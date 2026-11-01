/**
 * Chrome Native On-Device Translation Service
 *
 * Provides staff-side on-demand translation using Chrome's built-in
 * WICG `Translator` and `LanguageDetector` browser APIs.
 *
 * Strictly on-device and privacy-preserving:
 * - Zero external API keys or cloud translation providers.
 * - Zero network transmission of farmer breakdown descriptions.
 * - Zero persistence or modification of Supabase repair records.
 * - Canonical farmer description is strictly preserved.
 */

// ==============================================================================
// 1. Types & Scoped Browser API Declarations
// ==============================================================================

export const SUPPORTED_LANGUAGES = ["en", "hi", "mr"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: "English",
  hi: "Hindi",
  mr: "Marathi",
};

/**
 * The six approved language translation directions between English, Hindi, and Marathi.
 */
export const SUPPORTED_LANGUAGE_PAIRS: ReadonlyArray<
  readonly [SupportedLanguage, SupportedLanguage]
> = [
  ["mr", "en"],
  ["hi", "en"],
  ["en", "mr"],
  ["en", "hi"],
  ["mr", "hi"],
  ["hi", "mr"],
] as const;

export type ChromeTranslationAvailability =
  "available" | "downloadable" | "downloading" | "unavailable";

export type TranslationErrorCode =
  | "UNSUPPORTED_BROWSER"
  | "INSECURE_CONTEXT"
  | "UNSUPPORTED_LANGUAGE"
  | "UNAVAILABLE_LANGUAGE_PAIR"
  | "IDENTICAL_LANGUAGES"
  | "LOW_CONFIDENCE"
  | "EMPTY_INPUT"
  | "MODEL_DOWNLOAD_FAILED"
  | "TRANSLATION_FAILED"
  | "INITIALIZATION_FAILED"
  | "ABORTED";

export class TranslationError extends Error {
  readonly code: TranslationErrorCode;
  readonly details?: unknown;

  constructor(code: TranslationErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "TranslationError";
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, TranslationError.prototype);
  }
}

export interface TranslationCapabilities {
  isBrowser: boolean;
  isSecureContext: boolean;
  hasTranslator: boolean;
  hasLanguageDetector: boolean;
  isSupported: boolean;
  reason?: string | undefined;
}

export interface ChromeTranslatorProgressEvent {
  loaded: number;
  total: number;
}

export interface ChromeTranslatorDownloadMonitor {
  addEventListener(
    type: "downloadprogress",
    listener: (event: ChromeTranslatorProgressEvent) => void,
  ): void;
  removeEventListener(
    type: "downloadprogress",
    listener: (event: ChromeTranslatorProgressEvent) => void,
  ): void;
}

export interface ChromeTranslatorCreateOptions {
  sourceLanguage: string;
  targetLanguage: string;
  monitor?: ((monitor: ChromeTranslatorDownloadMonitor) => void) | undefined;
  signal?: AbortSignal | undefined;
}

export interface ChromeTranslatorInstance {
  translate(text: string): Promise<string>;
  destroy(): void;
}

export interface ChromeTranslatorConstructor {
  availability(options: {
    sourceLanguage: string;
    targetLanguage: string;
  }): Promise<ChromeTranslationAvailability | string>;
  create(options: ChromeTranslatorCreateOptions): Promise<ChromeTranslatorInstance>;
}

export interface ChromeLanguageDetectionCandidate {
  detectedLanguage: string;
  confidence: number;
}

export interface ChromeLanguageDetectorInstance {
  detect(text: string): Promise<ChromeLanguageDetectionCandidate[]>;
  destroy?(): void;
}

export interface ChromeLanguageDetectorConstructor {
  availability?(): Promise<ChromeTranslationAvailability | string>;
  create(options?: { signal?: AbortSignal | undefined }): Promise<ChromeLanguageDetectorInstance>;
}

export interface LanguageDetectionResult {
  detectedLanguage: SupportedLanguage | null;
  confidence: number;
  isAmbiguous: boolean;
  candidates: ChromeLanguageDetectionCandidate[];
  requiresManualSelection: boolean;
  reason?: string | undefined;
}

export interface TranslateOptions {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  onDownloadProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}

export interface TranslationResult {
  translatedText: string;
  sourceLanguage: SupportedLanguage;
  targetLanguage: SupportedLanguage;
  detectedConfidence?: number;
}

// ==============================================================================
// 2. Constants & Thresholds
// ==============================================================================

/** Minimum confidence threshold for automatic language acceptance. */
export const DETECTION_CONFIDENCE_THRESHOLD = 0.5;

/**
 * If the difference in confidence between the top candidate and the next candidate
 * is less than this threshold, the result is considered ambiguous (e.g. Hindi vs Marathi).
 */
export const AMBIGUITY_DELTA_THRESHOLD = 0.15;

// ==============================================================================
// 3. Helper Functions: Globals & Validation
// ==============================================================================

function getGlobalTranslator(): ChromeTranslatorConstructor | undefined {
  if (typeof globalThis !== "undefined" && (globalThis as Record<string, unknown>)["Translator"]) {
    return (globalThis as Record<string, unknown>)["Translator"] as ChromeTranslatorConstructor;
  }
  return undefined;
}

function getGlobalLanguageDetector(): ChromeLanguageDetectorConstructor | undefined {
  if (
    typeof globalThis !== "undefined" &&
    (globalThis as Record<string, unknown>)["LanguageDetector"]
  ) {
    return (globalThis as Record<string, unknown>)[
      "LanguageDetector"
    ] as ChromeLanguageDetectorConstructor;
  }
  return undefined;
}

/**
 * Type guard for supported language codes (en, hi, mr).
 */
export function isSupportedLanguage(lang: unknown): lang is SupportedLanguage {
  return (
    typeof lang === "string" &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(lang.toLowerCase())
  );
}

/**
 * Asserts that a given language code is supported, or throws TranslationError.
 */
export function assertSupportedLanguage(lang: unknown, paramName = "language"): SupportedLanguage {
  if (typeof lang !== "string" || !isSupportedLanguage(lang)) {
    throw new TranslationError(
      "UNSUPPORTED_LANGUAGE",
      `Unsupported ${paramName} '${String(lang)}'. Supported languages are: ${SUPPORTED_LANGUAGES.join(", ")}.`,
    );
  }
  return lang.toLowerCase() as SupportedLanguage;
}

/**
 * Checks whether a source and target language pair is supported and valid.
 */
export function isSupportedLanguagePair(source: string, target: string): boolean {
  if (!isSupportedLanguage(source) || !isSupportedLanguage(target)) {
    return false;
  }
  if (source.toLowerCase() === target.toLowerCase()) {
    return false;
  }
  return SUPPORTED_LANGUAGE_PAIRS.some(
    ([s, t]) => s === source.toLowerCase() && t === target.toLowerCase(),
  );
}

// ==============================================================================
// 4. Capability Detection
// ==============================================================================

export const TARGET_LANG_STORAGE_PREFIX = "terrabyte_staff_target_lang_";
export const DEFAULT_STAFF_TARGET_LANGUAGE: SupportedLanguage = "en";

/**
 * Safely reads the staff target language preference from browser localStorage.
 * Scoped to an authenticated user ID.
 */
export function getStoredTargetLanguage(userId: string | null | undefined): SupportedLanguage {
  if (typeof window === "undefined") return DEFAULT_STAFF_TARGET_LANGUAGE;
  try {
    const key = userId
      ? `${TARGET_LANG_STORAGE_PREFIX}${userId}`
      : `${TARGET_LANG_STORAGE_PREFIX}default`;
    const stored = window.localStorage.getItem(key);
    if (stored && isSupportedLanguage(stored)) {
      return stored;
    }
  } catch {
    // Gracefully handle sandboxed or restricted localStorage
  }
  return DEFAULT_STAFF_TARGET_LANGUAGE;
}

/**
 * Safely persists the staff target language preference to browser localStorage.
 */
export function setStoredTargetLanguage(
  userId: string | null | undefined,
  lang: SupportedLanguage,
): void {
  if (typeof window === "undefined") return;
  try {
    const key = userId
      ? `${TARGET_LANG_STORAGE_PREFIX}${userId}`
      : `${TARGET_LANG_STORAGE_PREFIX}default`;
    window.localStorage.setItem(key, lang);
  } catch {
    // Gracefully handle sandboxed or restricted localStorage
  }
}

/**
 * Evaluates whether the current runtime environment supports on-device Chrome translation.
 * Safe for SSR and non-browser test environments.
 */
export function getTranslationCapabilities(): TranslationCapabilities {
  const isBrowser = typeof window !== "undefined";
  if (!isBrowser) {
    return {
      isBrowser: false,
      isSecureContext: false,
      hasTranslator: false,
      hasLanguageDetector: false,
      isSupported: false,
      reason: "Execution environment is not a browser (SSR or server context).",
    };
  }

  const isSecureContext = Boolean(window.isSecureContext);
  const hasTranslator = Boolean(getGlobalTranslator());
  const hasLanguageDetector = Boolean(getGlobalLanguageDetector());
  const isSupported = isSecureContext && hasTranslator && hasLanguageDetector;

  let reason: string | undefined;
  if (!isSecureContext) {
    reason = "A secure context (HTTPS or localhost) is required for on-device translation.";
  } else if (!hasTranslator && !hasLanguageDetector) {
    reason = "Neither Translator nor LanguageDetector APIs are available in this browser.";
  } else if (!hasTranslator) {
    reason = "Translator API is not available in this browser.";
  } else if (!hasLanguageDetector) {
    reason = "LanguageDetector API is not available in this browser.";
  }

  return {
    isBrowser,
    isSecureContext,
    hasTranslator,
    hasLanguageDetector,
    isSupported,
    reason,
  };
}

// ==============================================================================
// 5. Translation Availability
// ==============================================================================

/**
 * Checks the availability of an on-device translation model for a specific language pair.
 */
export async function checkTranslationAvailability(
  sourceLanguage: string,
  targetLanguage: string,
): Promise<ChromeTranslationAvailability> {
  const source = assertSupportedLanguage(sourceLanguage, "sourceLanguage");
  const target = assertSupportedLanguage(targetLanguage, "targetLanguage");

  if (source === target) {
    throw new TranslationError(
      "IDENTICAL_LANGUAGES",
      `Source and target languages cannot both be '${source}'.`,
    );
  }

  const capabilities = getTranslationCapabilities();
  if (!capabilities.isBrowser || !capabilities.isSecureContext || !capabilities.hasTranslator) {
    const code: TranslationErrorCode =
      capabilities.isSecureContext === false ? "INSECURE_CONTEXT" : "UNSUPPORTED_BROWSER";
    throw new TranslationError(
      code,
      capabilities.reason || "Translator API is not available in this browser.",
    );
  }

  const Translator = getGlobalTranslator()!;

  try {
    const rawStatus = await Translator.availability({
      sourceLanguage: source,
      targetLanguage: target,
    });

    // Normalize raw API response strings into ChromeTranslationAvailability
    const status = typeof rawStatus === "string" ? rawStatus.toLowerCase() : "";
    if (status === "available" || status === "readily") {
      return "available";
    }
    if (status === "downloadable" || status === "after-download") {
      return "downloadable";
    }
    if (status === "downloading") {
      return "downloading";
    }
    if (status === "unavailable" || status === "no") {
      return "unavailable";
    }

    return "unavailable";
  } catch (err) {
    if (err instanceof TranslationError) throw err;
    throw new TranslationError(
      "INITIALIZATION_FAILED",
      `Failed to check translation availability for ${source} -> ${target}: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
}

// ==============================================================================
// 6. Language Detection
// ==============================================================================

/**
 * Detects the language of a text snippet using Chrome's on-device LanguageDetector API.
 * Identifies Hindi, Marathi, and English without making naive Unicode script assumptions.
 */
export async function detectSourceLanguage(
  text: string,
  options?: { signal?: AbortSignal },
): Promise<LanguageDetectionResult> {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new TranslationError("EMPTY_INPUT", "Input text cannot be empty or whitespace only.");
  }

  const capabilities = getTranslationCapabilities();
  if (
    !capabilities.isBrowser ||
    !capabilities.isSecureContext ||
    !capabilities.hasLanguageDetector
  ) {
    const code: TranslationErrorCode =
      capabilities.isSecureContext === false ? "INSECURE_CONTEXT" : "UNSUPPORTED_BROWSER";
    throw new TranslationError(
      code,
      capabilities.reason || "LanguageDetector API is not available in this browser.",
    );
  }

  if (options?.signal?.aborted) {
    throw new TranslationError("ABORTED", "Language detection was aborted.");
  }

  const LanguageDetector = getGlobalLanguageDetector()!;
  let detector: ChromeLanguageDetectorInstance | undefined;

  try {
    detector = await LanguageDetector.create(
      options?.signal ? { signal: options.signal } : undefined,
    );
  } catch (err) {
    if (options?.signal?.aborted || (err as { name?: string })?.name === "AbortError") {
      throw new TranslationError("ABORTED", "Language detection was aborted.", err);
    }
    throw new TranslationError(
      "INITIALIZATION_FAILED",
      `Failed to create LanguageDetector: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  let candidates: ChromeLanguageDetectionCandidate[] = [];
  try {
    if (options?.signal?.aborted) {
      throw new TranslationError("ABORTED", "Language detection was aborted.");
    }
    candidates = await detector.detect(text.trim());
  } catch (err) {
    if (err instanceof TranslationError) throw err;
    if (options?.signal?.aborted || (err as { name?: string })?.name === "AbortError") {
      throw new TranslationError("ABORTED", "Language detection was aborted.", err);
    }
    throw new TranslationError(
      "TRANSLATION_FAILED",
      `Language detection execution failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  } finally {
    if (detector && typeof detector.destroy === "function") {
      try {
        detector.destroy();
      } catch {
        // Safe cleanup suppression
      }
    }
  }

  // Handle empty detector candidates
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return {
      detectedLanguage: null,
      confidence: 0,
      isAmbiguous: true,
      candidates: [],
      requiresManualSelection: true,
      reason: "No languages were detected from the provided text.",
    };
  }

  // Sort candidates by confidence descending
  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const top = sorted[0];
  if (!top) {
    return {
      detectedLanguage: null,
      confidence: 0,
      isAmbiguous: false,
      candidates: [],
      requiresManualSelection: true,
      reason: "No language detection candidates returned.",
    };
  }
  const topLang = (top.detectedLanguage || "").toLowerCase();
  const topConfidence = typeof top.confidence === "number" ? top.confidence : 0;

  // Check if detected language is one of our supported languages (en, hi, mr)
  if (!isSupportedLanguage(topLang)) {
    return {
      detectedLanguage: null,
      confidence: topConfidence,
      isAmbiguous: false,
      candidates: sorted,
      requiresManualSelection: true,
      reason: `Detected language '${topLang}' is not supported (only English, Hindi, and Marathi are supported).`,
    };
  }

  // Check confidence threshold
  let isAmbiguous = topConfidence < DETECTION_CONFIDENCE_THRESHOLD;

  // Check ambiguity between close candidates (e.g. Hindi vs Marathi Devanagari confusion)
  const second = sorted[1];
  if (!isAmbiguous && second) {
    const secondConfidence = typeof second.confidence === "number" ? second.confidence : 0;
    if (topConfidence - secondConfidence < AMBIGUITY_DELTA_THRESHOLD) {
      isAmbiguous = true;
    }
  }

  return {
    detectedLanguage: isAmbiguous ? null : (topLang as SupportedLanguage),
    confidence: topConfidence,
    isAmbiguous,
    candidates: sorted,
    requiresManualSelection: isAmbiguous,
    reason: isAmbiguous
      ? `Detection confidence (${Math.round(topConfidence * 100)}%) is too low or ambiguous. Manual selection required.`
      : undefined,
  };
}

// ==============================================================================
// 7. Translation Execution
// ==============================================================================

/**
 * Translates text on-device using Chrome's Translator API.
 * Never transmits text over the network and cleans up instance memory upon completion.
 */
export async function translateText(options: TranslateOptions): Promise<TranslationResult> {
  const { text, sourceLanguage, targetLanguage, onDownloadProgress, signal } = options;

  // 1. Validate text input
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new TranslationError(
      "EMPTY_INPUT",
      "Text to translate cannot be empty or whitespace only.",
    );
  }

  // 2. Validate language parameters
  const source = assertSupportedLanguage(sourceLanguage, "sourceLanguage");
  const target = assertSupportedLanguage(targetLanguage, "targetLanguage");

  if (source === target) {
    throw new TranslationError(
      "IDENTICAL_LANGUAGES",
      `Source and target languages cannot both be '${source}'.`,
    );
  }

  // 3. Verify runtime capabilities
  const capabilities = getTranslationCapabilities();
  if (!capabilities.isBrowser || !capabilities.isSecureContext || !capabilities.hasTranslator) {
    const code: TranslationErrorCode =
      capabilities.isSecureContext === false ? "INSECURE_CONTEXT" : "UNSUPPORTED_BROWSER";
    throw new TranslationError(
      code,
      capabilities.reason || "Translator API is not available in this browser.",
    );
  }

  // 4. Verify pair availability
  const availability = await checkTranslationAvailability(source, target);
  if (availability === "unavailable") {
    throw new TranslationError(
      "UNAVAILABLE_LANGUAGE_PAIR",
      `Translation pair ${source} -> ${target} is unavailable on this device.`,
    );
  }

  // 5. Check early abort signal
  if (signal?.aborted) {
    throw new TranslationError("ABORTED", "Translation was aborted by caller.");
  }

  const Translator = getGlobalTranslator()!;
  let translator: ChromeTranslatorInstance | undefined;

  let monitorCallback: ((monitor: ChromeTranslatorDownloadMonitor) => void) | undefined;

  if (typeof onDownloadProgress === "function") {
    monitorCallback = (monitor: ChromeTranslatorDownloadMonitor) => {
      monitor.addEventListener("downloadprogress", (e: ChromeTranslatorProgressEvent) => {
        const loaded = typeof e.loaded === "number" ? e.loaded : 0;
        const total = typeof e.total === "number" ? e.total : 0;
        onDownloadProgress(loaded, total);
      });
    };
  }

  // 6. Create Translator instance
  try {
    const createOptions: ChromeTranslatorCreateOptions = {
      sourceLanguage: source,
      targetLanguage: target,
    };
    if (monitorCallback) createOptions.monitor = monitorCallback;
    if (signal) createOptions.signal = signal;
    translator = await Translator.create(createOptions);
  } catch (err) {
    if (signal?.aborted || (err as { name?: string })?.name === "AbortError") {
      throw new TranslationError("ABORTED", "Translation was aborted during initialization.", err);
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    const isDownloadFailure =
      availability === "downloadable" ||
      availability === "downloading" ||
      errMsg.toLowerCase().includes("download");

    throw new TranslationError(
      isDownloadFailure ? "MODEL_DOWNLOAD_FAILED" : "INITIALIZATION_FAILED",
      `Failed to initialize translator for ${source} -> ${target}: ${errMsg}`,
      err,
    );
  }

  // 7. Execute translation and guarantee instance destruction
  try {
    if (signal?.aborted) {
      throw new TranslationError("ABORTED", "Translation was aborted before execution.");
    }

    const trimmedInput = text.trim();
    const translated = await translator.translate(trimmedInput);

    if (signal?.aborted) {
      throw new TranslationError("ABORTED", "Translation was aborted.");
    }

    return {
      translatedText: translated,
      sourceLanguage: source,
      targetLanguage: target,
    };
  } catch (err) {
    if (err instanceof TranslationError) throw err;
    if (signal?.aborted || (err as { name?: string })?.name === "AbortError") {
      throw new TranslationError("ABORTED", "Translation was aborted.", err);
    }
    throw new TranslationError(
      "TRANSLATION_FAILED",
      `Translation execution failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  } finally {
    if (translator && typeof translator.destroy === "function") {
      try {
        translator.destroy();
      } catch {
        // Safe cleanup suppression
      }
    }
  }
}
