import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type EquipmentRow = Database["public"]["Tables"]["equipment"]["Row"];
export type EquipmentType = Database["public"]["Enums"]["equipment_type"];
export type EquipmentStatus = Database["public"]["Enums"]["equipment_status"];

export interface CreateEquipmentInput {
  type: EquipmentType;
  make: string;
  model: string;
  year?: number | null;
  serial_number: string;
  operating_hours?: number;
  photo_url?: string | null;
}

/**
 * Resolves the authenticated user's profile ID and role.
 * Ensures caller identity is verified against Supabase Auth.
 */
async function getAuthenticatedProfile(): Promise<{ id: string; role: string }> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error("Authentication required: Please sign in to manage equipment.");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role")
    .or(`auth_user_id.eq.${user.id},id.eq.${user.id}`)
    .maybeSingle();

  if (profileError || !profile) {
    throw new Error("User profile not found. Please ensure your profile is initialized.");
  }

  return profile;
}

/**
 * Fetches all agricultural machinery owned by the authenticated farmer.
 * Protected by PostgreSQL RLS: Equipment view policy restricts rows to the caller's profile.
 */
export async function getFarmerEquipment(): Promise<EquipmentRow[]> {
  // Ensure session exists
  await getAuthenticatedProfile();

  const { data, error } = await supabase
    .from("equipment")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load equipment: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Registers a new piece of equipment for the authenticated farmer.
 * Derives the farmer_id strictly from the authenticated user's profile.
 * Protected by PostgreSQL RLS: Farmers can insert own equipment with check (farmer_id = current_profile_id()).
 */
export async function createEquipment(input: CreateEquipmentInput): Promise<EquipmentRow> {
  const profile = await getAuthenticatedProfile();

  if (profile.role !== "farmer" && profile.role !== "admin") {
    throw new Error("Unauthorized: Only registered farmers can add equipment.");
  }

  // Validate inputs
  const make = input.make.trim();
  const model = input.model.trim();
  const serialNumber = input.serial_number.trim();

  if (!make) throw new Error("Equipment manufacturer (make) is required.");
  if (!model) throw new Error("Equipment model is required.");
  if (!serialNumber) throw new Error("Registration or serial/chassis number is required.");

  if (input.year !== undefined && input.year !== null) {
    if (input.year < 1970 || input.year > 2100) {
      throw new Error("Year must be between 1970 and 2100.");
    }
  }

  if (input.operating_hours !== undefined && input.operating_hours !== null) {
    if (input.operating_hours < 0) {
      throw new Error("Operating hours cannot be negative.");
    }
  }

  const { data, error } = await supabase
    .from("equipment")
    .insert({
      farmer_id: profile.id,
      type: input.type,
      make,
      model,
      year: input.year ?? null,
      serial_number: serialNumber,
      operating_hours: input.operating_hours ?? 0,
      photo_url: input.photo_url ?? null,
      status: "Operational",
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to register equipment: ${error.message}`);
  }

  return data;
}

/**
 * Fetches a single equipment record by its unique identifier.
 * Protected by PostgreSQL RLS: Only the owning farmer or authorized service staff can read the record.
 */
export async function getEquipmentById(id: string): Promise<EquipmentRow | null> {
  if (!id) throw new Error("Equipment ID is required.");

  const { data, error } = await supabase
    .from("equipment")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load equipment details: ${error.message}`);
  }

  return data;
}
