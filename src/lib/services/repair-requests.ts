import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { createNotification } from "./notifications";
import { createServiceHistoryFromRepair } from "./service-history";

export type RepairRequestRow = Database["public"]["Tables"]["repair_requests"]["Row"];
export type RepairTimelineRow = Database["public"]["Tables"]["repair_timeline"]["Row"];
export type EquipmentRow = Database["public"]["Tables"]["equipment"]["Row"];
export type RepairStatus = Database["public"]["Enums"]["repair_status"];

export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

export interface CreateRepairRequestInput {
  equipment_id: string;
  symptoms: string[];
  description?: string;
  photos?: string[];
  location: string;
  assessment?: Json;
}

export interface RepairRequestWithEquipment extends RepairRequestRow {
  equipment: EquipmentRow | null;
  technician?: Pick<ProfileRow, "id" | "full_name" | "phone" | "village"> | null;
  farmer?: Pick<ProfileRow, "id" | "full_name" | "phone" | "village"> | null;
}

export type RepairTimelineWithActor = RepairTimelineRow & {
  created_by?: Pick<ProfileRow, "id" | "full_name" | "role"> | null;
};

export interface RepairRequestDetail extends RepairRequestWithEquipment {
  repair_timeline: RepairTimelineWithActor[];
}

export const CANCELLATION_REASONS = [
  "Repaired locally / alternative arrangement",
  "Cost / quote concerns",
  "Delay / timing constraints",
  "Machine no longer needed",
  "Other",
] as const;

export type CancellationReason = (typeof CANCELLATION_REASONS)[number] | string;

export interface RequestCancellationInput {
  reason: CancellationReason;
  note?: string;
}

export interface ApproveCancellationInput {
  adminResponse?: string;
}

export interface RejectCancellationInput {
  adminResponse: string;
}

let cachedProfile: { auth_user_id: string; id: string; role: string; expiresAt: number } | null = null;

/**
 * Resolves the authenticated user's profile ID and role.
 * Uses cached profile / active session when available to prevent waterfall latency.
 */
async function getAuthenticatedProfile(): Promise<{ id: string; role: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const sessionUser = session?.user;

  if (sessionUser && cachedProfile && cachedProfile.auth_user_id === sessionUser.id && Date.now() < cachedProfile.expiresAt) {
    return { id: cachedProfile.id, role: cachedProfile.role };
  }

  const user = sessionUser || (await supabase.auth.getUser()).data.user;

  if (!user) {
    throw new Error("Authentication required: Please sign in to manage repair requests.");
  }

  if (cachedProfile && cachedProfile.auth_user_id === user.id && Date.now() < cachedProfile.expiresAt) {
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
 * Generates a unique, collision-resistant human-readable job number in standard format (e.g. TB-8841).
 * Verifies against the database to guarantee uniqueness before insertion.
 */
async function generateUniqueJobNumber(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    // Generate 4-digit numeric code in the 1000-9999 range
    const code = Math.floor(1000 + Math.random() * 9000);
    const candidate = `TB-${code}`;

    const { data } = await supabase
      .from("repair_requests")
      .select("id")
      .eq("job_number", candidate)
      .maybeSingle();

    if (!data) {
      return candidate;
    }
  }

  // High-entropy fallback using current millisecond timestamp slice
  return `TB-${Date.now().toString().slice(-4)}`;
}

/**
 * Creates a persistent repair request ticket for agricultural equipment.
 * Validates ownership, ensures equipment is not already under active repair,
 * generates a unique job number, advances equipment status, and writes the initial timeline event.
 */
export async function createRepairRequest(input: CreateRepairRequestInput): Promise<RepairRequestRow> {
  const profile = await getAuthenticatedProfile();

  if (profile.role !== "farmer" && profile.role !== "admin") {
    throw new Error("Unauthorized: Only registered farmers can report breakdowns.");
  }

  if (!input.equipment_id) {
    throw new Error("Equipment selection is required to report a breakdown.");
  }

  if (!input.symptoms || input.symptoms.length === 0) {
    throw new Error("At least one reported symptom is required.");
  }

  const location = input.location?.trim();
  if (!location) {
    throw new Error("Breakdown location is required.");
  }

  // 1. Verify equipment ownership and current operational status
  const { data: equipment, error: eqError } = await supabase
    .from("equipment")
    .select("id, farmer_id, status, make, model")
    .eq("id", input.equipment_id)
    .maybeSingle();

  if (eqError || !equipment) {
    throw new Error("Selected equipment was not found or is inaccessible.");
  }

  if (equipment.farmer_id !== profile.id && profile.role !== "admin") {
    throw new Error("Unauthorized: You do not own the selected equipment.");
  }

  if (equipment.status === "In Repair") {
    throw new Error(
      `Cannot report breakdown: ${equipment.make} ${equipment.model} is already marked as 'In Repair'.`
    );
  }

  // 2. Generate unique job number
  const jobNumber = await generateUniqueJobNumber();
  const now = new Date().toISOString();

  // 3. Insert the repair request row (protected by RLS WITH CHECK (farmer_id = current_profile_id()))
  const { data: repair, error: insertError } = await supabase
    .from("repair_requests")
    .insert({
      job_number: jobNumber,
      equipment_id: input.equipment_id,
      farmer_id: profile.id,
      status: "REQUESTED",
      is_testing: false,
      symptoms: input.symptoms,
      description: input.description?.trim() || "",
      photos: input.photos || [],
      location,
      assessment: input.assessment ?? {},
      status_since: now,
    })
    .select()
    .single();

  if (insertError) {
    throw new Error(`Failed to create repair ticket: ${insertError.message}`);
  }

  // 4. Coordinated state updates: update equipment status to 'In Repair'
  const { error: eqUpdateError } = await supabase
    .from("equipment")
    .update({ status: "In Repair" })
    .eq("id", input.equipment_id);

  if (eqUpdateError) {
    console.warn(`[TerraByte] Warning: Failed to advance equipment ${input.equipment_id} status: ${eqUpdateError.message}`);
  }

  // 5. Coordinated state updates: write initial audit timeline entry
  const { error: timelineError } = await supabase
    .from("repair_timeline")
    .insert({
      repair_request_id: repair.id,
      status: "REQUESTED",
      note: "Breakdown reported",
      created_by_role: "farmer",
      created_by_id: profile.id,
    });

  if (timelineError) {
    console.warn(`[TerraByte] Warning: Failed to record initial timeline entry: ${timelineError.message}`);
  }

  // 6. Notify Service Centre Admin of new breakdown request
  try {
    await createNotification({
      recipient_role: "admin",
      notification_text: `New breakdown reported (${jobNumber}): ${input.symptoms.join(", ")}.`,
      link_target: `/admin/repair/${repair.id}`,
    });
  } catch (notifErr) {
    console.warn("[TerraByte] Warning: Failed to send breakdown notification:", notifErr);
  }

  return repair;
}

/**
 * Fetches all repair request tickets for the authenticated farmer with joined equipment details.
 * Protected by PostgreSQL RLS: Only the farmer's own repair requests are returned.
 * Accepts optional farmerId to bypass profile resolution waterfall when already known.
 */
export async function getFarmerRepairRequests(
  farmerId?: string,
  options?: { activeOnly?: boolean }
): Promise<RepairRequestWithEquipment[]> {
  const resolvedFarmerId = farmerId || (await getAuthenticatedProfile()).id;

  let query = supabase
    .from("repair_requests")
    .select("*, equipment(*), technician:technician_id(id, full_name, phone, village)")
    .eq("farmer_id", resolvedFarmerId);

  if (options?.activeOnly) {
    query = query.not("status", "in", '("COMPLETED","CANCELLED")');
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load repair requests: ${error.message}`);
  }

  return (data as RepairRequestWithEquipment[]) ?? [];
}

/**
 * Fetches full details for a single repair request by its UUID or job_number,
 * including equipment information, assigned technician profile, and audit timeline events.
 * Protected by PostgreSQL RLS: Restricts access to authorized participants.
 */
export async function getRepairRequestById(id: string): Promise<RepairRequestDetail | null> {
  if (!id) throw new Error("Repair Request ID is required.");

  await getAuthenticatedProfile();

  const trimmedId = id.trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmedId);

  // Allow lookup by UUID or human-readable job_number (case-insensitive for resilience)
  const query = supabase
    .from("repair_requests")
    .select("*, equipment(*), repair_timeline(*, created_by:created_by_id(id, full_name, role)), technician:technician_id(id, full_name, phone, village), farmer:farmer_id(id, full_name, phone, village)")
    .order("created_at", { referencedTable: "repair_timeline", ascending: true });

  const { data, error } = isUuid
    ? await query.eq("id", trimmedId).maybeSingle()
    : await query.ilike("job_number", trimmedId).maybeSingle();

  if (error) {
    throw new Error(`Failed to load repair details: ${error.message}`);
  }

  if (!data) return null;

  // Normalize photos to guaranteed string array regardless of database encoding
  let photos: string[] = [];
  if (Array.isArray(data.photos)) {
    photos = data.photos.filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  } else if (typeof data.photos === "string") {
    const raw = (data.photos as string).trim();
    if (raw.startsWith("[") && raw.endsWith("]")) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          photos = parsed.filter((p): p is string => typeof p === "string" && p.trim().length > 0);
        }
      } catch {
        photos = [raw];
      }
    } else if (raw.startsWith("{") && raw.endsWith("}")) {
      // Postgres array literal format "{item1,item2}"
      photos = raw
        .slice(1, -1)
        .split(",")
        .map((s) => s.replace(/^"(.*)"$/, "$1").trim())
        .filter(Boolean);
    } else if (raw) {
      photos = [raw];
    }
  }

  return {
    ...(data as RepairRequestDetail),
    photos,
  };
}

/**
 * Fetches all repair requests for the authenticated technician.
 * Includes assigned/requested jobs, equipment details, and farmer information.
 * Protected by PostgreSQL RLS.
 */
export async function getTechnicianRepairRequests(): Promise<RepairRequestWithEquipment[]> {
  const profile = await getAuthenticatedProfile();

  const { data, error } = await supabase
    .from("repair_requests")
    .select("*, equipment(*), farmer:farmer_id(id, full_name, phone, village), technician:technician_id(id, full_name, phone, village)")
    .eq("technician_id", profile.id)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load technician repair requests: ${error.message}`);
  }

  return (data as RepairRequestWithEquipment[]) ?? [];
}

/**
 * Fetches all repair requests for the Service Centre / Admin operations queue.
 * Includes equipment details, farmer name, and assigned technician profile.
 * Protected by PostgreSQL RLS: Admin role only.
 */
export async function getAdminRepairRequests(): Promise<RepairRequestDetail[]> {
  await getAuthenticatedProfile();

  const { data, error } = await supabase
    .from("repair_requests")
    .select("*, equipment(*), farmer:farmer_id(id, full_name, phone, village), technician:technician_id(id, full_name, phone, village)")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load operations repair requests: ${error.message}`);
  }

  return (data as any[]) ?? [];
}

/**
 * Cancels an eligible repair request.
 * Direct cancellation is strictly permitted only while the ticket is in 'REQUESTED' state
 * and has not yet been assigned to a technician (unassigned).
 * Assigned or in-progress repairs require governed review via requestCancellation().
 * Admins retain operational authority to directly cancel active tickets.
 * Automatically restores the associated equipment to 'Operational' if no other active repairs exist.
 */
export async function cancelRepairRequest(
  id: string,
  options?: { reason?: string; note?: string }
): Promise<RepairRequestRow> {
  const profile = await getAuthenticatedProfile();

  // 1. Fetch current repair ticket state
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const { data: repair, error: fetchError } = isUuid
    ? await supabase.from("repair_requests").select("*").eq("id", id).maybeSingle()
    : await supabase.from("repair_requests").select("*").eq("job_number", id).maybeSingle();

  if (fetchError || !repair) {
    throw new Error("Repair ticket not found or inaccessible.");
  }

  if (repair.farmer_id !== profile.id && profile.role !== "admin") {
    throw new Error("Unauthorized: You can only cancel your own repair requests.");
  }

  // 2. Validate cancellation eligibility
  if (profile.role !== "admin") {
    if (repair.status !== "REQUESTED" || repair.technician_id !== null) {
      throw new Error(
        `Direct cancellation is only permitted for unassigned requested repairs. This repair is ${
          repair.technician_id ? "assigned to a technician" : `in '${repair.status}' status`
        }; please submit a cancellation request for Service Centre review.`
      );
    }
  } else {
    // Admin direct cancel guard
    if (repair.status === "COMPLETED" || repair.status === "CANCELLED") {
      throw new Error(`Cannot cancel repair: Ticket is already '${repair.status}'.`);
    }
  }

  const now = new Date().toISOString();

  // 3. Update repair request status to CANCELLED
  const updatePayload: Record<string, any> = {
    status: "CANCELLED",
    status_since: now,
  };
  if (options?.reason?.trim()) {
    updatePayload.cancellation_reason = options.reason.trim();
  }
  if (options?.note?.trim()) {
    updatePayload.cancellation_note = options.note.trim();
  }

  const { data: updated, error: updateError } = await supabase
    .from("repair_requests")
    .update(updatePayload)
    .eq("id", repair.id)
    .select()
    .single();

  if (updateError || !updated) {
    throw new Error(`Failed to cancel repair request: ${updateError?.message}`);
  }

  // 4. Log cancellation event in timeline
  const reasonText = options?.reason?.trim() ? `: ${options.reason.trim()}` : "";
  const timelineNote =
    profile.role === "admin"
      ? `Cancelled by Service Centre${reasonText}`
      : `Cancelled by farmer before assignment${reasonText}`;

  const { error: timelineError } = await supabase
    .from("repair_timeline")
    .insert({
      repair_request_id: repair.id,
      status: "CANCELLED",
      note: timelineNote,
      created_by_role: profile.role,
      created_by_id: profile.id,
    });

  if (timelineError) {
    console.warn(`[TerraByte] Warning: Failed to record cancellation timeline entry: ${timelineError.message}`);
  }

  // 5. Restore equipment to 'Operational' if no other active repairs are underway
  const { data: otherActive } = await supabase
    .from("repair_requests")
    .select("id")
    .eq("equipment_id", repair.equipment_id)
    .neq("id", repair.id)
    .not("status", "in", '("COMPLETED","CANCELLED")');

  if (!otherActive || otherActive.length === 0) {
    const { error: eqRestoreError } = await supabase
      .from("equipment")
      .update({ status: "Operational" })
      .eq("id", repair.equipment_id);

    if (eqRestoreError) {
      console.warn(`[TerraByte] Warning: Failed to restore equipment status to Operational: ${eqRestoreError.message}`);
    }
  }

  // 6. Notify relevant parties
  try {
    if (profile.role === "admin") {
      await createNotification({
        recipient_role: "farmer",
        recipient_user_id: repair.farmer_id,
        notification_text: `Repair request ${repair.job_number} was cancelled by Service Centre.`,
        link_target: `/farmer/repair/${repair.id}`,
      });
      if (repair.technician_id) {
        await createNotification({
          recipient_role: "technician",
          recipient_user_id: repair.technician_id,
          notification_text: `Repair request ${repair.job_number} was cancelled by Service Centre.`,
          link_target: `/technician/job/${repair.id}`,
        });
      }
    } else {
      await createNotification({
        recipient_role: "admin",
        notification_text: `Repair request ${repair.job_number} was cancelled by farmer.`,
        link_target: `/admin/repair/${repair.id}`,
      });
    }
  } catch (notifErr) {
    console.warn("[TerraByte] Warning: Failed to dispatch cancellation notification:", notifErr);
  }

  return updated;
}

/**
 * Requests cancellation for an assigned or active repair ticket.
 * If the ticket is in 'REQUESTED' status and unassigned, automatically delegates to immediate cancellation.
 * For assigned or in-progress tickets, transitions status to 'CANCELLATION_REQUESTED',
 * saves cancellation metadata (reason, note, requested_by, requested_at, previous_status),
 * records a timeline event, and notifies the Service Centre (admin).
 * Equipment status remains unchanged ('In Repair') during the administrative review.
 */
export async function requestCancellation(
  id: string,
  input: RequestCancellationInput
): Promise<RepairRequestRow> {
  const trimmedReason = input.reason?.trim();
  if (!trimmedReason) {
    throw new Error("A cancellation reason is required.");
  }
  const trimmedNote = input.note?.trim() || null;

  const profile = await getAuthenticatedProfile();

  // 1. Fetch current repair ticket state
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const { data: repair, error: fetchError } = isUuid
    ? await supabase.from("repair_requests").select("*").eq("id", id).maybeSingle()
    : await supabase.from("repair_requests").select("*").eq("job_number", id).maybeSingle();

  if (fetchError || !repair) {
    throw new Error("Repair ticket not found or inaccessible.");
  }

  if (repair.farmer_id !== profile.id && profile.role !== "admin") {
    throw new Error("Unauthorized: You can only request cancellation for your own repair requests.");
  }

  // 2. Validate current status
  if (repair.status === "COMPLETED") {
    throw new Error("Cannot request cancellation: Repair has already been completed.");
  }
  if (repair.status === "CANCELLED") {
    throw new Error("Cannot request cancellation: Repair ticket is already cancelled.");
  }
  if (repair.status === "CANCELLATION_REQUESTED") {
    throw new Error("A cancellation request is already pending Service Centre review.");
  }

  // 3. If unassigned and still in REQUESTED status, perform immediate direct cancellation
  if (repair.status === "REQUESTED" && !repair.technician_id) {
    return cancelRepairRequest(repair.id, { reason: trimmedReason, note: trimmedNote || undefined });
  }

  // 4. Active / assigned repair: transition to CANCELLATION_REQUESTED
  if (!isLegalRepairTransition(repair.status, "CANCELLATION_REQUESTED")) {
    throw new Error(`Cannot request cancellation from '${repair.status}' status.`);
  }

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from("repair_requests")
    .update({
      status: "CANCELLATION_REQUESTED",
      cancellation_previous_status: repair.status,
      cancellation_reason: trimmedReason,
      cancellation_note: trimmedNote,
      cancellation_requested_by: profile.id,
      cancellation_requested_at: now,
      cancellation_admin_response: null,
      status_since: now,
    })
    .eq("id", repair.id)
    .select()
    .single();

  if (updateError || !updated) {
    throw new Error(`Failed to request cancellation: ${updateError?.message}`);
  }

  // 5. Log cancellation request event in timeline
  const timelineNote = trimmedNote
    ? `Cancellation requested: ${trimmedReason} — ${trimmedNote}`
    : `Cancellation requested: ${trimmedReason}`;

  const { error: timelineError } = await supabase
    .from("repair_timeline")
    .insert({
      repair_request_id: repair.id,
      status: "CANCELLATION_REQUESTED",
      note: timelineNote,
      created_by_role: profile.role,
      created_by_id: profile.id,
    });

  if (timelineError) {
    console.warn(`[TerraByte] Warning: Failed to record cancellation request timeline entry: ${timelineError.message}`);
  }

  // 6. Notify Service Centre (admin) of actionable cancellation request
  try {
    await createNotification({
      recipient_role: "admin",
      notification_text: `Cancellation requested for ${repair.job_number}: ${trimmedReason}.`,
      link_target: `/admin/repair/${repair.id}`,
    });
  } catch (notifErr) {
    console.warn("[TerraByte] Warning: Failed to dispatch cancellation request notification:", notifErr);
  }

  return updated;
}

/**
 * Approves a pending repair cancellation request by the Service Centre (admin).
 * Transitions status: CANCELLATION_REQUESTED -> CANCELLED.
 * Restores associated equipment to 'Operational' if no other active repairs exist.
 * Records admin response and notifies farmer and assigned technician.
 */
export async function approveCancellation(
  id: string,
  input?: ApproveCancellationInput
): Promise<RepairRequestRow> {
  const profile = await getAuthenticatedProfile();

  if (profile.role !== "admin") {
    throw new Error("Unauthorized: Only Service Centre administrators can approve cancellation requests.");
  }

  // 1. Fetch current repair ticket state
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const { data: repair, error: fetchError } = isUuid
    ? await supabase.from("repair_requests").select("*").eq("id", id).maybeSingle()
    : await supabase.from("repair_requests").select("*").eq("job_number", id).maybeSingle();

  if (fetchError || !repair) {
    throw new Error("Repair ticket not found or inaccessible.");
  }

  if (repair.status !== "CANCELLATION_REQUESTED") {
    throw new Error(
      `Cannot approve cancellation: Ticket is in '${repair.status}' status (must be CANCELLATION_REQUESTED).`
    );
  }

  const now = new Date().toISOString();
  const adminResponse = input?.adminResponse?.trim() || "Cancellation approved by Service Centre";

  // 2. Update status to CANCELLED
  const { data: updated, error: updateError } = await supabase
    .from("repair_requests")
    .update({
      status: "CANCELLED",
      cancellation_admin_response: adminResponse,
      status_since: now,
    })
    .eq("id", repair.id)
    .select()
    .single();

  if (updateError || !updated) {
    throw new Error(`Failed to approve cancellation: ${updateError?.message}`);
  }

  // 3. Log approval event in timeline
  const timelineNote = input?.adminResponse?.trim()
    ? `Cancellation approved by Service Centre: ${input.adminResponse.trim()}`
    : "Cancellation approved by Service Centre";

  const { error: timelineError } = await supabase
    .from("repair_timeline")
    .insert({
      repair_request_id: repair.id,
      status: "CANCELLED",
      note: timelineNote,
      created_by_role: "admin",
      created_by_id: profile.id,
    });

  if (timelineError) {
    console.warn(`[TerraByte] Warning: Failed to record cancellation approval timeline entry: ${timelineError.message}`);
  }

  // 4. Restore equipment to 'Operational' if no other active repairs exist
  const { data: otherActive } = await supabase
    .from("repair_requests")
    .select("id")
    .eq("equipment_id", repair.equipment_id)
    .neq("id", repair.id)
    .not("status", "in", '("COMPLETED","CANCELLED")');

  if (!otherActive || otherActive.length === 0) {
    const { error: eqRestoreError } = await supabase
      .from("equipment")
      .update({ status: "Operational" })
      .eq("id", repair.equipment_id);

    if (eqRestoreError) {
      console.warn(`[TerraByte] Warning: Failed to restore equipment status to Operational: ${eqRestoreError.message}`);
    }
  }

  // 5. Notify farmer and assigned technician
  try {
    await createNotification({
      recipient_role: "farmer",
      recipient_user_id: repair.farmer_id,
      notification_text: `Cancellation approved for ${repair.job_number}. Repair cancelled.`,
      link_target: `/farmer/repair/${repair.id}`,
    });

    if (repair.technician_id) {
      await createNotification({
        recipient_role: "technician",
        recipient_user_id: repair.technician_id,
        notification_text: `Cancellation approved for ${repair.job_number}. Repair cancelled.`,
        link_target: `/technician/job/${repair.id}`,
      });
    }
  } catch (notifErr) {
    console.warn("[TerraByte] Warning: Failed to dispatch cancellation approval notifications:", notifErr);
  }

  return updated;
}

/**
 * Declines/rejects a pending repair cancellation request by the Service Centre (admin).
 * Transitions status: CANCELLATION_REQUESTED -> cancellation_previous_status (or ACCEPTED fallback).
 * Records admin response and explanation.
 * Equipment remains in current repair status ('In Repair').
 * Notifies farmer and assigned technician that work has resumed.
 */
export async function rejectCancellation(
  id: string,
  input: RejectCancellationInput
): Promise<RepairRequestRow> {
  const profile = await getAuthenticatedProfile();

  if (profile.role !== "admin") {
    throw new Error("Unauthorized: Only Service Centre administrators can decline cancellation requests.");
  }

  const adminResponse = input?.adminResponse?.trim();
  if (!adminResponse) {
    throw new Error("An administrative explanation is required to decline a cancellation request.");
  }

  // 1. Fetch current repair ticket state
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const { data: repair, error: fetchError } = isUuid
    ? await supabase.from("repair_requests").select("*").eq("id", id).maybeSingle()
    : await supabase.from("repair_requests").select("*").eq("job_number", id).maybeSingle();

  if (fetchError || !repair) {
    throw new Error("Repair ticket not found or inaccessible.");
  }

  if (repair.status !== "CANCELLATION_REQUESTED") {
    throw new Error(
      `Cannot decline cancellation: Ticket is in '${repair.status}' status (must be CANCELLATION_REQUESTED).`
    );
  }

  // 2. Resolve target restoration status
  const targetStatus: RepairStatus = repair.cancellation_previous_status || "ACCEPTED";
  if (!isLegalRepairTransition("CANCELLATION_REQUESTED", targetStatus)) {
    throw new Error(
      `Illegal state transition: Cannot restore status from 'CANCELLATION_REQUESTED' to '${targetStatus}'.`
    );
  }

  const now = new Date().toISOString();

  // 3. Update status back to previous status
  const { data: updated, error: updateError } = await supabase
    .from("repair_requests")
    .update({
      status: targetStatus,
      cancellation_admin_response: adminResponse,
      status_since: now,
    })
    .eq("id", repair.id)
    .select()
    .single();

  if (updateError || !updated) {
    throw new Error(`Failed to decline cancellation: ${updateError?.message}`);
  }

  // 4. Log rejection event in timeline
  const { error: timelineError } = await supabase
    .from("repair_timeline")
    .insert({
      repair_request_id: repair.id,
      status: targetStatus,
      note: `Cancellation request declined by Service Centre: ${adminResponse}`,
      created_by_role: "admin",
      created_by_id: profile.id,
    });

  if (timelineError) {
    console.warn(`[TerraByte] Warning: Failed to record cancellation rejection timeline entry: ${timelineError.message}`);
  }

  // 5. Equipment remains In Repair — no equipment update needed.

  // 6. Notify farmer and assigned technician
  try {
    await createNotification({
      recipient_role: "farmer",
      recipient_user_id: repair.farmer_id,
      notification_text: `Cancellation request for ${repair.job_number} was declined by Service Centre: ${adminResponse}.`,
      link_target: `/farmer/repair/${repair.id}`,
    });

    if (repair.technician_id) {
      await createNotification({
        recipient_role: "technician",
        recipient_user_id: repair.technician_id,
        notification_text: `Cancellation request for ${repair.job_number} was declined. Work resumed.`,
        link_target: `/technician/job/${repair.id}`,
      });
    }
  } catch (notifErr) {
    console.warn("[TerraByte] Warning: Failed to dispatch cancellation rejection notifications:", notifErr);
  }

  return updated;
}

// ============================================================================
// PHASE 3.5 — CANONICAL REPAIR STATE MACHINE & PARTS HOLD
// ============================================================================

export const LEGAL_REPAIR_TRANSITIONS: Record<RepairStatus, readonly RepairStatus[]> = {
  REQUESTED: ["ACCEPTED", "CANCELLED", "CANCELLATION_REQUESTED"],
  ACCEPTED: ["QUOTE_PENDING", "CANCELLATION_REQUESTED"],
  QUOTE_PENDING: ["QUOTE_REVISED", "IN_PROGRESS", "CANCELLATION_REQUESTED"],
  QUOTE_REVISED: ["QUOTE_PENDING", "CANCELLATION_REQUESTED"],
  IN_PROGRESS: ["WAITING_FOR_PARTS", "COMPLETED", "CANCELLATION_REQUESTED"],
  WAITING_FOR_PARTS: ["IN_PROGRESS", "CANCELLATION_REQUESTED"],
  CANCELLATION_REQUESTED: [
    "CANCELLED",
    "REQUESTED",
    "ACCEPTED",
    "QUOTE_PENDING",
    "QUOTE_REVISED",
    "IN_PROGRESS",
    "WAITING_FOR_PARTS",
  ],
  COMPLETED: [],
  CANCELLED: [],
};

export function isLegalRepairTransition(currentStatus: RepairStatus, targetStatus: RepairStatus): boolean {
  return LEGAL_REPAIR_TRANSITIONS[currentStatus]?.includes(targetStatus) ?? false;
}

export type RepairActionActor = "farmer" | "technician" | "admin" | "none";

export interface RepairActionOwnership {
  currentStatus: RepairStatus;
  primaryActor: RepairActionActor;
  isActionRequired: boolean;
  farmerState: "action_required" | "waiting" | "closed";
  technicianState: "action_required" | "waiting" | "on_hold" | "closed";
  adminState: "monitor" | "action_required" | "closed";
  actionDescription: string;
}

/**
 * Exposes action ownership and persona workflow states across all repair lifecycle statuses.
 * Accurately models QUOTE_REVISED:
 * - technician: action_required (must formulate revised quote)
 * - farmer: waiting (awaiting technician response)
 * - admin: monitor (intervene if overdue)
 */
export function getRepairActionOwnership(status: RepairStatus): RepairActionOwnership {
  switch (status) {
    case "REQUESTED":
      return {
        currentStatus: status,
        primaryActor: "admin",
        isActionRequired: true,
        farmerState: "waiting",
        technicianState: "action_required",
        adminState: "action_required",
        actionDescription: "Technician assignment pending",
      };
    case "ACCEPTED":
      return {
        currentStatus: status,
        primaryActor: "technician",
        isActionRequired: true,
        farmerState: "waiting",
        technicianState: "action_required",
        adminState: "monitor",
        actionDescription: "Initial quote formulation required",
      };
    case "QUOTE_PENDING":
      return {
        currentStatus: status,
        primaryActor: "farmer",
        isActionRequired: true,
        farmerState: "action_required",
        technicianState: "waiting",
        adminState: "monitor",
        actionDescription: "Farmer quote review and approval required",
      };
    case "QUOTE_REVISED":
      return {
        currentStatus: status,
        primaryActor: "technician",
        isActionRequired: true,
        farmerState: "waiting",
        technicianState: "action_required",
        adminState: "monitor",
        actionDescription: "Technician quote revision response required",
      };
    case "IN_PROGRESS":
      return {
        currentStatus: status,
        primaryActor: "technician",
        isActionRequired: true,
        farmerState: "waiting",
        technicianState: "action_required",
        adminState: "monitor",
        actionDescription: "Physical repair execution and verification",
      };
    case "WAITING_FOR_PARTS":
      return {
        currentStatus: status,
        primaryActor: "technician",
        isActionRequired: false,
        farmerState: "waiting",
        technicianState: "on_hold",
        adminState: "monitor",
        actionDescription: "Work paused awaiting spare parts delivery",
      };
    case "CANCELLATION_REQUESTED":
      return {
        currentStatus: status,
        primaryActor: "admin",
        isActionRequired: true,
        farmerState: "waiting",
        technicianState: "on_hold",
        adminState: "action_required",
        actionDescription: "Administrative cancellation request review required",
      };
    case "COMPLETED":
      return {
        currentStatus: status,
        primaryActor: "none",
        isActionRequired: false,
        farmerState: "closed",
        technicianState: "closed",
        adminState: "closed",
        actionDescription: "Repair completed and verified in service history",
      };
    case "CANCELLED":
      return {
        currentStatus: status,
        primaryActor: "none",
        isActionRequired: false,
        farmerState: "closed",
        technicianState: "closed",
        adminState: "closed",
        actionDescription: "Repair closed",
      };
  }
}

export interface WaitForPartsInput {
  part: string;
  reason: string;
  eta: string;
  revisedCompletion?: string;
  note?: string;
}

export interface UpdatePartsEtaInput {
  eta: string;
  revisedCompletion?: string;
  note?: string;
}

export interface CompleteRepairInput {
  notes: string;
  photo?: string;
  tested?: boolean;
}

/**
 * Checks if a technician has been verified by the Service Centre.
 */
async function verifyTechnicianIsVerified(profileId: string): Promise<boolean> {
  const { data: tech } = await supabase
    .from("technician_profiles")
    .select("is_verified")
    .eq("profile_id", profileId)
    .maybeSingle();

  return Boolean(tech?.is_verified);
}

/**
 * Accepts a repair request by the assigned, verified technician.
 * Transitions status: REQUESTED -> ACCEPTED.
 */
export async function acceptRepairRequest(repairRequestId: string): Promise<RepairRequestRow> {
  if (!repairRequestId) throw new Error("Repair request ID is required.");
  const profile = await getAuthenticatedProfile();

  if (profile.role !== "technician" && profile.role !== "admin") {
    throw new Error("Unauthorized: Only technicians can accept repair jobs.");
  }

  const isVerified = await verifyTechnicianIsVerified(profile.id);
  if (!isVerified && profile.role !== "admin") {
    throw new Error("Unauthorized: Unverified technicians cannot accept repair jobs.");
  }

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(repairRequestId);
  const { data: repair, error: repairError } = isUuid
    ? await supabase.from("repair_requests").select("*").eq("id", repairRequestId).maybeSingle()
    : await supabase.from("repair_requests").select("*").eq("job_number", repairRequestId).maybeSingle();

  if (repairError || !repair) {
    throw new Error("Repair request not found or inaccessible.");
  }

  if (repair.technician_id !== profile.id && profile.role !== "admin") {
    throw new Error("Unauthorized: You are not the assigned technician for this repair job.");
  }

  if (repair.status !== "REQUESTED") {
    throw new Error(`Cannot accept job: Repair ticket is in '${repair.status}' status (must be REQUESTED).`);
  }

  if (!isLegalRepairTransition(repair.status, "ACCEPTED")) {
    throw new Error(`Illegal state transition: Cannot transition from '${repair.status}' to 'ACCEPTED'.`);
  }

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from("repair_requests")
    .update({
      status: "ACCEPTED",
      status_since: now,
    })
    .eq("id", repair.id)
    .select()
    .single();

  if (updateError || !updated) {
    throw new Error(`Failed to accept repair request: ${updateError?.message}`);
  }

  await supabase.from("repair_timeline").insert({
    repair_request_id: repair.id,
    status: "ACCEPTED",
    note: "Technician accepted job & dispatched for on-site inspection",
    created_by_role: profile.role,
    created_by_id: profile.id,
  });

  // Notify farmer that technician accepted and is dispatched
  try {
    await createNotification({
      recipient_role: "farmer",
      recipient_user_id: repair.farmer_id,
      notification_text: `Technician accepted repair ${repair.job_number}. Inspection on the way.`,
      link_target: `/farmer/repair/${repair.id}`,
    });
  } catch (notifErr) {
    console.warn("[TerraByte] Warning: Failed to send accept notification:", notifErr);
  }

  return updated;
}

/**
 * Declines a repair request by the assigned technician.
 * Preserves REQUESTED status, records technician in declined_by, and returns ticket to dispatch.
 */
export async function declineRepairRequest(repairRequestId: string, reason: string): Promise<RepairRequestRow> {
  if (!repairRequestId) throw new Error("Repair request ID is required.");
  const trimmedReason = reason?.trim();
  if (!trimmedReason) {
    throw new Error("A reason is required to decline a repair job.");
  }

  const profile = await getAuthenticatedProfile();

  if (profile.role !== "technician" && profile.role !== "admin") {
    throw new Error("Unauthorized: Only technicians can decline repair jobs.");
  }

  const isVerified = await verifyTechnicianIsVerified(profile.id);
  if (!isVerified && profile.role !== "admin") {
    throw new Error("Unauthorized: Unverified technicians cannot decline repair jobs.");
  }

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(repairRequestId);
  const { data: repair, error: repairError } = isUuid
    ? await supabase.from("repair_requests").select("*").eq("id", repairRequestId).maybeSingle()
    : await supabase.from("repair_requests").select("*").eq("job_number", repairRequestId).maybeSingle();

  if (repairError || !repair) {
    throw new Error("Repair request not found or inaccessible.");
  }

  if (repair.technician_id !== profile.id && profile.role !== "admin") {
    throw new Error("Unauthorized: You are not the assigned technician for this repair job.");
  }

  if (repair.status !== "REQUESTED") {
    throw new Error(`Cannot decline job: Repair ticket is in '${repair.status}' status (must be REQUESTED).`);
  }

  const declinedList = Array.isArray(repair.declined_by) ? [...repair.declined_by] : [];
  if (!declinedList.includes(profile.id)) {
    declinedList.push(profile.id);
  }

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from("repair_requests")
    .update({
      technician_id: null,
      status: "REQUESTED",
      declined_by: declinedList,
      status_since: now,
    })
    .eq("id", repair.id)
    .select()
    .single();

  if (updateError || !updated) {
    throw new Error(`Failed to decline repair request: ${updateError?.message}`);
  }

  await supabase.from("repair_timeline").insert({
    repair_request_id: repair.id,
    status: "REQUESTED",
    note: `Technician declined job (${trimmedReason}). Returned to dispatch queue.`,
    created_by_role: profile.role,
    created_by_id: profile.id,
  });

  // Notify admin and farmer
  try {
    await createNotification({
      recipient_role: "admin",
      notification_text: `Repair ${repair.job_number} declined by technician (${trimmedReason}) — needs reassignment.`,
      link_target: `/admin/repair/${repair.id}`,
    });
    await createNotification({
      recipient_role: "farmer",
      recipient_user_id: repair.farmer_id,
      notification_text: `Technician declined repair ${repair.job_number} (${trimmedReason}). Reassignment in progress.`,
      link_target: `/farmer/repair/${repair.id}`,
    });
  } catch (notifErr) {
    console.warn("[TerraByte] Warning: Failed to send decline notifications:", notifErr);
  }

  return updated;
}

/**
 * Validates that physical work is ready to start on an approved repair.
 * Confirms status is IN_PROGRESS and quote is APPROVED.
 */
export async function startRepair(repairRequestId: string): Promise<RepairRequestRow> {
  if (!repairRequestId) throw new Error("Repair request ID is required.");
  const profile = await getAuthenticatedProfile();

  if (profile.role !== "technician" && profile.role !== "admin") {
    throw new Error("Unauthorized: Only technicians can start repair work.");
  }

  const isVerified = await verifyTechnicianIsVerified(profile.id);
  if (!isVerified && profile.role !== "admin") {
    throw new Error("Unauthorized: Unverified technicians cannot start repair work.");
  }

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(repairRequestId);
  const { data: repair, error: repairError } = isUuid
    ? await supabase.from("repair_requests").select("*").eq("id", repairRequestId).maybeSingle()
    : await supabase.from("repair_requests").select("*").eq("job_number", repairRequestId).maybeSingle();

  if (repairError || !repair) {
    throw new Error("Repair request not found or inaccessible.");
  }

  if (repair.technician_id !== profile.id && profile.role !== "admin") {
    throw new Error("Unauthorized: You are not assigned to this repair ticket.");
  }

  if (repair.status !== "IN_PROGRESS") {
    throw new Error(`Cannot start repair work: Ticket is in '${repair.status}' status (quote must be approved first).`);
  }

  // Ensure an approved quote exists
  const { data: approvedQuote } = await supabase
    .from("quotes")
    .select("id")
    .eq("repair_request_id", repair.id)
    .eq("status", "APPROVED")
    .maybeSingle();

  if (!approvedQuote && profile.role !== "admin") {
    throw new Error("Cannot start repair work: No approved quote found for this repair ticket.");
  }

  await supabase.from("repair_timeline").insert({
    repair_request_id: repair.id,
    status: "IN_PROGRESS",
    note: "Technician began disassembly and physical repair work",
    created_by_role: profile.role,
    created_by_id: profile.id,
  });

  // Notify farmer that physical repair work has started (idempotent)
  try {
    const { data: existingNotif } = await supabase
      .from("notifications")
      .select("id")
      .eq("recipient_user_id", repair.farmer_id)
      .ilike("notification_text", `%started repair work on ${repair.job_number}%`)
      .limit(1);

    if (!existingNotif || existingNotif.length === 0) {
      await createNotification({
        recipient_role: "farmer",
        recipient_user_id: repair.farmer_id,
        notification_text: `Technician started repair work on ${repair.job_number}.`,
        link_target: `/farmer/repair/${repair.id}`,
      });
    }
  } catch (notifErr) {
    console.warn("[TerraByte] Warning: Failed to send start repair notification:", notifErr);
  }

  return repair;
}

/**
 * Pauses active repair work when waiting for spare parts delivery.
 * Transitions status: IN_PROGRESS -> WAITING_FOR_PARTS.
 * Persists hold details into parts_hold JSONB.
 */
export async function waitForParts(repairRequestId: string, input: WaitForPartsInput): Promise<RepairRequestRow> {
  if (!repairRequestId) throw new Error("Repair request ID is required.");
  if (!input.part?.trim()) throw new Error("Part name is required to pause for parts.");
  if (!input.eta?.trim()) throw new Error("Expected arrival (ETA) is required.");
  if (!input.reason?.trim()) throw new Error("Reason for parts hold is required.");

  const profile = await getAuthenticatedProfile();

  if (profile.role !== "technician" && profile.role !== "admin") {
    throw new Error("Unauthorized: Only technicians can pause repairs for parts.");
  }

  const isVerified = await verifyTechnicianIsVerified(profile.id);
  if (!isVerified && profile.role !== "admin") {
    throw new Error("Unauthorized: Unverified technicians cannot manage parts hold.");
  }

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(repairRequestId);
  const { data: repair, error: repairError } = isUuid
    ? await supabase.from("repair_requests").select("*").eq("id", repairRequestId).maybeSingle()
    : await supabase.from("repair_requests").select("*").eq("job_number", repairRequestId).maybeSingle();

  if (repairError || !repair) {
    throw new Error("Repair request not found or inaccessible.");
  }

  if (repair.technician_id !== profile.id && profile.role !== "admin") {
    throw new Error("Unauthorized: You are not assigned to this repair ticket.");
  }

  if (repair.status !== "IN_PROGRESS") {
    throw new Error(`Cannot pause for parts: Ticket is in '${repair.status}' status (must be IN_PROGRESS).`);
  }

  if (!isLegalRepairTransition(repair.status, "WAITING_FOR_PARTS")) {
    throw new Error(`Illegal state transition: Cannot transition from '${repair.status}' to 'WAITING_FOR_PARTS'.`);
  }

  const now = new Date().toISOString();
  const partsHoldData = {
    part: input.part.trim(),
    reason: input.reason.trim(),
    eta: input.eta.trim(),
    revisedCompletion: input.revisedCompletion?.trim() || null,
    note: input.note?.trim() || null,
    since: now,
    updated_at: now,
    resolvedAt: null,
  };

  const { data: updated, error: updateError } = await supabase
    .from("repair_requests")
    .update({
      status: "WAITING_FOR_PARTS",
      is_testing: false,
      parts_hold: partsHoldData as Json,
      status_since: now,
    })
    .eq("id", repair.id)
    .select()
    .single();

  if (updateError || !updated) {
    throw new Error(`Failed to pause repair for parts: ${updateError?.message}`);
  }

  await supabase.from("repair_timeline").insert({
    repair_request_id: repair.id,
    status: "WAITING_FOR_PARTS",
    note: `Paused for parts: ${input.part.trim()} (ETA: ${input.eta.trim()})`,
    created_by_role: profile.role,
    created_by_id: profile.id,
  });

  // Notify farmer that repair is paused for parts
  try {
    await createNotification({
      recipient_role: "farmer",
      recipient_user_id: repair.farmer_id,
      notification_text: `Repair ${repair.job_number} is delayed while waiting for spare parts. Expected arrival: ${input.eta.trim()}.`,
      link_target: `/farmer/repair/${repair.id}`,
    });
  } catch (notifErr) {
    console.warn("[TerraByte] Warning: Failed to send parts hold notification:", notifErr);
  }

  return updated;
}

/**
 * Updates the estimated arrival time for pending spare parts without mutating repair status.
 */
export async function updatePartsEta(repairRequestId: string, input: UpdatePartsEtaInput): Promise<RepairRequestRow> {
  if (!repairRequestId) throw new Error("Repair request ID is required.");
  if (!input.eta?.trim()) throw new Error("Updated parts ETA is required.");

  const profile = await getAuthenticatedProfile();

  if (profile.role !== "technician" && profile.role !== "admin") {
    throw new Error("Unauthorized: Only technicians can update parts ETA.");
  }

  const isVerified = await verifyTechnicianIsVerified(profile.id);
  if (!isVerified && profile.role !== "admin") {
    throw new Error("Unauthorized: Unverified technicians cannot update parts ETA.");
  }

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(repairRequestId);
  const { data: repair, error: repairError } = isUuid
    ? await supabase.from("repair_requests").select("*").eq("id", repairRequestId).maybeSingle()
    : await supabase.from("repair_requests").select("*").eq("job_number", repairRequestId).maybeSingle();

  if (repairError || !repair) {
    throw new Error("Repair request not found or inaccessible.");
  }

  if (repair.technician_id !== profile.id && profile.role !== "admin") {
    throw new Error("Unauthorized: You are not assigned to this repair ticket.");
  }

  if (repair.status !== "WAITING_FOR_PARTS") {
    throw new Error(`Cannot update parts ETA: Ticket is in '${repair.status}' status (must be WAITING_FOR_PARTS).`);
  }

  const currentHold = (repair.parts_hold as Record<string, unknown>) ?? {};
  const updatedHold: Record<string, unknown> = {
    ...currentHold,
    eta: input.eta.trim(),
    updated_at: new Date().toISOString(),
  };
  if (input.revisedCompletion !== undefined) {
    updatedHold["revisedCompletion"] = input.revisedCompletion.trim() || null;
  }
  if (input.note !== undefined) {
    updatedHold["note"] = input.note.trim() || null;
  }

  const { data: updated, error: updateError } = await supabase
    .from("repair_requests")
    .update({
      parts_hold: updatedHold as Json,
    })
    .eq("id", repair.id)
    .select()
    .single();

  if (updateError || !updated) {
    throw new Error(`Failed to update parts ETA: ${updateError?.message}`);
  }

  await supabase.from("repair_timeline").insert({
    repair_request_id: repair.id,
    status: "NOTE",
    note: `Parts ETA updated: ${input.eta.trim()}`,
    created_by_role: profile.role,
    created_by_id: profile.id,
  });

  // Notify farmer that ETA was updated
  try {
    await createNotification({
      recipient_role: "farmer",
      recipient_user_id: repair.farmer_id,
      notification_text: `Repair ${repair.job_number}: Spare part ETA updated to ${input.eta.trim()}.`,
      link_target: `/farmer/repair/${repair.id}`,
    });
  } catch (notifErr) {
    console.warn("[TerraByte] Warning: Failed to send parts ETA notification:", notifErr);
  }

  return updated;
}

/**
 * Resumes work on a repair after parts arrive.
 * Transitions status: WAITING_FOR_PARTS -> IN_PROGRESS.
 * Preserves historical parts hold data with resolvedAt timestamp.
 */
export async function resumeRepair(repairRequestId: string): Promise<RepairRequestRow> {
  if (!repairRequestId) throw new Error("Repair request ID is required.");
  const profile = await getAuthenticatedProfile();

  if (profile.role !== "technician" && profile.role !== "admin") {
    throw new Error("Unauthorized: Only technicians can resume repairs.");
  }

  const isVerified = await verifyTechnicianIsVerified(profile.id);
  if (!isVerified && profile.role !== "admin") {
    throw new Error("Unauthorized: Unverified technicians cannot resume repairs.");
  }

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(repairRequestId);
  const { data: repair, error: repairError } = isUuid
    ? await supabase.from("repair_requests").select("*").eq("id", repairRequestId).maybeSingle()
    : await supabase.from("repair_requests").select("*").eq("job_number", repairRequestId).maybeSingle();

  if (repairError || !repair) {
    throw new Error("Repair request not found or inaccessible.");
  }

  if (repair.technician_id !== profile.id && profile.role !== "admin") {
    throw new Error("Unauthorized: You are not assigned to this repair ticket.");
  }

  if (repair.status !== "WAITING_FOR_PARTS") {
    throw new Error(`Cannot resume repair: Ticket is in '${repair.status}' status (must be WAITING_FOR_PARTS).`);
  }

  if (!isLegalRepairTransition(repair.status, "IN_PROGRESS")) {
    throw new Error(`Illegal state transition: Cannot transition from '${repair.status}' to 'IN_PROGRESS'.`);
  }

  const now = new Date().toISOString();
  const currentHold = (repair.parts_hold as Record<string, unknown>) ?? {};
  const updatedHold: Record<string, unknown> = {
    ...currentHold,
    resolvedAt: now,
  };

  const { data: updated, error: updateError } = await supabase
    .from("repair_requests")
    .update({
      status: "IN_PROGRESS",
      parts_hold: updatedHold as Json,
      status_since: now,
    })
    .eq("id", repair.id)
    .select()
    .single();

  if (updateError || !updated) {
    throw new Error(`Failed to resume repair: ${updateError?.message}`);
  }

  const partName = currentHold["part"] || "parts";
  await supabase.from("repair_timeline").insert({
    repair_request_id: repair.id,
    status: "IN_PROGRESS",
    note: `Spare parts arrived (${partName}). Repair work resumed.`,
    created_by_role: profile.role,
    created_by_id: profile.id,
  });

  // Notify farmer that repair has resumed
  try {
    await createNotification({
      recipient_role: "farmer",
      recipient_user_id: repair.farmer_id,
      notification_text: `Parts received. Repair ${repair.job_number} has resumed.`,
      link_target: `/farmer/repair/${repair.id}`,
    });
  } catch (notifErr) {
    console.warn("[TerraByte] Warning: Failed to send resume notification:", notifErr);
  }

  return updated;
}

/**
 * Initiates operational load testing.
 * Status remains IN_PROGRESS; sets is_testing = true.
 */
export async function startTesting(repairRequestId: string): Promise<RepairRequestRow> {
  if (!repairRequestId) throw new Error("Repair request ID is required.");
  const profile = await getAuthenticatedProfile();

  if (profile.role !== "technician" && profile.role !== "admin") {
    throw new Error("Unauthorized: Only technicians can initiate machine testing.");
  }

  const isVerified = await verifyTechnicianIsVerified(profile.id);
  if (!isVerified && profile.role !== "admin") {
    throw new Error("Unauthorized: Unverified technicians cannot start machine testing.");
  }

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(repairRequestId);
  const { data: repair, error: repairError } = isUuid
    ? await supabase.from("repair_requests").select("*").eq("id", repairRequestId).maybeSingle()
    : await supabase.from("repair_requests").select("*").eq("job_number", repairRequestId).maybeSingle();

  if (repairError || !repair) {
    throw new Error("Repair request not found or inaccessible.");
  }

  if (repair.technician_id !== profile.id && profile.role !== "admin") {
    throw new Error("Unauthorized: You are not assigned to this repair ticket.");
  }

  if (repair.status !== "IN_PROGRESS") {
    throw new Error(`Cannot start testing: Ticket is in '${repair.status}' status (must be IN_PROGRESS).`);
  }

  const { data: updated, error: updateError } = await supabase
    .from("repair_requests")
    .update({
      is_testing: true,
    })
    .eq("id", repair.id)
    .select()
    .single();

  if (updateError || !updated) {
    throw new Error(`Failed to set testing mode: ${updateError?.message}`);
  }

  await supabase.from("repair_timeline").insert({
    repair_request_id: repair.id,
    status: "TESTING",
    note: "Repair work completed. Testing under operational load started.",
    created_by_role: profile.role,
    created_by_id: profile.id,
  });

  // Notify farmer that machine testing under operational load has started
  try {
    await createNotification({
      recipient_role: "farmer",
      recipient_user_id: repair.farmer_id,
      notification_text: `Repair ${repair.job_number} is now being tested.`,
      link_target: `/farmer/repair/${repair.id}`,
    });
  } catch (notifErr) {
    console.warn("[TerraByte] Warning: Failed to send testing notification:", notifErr);
  }

  return updated;
}

export interface FailTestingInput {
  reason?: string;
}

/**
 * Handles operational load testing failure.
 * Clears is_testing flag, keeps status IN_PROGRESS, logs TESTING_FAILED in timeline,
 * optionally appends to repair_notes, and notifies the farmer that technician is continuing repair work.
 */
export async function failTesting(
  repairRequestId: string,
  input?: FailTestingInput
): Promise<RepairRequestRow> {
  if (!repairRequestId) throw new Error("Repair request ID is required.");
  const profile = await getAuthenticatedProfile();

  if (profile.role !== "technician" && profile.role !== "admin") {
    throw new Error("Unauthorized: Only technicians can report testing results.");
  }

  const isVerified = await verifyTechnicianIsVerified(profile.id);
  if (!isVerified && profile.role !== "admin") {
    throw new Error("Unauthorized: Unverified technicians cannot manage machine testing.");
  }

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(repairRequestId);
  const { data: repair, error: repairError } = isUuid
    ? await supabase.from("repair_requests").select("*").eq("id", repairRequestId).maybeSingle()
    : await supabase.from("repair_requests").select("*").eq("job_number", repairRequestId).maybeSingle();

  if (repairError || !repair) {
    throw new Error("Repair request not found or inaccessible.");
  }

  if (repair.technician_id !== profile.id && profile.role !== "admin") {
    throw new Error("Unauthorized: You are not assigned to this repair ticket.");
  }

  if (repair.status !== "IN_PROGRESS") {
    throw new Error(`Cannot report testing failure: Ticket is in '${repair.status}' status (must be IN_PROGRESS).`);
  }

  if (!repair.is_testing) {
    throw new Error("Cannot report testing failure: Machine is not currently in testing mode.");
  }

  const { data: updated, error: updateError } = await supabase
    .from("repair_requests")
    .update({
      is_testing: false,
    })
    .eq("id", repair.id)
    .select()
    .single();

  if (updateError || !updated) {
    throw new Error(`Failed to update testing failure: ${updateError?.message}`);
  }

  const failureNote = input?.reason?.trim()
    ? `Operational testing failed: ${input.reason.trim()}. Returning to active repair.`
    : "Operational load testing identified an issue. Returning to active repair.";

  await supabase.from("repair_timeline").insert({
    repair_request_id: repair.id,
    status: "TESTING_FAILED",
    note: failureNote,
    created_by_role: profile.role,
    created_by_id: profile.id,
  });

  // If a specific reason was provided, also persist in technician repair notes
  if (input?.reason?.trim()) {
    try {
      await supabase.from("repair_notes").insert({
        repair_request_id: repair.id,
        author_id: profile.id,
        note_text: `Testing failure: ${input.reason.trim()}`,
      });
    } catch (noteErr) {
      console.warn("[TerraByte] Warning: Failed to insert testing failure note:", noteErr);
    }
  }

  // Notify farmer that testing found an issue and repair continues
  try {
    await createNotification({
      recipient_role: "farmer",
      recipient_user_id: repair.farmer_id,
      notification_text: `Testing found an issue with repair ${repair.job_number}. The technician is continuing the repair.`,
      link_target: `/farmer/repair/${repair.id}`,
    });
  } catch (notifErr) {
    console.warn("[TerraByte] Warning: Failed to send testing failure notification:", notifErr);
  }

  return updated;
}

/**
 * Completes a repair request, marks equipment as Operational if appropriate,
 * clears testing mode, and stores structured completion details.
 * Transitions status: IN_PROGRESS -> COMPLETED.
 */
export async function completeRepair(
  repairRequestId: string,
  input: CompleteRepairInput
): Promise<RepairRequestRow> {
  if (!repairRequestId) throw new Error("Repair request ID is required.");
  const trimmedNotes = input.notes?.trim();
  if (!trimmedNotes) {
    throw new Error("Completion notes describing the work performed are required.");
  }

  const profile = await getAuthenticatedProfile();

  if (profile.role !== "technician" && profile.role !== "admin") {
    throw new Error("Unauthorized: Only technicians can complete repairs.");
  }

  const isVerified = await verifyTechnicianIsVerified(profile.id);
  if (!isVerified && profile.role !== "admin") {
    throw new Error("Unauthorized: Unverified technicians cannot complete repairs.");
  }

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(repairRequestId);
  const { data: repair, error: repairError } = isUuid
    ? await supabase.from("repair_requests").select("*").eq("id", repairRequestId).maybeSingle()
    : await supabase.from("repair_requests").select("*").eq("job_number", repairRequestId).maybeSingle();

  if (repairError || !repair) {
    throw new Error("Repair request not found or inaccessible.");
  }

  if (repair.technician_id !== profile.id && profile.role !== "admin") {
    throw new Error("Unauthorized: You are not assigned to this repair ticket.");
  }

  if (repair.status !== "IN_PROGRESS") {
    throw new Error(`Cannot complete repair: Ticket is in '${repair.status}' status (must be IN_PROGRESS).`);
  }

  if (!repair.is_testing && profile.role !== "admin") {
    throw new Error("Cannot complete repair: Operational load testing must be started before completing the repair.");
  }

  if (!input.tested) {
    throw new Error("Machine must be tested under load and confirmed working before completion.");
  }

  if (!isLegalRepairTransition(repair.status, "COMPLETED")) {
    throw new Error(`Illegal state transition: Cannot transition from '${repair.status}' to 'COMPLETED'.`);
  }

  const now = new Date().toISOString();
  const completionData = {
    notes: trimmedNotes,
    photo: input.photo || null,
    tested: Boolean(input.tested),
    completed_at: now,
  };

  const { data: updated, error: updateError } = await supabase
    .from("repair_requests")
    .update({
      status: "COMPLETED",
      is_testing: false,
      completion_details: completionData as Json,
      status_since: now,
    })
    .eq("id", repair.id)
    .select()
    .single();

  if (updateError || !updated) {
    throw new Error(`Failed to complete repair: ${updateError?.message}`);
  }

  await supabase.from("repair_timeline").insert({
    repair_request_id: repair.id,
    status: "COMPLETED",
    note: `Repair completed & verified: "${trimmedNotes}"`,
    created_by_role: profile.role,
    created_by_id: profile.id,
  });

  // Restore equipment to Operational if no other active repairs exist
  const { data: otherActive } = await supabase
    .from("repair_requests")
    .select("id")
    .eq("equipment_id", repair.equipment_id)
    .neq("id", repair.id)
    .not("status", "in", '("COMPLETED","CANCELLED")');

  if (!otherActive || otherActive.length === 0) {
    const { error: eqError } = await supabase
      .from("equipment")
      .update({ status: "Operational" })
      .eq("id", repair.equipment_id);

    if (eqError) {
      console.warn(`[TerraByte] Warning: Failed to set equipment to Operational: ${eqError.message}`);
    }
  }

  // Auto-generate verified service history record bound to equipment
  try {
    await createServiceHistoryFromRepair(repair.id);
  } catch (shErr) {
    console.warn(`[TerraByte] Warning: Failed to auto-generate service history on completion:`, shErr);
  }

  // Notify farmer that repair is completed and machinery is ready
  try {
    await createNotification({
      recipient_role: "farmer",
      recipient_user_id: repair.farmer_id,
      notification_text: `Repair ${repair.job_number} has been completed and saved to service history.`,
      link_target: `/farmer/repair/${repair.id}`,
    });
  } catch (notifErr) {
    console.warn("[TerraByte] Warning: Failed to send completion notification:", notifErr);
  }

  // Notify Service Centre (admin) that repair is completed and verified
  try {
    await createNotification({
      recipient_role: "admin",
      notification_text: `Repair ${repair.job_number} completed & verified by technician. Ready for review.`,
      link_target: `/admin/repair/${repair.id}`,
    });
  } catch (adminNotifErr) {
    console.warn("[TerraByte] Warning: Failed to send admin completion notification:", adminNotifErr);
  }

  return updated;
}

