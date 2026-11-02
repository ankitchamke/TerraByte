import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  formatCoarseLocation,
  getNagpurTahsilCentroid,
  normalizeNagpurTahsil,
  NAGPUR_TAHSILS,
} from "../src/lib/location.ts";
import { sanitizeDoorstepTextField } from "../src/lib/services/doorstep-service.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

// ==============================================================================
// 1. FARMER BREAKDOWN WIZARD SOURCE AST VERIFICATION
// ==============================================================================

test("Farmer breakdown wizard starts with empty locality and never auto-populates Katol or profile village", () => {
  const wizardPath = path.join(ROOT_DIR, "src", "routes", "farmer", "report-breakdown.tsx");
  const content = fs.readFileSync(wizardPath, "utf8");

  // Initial draft state must start with empty strings
  assert.match(
    content,
    /village:\s*"",/,
    "Initial draft state must set village to empty string",
  );
  assert.match(
    content,
    /tahsil:\s*"",/,
    "Initial draft state must set tahsil to empty string",
  );

  // Must NOT have any useEffect automatically prefilling village from farmer profile
  assert.doesNotMatch(
    content,
    /profile\?\.village[\s\S]*?setD\(/,
    "Must NOT have any useEffect prefilling village from farmer profile",
  );
  assert.doesNotMatch(
    content,
    /village:\s*prev\.village\s*\|\|\s*profile\.village/,
    "Must NOT prefill village from profile into draft",
  );

  // 'Start over' reset handler must reset village to empty string, NOT profile village
  assert.match(
    content,
    /onClick=\{\(\)\s*=>\s*\{[\s\S]*?village:\s*"",[\s\S]*?clearGps\(\);/,
    "Start over action must reset village to empty string",
  );

  // Submission payload must fall back to 'On-site / Field' without assuming profile village
  assert.match(
    content,
    /location:\s*formatCoarseLocation\(d\.village,\s*d\.tahsil\)\s*\|\|\s*"On-site \/ Field",/,
    "Submission payload must use formatCoarseLocation or On-site / Field fallback without profile village substitution",
  );

  // Verify UI label and neutral placeholder
  assert.match(
    content,
    /<Label>Village \/ Locality<\/Label>/,
    "Renders Village / Locality label",
  );
  assert.match(
    content,
    /placeholder="e\.g\. Dorli, Mohpa"/,
    "Uses neutral Nagpur village placeholder Dorli, Mohpa",
  );

  // Tahsil dropdown unselected placeholder
  assert.match(
    content,
    /<option value="">Select Tahsil\.\.\.<\/option>/,
    "Tahsil dropdown starts with unselected placeholder",
  );
});

// ==============================================================================
// 2. FORMAT COARSE LOCATION & UNKNOWN FALLBACK
// ==============================================================================

test("formatCoarseLocation returns empty string when village and tahsil are blank (no assumed Katol)", () => {
  assert.equal(formatCoarseLocation("", ""), "");
  assert.equal(formatCoarseLocation(null, null), "");
  assert.equal(formatCoarseLocation(undefined, undefined), "");
  assert.equal(formatCoarseLocation("   ", "   "), "");
});

test("formatCoarseLocation correctly combines entered village and tahsil", () => {
  assert.equal(formatCoarseLocation("Dorli", "Kalmeshwar"), "Dorli, Kalmeshwar");
  assert.equal(formatCoarseLocation("Dorli", ""), "Dorli");
  assert.equal(formatCoarseLocation("", "Kalmeshwar"), "Kalmeshwar");
  assert.equal(formatCoarseLocation("Mohpa", null), "Mohpa");
});

test("formatCoarseLocation does not alter explicitly entered Katol locations", () => {
  assert.equal(formatCoarseLocation("Katol", "Katol"), "Katol, Katol");
  assert.equal(formatCoarseLocation("Dorli", "Katol"), "Dorli, Katol");
});

// ==============================================================================
// 3. CENTROID & ROUTING INTEGRITY (NO SILENT FABRICATION)
// ==============================================================================

test("Unknown-location fallback 'On-site / Field' strictly returns null centroid and never defaults to Katol or Nagpur", () => {
  const centroid = getNagpurTahsilCentroid("On-site / Field");
  assert.equal(centroid, null, "On-site / Field must NOT map to any tahsil centroid");

  const normalized = normalizeNagpurTahsil("On-site / Field");
  assert.equal(normalized, null, "On-site / Field must NOT normalize to any tahsil");
});

test("Legitimate Katol tahsil centroid calculation remains completely intact", () => {
  const centroid = getNagpurTahsilCentroid("Katol");
  assert.notEqual(centroid, null, "Legitimate Katol must resolve to its centroid");
  assert.equal(centroid.latitude, 21.2682);
  assert.equal(centroid.longitude, 78.5833);

  const normalized = normalizeNagpurTahsil("Katol, Nagpur");
  assert.equal(normalized, "Katol");
});

test("Empty, whitespace, and non-Nagpur strings never fabricate a centroid", () => {
  assert.equal(getNagpurTahsilCentroid(""), null);
  assert.equal(getNagpurTahsilCentroid("   "), null);
  assert.equal(getNagpurTahsilCentroid(null), null);
  assert.equal(getNagpurTahsilCentroid(undefined), null);
  assert.equal(getNagpurTahsilCentroid("Mumbai"), null);
  assert.equal(getNagpurTahsilCentroid("Pune"), null);
});

// ==============================================================================
// 4. PROFILE LOCATION PRESERVATION (DO NOT OVERWRITE WITH EMPTY)
// ==============================================================================

test("Profile service AST verifies existing saved village is preserved when empty or omitted", () => {
  const profileServicePath = path.join(ROOT_DIR, "src", "lib", "services", "profile.ts");
  const content = fs.readFileSync(profileServicePath, "utf8");

  // Verify updateProfile checks existing profile before clearing village
  assert.match(
    content,
    /Do not overwrite an existing saved farmer profile location with an empty value/,
    "updateProfile must document safeguarding existing saved profile location",
  );
  assert.match(
    content,
    /if\s*\(!existingProfile\?\.village\)\s*\{\s*\r?\n\s*updateData\.village\s*=\s*null;/,
    "updateProfile only sets village to null if user had no existing saved village",
  );
});

// ==============================================================================
// 5. REGISTRATION VALIDATION (LOCALITY REQUIRED WITH VALIDATION)
// ==============================================================================

test("Farmer registration validates village/area requirement and stops empty submission", () => {
  const regPath = path.join(ROOT_DIR, "src", "routes", "register", "farmer.tsx");
  const content = fs.readFileSync(regPath, "utf8");

  // Verify state starts empty
  assert.match(
    content,
    /useState\(\{\s*name:\s*"",\s*village:\s*"",/,
    "Registration form starts with empty village field",
  );

  // Verify validation guard on submit
  assert.match(
    content,
    /const\s+trimmedVillage\s*=\s*f\.village\.trim\(\);/,
    "Trims village in registration submit",
  );
  assert.match(
    content,
    /if\s*\(!trimmedVillage\)\s*\{\s*\r?\n\s*setErr\("Village or area is required\."\);/,
    "Shows explicit validation error when village is missing or whitespace",
  );
  assert.match(
    content,
    /<Field\s+label="Village \/ area"\s+required/,
    "Renders Village / area Field with required attribute",
  );
});

// ==============================================================================
// 6. MULTILINGUAL & LOCALIZATION PRESERVATION (HINDI & MARATHI)
// ==============================================================================

test("Devanagari script for Hindi and Marathi village names is preserved without alteration", () => {
  // Marathi and Hindi village names in Nagpur district
  const marathiVillage = "सावनेर";
  const hindiVillage = "काटोल";
  const mixedLocation = "मौदा, नागपूर";
  const complexLandmark = "ग्रामपंचायत पाण्याच्या टाकीजवळ, प्लॉट नं. १४";

  assert.equal(
    sanitizeDoorstepTextField(marathiVillage),
    "सावनेर",
    "Preserves Marathi Devanagari text",
  );
  assert.equal(
    sanitizeDoorstepTextField(hindiVillage),
    "काटोल",
    "Preserves Hindi Devanagari text",
  );
  assert.equal(
    sanitizeDoorstepTextField(mixedLocation),
    "मौदा, नागपूर",
    "Preserves Devanagari village and district",
  );
  assert.equal(
    sanitizeDoorstepTextField(complexLandmark),
    "ग्रामपंचायत पाण्याच्या टाकीजवळ, प्लॉट नं. १४",
    "Preserves Devanagari landmark instructions",
  );

  // formatCoarseLocation with Devanagari village and English Tahsil
  assert.equal(
    formatCoarseLocation("सावनेर", "Saoner"),
    "सावनेर, Saoner",
    "Formats Devanagari village with Tahsil",
  );
  assert.equal(
    formatCoarseLocation("काटोल", ""),
    "काटोल",
    "Preserves Devanagari village when tahsil is blank",
  );
});

// ==============================================================================
// 7. GPS CAPTURE INDEPENDENCE
// ==============================================================================

test("GPS capture is independent of village/locality input in farmer breakdown wizard", () => {
  const wizardPath = path.join(ROOT_DIR, "src", "routes", "farmer", "report-breakdown.tsx");
  const content = fs.readFileSync(wizardPath, "utf8");

  // GPS is stored in independent in-memory state
  assert.match(
    content,
    /const\s*\[gps,\s*setGps\]\s*=\s*useState<CapturedGps\s*\|\s*null>\(null\);/,
    "GPS is tracked in dedicated independent state",
  );

  // GPS capture button is independent of village/tahsil inputs
  assert.match(
    content,
    /Use my current location \(GPS\)/,
    "Provides independent GPS capture button",
  );

  // Submission payload attaches gpsLocation if captured, regardless of whether d.village is populated
  assert.match(
    content,
    /\.\.\.\(gps\s*\?\s*\{\s*\r?\n\s*gpsLocation:\s*\{/,
    "Passes gpsLocation independently whenever GPS was captured",
  );
});
