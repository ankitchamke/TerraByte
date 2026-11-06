import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DIAGNOSTIC_LIMITS,
  VisualDiagnosticResponseSchema,
  getSanitizedErrorMessage,
  type AllowlistedDiagnosticErrorCode,
  type GeminiDiagnosticResponse,
} from "@/lib/types/visual-diagnostics";
import type { Database } from "@/integrations/supabase/types";

const SELECTED_FREE_MODEL = "gemini-3.5-flash-lite";

interface ExecuteDiagnosticParams {
  supabaseAdmin: SupabaseClient<Database>;
  repairRequestId: string;
  claimToken: string;
  executorProfileId: string;
  equipment: {
    make: string;
    model: string;
    year?: number | null;
  };
  symptoms: string[];
  description: string;
  photos: string[];
}

export interface DiagnosticServiceResult {
  success: boolean;
  status: "ANALYZED" | "RETRYABLE_ERROR" | "FAILED" | "SKIPPED";
  error?: string;
  details?: string;
  data?: GeminiDiagnosticResponse;
}

/**
 * Validates, bounds, and normalizes a base64 photo Data URL.
 */
function sanitizePhotoDataUrl(
  photoUrl: string,
  index: number,
): { mimeType: string; base64Data: string } {
  if (typeof photoUrl !== "string" || photoUrl.length === 0) {
    throw new Error(`Photo ${index + 1} is empty or not a string.`);
  }

  // Check character length boundary after Base64 encoding
  if (photoUrl.length > DIAGNOSTIC_LIMITS.MAX_BASE64_PHOTO_CHARS) {
    throw new Error(`Photo ${index + 1} exceeds maximum size limit (4MB).`);
  }

  const match = photoUrl.match(/^data:(image\/[a-zA-Z0-9.+_-]+);base64,(.+)$/);
  if (!match) {
    // If raw base64 without prefix, default to image/jpeg
    return {
      mimeType: "image/jpeg",
      base64Data: photoUrl.trim(),
    };
  }

  const [, mimeType, base64Data] = match;
  const normalizedMime = mimeType?.toLowerCase() ?? "image/jpeg";
  if (!["image/jpeg", "image/png", "image/webp"].includes(normalizedMime)) {
    throw new Error(`Photo ${index + 1} has unsupported format: ${normalizedMime}. Expected JPEG, PNG, or WebP.`);
  }

  return {
    mimeType: normalizedMime,
    base64Data: base64Data?.trim() ?? "",
  };
}

/**
 * Builds the diagnostic prompt including machinery context and Central Nagpur Depot catalog context.
 */
function buildDiagnosticPrompt(
  equipment: { make: string; model: string; year?: number | null },
  symptoms: string[],
  description: string,
): string {
  return `You are a certified agricultural equipment mechanical diagnostic specialist inspecting breakdown photographs for field dispatch.

Machinery Under Inspection:
- Make: ${equipment.make}
- Model: ${equipment.model}
${equipment.year ? `- Year: ${equipment.year}` : ""}

Reported Symptoms:
${symptoms.map((s) => `- ${s}`).join("\n")}

Farmer's Stated Problem:
"${description || "No additional description provided."}"

Canonical Central Nagpur Depot Catalog Context:
- Part 0433171: Fuel Injector Nozzle Set (Bosch 0433171 x4) [Compatible: Mahindra 575 DI]
- Part 005556958R1: Inline Fuel Filter (Mahindra 005556958R1) [Compatible: Mahindra 575 DI]
- Part AL120788: Lift Cylinder Seal Kit (JD AL120788) [Compatible: John Deere 5050D]
- Part HY-GARD-15W30: Hydraulic Oil 15W-30 (JD Hy-Gard, litres) [Compatible: John Deere 5050D]
- Part 26243171: Starter Motor Assembly (Lucas-TVS 12V 2.2kW) [Compatible: Mahindra 575 DI, Swaraj 744 FE]
- Part TB-FLT-001: Oil Filter Cartridge [Compatible: John Deere 5050 D, Mahindra 575 DI]
- Part TB-BLT-002: Alternator Drive Belt [Compatible: John Deere 5050 D]
- Part TB-HYD-003: Hydraulic Hose Assembly [Compatible: Universal]

Instructions:
1. Examine the provided machinery photographs carefully. Identify visible anomalies, fluid leaks, mechanical fractures, wiring burn marks, or wear.
2. Determine if any catalog parts match the machine model and observable defect. If none match or compatibility cannot be established, provide an empty stagedParts array.
3. Provide essential safety guidance for field technicians (e.g. pressure release, battery disconnection, wheel chocking).
4. Return ONLY valid JSON adhering strictly to this schema:
{
  "visualConfidence": "HIGH" | "MEDIUM" | "LOW",
  "overallVisualSummary": "Concise technical summary of visual findings (max 1000 chars)",
  "visualAnomalies": [
    {
      "system": "Hydraulics" | "Electrical" | "Fuel system" | "Engine" | "Transmission" | "Chassis",
      "defectType": "Fluid leak" | "Crack" | "Corrosion" | "Loose fitting" | "Component failure",
      "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
      "observation": "Detailed observable anomaly",
      "recommendation": "Technical remediation advice"
    }
  ],
  "stagedParts": [
    {
      "partNumber": "0433171" | "005556958R1" | "AL120788" | "HY-GARD-15W30" | "26243171" | "TB-FLT-001" | "TB-BLT-002" | "TB-HYD-003",
      "estimatedQuantity": 1,
      "confidence": "HIGH" | "MEDIUM" | "LOW",
      "reasoning": "Technical justification for staging this part"
    }
  ],
  "safetyGuidance": [
    "Safety instructions before touching machinery"
  ]
}`;
}

/**
 * Executes multimodal vision diagnostics against Google Gemini 3.5 Flash-Lite (Free Tier)
 * with strict in-flight consent monitoring and atomic service-role finalization.
 */
export async function executeVisualDefectDiagnostic(
  params: ExecuteDiagnosticParams,
): Promise<DiagnosticServiceResult> {
  const {
    supabaseAdmin,
    repairRequestId,
    claimToken,
    executorProfileId,
    equipment,
    symptoms,
    description,
    photos,
  } = params;

  // 1. Check Gemini API configuration (Optional free-tier key)
  const rawApiKey = process.env["GEMINI_API_KEY"];
  const apiKey = rawApiKey ? rawApiKey.trim().replace(/^["']|["']$/g, "") : "";
  if (!apiKey || apiKey.length === 0) {
    const errorCode: AllowlistedDiagnosticErrorCode = "CONFIG_ERROR";
    const errorMessage = getSanitizedErrorMessage(errorCode);

    await supabaseAdmin.rpc("finalize_repair_visual_diagnostic_failure", {
      p_repair_request_id: repairRequestId,
      p_claim_token: claimToken,
      p_error_code: errorCode,
      p_error_message: errorMessage,
      p_is_terminal: true,
    });

    return {
      success: false,
      status: "FAILED",
      error: errorCode,
      details: errorMessage,
    };
  }

  // 2. Validate and prepare photo inputs (Process up to 4 photos, zero dropped)
  if (!photos || photos.length === 0) {
    const errorCode: AllowlistedDiagnosticErrorCode = "SCHEMA_VALIDATION_ERROR";
    const errorMessage = "No photos available for visual defect analysis.";

    await supabaseAdmin.rpc("finalize_repair_visual_diagnostic_failure", {
      p_repair_request_id: repairRequestId,
      p_claim_token: claimToken,
      p_error_code: errorCode,
      p_error_message: errorMessage,
      p_is_terminal: true,
    });

    return {
      success: false,
      status: "FAILED",
      error: errorCode,
      details: errorMessage,
    };
  }

  const boundedPhotos = photos.slice(0, DIAGNOSTIC_LIMITS.MAX_PHOTOS);
  let totalBytesEstimate = 0;
  const imageParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];

  try {
    for (let i = 0; i < boundedPhotos.length; i++) {
      const photo = boundedPhotos[i];
      if (!photo) continue;
      const { mimeType, base64Data } = sanitizePhotoDataUrl(photo, i);
      totalBytesEstimate += base64Data.length * 0.75;
      if (totalBytesEstimate > DIAGNOSTIC_LIMITS.MAX_TOTAL_PAYLOAD_BYTES) {
        throw new Error("Aggregate photo payload exceeds maximum size limit (16MB).");
      }
      imageParts.push({
        inlineData: {
          mimeType,
          data: base64Data,
        },
      });
    }
  } catch (err: unknown) {
    const errorCode: AllowlistedDiagnosticErrorCode = "SCHEMA_VALIDATION_ERROR";
    const errorMessage = err instanceof Error ? err.message : "Malformed image payload.";

    await supabaseAdmin.rpc("finalize_repair_visual_diagnostic_failure", {
      p_repair_request_id: repairRequestId,
      p_claim_token: claimToken,
      p_error_code: errorCode,
      p_error_message: errorMessage,
      p_is_terminal: true,
    });

    return {
      success: false,
      status: "FAILED",
      error: errorCode,
      details: errorMessage,
    };
  }

  // 3. Setup Concurrent Cancellation Guard (Application SLA timeout + 750ms Consent Poller)
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort(new Error("APPLICATION_SLA_TIMEOUT"));
  }, DIAGNOSTIC_LIMITS.GEMINI_TIMEOUT_MS);

  let pollIntervalId: NodeJS.Timeout | null = null;
  let inFlightPollActive = false;
  let consentRevoked = false;

  try {
    pollIntervalId = setInterval(async () => {
      if (inFlightPollActive || abortController.signal.aborted) {
        return;
      }
      inFlightPollActive = true;
      try {
        const { data: row, error: pollError } = await supabaseAdmin
          .from("repair_requests")
          .select("assessment")
          .eq("id", repairRequestId)
          .maybeSingle();

        if (pollError || !row) {
          abortController.abort(new Error("CONSENT_POLL_DB_ERROR"));
          return;
        }

        const assessment = (row.assessment ?? {}) as Record<string, unknown>;
        const vd = (assessment["visualDiagnostics"] ?? {}) as Record<string, unknown>;
        const consent = (vd["consent"] ?? {}) as Record<string, unknown>;
        const optInGranted = consent["optInGranted"] === true;

        if (!optInGranted || vd["status"] === "SKIPPED") {
          consentRevoked = true;
          abortController.abort(new Error("CONSENT_REVOKED_IN_FLIGHT"));
        }
      } catch {
        abortController.abort(new Error("CONSENT_POLL_EXCEPTION"));
      } finally {
        inFlightPollActive = false;
      }
    }, DIAGNOSTIC_LIMITS.CONSENT_POLL_INTERVAL_MS);

    // 4. Construct Gemini REST Request (Fixed Free Model: gemini-3.5-flash-lite)
    const promptText = buildDiagnosticPrompt(equipment, symptoms, description);
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${SELECTED_FREE_MODEL}:generateContent?key=${apiKey}`;

    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [
            ...imageParts,
            { text: promptText },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    };

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: abortController.signal,
    });

    // 5. Handle HTTP Status Responses
    if (!response.ok) {
      let errorCode: AllowlistedDiagnosticErrorCode = "PROVIDER_UNAVAILABLE";
      let isTerminal = false;

      if (response.status === 429) {
        errorCode = "RATE_LIMITED";
        isTerminal = false;
      } else if (response.status === 400 || response.status === 404) {
        errorCode = "CONFIG_ERROR";
        isTerminal = true;
      } else if (response.status >= 500) {
        errorCode = "PROVIDER_UNAVAILABLE";
        isTerminal = false;
      }

      const errorMessage = getSanitizedErrorMessage(errorCode);
      const { data: failResult } = await supabaseAdmin.rpc(
        "finalize_repair_visual_diagnostic_failure",
        {
          p_repair_request_id: repairRequestId,
          p_claim_token: claimToken,
          p_error_code: errorCode,
          p_error_message: errorMessage,
          p_is_terminal: isTerminal,
        },
      );

      const targetStatus = (failResult as { status?: string })?.status === "FAILED" ? "FAILED" : "RETRYABLE_ERROR";
      return {
        success: false,
        status: targetStatus,
        error: errorCode,
        details: errorMessage,
      };
    }

    const rawData = await response.json();
    const candidateText =
      rawData?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!candidateText || typeof candidateText !== "string") {
      throw new Error("EMPTY_GEMINI_RESPONSE");
    }

    // 6. Validate Output via Zod Schema
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(candidateText);
    } catch {
      throw new Error("MALFORMED_JSON_FROM_GEMINI");
    }

    const validatedResult = VisualDiagnosticResponseSchema.parse(parsedJson);

    // 7. Atomic Service-Role Save (Enforces claim metadata match & model catalogue compatibility)
    const { data: saveResult, error: saveError } = await supabaseAdmin.rpc(
      "save_repair_visual_diagnostic",
      {
        p_repair_request_id: repairRequestId,
        p_claim_token: claimToken,
        p_executed_by_profile_id: executorProfileId,
        p_diagnostic_payload: {
          status: "ANALYZED",
          ...validatedResult,
        },
      },
    );

    if (saveError || !(saveResult as { success?: boolean })?.success) {
      const errCode = (saveResult as { error?: string })?.error ?? "SAVE_FAILED";
      if (errCode === "CONSENT_WITHDRAWN_DURING_EXECUTION") {
        return {
          success: false,
          status: "SKIPPED",
          error: "CONSENT_WITHDRAWN",
          details: "Consent was withdrawn before result finalization.",
        };
      }

      throw new Error(`DATABASE_SAVE_FAILED: ${errCode}`);
    }

    return {
      success: true,
      status: "ANALYZED",
      data: validatedResult,
    };

  } catch (err: unknown) {
    // 8. Error Handling & In-Flight Cancellation Finalization
    if (consentRevoked) {
      return {
        success: false,
        status: "SKIPPED",
        error: "CONSENT_WITHDRAWN",
        details: "Analysis cancelled in-flight due to farmer consent withdrawal.",
      };
    }

    let errorCode: AllowlistedDiagnosticErrorCode = "UNEXPECTED_ERROR";
    let isTerminal = false;

    if (err instanceof Error) {
      if (err.name === "AbortError" || err.message.includes("TIMEOUT")) {
        errorCode = "TIMEOUT";
        isTerminal = false;
      } else if (err.message.includes("MALFORMED_JSON") || err.message.includes("EMPTY_GEMINI") || err.name === "ZodError") {
        errorCode = "SCHEMA_VALIDATION_ERROR";
        isTerminal = false;
      } else if (err.message.includes("fetch") || err.message.includes("Network")) {
        errorCode = "NETWORK_ERROR";
        isTerminal = false;
      }
    }

    const errorMessage = getSanitizedErrorMessage(errorCode);
    const { data: failResult } = await supabaseAdmin.rpc(
      "finalize_repair_visual_diagnostic_failure",
      {
        p_repair_request_id: repairRequestId,
        p_claim_token: claimToken,
        p_error_code: errorCode,
        p_error_message: errorMessage,
        p_is_terminal: isTerminal,
      },
    );

    const targetStatus = (failResult as { status?: string })?.status === "FAILED" ? "FAILED" : "RETRYABLE_ERROR";
    return {
      success: false,
      status: targetStatus,
      error: errorCode,
      details: errorMessage,
    };

  } finally {
    clearTimeout(timeoutId);
    if (pollIntervalId !== null) {
      clearInterval(pollIntervalId);
      pollIntervalId = null;
    }
  }
}
