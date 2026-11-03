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

  const { data: sessionData } = await supabase.rpc("get_session_profile");
  const sessionProfile = sessionData && sessionData.length > 0 ? sessionData[0] : null;
  const profileId = sessionProfile?.id || user.id;

  const trimmedName = input.fullName.trim();
  if (!trimmedName) {
    throw new Error("Full name is required.");
  }

<<<<<<< Updated upstream
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: trimmedName,
      phone: input.phone?.trim() || null,
      village: input.village?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .or(`auth_user_id.eq.${user.id},id.eq.${user.id}`);
=======
  const updateData: {
    full_name: string;
    phone?: string | null;
    village?: string | null;
    updated_at: string;
  } = {
    full_name: trimmedName,
    updated_at: new Date().toISOString(),
  };

  if (input.phone !== undefined) {
    updateData.phone = input.phone?.trim() || null;
  }

  if (input.village !== undefined) {
    const trimmedVillage = input.village?.trim();
    if (trimmedVillage) {
      updateData.village = trimmedVillage;
    } else {
      // Do not overwrite an existing saved farmer profile location with an empty value
      const { data: existingProfile } = await supabase
        .from("profiles")
        .select("village")
        .eq("id", profileId)
        .maybeSingle();

      if (!existingProfile?.village) {
        updateData.village = null;
      }
      // If existingProfile has a saved village, leave it unchanged
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update(updateData)
    .eq("id", profileId);
>>>>>>> Stashed changes

  if (error) {
    console.error("[TerraByte] Error updating profile:", error);
    throw new Error("Failed to update profile. Please try again.");
  }

  // Dual-write into profile_contacts
  const contactsUpdate = {
    profile_id: profileId,
    phone: (updateData.phone !== undefined ? updateData.phone : sessionProfile?.phone) ?? null,
    village: (updateData.village !== undefined ? updateData.village : sessionProfile?.village) ?? null,
    updated_at: updateData.updated_at,
  };

  const { error: contactsError } = await supabase
    .from("profile_contacts")
    .upsert(contactsUpdate);

  if (contactsError) {
    console.warn("[TerraByte] Warning: Error updating profile_contacts:", contactsError);
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
  const { data: sessionData, error: sessionError } = await supabase.rpc("get_session_profile");
  const profile = sessionData && sessionData.length > 0 ? sessionData[0] : null;

  if (sessionError || !profile) {
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

  const { data: sessionData } = await supabase.rpc("get_session_profile");
  const profile = sessionData && sessionData.length > 0 ? sessionData[0] : null;

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
