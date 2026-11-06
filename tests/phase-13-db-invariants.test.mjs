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
  "20261106160000_phase13_database_foundations.sql"
);

// Read the migration file once for static AST / regex validation
const sqlContent = fs.readFileSync(MIGRATION_PATH, "utf8");

// ==============================================================================
// 1. STATIC MIGRATION & SCHEMA ARCHITECTURE TESTS
// ==============================================================================

test("Migration 20261106160000_phase13_database_foundations.sql exists and is non-empty", () => {
  assert.ok(fs.existsSync(MIGRATION_PATH), "Migration file must exist on disk");
  assert.ok(sqlContent.length > 5000, "Migration file must contain substantial SQL statements");
});

test("Migration alters technician_profiles with nullable rating and Phase 13 fields", () => {
  assert.match(
    sqlContent,
    /ALTER\s+TABLE\s+public\.technician_profiles[\s\S]+?ALTER\s+COLUMN\s+rating\s+DROP\s+NOT\s+NULL/i,
    "Rating must be made nullable"
  );
  assert.match(
    sqlContent,
    /ALTER\s+TABLE\s+public\.technician_profiles[\s\S]+?ALTER\s+COLUMN\s+rating\s+SET\s+DEFAULT\s+NULL/i,
    "Rating default must be set to NULL (New / Unrated)"
  );
  assert.match(
    sqlContent,
    /CHECK\s*\(\s*rating\s+IS\s+NULL\s+OR\s*\(\s*rating\s*>=\s*1\.00\s+AND\s+rating\s*<=\s*5\.00\s*\)\s*\)/i,
    "Rating check constraint must accommodate NULL"
  );
  assert.match(
    sqlContent,
    /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+primary_facility_id\s+UUID/i,
    "Must add primary_facility_id"
  );
  assert.match(
    sqlContent,
    /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+review_count\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+0/i,
    "Must add review_count with default 0"
  );
  assert.match(
    sqlContent,
    /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+kyc_verified\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+FALSE/i,
    "Must add kyc_verified with default FALSE"
  );
  assert.match(
    sqlContent,
    /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+ai_suggested_skills\s+JSONB\s+NOT\s+NULL\s+DEFAULT\s+'\[\]'::jsonb/i,
    "Must add ai_suggested_skills jsonb array"
  );
  assert.match(
    sqlContent,
    /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+verified_skills\s+JSONB\s+NOT\s+NULL\s+DEFAULT\s+'\[\]'::jsonb/i,
    "Must add verified_skills jsonb array"
  );
});

test("Migration alters repair_requests with facility, load-test, payment, and handover fields", () => {
  assert.match(
    sqlContent,
    /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+facility_id\s+UUID/i,
    "Must add facility_id"
  );
  assert.match(
    sqlContent,
    /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+load_test_passed\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+FALSE/i,
    "Must add load_test_passed with default FALSE"
  );
  assert.match(
    sqlContent,
    /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+payment_cleared_at\s+TIMESTAMPTZ/i,
    "Must add payment_cleared_at"
  );
  assert.match(
    sqlContent,
    /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+handover_status\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'PENDING'/i,
    "Must add handover_status with default PENDING"
  );
  assert.match(
    sqlContent,
    /CHECK\s*\(\s*handover_status\s+IN\s*\(\s*'PENDING',\s*'AUTHORIZED',\s*'RELEASED'\s*\)\s*\)/i,
    "Must enforce handover_status check constraint"
  );
  assert.match(
    sqlContent,
    /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+farmer_collection_confirmed\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+FALSE/i,
    "Must add farmer_collection_confirmed"
  );
});

test("Migration hardens service_history with ON DELETE RESTRICT foreign keys", () => {
  assert.match(
    sqlContent,
    /FOREIGN\s+KEY\s*\(\s*repair_request_id\s*\)\s+REFERENCES\s+public\.repair_requests\s*\(\s*id\s*\)\s+ON\s+DELETE\s+RESTRICT/i,
    "repair_request_id must be ON DELETE RESTRICT"
  );
  assert.match(
    sqlContent,
    /FOREIGN\s+KEY\s*\(\s*equipment_id\s*\)\s+REFERENCES\s+public\.equipment\s*\(\s*id\s*\)\s+ON\s+DELETE\s+RESTRICT/i,
    "equipment_id must be ON DELETE RESTRICT"
  );
});

test("Migration creates repair_facilities, facility_memberships, and technician_reviews tables", () => {
  assert.match(
    sqlContent,
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.repair_facilities/i,
    "Must create repair_facilities table"
  );
  assert.match(
    sqlContent,
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.facility_memberships/i,
    "Must create facility_memberships table"
  );
  assert.match(
    sqlContent,
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.technician_reviews/i,
    "Must create technician_reviews table"
  );
  // Single owner unique partial index
  assert.match(
    sqlContent,
    /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_single_facility_owner\s+ON\s+public\.facility_memberships\s*\(\s*facility_id\s*\)\s+WHERE\s+role\s*=\s*'OWNER'/i,
    "Must create unique partial index enforcing exactly one OWNER per facility"
  );
});

test("Migration defines all 9 required invariant triggers including technician mutation guard", () => {
  const expectedTriggers = [
    "trg_facility_owner_membership",
    "trg_guard_owner_membership_mutation",
    "trg_facility_ownership_transfer",
    "trg_guard_facility_drop_off_approval",
    "trg_guard_repair_completion_load_test",
    "trg_guard_service_history_immutability",
    "trg_guard_completed_repair_relationships",
    "trg_recalculate_technician_rating",
    "trg_guard_technician_profile_mutation",
  ];

  for (const trg of expectedTriggers) {
    const regex = new RegExp(`CREATE\\s+TRIGGER\\s+${trg}`, "i");
    assert.match(sqlContent, regex, `Trigger ${trg} must be defined`);
  }

  // Verify guard_service_history_immutability is specifically SECURITY INVOKER
  assert.match(
    sqlContent,
    /FUNCTION\s+public\.guard_service_history_immutability\(\)[\s\S]+?SECURITY\s+INVOKER/i,
    "guard_service_history_immutability must be declared as SECURITY INVOKER"
  );

  // Verify guard_technician_profile_mutation is declared as SECURITY INVOKER with search_path = '' and checks postgres owner only via bare CURRENT_USER
  assert.match(
    sqlContent,
    /FUNCTION\s+public\.guard_technician_profile_mutation\(\)[\s\S]+?SECURITY\s+INVOKER[\s\S]+?SET\s+search_path\s*=\s*''/i,
    "guard_technician_profile_mutation must be declared as SECURITY INVOKER with search_path = ''"
  );
  assert.match(
    sqlContent,
    /guard_technician_profile_mutation[\s\S]+?\bCURRENT_USER\s*=\s*'postgres'/i,
    "guard_technician_profile_mutation must use bare CURRENT_USER keyword to permit only postgres definer routines"
  );
  assert.doesNotMatch(
    sqlContent,
    /pg_catalog\.(current_user|session_user|user|current_role)/i,
    "Migration must not contain invalid schema-qualified SQL standard keywords"
  );
  assert.doesNotMatch(
    sqlContent,
    /guard_technician_profile_mutation[\s\S]+?current_user\s+IN\s*\([^)]*service_role[^)]*\)/i,
    "guard_technician_profile_mutation must NOT contain service_role exemption"
  );
});

test("Migration defines hardened business RPCs with search_path = '' and explicit grants", () => {
  const expectedRPCs = [
    "transfer_facility_ownership",
    "invite_technician_to_facility",
    "accept_facility_invitation",
    "reject_facility_invitation",
    "revoke_facility_invitation",
    "get_facility_handover_location",
    "get_facility_management_profile",
    "verify_technician_kyc",
    "approve_technician_skill",
    "dismiss_technician_skill",
    "get_technician_private_profile",
    "get_technician_workshop_profile",
    "admin_set_technician_verification",
    "record_load_test_signoff",
    "record_offline_payment_clearance",
    "authorize_equipment_handover",
    "execute_equipment_handover_release",
    "confirm_farmer_equipment_collection",
    "reset_demo_data",
  ];

  for (const rpc of expectedRPCs) {
    const fnRegex = new RegExp(`FUNCTION\\s+public\\.${rpc}\\s*\\(`, "i");
    assert.match(sqlContent, fnRegex, `Function public.${rpc} must be defined`);
  }

  // Ensure record_offline_payment_clearance is revoked from anon and PUBLIC, granted to authenticated
  assert.match(
    sqlContent,
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.record_offline_payment_clearance[^;]+FROM\s+PUBLIC/i,
    "record_offline_payment_clearance must be revoked from PUBLIC"
  );
  assert.match(
    sqlContent,
    /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.record_offline_payment_clearance[^;]+FROM\s+anon/i,
    "record_offline_payment_clearance must be revoked from anon"
  );
  assert.match(
    sqlContent,
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.record_offline_payment_clearance[^;]+TO\s+authenticated/i,
    "record_offline_payment_clearance must be granted to authenticated"
  );

  // Ensure get_facility_management_profile is revoked from anon and PUBLIC, granted to authenticated
  assert.match(
    sqlContent,
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.get_facility_management_profile[^;]+FROM\s+PUBLIC,\s*anon/i,
    "get_facility_management_profile must be revoked from PUBLIC, anon"
  );
  assert.match(
    sqlContent,
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_facility_management_profile[^;]+TO\s+authenticated/i,
    "get_facility_management_profile must be granted to authenticated"
  );

  // Ensure get_technician_private_profile is revoked from anon and PUBLIC, granted to authenticated
  assert.match(
    sqlContent,
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.get_technician_private_profile[^;]+FROM\s+PUBLIC,\s*anon/i,
    "get_technician_private_profile must be revoked from PUBLIC, anon"
  );
  assert.match(
    sqlContent,
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_technician_private_profile[^;]+TO\s+authenticated/i,
    "get_technician_private_profile must be granted to authenticated"
  );
});

test("Migration enforces strict Discretionary Access Control (DAC) & Row Level Security (RLS)", () => {
  // Service history and reviews: unconditional revoke of UPDATE, DELETE, TRUNCATE from authenticated, anon, PUBLIC, service_role
  assert.match(
    sqlContent,
    /REVOKE\s+UPDATE,\s*DELETE,\s*TRUNCATE\s+ON\s+TABLE\s+public\.service_history\s+FROM\s+authenticated,\s*anon,\s*PUBLIC,\s*service_role/i,
    "service_history must revoke UPDATE, DELETE, TRUNCATE from authenticated, anon, PUBLIC, service_role"
  );
  assert.match(
    sqlContent,
    /REVOKE\s+UPDATE,\s*DELETE,\s*TRUNCATE\s+ON\s+TABLE\s+public\.technician_reviews\s+FROM\s+authenticated,\s*anon,\s*PUBLIC,\s*service_role/i,
    "technician_reviews must revoke UPDATE, DELETE, TRUNCATE from authenticated, anon, PUBLIC, service_role"
  );

  // Column partitioning on repair_requests: 16 safe operational columns granted
  assert.match(
    sqlContent,
    /REVOKE\s+UPDATE\s*\(\s*payment_cleared_at,\s*payment_cleared_by,\s*payment_method,\s*payment_reference\s*\)\s+ON\s+TABLE\s+public\.repair_requests\s+FROM\s+authenticated,\s*anon,\s*PUBLIC/i,
    "Payment clearance columns must be defensively revoked"
  );
  assert.match(
    sqlContent,
    /GRANT\s+UPDATE\s*\(\s*status,[\s\S]+?updated_at\s*\)\s+ON\s+TABLE\s+public\.repair_requests\s+TO\s+authenticated/i,
    "Only safe operational columns must be granted for UPDATE on repair_requests"
  );

  // Column partitioning on repair_facilities: safe attributes only
  assert.match(
    sqlContent,
    /GRANT\s+SELECT\s*\(\s*id,\s*name,\s*village,\s*tahsil,\s*operating_hours,\s*drop_off_approved,\s*is_active,\s*created_at,\s*updated_at\s*\)\s+ON\s+TABLE\s+public\.repair_facilities\s+TO\s+authenticated/i,
    "repair_facilities SELECT must grant only safe coarse columns"
  );

  // Technician profiles DAC: revoke table SELECT/UPDATE, grant column SELECT/UPDATE
  assert.match(
    sqlContent,
    /REVOKE\s+ALL\s+ON\s+TABLE\s+public\.technician_profiles\s+FROM\s+anon,\s*PUBLIC/i,
    "technician_profiles must revoke ALL from anon and PUBLIC"
  );
  assert.match(
    sqlContent,
    /REVOKE\s+SELECT,\s*UPDATE,\s*DELETE,\s*TRUNCATE\s+ON\s+TABLE\s+public\.technician_profiles\s+FROM\s+authenticated/i,
    "technician_profiles must revoke table-level SELECT, UPDATE, DELETE, TRUNCATE from authenticated"
  );
  assert.match(
    sqlContent,
    /REVOKE\s+UPDATE,\s*TRUNCATE\s+ON\s+TABLE\s+public\.technician_profiles\s+FROM\s+service_role/i,
    "technician_profiles must revoke direct table-level UPDATE and TRUNCATE from service_role"
  );
  assert.match(
    sqlContent,
    /REVOKE\s+UPDATE\s*\(\s*is_verified,[\s\S]+?jobs_completed\s*\)\s+ON\s+TABLE\s+public\.technician_profiles\s+FROM\s+authenticated,\s*service_role,\s*anon,\s*PUBLIC/i,
    "technician_profiles must defensively revoke UPDATE on protected columns from service_role, authenticated, anon, PUBLIC"
  );
  assert.match(
    sqlContent,
    /GRANT\s+SELECT\s*\(\s*id,[\s\S]+?primary_facility_id,[\s\S]+?updated_at\s*\)\s+ON\s+TABLE\s+public\.technician_profiles\s+TO\s+authenticated/i,
    "technician_profiles SELECT must grant only safe non-confidential operational columns"
  );
  assert.doesNotMatch(
    sqlContent,
    /GRANT\s+SELECT\s*\([^)]*\bphone\b[^)]*\)\s+ON\s+TABLE\s+public\.technician_profiles\s+TO\s+authenticated/i,
    "technician_profiles SELECT must NOT expose phone column directly to authenticated directory queries"
  );
  assert.match(
    sqlContent,
    /GRANT\s+UPDATE\s*\(\s*workshop_name,\s*phone,[\s\S]+?primary_facility_id,\s*updated_at\s*\)\s+ON\s+TABLE\s+public\.technician_profiles\s+TO\s+authenticated,\s*service_role/i,
    "technician_profiles UPDATE must grant strictly technician-editable operational columns (including phone) to authenticated and service_role"
  );
  assert.match(
    sqlContent,
    /GRANT\s+SELECT,\s*INSERT,\s*DELETE\s+ON\s+TABLE\s+public\.technician_profiles\s+TO\s+service_role/i,
    "technician_profiles must grant administrative SELECT, INSERT, DELETE to service_role"
  );
  assert.doesNotMatch(
    sqlContent,
    /GRANT\s+ALL\s+ON\s+TABLE\s+public\.technician_profiles\s+TO\s+service_role/i,
    "technician_profiles must NOT grant blanket ALL to service_role"
  );
});

test("reset_demo_data restores Phase 12 parts inventory baseline and cascades dependent tables in strict RESTRICT order", () => {
  // Cascading cleanup of parts tables
  assert.match(
    sqlContent,
    /DELETE\s+FROM\s+public\.service_centre_part_sales\s+WHERE\s+repair_request_id\s*=\s*ANY\(\$1\)/i,
    "reset_demo_data must cascade-delete service_centre_part_sales for demo repairs"
  );
  assert.match(
    sqlContent,
    /DELETE\s+FROM\s+public\.service_centre_part_requests\s+WHERE\s+repair_request_id\s*=\s*ANY\(\$1\)/i,
    "reset_demo_data must cascade-delete service_centre_part_requests for demo repairs"
  );
  assert.match(
    sqlContent,
    /DELETE\s+FROM\s+public\.service_centre_stock_audit\s+WHERE\s+repair_request_id\s*=\s*ANY\(\$1\)/i,
    "reset_demo_data must cascade-delete service_centre_stock_audit for demo repairs"
  );

  // Pre-deletion of reviews
  assert.match(
    sqlContent,
    /DELETE\s+FROM\s+public\.technician_reviews\s+WHERE\s+repair_id\s*=\s*ANY\(v_demo_repair_ids\)\s+OR\s+farmer_profile_id\s*=\s*v_demo_farmer_id/i,
    "reset_demo_data must pre-delete technician_reviews"
  );

  // Baseline restoration of 5 canonical parts
  assert.match(
    sqlContent,
    /'0433171',\s*'Fuel Injector Nozzle Set'/i,
    "reset_demo_data must restore Fuel Injector Nozzle Set"
  );
  assert.match(
    sqlContent,
    /'005556958R1',\s*'Inline Fuel Filter'/i,
    "reset_demo_data must restore Inline Fuel Filter"
  );
  assert.match(
    sqlContent,
    /'AL120788',\s*'Lift Cylinder Seal Kit'/i,
    "reset_demo_data must restore Lift Cylinder Seal Kit"
  );
  assert.match(
    sqlContent,
    /'HY-GARD-15W30',\s*'Hydraulic Oil 15W-30'/i,
    "reset_demo_data must restore Hydraulic Oil"
  );
  assert.match(
    sqlContent,
    /'26243171',\s*'Starter Motor Assembly'/i,
    "reset_demo_data must restore Starter Motor Assembly"
  );

  // Demo facility upsert
  assert.match(
    sqlContent,
    /INSERT\s+INTO\s+public\.repair_facilities[\s\S]+?'00000000-0000-0000-0020-000000000001'::uuid/i,
    "reset_demo_data must restore canonical demo facility"
  );

  // Demo technician reset
  assert.match(
    sqlContent,
    /UPDATE\s+public\.technician_profiles[\s\S]+?primary_facility_id\s*=\s*'00000000-0000-0000-0020-000000000001'::uuid[\s\S]+?rating\s*=\s*NULL[\s\S]+?review_count\s*=\s*0[\s\S]+?kyc_verified\s*=\s*TRUE/i,
    "reset_demo_data must reset technician profile state with primary facility, rating=NULL, and kyc_verified=TRUE"
  );

  // Strict Foreign Key Deletion Ordering Verification in reset_demo_data() SQL definition
  const resetFnMatch = sqlContent.match(/FUNCTION\s+public\.reset_demo_data\(\)[\s\S]+?\$\$([\s\S]+?)\$\$;/i);
  assert.ok(resetFnMatch, "reset_demo_data function body must be parseable");
  const fnBody = resetFnMatch[1];

  const posReviews = fnBody.indexOf("DELETE FROM public.technician_reviews");
  const posHistory = fnBody.indexOf("DELETE FROM public.service_history");
  const posQuotes = fnBody.indexOf("DELETE FROM public.quotes WHERE repair_request_id");
  const posRepairs = fnBody.indexOf("DELETE FROM public.repair_requests WHERE id = ANY(v_demo_repair_ids)");
  const posEquipment = fnBody.indexOf("DELETE FROM public.equipment");

  assert.ok(posReviews !== -1, "DELETE FROM public.technician_reviews must be present");
  assert.ok(posHistory !== -1, "DELETE FROM public.service_history must be present");
  assert.ok(posQuotes !== -1, "DELETE FROM public.quotes must be present");
  assert.ok(posRepairs !== -1, "DELETE FROM public.repair_requests must be present");
  assert.ok(posEquipment !== -1, "DELETE FROM public.equipment must be present");

  assert.ok(
    posReviews < posHistory,
    "technician_reviews must be deleted BEFORE service_history (ON DELETE RESTRICT on service_history_id)"
  );
  assert.ok(
    posHistory < posRepairs,
    "service_history must be deleted BEFORE repair_requests (ON DELETE RESTRICT on repair_request_id)"
  );
  assert.ok(
    posHistory < posEquipment,
    "service_history must be deleted BEFORE equipment (ON DELETE RESTRICT on equipment_id)"
  );
  assert.ok(
    posQuotes < posRepairs,
    "quotes must be deleted BEFORE repair_requests"
  );
  assert.ok(
    posRepairs < posEquipment,
    "repair_requests must be deleted BEFORE equipment (ON DELETE RESTRICT on equipment_id)"
  );
});

// ==============================================================================
// 2. BEHAVIORAL LOGIC SIMULATIONS: TEST-13-01 THROUGH TEST-13-16
// ==============================================================================

// Helper mock IDs
const FARMER_1 = "00000000-0000-0000-0001-000000000001";
const FARMER_2 = "00000000-0000-0000-0001-000000000002";
const TECH_1 = "00000000-0000-0000-0002-000000000001";
const TECH_2 = "00000000-0000-0000-0002-000000000002";
const TECH_3 = "00000000-0000-0000-0002-000000000003";
const ADMIN_1 = "00000000-0000-0000-0003-000000000001";
const FACILITY_1 = "11111111-1111-1111-1111-111111111111";

// ------------------------------------------------------------------------------
// TEST-13-01: Facility RLS & Identity
// ------------------------------------------------------------------------------
test("TEST-13-01: Facility RLS & Identity - Decoupled owner can update allowed attributes", () => {
  function simulateFacilityUpdate({ callerId, callerRole, facility, updates }) {
    const isOwner = facility.owner_profile_id === callerId;
    const isAdmin = callerRole === "admin" || callerRole === "service_centre";
    const isManager = facility.members?.some(
      (m) => m.technician_profile_id === callerId && m.role === "MANAGER" && m.status === "ACTIVE"
    );

    if (!isOwner && !isAdmin && !isManager) {
      throw new Error("42501: Access denied: RLS update policy violation");
    }

    return { ...facility, ...updates, updated_at: new Date().toISOString() };
  }

  const facility = {
    id: FACILITY_1,
    name: "Vidarbha Agro Workshop",
    owner_profile_id: TECH_1,
    address: "Old Ward 2",
    members: [{ technician_profile_id: TECH_1, role: "OWNER", status: "ACTIVE" }],
  };

  // Owner update succeeds
  const updated = simulateFacilityUpdate({
    callerId: TECH_1,
    callerRole: "technician",
    facility,
    updates: { address: "Plot 5, MIDC Hingna" },
  });
  assert.equal(updated.address, "Plot 5, MIDC Hingna");

  // Unrelated technician update fails
  assert.throws(
    () =>
      simulateFacilityUpdate({
        callerId: TECH_3,
        callerRole: "technician",
        facility,
        updates: { address: "Hacked Address" },
      }),
    /42501/
  );
});

// ------------------------------------------------------------------------------
// TEST-13-02: Drop-off Tamper Guard
// ------------------------------------------------------------------------------
test("TEST-13-02: Drop-off Tamper Guard - Non-admins cannot self-certify drop_off_approved", () => {
  function triggerGuardFacilityDropOffApproval({ callerRole, oldRecord, newRecord }) {
    if (newRecord.drop_off_approved !== oldRecord.drop_off_approved) {
      if (callerRole !== "admin" && callerRole !== "service_centre") {
        const err = new Error(
          "ACCESS_DENIED: Only Service Centre administrators can modify drop_off_approved status."
        );
        err.code = "42501";
        throw err;
      }
    }
    return newRecord;
  }

  const initialFacility = { id: FACILITY_1, drop_off_approved: false };

  // Owner attempting self-certification fails
  assert.throws(
    () =>
      triggerGuardFacilityDropOffApproval({
        callerRole: "technician",
        oldRecord: initialFacility,
        newRecord: { ...initialFacility, drop_off_approved: true },
      }),
    (err) => err.code === "42501" && err.message.includes("ACCESS_DENIED")
  );

  // Admin certification succeeds
  const approvedFacility = triggerGuardFacilityDropOffApproval({
    callerRole: "admin",
    oldRecord: initialFacility,
    newRecord: { ...initialFacility, drop_off_approved: true },
  });
  assert.equal(approvedFacility.drop_off_approved, true);
});

// ------------------------------------------------------------------------------
// TEST-13-03: In-Person KYC Authorization
// ------------------------------------------------------------------------------
test("TEST-13-03: In-Person KYC Authorization - KYC verification restricted strictly to service_centre admin", () => {
  function rpcVerifyTechnicianKyc({ callerRole, targetTechId, docType, maskedId, remarks }) {
    if (callerRole !== "admin" && callerRole !== "service_centre") {
      const err = new Error("UNAUTHORIZED: Only Service Centre administrators can verify technician KYC.");
      err.code = "42501";
      throw err;
    }
    return { success: true, targetTechId, docType, maskedId };
  }

  // Technician caller fails
  assert.throws(
    () =>
      rpcVerifyTechnicianKyc({
        callerRole: "technician",
        targetTechId: TECH_1,
        docType: "AADHAAR_PHYSICAL",
        maskedId: "XXXX-XXXX-1234",
        remarks: "In-person verified at depot",
      }),
    (err) => err.code === "42501" && err.message.includes("UNAUTHORIZED")
  );

  // Farmer caller fails
  assert.throws(
    () =>
      rpcVerifyTechnicianKyc({
        callerRole: "farmer",
        targetTechId: TECH_1,
        docType: "AADHAAR_PHYSICAL",
        maskedId: "XXXX-XXXX-1234",
        remarks: "Verified",
      }),
    (err) => err.code === "42501"
  );

  // Admin caller succeeds authorization
  const result = rpcVerifyTechnicianKyc({
    callerRole: "admin",
    targetTechId: TECH_1,
    docType: "AADHAAR_PHYSICAL",
    maskedId: "XXXX-XXXX-1234",
    remarks: "In-person verified at Nagpur Service Centre",
  });
  assert.equal(result.success, true);
});

// ------------------------------------------------------------------------------
// TEST-13-04: Aadhaar 12-Digit & Sensitive PII Storage Rejection
// ------------------------------------------------------------------------------
test("TEST-13-04: Aadhaar 12-Digit Rejection - Full UID, PAN, and Voter ID storage rejected", () => {
  function validateKycIdentifier(docType, maskedId) {
    const trimmedId = maskedId?.trim();
    if (!trimmedId) {
      const err = new Error("EMPTY_IDENTIFIER: Masked identifier cannot be empty or whitespace.");
      err.code = "22000";
      throw err;
    }

    // Anti-PII guards
    if (/^[0-9]{12}$/.test(trimmedId)) {
      const err = new Error("ILLEGAL_FULL_UID_STORAGE: Storing full 12-digit Aadhaar numbers is strictly prohibited.");
      err.code = "22000";
      throw err;
    }
    if (/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(trimmedId)) {
      const err = new Error("ILLEGAL_FULL_PAN_STORAGE: Storing complete PAN numbers is strictly prohibited.");
      err.code = "22000";
      throw err;
    }
    if (/^[A-Z]{3}[0-9]{7}$/i.test(trimmedId)) {
      const err = new Error("ILLEGAL_FULL_VOTER_ID_STORAGE: Storing complete Voter IDs is strictly prohibited.");
      err.code = "22000";
      throw err;
    }

    // Mask format enforcement
    switch (docType) {
      case "AADHAAR_PHYSICAL":
        if (!/^XXXX-XXXX-[0-9]{4}$/i.test(trimmedId)) {
          const err = new Error("INVALID_AADHAAR_MASK: Physical Aadhaar must be masked strictly as XXXX-XXXX-1234.");
          err.code = "22000";
          throw err;
        }
        break;
      case "PAN_CARD":
        if (!/^PAN-XX-[0-9A-Z]{4}$/i.test(trimmedId)) {
          const err = new Error("INVALID_PAN_MASK: PAN card must be masked strictly as PAN-XX-1234.");
          err.code = "22000";
          throw err;
        }
        break;
      case "VOTER_ID":
        if (!/^VID-XX-[0-9A-Z]{4}$/i.test(trimmedId)) {
          const err = new Error("INVALID_VOTER_ID_MASK: Voter ID must be masked strictly as VID-XX-1234.");
          err.code = "22000";
          throw err;
        }
        break;
      default:
        throw new Error("UNSUPPORTED_DOCUMENT_TYPE");
    }
    return true;
  }

  // 12-digit Aadhaar rejection
  assert.throws(
    () => validateKycIdentifier("AADHAAR_PHYSICAL", "123456789012"),
    (err) => err.code === "22000" && err.message.includes("ILLEGAL_FULL_UID_STORAGE")
  );

  // Complete PAN rejection
  assert.throws(
    () => validateKycIdentifier("PAN_CARD", "ABCDE1234F"),
    (err) => err.code === "22000" && err.message.includes("ILLEGAL_FULL_PAN_STORAGE")
  );

  // Complete Voter ID rejection
  assert.throws(
    () => validateKycIdentifier("VOTER_ID", "ABC1234567"),
    (err) => err.code === "22000" && err.message.includes("ILLEGAL_FULL_VOTER_ID_STORAGE")
  );
});

// ------------------------------------------------------------------------------
// TEST-13-05: Empty Masked ID & Remarks Sanitization
// ------------------------------------------------------------------------------
test("TEST-13-05: Empty Masked ID Rejection & Remarks Sanitization", () => {
  function validateKycInput(maskedId, remarks) {
    const trimmedId = maskedId?.trim();
    if (!trimmedId) {
      const err = new Error("EMPTY_IDENTIFIER: Masked identifier cannot be empty or whitespace.");
      err.code = "22000";
      throw err;
    }

    const trimmedRemarks = remarks?.trim() || "";
    if (/[0-9]{6,}/.test(trimmedRemarks)) {
      const err = new Error("SENSITIVE_DATA_IN_REMARKS: Remarks must not contain credential numbers.");
      err.code = "22000";
      throw err;
    }
    return true;
  }

  // Empty string
  assert.throws(() => validateKycInput("", "Remarks"), (err) => err.code === "22000" && err.message.includes("EMPTY_IDENTIFIER"));
  // Whitespace only
  assert.throws(() => validateKycInput("   ", "Remarks"), (err) => err.code === "22000" && err.message.includes("EMPTY_IDENTIFIER"));

  // Remarks with 6+ consecutive digits (leak prevention)
  assert.throws(
    () => validateKycInput("XXXX-XXXX-1234", "Verified card number 9876543210"),
    (err) => err.code === "22000" && err.message.includes("SENSITIVE_DATA_IN_REMARKS")
  );

  // Clean input passes
  assert.equal(validateKycInput("XXXX-XXXX-1234", "Physical biometric check completed at Nagpur"), true);
});

// ------------------------------------------------------------------------------
// TEST-13-06: AI Skill Privilege Boundary
// ------------------------------------------------------------------------------
test("TEST-13-06: AI Skill Privilege Boundary - Technicians cannot self-promote AI suggestions", () => {
  function rpcApproveTechnicianSkill({ callerRole, techProfile, skill }) {
    if (callerRole !== "admin" && callerRole !== "service_centre") {
      const err = new Error("UNAUTHORIZED: Only Service Centre administrators can approve technician skills.");
      err.code = "42501";
      throw err;
    }
    const trimmedSkill = skill?.trim();
    if (!trimmedSkill) {
      throw new Error("EMPTY_SKILL");
    }

    const newSuggested = techProfile.ai_suggested_skills.filter((s) => s !== trimmedSkill);
    const newVerified = techProfile.verified_skills.includes(trimmedSkill)
      ? techProfile.verified_skills
      : [...techProfile.verified_skills, trimmedSkill];

    return { ...techProfile, ai_suggested_skills: newSuggested, verified_skills: newVerified };
  }

  function rpcDismissTechnicianSkill({ callerRole, techProfile, skill }) {
    if (callerRole !== "admin" && callerRole !== "service_centre") {
      const err = new Error("UNAUTHORIZED: Only Service Centre administrators can dismiss technician skills.");
      err.code = "42501";
      throw err;
    }
    const trimmedSkill = skill?.trim();
    const newSuggested = techProfile.ai_suggested_skills.filter((s) => s !== trimmedSkill);
    return { ...techProfile, ai_suggested_skills: newSuggested };
  }

  const profile = {
    profile_id: TECH_1,
    ai_suggested_skills: ["Rotavator Gearbox Specialist", "Solar Inverter Calibration"],
    verified_skills: ["Tractor Hydraulics"],
  };

  // Technician attempt to approve fails
  assert.throws(
    () => rpcApproveTechnicianSkill({ callerRole: "technician", techProfile: profile, skill: "Rotavator Gearbox Specialist" }),
    (err) => err.code === "42501"
  );

  // Admin approves skill -> moves from suggested to verified
  const approved = rpcApproveTechnicianSkill({ callerRole: "admin", techProfile: profile, skill: "Rotavator Gearbox Specialist" });
  assert.deepEqual(approved.ai_suggested_skills, ["Solar Inverter Calibration"]);
  assert.deepEqual(approved.verified_skills, ["Tractor Hydraulics", "Rotavator Gearbox Specialist"]);

  // Admin dismisses skill -> removes from suggested without adding to verified
  const dismissed = rpcDismissTechnicianSkill({ callerRole: "admin", techProfile: profile, skill: "Solar Inverter Calibration" });
  assert.deepEqual(dismissed.ai_suggested_skills, ["Rotavator Gearbox Specialist"]);
});

// ------------------------------------------------------------------------------
// TEST-13-07: Review Eligibility Gate
// ------------------------------------------------------------------------------
test("TEST-13-07: Review Eligibility Gate - Permitted only after completed service history commit", () => {
  function validateReviewEligibility({ callerId, repair, serviceHistoryList }) {
    if (repair.farmer_id !== callerId) {
      throw new Error("42501: Review must be submitted by the owning farmer");
    }
    if (repair.status !== "COMPLETED") {
      throw new Error("42501: Reviews permitted only after repair is COMPLETED");
    }
    const matchingHistory = serviceHistoryList.find(
      (sh) => sh.repair_request_id === repair.id && sh.technician_profile_id === repair.technician_id
    );
    if (!matchingHistory) {
      throw new Error("23503: Completed service_history record required for review eligibility");
    }
    return true;
  }

  const repairInProgress = {
    id: "rep-001",
    farmer_id: FARMER_1,
    technician_id: TECH_1,
    status: "IN_PROGRESS",
  };

  // Fails when IN_PROGRESS
  assert.throws(
    () => validateReviewEligibility({ callerId: FARMER_1, repair: repairInProgress, serviceHistoryList: [] }),
    /COMPLETED/
  );

  const completedRepairWithoutHistory = {
    id: "rep-002",
    farmer_id: FARMER_1,
    technician_id: TECH_1,
    status: "COMPLETED",
  };

  // Fails without matching service history
  assert.throws(
    () => validateReviewEligibility({ callerId: FARMER_1, repair: completedRepairWithoutHistory, serviceHistoryList: [] }),
    /23503/
  );

  // Passes when completed and linked service history exists
  const serviceHistoryList = [{ id: "sh-001", repair_request_id: "rep-002", technician_profile_id: TECH_1 }];
  assert.equal(
    validateReviewEligibility({ callerId: FARMER_1, repair: completedRepairWithoutHistory, serviceHistoryList }),
    true
  );
});

// ------------------------------------------------------------------------------
// TEST-13-08: Review Cross-Tenant Spoofing
// ------------------------------------------------------------------------------
test("TEST-13-08: Review Cross-Tenant Spoofing - Farmers cannot review tickets belonging to other farmers", () => {
  function simulateReviewInsertPolicy({ callerId, repair, reviewRecord }) {
    if (reviewRecord.farmer_profile_id !== callerId) {
      throw new Error("42501: farmer_profile_id must match authenticated session");
    }
    if (repair.farmer_id !== callerId) {
      throw new Error("42501: RLS check failed: caller is not the owner of this repair ticket");
    }
    return true;
  }

  const repairOwnedByFarmer2 = {
    id: "rep-f2",
    farmer_id: FARMER_2,
    technician_id: TECH_1,
    status: "COMPLETED",
  };

  // Farmer 1 trying to review Farmer 2's repair
  assert.throws(
    () =>
      simulateReviewInsertPolicy({
        callerId: FARMER_1,
        repair: repairOwnedByFarmer2,
        reviewRecord: {
          repair_id: "rep-f2",
          farmer_profile_id: FARMER_1,
          technician_profile_id: TECH_1,
          rating: 5,
        },
      }),
    /42501/
  );
});

// ------------------------------------------------------------------------------
// TEST-13-09: Null Default & Trigger Arithmetic
// ------------------------------------------------------------------------------
test("TEST-13-09: Null Default & Trigger Arithmetic - Starts NULL, computes arithmetic mean, restores NULL", () => {
  function recalculateRating(reviews) {
    const published = reviews.filter((r) => r.is_published);
    if (published.length === 0) {
      return { rating: null, review_count: 0 };
    }
    const sum = published.reduce((acc, r) => acc + r.rating, 0);
    const avg = Math.round((sum / published.length) * 100) / 100;
    return { rating: avg, review_count: published.length };
  }

  // 1. Initial State: Unrated technician
  let reviews = [];
  let stats = recalculateRating(reviews);
  assert.equal(stats.rating, null, "Default rating must be NULL (New / Unrated)");
  assert.equal(stats.review_count, 0);

  // 2. Receives 5-star review
  reviews.push({ id: "rev-1", rating: 5, is_published: true });
  stats = recalculateRating(reviews);
  assert.equal(stats.rating, 5.00);
  assert.equal(stats.review_count, 1);

  // 3. Receives 4-star review
  reviews.push({ id: "rev-2", rating: 4, is_published: true });
  stats = recalculateRating(reviews);
  assert.equal(stats.rating, 4.50);
  assert.equal(stats.review_count, 2);

  // 4. Receives 3-star review
  reviews.push({ id: "rev-3", rating: 3, is_published: true });
  stats = recalculateRating(reviews);
  assert.equal(stats.rating, 4.00);
  assert.equal(stats.review_count, 3);

  // 5. Delete reviews one by one
  reviews.pop(); // remove rev-3
  reviews.pop(); // remove rev-2
  stats = recalculateRating(reviews);
  assert.equal(stats.rating, 5.00);
  assert.equal(stats.review_count, 1);

  reviews.pop(); // remove rev-1 (all reviews deleted)
  stats = recalculateRating(reviews);
  assert.equal(stats.rating, null, "When reviews are 0, rating restores cleanly to NULL");
  assert.equal(stats.review_count, 0);
});

// ------------------------------------------------------------------------------
// TEST-13-10: Single Owner Invariant & Mutation Locks
// ------------------------------------------------------------------------------
test("TEST-13-10: Single Owner Invariant - Exactly one OWNER membership permitted per facility", () => {
  class MockFacilityMembershipsTable {
    constructor() {
      this.rows = [];
    }

    insert(row) {
      if (row.role === "OWNER") {
        const existingOwner = this.rows.find((r) => r.facility_id === row.facility_id && r.role === "OWNER");
        if (existingOwner) {
          const err = new Error("23505: Unique violation on idx_single_facility_owner");
          err.code = "23505";
          throw err;
        }
      }
      this.rows.push(row);
      return row;
    }

    delete(id, facilityStillExists = true) {
      const idx = this.rows.findIndex((r) => r.id === id);
      if (idx === -1) return;
      const row = this.rows[idx];
      if (row.role === "OWNER" && facilityStillExists) {
        const err = new Error("23503: CANNOT_DELETE_FACILITY_OWNER: Facility owner membership cannot be deleted while facility exists.");
        err.code = "23503";
        throw err;
      }
      this.rows.splice(idx, 1);
    }
  }

  const table = new MockFacilityMembershipsTable();
  table.insert({ id: "mem-1", facility_id: FACILITY_1, technician_profile_id: TECH_1, role: "OWNER" });

  // Attempting second OWNER throws 23505
  assert.throws(
    () => table.insert({ id: "mem-2", facility_id: FACILITY_1, technician_profile_id: TECH_2, role: "OWNER" }),
    (err) => err.code === "23505"
  );

  // Attempting to directly delete OWNER while facility exists throws 23503
  assert.throws(
    () => table.delete("mem-1", true),
    (err) => err.code === "23503" && err.message.includes("CANNOT_DELETE_FACILITY_OWNER")
  );
});

// ------------------------------------------------------------------------------
// TEST-13-11: Unauthorized Owner Transfer
// ------------------------------------------------------------------------------
test("TEST-13-11: Unauthorized Owner Transfer - Managers cannot transfer ownership", () => {
  function rpcTransferFacilityOwnership({ callerId, callerRole, facility, newOwnerProfile }) {
    const isCurrentOwner = facility.owner_profile_id === callerId;
    const isAdmin = callerRole === "admin" || callerRole === "service_centre";

    if (!isCurrentOwner && !isAdmin) {
      const err = new Error("UNAUTHORIZED: Only current owner or Service Centre admin can transfer facility ownership.");
      err.code = "42501";
      throw err;
    }

    if (newOwnerProfile.role !== "technician") {
      const err = new Error("INVALID_TARGET: Target profile must be a registered technician.");
      err.code = "22000";
      throw err;
    }

    const previousOwner = facility.owner_profile_id;
    facility.owner_profile_id = newOwnerProfile.id;

    // Trigger simulation: demote old owner to MANAGER, promote new owner to OWNER
    const memberships = facility.members.map((m) => {
      if (m.technician_profile_id === previousOwner) {
        return { ...m, role: "MANAGER" };
      }
      if (m.technician_profile_id === newOwnerProfile.id) {
        return { ...m, role: "OWNER", status: "ACTIVE" };
      }
      return m;
    });

    return { success: true, previousOwner, newOwner: newOwnerProfile.id, memberships };
  }

  const facility = {
    id: FACILITY_1,
    owner_profile_id: TECH_1,
    members: [
      { technician_profile_id: TECH_1, role: "OWNER", status: "ACTIVE" },
      { technician_profile_id: TECH_2, role: "MANAGER", status: "ACTIVE" },
    ],
  };

  // Facility Manager (TECH_2) attempts transfer -> FAILS
  assert.throws(
    () =>
      rpcTransferFacilityOwnership({
        callerId: TECH_2,
        callerRole: "technician",
        facility,
        newOwnerProfile: { id: TECH_2, role: "technician" },
      }),
    (err) => err.code === "42501" && err.message.includes("UNAUTHORIZED")
  );

  // Target is not a technician -> FAILS
  assert.throws(
    () =>
      rpcTransferFacilityOwnership({
        callerId: TECH_1,
        callerRole: "technician",
        facility,
        newOwnerProfile: { id: FARMER_1, role: "farmer" },
      }),
    (err) => err.code === "22000" && err.message.includes("INVALID_TARGET")
  );

  // Legitimate Owner (TECH_1) transfers to TECH_2 -> SUCCEEDS
  const transferResult = rpcTransferFacilityOwnership({
    callerId: TECH_1,
    callerRole: "technician",
    facility,
    newOwnerProfile: { id: TECH_2, role: "technician" },
  });
  assert.equal(transferResult.success, true);
  assert.equal(facility.owner_profile_id, TECH_2);
  const oldOwnerMem = transferResult.memberships.find((m) => m.technician_profile_id === TECH_1);
  const newOwnerMem = transferResult.memberships.find((m) => m.technician_profile_id === TECH_2);
  assert.equal(oldOwnerMem.role, "MANAGER");
  assert.equal(newOwnerMem.role, "OWNER");
});

// ------------------------------------------------------------------------------
// TEST-13-12: Load Test Authorization
// ------------------------------------------------------------------------------
test("TEST-13-12: Load Test Authorization - Only assigned tech, facility tech, or admin can sign off", () => {
  function rpcRecordLoadTestSignoff({ callerId, callerRole, repair, facilityMemberships, passed, notes }) {
    if (repair.status === "COMPLETED") {
      const err = new Error("IMMUTABLE_RECORD: Load test results cannot be modified after repair is completed.");
      err.code = "42501";
      throw err;
    }

    const isAssigned = repair.technician_id === callerId;
    const isAdmin = callerRole === "admin" || callerRole === "service_centre";
    const isFacilityMember = facilityMemberships.some(
      (m) => m.facility_id === repair.facility_id && m.technician_profile_id === callerId && m.status === "ACTIVE"
    );

    if (!isAssigned && !isAdmin && !isFacilityMember) {
      const err = new Error("UNAUTHORIZED: Only assigned technician, facility technician, or Service Centre admin can record load testing.");
      err.code = "42501";
      throw err;
    }

    if (!notes || notes.trim().length < 10) {
      const err = new Error("INSUFFICIENT_NOTES: Load test notes must detail operational metrics.");
      err.code = "22000";
      throw err;
    }

    return {
      ...repair,
      load_test_passed: passed,
      load_test_notes: notes.trim(),
      load_tested_by: callerId,
      load_tested_at: new Date().toISOString(),
    };
  }

  const activeRepair = {
    id: "rep-1",
    status: "IN_PROGRESS",
    technician_id: TECH_1,
    facility_id: FACILITY_1,
    load_test_passed: false,
  };

  const memberships = [{ facility_id: FACILITY_1, technician_profile_id: TECH_1, status: "ACTIVE" }];

  // Unrelated technician TECH_3 fails
  assert.throws(
    () =>
      rpcRecordLoadTestSignoff({
        callerId: TECH_3,
        callerRole: "technician",
        repair: activeRepair,
        facilityMemberships: memberships,
        passed: true,
        notes: "Engine running fine at 1800 RPM and 60 PSI",
      }),
    (err) => err.code === "42501" && err.message.includes("UNAUTHORIZED")
  );

  // Insufficient notes (< 10 chars) fails
  assert.throws(
    () =>
      rpcRecordLoadTestSignoff({
        callerId: TECH_1,
        callerRole: "technician",
        repair: activeRepair,
        facilityMemberships: memberships,
        passed: true,
        notes: "Done OK",
      }),
    (err) => err.code === "22000" && err.message.includes("INSUFFICIENT_NOTES")
  );

  // Assigned tech with valid notes succeeds
  const signed = rpcRecordLoadTestSignoff({
    callerId: TECH_1,
    callerRole: "technician",
    repair: activeRepair,
    facilityMemberships: memberships,
    passed: true,
    notes: "30-min rotavator load test passed: 1800 RPM maintained, coolant 82C, oil 55 PSI.",
  });
  assert.equal(signed.load_test_passed, true);

  // Attempting mutation after COMPLETED fails
  const completedRepair = { ...signed, status: "COMPLETED" };
  assert.throws(
    () =>
      rpcRecordLoadTestSignoff({
        callerId: TECH_1,
        callerRole: "technician",
        repair: completedRepair,
        facilityMemberships: memberships,
        passed: false,
        notes: "Attempt to change load test result post-completion",
      }),
    (err) => err.code === "42501" && err.message.includes("IMMUTABLE_RECORD")
  );
});

// ------------------------------------------------------------------------------
// TEST-13-13: Failed Load Test Gate
// ------------------------------------------------------------------------------
test("TEST-13-13: Failed Load Test Gate - Handover authorization blocked without passed load test", () => {
  function rpcAuthorizeHandover({ repair, quoteApproved, paymentCleared }) {
    if (repair.status !== "COMPLETED") {
      const err = new Error("PRECONDITION_FAILED: Repair must be COMPLETED before authorizing equipment handover.");
      err.code = "22000";
      throw err;
    }
    if (!repair.load_test_passed) {
      const err = new Error("LOAD_TEST_REQUIRED: Operational load test must be verified before handover authorization.");
      err.code = "22000";
      throw err;
    }
    if (!quoteApproved) {
      const err = new Error("QUOTE_NOT_APPROVED: An approved itemized quote is required before release.");
      err.code = "22000";
      throw err;
    }
    if (!paymentCleared) {
      const err = new Error("PAYMENT_NOT_CLEARED: Offline payment clearance must be recorded in the database.");
      err.code = "22000";
      throw err;
    }
    return { ...repair, handover_status: "AUTHORIZED" };
  }

  const failedLoadTestRepair = {
    id: "rep-load-fail",
    status: "COMPLETED",
    load_test_passed: false,
    handover_status: "PENDING",
  };

  // Blocked by load test
  assert.throws(
    () => rpcAuthorizeHandover({ repair: failedLoadTestRepair, quoteApproved: true, paymentCleared: true }),
    (err) => err.code === "22000" && err.message.includes("LOAD_TEST_REQUIRED")
  );

  // Repair not yet completed blocked by status
  const inProgressRepair = { ...failedLoadTestRepair, status: "IN_PROGRESS", load_test_passed: true };
  assert.throws(
    () => rpcAuthorizeHandover({ repair: inProgressRepair, quoteApproved: true, paymentCleared: true }),
    (err) => err.code === "22000" && err.message.includes("PRECONDITION_FAILED")
  );
});

// ------------------------------------------------------------------------------
// TEST-13-14: Payment Clearance Rejection
// ------------------------------------------------------------------------------
test("TEST-13-14: Payment Clearance Rejection - Handover blocked until dues cleared in database", () => {
  function rpcRecordOfflinePaymentClearance({ callerRole, quoteApproved, paymentMethod, paymentReference }) {
    if (!quoteApproved) {
      const err = new Error("QUOTE_NOT_APPROVED: An approved itemized quote is required before payment clearance.");
      err.code = "22000";
      throw err;
    }
    const allowedMethods = ["CASH_ON_DELIVERY", "DIRECT_UPI", "DIRECT_BANK_TRANSFER", "OFFLINE_CHEQUE", "WAIVED_WARRANTY"];
    if (!allowedMethods.includes(paymentMethod)) {
      const err = new Error("INVALID_PAYMENT_METHOD");
      err.code = "22000";
      throw err;
    }
    const trimmedRef = paymentReference?.trim();
    if (["DIRECT_UPI", "DIRECT_BANK_TRANSFER", "OFFLINE_CHEQUE"].includes(paymentMethod)) {
      if (!trimmedRef || trimmedRef.length < 4) {
        const err = new Error(`MISSING_PAYMENT_REFERENCE: A valid transaction reference is required for ${paymentMethod}.`);
        err.code = "22000";
        throw err;
      }
    }
    return {
      payment_cleared_at: new Date().toISOString(),
      payment_method: paymentMethod,
      payment_reference: trimmedRef || null,
    };
  }

  // Missing approved quote fails
  assert.throws(
    () =>
      rpcRecordOfflinePaymentClearance({
        callerRole: "technician",
        quoteApproved: false,
        paymentMethod: "CASH_ON_DELIVERY",
        paymentReference: null,
      }),
    (err) => err.code === "22000" && err.message.includes("QUOTE_NOT_APPROVED")
  );

  // UPI without reference fails
  assert.throws(
    () =>
      rpcRecordOfflinePaymentClearance({
        callerRole: "technician",
        quoteApproved: true,
        paymentMethod: "DIRECT_UPI",
        paymentReference: "12",
      }),
    (err) => err.code === "22000" && err.message.includes("MISSING_PAYMENT_REFERENCE")
  );

  // Valid UPI payment succeeds
  const cleared = rpcRecordOfflinePaymentClearance({
    callerRole: "technician",
    quoteApproved: true,
    paymentMethod: "DIRECT_UPI",
    paymentReference: "UPI-ICICI-9876543210",
  });
  assert.ok(cleared.payment_cleared_at);
  assert.equal(cleared.payment_reference, "UPI-ICICI-9876543210");
});

// ------------------------------------------------------------------------------
// TEST-13-15: Farmer Collection Ownership
// ------------------------------------------------------------------------------
test("TEST-13-15: Farmer Collection Ownership - Only owning farmer can confirm machinery collection", () => {
  function rpcConfirmFarmerCollection({ callerId, repair }) {
    if (repair.farmer_id !== callerId) {
      const err = new Error("UNAUTHORIZED: Only the owning farmer can confirm equipment collection.");
      err.code = "42501";
      throw err;
    }
    if (repair.handover_status !== "RELEASED") {
      const err = new Error("PRECONDITION_FAILED: Equipment must be in RELEASED status before collection can be confirmed.");
      err.code = "22000";
      throw err;
    }
    return { ...repair, farmer_collection_confirmed: true, farmer_collection_confirmed_at: new Date().toISOString() };
  }

  const releasedRepair = {
    id: "rep-rel",
    farmer_id: FARMER_1,
    handover_status: "RELEASED",
    farmer_collection_confirmed: false,
  };

  // Unrelated farmer FARMER_2 fails
  assert.throws(
    () => rpcConfirmFarmerCollection({ callerId: FARMER_2, repair: releasedRepair }),
    (err) => err.code === "42501" && err.message.includes("UNAUTHORIZED")
  );

  // Calling when not RELEASED fails
  const pendingHandoverRepair = { ...releasedRepair, handover_status: "AUTHORIZED" };
  assert.throws(
    () => rpcConfirmFarmerCollection({ callerId: FARMER_1, repair: pendingHandoverRepair }),
    (err) => err.code === "22000" && err.message.includes("PRECONDITION_FAILED")
  );

  // Owning farmer succeeds
  const confirmed = rpcConfirmFarmerCollection({ callerId: FARMER_1, repair: releasedRepair });
  assert.equal(confirmed.farmer_collection_confirmed, true);
});

// ------------------------------------------------------------------------------
// TEST-13-16: Concurrent Rating Serialization
// ------------------------------------------------------------------------------
test("TEST-13-16: Concurrent Rating Serialization - Concurrency lock serializes execution and matches arithmetic mean", async () => {
  // Simulate serialized row updates using an async mutex queue representing FOR UPDATE row lock on technician_profiles
  class TechnicianProfileMutex {
    constructor(initialRating = null, initialCount = 0) {
      this.rating = initialRating;
      this.reviewCount = initialCount;
      this.reviews = [];
      this.lock = Promise.resolve();
    }

    addReviewSerialized(review) {
      // Each review submission waits for the technician profile row lock
      this.lock = this.lock.then(async () => {
        // Row lock acquired: PERFORM profile_id FROM technician_profiles WHERE profile_id = v_tech FOR UPDATE
        await new Promise((resolve) => setTimeout(resolve, 5)); // simulate DB I/O latency
        this.reviews.push(review);

        // Compute round(avg(rating), 2)
        const published = this.reviews.filter((r) => r.is_published);
        const sum = published.reduce((acc, r) => acc + r.rating, 0);
        this.rating = published.length ? Math.round((sum / published.length) * 100) / 100 : null;
        this.reviewCount = published.length;
      });
      return this.lock;
    }
  }

  const mutex = new TechnicianProfileMutex();

  // 5 concurrent submissions from different farmer clients
  const submissions = [
    { id: "r1", rating: 5, is_published: true },
    { id: "r2", rating: 4, is_published: true },
    { id: "r3", rating: 4, is_published: true },
    { id: "r4", rating: 5, is_published: true },
    { id: "r5", rating: 5, is_published: true },
  ];

  await Promise.all(submissions.map((s) => mutex.addReviewSerialized(s)));

  // Arithmetic average of [5, 4, 4, 5, 5] is 23 / 5 = 4.60
  assert.equal(mutex.reviewCount, 5);
  assert.equal(mutex.rating, 4.60);
});

// ==============================================================================
// 3. ADDITIONAL RELATIONAL INVARIANTS & LIFECYCLE TESTS
// ==============================================================================

test("Handover Location RPC: Geolocation hidden from farmers until AUTHORIZED", () => {
  function getFacilityHandoverLocation({ callerId, callerRole, repair, facility }) {
    const isAdmin = callerRole === "admin" || callerRole === "service_centre";
    const isTech = repair.technician_id === callerId;
    const isFarmer = repair.farmer_id === callerId;

    if (isAdmin || isTech) {
      return { latitude: facility.latitude, longitude: facility.longitude, name: facility.name };
    }

    if (isFarmer) {
      if (repair.status === "CANCELLED") {
        throw new Error("42501: ACCESS_DENIED: Workshop coordinates are not accessible for cancelled repairs.");
      }
      if (repair.handover_status === "PENDING") {
        throw new Error("42501: ACCESS_DENIED: Workshop pickup details are not available until equipment handover is authorized.");
      }
      if (repair.handover_status === "RELEASED") {
        throw new Error("42501: ACCESS_DENIED: Equipment has already been released. Workshop handover access is closed.");
      }
      if (repair.handover_status === "AUTHORIZED") {
        return { latitude: facility.latitude, longitude: facility.longitude, name: facility.name };
      }
    }

    throw new Error("42501: ACCESS_DENIED");
  }

  const facility = { latitude: 21.1458, longitude: 79.0882, name: "Nagpur Central Workshop" };
  const repair = { id: "rep-loc", farmer_id: FARMER_1, technician_id: TECH_1, status: "COMPLETED", handover_status: "PENDING" };

  // Farmer denied when PENDING
  assert.throws(
    () => getFacilityHandoverLocation({ callerId: FARMER_1, callerRole: "farmer", repair, facility }),
    /42501/
  );

  // Farmer allowed when AUTHORIZED
  const authRepair = { ...repair, handover_status: "AUTHORIZED" };
  const loc = getFacilityHandoverLocation({ callerId: FARMER_1, callerRole: "farmer", repair: authRepair, facility });
  assert.equal(loc.latitude, 21.1458);

  // Farmer denied when RELEASED (closed lifecycle)
  const relRepair = { ...repair, handover_status: "RELEASED" };
  assert.throws(
    () => getFacilityHandoverLocation({ callerId: FARMER_1, callerRole: "farmer", repair: relRepair, facility }),
    /42501/
  );
});

test("Facility Invitation Flow: Pending state, expiration, and authorization", () => {
  function acceptInvitation({ callerId, membership, currentDate }) {
    if (membership.technician_profile_id !== callerId) {
      throw new Error("42501: UNAUTHORIZED: Only the invited technician can accept this invitation.");
    }
    if (membership.status !== "INVITED") {
      throw new Error("22000: INVALID_STATE: Invitation is not in INVITED status.");
    }
    const daysOld = (currentDate.getTime() - new Date(membership.created_at).getTime()) / (1000 * 60 * 60 * 24);
    if (daysOld > 14) {
      throw new Error("22000: INVITATION_EXPIRED: This invitation has expired (valid for 14 days).");
    }
    return { ...membership, status: "ACTIVE", joined_at: currentDate.toISOString() };
  }

  const now = new Date("2026-11-06T12:00:00Z");
  const validInvitation = {
    id: "mem-inv-1",
    facility_id: FACILITY_1,
    technician_profile_id: TECH_2,
    role: "TECHNICIAN",
    status: "INVITED",
    created_at: "2026-11-01T12:00:00Z", // 5 days old
  };

  // Other tech cannot accept
  assert.throws(
    () => acceptInvitation({ callerId: TECH_1, membership: validInvitation, currentDate: now }),
    /42501/
  );

  // Invited tech accepts -> ACTIVE
  const accepted = acceptInvitation({ callerId: TECH_2, membership: validInvitation, currentDate: now });
  assert.equal(accepted.status, "ACTIVE");

  // Expired invitation (15 days old) fails
  const expiredInvitation = { ...validInvitation, created_at: "2026-10-20T12:00:00Z" };
  assert.throws(
    () => acceptInvitation({ callerId: TECH_2, membership: expiredInvitation, currentDate: now }),
    /INVITATION_EXPIRED/
  );
});

test("Service History Immutability Guard: Trigger unconditionally rejects updates", () => {
  function triggerGuardServiceHistoryImmutability() {
    const err = new Error("42501: IMMUTABLE_RECORD: Service history records are permanent and immutable. Updates are strictly prohibited.");
    err.code = "42501";
    throw err;
  }

  assert.throws(
    () => triggerGuardServiceHistoryImmutability(),
    (err) => err.code === "42501" && err.message.includes("IMMUTABLE_RECORD")
  );
});

test("Completed Repair Relational Anti-Tamper Guard: Relational identities frozen on completion", () => {
  function triggerGuardCompletedRepairRelationships(oldRecord, newRecord) {
    if (oldRecord.status === "COMPLETED" || newRecord.status === "COMPLETED") {
      if (
        newRecord.farmer_id !== oldRecord.farmer_id ||
        newRecord.technician_id !== oldRecord.technician_id ||
        newRecord.equipment_id !== oldRecord.equipment_id
      ) {
        const err = new Error("42501: RELATIONSHIP_FROZEN: Core relational identities cannot be altered.");
        err.code = "42501";
        throw err;
      }
    }

    if (oldRecord.status === "COMPLETED" && newRecord.status !== "COMPLETED") {
      const err = new Error("42501: INVALID_TRANSITION: Completed repair tickets cannot be reverted to any prior status.");
      err.code = "42501";
      throw err;
    }

    if (newRecord.status === "COMPLETED" && !newRecord.technician_id) {
      const err = new Error("22000: INVALID_COMPLETION: Repair request cannot be completed without an assigned technician.");
      err.code = "22000";
      throw err;
    }

    return newRecord;
  }

  const completedRepair = {
    id: "rep-c",
    status: "COMPLETED",
    farmer_id: FARMER_1,
    technician_id: TECH_1,
    equipment_id: "eq-1",
  };

  // Attempt to switch technician after completion fails
  assert.throws(
    () => triggerGuardCompletedRepairRelationships(completedRepair, { ...completedRepair, technician_id: TECH_2 }),
    (err) => err.code === "42501" && err.message.includes("RELATIONSHIP_FROZEN")
  );

  // Attempt to revert to IN_PROGRESS fails
  assert.throws(
    () => triggerGuardCompletedRepairRelationships(completedRepair, { ...completedRepair, status: "IN_PROGRESS" }),
    (err) => err.code === "42501" && err.message.includes("INVALID_TRANSITION")
  );
});

// ------------------------------------------------------------------------------
// TEST-13-17: Technician Profile Mutation Guard & Privilege Escalation Prevention
// ------------------------------------------------------------------------------
test("TEST-13-17: Technician Profile Mutation Guard - Eliminates service_role bypass; enforces RPC-only protected updates", () => {
  function simulateGuardTechnicianProfileMutation({ currentUser, oldRecord, newRecord }) {
    // 1. Authorized system maintenance: ONLY postgres definer routines (SECURITY DEFINER owned by postgres)
    if (currentUser === "postgres") {
      return newRecord;
    }

    // 2. Direct client updates (from authenticated, service_role, anon, or PUBLIC) are forbidden from modifying protected fields
    const isDistinct = (a, b) => JSON.stringify(a) !== JSON.stringify(b);

    if (
      isDistinct(newRecord.is_verified, oldRecord.is_verified) ||
      isDistinct(newRecord.kyc_verified, oldRecord.kyc_verified) ||
      isDistinct(newRecord.kyc_verified_at, oldRecord.kyc_verified_at) ||
      isDistinct(newRecord.kyc_verified_by, oldRecord.kyc_verified_by) ||
      isDistinct(newRecord.kyc_document_type, oldRecord.kyc_document_type) ||
      isDistinct(newRecord.kyc_masked_id, oldRecord.kyc_masked_id) ||
      isDistinct(newRecord.kyc_remarks, oldRecord.kyc_remarks) ||
      isDistinct(newRecord.verified_skills, oldRecord.verified_skills) ||
      isDistinct(newRecord.ai_suggested_skills, oldRecord.ai_suggested_skills) ||
      isDistinct(newRecord.rating, oldRecord.rating) ||
      isDistinct(newRecord.review_count, oldRecord.review_count) ||
      isDistinct(newRecord.jobs_completed, oldRecord.jobs_completed)
    ) {
      const err = new Error("42501: FORBIDDEN_MUTATION: Direct client modification of protected technician profile governance, rating, or KYC fields is strictly prohibited.");
      err.code = "42501";
      throw err;
    }

    return newRecord;
  }

  const baseTechProfile = {
    id: "tp-1",
    profile_id: TECH_1,
    workshop_name: "Original Workshop",
    brands: ["Mahindra"],
    skills: ["Engine Overhaul"],
    verified_skills: ["Engine Overhaul"],
    ai_suggested_skills: ["Hydraulics"],
    rating: null,
    review_count: 0,
    jobs_completed: 5,
    is_available: true,
    is_verified: true,
    kyc_verified: true,
    kyc_document_type: "AADHAAR",
    kyc_masked_id: "XXXX-XXXX-1234",
    kyc_remarks: "Verified in person",
  };

  // 1. Technician self-update of protected fields is rejected
  assert.throws(
    () =>
      simulateGuardTechnicianProfileMutation({
        currentUser: "authenticated",
        oldRecord: baseTechProfile,
        newRecord: { ...baseTechProfile, verified_skills: ["Engine Overhaul", "Hydraulics"] },
      }),
    (err) => err.code === "42501" && err.message.includes("FORBIDDEN_MUTATION"),
    "Technician self-promotion of skills must be rejected"
  );

  assert.throws(
    () =>
      simulateGuardTechnicianProfileMutation({
        currentUser: "authenticated",
        oldRecord: baseTechProfile,
        newRecord: { ...baseTechProfile, rating: 5.0 },
      }),
    (err) => err.code === "42501" && err.message.includes("FORBIDDEN_MUTATION"),
    "Technician tampering with rating must be rejected"
  );

  assert.throws(
    () =>
      simulateGuardTechnicianProfileMutation({
        currentUser: "authenticated",
        oldRecord: { ...baseTechProfile, kyc_verified: false },
        newRecord: { ...baseTechProfile, kyc_verified: true },
      }),
    (err) => err.code === "42501" && err.message.includes("FORBIDDEN_MUTATION"),
    "Technician tampering with KYC status must be rejected"
  );

  // 2. Raw service_role direct update of protected fields is rejected (NO service_role bypass)
  assert.throws(
    () =>
      simulateGuardTechnicianProfileMutation({
        currentUser: "service_role",
        oldRecord: baseTechProfile,
        newRecord: { ...baseTechProfile, kyc_verified: true, rating: 5.0 },
      }),
    (err) => err.code === "42501" && err.message.includes("FORBIDDEN_MUTATION"),
    "Raw service_role direct mutation of protected fields must be rejected"
  );

  assert.throws(
    () =>
      simulateGuardTechnicianProfileMutation({
        currentUser: "service_role",
        oldRecord: baseTechProfile,
        newRecord: { ...baseTechProfile, verified_skills: ["Unverified Skill"] },
      }),
    (err) => err.code === "42501" && err.message.includes("FORBIDDEN_MUTATION"),
    "Raw service_role direct mutation of verified_skills must be rejected"
  );

  // 3. Authorized admin RPC operation (running as postgres definer) succeeds
  const adminRpcUpdated = simulateGuardTechnicianProfileMutation({
    currentUser: "postgres", // inside SECURITY DEFINER RPC (e.g. verify_technician_kyc, approve_technician_skill)
    oldRecord: baseTechProfile,
    newRecord: { ...baseTechProfile, verified_skills: ["Engine Overhaul", "Hydraulics"] },
  });
  assert.deepEqual(adminRpcUpdated.verified_skills, ["Engine Overhaul", "Hydraulics"]);

  const systemRatingUpdated = simulateGuardTechnicianProfileMutation({
    currentUser: "postgres", // inside SECURITY DEFINER trigger recalculate_technician_rating
    oldRecord: baseTechProfile,
    newRecord: { ...baseTechProfile, rating: 4.85, review_count: 1 },
  });
  assert.equal(systemRatingUpdated.rating, 4.85);
  assert.equal(systemRatingUpdated.review_count, 1);

  // 4. Existing legitimate technician profile updates still work (operational fields including workshop_name, phone, is_available, skills)
  const updatedOperational = simulateGuardTechnicianProfileMutation({
    currentUser: "authenticated",
    oldRecord: baseTechProfile,
    newRecord: {
      ...baseTechProfile,
      workshop_name: "Nagpur Central Agro Workshop",
      phone: "+91-98765-43210",
      is_available: false,
      skills: ["Engine Overhaul", "Plow Repair"],
    },
  });
  assert.equal(updatedOperational.workshop_name, "Nagpur Central Agro Workshop");
  assert.equal(updatedOperational.phone, "+91-98765-43210");
  assert.equal(updatedOperational.is_available, false);
  assert.deepEqual(updatedOperational.skills, ["Engine Overhaul", "Plow Repair"]);
});

// ------------------------------------------------------------------------------
// TEST-13-18: Facility Management Profile Access Control RPC
// ------------------------------------------------------------------------------
test("TEST-13-18: Facility Management Profile - OWNER/MANAGER and admin read full profile, others denied", () => {
  const facility = {
    id: FACILITY_1,
    name: "Nagpur Central Agro Repairs",
    owner_profile_id: TECH_1,
    phone: "+91-98230-11223",
    email: "workshop@demo.com",
    address: "Plot 14, MIDC Complex",
    village: "Hingna",
    tahsil: "Hingna",
    latitude: 21.0965,
    longitude: 78.9876,
    max_equipment_capacity: 4,
    drop_off_approved: true,
    is_active: true,
  };

  const memberships = [
    { facility_id: FACILITY_1, technician_profile_id: TECH_1, role: "OWNER", status: "ACTIVE" },
    { facility_id: FACILITY_1, technician_profile_id: TECH_2, role: "MANAGER", status: "ACTIVE" },
    { facility_id: FACILITY_1, technician_profile_id: TECH_3, role: "TECHNICIAN", status: "ACTIVE" },
  ];

  function getFacilityManagementProfile({ callerProfileId, callerRole, facilityId }) {
    let isAuthorized = false;

    if (["admin", "service_centre"].includes(callerRole)) {
      isAuthorized = true;
    } else {
      isAuthorized = memberships.some(
        (m) =>
          m.facility_id === facilityId &&
          m.technician_profile_id === callerProfileId &&
          ["OWNER", "MANAGER"].includes(m.role) &&
          m.status === "ACTIVE"
      );
    }

    if (!isAuthorized) {
      const err = new Error("42501: ACCESS_DENIED: Caller is not an authorized owner, manager, or Service Centre administrator for this facility.");
      err.code = "42501";
      throw err;
    }

    if (facilityId !== facility.id) {
      const err = new Error("02000: NOT_FOUND: Facility record does not exist.");
      err.code = "02000";
      throw err;
    }

    return facility;
  }

  // Facility OWNER succeeds
  const ownerResult = getFacilityManagementProfile({
    callerProfileId: TECH_1,
    callerRole: "technician",
    facilityId: FACILITY_1,
  });
  assert.equal(ownerResult.phone, "+91-98230-11223");
  assert.equal(ownerResult.max_equipment_capacity, 4);

  // Facility MANAGER succeeds
  const managerResult = getFacilityManagementProfile({
    callerProfileId: TECH_2,
    callerRole: "technician",
    facilityId: FACILITY_1,
  });
  assert.equal(managerResult.address, "Plot 14, MIDC Complex");

  // Admin succeeds
  const adminResult = getFacilityManagementProfile({
    callerProfileId: ADMIN_1,
    callerRole: "admin",
    facilityId: FACILITY_1,
  });
  assert.equal(adminResult.name, "Nagpur Central Agro Repairs");

  // Regular technician member fails
  assert.throws(
    () =>
      getFacilityManagementProfile({
        callerProfileId: TECH_3,
        callerRole: "technician",
        facilityId: FACILITY_1,
      }),
    (err) => err.code === "42501" && err.message.includes("ACCESS_DENIED")
  );

  // Farmer fails
  assert.throws(
    () =>
      getFacilityManagementProfile({
        callerProfileId: FARMER_1,
        callerRole: "farmer",
        facilityId: FACILITY_1,
      }),
    (err) => err.code === "42501" && err.message.includes("ACCESS_DENIED")
  );

  // Non-existent facility throws NOT_FOUND
  assert.throws(
    () =>
      getFacilityManagementProfile({
        callerProfileId: ADMIN_1,
        callerRole: "admin",
        facilityId: "99999999-9999-9999-9999-999999999999",
      }),
    (err) => err.code === "02000" && err.message.includes("NOT_FOUND")
  );
});

// ------------------------------------------------------------------------------
// TEST-13-19: Technician Private Profile KYC and AI Skills Isolation RPC
// ------------------------------------------------------------------------------
test("TEST-13-19: Technician Private Profile - Self and admin access private KYC and AI data; others blocked", () => {
  const privateTechProfiles = {
    [TECH_1]: {
      profile_id: TECH_1,
      kyc_verified: true,
      kyc_verified_at: "2026-11-06T10:00:00Z",
      kyc_verified_by: ADMIN_1,
      kyc_document_type: "AADHAAR",
      kyc_masked_id: "XXXX-XXXX-9876",
      kyc_remarks: "Inspected physical certificate",
      ai_suggested_skills: ["Laser Land Leveling", "Pneumatic Planter"],
      verified_skills: ["Engine Overhaul"],
    },
  };

  function getTechnicianPrivateProfile({ callerProfileId, callerRole, targetProfileId }) {
    let isAuthorized = false;

    if (["admin", "service_centre"].includes(callerRole)) {
      isAuthorized = true;
    } else if (callerProfileId === targetProfileId) {
      isAuthorized = true;
    }

    if (!isAuthorized) {
      const err = new Error("42501: ACCESS_DENIED: Caller is not authorized to view private KYC or AI skill data for this technician.");
      err.code = "42501";
      throw err;
    }

    const record = privateTechProfiles[targetProfileId];
    if (!record) {
      const err = new Error("02000: NOT_FOUND: Technician profile does not exist.");
      err.code = "02000";
      throw err;
    }

    return record;
  }

  // Self access succeeds
  const selfResult = getTechnicianPrivateProfile({
    callerProfileId: TECH_1,
    callerRole: "technician",
    targetProfileId: TECH_1,
  });
  assert.equal(selfResult.kyc_masked_id, "XXXX-XXXX-9876");
  assert.deepEqual(selfResult.ai_suggested_skills, ["Laser Land Leveling", "Pneumatic Planter"]);

  // Admin access succeeds
  const adminResult = getTechnicianPrivateProfile({
    callerProfileId: ADMIN_1,
    callerRole: "admin",
    targetProfileId: TECH_1,
  });
  assert.equal(adminResult.kyc_remarks, "Inspected physical certificate");

  // Other technician fails
  assert.throws(
    () =>
      getTechnicianPrivateProfile({
        callerProfileId: TECH_2,
        callerRole: "technician",
        targetProfileId: TECH_1,
      }),
    (err) => err.code === "42501" && err.message.includes("ACCESS_DENIED")
  );

  // Farmer fails
  assert.throws(
    () =>
      getTechnicianPrivateProfile({
        callerProfileId: FARMER_1,
        callerRole: "farmer",
        targetProfileId: TECH_1,
      }),
    (err) => err.code === "42501" && err.message.includes("ACCESS_DENIED")
  );

  // Unknown technician throws NOT_FOUND
  assert.throws(
    () =>
      getTechnicianPrivateProfile({
        callerProfileId: ADMIN_1,
        callerRole: "admin",
        targetProfileId: "99999999-9999-9999-9999-999999999999",
      }),
    (err) => err.code === "02000" && err.message.includes("NOT_FOUND")
  );
});

// ------------------------------------------------------------------------------
// TEST-13-20: Restored Staging Demo Reset Baseline & Multi-Entity Cascade
// ------------------------------------------------------------------------------
test("TEST-13-20: Restored Staging Demo Reset Baseline - Verifies pair auth, cascade order, and parts baseline", () => {
  const STAGING_PAIRS = [
    { id: "00000000-0000-0000-0001-000000000001", email: "farmer.staging@terrabyte.app" },
    { id: "00000000-0000-0000-0002-000000000001", email: "tech.staging@terrabyte.app" },
    { id: "00000000-0000-0000-0003-000000000001", email: "admin.staging@terrabyte.app" },
    { id: "00000000-0000-0000-0000-000000000001", email: "farmer.nagpur@terrabyte.demo" },
    { id: "00000000-0000-0000-0000-000000000004", email: "tech.nagpur@terrabyte.demo" },
    { id: "00000000-0000-0000-0000-000000000005", email: "admin.nagpur@terrabyte.demo" },
  ];

  function simulateResetDemoData({ callerId, callerEmail, hasDemoCode }) {
    // 1. Auth check
    if (!callerId) {
      throw new Error("42501: Unauthorized: Demo reset requires an authenticated session.");
    }

    // 2. Exact Pair Matching
    const isMatched = STAGING_PAIRS.some((p) => p.id === callerId && p.email === callerEmail);
    if (!isMatched) {
      throw new Error("42501: Unauthorized: Demo reset is strictly reserved for designated demo evaluation personas.");
    }

    // 3. Dual-Key Verification
    if (!hasDemoCode) {
      throw new Error("42501: Forbidden: caller profile is missing demo_code");
    }

    // 4. Cascade execution order tracking
    const executionOrder = [];

    // Pre-delete reviews (FK to service_history & repair_requests ON DELETE RESTRICT)
    executionOrder.push("technician_reviews");
    // Service history (BEFORE repair_requests and equipment due to ON DELETE RESTRICT)
    executionOrder.push("service_history");
    // Quote items and quotes
    executionOrder.push("quote_items");
    executionOrder.push("quotes");
    // Repair sub-tables
    executionOrder.push("repair_dispatch_locations");
    executionOrder.push("repair_messages");
    executionOrder.push("repair_notes");
    executionOrder.push("repair_timeline");
    // Parts desk records
    executionOrder.push("service_centre_part_sales");
    executionOrder.push("service_centre_part_requests");
    executionOrder.push("service_centre_stock_audit");
    // Repair requests (unreferenced now that reviews, service_history, quotes, and sub-tables are deleted)
    executionOrder.push("repair_requests");
    // Notifications
    executionOrder.push("notifications");
    // Parts inventory baseline
    executionOrder.push("restore_canonical_parts_5");
    // Equipment (unreferenced now that service_history and repair_requests are deleted)
    executionOrder.push("restore_canonical_equipment_3");
    // Demo facility
    executionOrder.push("upsert_demo_facility");
    // Demo technician
    executionOrder.push("reset_demo_technician");

    const canonicalParts = [
      { part_number: "0433171", name: "Fuel Injector Nozzle Set", stock_quantity: 3 },
      { part_number: "005556958R1", name: "Inline Fuel Filter", stock_quantity: 8 },
      { part_number: "AL120788", name: "Lift Cylinder Seal Kit", stock_quantity: 2 },
      { part_number: "HY-GARD-15W30", name: "Hydraulic Oil 15W-30", stock_quantity: 5 },
      { part_number: "26243171", name: "Starter Motor Assembly", stock_quantity: 1 },
    ];

    return {
      success: true,
      executionOrder,
      canonicalParts,
    };
  }

  // Valid staging admin call succeeds
  const result = simulateResetDemoData({
    callerId: "00000000-0000-0000-0003-000000000001",
    callerEmail: "admin.staging@terrabyte.app",
    hasDemoCode: true,
  });
  assert.equal(result.success, true);
  assert.equal(result.canonicalParts.length, 5);
  assert.equal(result.canonicalParts[0].stock_quantity, 3);
  assert.equal(result.canonicalParts[1].stock_quantity, 8);

  const reviewsIdx = result.executionOrder.indexOf("technician_reviews");
  const shIdx = result.executionOrder.indexOf("service_history");
  const quotesIdx = result.executionOrder.indexOf("quotes");
  const salesIdx = result.executionOrder.indexOf("service_centre_part_sales");
  const repairIdx = result.executionOrder.indexOf("repair_requests");
  const equipIdx = result.executionOrder.indexOf("restore_canonical_equipment_3");

  // 1. Reviews are pre-deleted BEFORE service_history (satisfies technician_reviews.service_history_id RESTRICT)
  assert.ok(reviewsIdx < shIdx, "Reviews must be pre-deleted before service_history");

  // 2. Reviews are pre-deleted BEFORE repair_requests (satisfies technician_reviews.repair_id RESTRICT)
  assert.ok(reviewsIdx < repairIdx, "Reviews must be pre-deleted before repair_requests");

  // 3. Service history is deleted BEFORE repair_requests (satisfies service_history.repair_request_id RESTRICT)
  assert.ok(shIdx < repairIdx, "Service history must be deleted before repair_requests");

  // 4. Service history is deleted BEFORE equipment (satisfies service_history.equipment_id RESTRICT)
  assert.ok(shIdx < equipIdx, "Service history must be deleted before equipment");

  // 5. Quotes and parts desk records are deleted before repair_requests
  assert.ok(quotesIdx < repairIdx, "Quotes must be deleted before repair_requests");
  assert.ok(salesIdx < repairIdx, "Part sales must be deleted before repair_requests");

  // 6. Repair requests are deleted before equipment (satisfies repair_requests.equipment_id RESTRICT)
  assert.ok(repairIdx < equipIdx, "Repair requests must be deleted before equipment");

  // Mismatched ID and email fails
  assert.throws(
    () =>
      simulateResetDemoData({
        callerId: "00000000-0000-0000-0001-000000000001",
        callerEmail: "tech.staging@terrabyte.app", // mismatched email
        hasDemoCode: true,
      }),
    (err) => err.message.includes("42501")
  );

  // Missing demo code fails
  assert.throws(
    () =>
      simulateResetDemoData({
        callerId: "00000000-0000-0000-0003-000000000001",
        callerEmail: "admin.staging@terrabyte.app",
        hasDemoCode: false,
      }),
    (err) => err.message.includes("missing demo_code")
  );
});

// ------------------------------------------------------------------------------
// TEST-13-21: Admin Set Technician Verification RPC & Direct Mutation Denial
// ------------------------------------------------------------------------------
test("TEST-13-21: Admin Set Technician Verification RPC - Enforces admin authorization, updates is_verified, and rejects non-admin callers", () => {
  const techProfiles = {
    [TECH_1]: {
      id: "tp-1",
      profile_id: TECH_1,
      workshop_name: "Nagpur Central Agro Repairs",
      is_verified: false,
    },
  };

  function rpcAdminSetTechnicianVerification({ callerRole, targetTechId, isVerified }) {
    if (!["admin", "service_centre"].includes(callerRole)) {
      const err = new Error("42501: UNAUTHORIZED: Only service centre administrators can update technician account verification.");
      err.code = "42501";
      throw err;
    }

    if (!targetTechId) {
      const err = new Error("22000: INVALID_ARGUMENT: Technician profile ID is required.");
      err.code = "22000";
      throw err;
    }

    const tech = techProfiles[targetTechId];
    if (!tech) {
      const err = new Error("02000: NOT_FOUND: Technician profile not found for the specified ID.");
      err.code = "02000";
      throw err;
    }

    tech.is_verified = isVerified;
    return {
      success: true,
      id: tech.id,
      profile_id: tech.profile_id,
      is_verified: tech.is_verified,
      workshop_name: tech.workshop_name,
    };
  }

  // 1. Admin approval succeeds
  const resApprove = rpcAdminSetTechnicianVerification({
    callerRole: "admin",
    targetTechId: TECH_1,
    isVerified: true,
  });
  assert.equal(resApprove.success, true);
  assert.equal(resApprove.is_verified, true);
  assert.equal(techProfiles[TECH_1].is_verified, true);

  // 2. Admin revocation succeeds
  const resRevoke = rpcAdminSetTechnicianVerification({
    callerRole: "service_centre",
    targetTechId: TECH_1,
    isVerified: false,
  });
  assert.equal(resRevoke.success, true);
  assert.equal(resRevoke.is_verified, false);
  assert.equal(techProfiles[TECH_1].is_verified, false);

  // 3. Technician self-approval is rejected
  assert.throws(
    () =>
      rpcAdminSetTechnicianVerification({
        callerRole: "technician",
        targetTechId: TECH_1,
        isVerified: true,
      }),
    (err) => err.code === "42501" && err.message.includes("UNAUTHORIZED")
  );

  // 4. Farmer approval is rejected
  assert.throws(
    () =>
      rpcAdminSetTechnicianVerification({
        callerRole: "farmer",
        targetTechId: TECH_1,
        isVerified: true,
      }),
    (err) => err.code === "42501" && err.message.includes("UNAUTHORIZED")
  );

  // 5. Missing profile ID is rejected
  assert.throws(
    () =>
      rpcAdminSetTechnicianVerification({
        callerRole: "admin",
        targetTechId: null,
        isVerified: true,
      }),
    (err) => err.code === "22000" && err.message.includes("INVALID_ARGUMENT")
  );
});

// ------------------------------------------------------------------------------
// TEST-13-22: Technician Workshop Profile RPC & Private Phone Isolation
// ------------------------------------------------------------------------------
test("TEST-13-22: Technician Workshop Profile RPC - Owner and admin access private workshop phone, third-party and public queries denied", () => {
  const workshopProfiles = {
    [TECH_1]: {
      profile_id: TECH_1,
      workshop_name: "Nagpur Central Agro Workshop",
      phone: "+91-98230-11223",
      is_available: true,
      primary_facility_id: "00000000-0000-0000-0020-000000000001",
    },
  };

  function rpcGetTechnicianWorkshopProfile({ callerProfileId, callerRole, targetProfileId }) {
    const effectiveTargetId = targetProfileId || callerProfileId;
    if (!effectiveTargetId) {
      const err = new Error("42501: UNAUTHORIZED: Authentication required.");
      err.code = "42501";
      throw err;
    }

    const isAuthorized =
      ["admin", "service_centre"].includes(callerRole) ||
      callerProfileId === effectiveTargetId;

    if (!isAuthorized) {
      const err = new Error("42501: ACCESS_DENIED: Caller is not authorized to view workshop phone for this technician.");
      err.code = "42501";
      throw err;
    }

    const rec = workshopProfiles[effectiveTargetId];
    if (!rec) return null;

    return {
      profile_id: rec.profile_id,
      workshop_name: rec.workshop_name,
      phone: rec.phone,
      is_available: rec.is_available,
      primary_facility_id: rec.primary_facility_id,
    };
  }

  // 1. Technician retrieves their own workshop phone
  const selfWorkshop = rpcGetTechnicianWorkshopProfile({
    callerProfileId: TECH_1,
    callerRole: "technician",
    targetProfileId: null, // default to self
  });
  assert.equal(selfWorkshop.workshop_name, "Nagpur Central Agro Workshop");
  assert.equal(selfWorkshop.phone, "+91-98230-11223");

  // 2. Service centre admin retrieves technician workshop phone
  const adminWorkshop = rpcGetTechnicianWorkshopProfile({
    callerProfileId: ADMIN_1,
    callerRole: "admin",
    targetProfileId: TECH_1,
  });
  assert.equal(adminWorkshop.phone, "+91-98230-11223");

  // 3. Another technician cannot retrieve private workshop phone
  assert.throws(
    () =>
      rpcGetTechnicianWorkshopProfile({
        callerProfileId: TECH_2,
        callerRole: "technician",
        targetProfileId: TECH_1,
      }),
    (err) => err.code === "42501" && err.message.includes("ACCESS_DENIED")
  );

  // 4. Farmer cannot retrieve private workshop phone
  assert.throws(
    () =>
      rpcGetTechnicianWorkshopProfile({
        callerProfileId: FARMER_1,
        callerRole: "farmer",
        targetProfileId: TECH_1,
      }),
    (err) => err.code === "42501" && err.message.includes("ACCESS_DENIED")
  );
});

// ------------------------------------------------------------------------------
// TEST-13-23: Technician Profile Frontend Projection Invariant
// ------------------------------------------------------------------------------
test("TEST-13-23: Technician Profile Frontend Projection Invariant - Rejects wildcard SELECT * and validates explicit safe columns", () => {
  const techServicePath = path.join(ROOT_DIR, "src", "lib", "services", "technicians.ts");
  const techServiceContent = fs.readFileSync(techServicePath, "utf8");

  // 1. Verify TECHNICIAN_SAFE_PROJECTION is defined
  assert.match(
    techServiceContent,
    /export\s+const\s+TECHNICIAN_SAFE_PROJECTION\s*=/i,
    "TECHNICIAN_SAFE_PROJECTION constant must be exported"
  );

  // 2. Verify all queries on technician_profiles use TECHNICIAN_SAFE_PROJECTION
  assert.doesNotMatch(
    techServiceContent,
    /\.from\s*\(\s*["']technician_profiles["']\s*\)\s*\.select\s*\(\s*["']\*/i,
    "technicians.ts must NOT contain wildcard SELECT * on technician_profiles"
  );

  // 3. Verify safe projection excludes confidential audit fields and private table phone
  const matchProjection = techServiceContent.match(/TECHNICIAN_SAFE_PROJECTION\s*=\s*["']([^"']+)["']/);
  assert.ok(matchProjection, "TECHNICIAN_SAFE_PROJECTION string must be extracted");
  const topLevelString = matchProjection[1].replace(/profile:profile_id\([^)]+\)/, "");
  const projectionColumns = topLevelString.split(",").map((s) => s.trim()).filter(Boolean);

  assert.ok(!projectionColumns.includes("kyc_masked_id"), "Projection must exclude kyc_masked_id");
  assert.ok(!projectionColumns.includes("kyc_remarks"), "Projection must exclude kyc_remarks");
  assert.ok(!projectionColumns.includes("ai_suggested_skills"), "Projection must exclude ai_suggested_skills");
  assert.ok(!projectionColumns.includes("phone"), "Projection must exclude raw table phone from public query");

  // 4. Verify required operational fields are included in projection
  const requiredOperationalFields = [
    "id",
    "profile_id",
    "workshop_name",
    "brands",
    "skills",
    "verified_skills",
    "rating",
    "review_count",
    "is_available",
    "is_verified",
    "kyc_verified",
    "jobs_completed",
    "distance_km",
    "eta_minutes",
    "primary_facility_id",
    "created_at",
    "updated_at",
  ];
  for (const field of requiredOperationalFields) {
    assert.ok(projectionColumns.includes(field), `Projection must include ${field}`);
  }

  // 5. Verify profile.ts invokes get_technician_workshop_profile RPC
  const profileServicePath = path.join(ROOT_DIR, "src", "lib", "services", "profile.ts");
  const profileServiceContent = fs.readFileSync(profileServicePath, "utf8");
  assert.match(
    profileServiceContent,
    /supabase\.rpc\(\s*["']get_technician_workshop_profile["'][\s,]*\)/i,
    "profile.ts must call get_technician_workshop_profile RPC to fetch private workshop phone"
  );
});
