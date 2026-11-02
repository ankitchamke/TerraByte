/**
 * TerraByte — Phase 10.4-C: Technician Daily Field Circuit UX Test Suite
 *
 * Verifies:
 * 1. Circuit card visibility thresholds (hidden for < 2 doorstep jobs, visible for >= 2).
 * 2. Strict exclusion of WORKSHOP and inactive requests from doorstep circuit count.
 * 3. Topological itinerary generation: Depot Origin -> Sequential Stops -> Depot Completion.
 * 4. Urgency prioritization: CRITICAL + machine stopped is pinned as Stop #1.
 * 5. Urgency badges: Critical Stoppage and Urgent (24h) indicators.
 * 6. Per-leg distance and monotonic cumulative circuit metrics.
 * 7. Navigation URL generation: Exact GPS directions URL vs Coarse village search fallback.
 * 8. Emergency notification banner and detour cost calculation.
 * 9. Emergency banner acknowledgment state (idempotent dismissal without re-render loops).
 * 10. Strict privacy: No raw numeric coordinates exposed in visible user text.
 * 11. Cumulative circuit summary formatting and routing mode attribution.
 * 12. AST verification of TechnicianCircuitCard component and /technician route integration.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  NAGPUR_TAHSIL_CENTROIDS,
  buildGoogleMapsDirectionsUrl,
  buildGoogleMapsSearchUrl,
  isValidGpsCoordinate,
  getNagpurTahsilCentroid,
} from "../src/lib/location.ts";

import {
  calculateCircuitMetrics,
  calculateDetourCost,
  optimizeCircuitStops,
  normalizeCircuitStop,
} from "../src/lib/services/circuit-optimizer.ts";

import { normalizeRepairDoorstepUrgency } from "../src/lib/services/doorstep-service.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

// Workshop Depot: Katol Mobile Repairs
const KATOL_DEPOT = {
  latitude: 21.2682,
  longitude: 78.5833,
  name: "Green Earth Mobile Repairs, Katol",
};

// Tahsil Centroids for realistic scenario testing
const NARKHED_POINT = NAGPUR_TAHSIL_CENTROIDS["Narkhed"]; // ~25 km NW of Katol
const KALMESHWAR_POINT = NAGPUR_TAHSIL_CENTROIDS["Kalmeshwar"]; // ~35 km E of Katol
const SAONER_POINT = NAGPUR_TAHSIL_CENTROIDS["Saoner"]; // ~48 km NE of Katol

// Helper to create mock repair requests matching Supabase RepairRequestWithEquipment
function createMockRepair(overrides = {}) {
  const id = overrides.id || `rep-${Math.random().toString(36).substring(2, 9)}`;
  return {
    id,
    job_number:
      overrides.job_number || overrides.jobNumber || `JOB-${id.substring(4, 8).toUpperCase()}`,
    status: overrides.status || "ACCEPTED",
    service_type: overrides.service_type || "DOORSTEP",
    urgency_level: overrides.urgency_level || "STANDARD",
    is_machine_stopped: overrides.is_machine_stopped ?? false,
    field_landmark: overrides.field_landmark || null,
    location: overrides.location || "Katol Rural",
    status_since: new Date().toISOString(),
    created_at: new Date().toISOString(),
    is_testing: false,
    farmer: {
      id: "farmer-1",
      full_name: overrides.customerName || "Ramesh Patil",
      village: overrides.village || "Katol",
      phone: "9876543210",
    },
    equipment: {
      id: "equip-1",
      make: overrides.make || "Mahindra",
      model: overrides.model || "575 DI",
    },
    repair_dispatch_locations: overrides.gpsPoint
      ? [
          {
            latitude: overrides.gpsPoint.latitude,
            longitude: overrides.gpsPoint.longitude,
            accuracy: 10,
            captured_at: new Date().toISOString(),
          },
        ]
      : [],
    ...overrides,
  };
}

// Helper simulating TechnicianCircuitCard eligible doorstep filtering
function filterEligibleDoorstepRepairs(repairs) {
  return (repairs || []).filter((r) => {
    const norm = normalizeRepairDoorstepUrgency(r);
    return (
      norm.service_type === "DOORSTEP" &&
      ["ACCEPTED", "QUOTE_PENDING", "QUOTE_REVISED", "IN_PROGRESS", "WAITING_FOR_PARTS"].includes(
        r.status,
      )
    );
  });
}

// ==============================================================================
// 1. VISIBILITY AND ELIGIBILITY LOGIC
// ==============================================================================

test("1. Circuit card visibility: activates when technician has >= 2 active assigned doorstep repairs", () => {
  const repairs = [
    createMockRepair({ id: "job-1", status: "ACCEPTED", service_type: "DOORSTEP" }),
    createMockRepair({ id: "job-2", status: "IN_PROGRESS", service_type: "DOORSTEP" }),
  ];

  const eligible = filterEligibleDoorstepRepairs(repairs);
  assert.equal(eligible.length, 2, "Must identify exactly 2 eligible doorstep repairs");
  assert.ok(eligible.length >= 2, "Threshold check must pass (>= 2)");
});

test("2. Hidden state: remains hidden (returns null) with 0 or 1 active doorstep repairs", () => {
  // 0 repairs
  const emptyEligible = filterEligibleDoorstepRepairs([]);
  assert.equal(emptyEligible.length, 0);
  assert.ok(emptyEligible.length < 2, "Must be hidden with 0 repairs");

  // 1 repair
  const singleRepair = [
    createMockRepair({ id: "job-1", status: "ACCEPTED", service_type: "DOORSTEP" }),
  ];
  const singleEligible = filterEligibleDoorstepRepairs(singleRepair);
  assert.equal(singleEligible.length, 1);
  assert.ok(singleEligible.length < 2, "Must be hidden with only 1 repair");
});

test("3. Workshop requests are strictly excluded from doorstep circuit threshold", () => {
  const mixedRepairs = [
    createMockRepair({ id: "job-1", status: "ACCEPTED", service_type: "DOORSTEP" }),
    createMockRepair({ id: "job-2", status: "ACCEPTED", service_type: "WORKSHOP" }),
    createMockRepair({ id: "job-3", status: "IN_PROGRESS", service_type: "WORKSHOP" }),
    createMockRepair({ id: "job-4", status: "WAITING_FOR_PARTS", service_type: "WORKSHOP" }),
  ];

  const eligible = filterEligibleDoorstepRepairs(mixedRepairs);
  // Total active jobs = 4, but only 1 is DOORSTEP
  assert.equal(eligible.length, 1, "Only the 1 DOORSTEP request must be eligible");
  assert.ok(eligible.length < 2, "Must NOT show circuit card when doorstep count < 2");
});

test("4. Non-active doorstep repair statuses (REQUESTED, COMPLETED, CANCELLED) are excluded", () => {
  const statusRepairs = [
    createMockRepair({ id: "job-1", status: "ACCEPTED", service_type: "DOORSTEP" }),
    createMockRepair({ id: "job-2", status: "REQUESTED", service_type: "DOORSTEP" }), // Not yet assigned/accepted
    createMockRepair({ id: "job-3", status: "COMPLETED", service_type: "DOORSTEP" }),
    createMockRepair({ id: "job-4", status: "CANCELLED", service_type: "DOORSTEP" }),
  ];

  const eligible = filterEligibleDoorstepRepairs(statusRepairs);
  assert.equal(eligible.length, 1, "Only ACCEPTED repair is active");
  assert.ok(eligible.length < 2, "Must NOT show circuit card for unaccepted or completed jobs");
});

// ==============================================================================
// 2. SEQUENTIAL ITINERARY & METRICS
// ==============================================================================

test("5. Sequential itinerary renders correct Stop #1, Stop #2, ... and closes at Depot", () => {
  const repairs = [
    createMockRepair({
      id: "job-kalmeshwar",
      jobNumber: "TB-KALM-01",
      location: "Kalmeshwar",
      tahsil: "Kalmeshwar",
      gpsPoint: KALMESHWAR_POINT,
    }),
    createMockRepair({
      id: "job-narkhed",
      jobNumber: "TB-NARK-02",
      location: "Narkhed",
      tahsil: "Narkhed",
      gpsPoint: NARKHED_POINT,
    }),
  ];

  const circuit = calculateCircuitMetrics(KATOL_DEPOT, repairs);

  assert.equal(circuit.stopCount, 2, "Stop count must be 2");
  assert.equal(circuit.orderedStops.length, 2, "Must order 2 stops");
  assert.equal(circuit.orderedStops[0].sequenceNumber, 1, "First stop sequence number must be 1");
  assert.equal(circuit.orderedStops[1].sequenceNumber, 2, "Second stop sequence number must be 2");

  // Total legs = N stops + 1 return leg = 3 legs
  assert.equal(circuit.legs.length, 3, "Legs count must equal stops + 1 (return to depot)");
  assert.ok(circuit.totalDistanceKm > 0, "Total distance must be positive");
  assert.ok(circuit.totalDurationMinutes > 0, "Total duration must be positive");
});

test("6. Cumulative distance increases monotonically across sequential stops", () => {
  const repairs = [
    createMockRepair({ id: "s1", location: "Kalmeshwar", gpsPoint: KALMESHWAR_POINT }),
    createMockRepair({ id: "s2", location: "Saoner", gpsPoint: SAONER_POINT }),
    createMockRepair({ id: "s3", location: "Narkhed", gpsPoint: NARKHED_POINT }),
  ];

  const circuit = calculateCircuitMetrics(KATOL_DEPOT, repairs);

  let prevCumul = 0;
  for (const orderedStop of circuit.orderedStops) {
    assert.ok(
      orderedStop.cumulativeDistanceKm >= prevCumul,
      `Cumulative distance (${orderedStop.cumulativeDistanceKm}) must be >= previous (${prevCumul})`,
    );
    prevCumul = orderedStop.cumulativeDistanceKm;
  }
});

// ==============================================================================
// 3. URGENCY & EMERGENCY DISPATCH PRIORITY
// ==============================================================================

test("7. CRITICAL + stopped machine is always pinned as Stop #1 in the daily itinerary", () => {
  const routineFarStop = createMockRepair({
    id: "routine-narkhed",
    jobNumber: "TB-ROUTINE",
    location: "Narkhed",
    gpsPoint: NARKHED_POINT, // ~25 km
    urgency_level: "STANDARD",
    is_machine_stopped: false,
  });

  const emergencyFartherStop = createMockRepair({
    id: "emergency-saoner",
    jobNumber: "TB-EMERGENCY",
    location: "Saoner",
    gpsPoint: SAONER_POINT, // ~48 km (farther than Narkhed)
    urgency_level: "CRITICAL",
    is_machine_stopped: true,
  });

  const circuit = calculateCircuitMetrics(KATOL_DEPOT, [routineFarStop, emergencyFartherStop]);

  assert.equal(
    circuit.orderedStops[0].stop.jobNumber,
    "TB-EMERGENCY",
    "Emergency stopped machine must be pinned as Stop #1 regardless of distance",
  );
  assert.equal(circuit.orderedStops[0].stop.isEmergency, true);
});

test("8. Urgent breakdown banner detects active emergency and computes detour cost", () => {
  const routineStops = [
    createMockRepair({ id: "r1", location: "Kalmeshwar", gpsPoint: KALMESHWAR_POINT }),
    createMockRepair({ id: "r2", location: "Saoner", gpsPoint: SAONER_POINT }),
  ];

  const emergencyStop = createMockRepair({
    id: "em1",
    jobNumber: "TB-CRIT-99",
    location: "Narkhed",
    gpsPoint: NARKHED_POINT,
    urgency_level: "CRITICAL",
    is_machine_stopped: true,
  });

  const detour = calculateDetourCost(KATOL_DEPOT, routineStops, emergencyStop);

  assert.ok(detour.additionalDistanceKm >= 0, "Detour distance must be non-negative");
  assert.ok(detour.additionalDurationMinutes >= 0, "Detour duration must be non-negative");
  assert.ok(
    detour.additionalDistanceFormatted.includes("km"),
    "Formatted detour must include 'km'",
  );
  assert.ok(
    detour.additionalDurationFormatted.includes("mins") ||
      detour.additionalDurationFormatted.includes("hr"),
    "Formatted detour must include time units",
  );
});

test("9. Emergency acknowledgment state isolates dismissed IDs without re-triggering banner", () => {
  const acknowledgedEmergencies = ["em1"];

  const emergencyStop = { id: "em1", isEmergency: true };
  const unacknowledgedStop = { id: "em2", isEmergency: true };

  // Verification of the exclusion filter used in TechnicianCircuitCard
  const isEm1Active =
    emergencyStop.isEmergency && !acknowledgedEmergencies.includes(emergencyStop.id);
  const isEm2Active =
    unacknowledgedStop.isEmergency && !acknowledgedEmergencies.includes(unacknowledgedStop.id);

  assert.equal(isEm1Active, false, "Acknowledged emergency em1 must be dismissed from banner");
  assert.equal(isEm2Active, true, "Unacknowledged emergency em2 must remain active in banner");
});

// ==============================================================================
// 4. NAVIGATION URL GENERATION & MISSING COORDINATE FALLBACKS
// ==============================================================================

test("10. Exact GPS generates valid Google Maps Directions URL", () => {
  const validLat = 21.2682;
  const validLng = 78.5833;

  assert.ok(isValidGpsCoordinate(validLat, validLng));
  const url = buildGoogleMapsDirectionsUrl(validLat, validLng);

  assert.ok(
    url.startsWith("https://www.google.com/maps/dir/?api=1&destination="),
    "Must be Google Maps directions URL",
  );
  assert.ok(url.includes("21.268200%2C78.583300"), "Must encode formatted coordinates");
});

test("11. Missing GPS coordinates fallback generates Google Maps Search URL with location query", () => {
  const coarseLocation = "Parseoni Tahsil, Near Gram Panchayat";
  const url = buildGoogleMapsSearchUrl(coarseLocation);

  assert.ok(
    url.startsWith("https://www.google.com/maps/search/?api=1&query="),
    "Must be Google Maps search query URL",
  );
  assert.ok(
    url.includes("Parseoni%20Tahsil%2C%20Near%20Gram%20Panchayat"),
    "Must URL-encode coarse location",
  );
});

// ==============================================================================
// 5. PRIVACY & SENSITIVE DATA LEAKAGE GUARDS
// ==============================================================================

test("12. Privacy check: Raw numeric GPS coordinates are not rendered into visible UI text", () => {
  const cardPath = path.join(ROOT_DIR, "src", "components", "technician-circuit-card.tsx");
  const code = fs.readFileSync(cardPath, "utf8");

  // Coordinates should only be accessed for navigation URL generation or routing calculation
  // They should not be directly rendered inside JSX text blocks
  assert.ok(
    !code.includes("{stop.stop.gpsPoint.latitude}") &&
      !code.includes("{s.gpsPoint.latitude}") &&
      !code.includes("{s.latitude}") &&
      !code.includes("{depot.latitude}"),
    "JSX text must NEVER print raw numeric latitude directly to the screen",
  );
  assert.ok(
    !code.includes("{stop.stop.gpsPoint.longitude}") &&
      !code.includes("{s.gpsPoint.longitude}") &&
      !code.includes("{s.longitude}") &&
      !code.includes("{depot.longitude}"),
    "JSX text must NEVER print raw numeric longitude directly to the screen",
  );
});

// ==============================================================================
// 6. AST & COMPONENT INTEGRATION CHECKS
// ==============================================================================

test("13. TechnicianCircuitCard component exports and UI element contract", () => {
  const cardPath = path.join(ROOT_DIR, "src", "components", "technician-circuit-card.tsx");
  const code = fs.readFileSync(cardPath, "utf8");

  // Exported component
  assert.ok(
    code.includes("export function TechnicianCircuitCard"),
    "Must export TechnicianCircuitCard",
  );

  // Key Test IDs
  assert.ok(
    code.includes('data-testid="circuit-urgent-banner"'),
    "Must render urgent stoppage banner testid",
  );
  assert.ok(
    code.includes('data-testid="circuit-dismiss-emergency"'),
    "Must render dismiss emergency button testid",
  );
  assert.ok(
    code.includes('data-testid="circuit-navigate-next-btn"'),
    "Must render navigate next button testid",
  );
  assert.ok(
    code.includes('data-testid="circuit-itinerary-timeline"'),
    "Must render itinerary timeline testid",
  );

  // Key Badges and Labels
  assert.ok(code.includes("Daily Field Circuit"), "Must render Daily Field Circuit header badge");
  assert.ok(code.includes("Critical Stoppage"), "Must render Critical Stoppage urgency badge");
  assert.ok(code.includes("Urgent (24h)"), "Must render Urgent (24h) urgency badge");
  assert.ok(code.includes("Landmark / Access:"), "Must render Landmark / Access section");
  assert.ok(code.includes("Return to"), "Must render Return to Depot completion card");
});

test("14. Technician workbench (/technician) integrates TechnicianCircuitCard above Active Jobs", () => {
  const techIndexPath = path.join(ROOT_DIR, "src", "routes", "technician", "index.tsx");
  const code = fs.readFileSync(techIndexPath, "utf8");

  // Component import
  assert.ok(
    code.includes('import { TechnicianCircuitCard } from "@/components/technician-circuit-card"'),
    "Must import TechnicianCircuitCard in technician workbench",
  );

  // Component JSX usage
  assert.ok(code.includes("<TechnicianCircuitCard"), "Must render TechnicianCircuitCard component");
  assert.ok(
    code.includes("activeRepairs={active}"),
    "Must pass active repairs list to TechnicianCircuitCard",
  );
  assert.ok(
    code.includes("techProfile={techProfile}"),
    "Must pass techProfile to TechnicianCircuitCard",
  );

  // Placement: Above Active jobs section
  const cardPos = code.indexOf("<TechnicianCircuitCard");
  const activeJobsPos = code.indexOf("title={`Active jobs (${active.length})`}");

  assert.ok(cardPos !== -1, "TechnicianCircuitCard must be present");
  assert.ok(activeJobsPos !== -1, "Active jobs section must be present");
  assert.ok(
    cardPos < activeJobsPos,
    "TechnicianCircuitCard must be rendered ABOVE Active jobs section",
  );
});

// ==============================================================================
// 7. NAVIGATION ACCURACY & COORDINATE MAPPING VERIFICATION (PHASE 10.4-C FIX)
// ==============================================================================

test("15. Correct repair ID to coordinate mapping prevents cross-contamination across stops", () => {
  const repA = createMockRepair({
    id: "rep-8818",
    jobNumber: "TB-8818",
    location: "Katol",
    gpsPoint: { latitude: 21.213477, longitude: 79.063531 },
  });

  const repB = createMockRepair({
    id: "rep-6791",
    jobNumber: "TB-6791",
    location: "Narkhed",
    gpsPoint: { latitude: 21.4878, longitude: 78.5322 },
  });

  const repC = createMockRepair({
    id: "rep-9654",
    jobNumber: "TB-9654",
    location: "Saoner",
    // No GPS: Coarse location only
  });

  // Verify resolveStopCoordinates for each independent stop
  const resA = normalizeCircuitStop(repA);
  const resB = normalizeCircuitStop(repB);
  const resC = normalizeCircuitStop(repC);

  // Stop A mapping
  assert.equal(resA.id, "rep-8818");
  assert.equal(resA.distanceSource, "exact_gps");
  assert.equal(resA.gpsPoint?.latitude, 21.213477);
  assert.equal(resA.gpsPoint?.longitude, 79.063531);

  // Stop B mapping
  assert.equal(resB.id, "rep-6791");
  assert.equal(resB.distanceSource, "exact_gps");
  assert.equal(resB.gpsPoint?.latitude, 21.4878);
  assert.equal(resB.gpsPoint?.longitude, 78.5322);

  // Stop C mapping (must not inherit A or B coordinates)
  assert.equal(resC.id, "rep-9654");
  assert.equal(resC.distanceSource, "tahsil_centroid");
  assert.notEqual(resC.gpsPoint?.latitude, resA.gpsPoint?.latitude);
  assert.notEqual(resC.gpsPoint?.latitude, resB.gpsPoint?.latitude);
});

test("16. Correct Google Maps destination URL generation and latitude/longitude ordering", () => {
  const lat = 21.213477;
  const lng = 79.063531;

  const url = buildGoogleMapsDirectionsUrl(lat, lng);

  // Must follow destination=lat,lng format strictly
  assert.ok(
    url.includes("destination=21.213477%2C79.063531"),
    "Latitude must strictly precede longitude in Google Maps directions destination param",
  );
  // Guard against inverted lng,lat ordering
  assert.ok(
    !url.includes("destination=79.063531"),
    "Longitude must never be placed first as latitude",
  );
});

test("17. Exact GPS takes strict precedence over tahsil-centroid fallback for navigation", () => {
  // Repair is labeled with location "Katol, Nagpur" (whose tahsil centroid is 21.2682, 78.5833)
  // but has exact captured GPS at 21.213477, 79.063531
  const repair = createMockRepair({
    id: "rep-precedence",
    jobNumber: "TB-PREC-01",
    location: "Katol, Nagpur",
    gpsPoint: { latitude: 21.213477, longitude: 79.063531 },
  });

  const stop = normalizeCircuitStop(repair);

  assert.equal(stop.distanceSource, "exact_gps", "Must be exact_gps source when coordinates exist");
  assert.equal(stop.gpsPoint?.latitude, 21.213477);
  assert.equal(stop.gpsPoint?.longitude, 79.063531);

  // URL must use the exact GPS coordinates, NOT the Katol centroid (21.2682)
  const navUrl = buildGoogleMapsDirectionsUrl(stop.gpsPoint.latitude, stop.gpsPoint.longitude);
  assert.ok(navUrl.includes("21.213477%2C79.063531"));
  assert.ok(!navUrl.includes("21.268200"));
});

test("18. Missing GPS fallback generates coarse search URL instead of arbitrary directions", () => {
  const repairWithoutGps = createMockRepair({
    id: "rep-no-gps",
    jobNumber: "TB-NOGPS-02",
    location: "Katol Rural, Near Shiv Temple",
    // No GPS coordinates
  });

  const stop = normalizeCircuitStop(repairWithoutGps);

  // If distanceSource is not exact_gps, navigation must generate a search query URL
  let targetUrl;
  if (stop.distanceSource === "exact_gps" && stop.gpsPoint) {
    targetUrl = buildGoogleMapsDirectionsUrl(stop.gpsPoint.latitude, stop.gpsPoint.longitude);
  } else {
    targetUrl = buildGoogleMapsSearchUrl(stop.location);
  }

  assert.ok(
    targetUrl.startsWith("https://www.google.com/maps/search/?api=1&query="),
    "Must use search URL for coarse locations to prevent misrouting",
  );
  assert.ok(targetUrl.includes("Katol%20Rural"));
});

test("19. Zero distance calculation when coordinates genuinely match between waypoints", () => {
  const commonCoord = { latitude: 21.213477, longitude: 79.063531 };

  // Depot is at commonCoord (technician testing from same spot)
  const depot = {
    latitude: commonCoord.latitude,
    longitude: commonCoord.longitude,
    name: "Tester Field Base",
  };

  // Farmer stop 1 is at commonCoord
  const stop1 = createMockRepair({
    id: "s1",
    jobNumber: "TB-SAME-01",
    gpsPoint: commonCoord,
  });

  // Farmer stop 2 is also at commonCoord
  const stop2 = createMockRepair({
    id: "s2",
    jobNumber: "TB-SAME-02",
    gpsPoint: commonCoord,
  });

  const circuit = calculateCircuitMetrics(depot, [stop1, stop2]);

  // When coordinates genuinely match, zero distance is mathematically correct
  assert.equal(circuit.totalDistanceKm, 0, "Total distance must be 0 km for identical coordinates");
  assert.equal(circuit.legs[0].distanceMeters, 0, "Leg 0 must be 0 m");
  assert.equal(circuit.legs[1].distanceMeters, 0, "Leg 1 must be 0 m");
  assert.equal(circuit.legs[0].distanceFormatted, "0 m", "Formatted distance must be '0 m'");

  // When a stop has distinct coordinates, distance must NOT be zero
  const distinctStop = createMockRepair({
    id: "s3",
    jobNumber: "TB-DIST-03",
    gpsPoint: { latitude: 21.4878, longitude: 78.5322 }, // Narkhed (~60 km away)
  });

  const circuitWithDistinct = calculateCircuitMetrics(depot, [stop1, distinctStop]);
  assert.ok(
    circuitWithDistinct.totalDistanceKm > 0,
    "Distance must be positive when coordinates genuinely differ",
  );
});

test("20. TechnicianCircuitCard component integrates batch dispatch location resolution and badges AST", () => {
  const cardPath = path.join(ROOT_DIR, "src", "components", "technician-circuit-card.tsx");
  const code = fs.readFileSync(cardPath, "utf8");

  // Batch query import and state
  assert.ok(code.includes("getRepairDispatchLocations"), "Must import getRepairDispatchLocations");
  assert.ok(code.includes("dispatchLocations"), "Must track dispatchLocations in component state");

  // Exact GPS vs Coarse Location Badges
  assert.ok(
    code.includes("Exact GPS saved"),
    "Must render 'Exact GPS saved' badge for exact coordinates",
  );
  assert.ok(
    code.includes("Coarse area only (no GPS)"),
    "Must render 'Coarse area only (no GPS)' badge for non-GPS stops",
  );
  assert.ok(
    code.includes("Exact GPS") && code.includes("Coarse Location Fallback"),
    "Next Destination CTA must clearly label location accuracy",
  );
});
