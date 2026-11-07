import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export function isUuid(value?: string | null): boolean {
  if (!value || typeof value !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

export type QuoteStatus = "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "REVISED";
export type RepairStatus =
  | "REQUESTED"
  | "ASSIGNED"
  | "ACCEPTED"
  | "DECLINED"
  | "DIAGNOSED"
  | "QUOTE_PENDING"
  | "QUOTE_REVISED"
  | "WAITING_FOR_PARTS"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED";

export interface QuoteTotals {
  partsTotal: number;
  labourAmount: number;
  taxAmount: number;
  totalAmount: number;
}

export interface QuoteItemRow {
  id: string;
  quote_id: string;
  part_name: string;
  part_spec?: string | null;
  quantity: number;
  unit_price: number;
  part_source?: string | null;
  catalog_part_id?: string | null;
  created_at: string;
}

export interface QuoteDetail {
  id: string;
  repair_request_id: string;
  technician_id: string;
  version: number;
  status: QuoteStatus;
  labour_description: string;
  labour_amount: number;
  tax_percent: number;
  estimated_completion: string;
  warranty_terms?: string | null;
  sent_at?: string | null;
  created_at: string;
  updated_at: string;
  quote_items: QuoteItemRow[];
  totals: QuoteTotals;
}

export function calculateQuoteTotals(
  items: Array<{ quantity: number; unit_price: number }>,
  labourAmount: number,
  taxPercent: number,
): QuoteTotals {
  const partsTotal = (items || []).reduce(
    (sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0),
    0,
  );
  const labour = Number(labourAmount || 0);
  const tax = ((partsTotal + labour) * Number(taxPercent || 0)) / 100;
  return {
    partsTotal,
    labourAmount: labour,
    taxAmount: tax,
    totalAmount: partsTotal + labour + tax,
  };
}

export interface ParsedClarification {
  reason?: string | undefined;
  explanation?: string | undefined;
  photo?: string | undefined;
}

export function parseClarificationNote(note?: string | null): ParsedClarification {
  if (!note) return {};
  const trimmed = note.trim();

  const predefined = [
    "Too expensive",
    "Want local (non-OEM) parts",
    "Need earlier completion",
    "Please explain labour",
  ];
  if (predefined.includes(trimmed)) {
    return { reason: trimmed };
  }

  const match = trimmed.match(
    /^Reason:\s*([^\n]+)(?:\n+(?:Explanation|Farmer message|Message):\s*([\s\S]*?))?(?:\n+Photo:\s*(\S+))?$/i,
  );
  if (match) {
    return {
      reason: match[1]?.trim() || undefined,
      explanation: match[2]?.trim() || undefined,
      photo: match[3]?.trim() || undefined,
    };
  }

  const bracketMatch = trimmed.match(/^\[(.*?)\]\s*([\s\S]+)$/);
  if (bracketMatch && bracketMatch[1] && bracketMatch[2]) {
    return { reason: bracketMatch[1].trim(), explanation: bracketMatch[2].trim() };
  }

  const colonMatch = trimmed.match(/^([^-–—:\n]+)\s*[-–—:]\s*([\s\S]+)$/);
  if (colonMatch && colonMatch[1] && colonMatch[2]) {
    return { reason: colonMatch[1].trim(), explanation: colonMatch[2].trim() };
  }

  return { explanation: trimmed };
}

const CANONICAL_SUPABASE_URL = "https://ubqgvhcfmrvnmrbllcom.supabase.co";
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

export interface QuoteDecisionInput {
  quoteId: string;
  action: "approve" | "reject";
  reason?: string;
  explanation?: string;
  photo?: string;
}

/**
 * Handles incoming POST /api/quote-decision requests.
 *
 * Verifies caller JWT and profile ownership, checks that the target quotation is the latest
 * pending revision, enforces state machine rules, and updates quote and repair statuses
 * with full timeline logging and technician notification.
 */
export async function handleQuoteDecisionRequest(
  request: Request,
  options?: {
    adminClient?: SupabaseClient;
    userClient?: SupabaseClient;
  },
): Promise<Response> {
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
  const userClient =
    options?.userClient ||
    createClient<Database>(supabaseUrl, supabaseKey, {
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

  // 2. Identify caller profile and role via get_session_profile RPC
  const { data: sessionData } = await userClient.rpc("get_session_profile");
  let profile = sessionData && sessionData.length > 0 ? sessionData[0] : null;

  if (!profile) {
    const { data: secretRow } = await userClient
      .from("profile_auth_secrets")
      .select("profile_id")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    const targetProfileId = secretRow?.profile_id || user.id;

    const { data: fallbackRow } = await userClient
      .from("profiles")
      .select("id, role")
      .eq("id", targetProfileId)
      .maybeSingle();

    if (fallbackRow) {
      profile = fallbackRow as unknown as typeof profile;
    }
  }

  if (!profile) {
    return new Response(
      JSON.stringify({ error: "Could not find profile for authenticated user." }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // 3. Parse and validate request body
  let body: QuoteDecisionInput;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON request body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { quoteId, action, reason, explanation, photo } = body;

  if (!quoteId || typeof quoteId !== "string" || !isUuid(quoteId.trim())) {
    return new Response(
      JSON.stringify({ error: "A valid quotation UUID (quoteId) is required." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (action !== "approve" && action !== "reject") {
    return new Response(
      JSON.stringify({ error: "Invalid action. Supported actions are 'approve' and 'reject'." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const cleanQuoteId = quoteId.trim();

  // 4. Fetch quotation details and associated repair request
  const { data: quote, error: quoteError } = await userClient
    .from("quotes")
    .select(
      "*, quote_items(*), repair_request:repair_request_id(id, job_number, farmer_id, technician_id, status, clarification_note)",
    )
    .eq("id", cleanQuoteId)
    .maybeSingle();

  if (quoteError || !quote) {
    return new Response(JSON.stringify({ error: "Quotation not found or inaccessible." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const repair = quote.repair_request as unknown as {
    id: string;
    job_number: string;
    farmer_id: string;
    technician_id: string | null;
    status: RepairStatus;
    clarification_note: string | null;
  } | null;

  if (!repair) {
    return new Response(JSON.stringify({ error: "Associated repair request record not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 5. Authorization: Only the machine owner (farmer) or admin can approve / reject quotes
  const isOwner = repair.farmer_id === profile.id;
  const isAdmin = profile.role === "admin";

  if (!isOwner && !isAdmin) {
    return new Response(
      JSON.stringify({
        error: "Unauthorized: Only the machinery owner (farmer) can authorize or decline quotes.",
      }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // 6. Validate quote pending status
  if (quote.status !== "PENDING") {
    return new Response(
      JSON.stringify({
        error: `Cannot ${action} quote: This quotation is already '${quote.status}' and cannot be processed again. Please refresh.`,
      }),
      {
        status: 409,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // 7. Version Invariant: Check if a newer version exists for this repair request
  const { data: newerQuotes } = await userClient
    .from("quotes")
    .select("id, version")
    .eq("repair_request_id", repair.id)
    .gt("version", quote.version);

  const latestNewerQuote = newerQuotes?.[0];
  if (latestNewerQuote) {
    return new Response(
      JSON.stringify({
        error: `Cannot ${action} quote: A newer quotation version (v${latestNewerQuote.version}) exists. Older quote versions cannot be processed. Please review the latest quote.`,
      }),
      {
        status: 409,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // 8. Validate repair request status eligibility
  const validStatuses: RepairStatus[] = ["QUOTE_PENDING", "WAITING_FOR_PARTS", "IN_PROGRESS"];
  if (!validStatuses.includes(repair.status)) {
    return new Response(
      JSON.stringify({
        error: `Cannot ${action} quote: Associated repair ticket is in '${repair.status}' status (must be QUOTE_PENDING, WAITING_FOR_PARTS, or IN_PROGRESS).`,
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // 9. Prepare mutation data
  const now = new Date().toISOString();
  let dbClient = options?.adminClient;

  if (!dbClient) {
    try {
      const serverModule = await import("@/integrations/supabase/client.server");
      dbClient = serverModule.supabaseAdmin;
    } catch {
      // If client.server is unavailable, fall back to caller-authenticated client
      dbClient = userClient;
    }
  }

  if (action === "approve") {
    // A. Update quote status to APPROVED
    const { data: updatedQuoteRow, error: quoteUpdateErr } = await dbClient
      .from("quotes")
      .update({ status: "APPROVED", updated_at: now })
      .eq("id", quote.id)
      .eq("status", "PENDING")
      .select("*, quote_items(*)")
      .maybeSingle();

    if (quoteUpdateErr) {
      return new Response(
        JSON.stringify({ error: `Failed to approve quote: ${quoteUpdateErr.message}` }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    if (!updatedQuoteRow && dbClient !== userClient) {
      return new Response(
        JSON.stringify({
          error: "This quote is no longer pending or was already processed. Please refresh.",
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    }

    // B. Advance repair request status to IN_PROGRESS unless WAITING_FOR_PARTS
    if (repair.status !== "WAITING_FOR_PARTS") {
      const { error: repairUpdateErr } = await dbClient
        .from("repair_requests")
        .update({
          status: "IN_PROGRESS",
          status_since: now,
        })
        .eq("id", repair.id);

      if (repairUpdateErr) {
        console.warn(
          `[TerraByte Quote Decision API] Warning: Failed to advance repair status: ${repairUpdateErr.message}`,
        );
      }
    }

    // C. Record timeline entry
    const timelineStatus =
      repair.status === "WAITING_FOR_PARTS" ? "WAITING_FOR_PARTS" : "IN_PROGRESS";
    const timelineNote =
      repair.status === "WAITING_FOR_PARTS"
        ? `Quote revision v${quote.version} approved by farmer while waiting for parts.`
        : `Quote approved & repair authorized (v${quote.version})`;

    await dbClient.from("repair_timeline").insert({
      repair_request_id: repair.id,
      status: timelineStatus,
      note: timelineNote,
      created_by_role: profile.role,
      created_by_id: profile.id,
    });

    // D. Notify technician
    if (quote.technician_id) {
      try {
        await dbClient.from("notifications").insert({
          recipient_user_id: quote.technician_id,
          recipient_role: "technician",
          title: "Quote Approved",
          message: `Quote v${quote.version} for repair ${repair.job_number} was approved. You may proceed with repairs.`,
          link_url: `/technician/job/${repair.id}`,
        });
      } catch (notifErr) {
        console.warn("[TerraByte] Warning: Failed to insert notification:", notifErr);
      }
    }

    const items = (updatedQuoteRow?.quote_items as QuoteItemRow[]) || quote.quote_items || [];
    const totals = calculateQuoteTotals(
      items,
      Number(updatedQuoteRow?.labour_amount ?? quote.labour_amount),
      Number(updatedQuoteRow?.tax_percent ?? quote.tax_percent),
    );

    const resultQuote: QuoteDetail = {
      ...(updatedQuoteRow || quote),
      status: "APPROVED",
      quote_items: items,
      totals,
    };

    return new Response(JSON.stringify({ success: true, quote: resultQuote }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } else {
    // REJECT / REVISE ACTION
    const selectedReason = reason?.trim() || "";
    const cleanExplanation = explanation?.trim() || "";
    const cleanPhoto = photo?.trim();

    let clarificationToSave: string;
    if (selectedReason && cleanExplanation) {
      clarificationToSave = `Reason: ${selectedReason}\nExplanation: ${cleanExplanation}${cleanPhoto ? `\nPhoto: ${cleanPhoto}` : ""}`;
    } else if (selectedReason) {
      clarificationToSave = cleanPhoto
        ? `Reason: ${selectedReason}\nPhoto: ${cleanPhoto}`
        : selectedReason;
    } else if (cleanExplanation) {
      clarificationToSave = cleanExplanation;
    } else {
      clarificationToSave = "Quote declined by farmer";
    }

    const newStatus: QuoteStatus = selectedReason || cleanExplanation ? "REVISED" : "REJECTED";

    // A. Update quote status to REVISED or REJECTED
    const { data: updatedQuoteRow, error: quoteUpdateErr } = await dbClient
      .from("quotes")
      .update({ status: newStatus, updated_at: now })
      .eq("id", quote.id)
      .eq("status", "PENDING")
      .select("*, quote_items(*)")
      .maybeSingle();

    if (quoteUpdateErr) {
      return new Response(
        JSON.stringify({ error: `Failed to reject quote: ${quoteUpdateErr.message}` }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    if (!updatedQuoteRow && dbClient !== userClient) {
      return new Response(
        JSON.stringify({
          error: "This quote is no longer pending or was already processed. Please refresh.",
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    }

    // B. Update repair request status and save clarification note
    const nextRepairStatus: RepairStatus =
      repair.status === "WAITING_FOR_PARTS" ? "WAITING_FOR_PARTS" : "QUOTE_REVISED";

    await dbClient
      .from("repair_requests")
      .update({
        status: nextRepairStatus,
        clarification_note: clarificationToSave,
        status_since: now,
      })
      .eq("id", repair.id);

    // C. Record timeline entry
    const notifSummary =
      selectedReason && cleanExplanation
        ? `${selectedReason}: "${cleanExplanation.length > 60 ? cleanExplanation.slice(0, 57) + "..." : cleanExplanation}"`
        : selectedReason || cleanExplanation || "Quote declined by farmer";

    await dbClient.from("repair_timeline").insert({
      repair_request_id: repair.id,
      status: "QUOTE_REVISED",
      note: `Quote revision requested: "${notifSummary}"`,
      created_by_role: profile.role,
      created_by_id: profile.id,
    });

    // D. Notify technician
    if (quote.technician_id) {
      try {
        await dbClient.from("notifications").insert({
          recipient_user_id: quote.technician_id,
          recipient_role: "technician",
          title: "Quote Revision Requested",
          message: `Farmer requested changes on quote v${quote.version} (${notifSummary}). Please review and send an updated quotation.`,
          link_url: `/technician/job/${repair.id}`,
        });
      } catch (notifErr) {
        console.warn("[TerraByte] Warning: Failed to insert notification:", notifErr);
      }
    }

    const items = (updatedQuoteRow?.quote_items as QuoteItemRow[]) || quote.quote_items || [];
    const totals = calculateQuoteTotals(
      items,
      Number(updatedQuoteRow?.labour_amount ?? quote.labour_amount),
      Number(updatedQuoteRow?.tax_percent ?? quote.tax_percent),
    );

    const resultQuote: QuoteDetail = {
      ...(updatedQuoteRow || quote),
      status: newStatus,
      quote_items: items,
      totals,
    };

    return new Response(JSON.stringify({ success: true, quote: resultQuote }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
}
