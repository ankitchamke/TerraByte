export type DeliveryMode = "DOORSTEP" | "WORKSHOP_DROPOFF";

export interface IntakeValidationResult {
  valid: boolean;
  error?: string;
  effectiveMode: DeliveryMode;
}

export interface SelectableFacility {
  id: string;
  name: string;
  address?: string;
  village?: string;
  tahsil?: string;
  phone?: string;
  operating_hours?: {
    open: string;
    close: string;
    days: string[];
  };
  drop_off_approved: boolean;
  is_active: boolean;
}

export const IMMOBILE_LOCK_WARNING =
  "Immobile machinery cannot be transported. Service is locked to Doorstep / On-Field.";

/**
 * Resolves the effective delivery mode based on machine mobility.
 * If the machinery is immobile (isImmobile = true), service is strictly locked to 'DOORSTEP'.
 */
export function resolveEffectiveDeliveryMode(
  isImmobile: boolean,
  requestedMode?: DeliveryMode | string | null,
): DeliveryMode {
  if (isImmobile) {
    return "DOORSTEP";
  }
  return requestedMode === "WORKSHOP_DROPOFF" ? "WORKSHOP_DROPOFF" : "DOORSTEP";
}

/**
 * Validates intake submission for mobility and delivery mode domain invariants.
 * Enforces that immobile machinery cannot select workshop drop-off,
 * drop-off requires an approved facility, and doorstep cannot carry a facility reference.
 */
export function validateIntakeSubmission(input: {
  isImmobile?: boolean | null;
  deliveryMode?: DeliveryMode | string | null;
  facilityId?: string | null;
}): IntakeValidationResult {
  const isImmobile = Boolean(input.isImmobile);

  if (!input.deliveryMode && !isImmobile) {
    return {
      valid: false,
      error: "Please select a delivery mode (Doorstep or Workshop Drop-Off).",
      effectiveMode: "DOORSTEP",
    };
  }

  const requestedMode = input.deliveryMode === "WORKSHOP_DROPOFF" ? "WORKSHOP_DROPOFF" : "DOORSTEP";

  if (isImmobile && requestedMode === "WORKSHOP_DROPOFF") {
    return {
      valid: false,
      error: IMMOBILE_LOCK_WARNING,
      effectiveMode: "DOORSTEP",
    };
  }

  if (requestedMode === "DOORSTEP" && input.facilityId?.trim()) {
    return {
      valid: false,
      error: "Facility reference cannot be provided when delivery mode is DOORSTEP.",
      effectiveMode: "DOORSTEP",
    };
  }

  if (requestedMode === "WORKSHOP_DROPOFF" && !input.facilityId?.trim()) {
    return {
      valid: false,
      error: "Please select an approved workshop for workshop drop-off.",
      effectiveMode: "WORKSHOP_DROPOFF",
    };
  }

  return {
    valid: true,
    effectiveMode: resolveEffectiveDeliveryMode(isImmobile, requestedMode),
  };
}

/**
 * Evaluates whether a facility is eligible for workshop drop-off.
 * In Phase 14 Milestone 3, requires drop_off_approved = true and is_active = true.
 * Bay capacity allocation and reservation checks are reserved for Milestone 4.
 */
export function isWorkshopEligible(facility: {
  drop_off_approved?: boolean | null;
  is_active?: boolean | null;
}): boolean {
  return Boolean(facility.drop_off_approved && facility.is_active);
}

/**
 * Backward compatibility alias for isWorkshopEligible.
 */
export const isWorkshopSelectable = isWorkshopEligible;
