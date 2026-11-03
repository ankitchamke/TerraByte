import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  VisualDiagnosticResponseSchema,
  DIAGNOSTIC_LIMITS,
  getSanitizedErrorMessage,
  ALLOWED_DIAGNOSTIC_ERROR_CODES,
} from "../src/lib/types/visual-diagnostics.ts";

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  "supabase/migrations/20261103120000_phase11_visual_defect_diagnostics.sql",
);

function readMigrationSql() {
  assert.ok(fs.existsSync(MIGRATION_PATH), "Phase 11 migration file must exist");
  const raw = fs.readFileSync(MIGRATION_PATH, "utf8");
  return raw.replace(/\r\n/g, "\n");
}

test("Parts Matching — Zod Response Schema Validation", () => {
  const validResponse = {
    visualConfidence: "HIGH",
    overallVisualSummary: "Hydraulic lift cylinder seal leakage observed along ram housing.",
    visualAnomalies: [
      {
        system: "Hydraulics",
        defectType: "Fluid leak",
        severity: "HIGH",
        observation: "Heavy hydraulic oil weeping around primary ram wiper seal.",
        recommendation: "Replace lift cylinder seal kit and check oil level.",
      },
    ],
    stagedParts: [
      {
        partNumber: "AL120788",
        estimatedQuantity: 1,
        confidence: "HIGH",
        reasoning: "Lift cylinder seal kit matches observed leak on JD 5050D.",
      },
    ],
    safetyGuidance: [
      "Relieve all hydraulic line pressure before disconnecting fittings.",
      "Support implement mechanically before inspecting cylinder.",
    ],
  };

  // 1. Valid payload must pass
  const parsed = VisualDiagnosticResponseSchema.parse(validResponse);
  assert.equal(parsed.visualConfidence, "HIGH");
  assert.equal(parsed.stagedParts.length, 1);
  assert.equal(parsed.stagedParts[0].partNumber, "AL120788");

  // 2. Missing summary must fail
  assert.throws(() => {
    VisualDiagnosticResponseSchema.parse({
      ...validResponse,
      overallVisualSummary: "",
    });
  });

  // 3. Invalid confidence enum must fail
  assert.throws(() => {
    VisualDiagnosticResponseSchema.parse({
      ...validResponse,
      visualConfidence: "EXTREMELY_HIGH",
    });
  });

  // 4. Invalid estimatedQuantity must fail
  assert.throws(() => {
    VisualDiagnosticResponseSchema.parse({
      ...validResponse,
      stagedParts: [
        {
          partNumber: "AL120788",
          estimatedQuantity: 99, // exceeds max 10
        },
      ],
    });
  });
});

test("Parts Matching — Catalogue Model Compatibility Rules", () => {
  const sql = readMigrationSql();

  // 1. Verify equipment make and model are queried
  assert.match(sql, /select\s+make,\s*model\s+into\s+v_eq_make,\s*v_eq_model/i);

  // 2. Verify machine_model combination
  assert.match(sql, /v_machine_model\s*:=\s*trim\(concat\(v_eq_make,\s*' ',\s*v_eq_model\)\);/i);

  // 3. Verify compatible_models array check
  assert.match(
    sql,
    /v_machine_model\s*=\s*any\(v_db_part\.compatible_models\)\s+or\s+trim\(v_eq_model\)\s*=\s*any\(v_db_part\.compatible_models\)/i,
    "Catalogue check must verify machine model against compatible_models array",
  );

  // 4. Verify that unestablished compatibility omits the part from staging
  assert.match(
    sql,
    /cardinality\(v_db_part\.compatible_models\)\s*>\s*0/i,
    "Empty compatible_models must not be assumed universal",
  );
});

test("Parts Matching — Zero Stock Mutation Invariant", () => {
  const sql = readMigrationSql();

  // Find save_repair_visual_diagnostic body
  const saveRpcStart = sql.indexOf("function public.save_repair_visual_diagnostic");
  assert.ok(saveRpcStart > 0);
  const saveRpcEnd = sql.indexOf("function public.finalize_repair_visual_diagnostic_failure");
  assert.ok(saveRpcEnd > saveRpcStart);
  const saveRpcBody = sql.substring(saveRpcStart, saveRpcEnd);

  // Verify save RPC only updates repair_requests
  assert.match(saveRpcBody, /update\s+public\.repair_requests/i);

  // Must NEVER update service_centre_parts
  assert.doesNotMatch(
    saveRpcBody,
    /update\s+public\.service_centre_parts/i,
    "save_repair_visual_diagnostic must never update service_centre_parts",
  );

  // Must NEVER insert into stock audit log
  assert.doesNotMatch(
    saveRpcBody,
    /insert\s+into\s+public\.service_centre_stock_audit/i,
    "save_repair_visual_diagnostic must never write to stock audit",
  );
});

test("Parts Matching — Concrete Payload Boundaries & Sanitized Error Codes", () => {
  // Verify concrete limits
  assert.equal(DIAGNOSTIC_LIMITS.MAX_PHOTOS, 4);
  assert.equal(DIAGNOSTIC_LIMITS.MAX_RAW_PHOTO_BYTES, 4 * 1024 * 1024);
  assert.equal(DIAGNOSTIC_LIMITS.MAX_TOTAL_PAYLOAD_BYTES, 16 * 1024 * 1024);
  assert.equal(DIAGNOSTIC_LIMITS.GEMINI_TIMEOUT_MS, 9000);
  assert.equal(DIAGNOSTIC_LIMITS.CONSENT_POLL_INTERVAL_MS, 750);

  // Verify allowlisted error codes
  for (const code of ALLOWED_DIAGNOSTIC_ERROR_CODES) {
    const msg = getSanitizedErrorMessage(code);
    assert.ok(typeof msg === "string" && msg.length > 5);
    // Ensure no provider names, stack traces, or secrets in messages
    assert.doesNotMatch(msg, /Google|Gemini|API_KEY|Bearer|Trace/i);
  }
});
