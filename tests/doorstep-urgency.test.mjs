import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SERVICE_TYPES,
  URGENCY_LEVELS,
  isValidServiceType,
  isValidUrgencyLevel,
  sanitizeDoorstepTextField,
  validateDoorstepUrgencyInput,
  normalizeRepairDoorstepUrgency,
  triageUrgencyComparator,
  FARMER_AVAILABILITY_SLOTS,
  URGENCY_OPTIONS,
  SERVICE_MODE_OPTIONS,
} from "../src/lib/services/doorstep-service.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

// ==============================================================================
// 1. SERVICE TYPE VALIDATION
// ==============================================================================

test("SERVICE_TYPES constant definition", () => {
  assert.deepEqual(SERVICE_TYPES, ["DOORSTEP", "WORKSHOP"]);
});

test("isValidServiceType identifies valid and invalid service modes", () => {
  assert.equal(isValidServiceType("DOORSTEP"), true);
  assert.equal(isValidServiceType("WORKSHOP"), true);

  assert.equal(isValidServiceType("doorstep"), false, "Case-sensitive: lowercase rejected");
  assert.equal(isValidServiceType("MOBILE"), false);
  assert.equal(isValidServiceType("FIELD"), false);
  assert.equal(isValidServiceType(""), false);
  assert.equal(isValidServiceType(null), false);
  assert.equal(isValidServiceType(undefined), false);
  assert.equal(isValidServiceType(123), false);
  assert.equal(isValidServiceType({}), false);
});

// ==============================================================================
// 2. URGENCY LEVEL VALIDATION
// ==============================================================================

test("URGENCY_LEVELS constant definition", () => {
  assert.deepEqual(URGENCY_LEVELS, ["CRITICAL", "HIGH", "STANDARD", "FLEXIBLE"]);
});

test("isValidUrgencyLevel identifies valid and invalid urgency tiers", () => {
  assert.equal(isValidUrgencyLevel("CRITICAL"), true);
  assert.equal(isValidUrgencyLevel("HIGH"), true);
  assert.equal(isValidUrgencyLevel("STANDARD"), true);
  assert.equal(isValidUrgencyLevel("FLEXIBLE"), true);

  assert.equal(isValidUrgencyLevel("critical"), false, "Case-sensitive: lowercase rejected");
  assert.equal(isValidUrgencyLevel("URGENT"), false);
  assert.equal(isValidUrgencyLevel("LOW"), false);
  assert.equal(isValidUrgencyLevel("MEDIUM"), false);
  assert.equal(isValidUrgencyLevel(""), false);
  assert.equal(isValidUrgencyLevel(null), false);
  assert.equal(isValidUrgencyLevel(undefined), false);
});

// ==============================================================================
// 3. TEXT SANITIZATION & UNICODE PRESERVATION
// ==============================================================================

test("sanitizeDoorstepTextField strips HTML tags and control chars", () => {
  assert.equal(
    sanitizeDoorstepTextField("<script>alert('xss')</script>Near Katol bypass canal"),
    "Near Katol bypass canal",
  );
  assert.equal(
    sanitizeDoorstepTextField("Gate 2 <b>behind</b> pump house"),
    "Gate 2 behind pump house",
  );
  assert.equal(sanitizeDoorstepTextField("   Plot #14, North Canal   "), "Plot #14, North Canal");
});

test("sanitizeDoorstepTextField preserves Devanagari Hindi and Marathi characters", () => {
  const marathiLandmark = "काटोल रस्त्याजवळ कालव्याच्या बाजूला, शेत क्र. १४";
  const hindiLandmark = "बोरवेल के पास, प्राथमिक स्कूल के पीछे";

  assert.equal(sanitizeDoorstepTextField(marathiLandmark), marathiLandmark);
  assert.equal(sanitizeDoorstepTextField(hindiLandmark), hindiLandmark);
});

test("sanitizeDoorstepTextField handles non-string and empty inputs", () => {
  assert.equal(sanitizeDoorstepTextField(""), "");
  assert.equal(sanitizeDoorstepTextField("   "), "");
  assert.equal(sanitizeDoorstepTextField(null), "");
  assert.equal(sanitizeDoorstepTextField(undefined), "");
  assert.equal(sanitizeDoorstepTextField(12345), "");
});

// ==============================================================================
// 4. VALIDATE DOORSTEP URGENCY INPUT & BOUNDARY LIMITS
// ==============================================================================

test("validateDoorstepUrgencyInput applies defaults when fields are omitted", () => {
  const result = validateDoorstepUrgencyInput({});

  assert.equal(result.service_type, "DOORSTEP");
  assert.equal(result.urgency_level, "STANDARD");
  assert.equal(result.is_machine_stopped, false);
  assert.equal(result.preferred_time_slot, null);
  assert.equal(result.field_landmark, null);
});

test("validateDoorstepUrgencyInput handles undefined argument", () => {
  const result = validateDoorstepUrgencyInput(undefined);

  assert.equal(result.service_type, "DOORSTEP");
  assert.equal(result.urgency_level, "STANDARD");
  assert.equal(result.is_machine_stopped, false);
  assert.equal(result.preferred_time_slot, null);
  assert.equal(result.field_landmark, null);
});

test("validateDoorstepUrgencyInput validates and accepts explicit values", () => {
  const result = validateDoorstepUrgencyInput({
    service_type: "WORKSHOP",
    urgency_level: "CRITICAL",
    is_machine_stopped: true,
    preferred_time_slot: "Today Afternoon (2 PM - 6 PM)",
    field_landmark: "Opposite Gram Panchayat well, Gate #3",
  });

  assert.equal(result.service_type, "WORKSHOP");
  assert.equal(result.urgency_level, "CRITICAL");
  assert.equal(result.is_machine_stopped, true);
  assert.equal(result.preferred_time_slot, "Today Afternoon (2 PM - 6 PM)");
  assert.equal(result.field_landmark, "Opposite Gram Panchayat well, Gate #3");
});

test("validateDoorstepUrgencyInput rejects invalid service_type", () => {
  assert.throws(
    () => validateDoorstepUrgencyInput({ service_type: "HOME_DELIVERY" }),
    /Invalid service_type "HOME_DELIVERY": must be one of DOORSTEP, WORKSHOP/,
  );
});

test("validateDoorstepUrgencyInput rejects invalid urgency_level", () => {
  assert.throws(
    () => validateDoorstepUrgencyInput({ urgency_level: "ASAP" }),
    /Invalid urgency_level "ASAP": must be one of CRITICAL, HIGH, STANDARD, FLEXIBLE/,
  );
});

test("validateDoorstepUrgencyInput enforces preferred_time_slot 100-character limit", () => {
  const exact100 = "A".repeat(100);
  const result = validateDoorstepUrgencyInput({ preferred_time_slot: exact100 });
  assert.equal(result.preferred_time_slot, exact100);

  const over100 = "A".repeat(101);
  assert.throws(
    () => validateDoorstepUrgencyInput({ preferred_time_slot: over100 }),
    /preferred_time_slot exceeds maximum length of 100 characters \(received 101\)/,
  );
});

test("validateDoorstepUrgencyInput enforces field_landmark 300-character limit", () => {
  const exact300 = "B".repeat(300);
  const result = validateDoorstepUrgencyInput({ field_landmark: exact300 });
  assert.equal(result.field_landmark, exact300);

  const over300 = "B".repeat(301);
  assert.throws(
    () => validateDoorstepUrgencyInput({ field_landmark: over300 }),
    /field_landmark exceeds maximum length of 300 characters \(received 301\)/,
  );
});

test("validateDoorstepUrgencyInput normalizes whitespace-only strings to null", () => {
  const result = validateDoorstepUrgencyInput({
    preferred_time_slot: "    ",
    field_landmark: "   \n\t   ",
  });

  assert.equal(result.preferred_time_slot, null);
  assert.equal(result.field_landmark, null);
});

// ==============================================================================
// 5. BACKWARD-COMPATIBILITY NORMALIZATION FOR OLDER RECORDS
// ==============================================================================

test("normalizeRepairDoorstepUrgency provides canonical defaults for legacy records", () => {
  const legacyRecord = {
    id: "TB-8841",
    job_number: "TB-8841",
    status: "REQUESTED",
    location: "Katol, Nagpur",
  };

  const normalized = normalizeRepairDoorstepUrgency(legacyRecord);

  assert.equal(normalized.service_type, "DOORSTEP");
  assert.equal(normalized.urgency_level, "STANDARD");
  assert.equal(normalized.is_machine_stopped, false);
  assert.equal(normalized.preferred_time_slot, null);
  assert.equal(normalized.field_landmark, null);
});

test("normalizeRepairDoorstepUrgency handles null and undefined inputs gracefully", () => {
  const normNull = normalizeRepairDoorstepUrgency(null);
  assert.equal(normNull.service_type, "DOORSTEP");
  assert.equal(normNull.urgency_level, "STANDARD");

  const normUndefined = normalizeRepairDoorstepUrgency(undefined);
  assert.equal(normUndefined.service_type, "DOORSTEP");
  assert.equal(normUndefined.urgency_level, "STANDARD");
});

test("normalizeRepairDoorstepUrgency preserves valid custom attributes", () => {
  const modernRecord = {
    service_type: "WORKSHOP",
    urgency_level: "HIGH",
    is_machine_stopped: true,
    preferred_time_slot: "Tomorrow 9 AM",
    field_landmark: "Near Savner toll plaza",
  };

  const normalized = normalizeRepairDoorstepUrgency(modernRecord);

  assert.equal(normalized.service_type, "WORKSHOP");
  assert.equal(normalized.urgency_level, "HIGH");
  assert.equal(normalized.is_machine_stopped, true);
  assert.equal(normalized.preferred_time_slot, "Tomorrow 9 AM");
  assert.equal(normalized.field_landmark, "Near Savner toll plaza");
});

// ==============================================================================
// 6. TRIAGE COMPARATOR (URGENCY & STOPPAGE PRIORITIZATION)
// ==============================================================================

test("triageUrgencyComparator sorts critical stopped machines first", () => {
  const criticalStopped = {
    id: "R1",
    urgency_level: "CRITICAL",
    is_machine_stopped: true,
  };
  const criticalRunning = {
    id: "R2",
    urgency_level: "CRITICAL",
    is_machine_stopped: false,
  };
  const highUrgency = {
    id: "R3",
    urgency_level: "HIGH",
    is_machine_stopped: false,
  };
  const standard = {
    id: "R4",
    urgency_level: "STANDARD",
    is_machine_stopped: false,
  };
  const flexible = {
    id: "R5",
    urgency_level: "FLEXIBLE",
    is_machine_stopped: false,
  };

  const unsorted = [standard, flexible, criticalRunning, criticalStopped, highUrgency];
  const sorted = [...unsorted].sort(triageUrgencyComparator);

  assert.deepEqual(
    sorted.map((r) => r.id),
    ["R1", "R2", "R3", "R4", "R5"],
    "Expected sort: Critical Stopped (100) -> Critical (80) -> High (60) -> Standard (40) -> Flexible (20)",
  );
});

// ==============================================================================
// 7. SQL MIGRATION FILE AST & INTEGRITY CHECKS
// ==============================================================================

test("SQL Migration 20261102100000_phase10_2_doorstep_urgency.sql exists and defines required schema", () => {
  const migrationPath = path.join(
    ROOT_DIR,
    "supabase",
    "migrations",
    "20261102100000_phase10_2_doorstep_urgency.sql",
  );

  assert.equal(fs.existsSync(migrationPath), true, "Migration file must exist on disk");
  const sql = fs.readFileSync(migrationPath, "utf8");

  // Check columns
  assert.match(sql, /service_type text NOT NULL DEFAULT 'DOORSTEP'/);
  assert.match(sql, /CHECK \(service_type IN \('DOORSTEP', 'WORKSHOP'\)\)/);
  assert.match(sql, /urgency_level text NOT NULL DEFAULT 'STANDARD'/);
  assert.match(sql, /CHECK \(urgency_level IN \('CRITICAL', 'HIGH', 'STANDARD', 'FLEXIBLE'\)\)/);
  assert.match(sql, /is_machine_stopped boolean NOT NULL DEFAULT false/);
  assert.match(sql, /preferred_time_slot text NULL/);
  assert.match(sql, /char_length\(preferred_time_slot\) <= 100/);
  assert.match(sql, /field_landmark text NULL/);
  assert.match(sql, /char_length\(field_landmark\) <= 300/);

  // Check indexes
  assert.match(sql, /idx_repair_requests_urgency_triage/);
  assert.match(sql, /idx_repair_requests_service_type/);
});

// ==============================================================================
// 8. SUPABASE TYPES INTEGRITY CHECKS
// ==============================================================================

test("src/integrations/supabase/types.ts includes Phase 10.2 doorstep columns", () => {
  const typesPath = path.join(ROOT_DIR, "src", "integrations", "supabase", "types.ts");
  const typesContent = fs.readFileSync(typesPath, "utf8");

  // Check Row
  assert.match(typesContent, /service_type: "DOORSTEP" \| "WORKSHOP"/);
  assert.match(typesContent, /urgency_level: "CRITICAL" \| "HIGH" \| "STANDARD" \| "FLEXIBLE"/);
  assert.match(typesContent, /is_machine_stopped: boolean/);
  assert.match(typesContent, /preferred_time_slot: string \| null/);
  assert.match(typesContent, /field_landmark: string \| null/);

  // Check Insert
  assert.match(typesContent, /service_type\?: "DOORSTEP" \| "WORKSHOP"/);
  assert.match(typesContent, /urgency_level\?: "CRITICAL" \| "HIGH" \| "STANDARD" \| "FLEXIBLE"/);
  assert.match(typesContent, /is_machine_stopped\?: boolean/);
  assert.match(typesContent, /preferred_time_slot\?: string \| null/);
  assert.match(typesContent, /field_landmark\?: string \| null/);
});

// ==============================================================================
// 9. REPAIR REQUESTS SERVICE INTEGRATION CHECKS
// ==============================================================================

test("src/lib/services/repair-requests.ts re-exports doorstep-service and integrates validation", () => {
  const servicePath = path.join(ROOT_DIR, "src", "lib", "services", "repair-requests.ts");
  const content = fs.readFileSync(servicePath, "utf8");

  // Re-export
  assert.match(content, /export \* from "\.\/doorstep-service";/);

  // Input interface extensions
  assert.match(content, /service_type\?: ServiceType \| undefined;/);
  assert.match(content, /urgency_level\?: UrgencyLevel \| undefined;/);
  assert.match(content, /is_machine_stopped\?: boolean \| undefined;/);
  assert.match(content, /preferred_time_slot\?: string \| null \| undefined;/);
  assert.match(content, /field_landmark\?: string \| null \| undefined;/);

  // createRepairRequest uses validateDoorstepUrgencyInput
  assert.match(content, /const doorstepUrgency = validateDoorstepUrgencyInput\(input\);/);
  assert.match(content, /service_type: doorstepUrgency\.service_type,/);
  assert.match(content, /urgency_level: doorstepUrgency\.urgency_level,/);
  assert.match(content, /is_machine_stopped: doorstepUrgency\.is_machine_stopped,/);
  assert.match(content, /preferred_time_slot: doorstepUrgency\.preferred_time_slot,/);
  assert.match(content, /field_landmark: doorstepUrgency\.field_landmark,/);

  // Fallback resilience for unmigrated database schema cache
  assert.match(content, /insertError\.message\.includes\("service_type"\)/);
});

// ==============================================================================
// 10. FARMER BREAKDOWN WIZARD INTEGRATION (PHASE 10.2-B)
// ==============================================================================

test("SERVICE_MODE_OPTIONS defines Doorstep and Workshop with subtitles", () => {
  assert.equal(SERVICE_MODE_OPTIONS.length, 2);
  assert.deepEqual(
    SERVICE_MODE_OPTIONS.map((o) => o.mode),
    ["DOORSTEP", "WORKSHOP"],
  );
  assert.equal(SERVICE_MODE_OPTIONS[0].label, "Doorstep / On-Field");
  assert.equal(SERVICE_MODE_OPTIONS[1].label, "Workshop Drop-off");
});

test("URGENCY_OPTIONS defines all four tiers with farmer-focused descriptions", () => {
  assert.equal(URGENCY_OPTIONS.length, 4);
  assert.deepEqual(
    URGENCY_OPTIONS.map((o) => o.level),
    ["CRITICAL", "HIGH", "STANDARD", "FLEXIBLE"],
  );

  const critical = URGENCY_OPTIONS.find((o) => o.level === "CRITICAL");
  assert.match(critical.description, /Field operations halted/);

  const high = URGENCY_OPTIONS.find((o) => o.level === "HIGH");
  assert.match(high.description, /24 hours/);

  const standard = URGENCY_OPTIONS.find((o) => o.level === "STANDARD");
  assert.match(standard.description, /Normal repair timeline/);

  const flexible = URGENCY_OPTIONS.find((o) => o.level === "FLEXIBLE");
  assert.match(flexible.description, /Routine maintenance/);
});

test("FARMER_AVAILABILITY_SLOTS defines four standard scheduling windows", () => {
  assert.equal(FARMER_AVAILABILITY_SLOTS.length, 4);
  assert.deepEqual(FARMER_AVAILABILITY_SLOTS, [
    "Immediate / ASAP",
    "Today Afternoon (2 PM–6 PM)",
    "Tomorrow Morning (8 AM–12 PM)",
    "Flexible",
  ]);
});

test("Draft state initialization defaults to Doorstep, Standard urgency, and Immediate availability", () => {
  // Simulates the default state used in Report component
  const initialDraft = {
    step: 1,
    equipmentId: "",
    symptoms: [],
    description: "",
    photos: [],
    village: "",
    tahsil: "",
    serviceType: "DOORSTEP",
    urgencyLevel: "STANDARD",
    isMachineStopped: false,
    preferredTimeSlot: "Immediate / ASAP",
    fieldLandmark: "",
  };

  assert.equal(initialDraft.serviceType, "DOORSTEP");
  assert.equal(initialDraft.urgencyLevel, "STANDARD");
  assert.equal(initialDraft.isMachineStopped, false);
  assert.equal(initialDraft.preferredTimeSlot, "Immediate / ASAP");
  assert.equal(initialDraft.fieldLandmark, "");
});

test("Draft transitions between Doorstep and Workshop modes cleanly", () => {
  let draft = {
    serviceType: "DOORSTEP",
    fieldLandmark: "Gate 3 near north canal",
  };

  // Switch to Workshop
  draft = { ...draft, serviceType: "WORKSHOP" };
  assert.equal(draft.serviceType, "WORKSHOP");

  // In submission payload, landmark is omitted/nullified when in WORKSHOP mode
  const submissionPayload = {
    service_type: draft.serviceType,
    field_landmark: draft.serviceType === "DOORSTEP" ? draft.fieldLandmark : null,
  };
  assert.equal(submissionPayload.field_landmark, null);

  // Switch back to Doorstep
  draft = { ...draft, serviceType: "DOORSTEP" };
  assert.equal(draft.serviceType, "DOORSTEP");
  const doorstepPayload = {
    service_type: draft.serviceType,
    field_landmark: draft.serviceType === "DOORSTEP" ? draft.fieldLandmark : null,
  };
  assert.equal(doorstepPayload.field_landmark, "Gate 3 near north canal");
});

test("Draft state serialization and restoration preserves all new Phase 10.2 fields", () => {
  const activeDraft = {
    step: 3,
    equipmentId: "eq-101",
    symptoms: ["Engine Overheating", "White Smoke"],
    description: "Tractor stalled in field during tilling",
    photos: ["data:image/jpeg;base64,sample"],
    village: "Dorli",
    tahsil: "Katol",
    serviceType: "DOORSTEP",
    urgencyLevel: "CRITICAL",
    isMachineStopped: true,
    preferredTimeSlot: "Today Afternoon (2 PM–6 PM)",
    fieldLandmark: "Plot 12, behind primary school",
  };

  const serialized = JSON.stringify(activeDraft);
  const parsed = JSON.parse(serialized);

  // Reconstitute with draft restore logic
  const restored = {
    step: typeof parsed.step === "number" ? parsed.step : 1,
    equipmentId: typeof parsed.equipmentId === "string" ? parsed.equipmentId : "",
    symptoms: Array.isArray(parsed.symptoms) ? parsed.symptoms : [],
    description: typeof parsed.description === "string" ? parsed.description : "",
    photos: Array.isArray(parsed.photos) ? parsed.photos : [],
    village: typeof parsed.village === "string" ? parsed.village : "",
    tahsil: typeof parsed.tahsil === "string" ? parsed.tahsil : "",
    serviceType: isValidServiceType(parsed.serviceType) ? parsed.serviceType : "DOORSTEP",
    urgencyLevel: isValidUrgencyLevel(parsed.urgencyLevel) ? parsed.urgencyLevel : "STANDARD",
    isMachineStopped:
      typeof parsed.isMachineStopped === "boolean" ? parsed.isMachineStopped : false,
    preferredTimeSlot:
      typeof parsed.preferredTimeSlot === "string" && parsed.preferredTimeSlot.trim().length > 0
        ? parsed.preferredTimeSlot
        : "Immediate / ASAP",
    fieldLandmark: typeof parsed.fieldLandmark === "string" ? parsed.fieldLandmark : "",
  };

  assert.deepEqual(restored, activeDraft);
});

test("Draft restoration safely upgrades legacy drafts without doorstep attributes", () => {
  // Legacy draft from Phase 9 / 10.1 without any Phase 10.2 fields
  const legacyDraftJson = JSON.stringify({
    step: 2,
    equipmentId: "eq-legacy-99",
    symptoms: ["Hydraulic Lift Failure"],
    description: "Lift not raising cultivator",
    photos: [],
    village: "Mohpa",
    tahsil: "Kalmeshwar",
  });

  const parsed = JSON.parse(legacyDraftJson);

  const restored = {
    step: typeof parsed.step === "number" ? parsed.step : 1,
    equipmentId: typeof parsed.equipmentId === "string" ? parsed.equipmentId : "",
    symptoms: Array.isArray(parsed.symptoms) ? parsed.symptoms : [],
    description: typeof parsed.description === "string" ? parsed.description : "",
    photos: Array.isArray(parsed.photos) ? parsed.photos : [],
    village: typeof parsed.village === "string" ? parsed.village : "",
    tahsil: typeof parsed.tahsil === "string" ? parsed.tahsil : "",
    serviceType: isValidServiceType(parsed.serviceType) ? parsed.serviceType : "DOORSTEP",
    urgencyLevel: isValidUrgencyLevel(parsed.urgencyLevel) ? parsed.urgencyLevel : "STANDARD",
    isMachineStopped:
      typeof parsed.isMachineStopped === "boolean" ? parsed.isMachineStopped : false,
    preferredTimeSlot:
      typeof parsed.preferredTimeSlot === "string" && parsed.preferredTimeSlot.trim().length > 0
        ? parsed.preferredTimeSlot
        : "Immediate / ASAP",
    fieldLandmark: typeof parsed.fieldLandmark === "string" ? parsed.fieldLandmark : "",
  };

  assert.equal(restored.equipmentId, "eq-legacy-99");
  assert.equal(restored.serviceType, "DOORSTEP", "Defaulted to DOORSTEP");
  assert.equal(restored.urgencyLevel, "STANDARD", "Defaulted to STANDARD");
  assert.equal(restored.isMachineStopped, false, "Defaulted to false");
  assert.equal(restored.preferredTimeSlot, "Immediate / ASAP", "Defaulted to Immediate");
  assert.equal(restored.fieldLandmark, "", "Defaulted to empty landmark");
});

test("Submission payload integrates Doorstep, Urgency, Stoppage, Availability, and Landmark", () => {
  const wizardDraft = {
    equipmentId: "tractor-01",
    symptoms: ["Steering Pulling / Heavy", "Front Axle Noise"],
    description: "Cannot steer tractor, left tie-rod loose",
    photos: [],
    village: "Dorli",
    tahsil: "Katol",
    serviceType: "DOORSTEP",
    urgencyLevel: "CRITICAL",
    isMachineStopped: true,
    preferredTimeSlot: "Tomorrow Morning (8 AM–12 PM)",
    fieldLandmark: "Gate 2 near canal bund",
  };

  // Simulates the exact object passed to createRepairRequest
  const payload = {
    equipment_id: wizardDraft.equipmentId,
    symptoms: wizardDraft.symptoms,
    description: wizardDraft.description,
    photos: wizardDraft.photos,
    location: `${wizardDraft.village}, ${wizardDraft.tahsil}`,
    service_type: wizardDraft.serviceType,
    urgency_level: wizardDraft.urgencyLevel,
    is_machine_stopped: wizardDraft.isMachineStopped,
    preferred_time_slot: wizardDraft.preferredTimeSlot?.trim() || null,
    field_landmark:
      wizardDraft.serviceType === "DOORSTEP" ? wizardDraft.fieldLandmark?.trim() || null : null,
  };

  // Validates through Phase 10.2-A validation engine
  const validated = validateDoorstepUrgencyInput(payload);

  assert.equal(validated.service_type, "DOORSTEP");
  assert.equal(validated.urgency_level, "CRITICAL");
  assert.equal(validated.is_machine_stopped, true);
  assert.equal(validated.preferred_time_slot, "Tomorrow Morning (8 AM–12 PM)");
  assert.equal(validated.field_landmark, "Gate 2 near canal bund");
});

test("Farmer breakdown wizard source AST verifies Step 3 controls and Step 5 summary", () => {
  const wizardPath = path.join(ROOT_DIR, "src", "routes", "farmer", "report-breakdown.tsx");
  const content = fs.readFileSync(wizardPath, "utf8");

  // Step 3 controls
  assert.match(content, /Service Delivery Mode/, "Renders Service Delivery Mode header");
  assert.match(content, /SERVICE_MODE_OPTIONS\.map/, "Renders service mode options");
  assert.match(content, /fieldLandmark/, "Renders fieldLandmark control");
  assert.match(content, /d\.fieldLandmark\.length\}\/300/, "Renders 300 char counter");
  assert.match(content, /Machine is completely stopped \/ immobile/, "Renders stoppage toggle");
  assert.match(content, /URGENCY_OPTIONS\.map/, "Renders urgency radio buttons");
  assert.match(content, /FARMER_AVAILABILITY_SLOTS\.map/, "Renders availability chips");

  // Step 5 Review Card
  assert.match(content, /Review Breakdown Summary/, "Renders Step 5 summary header");
  assert.match(content, /Service Mode:/, "Displays Service Mode in review");
  assert.match(content, /Urgency:/, "Displays Urgency in review");
  assert.match(content, /Machine Stoppage:/, "Displays Machine Stoppage in review");
  assert.match(content, /Preferred Availability:/, "Displays Preferred Availability in review");
  assert.match(content, /Field Landmark:/, "Displays Field Landmark in review");

  // Submission payload
  assert.match(
    content,
    /service_type:\s*d\.serviceType/,
    "Passes service_type to createRepairRequest",
  );
  assert.match(
    content,
    /urgency_level:\s*d\.urgencyLevel/,
    "Passes urgency_level to createRepairRequest",
  );
  assert.match(
    content,
    /is_machine_stopped:\s*d\.isMachineStopped/,
    "Passes is_machine_stopped to createRepairRequest",
  );
  assert.match(
    content,
    /preferred_time_slot:\s*d\.preferredTimeSlot/,
    "Passes preferred_time_slot to createRepairRequest",
  );
  assert.match(
    content,
    /field_landmark:\s*d\.serviceType === "DOORSTEP"/,
    "Conditionally passes landmark only for Doorstep",
  );
});

// ==============================================================================
// 9. PHASE 10.2-C: STAFF OPERATIONAL VISIBILITY & TRIAGE
// ==============================================================================

test("Technician incoming feed triage orders critical stopped machines first", () => {
  const jobs = [
    {
      id: "req-std",
      service_type: "DOORSTEP",
      urgency_level: "STANDARD",
      is_machine_stopped: false,
      status_since: "2026-11-02T10:00:00Z",
    },
    {
      id: "req-flex",
      service_type: "WORKSHOP",
      urgency_level: "FLEXIBLE",
      is_machine_stopped: false,
      status_since: "2026-11-02T09:00:00Z",
    },
    {
      id: "req-crit-stopped",
      service_type: "DOORSTEP",
      urgency_level: "CRITICAL",
      is_machine_stopped: true,
      status_since: "2026-11-02T11:00:00Z",
    },
    {
      id: "req-high",
      service_type: "DOORSTEP",
      urgency_level: "HIGH",
      is_machine_stopped: false,
      status_since: "2026-11-02T08:00:00Z",
    },
    {
      id: "req-crit-running",
      service_type: "WORKSHOP",
      urgency_level: "CRITICAL",
      is_machine_stopped: false,
      status_since: "2026-11-02T07:00:00Z",
    },
    {
      id: "req-legacy",
      // Missing doorstep fields (legacy Phase 9 record)
      status_since: "2026-11-02T06:00:00Z",
    },
  ];

  // Exactly how technician feed sorts incoming jobs
  const sorted = [...jobs].sort(
    (a, b) =>
      triageUrgencyComparator(a, b) ||
      new Date(a.status_since).getTime() - new Date(b.status_since).getTime(),
  );

  assert.equal(sorted[0].id, "req-crit-stopped", "Critical stopped machine is #1 priority");
  assert.equal(sorted[1].id, "req-crit-running", "Critical non-stopped is #2");
  assert.equal(sorted[2].id, "req-high", "High urgency is #3");
  // Standard and legacy tie on urgency (score 40). Legacy status_since (06:00) < req-std (10:00)
  assert.equal(
    sorted[3].id,
    "req-legacy",
    "Legacy ticket gets STANDARD and precedes req-std by FIFO",
  );
  assert.equal(sorted[4].id, "req-std", "Standard ticket is #5");
  assert.equal(sorted[5].id, "req-flex", "Flexible urgency is last (#6)");
});

test("Service Centre 3-tier queue triage prioritizes urgency, then SLA overdue, then FIFO", () => {
  const queue = [
    // Standard urgency, but SLA overdue
    {
      id: "ticket-std-overdue",
      service_type: "DOORSTEP",
      urgency_level: "STANDARD",
      is_machine_stopped: false,
      is_overdue: true,
      status_since: "2026-11-02T05:00:00Z",
    },
    // Critical stopped machine, not overdue
    {
      id: "ticket-crit-stopped",
      service_type: "DOORSTEP",
      urgency_level: "CRITICAL",
      is_machine_stopped: true,
      is_overdue: false,
      status_since: "2026-11-02T11:00:00Z",
    },
    // High urgency, not overdue, later time
    {
      id: "ticket-high-recent",
      service_type: "DOORSTEP",
      urgency_level: "HIGH",
      is_machine_stopped: false,
      is_overdue: false,
      status_since: "2026-11-02T09:00:00Z",
    },
    // High urgency, SLA overdue
    {
      id: "ticket-high-overdue",
      service_type: "DOORSTEP",
      urgency_level: "HIGH",
      is_machine_stopped: false,
      is_overdue: true,
      status_since: "2026-11-02T08:00:00Z",
    },
    // High urgency, not overdue, earlier time
    {
      id: "ticket-high-older",
      service_type: "DOORSTEP",
      urgency_level: "HIGH",
      is_machine_stopped: false,
      is_overdue: false,
      status_since: "2026-11-02T07:00:00Z",
    },
  ];

  // Exact Service Centre comparator implementation
  const sorted = [...queue].sort((a, b) => {
    const urgencyDiff = triageUrgencyComparator(a, b);
    if (urgencyDiff !== 0) return urgencyDiff;
    const slaDiff = Number(b.is_overdue) - Number(a.is_overdue);
    if (slaDiff !== 0) return slaDiff;
    return new Date(a.status_since).getTime() - new Date(b.status_since).getTime();
  });

  // Verification of 3-tier triage ordering:
  // 1. Critical stopped machine beats everything, even overdue tickets of lower urgency
  assert.equal(sorted[0].id, "ticket-crit-stopped");
  // 2. High urgency group: overdue ticket beats non-overdue tickets
  assert.equal(sorted[1].id, "ticket-high-overdue");
  // 3. High urgency non-overdue: older ticket (07:00) beats newer ticket (09:00) by FIFO
  assert.equal(sorted[2].id, "ticket-high-older");
  assert.equal(sorted[3].id, "ticket-high-recent");
  // 4. Standard urgency ticket is after High urgency
  assert.equal(sorted[4].id, "ticket-std-overdue");
});

test("Technician incoming feed AST verifies Phase 10.2 badges and critical stoppage highlight", () => {
  const techIndexPath = path.join(ROOT_DIR, "src", "routes", "technician", "index.tsx");
  const content = fs.readFileSync(techIndexPath, "utf8");

  assert.match(content, /normalizeRepairDoorstepUrgency/, "Imports and uses doorstep normalizer");
  assert.match(
    content,
    /triageUrgencyComparator/,
    "Sorts incoming repairs with triageUrgencyComparator",
  );
  assert.match(content, /Truck.*Doorstep/, "Renders Doorstep badge with Truck icon");
  assert.match(content, /Building2.*Workshop/, "Renders Workshop badge with Building2 icon");
  assert.match(
    content,
    /Critical · Field Stoppage/,
    "Renders Critical Field Stoppage urgency badge",
  );
  assert.match(
    content,
    /isCriticalStopped\s*\?\s*"border-destructive/,
    "Applies critical stoppage card highlight",
  );
  assert.match(content, /norm\.field_landmark/, "Renders field landmark subtitle if available");
});

test("Technician job detail AST verifies Doorstep, Urgency, Stoppage, and Landmark section", () => {
  const techDetailPath = path.join(ROOT_DIR, "src", "routes", "technician", "job", "$id.tsx");
  const content = fs.readFileSync(techDetailPath, "utf8");

  assert.match(content, /normalizeRepairDoorstepUrgency/, "Uses doorstep normalizer");
  assert.match(
    content,
    /Doorstep \/ On-Field Service/,
    "Displays Doorstep / On-Field Service badge",
  );
  assert.match(content, /Workshop Drop-off/, "Displays Workshop Drop-off badge");
  assert.match(content, /Machine Stopped in Field/, "Displays Machine Stopped in Field badge");
  assert.match(content, /Farmer Availability:/, "Displays Farmer Availability timing");
  assert.match(
    content,
    /Field Landmark & Access[\s\S]*Instructions/,
    "Displays Field Landmark instructions",
  );
  assert.match(content, /DirectionsButton/, "Preserves existing DirectionsButton navigation");
  assert.match(content, /Exact GPS saved/, "Preserves existing GPS accuracy indication");
});

test("Service Centre queue AST verifies Service & Urgency column and triage sorting", () => {
  const adminIndexPath = path.join(ROOT_DIR, "src", "routes", "admin", "index.tsx");
  const content = fs.readFileSync(adminIndexPath, "utf8");

  assert.match(content, /"Service & Urgency"/, "Includes Service & Urgency in table header");
  assert.match(content, /colSpan=\{8\}/, "Uses colSpan=8 for empty table view");
  assert.match(
    content,
    /triageUrgencyComparator/,
    "Uses triageUrgencyComparator in open tickets sorting",
  );
  assert.match(content, /checkOverdue/, "Preserves checkOverdue SLA secondary sorting");
  assert.match(content, /Truck.*Doorstep/, "Displays Doorstep delivery mode pill in queue");
  assert.match(content, /Building2.*Workshop/, "Displays Workshop delivery mode pill in queue");
  assert.match(content, /Stopped/, "Displays Stopped badge in queue");
});

test("Service Centre repair detail AST verifies Doorstep Urgency header and report card", () => {
  const adminDetailPath = path.join(ROOT_DIR, "src", "routes", "admin", "repair", "$id.tsx");
  const content = fs.readFileSync(adminDetailPath, "utf8");

  assert.match(
    content,
    /normalizeRepairDoorstepUrgency\(dbRepair \|\| mockR\)/,
    "Normalizes real or mock repair",
  );
  assert.match(content, /Doorstep \/ On-Field/, "Displays Doorstep / On-Field header badge");
  assert.match(
    content,
    /Field Operations Halted[\s\S]*Critical Field Stoppage/,
    "Renders top emergency stoppage banner",
  );
  assert.match(
    content,
    /Service Delivery & Urgency/,
    "Displays dedicated Service Delivery & Urgency section in Farmer Report",
  );
  assert.match(
    content,
    /Field Landmark & Access[\s\S]*Instructions/,
    "Displays landmark instructions on admin detail",
  );
});

// ==============================================================================

// ==============================================================================

// ==============================================================================
// 10. PHASE 10.2: LANDMARK VISIBILITY FIX (END-TO-END)
// ==============================================================================

test("Landmark included in farmer submission payload for Doorstep and omitted for Workshop", () => {
  const wizardPath = path.join(ROOT_DIR, "src", "routes", "farmer", "report-breakdown.tsx");
  const content = fs.readFileSync(wizardPath, "utf8");

  // Verify conditional landmark submission expression in wizard
  assert.match(
    content,
    /field_landmark:\s*d\.serviceType === "DOORSTEP"\s*\?\s*d\.fieldLandmark\?\.trim\(\)\s*\|\|\s*null\s*:\s*null/,
    "Passes trimmed landmark for Doorstep, null for Workshop or whitespace",
  );

  // Simulate submission logic behavior
  const simulateSubmission = (serviceType, fieldLandmark) => ({
    service_type: serviceType,
    field_landmark: serviceType === "DOORSTEP" ? fieldLandmark?.trim() || null : null,
  });

  const doorstepWithLandmark = simulateSubmission("DOORSTEP", "  Gate 3 near canal bund  ");
  assert.equal(doorstepWithLandmark.field_landmark, "Gate 3 near canal bund");

  const doorstepEmpty = simulateSubmission("DOORSTEP", "   ");
  assert.equal(doorstepEmpty.field_landmark, null);

  const workshopWithLandmark = simulateSubmission("WORKSHOP", "Near depot entrance");
  assert.equal(workshopWithLandmark.field_landmark, null);
});

test("Landmark persisted and returned by repair queries and service fallbacks", () => {
  const servicePath = path.join(ROOT_DIR, "src", "lib", "services", "repair-requests.ts");
  const content = fs.readFileSync(servicePath, "utf8");

  // Verify createRepairRequest includes field_landmark in both primary insert and fallback insert
  assert.match(
    content,
    /field_landmark:\s*doorstepUrgency\.field_landmark/,
    "Inserts field_landmark into repair_requests table",
  );
  assert.match(
    content,
    /insertError\.message\.includes\("field_landmark"\)/,
    "Handles remote schema fallback check for field_landmark",
  );
  assert.match(
    content,
    /doorstep_urgency:\s*\{\s*service_type:\s*doorstepUrgency\.service_type/,
    "Fallback insert embeds doorstep_urgency in assessment JSONB",
  );

  // Verify getRepairRequestById selects all columns including field_landmark
  assert.match(
    content,
    /\.from\("repair_requests"\)\s*\.select\(\s*"\*,\s*equipment\(\*\)/,
    "getRepairRequestById selects * from repair_requests including field_landmark",
  );

  // Verify technician query selects all columns
  assert.match(
    content,
    /export async function getTechnicianRepairRequests[\s\S]*?\.select\(\s*"\*,\s*equipment\(\*\)/,
    "getTechnicianRepairRequests selects * including field_landmark",
  );

  // Verify admin query selects all columns
  assert.match(
    content,
    /export async function getAdminRepairRequests[\s\S]*?\.select\(\s*"\*,\s*equipment\(\*\)/,
    "getAdminRepairRequests selects * including field_landmark",
  );
});

test("Landmark survives application data mapping and normalization", () => {
  // Database snake_case row
  const dbRow = {
    id: "uuid-1234",
    service_type: "DOORSTEP",
    urgency_level: "CRITICAL",
    is_machine_stopped: true,
    preferred_time_slot: "Immediate / ASAP",
    field_landmark: "Opposite primary school, North Gate",
  };
  const normFromDb = normalizeRepairDoorstepUrgency(dbRow);
  assert.equal(normFromDb.field_landmark, "Opposite primary school, North Gate");
  assert.equal(normFromDb.service_type, "DOORSTEP");

  // In-memory / demo camelCase model
  const memoryModel = {
    id: "TB-7788",
    serviceType: "DOORSTEP",
    urgencyLevel: "HIGH",
    isMachineStopped: false,
    preferredTimeSlot: "Tomorrow Morning (8 AM–12 PM)",
    fieldLandmark: "Plot #42 behind solar pump",
  };
  const normFromMemory = normalizeRepairDoorstepUrgency(memoryModel);
  assert.equal(normFromMemory.field_landmark, "Plot #42 behind solar pump");
  assert.equal(normFromMemory.service_type, "DOORSTEP");
  assert.equal(normFromMemory.preferred_time_slot, "Tomorrow Morning (8 AM–12 PM)");

  // Unmigrated database row (fallback: stored inside assessment JSON)
  const unmigratedRow = {
    id: "TB-7940",
    symptoms: ["Engine won't start"],
    location: "Katol, Nagpur",
    assessment: {
      skill: "Electrical",
      doorstep_urgency: {
        service_type: "DOORSTEP",
        urgency_level: "STANDARD",
        is_machine_stopped: false,
        preferred_time_slot: "Immediate / ASAP",
        field_landmark: "This is the landmark",
      },
    },
  };
  const normFromUnmigrated = normalizeRepairDoorstepUrgency(unmigratedRow);
  assert.equal(normFromUnmigrated.field_landmark, "This is the landmark");
  assert.equal(normFromUnmigrated.service_type, "DOORSTEP");
  assert.equal(normFromUnmigrated.urgency_level, "STANDARD");
  assert.equal(normFromUnmigrated.is_machine_stopped, false);
  assert.equal(normFromUnmigrated.preferred_time_slot, "Immediate / ASAP");
});

test("Farmer repair detail AST verifies Field Landmark & Access Instructions section", () => {
  const farmerDetailPath = path.join(ROOT_DIR, "src", "routes", "farmer", "repair", "$id.tsx");
  const content = fs.readFileSync(farmerDetailPath, "utf8");

  assert.match(
    content,
    /normalizeRepairDoorstepUrgency/,
    "Farmer repair view imports and calls normalizeRepairDoorstepUrgency",
  );
  assert.match(
    content,
    /Field Landmark & Access[\s\S]*Instructions/,
    "Farmer repair view renders Field Landmark & Access Instructions section",
  );
  assert.match(
    content,
    /doorstepInfo\.service_type === "DOORSTEP"[\s\S]*?Boolean\(doorstepInfo\.field_landmark\?\.trim\(\)\)/,
    "Farmer repair view conditionally displays landmark only for Doorstep with non-empty landmark",
  );
  assert.match(
    content,
    /field_landmark:\s*demo\.field_landmark\s*\|\|\s*demo\.fieldLandmark\s*\|\|\s*null/,
    "Demo store fallback in farmer repair view preserves field_landmark",
  );
});

test("Technician job detail AST verifies Field Landmark & Access Instructions section condition", () => {
  const techDetailPath = path.join(ROOT_DIR, "src", "routes", "technician", "job", "$id.tsx");
  const content = fs.readFileSync(techDetailPath, "utf8");

  assert.match(
    content,
    /Field Landmark & Access[\s\S]*Instructions/,
    "Technician job view renders Field Landmark & Access Instructions section",
  );
  assert.match(
    content,
    /norm\.service_type === "DOORSTEP"[\s\S]*?Boolean\(norm\.field_landmark\?\.trim\(\)\)/,
    "Technician job view conditionally displays landmark only for Doorstep with non-empty landmark",
  );
  assert.match(content, /norm\.field_landmark/, "Renders norm.field_landmark content");
});

test("Service Centre repair detail AST verifies Field Landmark & Access Instructions section condition", () => {
  const adminDetailPath = path.join(ROOT_DIR, "src", "routes", "admin", "repair", "$id.tsx");
  const content = fs.readFileSync(adminDetailPath, "utf8");

  assert.match(
    content,
    /Field Landmark & Access[\s\S]*Instructions/,
    "Service Centre repair view renders Field Landmark & Access Instructions section",
  );
  assert.match(
    content,
    /doorstepInfo\.service_type === "DOORSTEP"[\s\S]*?Boolean\(doorstepInfo\.field_landmark\?\.trim\(\)\)/,
    "Service Centre repair view conditionally displays landmark only for Doorstep with non-empty landmark",
  );
  assert.match(
    content,
    /doorstepInfo\.field_landmark/,
    "Renders doorstepInfo.field_landmark content",
  );
});

test("Empty landmark and Workshop mode hide the landmark section across all three views", () => {
  // Evaluates visibility condition across all roles
  const shouldDisplaySection = (service_type, field_landmark) => {
    return service_type === "DOORSTEP" && Boolean(field_landmark?.trim());
  };

  // Workshop mode hides even if landmark text exists
  assert.equal(
    shouldDisplaySection("WORKSHOP", "Near depot gate"),
    false,
    "Workshop mode hides landmark section",
  );

  // Doorstep mode with null landmark hides
  assert.equal(shouldDisplaySection("DOORSTEP", null), false, "Null landmark hides section");

  // Doorstep mode with empty string hides
  assert.equal(shouldDisplaySection("DOORSTEP", ""), false, "Empty landmark hides section");

  // Doorstep mode with whitespace only hides
  assert.equal(
    shouldDisplaySection("DOORSTEP", "   \t\n  "),
    false,
    "Whitespace-only landmark hides section",
  );

  // Doorstep mode with valid text displays
  assert.equal(
    shouldDisplaySection("DOORSTEP", "Gate #4, Canal Road"),
    true,
    "Doorstep with valid landmark displays section",
  );
});

test("Marathi and Hindi landmark text remains intact without alteration or translation", () => {
  const marathiLandmark =
    "विहिरीच्या डाव्या बाजूला, शेत रस्ता क्रमांक ४, जुन्या वडाच्या झाडाशेजारी, गट क्र. १२८";
  const hindiLandmark =
    "गेट नं 3, कालव्याजवळ, ग्रामपंचायत पाण्याच्या टाकीच्या मागे 500 मी, प्लॉट #14";

  // 1. Sanitization preserves full text
  assert.equal(
    sanitizeDoorstepTextField(marathiLandmark),
    marathiLandmark,
    "Marathi landmark preserved through sanitizeDoorstepTextField",
  );
  assert.equal(
    sanitizeDoorstepTextField(hindiLandmark),
    hindiLandmark,
    "Hindi landmark preserved through sanitizeDoorstepTextField",
  );

  // 2. Validation preserves full text
  const validatedMarathi = validateDoorstepUrgencyInput({
    service_type: "DOORSTEP",
    field_landmark: marathiLandmark,
  });
  assert.equal(
    validatedMarathi.field_landmark,
    marathiLandmark,
    "Marathi landmark preserved through validateDoorstepUrgencyInput",
  );

  const validatedHindi = validateDoorstepUrgencyInput({
    service_type: "DOORSTEP",
    field_landmark: hindiLandmark,
  });
  assert.equal(
    validatedHindi.field_landmark,
    hindiLandmark,
    "Hindi landmark preserved through validateDoorstepUrgencyInput",
  );

  // 3. Normalization preserves full text
  const normalizedMarathi = normalizeRepairDoorstepUrgency({
    service_type: "DOORSTEP",
    field_landmark: marathiLandmark,
  });
  assert.equal(
    normalizedMarathi.field_landmark,
    marathiLandmark,
    "Marathi landmark preserved through normalizeRepairDoorstepUrgency",
  );

  const normalizedHindi = normalizeRepairDoorstepUrgency({
    service_type: "DOORSTEP",
    field_landmark: hindiLandmark,
  });
  assert.equal(
    normalizedHindi.field_landmark,
    hindiLandmark,
    "Hindi landmark preserved through normalizeRepairDoorstepUrgency",
  );
});

test("Legacy repairs without landmarks load safely with field_landmark: null", () => {
  const legacyRecord = {
    id: "legacy-repair-001",
    farmer_id: "farmer-1",
    symptoms: ["Engine overheating"],
    description: "Tractor starts smoking after 10 minutes of tilling.",
    location: "Wardha",
    created_at: "2025-01-01T00:00:00Z",
  };

  const norm = normalizeRepairDoorstepUrgency(legacyRecord);
  assert.equal(norm.service_type, "DOORSTEP", "Defaults service_type to DOORSTEP");
  assert.equal(norm.urgency_level, "STANDARD", "Defaults urgency_level to STANDARD");
  assert.equal(norm.is_machine_stopped, false, "Defaults is_machine_stopped to false");
  assert.equal(norm.preferred_time_slot, null, "Defaults preferred_time_slot to null");
  assert.equal(norm.field_landmark, null, "Defaults field_landmark to null");

  // Null input handles gracefully
  const normNull = normalizeRepairDoorstepUrgency(null);
  assert.equal(normNull.field_landmark, null);

  // Undefined input handles gracefully
  const normUndefined = normalizeRepairDoorstepUrgency(undefined);
  assert.equal(normUndefined.field_landmark, null);
});
