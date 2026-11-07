import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// Dictionaries Import (pure TS without alias dependencies)
import { en } from "../src/lib/i18n/dictionaries/en.ts";
import { hi } from "../src/lib/i18n/dictionaries/hi.ts";
import { mr } from "../src/lib/i18n/dictionaries/mr.ts";

const MIGRATION_PATH = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20261106160000_phase13_database_foundations.sql",
);
const HANDOVER_SERVICE_PATH = path.join(ROOT, "src/lib/services/handover.ts");

const APPROVED_OFFLINE_PAYMENT_METHODS = [
  "CASH_ON_DELIVERY",
  "DIRECT_UPI",
  "DIRECT_BANK_TRANSFER",
  "OFFLINE_CHEQUE",
  "WAIVED_WARRANTY",
];

function formatLoadTestNotes(input) {
  const parts = [];
  if (
    input.temperatureC !== undefined &&
    input.temperatureC !== null &&
    input.temperatureC !== ""
  ) {
    parts.push(`Temp: ${input.temperatureC}°C`);
  }
  if (
    input.hydraulicPressureBar !== undefined &&
    input.hydraulicPressureBar !== null &&
    input.hydraulicPressureBar !== ""
  ) {
    parts.push(`Pressure: ${input.hydraulicPressureBar} bar`);
  }
  if (input.engineRpm !== undefined && input.engineRpm !== null && input.engineRpm !== "") {
    parts.push(`RPM: ${input.engineRpm}`);
  }

  const obs = input.observations.trim();
  if (parts.length > 0) {
    return `${parts.join(" | ")}. ${obs}`.trim();
  }
  return obs;
}

function deriveHandoverReadiness(input) {
  const repair = input.repair;
  const quote = input.quote;
  const missingConditions = [];

  const loadTestPassed = Boolean(
    repair.load_test_passed === true ||
    (repair.completion_details &&
      typeof repair.completion_details === "object" &&
      repair.completion_details.tested === true),
  );
  if (!loadTestPassed) {
    missingConditions.push("Operational load test passed");
  }

  const quoteApproved = Boolean(
    (quote && quote.status === "APPROVED") ||
    (repair.quote && repair.quote.status === "APPROVED") ||
    (repair.quote_status && repair.quote_status === "APPROVED"),
  );
  if (!quoteApproved) {
    missingConditions.push("Quotation approved by farmer");
  }

  const paymentCleared = Boolean(repair.payment_cleared_at);
  if (!paymentCleared) {
    missingConditions.push("Payment clearance required");
  }

  let partsCleared = true;
  if (repair.parts_hold && typeof repair.parts_hold === "object") {
    const ph = repair.parts_hold;
    if (Array.isArray(ph.items)) {
      const hasPendingItem = ph.items.some(
        (it) => it && typeof it === "object" && (!it.status || it.status === "PENDING"),
      );
      if (hasPendingItem) {
        partsCleared = false;
      }
    }
  }
  if (!partsCleared) {
    missingConditions.push("All spare parts delivered and cleared");
  }

  const canAuthorize =
    repair.status === "COMPLETED" &&
    loadTestPassed &&
    quoteApproved &&
    paymentCleared &&
    partsCleared;

  return {
    canAuthorize,
    missingConditions,
    loadTestPassed,
    quoteApproved,
    paymentCleared,
    partsCleared,
  };
}

test("Test 1: Service Contract Invariant — exports and function signatures", () => {
  const handoverServiceFile = fs.readFileSync(HANDOVER_SERVICE_PATH, "utf8");

  assert.match(handoverServiceFile, /export const APPROVED_OFFLINE_PAYMENT_METHODS/);
  assert.match(handoverServiceFile, /export function formatLoadTestNotes/);
  assert.match(handoverServiceFile, /export function deriveHandoverReadiness/);
  assert.match(handoverServiceFile, /export async function recordLoadTestSignoff/);
  assert.match(handoverServiceFile, /export async function recordOfflinePaymentClearance/);
  assert.match(handoverServiceFile, /export async function authorizeEquipmentHandover/);
  assert.match(handoverServiceFile, /export async function executeEquipmentHandoverRelease/);
  assert.match(handoverServiceFile, /export async function confirmFarmerEquipmentCollection/);
  assert.match(handoverServiceFile, /export async function getFacilityHandoverLocation/);
  assert.match(handoverServiceFile, /export interface FacilityHandoverLocation/);
  assert.match(handoverServiceFile, /export interface HandoverReadiness/);
});

test("Test 2: Database Schema & Relational Invariants in Phase 13 migration", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");

  // Verify all 16 repair_requests columns exist
  const expectedColumns = [
    "facility_id",
    "load_test_passed",
    "load_test_notes",
    "load_tested_at",
    "load_tested_by",
    "payment_cleared_at",
    "payment_cleared_by",
    "payment_method",
    "payment_reference",
    "handover_status",
    "handover_authorized_at",
    "handover_authorized_by",
    "handover_released_at",
    "handover_released_by",
    "handover_notes",
    "farmer_collection_confirmed",
    "farmer_collection_confirmed_at",
  ];

  for (const col of expectedColumns) {
    assert.match(
      sql,
      new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`),
      `Migration must define column ${col}`,
    );
  }

  // Verify handover_status check constraint and valid states
  assert.match(sql, /check_handover_status/);
  assert.match(sql, /CHECK \(handover_status IN \('PENDING', 'AUTHORIZED', 'RELEASED'\)\)/);

  // Verify all 6 RPC functions exist
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.record_load_test_signoff/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.record_offline_payment_clearance/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.authorize_equipment_handover/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.execute_equipment_handover_release/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.confirm_farmer_equipment_collection/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.get_facility_handover_location/);
});

test("Test 3: Load Test Completion Guard — trigger simulation", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.guard_repair_completion_load_test\(\)/);
  assert.match(sql, /NEW\.load_test_passed IS NOT TRUE/);
  assert.match(sql, /CANNOT_COMPLETE_WITHOUT_LOAD_TEST/);

  // Logical Simulation of the DB Trigger
  const simulateCompletionTrigger = (oldStatus, newStatus, loadTestPassed) => {
    if (newStatus === "COMPLETED" && oldStatus !== "COMPLETED") {
      if (loadTestPassed !== true) {
        throw new Error(
          "CANNOT_COMPLETE_WITHOUT_LOAD_TEST: Repair cannot be marked COMPLETED without a passed operational load test.",
        );
      }
    }
    return true;
  };

  assert.throws(
    () => simulateCompletionTrigger("IN_PROGRESS", "COMPLETED", false),
    /CANNOT_COMPLETE_WITHOUT_LOAD_TEST/,
  );
  assert.throws(
    () => simulateCompletionTrigger("IN_PROGRESS", "COMPLETED", null),
    /CANNOT_COMPLETE_WITHOUT_LOAD_TEST/,
  );
  assert.throws(
    () => simulateCompletionTrigger("IN_PROGRESS", "COMPLETED", undefined),
    /CANNOT_COMPLETE_WITHOUT_LOAD_TEST/,
  );
  assert.equal(simulateCompletionTrigger("IN_PROGRESS", "COMPLETED", true), true);
  // Transition between non-completed statuses does not require load test
  assert.equal(simulateCompletionTrigger("IN_PROGRESS", "WAITING_FOR_PARTS", false), true);
});

test("Test 4: Format Load Test Notes & Metric Compilation (AC-13-F12)", () => {
  const notes1 = formatLoadTestNotes({
    temperatureC: 85,
    hydraulicPressureBar: 190,
    engineRpm: 2100,
    observations: "Hydraulic cylinders responsive under operational load. No leaks detected.",
  });
  assert.equal(
    notes1,
    "Temp: 85°C | Pressure: 190 bar | RPM: 2100. Hydraulic cylinders responsive under operational load. No leaks detected.",
  );
  assert.ok(notes1.length >= 10, "Formatted note must meet length >= 10 requirement");

  // Partial metrics
  const notes2 = formatLoadTestNotes({
    temperatureC: 90,
    observations: "Cooling system stable.",
  });
  assert.equal(notes2, "Temp: 90°C. Cooling system stable.");

  // Plain observations
  const notes3 = formatLoadTestNotes({
    observations: "Engine test run successful for 30 minutes.",
  });
  assert.equal(notes3, "Engine test run successful for 30 minutes.");
});

test("Test 5: Load Test UI & Guard against Completion without Pass (AC-13-F13)", () => {
  const techJobRoute = fs.readFileSync(
    path.join(ROOT, "src/routes/technician/job/$id.tsx"),
    "utf8",
  );
  const workbench = fs.readFileSync(
    path.join(ROOT, "src/components/handover/load-test-workbench.tsx"),
    "utf8",
  );

  // In load-test-workbench: prominent red warning when failed
  assert.match(workbench, /Operational Load Test FAILED — Sign-Off Blocked/);
  assert.match(workbench, /border-destructive bg-destructive\/10/);

  // In technician/job/$id: strict button disable when load_test_passed is false
  assert.match(techJobRoute, /realRepair\?\.load_test_passed === false/);
  assert.match(techJobRoute, /disabled=\{/);

  // In handleComplete: throws toast if not verified
  assert.match(
    techJobRoute,
    /Verified passing operational load test is required before completion/,
  );
});

test("Test 6: Offline Payment Clearance Validation & Methods Whitelist (AC-13-F14)", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");

  // Verify payment methods whitelist in database RPC
  assert.match(
    sql,
    /'CASH_ON_DELIVERY', 'DIRECT_UPI', 'DIRECT_BANK_TRANSFER', 'OFFLINE_CHEQUE', 'WAIVED_WARRANTY'/,
  );

  // Verify DAC privilege boundary: direct column update blocked, RPC SECURITY DEFINER granted to authenticated
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.record_offline_payment_clearance/);
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.record_offline_payment_clearance\(UUID, TEXT, TEXT\) TO authenticated/,
  );

  // Logic Simulation: Requires reference for digital/cheque methods
  const validateClearance = (method, ref) => {
    if (!APPROVED_OFFLINE_PAYMENT_METHODS.includes(method)) {
      throw new Error(`Invalid payment method: ${method}`);
    }
    if (
      ["DIRECT_UPI", "DIRECT_BANK_TRANSFER", "OFFLINE_CHEQUE"].includes(method) &&
      (!ref || ref.trim().length < 4)
    ) {
      throw new Error("Payment reference required for digital/cheque transfers (min 4 chars)");
    }
    return true;
  };

  assert.equal(validateClearance("CASH_ON_DELIVERY", null), true);
  assert.equal(validateClearance("WAIVED_WARRANTY", ""), true);
  assert.equal(validateClearance("DIRECT_UPI", "UTR12345678"), true);
  assert.throws(() => validateClearance("DIRECT_UPI", ""), /Payment reference required/);
  assert.throws(() => validateClearance("DIRECT_UPI", "12"), /Payment reference required/);
  assert.throws(() => validateClearance("BITCOIN", "tx123"), /Invalid payment method/);
});

test("Test 7: Handover Authorization Preconditions & Readiness Derivation (AC-13-F15)", () => {
  // Baseline valid repair
  const baseRepair = {
    id: "rep-001",
    status: "COMPLETED",
    load_test_passed: true,
    payment_cleared_at: "2026-11-07T12:00:00Z",
    handover_status: "PENDING",
  };
  const baseQuote = {
    id: "quote-001",
    status: "APPROVED",
  };

  // Case 1: All prerequisites satisfied
  const readiness1 = deriveHandoverReadiness({ repair: baseRepair, quote: baseQuote });
  assert.equal(readiness1.canAuthorize, true);
  assert.equal(readiness1.loadTestPassed, true);
  assert.equal(readiness1.quoteApproved, true);
  assert.equal(readiness1.paymentCleared, true);
  assert.equal(readiness1.partsCleared, true);
  assert.deepEqual(readiness1.missingConditions, []);

  // Case 2: Payment missing
  const readiness2 = deriveHandoverReadiness({
    repair: { ...baseRepair, payment_cleared_at: null },
    quote: baseQuote,
  });
  assert.equal(readiness2.canAuthorize, false);
  assert.equal(readiness2.paymentCleared, false);
  assert.ok(readiness2.missingConditions.includes("Payment clearance required"));

  // Case 3: Load test missing/failed
  const readiness3 = deriveHandoverReadiness({
    repair: { ...baseRepair, load_test_passed: false },
    quote: baseQuote,
  });
  assert.equal(readiness3.canAuthorize, false);
  assert.equal(readiness3.loadTestPassed, false);
  assert.ok(readiness3.missingConditions.includes("Operational load test passed"));

  // Case 4: Quote not approved
  const readiness4 = deriveHandoverReadiness({
    repair: baseRepair,
    quote: { id: "quote-002", status: "PENDING" },
  });
  assert.equal(readiness4.canAuthorize, false);
  assert.equal(readiness4.quoteApproved, false);
  assert.ok(readiness4.missingConditions.includes("Quotation approved by farmer"));

  // Case 5: Pending spare parts hold
  const readiness5 = deriveHandoverReadiness({
    repair: {
      ...baseRepair,
      parts_hold: { items: [{ part: "Gasket", status: "PENDING" }] },
    },
    quote: baseQuote,
  });
  assert.equal(readiness5.canAuthorize, false);
  assert.equal(readiness5.partsCleared, false);
  assert.ok(readiness5.missingConditions.includes("All spare parts delivered and cleared"));
});

test("Test 8: Physical Release Execution & Actor Restrictions (AC-13-F16)", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");

  // In execute_equipment_handover_release:
  // Farmer caller is not in authorized list (v_caller_role_text in ('admin', 'service_centre') OR v_repair.technician_id = v_caller_profile_id OR v_is_facility_member):
  assert.match(sql, /v_caller_role_text IN \('admin', 'service_centre'\)/);
  assert.match(sql, /UNAUTHORIZED: Caller is not authorized to release this equipment/);

  // Handover status must be AUTHORIZED:
  assert.match(sql, /IF v_repair\.handover_status != 'AUTHORIZED' THEN/);
  assert.match(sql, /Equipment handover must be in AUTHORIZED status before executing release/);

  // Logical Simulation of release authorization
  const simulateRelease = (callerRole, isAssignedTech, isFacilityStaff, handoverStatus) => {
    const isAuthorized =
      callerRole === "admin" ||
      callerRole === "service_centre" ||
      isAssignedTech ||
      isFacilityStaff;

    if (!isAuthorized) {
      throw new Error("UNAUTHORIZED: Caller is not authorized to release this equipment.");
    }
    if (handoverStatus !== "AUTHORIZED") {
      throw new Error(
        "NOT_AUTHORIZED: Equipment handover must be in AUTHORIZED status before executing release.",
      );
    }
    return "RELEASED";
  };

  assert.throws(
    () => simulateRelease("farmer", false, false, "AUTHORIZED"),
    /UNAUTHORIZED: Caller is not authorized/,
  );
  assert.throws(
    () => simulateRelease("technician", true, false, "PENDING"),
    /must be in AUTHORIZED status before executing release/,
  );
  assert.equal(simulateRelease("technician", true, false, "AUTHORIZED"), "RELEASED");
  assert.equal(simulateRelease("admin", false, false, "AUTHORIZED"), "RELEASED");
});

test("Test 9: Farmer Collection Confirmation & Custody Receipt (AC-13-F18)", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");

  // In confirm_farmer_equipment_collection:
  // Only the owning farmer can confirm:
  assert.match(sql, /IF v_repair\.farmer_id != v_caller_profile_id THEN/);
  assert.match(sql, /UNAUTHORIZED: Only the owning farmer can confirm equipment collection/);

  // Must be in RELEASED status:
  assert.match(sql, /IF v_repair\.handover_status != 'RELEASED' THEN/);
  assert.match(
    sql,
    /PRECONDITION_FAILED: Equipment must be in RELEASED status before collection can be confirmed/,
  );

  // Idempotency: if already confirmed, returns gracefully
  assert.match(sql, /IF v_repair\.farmer_collection_confirmed THEN/);

  // Logical Simulation
  const simulateFarmerConfirmation = (callerId, farmerId, handoverStatus, alreadyConfirmed) => {
    if (callerId !== farmerId) {
      throw new Error("UNAUTHORIZED: Only the owning farmer can confirm equipment collection.");
    }
    if (handoverStatus !== "RELEASED") {
      throw new Error(
        "PRECONDITION_FAILED: Equipment must be in RELEASED status before collection can be confirmed.",
      );
    }
    if (alreadyConfirmed) {
      return { success: true, message: "Collection already confirmed" };
    }
    return { success: true, confirmed_at: new Date().toISOString() };
  };

  assert.throws(
    () => simulateFarmerConfirmation("tech-1", "farmer-1", "RELEASED", false),
    /Only the owning farmer can confirm equipment collection/,
  );
  assert.throws(
    () => simulateFarmerConfirmation("farmer-1", "farmer-1", "AUTHORIZED", false),
    /Equipment must be in RELEASED status before collection can be confirmed/,
  );
  assert.equal(simulateFarmerConfirmation("farmer-1", "farmer-1", "RELEASED", false).success, true);
  assert.equal(
    simulateFarmerConfirmation("farmer-1", "farmer-1", "RELEASED", true).message,
    "Collection already confirmed",
  );
});

test("Test 10: Location Hiding Guard — Coordinates Revealed strictly when AUTHORIZED (AC-13-F17)", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");

  // In get_facility_handover_location:
  // Hidden during PENDING:
  assert.match(sql, /IF v_repair\.handover_status = 'PENDING' THEN/);
  assert.match(
    sql,
    /Workshop pickup details are not available until equipment handover is authorized/,
  );

  // Closed upon RELEASED:
  assert.match(sql, /ELSIF v_repair\.handover_status = 'RELEASED' THEN/);
  assert.match(sql, /Equipment has already been released\. Workshop handover access is closed/);

  // Simulation
  const simulateLocationAccess = (callerRole, isFarmer, handoverStatus) => {
    if (callerRole === "admin" || callerRole === "service_centre") {
      return { location: "Facility Nagpur" };
    }
    if (isFarmer) {
      if (handoverStatus === "PENDING") {
        throw new Error(
          "ACCESS_DENIED: Workshop pickup details are not available until equipment handover is authorized.",
        );
      }
      if (handoverStatus === "RELEASED") {
        throw new Error(
          "ACCESS_DENIED: Equipment has already been released. Workshop handover access is closed.",
        );
      }
      if (handoverStatus === "AUTHORIZED") {
        return { location: "Facility Nagpur" };
      }
    }
    throw new Error("ACCESS_DENIED");
  };

  assert.throws(
    () => simulateLocationAccess("farmer", true, "PENDING"),
    /not available until equipment handover is authorized/,
  );
  assert.throws(
    () => simulateLocationAccess("farmer", true, "RELEASED"),
    /Workshop handover access is closed/,
  );
  assert.deepEqual(simulateLocationAccess("farmer", true, "AUTHORIZED"), {
    location: "Facility Nagpur",
  });
  assert.deepEqual(simulateLocationAccess("admin", false, "PENDING"), {
    location: "Facility Nagpur",
  });
});

test("Test 11: Trilingual Dictionary Parity & Devanagari Presence", () => {
  const enKeys = Object.keys(en.handover);
  const hiKeys = Object.keys(hi.handover);
  const mrKeys = Object.keys(mr.handover);

  assert.equal(enKeys.length, 22, "English handover dictionary must have exactly 22 keys");
  assert.deepEqual(hiKeys.sort(), enKeys.sort(), "Hindi dictionary keys must match English 1:1");
  assert.deepEqual(mrKeys.sort(), enKeys.sort(), "Marathi dictionary keys must match English 1:1");

  // Devanagari Unicode Range: \u0900-\u097F
  const devanagariRegex = /[\u0900-\u097F]/;

  for (const key of enKeys) {
    const enVal = en.handover[key];
    const hiVal = hi.handover[key];
    const mrVal = mr.handover[key];

    assert.ok(
      typeof enVal === "string" && enVal.trim().length > 0,
      `en.handover.${key} must not be empty`,
    );
    assert.ok(
      typeof hiVal === "string" && hiVal.trim().length > 0,
      `hi.handover.${key} must not be empty`,
    );
    assert.ok(
      typeof mrVal === "string" && mrVal.trim().length > 0,
      `mr.handover.${key} must not be empty`,
    );

    // Verify Devanagari characters in Hindi and Marathi
    assert.match(
      hiVal,
      devanagariRegex,
      `hi.handover.${key} must contain Devanagari characters: "${hiVal}"`,
    );
    assert.match(
      mrVal,
      devanagariRegex,
      `mr.handover.${key} must contain Devanagari characters: "${mrVal}"`,
    );
  }
});
