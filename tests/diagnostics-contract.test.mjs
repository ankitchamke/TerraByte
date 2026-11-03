import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  "supabase/migrations/20261103120000_phase11_visual_defect_diagnostics.sql",
);

function readMigrationSql() {
  assert.ok(fs.existsSync(MIGRATION_PATH), "Phase 11 migration file must exist");
  const raw = fs.readFileSync(MIGRATION_PATH, "utf8");
  return raw.replace(/\r\n/g, "\n");
}

test("Diagnostics Contract — Privilege Isolation & Catalog Grants", () => {
  const sql = readMigrationSql();

  // 1. save_repair_visual_diagnostic must revoke PUBLIC, anon, authenticated and grant strictly to service_role
  assert.match(
    sql,
    /revoke\s+all\s+on\s+function\s+public\.save_repair_visual_diagnostic\([^\)]+\)\s+from\s+public,\s*anon,\s*authenticated;/i,
    "save_repair_visual_diagnostic must revoke execution from public, anon, and authenticated",
  );
  assert.match(
    sql,
    /grant\s+execute\s+on\s+function\s+public\.save_repair_visual_diagnostic\([^\)]+\)\s+to\s+service_role;/i,
    "save_repair_visual_diagnostic must grant execution strictly to service_role",
  );

  // 2. finalize_repair_visual_diagnostic_failure must revoke PUBLIC, anon, authenticated and grant strictly to service_role
  assert.match(
    sql,
    /revoke\s+all\s+on\s+function\s+public\.finalize_repair_visual_diagnostic_failure\([^\)]+\)\s+from\s+public,\s*anon,\s*authenticated;/i,
    "finalize_repair_visual_diagnostic_failure must revoke execution from public, anon, and authenticated",
  );
  assert.match(
    sql,
    /grant\s+execute\s+on\s+function\s+public\.finalize_repair_visual_diagnostic_failure\([^\)]+\)\s+to\s+service_role;/i,
    "finalize_repair_visual_diagnostic_failure must grant execution strictly to service_role",
  );

  // 3. User-facing RPCs must revoke PUBLIC, anon, and service_role, granting strictly to authenticated
  const userRpcNames = [
    "claim_repair_visual_diagnostic",
    "revoke_repair_visual_consent",
    "grant_repair_visual_consent",
    "admin_repair_corrupted_diagnostic",
  ];

  for (const rpc of userRpcNames) {
    const revokePattern = new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${rpc}\\([^\\)]*\\)\\s+from\\s+public,\\s*anon,\\s*service_role;`, "i");
    assert.match(sql, revokePattern, `${rpc} must revoke from public, anon, and service_role`);

    const grantPattern = new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${rpc}\\([^\\)]*\\)\\s+to\\s+authenticated;`, "i");
    assert.match(sql, grantPattern, `${rpc} must grant execution to authenticated`);
  }
});

test("Diagnostics Contract — Authentication & Authorization Checks", () => {
  const sql = readMigrationSql();

  // Verify established helper functions are used
  assert.match(sql, /v_caller_profile_id\s+uuid\s*:=\s*public\.current_profile_id\(\);/i);
  assert.match(sql, /v_caller_role\s+public\.user_role\s*:=\s*public\.current_user_role\(\);/i);

  // Verify technician ticket assignment enforcement
  assert.match(
    sql,
    /if\s+v_record\.technician_id\s+is\s+null\s+then[\s\S]+?CANNOT_ACCESS_UNASSIGNED_TICKET/i,
    "Technicians must not access unassigned tickets",
  );
  assert.match(
    sql,
    /if\s+v_record\.technician_id\s+!=\s+v_caller_profile_id\s+then[\s\S]+?FORBIDDEN_TECHNICIAN_NOT_ASSIGNED/i,
    "Technicians must not access tickets assigned to others",
  );

  // Verify farmer-only consent granting
  assert.match(
    sql,
    /if\s+v_record\.farmer_id\s+!=\s+v_caller_profile_id\s+then[\s\S]+?FORBIDDEN_ONLY_OWNING_FARMER_CAN_GRANT_CONSENT/i,
    "Only the owning farmer can grant AI consent",
  );
});

test("Diagnostics Contract — Fail-Closed Consent Evaluation", () => {
  const sql = readMigrationSql();

  // Strict boolean JSON equality without casting
  assert.match(
    sql,
    /jsonb_typeof\(v_consent->'optInGranted'\)\s*=\s*'boolean'\s+and\s+\(v_consent->'optInGranted'\)\s*=\s*'true'::jsonb/i,
    "Consent must check exact JSON boolean true",
  );

  // Verify re-grant blocks while PROCESSING
  assert.match(
    sql,
    /if\s+v_status\s*=\s*'PROCESSING'\s+then[\s\S]+?CANNOT_GRANT_CONSENT_WHILE_PROCESSING/i,
    "Consent re-grant must be rejected while actively processing",
  );
});

test("Diagnostics Contract — Bounded Integer Parsing & Safe State Machine", () => {
  const sql = readMigrationSql();

  // Bounded regex patterns
  assert.match(sql, /v_raw_val\s*~\s*'\^\[0-3\]\$'/i, "Attempts must be parsed with strict ^[0-3]$ regex");
  assert.match(sql, /v_raw_val\s*~\s*'\^\[0-5\]\$'/i, "Rescan count must be parsed with strict ^[0-5]$ regex");

  // NOT_REQUESTED transition with attempts >= 3 into FAILED
  assert.match(
    sql,
    /if\s+v_attempts\s*>=\s*c_max_attempts\s+then[\s\S]+?'status',\s*'FAILED'[\s\S]+?MAX_ATTEMPTS_EXCEEDED/i,
    "Exhausted attempts in NOT_REQUESTED must atomically transition to FAILED",
  );

  // Cooldown enforcement (30 seconds)
  assert.match(
    sql,
    /c_cooldown_seconds\s+constant\s+interval\s*:=\s*interval\s+'30 seconds';/i,
    "Deterministic 30-second cooldown constant must exist",
  );

  // UTC formatting verification
  assert.match(
    sql,
    /to_char\(c_now\s+at\s+time\s+zone\s+'UTC',\s*'YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"'\)/i,
    "Timestamps must use explicit UTC timezone conversion",
  );
});

test("Diagnostics Contract — Failure Finalization Sanitization & Status Validation", () => {
  const sql = readMigrationSql();

  // IS DISTINCT FROM 'PROCESSING'
  assert.match(
    sql,
    /\(v_vd->>'status'\)\s+is\s+distinct\s+from\s+'PROCESSING'/i,
    "Failure finalizer must use IS DISTINCT FROM 'PROCESSING' to reject NULL",
  );

  // Error code allowlist
  assert.match(
    sql,
    /p_error_code\s+in\s+\('TIMEOUT',\s*'RATE_LIMITED',\s*'PROVIDER_UNAVAILABLE',\s*'SCHEMA_VALIDATION_ERROR',\s*'CONFIG_ERROR',\s*'NETWORK_ERROR'\)/i,
    "Failure finalizer must enforce allowlisted error codes",
  );
});
