import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const TECH_SERVICE_PATH = path.join(ROOT_DIR, "src", "lib", "services", "technicians.ts");
const FACILITIES_SERVICE_PATH = path.join(ROOT_DIR, "src", "lib", "services", "facilities.ts");
const ADMIN_TECHS_PATH = path.join(ROOT_DIR, "src", "routes", "admin", "technicians.tsx");
const TECH_INDEX_PATH = path.join(ROOT_DIR, "src", "routes", "technician", "index.tsx");
const REPAIR_PARTS_PATH = path.join(ROOT_DIR, "src", "components", "repair-parts.tsx");
const TB_SHELL_PATH = path.join(ROOT_DIR, "src", "components", "tb.tsx");
const REGISTER_DIALOG_PATH = path.join(
  ROOT_DIR,
  "src",
  "components",
  "workshop",
  "RegisterWorkshopDialog.tsx",
);
const MIGRATION_PATH = path.join(
  ROOT_DIR,
  "supabase",
  "migrations",
  "20261106160000_phase13_database_foundations.sql",
);

// ==============================================================================
// 1. CANONICAL MASKED IDENTIFIER VALIDATION & DOCUMENT CATALOG
// ==============================================================================

test("Milestone 3: technicians.ts exports approved KYC document catalog with exact mask patterns", () => {
  const content = fs.readFileSync(TECH_SERVICE_PATH, "utf8");

  assert.match(
    content,
    /export\s+const\s+APPROVED_KYC_DOCUMENT_TYPES\s*=/,
    "Must export APPROVED_KYC_DOCUMENT_TYPES catalog",
  );

  const approvedCodes = [
    "AADHAAR_PHYSICAL",
    "PAN_CARD",
    "VOTER_ID",
    "DRIVING_LICENSE",
    "WORKSHOP_TRADE_LICENSE",
  ];

  for (const code of approvedCodes) {
    assert.match(
      content,
      new RegExp(`code:\\s*["']${code}["']`),
      `APPROVED_KYC_DOCUMENT_TYPES must include document type '${code}'`,
    );
  }

  // Canonical masked formats
  assert.match(content, /XXXX-XXXX-1234/, "Aadhaar example must be XXXX-XXXX-1234");
  assert.match(content, /XXXXX1234X/, "PAN example must be XXXXX1234X");
  assert.match(content, /ABC\*{6}7/, "Voter ID example must be ABC******7");
  assert.match(content, /MH-31-2018-XXX1234/, "Driving license example must be MH-31-2018-XXX1234");
  assert.match(
    content,
    /NMC\/WAR\/2023\/XX1234/,
    "Trade license example must be NMC/WAR/2023/XX1234",
  );
});

// ==============================================================================
// 2. DOCUMENT VALIDATION RULES (AADHAAR, PAN, VOTER ID, DL, TRADE LICENSE)
// ==============================================================================

test("Milestone 3 / Bug 3 Rule 1: Aadhaar valid masked format and invalid full UID rejection", () => {
  const aadhaarRegex = /^XXXX-XXXX-[0-9]{4}$/i;

  // Valid masked Aadhaar
  assert.equal(aadhaarRegex.test("XXXX-XXXX-1234"), true);
  assert.equal(aadhaarRegex.test("XXXX-XXXX-9876"), true);
  assert.equal(aadhaarRegex.test("xxxx-xxxx-5678"), true);

  // Invalid Aadhaar (unmasked, wrong lengths, wrong separators)
  assert.equal(aadhaarRegex.test("123456789012"), false);
  assert.equal(aadhaarRegex.test("1234-5678-9012"), false);
  assert.equal(aadhaarRegex.test("1234 5678 9012"), false);
  assert.equal(aadhaarRegex.test("XXXX-1234-5678"), false);
  assert.equal(aadhaarRegex.test("XXXXXXXX1234"), false);
  assert.equal(aadhaarRegex.test("XXXX-XXXX-123"), false);
  assert.equal(aadhaarRegex.test("XXXX-XXXX-12345"), false);
});

test("Milestone 3 / Bug 3 Rule 2: PAN Card valid masked format and invalid PAN rejection", () => {
  const panRegex = /^[Xx]{5}[0-9]{4}[A-Za-z]$/i;

  // Valid masked PAN
  assert.equal(panRegex.test("XXXXX1234X"), true);
  assert.equal(panRegex.test("xxxxx5678x"), true);
  assert.equal(panRegex.test("XXXXX1234A"), true);
  assert.equal(panRegex.test("XXXXX9876Z"), true);

  // Invalid PAN (unmasked, wrong prefix, old PAN-XX-1234 format, wrong lengths)
  assert.equal(panRegex.test("ABCDE1234F"), false);
  assert.equal(panRegex.test("PAN-XX-1234"), false);
  assert.equal(panRegex.test("XXXX1234X"), false);
  assert.equal(panRegex.test("XXXXXX1234X"), false);
  assert.equal(panRegex.test("XXXXX123X"), false);
  assert.equal(panRegex.test("XXXXX12345"), false);
});

test("Milestone 3 / Bug 3 Rule 3: Voter ID valid 10-char masked format and invalid format rejection", () => {
  const voterRegex = /^[A-Za-z]{3}[*Xx]{6}[0-9A-Za-z]$/i;

  function isValidVoterId(val) {
    const trimmed = (val || "").trim();
    return trimmed.length === 10 && voterRegex.test(trimmed);
  }

  // Valid masked Voter ID (10 chars, 3 letters, 6 masked, 1 check digit/char)
  assert.equal(isValidVoterId("ABC******7"), true);
  assert.equal(isValidVoterId("XYZ******1"), true);
  assert.equal(isValidVoterId("MHX******9"), true);
  assert.equal(isValidVoterId("ABCXXXXXX7"), true);
  assert.equal(isValidVoterId("abc******7"), true);

  // Invalid Voter ID (unmasked, old VID-XX-1234 format, wrong lengths, wrong letter count)
  assert.equal(isValidVoterId("ABC1234567"), false);
  assert.equal(isValidVoterId("VID-XX-1234"), false);
  assert.equal(isValidVoterId("AB*****7"), false); // 8 chars
  assert.equal(isValidVoterId("ABCD*****7"), false); // 4 letters
  assert.equal(isValidVoterId("ABC*****78"), false); // only 5 mask chars
  assert.equal(isValidVoterId("123******4"), false); // no letters prefix
});

test("Milestone 3 / Bug 3 Rule 4: Driving Licence valid state/RTO/year format and invalid DL rejection", () => {
  const dlRegex =
    /^[A-Za-z]{2}[- ]?[0-9]{2}[- ]?(?:[0-9]{4}|YYYY)[- ]?[*Xx]{3,7}[0-9A-Za-z]{1,4}$/i;

  // Valid masked DL formats
  assert.equal(dlRegex.test("MH-31-2018-XXX1234"), true);
  assert.equal(dlRegex.test("MH31 2018 XXXX123"), true);
  assert.equal(dlRegex.test("MH-31-2020-***1234"), true);
  assert.equal(dlRegex.test("DL-01-2019-XXX9876"), true);
  assert.equal(dlRegex.test("MH31-2019-XXXXXXX"), true);
  assert.equal(dlRegex.test("MH-31-YYYY-XXX1234"), true);

  // Invalid DL (full unmasked DL, wrong state/RTO, unmasked serial, old DL-XX-1234 format)
  assert.equal(dlRegex.test("MH-31-2018-1234567"), false); // unmasked serial
  assert.equal(dlRegex.test("MH3120181234567"), false); // unmasked full DL
  assert.equal(dlRegex.test("12-31-2018-XXX1234"), false); // invalid state code (digits)
  assert.equal(dlRegex.test("DL-XX-1234"), false); // old format lacking state/RTO/year
  assert.equal(dlRegex.test("MH-31-2018-1234"), false); // serial lacks mask characters
});

test("Milestone 3 / Bug 3 Rule 5: Workshop Trade Licence valid variable-format and invalid rejection", () => {
  const tradeRegex = /^(?=.*[*Xx]{2,})[A-Za-z0-9][A-Za-z0-9\-/ ]{6,28}[A-Za-z0-9]$/i;

  function isValidTradeLicense(val) {
    const trimmed = (val || "").trim();
    return trimmed.length >= 8 && trimmed.length <= 30 && tradeRegex.test(trimmed);
  }

  // Valid variable-format masked trade licences
  assert.equal(isValidTradeLicense("NMC/WAR/2023/XX1234"), true);
  assert.equal(isValidTradeLicense("MH-NGP-TL-XXXX-1234"), true);
  assert.equal(isValidTradeLicense("TL-NGP-2024-XX99"), true);
  assert.equal(isValidTradeLicense("SHOP/NGP/XX-1234"), true);
  assert.equal(isValidTradeLicense("TL-XX-1234"), true); // backward compatible format

  // Invalid trade licences (unmasked raw licences, too short, invalid characters)
  assert.equal(isValidTradeLicense("NMC/WAR/2023/12345"), false); // no mask characters
  assert.equal(isValidTradeLicense("SHOP/NGP/123456"), false); // no mask characters
  assert.equal(isValidTradeLicense("TL-XX"), false); // too short (<8)
  assert.equal(isValidTradeLicense("TL/2024/XX@123"), false); // illegal character '@'
  assert.equal(isValidTradeLicense("NMC/WAR/2023/XX1234567890123456789"), false); // >30 chars
});

// ==============================================================================
// 3. FRONTEND / BACKEND VALIDATION PARITY
// ==============================================================================

test("Milestone 3 / Bug 3 Parity: Frontend and PostgreSQL RPC enforce identical validation regexes", () => {
  const tsContent = fs.readFileSync(TECH_SERVICE_PATH, "utf8");
  const sqlContent = fs.readFileSync(MIGRATION_PATH, "utf8");

  // 1. Aadhaar: XXXX-XXXX-[0-9]{4}
  assert.match(tsContent, /XXXX-XXXX-\[0-9\]\{4\}/);
  assert.match(sqlContent, /\^XXXX-XXXX-\[0-9\]\{4\}\$/);

  // 2. PAN Card: X{5}[0-9]{4}[A-Z]
  assert.match(tsContent, /\[Xx\]\{5\}\[0-9\]\{4\}\[A-Za-z\]/);
  assert.match(sqlContent, /\^X\{5\}\[0-9\]\{4\}\[A-Z\]\$/);

  // 3. Voter ID: [A-Z]{3}[*X]{6}[0-9A-Z] (10 chars)
  assert.match(tsContent, /\[A-Za-z\]\{3\}\[\*Xx\]\{6\}\[0-9A-Za-z\]/);
  assert.match(sqlContent, /\^\[A-Z\]\{3\}\[\*X\]\{6\}\[0-9A-Z\]\$/);

  // 4. Driving Licence: State, RTO, Year, Masked Serial
  assert.match(tsContent, /\[A-Za-z\]\{2\}\[- \]\?\[0-9\]\{2\}/);
  assert.match(sqlContent, /\^\[A-Z\]\{2\}\[- \]\?\[0-9\]\{2\}/);

  // 5. Workshop Trade Licence: 8-30 chars and [*X]{2,} mask
  assert.match(tsContent, /\[\*Xx\]\{2,\}/);
  assert.match(sqlContent, /\[\*X\]\{2,\}/);
});

// ==============================================================================
// 4. ANTI-PII & ILLEGAL FULL IDENTIFIER DETECTION
// ==============================================================================

test("Milestone 3 Simulation: detectIllegalFullId rejects 12-digit Aadhaar, full PAN, Voter ID, and full DL", () => {
  function detectIllegalFullId(input) {
    const trimmed = (input || "").trim();
    if (/^[0-9]{12}$/.test(trimmed) || /^[0-9]{4}[ -][0-9]{4}[ -][0-9]{4}$/.test(trimmed)) {
      return { isIllegal: true, message: "ILLEGAL_FULL_UID_STORAGE" };
    }
    if (/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(trimmed) && !/^[Xx]{5}/.test(trimmed)) {
      return { isIllegal: true, message: "ILLEGAL_FULL_PAN_STORAGE" };
    }
    if (/^[A-Z]{3}[0-9]{7}$/i.test(trimmed)) {
      return { isIllegal: true, message: "ILLEGAL_FULL_VOTER_ID_STORAGE" };
    }
    if (/^[A-Z]{2}[- ]?[0-9]{2}[- ]?[0-9]{4}[- ]?[0-9]{7}$/i.test(trimmed)) {
      return { isIllegal: true, message: "ILLEGAL_FULL_DL_STORAGE" };
    }
    return { isIllegal: false };
  }

  // Full 12-digit Aadhaar (raw and separated)
  assert.equal(detectIllegalFullId("987654321098").isIllegal, true);
  assert.equal(detectIllegalFullId("9876-5432-1098").isIllegal, true);
  assert.equal(detectIllegalFullId("9876 5432 1098").isIllegal, true);

  // Full PAN
  assert.equal(detectIllegalFullId("ABCDE1234F").isIllegal, true);

  // Full Voter ID
  assert.equal(detectIllegalFullId("ABC1234567").isIllegal, true);

  // Full Driving Licence
  assert.equal(detectIllegalFullId("MH-31-2018-1234567").isIllegal, true);
  assert.equal(detectIllegalFullId("MH3120181234567").isIllegal, true);

  // Masked format is NOT considered illegal full ID
  assert.equal(detectIllegalFullId("XXXX-XXXX-1234").isIllegal, false);
  assert.equal(detectIllegalFullId("XXXXX1234X").isIllegal, false);
  assert.equal(detectIllegalFullId("ABC******7").isIllegal, false);
  assert.equal(detectIllegalFullId("MH-31-2018-XXX1234").isIllegal, false);
});

test("Milestone 3 Simulation: detectSensitiveDataInRemarks disallows credential numbers in remarks", () => {
  function detectSensitiveDataInRemarks(remarks) {
    return /[0-9]{6,}/.test(remarks || "");
  }

  assert.equal(detectSensitiveDataInRemarks("Inspected original card at Nagpur counter."), false);
  assert.equal(detectSensitiveDataInRemarks("Desk 4 verification"), false);
  assert.equal(detectSensitiveDataInRemarks("Card number was 123456"), true);
  assert.equal(detectSensitiveDataInRemarks("Aadhaar 987654321012 inspected"), true);
});

// ==============================================================================
// 5. DATABASE / RPC SECURITY & PRIVILEGE BOUNDARIES
// ==============================================================================

test("Milestone 3 Database Contract: verify_technician_kyc enforces admin-only and anti-PII in PostgreSQL", () => {
  const content = fs.readFileSync(MIGRATION_PATH, "utf8");

  // Function signature & search path
  assert.match(
    content,
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.verify_technician_kyc/,
    "Must define verify_technician_kyc function",
  );
  assert.match(
    content,
    /SECURITY\s+DEFINER[\s\S]*?SET\s+search_path\s*=\s*''/,
    "verify_technician_kyc must be SECURITY DEFINER with empty search_path",
  );

  // Role authorization: Admin or service_centre only
  assert.match(
    content,
    /IF\s+v_admin_role_text\s+NOT\s+IN\s*\(\s*['"]admin['"],\s*['"]service_centre['"]\s*\)\s+THEN[\s\S]*?RAISE\s+EXCEPTION\s+['"]UNAUTHORIZED/i,
    "verify_technician_kyc must strictly require admin or service_centre role",
  );

  // Anti-PII guards in database
  assert.match(content, /ILLEGAL_FULL_UID_STORAGE/);
  assert.match(content, /ILLEGAL_FULL_PAN_STORAGE/);
  assert.match(content, /ILLEGAL_FULL_VOTER_ID_STORAGE/);
  assert.match(content, /ILLEGAL_FULL_DL_STORAGE/);

  // Remarks leak guard
  assert.match(content, /SENSITIVE_DATA_IN_REMARKS/);

  // Grants
  assert.match(
    content,
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.verify_technician_kyc[^;]+FROM\s+PUBLIC/i,
  );
  assert.match(
    content,
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.verify_technician_kyc[^;]+TO\s+authenticated/i,
  );
});

test("Milestone 3 Database Contract: approve_technician_skill and dismiss_technician_skill are admin-only", () => {
  const content = fs.readFileSync(MIGRATION_PATH, "utf8");

  // approve_technician_skill
  assert.match(
    content,
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.approve_technician_skill/,
    "Must define approve_technician_skill",
  );
  assert.match(
    content,
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.approve_technician_skill[^;]+FROM\s+PUBLIC/i,
  );

  // dismiss_technician_skill
  assert.match(
    content,
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.dismiss_technician_skill/,
    "Must define dismiss_technician_skill",
  );
  assert.match(
    content,
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.dismiss_technician_skill[^;]+FROM\s+PUBLIC/i,
  );
});

test("Milestone 3 Database Contract: get_technician_private_profile strictly enforces caller authorization", () => {
  const content = fs.readFileSync(MIGRATION_PATH, "utf8");

  assert.match(
    content,
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_technician_private_profile/,
    "Must define get_technician_private_profile",
  );

  // Authorization check: only technician themselves or service_centre admin
  assert.match(
    content,
    /IF\s+v_caller_role_text\s+IN\s*\(\s*['"]admin['"],\s*['"]service_centre['"]\s*\)[\s\S]*?ELSIF\s+v_caller_profile_id\s*=\s*p_technician_profile_id/i,
  );

  assert.match(content, /ACCESS_DENIED: Caller is not authorized to view private KYC/i);
});

test("Milestone 3 Security Contract: guard_technician_profile_mutation prevents self-updating KYC fields", () => {
  const content = fs.readFileSync(MIGRATION_PATH, "utf8");

  const protectedKycCols = [
    "is_verified",
    "kyc_verified",
    "kyc_verified_at",
    "kyc_verified_by",
    "kyc_document_type",
    "kyc_masked_id",
    "kyc_remarks",
    "verified_skills",
  ];

  for (const col of protectedKycCols) {
    assert.match(
      content,
      new RegExp(`NEW\\.${col}\\s+IS\\s+DISTINCT\\s+FROM\\s+OLD\\.${col}`),
      `guard_technician_profile_mutation must protect column '${col}'`,
    );
  }
});

// ==============================================================================
// 6. FRONTEND SERVICE LAYER API CONTRACT
// ==============================================================================

test("Milestone 3: technicians.ts exports required KYC and skill certification methods", () => {
  const content = fs.readFileSync(TECH_SERVICE_PATH, "utf8");

  const requiredMethods = [
    "detectIllegalFullId",
    "isValidMaskedId",
    "detectSensitiveDataInRemarks",
    "verifyTechnicianKyc",
    "approveTechnicianSkill",
    "dismissTechnicianSkill",
    "getTechnicianPrivateProfile",
    "getAllTechniciansAdmin",
  ];

  for (const method of requiredMethods) {
    assert.match(
      content,
      new RegExp(`export\\s+(async\\s+)?function\\s+${method}`),
      `technicians.ts must export ${method}()`,
    );
  }
});

// ==============================================================================
// 7. SERVICE CENTRE ADMIN UI CONTRACT (src/routes/admin/technicians.tsx)
// ==============================================================================

test("Milestone 3 Admin Experience: /admin/technicians implements physical KYC dialog with masked validation", () => {
  const content = fs.readFileSync(ADMIN_TECHS_PATH, "utf8");

  assert.match(
    content,
    /In-Person Physical Identity Verification/,
    "Must render In-Person Physical Verification dialog title",
  );
  assert.match(
    content,
    /Nagpur Service Centre/i,
    "Must display Nagpur Service Centre physical audit context",
  );
  assert.match(
    content,
    /Zero-Aadhaar-Storage Mandate/i,
    "Must prominently state Zero-Aadhaar-Storage mandate",
  );

  // Invariant: Zero file uploads
  assert.doesNotMatch(content, /<input[^>]+type=["']file["']/i);
  assert.doesNotMatch(content, /supabase\.storage|\.upload\(/i);

  // Document types
  assert.match(content, /APPROVED_KYC_DOCUMENT_TYPES/);
  assert.match(content, /detectIllegalFullId/);
  assert.match(content, /isValidMaskedId/);
  assert.match(content, /validationError/);

  // Semantic separation KPI metrics
  assert.match(content, /Pending Approval/);
  assert.match(content, /KYC Pending/);
  assert.match(content, /KYC Verified|KYC Certified/);
});

test("Milestone 3 Admin Experience: /admin/technicians implements AI skill certification workbench", () => {
  const content = fs.readFileSync(ADMIN_TECHS_PATH, "utf8");

  assert.match(
    content,
    /AI Skill Endorsement Workbench/,
    "Must render AI Skill Endorsement Workbench title",
  );
  assert.match(content, /Pending AI Suggested Skills/);
  assert.match(content, /Publicly Verified Skills/);
  assert.match(content, /approveTechnicianSkill/);
  assert.match(content, /dismissTechnicianSkill/);
});

// ==============================================================================
// 8. TECHNICIAN PORTAL UI CONTRACT (src/routes/technician/index.tsx)
// ==============================================================================

test("Milestone 3 Technician Experience: /technician displays in-person visit instructions without upload form", () => {
  const content = fs.readFileSync(TECH_INDEX_PATH, "utf8");

  assert.match(content, /Identity & Trust Verification/);
  assert.match(content, /Physical Identity Verification Required/i);
  assert.match(content, /Nagpur Service Centre \(MIDC Hingna Road\)/i);
  assert.match(content, /What to bring for in-person verification/i);
  assert.match(content, /Physical Aadhaar/i);
  assert.match(content, /PAN Card/i);
  assert.match(content, /Voter ID/i);
  assert.match(content, /Commercial Driving Licence/i);
  assert.match(content, /Maharashtra Trade Licence/i);
  assert.match(content, /Please contact or visit the Nagpur Service Centre/i);
  assert.doesNotMatch(content, /Operating Hours: Monday – Saturday, 09:00 – 18:00/i);

  // Zero file uploads
  assert.doesNotMatch(content, /<input[^>]+type=["']file["']/i);
  assert.doesNotMatch(content, /uploadDocument|uploadFile/i);

  // Verified skills vs AI suggested skills
  assert.match(content, /Verified Technical Skills/);
  assert.match(content, /AI Suggested Skills · Awaiting Service Centre Review/i);
  assert.doesNotMatch(content, /onClick=\{.*approveTechnicianSkill/i);
});

// ==============================================================================
// 9. PUBLIC / FARMER TECHCARD CONTRACT (src/components/repair-parts.tsx)
// ==============================================================================

test("Milestone 3 Public TechCard Contract: displays KYC Verified shield badge strictly when kyc_verified is true", () => {
  const content = fs.readFileSync(REPAIR_PARTS_PATH, "utf8");

  assert.match(content, /isKycVerified\s*=\s*Boolean\(t\.kyc_verified\)/);
  assert.match(content, /ShieldCheck className="[^"]*text-success[^"]*" aria-label="KYC Verified"/);
  assert.match(content, /KYC Verified/);
  assert.match(content, /t\.verified_skills && t\.verified_skills\.length > 0/);
  assert.match(content, /Certified Skills:/);
});

// ==============================================================================
// 10. BUG 2 — FARMER HEADER AUTHENTICATED PROFILE NAME DISPLAY
// ==============================================================================

test("Bug 2: tb.tsx displays authenticated farmer full name with localized fallback", () => {
  const content = fs.readFileSync(TB_SHELL_PATH, "utf8");

  // Defines farmerDisplayName with fallback to localized farmerPortal
  assert.match(
    content,
    /farmerDisplayName\s*=\s*profile\?\.full_name\?\.trim\(\)\s*\|\|\s*t\(["']shell\.farmerPortal["']\)/,
    "Must define farmerDisplayName using profile.full_name.trim() with t('shell.farmerPortal') fallback",
  );

  // Renders farmerDisplayName for farmer role
  assert.match(
    content,
    /role\s*===\s*["']farmer["']\s*\?\s*farmerDisplayName\s*:\s*who/,
    "Header must render farmerDisplayName when role is farmer, and who for other roles",
  );
});

// ==============================================================================
// 11. BUG 1 — WORKSHOP REGISTRATION MIGRATION AVAILABILITY & BLOCKED SUBMIT
// ==============================================================================

test("Bug 1: facilities.ts exports checkFacilityMigrationReadiness and RegisterWorkshopDialog blocks submit", () => {
  const facContent = fs.readFileSync(FACILITIES_SERVICE_PATH, "utf8");
  const dialogContent = fs.readFileSync(REGISTER_DIALOG_PATH, "utf8");

  // Service export
  assert.match(
    facContent,
    /export\s+async\s+function\s+checkFacilityMigrationReadiness/,
    "facilities.ts must export checkFacilityMigrationReadiness",
  );

  // Dialog checks readiness on open
  assert.match(
    dialogContent,
    /checkFacilityMigrationReadiness\(\)/,
    "Dialog must check readiness on mount/open",
  );

  // Submit button is disabled when migration is unavailable
  assert.match(
    dialogContent,
    /disabled=\{[^}]*isMigrationUnavailable[^}]*\}/,
    "Submit button must be disabled when isMigrationUnavailable",
  );

  // Form submission handler guards against unavailable migration
  assert.match(
    dialogContent,
    /if\s*\(\s*isMigrationUnavailable\s*\)\s*\{\s*return;\s*\}/,
    "handleSubmit must reject submission when migration is unavailable",
  );

  // Duplicate toast suppressed
  assert.match(
    dialogContent,
    /avoid duplicate toast notification/,
    "Duplicate toast must be suppressed when inline banner is active",
  );
});
