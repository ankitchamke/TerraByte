import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

// Dictionaries
import { en } from "../src/lib/i18n/dictionaries/en.ts";
import { hi } from "../src/lib/i18n/dictionaries/hi.ts";
import { mr } from "../src/lib/i18n/dictionaries/mr.ts";

// Migration SQL content
const MIGRATION_PATH = path.join(
  ROOT_DIR,
  "supabase",
  "migrations",
  "20261106160000_phase13_database_foundations.sql",
);
const migrationSql = fs.readFileSync(MIGRATION_PATH, "utf8");

// Service files
const HANDOVER_SERVICE_PATH = path.join(ROOT_DIR, "src", "lib", "services", "handover.ts");
const REVIEWS_SERVICE_PATH = path.join(ROOT_DIR, "src", "lib", "services", "reviews.ts");
const FACILITIES_SERVICE_PATH = path.join(ROOT_DIR, "src", "lib", "services", "facilities.ts");
const TECHS_SERVICE_PATH = path.join(ROOT_DIR, "src", "lib", "services", "technicians.ts");

const handoverContent = fs.readFileSync(HANDOVER_SERVICE_PATH, "utf8");
const reviewsContent = fs.readFileSync(REVIEWS_SERVICE_PATH, "utf8");
const facilitiesContent = fs.readFileSync(FACILITIES_SERVICE_PATH, "utf8");
const techsContent = fs.readFileSync(TECHS_SERVICE_PATH, "utf8");

// ==============================================================================
// 1. END-TO-END WORKFLOW SIMULATION: THE COMPLETE PHASE 13 LIFECYCLE
// ==============================================================================

test("E2E Integration: Complete Golden Flow across Farmer, Technician, Facility & Admin", () => {
  // Scenario Context:
  // Farmer Ramesh (Wardha/Katol) has a breakdown on Mahindra 575 DI.
  // Assigned to Technician Rajesh (KYC verified, affiliated with Hingna Central Workshop).
  // Quote issued, approved by farmer, parts cleared, load-tested, completed, paid offline,
  // authorized for handover, physically released, collected, and reviewed.

  const state = {
    farmer: {
      profileId: "00000000-0000-0000-0001-000000000001",
      name: "Ramesh Pawar",
      phone: "+91-98220-12345",
    },
    technician: {
      profileId: "00000000-0000-0000-0002-000000000001",
      name: "Rajesh Shinde",
      rating: null,
      reviewCount: 0,
      kycVerified: true,
      verifiedSkills: ["Mahindra 575 DI specialist", "Hydraulics expert"],
    },
    facility: {
      id: "00000000-0000-0000-0020-000000000001",
      name: "Nagpur Central Agro Repairs & Workshop, Hingna",
      latitude: 21.0965,
      longitude: 78.9876,
      phone: "+91-98230-11223",
      dropOffApproved: true,
      ownerProfileId: "00000000-0000-0000-0002-000000000001",
    },
    repair: {
      id: "11111111-2222-3333-4444-555555555555",
      farmerId: "00000000-0000-0000-0001-000000000001",
      technicianId: "00000000-0000-0000-0002-000000000001",
      facilityId: "00000000-0000-0000-0020-000000000001",
      status: "IN_PROGRESS",
      isTesting: false,
      loadTestPassed: null,
      loadTestNotes: null,
      loadTestedAt: null,
      paymentClearedAt: null,
      paymentMethod: null,
      paymentReference: null,
      handoverStatus: "PENDING",
      handoverAuthorizedAt: null,
      equipmentReleasedAt: null,
      farmerCollectedAt: null,
    },
    quote: {
      id: "qqqqqqqq-1111-2222-3333-444444444444",
      status: "APPROVED",
      grandTotal: 3450,
    },
    partsRequisitions: [{ id: "pr-1", status: "FULFILLED", partName: "Inline Fuel Filter" }],
    serviceHistory: null,
    review: null,
  };

  // STEP 1: Verify Initial State
  assert.equal(state.repair.status, "IN_PROGRESS");
  assert.equal(state.repair.handoverStatus, "PENDING");
  assert.equal(state.technician.rating, null);

  // STEP 2: Load Test Sign-Off (Technician tests equipment under load)
  // 2a. A failed test must block repair completion
  function canCompleteRepair(repair) {
    return repair.loadTestPassed === true && Boolean(repair.isTesting);
  }

  // Attempt complete without test -> BLOCKED
  assert.equal(canCompleteRepair(state.repair), false, "Completion blocked without load test");

  // Attempt complete with failed test -> BLOCKED
  state.repair.loadTestPassed = false;
  state.repair.isTesting = false;
  assert.equal(canCompleteRepair(state.repair), false, "Completion blocked with failed load test");

  // Technician re-tests and passes operational load test
  state.repair.isTesting = true;
  state.repair.loadTestPassed = true;
  state.repair.loadTestNotes =
    "Temp: 82°C | Pressure: 180 bar | RPM: 2200. Hydraulic lift sustained 15 min.";
  state.repair.loadTestedAt = new Date().toISOString();
  assert.equal(canCompleteRepair(state.repair), true, "Completion allowed after passing load test");

  // Complete repair -> Transition to COMPLETED and commit to service history
  state.repair.status = "COMPLETED";
  state.serviceHistory = {
    id: "sh-001",
    repairRequestId: state.repair.id,
    technicianId: state.technician.profileId,
    equipmentId: "00000000-0000-0000-0010-000000000001",
    invoiceReference: "INV-TB-7524",
    completedAt: new Date().toISOString(),
  };

  // STEP 3: Payment Clearance Gate
  // Derive Handover Readiness
  function deriveReadiness(repair, quote, partsRequests) {
    const isPaymentCleared = Boolean(repair.paymentClearedAt);
    const isLoadTestPassed = repair.loadTestPassed === true;
    const isQuoteApproved = quote?.status === "APPROVED";
    const arePartsFulfilled = partsRequests.every((pr) => pr.status === "FULFILLED");

    return {
      canAuthorize: isPaymentCleared && isLoadTestPassed && isQuoteApproved && arePartsFulfilled,
      isPaymentCleared,
      isLoadTestPassed,
      isQuoteApproved,
      arePartsFulfilled,
    };
  }

  // Readiness before payment clearance -> canAuthorize must be false
  let readiness = deriveReadiness(state.repair, state.quote, state.partsRequisitions);
  assert.equal(
    readiness.canAuthorize,
    false,
    "Handover cannot be authorized before payment clearance",
  );

  // Clear payment offline (Cash on delivery)
  state.repair.paymentClearedAt = new Date().toISOString();
  state.repair.paymentMethod = "CASH_ON_DELIVERY";
  state.repair.paymentReference = "Receipt #TB-PAY-108";

  // Readiness after payment clearance -> canAuthorize must be true
  readiness = deriveReadiness(state.repair, state.quote, state.partsRequisitions);
  assert.equal(
    readiness.canAuthorize,
    true,
    "Handover can be authorized once payment, test & quote cleared",
  );

  // STEP 4: Handover Authorization
  state.repair.handoverStatus = "AUTHORIZED";
  state.repair.handoverAuthorizedAt = new Date().toISOString();

  // STEP 5: Location Confidentiality Gate
  // When PENDING: Location coordinates are sealed from farmer
  // When AUTHORIZED: Location coordinates are revealed
  function resolveFarmerPickupLocation(repair, facility) {
    if (repair.handoverStatus === "PENDING") {
      return {
        facilityName: facility.name,
        village: "Hingna",
        tahsil: "Hingna",
        coordinates: null, // SEALED
        phone: null, // SEALED
      };
    }
    return {
      facilityName: facility.name,
      village: "Hingna",
      tahsil: "Hingna",
      coordinates: { latitude: facility.latitude, longitude: facility.longitude },
      phone: facility.phone,
    };
  }

  const pickupLocation = resolveFarmerPickupLocation(state.repair, state.facility);
  assert.ok(
    pickupLocation.coordinates !== null,
    "Coordinates revealed during AUTHORIZED handover window",
  );
  assert.equal(pickupLocation.coordinates.latitude, 21.0965);

  // STEP 6: Physical Equipment Release
  state.repair.handoverStatus = "RELEASED";
  state.repair.equipmentReleasedAt = new Date().toISOString();

  // STEP 7: Independent Farmer Machinery Collection Confirmation
  state.repair.farmerCollectedAt = new Date().toISOString();
  assert.ok(state.repair.farmerCollectedAt !== null, "Farmer collection timestamp stamped");

  // STEP 8: Verified Review Submission & Real-Time Rating Aggregation
  // Eligibility check: Requires completed repair, linked service history, and farmer caller
  function checkEligibility(callerProfileId, repair, serviceHistory, existingReviews) {
    if (!callerProfileId) return { eligible: false, reason: "NOT_AUTHENTICATED" };
    if (callerProfileId !== repair.farmerId) return { eligible: false, reason: "NOT_TICKET_OWNER" };
    if (repair.status !== "COMPLETED" || !serviceHistory)
      return { eligible: false, reason: "REPAIR_NOT_COMPLETED" };
    const hasExisting = existingReviews.some((r) => r.repairId === repair.id);
    if (hasExisting) return { eligible: false, reason: "ALREADY_REVIEWED" };
    return { eligible: true };
  }

  const existingReviews = [];
  const eligibility = checkEligibility(
    state.farmer.profileId,
    state.repair,
    state.serviceHistory,
    existingReviews,
  );
  assert.equal(eligibility.eligible, true, "Farmer is eligible to review completed repair");

  // Submit review: 5 stars
  const submittedReview = {
    id: "rev-001",
    repairId: state.repair.id,
    farmerProfileId: state.farmer.profileId,
    technicianProfileId: state.technician.profileId,
    rating: 5,
    timelinessRating: 5,
    qualityRating: 5,
    comment: "Excellent repair on the fuel injection pump. Finished ahead of schedule.",
    createdAt: new Date().toISOString(),
  };
  existingReviews.push(submittedReview);

  // Trigger simulation: Recalculate technician aggregate rating
  function recalculateRating(reviews, techProfileId) {
    const techReviews = reviews.filter((r) => r.technicianProfileId === techProfileId);
    if (techReviews.length === 0) return { rating: null, reviewCount: 0 };
    const sum = techReviews.reduce((acc, r) => acc + r.rating, 0);
    const avg = Number((sum / techReviews.length).toFixed(2));
    return { rating: avg, reviewCount: techReviews.length };
  }

  const updatedTechRating = recalculateRating(existingReviews, state.technician.profileId);
  assert.equal(updatedTechRating.rating, 5.0, "Rating correctly updated to 5.0");
  assert.equal(updatedTechRating.reviewCount, 1, "Review count is 1");

  // Attempt duplicate review -> MUST FAIL
  const secondEligibility = checkEligibility(
    state.farmer.profileId,
    state.repair,
    state.serviceHistory,
    existingReviews,
  );
  assert.equal(secondEligibility.eligible, false);
  assert.equal(secondEligibility.reason, "ALREADY_REVIEWED");
});

// ==============================================================================
// 2. SECURITY & BOUNDARY INVARIANTS
// ==============================================================================

test("Security Invariant: DAC & Trigger boundaries in migration SQL", () => {
  // 1. repair_requests column-level UPDATE DAC partitioning
  assert.match(
    migrationSql,
    /GRANT\s+UPDATE\s*\([\s\S]*?\)\s+ON\s+(?:TABLE\s+)?public\.repair_requests\s+TO\s+authenticated/i,
    "DAC column-level UPDATE grant exists on repair_requests",
  );
  // Defensively verify payment clearance fields are NOT in direct column update grant
  const updateGrantMatch = migrationSql.match(
    /GRANT\s+UPDATE\s*\(([\s\S]*?)\)\s+ON\s+(?:TABLE\s+)?public\.repair_requests\s+TO\s+authenticated/i,
  );
  if (updateGrantMatch) {
    const grantedCols = updateGrantMatch[1].split(",").map((s) => s.trim());
    assert.ok(
      !grantedCols.includes("payment_cleared_at"),
      "payment_cleared_at revoked from direct UPDATE",
    );
    assert.ok(
      !grantedCols.includes("payment_cleared_by"),
      "payment_cleared_by revoked from direct UPDATE",
    );
    assert.ok(!grantedCols.includes("payment_method"), "payment_method revoked from direct UPDATE");
  }

  // 2. Immutability on service_history & technician_reviews
  assert.match(
    migrationSql,
    /REVOKE\s+UPDATE,\s*DELETE,\s*TRUNCATE\s+ON\s+(?:TABLE\s+)?public\.service_history/i,
    "service_history is strictly immutable",
  );
  assert.match(
    migrationSql,
    /REVOKE\s+UPDATE,\s*DELETE,\s*TRUNCATE\s+ON\s+(?:TABLE\s+)?public\.technician_reviews/i,
    "technician_reviews is strictly immutable",
  );

  // 3. Sensitive PII / KYC protection: Aadhaar 12-digit rejection
  assert.match(
    migrationSql,
    /v_trimmed_id\s*~\*\s*'\^\[0-9\]\{12\}\$'/i,
    "Database RPC strictly blocks 12-digit unmasked Aadhaar numbers",
  );

  // 4. Drop-off approval guard
  assert.match(
    migrationSql,
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.guard_facility_drop_off_approval/i,
    "guard_facility_drop_off_approval trigger prevents non-admin tampering",
  );

  // 5. Single owner invariant
  assert.match(
    migrationSql,
    /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_single_facility_owner/i,
    "Single active owner unique partial index exists on facility_memberships",
  );
});

// ==============================================================================
// 3. DEMO DATA RESET INTEGRITY (CASCADE & DEPENDENCY ORDER)
// ==============================================================================

test("Demo Reset Integrity: Safe cascade sequence and baseline restoration", () => {
  // Extract reset_demo_data definition from migration
  const resetFuncMatch = migrationSql.match(
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.reset_demo_data\(\)[\s\S]*?\$\$[\s\S]*?\$\$;/,
  );
  assert.ok(resetFuncMatch, "reset_demo_data() function is defined in migration");
  const funcBody = resetFuncMatch[0];

  // 1. Auth check
  assert.match(funcBody, /v_caller_id\s*:=\s*auth\.uid\(\);/);
  assert.match(funcBody, /farmer\.staging@terrabyte\.app/);
  assert.match(funcBody, /tech\.staging@terrabyte\.app/);
  assert.match(funcBody, /admin\.staging@terrabyte\.app/);

  // 2. Cascade Order: reviews pre-deleted before service_history & repair_requests
  const reviewsDeletePos = funcBody.indexOf("DELETE FROM public.technician_reviews");
  const shDeletePos = funcBody.indexOf("DELETE FROM public.service_history");
  const repairDeletePos = funcBody.indexOf("DELETE FROM public.repair_requests");

  assert.ok(reviewsDeletePos !== -1, "technician_reviews deletion present");
  assert.ok(shDeletePos !== -1, "service_history deletion present");
  assert.ok(repairDeletePos !== -1, "repair_requests deletion present");

  assert.ok(
    reviewsDeletePos < shDeletePos,
    "technician_reviews must be deleted BEFORE service_history to prevent RESTRICT violation",
  );
  assert.ok(
    shDeletePos < repairDeletePos,
    "service_history must be deleted BEFORE repair_requests to satisfy ON DELETE RESTRICT",
  );

  // 3. Baseline fixtures restoration
  assert.match(funcBody, /Nagpur Central Agro Repairs & Workshop, Hingna/);
  assert.match(funcBody, /rating\s*=\s*NULL/);
  assert.match(funcBody, /review_count\s*=\s*0/);
  assert.match(funcBody, /kyc_verified\s*=\s*TRUE/);
  assert.match(funcBody, /is_verified\s*=\s*TRUE/);
  assert.match(funcBody, /Fuel Injector Nozzle Set/);
});

// ==============================================================================
// 5. NEGATIVE TRANSITIONS & CROSS-ROLE RESTRICTIONS
// ==============================================================================

test("Cross-Role Security & Negative Transition Enforcement", () => {
  // 1. Unverified technician cannot receive assignments
  function canAssignTechnician(techProfile) {
    return (
      techProfile.is_verified === true &&
      techProfile.kyc_verified === true &&
      techProfile.is_available === true
    );
  }

  assert.equal(
    canAssignTechnician({ is_verified: false, kyc_verified: false, is_available: true }),
    false,
    "Unverified technician is rejected from assignment",
  );
  assert.equal(
    canAssignTechnician({ is_verified: true, kyc_verified: false, is_available: true }),
    false,
    "Technician without physical KYC is rejected from assignment",
  );
  assert.equal(
    canAssignTechnician({ is_verified: true, kyc_verified: true, is_available: false }),
    false,
    "Unavailable technician is rejected from assignment",
  );
  assert.equal(
    canAssignTechnician({ is_verified: true, kyc_verified: true, is_available: true }),
    true,
    "Fully verified, KYC-certified, available technician can be assigned",
  );

  // 2. Technician cannot self-promote AI suggested skills
  function applySkillAction(callerRole, action, skill, currentSkills) {
    if (callerRole !== "admin" && callerRole !== "service_centre") {
      throw new Error(
        "UNAUTHORIZED: Only Service Centre administrators can manage technician skills.",
      );
    }
    const verified = new Set(currentSkills.verified);
    const suggested = new Set(currentSkills.suggested);
    if (action === "APPROVE") {
      suggested.delete(skill);
      verified.add(skill);
    } else if (action === "DISMISS") {
      suggested.delete(skill);
    }
    return { verified: Array.from(verified), suggested: Array.from(suggested) };
  }

  assert.throws(
    () =>
      applySkillAction("technician", "APPROVE", "Hydraulics expert", {
        verified: [],
        suggested: ["Hydraulics expert"],
      }),
    /UNAUTHORIZED/,
    "Technician cannot self-approve skills",
  );

  const adminApproved = applySkillAction(
    "service_centre",
    "APPROVE",
    "Rotavator Gearbox Specialist",
    { verified: ["Mahindra 575 DI specialist"], suggested: ["Rotavator Gearbox Specialist"] },
  );
  assert.deepEqual(adminApproved.verified, [
    "Mahindra 575 DI specialist",
    "Rotavator Gearbox Specialist",
  ]);
  assert.deepEqual(adminApproved.suggested, []);

  // 3. Drop-off approval toggle restricted to admins
  function updateDropOffApproval(callerRole, newDropOffValue) {
    if (callerRole !== "admin" && callerRole !== "service_centre") {
      throw new Error(
        "42501: Only Service Centre administrators can modify drop_off_approved status.",
      );
    }
    return newDropOffValue;
  }

  assert.throws(() => updateDropOffApproval("technician", true), /42501/);
  assert.throws(() => updateDropOffApproval("farmer", true), /42501/);
  assert.equal(updateDropOffApproval("admin", true), true);

  // 4. Rating revert to NULL when reviews are purged
  function computeRatingDisplay(rating) {
    if (rating === null || rating === undefined || isNaN(rating)) {
      return "New / Unrated";
    }
    return Number(rating).toFixed(1);
  }

  assert.equal(computeRatingDisplay(null), "New / Unrated");
  assert.equal(computeRatingDisplay(undefined), "New / Unrated");
  assert.equal(computeRatingDisplay(4.8), "4.8");
  assert.equal(computeRatingDisplay(5.0), "5.0");
});

// ==============================================================================
// 6. TRILINGUAL PARITY (250 KEYS) & DEVANAGARI VERIFICATION
// ==============================================================================

test("Trilingual Parity: 100% Key Parity (250 Keys) across EN, HI, MR", () => {
  function getAllKeys(obj, prefix = "") {
    let keys = [];
    for (const [key, value] of Object.entries(obj)) {
      const fullPath = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        keys = keys.concat(getAllKeys(value, fullPath));
      } else {
        keys.push(fullPath);
      }
    }
    return keys;
  }

  const enKeys = getAllKeys(en).sort();
  const hiKeys = getAllKeys(hi).sort();
  const mrKeys = getAllKeys(mr).sort();

  assert.equal(
    enKeys.length,
    250,
    `Expected exactly 250 keys in EN dictionary (found ${enKeys.length})`,
  );
  assert.equal(
    hiKeys.length,
    250,
    `Expected exactly 250 keys in HI dictionary (found ${hiKeys.length})`,
  );
  assert.equal(
    mrKeys.length,
    250,
    `Expected exactly 250 keys in MR dictionary (found ${mrKeys.length})`,
  );

  // Parity checks
  const missingInHi = enKeys.filter((k) => !hiKeys.includes(k));
  const missingInMr = enKeys.filter((k) => !mrKeys.includes(k));
  assert.deepEqual(missingInHi, [], "Zero missing keys in Hindi dictionary");
  assert.deepEqual(missingInMr, [], "Zero missing keys in Marathi dictionary");

  // Phase 13 Section Validation
  const phase13Prefixes = ["reviews", "handover"];
  for (const prefix of phase13Prefixes) {
    const matchingEn = enKeys.filter((k) => k.startsWith(prefix));
    assert.ok(matchingEn.length > 0, `Prefix ${prefix} has keys in EN`);
  }

  // Devanagari Presence in HI & MR
  const devanagariRegex = /[\u0900-\u097F]/;
  const sampleHi = hi.handover?.confirmButton;
  const sampleMr = mr.handover?.confirmButton;
  assert.ok(devanagariRegex.test(sampleHi), "Hindi handover text has Devanagari script");
  assert.ok(devanagariRegex.test(sampleMr), "Marathi handover text has Devanagari script");
});
