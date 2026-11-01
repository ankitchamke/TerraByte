import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { createNotification } from "./notifications";
import {
  isValidGpsCoordinate,
  getNagpurTahsilCentroid,
  computeApproximateRoadDistance,
  type GpsPoint,
  type DistanceSource,
} from "../location.ts";
import { normalizeRepairDoorstepUrgency } from "./doorstep-service.ts";
import { resolveDrivingDistance } from "./routing.ts";

import {
  computeTechnicianDispatchScore,
  type ComputeTechnicianDispatchScoreInput,
  type TechnicianDispatchScoreBreakdown,
  type ScoredTechnicianMatch as ScoredTechnicianMatchGeneric,
  type GetEligibleTechniciansOptions,
} from "./technician-dispatch.ts";

export type {
  ComputeTechnicianDispatchScoreInput,
  TechnicianDispatchScoreBreakdown,
  GetEligibleTechniciansOptions,
};
export { computeTechnicianDispatchScore };

export type TechnicianProfileRow = Database["public"]["Tables"]["technician_profiles"]["Row"];
export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
export type RepairRequestRow = Database["public"]["Tables"]["repair_requests"]["Row"];

export interface VerifiedTechnicianWithProfile extends TechnicianProfileRow {
  profile: Pick<ProfileRow, "id" | "full_name" | "phone" | "village"> | null;
}

export type ScoredTechnicianMatch = ScoredTechnicianMatchGeneric<VerifiedTechnicianWithProfile>;

export interface AssignTechnicianInput {
  repair_request_id: string;
  technician_id: string; // The technician's profile UUID (profiles.id / technician_profiles.profile_id)
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

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role")
    .or(`auth_user_id.eq.${user.id},id.eq.${user.id}`)
    .maybeSingle();

  if (profileError || !profile) {
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

/**
 * Fetches and ranks eligible verified technicians for a specific repair request.
 * - Only approved technicians (is_verified = true) are returned.
 * - Technicians who have declined the job (declined_by) are excluded.
 * - Ranked using multi-factor adaptive scoring: proximity / ETA, availability, active workload,
 *   brand specialization, repair skill, doorstep mobile capability, and operational urgency.
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

  if (repairError || !repair) {
    throw new Error("Repair request not found or inaccessible.");
  }

  const equipment = (repair as unknown as { equipment?: { make?: string } | null }).equipment;
  const make = equipment?.make ?? "";
  const assessment = (repair.assessment as Record<string, unknown> | null) ?? {};
  const targetSkill = typeof assessment["skill"] === "string" ? assessment["skill"] : "";
  const declinedBy = new Set(repair.declined_by ?? []);

  // Phase 10.2 doorstep service and urgency attributes
  const doorstep = normalizeRepairDoorstepUrgency(repair);
  const isCriticalStopped = doorstep.urgency_level === "CRITICAL" && doorstep.is_machine_stopped;

  // 2. Resolve farmer coordinates (exact GPS or tahsil centroid)
  let farmerPoint: GpsPoint | null = null;
  let distanceSource: DistanceSource = "unknown";

  try {
    const { data: dispatchLoc } = await supabase
      .from("repair_dispatch_locations")
      .select("latitude, longitude, accuracy")
      .eq("repair_request_id", repair.id)
      .maybeSingle();

    if (dispatchLoc && isValidGpsCoordinate(dispatchLoc.latitude, dispatchLoc.longitude)) {
      farmerPoint = { latitude: dispatchLoc.latitude, longitude: dispatchLoc.longitude };
      distanceSource = "exact_gps";
    }
  } catch {
    // RLS or missing table gracefully falls through to coarse location
  }

  if (!farmerPoint && repair.location) {
    const centroid = getNagpurTahsilCentroid(repair.location);
    if (centroid) {
      farmerPoint = centroid;
      distanceSource = "tahsil_centroid";
    }
  }

  // 3. Query all verified technicians from PostgreSQL
  const { data: techRows, error: techError } = await supabase
    .from("technician_profiles")
    .select("*, profile:profile_id(id, full_name, phone, village)")
    .eq("is_verified", true);

  if (techError) {
    throw new Error(`Failed to load technicians: ${techError.message}`);
  }

  const verifiedTechs = (techRows as unknown as VerifiedTechnicianWithProfile[]) ?? [];

  // 4. Query active repair workload across technicians in a single query
  const activeJobCounts = new Map<string, number>();
  try {
    const { data: activeRepairs } = await supabase
      .from("repair_requests")
      .select("technician_id")
      .in("status", ["ACCEPTED", "IN_PROGRESS", "WAITING_FOR_PARTS"]);

    for (const r of activeRepairs || []) {
      if (r.technician_id) {
        activeJobCounts.set(r.technician_id, (activeJobCounts.get(r.technician_id) || 0) + 1);
      }
    }
  } catch {
    // non-fatal if active workload query fails
  }

  // 5. Score and rank candidates using adaptive location-aware model
  const eligibleTechs = verifiedTechs.filter(
    (t) =>
      Boolean(t.is_verified) &&
      Boolean(t.profile) &&
      Boolean(t.profile?.full_name?.trim()) &&
      t.profile?.full_name !== "Former Member" &&
      !declinedBy.has(t.profile_id),
  );

  const preliminaryMatches: ScoredTechnicianMatch[] = eligibleTechs.map((t) => {
    const brandMatch = Boolean(make && t.brands && t.brands.includes(make));
    const skillMatch = Boolean(targetSkill && t.skills && t.skills.includes(targetSkill));

    // Technician location resolution (workshop coordinates or tahsil centroid)
    let techPoint: GpsPoint | null = null;
    const wLat = t.workshop_latitude;
    const wLng = t.workshop_longitude;
    if (typeof wLat === "number" && typeof wLng === "number" && isValidGpsCoordinate(wLat, wLng)) {
      techPoint = { latitude: wLat, longitude: wLng };
    } else {
      const techLoc = t.profile?.village || t.workshop_name;
      techPoint = getNagpurTahsilCentroid(techLoc);
    }

    // Doorstep capability & travel radius defaults for backward compatibility
    const isDoorstepCapable = t.is_doorstep_capable ?? true;
    const maxRadiusKm = t.max_travel_radius_km ?? 40;
    const doorstepMatch = doorstep.service_type === "DOORSTEP" ? isDoorstepCapable : true;

    // Distance computation (Haversine approximate road distance)
    let distanceKm: number | null = null;
    let estimatedDriveMinutes: number | null = null;
    let isWithinRadius = true;

    if (farmerPoint && techPoint) {
      const approx = computeApproximateRoadDistance(techPoint, farmerPoint);
      distanceKm = approx.distanceKm;
      estimatedDriveMinutes = approx.durationMinutes;

      if (doorstep.service_type === "DOORSTEP" && distanceKm > maxRadiusKm) {
        isWithinRadius = false;
      }
    }

    const activeJobCount = activeJobCounts.get(t.profile_id) ?? 0;

    const breakdown = computeTechnicianDispatchScore({
      isCriticalStopped,
      brandMatch,
      skillMatch,
      isAvailable: Boolean(t.is_available),
      activeJobCount,
      distanceKm,
      isWithinRadius,
      serviceType: doorstep.service_type,
      isDoorstepCapable,
    });

    // Human-readable recommendation reasons
    const reasons: string[] = [];
    if (brandMatch) reasons.push(`${make} specialist`);
    if (skillMatch) reasons.push(`${targetSkill} expert`);

    if (t.is_available) {
      if (activeJobCount === 0) reasons.push("Available now (0 active jobs)");
      else if (activeJobCount === 1) reasons.push("Available (1 active job)");
      else reasons.push(`Available (${activeJobCount} active jobs)`);
    } else {
      reasons.push("Currently unavailable");
    }

    if (distanceKm !== null && estimatedDriveMinutes !== null) {
      const approxTag = distanceSource === "tahsil_centroid" ? " (approx)" : "";
      reasons.push(`${distanceKm} km · ~${estimatedDriveMinutes} min drive${approxTag}`);
    }

    if (doorstep.service_type === "DOORSTEP") {
      if (isDoorstepCapable) {
        reasons.push("Mobile field service");
      } else {
        reasons.push("Workshop depot only");
      }
    }

    if (!isWithinRadius && distanceKm !== null) {
      reasons.push(`Outside standard travel radius (${distanceKm} km > ${maxRadiusKm} km)`);
    }

    if (isCriticalStopped && breakdown.proximityScore >= 32) {
      reasons.push("Rapid dispatch proximity match");
    }

    return {
      technician: t,
      score: breakdown.score,
      brandMatch,
      skillMatch,
      reasons,
      distanceKm,
      estimatedDriveMinutes,
      distanceSource,
      activeJobCount,
      doorstepMatch,
      isUrgencyWeighted: isCriticalStopped,
      isWithinRadius,
    };
  });

  // Sort candidates by score descending
  preliminaryMatches.sort((a, b) => b.score - a.score);

  // 6. Progressive refinement for top 3 candidates via OSRM (bounded timeout, non-blocking)
  if (!options?.skipOsrm && farmerPoint && distanceSource === "exact_gps") {
    const topCandidates = preliminaryMatches.slice(0, 3);
    await Promise.allSettled(
      topCandidates.map(async (m) => {
        if (m.distanceKm !== null && farmerPoint) {
          const tPoint = isValidGpsCoordinate(
            m.technician.workshop_latitude,
            m.technician.workshop_longitude,
          )
            ? {
                latitude: m.technician.workshop_latitude as number,
                longitude: m.technician.workshop_longitude as number,
              }
            : getNagpurTahsilCentroid(m.technician.profile?.village || m.technician.workshop_name);

          if (tPoint) {
            const resolveOpts: {
              timeoutMs?: number | undefined;
              fetchFn?: typeof fetch | undefined;
            } = {
              timeoutMs: options?.osrmTimeoutMs ?? 2000,
            };
            if (options?.fetchFn) {
              resolveOpts.fetchFn = options.fetchFn;
            }
            const resolved = await resolveDrivingDistance(tPoint, farmerPoint, resolveOpts);
            m.distanceKm = resolved.distanceKm;
            m.estimatedDriveMinutes = resolved.durationMinutes;
          }
        }
      }),
    );
  }

  return preliminaryMatches;
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

  const techProfile = (
    techRecord as unknown as { profile: { id: string; full_name: string; role: string } | null }
  ).profile;
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
    .select("*, profile:profile_id(id, full_name, phone, village)")
    .eq("profile_id", repair.technician_id)
    .maybeSingle();

  if (techError || !tech) {
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
    .select("*, profile:profile_id(id, full_name, phone, village)")
    .eq("profile_id", profile.id)
    .maybeSingle();

  if (error) {
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
    .select("*, profile:profile_id(id, full_name, phone, village)")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load technicians: ${error.message}`);
  }

  return (data as unknown as VerifiedTechnicianWithProfile[]) ?? [];
}

/**
 * Sets verification status for a technician profile (admin-only).
 * When approved (isVerified = true), dispatches an idempotent notification to the technician.
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

  const { error } = await supabase
    .from("technician_profiles")
    .update({ is_verified: isVerified })
    .or(`profile_id.eq.${profileId},id.eq.${profileId}`);

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
