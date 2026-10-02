import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { createNotification } from "./notifications";

export type QuoteRow = Database["public"]["Tables"]["quotes"]["Row"];
export type QuoteItemRow = Database["public"]["Tables"]["quote_items"]["Row"];
export type QuoteStatus = Database["public"]["Enums"]["quote_status"];
export type RepairStatus = Database["public"]["Enums"]["repair_status"];
export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
export type RepairRequestRow = Database["public"]["Tables"]["repair_requests"]["Row"];

export interface CreateQuoteItemInput {
  part_name: string;
  part_spec?: string;
  quantity: number;
  unit_price: number;
  part_source?: string;
}

export interface CreateQuoteInput {
  repair_request_id: string;
  labour_description: string;
  labour_amount: number;
  tax_percent: number;
  estimated_completion: string;
  warranty_terms?: string;
  items: CreateQuoteItemInput[];
}

export interface ReviseQuoteInput extends CreateQuoteInput {
  previous_quote_id: string;
}

export interface QuoteTotals {
  partsTotal: number;
  labourAmount: number;
  taxAmount: number;
  totalAmount: number;
}

export interface QuoteDetail extends QuoteRow {
  quote_items: QuoteItemRow[];
  totals: QuoteTotals;
  technician?: Pick<ProfileRow, "id" | "full_name" | "phone" | "village"> | null;
}

/**
 * Calculates itemized parts, labour, tax, and total pricing for a quote.
 */
export function calculateQuoteTotals(
  items: Array<{ quantity: number; unit_price: number }>,
  labourAmount: number,
  taxPercent: number
): QuoteTotals {
  const partsTotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const taxAmount = Math.round((partsTotal + labourAmount) * (taxPercent / 100) * 100) / 100;
  const totalAmount = Math.round((partsTotal + labourAmount + taxAmount) * 100) / 100;
  return { partsTotal, labourAmount, taxAmount, totalAmount };
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
    throw new Error("Authentication required: Please sign in to manage quotes.");
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
 * Validates common quote fields (labour, tax, completion date, items).
 */
function validateQuoteInputs(input: CreateQuoteInput) {
  if (!input.repair_request_id) {
    throw new Error("Repair request ID is required.");
  }

  if (typeof input.labour_amount !== "number" || isNaN(input.labour_amount) || input.labour_amount < 0) {
    throw new Error("Labour amount must be a non-negative number.");
  }

  if (
    typeof input.tax_percent !== "number" ||
    isNaN(input.tax_percent) ||
    input.tax_percent < 0 ||
    input.tax_percent > 100
  ) {
    throw new Error("Tax percentage must be between 0% and 100%.");
  }

  const labourDesc = input.labour_description?.trim();
  if (!labourDesc) {
    throw new Error("Labour / service description is required.");
  }

  const eta = input.estimated_completion?.trim();
  if (!eta) {
    throw new Error("Estimated completion time is required.");
  }

  if (!input.items || !Array.isArray(input.items) || input.items.length === 0) {
    throw new Error("Quote must contain at least one itemized part or supply.");
  }

  for (const [i, item] of input.items.entries()) {
    if (!item || !item.part_name || !item.part_name.trim()) {
      throw new Error(`Item ${i + 1}: Part name is required.`);
    }
    if (typeof item.quantity !== "number" || isNaN(item.quantity) || item.quantity <= 0) {
      throw new Error(`Item ${i + 1}: Quantity must be greater than 0.`);
    }
    if (typeof item.unit_price !== "number" || isNaN(item.unit_price) || item.unit_price < 0) {
      throw new Error(`Item ${i + 1}: Unit price must be a non-negative number.`);
    }
  }
}

/**
 * Fetches all quotes for a repair request, ordered by version ASC.
 * Includes quote items and technician profile.
 * Protected by PostgreSQL RLS: Only authorized participants can view quotes.
 */
export async function getQuotesForRepair(repairRequestId: string): Promise<QuoteDetail[]> {
  if (!repairRequestId) throw new Error("Repair request ID is required.");

  await getAuthenticatedProfile();

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
    .from("quotes")
    .select("*, quote_items(*), technician:technician_id(id, full_name, phone, village)")
    .eq("repair_request_id", resolvedId)
    .order("version", { ascending: true });

  if (error) {
    throw new Error(`Failed to load quotes: ${error.message}`);
  }

  const quoteRows = (data as unknown as Array<QuoteRow & { quote_items: QuoteItemRow[]; technician: any }>) ?? [];

  return quoteRows.map((q) => {
    const items = q.quote_items || [];
    const totals = calculateQuoteTotals(items, Number(q.labour_amount), Number(q.tax_percent));
    return {
      ...q,
      quote_items: items,
      totals,
    };
  });
}

/**
 * Fetches a single quote by its UUID, including items and calculated totals.
 */
export async function getQuoteById(quoteId: string): Promise<QuoteDetail | null> {
  if (!quoteId) throw new Error("Quote ID is required.");

  await getAuthenticatedProfile();

  const { data, error } = await supabase
    .from("quotes")
    .select("*, quote_items(*), technician:technician_id(id, full_name, phone, village)")
    .eq("id", quoteId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load quote: ${error.message}`);
  }

  if (!data) return null;

  const quote = data as unknown as QuoteRow & { quote_items: QuoteItemRow[]; technician: any };
  const items = quote.quote_items || [];
  const totals = calculateQuoteTotals(items, Number(quote.labour_amount), Number(quote.tax_percent));

  return {
    ...quote,
    quote_items: items,
    totals,
  };
}

/**
 * Creates and dispatches an initial quote (version 1) for a repair request.
 * Authorization Rules:
 * - Only the technician assigned to the repair ticket (or Service Centre admin) can create quotes.
 * - Repair must be in 'ACCEPTED' or 'REQUESTED' status.
 * - Enforces server-side validation on labour, taxes, and items.
 * - Advances repair status to 'QUOTE_PENDING'.
 * - Records timeline event.
 */
export async function createQuote(input: CreateQuoteInput): Promise<QuoteDetail> {
  validateQuoteInputs(input);

  const profile = await getAuthenticatedProfile();

  if (profile.role !== "technician" && profile.role !== "admin") {
    throw new Error("Unauthorized: Only technicians can formulate repair quotes.");
  }

  // 1. Fetch repair request to verify assignment and eligibility
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.repair_request_id);
  const { data: repair, error: repairError } = isUuid
    ? await supabase.from("repair_requests").select("*").eq("id", input.repair_request_id).maybeSingle()
    : await supabase.from("repair_requests").select("*").eq("job_number", input.repair_request_id).maybeSingle();

  if (repairError || !repair) {
    throw new Error("Repair request not found or inaccessible.");
  }

  const isAssigned = repair.technician_id === profile.id;
  const isAdmin = profile.role === "admin";

  if (!isAssigned && !isAdmin) {
    throw new Error("Unauthorized: You are not assigned to this repair request.");
  }

  const quotableStatuses: RepairStatus[] = ["ACCEPTED", "REQUESTED", "QUOTE_REVISED"];
  if (!quotableStatuses.includes(repair.status)) {
    throw new Error(`Cannot create quote: Repair ticket is in '${repair.status}' status.`);
  }

  // 2. Insert quote row (version 1, PENDING)
  const now = new Date().toISOString();
  const { data: quote, error: quoteInsertError } = await supabase
    .from("quotes")
    .insert({
      repair_request_id: repair.id,
      technician_id: profile.id,
      labour_description: input.labour_description.trim(),
      labour_amount: input.labour_amount,
      tax_percent: input.tax_percent,
      estimated_completion: input.estimated_completion.trim(),
      warranty_terms: input.warranty_terms?.trim() || null,
      version: 1,
      status: "PENDING",
      sent_at: now,
    })
    .select()
    .single();

  if (quoteInsertError || !quote) {
    throw new Error(`Failed to create quote: ${quoteInsertError?.message}`);
  }

  // 3. Batch insert quote items
  const itemRows = input.items.map((item) => ({
    quote_id: quote.id,
    part_name: item.part_name.trim(),
    part_spec: item.part_spec?.trim() || null,
    quantity: item.quantity,
    unit_price: item.unit_price,
    part_source: item.part_source?.trim() || "In van stock",
  }));

  const { data: insertedItems, error: itemsError } = await supabase
    .from("quote_items")
    .insert(itemRows)
    .select();

  if (itemsError || !insertedItems) {
    // Attempt rollback of the quote row
    await supabase.from("quotes").delete().eq("id", quote.id);
    throw new Error(`Failed to save quote items: ${itemsError?.message}`);
  }

  // 4. Update repair request status to 'QUOTE_PENDING' and clear any previous clarification note
  const { error: repairUpdateError } = await supabase
    .from("repair_requests")
    .update({
      status: "QUOTE_PENDING",
      clarification_note: null,
      status_since: now,
    })
    .eq("id", repair.id);

  if (repairUpdateError) {
    console.warn(`[TerraByte] Warning: Failed to advance repair status to QUOTE_PENDING: ${repairUpdateError.message}`);
  }

  // 5. Coordinated state: record timeline event
  const totals = calculateQuoteTotals(insertedItems, input.labour_amount, input.tax_percent);
  const { error: timelineError } = await supabase
    .from("repair_timeline")
    .insert({
      repair_request_id: repair.id,
      status: "QUOTE_PENDING",
      note: `Quote formulated & sent (v1: ₹${totals.totalAmount.toLocaleString("en-IN")})`,
      created_by_role: profile.role,
      created_by_id: profile.id,
    });

  if (timelineError) {
    console.warn(`[TerraByte] Warning: Failed to record quote timeline entry: ${timelineError.message}`);
  }

  // Notify farmer of new quote
  try {
    await createNotification({
      recipient_role: "farmer",
      recipient_user_id: repair.farmer_id,
      notification_text: `Quote ready for ${repair.job_number}: ₹${totals.totalAmount.toLocaleString("en-IN")}`,
      link_target: `/farmer/repair/${repair.id}`,
    });
  } catch (notifErr) {
    console.warn("[TerraByte] Warning: Failed to send quote notification:", notifErr);
  }

  return {
    ...quote,
    quote_items: insertedItems,
    totals,
  };
}

/**
 * Formulates and sends a revised quote for a repair request, preserving prior quote history.
 * - Increments quote version (previous.version + 1).
 * - Marks previous quote as 'REVISED'.
 * - Creates new quote row in 'PENDING' status.
 * - Updates repair status to 'QUOTE_PENDING' and clears clarification note.
 * - Records timeline audit event.
 */
export async function reviseQuote(input: ReviseQuoteInput): Promise<QuoteDetail> {
  if (!input.previous_quote_id) {
    throw new Error("Previous quote ID is required for revision.");
  }

  validateQuoteInputs(input);

  const profile = await getAuthenticatedProfile();

  if (profile.role !== "technician" && profile.role !== "admin") {
    throw new Error("Unauthorized: Only technicians can formulate repair quotes.");
  }

  // 1. Fetch previous quote
  const { data: prevQuote, error: prevQuoteError } = await supabase
    .from("quotes")
    .select("*")
    .eq("id", input.previous_quote_id)
    .maybeSingle();

  if (prevQuoteError || !prevQuote) {
    throw new Error("Previous quote not found or inaccessible.");
  }

  // 2. Fetch repair request to verify assignment
  const { data: repair, error: repairError } = await supabase
    .from("repair_requests")
    .select("*")
    .eq("id", prevQuote.repair_request_id)
    .maybeSingle();

  if (repairError || !repair) {
    throw new Error("Repair request not found or inaccessible.");
  }

  const isAssigned = repair.technician_id === profile.id;
  const isAdmin = profile.role === "admin";

  if (!isAssigned && !isAdmin) {
    throw new Error("Unauthorized: You are not assigned to this repair request.");
  }

  // 3. Mark previous quote as 'REVISED'
  await supabase
    .from("quotes")
    .update({ status: "REVISED" })
    .eq("id", prevQuote.id);

  // 4. Create new quote row with incremented version
  const newVersion = prevQuote.version + 1;
  const now = new Date().toISOString();

  const { data: newQuote, error: newQuoteError } = await supabase
    .from("quotes")
    .insert({
      repair_request_id: repair.id,
      technician_id: profile.id,
      labour_description: input.labour_description.trim(),
      labour_amount: input.labour_amount,
      tax_percent: input.tax_percent,
      estimated_completion: input.estimated_completion.trim(),
      warranty_terms: input.warranty_terms?.trim() || null,
      version: newVersion,
      status: "PENDING",
      sent_at: now,
    })
    .select()
    .single();

  if (newQuoteError || !newQuote) {
    throw new Error(`Failed to create revised quote: ${newQuoteError?.message}`);
  }

  // 5. Batch insert new quote items
  const itemRows = input.items.map((item) => ({
    quote_id: newQuote.id,
    part_name: item.part_name.trim(),
    part_spec: item.part_spec?.trim() || null,
    quantity: item.quantity,
    unit_price: item.unit_price,
    part_source: item.part_source?.trim() || "In van stock",
  }));

  const { data: insertedItems, error: itemsError } = await supabase
    .from("quote_items")
    .insert(itemRows)
    .select();

  if (itemsError || !insertedItems) {
    await supabase.from("quotes").delete().eq("id", newQuote.id);
    throw new Error(`Failed to save revised quote items: ${itemsError?.message}`);
  }

  // 6. Update repair request status to 'QUOTE_PENDING' and clear clarification note
  await supabase
    .from("repair_requests")
    .update({
      status: "QUOTE_PENDING",
      clarification_note: null,
      status_since: now,
    })
    .eq("id", repair.id);

  // 7. Record timeline audit entry
  const totals = calculateQuoteTotals(insertedItems, input.labour_amount, input.tax_percent);
  const { error: timelineError } = await supabase
    .from("repair_timeline")
    .insert({
      repair_request_id: repair.id,
      status: "QUOTE_PENDING",
      note: `Revised quote sent (v${newVersion}: ₹${totals.totalAmount.toLocaleString("en-IN")})`,
      created_by_role: profile.role,
      created_by_id: profile.id,
    });

  if (timelineError) {
    console.warn(`[TerraByte] Warning: Failed to record revised quote timeline entry: ${timelineError.message}`);
  }

  // Notify farmer of revised quote
  try {
    await createNotification({
      recipient_role: "farmer",
      recipient_user_id: repair.farmer_id,
      notification_text: `Revised quote ready for ${repair.job_number} (v${newVersion}): ₹${totals.totalAmount.toLocaleString("en-IN")}`,
      link_target: `/farmer/repair/${repair.id}`,
    });
  } catch (notifErr) {
    console.warn("[TerraByte] Warning: Failed to send revised quote notification:", notifErr);
  }

  return {
    ...newQuote,
    quote_items: insertedItems,
    totals,
  };
}

/**
 * Approves a pending quote and authorizes physical repair work.
 * Authorization Rules:
 * - Only the farmer who owns the machinery / repair ticket can approve quotes.
 * - Technicians cannot approve their own quotes.
 * - Quote must currently be in 'PENDING' status.
 * - Advances repair status to 'IN_PROGRESS'.
 * - Records timeline audit event.
 */
export async function approveQuote(quoteId: string): Promise<QuoteDetail> {
  if (!quoteId) throw new Error("Quote ID is required.");

  const profile = await getAuthenticatedProfile();

  // 1. Fetch quote with repair request
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("*, quote_items(*), repair_request:repair_request_id(id, farmer_id, status)")
    .eq("id", quoteId)
    .maybeSingle();

  if (quoteError || !quote) {
    throw new Error("Quote not found or inaccessible.");
  }

  const repair = quote.repair_request as unknown as { id: string; farmer_id: string; status: RepairStatus };
  if (!repair) {
    throw new Error("Associated repair ticket not found.");
  }

  // 2. Authorization check: only owning farmer or admin can approve
  const isOwner = repair.farmer_id === profile.id;
  const isAdmin = profile.role === "admin";

  if (!isOwner && !isAdmin) {
    throw new Error("Unauthorized: Only the machinery owner (farmer) can approve quotes.");
  }

  // 3. Status check: quote must be PENDING
  if (quote.status !== "PENDING") {
    throw new Error(`Cannot approve quote: Quote is already '${quote.status}'.`);
  }

  const now = new Date().toISOString();

  // 4. Update quote status to APPROVED
  const { data: updatedQuote, error: updateError } = await supabase
    .from("quotes")
    .update({ status: "APPROVED" })
    .eq("id", quote.id)
    .select("*, quote_items(*), technician:technician_id(id, full_name, phone, village)")
    .single();

  if (updateError || !updatedQuote) {
    throw new Error(`Failed to approve quote: ${updateError?.message}`);
  }

  // 5. Advance repair status to IN_PROGRESS
  const { error: repairError2 } = await supabase
    .from("repair_requests")
    .update({
      status: "IN_PROGRESS",
      status_since: now,
    })
    .eq("id", repair.id);

  if (repairError2) {
    console.warn(`[TerraByte] Warning: Failed to advance repair status to IN_PROGRESS: ${repairError2.message}`);
  }

  // 6. Record timeline audit entry
  const { error: timelineError } = await supabase
    .from("repair_timeline")
    .insert({
      repair_request_id: repair.id,
      status: "IN_PROGRESS",
      note: "Quote approved & repair authorized",
      created_by_role: profile.role,
      created_by_id: profile.id,
    });

  if (timelineError) {
    console.warn(`[TerraByte] Warning: Failed to record quote approval timeline entry: ${timelineError.message}`);
  }

  // Notify technician that quote was approved and work can begin
  try {
    await createNotification({
      recipient_role: "technician",
      recipient_user_id: quote.technician_id,
      notification_text: `Quote approved for repair ticket — you may proceed with work`,
      link_target: `/technician/job/${repair.id}`,
    });
  } catch (notifErr) {
    console.warn("[TerraByte] Warning: Failed to send quote approval notification:", notifErr);
  }

  const items = (updatedQuote as any).quote_items || [];
  const totals = calculateQuoteTotals(items, Number(updatedQuote.labour_amount), Number(updatedQuote.tax_percent));

  return {
    ...(updatedQuote as unknown as QuoteRow & { quote_items: QuoteItemRow[]; technician: any }),
    totals,
  };
}

/**
 * Rejects a pending quote or sends it back to the technician for revision.
 * Authorization Rules:
 * - Only the owning farmer (or Service Centre admin) can reject or request revision.
 * - Quote must currently be in 'PENDING' status.
 * - Updates quote status to 'REVISED' (if revision reason given) or 'REJECTED'.
 * - Sets repair status to 'QUOTE_REVISED' with clarification note.
 * - Records timeline audit event.
 */
export async function rejectQuote(quoteId: string, reason?: string): Promise<QuoteDetail> {
  if (!quoteId) throw new Error("Quote ID is required.");

  const profile = await getAuthenticatedProfile();

  // 1. Fetch quote with repair request
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("*, quote_items(*), repair_request:repair_request_id(id, farmer_id, status)")
    .eq("id", quoteId)
    .maybeSingle();

  if (quoteError || !quote) {
    throw new Error("Quote not found or inaccessible.");
  }

  const repair = quote.repair_request as unknown as { id: string; farmer_id: string; status: RepairStatus };
  if (!repair) {
    throw new Error("Associated repair ticket not found.");
  }

  // 2. Authorization check: only owning farmer or admin can reject
  const isOwner = repair.farmer_id === profile.id;
  const isAdmin = profile.role === "admin";

  if (!isOwner && !isAdmin) {
    throw new Error("Unauthorized: Only the machinery owner (farmer) can reject quotes.");
  }

  // 3. Status check: quote must be PENDING
  if (quote.status !== "PENDING") {
    throw new Error(`Cannot reject quote: Quote is already '${quote.status}'.`);
  }

  const trimmedReason = reason?.trim();
  const newStatus: QuoteStatus = trimmedReason ? "REVISED" : "REJECTED";
  const now = new Date().toISOString();

  // 4. Update quote status
  const { data: updatedQuote, error: updateError } = await supabase
    .from("quotes")
    .update({ status: newStatus })
    .eq("id", quote.id)
    .select("*, quote_items(*), technician:technician_id(id, full_name, phone, village)")
    .single();

  if (updateError || !updatedQuote) {
    throw new Error(`Failed to reject quote: ${updateError?.message}`);
  }

  // 5. Update repair request status to QUOTE_REVISED and save clarification note
  const { error: repairError2 } = await supabase
    .from("repair_requests")
    .update({
      status: "QUOTE_REVISED",
      clarification_note: trimmedReason || "Quote declined by farmer",
      status_since: now,
    })
    .eq("id", repair.id);

  if (repairError2) {
    console.warn(`[TerraByte] Warning: Failed to set repair status to QUOTE_REVISED: ${repairError2.message}`);
  }

  // 6. Record timeline audit entry
  const { error: timelineError } = await supabase
    .from("repair_timeline")
    .insert({
      repair_request_id: repair.id,
      status: "QUOTE_REVISED",
      note: trimmedReason ? `Quote revision requested: "${trimmedReason}"` : "Quote declined by farmer",
      created_by_role: profile.role,
      created_by_id: profile.id,
    });

  if (timelineError) {
    console.warn(`[TerraByte] Warning: Failed to record quote rejection timeline entry: ${timelineError.message}`);
  }

  // Notify technician and admin
  try {
    if (trimmedReason) {
      await createNotification({
        recipient_role: "technician",
        recipient_user_id: quote.technician_id,
        notification_text: `Farmer requested quote revision: "${trimmedReason}"`,
        link_target: `/technician/job/${repair.id}`,
      });
    } else {
      await createNotification({
        recipient_role: "technician",
        recipient_user_id: quote.technician_id,
        notification_text: `Quote rejected by farmer`,
        link_target: `/technician/job/${repair.id}`,
      });
      await createNotification({
        recipient_role: "admin",
        notification_text: `Quote rejected by farmer for repair ticket`,
        link_target: `/admin/repair/${repair.id}`,
      });
    }
  } catch (notifErr) {
    console.warn("[TerraByte] Warning: Failed to send quote rejection notification:", notifErr);
  }

  const items = (updatedQuote as any).quote_items || [];
  const totals = calculateQuoteTotals(items, Number(updatedQuote.labour_amount), Number(updatedQuote.tax_percent));

  return {
    ...(updatedQuote as unknown as QuoteRow & { quote_items: QuoteItemRow[]; technician: any }),
    totals,
  };
}
