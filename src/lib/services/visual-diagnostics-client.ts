import {
  DIAGNOSTIC_LIMITS,
  type GeminiDiagnosticResponse,
  type VisualDiagnosticsData,
} from "../types/visual-diagnostics.ts";

export interface PhotoValidationResult {
  valid: boolean;
  error?: string;
}

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * Validates a photo file against Phase 11 format and size boundaries.
 * Enforces JPEG/PNG/WebP and strictly <= 4 MB per photo.
 */
export function validateDiagnosticPhoto(file: {
  name?: string;
  type?: string;
  size?: number;
}): PhotoValidationResult {
  if (!file) {
    return { valid: false, error: "No photo file provided." };
  }

  const mime = file.type?.toLowerCase();
  if (!ALLOWED_MIME_TYPES.includes(mime as (typeof ALLOWED_MIME_TYPES)[number])) {
    return {
      valid: false,
      error: `Unsupported image format (${file.type || "unknown"}). Please upload a JPEG, PNG, or WebP photo.`,
    };
  }

  if (typeof file.size === "number" && file.size > DIAGNOSTIC_LIMITS.MAX_RAW_PHOTO_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `Photo is too large (${sizeMb} MB). Maximum allowed size is 4.0 MB.`,
    };
  }

  return { valid: true };
}

/**
 * Validates a list of photos before submission (max 4 photos, each valid).
 */
export function validatePhotoBatch(
  currentPhotos: string[],
  newCount: number = 0,
): PhotoValidationResult {
  if (currentPhotos.length + newCount > DIAGNOSTIC_LIMITS.MAX_PHOTOS) {
    return {
      valid: false,
      error: `Maximum ${DIAGNOSTIC_LIMITS.MAX_PHOTOS} photos allowed per breakdown report.`,
    };
  }
  return { valid: true };
}

export interface TriggerDiagnosticResult {
  success: boolean;
  status?: string;
  data?: GeminiDiagnosticResponse;
  error?: string;
  details?: string;
  retryAfterSeconds?: number;
}

/**
 * Helper to dynamically load Supabase client at runtime.
 */
async function getSupabase() {
  const mod = await import("@/integrations/supabase/client");
  return mod.supabase;
}

/**
 * Triggers server-side visual defect analysis for a repair ticket.
 * Sends the authenticated session token to /api/assess-visual-defect.
 */
export async function triggerVisualDiagnostic(
  repairRequestId: string,
  forceRescan: boolean = false,
): Promise<TriggerDiagnosticResult> {
  if (!repairRequestId) {
    return {
      success: false,
      error: "INVALID_ARGUMENT",
      details: "Missing repair request identifier.",
    };
  }

  try {
    const supabase = await getSupabase();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      return {
        success: false,
        error: "UNAUTHENTICATED",
        details: "You must be signed in to request visual diagnostics.",
      };
    }

    const res = await fetch("/api/assess-visual-defect", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        repairRequestId,
        forceRescan,
      }),
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        success: false,
        status: body.status || "FAILED",
        error: body.error || "DIAGNOSTIC_REQUEST_FAILED",
        details: body.details || `Server responded with status ${res.status}.`,
        retryAfterSeconds: body.retryAfterSeconds,
      };
    }

    return {
      success: true,
      status: body.status || "ANALYZED",
      data: body.data,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Network error during visual diagnostic call.";
    return {
      success: false,
      error: "NETWORK_ERROR",
      details: msg,
    };
  }
}

/**
 * Grants AI visual diagnostic consent for a repair request.
 * Strictly callable by the owning farmer under RLS.
 */
export async function grantFarmerVisualConsent(
  repairRequestId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc("grant_repair_visual_consent", {
      p_repair_request_id: repairRequestId,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const res = data as { success?: boolean; error?: string };
    if (!res?.success) {
      return { success: false, error: res?.error || "Failed to grant consent." };
    }

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Error granting consent.",
    };
  }
}

/**
 * Revokes AI visual diagnostic consent for a repair request.
 * Callable by the owning farmer or administrator under RLS.
 */
export async function revokeFarmerVisualConsent(
  repairRequestId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc("revoke_repair_visual_consent", {
      p_repair_request_id: repairRequestId,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const res = data as { success?: boolean; error?: string };
    if (!res?.success) {
      return { success: false, error: res?.error || "Failed to revoke consent." };
    }

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Error revoking consent.",
    };
  }
}

/**
 * Extracts and normalizes visualDiagnostics data from a repair request assessment payload.
 */
export function extractVisualDiagnostics(assessment: unknown): VisualDiagnosticsData | null {
  if (typeof assessment !== "object" || assessment === null) {
    return null;
  }
  const vd = (assessment as Record<string, unknown>)["visualDiagnostics"];
  if (typeof vd !== "object" || vd === null) {
    return null;
  }
  return vd as VisualDiagnosticsData;
}
