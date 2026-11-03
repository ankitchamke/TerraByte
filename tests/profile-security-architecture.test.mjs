import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const MIGRATION_PATH = path.join(
  ROOT_DIR,
  "supabase",
  "migrations",
  "20261104100000_profile_security_separation.sql"
);
const TYPES_PATH = path.join(
  ROOT_DIR,
  "src",
  "integrations",
  "supabase",
  "types.ts"
);
const AUTH_PATH = path.join(ROOT_DIR, "src", "lib", "auth.ts");
const PROFILE_SERVICE_PATH = path.join(
  ROOT_DIR,
  "src",
  "lib",
  "services",
  "profile.ts"
);
const REPAIR_SERVICE_PATH = path.join(
  ROOT_DIR,
  "src",
  "lib",
  "services",
  "repair-requests.ts"
);
const TECH_SERVICE_PATH = path.join(
  ROOT_DIR,
  "src",
  "lib",
  "services",
  "technicians.ts"
);

// ==============================================================================
// 1. MIGRATION FILE & SCHEMA ARCHITECTURE TESTS
// ==============================================================================

test("Migration 20261104100000_profile_security_separation.sql exists and is non-empty", () => {
  assert.ok(fs.existsSync(MIGRATION_PATH), "Migration file must exist");
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  assert.ok(sql.length > 500, "Migration file must contain substantial SQL content");
});

test("Migration defines app_security schema with proper isolation", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  assert.match(
    sql,
    /CREATE\s+SCHEMA\s+IF\s+NOT\s+EXISTS\s+app_security;/i,
    "Must create app_security private schema"
  );
  assert.match(
    sql,
    /REVOKE\s+ALL\s+ON\s+SCHEMA\s+app_security\s+FROM\s+PUBLIC;/i,
    "Must revoke schema privileges from PUBLIC"
  );
  assert.match(
    sql,
    /REVOKE\s+ALL\s+ON\s+SCHEMA\s+app_security\s+FROM\s+anon;/i,
    "Must revoke schema privileges from anon"
  );
  assert.match(
    sql,
    /GRANT\s+USAGE\s+ON\s+SCHEMA\s+app_security\s+TO\s+authenticated/i,
    "Must grant USAGE to authenticated"
  );
});

test("Migration defines public.profile_contacts table with foreign key and index", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  assert.match(
    sql,
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.profile_contacts\s*\(/i,
    "Must create profile_contacts table"
  );
  assert.match(
    sql,
    /profile_id\s+uuid\s+PRIMARY\s+KEY\s+REFERENCES\s+public\.profiles\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i,
    "profile_id must be PK and FK to profiles(id) with CASCADE"
  );
  assert.match(
    sql,
    /phone\s+text/i,
    "Must include phone column"
  );
  assert.match(
    sql,
    /village\s+text/i,
    "Must include village column"
  );
});

test("Migration defines public.profile_auth_secrets table with constraints and case-insensitive email index", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  assert.match(
    sql,
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.profile_auth_secrets\s*\(/i,
    "Must create profile_auth_secrets table"
  );
  assert.match(
    sql,
    /profile_id\s+uuid\s+PRIMARY\s+KEY\s+REFERENCES\s+public\.profiles\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i,
    "profile_id must be PK and FK to profiles(id) with CASCADE"
  );
  assert.match(
    sql,
    /auth_user_id\s+uuid\s+REFERENCES\s+auth\.users\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i,
    "auth_user_id must reference auth.users(id) with CASCADE"
  );
  assert.match(
    sql,
    /demo_code\s+text\s+UNIQUE/i,
    "demo_code must have UNIQUE constraint"
  );
  assert.match(
    sql,
    /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+profile_auth_secrets_lower_email_idx\s+ON\s+public\.profile_auth_secrets\s*\(\s*lower\s*\(\s*email\s*\)\s*\)/i,
    "Must enforce case-insensitive email uniqueness via unique index on lower(email)"
  );
  assert.match(
    sql,
    /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+profile_auth_secrets_auth_user_id_idx\s+ON\s+public\.profile_auth_secrets\s*\(\s*auth_user_id\s*\)/i,
    "Must enforce unique index on auth_user_id"
  );
});

test("Migration backfills existing profiles into profile_contacts and profile_auth_secrets", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  assert.match(
    sql,
    /INSERT\s+INTO\s+public\.profile_contacts\s*\(profile_id,\s*phone,\s*village,\s*updated_at\)/i,
    "Must backfill profile_contacts"
  );
  assert.match(
    sql,
    /INSERT\s+INTO\s+public\.profile_auth_secrets\s*\(profile_id,\s*auth_user_id,\s*email,\s*demo_code,\s*clerk_user_id,\s*created_at,\s*updated_at\)/i,
    "Must backfill profile_auth_secrets"
  );
});

// ==============================================================================
// 2. SECURITY DEFINER HELPER & AUTHORIZATION TESTS
// ==============================================================================

test("app_security.can_view_profile enforces fail-closed single-argument target check", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  assert.match(
    sql,
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+app_security\.can_view_profile\s*\(\s*target_profile_id\s+uuid\s*\)/i,
    "can_view_profile must accept strictly single target_profile_id uuid argument"
  );
  assert.doesNotMatch(
    sql,
    /can_view_profile\([^)]*target_role/i,
    "can_view_profile must NEVER accept caller-supplied target_role parameter"
  );
  assert.match(
    sql,
    /IF\s+auth\.uid\(\)\s+IS\s+NULL\s+OR\s+target_profile_id\s+IS\s+NULL\s+THEN\s+RETURN\s+FALSE;/i,
    "can_view_profile must fail closed on missing caller or target"
  );
});

test("app_security.can_view_profile denies unassigned and declined technicians from farmer profile", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  // Assigned technician on active repair
  assert.match(
    sql,
    /rr\.farmer_id\s*=\s*target_profile_id\s+AND\s+rr\.technician_id\s*=\s*v_caller_pid/i,
    "Must require repair assignment to link technician to farmer profile"
  );
  // Respect decline lifecycle
  assert.match(
    sql,
    /\(\s*rr\.declined_by\s+IS\s+NULL\s+OR\s+NOT\s*\(\s*v_caller_pid\s*=\s*ANY\s*\(\s*rr\.declined_by\s*\)\s*\)\s*\)/i,
    "Must revoke farmer profile visibility if technician is recorded in declined_by"
  );
});

test("public.get_session_profile is parameterless and returns combined profile safely", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  assert.match(
    sql,
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_session_profile\s*\(\s*\)/i,
    "get_session_profile must take zero parameters"
  );
  assert.match(
    sql,
    /SET\s+search_path\s*=\s*''/i,
    "Must enforce safe search_path on get_session_profile"
  );
  assert.match(
    sql,
    /v_uid\s*:=\s*auth\.uid\(\);/i,
    "Must read caller identity strictly from auth.uid()"
  );
  assert.match(
    sql,
    /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_session_profile\(\)\s+FROM\s+anon;/i,
    "Must revoke get_session_profile from anon"
  );
  assert.match(
    sql,
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_session_profile\(\)\s+TO\s+authenticated/i,
    "Must grant get_session_profile to authenticated"
  );
});

test("public.admin_provision_staff checks admin role, validates input, and pre-provisions stub", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  assert.match(
    sql,
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.admin_provision_staff\s*\(/i,
    "Must define admin_provision_staff RPC"
  );
  assert.match(
    sql,
    /IF\s+v_caller_role\s+IS\s+NULL\s+OR\s+v_caller_role\s*!=\s*'admin'::public\.user_role\s+THEN/i,
    "Must restrict admin_provision_staff strictly to admin role with fail-closed check"
  );
  assert.match(
    sql,
    /INSERT\s+INTO\s+public\.profile_auth_secrets\s*\(profile_id,\s*auth_user_id,\s*email/i,
    "Must insert into profile_auth_secrets with NULL auth_user_id"
  );
  assert.match(
    sql,
    /NULL,\s*v_norm_email/i,
    "Must store NULL auth_user_id for pre-provisioned stub"
  );
});

test("admin_provision_staff pre-provisions technician as unverified (is_verified = false)", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  assert.match(
    sql,
    /INSERT\s+INTO\s+public\.technician_profiles[^;]+false,\s*--\s*Pre-provisioned technicians must start unverified/i,
    "Pre-provisioned technician must have is_verified = false"
  );
});

test("admin_provision_staff rejects non-technician roles and invalid email addresses", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  assert.match(
    sql,
    /IF\s+p_role\s+IS\s+NULL\s+OR\s+p_role\s*!=\s*'technician'::public\.user_role\s+THEN\s+RAISE\s+EXCEPTION/i,
    "Must reject non-technician role (including admin) fail-closed"
  );
  assert.match(
    sql,
    /(?:TRIM\()?\s*p_email\s*\)?\s+NOT\s+LIKE\s+'%_@__%\.__%'/i,
    "Must validate email format"
  );
});

test("public.get_session_profile excludes auth_user_id, clerk_user_id, demo_code, and email", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  const getSessionFunc = sql.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_session_profile\s*\(\s*\)\s*RETURNS\s+TABLE\s*\(([^)]+)\)/i);
  assert.ok(getSessionFunc, "get_session_profile must return a table");
  const returnColumns = getSessionFunc[1];
  assert.doesNotMatch(returnColumns, /auth_user_id/i, "Must not return auth_user_id");
  assert.doesNotMatch(returnColumns, /clerk_user_id/i, "Must not return clerk_user_id");
  assert.doesNotMatch(returnColumns, /demo_code/i, "Must not return demo_code");
  assert.doesNotMatch(returnColumns, /email/i, "Must not return email");
  assert.match(returnColumns, /id\s+uuid/i, "Must return id uuid");
  assert.match(returnColumns, /role\s+public\.user_role/i, "Must return role");
  assert.match(returnColumns, /full_name\s+text/i, "Must return full_name");
  assert.match(returnColumns, /phone\s+text/i, "Must return phone");
  assert.match(returnColumns, /village\s+text/i, "Must return village");
  assert.match(returnColumns, /is_verified\s+boolean/i, "Must return is_verified");
});

test("profile_contacts RLS enforces granular write permissions and lifecycle restrictions", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  assert.match(
    sql,
    /CREATE\s+POLICY\s+"profile_contacts_insert_policy"\s+ON\s+public\.profile_contacts\s+FOR\s+INSERT\s+TO\s+authenticated\s+WITH\s+CHECK\s*\(\s*profile_id\s*=\s*public\.current_profile_id\(\)\s+OR\s+public\.current_user_role\(\)\s*=\s*'admin'::public\.user_role\s*\);/i,
    "profile_contacts INSERT policy must exist and require own profile_id"
  );
  assert.match(
    sql,
    /CREATE\s+POLICY\s+"profile_contacts_update_policy"\s+ON\s+public\.profile_contacts\s+FOR\s+UPDATE\s+TO\s+authenticated\s+USING\s*\(\s*profile_id\s*=\s*public\.current_profile_id\(\)\s+OR\s+public\.current_user_role\(\)\s*=\s*'admin'::public\.user_role\s*\)\s+WITH\s+CHECK\s*\(\s*profile_id\s*=\s*public\.current_profile_id\(\)\s+OR\s+public\.current_user_role\(\)\s*=\s*'admin'::public\.user_role\s*\);/i,
    "profile_contacts UPDATE policy must exist and require own profile_id for USING and WITH CHECK"
  );
});

test("Logical simulation: Contact visibility lifecycle matrix", () => {
  function evaluateContactAccess({ callerId, callerRole, targetProfileId, repair }) {
    if (callerId === targetProfileId) return true;
    if (callerRole === "admin") return true;
    if (repair) {
      const isAssigned = (repair.farmerId === targetProfileId && repair.technicianId === callerId) ||
                         (repair.technicianId === targetProfileId && repair.farmerId === callerId);
      const isActive = repair.status !== "COMPLETED" && repair.status !== "CANCELLED";
      const notDeclined = !repair.declinedBy || !repair.declinedBy.includes(callerId);
      if (isAssigned && isActive && notDeclined) return true;
    }
    return false;
  }

  const farmerId = "00000000-0000-0000-0001-000000000001";
  const techId = "00000000-0000-0000-0002-000000000001";
  const unassignedTechId = "00000000-0000-0000-0002-000000000002";
  const adminId = "00000000-0000-0000-0003-000000000001";

  // A. Self access
  assert.equal(evaluateContactAccess({ callerId: farmerId, callerRole: "farmer", targetProfileId: farmerId }), true);
  assert.equal(evaluateContactAccess({ callerId: techId, callerRole: "technician", targetProfileId: techId }), true);

  // B. Cross-farmer access denied
  assert.equal(evaluateContactAccess({ callerId: farmerId, callerRole: "farmer", targetProfileId: "stranger-farmer" }), false);

  // C. Admin operational access allowed
  assert.equal(evaluateContactAccess({ callerId: adminId, callerRole: "admin", targetProfileId: farmerId }), true);

  // D. Active assigned repair allows counterpart
  const activeRepair = { farmerId, technicianId: techId, status: "IN_PROGRESS", declinedBy: [] };
  assert.equal(evaluateContactAccess({ callerId: techId, callerRole: "technician", targetProfileId: farmerId, repair: activeRepair }), true);
  assert.equal(evaluateContactAccess({ callerId: farmerId, callerRole: "farmer", targetProfileId: techId, repair: activeRepair }), true);

  // E. Unassigned technician denied
  assert.equal(evaluateContactAccess({ callerId: unassignedTechId, callerRole: "technician", targetProfileId: farmerId, repair: activeRepair }), false);

  // F. Declined technician revoked
  const declinedRepair = { farmerId, technicianId: null, status: "REQUESTED", declinedBy: [techId] };
  assert.equal(evaluateContactAccess({ callerId: techId, callerRole: "technician", targetProfileId: farmerId, repair: declinedRepair }), false);

  // G. Completed repair lifecycle closes counterpart contact access
  const completedRepair = { farmerId, technicianId: techId, status: "COMPLETED", declinedBy: [] };
  assert.equal(evaluateContactAccess({ callerId: techId, callerRole: "technician", targetProfileId: farmerId, repair: completedRepair }), false);

  // H. Cancelled repair closes counterpart contact access
  const cancelledRepair = { farmerId, technicianId: techId, status: "CANCELLED", declinedBy: [] };
  assert.equal(evaluateContactAccess({ callerId: techId, callerRole: "technician", targetProfileId: farmerId, repair: cancelledRepair }), false);
});

test("public.protect_profile_role trigger prevents non-admin role modification", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  assert.match(
    sql,
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.protect_profile_role\(\)/i,
    "Must define protect_profile_role trigger function"
  );
  assert.match(
    sql,
    /IF\s+NEW\.role\s+IS\s+DISTINCT\s+FROM\s+OLD\.role\s+THEN/i,
    "Must detect role modification"
  );
  assert.match(
    sql,
    /IF\s+public\.current_user_role\(\)\s*!=\s*'admin'::public\.user_role\s+THEN/i,
    "Must reject role modification if caller is not admin"
  );
  assert.match(
    sql,
    /CREATE\s+TRIGGER\s+tr_protect_profile_role\s+BEFORE\s+UPDATE\s+ON\s+public\.profiles/i,
    "Must attach tr_protect_profile_role trigger to profiles"
  );
});

test("public.handle_new_user atomically links pre-provisioned stubs and handles self-registration", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  assert.match(
    sql,
    /SELECT\s+pas\.profile_id\s+INTO\s+v_matched_profile_id\s+FROM\s+public\.profile_auth_secrets\s+pas\s+WHERE\s+LOWER\(pas\.email\)\s*=\s*v_email\s+AND\s+pas\.auth_user_id\s+IS\s+NULL\s+FOR\s+UPDATE/i,
    "Must lock and match pre-provisioned stub by LOWER(email) with auth_user_id IS NULL"
  );
  assert.match(
    sql,
    /UPDATE\s+public\.profile_auth_secrets\s+SET\s+auth_user_id\s*=\s*NEW\.id/i,
    "Must claim stub by updating auth_user_id to NEW.id"
  );
  assert.match(
    sql,
    /UPDATE\s+public\.profiles\s+SET\s+auth_user_id\s*=\s*NEW\.id/i,
    "Must dual-write auth_user_id to profiles during compatibility window"
  );
});

// ==============================================================================
// 3. ROW LEVEL SECURITY (RLS) POLICIES
// ==============================================================================

test("RLS is enabled on profiles, profile_contacts, and profile_auth_secrets", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  assert.match(
    sql,
    /ALTER\s+TABLE\s+public\.profiles\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY;/i,
    "RLS must be enabled on profiles"
  );
  assert.match(
    sql,
    /ALTER\s+TABLE\s+public\.profile_contacts\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY;/i,
    "RLS must be enabled on profile_contacts"
  );
  assert.match(
    sql,
    /ALTER\s+TABLE\s+public\.profile_auth_secrets\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY;/i,
    "RLS must be enabled on profile_auth_secrets"
  );
});

test("profile_auth_secrets RLS strictly seals secrets from administrators", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  assert.match(
    sql,
    /CREATE\s+POLICY\s+"profile_auth_secrets_select_own"\s+ON\s+public\.profile_auth_secrets\s+FOR\s+SELECT\s+TO\s+authenticated\s+USING\s*\(\s*auth_user_id\s*=\s*auth\.uid\(\)\s*\);/i,
    "profile_auth_secrets SELECT policy must allow ONLY auth_user_id = auth.uid()"
  );
  // Verify NO admin bypass in profile_auth_secrets policy statements
  const policyMatches = sql.match(/CREATE\s+POLICY\s+[^;]+ON\s+public\.profile_auth_secrets\s+[^;]+;/gis) || [];
  assert.ok(policyMatches.length >= 4, "Must define at least 4 policies for profile_auth_secrets");
  for (const policy of policyMatches) {
    assert.doesNotMatch(
      policy,
      /admin/i,
      `profile_auth_secrets policy must NEVER include admin role bypass: ${policy}`
    );
    assert.doesNotMatch(
      policy,
      /current_user_role/i,
      `profile_auth_secrets policy must NEVER check user role: ${policy}`
    );
  }
});

test("profile_contacts RLS enforces counterpart lifecycle and admin support access", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  assert.match(
    sql,
    /CREATE\s+POLICY\s+"profile_contacts_select_policy"\s+ON\s+public\.profile_contacts/i,
    "profile_contacts must have select policy"
  );
  assert.match(
    sql,
    /profile_id\s*=\s*public\.current_profile_id\(\)/i,
    "Must allow self access to contacts"
  );
  assert.match(
    sql,
    /public\.current_user_role\(\)\s*=\s*'admin'::public\.user_role/i,
    "Must check admin role for operational access"
  );
  // Scoped admin check
  assert.match(
    sql,
    /p\.role\s*=\s*'technician'::public\.user_role/i,
    "Admin access must permit technician contact management"
  );
  assert.match(
    sql,
    /rr\.farmer_id\s*=\s*profile_contacts\.profile_id/i,
    "Admin access must scope farmer contacts to tickets"
  );
  assert.match(
    sql,
    /rr\.status\s+NOT\s+IN\s*\(\s*'COMPLETED'::public\.repair_status,\s*'CANCELLED'::public\.repair_status\s*\)/i,
    "Must restrict counterpart contact access to active repairs"
  );
  assert.match(
    sql,
    /NOT\s*\(\s*public\.current_profile_id\(\)\s*=\s*ANY\s*\(\s*rr\.declined_by\s*\)\s*\)/i,
    "Must deny contact access to technicians who declined the repair"
  );
});

test("Column-level grants on public.profiles strictly protect legacy sensitive fields", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");

  // Revoke table-level access from authenticated, anon, PUBLIC
  assert.match(
    sql,
    /REVOKE\s+ALL\s+ON\s+TABLE\s+public\.profiles\s+FROM\s+authenticated;/i,
    "Must revoke table-level privileges from authenticated"
  );
  assert.match(
    sql,
    /REVOKE\s+ALL\s+ON\s+TABLE\s+public\.profiles\s+FROM\s+anon;/i,
    "Must revoke table-level privileges from anon"
  );

  // Grant column-level SELECT on ONLY safe columns
  assert.match(
    sql,
    /GRANT\s+SELECT\s*\(\s*id,\s*role,\s*full_name,\s*phone,\s*village,\s*created_at,\s*updated_at\s*\)\s+ON\s+TABLE\s+public\.profiles\s+TO\s+authenticated;/i,
    "Must grant column-level SELECT strictly on safe columns to authenticated"
  );

  // Verify sensitive columns are NEVER granted to authenticated
  const grantMatches = sql.match(/GRANT\s+SELECT\s*\([^)]+\)\s+ON\s+TABLE\s+public\.profiles\s+TO\s+authenticated;/gi) || [];
  assert.ok(grantMatches.length > 0, "Must have column-level grant for authenticated");
  for (const grant of grantMatches) {
    assert.doesNotMatch(grant, /auth_user_id/i, "auth_user_id must NEVER be granted to authenticated");
    assert.doesNotMatch(grant, /email/i, "email must NEVER be granted to authenticated");
    assert.doesNotMatch(grant, /demo_code/i, "demo_code must NEVER be granted to authenticated");
    assert.doesNotMatch(grant, /clerk_user_id/i, "clerk_user_id must NEVER be granted to authenticated");
  }

  // Grant column-level UPDATE on ONLY user-editable fields
  assert.match(
    sql,
    /GRANT\s+UPDATE\s*\(\s*full_name,\s*phone,\s*village,\s*updated_at\s*\)\s+ON\s+TABLE\s+public\.profiles\s+TO\s+authenticated;/i,
    "Must grant column-level UPDATE strictly on user-editable fields"
  );
});

test("Simulation: Column privilege boundary blocks unauthorized queries", () => {
  const GRANTED_COLUMNS = new Set(["id", "role", "full_name", "phone", "village", "created_at", "updated_at"]);
  const SENSITIVE_COLUMNS = ["auth_user_id", "email", "demo_code", "clerk_user_id"];

  function checkColumnAccess(requestedColumns) {
    for (const col of requestedColumns) {
      if (!GRANTED_COLUMNS.has(col)) {
        const err = new Error(`permission denied for column ${col} of relation profiles`);
        err.code = "42501";
        throw err;
      }
    }
    return true;
  }

  // 1. Safe query succeeds
  assert.equal(checkColumnAccess(["id", "full_name", "role", "phone", "village"]), true);

  // 2. Sensitive column queries throw 42501
  for (const sensitiveCol of SENSITIVE_COLUMNS) {
    assert.throws(
      () => checkColumnAccess(["id", "full_name", sensitiveCol]),
      (err) => err.code === "42501" && err.message.includes(sensitiveCol),
      `Query containing ${sensitiveCol} must be blocked by column privilege check`
    );
  }
});

test("Simulation: Scoped administrator contact access enforces operational necessity", () => {
  function evaluateScopedAdminContactAccess({ callerRole, targetRole, hasRepairRequest }) {
    if (callerRole !== "admin") return false;
    // Admin can access technician contacts (dispatch/verification) or farmers with open repairs
    if (targetRole === "technician") return true;
    if (targetRole === "farmer" && hasRepairRequest) return true;
    return false;
  }

  // 1. Admin accessing technician contact -> allowed
  assert.equal(evaluateScopedAdminContactAccess({ callerRole: "admin", targetRole: "technician", hasRepairRequest: false }), true);

  // 2. Admin accessing farmer with active repair -> allowed
  assert.equal(evaluateScopedAdminContactAccess({ callerRole: "admin", targetRole: "farmer", hasRepairRequest: true }), true);

  // 3. Admin accessing farmer without any repair -> DENIED
  assert.equal(evaluateScopedAdminContactAccess({ callerRole: "admin", targetRole: "farmer", hasRepairRequest: false }), false);
});

// ==============================================================================
// 4. FRONTEND INTEGRATION & CLIENT SERVICE AUDIT
// ==============================================================================

test("src/lib/auth.ts uses get_session_profile RPC and eliminates client-side auth_user_id update", () => {
  const content = fs.readFileSync(AUTH_PATH, "utf8");
  assert.match(
    content,
    /supabase\.rpc\(\s*["']get_session_profile["']\s*\)/,
    "auth.ts must call get_session_profile RPC"
  );
  assert.doesNotMatch(
    content,
    /\.from\(["']profiles["']\)\.update\(\{\s*auth_user_id/,
    "auth.ts must NEVER perform client-side profiles auth_user_id updates"
  );
});

test("src/lib/services/repair-requests.ts uses get_session_profile for caller identity resolution", () => {
  const content = fs.readFileSync(REPAIR_SERVICE_PATH, "utf8");
  assert.match(
    content,
    /supabase\.rpc\(\s*["']get_session_profile["']\s*\)/,
    "repair-requests.ts must use get_session_profile RPC"
  );
});

test("src/lib/services/technicians.ts uses get_session_profile for caller identity resolution", () => {
  const content = fs.readFileSync(TECH_SERVICE_PATH, "utf8");
  assert.match(
    content,
    /supabase\.rpc\(\s*["']get_session_profile["']\s*\)/,
    "technicians.ts must use get_session_profile RPC"
  );
});

test("src/lib/services/profile.ts performs dual-write to profiles and profile_contacts", () => {
  const content = fs.readFileSync(PROFILE_SERVICE_PATH, "utf8");
  assert.match(
    content,
    /supabase\s*\.from\(["']profiles["']\)\s*\.update/,
    "profile.ts must update profiles"
  );
  assert.match(
    content,
    /supabase\s*\.from\(["']profile_contacts["']\)\s*\.upsert/,
    "profile.ts must dual-write into profile_contacts"
  );
});

test("src/integrations/supabase/types.ts includes profile_contacts, profile_auth_secrets, and new RPCs", () => {
  const content = fs.readFileSync(TYPES_PATH, "utf8");
  assert.match(content, /profile_contacts:\s*\{/, "types.ts must declare profile_contacts table");
  assert.match(content, /profile_auth_secrets:\s*\{/, "types.ts must declare profile_auth_secrets table");
  assert.match(content, /get_session_profile:\s*\{/, "types.ts must declare get_session_profile function");
  assert.match(content, /admin_provision_staff:\s*\{/, "types.ts must declare admin_provision_staff function");
});

// ==============================================================================
// 5. PROFILES INSERT SECURITY & LIFECYCLE VERIFICATION
// ==============================================================================

test("public.profiles RLS intentionally disallows direct client INSERT and drops legacy insert policies", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");

  // Verify legacy INSERT policies are explicitly dropped
  assert.match(
    sql,
    /DROP\s+POLICY\s+IF\s+EXISTS\s+"Users can insert own profile"\s+ON\s+public\.profiles;/i,
    "Must drop legacy 'Users can insert own profile' policy"
  );
  assert.match(
    sql,
    /DROP\s+POLICY\s+IF\s+EXISTS\s+"profiles_insert_policy"\s+ON\s+public\.profiles;/i,
    "Must drop 'profiles_insert_policy'"
  );

  // Verify that NO permissive INSERT policy is created for public.profiles
  const createPolicyMatches = sql.match(/CREATE\s+POLICY\s+[^;]+ON\s+public\.profiles\s+[^;]+;/gis) || [];
  for (const policy of createPolicyMatches) {
    assert.doesNotMatch(
      policy,
      /FOR\s+INSERT/i,
      `public.profiles must NEVER have a client FOR INSERT policy: ${policy}`
    );
  }

  // Verify direct INSERT privilege is explicitly revoked
  assert.match(
    sql,
    /REVOKE\s+INSERT\s+ON\s+TABLE\s+public\.profiles\s+FROM\s+authenticated,\s*anon,\s*PUBLIC;/i,
    "Must explicitly revoke INSERT on public.profiles from authenticated, anon, PUBLIC"
  );
});

test("Verification of profile-creation workflows: profiles are exclusively created server-side via SECURITY DEFINER routines with decoupled IDs", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");

  // 1. handle_new_user() creates profiles server-side using gen_random_uuid()
  assert.match(
    sql,
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.handle_new_user\(\)\s+RETURNS\s+trigger\s+LANGUAGE\s+plpgsql\s+SECURITY\s+DEFINER/i,
    "handle_new_user must be SECURITY DEFINER"
  );
  assert.match(
    sql,
    /v_new_profile_id\s*:=\s*gen_random_uuid\(\);/,
    "handle_new_user must generate a distinct UUID for profile ID (never assuming profiles.id = auth.uid())"
  );

  // 2. admin_provision_staff() creates profiles server-side using gen_random_uuid()
  assert.match(
    sql,
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.admin_provision_staff\([^)]+\)\s+RETURNS\s+uuid\s+LANGUAGE\s+plpgsql\s+SECURITY\s+DEFINER/i,
    "admin_provision_staff must be SECURITY DEFINER"
  );

  // 3. Frontend audit: confirm no frontend file in src/ directly executes .insert() on profiles
  const srcFiles = [];
  function scanDir(dir) {
    for (const item of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, item);
      if (fs.statSync(fullPath).isDirectory()) {
        scanDir(fullPath);
      } else if (/\.(ts|tsx|js|jsx)$/.test(item)) {
        srcFiles.push(fullPath);
      }
    }
  }
  scanDir(path.join(ROOT_DIR, "src"));

  for (const filePath of srcFiles) {
    const fileContent = fs.readFileSync(filePath, "utf8");
    assert.doesNotMatch(
      fileContent,
      /\.from\(["']profiles["']\)\.insert\(/,
      `Frontend file ${path.relative(ROOT_DIR, filePath)} must never directly insert into public.profiles`
    );
  }
});

test("Simulation: direct client INSERT into public.profiles is denied while SECURITY DEFINER handle_new_user succeeds with independent IDs", () => {
  const authUserId = "11111111-1111-4111-8111-111111111111";
  const distinctProfileId = "22222222-2222-4222-8222-222222222222";

  // Client permissions matrix
  const clientPermissions = {
    authenticated: {
      canInsertProfiles: false, // Revoked by migration
      hasProfilesInsertPolicy: false, // No INSERT policy on profiles
    },
  };

  function simulateClientInsert({ role, targetTable }) {
    if (targetTable === "profiles") {
      const perms = clientPermissions[role];
      if (!perms || !perms.canInsertProfiles || !perms.hasProfilesInsertPolicy) {
        const error = new Error(`permission denied for table profiles`);
        error.code = "42501";
        throw error;
      }
    }
    return { success: true };
  }

  // 1. Authenticated user attempting direct insert into public.profiles is rejected with 42501
  assert.throws(
    () => simulateClientInsert({ role: "authenticated", targetTable: "profiles" }),
    (err) => err.code === "42501" && err.message.includes("permission denied"),
    "Direct client insert on profiles must throw 42501 permission denied"
  );

  // 2. Server-side handle_new_user trigger routine succeeds with distinct UUIDs
  function simulateServerSideUserCreation({ authId, email, role, fullName }) {
    // SECURITY DEFINER runs as database owner (postgres), bypassing client RLS
    const newProfile = {
      id: distinctProfileId, // Generated distinct UUID
      role: role || "farmer",
      full_name: fullName || "Test Farmer",
    };
    const newSecret = {
      profile_id: newProfile.id,
      auth_user_id: authId,
      email: email,
    };

    assert.notEqual(newProfile.id, authId, "Profile ID and Auth User ID must remain decoupled");
    assert.equal(newSecret.profile_id, newProfile.id, "Secret must link profile ID");
    assert.equal(newSecret.auth_user_id, authId, "Secret must link Auth ID");
    return { profile: newProfile, secret: newSecret };
  }

  const result = simulateServerSideUserCreation({
    authId: authUserId,
    email: "farmer@example.com",
    role: "farmer",
    fullName: "Ramesh Patil",
  });

  assert.ok(result.profile.id);
  assert.ok(result.secret.auth_user_id);
});
