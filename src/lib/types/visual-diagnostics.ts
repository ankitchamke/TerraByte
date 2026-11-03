import { z } from "zod";

/**
 * Diagnostic State Machine Status Enum
 */
export type VisualDiagnosticStatus =
  | "NOT_REQUESTED"
  | "PROCESSING"
  | "ANALYZED"
  | "RETRYABLE_ERROR"
  | "FAILED"
  | "SKIPPED"
  | "DEMO_SAMPLE";

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";
export type DefectSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

/**
 * Zod Schema for Structured Output from Gemini
 */
export const VisualAnomalySchema = z.object({
  system: z.string().min(1).max(100),
  defectType: z.string().min(1).max(100),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  observation: z.string().min(1).max(500),
  recommendation: z.string().min(1).max(500),
});

export const StagedPartCandidateSchema = z.object({
  partNumber: z.string().min(1).max(50),
  estimatedQuantity: z.number().int().min(1).max(10).default(1),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  reasoning: z.string().max(500).default(""),
});

export const VisualDiagnosticResponseSchema = z.object({
  visualConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  overallVisualSummary: z.string().min(1).max(2000),
  visualAnomalies: z.array(VisualAnomalySchema).max(10).default([]),
  stagedParts: z.array(StagedPartCandidateSchema).max(10).default([]),
  safetyGuidance: z.array(z.string().max(300)).max(10).default([]),
});

export type VisualAnomaly = z.infer<typeof VisualAnomalySchema>;
export type StagedPartCandidate = z.infer<typeof StagedPartCandidateSchema>;
export type GeminiDiagnosticResponse = z.infer<typeof VisualDiagnosticResponseSchema>;

/**
 * Authoritative Staged Part stored in repair_requests.assessment
 */
export interface StagedPart {
  partId: string;
  partNumber: string;
  name: string;
  category: string;
  currentStock: number;
  unitPrice: number;
  estimatedQuantity: number;
  confidence: ConfidenceLevel;
  reasoning: string;
}

/**
 * Full visualDiagnostics JSONB structure
 */
export interface VisualDiagnosticsData {
  status: VisualDiagnosticStatus;
  claim_token?: string | null;
  claimed_at?: string | null;
  claimedByProfileId?: string | null;
  executedByProfileId?: string | null;
  analyzedAt?: string | null;
  lastAttemptAt?: string | null;
  attempts?: number;
  rescan_count?: number;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  visualConfidence?: ConfidenceLevel;
  overallVisualSummary?: string;
  visualAnomalies?: VisualAnomaly[];
  stagedParts?: StagedPart[];
  safetyGuidance?: string[];
  consent?: {
    optInGranted: boolean;
    consentedAt?: string;
    consentPolicyVersion?: string;
    withdrawnAt?: string | null;
  };
  history?: Array<Record<string, unknown>>;
  reason?: string;
}

/**
 * Allowlisted error codes for safe, sanitized failure finalization
 */
export const ALLOWED_DIAGNOSTIC_ERROR_CODES = [
  "TIMEOUT",
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "SCHEMA_VALIDATION_ERROR",
  "CONFIG_ERROR",
  "NETWORK_ERROR",
  "UNEXPECTED_ERROR",
] as const;

export type AllowlistedDiagnosticErrorCode =
  (typeof ALLOWED_DIAGNOSTIC_ERROR_CODES)[number];

export function getSanitizedErrorMessage(code: AllowlistedDiagnosticErrorCode): string {
  switch (code) {
    case "TIMEOUT":
      return "Diagnostic service request timed out. You may retry.";
    case "RATE_LIMITED":
      return "Diagnostic capacity limit reached. Please retry after a brief pause.";
    case "PROVIDER_UNAVAILABLE":
      return "External vision analysis service is temporarily unavailable.";
    case "SCHEMA_VALIDATION_ERROR":
      return "Diagnostic response schema validation failed.";
    case "CONFIG_ERROR":
      return "Diagnostic service configuration error. Contact administrator.";
    case "NETWORK_ERROR":
      return "Network connection issue during diagnostic request.";
    case "UNEXPECTED_ERROR":
    default:
      return "An unexpected error occurred during visual diagnostic execution.";
  }
}

/**
 * Concrete Payload Size Boundaries (Up to 4 photos, bounded before and after Base64)
 */
export const DIAGNOSTIC_LIMITS = {
  MAX_PHOTOS: 4,
  MAX_RAW_PHOTO_BYTES: 4 * 1024 * 1024, // 4 MB per photo
  MAX_BASE64_PHOTO_CHARS: 5.6 * 1024 * 1024, // ~5.6 MB after Base64
  MAX_TOTAL_PAYLOAD_BYTES: 16 * 1024 * 1024, // 16 MB aggregate
  GEMINI_TIMEOUT_MS: 9000, // 9 seconds application SLA timeout
  CONSENT_POLL_INTERVAL_MS: 750, // 750 ms non-overlapping polling interval
} as const;
