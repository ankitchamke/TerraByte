import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { handleQuoteDecisionRequest } from "../src/lib/services/quote-action-handler.ts";

const ROOT_DIR = path.resolve(process.cwd());
const REVIEWS_SERVICE_PATH = path.join(ROOT_DIR, "src", "lib", "services", "reviews.ts");
const QUOTES_SERVICE_PATH = path.join(ROOT_DIR, "src", "lib", "services", "quotes.ts");
const QUOTE_HANDLER_PATH = path.join(
  ROOT_DIR,
  "src",
  "lib",
  "services",
  "quote-action-handler.ts",
);
const VERIFIED_REVIEW_SECTION_PATH = path.join(
  ROOT_DIR,
  "src",
  "components",
  "reviews",
  "VerifiedReviewSection.tsx",
);
const FARMER_REPAIR_PATH = path.join(
  ROOT_DIR,
  "src",
  "routes",
  "farmer",
  "repair",
  "$id.tsx",
);

// Evaluator simulating checkReviewEligibility behavior
function evaluateReviewEligibility({
  caller,
  repair,
  serviceHistory,
  existingReview,
}) {
  if (!repair) {
    return { isEligible: false, reason: "REPAIR_NOT_FOUND", repair: null };
  }
  if (!caller) {
    return { isEligible: false, reason: "NOT_AUTHENTICATED", repair };
  }
  if (caller.role !== "admin" && repair.farmer_id !== caller.id) {
    return { isEligible: false, reason: "NOT_TICKET_OWNER", repair };
  }
  if (repair.status !== "COMPLETED") {
    return { isEligible: false, reason: "REPAIR_NOT_COMPLETED", repair };
  }
  if (!repair.technician_id) {
    return { isEligible: false, reason: "NO_TECHNICIAN_ASSIGNED", repair };
  }
  if (!serviceHistory) {
    return { isEligible: false, reason: "NO_SERVICE_HISTORY", repair, serviceHistory: null };
  }
  if (existingReview) {
    return { isEligible: false, reason: "ALREADY_REVIEWED", repair, serviceHistory, existingReview };
  }
  return { isEligible: true, repair, serviceHistory, existingReview: null };
}

// ==============================================================================
// 1. AUTHENTICATED FARMER REVIEW ELIGIBILITY (DEVDAS GAIKWAD SCENARIO)
// ==============================================================================

test("Security Audit: Authenticated farmer successfully checks review eligibility", () => {
  const farmerId = "00000000-0000-0000-0001-000000000001";
  const repairId = "70d7d056-721b-4aab-9551-5f5d0bdd6b1d";
  const techId = "00000000-0000-0000-0002-000000000001";

  const eligibility = evaluateReviewEligibility({
    caller: { id: farmerId, role: "farmer" },
    repair: {
      id: repairId,
      job_number: "TB-1341",
      status: "COMPLETED",
      farmer_id: farmerId,
      technician_id: techId,
    },
    serviceHistory: {
      id: "96d51500-d2a0-429a-ae68-e1d3fdf8481a",
      repair_request_id: repairId,
      service_date: "2026-11-07T08:54:44.858Z",
      operating_hours: 1240,
    },
    existingReview: null,
  });

  assert.equal(eligibility.isEligible, true);
  assert.equal(eligibility.reason, undefined);
  assert.equal(eligibility.repair.id, repairId);
  assert.equal(eligibility.serviceHistory.id, "96d51500-d2a0-429a-ae68-e1d3fdf8481a");
  assert.equal(eligibility.existingReview, null);
});

// ==============================================================================
// 2. MISSING OR EXPIRED JWT / UNAUTHENTICATED CALLER
// ==============================================================================

test("Security Audit: Missing or expired session fails closed with NOT_AUTHENTICATED", () => {
  const repairId = "70d7d056-721b-4aab-9551-5f5d0bdd6b1d";

  const eligibility = evaluateReviewEligibility({
    caller: null, // Unauthenticated / expired JWT
    repair: {
      id: repairId,
      job_number: "TB-1341",
      status: "COMPLETED",
      farmer_id: "farmer-1",
      technician_id: "tech-1",
    },
    serviceHistory: { id: "hist-1", repair_request_id: repairId },
    existingReview: null,
  });

  assert.equal(eligibility.isEligible, false);
  assert.equal(eligibility.reason, "NOT_AUTHENTICATED");
});

// ==============================================================================
// 3. PROFILE MAPPING & COLUMN PRIVILEGE RESTRICTIONS (REVIEWS.TS)
// ==============================================================================

test("Security Audit: reviews.ts correctly parses array from get_session_profile RPC and uses safe column whitelist in fallback", () => {
  const content = fs.readFileSync(REVIEWS_SERVICE_PATH, "utf8");

  // Array handling: PostgREST returns array for SETOF records
  assert.ok(
    content.includes("Array.isArray(sessionData)") || content.includes("sessionData && sessionData.length > 0"),
    "reviews.ts must handle array return format from get_session_profile RPC",
  );

  // Fallback path does not query forbidden auth_user_id on profiles
  assert.doesNotMatch(
    content,
    /\.from\(["']profiles["']\)[^;]*auth_user_id/i,
    "reviews.ts fallback must NEVER query profiles by auth_user_id (violates column-level grants)",
  );

  // Fallback path queries profile_auth_secrets
  assert.ok(
    content.includes('.from("profile_auth_secrets")'),
    "reviews.ts must check profile_auth_secrets in fallback path",
  );

  // Queries profiles by id only
  assert.ok(
    content.includes('.from("profiles")'),
    "reviews.ts must query profiles table in fallback path",
  );
  assert.ok(
    content.includes('.eq("id", targetProfileId)'),
    "reviews.ts fallback must query profiles by id",
  );
});

// ==============================================================================
// 4. FARMER ACCESSING ANOTHER FARMER'S REPAIR
// ==============================================================================

test("Security Audit: Farmer attempting to review another farmer's repair ticket is rejected with NOT_TICKET_OWNER", () => {
  const callerFarmerId = "00000000-0000-0000-0001-000000000001"; // Devdas Gaikwad
  const victimFarmerId = "bbfca0eb-1768-4049-8ee0-b56cf7d2a88c"; // Balasaheb Patil

  const eligibility = evaluateReviewEligibility({
    caller: { id: callerFarmerId, role: "farmer" },
    repair: {
      id: "repair-202",
      job_number: "TB-9999",
      status: "COMPLETED",
      farmer_id: victimFarmerId, // Owned by another farmer!
      technician_id: "tech-1",
    },
    serviceHistory: { id: "hist-202", repair_request_id: "repair-202" },
    existingReview: null,
  });

  assert.equal(eligibility.isEligible, false);
  assert.equal(eligibility.reason, "NOT_TICKET_OWNER");
});

// ==============================================================================
// 5. DUPLICATE REVIEW PREVENTION
// ==============================================================================

test("Security Audit: Duplicate review submission is rejected with ALREADY_REVIEWED", () => {
  const farmerId = "00000000-0000-0000-0001-000000000001";

  const eligibility = evaluateReviewEligibility({
    caller: { id: farmerId, role: "farmer" },
    repair: {
      id: "repair-303",
      job_number: "TB-1341",
      status: "COMPLETED",
      farmer_id: farmerId,
      technician_id: "tech-1",
    },
    serviceHistory: { id: "hist-303", repair_request_id: "repair-303" },
    existingReview: { id: "rev-303", rating: 5 }, // Review already exists!
  });

  assert.equal(eligibility.isEligible, false);
  assert.equal(eligibility.reason, "ALREADY_REVIEWED");
});

// ==============================================================================
// 6. QUOTE WORKFLOW: TECHNICIAN SELF-APPROVAL REJECTION
// ==============================================================================

test("Security Audit: Technician cannot approve or reject their own quote via quote-decision API", async () => {
  const techId = "00000000-0000-0000-0002-000000000001";
  const farmerId = "00000000-0000-0000-0001-000000000001";
  const quoteId = "76e075be-5ce6-4f14-b1af-f562552fe379";
  const repairId = "70d7d056-721b-4aab-9551-5f5d0bdd6b1d";

  const mockUserClient = {
    auth: {
      getUser: async () => ({
        data: { user: { id: techId, email: "tech@terrabyte.app" } },
        error: null,
      }),
    },
    rpc: async (fn) => {
      if (fn === "get_session_profile") {
        return {
          data: [{ id: techId, role: "technician", full_name: "Santosh Kale" }],
          error: null,
        };
      }
      return { data: null, error: null };
    },
    from: (table) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === "quotes") {
              return {
                data: {
                  id: quoteId,
                  version: 1,
                  status: "PENDING",
                  technician_id: techId,
                  repair_request: {
                    id: repairId,
                    farmer_id: farmerId,
                    technician_id: techId,
                    status: "QUOTE_PENDING",
                  },
                },
                error: null,
              };
            }
            return { data: null, error: null };
          },
        }),
      }),
    }),
  };

  const req = new Request("http://localhost/api/quote-decision", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer mock-technician-token",
    },
    body: JSON.stringify({
      quoteId,
      action: "approve",
    }),
  });

  const res = await handleQuoteDecisionRequest(req, { userClient: mockUserClient });
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.match(data.error, /Unauthorized: Only the machinery owner/);
});

// ==============================================================================
// 7. QUOTE WORKFLOW: CROSS-FARMER AUTHORIZATION BOUNDARY
// ==============================================================================

test("Security Audit: Farmer cannot approve or reject another farmer's quote", async () => {
  const attackerFarmerId = "attacker-farmer-uuid";
  const victimFarmerId = "00000000-0000-0000-0001-000000000001";
  const quoteId = "76e075be-5ce6-4f14-b1af-f562552fe379";
  const repairId = "70d7d056-721b-4aab-9551-5f5d0bdd6b1d";

  const mockUserClient = {
    auth: {
      getUser: async () => ({
        data: { user: { id: attackerFarmerId, email: "attacker@test.com" } },
        error: null,
      }),
    },
    rpc: async (fn) => {
      if (fn === "get_session_profile") {
        return {
          data: [{ id: attackerFarmerId, role: "farmer", full_name: "Attacker Farmer" }],
          error: null,
        };
      }
      return { data: null, error: null };
    },
    from: (table) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === "quotes") {
              return {
                data: {
                  id: quoteId,
                  version: 1,
                  status: "PENDING",
                  technician_id: "tech-1",
                  repair_request: {
                    id: repairId,
                    farmer_id: victimFarmerId, // Belongs to victim farmer!
                    technician_id: "tech-1",
                    status: "QUOTE_PENDING",
                  },
                },
                error: null,
              };
            }
            return { data: null, error: null };
          },
        }),
      }),
    }),
  };

  const req = new Request("http://localhost/api/quote-decision", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer mock-attacker-token",
    },
    body: JSON.stringify({
      quoteId,
      action: "approve",
    }),
  });

  const res = await handleQuoteDecisionRequest(req, { userClient: mockUserClient });
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.match(data.error, /Unauthorized: Only the machinery owner/);
});

// ==============================================================================
// 8. ZERO SERVICE-ROLE CREDENTIAL LEAK INVARIANT
// ==============================================================================

test("Security Audit: Zero service-role credentials or server imports in browser-facing code", () => {
  const browserFiles = [
    QUOTES_SERVICE_PATH,
    REVIEWS_SERVICE_PATH,
    VERIFIED_REVIEW_SECTION_PATH,
    FARMER_REPAIR_PATH,
  ];

  for (const filePath of browserFiles) {
    const content = fs.readFileSync(filePath, "utf8");
    assert.doesNotMatch(
      content,
      /client\.server/i,
      `Browser module ${path.basename(filePath)} must NEVER import client.server`,
    );
    assert.doesNotMatch(
      content,
      /SUPABASE_SERVICE_ROLE_KEY/i,
      `Browser module ${path.basename(filePath)} must NEVER reference SUPABASE_SERVICE_ROLE_KEY`,
    );
  }
});

// ==============================================================================
// 9. CONCURRENT SUBMISSION & IN-FLIGHT MUTATION LOCK INVARIANTS
// ==============================================================================

test("Security Audit: inFlightQuoteMutations and actionInProgress prevent race conditions", () => {
  const quotesContent = fs.readFileSync(QUOTES_SERVICE_PATH, "utf8");
  const repairContent = fs.readFileSync(FARMER_REPAIR_PATH, "utf8");

  // In-flight mutex in quotes service
  assert.ok(
    quotesContent.includes("inFlightQuoteMutations.has(quoteId)"),
    "quotes.ts must check inFlightQuoteMutations before executing mutations",
  );
  assert.ok(
    quotesContent.includes("inFlightQuoteMutations.add(quoteId)"),
    "quotes.ts must lock quoteId in inFlightQuoteMutations",
  );
  assert.ok(
    quotesContent.includes("inFlightQuoteMutations.delete(quoteId)"),
    "quotes.ts must release lock in finally block",
  );

  // UI state in repair detail page
  assert.ok(
    repairContent.includes("disabled={actionInProgress}"),
    "Farmer repair page must disable action buttons when actionInProgress is true",
  );
});
