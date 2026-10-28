import { isValidGpsCoordinate } from "../location.ts";

export interface GpsPoint {
  latitude: number;
  longitude: number;
}

export interface RouteEstimateResult {
  success: true;
  distanceMeters: number;
  distanceKm: number;
  durationSeconds: number;
  durationMinutes: number;
  durationFormatted: string;
  calculatedAt: string;
  isTrafficAware: false;
}

/**
 * Formats a distance in meters into human-readable metric string.
 * Sub-kilometer distances are shown in meters (e.g. "850 m").
 * Distances 1 km and above are shown in kilometers with 1 decimal place (e.g. "14.2 km").
 */
export function formatRouteDistance(distanceMeters: number): string {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    return "0 km";
  }
  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)} m`;
  }
  const km = distanceMeters / 1000;
  return `${km.toFixed(1)} km`;
}

/**
 * Formats duration in seconds into human-readable duration string.
 * Under 60 minutes: "X mins" (e.g. "28 mins").
 * 60 minutes and above: "X hr Y mins" (e.g. "1 hr 15 mins").
 */
export function formatRouteDuration(durationSeconds: number): string {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    return "0 mins";
  }
  const totalMinutes = Math.round(durationSeconds / 60);
  if (totalMinutes < 60) {
    return `${Math.max(1, totalMinutes)} mins`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) {
    return `${hours} hr`;
  }
  return `${hours} hr ${minutes} mins`;
}

/**
 * Parses Google Routes API duration string format (e.g. "1680s") into seconds.
 */
export function parseGoogleDurationSeconds(durationStr: unknown): number {
  if (typeof durationStr !== "string") {
    return 0;
  }
  const clean = durationStr.trim().toLowerCase();
  if (clean.endsWith("s")) {
    const parsed = parseFloat(clean.slice(0, -1));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }
  const fallback = parseFloat(clean);
  return Number.isFinite(fallback) && fallback >= 0 ? fallback : 0;
}

/**
 * Computes a driving route estimate between two points using the free public OSRM service.
 * OSRM endpoint expects coordinates in longitude,latitude order:
 * https://router.project-osrm.org/route/v1/driving/{longitude},{latitude};{longitude},{latitude}?overview=false
 *
 * Distance is returned in meters, duration in seconds.
 * Transient calculation; traffic-unaware.
 */
export async function computeOsrmRoute(
  origin: GpsPoint,
  destination: GpsPoint,
  fetchFn: typeof fetch = fetch,
): Promise<RouteEstimateResult> {
  if (!isValidGpsCoordinate(origin.latitude, origin.longitude)) {
    throw new Error("Invalid origin GPS coordinates.");
  }
  if (!isValidGpsCoordinate(destination.latitude, destination.longitude)) {
    throw new Error("Invalid destination GPS coordinates.");
  }

  const endpoint = `https://router.project-osrm.org/route/v1/driving/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}?overview=false`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetchFn(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorMsg = `OSRM routing request failed with status ${response.status}.`;
      try {
        const errJson = await response.json();
        if (errJson?.message) {
          errorMsg = errJson.message;
        }
      } catch {
        /* ignore json parse error */
      }
      throw new Error(errorMsg);
    }

    const data = await response.json();

    if (data?.code !== "Ok" || !Array.isArray(data?.routes) || data.routes.length === 0) {
      throw new Error("No drivable route found between current location and destination.");
    }

    const route = data.routes[0];
    if (typeof route?.distance !== "number" || typeof route?.duration !== "number") {
      throw new Error("No drivable route found between current location and destination.");
    }

    const distanceMeters = Math.round(route.distance);
    const durationSeconds = Math.round(route.duration);
    const distanceKm = Math.round((distanceMeters / 1000) * 10) / 10;
    const durationMinutes = Math.max(1, Math.round(durationSeconds / 60));
    const durationFormatted = formatRouteDuration(durationSeconds);

    return {
      success: true,
      distanceMeters,
      distanceKm,
      durationSeconds,
      durationMinutes,
      durationFormatted,
      calculatedAt: new Date().toISOString(),
      isTrafficAware: false,
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("OSRM routing request timed out. Please try again.");
    }
    throw err;
  }
}

/**
 * Computes a standard driving route estimate between two points using Google Maps Routes API v2.
 * Strictly uses TRAFFIC_UNAWARE to avoid live traffic modifier SKUs and ensure standard driving estimates.
 * Restricts field mask strictly to routes.distanceMeters and routes.duration.
 */
export async function computeGoogleRoute(
  origin: GpsPoint,
  destination: GpsPoint,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<RouteEstimateResult> {
  if (!isValidGpsCoordinate(origin.latitude, origin.longitude)) {
    throw new Error("Invalid origin GPS coordinates.");
  }
  if (!isValidGpsCoordinate(destination.latitude, destination.longitude)) {
    throw new Error("Invalid destination GPS coordinates.");
  }
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    throw new Error("Google Maps Server Key is missing or invalid.");
  }

  const endpoint = "https://routes.googleapis.com/directions/v2:computeRoutes";

  const requestBody = {
    origin: {
      location: {
        latLng: {
          latitude: origin.latitude,
          longitude: origin.longitude,
        },
      },
    },
    destination: {
      location: {
        latLng: {
          latitude: destination.latitude,
          longitude: destination.longitude,
        },
      },
    },
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_UNAWARE",
    computeAlternativeRoutes: false,
    routeModifiers: {
      avoidTolls: false,
      avoidHighways: false,
      avoidFerries: true,
    },
    languageCode: "en-US",
    units: "METRIC",
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey.trim(),
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorMsg = `Google Routes API request failed with status ${response.status}.`;
      try {
        const errJson = await response.json();
        if (errJson?.error?.message) {
          errorMsg = errJson.error.message;
        }
      } catch {
        /* ignore json parse error */
      }
      throw new Error(errorMsg);
    }

    const data = await response.json();
    const route = data?.routes?.[0];

    if (!route || typeof route.distanceMeters !== "number") {
      throw new Error("No drivable route found between current location and destination.");
    }

    const distanceMeters = route.distanceMeters;
    const durationSeconds = parseGoogleDurationSeconds(route.duration);
    const distanceKm = Math.round((distanceMeters / 1000) * 10) / 10;
    const durationMinutes = Math.max(1, Math.round(durationSeconds / 60));
    const durationFormatted = formatRouteDuration(durationSeconds);

    return {
      success: true,
      distanceMeters,
      distanceKm,
      durationSeconds,
      durationMinutes,
      durationFormatted,
      calculatedAt: new Date().toISOString(),
      isTrafficAware: false,
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Google Routes API request timed out. Please try again.");
    }
    throw err;
  }
}
