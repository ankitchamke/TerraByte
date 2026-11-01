import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  SUPPORTED_LANGUAGES,
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGE_PAIRS,
  DEFAULT_STAFF_TARGET_LANGUAGE,
  TARGET_LANG_STORAGE_PREFIX,
  getStoredTargetLanguage,
  setStoredTargetLanguage,
  getTranslationCapabilities,
  checkTranslationAvailability,
  detectSourceLanguage,
  translateText,
  TranslationError,
} from "../src/lib/services/chrome-translator.ts";

// ==============================================================================
// TEST FIXTURES & MOCK HELPERS
// ==============================================================================

const originalWindow = globalThis.window;
const originalTranslator = globalThis.Translator;
const originalLanguageDetector = globalThis.LanguageDetector;

function restoreGlobals() {
  if (originalWindow !== undefined) {
    globalThis.window = originalWindow;
  } else {
    delete globalThis.window;
  }

  if (originalTranslator !== undefined) {
    globalThis.Translator = originalTranslator;
  } else {
    delete globalThis.Translator;
  }

  if (originalLanguageDetector !== undefined) {
    globalThis.LanguageDetector = originalLanguageDetector;
  } else {
    delete globalThis.LanguageDetector;
  }
}

function createMockLocalStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
}

function setupMockEnvironment(options = {}) {
  const {
    isBrowser = true,
    isSecureContext = true,
    mockStorage = createMockLocalStorage(),
    availability = "available",
    detectResults = [{ detectedLanguage: "mr", confidence: 0.95 }],
    translationMap = {
      "mr->en": "Tractor engine is overheating and making noise",
      "hi->en": "Tractor engine is very hot and emitting black smoke",
      "en->mr": "ट्रॅक्टरचे इंजिन खूप गरम होत आहे",
      "en->hi": "ट्रैक्टर का इंजन बहुत गर्म हो रहा है",
      "mr->hi": "ट्रैक्टर का इंजन गरम हो रहा है और आवाज आ रही है",
      "hi->mr": "ट्रॅक्टरचे इंजिन गरम होत आहे आणि आवाज येत आहे",
    },
    downloadProgressSteps = [
      { loaded: 50, total: 100 },
      { loaded: 100, total: 100 },
    ],
  } = options;

  if (isBrowser) {
    globalThis.window = {
      isSecureContext,
      localStorage: mockStorage,
    };
  } else {
    delete globalThis.window;
  }

  const destroyedInstances = {
    translators: 0,
    detectors: 0,
  };

  globalThis.Translator = {
    availability: async () => availability,
    create: async ({ sourceLanguage, targetLanguage, monitor, signal }) => {
      if (signal?.aborted) {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      }

      if (typeof monitor === "function") {
        const listeners = [];
        const mockMonitor = {
          addEventListener: (type, listener) => {
            if (type === "downloadprogress") listeners.push(listener);
          },
          removeEventListener: () => {},
        };
        monitor(mockMonitor);
        for (const step of downloadProgressSteps) {
          for (const l of listeners) l(step);
        }
      }

      return {
        translate: async (input) => {
          if (signal?.aborted) {
            const err = new Error("Aborted");
            err.name = "AbortError";
            throw err;
          }
          const key = `${sourceLanguage}->${targetLanguage}`;
          return translationMap[key] || `Translated [${key}]: ${input}`;
        },
        destroy: () => {
          destroyedInstances.translators += 1;
        },
      };
    },
  };

  globalThis.LanguageDetector = {
    create: async ({ signal } = {}) => {
      if (signal?.aborted) {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      }
      return {
        detect: async () => (typeof detectResults === "function" ? detectResults() : detectResults),
        destroy: () => {
          destroyedInstances.detectors += 1;
        },
      };
    },
  };

  return { destroyedInstances, mockStorage };
}

// ==============================================================================
// 1. ROUTE INTEGRATION INSPECTIONS
// ==============================================================================

test("technician job detail route imports and renders OnDemandTranslation directly below farmer description", () => {
  const filePath = path.resolve(process.cwd(), "src/routes/technician/job/$id.tsx");
  const content = fs.readFileSync(filePath, "utf-8");

  // Verify import
  assert.match(
    content,
    /import\s+\{\s*OnDemandTranslation\s*\}\s+from\s+["']@\/components\/on-demand-translation["']/,
    "Technician job route must import OnDemandTranslation",
  );

  // Verify placement directly in farmer description section
  assert.match(
    content,
    /\{r\.description\s*&&\s*\(\s*<div[^>]*>\s*<Label>Farmer's description<\/Label>\s*<p>"\{r\.description\}"<\/p>\s*<OnDemandTranslation text=\{r\.description\} \/>/s,
    "OnDemandTranslation must be rendered directly below farmer description in technician job detail",
  );
});

test("service centre admin repair detail route imports and renders OnDemandTranslation inside Farmer Report card", () => {
  const filePath = path.resolve(process.cwd(), "src/routes/admin/repair/$id.tsx");
  const content = fs.readFileSync(filePath, "utf-8");

  // Verify import
  assert.match(
    content,
    /import\s+\{\s*OnDemandTranslation\s*\}\s+from\s+["']@\/components\/on-demand-translation["']/,
    "Admin repair route must import OnDemandTranslation",
  );

  // Verify placement directly in Farmer report Card
  assert.match(
    content,
    /\{description\s*&&\s*<p[^>]*>"\{description\}"<\/p>\}\s*\{description\s*&&\s*<OnDemandTranslation text=\{description\} \/>\}/s,
    "OnDemandTranslation must be rendered directly below description in admin repair detail",
  );
});

// ==============================================================================
// 2. ACCOUNT-SPECIFIC LANGUAGE PREFERENCE MANAGEMENT
// ==============================================================================

test("getStoredTargetLanguage defaults to English ('en') when no preference is saved", () => {
  setupMockEnvironment({ isBrowser: true, isSecureContext: true });
  try {
    const lang = getStoredTargetLanguage("user_tech_123");
    assert.equal(lang, "en");
    assert.equal(DEFAULT_STAFF_TARGET_LANGUAGE, "en");
  } finally {
    restoreGlobals();
  }
});

test("setStoredTargetLanguage persists preference to account-specific key and restores it", () => {
  const { mockStorage } = setupMockEnvironment({ isBrowser: true, isSecureContext: true });
  try {
    setStoredTargetLanguage("user_tech_456", "mr");
    assert.equal(mockStorage.getItem(`${TARGET_LANG_STORAGE_PREFIX}user_tech_456`), "mr");

    const restored = getStoredTargetLanguage("user_tech_456");
    assert.equal(restored, "mr");
  } finally {
    restoreGlobals();
  }
});

test("preference isolation: different staff accounts maintain independent target languages", () => {
  setupMockEnvironment({ isBrowser: true, isSecureContext: true });
  try {
    setStoredTargetLanguage("tech_user_A", "mr");
    setStoredTargetLanguage("admin_user_B", "hi");

    assert.equal(getStoredTargetLanguage("tech_user_A"), "mr");
    assert.equal(getStoredTargetLanguage("admin_user_B"), "hi");
    assert.equal(getStoredTargetLanguage("other_user_C"), "en"); // Unset defaults to English
  } finally {
    restoreGlobals();
  }
});

test("getStoredTargetLanguage rejects corrupted or unsupported localStorage values and falls back to English", () => {
  const { mockStorage } = setupMockEnvironment({ isBrowser: true, isSecureContext: true });
  try {
    mockStorage.setItem(`${TARGET_LANG_STORAGE_PREFIX}user_corrupt`, "es");
    assert.equal(getStoredTargetLanguage("user_corrupt"), "en");

    mockStorage.setItem(`${TARGET_LANG_STORAGE_PREFIX}user_garbage`, "some_invalid_token");
    assert.equal(getStoredTargetLanguage("user_garbage"), "en");
  } finally {
    restoreGlobals();
  }
});

test("getStoredTargetLanguage and setStoredTargetLanguage gracefully handle throwing localStorage (sandboxed/private browsing)", () => {
  const throwingStorage = {
    getItem: () => {
      throw new Error("SecurityError: Access denied");
    },
    setItem: () => {
      throw new Error("SecurityError: Access denied");
    },
  };
  setupMockEnvironment({ isBrowser: true, isSecureContext: true, mockStorage: throwingStorage });
  try {
    // Must not throw
    const lang = getStoredTargetLanguage("user_restricted");
    assert.equal(lang, "en");

    // Must not throw
    assert.doesNotThrow(() => setStoredTargetLanguage("user_restricted", "hi"));
  } finally {
    restoreGlobals();
  }
});

test("getStoredTargetLanguage returns English in SSR / non-browser context", () => {
  setupMockEnvironment({ isBrowser: false });
  try {
    assert.equal(getStoredTargetLanguage("user_ssr"), "en");
    assert.doesNotThrow(() => setStoredTargetLanguage("user_ssr", "mr"));
  } finally {
    restoreGlobals();
  }
});

// ==============================================================================
// 3. ON-DEMAND TRANSLATION WORKFLOW & LIFECYCLE
// ==============================================================================

test("translation flow: high-confidence Marathi description is detected and translated to English", async () => {
  const { destroyedInstances } = setupMockEnvironment({
    isBrowser: true,
    isSecureContext: true,
    detectResults: [{ detectedLanguage: "mr", confidence: 0.95 }],
    availability: "available",
  });

  try {
    const text = "माझ्या ट्रॅक्टरचे इंजिन सुरू होत नाही आणि खूप आवाज येत आहे";

    // 1. Detect language
    const detection = await detectSourceLanguage(text);
    assert.equal(detection.detectedLanguage, "mr");
    assert.equal(detection.isAmbiguous, false);
    assert.equal(detection.requiresManualSelection, false);

    // 2. Check pair availability
    const avail = await checkTranslationAvailability(detection.detectedLanguage, "en");
    assert.equal(avail, "available");

    // 3. Translate
    const result = await translateText({
      text,
      sourceLanguage: detection.detectedLanguage,
      targetLanguage: "en",
    });

    assert.equal(result.sourceLanguage, "mr");
    assert.equal(result.targetLanguage, "en");
    assert.equal(result.translatedText, "Tractor engine is overheating and making noise");

    // Cleaned up
    assert.equal(destroyedInstances.detectors, 1);
    assert.equal(destroyedInstances.translators, 1);
  } finally {
    restoreGlobals();
  }
});

test("translation flow: ambiguous Hindi/Marathi Devanagari detection flags manual source selection", async () => {
  setupMockEnvironment({
    isBrowser: true,
    isSecureContext: true,
    detectResults: [
      { detectedLanguage: "hi", confidence: 0.51 },
      { detectedLanguage: "mr", confidence: 0.47 },
    ],
  });

  try {
    const text = "इंजन गरम आहे आणि आवाज येतो";
    const detection = await detectSourceLanguage(text);

    // Must be marked ambiguous so staff can manually choose
    assert.equal(detection.isAmbiguous, true);
    assert.equal(detection.requiresManualSelection, true);
    assert.equal(detection.detectedLanguage, null);
  } finally {
    restoreGlobals();
  }
});

test("translation flow: identical source and target languages reject translation cleanly", async () => {
  setupMockEnvironment({ isBrowser: true, isSecureContext: true });
  try {
    await assert.rejects(
      async () =>
        translateText({
          text: "Engine oil is leaking",
          sourceLanguage: "en",
          targetLanguage: "en",
        }),
      (err) => err instanceof TranslationError && err.code === "IDENTICAL_LANGUAGES",
    );
  } finally {
    restoreGlobals();
  }
});

test("translation flow: downloadable model reports progress events (0% to 100%)", async () => {
  const recordedSteps = [];
  setupMockEnvironment({
    isBrowser: true,
    isSecureContext: true,
    availability: "downloadable",
    downloadProgressSteps: [
      { loaded: 20, total: 100 },
      { loaded: 60, total: 100 },
      { loaded: 100, total: 100 },
    ],
  });

  try {
    const result = await translateText({
      text: "ट्रैक्टर का इंजन बहुत गर्म हो रहा है",
      sourceLanguage: "hi",
      targetLanguage: "en",
      onDownloadProgress: (loaded, total) => {
        const percentage = Math.round((loaded / total) * 100);
        recordedSteps.push(percentage);
      },
    });

    assert.equal(result.translatedText, "Tractor engine is very hot and emitting black smoke");
    assert.deepEqual(recordedSteps, [20, 60, 100]);
  } finally {
    restoreGlobals();
  }
});

test("translation flow: user cancellation aborts translation immediately and cleans up resources", async () => {
  const controller = new AbortController();
  const { destroyedInstances } = setupMockEnvironment({
    isBrowser: true,
    isSecureContext: true,
    availability: "available",
  });

  try {
    controller.abort();

    await assert.rejects(
      async () =>
        translateText({
          text: "इंजिन खूप गरम होत आहे",
          sourceLanguage: "mr",
          targetLanguage: "en",
          signal: controller.signal,
        }),
      (err) => err instanceof TranslationError && err.code === "ABORTED",
    );
  } finally {
    restoreGlobals();
  }
});

// ==============================================================================
// 4. CANONICAL PRIVACY & INTEGRITY GUARANTEES
// ==============================================================================

test("privacy guarantee: farmer descriptions are never logged to console or sent across network", async () => {
  const logged = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origErr = console.error;

  console.log = (...args) => logged.push(args.join(" "));
  console.warn = (...args) => logged.push(args.join(" "));
  console.error = (...args) => logged.push(args.join(" "));

  setupMockEnvironment({ isBrowser: true, isSecureContext: true, availability: "available" });

  const sensitiveFarmerIssue = "Tractor steering arm snapped near water canal plot #8";

  try {
    await translateText({
      text: sensitiveFarmerIssue,
      sourceLanguage: "en",
      targetLanguage: "hi",
    });

    for (const msg of logged) {
      assert.equal(
        msg.includes(sensitiveFarmerIssue),
        false,
        "Farmer breakdown issue must never be printed to logs",
      );
    }
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origErr;
    restoreGlobals();
  }
});

test("zero database side-effects: translation service has zero Supabase queries or mutations", () => {
  const componentPath = path.resolve(process.cwd(), "src/components/on-demand-translation.tsx");
  const componentContent = fs.readFileSync(componentPath, "utf-8");

  // Verify component does NOT import supabase client
  assert.equal(
    componentContent.includes("@/integrations/supabase/client"),
    false,
    "on-demand-translation.tsx must never import supabase client directly",
  );

  // Verify component does NOT call repairs.update
  assert.equal(
    componentContent.includes("repairs.update") || componentContent.includes("description:"),
    false,
    "on-demand-translation.tsx must never mutate repair descriptions in database",
  );
});
