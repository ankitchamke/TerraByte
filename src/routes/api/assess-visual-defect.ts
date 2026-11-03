import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { executeVisualDefectDiagnostic } from "@/lib/services/gemini-diagnostic";
import type { Database } from "@/integrations/supabase/types";

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
 * Visual Defect Diagnostics API (/api/assess-visual-defect)
 *
 * POST:
 * Authenticates user JWT, executes atomic diagnostic claim under user RLS,
 * runs multimodal visual analysis against Google Gemini 3.5 Flash-Lite (Free Tier)
 * with strict in-flight consent cancellation, and atomically saves results via service_role.
 *
 * Claim tokens are kept strictly server-side and never returned in HTTP responses.
 */
export async function handleVisualDefectRequest(request: Request): Promise<Response> {
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
  const userClient = createClient<Database>(supabaseUrl, supabaseKey, {
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

  // 2. Resolve caller profile and role via verified get_session_profile RPC
  const { data: sessionData, error: profileError } = await userClient.rpc("get_session_profile");
  const profile = sessionData && sessionData.length > 0 ? sessionData[0] : null;

  if (profileError || !profile) {
    return new Response(
      JSON.stringify({ error: "Could not find profile for authenticated user." }),
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
    return new Response(
      JSON.stringify({ error: "Invalid JSON request body." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const repairRequestId = typeof body?.["repairRequestId"] === "string" ? body["repairRequestId"].trim() : "";
  const forceRescan = body?.["forceRescan"] === true;

  if (!repairRequestId) {
    return new Response(
      JSON.stringify({ error: "Missing required parameter: repairRequestId." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // 4. Execute atomic claim RPC using caller-scoped user client (enforces RLS and permissions)
  const { data: claimData, error: claimRpcError } = await userClient.rpc(
    "claim_repair_visual_diagnostic",
    {
      p_repair_request_id: repairRequestId,
      p_force_rescan: forceRescan,
    },
  );

  if (claimRpcError) {
    return new Response(
      JSON.stringify({
        error: "Failed to execute diagnostic claim operation.",
        details: claimRpcError.message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const claimResult = claimData as {
    success?: boolean;
    claim_token?: string;
    status?: string;
    error?: string;
    details?: string;
    retry_after_seconds?: number;
  };

  if (!claimResult?.success || !claimResult?.claim_token) {
    const errCode = claimResult?.error || "CLAIM_FAILED";
    let httpStatus = 400;

    if (errCode === "COOLDOWN_ACTIVE") {
      httpStatus = 429;
    } else if (errCode === "ALREADY_PROCESSING") {
      httpStatus = 409;
    } else if (
      errCode === "FORBIDDEN_REQUEST_ACCESS" ||
      errCode === "FORBIDDEN_TECHNICIAN_NOT_ASSIGNED" ||
      errCode === "CANNOT_ACCESS_UNASSIGNED_TICKET" ||
      errCode === "CONSENT_NOT_GRANTED"
    ) {
      httpStatus = 403;
    } else if (errCode === "MAX_ATTEMPTS_EXCEEDED" || errCode === "MAX_RESCANS_EXCEEDED") {
      httpStatus = 422;
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: errCode,
        details: claimResult?.details,
        retryAfterSeconds: claimResult?.retry_after_seconds,
      }),
      {
        status: httpStatus,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Hold claimToken strictly in server execution scope (never returned to browser)
  const serverSideClaimToken = claimResult.claim_token;

  // 5. Fetch breakdown ticket details and equipment under caller-scoped client
  const { data: repairTicket, error: fetchError } = await userClient
    .from("repair_requests")
    .select("photos, symptoms, description, equipment_id")
    .eq("id", repairRequestId)
    .single();

  if (fetchError || !repairTicket) {
    return new Response(
      JSON.stringify({ error: "Could not retrieve breakdown ticket details." }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const { data: equipmentRecord, error: eqError } = await userClient
    .from("equipment")
    .select("make, model, year")
    .eq("id", repairTicket.equipment_id)
    .single();

  if (eqError || !equipmentRecord) {
    return new Response(
      JSON.stringify({ error: "Could not retrieve machinery equipment specifications." }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // 6. Dynamically import privileged service-role client for internal finalization
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // 7. Execute diagnostic service (Invokes Gemini, monitors consent, and saves atomically)
  const diagResult = await executeVisualDefectDiagnostic({
    supabaseAdmin,
    repairRequestId,
    claimToken: serverSideClaimToken,
    executorProfileId: profile.id,
    equipment: {
      make: equipmentRecord.make,
      model: equipmentRecord.model,
      year: equipmentRecord.year,
    },
    symptoms: repairTicket.symptoms || [],
    description: repairTicket.description || "",
    photos: repairTicket.photos || [],
  });

  if (!diagResult.success) {
    let statusHttp = 500;
    if (diagResult.status === "SKIPPED") {
      statusHttp = 403;
    } else if (diagResult.error === "RATE_LIMITED") {
      statusHttp = 429;
    } else if (diagResult.error === "TIMEOUT") {
      statusHttp = 504;
    } else if (diagResult.error === "CONFIG_ERROR") {
      statusHttp = 503;
    }

    return new Response(
      JSON.stringify({
        success: false,
        status: diagResult.status,
        error: diagResult.error,
        details: diagResult.details,
      }),
      {
        status: statusHttp,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // 8. Return successful sanitized diagnostic result (without claim_token)
  return new Response(
    JSON.stringify({
      success: true,
      status: "ANALYZED",
      data: diagResult.data,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

export const Route = createFileRoute("/api/assess-visual-defect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        return handleVisualDefectRequest(request);
      },
    },
  },
});
