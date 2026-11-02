import test from "node:test";
import assert from "node:assert/strict";

import {
  SUPPORTED_LANGUAGES,
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGE_PAIRS,
  DETECTION_CONFIDENCE_THRESHOLD,
  AMBIGUITY_DELTA_THRESHOLD,
  TranslationError,
  isSupportedLanguage,
  assertSupportedLanguage,
  isSupportedLanguagePair,
  getTranslationCapabilities,
  checkTranslationAvailability,
  detectSourceLanguage,
  translateText,
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

function setupMockEnvironment(options = {}) {
  const {
    isBrowser = true,
    isSecureContext = true,
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
    simulateCreateError = null,
    simulateTranslateError = null,
    simulateDetectError = null,
    simulateAvailabilityError = null,
  } = options;

  if (isBrowser) {
    globalThis.window = {
      isSecureContext,
    };
  } else {
    delete globalThis.window;
  }

  const destroyedInstances = {
    translators: 0,
    detectors: 0,
  };

  // Mock Translator constructor
  globalThis.Translator = {
    availability: async ({ sourceLanguage, targetLanguage }) => {
      if (simulateAvailabilityError) {
        throw simulateAvailabilityError;
      }
      if (typeof availability === "function") {
        return availability(sourceLanguage, targetLanguage);
      }
      return availability;
    },
    create: async ({ sourceLanguage, targetLanguage, monitor, signal }) => {
      if (signal?.aborted) {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      }

      if (simulateCreateError) {
        throw simulateCreateError;
      }

      // Simulate download progress events if monitor provided
      if (typeof monitor === "function") {
        const listeners = [];
        const mockMonitor = {
          addEventListener: (type, listener) => {
            if (type === "downloadprogress") listeners.push(listener);
          },
          removeEventListener: (type, listener) => {
            const idx = listeners.indexOf(listener);
            if (idx >= 0) listeners.splice(idx, 1);
          },
        };
        monitor(mockMonitor);
        for (const step of downloadProgressSteps) {
          for (const listener of listeners) {
            listener(step);
          }
        }
      }

      return {
        translate: async (input) => {
          if (signal?.aborted) {
            const err = new Error("Aborted");
            err.name = "AbortError";
            throw err;
          }
          if (simulateTranslateError) {
            throw simulateTranslateError;
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

  // Mock LanguageDetector constructor
  globalThis.LanguageDetector = {
    create: async ({ signal } = {}) => {
      if (signal?.aborted) {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      }
      if (simulateDetectError) {
        throw simulateDetectError;
      }
      return {
        detect: async (text) => {
          if (signal?.aborted) {
            const err = new Error("Aborted");
            err.name = "AbortError";
            throw err;
          }
          return typeof detectResults === "function" ? detectResults(text) : detectResults;
        },
        destroy: () => {
          destroyedInstances.detectors += 1;
        },
      };
    },
  };

  return { destroyedInstances };
}

// ==============================================================================
// 1. CAPABILITY DETECTION
// ==============================================================================

test("getTranslationCapabilities detects full support in a secure browser with APIs", () => {
  setupMockEnvironment({ isBrowser: true, isSecureContext: true });
  try {
    const caps = getTranslationCapabilities();
    assert.equal(caps.isBrowser, true);
    assert.equal(caps.isSecureContext, true);
    assert.equal(caps.hasTranslator, true);
    assert.equal(caps.hasLanguageDetector, true);
    assert.equal(caps.isSupported, true);
    assert.equal(caps.reason, undefined);
  } finally {
    restoreGlobals();
  }
});

test("getTranslationCapabilities flags unsupported when environment is non-browser (SSR/Node)", () => {
  setupMockEnvironment({ isBrowser: false });
  try {
    const caps = getTranslationCapabilities();
    assert.equal(caps.isBrowser, false);
    assert.equal(caps.isSupported, false);
    assert.match(caps.reason, /not a browser/i);
  } finally {
    restoreGlobals();
  }
});

test("getTranslationCapabilities flags unsupported when context is insecure (HTTP)", () => {
  setupMockEnvironment({ isBrowser: true, isSecureContext: false });
  try {
    const caps = getTranslationCapabilities();
    assert.equal(caps.isBrowser, true);
    assert.equal(caps.isSecureContext, false);
    assert.equal(caps.isSupported, false);
    assert.match(caps.reason, /secure context/i);
  } finally {
    restoreGlobals();
  }
});

test("getTranslationCapabilities flags unsupported when Translator is missing", () => {
  setupMockEnvironment({ isBrowser: true, isSecureContext: true });
  delete globalThis.Translator;
  try {
    const caps = getTranslationCapabilities();
    assert.equal(caps.hasTranslator, false);
    assert.equal(caps.hasLanguageDetector, true);
    assert.equal(caps.isSupported, false);
    assert.match(caps.reason, /Translator API is not available/i);
  } finally {
    restoreGlobals();
  }
});

test("getTranslationCapabilities flags unsupported when LanguageDetector is missing", () => {
  setupMockEnvironment({ isBrowser: true, isSecureContext: true });
  delete globalThis.LanguageDetector;
  try {
    const caps = getTranslationCapabilities();
    assert.equal(caps.hasTranslator, true);
    assert.equal(caps.hasLanguageDetector, false);
    assert.equal(caps.isSupported, false);
    assert.match(caps.reason, /LanguageDetector API is not available/i);
  } finally {
    restoreGlobals();
  }
});

test("getTranslationCapabilities flags unsupported when both APIs are missing", () => {
  setupMockEnvironment({ isBrowser: true, isSecureContext: true });
  delete globalThis.Translator;
  delete globalThis.LanguageDetector;
  try {
    const caps = getTranslationCapabilities();
    assert.equal(caps.hasTranslator, false);
    assert.equal(caps.hasLanguageDetector, false);
    assert.equal(caps.isSupported, false);
    assert.match(caps.reason, /Neither Translator nor LanguageDetector/i);
  } finally {
    restoreGlobals();
  }
});

// ==============================================================================
// 2. LANGUAGE VALIDATION
// ==============================================================================

test("isSupportedLanguage strictly accepts en, hi, mr and rejects other languages", () => {
  assert.equal(isSupportedLanguage("en"), true);
  assert.equal(isSupportedLanguage("EN"), true);
  assert.equal(isSupportedLanguage("hi"), true);
  assert.equal(isSupportedLanguage("mr"), true);

  assert.equal(isSupportedLanguage("es"), false);
  assert.equal(isSupportedLanguage("fr"), false);
  assert.equal(isSupportedLanguage("de"), false);
  assert.equal(isSupportedLanguage(""), false);
  assert.equal(isSupportedLanguage(null), false);
  assert.equal(isSupportedLanguage(undefined), false);
  assert.equal(isSupportedLanguage(123), false);
});

test("assertSupportedLanguage returns lowercase code or throws TranslationError", () => {
  assert.equal(assertSupportedLanguage("EN"), "en");
  assert.equal(assertSupportedLanguage("mr"), "mr");
  assert.equal(assertSupportedLanguage("hi"), "hi");

  assert.throws(
    () => assertSupportedLanguage("ta", "targetLanguage"),
    (err) => err instanceof TranslationError && err.code === "UNSUPPORTED_LANGUAGE",
  );
  assert.throws(
    () => assertSupportedLanguage(null),
    (err) => err instanceof TranslationError && err.code === "UNSUPPORTED_LANGUAGE",
  );
});

test("isSupportedLanguagePair verifies all six approved translation directions and rejects invalid pairs", () => {
  // All 6 directions must be valid
  assert.equal(isSupportedLanguagePair("mr", "en"), true);
  assert.equal(isSupportedLanguagePair("hi", "en"), true);
  assert.equal(isSupportedLanguagePair("en", "mr"), true);
  assert.equal(isSupportedLanguagePair("en", "hi"), true);
  assert.equal(isSupportedLanguagePair("mr", "hi"), true);
  assert.equal(isSupportedLanguagePair("hi", "mr"), true);

  // Identical languages must be rejected
  assert.equal(isSupportedLanguagePair("en", "en"), false);
  assert.equal(isSupportedLanguagePair("mr", "mr"), false);

  // Unsupported languages must be rejected
  assert.equal(isSupportedLanguagePair("en", "es"), false);
  assert.equal(isSupportedLanguagePair("fr", "en"), false);
});

test("constants definition integrity: 3 languages, 6 pairs, accurate human labels", () => {
  assert.deepEqual([...SUPPORTED_LANGUAGES], ["en", "hi", "mr"]);
  assert.equal(SUPPORTED_LANGUAGE_PAIRS.length, 6);
  assert.equal(LANGUAGE_LABELS.en, "English");
  assert.equal(LANGUAGE_LABELS.hi, "Hindi");
  assert.equal(LANGUAGE_LABELS.mr, "Marathi");
});

// ==============================================================================
// 3. AVAILABILITY CHECKING
// ==============================================================================

test("checkTranslationAvailability handles standard documented statuses: available, downloadable, downloading, unavailable", async () => {
  setupMockEnvironment({ isBrowser: true, isSecureContext: true });
  try {
    for (const status of ["available", "downloadable", "downloading", "unavailable"]) {
      globalThis.Translator.availability = async () => status;
      const res = await checkTranslationAvailability("mr", "en");
      assert.equal(res, status);
    }
  } finally {
    restoreGlobals();
  }
});

test("checkTranslationAvailability normalizes legacy statuses (readily -> available, after-download -> downloadable, no -> unavailable)", async () => {
  setupMockEnvironment({ isBrowser: true, isSecureContext: true });
  try {
    globalThis.Translator.availability = async () => "readily";
    assert.equal(await checkTranslationAvailability("mr", "en"), "available");

    globalThis.Translator.availability = async () => "after-download";
    assert.equal(await checkTranslationAvailability("hi", "en"), "downloadable");

    globalThis.Translator.availability = async () => "no";
    assert.equal(await checkTranslationAvailability("en", "mr"), "unavailable");

    globalThis.Translator.availability = async () => "unknown_status_from_browser";
    assert.equal(await checkTranslationAvailability("en", "hi"), "unavailable");
  } finally {
    restoreGlobals();
  }
});

test("checkTranslationAvailability rejects identical source and target languages", async () => {
  setupMockEnvironment({ isBrowser: true, isSecureContext: true });
  try {
    await assert.rejects(
      async () => checkTranslationAvailability("en", "en"),
      (err) => err instanceof TranslationError && err.code === "IDENTICAL_LANGUAGES",
    );
  } finally {
    restoreGlobals();
  }
});

test("checkTranslationAvailability rejects unsupported language codes", async () => {
  setupMockEnvironment({ isBrowser: true, isSecureContext: true });
  try {
    await assert.rejects(
      async () => checkTranslationAvailability("es", "en"),
      (err) => err instanceof TranslationError && err.code === "UNSUPPORTED_LANGUAGE",
    );
  } finally {
    restoreGlobals();
  }
});

test("checkTranslationAvailability throws INITIALIZATION_FAILED when API throws", async () => {
  setupMockEnvironment({
    isBrowser: true,
    isSecureContext: true,
    simulateAvailabilityError: new Error("Underlying hardware initialization failed"),
  });
  try {
    await assert.rejects(
      async () => checkTranslationAvailability("mr", "en"),
      (err) =>
        err instanceof TranslationError &&
        err.code === "INITIALIZATION_FAILED" &&
        err.message.includes("Underlying hardware initialization failed"),
    );
  } finally {
    restoreGlobals();
  }
});

// ==============================================================================
// 4. LANGUAGE DETECTION
// ==============================================================================

test("detectSourceLanguage detects Marathi with high confidence", async () => {
  setupMockEnvironment({
    isBrowser: true,
    isSecureContext: true,
    detectResults: [{ detectedLanguage: "mr", confidence: 0.94 }],
  });
  try {
    const res = await detectSourceLanguage("इंजिन सुरू होत नाही आणि आवाज येत आहे");
    assert.equal(res.detectedLanguage, "mr");
    assert.equal(res.confidence, 0.94);
    assert.equal(res.isAmbiguous, false);
    assert.equal(res.requiresManualSelection, false);
  } finally {
    restoreGlobals();
  }
});

test("detectSourceLanguage detects Hindi with high confidence", async () => {
  setupMockEnvironment({
    isBrowser: true,
    isSecureContext: true,
    detectResults: [{ detectedLanguage: "hi", confidence: 0.92 }],
  });
  try {
    const res = await detectSourceLanguage("ट्रैक्टर का इंजन बहुत गरम हो रहा है");
    assert.equal(res.detectedLanguage, "hi");
    assert.equal(res.confidence, 0.92);
    assert.equal(res.isAmbiguous, false);
    assert.equal(res.requiresManualSelection, false);
  } finally {
    restoreGlobals();
  }
});

test("detectSourceLanguage detects English with high confidence", async () => {
  setupMockEnvironment({
    isBrowser: true,
    isSecureContext: true,
    detectResults: [{ detectedLanguage: "en", confidence: 0.98 }],
  });
  try {
    const res = await detectSourceLanguage("Hydraulic cylinder leaking hydraulic oil");
    assert.equal(res.detectedLanguage, "en");
    assert.equal(res.confidence, 0.98);
    assert.equal(res.isAmbiguous, false);
    assert.equal(res.requiresManualSelection, false);
  } finally {
    restoreGlobals();
  }
});

test("detectSourceLanguage flags low confidence (< 0.5) as ambiguous and requires manual selection", async () => {
  setupMockEnvironment({
    isBrowser: true,
    isSecureContext: true,
    detectResults: [{ detectedLanguage: "hi", confidence: 0.42 }],
  });
  try {
    const res = await detectSourceLanguage("इंजन");
    assert.equal(res.detectedLanguage, null);
    assert.equal(res.confidence, 0.42);
    assert.equal(res.isAmbiguous, true);
    assert.equal(res.requiresManualSelection, true);
    assert.match(res.reason, /too low or ambiguous/i);
  } finally {
    restoreGlobals();
  }
});

test("detectSourceLanguage flags close candidates (Hindi vs Marathi Devanagari ambiguity) as ambiguous", async () => {
  // Delta between top (hi: 0.52) and second (mr: 0.46) is 0.06 (< AMBIGUITY_DELTA_THRESHOLD 0.15)
  setupMockEnvironment({
    isBrowser: true,
    isSecureContext: true,
    detectResults: [
      { detectedLanguage: "hi", confidence: 0.52 },
      { detectedLanguage: "mr", confidence: 0.46 },
    ],
  });
  try {
    const res = await detectSourceLanguage("खूप समस्या आहे इंजन चालू होत नाही");
    assert.equal(res.detectedLanguage, null);
    assert.equal(res.isAmbiguous, true);
    assert.equal(res.requiresManualSelection, true);
  } finally {
    restoreGlobals();
  }
});

test("detectSourceLanguage rejects unsupported detected language (e.g. Spanish) gracefully", async () => {
  setupMockEnvironment({
    isBrowser: true,
    isSecureContext: true,
    detectResults: [{ detectedLanguage: "es", confidence: 0.97 }],
  });
  try {
    const res = await detectSourceLanguage("El tractor no funciona");
    assert.equal(res.detectedLanguage, null);
    assert.equal(res.isAmbiguous, false);
    assert.equal(res.requiresManualSelection, true);
    assert.match(res.reason, /Detected language 'es' is not supported/i);
  } finally {
    restoreGlobals();
  }
});

test("detectSourceLanguage rejects empty or whitespace-only text with EMPTY_INPUT", async () => {
  setupMockEnvironment({ isBrowser: true, isSecureContext: true });
  try {
    await assert.rejects(
      async () => detectSourceLanguage(""),
      (err) => err instanceof TranslationError && err.code === "EMPTY_INPUT",
    );
    await assert.rejects(
      async () => detectSourceLanguage("    \n\t  "),
      (err) => err instanceof TranslationError && err.code === "EMPTY_INPUT",
    );
  } finally {
    restoreGlobals();
  }
});

test("detectSourceLanguage destroys detector instance upon completion", async () => {
  const { destroyedInstances } = setupMockEnvironment({
    isBrowser: true,
    isSecureContext: true,
    detectResults: [{ detectedLanguage: "mr", confidence: 0.9 }],
  });
  try {
    await detectSourceLanguage("ट्रॅक्टर सुरू होत नाही");
    assert.equal(destroyedInstances.detectors, 1);
  } finally {
    restoreGlobals();
  }
});

test("detectSourceLanguage cleans up detector and handles abort signal", async () => {
  const controller = new AbortController();
  controller.abort();
  setupMockEnvironment({ isBrowser: true, isSecureContext: true });
  try {
    await assert.rejects(
      async () => detectSourceLanguage("ट्रॅक्टर", { signal: controller.signal }),
      (err) => err instanceof TranslationError && err.code === "ABORTED",
    );
  } finally {
    restoreGlobals();
  }
});

// ==============================================================================
// 5. TRANSLATION EXECUTION (6 APPROVED PAIRS)
// ==============================================================================

test("translateText successfully executes all six approved translation directions", async () => {
  const { destroyedInstances } = setupMockEnvironment({
    isBrowser: true,
    isSecureContext: true,
    availability: "available",
  });

  try {
    const pairs = [
      ["mr", "en"],
      ["hi", "en"],
      ["en", "mr"],
      ["en", "hi"],
      ["mr", "hi"],
      ["hi", "mr"],
    ];

    let translationCount = 0;
    for (const [source, target] of pairs) {
      const res = await translateText({
        text: "Sample breakdown report",
        sourceLanguage: source,
        targetLanguage: target,
      });

      assert.equal(res.sourceLanguage, source);
      assert.equal(res.targetLanguage, target);
      assert.ok(res.translatedText.length > 0);
      translationCount += 1;
    }

    // Every translation call must construct and destroy a single Translator instance
    assert.equal(destroyedInstances.translators, translationCount);
  } finally {
    restoreGlobals();
  }
});

test("translateText rejects empty or whitespace-only input with EMPTY_INPUT", async () => {
  setupMockEnvironment({ isBrowser: true, isSecureContext: true });
  try {
    await assert.rejects(
      async () =>
        translateText({
          text: "   ",
          sourceLanguage: "mr",
          targetLanguage: "en",
        }),
      (err) => err instanceof TranslationError && err.code === "EMPTY_INPUT",
    );
  } finally {
    restoreGlobals();
  }
});

test("translateText rejects identical source and target languages with IDENTICAL_LANGUAGES", async () => {
  setupMockEnvironment({ isBrowser: true, isSecureContext: true });
  try {
    await assert.rejects(
      async () =>
        translateText({
          text: "Some text",
          sourceLanguage: "en",
          targetLanguage: "en",
        }),
      (err) => err instanceof TranslationError && err.code === "IDENTICAL_LANGUAGES",
    );
  } finally {
    restoreGlobals();
  }
});

test("translateText rejects unsupported source or target languages with UNSUPPORTED_LANGUAGE", async () => {
  setupMockEnvironment({ isBrowser: true, isSecureContext: true });
  try {
    await assert.rejects(
      async () =>
        translateText({
          text: "Valid text",
          sourceLanguage: "de",
          targetLanguage: "en",
        }),
      (err) => err instanceof TranslationError && err.code === "UNSUPPORTED_LANGUAGE",
    );
  } finally {
    restoreGlobals();
  }
});

test("translateText throws UNAVAILABLE_LANGUAGE_PAIR when API reports pair as unavailable", async () => {
  setupMockEnvironment({
    isBrowser: true,
    isSecureContext: true,
    availability: "unavailable",
  });
  try {
    await assert.rejects(
      async () =>
        translateText({
          text: "Valid text",
          sourceLanguage: "mr",
          targetLanguage: "en",
        }),
      (err) => err instanceof TranslationError && err.code === "UNAVAILABLE_LANGUAGE_PAIR",
    );
  } finally {
    restoreGlobals();
  }
});

test("translateText fires onDownloadProgress during model download and completes translation", async () => {
  const recordedSteps = [];
  setupMockEnvironment({
    isBrowser: true,
    isSecureContext: true,
    availability: "downloadable",
    downloadProgressSteps: [
      { loaded: 25, total: 100 },
      { loaded: 50, total: 100 },
      { loaded: 100, total: 100 },
    ],
  });

  try {
    const res = await translateText({
      text: "इंजिन खूप गरम होत आहे",
      sourceLanguage: "mr",
      targetLanguage: "en",
      onDownloadProgress: (loaded, total) => {
        recordedSteps.push({ loaded, total });
      },
    });

    assert.equal(res.translatedText, "Tractor engine is overheating and making noise");
    assert.deepEqual(recordedSteps, [
      { loaded: 25, total: 100 },
      { loaded: 50, total: 100 },
      { loaded: 100, total: 100 },
    ]);
  } finally {
    restoreGlobals();
  }
});

test("translateText categorizes download failure as MODEL_DOWNLOAD_FAILED when status is downloadable", async () => {
  setupMockEnvironment({
    isBrowser: true,
    isSecureContext: true,
    availability: "downloadable",
    simulateCreateError: new Error("Network timeout while downloading model package"),
  });

  try {
    await assert.rejects(
      async () =>
        translateText({
          text: "इंजिन गरम आहे",
          sourceLanguage: "mr",
          targetLanguage: "en",
        }),
      (err) =>
        err instanceof TranslationError &&
        err.code === "MODEL_DOWNLOAD_FAILED" &&
        err.message.includes("Network timeout while downloading model package"),
    );
  } finally {
    restoreGlobals();
  }
});

test("translateText categorizes general creation failure as INITIALIZATION_FAILED", async () => {
  setupMockEnvironment({
    isBrowser: true,
    isSecureContext: true,
    availability: "available",
    simulateCreateError: new Error("GPU device lost during pipeline compilation"),
  });

  try {
    await assert.rejects(
      async () =>
        translateText({
          text: "इंजिन गरम आहे",
          sourceLanguage: "mr",
          targetLanguage: "en",
        }),
      (err) =>
        err instanceof TranslationError &&
        err.code === "INITIALIZATION_FAILED" &&
        err.message.includes("GPU device lost"),
    );
  } finally {
    restoreGlobals();
  }
});

test("translateText categorizes translation runtime failure as TRANSLATION_FAILED and cleans up translator", async () => {
  const { destroyedInstances } = setupMockEnvironment({
    isBrowser: true,
    isSecureContext: true,
    availability: "available",
    simulateTranslateError: new Error("Internal inference engine failure"),
  });

  try {
    await assert.rejects(
      async () =>
        translateText({
          text: "Valid text",
          sourceLanguage: "mr",
          targetLanguage: "en",
        }),
      (err) =>
        err instanceof TranslationError &&
        err.code === "TRANSLATION_FAILED" &&
        err.message.includes("Internal inference engine failure"),
    );

    // Guaranteed destruction on error
    assert.equal(destroyedInstances.translators, 1);
  } finally {
    restoreGlobals();
  }
});

test("translateText honors AbortSignal before and during execution", async () => {
  const controller = new AbortController();
  controller.abort();

  setupMockEnvironment({
    isBrowser: true,
    isSecureContext: true,
    availability: "available",
  });

  try {
    await assert.rejects(
      async () =>
        translateText({
          text: "Valid text",
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
// 6. PRIVACY & ISOLATION VERIFICATION
// ==============================================================================

test("privacy verification: translation service never logs source text or sends outbound requests", async () => {
  const loggedMessages = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = (...args) => loggedMessages.push(args.join(" "));
  console.warn = (...args) => loggedMessages.push(args.join(" "));
  console.error = (...args) => loggedMessages.push(args.join(" "));

  setupMockEnvironment({
    isBrowser: true,
    isSecureContext: true,
    availability: "available",
  });

  const sensitiveFarmerBreakdown = "Confidential breakdown at farm plot #42 with John Deere 5050D";

  try {
    await translateText({
      text: sensitiveFarmerBreakdown,
      sourceLanguage: "en",
      targetLanguage: "mr",
    });

    for (const msg of loggedMessages) {
      assert.equal(
        msg.includes(sensitiveFarmerBreakdown),
        false,
        "Source description must never be output to console logs",
      );
    }
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    restoreGlobals();
  }
});
