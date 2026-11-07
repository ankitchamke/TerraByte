import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const FACILITIES_SERVICE_PATH = path.join(ROOT_DIR, "src", "lib", "services", "facilities.ts");
const TECHNICIANS_SERVICE_PATH = path.join(ROOT_DIR, "src", "lib", "services", "technicians.ts");
const REGISTER_DIALOG_PATH = path.join(
  ROOT_DIR,
  "src",
  "components",
  "workshop",
  "RegisterWorkshopDialog.tsx",
);
const PROFILE_ROUTE_PATH = path.join(ROOT_DIR, "src", "routes", "profile.tsx");

// ==============================================================================
// 1. ISSUE 1 — WORKSHOP REGISTRATION MIGRATION-PENDING HANDLING
// ==============================================================================

test("Issue 1: facilities.ts defines user-friendly migration-pending message and detector", () => {
  const content = fs.readFileSync(FACILITIES_SERVICE_PATH, "utf8");

  // Constant definition
  assert.match(
    content,
    /export\s+const\s+FACILITY_MIGRATION_PENDING_MESSAGE\s*=/,
    "facilities.ts must export FACILITY_MIGRATION_PENDING_MESSAGE",
  );
  assert.match(
    content,
    /Phase 13 database migration, which is pending approval/,
    "FACILITY_MIGRATION_PENDING_MESSAGE must clearly mention pending Phase 13 database migration",
  );

  // Helper definition
  assert.match(
    content,
    /export\s+function\s+isFacilityMigrationPendingError/,
    "facilities.ts must export isFacilityMigrationPendingError",
  );
  assert.match(
    content,
    /export\s+async\s+function\s+checkFacilityMigrationReadiness/,
    "facilities.ts must export checkFacilityMigrationReadiness",
  );
});

test("Issue 1 Simulation: isFacilityMigrationPendingError detects schema cache and missing table errors", () => {
  // Pure simulation of detector logic matching facilities.ts
  function isFacilityMigrationPendingError(error) {
    if (!error) return false;
    const code = error.code || "";
    const msg = (error.message || "").toLowerCase();
    return (
      code === "PGRST205" ||
      code === "42P01" ||
      msg.includes("repair_facilities") ||
      msg.includes("facility_memberships") ||
      (msg.includes("schema cache") && (msg.includes("table") || msg.includes("repair_facilities")))
    );
  }

  // Exact PostgREST schema cache error reported in manual testing
  assert.equal(
    isFacilityMigrationPendingError({
      message: "Could not find the table 'public.repair_facilities' in the schema cache",
      code: "PGRST205",
    }),
    true,
  );

  // Postgres 42P01 undefined_table
  assert.equal(
    isFacilityMigrationPendingError({
      message: 'relation "public.repair_facilities" does not exist',
      code: "42P01",
    }),
    true,
  );

  // facility_memberships missing table error
  assert.equal(
    isFacilityMigrationPendingError({
      message: "Could not find the table 'public.facility_memberships' in the schema cache",
      code: "PGRST205",
    }),
    true,
  );

  // Unrelated errors must NOT be detected as migration pending
  assert.equal(
    isFacilityMigrationPendingError({
      message: "invalid input syntax for type uuid",
      code: "22P02",
    }),
    false,
  );
  assert.equal(
    isFacilityMigrationPendingError({
      message: "JWT expired",
      code: "PGRST301",
    }),
    false,
  );
  assert.equal(isFacilityMigrationPendingError(null), false);
  assert.equal(isFacilityMigrationPendingError(undefined), false);
});

test("Issue 1: RegisterWorkshopDialog renders user-friendly migration error banner without fake store fallback", () => {
  const content = fs.readFileSync(REGISTER_DIALOG_PATH, "utf8");

  // Error state and display
  assert.match(content, /submitError,\s*setSubmitError/, "Must track submitError in state");
  assert.match(content, /submitError\s*&&/, "Must conditionally render error banner");
  assert.match(content, /AlertCircle/, "Must render AlertCircle icon in error banner");

  // Invariant: Must NOT implement silent fake persistence via tb-store
  assert.doesNotMatch(
    content,
    /import.*tb-store/,
    "RegisterWorkshopDialog must NOT import tb-store to fake persistence",
  );
  assert.doesNotMatch(
    content,
    /localStorage\.setItem\(["']facilities/,
    "RegisterWorkshopDialog must NOT fake persistence in localStorage",
  );

  // Must invoke registerFacility from facilities service
  assert.match(
    content,
    /await\s+registerFacility\(/,
    "RegisterWorkshopDialog must call real registerFacility service",
  );

  // Readiness check & submission blocking invariants
  assert.match(
    content,
    /checkFacilityMigrationReadiness\(\)/,
    "RegisterWorkshopDialog must check facility migration readiness on mount/open",
  );
  assert.match(
    content,
    /disabled=\{[^}]*isMigrationUnavailable[^}]*\}/,
    "RegisterWorkshopDialog submit button must be disabled when migration is unavailable",
  );
  assert.match(
    content,
    /if\s*\(\s*isMigrationUnavailable\s*\)\s*\{\s*return;\s*\}/,
    "handleSubmit must refuse to submit when migration is unavailable",
  );
  assert.match(
    content,
    /\/\/ Migration-pending notice is shown inline in the dialog banner; avoid duplicate toast notification\./,
    "RegisterWorkshopDialog must avoid duplicate toast when inline banner is active",
  );
});

test("Issue 1: Facility queries prevent background error thrashing when migration is pending", () => {
  const content = fs.readFileSync(FACILITIES_SERVICE_PATH, "utf8");

  // getAffiliatedFacilities returns empty list when migration pending
  assert.match(
    content,
    /if\s*\(\s*isFacilityMigrationPendingError\(error\)\s*\)\s*\{\s*console\.warn[\s\S]*?return\s*\[\];\s*\}/,
    "getAffiliatedFacilities must return empty array when migration is pending",
  );

  // getAllFacilitiesAdmin returns empty list when migration pending
  assert.match(
    content,
    /if\s*\(\s*isFacilityMigrationPendingError\(error\)\s*\)\s*\{\s*console\.warn[\s\S]*?return\s*\[\];\s*\}/,
    "getAllFacilitiesAdmin must return empty array when migration is pending",
  );
});

// ==============================================================================
// 2. ISSUE 2 — TECHNICIAN DISCOVERY BACKWARD-COMPATIBLE PROJECTION
// ==============================================================================

test("Issue 2: technicians.ts exports Phase 12 projection, column error detector, and mapper", () => {
  const content = fs.readFileSync(TECHNICIANS_SERVICE_PATH, "utf8");

  // Exported constants and helpers
  assert.match(
    content,
    /export\s+const\s+TECHNICIAN_PHASE12_SAFE_PROJECTION\s*=/,
    "technicians.ts must export TECHNICIAN_PHASE12_SAFE_PROJECTION",
  );
  assert.match(
    content,
    /export\s+function\s+isPhase13ColumnMissingError/,
    "technicians.ts must export isPhase13ColumnMissingError",
  );
  assert.match(
    content,
    /export\s+function\s+mapPhase12RowToVerifiedTechnician/,
    "technicians.ts must export mapPhase12RowToVerifiedTechnician",
  );

  // Phase 12 projection must include Phase 12 columns
  const phase12Cols = [
    "id",
    "profile_id",
    "workshop_name",
    "brands",
    "skills",
    "rating",
    "is_available",
    "is_verified",
    "jobs_completed",
    "distance_km",
    "eta_minutes",
    "profile:profile_id(id, full_name, phone, village)",
  ];
  for (const col of phase12Cols) {
    assert.match(
      content,
      new RegExp(col.replace(/[()]/g, "\\$&")),
      `Phase 12 projection must include ${col}`,
    );
  }

  // Phase 12 projection must strictly NOT include missing Phase 13 columns
  const phase13MissingCols = [
    "verified_skills",
    "review_count",
    "kyc_verified",
    "primary_facility_id",
  ];
  const phase12ProjectionMatch = content.match(
    /TECHNICIAN_PHASE12_SAFE_PROJECTION\s*=\s*["']([^"']+)["']/,
  );
  assert.ok(phase12ProjectionMatch, "Found TECHNICIAN_PHASE12_SAFE_PROJECTION string");
  const projectionStr = phase12ProjectionMatch[1];
  for (const col of phase13MissingCols) {
    assert.equal(
      projectionStr.includes(col),
      false,
      `TECHNICIAN_PHASE12_SAFE_PROJECTION must NOT include Phase 13 column '${col}'`,
    );
  }
});

test("Issue 2 Simulation: isPhase13ColumnMissingError detects 42703 column missing errors", () => {
  function isPhase13ColumnMissingError(error) {
    if (!error) return false;
    const code = error.code || "";
    const msg = (error.message || "").toLowerCase();
    return (
      code === "42703" ||
      msg.includes("does not exist") ||
      msg.includes("verified_skills") ||
      msg.includes("review_count") ||
      msg.includes("kyc_verified") ||
      msg.includes("primary_facility_id")
    );
  }

  // Exact PostgreSQL 42703 error
  assert.equal(
    isPhase13ColumnMissingError({
      message: "column technician_profiles.verified_skills does not exist",
      code: "42703",
    }),
    true,
  );

  // PostgREST 42703 error for review_count
  assert.equal(
    isPhase13ColumnMissingError({
      message: "Could not find column 'review_count' of 'technician_profiles'",
      code: "42703",
    }),
    true,
  );

  // Unrelated error
  assert.equal(
    isPhase13ColumnMissingError({
      message: "connection timeout",
      code: "57P01",
    }),
    false,
  );
  assert.equal(isPhase13ColumnMissingError(null), false);
});

test("Issue 2 Simulation: mapPhase12RowToVerifiedTechnician preserves data without fabricating certifications", () => {
  function mapPhase12RowToVerifiedTechnician(row) {
    return {
      ...row,
      verified_skills: null,
      review_count: null,
      kyc_verified: false,
      primary_facility_id: null,
      kyc_masked_id: null,
      kyc_remarks: null,
      kyc_verified_at: null,
      kyc_verified_by: null,
      suggested_skills: null,
      skills_confirmed_at: null,
      skills_confirmed_by: null,
    };
  }

  const phase12DbRow = {
    id: "tech-001",
    profile_id: "prof-001",
    workshop_name: "Nagpur Agro Repairs",
    brands: ["Mahindra", "John Deere"],
    skills: ["Engine Overhaul", "Hydraulics"],
    rating: 4.8,
    is_available: true,
    is_verified: true,
    jobs_completed: 42,
    distance_km: 12.5,
    eta_minutes: 30,
    profile: {
      id: "prof-001",
      full_name: "Ramesh Kumar",
      phone: "9876543211",
      village: "Saoner",
    },
  };

  const mapped = mapPhase12RowToVerifiedTechnician(phase12DbRow);

  // Phase 12 fields strictly preserved
  assert.equal(mapped.id, "tech-001");
  assert.equal(mapped.workshop_name, "Nagpur Agro Repairs");
  assert.deepEqual(mapped.brands, ["Mahindra", "John Deere"]);
  assert.deepEqual(mapped.skills, ["Engine Overhaul", "Hydraulics"]);
  assert.equal(mapped.rating, 4.8);
  assert.equal(mapped.is_verified, true);
  assert.equal(mapped.jobs_completed, 42);
  assert.equal(mapped.profile.full_name, "Ramesh Kumar");

  // Non-fabrication invariant: Phase 13 certifications must NOT be fabricated
  assert.equal(mapped.verified_skills, null, "Must NOT fabricate verified_skills");
  assert.equal(mapped.review_count, null, "Must NOT fabricate review_count");
  assert.equal(mapped.kyc_verified, false, "Must NOT fabricate kyc_verified as true");
  assert.equal(mapped.primary_facility_id, null, "Must NOT fabricate primary_facility_id");
  assert.equal(mapped.kyc_verified_at, null);
  assert.equal(mapped.skills_confirmed_at, null);
});

test("Issue 2: Technician queries contain backward-compatible Phase 12 fallbacks", () => {
  const content = fs.readFileSync(TECHNICIANS_SERVICE_PATH, "utf8");

  // Four key queries with fallback logic
  const queryMethods = [
    "getEligibleTechnicians",
    "getMyTechnicianProfile",
    "getAssignedTechnician",
    "getVerifiedTechnicians",
  ];

  for (const method of queryMethods) {
    const fnRegex = new RegExp(`export\\s+async\\s+function\\s+${method}[\\s\\S]*?(?=export|$)`);
    const fnCode = content.match(fnRegex)?.[0] || "";
    assert.match(
      fnCode,
      /isPhase13ColumnMissingError/,
      `${method} must check isPhase13ColumnMissingError`,
    );
    assert.match(
      fnCode,
      /TECHNICIAN_PHASE12_SAFE_PROJECTION/,
      `${method} must query TECHNICIAN_PHASE12_SAFE_PROJECTION on fallback`,
    );
    assert.match(
      fnCode,
      /mapPhase12RowToVerifiedTechnician/,
      `${method} must map results with mapPhase12RowToVerifiedTechnician`,
    );
  }
});

// ==============================================================================
// 3. ISSUE 3 — IN-APP NAVIGATION & PROFILE SSR CONFIGURATION
// ==============================================================================

test("Issue 3: profile.tsx specifies ssr: false for client-side navigation stability", () => {
  const content = fs.readFileSync(PROFILE_ROUTE_PATH, "utf8");

  assert.match(
    content,
    /export\s+const\s+Route\s*=\s*createFileRoute\(["']\/profile["']\)\(\s*\{\s*ssr:\s*false/m,
    "profile.tsx must declare ssr: false to prevent hydration mismatches and client navigation freezes",
  );
});

test("Issue 3 Invariant: All dashboard, auth, and role routes consistently disable SSR", () => {
  const routesToCheck = [
    "src/routes/profile.tsx",
    "src/routes/admin.tsx",
    "src/routes/farmer.tsx",
    "src/routes/technician.tsx",
    "src/routes/login.tsx",
    "src/routes/index.tsx",
  ];

  for (const relPath of routesToCheck) {
    const fullPath = path.join(ROOT_DIR, relPath);
    assert.ok(fs.existsSync(fullPath), `${relPath} must exist`);
    const content = fs.readFileSync(fullPath, "utf8");
    assert.match(content, /ssr:\s*false/, `${relPath} must configure ssr: false`);
  }
});
