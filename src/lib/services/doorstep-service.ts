/**
 * TerraByte — Phase 10.2: Doorstep Service Intake & Operational Urgency Domain Logic
 * Provides types, validation, sanitization, and triage sorting utilities for
 * agricultural machinery repair requests.
 */

export const SERVICE_TYPES = ["DOORSTEP", "WORKSHOP"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const URGENCY_LEVELS = ["CRITICAL", "HIGH", "STANDARD", "FLEXIBLE"] as const;
export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];

export const FARMER_AVAILABILITY_SLOTS = [
  "Immediate / ASAP",
  "Today Afternoon (2 PM–6 PM)",
  "Tomorrow Morning (8 AM–12 PM)",
  "Flexible",
] as const;
export type FarmerAvailabilitySlot = (typeof FARMER_AVAILABILITY_SLOTS)[number];

export interface UrgencyOption {
  level: UrgencyLevel;
  title: string;
  description: string;
}

export const URGENCY_OPTIONS: UrgencyOption[] = [
  {
    level: "CRITICAL",
    title: "Critical",
    description: "Field operations halted; urgent assistance needed.",
  },
  {
    level: "HIGH",
    title: "High",
    description: "Service needed within 24 hours.",
  },
  {
    level: "STANDARD",
    title: "Standard",
    description: "Normal repair timeline.",
  },
  {
    level: "FLEXIBLE",
    title: "Flexible",
    description: "Routine maintenance.",
  },
];

export interface ServiceModeOption {
  mode: ServiceType;
  label: string;
  subtitle: string;
}

export const SERVICE_MODE_OPTIONS: ServiceModeOption[] = [
  {
    mode: "DOORSTEP",
    label: "Doorstep / On-Field",
    subtitle: "Technician travels to your machine in the field",
  },
  {
    mode: "WORKSHOP",
    label: "Workshop Drop-off",
    subtitle: "You bring or tow equipment to the service depot",
  },
];

export function isValidServiceType(val: unknown): val is ServiceType {
  return typeof val === "string" && (SERVICE_TYPES as readonly string[]).includes(val);
}

export function isValidUrgencyLevel(val: unknown): val is UrgencyLevel {
  return typeof val === "string" && (URGENCY_LEVELS as readonly string[]).includes(val);
}

/**
 * Sanitizes plain text input by stripping control chars / HTML tags and trimming.
 * Retains printable ASCII, standard whitespace, and international/Devanagari unicode (Hindi/Marathi).
 */
export function sanitizeDoorstepTextField(text: unknown): string {
  if (typeof text !== "string") return "";
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, "") // strip script tags and contents
    .replace(/<style[\s\S]*?<\/style>/gi, "") // strip style tags and contents
    .replace(/<[^>]*>/g, "") // strip remaining HTML tags
    .replace(/[<>]/g, "") // strip any dangling angle brackets
    .split("")
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return (code >= 32 && code !== 127) || code === 10 || code === 13 || code === 9 || code > 159;
    })
    .join("")
    .trim();
}

export interface ValidatedDoorstepUrgencyInput {
  service_type: ServiceType;
  urgency_level: UrgencyLevel;
  is_machine_stopped: boolean;
  preferred_time_slot: string | null;
  field_landmark: string | null;
}

export function validateDoorstepUrgencyInput(input?: {
  service_type?: unknown;
  urgency_level?: unknown;
  is_machine_stopped?: unknown;
  preferred_time_slot?: unknown;
  field_landmark?: unknown;
}): ValidatedDoorstepUrgencyInput {
  // Service Type (default: DOORSTEP)
  let service_type: ServiceType = "DOORSTEP";
  if (input?.service_type !== undefined && input?.service_type !== null) {
    if (!isValidServiceType(input.service_type)) {
      throw new Error(
        `Invalid service_type "${String(input.service_type)}": must be one of ${SERVICE_TYPES.join(", ")}`,
      );
    }
    service_type = input.service_type;
  }

  // Urgency Level (default: STANDARD)
  let urgency_level: UrgencyLevel = "STANDARD";
  if (input?.urgency_level !== undefined && input?.urgency_level !== null) {
    if (!isValidUrgencyLevel(input.urgency_level)) {
      throw new Error(
        `Invalid urgency_level "${String(input.urgency_level)}": must be one of ${URGENCY_LEVELS.join(", ")}`,
      );
    }
    urgency_level = input.urgency_level;
  }

  // Machine Stoppage (default: false)
  const is_machine_stopped = Boolean(input?.is_machine_stopped);

  // Preferred Time Slot (max 100 characters)
  let preferred_time_slot: string | null = null;
  if (input?.preferred_time_slot !== undefined && input?.preferred_time_slot !== null) {
    const raw = String(input.preferred_time_slot);
    const sanitized = sanitizeDoorstepTextField(raw);
    if (sanitized.length > 100) {
      throw new Error(
        `preferred_time_slot exceeds maximum length of 100 characters (received ${sanitized.length}).`,
      );
    }
    preferred_time_slot = sanitized.length > 0 ? sanitized : null;
  }

  // Field Landmark (max 300 characters)
  let field_landmark: string | null = null;
  if (input?.field_landmark !== undefined && input?.field_landmark !== null) {
    const raw = String(input.field_landmark);
    const sanitized = sanitizeDoorstepTextField(raw);
    if (sanitized.length > 300) {
      throw new Error(
        `field_landmark exceeds maximum length of 300 characters (received ${sanitized.length}).`,
      );
    }
    field_landmark = sanitized.length > 0 ? sanitized : null;
  }

  return {
    service_type,
    urgency_level,
    is_machine_stopped,
    preferred_time_slot,
    field_landmark,
  };
}

/**
 * Normalizes a repair request row (or legacy record) to ensure doorstep and urgency attributes
 * possess canonical defaults when rendered or processed.
 */
export function normalizeRepairDoorstepUrgency(repair?: unknown): {
  service_type: ServiceType;
  urgency_level: UrgencyLevel;
  is_machine_stopped: boolean;
  preferred_time_slot: string | null;
  field_landmark: string | null;
} {
  if (!repair || typeof repair !== "object") {
    return {
      service_type: "DOORSTEP",
      urgency_level: "STANDARD",
      is_machine_stopped: false,
      preferred_time_slot: null,
      field_landmark: null,
    };
  }

  const rec = repair as Record<string, unknown>;

  // Check top-level columns/properties first, then fallback to embedded assessment.doorstep_urgency
  // (ensures full backward compatibility if remote database has unmigrated schema cache)
  const rawAssessment = rec["assessment"];
  let embeddedDoorstep: Record<string, unknown> = {};
  if (rawAssessment && typeof rawAssessment === "object") {
    const asObj = rawAssessment as Record<string, unknown>;
    if (asObj["doorstep_urgency"] && typeof asObj["doorstep_urgency"] === "object") {
      embeddedDoorstep = asObj["doorstep_urgency"] as Record<string, unknown>;
    } else {
      embeddedDoorstep = asObj;
    }
  } else if (
    typeof rawAssessment === "string" &&
    (rawAssessment as string).trim().startsWith("{")
  ) {
    try {
      const parsed = JSON.parse(rawAssessment as string);
      if (parsed && typeof parsed === "object") {
        embeddedDoorstep = (
          parsed["doorstep_urgency"] && typeof parsed["doorstep_urgency"] === "object"
            ? parsed["doorstep_urgency"]
            : parsed
        ) as Record<string, unknown>;
      }
    } catch {
      // ignore JSON parse error
    }
  }

  const rawService =
    rec["service_type"] ??
    rec["serviceType"] ??
    embeddedDoorstep["service_type"] ??
    embeddedDoorstep["serviceType"];
  const rawUrgency =
    rec["urgency_level"] ??
    rec["urgencyLevel"] ??
    embeddedDoorstep["urgency_level"] ??
    embeddedDoorstep["urgencyLevel"];
  const rawStopped =
    rec["is_machine_stopped"] ??
    rec["isMachineStopped"] ??
    embeddedDoorstep["is_machine_stopped"] ??
    embeddedDoorstep["isMachineStopped"];
  const rawSlot =
    rec["preferred_time_slot"] ??
    rec["preferredTimeSlot"] ??
    embeddedDoorstep["preferred_time_slot"] ??
    embeddedDoorstep["preferredTimeSlot"];
  const rawLandmark =
    rec["field_landmark"] ??
    rec["fieldLandmark"] ??
    embeddedDoorstep["field_landmark"] ??
    embeddedDoorstep["fieldLandmark"];

  return {
    service_type: isValidServiceType(rawService) ? rawService : "DOORSTEP",
    urgency_level: isValidUrgencyLevel(rawUrgency) ? rawUrgency : "STANDARD",
    is_machine_stopped: Boolean(rawStopped),
    preferred_time_slot:
      typeof rawSlot === "string" && rawSlot.trim().length > 0
        ? sanitizeDoorstepTextField(rawSlot) || null
        : null,
    field_landmark:
      typeof rawLandmark === "string" && rawLandmark.trim().length > 0
        ? sanitizeDoorstepTextField(rawLandmark) || null
        : null,
  };
}

/**
 * Priority comparator for triage lists (e.g., Technician and Service Centre feeds):
 * Orders by:
 * 1. Critical machine stopped in field (emergency)
 * 2. Critical general breakdown
 * 3. High urgency
 * 4. Standard
 * 5. Flexible
 */
export function triageUrgencyComparator(a: unknown, b: unknown): number {
  const normA = normalizeRepairDoorstepUrgency(a);
  const normB = normalizeRepairDoorstepUrgency(b);

  const scoreA =
    normA.urgency_level === "CRITICAL" && normA.is_machine_stopped
      ? 100
      : normA.urgency_level === "CRITICAL"
        ? 80
        : normA.urgency_level === "HIGH"
          ? 60
          : normA.urgency_level === "STANDARD"
            ? 40
            : 20;

  const scoreB =
    normB.urgency_level === "CRITICAL" && normB.is_machine_stopped
      ? 100
      : normB.urgency_level === "CRITICAL"
        ? 80
        : normB.urgency_level === "HIGH"
          ? 60
          : normB.urgency_level === "STANDARD"
            ? 40
            : 20;

  return scoreB - scoreA;
}
