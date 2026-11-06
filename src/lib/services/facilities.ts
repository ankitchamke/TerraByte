import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

export type FacilityRole = "OWNER" | "MANAGER" | "TECHNICIAN";
export type MembershipStatus = "ACTIVE" | "INVITED" | "SUSPENDED" | "RESIGNED";

export interface OperatingHours {
  open: string;
  close: string;
  days: string[];
}

export const VIDARBHA_TAHSILS = [
  "Nagpur",
  "Hingna",
  "Katol",
  "Kalmeshwar",
  "Saoner",
  "Ramtek",
  "Umred",
  "Narkhed",
  "Kuhi",
  "Bhiwapur",
  "Mouda",
  "Kamptee",
  "Parseoni",
] as const;

export type VidarbhaTahsil = (typeof VIDARBHA_TAHSILS)[number];

export const TAHSIL_COORDINATES: Record<string, { lat: number; lng: number }> = {
  Nagpur: { lat: 21.1458, lng: 79.0882 },
  Hingna: { lat: 21.0965, lng: 79.0012 },
  Katol: { lat: 21.2787, lng: 78.5867 },
  Kalmeshwar: { lat: 21.2333, lng: 78.9167 },
  Saoner: { lat: 21.3833, lng: 78.9167 },
  Ramtek: { lat: 21.3967, lng: 79.3283 },
  Umred: { lat: 20.8542, lng: 79.3256 },
  Narkhed: { lat: 21.4667, lng: 78.5333 },
  Kuhi: { lat: 21.0167, lng: 79.3667 },
  Bhiwapur: { lat: 20.7667, lng: 79.5167 },
  Mouda: { lat: 21.1667, lng: 79.4167 },
  Kamptee: { lat: 21.2227, lng: 79.1994 },
  Parseoni: { lat: 21.3833, lng: 79.1833 },
};

export interface SafeFacility {
  id: string;
  name: string;
  village: string;
  tahsil: string;
  operating_hours: OperatingHours | Json;
  drop_off_approved: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DetailedFacility extends SafeFacility {
  owner_profile_id: string;
  phone: string;
  email: string | null;
  address: string;
  latitude: number;
  longitude: number;
  max_equipment_capacity: number;
  drop_off_approved_at: string | null;
  drop_off_approved_by: string | null;
}

export interface AffiliatedFacility {
  membership_id: string;
  facility_id: string;
  role: FacilityRole;
  status: MembershipStatus;
  joined_at: string | null;
  facility: SafeFacility;
  management_details?: DetailedFacility | null;
}

export interface FacilityMemberWithProfile {
  id: string;
  facility_id: string;
  technician_profile_id: string;
  role: FacilityRole;
  status: MembershipStatus;
  joined_at: string | null;
  created_at: string;
  profile: {
    id: string;
    full_name: string;
    phone: string | null;
    village: string | null;
  } | null;
}

export interface RegisterFacilityInput {
  name: string;
  address: string;
  village: string;
  tahsil: string;
  phone: string;
  email?: string | null;
  latitude: number;
  longitude: number;
  max_equipment_capacity?: number;
  operating_hours?: OperatingHours;
}

export interface UpdateFacilityInput {
  name?: string;
  address?: string;
  village?: string;
  tahsil?: string;
  phone?: string;
  email?: string | null;
  latitude?: number;
  longitude?: number;
  max_equipment_capacity?: number;
  operating_hours?: OperatingHours;
}

/**
 * Resolves the authenticated user's profile ID and role.
 */
async function getAuthenticatedProfile(): Promise<{ id: string; role: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const sessionUser = session?.user;
  const user = sessionUser || (await supabase.auth.getUser()).data.user;

  if (!user) {
    throw new Error("Authentication required: Please sign in.");
  }

  const { data: sessionData } = await supabase.rpc("get_session_profile");
  const profile = sessionData && sessionData.length > 0 ? sessionData[0] : null;

  if (profile) {
    return { id: profile.id, role: profile.role };
  }

  const { data: fallbackRow } = await supabase
    .from("profiles")
    .select("id, role")
    .or(`auth_user_id.eq.${user.id},id.eq.${user.id}`)
    .maybeSingle();

  if (fallbackRow) {
    return { id: fallbackRow.id, role: fallbackRow.role };
  }

  throw new Error("User profile not found. Please contact administration.");
}

/**
 * Fetch all facilities affiliated with the authenticated technician.
 */
export async function getAffiliatedFacilities(): Promise<AffiliatedFacility[]> {
  const caller = await getAuthenticatedProfile();

  const { data, error } = await supabase
    .from("facility_memberships")
    .select(`
      id,
      facility_id,
      role,
      status,
      joined_at,
      created_at,
      repair_facilities:facility_id (
        id,
        name,
        village,
        tahsil,
        operating_hours,
        drop_off_approved,
        is_active,
        created_at,
        updated_at
      )
    `)
    .eq("technician_profile_id", caller.id)
    .in("status", ["ACTIVE", "INVITED"])
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[TerraByte] Error fetching affiliated facilities:", error);
    throw new Error(error.message || "Failed to load affiliated facilities.");
  }

  const list: AffiliatedFacility[] = [];

  for (const item of (data as any[]) || []) {
    const rawFac = Array.isArray(item.repair_facilities)
      ? item.repair_facilities[0]
      : item.repair_facilities;

    if (!rawFac) continue;

    list.push({
      membership_id: item.id,
      facility_id: item.facility_id,
      role: item.role as FacilityRole,
      status: item.status as MembershipStatus,
      joined_at: item.joined_at,
      facility: {
        id: rawFac.id,
        name: rawFac.name,
        village: rawFac.village,
        tahsil: rawFac.tahsil,
        operating_hours: rawFac.operating_hours,
        drop_off_approved: Boolean(rawFac.drop_off_approved),
        is_active: Boolean(rawFac.is_active),
        created_at: rawFac.created_at,
        updated_at: rawFac.updated_at,
      },
    });
  }

  return list;
}

/**
 * Fetch the complete management profile for a facility (OWNER, MANAGER, or Admin only).
 */
export async function getFacilityManagementProfile(facilityId: string): Promise<DetailedFacility> {
  const { data, error } = await supabase.rpc("get_facility_management_profile", {
    p_facility_id: facilityId,
  });

  if (error) {
    console.error("[TerraByte] Error fetching facility management profile:", error);
    throw new Error(error.message || "Failed to load facility management profile.");
  }

  return data as unknown as DetailedFacility;
}

/**
 * Fetch all facilities across Vidarbha with owner details and member counts (Service Centre Admin only).
 */
export async function getAllFacilitiesAdmin(): Promise<
  (SafeFacility & {
    owner_name: string;
    owner_phone: string | null;
    owner_profile_id: string;
    active_members_count: number;
    max_equipment_capacity: number;
  })[]
> {
  const { data: facs, error } = await supabase
    .from("repair_facilities")
    .select(`
      id,
      name,
      village,
      tahsil,
      operating_hours,
      drop_off_approved,
      is_active,
      created_at,
      updated_at
    `)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[TerraByte] Error fetching facilities for admin:", error);
    throw new Error(error.message || "Failed to load facilities.");
  }

  // Fetch all active memberships to calculate member counts per facility
  const { data: memberships } = await supabase
    .from("facility_memberships")
    .select("facility_id, role, status, technician_profile_id, profiles:technician_profile_id(full_name, phone)")
    .eq("status", "ACTIVE");

  const memberCountMap: Record<string, number> = {};
  const ownerMap: Record<string, { name: string; phone: string | null; profileId: string }> = {};

  for (const m of (memberships as any[]) || []) {
    memberCountMap[m.facility_id] = (memberCountMap[m.facility_id] || 0) + 1;
    if (m.role === "OWNER") {
      const prof = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
      ownerMap[m.facility_id] = {
        name: prof?.full_name || "Unknown Owner",
        phone: prof?.phone || null,
        profileId: m.technician_profile_id,
      };
    }
  }

  return ((facs as any[]) || []).map((f) => ({
    id: f.id,
    name: f.name,
    village: f.village,
    tahsil: f.tahsil,
    operating_hours: f.operating_hours,
    drop_off_approved: Boolean(f.drop_off_approved),
    is_active: Boolean(f.is_active),
    created_at: f.created_at,
    updated_at: f.updated_at,
    owner_name: ownerMap[f.id]?.name || "Unassigned",
    owner_phone: ownerMap[f.id]?.phone || null,
    owner_profile_id: ownerMap[f.id]?.profileId || "",
    active_members_count: memberCountMap[f.id] || 1,
    max_equipment_capacity: 4, // default nominal baseline
  }));
}

/**
 * Register a new workshop facility.
 * Enforces strictly the 10 approved columns.
 * Auto-provisions caller as OWNER via database trigger.
 */
export async function registerFacility(input: RegisterFacilityInput): Promise<{ id: string }> {
  const caller = await getAuthenticatedProfile();

  if (!input.name || input.name.trim().length < 3) {
    throw new Error("Workshop name must be at least 3 characters.");
  }
  if (!input.address || input.address.trim().length < 3) {
    throw new Error("Valid street address is required.");
  }
  if (!input.village || input.village.trim().length < 2) {
    throw new Error("Village or hub name is required.");
  }
  if (!input.tahsil || !VIDARBHA_TAHSILS.includes(input.tahsil as any)) {
    throw new Error("Please select a valid Vidarbha tahsil.");
  }

  const cleanPhone = (input.phone || "").replace(/[^0-9]/g, "");
  if (cleanPhone.length < 10) {
    throw new Error("Please enter a valid 10-digit Indian phone number.");
  }

  const lat = Number(input.latitude);
  const lng = Number(input.longitude);
  if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new Error("Valid geographic coordinates are required.");
  }

  const capacity = input.max_equipment_capacity && input.max_equipment_capacity > 0
    ? Math.floor(input.max_equipment_capacity)
    : 4;

  const defaultHours: OperatingHours = {
    open: "08:00",
    close: "19:00",
    days: ["MON", "TUE", "WED", "THU", "FRI", "SAT"],
  };

  const hours = input.operating_hours || defaultHours;

  const insertPayload = {
    name: input.name.trim(),
    address: input.address.trim(),
    village: input.village.trim(),
    tahsil: input.tahsil,
    phone: cleanPhone.slice(-10),
    email: input.email ? input.email.trim() : null,
    latitude: lat,
    longitude: lng,
    max_equipment_capacity: capacity,
    operating_hours: hours as unknown as Json,
    owner_profile_id: caller.id,
  };

  const { data, error } = await supabase
    .from("repair_facilities")
    .insert(insertPayload)
    .select("id")
    .single();

  if (error) {
    console.error("[TerraByte] Failed to register facility:", error);
    throw new Error(error.message || "Failed to register workshop facility.");
  }

  return { id: data.id };
}

/**
 * Update an existing facility's operational details (contact, hours, capacity).
 */
export async function updateFacility(
  facilityId: string,
  input: UpdateFacilityInput
): Promise<void> {
  const updatePayload: Record<string, any> = {};

  if (input.name !== undefined) updatePayload.name = input.name.trim();
  if (input.address !== undefined) updatePayload.address = input.address.trim();
  if (input.village !== undefined) updatePayload.village = input.village.trim();
  if (input.tahsil !== undefined) updatePayload.tahsil = input.tahsil;
  if (input.phone !== undefined) {
    const cleanPhone = input.phone.replace(/[^0-9]/g, "");
    if (cleanPhone.length < 10) throw new Error("10-digit phone number is required.");
    updatePayload.phone = cleanPhone.slice(-10);
  }
  if (input.email !== undefined) updatePayload.email = input.email ? input.email.trim() : null;
  if (input.latitude !== undefined) updatePayload.latitude = Number(input.latitude);
  if (input.longitude !== undefined) updatePayload.longitude = Number(input.longitude);
  if (input.max_equipment_capacity !== undefined) {
    updatePayload.max_equipment_capacity = Math.max(1, Math.floor(input.max_equipment_capacity));
  }
  if (input.operating_hours !== undefined) {
    updatePayload.operating_hours = input.operating_hours as unknown as Json;
  }

  updatePayload.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from("repair_facilities")
    .update(updatePayload)
    .eq("id", facilityId);

  if (error) {
    console.error("[TerraByte] Failed to update facility:", error);
    throw new Error(error.message || "Failed to update facility details.");
  }
}

/**
 * Fetch all members of a specific facility (OWNER, MANAGER, or active member).
 */
export async function getFacilityMembers(facilityId: string): Promise<FacilityMemberWithProfile[]> {
  const { data, error } = await supabase
    .from("facility_memberships")
    .select(`
      id,
      facility_id,
      technician_profile_id,
      role,
      status,
      joined_at,
      created_at,
      profiles:technician_profile_id (
        id,
        full_name,
        phone,
        village
      )
    `)
    .eq("facility_id", facilityId)
    .in("status", ["ACTIVE", "INVITED"])
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[TerraByte] Failed to fetch facility members:", error);
    throw new Error(error.message || "Failed to load facility members.");
  }

  const rolePriority: Record<string, number> = { OWNER: 1, MANAGER: 2, TECHNICIAN: 3 };

  return ((data as any[]) || [])
    .map((m) => {
      const prof = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
      return {
        id: m.id,
        facility_id: m.facility_id,
        technician_profile_id: m.technician_profile_id,
        role: m.role as FacilityRole,
        status: m.status as MembershipStatus,
        joined_at: m.joined_at,
        created_at: m.created_at,
        profile: prof
          ? {
              id: prof.id,
              full_name: prof.full_name,
              phone: prof.phone,
              village: prof.village,
            }
          : null,
      };
    })
    .sort((a, b) => {
      const pA = rolePriority[a.role] || 99;
      const pB = rolePriority[b.role] || 99;
      if (pA !== pB) return pA - pB;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
}

/**
 * Invite a technician to join a facility via 10-digit mobile phone.
 * strictly creates membership in 'INVITED' status.
 */
export async function inviteFacilityMember(
  facilityId: string,
  phone: string,
  role: "MANAGER" | "TECHNICIAN"
): Promise<{ success: boolean; technician_name: string }> {
  if (role !== "MANAGER" && role !== "TECHNICIAN") {
    throw new Error("Technicians can only be invited as MANAGER or TECHNICIAN.");
  }

  const cleanPhone = phone.replace(/[^0-9]/g, "");
  if (cleanPhone.length < 10) {
    throw new Error("Enter a valid 10-digit registered mobile phone number.");
  }

  const { data, error } = await supabase.rpc("invite_technician_to_facility", {
    p_facility_id: facilityId,
    p_technician_phone: cleanPhone.slice(-10),
    p_role: role,
  });

  if (error) {
    console.error("[TerraByte] Failed to invite technician:", error);
    throw new Error(error.message || "Failed to invite technician to facility.");
  }

  return data as unknown as { success: boolean; technician_name: string };
}

/**
 * Accept a pending facility invitation.
 */
export async function acceptFacilityInvitation(membershipId: string): Promise<void> {
  const { error } = await supabase.rpc("accept_facility_invitation", {
    p_membership_id: membershipId,
  });

  if (error) {
    console.error("[TerraByte] Failed to accept invitation:", error);
    throw new Error(error.message || "Failed to accept invitation.");
  }
}

/**
 * Reject a pending facility invitation.
 */
export async function rejectFacilityInvitation(membershipId: string): Promise<void> {
  const { error } = await supabase.rpc("reject_facility_invitation", {
    p_membership_id: membershipId,
  });

  if (error) {
    console.error("[TerraByte] Failed to reject invitation:", error);
    throw new Error(error.message || "Failed to reject invitation.");
  }
}

/**
 * Revoke a pending invitation (Owner, Manager, or Admin).
 */
export async function revokeFacilityInvitation(membershipId: string): Promise<void> {
  const { error } = await supabase.rpc("revoke_facility_invitation", {
    p_membership_id: membershipId,
  });

  if (error) {
    console.error("[TerraByte] Failed to revoke invitation:", error);
    throw new Error(error.message || "Failed to revoke invitation.");
  }
}

/**
 * Remove an active member from the facility.
 * Owner can remove any non-owner; Manager can remove Technicians only.
 */
export async function removeFacilityMember(
  facilityId: string,
  technicianProfileId: string
): Promise<void> {
  const { error } = await supabase.rpc("remove_facility_member", {
    p_facility_id: facilityId,
    p_technician_profile_id: technicianProfileId,
  });

  if (error) {
    // If the RPC is unavailable for any reason, try direct delete (protected by trg_guard_owner_membership_mutation)
    const { error: directErr } = await supabase
      .from("facility_memberships")
      .delete()
      .eq("facility_id", facilityId)
      .eq("technician_profile_id", technicianProfileId);

    if (directErr) {
      console.error("[TerraByte] Failed to remove facility member:", directErr);
      throw new Error(directErr.message || error.message || "Failed to remove member.");
    }
  }
}

/**
 * Transfer ownership of a facility to another active member.
 * Atomic 2-step execution: old owner demoted to MANAGER, new owner promoted to OWNER.
 */
export async function transferFacilityOwnership(
  facilityId: string,
  newOwnerProfileId: string
): Promise<void> {
  const { error } = await supabase.rpc("transfer_facility_ownership", {
    p_facility_id: facilityId,
    p_new_owner_profile_id: newOwnerProfileId,
  });

  if (error) {
    console.error("[TerraByte] Failed to transfer facility ownership:", error);
    throw new Error(error.message || "Failed to transfer facility ownership.");
  }
}

/**
 * Toggle public drop-off approval for a facility (Service Centre Admin only).
 */
export async function toggleDropOffApproval(
  facilityId: string,
  dropOffApproved: boolean
): Promise<void> {
  const { error } = await supabase
    .from("repair_facilities")
    .update({
      drop_off_approved: dropOffApproved,
      drop_off_approved_at: dropOffApproved ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", facilityId);

  if (error) {
    console.error("[TerraByte] Failed to update drop-off approval:", error);
    throw new Error(error.message || "Failed to update drop-off approval status.");
  }
}
