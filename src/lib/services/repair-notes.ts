import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import type { Assessment } from "@/lib/assessment";
import { createNotification } from "./notifications";

export type RepairNoteRow = Database["public"]["Tables"]["repair_notes"]["Row"];
export type RepairRequestRow = Database["public"]["Tables"]["repair_requests"]["Row"];
export type RepairTimelineRow = Database["public"]["Tables"]["repair_timeline"]["Row"];
export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

export interface RepairNoteWithAuthor {
  id: string;
  repair_request_id: string;
  author_id: string;
  note_text: string;
  created_at: string;
  author: Pick<ProfileRow, "id" | "full_name" | "role"> | null;
}

export interface UpdateDiagnosisInput {
  system?: string;
  possibleIssue?: string;
  severity?: "Low" | "Moderate" | "Moderate to High" | "High";
  advice?: string;
  partsCategory?: string[];
  skill?: string;
  technicianNotes?: string;
  findings?: string;
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
    throw new Error("Authentication required: Please sign in to manage repair notes and diagnosis.");
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
 * Fetches all chronological repair notes for a given repair request,
 * joining the author profile (id, full_name, role).
 * Protected by PostgreSQL RLS: Only authorized participants (farmer, assigned technician, admin) can view notes.
 */
export async function getRepairNotes(repairRequestId: string): Promise<RepairNoteWithAuthor[]> {
  if (!repairRequestId) throw new Error("Repair request ID is required.");

  await getAuthenticatedProfile();

  // Resolve UUID if job_number was passed
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(repairRequestId);
  let resolvedId = repairRequestId;

  if (!isUuid) {
    const { data: repair, error: lookupError } = await supabase
      .from("repair_requests")
      .select("id")
      .eq("job_number", repairRequestId)
      .maybeSingle();

    if (lookupError || !repair) {
      throw new Error("Repair request not found or inaccessible.");
    }
    resolvedId = repair.id;
  }

  const { data, error } = await supabase
    .from("repair_notes")
    .select("id, repair_request_id, author_id, note_text, created_at, author:author_id(id, full_name, role)")
    .eq("repair_request_id", resolvedId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load repair notes: ${error.message}`);
  }

  return (data as unknown as RepairNoteWithAuthor[]) ?? [];
}

/**
 * Adds an immutable technical repair note to a repair request.
 * Authorization Rules:
 * - Only the assigned technician (repair_requests.technician_id === profile.id) or Service Centre (admin) can add notes.
 * - Farmers and unassigned/different technicians are strictly unauthorized.
 * - The author_id is strictly derived from the authenticated profile (anti-spoofing).
 * - Terminal states (COMPLETED, CANCELLED) reject new notes.
 * - Records an audit entry in repair_timeline with status "NOTE".
 */
export async function addRepairNote(repairRequestId: string, noteText: string): Promise<RepairNoteWithAuthor> {
  if (!repairRequestId) throw new Error("Repair request ID is required.");

  const profile = await getAuthenticatedProfile();

  const trimmedText = noteText?.trim();
  if (!trimmedText) {
    throw new Error("Note text cannot be empty.");
  }

  if (trimmedText.length > 1000) {
    throw new Error("Note text exceeds maximum allowed length (1000 characters).");
  }

  // 1. Fetch repair request to verify assignment and lifecycle status
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(repairRequestId);
  const { data: repair, error: repairError } = isUuid
    ? await supabase.from("repair_requests").select("id, technician_id, status, job_number, farmer_id").eq("id", repairRequestId).maybeSingle()
    : await supabase.from("repair_requests").select("id, technician_id, status, job_number, farmer_id").eq("job_number", repairRequestId).maybeSingle();

  if (repairError || !repair) {
    throw new Error("Repair request not found or inaccessible.");
  }

  // 2. Authorization check: only assigned technician or admin can add notes
  const isAssignedTech = repair.technician_id === profile.id;
  const isAdmin = profile.role === "admin";

  if (!isAssignedTech && !isAdmin) {
    throw new Error("Unauthorized: Only the assigned technician or Service Centre can add repair notes.");
  }

  // 3. Lifecycle check: terminal states reject note addition
  if (repair.status === "COMPLETED" || repair.status === "CANCELLED") {
    throw new Error(`Cannot add note: Repair request is ${repair.status.toLowerCase()}.`);
  }

  // 4. Insert note row into public.repair_notes (author_id strictly from authenticated profile)
  const { data: noteRow, error: insertError } = await supabase
    .from("repair_notes")
    .insert({
      repair_request_id: repair.id,
      author_id: profile.id,
      note_text: trimmedText,
    })
    .select("id, repair_request_id, author_id, note_text, created_at, author:author_id(id, full_name, role)")
    .single();

  if (insertError || !noteRow) {
    throw new Error(`Failed to save repair note: ${insertError?.message}`);
  }

  // 5. Coordinated state: record audit event in public.repair_timeline
  const { error: timelineError } = await supabase
    .from("repair_timeline")
    .insert({
      repair_request_id: repair.id,
      status: "NOTE",
      note: trimmedText,
      created_by_role: profile.role,
      created_by_id: profile.id,
    });

  if (timelineError) {
    console.warn(`[TerraByte] Warning: Failed to record timeline entry for note: ${timelineError.message}`);
  }

  // Important rule (Phase 4.3): Do NOT generate notifications for every internal technician note.
  // The repair timeline/activity log remains the detailed history.
  return noteRow as unknown as RepairNoteWithAuthor;
}

/**
 * Updates the confirmed diagnostic findings in repair_requests.assessment.
 * Authorization Rules:
 * - Only the assigned technician (repair_requests.technician_id === profile.id) or Service Centre (admin) can update diagnosis.
 * - Preserves existing intake assessment structure while updating confirmed findings.
 * - Does not alter repair status, ownership, or unrelated fields.
 * - Records a confirmation audit entry in repair_timeline.
 */
export async function updateDiagnosis(
  repairRequestId: string,
  diagnosisData: UpdateDiagnosisInput
): Promise<RepairRequestRow> {
  if (!repairRequestId) throw new Error("Repair request ID is required.");

  const profile = await getAuthenticatedProfile();

  const hasFields = Object.keys(diagnosisData).some((k) => (diagnosisData as Record<string, unknown>)[k] !== undefined);
  if (!hasFields) {
    throw new Error("At least one diagnostic field must be provided to update assessment.");
  }

  // 1. Fetch repair request
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(repairRequestId);
  const { data: repair, error: repairError } = isUuid
    ? await supabase.from("repair_requests").select("*").eq("id", repairRequestId).maybeSingle()
    : await supabase.from("repair_requests").select("*").eq("job_number", repairRequestId).maybeSingle();

  if (repairError || !repair) {
    throw new Error("Repair request not found or inaccessible.");
  }

  // 2. Authorization check: only assigned technician or admin can update diagnosis
  const isAssignedTech = repair.technician_id === profile.id;
  const isAdmin = profile.role === "admin";

  if (!isAssignedTech && !isAdmin) {
    throw new Error("Unauthorized: Only the assigned technician or Service Centre can update diagnostic findings.");
  }

  // 3. Lifecycle check: terminal states reject diagnosis update
  if (repair.status === "COMPLETED" || repair.status === "CANCELLED") {
    throw new Error(`Cannot update diagnosis: Repair request is ${repair.status.toLowerCase()}.`);
  }

  // 4. Merge diagnosis data into existing assessment JSON
  const existingAssessment = (repair.assessment as Record<string, unknown>) ?? {};
  const updatedAssessment: Record<string, unknown> = {
    ...existingAssessment,
    source: "technician-confirmed",
    confirmed_at: new Date().toISOString(),
  };

  if (diagnosisData.system !== undefined) updatedAssessment["system"] = diagnosisData.system;
  if (diagnosisData.possibleIssue !== undefined) updatedAssessment["possibleIssue"] = diagnosisData.possibleIssue;
  if (diagnosisData.severity !== undefined) updatedAssessment["severity"] = diagnosisData.severity;
  if (diagnosisData.advice !== undefined) updatedAssessment["advice"] = diagnosisData.advice;
  if (diagnosisData.partsCategory !== undefined) updatedAssessment["partsCategory"] = diagnosisData.partsCategory;
  if (diagnosisData.skill !== undefined) updatedAssessment["skill"] = diagnosisData.skill;
  if (diagnosisData.technicianNotes !== undefined) updatedAssessment["technicianNotes"] = diagnosisData.technicianNotes;
  if (diagnosisData.findings !== undefined) updatedAssessment["findings"] = diagnosisData.findings;

  // 5. Persist updated assessment to repair_requests
  const { data: updated, error: updateError } = await supabase
    .from("repair_requests")
    .update({
      assessment: updatedAssessment as Json,
    })
    .eq("id", repair.id)
    .select()
    .single();

  if (updateError || !updated) {
    throw new Error(`Failed to update diagnosis: ${updateError?.message}`);
  }

  // 6. Record diagnostic confirmation audit event in timeline
  const diagnosticSummary =
    diagnosisData.possibleIssue || diagnosisData.system || "Technician confirmed diagnostic assessment";
  const { error: timelineError } = await supabase
    .from("repair_timeline")
    .insert({
      repair_request_id: repair.id,
      status: "NOTE",
      note: `Diagnostic assessment confirmed: ${diagnosticSummary}`,
      created_by_role: profile.role,
      created_by_id: profile.id,
    });

  if (timelineError) {
    console.warn(`[TerraByte] Warning: Failed to record diagnosis timeline entry: ${timelineError.message}`);
  }

  return updated;
}
