import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { createNotification } from "./notifications";
import {
  computeOsrmRoute,
  compareTechnicianMatchesDefault,
  type TechnicianRoutingStatus,
} from "./routing.ts";
import { isValidGpsCoordinate } from "../location.ts";

export { compareTechnicianMatchesDefault };

export type TechnicianProfileRow = Database["public"]["Tables"]["technician_profiles"]["Row"];
export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
export type RepairRequestRow = Database["public"]["Tables"]["repair_requests"]["Row"];

export interface VerifiedTechnicianWithProfile extends TechnicianProfileRow {
  profile: Pick<ProfileRow, "id" | "full_name" | "phone" | "village"> | null;
}

export interface ScoredTechnicianMatch {
  technician: VerifiedTechnicianWithProfile;
  score: number; // Qualification score (0-90)
  brandMatch: boolean;
  skillMatch: boolean;
  reasons: string[];
  distanceKm: number | null;
  etaMin: number | null;
  routingStatus: TechnicianRoutingStatus;
  workshopName?: string;
  isExtendedTravel: boolean;
}

export interface AssignTechnicianInput {
  repair_request_id: string;
  technician_id: string; // The technician's profile UUID (profiles.id / technician_profiles.profile_id)
}

/**
 * Explicit safe column projection for public and operational technician discovery.
 * Strictly excludes sensitive KYC audit details (kyc_masked_id, kyc_remarks) and AI suggested skills
 * while preserving necessary operational, reputation, and relational profile attributes.
 */
export const TECHNICIAN_SAFE_PROJECTION =
  "id, profile_id, workshop_name, brands, skills, verified_skills, rating, review_count, is_available, is_verified, kyc_verified, jobs_completed, distance_km, eta_minutes, primary_facility_id, created_at, updated_at, profile:profile_id(id, full_name, phone, village)";

/**
 * Backward-compatible safe column projection for environments running Phase 12 database schema.
 * Strictly excludes missing Phase 13 columns (verified_skills, review_count, kyc_verified, primary_facility_id)
 * while preserving identical authorization, DAC column protections, and profile relations.
 */
export const TECHNICIAN_PHASE12_SAFE_PROJECTION =
  "id, profile_id, workshop_name, brands, skills, rating, is_available, is_verified, jobs_completed, distance_km, eta_minutes, created_at, updated_at, profile:profile_id(id, full_name, phone, village)";

export function isPhase13ColumnMissingError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const errObj = error as { code?: string; message?: string };
  const code = errObj.code || "";
  const msg = (errObj.message || "").toLowerCase();
  return (
    code === "42703" ||
    msg.includes("does not exist") ||
    msg.includes("verified_skills") ||
    msg.includes("review_count") ||
    msg.includes("kyc_verified") ||
    msg.includes("primary_facility_id")
  );
}

export function mapPhase12RowToVerifiedTechnician(
  row: Record<string, unknown>,
): VerifiedTechnicianWithProfile {
  return {
    ...row,
    verified_skills: null,
    review_count: null,
    kyc_verified: false,
    primary_facility_id: null,
    kyc_masked_id: null,
    kyc_remarks: null,
    kyc_verified_at: null,
    kyc_verified_by: null,
    suggested_skills: null,
    skills_confirmed_at: null,
    skills_confirmed_by: null,
  } as unknown as VerifiedTechnicianWithProfile;
}

let cachedProfile: { auth_user_id: string; id: string; role: string; expiresAt: number } | null =
  null;

/**
 * Resolves the authenticated user's profile ID and role.
 * Uses cached profile / active session when available to prevent waterfall latency.
 */
async function getAuthenticatedProfile(): Promise<{ id: string; role: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const sessionUser = session?.user;

  if (
    sessionUser &&
    cachedProfile &&
    cachedProfile.auth_user_id === sessionUser.id &&
    Date.now() < cachedProfile.expiresAt
  ) {
    return { id: cachedProfile.id, role: cachedProfile.role };
  }

  const user = sessionUser || (await supabase.auth.getUser()).data.user;

  if (!user) {
    throw new Error("Authentication required: Please sign in.");
  }

  if (
    cachedProfile &&
    cachedProfile.auth_user_id === user.id &&
    Date.now() < cachedProfile.expiresAt
  ) {
    return { id: cachedProfile.id, role: cachedProfile.role };
  }

  const { data: sessionData, error: profileError } = await supabase.rpc("get_session_profile");
  let profile = sessionData && sessionData.length > 0 ? sessionData[0] : null;

  if (!profile) {
    const { data: fallbackRow } = await supabase
      .from("profiles")
      .select("id, role")
      .or(`auth_user_id.eq.${user.id},id.eq.${user.id}`)
      .maybeSingle();

    if (fallbackRow) {
      profile = fallbackRow as unknown as typeof profile;
    }
  }

  if (!profile) {
    throw new Error("User profile not found. Please ensure your profile is initialized.");
  }

  cachedProfile = {
    auth_user_id: user.id,
    id: profile.id,
    role: profile.role,
    expiresAt: Date.now() + 60_000,
  };

  return profile;
}

export interface GetEligibleTechniciansOptions {
  computeRouteFn?: typeof computeOsrmRoute;
}

/**
 * Fetches and ranks eligible verified technicians for a specific repair request.
 * - Option C: Qualification-First Ranking with Routing as Decision Support.
 * - Only approved technicians (`is_verified = true`) are returned.
 * - Technicians who have declined the job (`declined_by`) are excluded.
 * - Ranked strictly by qualification score (brand 40, skill 30, availability 20; max 90)
 *   and authoritative tie-breakers (KYC, rating, jobs completed, name, id).
 * - OSRM route metrics are computed from registered workshop (primary_facility_id -> repair_facilities)
 *   to farmer breakdown location (repair_dispatch_locations) and attached as decision support.
 * - Routing status or failures never affect qualification ranking or candidate eligibility.
 */
export async function getEligibleTechnicians(
  repairRequestId: string,
  options?: GetEligibleTechniciansOptions,
): Promise<ScoredTechnicianMatch[]> {
  if (!repairRequestId) throw new Error("Repair request ID is required.");

  await getAuthenticatedProfile();

  // 1. Fetch repair request with equipment and assessment details
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    repairRequestId,
  );
  let make = "";
  let targetSkill = "";
  let declinedBy = new Set<string>();
  let repairId = "";

  const { data: repair, error: repairError } = isUuid
    ? await supabase
        .from("repair_requests")
        .select("*, equipment(*)")
        .eq("id", repairRequestId)
        .maybeSingle()
    : await supabase
        .from("repair_requests")
        .select("*, equipment(*)")
        .eq("job_number", repairRequestId)
        .maybeSingle();

  if (repair) {
    repairId = repair.id;
    make = (repair.equipment as { make?: string } | null)?.make ?? "";
    const assessment = (repair.assessment as { skill?: string } | null) ?? {};
    targetSkill = assessment.skill ?? "";
    declinedBy = new Set(repair.declined_by ?? []);
  } else {
    // If not found in remote database, check demo ticket fallback (e.g. offline demo tickets)
    if (typeof window !== "undefined") {
      try {
        const { tb } = await import("@/lib/tb-store");
        const demo = tb.repairs.find(
          (x) =>
            x.id === repairRequestId || (x as { jobNumber?: string }).jobNumber === repairRequestId,
        );
        if (demo) {
          repairId = demo.id;
          const eq = tb.equipment.find((e) => e.id === demo.equipmentId);
          make = eq?.make ?? "";
          targetSkill = (demo as { symptoms?: string[] }).symptoms?.[0] ?? "";
        }
      } catch {
        // Ignore fallback import error
      }
    }
    if (!make && !targetSkill && repairError) {
      throw new Error("Repair request not found or inaccessible.");
    }
  }

  // 2. Resolve destination GPS from repair_dispatch_locations
  let destinationGps: { latitude: number; longitude: number } | null = null;
  if (repairId) {
    const { data: locRow } = await supabase
      .from("repair_dispatch_locations")
      .select("latitude, longitude")
      .eq("repair_request_id", repairId)
      .maybeSingle();

    if (locRow && locRow.latitude != null && locRow.longitude != null) {
      const lat = Number(locRow.latitude);
      const lon = Number(locRow.longitude);
      if (isValidGpsCoordinate(lat, lon)) {
        destinationGps = {
          latitude: lat,
          longitude: lon,
        };
      }
    }
  }

  // 3. Query all verified technicians from PostgreSQL
  let verifiedTechs: VerifiedTechnicianWithProfile[] = [];
  const { data: techRows, error: techError } = await supabase
    .from("technician_profiles")
    .select(TECHNICIAN_SAFE_PROJECTION)
    .eq("is_verified", true);

  if (techError) {
    if (isPhase13ColumnMissingError(techError)) {
      console.warn(
        "[TerraByte] Phase 13 technician columns missing on database. Falling back to Phase 12 safe projection.",
      );
      const { data: fallbackRows, error: fallbackError } = await supabase
        .from("technician_profiles")
        .select(TECHNICIAN_PHASE12_SAFE_PROJECTION)
        .eq("is_verified", true);

      if (fallbackError) {
        throw new Error(`Failed to load technicians: ${fallbackError.message}`);
      }
      verifiedTechs = (fallbackRows || []).map(mapPhase12RowToVerifiedTechnician);
    } else {
      throw new Error(`Failed to load technicians: ${techError.message}`);
    }
  } else {
    verifiedTechs = (techRows as unknown as VerifiedTechnicianWithProfile[]) ?? [];
  }

  // 4. Filter approved, active candidates
  const eligibleTechs = verifiedTechs.filter(
    (t) =>
      Boolean(t.is_verified) &&
      Boolean(t.profile) &&
      Boolean(t.profile?.full_name?.trim()) &&
      t.profile?.full_name !== "Former Member" &&
      !declinedBy.has(t.profile_id),
  );

  // 5. Resolve registered primary facilities from repair_facilities table
  const facilityIds = Array.from(
    new Set(
      eligibleTechs
        .map((t) => t.primary_facility_id)
        .filter((id): id is string => typeof id === "string" && Boolean(id.trim())),
    ),
  );

  const facilitiesMap = new Map<
    string,
    { id: string; name: string; latitude: number; longitude: number }
  >();

  if (facilityIds.length > 0) {
    const { data: facilities } = await supabase
      .from("repair_facilities")
      .select("id, name, latitude, longitude")
      .in("id", facilityIds);

    if (facilities) {
      for (const f of facilities) {
        const lat = f.latitude != null ? Number(f.latitude) : NaN;
        const lon = f.longitude != null ? Number(f.longitude) : NaN;
        if (isValidGpsCoordinate(lat, lon)) {
          facilitiesMap.set(f.id, {
            id: f.id,
            name: f.name || "Registered Workshop",
            latitude: lat,
            longitude: lon,
          });
        }
      }
    }
  }

  // 6. Score candidates and compute OSRM routing decision support
  const routeFn = options?.computeRouteFn ?? computeOsrmRoute;

  const matches: ScoredTechnicianMatch[] = await Promise.all(
    eligibleTechs.map(async (t) => {
      const brandMatch = Boolean(make && t.brands && t.brands.includes(make));
      const skillMatch = Boolean(targetSkill && t.skills && t.skills.includes(targetSkill));
      const reasons: string[] = [];

      if (brandMatch) reasons.push(`${make} specialist`);
      if (skillMatch) reasons.push(`${targetSkill} expert`);
      if (t.is_available) reasons.push("Available now");

      // Qualification score: Brand (40) + Skill (30) + Availability (20); Max: 90. Proximity: 0.
      const qualificationScore =
        (brandMatch ? 40 : 0) + (skillMatch ? 30 : 0) + (t.is_available ? 20 : 0);

      // Resolve authoritative registered workshop origin
      const facility = t.primary_facility_id ? facilitiesMap.get(t.primary_facility_id) : null;
      const workshopName = facility?.name || t.workshop_name || "Authorized Service Centre";

      let distanceKm: number | null = null;
      let etaMin: number | null = null;
      let routingStatus: TechnicianRoutingStatus = "NO_COORDINATES";

      // Missing Coordinates Gate: Zero OSRM network requests if either origin or destination is invalid
      if (
        facility &&
        destinationGps &&
        isValidGpsCoordinate(facility.latitude, facility.longitude) &&
        isValidGpsCoordinate(destinationGps.latitude, destinationGps.longitude)
      ) {
        try {
          const routeResult = await routeFn(
            { latitude: facility.latitude, longitude: facility.longitude },
            { latitude: destinationGps.latitude, longitude: destinationGps.longitude },
          );
          if (routeResult && typeof routeResult.distanceKm === "number") {
            distanceKm = routeResult.distanceKm;
            etaMin = routeResult.durationMinutes;
            routingStatus = distanceKm > 50 ? "EXTENDED" : "AVAILABLE";
          } else {
            routingStatus = "OUTAGE";
          }
        } catch {
          // OSRM timeout, network error, 5xx, or NoRoute
          distanceKm = null;
          etaMin = null;
          routingStatus = "OUTAGE";
        }
      } else {
        routingStatus = "NO_COORDINATES";
        distanceKm = null;
        etaMin = null;
      }

      const isExtendedTravel = distanceKm !== null && distanceKm > 50;

      return {
        technician: {
          ...t,
          distance_km: distanceKm,
          eta_minutes: etaMin,
        },
        score: qualificationScore,
        brandMatch,
        skillMatch,
        reasons,
        distanceKm,
        etaMin,
        routingStatus,
        workshopName,
        isExtendedTravel,
      };
    }),
  );

  // 7. Deterministic Option C sorting: Qualification first, zero proximity influence
  return matches.sort(compareTechnicianMatchesDefault);
}

/**
 * Assigns a verified technician to a repair request.
 * Authorization Rules:
 * - Farmers can only assign/request technicians for their own repair requests while in 'REQUESTED' status.
 * - Service Centre (admin) can assign or reassign any repair request.
 * - Technicians cannot self-assign tickets.
 * - Unverified technicians cannot be assigned.
 * - Technicians who previously declined the ticket cannot be reassigned without triage.
 */
export async function assignTechnician(input: AssignTechnicianInput): Promise<RepairRequestRow> {
  const profile = await getAuthenticatedProfile();

  if (!input.repair_request_id) throw new Error("Repair request ID is required.");
  if (!input.technician_id) throw new Error("Technician ID is required.");

  // 1. Fetch repair request to validate ownership and state
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    input.repair_request_id,
  );
  const { data: repair, error: repairError } = isUuid
    ? await supabase
        .from("repair_requests")
        .select("*")
        .eq("id", input.repair_request_id)
        .maybeSingle()
    : await supabase
        .from("repair_requests")
        .select("*")
        .eq("job_number", input.repair_request_id)
        .maybeSingle();

  if (repairError || !repair) {
    throw new Error("Repair request not found or inaccessible.");
  }

  // 2. Authorization check
  const isOwner = repair.farmer_id === profile.id;
  const isAdmin = profile.role === "admin";

  if (!isOwner && !isAdmin) {
    throw new Error(
      "Unauthorized: Only the machinery owner or Service Centre can assign technicians.",
    );
  }

  // Terminal states cannot receive assignments
  if (repair.status === "COMPLETED" || repair.status === "CANCELLED") {
    throw new Error(`Cannot assign technician: Repair is already ${repair.status.toLowerCase()}.`);
  }

  // Farmers can only nominate/assign while ticket is in REQUESTED state
  if (isOwner && !isAdmin && repair.status !== "REQUESTED") {
    throw new Error(
      `Cannot reassign technician: Repair is already in '${repair.status}' stage. Contact Service Centre.`,
    );
  }

  // 3. Validate candidate technician existence, role, and verification status
  const { data: techRecord, error: techCheckError } = await supabase
    .from("technician_profiles")
    .select(
      "profile_id, workshop_name, is_verified, is_available, profile:profile_id(id, full_name, role)",
    )
    .eq("profile_id", input.technician_id)
    .maybeSingle();

  if (techCheckError || !techRecord) {
    throw new Error("Technician profile not found. Please select a valid registered technician.");
  }

  const techProfile = (techRecord as { profile?: { role?: string } | null }).profile;
  if (!techProfile || techProfile.role !== "technician") {
    throw new Error("Invalid assignment: Selected user profile is not a registered technician.");
  }

  if (!techRecord.is_verified) {
    throw new Error(
      "Assignment rejected: Selected technician has not been verified by the Service Centre.",
    );
  }

  // Check if technician previously declined this ticket
  if (repair.declined_by && repair.declined_by.includes(input.technician_id)) {
    throw new Error(
      "Assignment rejected: This technician has already declined this repair request.",
    );
  }

  const now = new Date().toISOString();
  const techName = techProfile.full_name || "Technician";
  const workshopName = techRecord.workshop_name || "Field Workshop";

  // 4. Persist assignment in repair_requests
  let updateQuery = supabase
    .from("repair_requests")
    .update({
      technician_id: input.technician_id,
      status_since: now,
    })
    .eq("id", repair.id);

  if (isOwner && !isAdmin) {
    updateQuery = updateQuery.eq("status", "REQUESTED");
  } else {
    updateQuery = updateQuery.neq("status", "COMPLETED").neq("status", "CANCELLED");
  }

  const { data: updatedRepair, error: updateError } = await updateQuery.select().maybeSingle();

  if (updateError) {
    throw new Error(`Failed to assign technician: ${updateError.message}`);
  }

  if (!updatedRepair) {
    throw new Error(
      "This repair request could not be assigned because its status changed. Please refresh.",
    );
  }

  // 5. Record chronological audit event in repair_timeline
  const timelineStatus = isAdmin && repair.technician_id ? "REASSIGNED" : "REQUESTED";
  const timelineNote =
    isAdmin && repair.technician_id
      ? `Reassigned to ${techName} (${workshopName}) by Service Centre`
      : `Technician assigned: ${techName} (${workshopName})`;

  const { error: timelineError } = await supabase.from("repair_timeline").insert({
    repair_request_id: repair.id,
    status: timelineStatus,
    note: timelineNote,
    created_by_role: isAdmin ? "admin" : "farmer",
    created_by_id: profile.id,
  });

  if (timelineError) {
    console.warn(
      `[TerraByte] Warning: Failed to record assignment timeline entry: ${timelineError.message}`,
    );
  }

  // Notify technician of assignment
  try {
    await createNotification({
      recipient_role: "technician",
      recipient_user_id: input.technician_id,
      notification_text: `You have been assigned to repair request ${repair.job_number}.`,
      link_target: `/technician/job/${repair.id}`,
    });

    if (isAdmin) {
      await createNotification({
        recipient_role: "farmer",
        recipient_user_id: repair.farmer_id,
        notification_text: `Technician assigned to ${repair.job_number}. Inspection on the way.`,
        link_target: `/farmer/repair/${repair.id}`,
      });
    }
  } catch (notifErr) {
    console.warn("[TerraByte] Warning: Failed to send assignment notification:", notifErr);
  }

  return updatedRepair;
}

/**
 * Fetches the currently assigned technician for a repair request, if any.
 */
export async function getAssignedTechnician(
  repairRequestId: string,
): Promise<VerifiedTechnicianWithProfile | null> {
  if (!repairRequestId) throw new Error("Repair request ID is required.");

  await getAuthenticatedProfile();

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    repairRequestId,
  );
  const { data: repair, error: repairError } = isUuid
    ? await supabase
        .from("repair_requests")
        .select("technician_id")
        .eq("id", repairRequestId)
        .maybeSingle()
    : await supabase
        .from("repair_requests")
        .select("technician_id")
        .eq("job_number", repairRequestId)
        .maybeSingle();

  if (repairError || !repair || !repair.technician_id) {
    return null;
  }

  const { data: tech, error: techError } = await supabase
    .from("technician_profiles")
    .select(TECHNICIAN_SAFE_PROJECTION)
    .eq("profile_id", repair.technician_id)
    .maybeSingle();

  if (techError) {
    if (isPhase13ColumnMissingError(techError)) {
      const { data: fallbackTech, error: fallbackError } = await supabase
        .from("technician_profiles")
        .select(TECHNICIAN_PHASE12_SAFE_PROJECTION)
        .eq("profile_id", repair.technician_id)
        .maybeSingle();

      if (fallbackError || !fallbackTech) return null;
      return mapPhase12RowToVerifiedTechnician(fallbackTech);
    }
    return null;
  }

  if (!tech) {
    return null;
  }

  return tech as unknown as VerifiedTechnicianWithProfile;
}

/**
 * Fetches the technician profile details for the authenticated user, if registered.
 */
export async function getMyTechnicianProfile(): Promise<VerifiedTechnicianWithProfile | null> {
  const profile = await getAuthenticatedProfile();

  const { data, error } = await supabase
    .from("technician_profiles")
    .select(TECHNICIAN_SAFE_PROJECTION)
    .eq("profile_id", profile.id)
    .maybeSingle();

  if (error) {
    if (isPhase13ColumnMissingError(error)) {
      const { data: fallbackData, error: fallbackError } = await supabase
        .from("technician_profiles")
        .select(TECHNICIAN_PHASE12_SAFE_PROJECTION)
        .eq("profile_id", profile.id)
        .maybeSingle();

      if (fallbackError) {
        console.error(
          "[TerraByte] Failed to load technician profile (Phase 12 fallback):",
          fallbackError,
        );
        return null;
      }
      return fallbackData ? mapPhase12RowToVerifiedTechnician(fallbackData) : null;
    }
    console.error("[TerraByte] Failed to load technician profile:", error);
    return null;
  }

  return (data as unknown as VerifiedTechnicianWithProfile) ?? null;
}

/**
 * Updates the availability status for the authenticated technician.
 */
export async function updateTechnicianAvailability(isAvailable: boolean): Promise<boolean> {
  const profile = await getAuthenticatedProfile();

  const { error } = await supabase
    .from("technician_profiles")
    .update({
      is_available: isAvailable,
      updated_at: new Date().toISOString(),
    })
    .eq("profile_id", profile.id);

  if (error) {
    throw new Error(`Failed to update availability: ${error.message}`);
  }

  return isAvailable;
}

/**
 * Fetches all registered technicians for Service Centre operations and workload overview.
 */
export async function getVerifiedTechnicians(): Promise<VerifiedTechnicianWithProfile[]> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) {
    throw new Error("Authentication required: Please sign in.");
  }

  const { data, error } = await supabase
    .from("technician_profiles")
    .select(TECHNICIAN_SAFE_PROJECTION)
    .order("created_at", { ascending: true });

  if (error) {
    if (isPhase13ColumnMissingError(error)) {
      console.warn(
        "[TerraByte] Phase 13 technician columns missing on database. Falling back to Phase 12 safe projection.",
      );
      const { data: fallbackData, error: fallbackError } = await supabase
        .from("technician_profiles")
        .select(TECHNICIAN_PHASE12_SAFE_PROJECTION)
        .order("created_at", { ascending: true });

      if (fallbackError) {
        throw new Error(`Failed to load technicians: ${fallbackError.message}`);
      }
      return (fallbackData || []).map(mapPhase12RowToVerifiedTechnician);
    }
    throw new Error(`Failed to load technicians: ${error.message}`);
  }

  return (data as unknown as VerifiedTechnicianWithProfile[]) ?? [];
}

/**
 * Sets verification status for a technician profile (admin-only).
 * When approved (isVerified = true), dispatches an idempotent notification to the technician.
 * Uses the hardened SECURITY DEFINER admin RPC to update protected verification governance.
 */
export async function setTechnicianVerification(
  profileId: string,
  isVerified: boolean,
): Promise<void> {
  if (!profileId) throw new Error("Technician profile ID is required.");
  const profile = await getAuthenticatedProfile();
  if (profile.role !== "admin") {
    throw new Error(
      "Unauthorized: Only service centre administrators can update technician verification.",
    );
  }

  // Use the hardened admin RPC to execute verified mutation securely
  const { error } = await supabase.rpc("admin_set_technician_verification", {
    p_technician_profile_id: profileId,
    p_is_verified: isVerified,
  });

  if (error) {
    throw new Error(`Failed to update technician verification: ${error.message}`);
  }

  // Idempotently notify technician upon approval
  if (isVerified) {
    try {
      const { data: existing } = await supabase
        .from("notifications")
        .select("id")
        .eq("recipient_user_id", profileId)
        .ilike("notification_text", "%approved by the service centre%")
        .limit(1);

      if (!existing || existing.length === 0) {
        await createNotification({
          recipient_role: "technician",
          recipient_user_id: profileId,
          notification_text:
            "Your technician account has been approved by the Service Centre. You can now accept repair jobs.",
          link_target: "/technician",
        });
      }
    } catch (notifErr) {
      console.warn(
        "[TerraByte] Warning: Failed to send technician verification notification:",
        notifErr,
      );
    }
  }
}

/**
 * Idempotently notifies Service Centre administrators when a new technician registers.
 */
export async function notifyAdminOnTechnicianRegistration(
  technicianName: string,
  workshopName?: string,
): Promise<void> {
  const name = technicianName?.trim() || "New technician";
  const workshop = workshopName?.trim() || "Workshop";

  try {
    const { data: existing } = await supabase
      .from("notifications")
      .select("id")
      .eq("recipient_role", "admin")
      .ilike("notification_text", `%${name}%`)
      .limit(1);

    if (!existing || existing.length === 0) {
      await createNotification({
        recipient_role: "admin",
        recipient_user_id: null,
        notification_text: `New technician registration: ${name} (${workshop}). Pending verification.`,
        link_target: "/admin/technicians",
      });
    }
  } catch (notifErr) {
    console.warn(
      "[TerraByte] Warning: Failed to send admin notification for technician registration:",
      notifErr,
    );
  }
}

// ==============================================================================
// PHASE 13 MILESTONE 3: IN-PERSON PHYSICAL KYC & SKILL CERTIFICATION
// ==============================================================================

export const APPROVED_KYC_DOCUMENT_TYPES = [
  {
    code: "AADHAAR_PHYSICAL",
    label: "Physical Aadhaar Card (Inspection Only)",
    example: "XXXX-XXXX-1234",
    maskPattern: /^XXXX-XXXX-[0-9]{4}$/i,
    description:
      "Physical plastic/paper card inspected at Nagpur Service Centre. Enter strictly masked last-4 digits.",
  },
  {
    code: "PAN_CARD",
    label: "Permanent Account Number (PAN) Card",
    example: "XXXXX1234X",
    maskPattern: /^[Xx]{5}[0-9]{4}[A-Za-z]$/i,
    description:
      "Income Tax PAN card inspected in person. Enter 5 masked letters, 4 visible digits, and 1 character: XXXXX1234X.",
  },
  {
    code: "VOTER_ID",
    label: "Voter Identity Card (EPIC)",
    example: "ABC******7",
    maskPattern: /^[A-Za-z]{3}[*Xx]{6}[0-9A-Za-z]$/i,
    description:
      "Election Commission Voter ID card. Exactly 10 characters with 3-letter prefix and masked body: ABC******7.",
  },
  {
    code: "DRIVING_LICENSE",
    label: "Commercial / Heavy Driving License",
    example: "MH-31-2018-XXX1234",
    maskPattern: /^[A-Za-z]{2}[- ]?[0-9]{2}[- ]?(?:[0-9]{4}|YYYY)[- ]?[*Xx]{3,7}[0-9A-Za-z]{1,4}$/i,
    description:
      "Transport heavy/commercial driving license. Enter State, RTO, year, and masked serial (e.g. MH-31-2018-XXX1234).",
  },
  {
    code: "WORKSHOP_TRADE_LICENSE",
    label: "Maharashtra Workshop / Trade License",
    example: "NMC/WAR/2023/XX1234",
    maskPattern: /^(?=.*[*Xx]{2,})[A-Za-z0-9][A-Za-z0-9\-/ ]{6,28}[A-Za-z0-9]$/i,
    description:
      "Shop & Establishment or Gram Panchayat municipal trade license (8–30 chars, masked identifier e.g. NMC/WAR/2023/XX1234).",
  },
] as const;

export type KycDocumentTypeCode = (typeof APPROVED_KYC_DOCUMENT_TYPES)[number]["code"];

/**
 * Validates whether an input represents an illegal full-length credential number.
 * Enforces zero-tolerance anti-PII protection on client and server.
 */
export function detectIllegalFullId(input: string): {
  isIllegal: boolean;
  message?: string;
} {
  const trimmed = (input || "").trim();
  if (/^[0-9]{12}$/.test(trimmed) || /^[0-9]{4}[ -][0-9]{4}[ -][0-9]{4}$/.test(trimmed)) {
    return {
      isIllegal: true,
      message:
        "ILLEGAL_FULL_UID_STORAGE: Storing full 12-digit Aadhaar numbers is strictly prohibited. Enter masked last-4 only: XXXX-XXXX-1234.",
    };
  }
  if (/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(trimmed) && !/^[Xx]{5}/.test(trimmed)) {
    return {
      isIllegal: true,
      message:
        "ILLEGAL_FULL_PAN_STORAGE: Storing complete PAN numbers is strictly prohibited. Use masked format: XXXXX1234X.",
    };
  }
  if (/^[A-Z]{3}[0-9]{7}$/i.test(trimmed)) {
    return {
      isIllegal: true,
      message:
        "ILLEGAL_FULL_VOTER_ID_STORAGE: Storing complete Voter IDs is strictly prohibited. Use 10-character masked format: ABC******7.",
    };
  }
  if (/^[A-Z]{2}[- ]?[0-9]{2}[- ]?[0-9]{4}[- ]?[0-9]{7}$/i.test(trimmed)) {
    return {
      isIllegal: true,
      message:
        "ILLEGAL_FULL_DL_STORAGE: Storing complete Driving Licence numbers is strictly prohibited. Use masked format: MH-31-2018-XXX1234.",
    };
  }
  return { isIllegal: false };
}

/**
 * Validates that a masked identifier matches the canonical regex for the document type.
 */
export function isValidMaskedId(docType: string, maskedId: string): boolean {
  const trimmed = (maskedId || "").trim();
  if (!trimmed) return false;
  const doc = APPROVED_KYC_DOCUMENT_TYPES.find((d) => d.code === docType);
  if (!doc) return false;

  switch (docType) {
    case "AADHAAR_PHYSICAL":
      return doc.maskPattern.test(trimmed);
    case "PAN_CARD":
      return doc.maskPattern.test(trimmed);
    case "VOTER_ID":
      return trimmed.length === 10 && doc.maskPattern.test(trimmed);
    case "DRIVING_LICENSE":
      return doc.maskPattern.test(trimmed);
    case "WORKSHOP_TRADE_LICENSE":
      return trimmed.length >= 8 && trimmed.length <= 30 && doc.maskPattern.test(trimmed);
    default:
      return doc.maskPattern.test(trimmed);
  }
}

/**
 * Checks for credential leak in remarks (rejects 6 or more consecutive digits).
 */
export function detectSensitiveDataInRemarks(remarks: string): boolean {
  return /[0-9]{6,}/.test(remarks || "");
}

export interface VerifyKycInput {
  technicianProfileId: string;
  documentType: string;
  maskedId: string;
  remarks?: string;
}

/**
 * Verifies a technician's in-person physical identity inspection (Service Centre Admin only).
 * Dispatches the hardened SECURITY DEFINER verify_technician_kyc RPC.
 */
export async function verifyTechnicianKyc(
  input: VerifyKycInput,
): Promise<{ success: boolean; technician_id: string; verified_at: string }> {
  const caller = await getAuthenticatedProfile();
  if (caller.role !== "admin") {
    throw new Error("UNAUTHORIZED: Only Service Centre administrators can verify technician KYC.");
  }

  const trimmedId = (input.maskedId || "").trim();
  const trimmedRemarks = (input.remarks || "").trim();

  // 1. Check for illegal full credentials
  const illegalCheck = detectIllegalFullId(trimmedId);
  if (illegalCheck.isIllegal) {
    throw new Error(illegalCheck.message || "Illegal complete identifier detected.");
  }

  // 2. Enforce canonical masked pattern per document type
  if (!isValidMaskedId(input.documentType, trimmedId)) {
    const doc = APPROVED_KYC_DOCUMENT_TYPES.find((d) => d.code === input.documentType);
    throw new Error(
      `INVALID_MASK: Identifier must strictly follow the canonical masked format for ${
        doc?.label || input.documentType
      } (e.g. ${doc?.example || "XXXX-XXXX-1234"}).`,
    );
  }

  // 3. Privacy guard on remarks
  if (detectSensitiveDataInRemarks(trimmedRemarks)) {
    throw new Error(
      "SENSITIVE_DATA_IN_REMARKS: Remarks must not contain credential numbers (6 or more digits).",
    );
  }

  const { data, error } = await supabase.rpc("verify_technician_kyc", {
    p_technician_profile_id: input.technicianProfileId,
    p_document_type: input.documentType,
    p_masked_id: trimmedId,
    p_remarks: trimmedRemarks,
  });

  if (error) {
    if (
      error.code === "PGRST202" ||
      error.message?.includes("schema cache") ||
      error.message?.includes("verify_technician_kyc")
    ) {
      throw new Error(
        "Technician KYC verification requires the Phase 13 database migration, which is pending approval for this environment.",
      );
    }
    throw new Error(error.message || "Failed to verify technician KYC.");
  }

  return data as {
    success: boolean;
    technician_id: string;
    verified_at: string;
  };
}

/**
 * Promotes an AI-suggested skill to verified_skills for a technician (Service Centre Admin only).
 */
export async function approveTechnicianSkill(
  technicianProfileId: string,
  skill: string,
): Promise<{ success: boolean; skill: string; verified_skills: string[] }> {
  const caller = await getAuthenticatedProfile();
  if (caller.role !== "admin") {
    throw new Error(
      "UNAUTHORIZED: Only Service Centre administrators can approve technician skills.",
    );
  }

  const trimmedSkill = (skill || "").trim();
  if (!trimmedSkill) {
    throw new Error("EMPTY_SKILL: Skill cannot be empty or whitespace.");
  }

  const { data, error } = await supabase.rpc("approve_technician_skill", {
    p_technician_profile_id: technicianProfileId,
    p_skill: trimmedSkill,
  });

  if (error) {
    if (
      error.code === "PGRST202" ||
      error.message?.includes("schema cache") ||
      error.message?.includes("approve_technician_skill")
    ) {
      throw new Error(
        "Skill certification requires the Phase 13 database migration, which is pending approval for this environment.",
      );
    }
    throw new Error(error.message || "Failed to approve technician skill.");
  }

  return data as {
    success: boolean;
    skill: string;
    verified_skills: string[];
  };
}

/**
 * Dismisses an AI-suggested skill from a technician's profile (Service Centre Admin only).
 */
export async function dismissTechnicianSkill(
  technicianProfileId: string,
  skill: string,
): Promise<{
  success: boolean;
  skill: string;
  ai_suggested_skills: string[];
}> {
  const caller = await getAuthenticatedProfile();
  if (caller.role !== "admin") {
    throw new Error(
      "UNAUTHORIZED: Only Service Centre administrators can dismiss technician skills.",
    );
  }

  const trimmedSkill = (skill || "").trim();
  if (!trimmedSkill) {
    throw new Error("EMPTY_SKILL: Skill cannot be empty or whitespace.");
  }

  const { data, error } = await supabase.rpc("dismiss_technician_skill", {
    p_technician_profile_id: technicianProfileId,
    p_skill: trimmedSkill,
  });

  if (error) {
    if (
      error.code === "PGRST202" ||
      error.message?.includes("schema cache") ||
      error.message?.includes("dismiss_technician_skill")
    ) {
      throw new Error(
        "Skill certification requires the Phase 13 database migration, which is pending approval for this environment.",
      );
    }
    throw new Error(error.message || "Failed to dismiss technician skill.");
  }

  return data as {
    success: boolean;
    skill: string;
    ai_suggested_skills: string[];
  };
}

export interface TechnicianPrivateProfile {
  profile_id: string;
  phone: string | null;
  kyc_verified: boolean;
  kyc_verified_at: string | null;
  kyc_verified_by: string | null;
  kyc_document_type: string | null;
  kyc_masked_id: string | null;
  kyc_remarks: string | null;
  ai_suggested_skills: string[];
  verified_skills: string[];
}

/**
 * Fetches the private KYC and AI skills profile for a technician.
 * Accessible only by the technician themselves or Service Centre administrators.
 */
export async function getTechnicianPrivateProfile(
  technicianProfileId: string,
): Promise<TechnicianPrivateProfile | null> {
  const { data, error } = await supabase.rpc("get_technician_private_profile", {
    p_technician_profile_id: technicianProfileId,
  });

  if (error) {
    if (error.code === "42501" || error.message?.includes("ACCESS_DENIED")) {
      throw new Error(
        "Access denied: You are not authorized to view private KYC details for this technician.",
      );
    }
    console.warn("[TerraByte] Private profile RPC unavailable or failed:", error.message);
    return null;
  }

  if (!data) return null;

  const raw = data as Record<string, unknown>;
  return {
    profile_id: (raw.profile_id as string) || technicianProfileId,
    phone: (raw.phone as string) || null,
    kyc_verified: Boolean(raw.kyc_verified),
    kyc_verified_at: (raw.kyc_verified_at as string) || null,
    kyc_verified_by: (raw.kyc_verified_by as string) || null,
    kyc_document_type: (raw.kyc_document_type as string) || null,
    kyc_masked_id: (raw.kyc_masked_id as string) || null,
    kyc_remarks: (raw.kyc_remarks as string) || null,
    ai_suggested_skills: Array.isArray(raw.ai_suggested_skills)
      ? (raw.ai_suggested_skills as string[])
      : [],
    verified_skills: Array.isArray(raw.verified_skills) ? (raw.verified_skills as string[]) : [],
  };
}

export interface AdminTechnicianRow {
  id: string; // profile_id
  full_name: string;
  phone: string | null;
  village: string | null;
  created_at: string;
  workshop_name: string;
  is_verified: boolean;
  kyc_verified: boolean;
  kyc_verified_at: string | null;
  kyc_verified_by: string | null;
  kyc_document_type: string | null;
  kyc_masked_id: string | null;
  kyc_remarks: string | null;
  verified_skills: string[];
  ai_suggested_skills: string[];
  brands: string[];
  skills: string[];
  rating: number | null;
  jobs_completed: number;
}

/**
 * Loads all technicians across Vidarbha with full verification status, KYC details, and AI skills for the admin portal.
 */
export async function getAllTechniciansAdmin(): Promise<AdminTechnicianRow[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      `
      id,
      full_name,
      phone,
      village,
      created_at,
      technician_profiles (
        workshop_name,
        brands,
        skills,
        rating,
        jobs_completed,
        is_verified,
        kyc_verified,
        kyc_verified_at,
        kyc_verified_by,
        kyc_document_type,
        kyc_masked_id,
        kyc_remarks,
        verified_skills,
        ai_suggested_skills
      )
    `,
    )
    .eq("role", "technician")
    .order("created_at", { ascending: false });

  if (error) {
    // If Phase 13 columns are missing on remote schema, fallback to Phase 12 projection
    if (isPhase13ColumnMissingError(error)) {
      const { data: fallbackData, error: fallbackError } = await supabase
        .from("profiles")
        .select(
          `
          id,
          full_name,
          phone,
          village,
          created_at,
          technician_profiles (
            workshop_name,
            brands,
            skills,
            rating,
            jobs_completed,
            is_verified
          )
        `,
        )
        .eq("role", "technician")
        .order("created_at", { ascending: false });

      if (fallbackError) {
        throw new Error(`Failed to load technicians: ${fallbackError.message}`);
      }

      return ((fallbackData as unknown as Array<Record<string, unknown>>) || []).map((p) => {
        const tp = Array.isArray(p.technician_profiles)
          ? (p.technician_profiles[0] as Record<string, unknown> | undefined)
          : (p.technician_profiles as Record<string, unknown> | undefined);
        return {
          id: p.id as string,
          full_name: (p.full_name as string) || "Unnamed Technician",
          phone: (p.phone as string) || null,
          village: (p.village as string) || null,
          created_at: p.created_at as string,
          workshop_name: (tp?.workshop_name as string) || "Workshop not provided",
          is_verified: Boolean(tp?.is_verified),
          kyc_verified: false,
          kyc_verified_at: null,
          kyc_verified_by: null,
          kyc_document_type: null,
          kyc_masked_id: null,
          kyc_remarks: null,
          verified_skills: [],
          ai_suggested_skills: [],
          brands: Array.isArray(tp?.brands) ? (tp.brands as string[]) : [],
          skills: Array.isArray(tp?.skills) ? (tp.skills as string[]) : [],
          rating: typeof tp?.rating === "number" ? tp.rating : null,
          jobs_completed: typeof tp?.jobs_completed === "number" ? tp.jobs_completed : 0,
        };
      });
    }

    throw new Error(`Failed to load technicians: ${error.message}`);
  }

  return ((data as unknown as Array<Record<string, unknown>>) || []).map((p) => {
    const tp = Array.isArray(p.technician_profiles)
      ? (p.technician_profiles[0] as Record<string, unknown> | undefined)
      : (p.technician_profiles as Record<string, unknown> | undefined);

    const verifiedSkills = Array.isArray(tp?.verified_skills)
      ? (tp.verified_skills as string[])
      : [];
    const aiSuggestedSkills = Array.isArray(tp?.ai_suggested_skills)
      ? (tp.ai_suggested_skills as string[])
      : [];

    return {
      id: p.id as string,
      full_name: (p.full_name as string) || "Unnamed Technician",
      phone: (p.phone as string) || null,
      village: (p.village as string) || null,
      created_at: p.created_at as string,
      workshop_name: (tp?.workshop_name as string) || "Workshop not provided",
      is_verified: Boolean(tp?.is_verified),
      kyc_verified: Boolean(tp?.kyc_verified),
      kyc_verified_at: (tp?.kyc_verified_at as string) || null,
      kyc_verified_by: (tp?.kyc_verified_by as string) || null,
      kyc_document_type: (tp?.kyc_document_type as string) || null,
      kyc_masked_id: (tp?.kyc_masked_id as string) || null,
      kyc_remarks: (tp?.kyc_remarks as string) || null,
      verified_skills: verifiedSkills,
      ai_suggested_skills: aiSuggestedSkills,
      brands: Array.isArray(tp?.brands) ? (tp.brands as string[]) : [],
      skills: Array.isArray(tp?.skills) ? (tp.skills as string[]) : [],
      rating: typeof tp?.rating === "number" ? tp.rating : null,
      jobs_completed: typeof tp?.jobs_completed === "number" ? tp.jobs_completed : 0,
    };
  });
}
