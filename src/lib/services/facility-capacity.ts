/**
 * TerraByte Facility Capacity, Bay Reservations & Drop-Off Lifecycle Service
 * Phase 14 Milestone 4: Operational capacity and physical equipment lifecycle.
 */

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export interface FacilityCapacityBreakdown {
  facility_id: string;
  facility_name: string;
  max_equipment_capacity: number;
  physical_occupancy: number;
  active_reservations: number;
  total_committed_capacity: number;
  available_capacity: number;
  is_at_capacity: boolean;
  is_overcommitted: boolean;
}

export interface FacilityReservation {
  id: string;
  facility_id: string;
  repair_request_id: string;
  farmer_profile_id: string;
  status: "RESERVED" | "CLAIMED" | "EXPIRED" | "RELEASED" | "CANCELLED";
  reserved_at: string;
  expires_at: string;
  renewal_count: number;
  renewed_at: string | null;
  renewed_by: string | null;
  renewal_notes: string | null;
  claimed_at: string | null;
  released_at: string | null;
  priority_original_reserved_at: string;
  created_at: string;
  updated_at: string;
  repair?: {
    id: string;
    job_number: string;
    status: string;
    delivery_mode: string;
    location: string;
    farmer_name: string;
    farmer_phone?: string;
    equipment_make: string;
    equipment_model: string;
    equipment_type: string;
  };
}

export interface FacilityPhysicalOccupancy {
  repair_id: string;
  job_number: string;
  status: string;
  delivery_mode: string;
  dropped_off_at: string;
  drop_off_receipt_number: string | null;
  dropped_off_by: string | null;
  dropped_off_by_name?: string | null;
  handover_status: string;
  farmer_id: string;
  farmer_name: string;
  farmer_phone: string;
  equipment_make: string;
  equipment_model: string;
  equipment_type: string;
  equipment_serial?: string;
  is_cancelled_in_custody: boolean;
}

function handleFacilityError(error: unknown, fallbackMessage: string): never {
  const msg = error instanceof Error ? error.message : fallbackMessage;
  console.error(`[TerraByte Facility Capacity] ${fallbackMessage}:`, error);
  throw new Error(msg);
}

function isMigrationPending(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes("does not exist") ||
    msg.includes("relation") ||
    msg.includes("column") ||
    msg.includes("function")
  );
}

/**
 * Calls public.get_facility_capacity_breakdown RPC.
 * Returns authoritative real-time bay utilization.
 */
export async function getFacilityCapacityBreakdown(
  facilityId: string,
): Promise<FacilityCapacityBreakdown> {
  const { data, error } = await supabase.rpc("get_facility_capacity_breakdown", {
    p_facility_id: facilityId,
  });

  if (error) {
    if (isMigrationPending(error)) {
      return {
        facility_id: facilityId,
        facility_name: "Workshop Facility",
        max_equipment_capacity: 4,
        physical_occupancy: 0,
        active_reservations: 0,
        total_committed_capacity: 0,
        available_capacity: 4,
        is_at_capacity: false,
        is_overcommitted: false,
      };
    }
    handleFacilityError(error, `Failed to load capacity breakdown for facility ${facilityId}`);
  }

  const raw = (data as unknown as Record<string, unknown>) || {};
  return {
    facility_id: (raw.facility_id as string) || facilityId,
    facility_name: (raw.facility_name as string) || "Workshop",
    max_equipment_capacity: Number(raw.max_equipment_capacity) || 0,
    physical_occupancy: Number(raw.physical_occupancy) || 0,
    active_reservations: Number(raw.active_reservations) || 0,
    total_committed_capacity: Number(raw.total_committed_capacity) || 0,
    available_capacity: Number(raw.available_capacity) || 0,
    is_at_capacity: Boolean(raw.is_at_capacity),
    is_overcommitted: Boolean(raw.is_overcommitted),
  };
}

/**
 * Queries incoming and historical reservations for a facility.
 * Enriched with linked repair request, equipment, and farmer profile data.
 */
export async function getFacilityReservations(facilityId: string): Promise<FacilityReservation[]> {
  try {
    const { data, error } = await supabase
      .from("facility_bay_reservations")
      .select(
        `
        id,
        facility_id,
        repair_request_id,
        farmer_profile_id,
        status,
        reserved_at,
        expires_at,
        renewal_count,
        renewed_at,
        renewed_by,
        renewal_notes,
        claimed_at,
        released_at,
        priority_original_reserved_at,
        created_at,
        updated_at,
        repair_requests (
          id,
          job_number,
          status,
          delivery_mode,
          location,
          equipment (
            make,
            model,
            type
          ),
          profiles:farmer_id (
            full_name,
            phone
          )
        )
      `,
      )
      .eq("facility_id", facilityId)
      .order("priority_original_reserved_at", { ascending: true });

    if (error) {
      if (isMigrationPending(error)) return [];
      handleFacilityError(error, `Failed to load reservations for facility ${facilityId}`);
    }

    if (!data) return [];

    return (data as unknown as Record<string, unknown>[]).map((row) => {
      const rep = row["repair_requests"] as Record<string, unknown> | null;
      const eq = rep?.["equipment"] as Record<string, unknown> | null;
      const prof = rep?.["profiles"] as Record<string, unknown> | null;

      return {
        id: row["id"] as string,
        facility_id: row["facility_id"] as string,
        repair_request_id: row["repair_request_id"] as string,
        farmer_profile_id: row["farmer_profile_id"] as string,
        status: row["status"] as FacilityReservation["status"],
        reserved_at: row["reserved_at"] as string,
        expires_at: row["expires_at"] as string,
        renewal_count: (row["renewal_count"] as number) || 0,
        renewed_at: (row["renewed_at"] as string) || null,
        renewed_by: (row["renewed_by"] as string) || null,
        renewal_notes: (row["renewal_notes"] as string) || null,
        claimed_at: (row["claimed_at"] as string) || null,
        released_at: (row["released_at"] as string) || null,
        priority_original_reserved_at: row["priority_original_reserved_at"] as string,
        created_at: row["created_at"] as string,
        updated_at: row["updated_at"] as string,
        repair: rep
          ? {
              id: rep["id"] as string,
              job_number: rep["job_number"] as string,
              status: rep["status"] as string,
              delivery_mode: rep["delivery_mode"] as string,
              location: (rep["location"] as string) || "",
              farmer_name: (prof?.["full_name"] as string) || "Farmer",
              farmer_phone: (prof?.["phone"] as string) || "",
              equipment_make: (eq?.["make"] as string) || "",
              equipment_model: (eq?.["model"] as string) || "",
              equipment_type: (eq?.["type"] as string) || "",
            }
          : undefined,
      };
    });
  } catch (err: unknown) {
    if (isMigrationPending(err)) return [];
    console.error("[TerraByte] Error fetching facility reservations:", err);
    throw err;
  }
}

/**
 * Queries all equipment physically present inside the workshop bays.
 * Includes both active repairs in progress and cancelled equipment in custody.
 */
export async function getFacilityPhysicalOccupancy(
  facilityId: string,
): Promise<FacilityPhysicalOccupancy[]> {
  try {
    const { data, error } = await supabase
      .from("repair_requests")
      .select(
        `
        id,
        job_number,
        status,
        delivery_mode,
        dropped_off_at,
        drop_off_receipt_number,
        dropped_off_by,
        handover_status,
        farmer_id,
        equipment (
          make,
          model,
          type,
          serial_number
        ),
        profiles:farmer_id (
          full_name,
          phone
        ),
        dropper:dropped_off_by (
          full_name
        )
      `,
      )
      .eq("facility_id", facilityId)
      .eq("delivery_mode", "WORKSHOP_DROPOFF")
      .not("dropped_off_at", "is", null)
      .neq("handover_status", "RELEASED")
      .order("dropped_off_at", { ascending: false });

    if (error) {
      if (isMigrationPending(error)) return [];
      handleFacilityError(error, `Failed to load physical occupancy for facility ${facilityId}`);
    }

    if (!data) return [];

    return (data as unknown as Record<string, unknown>[]).map((row) => {
      const eq = row["equipment"] as Record<string, unknown> | null;
      const prof = row["profiles"] as Record<string, unknown> | null;
      const dropper = row["dropper"] as Record<string, unknown> | null;

      return {
        repair_id: row["id"] as string,
        job_number: row["job_number"] as string,
        status: row["status"] as string,
        delivery_mode: row["delivery_mode"] as string,
        dropped_off_at: row["dropped_off_at"] as string,
        drop_off_receipt_number: (row["drop_off_receipt_number"] as string) || null,
        dropped_off_by: (row["dropped_off_by"] as string) || null,
        dropped_off_by_name: (dropper?.["full_name"] as string) || null,
        handover_status: row["handover_status"] as string,
        farmer_id: row["farmer_id"] as string,
        farmer_name: (prof?.["full_name"] as string) || "Farmer",
        farmer_phone: (prof?.["phone"] as string) || "",
        equipment_make: (eq?.["make"] as string) || "",
        equipment_model: (eq?.["model"] as string) || "",
        equipment_type: (eq?.["type"] as string) || "",
        equipment_serial: (eq?.["serial_number"] as string) || "",
        is_cancelled_in_custody: row["status"] === "CANCELLED",
      };
    });
  } catch (err: unknown) {
    if (isMigrationPending(err)) return [];
    console.error("[TerraByte] Error fetching physical occupancy:", err);
    throw err;
  }
}

/**
 * Reserves workshop bay capacity for a repair ticket.
 * Invokes public.reserve_workshop_bay RPC.
 */
export async function reserveWorkshopBay(
  repairRequestId: string,
  facilityId: string,
  expiryInterval?: string,
): Promise<{
  success: boolean;
  reservation_id?: string;
  facility_id?: string;
  expires_at?: string;
  priority_original_reserved_at?: string;
  code?: string;
  message?: string;
  reroute_eligible?: boolean;
}> {
  const { data, error } = await supabase.rpc("reserve_workshop_bay", {
    p_repair_request_id: repairRequestId,
    p_facility_id: facilityId,
    p_expiry_interval: (expiryInterval ||
      "24 hours") as unknown as Database["public"]["CompositeTypes"][keyof Database["public"]["CompositeTypes"]],
  });

  if (error) {
    handleFacilityError(error, "Failed to reserve workshop bay");
  }

  return (data ?? {}) as unknown as {
    success: boolean;
    reservation_id?: string;
    facility_id?: string;
    expires_at?: string;
    priority_original_reserved_at?: string;
    code?: string;
    message?: string;
    reroute_eligible?: boolean;
  };
}

export interface SubmitWorkshopDropoffInput {
  equipment_id: string;
  facility_id: string;
  symptoms: string[];
  description: string;
  location: string;
  photos?: string[];
  assessment?: unknown;
  farmer_id?: string;
  is_immobile?: boolean;
  gpsLocation?: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
  };
}

export interface SubmitWorkshopDropoffResult {
  id: string;
  job_number: string;
  reservation_id: string;
  expires_at: string;
}

/**
 * Submits a workshop drop-off repair ticket and reserves bay capacity in a single atomic database transaction.
 * Invokes public.submit_workshop_dropoff_repair RPC.
 * If capacity is exhausted or reservation fails, repair creation is rolled back atomically, preventing orphan tickets.
 */
export async function submitWorkshopDropoffRepair(
  input: SubmitWorkshopDropoffInput,
): Promise<SubmitWorkshopDropoffResult> {
  const { data, error } = await supabase.rpc(
    "submit_workshop_dropoff_repair" as unknown as "reserve_workshop_bay",
    {
      p_equipment_id: input.equipment_id,
      p_facility_id: input.facility_id,
      p_symptoms: input.symptoms,
      p_description: input.description,
      p_location: input.location,
      p_photos: input.photos || [],
      p_assessment: input.assessment ?? {},
      p_gps_lat: input.gpsLocation?.latitude ?? null,
      p_gps_lng: input.gpsLocation?.longitude ?? null,
      p_gps_acc: input.gpsLocation?.accuracy ?? null,
      p_farmer_id: input.farmer_id ?? null,
      p_is_immobile: input.is_immobile ?? false,
    } as unknown as Record<string, unknown>,
  );

  if (error) {
    handleFacilityError(error, "Failed to submit workshop drop-off repair");
  }

  const raw = (data ?? {}) as Record<string, unknown>;
  const resv = raw.reservation as Record<string, unknown> | undefined;

  return {
    id: (raw.repair_id as string) || "",
    job_number: (raw.job_number as string) || "",
    reservation_id: (resv?.reservation_id as string) || "",
    expires_at: (resv?.expires_at as string) || "",
  };
}

/**
 * Renews an existing workshop bay reservation.
 * Farmers are limited to 1 self-renewal. Admins require mandatory audit notes.
 * Invokes public.renew_workshop_bay_reservation RPC.
 */
export async function renewWorkshopBayReservation(
  reservationId: string,
  extensionInterval?: string,
  auditNotes?: string,
): Promise<{
  success: boolean;
  reservation_id?: string;
  new_expires_at?: string;
  renewal_count?: number;
  code?: string;
  message?: string;
}> {
  const { data, error } = await supabase.rpc("renew_workshop_bay_reservation", {
    p_reservation_id: reservationId,
    p_extension_interval: (extensionInterval ||
      "24 hours") as unknown as Database["public"]["CompositeTypes"][keyof Database["public"]["CompositeTypes"]],
    p_notes: auditNotes || null,
  });

  if (error) {
    handleFacilityError(error, "Failed to renew workshop bay reservation");
  }

  return (data ?? {}) as unknown as {
    success: boolean;
    reservation_id?: string;
    new_expires_at?: string;
    renewal_count?: number;
    code?: string;
    message?: string;
  };
}

/**
 * Releases a workshop bay reservation.
 * Invokes public.release_workshop_bay_reservation RPC.
 */
export async function releaseWorkshopBayReservation(
  repairRequestId: string,
  reason?: string,
): Promise<{
  success: boolean;
  reservation_id?: string;
  status?: string;
  already_released?: boolean;
  code?: string;
  message?: string;
}> {
  const { data, error } = await supabase.rpc("release_workshop_bay_reservation", {
    p_repair_request_id: repairRequestId,
    p_reason: reason || null,
  });

  if (error) {
    handleFacilityError(error, "Failed to release workshop bay reservation");
  }

  return (data ?? {}) as unknown as {
    success: boolean;
    reservation_id?: string;
    status?: string;
    already_released?: boolean;
    code?: string;
    message?: string;
  };
}

/**
 * Authoritatively executes physical check-in of equipment at a workshop.
 * Transitions reservation to CLAIMED, sets dropped_off_at, and returns unique RCP-TB-YYYYMMDD-XXXX receipt.
 * Invokes public.execute_workshop_dropoff_checkin RPC.
 */
export async function executeWorkshopDropoffCheckin(
  repairRequestId: string,
  notes?: string,
): Promise<{
  success: boolean;
  receipt_number?: string;
  dropped_off_at?: string;
  facility_id?: string;
  path?: "ACTIVE" | "STANDBY";
  already_checked_in?: boolean;
  code?: string;
  message?: string;
  reroute_eligible?: boolean;
  priority_original_reserved_at?: string;
  earlier_reservations_ahead?: number;
}> {
  const { data, error } = await supabase.rpc("execute_workshop_dropoff_checkin", {
    p_repair_request_id: repairRequestId,
    p_notes: notes || null,
  });

  if (error) {
    handleFacilityError(error, "Failed to execute workshop drop-off check-in");
  }

  return (data ?? {}) as unknown as {
    success: boolean;
    receipt_number?: string;
    dropped_off_at?: string;
    facility_id?: string;
    path?: "ACTIVE" | "STANDBY";
    already_checked_in?: boolean;
    code?: string;
    message?: string;
    reroute_eligible?: boolean;
    priority_original_reserved_at?: string;
    earlier_reservations_ahead?: number;
  };
}

/**
 * Authoritatively releases physical equipment from workshop custody after ticket cancellation.
 * Sets handover_status = 'RELEASED', updates handover_released_at, records timeline audit,
 * and frees physical bay occupancy.
 * Invokes public.release_cancelled_workshop_equipment RPC.
 */
export async function releaseCancelledWorkshopEquipment(
  repairRequestId: string,
  notes?: string,
): Promise<{
  success: boolean;
  repair_id?: string;
  handover_status?: string;
  released_at?: string;
  code?: string;
  message?: string;
}> {
  const { data, error } = await supabase.rpc("release_cancelled_workshop_equipment", {
    p_repair_request_id: repairRequestId,
    p_notes: notes || null,
  });

  if (error) {
    handleFacilityError(error, "Failed to release cancelled workshop equipment");
  }

  return (data ?? {}) as unknown as {
    success: boolean;
    repair_id?: string;
    handover_status?: string;
    released_at?: string;
    code?: string;
    message?: string;
  };
}

/**
 * Reroutes a workshop drop-off ticket to another approved facility with available capacity.
 * Preserves the original reserved_at FIFO priority timestamp across rerouting.
 */
export async function rerouteWorkshopDropoff(
  repairRequestId: string,
  newFacilityId: string,
): Promise<{
  success: boolean;
  reservation_id?: string;
  facility_id?: string;
  expires_at?: string;
  priority_original_reserved_at?: string;
  code?: string;
  message?: string;
  reroute_eligible?: boolean;
}> {
  return reserveWorkshopBay(repairRequestId, newFacilityId, "24 hours");
}

/**
 * Updates maximum equipment capacity for a workshop facility.
 * Does NOT evict existing equipment or cancel active reservations.
 */
export async function updateFacilityCapacity(
  facilityId: string,
  newCapacity: number,
): Promise<void> {
  const cleanCapacity = Math.max(1, Math.min(20, Math.floor(newCapacity)));
  const { error } = await supabase
    .from("repair_facilities")
    .update({
      max_equipment_capacity: cleanCapacity,
      updated_at: new Date().toISOString(),
    })
    .eq("id", facilityId);

  if (error) {
    handleFacilityError(error, "Failed to update facility bay capacity");
  }
}
