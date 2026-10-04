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
  technician_explanation?: string | undefined;
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

export interface QuoteRevisionInfo {
  reason?: string | undefined;
  explanation?: string | undefined;
  photo?: string | undefined;
  requested_at?: string | undefined;
}

export interface QuoteVersionDetail extends QuoteDetail {
  revision_request?: QuoteRevisionInfo | null;
  technician_explanation?: string | null;
}

export interface QuoteItemDiff {
  part_name: string;
  part_spec?: string | null;
  part_source?: string;
  v1_quantity?: number;
  v1_unit_price?: number;
  v1_total?: number;
  v2_quantity?: number;
  v2_unit_price?: number;
  v2_total?: number;
  price_difference?: number;
  status: "added" | "removed" | "modified" | "unchanged";
}

export interface QuoteVersionComparison {
  v1: QuoteVersionDetail;
  v2: QuoteVersionDetail;
  item_diffs: QuoteItemDiff[];
  labour_v1: number;
  labour_v2: number;
  labour_difference: number;
  parts_v1: number;
  parts_v2: number;
  parts_difference: number;
  total_v1: number;
  total_v2: number;
  total_difference: number;
  percentage_change: number;
  farmer_revision_request?: QuoteRevisionInfo | null;
  technician_explanation?: string | null;
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

  const quoteRows =
    (data as unknown as Array<
      QuoteRow & {
        quote_items: QuoteItemRow[];
        technician: Pick<ProfileRow, "id" | "full_name" | "phone" | "village"> | null;
      }
    >) ?? [];

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
 * Fetches all quote versions for a repair request with full version metadata,
 * including historical farmer revision requests and technician revision explanations.
 * Enables multi-version quote progression and comparison.
 */
export async function getQuoteVersions(repairRequestId: string): Promise<QuoteVersionDetail[]> {
  if (!repairRequestId?.trim()) throw new Error("Repair request ID is required.");

  await getAuthenticatedProfile();

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(repairRequestId.trim());
  let resolvedId = repairRequestId.trim();

  if (!isUuid) {
    const { data: repairLookup, error: lookupError } = await supabase
      .from("repair_requests")
      .select("id")
      .eq("job_number", repairRequestId.trim())
      .maybeSingle();

    if (lookupError || !repairLookup) {
      throw new Error("Repair request not found or inaccessible.");
    }
    resolvedId = repairLookup.id;
  }

  // 1. Fetch quotes with items ordered by version ascending
  const { data: quotesData, error: quotesError } = await supabase
    .from("quotes")
    .select("*, quote_items(*), technician:technician_id(id, full_name, phone, village)")
    .eq("repair_request_id", resolvedId)
    .order("version", { ascending: true });

  if (quotesError) {
    throw new Error(`Failed to load quote versions: ${quotesError.message}`);
  }

  const quoteRows =
    (quotesData as unknown as Array<
      QuoteRow & {
        quote_items: QuoteItemRow[];
        technician: Pick<ProfileRow, "id" | "full_name" | "phone" | "village"> | null;
      }
    >) ?? [];
  if (quoteRows.length === 0) return [];

  // 2. Fetch repair request to inspect persistent clarification_note
  const { data: repair } = await supabase
    .from("repair_requests")
    .select("id, status, clarification_note")
    .eq("id", resolvedId)
    .maybeSingle();

  // 3. Fetch repair timeline to correlate revision events and technician explanations
  const { data: timelineEntries } = await supabase
    .from("repair_timeline")
    .select("*")
    .eq("repair_request_id", resolvedId)
    .order("created_at", { ascending: true });

  const timeline = timelineEntries || [];

  return quoteRows.map((q, idx) => {
    const items = q.quote_items || [];
    const totals = calculateQuoteTotals(items, Number(q.labour_amount), Number(q.tax_percent));

    // Find farmer revision request for this version (if revised)
    let revisionRequest: QuoteRevisionInfo | null = null;
    if (q.status === "REVISED" || idx < quoteRows.length - 1) {
      const qTime = new Date(q.sent_at || q.created_at).getTime();
      const nextQTime = quoteRows[idx + 1]
        ? new Date(quoteRows[idx + 1].sent_at || quoteRows[idx + 1].created_at).getTime()
        : Infinity;

      const revEvent = timeline.find((t) => {
        if (t.status !== "QUOTE_REVISED") return false;
        const tTime = new Date(t.created_at).getTime();
        return tTime >= qTime - 5000 && tTime <= nextQTime + 5000;
      });

      if (revEvent?.note) {
        const match = revEvent.note.match(/Quote revision requested:\s*"?([\s\S]*?)"?$/);
        const rawNote = match ? match[1] : revEvent.note;
        const parsed = parseClarificationNote(rawNote);
        revisionRequest = {
          reason: parsed.reason,
          explanation: parsed.explanation,
          photo: parsed.photo,
          requested_at: revEvent.created_at,
        };
      } else if (idx === quoteRows.length - 1 && repair?.clarification_note) {
        const parsed = parseClarificationNote(repair.clarification_note);
        revisionRequest = {
          reason: parsed.reason,
          explanation: parsed.explanation,
          photo: parsed.photo,
        };
      }
    }

    // Find technician revision explanation for this version (if version > 1)
    let techExplanation: string | null = null;
    if (q.version > 1) {
      const qTime = new Date(q.sent_at || q.created_at).getTime();
      const sendEvent = timeline.find((t) => {
        if (t.status !== "QUOTE_PENDING" || t.created_by_role !== "technician") return false;
        const tTime = new Date(t.created_at).getTime();
        return Math.abs(tTime - qTime) < 30000;
      });

      if (sendEvent?.note) {
        const match = sendEvent.note.match(/Note:\s*"([\s\S]*?)"/);
        if (match && match[1]) {
          techExplanation = match[1].trim();
        }
      }
    }

    return {
      ...q,
      quote_items: items,
      totals,
      revision_request: revisionRequest,
      technician_explanation: techExplanation,
    };
  });
}

/**
 * Compares two quote versions (e.g. v1 and v2) and generates a structured diff
 * containing item differences, labour adjustments, price variances, and revision explanations.
 * Pure service-layer helper providing clean comparison data for the UI.
 */
export function compareQuoteVersions(
  v1: QuoteVersionDetail,
  v2: QuoteVersionDetail
): QuoteVersionComparison {
  if (!v1 || !v2) {
    throw new Error("Both quote versions are required for comparison.");
  }

  const v1Items = v1.quote_items || [];
  const v2Items = v2.quote_items || [];

  const itemDiffs: QuoteItemDiff[] = [];
  const matchedV2Ids = new Set<string>();

  // Compare items from v1 against v2
  for (const item1 of v1Items) {
    const match2 = v2Items.find(
      (item2) =>
        !matchedV2Ids.has(item2.id) &&
        item2.part_name.trim().toLowerCase() === item1.part_name.trim().toLowerCase()
    );

    if (match2) {
      matchedV2Ids.add(match2.id);
      const v1Total = item1.quantity * item1.unit_price;
      const v2Total = match2.quantity * match2.unit_price;
      const diff = v2Total - v1Total;
      const isModified =
        item1.quantity !== match2.quantity ||
        item1.unit_price !== match2.unit_price ||
        item1.part_source !== match2.part_source;

      itemDiffs.push({
        part_name: match2.part_name,
        part_spec: match2.part_spec || item1.part_spec || null,
        part_source: match2.part_source || item1.part_source,
        v1_quantity: item1.quantity,
        v1_unit_price: item1.unit_price,
        v1_total: v1Total,
        v2_quantity: match2.quantity,
        v2_unit_price: match2.unit_price,
        v2_total: v2Total,
        price_difference: diff,
        status: isModified ? "modified" : "unchanged",
      });
    } else {
      // Removed in v2
      const v1Total = item1.quantity * item1.unit_price;
      itemDiffs.push({
        part_name: item1.part_name,
        part_spec: item1.part_spec || null,
        part_source: item1.part_source,
        v1_quantity: item1.quantity,
        v1_unit_price: item1.unit_price,
        v1_total: v1Total,
        v2_quantity: 0,
        v2_unit_price: 0,
        v2_total: 0,
        price_difference: -v1Total,
        status: "removed",
      });
    }
  }

  // Items added in v2
  for (const item2 of v2Items) {
    if (!matchedV2Ids.has(item2.id)) {
      const v2Total = item2.quantity * item2.unit_price;
      itemDiffs.push({
        part_name: item2.part_name,
        part_spec: item2.part_spec || null,
        part_source: item2.part_source,
        v1_quantity: 0,
        v1_unit_price: 0,
        v1_total: 0,
        v2_quantity: item2.quantity,
        v2_unit_price: item2.unit_price,
        v2_total: v2Total,
        price_difference: v2Total,
        status: "added",
      });
    }
  }

  const labour1 = Number(v1.labour_amount) || 0;
  const labour2 = Number(v2.labour_amount) || 0;
  const labourDiff = labour2 - labour1;

  const parts1 = v1.totals.partsTotal || 0;
  const parts2 = v2.totals.partsTotal || 0;
  const partsDiff = parts2 - parts1;

  const total1 = v1.totals.totalAmount || 0;
  const total2 = v2.totals.totalAmount || 0;
  const totalDiff = total2 - total1;

  const percentageChange =
    total1 > 0 ? Math.round(((total2 - total1) / total1) * 1000) / 10 : 0;

  return {
    v1,
    v2,
    item_diffs: itemDiffs,
    labour_v1: labour1,
    labour_v2: labour2,
    labour_difference: labourDiff,
    parts_v1: parts1,
    parts_v2: parts2,
    parts_difference: partsDiff,
    total_v1: total1,
    total_v2: total2,
    total_difference: totalDiff,
    percentage_change: percentageChange,
    farmer_revision_request: v1.revision_request || null,
    technician_explanation: v2.technician_explanation || null,
  };
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

  // Prevent duplicate active quotes for the same repair
  const { data: existingPendingQuote } = await supabase
    .from("quotes")
    .select("id")
    .eq("repair_request_id", repair.id)
    .eq("status", "PENDING")
    .maybeSingle();

  if (existingPendingQuote) {
    throw new Error("A pending quote already exists for this repair request. Wait for the farmer to respond or request changes.");
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
      notification_text: `Quote ready for repair ${repair.job_number}. Review and approve the proposed repair.`,
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

  // 6. Update repair request status to 'QUOTE_PENDING'
  // CRITICAL INVARIANT: The farmer's original clarification_note is preserved intact.
  // We DO NOT overwrite clarification_note with technician explanation.
  // The technician's response/explanation is stored separately in the repair_timeline audit event below.
  await supabase
    .from("repair_requests")
    .update({
      status: "QUOTE_PENDING",
      status_since: now,
    })
    .eq("id", repair.id);

  // 7. Record timeline audit entry
  const totals = calculateQuoteTotals(insertedItems, input.labour_amount, input.tax_percent);
  const techNoteSummary = input.technician_explanation?.trim()
    ? ` Note: "${input.technician_explanation.trim()}"`
    : "";
  const { error: timelineError } = await supabase
    .from("repair_timeline")
    .insert({
      repair_request_id: repair.id,
      status: "QUOTE_PENDING",
      note: `Revised quote sent (v${newVersion}: ₹${totals.totalAmount.toLocaleString("en-IN")}).${techNoteSummary}`,
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
      notification_text: `Revised quote ready for repair ${repair.job_number} (v${newVersion}). Review and approve the proposed repair.`,
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
    .select("*, quote_items(*), repair_request:repair_request_id(id, job_number, farmer_id, status)")
    .eq("id", quoteId)
    .maybeSingle();

  if (quoteError || !quote) {
    throw new Error("Quote not found or inaccessible.");
  }

  const repair = quote.repair_request as unknown as { id: string; job_number: string; farmer_id: string; status: RepairStatus };
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

  if (repair.status !== "QUOTE_PENDING") {
    throw new Error(`Cannot approve quote: Repair ticket is in '${repair.status}' status (must be QUOTE_PENDING).`);
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
      notification_text: `Farmer approved quote for repair ${repair.job_number}. Proceed with repair work.`,
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

export interface RejectQuoteInput {
  reason: string;
  explanation?: string | undefined;
  photo?: string | undefined;
}

export interface ParsedClarification {
  reason?: string | undefined;
  explanation?: string | undefined;
  photo?: string | undefined;
}

/**
 * Parses structured clarification note into reason, explanation, and photo.
 * Gracefully handles legacy strings or freeform text.
 */
export function parseClarificationNote(note?: string | null): ParsedClarification {
  if (!note) return {};
  const trimmed = note.trim();

  // Predefined reasons without required extra explanation
  const predefined = [
    "Too expensive",
    "Want local (non-OEM) parts",
    "Need earlier completion",
    "Please explain labour",
  ];
  if (predefined.includes(trimmed)) {
    return { reason: trimmed };
  }

  // Pattern: "Reason: ...\nExplanation: ...\nPhoto: ..."
  const match = trimmed.match(
    /^Reason:\s*([^\n]+)(?:\n+(?:Explanation|Farmer message|Message):\s*([\s\S]*?))?(?:\n+Photo:\s*(\S+))?$/i
  );
  if (match) {
    return {
      reason: match[1]?.trim() || undefined,
      explanation: match[2]?.trim() || undefined,
      photo: match[3]?.trim() || undefined,
    };
  }

  // Pattern: "[Reason] Explanation"
  const bracketMatch = trimmed.match(/^\[(.*?)\]\s*([\s\S]+)$/);
  if (bracketMatch && bracketMatch[1] && bracketMatch[2]) {
    return { reason: bracketMatch[1].trim(), explanation: bracketMatch[2].trim() };
  }

  // Pattern: "Reason: Explanation" or "Reason - Explanation"
  const colonMatch = trimmed.match(/^([^-–—:\n]+)\s*[-–—:]\s*([\s\S]+)$/);
  if (colonMatch && colonMatch[1] && colonMatch[2]) {
    return { reason: colonMatch[1].trim(), explanation: colonMatch[2].trim() };
  }

  return { explanation: trimmed };
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
export async function rejectQuote(
  quoteId: string,
  reasonOrInput?: string | RejectQuoteInput
): Promise<QuoteDetail> {
  if (!quoteId) throw new Error("Quote ID is required.");

  const profile = await getAuthenticatedProfile();

  // 1. Fetch quote with repair request
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("*, quote_items(*), repair_request:repair_request_id(id, job_number, farmer_id, status)")
    .eq("id", quoteId)
    .maybeSingle();

  if (quoteError || !quote) {
    throw new Error("Quote not found or inaccessible.");
  }

  const repair = quote.repair_request as unknown as { id: string; job_number: string; farmer_id: string; status: RepairStatus };
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

  if (repair.status !== "QUOTE_PENDING") {
    throw new Error(`Cannot reject quote: Repair ticket is in '${repair.status}' status (must be QUOTE_PENDING).`);
  }

  let selectedReason = "";
  let explanation = "";
  let photo: string | undefined = undefined;

  if (typeof reasonOrInput === "object" && reasonOrInput !== null) {
    selectedReason = reasonOrInput.reason?.trim() || "";
    explanation = reasonOrInput.explanation?.trim() || "";
    photo = reasonOrInput.photo?.trim();
  } else if (typeof reasonOrInput === "string") {
    const trimmed = reasonOrInput.trim();
    const parsed = parseClarificationNote(trimmed);
    selectedReason = parsed.reason || "";
    explanation = parsed.explanation || (parsed.reason ? "" : trimmed);
  }

  // Format clarification note to persist in repair_requests.clarification_note
  let clarificationToSave: string;
  if (selectedReason && explanation) {
    clarificationToSave = `Reason: ${selectedReason}\nExplanation: ${explanation}${photo ? `\nPhoto: ${photo}` : ""}`;
  } else if (selectedReason) {
    clarificationToSave = photo ? `Reason: ${selectedReason}\nPhoto: ${photo}` : selectedReason;
  } else if (explanation) {
    clarificationToSave = explanation;
  } else {
    clarificationToSave = "Quote declined by farmer";
  }

  const notifSummary = (selectedReason && explanation)
    ? `${selectedReason}: "${explanation.length > 60 ? explanation.slice(0, 57) + "..." : explanation}"`
    : (selectedReason || explanation || "Quote declined by farmer");

  const newStatus: QuoteStatus = (selectedReason || explanation) ? "REVISED" : "REJECTED";
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
      clarification_note: clarificationToSave,
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
      note: `Quote revision requested: "${notifSummary}"`,
      created_by_role: profile.role,
      created_by_id: profile.id,
    });

  if (timelineError) {
    console.warn(`[TerraByte] Warning: Failed to record quote rejection timeline entry: ${timelineError.message}`);
  }

  // Notify technician and admin
  try {
    if (selectedReason || explanation) {
      await createNotification({
        recipient_role: "technician",
        recipient_user_id: quote.technician_id,
        notification_text: `Farmer requested changes to quote for repair ${repair.job_number}: ${notifSummary.endsWith(".") ? notifSummary : `${notifSummary}.`}`,
        link_target: `/technician/job/${repair.id}`,
      });
    } else {
      await createNotification({
        recipient_role: "technician",
        recipient_user_id: quote.technician_id,
        notification_text: `Quote rejected by farmer for repair ${repair.job_number}.`,
        link_target: `/technician/job/${repair.id}`,
      });
      await createNotification({
        recipient_role: "admin",
        notification_text: `Quote rejected by farmer for repair ${repair.job_number}.`,
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
