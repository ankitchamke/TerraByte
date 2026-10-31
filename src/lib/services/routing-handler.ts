import { createClient } from "@supabase/supabase-js";
import { isValidGpsCoordinate } from "../location.ts";
import { computeOsrmRoute, type RouteEstimateResult } from "./routing.ts";

const CANONICAL_SUPABASE_URL = "https://hwdrypkvszwrcraujctw.supabase.co";
const CANONICAL_SUPABASE_KEY = "sb_publishable_N5Najdw3CfFpFv3gNy0sdA_HNGtdRrq";

function getSupabaseConfig() {
  const processEnv = typeof process !== "undefined" && process?.env ? process.env : undefined;
  const url =
    processEnv?.["SUPABASE_URL"] || processEnv?.["VITE_SUPABASE_URL"] || CANONICAL_SUPABASE_URL;
  const key =
    processEnv?.["SUPABASE_PUBLISHABLE_KEY"] ||
    processEnv?.["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
    processEnv?.["SUPABASE_ANON_KEY"] ||
    processEnv?.["VITE_SUPABASE_ANON_KEY"] ||
    CANONICAL_SUPABASE_KEY;
  return { url, key };
}

/**
 * Handles incoming POST /api/route-estimate requests.
 * Authenticates the caller, verifies technician assignment and active repair state,
 * retrieves destination GPS coordinates via user-scoped RLS, and executes standard
 * route computation via free public OSRM routing service.
 */
export async function handleRouteEstimateRequest(
  request: Request,
  options?: {
    apiKey?: string;
    fetchFn?: typeof fetch;
  },
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed. Use POST." }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 1. Authenticate caller bearer token
  const authHeader = request.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+([^\s,]+)$/i);
  const token = match?.[1];

  if (!token) {
    return new Response(
      JSON.stringify({ error: "Authentication required. Missing Bearer token." }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const { url: supabaseUrl, key: supabaseKey } = getSupabaseConfig();
  const userClient = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser(token);

  if (authError || !user) {
    return new Response(
      JSON.stringify({ error: "Invalid or expired session. Please sign in again." }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // 2. Identify caller profile and role
  const { data: profile, error: profileError } = await userClient
    .from("profiles")
    .select("id, role")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return new Response(
      JSON.stringify({ error: "Could not find profile for authenticated user." }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (profile.role !== "technician") {
    return new Response(
      JSON.stringify({
        error: "Route estimates are only available for field technicians.",
      }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // 3. Parse and validate request body
  let body: Record<string, unknown> | null = null;
  try {
    const raw = await request.json();
    if (typeof raw === "object" && raw !== null) {
      body = raw as Record<string, unknown>;
    }
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON request body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const repairId = typeof body?.["repairId"] === "string" ? body["repairId"] : "";
  const technicianLatitude =
    typeof body?.["technicianLatitude"] === "number" ? body["technicianLatitude"] : NaN;
  const technicianLongitude =
    typeof body?.["technicianLongitude"] === "number" ? body["technicianLongitude"] : NaN;

  if (!repairId) {
    return new Response(JSON.stringify({ error: "Missing required field: repairId." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!isValidGpsCoordinate(technicianLatitude, technicianLongitude)) {
    return new Response(
      JSON.stringify({
        error: "Invalid technician GPS coordinates. Latitude and longitude are required.",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // 4. Verify repair existence, assignment, and status
  const trimmedRepairId = repairId.trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    trimmedRepairId,
  );

  const repairQuery = userClient.from("repair_requests").select("id, technician_id, status");

  const { data: repair, error: repairError } = isUuid
    ? await repairQuery.eq("id", trimmedRepairId).maybeSingle()
    : await repairQuery.ilike("job_number", trimmedRepairId).maybeSingle();

  if (repairError || !repair) {
    return new Response(JSON.stringify({ error: "Repair request not found or inaccessible." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (repair.technician_id !== profile.id) {
    return new Response(
      JSON.stringify({
        error: "Access denied. You are not the technician assigned to this repair request.",
      }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (repair.status === "CANCELLED") {
    return new Response(
      JSON.stringify({
        error: "Route estimates are not available for cancelled repairs.",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (repair.status === "COMPLETED") {
    return new Response(
      JSON.stringify({
        error: "Route estimates are not available for completed repairs.",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // 5. Retrieve saved destination GPS coordinates via user-scoped RLS
  const { data: dispatchLoc, error: dispatchError } = await userClient
    .from("repair_dispatch_locations")
    .select("latitude, longitude, accuracy")
    .eq("repair_request_id", repair.id)
    .maybeSingle();

  if (dispatchError || !dispatchLoc) {
    return new Response(
      JSON.stringify({
        error: "No saved GPS location found for this repair request.",
      }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (!isValidGpsCoordinate(dispatchLoc.latitude, dispatchLoc.longitude)) {
    return new Response(
      JSON.stringify({
        error: "Saved repair GPS coordinates are invalid or corrupted.",
      }),
      {
        status: 422,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // 6. Execute route calculation via OSRM
  try {
    const result: RouteEstimateResult = await computeOsrmRoute(
      { latitude: technicianLatitude, longitude: technicianLongitude },
      { latitude: dispatchLoc.latitude, longitude: dispatchLoc.longitude },
      options?.fetchFn,
    );

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to calculate driving route.";
    const status = message.includes("No drivable route found")
      ? 422
      : message.includes("timed out")
        ? 504
        : 502;

    return new Response(
      JSON.stringify({
        error: `${message} You can still use the Google Maps navigation button for directions.`,
      }),
      {
        status,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
