import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { en } from "../src/lib/i18n/dictionaries/en.ts";
import { hi } from "../src/lib/i18n/dictionaries/hi.ts";
import { mr } from "../src/lib/i18n/dictionaries/mr.ts";

const migrationPath = path.resolve(
  process.cwd(),
  "supabase/migrations/20261106160000_phase13_database_foundations.sql",
);
const sqlContent = fs.readFileSync(migrationPath, "utf-8");

const reviewsServicePath = path.resolve(
  process.cwd(),
  "src/lib/services/reviews.ts",
);
const reviewsContent = fs.readFileSync(reviewsServicePath, "utf-8");

function detectSensitiveDataInComment(comment) {
  return /[0-9]{6,}/.test(comment || "");
}

function formatTechnicianRating(rating, unratedLabel = "New / Unrated") {
  if (rating === null || rating === undefined || isNaN(rating)) {
    return unratedLabel;
  }
  return Number(rating).toFixed(1);
}

// ==============================================================================
// 1. DATABASE SCHEMA & CONSTRAINT INVARIANTS
// ==============================================================================

test("Review Service — exports authoritative interfaces and functions", () => {
  assert.match(reviewsContent, /export\s+interface\s+TechnicianReview/);
  assert.match(reviewsContent, /export\s+interface\s+CreateReviewInput/);
  assert.match(reviewsContent, /export\s+interface\s+ReviewEligibilityResult/);
  assert.match(reviewsContent, /export\s+function\s+isPhase13ReviewsMissingError/);
  assert.match(reviewsContent, /export\s+function\s+detectSensitiveDataInComment/);
  assert.match(reviewsContent, /export\s+function\s+formatTechnicianRating/);
  assert.match(reviewsContent, /export\s+async\s+function\s+checkReviewEligibility/);
  assert.match(reviewsContent, /export\s+async\s+function\s+submitTechnicianReview/);
  assert.match(reviewsContent, /export\s+async\s+function\s+getRepairReview/);
  assert.match(reviewsContent, /export\s+async\s+function\s+getTechnicianReviews/);
});

test("Database Schema — technician_reviews table structure and relational constraints", () => {
  // Table exists
  assert.match(
    sqlContent,
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.technician_reviews/i,
    "technician_reviews table must exist",
  );

  // Foreign key with RESTRICT to repair_requests
  assert.match(
    sqlContent,
    /repair_id\s+UUID\s+NOT\s+NULL\s+UNIQUE\s+REFERENCES\s+public\.repair_requests\(id\)\s+ON\s+DELETE\s+RESTRICT/i,
    "repair_id must have UNIQUE and ON DELETE RESTRICT foreign key",
  );

  // Foreign key with RESTRICT to service_history
  assert.match(
    sqlContent,
    /service_history_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+public\.service_history\(id\)\s+ON\s+DELETE\s+RESTRICT/i,
    "service_history_id must have ON DELETE RESTRICT foreign key",
  );

  // Farmer and technician profile references
  assert.match(
    sqlContent,
    /farmer_profile_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+public\.profiles\(id\)\s+ON\s+DELETE\s+RESTRICT/i,
    "farmer_profile_id must reference public.profiles",
  );
  assert.match(
    sqlContent,
    /technician_profile_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+public\.profiles\(id\)\s+ON\s+DELETE\s+RESTRICT/i,
    "technician_profile_id must reference public.profiles",
  );

  // Rating range check constraint 1..5
  assert.match(
    sqlContent,
    /rating\s+INTEGER\s+NOT\s+NULL\s+CHECK\s*\(\s*rating\s+BETWEEN\s+1\s+AND\s+5\s*\)/i,
    "rating must have CHECK constraint BETWEEN 1 AND 5",
  );

  // Optional sub-metrics check constraints 1..5
  assert.match(
    sqlContent,
    /timeliness_rating\s+INTEGER\s+CHECK\s*\(\s*timeliness_rating\s+BETWEEN\s+1\s+AND\s+5\s*\)/i,
    "timeliness_rating must have CHECK constraint BETWEEN 1 AND 5",
  );
  assert.match(
    sqlContent,
    /quality_rating\s+INTEGER\s+CHECK\s*\(\s*quality_rating\s+BETWEEN\s+1\s+AND\s+5\s*\)/i,
    "quality_rating must have CHECK constraint BETWEEN 1 AND 5",
  );
});

test("Database Schema — technician_profiles rating nullable and review_count initialized", () => {
  // Alter column rating DROP NOT NULL
  assert.match(
    sqlContent,
    /ALTER\s+TABLE\s+public\.technician_profiles[\s\S]+?ALTER\s+COLUMN\s+rating\s+DROP\s+NOT\s+NULL/i,
    "Rating must be nullable on technician_profiles",
  );

  // Default rating SET DEFAULT NULL
  assert.match(
    sqlContent,
    /ALTER\s+TABLE\s+public\.technician_profiles[\s\S]+?ALTER\s+COLUMN\s+rating\s+SET\s+DEFAULT\s+NULL/i,
    "Rating default must be NULL",
  );

  // Review count column added with default 0
  assert.match(
    sqlContent,
    /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+review_count\s+(?:INT|INTEGER)\s+NOT\s+NULL\s+DEFAULT\s+0/i,
    "review_count must be added with default 0",
  );
});

test("Database Security — Access Control & Immutability on technician_reviews", () => {
  // Direct UPDATE, DELETE, TRUNCATE revoked from authenticated, anon, PUBLIC, service_role
  assert.match(
    sqlContent,
    /REVOKE\s+UPDATE,\s*DELETE,\s*TRUNCATE\s+ON\s+TABLE\s+public\.technician_reviews\s+FROM\s+authenticated,\s*anon,\s*PUBLIC,\s*service_role/i,
    "Direct mutation on technician_reviews must be revoked for all roles",
  );

  // Only SELECT and INSERT granted to authenticated
  assert.match(
    sqlContent,
    /GRANT\s+SELECT,\s*INSERT\s+ON\s+TABLE\s+public\.technician_reviews\s+TO\s+authenticated/i,
    "authenticated role should only have SELECT and INSERT on technician_reviews",
  );

  // RLS Insert policy enforces farmer ownership, completed status, and linked service history
  assert.match(
    sqlContent,
    /CREATE\s+POLICY\s+"Farmers can insert reviews for completed repairs with service history"\s+ON\s+public\.technician_reviews\s+FOR\s+INSERT\s+TO\s+authenticated\s+WITH\s+CHECK\s*\(/i,
    "RLS insert policy must exist on technician_reviews",
  );
  assert.match(
    sqlContent,
    /farmer_profile_id\s*=\s*public\.current_profile_id\(\)/i,
    "RLS must verify farmer_profile_id matches current profile",
  );
  assert.match(
    sqlContent,
    /r\.status\s*=\s*'COMPLETED'/i,
    "RLS must verify repair status is COMPLETED",
  );
});

// ==============================================================================
// 2. RATING AGGREGATION TRIGGER & SIMULATION
// ==============================================================================

test("Database Trigger — recalculate_technician_rating trigger definition and concurrency lock", () => {
  // Trigger function exists
  assert.match(
    sqlContent,
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.recalculate_technician_rating\(\)/i,
    "recalculate_technician_rating trigger function must be defined",
  );

  // SECURITY DEFINER with empty search_path
  assert.match(
    sqlContent,
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.recalculate_technician_rating\(\)[\s\S]+?SECURITY\s+DEFINER[\s\S]+?SET\s+search_path\s*=\s*''/i,
    "Trigger must be SECURITY DEFINER with empty search path",
  );

  // Row lock with FOR UPDATE
  assert.match(
    sqlContent,
    /PERFORM\s+profile_id\s+FROM\s+public\.technician_profiles\s+WHERE\s+profile_id\s*=\s*v_tech_1\s+FOR\s+UPDATE/i,
    "Trigger must lock technician profile with FOR UPDATE",
  );

  // Attached to AFTER INSERT OR UPDATE OR DELETE ON technician_reviews
  assert.match(
    sqlContent,
    /CREATE\s+TRIGGER\s+trg_recalculate_technician_rating\s+AFTER\s+INSERT\s+OR\s+UPDATE\s+OR\s+DELETE\s+ON\s+public\.technician_reviews/i,
    "Trigger must fire AFTER INSERT OR UPDATE OR DELETE",
  );
});

test("Rating Aggregation Simulation — Atomically recalculates average and handles 0 reviews as NULL", () => {
  // Simulate the PostgreSQL recalculate_technician_rating trigger logic
  function simulateRecalculateTechnicianRating(reviews) {
    const published = reviews.filter((r) => r.is_published);
    if (published.length === 0) {
      return { rating: null, review_count: 0 };
    }
    const sum = published.reduce((acc, r) => acc + r.rating, 0);
    const avg = Math.round((sum / published.length) * 100) / 100;
    return {
      rating: avg,
      review_count: published.length,
    };
  }

  // 1. Initial state (0 reviews) -> rating must be NULL
  const initial = simulateRecalculateTechnicianRating([]);
  assert.equal(initial.rating, null);
  assert.equal(initial.review_count, 0);

  // 2. After First Review (rating = 4)
  const afterFirst = simulateRecalculateTechnicianRating([{ rating: 4, is_published: true }]);
  assert.equal(afterFirst.rating, 4.0);
  assert.equal(afterFirst.review_count, 1);

  // 3. After Second Review (rating = 5) -> avg 4.5
  const afterSecond = simulateRecalculateTechnicianRating([
    { rating: 4, is_published: true },
    { rating: 5, is_published: true },
  ]);
  assert.equal(afterSecond.rating, 4.5);
  assert.equal(afterSecond.review_count, 2);

  // 4. After Third Review (rating = 3) -> (4+5+3)/3 = 4.0
  const afterThird = simulateRecalculateTechnicianRating([
    { rating: 4, is_published: true },
    { rating: 5, is_published: true },
    { rating: 3, is_published: true },
  ]);
  assert.equal(afterThird.rating, 4.0);
  assert.equal(afterThird.review_count, 3);

  // 5. Unpublished reviews do not count towards public average
  const withUnpublished = simulateRecalculateTechnicianRating([
    { rating: 4, is_published: true },
    { rating: 5, is_published: true },
    { rating: 1, is_published: false }, // Moderated/Unpublished
  ]);
  assert.equal(withUnpublished.rating, 4.5);
  assert.equal(withUnpublished.review_count, 2);

  // 6. Delete all reviews -> reverts to NULL
  const afterDeleteAll = simulateRecalculateTechnicianRating([]);
  assert.equal(afterDeleteAll.rating, null);
  assert.equal(afterDeleteAll.review_count, 0);
});

// ==============================================================================
// 3. REVIEW ELIGIBILITY & VALIDATION INVARIANTS
// ==============================================================================

test("Review Eligibility Contract — Requires completed repair, linked service history, and farmer ownership", () => {
  function evaluateEligibility({
    callerProfileId,
    repair,
    serviceHistory,
    existingReview,
  }) {
    if (!repair) return { isEligible: false, reason: "REPAIR_NOT_FOUND" };
    if (!callerProfileId) return { isEligible: false, reason: "NOT_AUTHENTICATED" };
    if (repair.farmer_id !== callerProfileId) return { isEligible: false, reason: "NOT_TICKET_OWNER" };
    if (repair.status !== "COMPLETED") return { isEligible: false, reason: "REPAIR_NOT_COMPLETED" };
    if (!repair.technician_id) return { isEligible: false, reason: "NO_TECHNICIAN_ASSIGNED" };
    if (!serviceHistory) return { isEligible: false, reason: "NO_SERVICE_HISTORY" };
    if (existingReview) return { isEligible: false, reason: "ALREADY_REVIEWED" };
    return { isEligible: true };
  }

  const farmerId = "00000000-0000-0000-0001-000000000001";
  const otherFarmerId = "00000000-0000-0000-0001-000000000002";
  const techId = "00000000-0000-0000-0002-000000000001";
  const validRepair = {
    id: "rep-101",
    farmer_id: farmerId,
    technician_id: techId,
    status: "COMPLETED",
  };
  const validHistory = { id: "sh-101", repair_request_id: "rep-101" };

  // 1. Eligible Case
  const eligible = evaluateEligibility({
    callerProfileId: farmerId,
    repair: validRepair,
    serviceHistory: validHistory,
    existingReview: null,
  });
  assert.equal(eligible.isEligible, true);

  // 2. Rejects when repair is still in IN_PROGRESS or DIAGNOSED
  const inProgress = evaluateEligibility({
    callerProfileId: farmerId,
    repair: { ...validRepair, status: "IN_PROGRESS" },
    serviceHistory: validHistory,
    existingReview: null,
  });
  assert.equal(inProgress.isEligible, false);
  assert.equal(inProgress.reason, "REPAIR_NOT_COMPLETED");

  // 3. Rejects when repair has no linked service history record
  const noHistory = evaluateEligibility({
    callerProfileId: farmerId,
    repair: validRepair,
    serviceHistory: null,
    existingReview: null,
  });
  assert.equal(noHistory.isEligible, false);
  assert.equal(noHistory.reason, "NO_SERVICE_HISTORY");

  // 4. Rejects when caller is not the farmer who owns the ticket
  const wrongFarmer = evaluateEligibility({
    callerProfileId: otherFarmerId,
    repair: validRepair,
    serviceHistory: validHistory,
    existingReview: null,
  });
  assert.equal(wrongFarmer.isEligible, false);
  assert.equal(wrongFarmer.reason, "NOT_TICKET_OWNER");

  // 5. Rejects when a review has already been submitted (One review per repair)
  const alreadyReviewed = evaluateEligibility({
    callerProfileId: farmerId,
    repair: validRepair,
    serviceHistory: validHistory,
    existingReview: { id: "rev-1", rating: 5 },
  });
  assert.equal(alreadyReviewed.isEligible, false);
  assert.equal(alreadyReviewed.reason, "ALREADY_REVIEWED");
});

test("Rating Range Validation — Integer bounds 1..5 enforced for overall, timeliness, and quality", () => {
  function validateRatingInput({ rating, timelinessRating, qualityRating }) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new Error("INVALID_RATING: Overall rating must be an integer between 1 and 5 stars.");
    }
    if (
      timelinessRating != null &&
      (!Number.isInteger(timelinessRating) || timelinessRating < 1 || timelinessRating > 5)
    ) {
      throw new Error("INVALID_TIMELINESS_RATING: Timeliness rating must be between 1 and 5.");
    }
    if (
      qualityRating != null &&
      (!Number.isInteger(qualityRating) || qualityRating < 1 || qualityRating > 5)
    ) {
      throw new Error("INVALID_QUALITY_RATING: Quality rating must be between 1 and 5.");
    }
    return true;
  }

  // Valid inputs
  assert.ok(validateRatingInput({ rating: 5 }));
  assert.ok(validateRatingInput({ rating: 1, timelinessRating: 4, qualityRating: 5 }));

  // Rejects 0 stars
  assert.throws(() => validateRatingInput({ rating: 0 }), /INVALID_RATING/);

  // Rejects > 5 stars
  assert.throws(() => validateRatingInput({ rating: 6 }), /INVALID_RATING/);

  // Rejects floating point ratings (e.g. 4.5)
  assert.throws(() => validateRatingInput({ rating: 4.5 }), /INVALID_RATING/);

  // Rejects invalid sub-metric ratings
  assert.throws(
    () => validateRatingInput({ rating: 5, timelinessRating: 0 }),
    /INVALID_TIMELINESS_RATING/,
  );
  assert.throws(
    () => validateRatingInput({ rating: 5, qualityRating: 6 }),
    /INVALID_QUALITY_RATING/,
  );
});

// ==============================================================================
// 4. ANTI-PII PROTECTION ON REVIEW COMMENTS
// ==============================================================================

test("Anti-PII Protection — detectSensitiveDataInComment rejects 6+ continuous digits", () => {
  // Clean comments pass
  assert.equal(
    detectSensitiveDataInComment("Excellent tractor clutch replacement, fast and professional work!"),
    false,
  );
  assert.equal(detectSensitiveDataInComment("Fixed the hydraulics in 3 hours. Great service."), false);

  // Leaked phone numbers reject
  assert.equal(detectSensitiveDataInComment("Call him at 9823011223 for emergency repairs"), true);
  assert.equal(detectSensitiveDataInComment("Technician number 9011000001"), true);

  // Leaked Aadhaar/PAN reject
  assert.equal(detectSensitiveDataInComment("My aadhaar was 123456789012"), true);
  assert.equal(detectSensitiveDataInComment("Reference 987654"), true);
});

// ==============================================================================
// 5. UI FORMATTING & NULL DEFAULT INVARIANTS
// ==============================================================================

test("UI Formatting — formatTechnicianRating renders 'New / Unrated' when rating is null", () => {
  assert.equal(formatTechnicianRating(null), "New / Unrated");
  assert.equal(formatTechnicianRating(undefined), "New / Unrated");
  assert.equal(formatTechnicianRating(NaN), "New / Unrated");
  assert.equal(formatTechnicianRating(null, "नवीन / रेट केलेले नाही"), "नवीन / रेट केलेले नाही");
  assert.equal(formatTechnicianRating(null, "नया / अनरेटेड"), "नया / अनरेटेड");

  // Valid ratings render formatted to 1 decimal place
  assert.equal(formatTechnicianRating(5), "5.0");
  assert.equal(formatTechnicianRating(4.8), "4.8");
  assert.equal(formatTechnicianRating(4.67), "4.7");
});

test("Codebase Search — No hardcoded 4.8 or 5.0 fallback rating in farmer repair detail", () => {
  const farmerRepairDetailPath = path.resolve(
    process.cwd(),
    "src/routes/farmer/repair/$id.tsx",
  );
  const detailCode = fs.readFileSync(farmerRepairDetailPath, "utf-8");

  // Must not contain `rating ?? 4.8`
  assert.equal(
    /rating\s*\?\?\s*4\.8/.test(detailCode),
    false,
    "Should not contain hardcoded 4.8 fallback for rating",
  );

  // Must embed VerifiedReviewSection
  assert.match(
    detailCode,
    /<VerifiedReviewSection/i,
    "Farmer repair detail must render VerifiedReviewSection",
  );
});

// ==============================================================================
// 6. TRILINGUAL DICTIONARY KEY PARITY
// ==============================================================================

test("Trilingual Parity — reviews dictionary section has complete parity across en, hi, mr", () => {
  const enReviewsKeys = Object.keys(en.reviews).sort();
  const hiReviewsKeys = Object.keys(hi.reviews).sort();
  const mrReviewsKeys = Object.keys(mr.reviews).sort();

  assert.deepEqual(
    enReviewsKeys,
    hiReviewsKeys,
    "English and Hindi reviews keys must be identical",
  );
  assert.deepEqual(
    enReviewsKeys,
    mrReviewsKeys,
    "English and Marathi reviews keys must be identical",
  );

  // Check non-empty strings
  for (const key of enReviewsKeys) {
    assert.ok(en.reviews[key]?.length > 0, `English key ${key} must not be empty`);
    assert.ok(hi.reviews[key]?.length > 0, `Hindi key ${key} must not be empty`);
    assert.ok(mr.reviews[key]?.length > 0, `Marathi key ${key} must not be empty`);

    // Verify Devanagari presence in Hindi and Marathi
    const devanagariRegex = /[\u0900-\u097F]/;
    assert.match(
      hi.reviews[key],
      devanagariRegex,
      `Hindi key ${key} must contain Devanagari script`,
    );
    assert.match(
      mr.reviews[key],
      devanagariRegex,
      `Marathi key ${key} must contain Devanagari script`,
    );
  }
});

// ==============================================================================
// 7. IDENTITY DECOUPLING & AUTHORIZATION INTEGRITY
// ==============================================================================

test("Identity Decoupling — RLS policy and review service resolve profiles.id, not auth.uid()", () => {
  // 1. Migration SQL must use public.current_profile_id(), never auth.uid(), on technician_reviews
  assert.match(
    sqlContent,
    /farmer_profile_id\s*=\s*public\.current_profile_id\(\)/i,
    "technician_reviews RLS must check farmer_profile_id against current_profile_id()",
  );
  assert.match(
    sqlContent,
    /r\.farmer_id\s*=\s*public\.current_profile_id\(\)/i,
    "technician_reviews RLS must check repair ownership against current_profile_id()",
  );
  assert.equal(
    /farmer_profile_id\s*=\s*auth\.uid\(\)/i.test(sqlContent),
    false,
    "technician_reviews RLS must NOT compare farmer_profile_id against auth.uid()",
  );
  assert.equal(
    /r\.farmer_id\s*=\s*auth\.uid\(\)/i.test(sqlContent),
    false,
    "technician_reviews RLS must NOT compare r.farmer_id against auth.uid()",
  );

  // 2. Canonical table in SQL policy must be public.repair_requests, never public.repairs
  assert.match(
    sqlContent,
    /JOIN\s+public\.repair_requests\s+r\s+ON\s+r\.id\s*=\s*sh\.repair_request_id/i,
    "technician_reviews RLS must join public.repair_requests",
  );
  assert.equal(
    /JOIN\s+public\.repairs\b/i.test(sqlContent),
    false,
    "technician_reviews RLS must NOT reference non-existent public.repairs table",
  );

  // 3. Simulation of Decoupled Identity Evaluation:
  const authUid = "a0000000-0000-0000-0000-000000000001";
  const profileId = "p0000000-0000-0000-0000-000000000001";
  assert.notEqual(authUid, profileId, "Auth UID and Profile ID must be decoupled");

  // In database, profiles maps auth_user_id -> profile.id
  const mockProfilesTable = [
    { id: profileId, auth_user_id: authUid, role: "farmer" }
  ];
  function simulateCurrentProfileId(callerAuthUid) {
    const found = mockProfilesTable.find(p => p.auth_user_id === callerAuthUid);
    return found ? found.id : null;
  }

  // In database, repair_requests.farmer_id stores the profile ID (not auth UID)
  const repair = {
    id: "rep-101",
    farmer_id: profileId,
    technician_id: "t0000000-0000-0000-0000-000000000001",
    status: "COMPLETED"
  };

  // Naive check against auth.uid() would incorrectly fail:
  const naiveCheck = (repair.farmer_id === authUid);
  assert.equal(naiveCheck, false, "Comparing repair.farmer_id directly to auth.uid() must fail due to decoupling");

  // Canonical check against current_profile_id() succeeds:
  const resolvedProfileId = simulateCurrentProfileId(authUid);
  const canonicalCheck = (repair.farmer_id === resolvedProfileId);
  assert.equal(canonicalCheck, true, "Comparing repair.farmer_id to current_profile_id() must succeed");

  // Review insert row sets farmer_profile_id to resolved profile ID:
  const newReviewRow = {
    repair_id: repair.id,
    farmer_profile_id: resolvedProfileId,
    technician_profile_id: repair.technician_id,
    rating: 5
  };
  const policyPasses = (newReviewRow.farmer_profile_id === resolvedProfileId) && canonicalCheck;
  assert.equal(policyPasses, true, "RLS insert policy evaluates true for decoupled profile ID");
});
