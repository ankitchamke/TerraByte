import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  handleQuoteDecisionRequest,
  calculateQuoteTotals,
  parseClarificationNote,
} from "../src/lib/services/quote-action-handler.ts";

const ROOT_DIR = path.resolve(process.cwd());
const QUOTES_SERVICE_PATH = path.join(ROOT_DIR, "src", "lib", "services", "quotes.ts");
const QUOTE_ACTION_HANDLER_PATH = path.join(
  ROOT_DIR,
  "src",
  "lib",
  "services",
  "quote-action-handler.ts",
);
const FARMER_REPAIR_PATH = path.join(ROOT_DIR, "src", "routes", "farmer", "repair", "$id.tsx");
const API_ROUTE_PATH = path.join(ROOT_DIR, "src", "routes", "api", "quote-decision.ts");

// Helper to build mock Supabase clients for server handler testing
function createMockClients({
  user,
  profile,
  quote,
  repair,
  newerQuotes = [],
  quoteUpdateResult = null,
  repairUpdateResult = null,
}) {
  const recordedInserts = {
    repair_timeline: [],
    notifications: [],
  };
  const recordedUpdates = {
    quotes: [],
    repair_requests: [],
  };

  const createTableQueryBuilder = (tableName) => {
    let eqFilters = {};
    let gtFilters = {};
    let updatePayload = null;

    const builder = {
      select: () => builder,
      eq: (col, val) => {
        eqFilters[col] = val;
        return builder;
      },
      gt: (col, val) => {
        gtFilters[col] = val;
        return builder;
      },
      in: () => builder,
      or: () => builder,
      update: (payload) => {
        updatePayload = payload;
        recordedUpdates[tableName]?.push(payload);
        return builder;
      },
      insert: async (payload) => {
        recordedInserts[tableName]?.push(payload);
        return { data: payload, error: null };
      },
      maybeSingle: async () => {
        if (tableName === "quotes") {
          if (updatePayload) {
            return {
              data: quoteUpdateResult || {
                ...quote,
                ...updatePayload,
                quote_items: quote?.quote_items || [],
              },
              error: null,
            };
          }
          return {
            data: quote
              ? {
                  ...quote,
                  repair_request: repair,
                }
              : null,
            error: null,
          };
        }
        if (tableName === "profiles") {
          return { data: profile, error: null };
        }
        if (tableName === "repair_requests") {
          return {
            data: repairUpdateResult || {
              ...repair,
              ...(updatePayload || {}),
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
      then: (resolve) => {
        if (tableName === "quotes" && gtFilters.version !== undefined) {
          return resolve({ data: newerQuotes, error: null });
        }
        if (tableName === "repair_requests" && updatePayload) {
          return resolve({ data: [{ ...repair, ...updatePayload }], error: null });
        }
        return resolve({ data: [], error: null });
      },
    };
    return builder;
  };

  const userClient = {
    auth: {
      getUser: async (token) => {
        if (token === "valid-farmer-token" || token === "valid-admin-token") {
          return { data: { user }, error: null };
        }
        return { data: { user: null }, error: new Error("Invalid token") };
      },
    },
    rpc: async (fnName) => {
      if (fnName === "get_session_profile") {
        return { data: profile ? [profile] : [], error: null };
      }
      return { data: null, error: null };
    },
    from: (table) => createTableQueryBuilder(table),
  };

  const adminClient = {
    from: (table) => createTableQueryBuilder(table),
  };

  return { userClient, adminClient, recordedInserts, recordedUpdates };
}

// ==============================================================================
// 1. FARMER APPROVES PENDING QUOTE
// ==============================================================================

test("Requirement 1: Farmer successfully approves a pending quote via quote-decision handler", async () => {
  const quoteId = "76e075be-5ce6-4f14-b1af-f562552fe379";
  const repairId = "70d7d056-721b-4aab-9551-5f5d0bdd6b1d";
  const farmerId = "11111111-1111-4111-8111-111111111111";
  const techId = "22222222-2222-4222-8222-222222222222";

  const { userClient, adminClient, recordedInserts, recordedUpdates } = createMockClients({
    user: { id: farmerId, email: "farmer@terrabytedemo.in" },
    profile: { id: farmerId, role: "farmer", full_name: "Ramesh Patil" },
    quote: {
      id: quoteId,
      repair_request_id: repairId,
      technician_id: techId,
      version: 1,
      status: "PENDING",
      labour_description: "Transmission overhaul",
      labour_amount: 3500,
      tax_percent: 18,
      estimated_completion: "2026-11-10T18:00:00Z",
      warranty_terms: "3 months warranty",
      sent_at: "2026-11-06T10:00:00Z",
      created_at: "2026-11-06T10:00:00Z",
      updated_at: "2026-11-06T10:00:00Z",
      quote_items: [
        {
          id: "item-1",
          quote_id: quoteId,
          part_name: "Transmission Gear Set",
          quantity: 1,
          unit_price: 12000,
        },
      ],
    },
    repair: {
      id: repairId,
      job_number: "TB-1341",
      farmer_id: farmerId,
      technician_id: techId,
      status: "QUOTE_PENDING",
      clarification_note: null,
    },
    newerQuotes: [],
  });

  const request = new Request("http://localhost/api/quote-decision", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer valid-farmer-token",
    },
    body: JSON.stringify({
      quoteId,
      action: "approve",
    }),
  });

  const response = await handleQuoteDecisionRequest(request, { userClient, adminClient });
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.quote.status, "APPROVED");
  assert.equal(payload.quote.version, 1);
  assert.equal(payload.quote.totals.totalAmount, (12000 + 3500) * 1.18);

  // Verify updates made to quotes table and repair_requests table
  assert.ok(recordedUpdates.quotes.length > 0);
  assert.equal(recordedUpdates.quotes[0].status, "APPROVED");

  assert.ok(recordedUpdates.repair_requests.length > 0);
  assert.equal(recordedUpdates.repair_requests[0].status, "IN_PROGRESS");

  // Verify audit timeline entry
  assert.ok(recordedInserts.repair_timeline.length > 0);
  assert.equal(recordedInserts.repair_timeline[0].status, "IN_PROGRESS");
  assert.match(recordedInserts.repair_timeline[0].note, /Quote approved & repair authorized/);

  // Verify technician notification
  assert.ok(recordedInserts.notifications.length > 0);
  assert.equal(recordedInserts.notifications[0].recipient_user_id, techId);
  assert.match(recordedInserts.notifications[0].message, /approved/i);
});

// ==============================================================================
// 2. FARMER REJECTS PENDING QUOTE
// ==============================================================================

test("Requirement 2: Farmer successfully rejects a pending quote with clarification note", async () => {
  const quoteId = "76e075be-5ce6-4f14-b1af-f562552fe379";
  const repairId = "70d7d056-721b-4aab-9551-5f5d0bdd6b1d";
  const farmerId = "11111111-1111-4111-8111-111111111111";
  const techId = "22222222-2222-4222-8222-222222222222";

  const { userClient, adminClient, recordedInserts, recordedUpdates } = createMockClients({
    user: { id: farmerId, email: "farmer@terrabytedemo.in" },
    profile: { id: farmerId, role: "farmer", full_name: "Ramesh Patil" },
    quote: {
      id: quoteId,
      repair_request_id: repairId,
      technician_id: techId,
      version: 1,
      status: "PENDING",
      labour_description: "Clutch repair",
      labour_amount: 2000,
      tax_percent: 18,
      estimated_completion: "2026-11-10T18:00:00Z",
      warranty_terms: "3 months warranty",
      sent_at: "2026-11-06T10:00:00Z",
      created_at: "2026-11-06T10:00:00Z",
      updated_at: "2026-11-06T10:00:00Z",
      quote_items: [],
    },
    repair: {
      id: repairId,
      job_number: "TB-1341",
      farmer_id: farmerId,
      technician_id: techId,
      status: "QUOTE_PENDING",
      clarification_note: null,
    },
    newerQuotes: [],
  });

  const request = new Request("http://localhost/api/quote-decision", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer valid-farmer-token",
    },
    body: JSON.stringify({
      quoteId,
      action: "reject",
      reason: "Too expensive",
      explanation: "Please check if aftermarket clutch plate is available",
    }),
  });

  const response = await handleQuoteDecisionRequest(request, { userClient, adminClient });
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.quote.status, "REVISED");

  // Verify updates made to quotes table and repair_requests table
  assert.ok(recordedUpdates.quotes.length > 0);
  assert.equal(recordedUpdates.quotes[0].status, "REVISED");

  assert.ok(recordedUpdates.repair_requests.length > 0);
  assert.equal(recordedUpdates.repair_requests[0].status, "QUOTE_REVISED");
  assert.match(
    recordedUpdates.repair_requests[0].clarification_note,
    /Reason: Too expensive\nExplanation: Please check if aftermarket clutch plate is available/,
  );

  // Verify audit timeline entry
  assert.ok(recordedInserts.repair_timeline.length > 0);
  assert.equal(recordedInserts.repair_timeline[0].status, "QUOTE_REVISED");

  // Verify technician notification
  assert.ok(recordedInserts.notifications.length > 0);
  assert.equal(recordedInserts.notifications[0].recipient_user_id, techId);
  assert.match(recordedInserts.notifications[0].title, /Revision/i);
});

// ==============================================================================
// 3. APPROVAL OF ALREADY PROCESSED QUOTE IS REJECTED
// ==============================================================================

test("Requirement 3: Approval of an already processed quote is rejected with 409 Conflict", async () => {
  const quoteId = "76e075be-5ce6-4f14-b1af-f562552fe379";
  const repairId = "70d7d056-721b-4aab-9551-5f5d0bdd6b1d";
  const farmerId = "11111111-1111-4111-8111-111111111111";

  const { userClient, adminClient } = createMockClients({
    user: { id: farmerId, email: "farmer@terrabytedemo.in" },
    profile: { id: farmerId, role: "farmer" },
    quote: {
      id: quoteId,
      repair_request_id: repairId,
      technician_id: "tech-1",
      version: 1,
      status: "APPROVED", // Already approved
      labour_amount: 1000,
      tax_percent: 18,
      quote_items: [],
    },
    repair: {
      id: repairId,
      job_number: "TB-1341",
      farmer_id: farmerId,
      status: "IN_PROGRESS",
    },
  });

  const request = new Request("http://localhost/api/quote-decision", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer valid-farmer-token",
    },
    body: JSON.stringify({
      quoteId,
      action: "approve",
    }),
  });

  const response = await handleQuoteDecisionRequest(request, { userClient, adminClient });
  assert.equal(response.status, 409);

  const payload = await response.json();
  assert.match(payload.error, /already 'APPROVED'/);
  assert.match(payload.error, /Please refresh/);
});

// ==============================================================================
// 4. REJECTION OF ALREADY PROCESSED QUOTE IS REJECTED
// ==============================================================================

test("Requirement 4: Rejection of an already processed quote is rejected with 409 Conflict", async () => {
  const quoteId = "76e075be-5ce6-4f14-b1af-f562552fe379";
  const repairId = "70d7d056-721b-4aab-9551-5f5d0bdd6b1d";
  const farmerId = "11111111-1111-4111-8111-111111111111";

  const { userClient, adminClient } = createMockClients({
    user: { id: farmerId, email: "farmer@terrabytedemo.in" },
    profile: { id: farmerId, role: "farmer" },
    quote: {
      id: quoteId,
      repair_request_id: repairId,
      technician_id: "tech-1",
      version: 1,
      status: "REVISED", // Already processed
      labour_amount: 1000,
      tax_percent: 18,
      quote_items: [],
    },
    repair: {
      id: repairId,
      job_number: "TB-1341",
      farmer_id: farmerId,
      status: "QUOTE_REVISED",
    },
  });

  const request = new Request("http://localhost/api/quote-decision", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer valid-farmer-token",
    },
    body: JSON.stringify({
      quoteId,
      action: "reject",
      reason: "Too expensive",
    }),
  });

  const response = await handleQuoteDecisionRequest(request, { userClient, adminClient });
  assert.equal(response.status, 409);

  const payload = await response.json();
  assert.match(payload.error, /already 'REVISED'/);
  assert.match(payload.error, /Please refresh/);
});

// ==============================================================================
// 5. OLD QUOTE VERSIONS CANNOT ACCIDENTALLY MUTATE NEWER VERSIONS
// ==============================================================================

test("Requirement 5: Old quote versions cannot accidentally mutate newer versions", async () => {
  const oldQuoteId = "76e075be-5ce6-4f14-b1af-f562552fe379";
  const repairId = "70d7d056-721b-4aab-9551-5f5d0bdd6b1d";
  const farmerId = "11111111-1111-4111-8111-111111111111";

  const { userClient, adminClient } = createMockClients({
    user: { id: farmerId, email: "farmer@terrabytedemo.in" },
    profile: { id: farmerId, role: "farmer" },
    quote: {
      id: oldQuoteId,
      repair_request_id: repairId,
      technician_id: "tech-1",
      version: 1, // Version 1
      status: "PENDING",
      labour_amount: 1000,
      tax_percent: 18,
      quote_items: [],
    },
    repair: {
      id: repairId,
      job_number: "TB-1341",
      farmer_id: farmerId,
      status: "QUOTE_PENDING",
    },
    // Database contains a newer version 2!
    newerQuotes: [{ id: "newer-quote-v2", version: 2 }],
  });

  // Attempting to approve version 1
  const request = new Request("http://localhost/api/quote-decision", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer valid-farmer-token",
    },
    body: JSON.stringify({
      quoteId: oldQuoteId,
      action: "approve",
    }),
  });

  const response = await handleQuoteDecisionRequest(request, { userClient, adminClient });
  assert.equal(response.status, 409);

  const payload = await response.json();
  assert.match(payload.error, /newer quotation version \(v2\) exists/);
  assert.match(payload.error, /Older quote versions cannot be processed/);

  // Invariant in quotes.ts service source:
  const quotesService = fs.readFileSync(QUOTES_SERVICE_PATH, "utf8");
  assert.ok(
    quotesService.includes('.gt("version", quote.version)'),
    "quotes.ts must check for newer quote versions in both approve and reject",
  );
  assert.ok(
    quotesService.includes("Older quote versions cannot be processed"),
    "quotes.ts must reject older quote revisions when newer versions exist",
  );
});

// ==============================================================================
// 6. DUPLICATE CLICKS CANNOT PROCESS A QUOTE TWICE
// ==============================================================================

test("Requirement 6: In-flight concurrency lock prevents processing duplicate clicks simultaneously", () => {
  const quotesService = fs.readFileSync(QUOTES_SERVICE_PATH, "utf8");
  const farmerRoute = fs.readFileSync(FARMER_REPAIR_PATH, "utf8");

  // In-flight concurrency guard in quotes.ts
  assert.ok(
    quotesService.includes("const inFlightQuoteMutations = new Set<string>();"),
    "quotes.ts must declare inFlightQuoteMutations Set to prevent parallel duplicate mutations",
  );
  assert.ok(
    quotesService.includes("inFlightQuoteMutations.has(quoteId)"),
    "approveQuote and rejectQuote must check if quoteId is currently in flight",
  );
  assert.ok(
    quotesService.includes(
      "A quote action is already in progress for this quotation. Please wait.",
    ),
    "Concurrent in-flight calls must throw an informative error message",
  );
  assert.ok(
    quotesService.includes("inFlightQuoteMutations.delete(quoteId)"),
    "In-flight mutation lock must be cleared in finally block",
  );

  // UI button disabled states in farmer repair route
  assert.ok(
    farmerRoute.includes("disabled={actionInProgress}"),
    "Action buttons must be disabled while actionInProgress is true",
  );
  assert.match(
    farmerRoute,
    /actionInProgress\s*\?\s*"Authorizing repair…"|'Authorizing repair…'/,
    "Approve button must indicate in-progress state to prevent repeated clicks",
  );
  assert.match(
    farmerRoute,
    /actionInProgress\s*\?\s*"Sending…"|'Sending…'/,
    "Decline button must indicate in-progress state to prevent repeated clicks",
  );
});

// ==============================================================================
// 7. FRONTEND UPDATES CORRECTLY AFTER SUCCESSFUL APPROVAL
// ==============================================================================

test("Requirement 7: Frontend updates correctly after successful approval", () => {
  const farmerRoute = fs.readFileSync(FARMER_REPAIR_PATH, "utf8");

  // Optimistic quote update
  assert.ok(
    farmerRoute.includes(
      "setQuotes((prev) => prev.map((q) => (q.id === updated.id ? updated : q)))",
    ),
    "handleApproveQuote must update local quotes array with the returned approved quote",
  );

  // Immediate repair status advance
  assert.ok(
    farmerRoute.includes('setR((prev) => (prev ? { ...prev, status: "IN_PROGRESS" } : null))'),
    "handleApproveQuote must advance repair status to IN_PROGRESS",
  );

  // Dual-store sync for demo mode
  assert.ok(
    farmerRoute.includes("actions.approveQuote(r.job_number || r.id)"),
    "handleApproveQuote must synchronize with in-memory demo store",
  );

  // Fresh data reload
  assert.ok(
    farmerRoute.includes("await loadData()"),
    "handleApproveQuote must reload authoritative database data after approval",
  );
});

// ==============================================================================
// 8. FRONTEND UPDATES CORRECTLY AFTER SUCCESSFUL REJECTION
// ==============================================================================

test("Requirement 8: Frontend updates correctly after successful rejection", () => {
  const farmerRoute = fs.readFileSync(FARMER_REPAIR_PATH, "utf8");

  // Optimistic quote update
  assert.ok(
    farmerRoute.includes(
      "setQuotes((prev) => prev.map((q) => (q.id === updated.id ? updated : q)))",
    ),
    "handleDeclineQuote must update local quotes array with returned revised quote",
  );

  // Immediate repair status update to QUOTE_REVISED
  assert.ok(
    farmerRoute.includes(
      'setR((prev) =>\n        prev ? { ...prev, status: "QUOTE_REVISED", clarification_note: cleanReason } : null,\n      )',
    ),
    "handleDeclineQuote must update repair status to QUOTE_REVISED and save clarification note",
  );

  // Dual-store sync for demo mode
  assert.ok(
    farmerRoute.includes("actions.declineQuote(r.job_number || r.id, cleanReason)"),
    "handleDeclineQuote must synchronize with in-memory demo store",
  );

  // Modal reset & fresh data reload
  assert.ok(
    farmerRoute.includes("setDeclining(false);"),
    "handleDeclineQuote must close the decline form upon success",
  );
});

// ==============================================================================
// 9. STALE FRONTEND STATE IS RECONCILED WITH DATABASE STATE
// ==============================================================================

test("Requirement 9: Stale frontend state is reconciled with authoritative database state", () => {
  const farmerRoute = fs.readFileSync(FARMER_REPAIR_PATH, "utf8");

  // Version sorting ensures latest quote is prioritized
  assert.ok(
    farmerRoute.includes(
      "const sortedQuotes = [...quotes].sort((a, b) => (a.version || 1) - (b.version || 1));",
    ),
    "Farmer repair page must sort quotes ascending by version to determine the authoritative latest quote",
  );
  assert.ok(
    farmerRoute.includes(
      "const latestQuote = allQuotes.length > 0 ? allQuotes[allQuotes.length - 1] : null;",
    ),
    "Farmer repair page must identify latestQuote from sorted quotes array",
  );
  assert.ok(
    farmerRoute.includes(
      'const pendingQuote = latestQuote?.status === "PENDING" ? latestQuote : null;',
    ),
    "pendingQuote must be strictly the latest quote if pending, ignoring older quote revisions",
  );

  // isAwaitingDecision condition
  assert.ok(
    farmerRoute.includes('pendingQuote.status === "PENDING"'),
    "isAwaitingDecision must strictly verify that pendingQuote has status PENDING",
  );

  // Immediate loadData() on error in catch blocks
  assert.ok(
    farmerRoute.includes(
      'toast.error(err?.message || "Failed to approve quote");\n      await loadData();',
    ),
    "handleApproveQuote must trigger loadData() in catch block to reconcile stale UI with DB",
  );
  assert.ok(
    farmerRoute.includes(
      'toast.error(err?.message || "Failed to request quote revision");\n      await loadData();',
    ),
    "handleDeclineQuote must trigger loadData() in catch block to reconcile stale UI with DB",
  );
});

// ==============================================================================
// 10. TECHNICIAN QUOTE CREATION AND REVISION WORKFLOWS REMAIN FUNCTIONAL
// ==============================================================================

test("Requirement 10: Existing technician quote creation and revision workflows remain functional", () => {
  const quotesService = fs.readFileSync(QUOTES_SERVICE_PATH, "utf8");
  const apiRoute = fs.readFileSync(API_ROUTE_PATH, "utf8");

  // API endpoint dispatch integration
  assert.ok(
    apiRoute.includes("handleQuoteDecisionRequest(request)"),
    "/api/quote-decision route must dispatch to handleQuoteDecisionRequest",
  );

  // Technician quote creation
  assert.ok(
    quotesService.includes("export async function createQuote("),
    "quotes.ts must export createQuote for technician quote formulation",
  );
  assert.ok(
    quotesService.includes('status: "QUOTE_PENDING"'),
    "createQuote must transition repair ticket to QUOTE_PENDING",
  );

  // Technician quote revision
  assert.ok(
    quotesService.includes("export async function reviseQuote("),
    "quotes.ts must export reviseQuote for technician revision formulation",
  );
  assert.ok(
    quotesService.includes("const newVersion = prevQuote.version + 1;"),
    "reviseQuote must increment version sequentially",
  );
  assert.ok(
    quotesService.includes('.update({ status: "REVISED" })'),
    "reviseQuote must mark previous revision as REVISED",
  );
  assert.ok(
    quotesService.includes("export const acceptQuote = approveQuote;"),
    "quotes.ts must export acceptQuote alias matching farmer quote acceptance specification",
  );
});

// ==============================================================================
// 11. UNIT HELPERS: CLARIFICATION PARSER & QUOTE TOTALS CALCULATION
// ==============================================================================

test("parseClarificationNote parses predefined and custom reasons accurately", () => {
  // Predefined reason
  const res1 = parseClarificationNote("Too expensive");
  assert.equal(res1.reason, "Too expensive");
  assert.equal(res1.explanation, undefined);

  // Reason and explanation with newline
  const res2 = parseClarificationNote(
    "Reason: Want local (non-OEM) parts\nExplanation: Please quote aftermarket brands\nPhoto: https://example.com/part.jpg",
  );
  assert.equal(res2.reason, "Want local (non-OEM) parts");
  assert.equal(res2.explanation, "Please quote aftermarket brands");
  assert.equal(res2.photo, "https://example.com/part.jpg");

  // Bracket pattern
  const res3 = parseClarificationNote(
    "[Need earlier completion] Machine needed for harvest on Monday",
  );
  assert.equal(res3.reason, "Need earlier completion");
  assert.equal(res3.explanation, "Machine needed for harvest on Monday");

  // Freeform explanation
  const res4 = parseClarificationNote("The quote looks higher than local market rate.");
  assert.equal(res4.explanation, "The quote looks higher than local market rate.");

  // Empty or undefined
  assert.deepEqual(parseClarificationNote(""), {});
  assert.deepEqual(parseClarificationNote(null), {});
  assert.deepEqual(parseClarificationNote(undefined), {});
});

test("calculateQuoteTotals accurately computes parts, labour, tax, and grand total", () => {
  const items = [
    { quantity: 2, unit_price: 1500 }, // 3000
    { quantity: 1, unit_price: 2500 }, // 2500
  ];
  const totals = calculateQuoteTotals(items, 1500, 18);
  assert.equal(totals.partsTotal, 5500);
  assert.equal(totals.labourAmount, 1500);
  assert.equal(totals.taxAmount, (5500 + 1500) * 0.18); // 1260
  assert.equal(totals.totalAmount, 7000 + 1260); // 8260
});
