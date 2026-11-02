import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  NAGPUR_TAHSILS,
  NAGPUR_TAHSIL_CENTROIDS,
  normalizeNagpurTahsil,
  getNagpurTahsilCentroid,
  isValidGpsCoordinate,
  computeHaversineDistanceKm,
  computeApproximateRoadDistance,
} from "../src/lib/location.ts";

import { computeTechnicianDispatchScore } from "../src/lib/services/technician-dispatch.ts";

import { computeOsrmRoute, resolveDrivingDistance } from "../src/lib/services/routing.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

// ==============================================================================
// 1. NAGPUR GEOGRAPHICAL CENTROIDS & NORMALIZATION
// ==============================================================================

test("NAGPUR_TAHSILS contains exactly the 14 official tahsils of Nagpur District", () => {
  assert.equal(NAGPUR_TAHSILS.length, 14);
  assert.ok(NAGPUR_TAHSILS.includes("Katol"));
  assert.ok(NAGPUR_TAHSILS.includes("Saoner"));
  assert.ok(NAGPUR_TAHSILS.includes("Umred"));
  assert.ok(NAGPUR_TAHSILS.includes("Nagpur (Urban)"));
  assert.ok(NAGPUR_TAHSILS.includes("Nagpur (Rural)"));
  assert.ok(NAGPUR_TAHSILS.includes("Hingna"));
  assert.ok(NAGPUR_TAHSILS.includes("Kalmeshwar"));
  assert.ok(NAGPUR_TAHSILS.includes("Narkhed"));
  assert.ok(NAGPUR_TAHSILS.includes("Ramtek"));
  assert.ok(NAGPUR_TAHSILS.includes("Parseoni"));
  assert.ok(NAGPUR_TAHSILS.includes("Mauda"));
  assert.ok(NAGPUR_TAHSILS.includes("Kamptee"));
  assert.ok(NAGPUR_TAHSILS.includes("Kuhi"));
  assert.ok(NAGPUR_TAHSILS.includes("Bhiwapur"));
});

test("NAGPUR_TAHSIL_CENTROIDS provides valid geographic coordinates within Nagpur district bounding box", () => {
  for (const tahsil of NAGPUR_TAHSILS) {
    const point = NAGPUR_TAHSIL_CENTROIDS[tahsil];
    assert.ok(point, `Centroid for ${tahsil} must exist`);
    assert.equal(isValidGpsCoordinate(point.latitude, point.longitude), true);

    // Official Nagpur district boundary: Latitude [20.5, 21.8], Longitude [78.2, 79.6]
    assert.ok(
      point.latitude >= 20.5 && point.latitude <= 21.8,
      `${tahsil} latitude (${point.latitude}) must be inside Nagpur district`,
    );
    assert.ok(
      point.longitude >= 78.2 && point.longitude <= 79.6,
      `${tahsil} longitude (${point.longitude}) must be inside Nagpur district`,
    );
  }
});

test("normalizeNagpurTahsil resolves standard and regional alias names", () => {
  assert.equal(normalizeNagpurTahsil("Katol"), "Katol");
  assert.equal(normalizeNagpurTahsil("katol"), "Katol");
  assert.equal(normalizeNagpurTahsil("Dorli, Katol"), "Katol");
  assert.equal(normalizeNagpurTahsil("Saoner"), "Saoner");
  assert.equal(normalizeNagpurTahsil("Savner, Nagpur"), "Saoner");
  assert.equal(normalizeNagpurTahsil("Umred"), "Umred");
  assert.equal(normalizeNagpurTahsil("Umrer"), "Umred");
  assert.equal(normalizeNagpurTahsil("Nagpur City"), "Nagpur (Urban)");
  assert.equal(normalizeNagpurTahsil("Nagpur Urban"), "Nagpur (Urban)");
  assert.equal(normalizeNagpurTahsil("Nagpur Rural"), "Nagpur (Rural)");
  assert.equal(normalizeNagpurTahsil("Kamthi"), "Kamptee");
});

test("getNagpurTahsilCentroid strictly returns null for unknown locations and never defaults to Nagpur", () => {
  assert.equal(getNagpurTahsilCentroid(null), null);
  assert.equal(getNagpurTahsilCentroid(""), null);
  assert.equal(getNagpurTahsilCentroid("   "), null);
  assert.equal(getNagpurTahsilCentroid("Mumbai"), null);
  assert.equal(getNagpurTahsilCentroid("Pune, Maharashtra"), null);
  assert.equal(getNagpurTahsilCentroid("Unknown Farmland X"), null);

  // Known location returns valid centroid
  const katol = getNagpurTahsilCentroid("Katol, Nagpur");
  assert.ok(katol);
  assert.equal(katol.latitude, 21.2682);
  assert.equal(katol.longitude, 78.5833);
});

// ==============================================================================
// 2. HAVERSINE & APPROXIMATE ROAD DISTANCE ENGINE
// ==============================================================================

test("computeHaversineDistanceKm accurately computes straight-line distance", () => {
  // Katol (21.2682, 78.5833) to Saoner (21.3850, 78.9167)
  const katol = { latitude: 21.2682, longitude: 78.5833 };
  const saoner = { latitude: 21.385, longitude: 78.9167 };
  const distanceKm = computeHaversineDistanceKm(katol, saoner);

  // Straight line is ~36.8 km
  assert.ok(distanceKm >= 35 && distanceKm <= 38, `Expected ~37 km, got ${distanceKm}`);

  // Same point is 0 km
  assert.equal(computeHaversineDistanceKm(katol, katol), 0);
});

test("computeHaversineDistanceKm rejects invalid coordinates with error", () => {
  assert.throws(
    () =>
      computeHaversineDistanceKm({ latitude: 95, longitude: 78 }, { latitude: 21, longitude: 78 }),
    /Invalid GPS coordinates/,
  );
  assert.throws(
    () =>
      computeHaversineDistanceKm({ latitude: 0, longitude: 0 }, { latitude: 21, longitude: 78 }),
    /Invalid GPS coordinates/,
  );
});

test("computeApproximateRoadDistance applies 1.3x rural road curvature and 35 km/h transit speed", () => {
  const katol = { latitude: 21.2682, longitude: 78.5833 };
  const saoner = { latitude: 21.385, longitude: 78.9167 };
  const approx = computeApproximateRoadDistance(katol, saoner);

  assert.equal(approx.isApproximate, true);
  // Straight line ~36.8 km * 1.3 = ~47.8 km
  assert.ok(
    approx.distanceKm >= 46 && approx.distanceKm <= 50,
    `Road distance: ${approx.distanceKm}`,
  );
  // ~48 km @ 35 km/h = ~82 mins
  assert.ok(
    approx.durationMinutes >= 75 && approx.durationMinutes <= 90,
    `Duration: ${approx.durationMinutes}`,
  );
  assert.ok(approx.durationFormatted.includes("hr"), "Formatted duration includes hours");
});

// ==============================================================================
// 3. OSRM ROUTE INTEGRATION & GRACEFUL FALLBACK
// ==============================================================================

test("resolveDrivingDistance returns OSRM result on HTTP success", async () => {
  const origin = { latitude: 21.2682, longitude: 78.5833 };
  const destination = { latitude: 21.385, longitude: 78.9167 };

  // Mock fetch that simulates successful OSRM response
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      code: "Ok",
      routes: [
        {
          distance: 44200, // 44.2 km
          duration: 3720, // 62 mins
        },
      ],
    }),
  });

  const res = await resolveDrivingDistance(origin, destination, {
    fetchFn: mockFetch,
    timeoutMs: 1000,
  });

  assert.equal(res.routingMode, "osrm_driving");
  assert.equal(res.isEstimate, false);
  assert.equal(res.distanceKm, 44.2);
  assert.equal(res.durationMinutes, 62);
  assert.equal(res.durationFormatted, "1 hr 2 mins");
});

test("resolveDrivingDistance falls back to approximate road distance when OSRM times out or fails", async () => {
  const origin = { latitude: 21.2682, longitude: 78.5833 };
  const destination = { latitude: 21.385, longitude: 78.9167 };

  // Mock fetch that throws network error
  const failingFetch = async () => {
    throw new Error("Network offline or DNS failure");
  };

  const res = await resolveDrivingDistance(origin, destination, {
    fetchFn: failingFetch,
    timeoutMs: 500,
  });

  assert.equal(res.routingMode, "rural_road_fallback");
  assert.equal(res.isEstimate, true);
  assert.ok(res.distanceKm > 0);
  assert.ok(res.durationMinutes > 0);
});

test("resolveDrivingDistance skips OSRM when skipOsrm is true", async () => {
  const origin = { latitude: 21.2682, longitude: 78.5833 };
  const destination = { latitude: 21.385, longitude: 78.9167 };

  let fetchCalled = false;
  const mockFetch = async () => {
    fetchCalled = true;
    return { ok: true, json: async () => ({}) };
  };

  const res = await resolveDrivingDistance(origin, destination, {
    skipOsrm: true,
    fetchFn: mockFetch,
  });

  assert.equal(fetchCalled, false);
  assert.equal(res.routingMode, "rural_road_fallback");
  assert.equal(res.isEstimate, true);
});

// ==============================================================================
// 4. ADAPTIVE DISPATCH SCORING ENGINE
// ==============================================================================

test("Critical stopped-machine scoring applies approved weights: Proximity 40, Availability 25, Brand/Skill 25, Mobile 10", () => {
  // Candidate A: 8 km away, 0 active jobs, brand & skill specialist, mobile doorstep capable
  const perfectCritical = computeTechnicianDispatchScore({
    isCriticalStopped: true,
    brandMatch: true,
    skillMatch: true,
    isAvailable: true,
    activeJobCount: 0,
    distanceKm: 8.0,
    isWithinRadius: true,
    serviceType: "DOORSTEP",
    isDoorstepCapable: true,
  });

  assert.equal(perfectCritical.proximityScore, 40);
  assert.equal(perfectCritical.availabilityScore, 25);
  assert.equal(perfectCritical.brandScore, 15);
  assert.equal(perfectCritical.skillScore, 10);
  assert.equal(perfectCritical.doorstepScore, 10);
  assert.equal(perfectCritical.score, 100);
});

test("Routine scoring applies approved weights: Brand 30, Skill 25, Proximity 20, Availability 15, Delivery 10", () => {
  // Candidate B: Routine repair with full brand and skill match, 12 km away, available
  const perfectRoutine = computeTechnicianDispatchScore({
    isCriticalStopped: false,
    brandMatch: true,
    skillMatch: true,
    isAvailable: true,
    activeJobCount: 0,
    distanceKm: 12.0,
    isWithinRadius: true,
    serviceType: "DOORSTEP",
    isDoorstepCapable: true,
  });

  assert.equal(perfectRoutine.brandScore, 30);
  assert.equal(perfectRoutine.skillScore, 25);
  assert.equal(perfectRoutine.proximityScore, 20);
  assert.equal(perfectRoutine.availabilityScore, 15);
  assert.equal(perfectRoutine.doorstepScore, 10);
  assert.equal(perfectRoutine.score, 100);
});

test("Active workload scales availability score (0 jobs = 100%, 1 job = 70%, 2+ jobs = 30%)", () => {
  // In Critical (max 25 availability)
  const zeroJobsCrit = computeTechnicianDispatchScore({
    isCriticalStopped: true,
    brandMatch: false,
    skillMatch: false,
    isAvailable: true,
    activeJobCount: 0,
    distanceKm: null,
    isWithinRadius: true,
    serviceType: "DOORSTEP",
    isDoorstepCapable: true,
  });
  assert.equal(zeroJobsCrit.availabilityScore, 25); // 100% of 25

  const oneJobCrit = computeTechnicianDispatchScore({
    isCriticalStopped: true,
    brandMatch: false,
    skillMatch: false,
    isAvailable: true,
    activeJobCount: 1,
    distanceKm: null,
    isWithinRadius: true,
    serviceType: "DOORSTEP",
    isDoorstepCapable: true,
  });
  assert.equal(oneJobCrit.availabilityScore, 18); // 70% of 25 = 17.5 -> 18

  const multiJobsCrit = computeTechnicianDispatchScore({
    isCriticalStopped: true,
    brandMatch: false,
    skillMatch: false,
    isAvailable: true,
    activeJobCount: 3,
    distanceKm: null,
    isWithinRadius: true,
    serviceType: "DOORSTEP",
    isDoorstepCapable: true,
  });
  assert.equal(multiJobsCrit.availabilityScore, 8); // 30% of 25 = 7.5 -> 8

  // Unavailable technician always receives 0 availability score
  const unavailCrit = computeTechnicianDispatchScore({
    isCriticalStopped: true,
    brandMatch: false,
    skillMatch: false,
    isAvailable: false,
    activeJobCount: 0,
    distanceKm: null,
    isWithinRadius: true,
    serviceType: "DOORSTEP",
    isDoorstepCapable: true,
  });
  assert.equal(unavailCrit.availabilityScore, 0);
});

test("Doorstep vs Workshop capability matching", () => {
  // Doorstep repair with mobile-capable technician gets 10 points
  const mobileOnDoorstep = computeTechnicianDispatchScore({
    isCriticalStopped: false,
    brandMatch: false,
    skillMatch: false,
    isAvailable: true,
    activeJobCount: 0,
    distanceKm: 20,
    isWithinRadius: true,
    serviceType: "DOORSTEP",
    isDoorstepCapable: true,
  });
  assert.equal(mobileOnDoorstep.doorstepScore, 10);

  // Doorstep repair with workshop-only technician gets 0 points
  const workshopOnlyOnDoorstep = computeTechnicianDispatchScore({
    isCriticalStopped: false,
    brandMatch: false,
    skillMatch: false,
    isAvailable: true,
    activeJobCount: 0,
    distanceKm: 20,
    isWithinRadius: true,
    serviceType: "DOORSTEP",
    isDoorstepCapable: false,
  });
  assert.equal(workshopOnlyOnDoorstep.doorstepScore, 0);

  // Workshop repair gives 10 points to registered workshops
  const workshopRepair = computeTechnicianDispatchScore({
    isCriticalStopped: false,
    brandMatch: false,
    skillMatch: false,
    isAvailable: true,
    activeJobCount: 0,
    distanceKm: 20,
    isWithinRadius: true,
    serviceType: "WORKSHOP",
    isDoorstepCapable: false,
  });
  assert.equal(workshopRepair.doorstepScore, 10);
});

test("Exceeding travel radius forfeits proximity score on doorstep repairs", () => {
  const outsideRadius = computeTechnicianDispatchScore({
    isCriticalStopped: true,
    brandMatch: true,
    skillMatch: true,
    isAvailable: true,
    activeJobCount: 0,
    distanceKm: 55, // 55 km > max 40 km
    isWithinRadius: false,
    serviceType: "DOORSTEP",
    isDoorstepCapable: true,
  });

  assert.equal(outsideRadius.proximityScore, 0, "Outside radius must receive 0 proximity points");
});

test("Adaptive ranking: Critical stopped machine floats closest available technician over distant brand specialist", () => {
  // Technician A: Nearby general mechanic (6 km), available, 0 jobs, mobile capable, NO brand match
  const techANearbyGeneral = computeTechnicianDispatchScore({
    isCriticalStopped: true,
    brandMatch: false,
    skillMatch: false,
    isAvailable: true,
    activeJobCount: 0,
    distanceKm: 6.0,
    isWithinRadius: true,
    serviceType: "DOORSTEP",
    isDoorstepCapable: true,
  });
  // 40 (proximity) + 25 (available) + 0 (brand) + 0 (skill) + 10 (mobile) = 75

  // Technician B: Distant brand specialist (45 km), available, 0 jobs, mobile capable, brand match
  const techBDistantSpecialist = computeTechnicianDispatchScore({
    isCriticalStopped: true,
    brandMatch: true,
    skillMatch: true,
    isAvailable: true,
    activeJobCount: 0,
    distanceKm: 45.0,
    isWithinRadius: true,
    serviceType: "DOORSTEP",
    isDoorstepCapable: true,
  });
  // 8 (proximity > 40km) + 25 (available) + 15 (brand) + 10 (skill) + 10 (mobile) = 68

  assert.ok(
    techANearbyGeneral.score > techBDistantSpecialist.score,
    `Nearby general (${techANearbyGeneral.score}) must outrank distant specialist (${techBDistantSpecialist.score}) during emergency field stoppage`,
  );
});

test("Adaptive ranking: Routine maintenance floats brand & skill specialist over nearby non-specialist", () => {
  // Technician A: Nearby general mechanic (6 km), available, 0 jobs, NO brand/skill match
  const techANearbyGeneral = computeTechnicianDispatchScore({
    isCriticalStopped: false,
    brandMatch: false,
    skillMatch: false,
    isAvailable: true,
    activeJobCount: 0,
    distanceKm: 6.0,
    isWithinRadius: true,
    serviceType: "DOORSTEP",
    isDoorstepCapable: true,
  });
  // 0 (brand) + 0 (skill) + 20 (proximity) + 15 (available) + 10 (mode) = 45

  // Technician B: Specialist (28 km), available, 0 jobs, brand AND skill match
  const techBSpecialist = computeTechnicianDispatchScore({
    isCriticalStopped: false,
    brandMatch: true,
    skillMatch: true,
    isAvailable: true,
    activeJobCount: 0,
    distanceKm: 28.0,
    isWithinRadius: true,
    serviceType: "DOORSTEP",
    isDoorstepCapable: true,
  });
  // 30 (brand) + 25 (skill) + 16 (proximity 15-30km) + 15 (available) + 10 (mode) = 96

  assert.ok(
    techBSpecialist.score > techANearbyGeneral.score,
    `Specialist (${techBSpecialist.score}) must outrank non-specialist (${techANearbyGeneral.score}) for routine repairs`,
  );
});

// ==============================================================================
// 5. DATABASE MIGRATION & RLS PRIVACY AST VERIFICATION
// ==============================================================================

test("SQL Migration 20261103100000_phase10_3_technician_dispatch.sql defines required schema", () => {
  const migPath = path.join(
    ROOT_DIR,
    "supabase",
    "migrations",
    "20261103100000_phase10_3_technician_dispatch.sql",
  );
  assert.ok(fs.existsSync(migPath), "Phase 10.3 migration file must exist");
  const sql = fs.readFileSync(migPath, "utf8");

  assert.ok(sql.includes("workshop_latitude"), "Must add workshop_latitude column");
  assert.ok(sql.includes("workshop_longitude"), "Must add workshop_longitude column");
  assert.ok(sql.includes("is_doorstep_capable"), "Must add is_doorstep_capable column");
  assert.ok(sql.includes("max_travel_radius_km"), "Must add max_travel_radius_km column");
  assert.ok(
    sql.includes("CHECK (workshop_latitude IS NULL OR"),
    "Must include latitude check constraint",
  );
  assert.ok(
    sql.includes("CHECK (workshop_longitude IS NULL OR"),
    "Must include longitude check constraint",
  );
  assert.ok(
    sql.includes("idx_technician_profiles_doorstep_dispatch"),
    "Must create doorstep dispatch index",
  );
  assert.ok(sql.includes("Green Earth"), "Must update Green Earth demo coordinates");
});

test("Security AST: repair_dispatch_locations RLS SELECT policy strictly blocks unassigned technicians", () => {
  const rlsPath = path.join(
    ROOT_DIR,
    "supabase",
    "migrations",
    "20261027100000_phase8b_1_dispatch_locations.sql",
  );
  assert.ok(fs.existsSync(rlsPath), "Dispatch locations migration must exist");
  const sql = fs.readFileSync(rlsPath, "utf8");

  // Verify that only admin, ticket farmer, or explicitly assigned technician can SELECT
  assert.ok(
    sql.includes("public.current_user_role() = 'admin'::public.user_role"),
    "Admin role must have access",
  );
  assert.ok(
    sql.includes("r.farmer_id = public.current_profile_id()"),
    "Owning farmer must have access",
  );
  assert.ok(
    sql.includes("r.technician_id = public.current_profile_id()"),
    "Only assigned technician can access",
  );
  // Verify unassigned technicians are NOT permitted
  assert.ok(
    !sql.includes("public.current_user_role() = 'technician'::public.user_role"),
    "Unassigned technicians must never have unconditional SELECT on repair_dispatch_locations",
  );
});

test("assignTechnician state machine guards require explicit human authorization", () => {
  const techServicePath = path.join(ROOT_DIR, "src", "lib", "services", "technicians.ts");
  const code = fs.readFileSync(techServicePath, "utf8");

  assert.ok(code.includes("assignTechnician"), "assignTechnician function must exist");
  assert.ok(
    code.includes("const isOwner = repair.farmer_id === profile.id;"),
    "Must verify ticket ownership",
  );
  assert.ok(
    code.includes('const isAdmin = profile.role === "admin";'),
    "Must verify admin authorization",
  );
  assert.ok(code.includes("if (!isOwner && !isAdmin)"), "Must block unauthorized callers");
  assert.ok(
    code.includes("if (!techRecord.is_verified)"),
    "Must block unverified technicians from assignment",
  );
});
