import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  resolveEffectiveDeliveryMode,
  validateIntakeSubmission,
  isWorkshopEligible,
  isWorkshopSelectable,
  IMMOBILE_LOCK_WARNING,
} from "../src/lib/intake.ts";
import { en } from "../src/lib/i18n/dictionaries/en.ts";
import { hi } from "../src/lib/i18n/dictionaries/hi.ts";
import { mr } from "../src/lib/i18n/dictionaries/mr.ts";

test("TEST-14-I01: Mobility toggle updates intake form state and delivery mode", () => {
  // 1. Mobile machine (isImmobile = false) respects requested delivery mode
  assert.equal(
    resolveEffectiveDeliveryMode(false, "DOORSTEP"),
    "DOORSTEP",
    "Mobile machinery can choose DOORSTEP service",
  );
  assert.equal(
    resolveEffectiveDeliveryMode(false, "WORKSHOP_DROPOFF"),
    "WORKSHOP_DROPOFF",
    "Mobile machinery can choose WORKSHOP_DROPOFF service",
  );
  assert.equal(
    resolveEffectiveDeliveryMode(false, null),
    "DOORSTEP",
    "Default delivery mode is DOORSTEP when unspecified",
  );

  // 2. Intake validation succeeds for valid doorstep submission
  const validDoorstep = validateIntakeSubmission({
    isImmobile: false,
    deliveryMode: "DOORSTEP",
  });
  assert.equal(validDoorstep.valid, true);
  assert.equal(validDoorstep.effectiveMode, "DOORSTEP");

  // 3. Intake validation succeeds for valid drop-off submission with facility
  const validDropOff = validateIntakeSubmission({
    isImmobile: false,
    deliveryMode: "WORKSHOP_DROPOFF",
    facilityId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  });
  assert.equal(validDropOff.valid, true);
  assert.equal(validDropOff.effectiveMode, "WORKSHOP_DROPOFF");
});

test("TEST-14-I02: is_immobile = true locks mode to DOORSTEP and disables WORKSHOP_DROPOFF", () => {
  // 1. Immobile machinery strictly forces DOORSTEP even if WORKSHOP_DROPOFF was requested
  assert.equal(
    resolveEffectiveDeliveryMode(true, "WORKSHOP_DROPOFF"),
    "DOORSTEP",
    "Immobile machinery must force delivery mode to DOORSTEP",
  );
  assert.equal(
    resolveEffectiveDeliveryMode(true, "DOORSTEP"),
    "DOORSTEP",
    "Immobile machinery remains DOORSTEP",
  );

  // 2. Submission attempting WORKSHOP_DROPOFF for immobile machine is rejected with invariant error
  const invalidImmobileDropOff = validateIntakeSubmission({
    isImmobile: true,
    deliveryMode: "WORKSHOP_DROPOFF",
    facilityId: "facility-001",
  });
  assert.equal(invalidImmobileDropOff.valid, false);
  assert.equal(invalidImmobileDropOff.effectiveMode, "DOORSTEP");
  assert.equal(invalidImmobileDropOff.error, IMMOBILE_LOCK_WARNING);

  // 3. Verify database CHECK constraint in Phase 14 forward migration
  const migrationPath = path.resolve(
    process.cwd(),
    "supabase/migrations/20261108100000_phase14_smart_dispatch_and_dropoff.sql",
  );
  const migrationSql = fs.readFileSync(migrationPath, "utf8");
  assert.ok(
    migrationSql.includes("check_immobile_delivery_mode"),
    "Migration must define check_immobile_delivery_mode constraint",
  );
  assert.ok(
    migrationSql.includes("NOT (is_immobile = TRUE AND delivery_mode = 'WORKSHOP_DROPOFF')"),
    "Constraint must reject is_immobile = TRUE with WORKSHOP_DROPOFF",
  );
});

test("TEST-14-I03: Advisory warning renders against towing immobile equipment", () => {
  // 1. Exact approved warning string constant
  assert.equal(
    IMMOBILE_LOCK_WARNING,
    "Immobile machinery cannot be transported. Service is locked to Doorstep / On-Field.",
  );

  // 2. Trilingual dictionaries declare the approved warning
  assert.equal(
    en.breakdown.immobileWarning,
    "Immobile machinery cannot be transported. Service is locked to Doorstep / On-Field.",
  );
  assert.ok(
    hi.breakdown.immobileWarning.length > 0,
    "Hindi dictionary must contain immobile warning",
  );
  assert.ok(
    mr.breakdown.immobileWarning.length > 0,
    "Marathi dictionary must contain immobile warning",
  );

  // 3. UI component renders warning advisory with AlertTriangle and guidance against towing
  const intakeRoutePath = path.resolve(process.cwd(), "src/routes/farmer/report-breakdown.tsx");
  const routeContent = fs.readFileSync(intakeRoutePath, "utf8");
  assert.ok(
    routeContent.includes('t("breakdown.immobileWarning")'),
    "Intake UI must render translated immobile warning",
  );
  assert.ok(
    routeContent.includes("Do not attempt hazardous road towing"),
    "Intake UI must explicitly advise against hazardous towing",
  );
  assert.ok(
    routeContent.includes("AlertTriangle"),
    "Intake UI must display AlertTriangle icon for safety warning",
  );
});

test("TEST-14-I04: Workshop drop-off selector lists only approved active facilities", () => {
  // 1. Unapproved facilities are not selectable
  assert.equal(
    isWorkshopEligible({
      drop_off_approved: false,
      is_active: true,
    }),
    false,
    "Unapproved facility (drop_off_approved = false) cannot be selected",
  );

  // 2. Inactive facilities are not selectable even if drop-off approved
  assert.equal(
    isWorkshopEligible({
      drop_off_approved: true,
      is_active: false,
    }),
    false,
    "Inactive facility cannot be selected",
  );

  // 3. Both unapproved and inactive is rejected
  assert.equal(
    isWorkshopEligible({
      drop_off_approved: false,
      is_active: false,
    }),
    false,
    "Facility both inactive and unapproved cannot be selected",
  );

  // 4. Active, approved facility is eligible
  assert.equal(
    isWorkshopEligible({
      drop_off_approved: true,
      is_active: true,
    }),
    true,
    "Active, approved facility must be eligible for drop-off selection",
  );

  // 5. Backward compatibility alias isWorkshopSelectable works identically
  assert.equal(
    isWorkshopSelectable({
      drop_off_approved: true,
      is_active: true,
    }),
    true,
    "Alias isWorkshopSelectable must produce identical result",
  );

  // 6. Inspect facilities service to verify zero fabricated/hardcoded workshops and query filter
  const facilitiesServicePath = path.resolve(process.cwd(), "src/lib/services/facilities.ts");
  const facilitiesCode = fs.readFileSync(facilitiesServicePath, "utf8");
  assert.ok(
    facilitiesCode.includes('.eq("drop_off_approved", true)'),
    "Facilities query must filter drop_off_approved = true",
  );
  assert.ok(
    facilitiesCode.includes('.eq("is_active", true)'),
    "Facilities query must filter is_active = true",
  );
  assert.ok(
    !facilitiesCode.includes("get_facility_capacity_breakdown"),
    "M3 facilities service must NOT call get_facility_capacity_breakdown",
  );
});

test("TEST-14-I05: Intake state transitions & fresh selection requirement", () => {
  // 1. When machinery is mobile, omitting delivery mode fails validation
  const missingMode = validateIntakeSubmission({
    isImmobile: false,
    deliveryMode: undefined,
  });
  assert.equal(missingMode.valid, false);
  assert.match(missingMode.error, /Please select a delivery mode/i);

  // 2. In report-breakdown.tsx, toggling from immobile to mobile resets deliveryMode and facilityId
  const intakeRoutePath = path.resolve(process.cwd(), "src/routes/farmer/report-breakdown.tsx");
  const routeContent = fs.readFileSync(intakeRoutePath, "utf8");
  assert.ok(
    routeContent.includes('up({ isImmobile: false, deliveryMode: undefined, facilityId: "" })'),
    "Toggling to mobile must reset deliveryMode to undefined and facilityId to empty",
  );

  // 3. canNext for step 3 requires deliveryMode when machine is mobile
  assert.match(
    routeContent,
    /d\.isImmobile\s*\?\s*true\s*:\s*d\.deliveryMode === ["']WORKSHOP_DROPOFF["']/,
    "canNext must enforce explicit deliveryMode choice when machine is mobile",
  );
});

test("TEST-14-I06: 100% dictionary key parity across English, Hindi, and Marathi for Phase 14 strings", () => {
  const phase14Keys = [
    "immobileQuestion",
    "immobileWarning",
    "deliveryModeDoorstep",
    "deliveryModeDropOff",
    "selectWorkshop",
    "machineMobility",
    "deliveryModeTitle",
    "noApprovedWorkshops",
    "validationWorkshop",
    "validationDeliveryMode",
  ];

  const devanagariRegex = /[\u0900-\u097F]/;

  for (const key of phase14Keys) {
    // English
    assert.ok(
      typeof en.breakdown[key] === "string" && en.breakdown[key].trim().length > 0,
      `English dictionary must declare non-empty breakdown.${key}`,
    );

    // Hindi
    assert.ok(
      typeof hi.breakdown[key] === "string" && hi.breakdown[key].trim().length > 0,
      `Hindi dictionary must declare non-empty breakdown.${key}`,
    );
    assert.match(
      hi.breakdown[key],
      devanagariRegex,
      `Hindi breakdown.${key} must contain valid Devanagari script`,
    );

    // Marathi
    assert.ok(
      typeof mr.breakdown[key] === "string" && mr.breakdown[key].trim().length > 0,
      `Marathi dictionary must declare non-empty breakdown.${key}`,
    );
    assert.match(
      mr.breakdown[key],
      devanagariRegex,
      `Marathi breakdown.${key} must contain valid Devanagari script`,
    );

    // Ordinary enumerability (no Object.defineProperties workaround)
    assert.equal(
      Object.prototype.propertyIsEnumerable.call(en.breakdown, key),
      true,
      `breakdown.${key} must be an ordinary enumerable property in English`,
    );
    assert.equal(
      Object.prototype.propertyIsEnumerable.call(hi.breakdown, key),
      true,
      `breakdown.${key} must be an ordinary enumerable property in Hindi`,
    );
    assert.equal(
      Object.prototype.propertyIsEnumerable.call(mr.breakdown, key),
      true,
      `breakdown.${key} must be an ordinary enumerable property in Marathi`,
    );
  }
});

test("TEST-14-I07: Trusted server-side validation against 6 forged submission scenarios", () => {
  // Scenario 1: is_immobile = true with WORKSHOP_DROPOFF is rejected
  const scenario1 = validateIntakeSubmission({
    isImmobile: true,
    deliveryMode: "WORKSHOP_DROPOFF",
    facilityId: "facility-123",
  });
  assert.equal(scenario1.valid, false);
  assert.equal(scenario1.error, IMMOBILE_LOCK_WARNING);

  // Scenario 2: DOORSTEP with non-null facility_id is rejected
  const scenario2 = validateIntakeSubmission({
    isImmobile: false,
    deliveryMode: "DOORSTEP",
    facilityId: "facility-123",
  });
  assert.equal(scenario2.valid, false);
  assert.match(
    scenario2.error,
    /Facility reference cannot be provided when delivery mode is DOORSTEP/i,
  );

  // Scenario 3: WORKSHOP_DROPOFF with null facility_id is rejected
  const scenario3 = validateIntakeSubmission({
    isImmobile: false,
    deliveryMode: "WORKSHOP_DROPOFF",
    facilityId: null,
  });
  assert.equal(scenario3.valid, false);
  assert.match(scenario3.error, /Please select an approved workshop/i);

  // Scenario 4: WORKSHOP_DROPOFF with inactive facility is rejected by eligibility check
  assert.equal(
    isWorkshopEligible({ drop_off_approved: true, is_active: false }),
    false,
    "Scenario 4: Inactive facility is not eligible",
  );

  // Scenario 5: WORKSHOP_DROPOFF with unapproved facility is rejected by eligibility check
  assert.equal(
    isWorkshopEligible({ drop_off_approved: false, is_active: true }),
    false,
    "Scenario 5: Unapproved facility is not eligible",
  );

  // Verify repair-requests service enforcement for Scenarios 1-5
  const repairReqPath = path.resolve(process.cwd(), "src/lib/services/repair-requests.ts");
  const repairReqCode = fs.readFileSync(repairReqPath, "utf8");

  assert.ok(
    repairReqCode.includes('isImmobile && deliveryMode === "WORKSHOP_DROPOFF"'),
    "Service must enforce isImmobile cannot choose WORKSHOP_DROPOFF",
  );
  assert.ok(
    repairReqCode.includes('deliveryMode === "DOORSTEP" && input.facility_id'),
    "Service must reject facility_id provided with DOORSTEP",
  );
  assert.match(
    repairReqCode,
    /deliveryMode === ["']WORKSHOP_DROPOFF["'][\s\S]*?!input\.facility_id\?\.trim\(\)/,
    "Service must reject missing facility_id for WORKSHOP_DROPOFF",
  );
  assert.ok(
    repairReqCode.includes("!targetFacility.is_active"),
    "Service must verify targetFacility.is_active",
  );
  assert.ok(
    repairReqCode.includes("!targetFacility.drop_off_approved"),
    "Service must verify targetFacility.drop_off_approved",
  );
  assert.ok(
    !repairReqCode.includes("reserve_workshop_bay"),
    "M3 service must NOT call reserve_workshop_bay",
  );

  // Scenario 6: Equipment ownership & RLS protection against unauthorized submission/modification
  assert.ok(
    repairReqCode.includes('equipment.farmer_id !== profile.id && profile.role !== "admin"'),
    "Service must verify equipment ownership against authenticated profile before ticket creation",
  );
  assert.ok(
    repairReqCode.includes('repair.farmer_id !== profile.id && profile.role !== "admin"'),
    "Service must verify repair ownership against authenticated profile before cancellation/modification",
  );
});
