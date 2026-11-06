import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { en } from "../src/lib/i18n/dictionaries/en.ts";
import { hi } from "../src/lib/i18n/dictionaries/hi.ts";
import { mr } from "../src/lib/i18n/dictionaries/mr.ts";
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY } from "../src/lib/i18n/types.ts";

function getAllKeys(obj, prefix = "") {
  let keys = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      keys = keys.concat(getAllKeys(value, fullPath));
    } else {
      keys.push(fullPath);
    }
  }
  return keys;
}

test("Phase 12 i18n — Language Options & Configuration", () => {
  assert.equal(DEFAULT_LANGUAGE, "en");
  assert.equal(LANGUAGE_STORAGE_KEY, "terrabyte_farmer_language");
  assert.equal(SUPPORTED_LANGUAGES.length, 3);

  const codes = SUPPORTED_LANGUAGES.map((l) => l.code);
  assert.deepEqual(codes, ["en", "hi", "mr"]);

  const enOpt = SUPPORTED_LANGUAGES.find((l) => l.code === "en");
  assert.equal(enOpt?.label, "English");

  const hiOpt = SUPPORTED_LANGUAGES.find((l) => l.code === "hi");
  assert.equal(hiOpt?.nativeLabel, "हिन्दी");

  const mrOpt = SUPPORTED_LANGUAGES.find((l) => l.code === "mr");
  assert.equal(mrOpt?.nativeLabel, "मराठी");
});

test("Phase 12 i18n — Complete Key Parity between English, Hindi, and Marathi", () => {
  const enKeys = getAllKeys(en).sort();
  const hiKeys = getAllKeys(hi).sort();
  const mrKeys = getAllKeys(mr).sort();

  assert.ok(enKeys.length > 50, `English dictionary should have comprehensive keys (found ${enKeys.length})`);

  // 1. Every English key must exist in Hindi
  const missingInHi = enKeys.filter((k) => !hiKeys.includes(k));
  assert.deepEqual(missingInHi, [], `Missing keys in Hindi dictionary: ${missingInHi.join(", ")}`);

  // 2. Every English key must exist in Marathi
  const missingInMr = enKeys.filter((k) => !mrKeys.includes(k));
  assert.deepEqual(missingInMr, [], `Missing keys in Marathi dictionary: ${missingInMr.join(", ")}`);

  // 3. No extra dangling keys in Hindi or Marathi
  const extraInHi = hiKeys.filter((k) => !enKeys.includes(k));
  assert.deepEqual(extraInHi, [], `Extra unexpected keys in Hindi: ${extraInHi.join(", ")}`);

  const extraInMr = mrKeys.filter((k) => !enKeys.includes(k));
  assert.deepEqual(extraInMr, [], `Extra unexpected keys in Marathi: ${extraInMr.join(", ")}`);
});

test("Phase 12 i18n — Non-Empty Translations and Devanagari Script Presence", () => {
  const devanagariRegex = /[\u0900-\u097F]/;

  // Check Hindi dictionary
  const hiKeys = getAllKeys(hi);
  for (const key of hiKeys) {
    const parts = key.split(".");
    let val = hi;
    for (const p of parts) {
      val = val[p];
    }
    assert.equal(typeof val, "string", `Hindi key ${key} must resolve to string`);
    assert.ok(val.trim().length > 0, `Hindi key ${key} must not be empty`);
  }

  // Check Marathi dictionary
  const mrKeys = getAllKeys(mr);
  for (const key of mrKeys) {
    const parts = key.split(".");
    let val = mr;
    for (const p of parts) {
      val = val[p];
    }
    assert.equal(typeof val, "string", `Marathi key ${key} must resolve to string`);
    assert.ok(val.trim().length > 0, `Marathi key ${key} must not be empty`);
  }

  // Assert Devanagari script is present in regional greetings
  assert.match(hi.dashboard.greeting, devanagariRegex, "Hindi greeting must contain Devanagari script");
  assert.match(mr.dashboard.greeting, devanagariRegex, "Marathi greeting must contain Devanagari script");
});

test("Phase 12 i18n — Typography Configuration (Noto Sans Devanagari)", () => {
  const stylesPath = path.resolve(process.cwd(), "src/styles.css");
  const stylesContent = fs.readFileSync(stylesPath, "utf8");
  assert.match(
    stylesContent,
    /Noto Sans Devanagari/i,
    "src/styles.css must include Noto Sans Devanagari in font stack"
  );

  const rootRoutePath = path.resolve(process.cwd(), "src/routes/__root.tsx");
  const rootContent = fs.readFileSync(rootRoutePath, "utf8");
  assert.match(
    rootContent,
    /Noto\+Sans\+Devanagari/i,
    "src/routes/__root.tsx must include Google Fonts link for Noto Sans Devanagari"
  );
});

test("Phase 12 i18n — Canonical Spoken Voice Preservation Invariant", () => {
  const servicePath = path.resolve(process.cwd(), "src/lib/services/transcription-service.ts");
  const content = fs.readFileSync(servicePath, "utf8");

  // Invariant: language parameter must be omitted so Groq Whisper automatically detects language
  assert.match(
    content,
    /OMIT the ["']language["'] parameter/i,
    "Transcription service must deliberately omit language parameter for multi-language detection"
  );
  assert.doesNotMatch(
    content,
    /groqFormData\.append\(["']language["']/i,
    "Transcription service must not hardcode a single language parameter"
  );
});

test("Phase 12 i18n — Zero Cost & Free-Tier Invariant", () => {
  const envExamplePath = path.resolve(process.cwd(), ".env.example");
  const envContent = fs.readFileSync(envExamplePath, "utf8");

  // Invariant: zero paid translation services
  assert.doesNotMatch(envContent, /DEEPL_API_KEY/i, "No paid DeepL translation API keys allowed");
  assert.doesNotMatch(envContent, /GOOGLE_TRANSLATE_API_KEY/i, "No paid Google Translate API keys allowed");
  assert.doesNotMatch(envContent, /AZURE_TRANSLATOR/i, "No paid Azure Translator API keys allowed");
});

test("Phase 12 i18n — Farmer Language Selector Single Header Placement", () => {
  const shellPath = path.resolve(process.cwd(), "src/components/tb.tsx");
  const shellContent = fs.readFileSync(shellPath, "utf8");
  assert.match(
    shellContent,
    /role === ["']farmer["'] && <FarmerLanguageSelector/i,
    "Top navigation header in Shell must render FarmerLanguageSelector for farmer role"
  );

  const dashboardPath = path.resolve(process.cwd(), "src/routes/farmer/index.tsx");
  const dashboardContent = fs.readFileSync(dashboardPath, "utf8");
  assert.doesNotMatch(
    dashboardContent,
    /<FarmerLanguageSelector/i,
    "Dashboard body must not render duplicate FarmerLanguageSelector"
  );
  assert.doesNotMatch(
    dashboardContent,
    /import\s+.*FarmerLanguageSelector.*from/i,
    "Dashboard must not import unused FarmerLanguageSelector"
  );
});

test("Phase 12 i18n — Language Selector Compact UI (No Globe, Displays EN / हिं / म, Accessible Names)", () => {
  const selectorPath = path.resolve(process.cwd(), "src/components/farmer-language-selector.tsx");
  const selectorContent = fs.readFileSync(selectorPath, "utf8");

  // Invariant 1: Globe icon must be completely absent
  assert.doesNotMatch(
    selectorContent,
    /Globe/i,
    "Lucide Globe icon must be removed entirely from language selector"
  );

  // Invariant 2: Selector must render EN, हिं, म labels
  assert.match(
    selectorContent,
    /en:\s*["']EN["']/,
    "Selector must map English to compact EN label"
  );
  assert.match(
    selectorContent,
    /hi:\s*["']हिं["']/,
    "Selector must map Hindi to compact हिं label"
  );
  assert.match(
    selectorContent,
    /mr:\s*["']म["']/,
    "Selector must map Marathi to compact म label"
  );

  // Invariant 3: Accessibility preserved with full language names
  assert.match(
    selectorContent,
    /aria-label=\{l\.label\}/i,
    "Selector buttons must provide accessible aria-label with full language name"
  );
  assert.match(
    selectorContent,
    /title=\{l\.label\}/i,
    "Selector buttons must provide tooltip title with full language name"
  );
});

test("Phase 12 — Reset Demo Access Control & Placement Invariant", () => {
  const shellPath = path.resolve(process.cwd(), "src/components/tb.tsx");
  const shellContent = fs.readFileSync(shellPath, "utf8");

  // Invariant 1: Reset demo is guarded by designated demo account check
  assert.match(
    shellContent,
    /isDesignatedDemoAccount\(email\)/,
    "Reset demo button in Shell must strictly require isDesignatedDemoAccount(email)"
  );
  assert.match(
    shellContent,
    /\{isDemo\s*&&\s*\(\s*<button[^>]*aria-label=["']Reset demo data["']/s,
    "Reset demo button must be conditionally rendered only when isDemo is true"
  );

  // Invariant 2: Reset confirmation dialog is also strictly guarded by isDemo
  assert.match(
    shellContent,
    /\{isDemo\s*&&\s*\(\s*<AlertDialog/s,
    "AlertDialog for reset must be conditionally rendered only when isDemo is true"
  );

  // Invariant 3: UI Placement in header right actions (after notifications, before sign-out)
  const headerRightIdx = shellContent.indexOf('className="ml-auto flex items-center gap-1"');
  assert.ok(headerRightIdx > -1, "Header right actions container must exist");
  const headerEndIdx = shellContent.indexOf("</header>", headerRightIdx);
  assert.ok(headerEndIdx > -1, "Header closing tag must exist");
  const headerSection = shellContent.slice(headerRightIdx, headerEndIdx);

  const notifIdx = headerSection.indexOf("ref={notifRef}");
  const resetBtnIdx = headerSection.indexOf('aria-label="Reset demo data"');
  const signOutIdx = headerSection.indexOf('aria-label="Sign out"');

  assert.ok(notifIdx > -1, "Notifications button must exist in header right actions");
  assert.ok(resetBtnIdx > -1, "Reset demo button must exist in header right actions");
  assert.ok(signOutIdx > -1, "Sign-out button must exist in header right actions");
  assert.ok(notifIdx < resetBtnIdx, "Reset demo must be positioned after notifications bell");
  assert.ok(resetBtnIdx < signOutIdx, "Reset demo must be positioned before sign-out button");
});

test("Phase 12 i18n — Name & Identity Non-Transliteration Invariant", () => {
  const dashboardPath = path.resolve(process.cwd(), "src/routes/farmer/index.tsx");
  const dashboardContent = fs.readFileSync(dashboardPath, "utf8");

  // Invariant: Farmer name, equipment make/model, technician name, and job ID are canonical and never wrapped in translation functions
  assert.match(
    dashboardContent,
    /\{farmerName\}/,
    "Farmer name must be rendered directly without translation"
  );
  assert.match(
    dashboardContent,
    /\{r\.equipment\?\.make\s*\|\|\s*["']Equipment["']\}\s*\{r\.equipment\?\.model\s*\|\|\s*["']["']\}/,
    "Equipment make and model must be rendered canonically without translation"
  );
  assert.match(
    dashboardContent,
    /\{r\.technician\?\.full_name\s*\?\?\s*t\(["']common\.notAssigned["']\)\}/,
    "Technician full name must be rendered canonically when assigned"
  );
  assert.match(
    dashboardContent,
    /\{r\.job_number\s*\|\|\s*r\.id\}/,
    "Job ID / Ticket number must remain canonical"
  );
});

test("Phase 12 i18n — Translatable System & Symptom Enums (e.g., Fuel supply)", () => {
  const devanagariRegex = /[\u0900-\u097F]/;

  // Verify "Fuel supply" and other system keys exist in all three dictionaries
  assert.equal(en.systems["Fuel supply"], "Fuel supply");
  assert.ok(hi.systems["Fuel supply"], "Hindi must have translation for Fuel supply");
  assert.ok(mr.systems["Fuel supply"], "Marathi must have translation for Fuel supply");

  assert.match(
    hi.systems["Fuel supply"],
    devanagariRegex,
    "Hindi Fuel supply must contain Devanagari script"
  );
  assert.match(
    mr.systems["Fuel supply"],
    devanagariRegex,
    "Marathi Fuel supply must contain Devanagari script"
  );

  // Verify farmer dashboard maps assessment.system through dictionary
  const dashboardPath = path.resolve(process.cwd(), "src/routes/farmer/index.tsx");
  const dashboardContent = fs.readFileSync(dashboardPath, "utf8");
  assert.match(
    dashboardContent,
    /t\(["`]systems\.\$\{assessment\.system\}["`],\s*assessment\.system\)/,
    "Farmer dashboard must look up assessment.system in the systems dictionary"
  );
});
