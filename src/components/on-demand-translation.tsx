import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Languages,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import {
  type SupportedLanguage,
  type TranslationCapabilities,
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGES,
  assertSupportedLanguage,
  checkTranslationAvailability,
  detectSourceLanguage,
  getStoredTargetLanguage,
  getTranslationCapabilities,
  isSupportedLanguage,
  setStoredTargetLanguage,
  translateText,
  TranslationError,
} from "@/lib/services/chrome-translator";

export interface OnDemandTranslationProps {
  text: string;
  className?: string;
}

/**
 * On-demand translation widget for staff (Technicians and Service Centre admins).
 *
 * Uses Chrome's built-in on-device Translator API.
 * Never modifies or persists the farmer's canonical description.
 */
export function OnDemandTranslation({ text, className }: OnDemandTranslationProps) {
  const { userId } = useAuth();

  // Widget expand/collapse state
  const [isOpen, setIsOpen] = useState(false);

  // Language configuration states
  const [targetLang, setTargetLang] = useState<SupportedLanguage>(() =>
    getStoredTargetLanguage(userId),
  );
  const [sourceLang, setSourceLang] = useState<SupportedLanguage | null>(null);
  const [detectedSourceLang, setDetectedSourceLang] = useState<SupportedLanguage | null>(null);
  const [detectionConfidence, setDetectionConfidence] = useState<number | null>(null);
  const [manualSourceRequired, setManualSourceRequired] = useState(false);
  const [detectionReason, setDetectionReason] = useState<string | null>(null);

  // Translation execution states
  const [isDetecting, setIsDetecting] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{
    loaded: number;
    total: number;
    percentage: number;
  } | null>(null);
  const [translatedResult, setTranslatedResult] = useState<string | null>(null);
  const [translatedPair, setTranslatedPair] = useState<{
    source: SupportedLanguage;
    target: SupportedLanguage;
  } | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [capabilities, setCapabilities] = useState<TranslationCapabilities | null>(null);

  // Lifecycle & cancellation references
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);
  const activeRequestIdRef = useRef<number>(0);

  // Sync stored preference whenever authenticated user changes
  useEffect(() => {
    const stored = getStoredTargetLanguage(userId);
    setTargetLang(stored);
  }, [userId]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  // Update browser capabilities on initial expand
  useEffect(() => {
    if (isOpen && capabilities === null) {
      setCapabilities(getTranslationCapabilities());
    }
  }, [isOpen, capabilities]);

  /**
   * Safe cancellation of in-flight operations.
   */
  const cancelInFlight = useCallback(() => {
    activeRequestIdRef.current += 1;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsTranslating(false);
    setIsDetecting(false);
    setStatusMessage(null);
    setDownloadProgress(null);
  }, []);

  /**
   * Handle user target language selection change.
   */
  const handleTargetChange = (newTarget: SupportedLanguage) => {
    if (newTarget === targetLang) return;
    cancelInFlight();
    setTargetLang(newTarget);
    setStoredTargetLanguage(userId, newTarget);
    setTranslatedResult(null);
    setTranslatedPair(null);
    setError(null);
  };

  /**
   * Handle user manual source language selection or override.
   */
  const handleSourceChange = (newSource: SupportedLanguage) => {
    cancelInFlight();
    setSourceLang(newSource);
    setManualSourceRequired(false);
    setTranslatedResult(null);
    setTranslatedPair(null);
    setError(null);
  };

  /**
   * Executes source language detection followed by translation.
   */
  const handleTranslate = async (overrideSource?: SupportedLanguage) => {
    cancelInFlight();
    const requestId = ++activeRequestIdRef.current;
    setError(null);
    setTranslatedResult(null);
    setTranslatedPair(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const currentCaps = getTranslationCapabilities();
    setCapabilities(currentCaps);

    if (!currentCaps.isBrowser || !currentCaps.isSecureContext || !currentCaps.hasTranslator) {
      setError({
        code: currentCaps.isSecureContext === false ? "INSECURE_CONTEXT" : "UNSUPPORTED_BROWSER",
        message:
          currentCaps.reason ||
          "On-device translation is not supported in this browser/device. The original farmer description is still available.",
      });
      return;
    }

    // Step 1: Resolve Source Language
    let resolvedSource = overrideSource || sourceLang;

    if (!resolvedSource) {
      setIsDetecting(true);
      setStatusMessage("Detecting spoken language...");

      try {
        if (!currentCaps.hasLanguageDetector) {
          // If LanguageDetector is not present, require staff to select language manually
          setManualSourceRequired(true);
          setDetectionReason(
            "Automatic language detection is unavailable. Please select the source language:",
          );
          setIsDetecting(false);
          setStatusMessage(null);
          return;
        }

        const detection = await detectSourceLanguage(text, { signal: controller.signal });

        if (!isMountedRef.current || requestId !== activeRequestIdRef.current) return;

        setDetectionConfidence(detection.confidence);

        if (detection.requiresManualSelection || !detection.detectedLanguage) {
          setManualSourceRequired(true);
          setDetectionReason(
            detection.reason ||
              "Language detection was ambiguous (e.g. Hindi vs Marathi Devanagari script). Please confirm the language:",
          );
          setIsDetecting(false);
          setStatusMessage(null);
          return;
        }

        resolvedSource = detection.detectedLanguage;
        setSourceLang(resolvedSource);
        setDetectedSourceLang(resolvedSource);
        setManualSourceRequired(false);
      } catch (err) {
        if (!isMountedRef.current || requestId !== activeRequestIdRef.current) return;
        if (err instanceof TranslationError && err.code === "ABORTED") {
          setIsDetecting(false);
          setStatusMessage(null);
          return;
        }
        // Fall back to manual source selection if detector fails
        setManualSourceRequired(true);
        setDetectionReason(
          "Could not determine language automatically. Please select the spoken language:",
        );
        setIsDetecting(false);
        setStatusMessage(null);
        return;
      } finally {
        if (isMountedRef.current && requestId === activeRequestIdRef.current) {
          setIsDetecting(false);
        }
      }
    }

    // Step 2: Prevent translating between identical languages
    if (resolvedSource === targetLang) {
      setError({
        code: "IDENTICAL_LANGUAGES",
        message: `Both source and target languages are ${LANGUAGE_LABELS[targetLang]}. Please choose a different target language to translate.`,
      });
      setStatusMessage(null);
      setIsTranslating(false);
      return;
    }

    // Step 3: Check pair availability
    setIsTranslating(true);
    setStatusMessage("Checking translation model availability...");

    try {
      const availability = await checkTranslationAvailability(resolvedSource, targetLang);
      if (!isMountedRef.current || requestId !== activeRequestIdRef.current) return;

      if (availability === "unavailable") {
        setError({
          code: "UNAVAILABLE_LANGUAGE_PAIR",
          message: `The ${LANGUAGE_LABELS[resolvedSource]} → ${LANGUAGE_LABELS[targetLang]} translation model is unavailable on this browser/device.`,
        });
        setIsTranslating(false);
        setStatusMessage(null);
        return;
      }

      if (availability === "downloadable" || availability === "downloading") {
        setStatusMessage("Downloading on-device language model...");
      } else {
        setStatusMessage("Translating description...");
      }

      // Step 4: Execute on-device translation
      const result = await translateText({
        text,
        sourceLanguage: resolvedSource,
        targetLanguage: targetLang,
        signal: controller.signal,
        onDownloadProgress: (loaded, total) => {
          if (!isMountedRef.current || requestId !== activeRequestIdRef.current) return;
          const percentage = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
          setDownloadProgress({ loaded, total, percentage });
          setStatusMessage(`Downloading language model (${percentage}%)...`);
        },
      });

      if (!isMountedRef.current || requestId !== activeRequestIdRef.current) return;

      setTranslatedResult(result.translatedText);
      setTranslatedPair({ source: result.sourceLanguage, target: result.targetLanguage });
      setStatusMessage(null);
      setDownloadProgress(null);
      setError(null);
    } catch (err) {
      if (!isMountedRef.current || requestId !== activeRequestIdRef.current) return;
      if (err instanceof TranslationError && err.code === "ABORTED") {
        setIsTranslating(false);
        setStatusMessage(null);
        return;
      }

      const errMsg =
        err instanceof TranslationError
          ? err.message
          : err instanceof Error
            ? err.message
            : "An unexpected error occurred during translation.";

      setError({
        code: err instanceof TranslationError ? err.code : "TRANSLATION_FAILED",
        message: errMsg,
      });
    } finally {
      if (isMountedRef.current && requestId === activeRequestIdRef.current) {
        setIsTranslating(false);
      }
    }
  };

  /**
   * Initial toggle when clicking "Translate description".
   */
  const handleToggle = () => {
    if (!isOpen) {
      setIsOpen(true);
      // Auto-trigger detection & translation if not already done
      if (!translatedResult && !isTranslating) {
        handleTranslate();
      }
    } else {
      cancelInFlight();
      setIsOpen(false);
    }
  };

  // If no description text exists, translation functionality is omitted
  if (!text || text.trim().length === 0) {
    return null;
  }

  return (
    <div className={cn("mt-2 select-none", className)}>
      {/* Compact Trigger Button */}
      {!isOpen && (
        <button
          type="button"
          onClick={handleToggle}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/80 bg-background/80 px-2.5 py-1 text-xs font-semibold text-foreground/80 hover:bg-muted hover:text-foreground transition-all shadow-xs"
        >
          <Languages className="h-3.5 w-3.5 text-primary" />
          Translate description
        </button>
      )}

      {/* Expanded Translation Container Card */}
      {isOpen && (
        <div className="rounded-xl border border-primary/25 bg-primary/5 p-3.5 space-y-3 transition-all animate-in fade-in duration-200">
          {/* Header Bar */}
          <div className="flex items-center justify-between border-b border-primary/10 pb-2">
            <div className="flex items-center gap-2">
              <Languages className="h-4 w-4 text-primary" />
              <span className="text-xs font-bold text-foreground">On-Demand Translation</span>
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary uppercase tracking-wider">
                On-Device Chrome AI
              </span>
            </div>
            <button
              type="button"
              onClick={handleToggle}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Close translation"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Browser Support Warning (if unsupported) */}
          {capabilities && !capabilities.isSupported && !capabilities.hasTranslator && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <p>
                  On-device translation is not supported in this browser/device. The original farmer
                  description is still available.
                </p>
              </div>
            </div>
          )}

          {/* Controls: Target Language Selector */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground">Target language:</span>
              <div className="inline-flex rounded-lg border border-border/70 bg-background/90 p-0.5 shadow-xs">
                {SUPPORTED_LANGUAGES.map((lang) => {
                  const isActive = targetLang === lang;
                  return (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => handleTargetChange(lang)}
                      disabled={isTranslating}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50",
                        isActive
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                      )}
                    >
                      {LANGUAGE_LABELS[lang]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Re-translate or Cancel Action */}
            <div className="flex items-center gap-2">
              {isTranslating ? (
                <button
                  type="button"
                  onClick={cancelInFlight}
                  className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                  Cancel
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleTranslate()}
                  disabled={isDetecting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-xs disabled:opacity-50"
                >
                  <RefreshCw className={cn("h-3 w-3", isDetecting && "animate-spin")} />
                  {translatedResult
                    ? "Re-translate"
                    : `Translate to ${LANGUAGE_LABELS[targetLang]}`}
                </button>
              )}
            </div>
          </div>

          {/* Source Language Status & Ambiguity Resolver */}
          <div className="rounded-lg border border-border/60 bg-background/60 p-2.5 text-xs space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-muted-foreground">Spoken language:</span>
                {sourceLang ? (
                  <span className="inline-flex items-center gap-1 font-bold text-foreground bg-primary/10 text-primary px-2 py-0.5 rounded">
                    {LANGUAGE_LABELS[sourceLang]}
                    {detectedSourceLang === sourceLang && detectionConfidence !== null && (
                      <span className="text-[10px] opacity-75">
                        ({Math.round(detectionConfidence * 100)}% match)
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="italic text-muted-foreground">
                    {isDetecting ? "Detecting..." : "Not selected"}
                  </span>
                )}
              </div>

              {/* Source Language Override / Selector Toggle */}
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-muted-foreground">Change source:</span>
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => handleSourceChange(lang)}
                    disabled={isTranslating}
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[11px] font-medium border transition-colors disabled:opacity-40",
                      sourceLang === lang
                        ? "border-primary bg-primary/15 text-primary font-bold"
                        : "border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted",
                    )}
                  >
                    {LANGUAGE_LABELS[lang]}
                  </button>
                ))}
              </div>
            </div>

            {/* Ambiguous Source Notice */}
            {manualSourceRequired && (
              <div className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400 pt-1 border-t border-border/50">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <p className="text-[11px] leading-snug">
                  {detectionReason ||
                    "Automatic language detection was ambiguous between Hindi and Marathi. Please click the spoken language above to proceed."}
                </p>
              </div>
            )}
          </div>

          {/* Progress / Status Display */}
          {(isDetecting || isTranslating) && (
            <div className="rounded-lg border border-primary/20 bg-primary/10 p-2.5 text-xs space-y-2">
              <div className="flex items-center gap-2 text-foreground font-semibold">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                <span>{statusMessage || "Processing translation on-device..."}</span>
              </div>
              {downloadProgress && downloadProgress.total > 0 && (
                <div className="space-y-1">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary/20">
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{ width: `${downloadProgress.percentage}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>Downloading package</span>
                    <span>{downloadProgress.percentage}%</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error Message Display */}
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive space-y-1">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-semibold">Unable to translate description</p>
                  <p className="text-[11px] leading-snug">{error.message}</p>
                </div>
              </div>
            </div>
          )}

          {/* Translated Result Card (Canonical separation maintained) */}
          {translatedResult && translatedPair && (
            <div className="rounded-xl border border-border bg-card p-3 shadow-xs space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/50 pb-1.5">
                <span className="font-bold text-foreground flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  Machine translated from {LANGUAGE_LABELS[translatedPair.source]} to{" "}
                  {LANGUAGE_LABELS[translatedPair.target]}
                </span>
                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  On-Device Inference
                </span>
              </div>

              {/* Translated Description */}
              <p className="text-sm font-semibold text-foreground whitespace-pre-wrap leading-relaxed">
                "{translatedResult}"
              </p>

              {/* Non-negotiable canonical immutability disclaimer */}
              <p className="text-[10px] text-muted-foreground italic border-t border-border/40 pt-1">
                Canonical farmer breakdown record remains unmodified. Translation is temporary and
                generated on-device.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
