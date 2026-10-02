import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { createNotification } from "./notifications";

export type TechnicianProfileRow = Database["public"]["Tables"]["technician_profiles"]["Row"];
export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
export type RepairRequestRow = Database["public"]["Tables"]["repair_requests"]["Row"];

export interface VerifiedTechnicianWithProfile extends TechnicianProfileRow {
  profile: Pick<ProfileRow, "id" | "full_name" | "phone" | "village"> | null;
}

export interface ScoredTechnicianMatch {
  technician: VerifiedTechnicianWithProfile;
  score: number;
  brandMatch: boolean;
  skillMatch: boolean;
  reasons: string[];
}

export interface AssignTechnicianInput {
  repair_request_id: string;
  technician_id: string; // The technician's profile UUID (profiles.id / technician_profiles.profile_id)
}

/**
 * Resolves the authenticated user's profile ID and role.
 * Ensures caller identity is verified against Supabase Auth.
 */
async function getAuthenticatedProfile(): Promise<{ id: string; role: string }> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error("Authentication required: Please sign in.");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role")
    .or(`auth_user_id.eq.${user.id},id.eq.${user.id}`)
    .maybeSingle();

  if (profileError || !profile) {
    throw new Error("User profile not found. Please ensure your profile is initialized.");
  }

  return profile;
}

/**
 * Fetches and ranks eligible verified technicians for a specific repair request.
 * - Only approved technicians (`is_verified = true`) are returned.
 * - Technicians who have declined the job (`declined_by`) are excluded.
 * - Ranked using multi-factor scoring: brand specialization (40), skill match (30),
 *   current availability (20), and travel ETA proximity (up to 10).
 */
export async function getEligibleTechnicians(repairRequestId: string): Promise<ScoredTechnicianMatch[]> {
  if (!repairRequestId) throw new Error("Repair request ID is required.");

  await getAuthenticatedProfile();

  // 1. Fetch repair request with equipment and assessment details
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(repairRequestId);
  const { data: repair, error: repairError } = isUuid
    ? await supabase.from("repair_requests").select("*, equipment(*)").eq("id", repairRequestId).maybeSingle()
    : await supabase.from("repair_requests").select("*, equipment(*)").eq("job_number", repairRequestId).maybeSingle();

  if (repairError || !repair) {
    throw new Error("Repair request not found or inaccessible.");
  }

  const make = (repair.equipment as any)?.make ?? "";
  const assessment = (repair.assessment as any) ?? {};
  const targetSkill = assessment.skill ?? "";
  const declinedBy = new Set(repair.declined_by ?? []);

  // 2. Query all verified technicians from PostgreSQL
  const { data: techRows, error: techError } = await supabase
    .from("technician_profiles")
    .select("*, profile:profile_id(id, full_name, phone, village)")
    .eq("is_verified", true);

  if (techError) {
    throw new Error(`Failed to load technicians: ${techError.message}`);
  }

  const verifiedTechs = (techRows as unknown as VerifiedTechnicianWithProfile[]) ?? [];

  // 3. Score and rank candidates (matching algorithm helper)
  const matches: ScoredTechnicianMatch[] = verifiedTechs
    .filter((t) => !declinedBy.has(t.profile_id))
    .map((t) => {
      const brandMatch = Boolean(make && t.brands && t.brands.includes(make));
      const skillMatch = Boolean(targetSkill && t.skills && t.skills.includes(targetSkill));
      const reasons: string[] = [];

      if (brandMatch) reasons.push(`${make} specialist`);
      if (skillMatch) reasons.push(`${targetSkill} expert`);
      if (t.is_available) reasons.push("Available now");

      const proximityScore = Math.max(0, 10 - (t.eta_minutes ?? 45) / 10);
      const score = (brandMatch ? 40 : 0) + (skillMatch ? 30 : 0) + (t.is_available ? 20 : 0) + proximityScore;

      return {
        technician: t,
        score: Math.round(score),
        brandMatch,
        skillMatch,
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score);

  return matches;
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
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.repair_request_id);
  const { data: repair, error: repairError } = isUuid
    ? await supabase.from("repair_requests").select("*").eq("id", input.repair_request_id).maybeSingle()
    : await supabase.from("repair_requests").select("*").eq("job_number", input.repair_request_id).maybeSingle();

  if (repairError || !repair) {
    throw new Error("Repair request not found or inaccessible.");
  }

  // 2. Authorization check
  const isOwner = repair.farmer_id === profile.id;
  const isAdmin = profile.role === "admin";

  if (!isOwner && !isAdmin) {
    throw new Error("Unauthorized: Only the machinery owner or Service Centre can assign technicians.");
  }

  // Terminal states cannot receive assignments
  if (repair.status === "COMPLETED" || repair.status === "CANCELLED") {
    throw new Error(`Cannot assign technician: Repair is already ${repair.status.toLowerCase()}.`);
  }

  // Farmers can only nominate/assign while ticket is in REQUESTED state
  if (isOwner && !isAdmin && repair.status !== "REQUESTED") {
    throw new Error(`Cannot reassign technician: Repair is already in '${repair.status}' stage. Contact Service Centre.`);
  }

  // 3. Validate candidate technician existence, role, and verification status
  const { data: techRecord, error: techCheckError } = await supabase
    .from("technician_profiles")
    .select("profile_id, workshop_name, is_verified, is_available, profile:profile_id(id, full_name, role)")
    .eq("profile_id", input.technician_id)
    .maybeSingle();

  if (techCheckError || !techRecord) {
    throw new Error("Technician profile not found. Please select a valid registered technician.");
  }

  const techProfile = (techRecord as any).profile;
  if (!techProfile || techProfile.role !== "technician") {
    throw new Error("Invalid assignment: Selected user profile is not a registered technician.");
  }

  if (!techRecord.is_verified) {
    throw new Error("Assignment rejected: Selected technician has not been verified by the Service Centre.");
  }

  // Check if technician previously declined this ticket
  if (repair.declined_by && repair.declined_by.includes(input.technician_id)) {
    throw new Error("Assignment rejected: This technician has already declined this repair request.");
  }

  const now = new Date().toISOString();
  const techName = techProfile.full_name || "Technician";
  const workshopName = techRecord.workshop_name || "Field Workshop";

  // 4. Persist assignment in repair_requests
  const { data: updatedRepair, error: updateError } = await supabase
    .from("repair_requests")
    .update({
      technician_id: input.technician_id,
      status_since: now,
    })
    .eq("id", repair.id)
    .select()
    .single();

  if (updateError) {
    throw new Error(`Failed to assign technician: ${updateError.message}`);
  }

  // 5. Record chronological audit event in repair_timeline
  const timelineStatus = isAdmin && repair.technician_id ? "REASSIGNED" : "REQUESTED";
  const timelineNote = isAdmin && repair.technician_id
    ? `Reassigned to ${techName} (${workshopName}) by Service Centre`
    : `Technician assigned: ${techName} (${workshopName})`;

  const { error: timelineError } = await supabase
    .from("repair_timeline")
    .insert({
      repair_request_id: repair.id,
      status: timelineStatus,
      note: timelineNote,
      created_by_role: isAdmin ? "admin" : "farmer",
      created_by_id: profile.id,
    });

  if (timelineError) {
    console.warn(`[TerraByte] Warning: Failed to record assignment timeline entry: ${timelineError.message}`);
  }

  // Notify technician of assignment
  try {
    await createNotification({
      recipient_role: "technician",
      recipient_user_id: input.technician_id,
      notification_text: `You have been assigned to repair request ${repair.job_number}`,
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
export async function getAssignedTechnician(repairRequestId: string): Promise<VerifiedTechnicianWithProfile | null> {
  if (!repairRequestId) throw new Error("Repair request ID is required.");

  await getAuthenticatedProfile();

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(repairRequestId);
  const { data: repair, error: repairError } = isUuid
    ? await supabase.from("repair_requests").select("technician_id").eq("id", repairRequestId).maybeSingle()
    : await supabase.from("repair_requests").select("technician_id").eq("job_number", repairRequestId).maybeSingle();

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
  await getAuthenticatedProfile();

  const { data, error } = await supabase
    .from("technician_profiles")
    .select("*, profile:profile_id(id, full_name, phone, village)")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load technicians: ${error.message}`);
  }

  return (data as unknown as VerifiedTechnicianWithProfile[]) ?? [];
}
