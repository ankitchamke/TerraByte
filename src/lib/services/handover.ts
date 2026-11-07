import { supabase } from "@/integrations/supabase/client";

export type HandoverStatus = "PENDING" | "AUTHORIZED" | "RELEASED";

export type OfflinePaymentMethod =
  "CASH_ON_DELIVERY" | "DIRECT_UPI" | "DIRECT_BANK_TRANSFER" | "OFFLINE_CHEQUE" | "WAIVED_WARRANTY";

export interface PaymentMethodOption {
  id: OfflinePaymentMethod;
  label: string;
  description: string;
  requiresReference: boolean;
  refPlaceholder?: string;
}

export const APPROVED_OFFLINE_PAYMENT_METHODS: readonly PaymentMethodOption[] = [
  {
    id: "CASH_ON_DELIVERY",
    label: "Cash on Collection / Handover",
    description: "Physical cash received at workshop counter or field handover.",
    requiresReference: false,
  },
  {
    id: "DIRECT_UPI",
    label: "Direct Counter / Field UPI",
    description: "Farmer scanned counter/field UPI QR code. Enter the 12-digit UTR reference.",
    requiresReference: true,
    refPlaceholder: "12-digit UPI UTR reference (e.g. 431289123456)",
  },
  {
    id: "DIRECT_BANK_TRANSFER",
    label: "Direct Bank Transfer (NEFT / IMPS)",
    description: "Direct bank transfer to workshop account.",
    requiresReference: true,
    refPlaceholder: "Bank transfer reference / UTR",
  },
  {
    id: "OFFLINE_CHEQUE",
    label: "Physical Cheque",
    description: "Bank cheque handed over.",
    requiresReference: true,
    refPlaceholder: "6-digit cheque number and bank name",
  },
  {
    id: "WAIVED_WARRANTY",
    label: "Warranty / Goodwill Waiver (No Charge)",
    description: "Covered under post-service warranty or commercial waiver.",
    requiresReference: false,
  },
] as const;

export interface LoadTestSignoffInput {
  repairId: string;
  passed: boolean;
  temperature?: number | string | null;
  temperatureC?: number | string | null;
  hydraulicPressure?: number | string | null;
  hydraulicPressureBar?: number | string | null;
  rpm?: number | string | null;
  engineRpm?: number | string | null;
  observations?: string;
  notes?: string;
}

export interface RecordPaymentClearanceInput {
  repairId: string;
  paymentMethod: OfflinePaymentMethod;
  paymentReference?: string | null | undefined;
  notes?: string | null | undefined;
}

export interface AuthorizeHandoverInput {
  repairId: string;
  authorizationNotes?: string | null | undefined;
}

export interface ExecuteReleaseInput {
  repairId: string;
  releaseNotes?: string | null | undefined;
}

export interface HandoverReadiness {
  isReady: boolean;
  canAuthorize: boolean;
  isCompleted: boolean;
  loadTestPassed: boolean;
  quoteApproved: boolean;
  paymentCleared: boolean;
  partsCleared: boolean;
  blockingReasons: string[];
  missingConditions: string[];
}

export interface FacilityHandoverLocation {
  facility_id: string;
  facility_name: string;
  counter_phone: string | null;
  counter_address: string | null;
  latitude: number | null;
  longitude: number | null;
  operating_hours: string | null;
  tahsil: string | null;
  village: string | null;
  authorized_at?: string | null;
  handover_status?: string;
  name?: string;
  address?: string | null;
  phone?: string | null;
}

/**
 * Formats structured load-test metrics into a canonical observations string.
 * Requires minimum 10 characters to satisfy PostgreSQL RPC constraints.
 */
export function formatLoadTestNotes(input: {
  temperature?: number | string | null;
  temperatureC?: number | string | null;
  hydraulicPressure?: number | string | null;
  hydraulicPressureBar?: number | string | null;
  rpm?: number | string | null;
  engineRpm?: number | string | null;
  observations?: string;
  notes?: string;
}): string {
  const parts: string[] = [];
  const temp = input.temperature ?? input.temperatureC;
  const press = input.hydraulicPressure ?? input.hydraulicPressureBar;
  const r = input.rpm ?? input.engineRpm;

  if (temp != null && String(temp).trim() !== "") {
    parts.push(`Temp: ${String(temp).trim()}°C`);
  }
  if (press != null && String(press).trim() !== "") {
    parts.push(`Pressure: ${String(press).trim()} bar`);
  }
  if (r != null && String(r).trim() !== "") {
    parts.push(`RPM: ${String(r).trim()}`);
  }

  const rawObs = input.observations ?? input.notes ?? "";
  const trimmedObs = rawObs.trim();
  if (parts.length > 0) {
    return trimmedObs ? `${parts.join(" | ")}. ${trimmedObs}` : parts.join(" | ");
  }
  return trimmedObs;
}

/**
 * Derives comprehensive handover authorization readiness from authoritative database records.
 * Does not trust caller-supplied booleans.
 */
export function deriveHandoverReadiness(
  repairOrInput:
    | {
        repair?: {
          status?: string;
          load_test_passed?: boolean | null;
          payment_cleared_at?: string | null;
          handover_status?: string | null;
        } | null;
        quote?: { status?: string } | null;
        partsRequests?: Array<{ status?: string }>;
      }
    | {
        status?: string;
        load_test_passed?: boolean | null;
        payment_cleared_at?: string | null;
        handover_status?: string | null;
      }
    | null,
  quotes: Array<{ status?: string }> = [],
  partRequests: Array<{ status?: string }> = [],
): HandoverReadiness {
  let repair: {
    status?: string;
    load_test_passed?: boolean | null;
    payment_cleared_at?: string | null;
    handover_status?: string | null;
  } | null = null;
  let quoteList = quotes;
  let partList = partRequests;

  if (repairOrInput && typeof repairOrInput === "object" && "repair" in repairOrInput) {
    repair = repairOrInput.repair ?? null;
    if (repairOrInput.quote) {
      quoteList = [repairOrInput.quote];
    }
    if (repairOrInput.partsRequests) {
      partList = repairOrInput.partsRequests;
    }
  } else {
    repair = repairOrInput as typeof repair;
  }

  const blockingReasons: string[] = [];

  const isCompleted = repair?.status === "COMPLETED";
  if (!isCompleted) {
    blockingReasons.push("Repair must be marked COMPLETED.");
  }

  const loadTestPassed = repair?.load_test_passed === true;
  if (!loadTestPassed) {
    blockingReasons.push("Operational load test must be conducted and passed.");
  }

  const quoteApproved = quoteList.some((q) => q.status === "APPROVED");
  if (!quoteApproved) {
    blockingReasons.push("An approved itemized quote is required.");
  }

  const paymentCleared = Boolean(repair?.payment_cleared_at);
  if (!paymentCleared) {
    blockingReasons.push("Offline payment clearance must be recorded in the database.");
  }

  const partsCleared = !partList.some((p) => p.status === "PENDING");
  if (!partsCleared) {
    blockingReasons.push("Requisitioned spare parts are still pending handoff or return.");
  }

  const isReady = isCompleted && loadTestPassed && quoteApproved && paymentCleared && partsCleared;

  return {
    isReady,
    canAuthorize: isReady,
    isCompleted,
    loadTestPassed,
    quoteApproved,
    paymentCleared,
    partsCleared,
    blockingReasons,
    missingConditions: blockingReasons,
  };
}

/**
 * Records operational load testing sign-off via database RPC `record_load_test_signoff`.
 * Blocks repair completion if test fails or notes are insufficient (< 10 chars).
 */
export async function recordLoadTestSignoff(
  input: LoadTestSignoffInput,
): Promise<{ success: boolean; load_test_passed: boolean; repair_id: string }> {
  const formattedNotes = formatLoadTestNotes({
    temperature: input.temperature,
    hydraulicPressure: input.hydraulicPressure,
    rpm: input.rpm,
    observations: input.observations,
  });

  if (formattedNotes.length < 10) {
    throw new Error(
      "INSUFFICIENT_NOTES: Load test notes must detail operational metrics and observations (at least 10 characters).",
    );
  }

  const { data, error } = await supabase.rpc("record_load_test_signoff", {
    p_repair_request_id: input.repairId,
    p_passed: input.passed,
    p_notes: formattedNotes,
  });

  if (error) {
    throw new Error(`Failed to record load test: ${error.message}`);
  }

  return data as unknown as { success: boolean; load_test_passed: boolean; repair_id: string };
}

/**
 * Records offline payment clearance via database RPC `record_offline_payment_clearance`.
 * Direct client UPDATE to payment clearance audit columns is strictly forbidden by DAC column privileges.
 */
export async function recordOfflinePaymentClearance(input: RecordPaymentClearanceInput): Promise<{
  success: boolean;
  repair_id: string;
  payment_cleared_at: string;
  payment_method: string;
  payment_reference: string;
  payment_cleared_by: string;
}> {
  const trimmedRef = (input.paymentReference || "").trim();
  const option = APPROVED_OFFLINE_PAYMENT_METHODS.find((m) => m.id === input.paymentMethod);

  if (option?.requiresReference && trimmedRef.length < 4) {
    throw new Error(
      `MISSING_PAYMENT_REFERENCE: A valid transaction reference or instrument number (at least 4 characters) is required for ${option.label}.`,
    );
  }

  const { data, error } = await supabase.rpc("record_offline_payment_clearance", {
    p_repair_request_id: input.repairId,
    p_payment_method: input.paymentMethod,
    p_payment_reference: trimmedRef || "N/A",
  });

  if (error) {
    throw new Error(`Failed to record payment clearance: ${error.message}`);
  }

  return data as unknown as {
    success: boolean;
    repair_id: string;
    payment_cleared_at: string;
    payment_method: string;
    payment_reference: string;
    payment_cleared_by: string;
  };
}

/**
 * Authorizes equipment handover via database RPC `authorize_equipment_handover`.
 * Enforces all preconditions in PostgreSQL: COMPLETED, load_test_passed = true, quote APPROVED,
 * payment_cleared_at IS NOT NULL, and no pending depot parts holds.
 */
export async function authorizeEquipmentHandover(
  input: AuthorizeHandoverInput,
): Promise<{ success: boolean; repair_id: string; handover_status: "AUTHORIZED" }> {
  const { data, error } = await supabase.rpc("authorize_equipment_handover", {
    p_repair_request_id: input.repairId,
    p_authorization_notes: (input.authorizationNotes || "Authorized for collection").trim(),
  });

  if (error) {
    throw new Error(`Failed to authorize equipment handover: ${error.message}`);
  }

  return data as unknown as {
    success: boolean;
    repair_id: string;
    handover_status: "AUTHORIZED";
  };
}

/**
 * Executes physical equipment handover release via database RPC `execute_equipment_handover_release`.
 * Restricted to assigned technician, facility technician/manager, or Service Centre admin.
 */
export async function executeEquipmentHandoverRelease(
  input: ExecuteReleaseInput,
): Promise<{ success: boolean; repair_id: string; handover_status: "RELEASED" }> {
  const { data, error } = await supabase.rpc("execute_equipment_handover_release", {
    p_repair_request_id: input.repairId,
    p_release_notes: (input.releaseNotes || "Physical equipment release verified").trim(),
  });

  if (error) {
    throw new Error(`Failed to release equipment: ${error.message}`);
  }

  return data as unknown as {
    success: boolean;
    repair_id: string;
    handover_status: "RELEASED";
  };
}

/**
 * Confirms equipment collection by the owning farmer via database RPC `confirm_farmer_equipment_collection`.
 * Restricted strictly to the owning farmer (farmer_id = current_profile_id()).
 * Does not block reviews.
 */
export async function confirmFarmerEquipmentCollection(
  input: string | { repairId: string },
): Promise<{
  success: boolean;
  repair_id: string;
  farmer_collection_confirmed: boolean;
  confirmed_at: string;
  already_confirmed?: boolean;
}> {
  const repairId = typeof input === "string" ? input : input.repairId;
  const { data, error } = await supabase.rpc("confirm_farmer_equipment_collection", {
    p_repair_request_id: repairId,
  });

  if (error) {
    throw new Error(`Failed to confirm equipment collection: ${error.message}`);
  }

  return data as unknown as {
    success: boolean;
    repair_id: string;
    farmer_collection_confirmed: boolean;
    confirmed_at: string;
    already_confirmed?: boolean;
  };
}

/**
 * Securely retrieves workshop pickup coordinates and counter phone for an authorized handover.
 * Database guard strictly restricts access: hidden during PENDING, revealed during AUTHORIZED,
 * and closed upon RELEASED.
 */
export async function getFacilityHandoverLocation(
  repairId: string,
): Promise<FacilityHandoverLocation | null> {
  const { data, error } = await supabase.rpc("get_facility_handover_location", {
    p_repair_request_id: repairId,
  });

  if (error || !data) {
    // If access denied (e.g. not authorized yet, or already released), return null
    return null;
  }

  const raw = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const name =
    typeof raw.name === "string"
      ? raw.name
      : typeof raw.facility_name === "string"
        ? raw.facility_name
        : "Authorized Service Facility";
  const address =
    typeof raw.address === "string"
      ? raw.address
      : typeof raw.counter_address === "string"
        ? raw.counter_address
        : null;
  const phone =
    typeof raw.phone === "string"
      ? raw.phone
      : typeof raw.counter_phone === "string"
        ? raw.counter_phone
        : null;

  return {
    facility_id: typeof raw.facility_id === "string" ? raw.facility_id : "",
    facility_name: name,
    name,
    counter_phone: phone,
    phone,
    counter_address: address,
    address,
    latitude: typeof raw.latitude === "number" ? raw.latitude : null,
    longitude: typeof raw.longitude === "number" ? raw.longitude : null,
    operating_hours: typeof raw.operating_hours === "string" ? raw.operating_hours : null,
    tahsil: typeof raw.tahsil === "string" ? raw.tahsil : null,
    village: typeof raw.village === "string" ? raw.village : null,
    authorized_at: typeof raw.authorized_at === "string" ? raw.authorized_at : null,
    handover_status: typeof raw.handover_status === "string" ? raw.handover_status : "AUTHORIZED",
  };
}
