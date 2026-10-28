import { supabase } from "../../integrations/supabase/client";

/**
 * The exact three canonical demo persona emails authorized for database reset.
 */
export const DESIGNATED_DEMO_EMAILS = [
  "farmer.nagpur@terrabyte.demo",
  "tech.nagpur@terrabyte.demo",
  "admin.nagpur@terrabyte.demo",
] as const;

export type DesignatedDemoEmail = (typeof DESIGNATED_DEMO_EMAILS)[number];

/**
 * Checks whether the specified email belongs to one of the 3 designated demo evaluation personas.
 * Returns false for null, undefined, real user emails, or arbitrary domains.
 */
export function isDesignatedDemoAccount(email?: string | null): boolean {
  if (!email) return false;
  const clean = email.trim().toLowerCase();
  return (DESIGNATED_DEMO_EMAILS as readonly string[]).includes(clean);
}

export interface ResetDemoResponse {
  success: boolean;
  message: string;
  details?: {
    repairs_deleted?: number;
    equipment_reset?: number;
    service_history_deleted?: number;
    notifications_deleted?: number;
  };
}

/**
 * Calls the public.reset_demo_data() database RPC with ZERO client parameters.
 * Cleans up demo test activity and deterministically restores clean baseline records.
 */
export async function resetDemoData(): Promise<ResetDemoResponse> {
  const { data, error } = await supabase.rpc("reset_demo_data");

  if (error) {
    console.error("[TerraByte] Reset demo error:", error);
    const msg = error.message || "";
    if (msg.includes("designated demo evaluation personas")) {
      throw new Error("Demo reset is not available for this account.");
    }
    throw new Error(error.message || "Failed to reset demo data. Please try again.");
  }

  if (data && typeof data === "object" && "success" in data && !(data as any).success) {
    throw new Error((data as { message?: string }).message || "Failed to reset demo data.");
  }

  return (
    (data as unknown as ResetDemoResponse) ?? {
      success: true,
      message: "Demo environment reset to clean baseline successfully.",
    }
  );
}
