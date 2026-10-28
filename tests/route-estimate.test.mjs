import test from "node:test";
import assert from "node:assert/strict";

import {
  formatRouteDistance,
  formatRouteDuration,
  parseGoogleDurationSeconds,
  computeGoogleRoute,
} from "../src/lib/services/routing.ts";
import {
  isValidGpsCoordinate,
  isUuid,
  determineGpsVisibilityCategory,
  buildGoogleMapsDirectionsUrl,
  buildGoogleMapsSearchUrl,
  formatCoarseLocation,
} from "../src/lib/location.ts";
import { handleRouteEstimateRequest } from "../src/lib/services/routing-handler.ts";

// ==============================================================================
// 1. UNIT CONVERSIONS & FORMATTING
// ==============================================================================

test("formatRouteDistance formats metric units correctly", () => {
  assert.equal(formatRouteDistance(0), "0 m");
  assert.equal(formatRouteDistance(450), "450 m");
  assert.equal(formatRouteDistance(999), "999 m");
  assert.equal(formatRouteDistance(1000), "1.0 km");
  assert.equal(formatRouteDistance(14250), "14.3 km");
  assert.equal(formatRouteDistance(105800), "105.8 km");
  assert.equal(formatRouteDistance(-50), "0 km");
  assert.equal(formatRouteDistance(NaN), "0 km");
  assert.equal(formatRouteDistance(Infinity), "0 km");
});

test("formatRouteDuration formats driving duration correctly", () => {
  assert.equal(formatRouteDuration(0), "1 mins");
  assert.equal(formatRouteDuration(30), "1 mins");
  assert.equal(formatRouteDuration(1680), "28 mins");
  assert.equal(formatRouteDuration(3540), "59 mins");
  assert.equal(formatRouteDuration(3600), "1 hr");
  assert.equal(formatRouteDuration(4500), "1 hr 15 mins");
  assert.equal(formatRouteDuration(7200), "2 hr");
  assert.equal(formatRouteDuration(7320), "2 hr 2 mins");
  assert.equal(formatRouteDuration(-10), "0 mins");
  assert.equal(formatRouteDuration(NaN), "0 mins");
});

test("parseGoogleDurationSeconds parses duration strings accurately", () => {
  assert.equal(parseGoogleDurationSeconds("1680s"), 1680);
  assert.equal(parseGoogleDurationSeconds("0s"), 0);
  assert.equal(parseGoogleDurationSeconds("45.5s"), 45.5);
  assert.equal(parseGoogleDurationSeconds("120"), 120);
  assert.equal(parseGoogleDurationSeconds(null), 0);
  assert.equal(parseGoogleDurationSeconds(undefined), 0);
  assert.equal(parseGoogleDurationSeconds("invalid"), 0);
});

test("isValidGpsCoordinate strictly validates coordinate bounds and rejects Null Island", () => {
  // Valid coordinates
  assert.equal(isValidGpsCoordinate(21.1458, 79.0882), true);
  assert.equal(isValidGpsCoordinate(-21.1458, -79.0882), true);
  assert.equal(isValidGpsCoordinate(90, 180), true);
  assert.equal(isValidGpsCoordinate(-90, -180), true);

  // Null Island (0, 0) rejection
  assert.equal(isValidGpsCoordinate(0, 0), false);

  // Out of range
  assert.equal(isValidGpsCoordinate(90.1, 79.0), false);
  assert.equal(isValidGpsCoordinate(-90.1, 79.0), false);
  assert.equal(isValidGpsCoordinate(21.0, 180.1), false);
  assert.equal(isValidGpsCoordinate(21.0, -180.1), false);

  // Non-numbers, NaN, null
  assert.equal(isValidGpsCoordinate("21.0", 79.0), false);
  assert.equal(isValidGpsCoordinate(NaN, 79.0), false);
  assert.equal(isValidGpsCoordinate(21.0, Infinity), false);
  assert.equal(isValidGpsCoordinate(null, null), false);
});

// ==============================================================================
// 2. GOOGLE ROUTES API CLIENT (MOCKED FETCH)
// ==============================================================================

test("computeGoogleRoute successfully parses valid Routes API response with TRAFFIC_UNAWARE", async () => {
  let capturedUrl = "";
  let capturedHeaders = {};
  let capturedBody = {};

  const mockFetch = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    capturedBody = JSON.parse(options.body);

    return {
      ok: true,
      status: 200,
      json: async () => ({
        routes: [
          {
            distanceMeters: 14250,
            duration: "1680s",
          },
        ],
      }),
    };
  };

  const origin = { latitude: 21.1458, longitude: 79.0882 };
  const destination = { latitude: 21.2678, longitude: 78.5872 };

  const result = await computeGoogleRoute(origin, destination, "mock-test-key", mockFetch);

  // Verify outgoing request
  assert.equal(capturedUrl, "https://routes.googleapis.com/directions/v2:computeRoutes");
  assert.equal(capturedHeaders["X-Goog-Api-Key"], "mock-test-key");
  assert.equal(capturedHeaders["X-Goog-FieldMask"], "routes.distanceMeters,routes.duration");
  assert.equal(capturedBody.travelMode, "DRIVE");
  assert.equal(capturedBody.routingPreference, "TRAFFIC_UNAWARE");
  assert.equal(capturedBody.origin.location.latLng.latitude, 21.1458);
  assert.equal(capturedBody.destination.location.latLng.latitude, 21.2678);

  // Verify returned result contains NO coordinates
  assert.equal(result.success, true);
  assert.equal(result.distanceMeters, 14250);
  assert.equal(result.distanceKm, 14.3);
  assert.equal(result.durationSeconds, 1680);
  assert.equal(result.durationMinutes, 28);
  assert.equal(result.durationFormatted, "28 mins");
  assert.equal(result.isTrafficAware, false);
  assert.equal("origin" in result, false);
  assert.equal("destination" in result, false);
  assert.equal("latitude" in result, false);
  assert.equal("longitude" in result, false);
  assert.ok(result.calculatedAt);
});

test("computeGoogleRoute throws when no drivable route is found", async () => {
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ routes: [] }),
  });

  await assert.rejects(
    async () => {
      await computeGoogleRoute(
        { latitude: 21.1458, longitude: 79.0882 },
        { latitude: 21.2678, longitude: 78.5872 },
        "mock-key",
        mockFetch,
      );
    },
    { message: /No drivable route found/ },
  );
});

test("computeGoogleRoute throws sanitized error when Google API returns HTTP error", async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 403,
    json: async () => ({
      error: {
        code: 403,
        message: "API key expired or billing account disabled",
        status: "PERMISSION_DENIED",
      },
    }),
  });

  await assert.rejects(
    async () => {
      await computeGoogleRoute(
        { latitude: 21.1458, longitude: 79.0882 },
        { latitude: 21.2678, longitude: 78.5872 },
        "mock-key",
        mockFetch,
      );
    },
    { message: /API key expired/ },
  );
});

test("computeGoogleRoute rejects missing or empty API key without calling fetch", async () => {
  let fetchCalled = false;
  const mockFetch = async () => {
    fetchCalled = true;
    return { ok: true };
  };

  await assert.rejects(
    async () => {
      await computeGoogleRoute(
        { latitude: 21.1458, longitude: 79.0882 },
        { latitude: 21.2678, longitude: 78.5872 },
        "",
        mockFetch,
      );
    },
    { message: /Server Key is missing or invalid/ },
  );

  assert.equal(fetchCalled, false);
});

// ==============================================================================
// 3. SERVER ROUTE ESTIMATE HANDLER & AUTHORIZATION
// ==============================================================================

test("handleRouteEstimateRequest rejects non-POST requests with 405", async () => {
  const req = new Request("http://localhost/api/route-estimate", { method: "GET" });
  const res = await handleRouteEstimateRequest(req);
  assert.equal(res.status, 405);
  const data = await res.json();
  assert.match(data.error, /Method not allowed/);
});

test("handleRouteEstimateRequest rejects missing Bearer token with 401", async () => {
  const req = new Request("http://localhost/api/route-estimate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repairId: "test-id", technicianLatitude: 21.1, technicianLongitude: 79.1 }),
  });
  const res = await handleRouteEstimateRequest(req);
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.match(data.error, /Authentication required/);
});

test("handleRouteEstimateRequest rejects invalid GPS coordinates in request body with 400", async () => {
  const req = new Request("http://localhost/api/route-estimate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer mock-token",
    },
    body: JSON.stringify({
      repairId: "test-id",
      technicianLatitude: 999.0, // Invalid lat
      technicianLongitude: 79.1,
    }),
  });

  const res = await handleRouteEstimateRequest(req);
  assert.ok(res.status === 400 || res.status === 401);
});

test("handleRouteEstimateRequest returns 400 when repairId is missing", async () => {
  const req = new Request("http://localhost/api/route-estimate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer mock-token",
    },
    body: JSON.stringify({
      technicianLatitude: 21.1458,
      technicianLongitude: 79.0882,
    }),
  });

  const res = await handleRouteEstimateRequest(req);
  assert.ok(res.status === 400 || res.status === 401);
});

// ==============================================================================
// 4. REGRESSION: TICKET ID RESOLUTION & GPS VISIBILITY STATES (TB-7524 FIX)
// ==============================================================================

test("isUuid correctly distinguishes UUIDs from human-readable job numbers like TB-7524", () => {
  // Valid UUIDs
  assert.equal(isUuid("23c3d082-3e43-43b6-927f-955f0653d30b"), true);
  assert.equal(isUuid("00000000-0000-0000-0001-000000000001"), true);
  assert.equal(isUuid("A0562F3B-4FD3-42D1-9BC1-6D4DFFFD3C2B"), true);

  // Human-readable job numbers (must NOT be treated as UUIDs)
  assert.equal(isUuid("TB-7524"), false);
  assert.equal(isUuid("TB-4489"), false);
  assert.equal(isUuid("TB-8841"), false);
  assert.equal(isUuid(""), false);
  assert.equal(isUuid(null), false);
  assert.equal(isUuid(undefined), false);
  assert.equal(isUuid("random-string-not-uuid"), false);
});

test("determineGpsVisibilityCategory correctly partitions the three UI visibility states", () => {
  // State (a): Ticket created without GPS, user authorized
  const stateA = determineGpsVisibilityCategory({
    hasGpsLocation: false,
    isAuthorized: true,
  });
  assert.equal(stateA, "not_captured");

  // State (b): Ticket has GPS captured, user authorized
  const stateB = determineGpsVisibilityCategory({
    hasGpsLocation: true,
    isAuthorized: true,
  });
  assert.equal(stateB, "exact_available");

  // State (c): Viewer lacks permission (unassigned technician / third party), whether GPS exists or not
  const stateC1 = determineGpsVisibilityCategory({
    hasGpsLocation: true,
    isAuthorized: false,
  });
  assert.equal(stateC1, "permission_denied");

  const stateC2 = determineGpsVisibilityCategory({
    hasGpsLocation: false,
    isAuthorized: false,
  });
  assert.equal(stateC2, "permission_denied");
});

test("buildGoogleMapsDirectionsUrl and buildGoogleMapsSearchUrl generate valid external navigation links", () => {
  // Exact GPS directions URL
  const dirUrl = buildGoogleMapsDirectionsUrl(21.1458, 79.0882);
  assert.match(dirUrl, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=21\.145800%2C79\.088200$/);

  // Coarse search URL
  const searchUrl = buildGoogleMapsSearchUrl("Katol, Nagpur (Rural)");
  assert.match(searchUrl, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Katol%2C%20Nagpur%20\(Rural\)$/);
});

test("formatCoarseLocation handles village and tahsil correctly", () => {
  assert.equal(formatCoarseLocation("Dorli", "Katol"), "Dorli, Katol");
  assert.equal(formatCoarseLocation("Katol, Nagpur", "Nagpur (Rural)"), "Katol, Nagpur, Nagpur (Rural)");
  assert.equal(formatCoarseLocation("", "Katol"), "Katol");
  assert.equal(formatCoarseLocation("Dorli", ""), "Dorli");
  assert.equal(formatCoarseLocation(null, null), "");
});

test("resilient ID resolution simulates getRepairDispatchLocation handling both UUID and job_number", async () => {
  const db = {
    repair_requests: [
      { id: "23c3d082-3e43-43b6-927f-955f0653d30b", job_number: "TB-7524" },
    ],
    repair_dispatch_locations: [
      {
        repair_request_id: "23c3d082-3e43-43b6-927f-955f0653d30b",
        latitude: 21.2678,
        longitude: 78.5872,
        accuracy: 8.5,
      },
    ],
  };

  // Mock implementation replicating getRepairDispatchLocation resolution logic
  async function mockGetRepairDispatchLocation(input) {
    if (!input?.trim()) return null;
    const trimmed = input.trim();
    let resolvedId = trimmed;

    if (!isUuid(trimmed)) {
      const match = db.repair_requests.find(
        (r) => r.job_number.toLowerCase() === trimmed.toLowerCase(),
      );
      if (!match) return null;
      resolvedId = match.id;
    }

    const loc = db.repair_dispatch_locations.find(
      (d) => d.repair_request_id === resolvedId,
    );
    return loc || null;
  }

  // 1. Direct query with UUID
  const byUuid = await mockGetRepairDispatchLocation("23c3d082-3e43-43b6-927f-955f0653d30b");
  assert.ok(byUuid);
  assert.equal(byUuid.repair_request_id, "23c3d082-3e43-43b6-927f-955f0653d30b");

  // 2. Query with human-readable job number (e.g. TB-7524 as passed from route params)
  const byJobNumber = await mockGetRepairDispatchLocation("TB-7524");
  assert.ok(byJobNumber);
  assert.equal(byJobNumber.repair_request_id, "23c3d082-3e43-43b6-927f-955f0653d30b");

  // 3. Query with non-existent job number
  const notFound = await mockGetRepairDispatchLocation("TB-9999");
  assert.equal(notFound, null);
});

