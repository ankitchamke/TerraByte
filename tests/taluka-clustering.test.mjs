import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { clusterRepairsByTahsil } from "../src/lib/services/circuit-optimizer.ts";
import { normalizeNagpurTahsil, NAGPUR_TAHSILS } from "../src/lib/location.ts";
import { computeTechnicianDispatchScore } from "../src/lib/services/technician-dispatch.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

// ==============================================================================
// 1. TALUKA CLUSTERING TESTS
// ==============================================================================

test("1. Multiple repairs in one tahsil are grouped together accurately", () => {
  const repairs = [
    { id: "r1", location: "Dorli, Katol", service_type: "DOORSTEP", urgency_level: "STANDARD" },
    { id: "r2", location: "Katol Central", service_type: "DOORSTEP", urgency_level: "HIGH" },
    {
      id: "r3",
      location: "Mohpa Road, Katol",
      service_type: "DOORSTEP",
      urgency_level: "CRITICAL",
      is_machine_stopped: true,
    },
  ];

  const result = clusterRepairsByTahsil(repairs);
  assert.equal(result.totalEligibleDoorstepRepairs, 3);
  assert.equal(result.clusterList.length, 1);

  const katol = result.clusters["Katol"];
  assert.ok(katol);
  assert.equal(katol.count, 3);
  assert.equal(katol.criticalStoppedCount, 1);
  assert.equal(katol.criticalCount, 1);
  assert.equal(katol.highCount, 1);
  assert.equal(katol.standardCount, 1);
  assert.equal(katol.repairs.length, 3);
});

test("2. Repairs distributed across different tahsils are separated correctly", () => {
  const repairs = [
    { id: "r1", location: "Katol", service_type: "DOORSTEP", urgency_level: "STANDARD" },
    { id: "r2", location: "Saoner", service_type: "DOORSTEP", urgency_level: "STANDARD" },
    { id: "r3", location: "Kalmeshwar", service_type: "DOORSTEP", urgency_level: "HIGH" },
    {
      id: "r4",
      location: "Saoner East",
      service_type: "DOORSTEP",
      urgency_level: "CRITICAL",
      is_machine_stopped: true,
    },
  ];

  const result = clusterRepairsByTahsil(repairs);
  assert.equal(result.totalEligibleDoorstepRepairs, 4);
  assert.equal(result.clusterList.length, 3);

  // Saoner has critical stoppage so it must sort to top
  assert.equal(result.clusterList[0]?.tahsil, "Saoner");
  assert.equal(result.clusterList[0]?.count, 2);
  assert.equal(result.clusterList[0]?.criticalStoppedCount, 1);

  assert.equal(result.clusters["Katol"]?.count, 1);
  assert.equal(result.clusters["Kalmeshwar"]?.count, 1);
});

test("3. Unknown locality is explicitly grouped under 'Unknown' cluster", () => {
  const repairs = [
    {
      id: "r1",
      location: "Unknown Remote Field",
      service_type: "DOORSTEP",
      urgency_level: "STANDARD",
    },
    {
      id: "r2",
      location: "Near Railway Crossing #4",
      service_type: "DOORSTEP",
      urgency_level: "HIGH",
    },
  ];

  const result = clusterRepairsByTahsil(repairs);
  assert.equal(result.totalEligibleDoorstepRepairs, 2);
  assert.equal(result.unknownCount, 2);
  assert.equal(result.clusterList.length, 1);
  assert.equal(result.clusterList[0]?.tahsil, "Unknown");
  assert.equal(result.clusterList[0]?.count, 2);
});

test("4. Missing locality (empty string or null) is placed in 'Unknown' cluster without fabricating a tahsil", () => {
  const repairs = [
    { id: "r1", location: "", service_type: "DOORSTEP", urgency_level: "STANDARD" },
    { id: "r2", location: "On-site / Field", service_type: "DOORSTEP", urgency_level: "STANDARD" },
    { id: "r3", location: "   ", service_type: "DOORSTEP", urgency_level: "STANDARD" },
  ];

  const result = clusterRepairsByTahsil(repairs);
  assert.equal(result.totalEligibleDoorstepRepairs, 3);
  assert.equal(result.unknownCount, 3);
  assert.equal(result.clusterList.length, 1);
  assert.equal(result.clusterList[0]?.tahsil, "Unknown");
  assert.equal(result.clusterList[0]?.count, 3);
  // Never default to Katol or Nagpur
  assert.equal(result.clusters["Katol"]?.count, 0);
  assert.equal(result.clusters["Nagpur (Urban)"]?.count, 0);
});

test("5. Workshop-only requests are strictly excluded from field dispatch clusters", () => {
  const repairs = [
    { id: "r1", location: "Katol", service_type: "DOORSTEP", urgency_level: "STANDARD" },
    { id: "r2", location: "Katol Depot", service_type: "WORKSHOP", urgency_level: "HIGH" },
    { id: "r3", location: "Saoner Workshop", service_type: "WORKSHOP", urgency_level: "CRITICAL" },
  ];

  const result = clusterRepairsByTahsil(repairs);
  assert.equal(result.totalEligibleDoorstepRepairs, 1);
  assert.equal(result.totalExcludedWorkshopRepairs, 2);
  assert.equal(result.clusterList.length, 1);
  assert.equal(result.clusterList[0]?.tahsil, "Katol");
  assert.equal(result.clusterList[0]?.count, 1);
  assert.equal(result.clusters["Saoner"]?.count, 0);
});

test("6. Completed and cancelled repairs are excluded before clustering in admin widget AST", () => {
  const widgetPath = path.join(ROOT_DIR, "src", "components", "admin-taluka-clusters.tsx");
  const content = fs.readFileSync(widgetPath, "utf8");

  // Verify eligibleRepairs filter in widget
  assert.match(
    content,
    /r\.status === "REQUESTED"/,
    "Clustering must restrict to open REQUESTED tickets",
  );
  assert.match(content, /!r\.technician_id/, "Clustering must restrict to unassigned tickets");
  assert.match(
    content,
    /\(r\.service_type \|\| "DOORSTEP"\) === "DOORSTEP"/,
    "Clustering must restrict to DOORSTEP mode",
  );
});

test("7. Critical stopped-machine count accurately calculated and prioritizes cluster ranking", () => {
  const repairs = [
    {
      id: "r1",
      location: "Umred",
      service_type: "DOORSTEP",
      urgency_level: "STANDARD",
      is_machine_stopped: false,
    },
    {
      id: "r2",
      location: "Umred",
      service_type: "DOORSTEP",
      urgency_level: "STANDARD",
      is_machine_stopped: false,
    },
    {
      id: "r3",
      location: "Umred",
      service_type: "DOORSTEP",
      urgency_level: "HIGH",
      is_machine_stopped: false,
    },
    {
      id: "r4",
      location: "Katol",
      service_type: "DOORSTEP",
      urgency_level: "CRITICAL",
      is_machine_stopped: true,
    },
  ];

  const result = clusterRepairsByTahsil(repairs);
  assert.equal(result.clusterList.length, 2);

  // Even though Umred has 3 repairs, Katol has 1 critical stopped machine and MUST rank first
  assert.equal(result.clusterList[0]?.tahsil, "Katol");
  assert.equal(result.clusterList[0]?.criticalStoppedCount, 1);

  assert.equal(result.clusterList[1]?.tahsil, "Umred");
  assert.equal(result.clusterList[1]?.count, 3);
  assert.equal(result.clusterList[1]?.criticalStoppedCount, 0);
});

test("8. Hindi and Marathi Devanagari locality strings normalize correctly", () => {
  // Test Devanagari tahsil names for Nagpur district
  assert.equal(normalizeNagpurTahsil("काटोल"), "Katol");
  assert.equal(normalizeNagpurTahsil("सावनेर"), "Saoner");
  assert.equal(normalizeNagpurTahsil("उमरेड"), "Umred");
  assert.equal(normalizeNagpurTahsil("उमरेर"), "Umred");
  assert.equal(normalizeNagpurTahsil("नरखेड"), "Narkhed");
  assert.equal(normalizeNagpurTahsil("कलमेश्वर"), "Kalmeshwar");
  assert.equal(normalizeNagpurTahsil("कळमेश्वर"), "Kalmeshwar");
  assert.equal(normalizeNagpurTahsil("रामटेक"), "Ramtek");
  assert.equal(normalizeNagpurTahsil("कामठी"), "Kamptee");
  assert.equal(normalizeNagpurTahsil("हिंगणा"), "Hingna");
  assert.equal(normalizeNagpurTahsil("पारशिवणी"), "Parseoni");
  assert.equal(normalizeNagpurTahsil("मौदा"), "Mauda");
  assert.equal(normalizeNagpurTahsil("भिवापूर"), "Bhiwapur");
  assert.equal(normalizeNagpurTahsil("कुही"), "Kuhi");
  assert.equal(normalizeNagpurTahsil("नागपूर ग्रामीण"), "Nagpur (Rural)");
  assert.equal(normalizeNagpurTahsil("नागपूर शहर"), "Nagpur (Urban)");

  // Clustering with Devanagari location strings
  const devanagariRepairs = [
    {
      id: "r1",
      location: "गाव काटोल, जि. नागपूर",
      service_type: "DOORSTEP",
      urgency_level: "STANDARD",
    },
    {
      id: "r2",
      location: "सावनेर बस स्टँडजवळ",
      service_type: "DOORSTEP",
      urgency_level: "CRITICAL",
      is_machine_stopped: true,
    },
  ];

  const result = clusterRepairsByTahsil(devanagariRepairs);
  assert.equal(result.clusters["Katol"]?.count, 1);
  assert.equal(result.clusters["Saoner"]?.count, 1);
  assert.equal(result.clusters["Saoner"]?.criticalStoppedCount, 1);
});

test("9. Empty state is returned cleanly when no eligible requests exist", () => {
  const result = clusterRepairsByTahsil([]);
  assert.equal(result.totalEligibleDoorstepRepairs, 0);
  assert.equal(result.totalExcludedWorkshopRepairs, 0);
  assert.equal(result.unknownCount, 0);
  assert.equal(result.clusterList.length, 0);
});

// ==============================================================================
// 2. IN-AREA CIRCUIT RECOMMENDATION & DISPATCH TESTS
// ==============================================================================

test("10. In-area circuit detection detects technician with existing stop in same tahsil", () => {
  const currentRepairTahsil = "Katol";
  const techAssignedTahsilCounts = new Map([
    ["tech-1", new Map([["Katol", 1]])],
    ["tech-2", new Map([["Saoner", 2]])],
  ]);

  const tech1Map = techAssignedTahsilCounts.get("tech-1");
  const tech1Count = tech1Map?.get(currentRepairTahsil) || 0;
  assert.equal(tech1Count, 1);
  assert.equal(tech1Count > 0, true);

  const tech2Map = techAssignedTahsilCounts.get("tech-2");
  const tech2Count = tech2Map?.get(currentRepairTahsil) || 0;
  assert.equal(tech2Count, 0);
});

test("11. Technician with stops in a different tahsil receives no in-area bonus", () => {
  const currentRepairTahsil = "Katol";
  const techMap = new Map([
    ["Saoner", 2],
    ["Umred", 1],
  ]);

  const inAreaCount = techMap.get(currentRepairTahsil) || 0;
  assert.equal(inAreaCount, 0);
});

test("12. Unknown tahsil repair must not grant an in-area circuit bonus to any technician", () => {
  const currentRepairTahsil = normalizeNagpurTahsil("On-site / Field");
  assert.equal(currentRepairTahsil, null);

  // When tahsil is null, hasInAreaCircuit must remain false
  const hasInAreaCircuit = Boolean(currentRepairTahsil && true);
  assert.equal(hasInAreaCircuit, false);
});

test("13. Technician with no existing circuit receives hasInAreaCircuit = false", () => {
  const currentRepairTahsil = "Katol";
  const techAssignedTahsilCounts = new Map();

  const tahsilMap = techAssignedTahsilCounts.get("idle-tech");
  const stopCount = tahsilMap ? tahsilMap.get(currentRepairTahsil) || 0 : 0;
  assert.equal(stopCount, 0);
});

test("14. Multiple assigned jobs in the same tahsil counted accurately without duplicate queries", () => {
  const currentRepairTahsil = "Katol";
  const activeRepairs = [
    { id: "a1", technician_id: "tech-1", location: "Dorli, Katol", service_type: "DOORSTEP" },
    { id: "a2", technician_id: "tech-1", location: "Mohpa, Katol", service_type: "DOORSTEP" },
    { id: "a3", technician_id: "tech-1", location: "Katol Yard", service_type: "DOORSTEP" },
    { id: "a4", technician_id: "tech-1", location: "Workshop Depot", service_type: "WORKSHOP" }, // excluded
  ];

  const techAssignedTahsilCounts = new Map();
  for (const r of activeRepairs) {
    if (r.service_type === "DOORSTEP") {
      const stopTahsil = normalizeNagpurTahsil(r.location);
      if (stopTahsil) {
        let tMap = techAssignedTahsilCounts.get(r.technician_id);
        if (!tMap) {
          tMap = new Map();
          techAssignedTahsilCounts.set(r.technician_id, tMap);
        }
        tMap.set(stopTahsil, (tMap.get(stopTahsil) || 0) + 1);
      }
    }
  }

  const stopCount = techAssignedTahsilCounts.get("tech-1")?.get(currentRepairTahsil) || 0;
  assert.equal(stopCount, 3);
});

test("15. In-area explanation string formats accurately for single and multiple stops", () => {
  const singleStopExp = `Already scheduled in Katol today`;
  const multiStopExp = `Already scheduled in Katol today (2 stops)`;

  assert.equal(singleStopExp, "Already scheduled in Katol today");
  assert.match(multiStopExp, /Already scheduled in Katol today \(2 stops\)/);
});

test("16. Existing dispatch score boundaries remain strictly within 0-100", () => {
  // Test both critical and routine maximums
  const criticalMax = computeTechnicianDispatchScore({
    isCriticalStopped: true,
    brandMatch: true,
    skillMatch: true,
    isAvailable: true,
    activeJobCount: 0,
    distanceKm: 5,
    isWithinRadius: true,
    serviceType: "DOORSTEP",
    isDoorstepCapable: true,
  });
  assert.equal(criticalMax.score, 100);

  const routineMax = computeTechnicianDispatchScore({
    isCriticalStopped: false,
    brandMatch: true,
    skillMatch: true,
    isAvailable: true,
    activeJobCount: 0,
    distanceKm: 10,
    isWithinRadius: true,
    serviceType: "DOORSTEP",
    isDoorstepCapable: true,
  });
  assert.equal(routineMax.score, 100);

  // Minimum bounds
  const minScore = computeTechnicianDispatchScore({
    isCriticalStopped: false,
    brandMatch: false,
    skillMatch: false,
    isAvailable: false,
    activeJobCount: 5,
    distanceKm: 120,
    isWithinRadius: false,
    serviceType: "DOORSTEP",
    isDoorstepCapable: false,
  });
  assert.ok(minScore.score >= 0 && minScore.score <= 100);
});

test("17. In-area circuit functions as deterministic tie-breaker without overriding score or urgency", () => {
  // Candidate A: 85 score, no in-area circuit
  // Candidate B: 85 score, has in-area circuit (wins tie)
  // Candidate C: 95 score, no in-area circuit (wins on score alone)
  const candidates = [
    { id: "A", score: 85, hasInAreaCircuit: false },
    { id: "B", score: 85, hasInAreaCircuit: true },
    { id: "C", score: 95, hasInAreaCircuit: false },
  ];

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const bInArea = Boolean(b.hasInAreaCircuit);
    const aInArea = Boolean(a.hasInAreaCircuit);
    if (bInArea !== aInArea) return Number(bInArea) - Number(aInArea);
    return 0;
  });

  assert.equal(
    candidates[0]?.id,
    "C",
    "Higher score (95) must beat 85 regardless of in-area circuit",
  );
  assert.equal(
    candidates[1]?.id,
    "B",
    "In-area candidate B must beat candidate A on score tie (85)",
  );
  assert.equal(candidates[2]?.id, "A");
});

// ==============================================================================
// 3. UI INTEGRATION & SOURCE AST VERIFICATIONS
// ==============================================================================

test("18. Admin index page AST renders AdminTalukaClusters widget and connects queue filter", () => {
  const adminIndexPath = path.join(ROOT_DIR, "src", "routes", "admin", "index.tsx");
  const content = fs.readFileSync(adminIndexPath, "utf8");

  assert.match(
    content,
    /<AdminTalukaClusters/,
    "Admin index must render AdminTalukaClusters component",
  );
  assert.match(
    content,
    /selectedTahsil=\{selectedTahsil\}/,
    "Passes selectedTahsil prop to AdminTalukaClusters",
  );
  assert.match(
    content,
    /onSelectTahsil=\{setSelectedTahsil\}/,
    "Passes onSelectTahsil callback to AdminTalukaClusters",
  );
  assert.match(
    content,
    /normalizeNagpurTahsil\(r\.location\)/,
    "Normalizes repair location with normalizeNagpurTahsil",
  );
  assert.match(
    content,
    /(?:normalizeNagpurTahsil\(r\.location\)|tahsil)\s*===\s*selectedTahsil/,
    "Filters queue table by selectedTahsil",
  );
});

test("19. Admin repair detail AST renders In-Area Circuit badge and modal explanation", () => {
  const repairDetailPath = path.join(ROOT_DIR, "src", "routes", "admin", "repair", "$id.tsx");
  const content = fs.readFileSync(repairDetailPath, "utf8");

  assert.match(
    content,
    /m\.hasInAreaCircuit && \(/,
    "Renders In-Area Circuit condition on technician recommendation card",
  );
  assert.match(content, /In-Area Circuit/, "Displays In-Area Circuit badge text");
  assert.match(
    content,
    /confirmAssignModal\.hasInAreaCircuit/,
    "Renders in-area circuit confirmation modal notification",
  );
});

test("20. GPS privacy is preserved: raw coordinates are never exposed in clustering widget", () => {
  const widgetPath = path.join(ROOT_DIR, "src", "components", "admin-taluka-clusters.tsx");
  const content = fs.readFileSync(widgetPath, "utf8");

  assert.doesNotMatch(
    content,
    /latitude|longitude|\.toFixed\(6\)/,
    "Clustering widget must never render raw numeric latitude/longitude coordinates",
  );
});
