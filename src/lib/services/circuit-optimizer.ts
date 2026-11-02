/**
 * TerraByte — Phase 10.4-B: Multi-Stop Circuit Optimization Engine
 *
 * Provides pure, deterministic domain services for:
 * 1. Sequential multi-stop field route planning (Depot -> Stop 1 -> ... -> Stop N -> Depot).
 * 2. Urgency-constrained Traveling Technician heuristic (CRITICAL + stopped machines prioritized first).
 * 3. Leg-by-leg metrics, cumulative travel times, and total circuit distances.
 * 4. Marginal detour cost calculation for emergency breakdown insertion.
 * 5. Nagpur tahsil-based clustering of open doorstep repairs.
 */

import {
  NAGPUR_TAHSILS,
  NAGPUR_TAHSIL_CENTROIDS,
  normalizeNagpurTahsil,
  getNagpurTahsilCentroid,
  isValidGpsCoordinate,
  computeApproximateRoadDistance,
  type GpsPoint,
  type DistanceSource,
  type NagpurTahsil,
} from "../location.ts";

import {
  normalizeRepairDoorstepUrgency,
  type ServiceType,
  type UrgencyLevel,
} from "./doorstep-service.ts";

import {
  resolveDrivingDistance,
  formatRouteDistance,
  formatRouteDuration,
  type ResolvedTravelDistance,
} from "./routing.ts";

// ==============================================================================
// 1. DATA CONTRACTS & INTERFACES
// ==============================================================================

/**
 * Flexible input stop representation accepted by circuit planning functions.
 * Can represent either a lightweight stop object or a full Supabase repair request record.
 */
export interface CircuitStopInput {
  id: string;
  jobNumber?: string | null | undefined;
  location?: string | null | undefined;
  village?: string | null | undefined;
  tahsil?: string | null | undefined;
  field_landmark?: string | null | undefined;
  latitude?: number | null | undefined;
  longitude?: number | null | undefined;
  gpsPoint?: GpsPoint | null | undefined;
  accuracy?: number | null | undefined;
  repair_dispatch_locations?: unknown;
  service_type?: ServiceType | string | null | undefined;
  serviceType?: ServiceType | string | null | undefined;
  urgency_level?: UrgencyLevel | string | null | undefined;
  urgencyLevel?: UrgencyLevel | string | null | undefined;
  is_machine_stopped?: boolean | null | undefined;
  isMachineStopped?: boolean | null | undefined;
  customerName?: string | null | undefined;
  equipmentModel?: string | null | undefined;
  status?: string | null | undefined;
  assessment?: unknown;
  [key: string]: unknown;
}

/**
 * Normalized stop within an optimized field circuit.
 */
export interface ResolvedCircuitStop<T = unknown> {
  id: string;
  jobNumber: string;
  location: string;
  village: string;
  tahsil: NagpurTahsil | null;
  gpsPoint: GpsPoint | null;
  accuracy?: number | null | undefined;
  distanceSource: DistanceSource;
  isEmergency: boolean; // CRITICAL urgency AND machine halted in field
  urgencyLevel: UrgencyLevel;
  isMachineStopped: boolean;
  serviceType: ServiceType;
  customerName: string;
  equipmentModel: string;
  raw: T;
}

/**
 * Individual travel leg between two waypoints in the circuit.
 */
export interface CircuitLeg {
  legIndex: number;
  fromType: "depot" | "stop";
  toType: "stop" | "depot";
  fromId: string;
  fromName: string;
  fromPoint: GpsPoint | null;
  toId: string;
  toName: string;
  toPoint: GpsPoint | null;
  distanceKm: number;
  distanceMeters: number;
  distanceFormatted: string;
  durationMinutes: number;
  durationSeconds: number;
  durationFormatted: string;
  routingMode: "osrm_driving" | "rural_road_fallback";
  isEstimate: boolean;
  distanceSource: DistanceSource;
}

/**
 * Ordered stop along an optimized itinerary with cumulative stats from depot.
 */
export interface OrderedCircuitStop<T = unknown> {
  sequenceNumber: number; // 1-based (1, 2, 3...)
  stop: ResolvedCircuitStop<T>;
  arrivalLegIndex: number;
  cumulativeDistanceKm: number;
  cumulativeDistanceFormatted: string;
  cumulativeDurationMinutes: number;
  cumulativeDurationFormatted: string;
}

/**
 * Complete metrics result for an optimized multi-stop circuit.
 */
export interface CircuitMetricsResult<T = unknown> {
  depot: GpsPoint & { name?: string };
  orderedStops: OrderedCircuitStop<T>[];
  legs: CircuitLeg[];
  stopCount: number;
  totalDistanceKm: number;
  totalDistanceMeters: number;
  totalDistanceFormatted: string;
  totalDurationMinutes: number;
  totalDurationSeconds: number;
  totalDurationFormatted: string;
  routingMode: "osrm_driving" | "rural_road_fallback" | "mixed";
  hasOsrmMetrics: boolean;
  hasEmergencyStops: boolean;
  emergencyStopCount: number;
}

/**
 * Additional travel cost analysis for inserting an emergency repair into an active circuit.
 */
export interface DetourCostResult<T = unknown> {
  insertionIndex: number; // 0-based position in stops array (0 means first stop after depot)
  additionalDistanceKm: number;
  additionalDistanceFormatted: string;
  additionalDurationMinutes: number;
  additionalDurationFormatted: string;
  isEmergency: boolean;
  previousTotalDistanceKm: number;
  newTotalDistanceKm: number;
  previousTotalDurationMinutes: number;
  newTotalDurationMinutes: number;
  updatedStops: ResolvedCircuitStop<T>[];
  detourReason: string;
}

/**
 * Open doorstep repairs clustered by Nagpur tahsil.
 */
export interface TahsilCluster<T = unknown> {
  tahsil: NagpurTahsil | "Unknown";
  repairs: T[];
  count: number;
  criticalStoppedCount: number;
  centroid: GpsPoint | null;
  criticalCount: number;
  highCount: number;
  standardCount: number;
  flexibleCount: number;
}

export interface ClusterRepairsResult<T = unknown> {
  clusters: Record<string, TahsilCluster<T>>;
  clusterList: TahsilCluster<T>[];
  totalEligibleDoorstepRepairs: number;
  totalExcludedWorkshopRepairs: number;
  unknownCount: number;
}

// ==============================================================================
// 2. STOP COORDINATE & ATTRIBUTE RESOLUTION
// ==============================================================================

/**
 * Resolves geographic coordinates and source indicator for a stop.
 * Prioritizes:
 * 1. Exact GPS coordinates if valid (`exact_gps`)
 * 2. Official Nagpur Tahsil centroid if recognizable (`tahsil_centroid`)
 * 3. Unresolvable location (`unknown`, point: null)
 */
export function resolveStopCoordinates(stop: CircuitStopInput): {
  point: GpsPoint | null;
  source: DistanceSource;
  normalizedTahsil: NagpurTahsil | null;
  accuracy?: number | null | undefined;
} {
  let rawLat = stop.gpsPoint?.latitude ?? stop.latitude;
  let rawLng = stop.gpsPoint?.longitude ?? stop.longitude;
  let accuracy: number | null | undefined = stop.accuracy;

  // 1. Direct coordinates check
  if (!isValidGpsCoordinate(rawLat, rawLng)) {
    // 2. Check attached repair_dispatch_locations (single object or array)
    const rawDispatch = stop["repair_dispatch_locations"];
    const loc = Array.isArray(rawDispatch) ? rawDispatch[0] : rawDispatch;
    if (loc && typeof loc === "object") {
      const locObj = loc as Record<string, unknown>;
      const candidateLat = Number(locObj["latitude"]);
      const candidateLng = Number(locObj["longitude"]);
      if (isValidGpsCoordinate(candidateLat, candidateLng)) {
        rawLat = candidateLat;
        rawLng = candidateLng;
        accuracy = (locObj["accuracy"] as number | null) ?? null;
      }
    }
  }

  // 3. Check stop.raw.repair_dispatch_locations if present
  const stopRaw = stop["raw"];
  if (!isValidGpsCoordinate(rawLat, rawLng) && typeof stopRaw === "object" && stopRaw !== null) {
    const rawRecord = stopRaw as Record<string, unknown>;
    const rawDispatch = rawRecord["repair_dispatch_locations"];
    const rawLoc = Array.isArray(rawDispatch) ? rawDispatch[0] : rawDispatch;
    if (rawLoc && typeof rawLoc === "object") {
      const locObj = rawLoc as Record<string, unknown>;
      const candidateLat = Number(locObj["latitude"]);
      const candidateLng = Number(locObj["longitude"]);
      if (isValidGpsCoordinate(candidateLat, candidateLng)) {
        rawLat = candidateLat;
        rawLng = candidateLng;
        accuracy = (locObj["accuracy"] as number | null) ?? null;
      }
    }
  }

  // Exact GPS takes precedence over tahsil centroid fallback
  if (isValidGpsCoordinate(rawLat, rawLng)) {
    const normalizedTahsil =
      normalizeNagpurTahsil(stop.tahsil) ??
      normalizeNagpurTahsil(stop.village) ??
      normalizeNagpurTahsil(stop.location);

    return {
      point: { latitude: Number(rawLat), longitude: Number(rawLng) },
      source: "exact_gps",
      normalizedTahsil,
      accuracy: accuracy ?? null,
    };
  }

  const candidateLocation = stop.tahsil || stop.village || stop.location || stop.field_landmark;
  const normalizedTahsil = normalizeNagpurTahsil(candidateLocation);

  if (normalizedTahsil) {
    const centroid = getNagpurTahsilCentroid(normalizedTahsil);
    if (centroid) {
      return {
        point: centroid,
        source: "tahsil_centroid",
        normalizedTahsil,
        accuracy: null,
      };
    }
  }

  return {
    point: null,
    source: "unknown",
    normalizedTahsil: null,
    accuracy: null,
  };
}

/**
 * Normalizes an arbitrary repair object or stop input into a validated ResolvedCircuitStop.
 */
export function normalizeCircuitStop<T = unknown>(
  input: CircuitStopInput | Record<string, unknown>,
): ResolvedCircuitStop<T> {
  const raw = input as Record<string, unknown>;
  const doorstep = normalizeRepairDoorstepUrgency(raw);

  const id = String(raw["id"] || raw["repair_request_id"] || raw["job_number"] || "unknown");
  const jobNumber = String(raw["job_number"] || raw["jobNumber"] || id);

  const village = String(raw["village"] || "");
  const location = String(raw["location"] || village || "Nagpur District");

  const customerName = String(
    raw["farmer_name"] ||
      raw["farmerName"] ||
      (typeof raw["farmer"] === "object" && raw["farmer"] !== null
        ? (raw["farmer"] as Record<string, unknown>)["full_name"]
        : "") ||
      "Farmer",
  );

  const equipmentModel = String(
    raw["equipment_model"] ||
      raw["equipmentModel"] ||
      (typeof raw["equipment"] === "object" && raw["equipment"] !== null
        ? `${(raw["equipment"] as Record<string, unknown>)["make"] || ""} ${(raw["equipment"] as Record<string, unknown>)["model"] || ""}`.trim()
        : "") ||
      "Equipment",
  );

  const { point, source, normalizedTahsil, accuracy } = resolveStopCoordinates(
    input as CircuitStopInput,
  );

  const isEmergency = doorstep.urgency_level === "CRITICAL" && doorstep.is_machine_stopped;

  return {
    id,
    jobNumber,
    location,
    village,
    tahsil: normalizedTahsil,
    gpsPoint: point,
    accuracy: accuracy ?? null,
    distanceSource: source,
    isEmergency,
    urgencyLevel: doorstep.urgency_level,
    isMachineStopped: doorstep.is_machine_stopped,
    serviceType: doorstep.service_type,
    customerName,
    equipmentModel,
    raw: input as T,
  };
}

// ==============================================================================
// 3. PURE DISTANCE EVALUATION & FALLBACK HELPERS
// ==============================================================================

/**
 * Standard fallback distance in kilometers when one or both points have unknown coordinates.
 * Represents an average intra-district rural transit across Nagpur tahsils.
 */
export const DEFAULT_UNKNOWN_COORDINATE_DISTANCE_KM = 25.0;
export const DEFAULT_UNKNOWN_COORDINATE_DURATION_MINS = 43;

/**
 * Pure synchronous distance helper between two points using rural road approximation.
 * Handles missing/null coordinates deterministically without throwing.
 */
export function calculatePureRoadDistance(
  origin: GpsPoint | null,
  destination: GpsPoint | null,
): { distanceKm: number; durationMinutes: number; isApproximate: boolean } {
  if (
    !origin ||
    !destination ||
    !isValidGpsCoordinate(origin.latitude, origin.longitude) ||
    !isValidGpsCoordinate(destination.latitude, destination.longitude)
  ) {
    return {
      distanceKm: DEFAULT_UNKNOWN_COORDINATE_DISTANCE_KM,
      durationMinutes: DEFAULT_UNKNOWN_COORDINATE_DURATION_MINS,
      isApproximate: true,
    };
  }

  // Exact same coordinates (zero detour)
  if (
    Math.abs(origin.latitude - destination.latitude) < 0.00001 &&
    Math.abs(origin.longitude - destination.longitude) < 0.00001
  ) {
    return {
      distanceKm: 0,
      durationMinutes: 0,
      isApproximate: true,
    };
  }

  const res = computeApproximateRoadDistance(origin, destination);
  return {
    distanceKm: res.distanceKm,
    durationMinutes: res.durationMinutes,
    isApproximate: true,
  };
}

export type DistanceCalculatorFn = (
  origin: GpsPoint | null,
  destination: GpsPoint | null,
) => { distanceKm: number; durationMinutes: number };

// ==============================================================================
// 4. MULTI-STOP CIRCUIT SEQUENCING ALGORITHM (NN + 2-OPT + URGENCY PINNING)
// ==============================================================================

/**
 * Pure, deterministic Traveling Technician Circuit optimizer.
 *
 * Sequence Constraints:
 * 1. Pinning: All CRITICAL + stopped machine repairs are placed at the beginning of the itinerary.
 * 2. Nearest Neighbor: Traverses remaining candidates by minimal distance from current waypoint.
 * 3. 2-Opt Optimization: Iteratively unwinds crossing road paths to minimize total circuit distance.
 * 4. Deterministic Tie-Breaking: If distances are equal, orders alphabetically by stop ID.
 * 5. Complete Inclusion: Every eligible stop is preserved (zero drops).
 */
export function optimizeCircuitStops<T = unknown>(
  depot: GpsPoint,
  stops: (ResolvedCircuitStop<T> | CircuitStopInput)[],
  distanceCalculator?: DistanceCalculatorFn,
): ResolvedCircuitStop<T>[] {
  if (!stops || stops.length <= 1) {
    return (stops || []).map((s) =>
      "isEmergency" in s ? (s as ResolvedCircuitStop<T>) : normalizeCircuitStop<T>(s),
    );
  }

  const calcDist: DistanceCalculatorFn =
    distanceCalculator ||
    ((p1, p2) => {
      const res = calculatePureRoadDistance(p1, p2);
      return { distanceKm: res.distanceKm, durationMinutes: res.durationMinutes };
    });

  const normalized = stops.map((s) =>
    "isEmergency" in s ? (s as ResolvedCircuitStop<T>) : normalizeCircuitStop<T>(s),
  );

  // Partition into emergency stops vs routine stops
  const emergencyStops: ResolvedCircuitStop<T>[] = [];
  const regularStops: ResolvedCircuitStop<T>[] = [];

  for (const stop of normalized) {
    if (stop.isEmergency) {
      emergencyStops.push(stop);
    } else {
      regularStops.push(stop);
    }
  }

  // 1. Optimize emergency stops starting from Depot
  const orderedEmergency = optimizeStopPartition(depot, emergencyStops, calcDist);

  // 2. Determine start point for regular stops:
  // If emergency stops exist, start regular routing from the last emergency stop; else from Depot.
  const lastEmergency =
    orderedEmergency.length > 0 ? orderedEmergency[orderedEmergency.length - 1] : undefined;
  const regularStartPoint = lastEmergency?.gpsPoint || depot;

  // 3. Optimize regular stops returning to Depot
  const orderedRegular = optimizeStopPartition(regularStartPoint, regularStops, calcDist);

  return [...orderedEmergency, ...orderedRegular];
}

/**
 * Helper to solve Nearest-Neighbor followed by 2-Opt on a specific stop partition.
 */
function optimizeStopPartition<T>(
  startPoint: GpsPoint,
  partition: ResolvedCircuitStop<T>[],
  calcDist: DistanceCalculatorFn,
): ResolvedCircuitStop<T>[] {
  if (partition.length <= 1) {
    return [...partition];
  }

  // Separate stops with known coordinates from unknown coordinates
  const knownStops = partition.filter((s) => s.gpsPoint !== null);
  const unknownStops = partition.filter((s) => s.gpsPoint === null);

  // Deterministically sort unknown stops by ID so order is always stable
  unknownStops.sort((a, b) => a.id.localeCompare(b.id));

  if (knownStops.length <= 1) {
    return [...knownStops, ...unknownStops];
  }

  // Step A: Nearest Neighbor from startPoint
  const unvisited = [...knownStops];
  const ordered: ResolvedCircuitStop<T>[] = [];
  let currentPoint = startPoint;

  while (unvisited.length > 0) {
    let bestIndex = 0;
    let bestDist = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const candidate = unvisited[i];
      if (!candidate) continue;

      const d = calcDist(currentPoint, candidate.gpsPoint).distanceKm;

      if (d < bestDist - 0.0001) {
        bestDist = d;
        bestIndex = i;
      } else if (Math.abs(d - bestDist) <= 0.0001) {
        const currentBest = unvisited[bestIndex];
        if (currentBest && candidate.id.localeCompare(currentBest.id) < 0) {
          bestDist = d;
          bestIndex = i;
        }
      }
    }

    const nextStop = unvisited.splice(bestIndex, 1)[0];
    if (!nextStop) break;

    ordered.push(nextStop);
    currentPoint = nextStop.gpsPoint || currentPoint;
  }

  // Step B: 2-Opt local search improvement
  const improved = applyTwoOpt(startPoint, ordered, calcDist);

  return [...improved, ...unknownStops];
}

/**
 * 2-Opt heuristic: iteratively inverts segment [i, j] if it reduces total travel distance.
 */
function applyTwoOpt<T>(
  startPoint: GpsPoint,
  stops: ResolvedCircuitStop<T>[],
  calcDist: DistanceCalculatorFn,
): ResolvedCircuitStop<T>[] {
  if (stops.length < 3) return stops;

  const route = [...stops];
  const maxIterations = 50;
  let iteration = 0;
  let improved = true;

  while (improved && iteration < maxIterations) {
    improved = false;
    iteration++;

    for (let i = 0; i < route.length - 1; i++) {
      for (let j = i + 1; j < route.length; j++) {
        const prevStop = i === 0 ? null : route[i - 1];
        const pPrev = prevStop ? prevStop.gpsPoint : startPoint;

        const stopI = route[i];
        const pI = stopI ? stopI.gpsPoint : null;

        const stopJ = route[j];
        const pJ = stopJ ? stopJ.gpsPoint : null;

        const nextStop = j === route.length - 1 ? null : route[j + 1];
        const pNext = nextStop ? nextStop.gpsPoint : startPoint;

        // Current distance of edges (prev -> i) and (j -> next)
        const currentDist = calcDist(pPrev, pI).distanceKm + calcDist(pJ, pNext).distanceKm;

        // Replaced distance if subpath [i..j] is inverted: (prev -> j) and (i -> next)
        const candidateDist = calcDist(pPrev, pJ).distanceKm + calcDist(pI, pNext).distanceKm;

        if (candidateDist < currentDist - 0.01) {
          reverseSubarray(route, i, j);
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }

  return route;
}

function reverseSubarray<T>(arr: T[], start: number, end: number): void {
  let i = start;
  let j = end;
  while (i < j) {
    const tempI = arr[i];
    const tempJ = arr[j];
    if (tempI !== undefined && tempJ !== undefined) {
      arr[i] = tempJ;
      arr[j] = tempI;
    }
    i++;
    j--;
  }
}

// ==============================================================================
// 5. CIRCUIT METRICS CALCULATION (SYNCHRONOUS & ROUTING-AWARE)
// ==============================================================================

/**
 * Calculates complete circuit metrics synchronously using rural road approximation.
 * Includes return leg to workshop depot.
 */
export function calculateCircuitMetrics<T = unknown>(
  depot: GpsPoint & { name?: string },
  stops: (ResolvedCircuitStop<T> | CircuitStopInput)[],
  options?: {
    distanceCalculator?: DistanceCalculatorFn;
  },
): CircuitMetricsResult<T> {
  const calcDist: DistanceCalculatorFn =
    options?.distanceCalculator ||
    ((p1, p2) => {
      const res = calculatePureRoadDistance(p1, p2);
      return { distanceKm: res.distanceKm, durationMinutes: res.durationMinutes };
    });

  const ordered = optimizeCircuitStops(depot, stops, calcDist);
  const legs: CircuitLeg[] = [];
  const orderedStops: OrderedCircuitStop<T>[] = [];

  let totalDistanceKm = 0;
  let totalDurationMinutes = 0;
  let emergencyCount = 0;

  if (ordered.length === 0) {
    return {
      depot,
      orderedStops: [],
      legs: [],
      stopCount: 0,
      totalDistanceKm: 0,
      totalDistanceMeters: 0,
      totalDistanceFormatted: "0 km",
      totalDurationMinutes: 0,
      totalDurationSeconds: 0,
      totalDurationFormatted: "0 mins",
      routingMode: "rural_road_fallback",
      hasOsrmMetrics: false,
      hasEmergencyStops: false,
      emergencyStopCount: 0,
    };
  }

  let currentPoint: GpsPoint = depot;
  let currentId = "depot";
  let currentName = depot.name || "Workshop Base";

  for (let i = 0; i < ordered.length; i++) {
    const stop = ordered[i];
    if (!stop) continue;

    if (stop.isEmergency) emergencyCount++;

    const legDist = calcDist(currentPoint, stop.gpsPoint);
    const distMeters = Math.round(legDist.distanceKm * 1000);
    const durSec = legDist.durationMinutes * 60;

    const leg: CircuitLeg = {
      legIndex: i,
      fromType: i === 0 ? "depot" : "stop",
      toType: "stop",
      fromId: currentId,
      fromName: currentName,
      fromPoint: currentPoint,
      toId: stop.id,
      toName: stop.customerName || stop.jobNumber,
      toPoint: stop.gpsPoint,
      distanceKm: legDist.distanceKm,
      distanceMeters: distMeters,
      distanceFormatted: formatRouteDistance(distMeters),
      durationMinutes: legDist.durationMinutes,
      durationSeconds: durSec,
      durationFormatted: formatRouteDuration(durSec),
      routingMode: "rural_road_fallback",
      isEstimate: true,
      distanceSource: stop.distanceSource,
    };

    legs.push(leg);
    totalDistanceKm += legDist.distanceKm;
    totalDurationMinutes += legDist.durationMinutes;

    orderedStops.push({
      sequenceNumber: i + 1,
      stop,
      arrivalLegIndex: i,
      cumulativeDistanceKm: Math.round(totalDistanceKm * 10) / 10,
      cumulativeDistanceFormatted: formatRouteDistance(Math.round(totalDistanceKm * 1000)),
      cumulativeDurationMinutes: totalDurationMinutes,
      cumulativeDurationFormatted: formatRouteDuration(totalDurationMinutes * 60),
    });

    currentPoint = stop.gpsPoint || currentPoint;
    currentId = stop.id;
    currentName = stop.customerName || stop.jobNumber;
  }

  // Return leg: Last Stop -> Workshop Depot
  const returnDist = calcDist(currentPoint, depot);
  const returnMeters = Math.round(returnDist.distanceKm * 1000);
  const returnSec = returnDist.durationMinutes * 60;

  const returnLeg: CircuitLeg = {
    legIndex: ordered.length,
    fromType: "stop",
    toType: "depot",
    fromId: currentId,
    fromName: currentName,
    fromPoint: currentPoint,
    toId: "depot",
    toName: depot.name || "Workshop Base",
    toPoint: depot,
    distanceKm: returnDist.distanceKm,
    distanceMeters: returnMeters,
    distanceFormatted: formatRouteDistance(returnMeters),
    durationMinutes: returnDist.durationMinutes,
    durationSeconds: returnSec,
    durationFormatted: formatRouteDuration(returnSec),
    routingMode: "rural_road_fallback",
    isEstimate: true,
    distanceSource: "exact_gps",
  };

  legs.push(returnLeg);
  totalDistanceKm += returnDist.distanceKm;
  totalDurationMinutes += returnDist.durationMinutes;

  const roundedTotalKm = Math.round(totalDistanceKm * 10) / 10;
  const totalMeters = Math.round(roundedTotalKm * 1000);
  const totalSec = totalDurationMinutes * 60;

  return {
    depot,
    orderedStops,
    legs,
    stopCount: ordered.length,
    totalDistanceKm: roundedTotalKm,
    totalDistanceMeters: totalMeters,
    totalDistanceFormatted: formatRouteDistance(totalMeters),
    totalDurationMinutes,
    totalDurationSeconds: totalSec,
    totalDurationFormatted: formatRouteDuration(totalSec),
    routingMode: "rural_road_fallback",
    hasOsrmMetrics: false,
    hasEmergencyStops: emergencyCount > 0,
    emergencyStopCount: emergencyCount,
  };
}

/**
 * Calculates circuit metrics using bounded OSRM driving distance with automatic fallback
 * and leg-level memoization.
 */
export async function calculateCircuitMetricsWithRouting<T = unknown>(
  depot: GpsPoint & { name?: string },
  stops: (ResolvedCircuitStop<T> | CircuitStopInput)[],
  options?: {
    skipOsrm?: boolean;
    osrmTimeoutMs?: number;
    fetchFn?: typeof fetch;
  },
): Promise<CircuitMetricsResult<T>> {
  const baseResult = calculateCircuitMetrics(depot, stops);
  if (baseResult.stopCount === 0 || options?.skipOsrm) {
    return baseResult;
  }

  // Leg memoization cache to prevent duplicate OSRM requests
  const legCache = new Map<string, ResolvedTravelDistance>();

  async function getLegTravel(
    p1: GpsPoint | null,
    p2: GpsPoint | null,
  ): Promise<ResolvedTravelDistance> {
    if (
      !p1 ||
      !p2 ||
      !isValidGpsCoordinate(p1.latitude, p1.longitude) ||
      !isValidGpsCoordinate(p2.latitude, p2.longitude)
    ) {
      return {
        distanceKm: DEFAULT_UNKNOWN_COORDINATE_DISTANCE_KM,
        durationMinutes: DEFAULT_UNKNOWN_COORDINATE_DURATION_MINS,
        durationFormatted: `${DEFAULT_UNKNOWN_COORDINATE_DURATION_MINS} mins`,
        isEstimate: true,
        routingMode: "rural_road_fallback",
      };
    }

    const key = `${p1.latitude.toFixed(5)},${p1.longitude.toFixed(5)}->${p2.latitude.toFixed(5)},${p2.longitude.toFixed(5)}`;
    if (legCache.has(key)) {
      return legCache.get(key)!;
    }

    const res = await resolveDrivingDistance(p1, p2, {
      skipOsrm: options?.skipOsrm,
      timeoutMs: options?.osrmTimeoutMs ?? 2500,
      fetchFn: options?.fetchFn,
    });

    legCache.set(key, res);
    return res;
  }

  const updatedLegs: CircuitLeg[] = [];
  const updatedOrderedStops: OrderedCircuitStop<T>[] = [];

  let totalDistanceKm = 0;
  let totalDurationMinutes = 0;
  let hasOsrm = false;

  for (let i = 0; i < baseResult.legs.length; i++) {
    const leg = baseResult.legs[i];
    if (!leg) continue;

    const travel = await getLegTravel(leg.fromPoint, leg.toPoint);

    if (travel.routingMode === "osrm_driving") {
      hasOsrm = true;
    }

    const distMeters = Math.round(travel.distanceKm * 1000);
    const durSec = travel.durationMinutes * 60;

    const updatedLeg: CircuitLeg = {
      legIndex: leg.legIndex,
      fromType: leg.fromType,
      toType: leg.toType,
      fromId: leg.fromId,
      fromName: leg.fromName,
      fromPoint: leg.fromPoint,
      toId: leg.toId,
      toName: leg.toName,
      toPoint: leg.toPoint,
      distanceKm: travel.distanceKm,
      distanceMeters: distMeters,
      distanceFormatted: formatRouteDistance(distMeters),
      durationMinutes: travel.durationMinutes,
      durationSeconds: durSec,
      durationFormatted: travel.durationFormatted,
      routingMode: travel.routingMode,
      isEstimate: travel.isEstimate,
      distanceSource: leg.distanceSource,
    };

    updatedLegs.push(updatedLeg);
    totalDistanceKm += travel.distanceKm;
    totalDurationMinutes += travel.durationMinutes;

    if (i < baseResult.orderedStops.length) {
      const origStop = baseResult.orderedStops[i];
      if (origStop) {
        updatedOrderedStops.push({
          sequenceNumber: origStop.sequenceNumber,
          stop: origStop.stop,
          arrivalLegIndex: origStop.arrivalLegIndex,
          cumulativeDistanceKm: Math.round(totalDistanceKm * 10) / 10,
          cumulativeDistanceFormatted: formatRouteDistance(Math.round(totalDistanceKm * 1000)),
          cumulativeDurationMinutes: totalDurationMinutes,
          cumulativeDurationFormatted: formatRouteDuration(totalDurationMinutes * 60),
        });
      }
    }
  }

  const roundedTotalKm = Math.round(totalDistanceKm * 10) / 10;
  const totalMeters = Math.round(roundedTotalKm * 1000);
  const totalSec = totalDurationMinutes * 60;

  return {
    ...baseResult,
    legs: updatedLegs,
    orderedStops: updatedOrderedStops,
    totalDistanceKm: roundedTotalKm,
    totalDistanceMeters: totalMeters,
    totalDistanceFormatted: formatRouteDistance(totalMeters),
    totalDurationMinutes,
    totalDurationSeconds: totalSec,
    totalDurationFormatted: formatRouteDuration(totalSec),
    routingMode: hasOsrm ? "osrm_driving" : "rural_road_fallback",
    hasOsrmMetrics: hasOsrm,
  };
}

// ==============================================================================
// 6. EMERGENCY DETOUR COST CALCULATION
// ==============================================================================

/**
 * Calculates the marginal travel cost (additional distance and duration) of inserting
 * an emergency breakdown repair into an existing circuit.
 *
 * Algorithm:
 * Evaluates each eligible insertion point in O(N) time without full circuit recomputation:
 * Extra Cost = Dist(Prev, New) + Dist(New, Next) - Dist(Prev, Next)
 *
 * Urgency Constraint:
 * If the incoming stop is an emergency (CRITICAL + stopped machine), it can only be inserted
 * within the emergency partition [0 .. urgentCount] to guarantee early intervention.
 */
export function calculateDetourCost<T = unknown>(
  depot: GpsPoint,
  currentStops: (ResolvedCircuitStop<T> | CircuitStopInput)[],
  newStop: ResolvedCircuitStop<T> | CircuitStopInput,
  options?: {
    distanceCalculator?: DistanceCalculatorFn;
  },
): DetourCostResult<T> {
  const calcDist: DistanceCalculatorFn =
    options?.distanceCalculator ||
    ((p1, p2) => {
      const res = calculatePureRoadDistance(p1, p2);
      return { distanceKm: res.distanceKm, durationMinutes: res.durationMinutes };
    });

  const normalizedCurrent = currentStops.map((s) =>
    "isEmergency" in s ? (s as ResolvedCircuitStop<T>) : normalizeCircuitStop<T>(s),
  );
  const normalizedNew =
    "isEmergency" in newStop
      ? (newStop as ResolvedCircuitStop<T>)
      : normalizeCircuitStop<T>(newStop);

  const prevMetrics = calculateCircuitMetrics(depot, normalizedCurrent, {
    distanceCalculator: calcDist,
  });

  // Edge case: Empty existing circuit
  if (normalizedCurrent.length === 0) {
    const singleStopMetrics = calculateCircuitMetrics(depot, [normalizedNew], {
      distanceCalculator: calcDist,
    });
    return {
      insertionIndex: 0,
      additionalDistanceKm: singleStopMetrics.totalDistanceKm,
      additionalDistanceFormatted: singleStopMetrics.totalDistanceFormatted,
      additionalDurationMinutes: singleStopMetrics.totalDurationMinutes,
      additionalDurationFormatted: singleStopMetrics.totalDurationFormatted,
      isEmergency: normalizedNew.isEmergency,
      previousTotalDistanceKm: 0,
      newTotalDistanceKm: singleStopMetrics.totalDistanceKm,
      previousTotalDurationMinutes: 0,
      newTotalDurationMinutes: singleStopMetrics.totalDurationMinutes,
      updatedStops: [normalizedNew],
      detourReason: normalizedNew.isEmergency
        ? "Initial circuit stop — prioritized emergency machine stoppage."
        : "Initial circuit stop.",
    };
  }

  // Count existing emergency stops
  const urgentCount = normalizedCurrent.filter((s) => s.isEmergency).length;

  // Determine eligible insertion positions [minPos, maxPos]
  let minPos = 0;
  let maxPos = normalizedCurrent.length;

  if (normalizedNew.isEmergency) {
    // Must insert within the emergency section [0 .. urgentCount]
    maxPos = urgentCount;
  } else {
    // Regular stop must not precede emergency stops
    minPos = urgentCount;
  }

  let bestIndex = minPos;
  let minDetourKm = Infinity;
  let bestDetourMinutes = Infinity;

  // Evaluate marginal detour cost at each eligible position
  for (let pos = minPos; pos <= maxPos; pos++) {
    const prevStop = pos === 0 ? null : normalizedCurrent[pos - 1];
    const prevPoint = prevStop ? prevStop.gpsPoint : depot;

    const nextStop = pos === normalizedCurrent.length ? null : normalizedCurrent[pos];
    const nextPoint = nextStop ? nextStop.gpsPoint : depot;

    // Leg being removed
    const origDist = calcDist(prevPoint, nextPoint);

    // Two replacement legs
    const toNew = calcDist(prevPoint, normalizedNew.gpsPoint);
    const fromNew = calcDist(normalizedNew.gpsPoint, nextPoint);

    const deltaKm =
      Math.round((toNew.distanceKm + fromNew.distanceKm - origDist.distanceKm) * 10) / 10;
    const deltaMins = Math.max(
      0,
      toNew.durationMinutes + fromNew.durationMinutes - origDist.durationMinutes,
    );

    const clampedDeltaKm = Math.max(0, deltaKm);

    if (clampedDeltaKm < minDetourKm - 0.01) {
      minDetourKm = clampedDeltaKm;
      bestDetourMinutes = deltaMins;
      bestIndex = pos;
    }
  }

  // Construct updated stop list
  const updatedStops = [...normalizedCurrent];
  updatedStops.splice(bestIndex, 0, normalizedNew);

  const roundedDetourKm = Math.round(minDetourKm * 10) / 10;
  const newTotalKm = Math.round((prevMetrics.totalDistanceKm + roundedDetourKm) * 10) / 10;
  const newTotalMinutes = prevMetrics.totalDurationMinutes + bestDetourMinutes;

  let detourReason = `Recommended insertion at Stop #${bestIndex + 1}`;
  if (normalizedNew.isEmergency) {
    detourReason += ` (Emergency stoppage prioritized before routine field visits). +${roundedDetourKm} km detour.`;
  } else {
    detourReason += `. Least-distance route insertion: +${roundedDetourKm} km.`;
  }

  return {
    insertionIndex: bestIndex,
    additionalDistanceKm: roundedDetourKm,
    additionalDistanceFormatted: formatRouteDistance(Math.round(roundedDetourKm * 1000)),
    additionalDurationMinutes: bestDetourMinutes,
    additionalDurationFormatted: formatRouteDuration(bestDetourMinutes * 60),
    isEmergency: normalizedNew.isEmergency,
    previousTotalDistanceKm: prevMetrics.totalDistanceKm,
    newTotalDistanceKm: newTotalKm,
    previousTotalDurationMinutes: prevMetrics.totalDurationMinutes,
    newTotalDurationMinutes: newTotalMinutes,
    updatedStops,
    detourReason,
  };
}

// ==============================================================================
// 7. TAHSIL-BASED CLUSTERING OF OPEN DOORSTEP REPAIRS
// ==============================================================================

/**
 * Groups unassigned doorstep repair requests into geographic taluka clusters for
 * traveling mechanic dispatch planning.
 *
 * Rules:
 * - Excludes WORKSHOP mode requests (depot-based, no mobile field travel required).
 * - Normalizes tahsil using official 14 Nagpur Tahsil centroids.
 * - Places unknown or unparsable rural locations in an explicit "Unknown" cluster.
 * - Never silently defaults unknown locations to Nagpur city.
 * - Sorts clusters by: Critical stoppages descending -> Total count descending -> Name ascending.
 */
export function clusterRepairsByTahsil<T = unknown>(repairs: T[]): ClusterRepairsResult<T> {
  const clusters: Record<string, TahsilCluster<T>> = {};

  // Initialize official 14 tahsil clusters
  for (const t of NAGPUR_TAHSILS) {
    clusters[t] = {
      tahsil: t,
      repairs: [],
      count: 0,
      criticalStoppedCount: 0,
      centroid: NAGPUR_TAHSIL_CENTROIDS[t] || null,
      criticalCount: 0,
      highCount: 0,
      standardCount: 0,
      flexibleCount: 0,
    };
  }

  // Initialize explicit Unknown cluster
  clusters["Unknown"] = {
    tahsil: "Unknown",
    repairs: [],
    count: 0,
    criticalStoppedCount: 0,
    centroid: null,
    criticalCount: 0,
    highCount: 0,
    standardCount: 0,
    flexibleCount: 0,
  };

  let totalEligibleDoorstepRepairs = 0;
  let totalExcludedWorkshopRepairs = 0;
  let unknownCount = 0;

  for (const raw of repairs || []) {
    const doorstep = normalizeRepairDoorstepUrgency(raw);

    // Exclude workshop drop-off requests
    if (doorstep.service_type === "WORKSHOP") {
      totalExcludedWorkshopRepairs++;
      continue;
    }

    totalEligibleDoorstepRepairs++;

    // Extract location candidates from top-level or nested structures
    const rawObj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const rawRepair = (
      typeof rawObj["repair"] === "object" && rawObj["repair"] !== null ? rawObj["repair"] : {}
    ) as Record<string, unknown>;
    const locCandidate =
      (rawObj["tahsil"] as string) ||
      (rawObj["village"] as string) ||
      (rawObj["location"] as string) ||
      (rawRepair["location"] as string) ||
      (rawObj["field_landmark"] as string) ||
      "";

    const normalizedTahsil = normalizeNagpurTahsil(locCandidate);
    const targetClusterKey = normalizedTahsil || "Unknown";

    if (!normalizedTahsil) {
      unknownCount++;
    }

    const cluster = clusters[targetClusterKey];
    if (cluster) {
      cluster.repairs.push(raw as T);
      cluster.count++;

      if (doorstep.urgency_level === "CRITICAL" && doorstep.is_machine_stopped) {
        cluster.criticalStoppedCount++;
      }
      if (doorstep.urgency_level === "CRITICAL") {
        cluster.criticalCount++;
      } else if (doorstep.urgency_level === "HIGH") {
        cluster.highCount++;
      } else if (doorstep.urgency_level === "STANDARD") {
        cluster.standardCount++;
      } else if (doorstep.urgency_level === "FLEXIBLE") {
        cluster.flexibleCount++;
      }
    }
  }

  // Convert to sorted array
  const clusterList = Object.values(clusters)
    .filter((c) => c.count > 0)
    .sort((a, b) => {
      // 1. Critical stoppages first
      if (b.criticalStoppedCount !== a.criticalStoppedCount) {
        return b.criticalStoppedCount - a.criticalStoppedCount;
      }
      // 2. Highest repair volume
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      // 3. Alphabetical (keep Unknown at end if tie)
      if (a.tahsil === "Unknown") return 1;
      if (b.tahsil === "Unknown") return -1;
      return a.tahsil.localeCompare(b.tahsil);
    });

  return {
    clusters,
    clusterList,
    totalEligibleDoorstepRepairs,
    totalExcludedWorkshopRepairs,
    unknownCount,
  };
}
