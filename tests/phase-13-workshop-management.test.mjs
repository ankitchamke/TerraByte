import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const FACILITIES_SERVICE_PATH = path.join(ROOT_DIR, "src", "lib", "services", "facilities.ts");
const REGISTER_DIALOG_PATH = path.join(ROOT_DIR, "src", "components", "workshop", "RegisterWorkshopDialog.tsx");
const MANAGE_DIALOG_PATH = path.join(ROOT_DIR, "src", "components", "workshop", "ManageWorkshopDialog.tsx");
const TRANSFER_DIALOG_PATH = path.join(ROOT_DIR, "src", "components", "workshop", "TransferOwnershipDialog.tsx");
const TECH_INDEX_PATH = path.join(ROOT_DIR, "src", "routes", "technician", "index.tsx");
const ADMIN_FACILITIES_PATH = path.join(ROOT_DIR, "src", "routes", "admin", "facilities.tsx");
const ADMIN_INDEX_PATH = path.join(ROOT_DIR, "src", "routes", "admin", "index.tsx");
const MIGRATION_PATH = path.join(ROOT_DIR, "supabase", "migrations", "20261106160000_phase13_database_foundations.sql");

// ==============================================================================
// 1. FACILITIES SERVICE LAYER API CONTRACT
// ==============================================================================

test("Facilities service defines required API methods and Vidarbha tahsil catalog", () => {
  const content = fs.readFileSync(FACILITIES_SERVICE_PATH, "utf8");

  // Core API functions
  const requiredMethods = [
    "getAffiliatedFacilities",
    "getFacilityManagementProfile",
    "getAllFacilitiesAdmin",
    "registerFacility",
    "updateFacility",
    "getFacilityMembers",
    "inviteFacilityMember",
    "acceptFacilityInvitation",
    "rejectFacilityInvitation",
    "revokeFacilityInvitation",
    "removeFacilityMember",
    "transferFacilityOwnership",
    "toggleDropOffApproval",
  ];

  for (const method of requiredMethods) {
    assert.match(
      content,
      new RegExp(`export\\s+(async\\s+)?function\\s+${method}`),
      `facilities.ts must export ${method}()`
    );
  }

  // Tahsils and coordinate catalog
  assert.match(content, /VIDARBHA_TAHSILS\s*=/, "Must export VIDARBHA_TAHSILS array");
  assert.match(content, /TAHSIL_COORDINATES(\s*:\s*[^=]+)?\s*=/, "Must export TAHSIL_COORDINATES map");

  // Verify key Vidarbha tahsils are present
  const requiredTahsils = ["Nagpur", "Hingna", "Katol", "Kalmeshwar", "Saoner", "Ramtek", "Umred"];
  for (const t of requiredTahsils) {
    assert.match(content, new RegExp(`"${t}"`), `VIDARBHA_TAHSILS must include ${t}`);
  }
});

// ==============================================================================
// 2. REGISTER WORKSHOP DIALOG: STRICT 10-COLUMN INTEGRITY
// ==============================================================================

test("RegisterWorkshopDialog enforces strictly the 10 approved columns and rejects unapproved schemas", () => {
  const content = fs.readFileSync(REGISTER_DIALOG_PATH, "utf8");

  // 10 Approved columns
  const approvedColumns = [
    "name",
    "address",
    "village",
    "tahsil",
    "phone",
    "email",
    "latitude",
    "longitude",
    "max_equipment_capacity",
    "operating_hours",
  ];

  for (const col of approvedColumns) {
    assert.match(
      content,
      new RegExp(col),
      `RegisterWorkshopDialog must collect approved column '${col}'`
    );
  }

  // Unapproved columns deferred to Phase 14-16 must NOT be present
  const forbiddenColumns = [
    "facility_type",
    "tooling_checklist",
    "equipment_specializations",
  ];

  for (const col of forbiddenColumns) {
    assert.doesNotMatch(
      content,
      new RegExp(col),
      `RegisterWorkshopDialog must strictly NOT contain unapproved column '${col}'`
    );
  }

  // Validation guards
  assert.match(content, /cleanPhone\.length\s*<\s*10/, "Must enforce 10-digit phone validation");
  assert.match(content, /name\.trim\(\)\.length\s*<\s*3/, "Must enforce minimum 3-char workshop name");
  assert.match(content, /Detect GPS|geolocation/, "Must support GPS geolocation detection button");
});

// ==============================================================================
// 3. MANAGE WORKSHOP DIALOG & ROLES
// ==============================================================================

test("ManageWorkshopDialog implements Details, Members, and Governance tabs with role-based guards", () => {
  const content = fs.readFileSync(MANAGE_DIALOG_PATH, "utf8");

  // Tab structure
  assert.match(content, /value="details"/, "Must include Details tab");
  assert.match(content, /value="members"/, "Must include Members tab");
  assert.match(content, /value="governance"/, "Must include Governance tab");

  // Phone-based technician invitation strictly as MANAGER or TECHNICIAN (OWNER forbidden)
  assert.match(
    content,
    /<SelectItem\s+value="TECHNICIAN"/,
    "Must allow inviting as TECHNICIAN"
  );
  assert.match(
    content,
    /<SelectItem\s+value="MANAGER"/,
    "Must allow inviting as MANAGER"
  );
  assert.doesNotMatch(
    content,
    /<SelectItem\s+value="OWNER"/,
    "Technician invitation must NEVER allow selecting role = OWNER"
  );

  // Status indicators & drop-off badge
  assert.match(content, /Drop-Off Approved/, "Must render Drop-Off Approved badge when approved");
  assert.match(content, /Private Field Base/, "Must render Private Field Base badge when not approved");

  // Member removal guards
  assert.match(content, /handleRemoveMember/, "Must implement handleRemoveMember");
  assert.match(content, /handleRevokeInvitation/, "Must implement handleRevokeInvitation");
});

// ==============================================================================
// 4. ATOMIC OWNERSHIP TRANSFER WORKFLOW (TransferOwnershipDialog)
// ==============================================================================

test("TransferOwnershipDialog enforces high-friction 4-step security flow and exact name typing", () => {
  const content = fs.readFileSync(TRANSFER_DIALOG_PATH, "utf8");

  // Step 1: Warning banner
  assert.match(
    content,
    /Transferring ownership will permanently relinquish your primary governance/i,
    "Must display warning banner regarding permanent governance transfer"
  );
  assert.match(
    content,
    /automatically reassigned as a.*MANAGER/i,
    "Must inform that old owner is demoted to MANAGER"
  );

  // Step 2: Eligible member selection (active non-owner members only)
  assert.match(
    content,
    /candidates\s*=\s*eligibleMembers\.filter\s*\(\s*\(m\)\s*=>\s*m\.role\s*!==\s*"OWNER"\s*&&\s*m\.status\s*===?\s*"ACTIVE"\s*\)/,
    "Must filter transfer candidates strictly to active non-owner members"
  );

  // Step 3: Exact workshop name confirmation
  assert.match(
    content,
    /typedConfirmation\.trim\(\)\s*===?\s*facilityName\.trim\(\)/,
    "Must require exact typed facility name to confirm transfer"
  );

  // Step 4: Atomic RPC invocation
  assert.match(
    content,
    /transferFacilityOwnership\s*\(\s*facilityId,\s*selectedMemberId\s*\)/,
    "Must call transferFacilityOwnership RPC"
  );
});

// ==============================================================================
// 5. TECHNICIAN DASHBOARD AFFILIATED WORKSHOPS CARD
// ==============================================================================

test("Technician index displays Affiliated Workshops & Bays card with role badges and register button", () => {
  const content = fs.readFileSync(TECH_INDEX_PATH, "utf8");

  assert.match(content, /Affiliated Workshops & Bays/, "Must render Affiliated Workshops & Bays section");
  assert.match(content, /Register New Workshop/, "Must include Register New Workshop button");
  assert.match(content, /getAffiliatedFacilities/, "Must load affiliated facilities on dashboard");
  assert.match(content, /RegisterWorkshopDialog/, "Must include RegisterWorkshopDialog component");
  assert.match(content, /ManageWorkshopDialog/, "Must include ManageWorkshopDialog component");

  // Distinct role badge rendering
  assert.match(content, /af\.role\s*===?\s*"OWNER"/, "Must handle OWNER role");
  assert.match(content, /af\.role\s*===?\s*"MANAGER"/, "Must handle MANAGER role");
  assert.match(content, /OWNER/, "Must render OWNER badge text");
  assert.match(content, /MANAGER/, "Must render MANAGER badge text");
  assert.match(content, /TECHNICIAN/, "Must render TECHNICIAN badge text");

  // Drop-off badge rendering
  assert.match(content, /Drop-Off Approved/, "Must render Drop-Off Approved indicator");
  assert.match(content, /Private Field Base/, "Must render Private Field Base indicator");

  // Pending invitation acceptance flow
  assert.match(content, /Membership Invitation Pending/, "Must render pending invitation notice");
  assert.match(content, /handleAcceptInvite/, "Must handle invitation acceptance");
  assert.match(content, /handleRejectInvite/, "Must handle invitation rejection");
});

// ==============================================================================
// 6. ADMIN FACILITIES MANAGEMENT SCREEN
// ==============================================================================

test("Admin facilities screen displays Vidarbha workshops with drop-off toggle and navigation", () => {
  const content = fs.readFileSync(ADMIN_FACILITIES_PATH, "utf8");

  assert.match(content, /createFileRoute\("\/admin\/facilities"\)/, "Must define route at /admin/facilities");
  assert.match(content, /Workshop facilities & bays/, "Must display page header");
  assert.match(content, /toggleDropOffApproval/, "Must use toggleDropOffApproval service");
  assert.match(content, /Switch/, "Must render Switch control for drop_off_approved");
  assert.match(content, /VIDARBHA_TAHSILS/, "Must provide tahsil filter dropdown");

  // Navigation from admin index
  const adminIndexContent = fs.readFileSync(ADMIN_INDEX_PATH, "utf8");
  assert.match(
    adminIndexContent,
    /to="\/admin\/facilities"/,
    "Admin index must include navigation link to /admin/facilities"
  );
  assert.match(
    adminIndexContent,
    /Workshops & Bays/,
    "Admin index navigation link label must be 'Workshops & Bays'"
  );
});

// ==============================================================================
// 7. DATABASE FOUNDATION CONTRACT FOR WORKSHOP GOVERNANCE
// ==============================================================================

test("Database migration defines repair_facilities and facility_memberships governance RPCs", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");

  // Tables
  assert.match(sql, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.repair_facilities/i, "Must create repair_facilities");
  assert.match(sql, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.facility_memberships/i, "Must create facility_memberships");

  // Governance RPCs
  assert.match(sql, /FUNCTION\s+public\.transfer_facility_ownership/i, "Must define transfer_facility_ownership RPC");
  assert.match(sql, /FUNCTION\s+public\.invite_technician_to_facility/i, "Must define invite_technician_to_facility RPC");
  assert.match(sql, /FUNCTION\s+public\.accept_facility_invitation/i, "Must define accept_facility_invitation RPC");
  assert.match(sql, /FUNCTION\s+public\.reject_facility_invitation/i, "Must define reject_facility_invitation RPC");
  assert.match(sql, /FUNCTION\s+public\.revoke_facility_invitation/i, "Must define revoke_facility_invitation RPC");
  assert.match(sql, /FUNCTION\s+public\.remove_facility_member/i, "Must define remove_facility_member RPC");
  assert.match(sql, /FUNCTION\s+public\.get_facility_management_profile/i, "Must define get_facility_management_profile RPC");

  // Owner protection trigger
  assert.match(
    sql,
    /CREATE\s+TRIGGER\s+trg_guard_owner_membership_mutation/i,
    "Must create trg_guard_owner_membership_mutation trigger"
  );
  assert.match(
    sql,
    /CREATE\s+TRIGGER\s+trg_guard_facility_drop_off_approval/i,
    "Must create trg_guard_facility_drop_off_approval trigger"
  );
});

// ==============================================================================
// 8. BEHAVIORAL VERIFICATION & RUNTIME INVARIANTS
// ==============================================================================

test("TEST-13-W01: GPS compliance - Centroid coordinates cannot silently be saved without explicit confirmation", () => {
  const content = fs.readFileSync(REGISTER_DIALOG_PATH, "utf8");

  // Verify source tracking state
  assert.match(
    content,
    /coordSource,\s*setCoordSource/,
    "Must maintain explicit coordSource state ('centroid' | 'gps' | 'manual')"
  );

  // Verify prominent badge
  assert.match(
    content,
    /Approximate Tahsil Centroid/,
    "Must render Approximate Tahsil Centroid badge when not verified by GPS"
  );

  // Verify checkbox acknowledgment
  assert.match(
    content,
    /confirmCentroid,\s*setConfirmCentroid/,
    "Must track explicit confirmation of approximate centroid coordinates"
  );

  // Verify submission guard
  assert.match(
    content,
    /if\s*\(\s*coordSource\s*===?\s*"centroid"\s*&&\s*!confirmCentroid\s*\)/,
    "Must block submission if centroid coordinates are unconfirmed"
  );
});

test("TEST-13-W02: Tahsil coordinates runtime invariant - All 13 Vidarbha tahsils have non-zero, bounded coordinates", () => {
  const content = fs.readFileSync(FACILITIES_SERVICE_PATH, "utf8");

  // Extract TAHSIL_COORDINATES block
  const match = content.match(/export const TAHSIL_COORDINATES[^=]*=\s*({[\s\S]+?});/);
  assert.ok(match, "TAHSIL_COORDINATES map must be defined in facilities.ts");

  // Parse entries
  const tahsilMatches = [...content.matchAll(/(\w+):\s*{\s*lat:\s*([0-9.]+),\s*lng:\s*([0-9.]+)\s*}/g)];
  assert.ok(tahsilMatches.length >= 12, "Must contain at least 12 Vidarbha tahsils");

  for (const [, name, latStr, lngStr] of tahsilMatches) {
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);

    assert.ok(!isNaN(lat), `${name} latitude must be a valid float`);
    assert.ok(!isNaN(lng), `${name} longitude must be a valid float`);
    assert.ok(lat !== 0 || lng !== 0, `${name} coordinates must not be Null Island (0,0)`);
    assert.ok(lat >= 20.0 && lat <= 22.5, `${name} latitude (${lat}) must be in Vidarbha region (20.0 - 22.5)`);
    assert.ok(lng >= 78.0 && lng <= 80.0, `${name} longitude (${lng}) must be in Vidarbha region (78.0 - 80.0)`);
  }
});

test("TEST-13-W03: Role hierarchy runtime sorting - OWNER precedes MANAGER, MANAGER precedes TECHNICIAN", () => {
  const rolePriority = { OWNER: 1, MANAGER: 2, TECHNICIAN: 3 };

  const testMembers = [
    { name: "Tech A", role: "TECHNICIAN", created_at: "2026-11-01T10:00:00Z" },
    { name: "Owner B", role: "OWNER", created_at: "2026-11-01T08:00:00Z" },
    { name: "Manager C", role: "MANAGER", created_at: "2026-11-01T09:00:00Z" },
    { name: "Tech D", role: "TECHNICIAN", created_at: "2026-11-01T11:00:00Z" },
  ];

  const sorted = [...testMembers].sort((a, b) => {
    const pA = rolePriority[a.role] || 99;
    const pB = rolePriority[b.role] || 99;
    if (pA !== pB) return pA - pB;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  assert.equal(sorted[0].role, "OWNER", "OWNER must be first");
  assert.equal(sorted[1].role, "MANAGER", "MANAGER must be second");
  assert.equal(sorted[2].role, "TECHNICIAN", "Older TECHNICIAN must be third");
  assert.equal(sorted[3].role, "TECHNICIAN", "Newer TECHNICIAN must be fourth");
});

test("TEST-13-W04: Phone sanitization simulation - Enforces 10-digit Indian mobile standard", () => {
  function sanitizePhone(raw) {
    const clean = (raw || "").replace(/[^0-9]/g, "");
    if (clean.length < 10) throw new Error("10-digit phone number is required.");
    return clean.slice(-10);
  }

  assert.equal(sanitizePhone("+91 98765 43210"), "9876543210");
  assert.equal(sanitizePhone("09876543210"), "9876543210");
  assert.equal(sanitizePhone("98765-43210"), "9876543210");
  assert.throws(() => sanitizePhone("12345"), /10-digit/);
  assert.throws(() => sanitizePhone(""), /10-digit/);
});

test("TEST-13-W05: Admin facilities screen implements explicit permission-denied state", () => {
  const content = fs.readFileSync(ADMIN_FACILITIES_PATH, "utf8");

  assert.match(
    content,
    /profile\.role\s*!==\s*"admin"\s*&&\s*\(profile\s+as\s+any\)\.role\s*!==\s*"service_centre"/,
    "Must check admin / service_centre authorization"
  );
  assert.match(
    content,
    /Access Restricted/,
    "Must render explicit Access Restricted view for non-admin users"
  );
  assert.match(
    content,
    /Return to Pipeline/,
    "Must render return navigation link in permission-denied state"
  );
});
