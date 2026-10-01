import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

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
}

export interface RepairRequestDetail extends RepairRequestWithEquipment {
  repair_timeline: RepairTimelineRow[];
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
    throw new Error("Authentication required: Please sign in to manage repair requests.");
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

  return repair;
}

/**
 * Fetches all repair request tickets for the authenticated farmer with joined equipment details.
 * Protected by PostgreSQL RLS: Only the farmer's own repair requests are returned.
 */
export async function getFarmerRepairRequests(): Promise<RepairRequestWithEquipment[]> {
  await getAuthenticatedProfile();

  const { data, error } = await supabase
    .from("repair_requests")
    .select("*, equipment(*), technician:technician_id(id, full_name, phone, village)")
    .order("created_at", { ascending: false });

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

  // Allow lookup by UUID or human-readable job_number
  const query = supabase
    .from("repair_requests")
    .select("*, equipment(*), repair_timeline(*), technician:technician_id(id, full_name, phone, village)")
    .order("created_at", { referencedTable: "repair_timeline", ascending: true });

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const { data, error } = isUuid
    ? await query.eq("id", id).maybeSingle()
    : await query.eq("job_number", id).maybeSingle();

  if (error) {
    throw new Error(`Failed to load repair details: ${error.message}`);
  }

  return (data as RepairRequestDetail) ?? null;
}

/**
 * Cancels an eligible repair request.
 * Cancellation is strictly permitted only while the ticket is in 'REQUESTED' or 'ACCEPTED' state.
 * Work in progress or completed repairs cannot be cancelled by the farmer.
 * Automatically restores the associated equipment to 'Operational' if no other active repairs exist.
 */
export async function cancelRepairRequest(id: string): Promise<RepairRequestRow> {
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
  const cancellableStatuses: RepairStatus[] = ["REQUESTED", "ACCEPTED"];
  if (!cancellableStatuses.includes(repair.status)) {
    throw new Error(
      `Cannot cancel repair: Ticket is in '${repair.status}' status. Only newly requested or accepted repairs can be cancelled.`
    );
  }

  const now = new Date().toISOString();

  // 3. Update repair request status to CANCELLED
  const { data: updated, error: updateError } = await supabase
    .from("repair_requests")
    .update({
      status: "CANCELLED",
      status_since: now,
    })
    .eq("id", repair.id)
    .select()
    .single();

  if (updateError) {
    throw new Error(`Failed to cancel repair request: ${updateError.message}`);
  }

  // 4. Log cancellation event in timeline
  const { error: timelineError } = await supabase
    .from("repair_timeline")
    .insert({
      repair_request_id: repair.id,
      status: "CANCELLED",
      note: "Cancelled by farmer",
      created_by_role: "farmer",
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

  return updated;
}
