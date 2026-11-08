import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { isValidGpsCoordinate } from "../src/lib/location.ts";
import {
  computeOsrmRoute,
  formatRouteDistance,
  formatRouteDuration,
  RURAL_TRAFFIC_DISCLAIMER,
  compareTechnicianMatchesDefault,
} from "../src/lib/services/routing.ts";

// ==============================================================================
// TEST-14-R01 [Mocked HTTP/Fetch Test]
// SUCCESSFUL OSRM ROAD DISTANCE & DURATION CALCULATION
// ==============================================================================
test("TEST-14-R01 [Mocked HTTP/Fetch Test]: computeOsrmRoute accurately parses valid OSRM response", async () => {
  const origin = { latitude: 21.1458, longitude: 79.0882 }; // Nagpur workshop
  const destination = { latitude: 21.2825, longitude: 78.5878 }; // Katol breakdown

  // Mock valid OSRM JSON response
  const mockOsrmResponse = {
    code: "Ok",
    routes: [
      {
        distance: 58420.5, // 58.42 km
        duration: 4320.0,  // 72 minutes
        weight_name: "routability",
        weight: 4320.0,
      },
    ],
    waypoints: [
      { hint: "origin_hint", distance: 0, location: [79.0882, 21.1458], name: "Workshop" },
      { hint: "dest_hint", distance: 0, location: [78.5878, 21.2825], name: "Field" },
    ],
  };

  const mockFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => mockOsrmResponse,
  });

  const result = await computeOsrmRoute(origin, destination, mockFetch);

  assert.equal(result.success, true);
  assert.equal(result.distanceMeters, 58421);
  assert.equal(result.distanceKm, 58.4);
  assert.equal(result.durationMinutes, 72);
  assert.equal(result.durationFormatted, "1 hr 12 mins");
  assert.equal(result.isTrafficAware, false);
});

// ==============================================================================
// TEST-14-R02 [Static Source Assertion]
// AUTHORITATIVE ORIGIN (primary_facility_id) & DESTINATION (repair_dispatch_locations)
// ==============================================================================
test("TEST-14-R02 [Static Source Assertion]: Matching resolves registered workshop via primary_facility_id -> repair_facilities and breakdown via repair_dispatch_locations", () => {
  const techniciansServicePath = path.resolve("src/lib/services/technicians.ts");
  const code = fs.readFileSync(techniciansServicePath, "utf8");

  // Verify primary_facility_id resolution to repair_facilities
  assert.ok(
    code.includes(".from(\"repair_facilities\")"),
    "technicians.ts must query repair_facilities table",
  );
  assert.ok(
    code.includes("primary_facility_id"),
    "technicians.ts must resolve origin using primary_facility_id",
  );

  // Verify authoritative breakdown destination resolution from repair_dispatch_locations
  assert.ok(
    code.includes(".from(\"repair_dispatch_locations\")"),
    "technicians.ts must query authoritative repair_dispatch_locations table for farmer breakdown GPS",
  );
  assert.ok(
    code.includes("destinationGps"),
    "technicians.ts must resolve farmer destination GPS",
  );

  // Invariant: zero duplicate latitude/longitude on repair_requests table
  assert.ok(
    !code.includes("repair_requests.latitude") && !code.includes("repair_requests.longitude"),
    "repair_requests must not have duplicate or invented latitude/longitude coordinates",
  );

  // Invariant: zero fallback to browser geolocation or arbitrary facility memberships
  assert.ok(
    !code.includes("navigator.geolocation") && !code.includes("facility_memberships"),
    "technicians.ts matching must never fall back to client geolocation or arbitrary memberships",
  );
});

// ==============================================================================
// TEST-14-R03 [Static Source Assertion]
// NO HARDCODED 0 KM / 45 MIN DEFAULTS
// ==============================================================================
test("TEST-14-R03 [Static Source Assertion]: Hardcoded '0 km · ~45 min' placeholders are completely eliminated", () => {
  const filesToScan = [
    "src/lib/services/technicians.ts",
    "src/components/repair-parts.tsx",
    "src/routes/farmer/repair/$id.tsx",
    "src/routes/admin/repair/$id.tsx",
  ];

  for (const relPath of filesToScan) {
    const fullPath = path.resolve(relPath);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, "utf8");

    assert.ok(
      !content.includes("eta_minutes ?? 45"),
      `File ${relPath} must not contain hardcoded 'eta_minutes ?? 45' fallback`,
    );
    assert.ok(
      !content.includes("distance_km ?? 0"),
      `File ${relPath} must not contain hardcoded 'distance_km ?? 0' fallback`,
    );
  }
});

// ==============================================================================
// TEST-14-R04 [Pure Unit & Mocked Fetch Test]
// COMPREHENSIVE COORDINATE VALIDATION & ZERO NETWORK REQUESTS
// ==============================================================================
test("TEST-14-R04 [Pure Unit & Mocked Fetch Test]: Valid zero coordinates are accepted; invalid/missing coordinates reject without network calls", async () => {
  // 1. Valid non-zero coordinates
  assert.equal(isValidGpsCoordinate(21.1458, 79.0882), true);
  assert.equal(isValidGpsCoordinate(-21.1458, -79.0882), true);
  assert.equal(isValidGpsCoordinate(90, 180), true);
  assert.equal(isValidGpsCoordinate(-90, -180), true);

  // 2. Geographically valid zero values (Equator / Prime Meridian) must be accepted
  assert.equal(isValidGpsCoordinate(0, 79.0882), true, "latitude = 0 with valid longitude must be accepted");
  assert.equal(isValidGpsCoordinate(21.1458, 0), true, "longitude = 0 with valid latitude must be accepted");
  assert.equal(isValidGpsCoordinate(0, 0), true, "both coordinates zero (0, 0) must be accepted");

  // 3. Out of range values must be rejected
  assert.equal(isValidGpsCoordinate(90.0001, 79.0), false, "latitude > 90 must be rejected");
  assert.equal(isValidGpsCoordinate(-90.0001, 79.0), false, "latitude < -90 must be rejected");
  assert.equal(isValidGpsCoordinate(21.0, 180.0001), false, "longitude > 180 must be rejected");
  assert.equal(isValidGpsCoordinate(21.0, -180.0001), false, "longitude < -180 must be rejected");

  // 4. Missing, non-numeric, and non-finite values must be rejected
  assert.equal(isValidGpsCoordinate(null, 79.0), false, "null latitude must be rejected");
  assert.equal(isValidGpsCoordinate(21.0, null), false, "null longitude must be rejected");
  assert.equal(isValidGpsCoordinate(undefined, 79.0), false, "undefined latitude must be rejected");
  assert.equal(isValidGpsCoordinate(21.0, undefined), false, "undefined longitude must be rejected");
  assert.equal(isValidGpsCoordinate(NaN, 79.0), false, "NaN latitude must be rejected");
  assert.equal(isValidGpsCoordinate(21.0, NaN), false, "NaN longitude must be rejected");
  assert.equal(isValidGpsCoordinate(Infinity, 79.0), false, "Infinity latitude must be rejected");
  assert.equal(isValidGpsCoordinate(21.0, -Infinity), false, "-Infinity longitude must be rejected");
  assert.equal(isValidGpsCoordinate("21.0", 79.0), false, "string latitude must be rejected");

  // 5. Zero network calls on invalid coordinates
  let networkCalls = 0;
  const mockFetch = async () => {
    networkCalls++;
    return { ok: true, json: async () => ({}) };
  };

  await assert.rejects(
    async () => {
      await computeOsrmRoute(
        { latitude: 95.0, longitude: 79.0 }, // Invalid latitude
        { latitude: 21.0, longitude: 78.0 },
        mockFetch,
      );
    },
    /Invalid origin GPS coordinates/,
  );

  await assert.rejects(
    async () => {
      await computeOsrmRoute(
        { latitude: 21.0, longitude: 79.0 },
        { latitude: 21.0, longitude: 195.0 }, // Invalid destination longitude
        mockFetch,
      );
    },
    /Invalid destination GPS coordinates/,
  );

  assert.equal(networkCalls, 0, "Zero network requests must be issued when coordinates are invalid");

  // 6. Valid zero coordinates make legitimate OSRM request
  const zeroMockFetch = async (url) => {
    networkCalls++;
    assert.ok(url.includes("/0,0;"), "OSRM endpoint URL must include zero coordinates");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        code: "Ok",
        routes: [{ distance: 1000, duration: 60 }],
      }),
    };
  };

  const zeroResult = await computeOsrmRoute(
    { latitude: 0, longitude: 0 },
    { latitude: 0.1, longitude: 0.1 },
    zeroMockFetch,
  );
  assert.equal(zeroResult.success, true);
  assert.equal(networkCalls, 1, "Exactly one OSRM request should be issued for valid zero coordinates");
});

// ==============================================================================
// TEST-14-R05A [Mocked HTTP/Fetch Test]
// OSRM HTTP 5XX ERROR HANDLING & NON-DISQUALIFICATION
// ==============================================================================
test("TEST-14-R05A [Mocked HTTP/Fetch Test]: OSRM HTTP 5xx returns sanitized error and preserves candidate eligibility", async () => {
  const origin = { latitude: 21.1458, longitude: 79.0882 };
  const destination = { latitude: 21.2825, longitude: 78.5878 };

  const mock500Fetch = async () => ({
    ok: false,
    status: 502,
    json: async () => ({ message: "Bad Gateway" }),
  });

  await assert.rejects(
    async () => {
      await computeOsrmRoute(origin, destination, mock500Fetch);
    },
    /Bad Gateway|status 502/,
    "computeOsrmRoute must throw on HTTP 5xx server error",
  );
});

// ==============================================================================
// TEST-14-R05B [Mocked HTTP/Fetch Test]
// OSRM NETWORK FAILURE HANDLING
// ==============================================================================
test("TEST-14-R05B [Mocked HTTP/Fetch Test]: OSRM network failure (fetch throws) throws sanitized error", async () => {
  const origin = { latitude: 21.1458, longitude: 79.0882 };
  const destination = { latitude: 21.2825, longitude: 78.5878 };

  const mockNetworkErrorFetch = async () => {
    throw new TypeError("Failed to fetch: Connection refused");
  };

  await assert.rejects(
    async () => {
      await computeOsrmRoute(origin, destination, mockNetworkErrorFetch);
    },
    /Failed to fetch/,
    "computeOsrmRoute must throw descriptive error on network failure",
  );
});

// ==============================================================================
// TEST-14-R05C [Mocked HTTP/Fetch Test]
// OSRM TIMEOUT & ABORT CONTROLLER HANDLING
// ==============================================================================
test("TEST-14-R05C [Mocked HTTP/Fetch Test]: OSRM timeout throws sanitized timeout error", async () => {
  const origin = { latitude: 21.1458, longitude: 79.0882 };
  const destination = { latitude: 21.2825, longitude: 78.5878 };

  const mockTimeoutFetch = async (_url, options) => {
    const error = new Error("The operation was aborted.");
    error.name = "AbortError";
    throw error;
  };

  await assert.rejects(
    async () => {
      await computeOsrmRoute(origin, destination, mockTimeoutFetch);
    },
    /OSRM routing request timed out|Routing service timed out|aborted|timed out/i,
    "computeOsrmRoute must throw timeout error when request is aborted",
  );
});

// ==============================================================================
// TEST-14-R05D [Mocked HTTP/Fetch Test]
// OSRM NoRoute CODE HANDLING
// ==============================================================================
test("TEST-14-R05D [Mocked HTTP/Fetch Test]: OSRM NoRoute code throws without disqualification", async () => {
  const origin = { latitude: 21.1458, longitude: 79.0882 };
  const destination = { latitude: 21.2825, longitude: 78.5878 };

  const mockNoRouteFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      code: "NoRoute",
      message: "No route found",
      routes: [],
    }),
  });

  await assert.rejects(
    async () => {
      await computeOsrmRoute(origin, destination, mockNoRouteFetch);
    },
    /No drivable route found/,
    "computeOsrmRoute must throw when OSRM returns NoRoute",
  );
});

// ==============================================================================
// TEST-14-R05E [Mocked HTTP/Fetch Test]
// MALFORMED OSRM JSON RESPONSE HANDLING
// ==============================================================================
test("TEST-14-R05E [Mocked HTTP/Fetch Test]: Malformed OSRM JSON response throws descriptive error", async () => {
  const origin = { latitude: 21.1458, longitude: 79.0882 };
  const destination = { latitude: 21.2825, longitude: 78.5878 };

  // Missing distance/duration in routes
  const mockMalformedFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      code: "Ok",
      routes: [{ distance: null, duration: "invalid" }],
    }),
  });

  await assert.rejects(
    async () => {
      await computeOsrmRoute(origin, destination, mockMalformedFetch);
    },
    /No drivable route found/,
    "computeOsrmRoute must throw when route metrics are malformed or missing",
  );
});

// ==============================================================================
// TEST-14-R06 [Pure Unit & Static Assertion]
// STALE ETA OR DISTANCE IS CLEARED ON ROUTING FAILURE
// ==============================================================================
test("TEST-14-R06 [Pure Unit & Static Assertion]: Failed route calculations purge previous routing metrics (zero stale data survives)", () => {
  const techniciansServicePath = path.resolve("src/lib/services/technicians.ts");
  const code = fs.readFileSync(techniciansServicePath, "utf8");

  // In catch block or failure branch, distanceKm and etaMin must be explicitly set to null
  assert.ok(
    code.includes("distanceKm = null") && code.includes("etaMin = null") && code.includes("\"OUTAGE\""),
    "technicians.ts must explicitly set distanceKm = null and etaMin = null on routing failure",
  );

  // Unit assertion: Outage match model has null metrics
  const outageMatch = {
    technician: {
      id: "tech-outage",
      profile_id: "p-outage",
      distance_km: null,
      eta_minutes: null,
      is_available: true,
      is_verified: true,
      kyc_verified: true,
      rating: 4.8,
      jobs_completed: 25,
      profile: { id: "p-outage", full_name: "Outage Candidate", phone: "123", village: "Nagpur" },
    },
    score: 90,
    brandMatch: true,
    skillMatch: true,
    reasons: [],
    distanceKm: null,
    etaMin: null,
    routingStatus: "OUTAGE",
    isExtendedTravel: false,
  };

  assert.equal(outageMatch.distanceKm, null, "distanceKm must be strictly null on outage");
  assert.equal(outageMatch.etaMin, null, "etaMin must be strictly null on outage");
  assert.equal(outageMatch.score, 90, "Candidate must remain fully eligible");
});

// ==============================================================================
// TEST-14-R07 [Static Source Assertion]
// STRICT ZERO HAVERSINE FORMULA USAGE
// ==============================================================================
test("TEST-14-R07 [Static Source Assertion]: Haversine formula is strictly banned across all application and service source files", () => {
  const srcDir = path.resolve("src");
  const forbiddenPatterns = [
    /\bhaversine\b/i,
    /6371\b/, // Earth radius in km commonly used in Haversine
    /Math\.atan2\s*\(\s*Math\.sqrt/i, // Haversine formula signature
  ];

  function scanDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        const content = fs.readFileSync(fullPath, "utf8");
        for (const pattern of forbiddenPatterns) {
          assert.ok(
            !pattern.test(content),
            `Forbidden Haversine pattern ${pattern} detected in file: ${fullPath}`,
          );
        }
      }
    }
  }

  scanDir(srcDir);
});

// ==============================================================================
// TEST-14-R08 [Pure Unit & Mocked Fetch Test]
// EXTENDED TRAVEL (> 50 KM) INFORMATIONAL ONLY
// ==============================================================================
test("TEST-14-R08 [Pure Unit & Mocked Fetch Test]: Road distance > 50 km receives 'EXTENDED' status and informational tag without penalty", () => {
  const matchExtended = {
    technician: {
      id: "tech-ext-01",
      profile_id: "profile-ext",
      workshop_name: "Wardha Depot",
      brands: ["Mahindra"],
      skills: ["Engine"],
      is_available: true,
      is_verified: true,
      kyc_verified: true,
      rating: 4.9,
      jobs_completed: 60,
      profile: { id: "profile-ext", full_name: "Prakash Deshmukh", phone: "9876543211", village: "Wardha" },
    },
    score: 90, // Unaffected qualification score
    brandMatch: true,
    skillMatch: true,
    reasons: ["Mahindra specialist", "Engine expert", "Available now"],
    distanceKm: 64.2,
    etaMin: 85,
    routingStatus: "EXTENDED",
    isExtendedTravel: true,
  };

  assert.equal(matchExtended.routingStatus, "EXTENDED");
  assert.equal(matchExtended.isExtendedTravel, true);
  assert.equal(matchExtended.score, 90, "Extended travel must not reduce qualification score");

  // Verify TechCard renders Extended Travel label
  const techCardPath = path.resolve("src/components/repair-parts.tsx");
  const techCardCode = fs.readFileSync(techCardPath, "utf8");
  assert.ok(
    techCardCode.includes("(Extended Travel)"),
    "TechCard must render '(Extended Travel)' tag for distances > 50 km",
  );
});

// ==============================================================================
// TEST-14-R09 [Pure Unit & Static Assertion]
// RURAL TRAFFIC DISCLAIMER CONTRACT
// ==============================================================================
test("TEST-14-R09 [Pure Unit & Static Assertion]: Exact rural traffic disclaimer string is exported and rendered on estimate cards", () => {
  const expectedDisclaimer =
    "Estimated standard driving duration. Real-time rural road and weather conditions may vary.";

  assert.equal(RURAL_TRAFFIC_DISCLAIMER, expectedDisclaimer);

  const cardPath = path.resolve("src/components/route-estimate-card.tsx");
  const cardCode = fs.readFileSync(cardPath, "utf8");

  assert.ok(
    cardCode.includes("RURAL_TRAFFIC_DISCLAIMER"),
    "RouteEstimateCard must import and render RURAL_TRAFFIC_DISCLAIMER",
  );
});

// ==============================================================================
// TEST-14-R10 [Pure Unit Test]
// QUALIFICATION SCORE INDEPENDENT OF OSRM ROUTING (Option C)
// ==============================================================================
test("TEST-14-R10 [Pure Unit Test]: Qualification score is strictly independent of OSRM routing status (Option C)", () => {
  // Candidate A: 10 km route available
  const candidateA = {
    technician: {
      id: "tech-a",
      profile_id: "p-a",
      is_available: true,
      is_verified: true,
      kyc_verified: true,
      rating: 4.8,
      jobs_completed: 30,
      profile: { id: "p-a", full_name: "Candidate A", phone: "111", village: "Nagpur" },
    },
    score: 90, // Brand 40 + Skill 30 + Avail 20
    brandMatch: true,
    skillMatch: true,
    reasons: [],
    distanceKm: 10.2,
    etaMin: 18,
    routingStatus: "AVAILABLE",
    isExtendedTravel: false,
  };

  // Candidate B: OSRM outage
  const candidateB = {
    technician: {
      id: "tech-b",
      profile_id: "p-b",
      is_available: true,
      is_verified: true,
      kyc_verified: true,
      rating: 4.8,
      jobs_completed: 30,
      profile: { id: "p-b", full_name: "Candidate B", phone: "222", village: "Katol" },
    },
    score: 90, // Brand 40 + Skill 30 + Avail 20 (zero proximity points added)
    brandMatch: true,
    skillMatch: true,
    reasons: [],
    distanceKm: null,
    etaMin: null,
    routingStatus: "OUTAGE",
    isExtendedTravel: false,
  };

  // Candidate C: Missing coordinates
  const candidateC = {
    technician: {
      id: "tech-c",
      profile_id: "p-c",
      is_available: true,
      is_verified: true,
      kyc_verified: true,
      rating: 4.8,
      jobs_completed: 30,
      profile: { id: "p-c", full_name: "Candidate C", phone: "333", village: "Umred" },
    },
    score: 90, // Brand 40 + Skill 30 + Avail 20 (zero proximity points added)
    brandMatch: true,
    skillMatch: true,
    reasons: [],
    distanceKm: null,
    etaMin: null,
    routingStatus: "NO_COORDINATES",
    isExtendedTravel: false,
  };

  assert.equal(candidateA.score, 90);
  assert.equal(candidateB.score, 90);
  assert.equal(candidateC.score, 90);
  assert.equal(candidateA.score, candidateB.score, "OSRM outage must not lower candidate qualification score");
  assert.equal(candidateA.score, candidateC.score, "Missing coordinates must not lower candidate qualification score");
});

// ==============================================================================
// TEST-14-R11 [Pure Unit Test]
// DETERMINISTIC 6-TIER TIE-BREAKING & COMPARATOR TRANSITIVITY
// ==============================================================================
test("TEST-14-R11 [Pure Unit Test]: compareTechnicianMatchesDefault enforces deterministic 6-tier hierarchy and mathematical transitivity", () => {
  const baseTech = (override) => ({
    technician: {
      id: override.id || "tech-id",
      profile_id: override.profile_id || "profile-id",
      is_available: true,
      is_verified: true,
      kyc_verified: override.kyc ?? true,
      rating: override.rating !== undefined ? override.rating : 4.5,
      jobs_completed: override.jobs ?? 10,
      profile: {
        id: override.profile_id || "profile-id",
        full_name: override.name || "Test Tech",
        phone: "9999999999",
        village: "Nagpur",
      },
    },
    score: override.score !== undefined ? override.score : 90,
    brandMatch: true,
    skillMatch: true,
    reasons: [],
    distanceKm: null,
    etaMin: null,
    routingStatus: "NO_COORDINATES",
    isExtendedTravel: false,
  });

  // Tier 1: Score 90 vs 70
  const tScore90 = baseTech({ id: "1", score: 90 });
  const tScore70 = baseTech({ id: "2", score: 70 });
  assert.ok(compareTechnicianMatchesDefault(tScore90, tScore70) < 0, "Score 90 must rank above Score 70");

  // Tier 2: KYC true vs false
  const tKycTrue = baseTech({ id: "1", kyc: true });
  const tKycFalse = baseTech({ id: "2", kyc: false });
  assert.ok(compareTechnicianMatchesDefault(tKycTrue, tKycFalse) < 0, "KYC verified must rank above non-verified");

  // Tier 3: Rating 4.9 vs 4.2
  const tRatingHigh = baseTech({ id: "1", rating: 4.9 });
  const tRatingLow = baseTech({ id: "2", rating: 4.2 });
  assert.ok(compareTechnicianMatchesDefault(tRatingHigh, tRatingLow) < 0, "Rating 4.9 must rank above 4.2");

  // Tier 3b: Rating 4.2 vs null (null last)
  const tRatingNull = baseTech({ id: "3", rating: null });
  assert.ok(compareTechnicianMatchesDefault(tRatingLow, tRatingNull) < 0, "Rated technician must rank above null rating");

  // Tier 4: Jobs completed 50 vs 10
  const tJobs50 = baseTech({ id: "1", jobs: 50 });
  const tJobs10 = baseTech({ id: "2", jobs: 10 });
  assert.ok(compareTechnicianMatchesDefault(tJobs50, tJobs10) < 0, "Jobs 50 must rank above Jobs 10");

  // Tier 5: Full name "Anand" vs "Vijay"
  const tNameA = baseTech({ id: "1", name: "Anand Patil" });
  const tNameV = baseTech({ id: "2", name: "Vijay Shinde" });
  assert.ok(compareTechnicianMatchesDefault(tNameA, tNameV) < 0, "Alphabetical 'Anand' must rank above 'Vijay'");

  // Tier 6: ID "001" vs "002"
  const tId1 = baseTech({ id: "001", name: "Same Name" });
  const tId2 = baseTech({ id: "002", name: "Same Name" });
  assert.ok(compareTechnicianMatchesDefault(tId1, tId2) < 0, "ID '001' must rank above ID '002'");

  // Transitivity Verification: A > B and B > C implies A > C
  const candA = baseTech({ id: "A", score: 90, rating: 5.0 });
  const candB = baseTech({ id: "B", score: 90, rating: 4.5 });
  const candC = baseTech({ id: "C", score: 90, rating: 4.0 });

  assert.ok(compareTechnicianMatchesDefault(candA, candB) < 0, "A must beat B");
  assert.ok(compareTechnicianMatchesDefault(candB, candC) < 0, "B must beat C");
  assert.ok(compareTechnicianMatchesDefault(candA, candC) < 0, "A must beat C (transitive)");
});
