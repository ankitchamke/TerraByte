import test from "node:test";
import assert from "node:assert/strict";

import {
  NAGPUR_TAHSIL_CENTROIDS,
  getNagpurTahsilCentroid,
  computeApproximateRoadDistance,
} from "../src/lib/location.ts";

import {
  optimizeCircuitStops,
  calculateCircuitMetrics,
  calculateCircuitMetricsWithRouting,
  calculateDetourCost,
  clusterRepairsByTahsil,
  normalizeCircuitStop,
  resolveStopCoordinates,
  calculatePureRoadDistance,
  DEFAULT_UNKNOWN_COORDINATE_DISTANCE_KM,
} from "../src/lib/services/circuit-optimizer.ts";

// Baseline Workshop Depot: Green Earth Mobile Repairs, Katol, Nagpur
const KATOL_DEPOT = {
  latitude: 21.2682,
  longitude: 78.5833,
  name: "Green Earth Mobile Repairs, Katol",
};

// Nagpur Tahsil Centroids for realistic testing
const NARKHED_POINT = NAGPUR_TAHSIL_CENTROIDS["Narkhed"]; // ~25 km NW of Katol
const KALMESHWAR_POINT = NAGPUR_TAHSIL_CENTROIDS["Kalmeshwar"]; // ~35 km E of Katol
const SAONER_POINT = NAGPUR_TAHSIL_CENTROIDS["Saoner"]; // ~48 km NE of Katol
const RAMTEK_POINT = NAGPUR_TAHSIL_CENTROIDS["Ramtek"]; // ~85 km ENE of Katol
const UMRED_POINT = NAGPUR_TAHSIL_CENTROIDS["Umred"]; // ~90 km SE of Katol

// ==============================================================================
// 1. ZERO-STOP & SINGLE-STOP CIRCUITS
// ==============================================================================

test("1. Zero-stop circuit returns empty itinerary with zero distance and time", () => {
  const result = calculateCircuitMetrics(KATOL_DEPOT, []);

  assert.equal(result.stopCount, 0);
  assert.equal(result.orderedStops.length, 0);
  assert.equal(result.legs.length, 0);
  assert.equal(result.totalDistanceKm, 0);
  assert.equal(result.totalDistanceMeters, 0);
  assert.equal(result.totalDistanceFormatted, "0 km");
  assert.equal(result.totalDurationMinutes, 0);
  assert.equal(result.totalDurationFormatted, "0 mins");
  assert.equal(result.hasEmergencyStops, false);
});

test("2. Single-stop circuit calculates outbound and depot-return legs", () => {
  const singleStop = {
    id: "TB-1001",
    jobNumber: "TB-1001",
    village: "Narkhed",
    gpsPoint: NARKHED_POINT,
    urgency_level: "STANDARD",
    is_machine_stopped: false,
    service_type: "DOORSTEP",
    customerName: "Namdeo Patil",
  };

  const result = calculateCircuitMetrics(KATOL_DEPOT, [singleStop]);

  assert.equal(result.stopCount, 1);
  assert.equal(result.orderedStops.length, 1);
  assert.equal(result.legs.length, 2); // Leg 0: Depot -> Stop, Leg 1: Stop -> Depot

  // Verify outbound leg
  assert.equal(result.legs[0].fromType, "depot");
  assert.equal(result.legs[0].toType, "stop");
  assert.equal(result.legs[0].toId, "TB-1001");
  assert.ok(result.legs[0].distanceKm > 20 && result.legs[0].distanceKm < 45);

  // Verify return leg
  assert.equal(result.legs[1].fromType, "stop");
  assert.equal(result.legs[1].toType, "depot");
  assert.equal(result.legs[1].toId, "depot");
  assert.equal(result.legs[1].distanceKm, result.legs[0].distanceKm);

  // Total distance is exactly round-trip
  const expectedTotal = Math.round(result.legs[0].distanceKm * 2 * 10) / 10;
  assert.equal(result.totalDistanceKm, expectedTotal);
  assert.ok(result.totalDurationMinutes > 0);
});

// ==============================================================================
// 2. MULTIPLE STOPS & DEPOT RETURN
// ==============================================================================

test("3. Multiple-stop circuit creates ordered itinerary with cumulative metrics", () => {
  const stops = [
    { id: "S1", jobNumber: "TB-01", location: "Narkhed", gpsPoint: NARKHED_POINT },
    { id: "S2", jobNumber: "TB-02", location: "Kalmeshwar", gpsPoint: KALMESHWAR_POINT },
    { id: "S3", jobNumber: "TB-03", location: "Saoner", gpsPoint: SAONER_POINT },
  ];

  const result = calculateCircuitMetrics(KATOL_DEPOT, stops);

  assert.equal(result.stopCount, 3);
  assert.equal(result.orderedStops.length, 3);
  assert.equal(result.legs.length, 4); // 3 stops + 1 return to depot

  // Check cumulative distance monotonicity
  let prevDist = 0;
  let prevDur = 0;
  for (let i = 0; i < result.orderedStops.length; i++) {
    const s = result.orderedStops[i];
    assert.equal(s.sequenceNumber, i + 1);
    assert.ok(s.cumulativeDistanceKm >= prevDist);
    assert.ok(s.cumulativeDurationMinutes >= prevDur);
    prevDist = s.cumulativeDistanceKm;
    prevDur = s.cumulativeDurationMinutes;
  }

  // Total circuit distance must equal sum of all legs
  const sumLegs = Math.round(result.legs.reduce((acc, leg) => acc + leg.distanceKm, 0) * 10) / 10;
  assert.equal(result.totalDistanceKm, sumLegs);
});

test("4. Depot return-leg calculation properly closes the circuit", () => {
  const stops = [
    { id: "S1", location: "Kalmeshwar", gpsPoint: KALMESHWAR_POINT },
    { id: "S2", location: "Saoner", gpsPoint: SAONER_POINT },
  ];

  const result = calculateCircuitMetrics(KATOL_DEPOT, stops);
  const returnLeg = result.legs[result.legs.length - 1];

  assert.equal(returnLeg.toType, "depot");
  assert.equal(returnLeg.toId, "depot");
  assert.deepEqual(returnLeg.toPoint, KATOL_DEPOT);
  assert.ok(returnLeg.distanceKm > 0);
});

// ==============================================================================
// 3. NEAREST NEIGHBOR & 2-OPT SEQUENCING
// ==============================================================================

test("5. Nearest-neighbor orders closer stops first starting from depot", () => {
  // From Katol Depot:
  // Kalmeshwar is ~35 km
  // Saoner is ~48 km
  // If input is provided in reverse order [Saoner, Kalmeshwar],
  // the optimizer visits the nearer stop (Kalmeshwar) first.
  const stops = [
    { id: "S-SAONER", location: "Saoner", gpsPoint: SAONER_POINT },
    { id: "S-KALMESHWAR", location: "Kalmeshwar", gpsPoint: KALMESHWAR_POINT },
  ];

  const ordered = optimizeCircuitStops(KATOL_DEPOT, stops);

  assert.equal(ordered.length, 2);
  assert.equal(ordered[0].id, "S-KALMESHWAR", "First stop from Katol must be nearest (Kalmeshwar)");
  assert.equal(ordered[1].id, "S-SAONER", "Second stop must be Saoner");
});

test("6. 2-opt improvement eliminates route crossover", () => {
  // Depot at (0, 0)
  const depot = { latitude: 20.0, longitude: 78.0 };
  // S1 at (20.0, 78.1) ~10 km
  // S2 at (20.1, 78.1) ~15 km
  // S3 at (20.1, 78.0) ~11 km
  // S4 at (20.05, 78.0) ~5 km
  const stops = [
    { id: "P1", gpsPoint: { latitude: 20.0, longitude: 78.1 } },
    { id: "P2", gpsPoint: { latitude: 20.1, longitude: 78.1 } },
    { id: "P3", gpsPoint: { latitude: 20.1, longitude: 78.0 } },
    { id: "P4", gpsPoint: { latitude: 20.05, longitude: 78.0 } },
  ];

  const metrics = calculateCircuitMetrics(depot, stops);
  assert.equal(metrics.stopCount, 4);

  // Verify optimized itinerary is shorter than arbitrarily crossed permutation
  const crossedStops = [stops[0], stops[2], stops[1], stops[3]]; // P1, P3, P2, P4
  const crossedDist =
    computeApproximateRoadDistance(depot, crossedStops[0].gpsPoint).distanceKm +
    computeApproximateRoadDistance(crossedStops[0].gpsPoint, crossedStops[1].gpsPoint).distanceKm +
    computeApproximateRoadDistance(crossedStops[1].gpsPoint, crossedStops[2].gpsPoint).distanceKm +
    computeApproximateRoadDistance(crossedStops[2].gpsPoint, crossedStops[3].gpsPoint).distanceKm +
    computeApproximateRoadDistance(crossedStops[3].gpsPoint, depot).distanceKm;

  assert.ok(
    metrics.totalDistanceKm <= Math.round(crossedDist * 10) / 10,
    `2-opt total (${metrics.totalDistanceKm}) must be <= crossed distance (${crossedDist})`,
  );
});

// ==============================================================================
// 4. EMERGENCY STOPPAGE PRIORITY (CRITICAL + IMMOBILE MACHINE)
// ==============================================================================

test("7. CRITICAL + stopped machine is pinned as the very first stop", () => {
  // Routine stop is very close to Katol (Kalmeshwar ~35 km)
  // Urgent stop is further away (Saoner ~48 km), but machine is halted in field
  const routineNear = {
    id: "ROUTINE-NEAR",
    location: "Kalmeshwar",
    gpsPoint: KALMESHWAR_POINT,
    urgency_level: "STANDARD",
    is_machine_stopped: false,
  };

  const emergencyFar = {
    id: "EMERGENCY-FAR",
    location: "Saoner",
    gpsPoint: SAONER_POINT,
    urgency_level: "CRITICAL",
    is_machine_stopped: true, // Emergency!
  };

  const ordered = optimizeCircuitStops(KATOL_DEPOT, [routineNear, emergencyFar]);

  assert.equal(ordered.length, 2);
  assert.equal(
    ordered[0].id,
    "EMERGENCY-FAR",
    "Emergency stopped machine MUST be placed at Stop #1 regardless of proximity",
  );
  assert.equal(ordered[1].id, "ROUTINE-NEAR");
});

test("8. Multiple urgent stops are grouped together at the head of the circuit", () => {
  const urgent1 = {
    id: "URGENT-1",
    location: "Saoner",
    gpsPoint: SAONER_POINT,
    urgency_level: "CRITICAL",
    is_machine_stopped: true,
  };
  const urgent2 = {
    id: "URGENT-2",
    location: "Kalmeshwar",
    gpsPoint: KALMESHWAR_POINT,
    urgency_level: "CRITICAL",
    is_machine_stopped: true,
  };
  const regular1 = {
    id: "REGULAR-1",
    location: "Narkhed",
    gpsPoint: NARKHED_POINT,
    urgency_level: "HIGH",
    is_machine_stopped: false,
  };
  const regular2 = {
    id: "REGULAR-2",
    location: "Ramtek",
    gpsPoint: RAMTEK_POINT,
    urgency_level: "STANDARD",
    is_machine_stopped: false,
  };

  // Mixed input
  const ordered = optimizeCircuitStops(KATOL_DEPOT, [regular1, urgent1, regular2, urgent2]);

  assert.equal(ordered.length, 4);
  // First two stops MUST be the two urgent stops
  assert.ok(ordered[0].id === "URGENT-2" || ordered[0].id === "URGENT-1");
  assert.ok(ordered[1].id === "URGENT-2" || ordered[1].id === "URGENT-1");
  // Third and fourth stops MUST be the regular stops
  assert.ok(ordered[2].id === "REGULAR-1" || ordered[2].id === "REGULAR-2");
  assert.ok(ordered[3].id === "REGULAR-1" || ordered[3].id === "REGULAR-2");

  // Since Kalmeshwar is closer to Katol than Saoner, URGENT-2 (Kalmeshwar) must precede URGENT-1 (Saoner)
  assert.equal(ordered[0].id, "URGENT-2");
  assert.equal(ordered[1].id, "URGENT-1");
});

// ==============================================================================
// 5. DETERMINISTIC ORDERING & EQUAL-DISTANCE HANDLING
// ==============================================================================

test("9. Stable deterministic ordering across multiple executions", () => {
  const stops = [
    { id: "TB-30", location: "Narkhed", gpsPoint: NARKHED_POINT },
    { id: "TB-10", location: "Saoner", gpsPoint: SAONER_POINT },
    { id: "TB-20", location: "Kalmeshwar", gpsPoint: KALMESHWAR_POINT },
  ];

  const run1 = optimizeCircuitStops(KATOL_DEPOT, stops).map((s) => s.id);
  const run2 = optimizeCircuitStops(KATOL_DEPOT, stops).map((s) => s.id);
  const run3 = optimizeCircuitStops(KATOL_DEPOT, stops).map((s) => s.id);

  assert.deepEqual(run1, run2);
  assert.deepEqual(run2, run3);
});

test("10. Equal-distance stops are broken deterministically by stop ID", () => {
  // Two stops at the exact same location/distance
  const stopA = {
    id: "TB-ALPHA",
    location: "Kalmeshwar",
    gpsPoint: KALMESHWAR_POINT,
  };
  const stopZ = {
    id: "TB-ZETA",
    location: "Kalmeshwar",
    gpsPoint: KALMESHWAR_POINT,
  };

  const ordered1 = optimizeCircuitStops(KATOL_DEPOT, [stopZ, stopA]).map((s) => s.id);
  const ordered2 = optimizeCircuitStops(KATOL_DEPOT, [stopA, stopZ]).map((s) => s.id);

  // Alphabetical tie-break: TB-ALPHA before TB-ZETA
  assert.deepEqual(ordered1, ["TB-ALPHA", "TB-ZETA"]);
  assert.deepEqual(ordered2, ["TB-ALPHA", "TB-ZETA"]);
});

// ==============================================================================
// 6. GEOGRAPHIC FALLBACK: MISSING GPS & UNKNOWN TAHSIL
// ==============================================================================

test("11. Missing GPS fallback resolves location via tahsil centroid", () => {
  const stopWithoutGps = {
    id: "TB-NO-GPS",
    jobNumber: "TB-NO-GPS",
    location: "Saoner, Nagpur",
    // No gpsPoint provided
  };

  const resolved = normalizeCircuitStop(stopWithoutGps);

  assert.equal(resolved.distanceSource, "tahsil_centroid");
  assert.ok(resolved.gpsPoint !== null);
  assert.equal(resolved.gpsPoint.latitude, SAONER_POINT.latitude);
  assert.equal(resolved.gpsPoint.longitude, SAONER_POINT.longitude);

  const metrics = calculateCircuitMetrics(KATOL_DEPOT, [stopWithoutGps]);
  assert.equal(metrics.stopCount, 1);
  assert.ok(metrics.totalDistanceKm > 0);
  assert.equal(metrics.legs[0].distanceSource, "tahsil_centroid");
});

test("12. Unknown tahsil handling safely preserves stop with fallback distance", () => {
  const stopUnknown = {
    id: "TB-UNKNOWN-LOC",
    jobNumber: "TB-UNKNOWN-LOC",
    location: "Nonexistent Distant Farm XYZ",
    // Invalid / unresolvable location
  };

  const resolved = normalizeCircuitStop(stopUnknown);

  assert.equal(resolved.distanceSource, "unknown");
  assert.equal(resolved.gpsPoint, null);

  // Must NOT be dropped from circuit
  const metrics = calculateCircuitMetrics(KATOL_DEPOT, [stopUnknown]);
  assert.equal(metrics.stopCount, 1);
  assert.equal(metrics.orderedStops[0].stop.id, "TB-UNKNOWN-LOC");
  // Default unknown transit distance applied
  assert.ok(metrics.totalDistanceKm >= DEFAULT_UNKNOWN_COORDINATE_DISTANCE_KM);
});

// ==============================================================================
// 7. ROUTING MODES: APPROXIMATE VS OSRM
// ==============================================================================

test("13. Approximate distance metrics correctly flag routing mode and estimate flags", () => {
  const stops = [{ id: "S1", location: "Kalmeshwar", gpsPoint: KALMESHWAR_POINT }];

  const metrics = calculateCircuitMetrics(KATOL_DEPOT, stops);

  assert.equal(metrics.routingMode, "rural_road_fallback");
  assert.equal(metrics.hasOsrmMetrics, false);
  assert.equal(metrics.legs[0].routingMode, "rural_road_fallback");
  assert.equal(metrics.legs[0].isEstimate, true);
});

test("14. OSRM-derived metrics integration with memoization", async () => {
  const stops = [
    { id: "S1", location: "Kalmeshwar", gpsPoint: KALMESHWAR_POINT },
    { id: "S2", location: "Saoner", gpsPoint: SAONER_POINT },
  ];

  let fetchCallCount = 0;
  const mockFetch = async () => {
    fetchCallCount++;
    return {
      ok: true,
      json: async () => ({
        code: "Ok",
        routes: [
          {
            distance: 28400, // 28.4 km in meters
            duration: 2160, // 36 mins in seconds
          },
        ],
      }),
    };
  };

  const metrics = await calculateCircuitMetricsWithRouting(KATOL_DEPOT, stops, {
    fetchFn: mockFetch,
  });

  assert.equal(metrics.hasOsrmMetrics, true);
  assert.equal(metrics.routingMode, "osrm_driving");
  assert.equal(metrics.legs[0].routingMode, "osrm_driving");
  assert.equal(metrics.legs[0].distanceKm, 28.4);
  assert.equal(metrics.legs[0].durationMinutes, 36);

  // Total legs = 3 (Depot->S1, S1->S2, S2->Depot)
  assert.equal(fetchCallCount, 3, "Fetch called once per distinct circuit leg");
});

// ==============================================================================
// 8. EMERGENCY DETOUR COST CALCULATION
// ==============================================================================

test("15. Emergency insertion at the best position", () => {
  // Existing circuit: Katol -> Kalmeshwar -> Saoner -> Katol
  const currentStops = [
    { id: "S-KALMESHWAR", location: "Kalmeshwar", gpsPoint: KALMESHWAR_POINT },
    { id: "S-SAONER", location: "Saoner", gpsPoint: SAONER_POINT },
  ];

  // New emergency stop located in Narkhed (closer to Katol)
  const newEmergency = {
    id: "S-NARKHED-EMERGENCY",
    location: "Narkhed",
    gpsPoint: NARKHED_POINT,
    urgency_level: "CRITICAL",
    is_machine_stopped: true,
  };

  const detour = calculateDetourCost(KATOL_DEPOT, currentStops, newEmergency);

  assert.equal(detour.isEmergency, true);
  assert.equal(detour.insertionIndex, 0, "Emergency stop must be inserted at Stop #1");
  assert.equal(detour.updatedStops[0].id, "S-NARKHED-EMERGENCY");
  assert.equal(detour.updatedStops.length, 3);
});

test("16. Emergency detour distance calculation equals new total minus previous total", () => {
  const currentStops = [{ id: "S1", location: "Kalmeshwar", gpsPoint: KALMESHWAR_POINT }];

  const newStop = {
    id: "S2",
    location: "Saoner",
    gpsPoint: SAONER_POINT,
    urgency_level: "CRITICAL",
    is_machine_stopped: true,
  };

  const detour = calculateDetourCost(KATOL_DEPOT, currentStops, newStop);

  assert.ok(detour.additionalDistanceKm > 0);
  assert.equal(
    detour.newTotalDistanceKm,
    Math.round((detour.previousTotalDistanceKm + detour.additionalDistanceKm) * 10) / 10,
  );
});

test("17. Emergency detour travel-time calculation", () => {
  const currentStops = [{ id: "S1", location: "Kalmeshwar", gpsPoint: KALMESHWAR_POINT }];

  const newStop = {
    id: "S2",
    location: "Saoner",
    gpsPoint: SAONER_POINT,
    urgency_level: "CRITICAL",
    is_machine_stopped: true,
  };

  const detour = calculateDetourCost(KATOL_DEPOT, currentStops, newStop);

  assert.ok(detour.additionalDurationMinutes > 0);
  assert.equal(
    detour.newTotalDurationMinutes,
    detour.previousTotalDurationMinutes + detour.additionalDurationMinutes,
  );
  assert.ok(detour.detourReason.includes("Emergency stoppage"));
});

test("18. Zero additional detour edge case when waypoint matches existing stop", () => {
  const existingStop = {
    id: "S1",
    location: "Kalmeshwar",
    gpsPoint: KALMESHWAR_POINT,
  };

  // Co-located stop (e.g. second job on same farm)
  const coLocatedStop = {
    id: "S1-PART-B",
    location: "Kalmeshwar Farm Block B",
    gpsPoint: KALMESHWAR_POINT,
  };

  const detour = calculateDetourCost(KATOL_DEPOT, [existingStop], coLocatedStop);

  assert.equal(
    detour.additionalDistanceKm,
    0,
    "Adding a co-located stop causes zero additional travel distance",
  );
  assert.equal(detour.additionalDurationMinutes, 0);
});

// ==============================================================================
// 9. TAHSIL CLUSTERING & WORKSHOP EXCLUSION
// ==============================================================================

test("19. Tahsil clustering groups eligible doorstep repairs and identifies critical stoppages", () => {
  const repairs = [
    {
      id: "R1",
      location: "Katol",
      service_type: "DOORSTEP",
      urgency_level: "CRITICAL",
      is_machine_stopped: true,
    },
    {
      id: "R2",
      location: "Katol",
      service_type: "DOORSTEP",
      urgency_level: "STANDARD",
      is_machine_stopped: false,
    },
    {
      id: "R3",
      location: "Saoner",
      service_type: "DOORSTEP",
      urgency_level: "HIGH",
      is_machine_stopped: false,
    },
    {
      id: "R4",
      location: "Unknown Remote Valley",
      service_type: "DOORSTEP",
      urgency_level: "STANDARD",
      is_machine_stopped: false,
    },
  ];

  const clustered = clusterRepairsByTahsil(repairs);

  assert.equal(clustered.totalEligibleDoorstepRepairs, 4);
  assert.equal(clustered.totalExcludedWorkshopRepairs, 0);
  assert.equal(clustered.unknownCount, 1);

  // Katol cluster has 2 repairs, 1 critical stopped
  assert.equal(clustered.clusters["Katol"].count, 2);
  assert.equal(clustered.clusters["Katol"].criticalStoppedCount, 1);
  assert.ok(clustered.clusters["Katol"].centroid !== null);

  // Saoner cluster has 1 repair, 0 critical
  assert.equal(clustered.clusters["Saoner"].count, 1);
  assert.equal(clustered.clusters["Saoner"].criticalStoppedCount, 0);

  // Unknown cluster has 1 repair
  assert.equal(clustered.clusters["Unknown"].count, 1);
  assert.equal(clustered.clusters["Unknown"].centroid, null);

  // Sorted list: Katol first because it has a critical stopped repair!
  assert.equal(clustered.clusterList[0].tahsil, "Katol");
});

test("20. Workshop requests are excluded from field circuit clusters", () => {
  const repairs = [
    { id: "R1", location: "Katol", service_type: "DOORSTEP" },
    { id: "R2", location: "Katol", service_type: "WORKSHOP" }, // Workshop drop-off
    { id: "R3", location: "Saoner", service_type: "WORKSHOP" }, // Workshop drop-off
    { id: "R4", location: "Saoner", service_type: "DOORSTEP" },
  ];

  const clustered = clusterRepairsByTahsil(repairs);

  assert.equal(
    clustered.totalEligibleDoorstepRepairs,
    2,
    "Only doorstep requests are eligible for field circuits",
  );
  assert.equal(clustered.totalExcludedWorkshopRepairs, 2, "Workshop requests are excluded");
  assert.equal(clustered.clusters["Katol"].count, 1);
  assert.equal(clustered.clusters["Saoner"].count, 1);
});

// ==============================================================================
// 10. RESILIENCE & BOUNDARY CONDITIONS
// ==============================================================================

test("21. calculateCircuitMetricsWithRouting falls back to approximation if OSRM fails", async () => {
  const stops = [{ id: "S1", location: "Kalmeshwar", gpsPoint: KALMESHWAR_POINT }];

  const failingFetch = async () => {
    throw new Error("OSRM Network Down or Timed Out");
  };

  const metrics = await calculateCircuitMetricsWithRouting(KATOL_DEPOT, stops, {
    fetchFn: failingFetch,
  });

  assert.equal(metrics.stopCount, 1);
  assert.equal(metrics.routingMode, "rural_road_fallback");
  assert.equal(metrics.hasOsrmMetrics, false);
  assert.ok(metrics.totalDistanceKm > 0);
});

test("22. clusterRepairsByTahsil gracefully handles null and undefined inputs", () => {
  const resNull = clusterRepairsByTahsil(null);
  assert.equal(resNull.totalEligibleDoorstepRepairs, 0);
  assert.equal(resNull.clusterList.length, 0);

  const resEmpty = clusterRepairsByTahsil([]);
  assert.equal(resEmpty.totalEligibleDoorstepRepairs, 0);
  assert.equal(resEmpty.clusterList.length, 0);
});

test("23. normalizeCircuitStop correctly extracts nested Supabase relations", () => {
  const rawDbRecord = {
    id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    job_number: "TB-9988",
    location: "Katol, Nagpur",
    farmer: {
      full_name: "Balasaheb Patil",
      phone: "+91 98220 12345",
    },
    equipment: {
      make: "Mahindra",
      model: "575 DI",
    },
    service_type: "DOORSTEP",
    urgency_level: "CRITICAL",
    is_machine_stopped: true,
  };

  const norm = normalizeCircuitStop(rawDbRecord);

  assert.equal(norm.id, "f47ac10b-58cc-4372-a567-0e02b2c3d479");
  assert.equal(norm.jobNumber, "TB-9988");
  assert.equal(norm.customerName, "Balasaheb Patil");
  assert.equal(norm.equipmentModel, "Mahindra 575 DI");
  assert.equal(norm.isEmergency, true);
  assert.equal(norm.distanceSource, "tahsil_centroid");
});

test("24. Non-urgent stop inserted into circuit with existing emergency stops preserves priority", () => {
  const emergency1 = {
    id: "EMERGENCY-1",
    location: "Narkhed",
    gpsPoint: NARKHED_POINT,
    urgency_level: "CRITICAL",
    is_machine_stopped: true,
  };

  const newRoutineStop = {
    id: "ROUTINE-NEW",
    location: "Kalmeshwar",
    gpsPoint: KALMESHWAR_POINT,
    urgency_level: "STANDARD",
    is_machine_stopped: false,
  };

  const detour = calculateDetourCost(KATOL_DEPOT, [emergency1], newRoutineStop);

  assert.equal(detour.isEmergency, false);
  // Non-urgent stop must not precede emergency stop
  assert.equal(detour.insertionIndex, 1, "Non-urgent stop must be appended after emergency stop");
  assert.equal(detour.updatedStops[0].id, "EMERGENCY-1");
  assert.equal(detour.updatedStops[1].id, "ROUTINE-NEW");
});

test("25. formatRouteDistance and formatRouteDuration integration in metrics", () => {
  const stops = [
    { id: "S1", location: "Kalmeshwar", gpsPoint: KALMESHWAR_POINT },
    { id: "S2", location: "Saoner", gpsPoint: SAONER_POINT },
  ];

  const metrics = calculateCircuitMetrics(KATOL_DEPOT, stops);

  assert.match(metrics.totalDistanceFormatted, /^\d+(\.\d+)? km$/);
  assert.match(metrics.totalDurationFormatted, /^\d+ (hr|mins)/);
  assert.equal(metrics.legs.length, 3);
  for (const leg of metrics.legs) {
    assert.match(leg.distanceFormatted, /^\d+(\.\d+)? (km|m)$/);
    assert.match(leg.durationFormatted, /^\d+ (hr|mins)/);
  }
});
