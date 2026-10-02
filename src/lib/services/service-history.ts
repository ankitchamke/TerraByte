import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { calculateQuoteTotals } from "./quotes";

export type ServiceHistoryRow = Database["public"]["Tables"]["service_history"]["Row"];
export type RepairRequestRow = Database["public"]["Tables"]["repair_requests"]["Row"];
export type EquipmentRow = Database["public"]["Tables"]["equipment"]["Row"];
export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
export type UserRole = Database["public"]["Enums"]["user_role"];

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
    throw new Error("Authentication required: Please sign in to access service history.");
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
 * Checks whether a technician is verified.
 */
async function verifyTechnicianIsVerified(profileId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("technician_profiles")
    .select("is_verified")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error || !data) return false;
  return Boolean(data.is_verified);
}

/**
 * Creates a permanent, verified service history record bound to equipment from a COMPLETED repair.
 * - Caller must be the assigned technician or an admin.
 * - Repair request must be in 'COMPLETED' status.
 * - Idempotent: If a service history record already exists for this repair request, returns existing record.
 * - Automatically derives operating hours, replacement parts, labour cost, total cost,
 *   technician & workshop credentials, downtime hours, and invoice reference.
 */
export async function createServiceHistoryFromRepair(
  repairRequestId: string
): Promise<ServiceHistoryRow> {
  if (!repairRequestId) throw new Error("Repair request ID is required.");

  const profile = await getAuthenticatedProfile();

  if (profile.role !== "technician" && profile.role !== "admin") {
    throw new Error("Unauthorized: Only technicians or admins can create service history records.");
  }

  if (profile.role === "technician") {
    const isVerified = await verifyTechnicianIsVerified(profile.id);
    if (!isVerified) {
      throw new Error("Unauthorized: Unverified technicians cannot generate verified service records.");
    }
  }

  // 1. Fetch repair request
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(repairRequestId);
  const { data: repair, error: repairError } = isUuid
    ? await supabase.from("repair_requests").select("*").eq("id", repairRequestId).maybeSingle()
    : await supabase.from("repair_requests").select("*").eq("job_number", repairRequestId).maybeSingle();

  if (repairError || !repair) {
    throw new Error("Repair request not found or inaccessible.");
  }

  // Check assignment
  if (profile.role === "technician" && repair.technician_id !== profile.id) {
    throw new Error("Unauthorized: You are not assigned to this repair ticket.");
  }

  // Must be COMPLETED
  if (repair.status !== "COMPLETED") {
    throw new Error(`Cannot create service history: Repair is in '${repair.status}' status (must be COMPLETED).`);
  }

  // 2. Check for existing service history record (idempotency)
  const { data: existing, error: existingError } = await supabase
    .from("service_history")
    .select("*")
    .eq("repair_request_id", repair.id)
    .maybeSingle();

  if (existing) {
    return existing;
  }

  // 3. Fetch equipment to get latest operating hours
  const { data: equipment, error: eqError } = await supabase
    .from("equipment")
    .select("*")
    .eq("id", repair.equipment_id)
    .single();

  if (eqError || !equipment) {
    throw new Error("Associated equipment not found.");
  }

  // 4. Fetch approved quote and line items if available
  const { data: approvedQuote } = await supabase
    .from("quotes")
    .select("*, quote_items(*)")
    .eq("repair_request_id", repair.id)
    .eq("status", "APPROVED")
    .maybeSingle();

  let partsReplaced: string[] = [];
  let labourCost = 0;
  let totalCost = 0;

  if (approvedQuote) {
    labourCost = Number(approvedQuote.labour_amount) || 0;
    const items = (approvedQuote.quote_items || []) as Array<{
      part_name: string;
      quantity: number;
      unit_price: number;
    }>;
    partsReplaced = items.map((item) =>
      item.quantity > 1 ? `${item.part_name} ×${item.quantity}` : item.part_name
    );
    const totals = calculateQuoteTotals(items, labourCost, Number(approvedQuote.tax_percent) || 0);
    totalCost = totals.totalAmount;
  }

  // 5. Fetch technician credentials and workshop name
  let technicianName = "Authorized Technician";
  let workshopName = "TerraByte Service Hub";

  if (repair.technician_id) {
    const { data: techProfile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", repair.technician_id)
      .maybeSingle();

    const { data: techExtra } = await supabase
      .from("technician_profiles")
      .select("workshop_name")
      .eq("profile_id", repair.technician_id)
      .maybeSingle();

    if (techProfile?.full_name) technicianName = techProfile.full_name;
    if (techExtra?.workshop_name) workshopName = techExtra.workshop_name;
  }

  // 6. Derive assessment, symptoms, and downtime
  const assessment = repair.assessment as Record<string, any> | null;
  const completionDetails = repair.completion_details as Record<string, any> | null;

  const assessmentSystem = assessment ? assessment["system"] : null;
  const serviceType = assessmentSystem
    ? `${assessmentSystem} Repair`
    : "Comprehensive Equipment Repair";

  const assessmentIssue = assessment ? assessment["possibleIssue"] : null;
  const issueDescription =
    assessmentIssue ||
    repair.description ||
    (repair.symptoms && repair.symptoms.length > 0
      ? repair.symptoms.join(", ")
      : "Machinery breakdown restored");

  const technicianNotes = (completionDetails ? completionDetails["notes"] : null) || repair.description || null;
  const maintenanceAdvice = (assessment ? assessment["maintenanceAdvice"] : null) || null;

  const createdAtMs = new Date(repair.created_at).getTime();
  const downtimeHours = Math.max(
    0,
    Math.round(((Date.now() - createdAtMs) / (1000 * 3600)) * 10) / 10
  );

  const invoiceReference = `INV-${repair.job_number}`;
  const serviceDate = (completionDetails ? completionDetails["completed_at"] : null) || new Date().toISOString();

  // 7. Insert service history record
  const { data: created, error: insertError } = await supabase
    .from("service_history")
    .insert({
      equipment_id: repair.equipment_id,
      repair_request_id: repair.id,
      service_date: serviceDate,
      operating_hours: equipment.operating_hours || 0,
      service_type: serviceType,
      issue_description: issueDescription,
      parts_replaced: partsReplaced,
      labour_cost: labourCost,
      total_cost: totalCost,
      technician_name: technicianName,
      workshop_name: workshopName,
      technician_notes: technicianNotes,
      maintenance_advice: maintenanceAdvice,
      downtime_hours: downtimeHours,
      invoice_reference: invoiceReference,
    })
    .select()
    .single();

  if (insertError || !created) {
    throw new Error(`Failed to create service history record: ${insertError?.message}`);
  }

  return created;
}

/**
 * Fetches all service history records for a specific equipment asset.
 * Ordered chronologically by service date (newest first).
 */
export async function getServiceHistoryForEquipment(
  equipmentId: string
): Promise<ServiceHistoryRow[]> {
  if (!equipmentId) throw new Error("Equipment ID is required.");
  await getAuthenticatedProfile();

  const { data, error } = await supabase
    .from("service_history")
    .select("*")
    .eq("equipment_id", equipmentId)
    .order("service_date", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch service history: ${error.message}`);
  }

  return data || [];
}

/**
 * Fetches the service history record associated with a specific repair request, if generated.
 */
export async function getServiceHistoryForRepair(
  repairRequestId: string
): Promise<ServiceHistoryRow | null> {
  if (!repairRequestId) throw new Error("Repair request ID is required.");
  await getAuthenticatedProfile();

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(repairRequestId);
  const { data: repair } = isUuid
    ? await supabase.from("repair_requests").select("id").eq("id", repairRequestId).maybeSingle()
    : await supabase.from("repair_requests").select("id").eq("job_number", repairRequestId).maybeSingle();

  const targetRepairId = repair ? repair.id : repairRequestId;

  const { data, error } = await supabase
    .from("service_history")
    .select("*")
    .eq("repair_request_id", targetRepairId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch service history for repair: ${error.message}`);
  }

  return data;
}

/**
 * Fetches a single service history record by its primary key.
 */
export async function getServiceHistoryById(
  serviceHistoryId: string
): Promise<ServiceHistoryRow | null> {
  if (!serviceHistoryId) throw new Error("Service history ID is required.");
  await getAuthenticatedProfile();

  const { data, error } = await supabase
    .from("service_history")
    .select("*")
    .eq("id", serviceHistoryId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch service record: ${error.message}`);
  }

  return data;
}
