# Testing Patterns

**Analysis Date:** 2026-11-04

## Test Framework

**Runner:**
- Node.js Built-in Test Runner (`node:test`)
- Assertions: `node:assert/strict`
- Configuration: Declared in `package.json` scripts

**Run Commands:**
```bash
npm test                             # Run full test suite (node --test tests/*.test.mjs)
node --test tests/parts-desk.test.mjs # Run specific test suite
node --test --watch tests/*.test.mjs # Watch mode
```

## Test File Organization

**Location:**
- Dedicated `tests/` directory at the project root

**Naming:**
- Kebab-case with `.test.mjs` extension:
  - `tests/cleanup-verification.test.mjs`
  - `tests/diagnostics-contract.test.mjs`
  - `tests/parts-desk.test.mjs`
  - `tests/parts-matching.test.mjs`
  - `tests/profile-security-architecture.test.mjs`
  - `tests/route-estimate.test.mjs`

**Structure:**
```
tests/
├── cleanup-verification.test.mjs           # Demo hygiene and persona security
├── diagnostics-contract.test.mjs           # AI visual diagnostic privilege isolation
├── parts-desk.test.mjs                     # Inventory, requisitions, movements, and sales
├── parts-matching.test.mjs                 # Parts catalog search and model matching
├── profile-security-architecture.test.mjs  # Profile decoupling and RLS protection
└── route-estimate.test.mjs                 # OSRM & Google Routes API verification
```

## Test Structure

**Suite Organization:**
```javascript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("candidate matching filter strictly rejects unverified and deleted technicians", () => {
  // 1. Setup / Fixture extraction
  const code = fs.readFileSync(path.resolve("src/lib/matching.ts"), "utf8");

  // 2. Execution / Assertion
  assert.ok(code.includes("is_verified === true"), "Must check verification status");
  assert.equal(typeof code, "string");
});
```

**Patterns:**
- **Static Contract Auditing:** Inspects source files and SQL migration scripts directly to enforce architectural rules, security boundaries, and schema invariants without requiring live external network infrastructure.
- **Logical Simulation:** Simulates PostgreSQL RLS matrices and multi-actor lifecycle transitions in-memory to guarantee fail-closed behavior.
- **Unit Assertion:** Tests pure calculation utilities (e.g. distance formatting, coordinate bounding, duration parsing).

## Mocking

**Framework:**
- Built-in JavaScript mocks and stubbed global fetch (`globalThis.fetch`)

**Patterns:**
```javascript
// Mocking fetch for external APIs
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (url.includes("router.project-osrm.org")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        code: "Ok",
        routes: [{ distance: 15400, duration: 1320 }],
      }),
    };
  }
  return { ok: false, status: 404 };
};

// Teardown restore
globalThis.fetch = originalFetch;
```

**What to Mock:**
- External third-party HTTP endpoints (Google Routes API, OSRM, Gemini AI, Groq Whisper)
- Browser environment globals when running in Node.js test environment

**What NOT to Mock:**
- Domain utility functions (`src/lib/location.ts`, `src/lib/date-utils.ts`)
- Schema files and migration scripts (read and verified directly from disk)

## Fixtures and Factories

**Test Data:**
- Designated demo personas and canonical fixtures maintained in `src/lib/services/demo.ts`:
  - Farmer: `farmer.nagpur@terrabyte.demo`
  - Technician: `tech.nagpur@terrabyte.demo`
  - Service Centre: `admin.nagpur@terrabyte.demo`
- Approved spare parts catalog in `src/lib/tb-store.ts` (5 canonical tractor parts)

**Location:**
- Inlined within test suites or imported from `src/lib/services/demo.ts` and `src/lib/tb-store.ts`

## Coverage

**Requirements:**
- High test coverage across core state machines, parts desk requisitions, profile security separation, and routing calculations. Currently 144 passing tests across 6 suites.

**View Test Results:**
```bash
npm test
```

## Test Types

**Unit Tests:**
- Pure functions and mathematical helpers (e.g., `formatRouteDistance`, `isValidGpsCoordinate` in `tests/route-estimate.test.mjs`).

**Contract & Architecture Tests:**
- Static code and migration analysis verifying RLS policies, column grants, trigger presence, and schema security in `tests/profile-security-architecture.test.mjs` and `tests/diagnostics-contract.test.mjs`.

**Lifecycle & State Machine Integration Tests:**
- End-to-end simulation of technician requisition, physical handoff, stock decrement, and quote integration in `tests/parts-desk.test.mjs`.

## Common Patterns

**Async Testing:**
```javascript
test("computeOsrmRoute parses valid OSRM response", async () => {
  const result = await computeOsrmRoute(origin, destination);
  assert.equal(result.distanceMeters, 15400);
  assert.equal(result.durationSeconds, 1320);
});
```

**Error Testing:**
```javascript
test("handleRouteEstimateRequest rejects missing Bearer token with 401", async () => {
  const req = new Request("http://localhost/api/route-estimate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const res = await handleRouteEstimateRequest(req);
  assert.equal(res.status, 401);
});
```

---

*Testing analysis: 2026-11-04*
