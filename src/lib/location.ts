/**
 * Official 14 Tahsils (Talukas) of Nagpur District, Maharashtra
 * Source: Nagpur District Administration (https://nagpur.gov.in/administration/)
 */
export const NAGPUR_TAHSILS = [
  "Nagpur (Urban)",
  "Nagpur (Rural)",
  "Kamptee",
  "Hingna",
  "Katol",
  "Narkhed",
  "Saoner",
  "Kalmeshwar",
  "Ramtek",
  "Parseoni",
  "Mauda",
  "Umred",
  "Bhiwapur",
  "Kuhi",
] as const;

export type NagpurTahsil = (typeof NAGPUR_TAHSILS)[number];

export interface GpsCoordinates {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  capturedAt?: string;
}

/**
 * Formats coarse location as "Village, Tahsil" or fallback.
 * Preserves legacy location values without alteration.
 */
export function formatCoarseLocation(village?: string | null, tahsil?: string | null): string {
  const v = village?.trim();
  const t = tahsil?.trim();
  if (v && t) return `${v}, ${t}`;
  return v || t || "";
}

/**
 * Validates GPS latitude and longitude ranges.
 * Latitude must be within [-90, 90], Longitude within [-180, 180].
 * Rejects (0, 0) as Null Island.
 */
export function isValidGpsCoordinate(latitude: unknown, longitude: unknown): boolean {
  if (typeof latitude !== "number" || typeof longitude !== "number") return false;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;
  if (latitude === 0 && longitude === 0) return false;
  return true;
}

/**
 * Formats GPS accuracy in meters for human readability (e.g. "±14m").
 */
export function formatGpsAccuracy(accuracy?: number | null): string {
  if (accuracy == null || !Number.isFinite(accuracy) || accuracy < 0) return "";
  return `±${Math.round(accuracy)}m`;
}

/**
 * Builds an on-demand external directions URL to exact coordinates using Google Maps.
 * Validates coordinates before generating the URL.
 */
export function buildGoogleMapsDirectionsUrl(latitude: number, longitude: number): string {
  if (!isValidGpsCoordinate(latitude, longitude)) {
    throw new Error("Cannot generate directions URL: Invalid coordinates.");
  }
  const destination = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

/**
 * Builds an on-demand external search URL for coarse village/tahsil location using Google Maps.
 */
export function buildGoogleMapsSearchUrl(locationQuery: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationQuery.trim())}`;
}

/**
 * Validates whether an input string is a valid standard UUID.
 */
export function isUuid(value?: string | null): boolean {
  if (!value || typeof value !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

export type GpsVisibilityCategory = "exact_available" | "not_captured" | "permission_denied";

/**
 * Categorizes the GPS visibility state into one of three explicit states:
 * a) not_captured: Ticket was reported without GPS; coarse search fallback only.
 * b) exact_available: Ticket has valid GPS and viewer has authorized access.
 * c) permission_denied: Ticket location is private; viewer lacks permission (e.g. unassigned queue).
 */
export function determineGpsVisibilityCategory(params: {
  hasGpsLocation: boolean;
  isAuthorized: boolean;
}): GpsVisibilityCategory {
  if (!params.isAuthorized) return "permission_denied";
  if (params.hasGpsLocation) return "exact_available";
  return "not_captured";
}
