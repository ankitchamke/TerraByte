import { supabase } from "@/integrations/supabase/client";

export interface UpdateProfileInput {
  fullName: string;
  phone?: string | null;
  village?: string | null;
}

export interface UpdateTechnicianWorkshopInput {
  workshopName: string;
  workshopPhone?: string | null;
}

/**
 * Updates the authenticated user's own profile record in public.profiles.
 * Enforces strict field whitelist to prevent touching security-sensitive fields (role, is_verified, etc.).
 */
export async function updateProfile(input: UpdateProfileInput): Promise<void> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error("Authentication required. Please sign in to update your profile.");
  }

  const trimmedName = input.fullName.trim();
  if (!trimmedName) {
    throw new Error("Full name is required.");
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: trimmedName,
      phone: input.phone?.trim() || null,
      village: input.village?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .or(`auth_user_id.eq.${user.id},id.eq.${user.id}`);

  if (error) {
    console.error("[TerraByte] Error updating profile:", error);
    throw new Error("Failed to update profile. Please try again.");
  }
}

/**
 * Updates the authenticated technician's workshop details in public.technician_profiles.
 */
export async function updateTechnicianWorkshop(input: UpdateTechnicianWorkshopInput): Promise<void> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error("Authentication required. Please sign in to update workshop details.");
  }

  const trimmedWorkshop = input.workshopName.trim();
  if (!trimmedWorkshop) {
    throw new Error("Workshop name is required.");
  }

  // Resolve technician's profile ID
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .or(`auth_user_id.eq.${user.id},id.eq.${user.id}`)
    .maybeSingle();

  if (profileError || !profile) {
    throw new Error("Technician profile record could not be found.");
  }

  const { error } = await supabase
    .from("technician_profiles")
    .update({
      workshop_name: trimmedWorkshop,
      phone: input.workshopPhone?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .or(`profile_id.eq.${profile.id},id.eq.${profile.id}`);

  if (error) {
    console.error("[TerraByte] Error updating workshop details:", error);
    throw new Error("Failed to update workshop details. Please try again.");
  }
}

/**
 * Fetches technician workshop details for the currently signed-in technician.
 */
export async function getTechnicianWorkshopDetails(): Promise<{
  workshop_name: string;
  phone: string | null;
} | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .or(`auth_user_id.eq.${user.id},id.eq.${user.id}`)
    .maybeSingle();

  if (!profile) return null;

  const { data: tech, error } = await supabase
    .from("technician_profiles")
    .select("workshop_name, phone")
    .or(`profile_id.eq.${profile.id},id.eq.${profile.id}`)
    .maybeSingle();

  if (error) {
    console.warn("[TerraByte] Could not fetch technician workshop details:", error);
    return null;
  }

  return tech ?? null;
}

/**
 * Permanently deletes or anonymizes the authenticated user's account via the secure RPC.
 * Automatically checks active repair restrictions, demo status, and unlinks/purges credentials.
 */
export async function deleteUserAccount(): Promise<void> {
  const { data, error } = await supabase.rpc("delete_user_account");

  if (error) {
    console.error("[TerraByte] Account deletion error:", error);
    const msg = error.message || "";
    if (msg.includes("active repair requests in progress")) {
      throw new Error(
        "Cannot delete your account while you have active repair requests in progress. Please complete or cancel all open repairs before deleting your account."
      );
    }
    if (msg.includes("assigned to active repair jobs")) {
      throw new Error(
        "Cannot delete your account while you are assigned to active repair jobs. Please complete or resolve all open jobs before deleting your account."
      );
    }
    if (msg.includes("Demo evaluation accounts cannot be deleted")) {
      throw new Error("Demo evaluation accounts cannot be deleted.");
    }
    if (msg.includes("administrator accounts cannot be self-deleted")) {
      throw new Error("Service Centre administrator accounts cannot be self-deleted.");
    }
    throw new Error(error.message || "Failed to delete account. Please try again.");
  }

  if (data && typeof data === "object" && "success" in data && !(data as any).success) {
    throw new Error((data as { message?: string }).message || "Failed to delete account.");
  }
}
