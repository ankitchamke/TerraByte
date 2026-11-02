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

export interface GpsPoint {
  latitude: number;
  longitude: number;
}

export interface GpsCoordinates extends GpsPoint {
  accuracy?: number | null;
  capturedAt?: string;
}

/**
 * Official geographic centroid coordinates for the 14 Tahsils of Nagpur District, Maharashtra.
 * Coordinates are verified against Survey of India and District Administration geographic data.
 * Used strictly as an approximate regional fallback when exact GPS coordinates were not captured.
 */
export const NAGPUR_TAHSIL_CENTROIDS: Readonly<Record<NagpurTahsil, GpsPoint>> = {
  "Nagpur (Urban)": { latitude: 21.1458, longitude: 79.0882 },
  "Nagpur (Rural)": { latitude: 21.185, longitude: 79.05 },
  Kamptee: { latitude: 21.223, longitude: 79.1994 },
  Hingna: { latitude: 20.9708, longitude: 78.9667 },
  Katol: { latitude: 21.2682, longitude: 78.5833 },
  Narkhed: { latitude: 21.4878, longitude: 78.5322 },
  Saoner: { latitude: 21.385, longitude: 78.9167 },
  Kalmeshwar: { latitude: 21.2333, longitude: 78.9167 },
  Ramtek: { latitude: 21.397, longitude: 79.3314 },
  Parseoni: { latitude: 21.3789, longitude: 79.2044 },
  Mauda: { latitude: 21.2706, longitude: 79.3939 },
  Umred: { latitude: 20.8544, longitude: 79.3275 },
  Bhiwapur: { latitude: 20.7631, longitude: 79.5211 },
  Kuhi: { latitude: 20.92, longitude: 79.36 },
} as const;

/**
 * Normalizes an input string to an official Nagpur Tahsil name.
 * Handles casing, punctuation, and common regional aliases.
 * Returns null if the location is not a recognized Nagpur tahsil.
 */
export function normalizeNagpurTahsil(input?: string | null): NagpurTahsil | null {
  if (!input || typeof input !== "string") return null;
  const clean = input
    .trim()
    .toLowerCase()
    .replace(/[-_,/]/g, " ");

  if (clean.includes("urban") && clean.includes("nagpur")) return "Nagpur (Urban)";
  if (clean.includes("rural") && clean.includes("nagpur")) return "Nagpur (Rural)";
  if (clean === "nagpur" || clean === "nagpur city") return "Nagpur (Urban)";

  if (clean.includes("katol")) return "Katol";
  if (clean.includes("saoner") || clean.includes("savner")) return "Saoner";
  if (clean.includes("umred") || clean.includes("umrer")) return "Umred";
  if (clean.includes("narkhed") || clean.includes("narkher")) return "Narkhed";
  if (clean.includes("kalmeshwar") || clean.includes("kalmeshver")) return "Kalmeshwar";
  if (clean.includes("ramtek")) return "Ramtek";
  if (clean.includes("kamptee") || clean.includes("kamthi")) return "Kamptee";
  if (clean.includes("hingna")) return "Hingna";
  if (clean.includes("parseoni") || clean.includes("parshioni")) return "Parseoni";
  if (clean.includes("mauda") || clean.includes("mouda")) return "Mauda";
  if (clean.includes("bhiwapur")) return "Bhiwapur";
  if (clean.includes("kuhi")) return "Kuhi";

  // Devanagari Marathi / Hindi Tahsil aliases
  if (clean.includes("काटोल")) return "Katol";
  if (clean.includes("सावनेर")) return "Saoner";
  if (clean.includes("उमरेड") || clean.includes("उमरेर")) return "Umred";
  if (clean.includes("नरखेड")) return "Narkhed";
  if (clean.includes("कळमेश्वर") || clean.includes("कलमेश्वर")) return "Kalmeshwar";
  if (clean.includes("रामटेक")) return "Ramtek";
  if (clean.includes("कामठी")) return "Kamptee";
  if (clean.includes("हिंगणा")) return "Hingna";
  if (clean.includes("पारशिवणी") || clean.includes("पारशिवनी")) return "Parseoni";
  if (clean.includes("मौदा")) return "Mauda";
  if (clean.includes("भिवापूर")) return "Bhiwapur";
  if (clean.includes("कुही")) return "Kuhi";
  if (clean.includes("नागपूर") && clean.includes("ग्रामीण")) return "Nagpur (Rural)";
  if (clean.includes("नागपूर") && (clean.includes("शहर") || clean.includes("नागरी")))
    return "Nagpur (Urban)";
  if (clean === "नागपूर") return "Nagpur (Urban)";

  for (const t of NAGPUR_TAHSILS) {
    if (t.toLowerCase() === clean) return t;
  }

  return null;
}

/**
 * Retrieves the verified geographic centroid for a recognized Nagpur Tahsil or village text.
 * Strictly returns null if the location is unknown (does NOT silently default to Nagpur city).
 */
export function getNagpurTahsilCentroid(locationOrTahsil?: string | null): GpsPoint | null {
  const normalized = normalizeNagpurTahsil(locationOrTahsil);
  if (!normalized) return null;
  const centroid = NAGPUR_TAHSIL_CENTROIDS[normalized];
  return centroid ? { latitude: centroid.latitude, longitude: centroid.longitude } : null;
}

/**
 * Distance calculation source indicator distinguishing exact farmer GPS vs tahsil centroid estimates.
 */
export type DistanceSource = "exact_gps" | "tahsil_centroid" | "unknown";

/**
 * Computes the great-circle Haversine straight-line distance in kilometers between two GPS points.
 */
export function computeHaversineDistanceKm(origin: GpsPoint, destination: GpsPoint): number {
  if (
    !isValidGpsCoordinate(origin?.latitude, origin?.longitude) ||
    !isValidGpsCoordinate(destination?.latitude, destination?.longitude)
  ) {
    throw new Error("Invalid GPS coordinates for Haversine distance computation.");
  }

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371; // Earth radius in km
  const dLat = toRad(destination.latitude - origin.latitude);
  const dLon = toRad(destination.longitude - origin.longitude);
  const lat1 = toRad(origin.latitude);
  const lat2 = toRad(destination.latitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c;

  return Math.round(d * 10) / 10;
}

export interface ApproximateRoadDistanceResult {
  distanceKm: number;
  durationMinutes: number;
  durationFormatted: string;
  isApproximate: true;
}

/**
 * Computes an approximate road distance using a rural road curvature factor (1.3x)
 * and standard agricultural transit speed (35 km/h).
 */
export function computeApproximateRoadDistance(
  origin: GpsPoint,
  destination: GpsPoint,
): ApproximateRoadDistanceResult {
  const straightLineKm = computeHaversineDistanceKm(origin, destination);
  const roadKm = Math.round(straightLineKm * 1.3 * 10) / 10;
  const durationMinutes = Math.max(5, Math.round((roadKm / 35) * 60));

  const hours = Math.floor(durationMinutes / 60);
  const mins = durationMinutes % 60;
  const durationFormatted =
    hours > 0 ? (mins > 0 ? `${hours} hr ${mins} mins` : `${hours} hr`) : `${durationMinutes} mins`;

  return {
    distanceKm: roadKm,
    durationMinutes,
    durationFormatted,
    isApproximate: true,
  };
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
