import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

// ==============================================================================
// 1. SERVICE CENTRE DISPATCH UI AST VERIFICATION
// ==============================================================================

test("Admin repair detail includes location-aware dispatch recommendation cards", () => {
  const adminDetailPath = path.join(ROOT_DIR, "src", "routes", "admin", "repair", "$id.tsx");
  const code = fs.readFileSync(adminDetailPath, "utf8");

  // Top match indicators
  assert.ok(
    code.includes("Urgent Proximity Match"),
    "Must include Urgent Proximity Match indicator",
  );
  assert.ok(code.includes("Best Match"), "Must include Best Match indicator");
  assert.ok(
    code.includes("Score {m.score}%") || code.includes("Score:"),
    "Must display match percentage/score",
  );

  // Technician details
  assert.ok(code.includes("m.technician.profile?.full_name"), "Must render technician full name");
  assert.ok(code.includes("m.technician.workshop_name"), "Must render technician workshop name");
  assert.ok(
    code.includes("BadgeCheck") && code.includes("Verified"),
    "Must display verified status indicator",
  );
});

test("Admin repair detail renders distance, ETA, and distance source labels", () => {
  const adminDetailPath = path.join(ROOT_DIR, "src", "routes", "admin", "repair", "$id.tsx");
  const code = fs.readFileSync(adminDetailPath, "utf8");

  // Distance and ETA
  assert.ok(code.includes("m.distanceKm"), "Must render distance in km");
  assert.ok(code.includes("m.estimatedDriveMinutes"), "Must render driving ETA");

  // Distance sources
  assert.ok(code.includes("Exact GPS"), "Must label Exact GPS distance source");
  assert.ok(code.includes("Tahsil Estimate"), "Must label Tahsil Estimate distance source");
  assert.ok(code.includes("Approx. Fallback"), "Must label Approximate Fallback distance source");
  assert.ok(code.includes("Distance unavailable"), "Must handle null distance gracefully");
});

test("Admin repair detail displays workload and active job count badges", () => {
  const adminDetailPath = path.join(ROOT_DIR, "src", "routes", "admin", "repair", "$id.tsx");
  const code = fs.readFileSync(adminDetailPath, "utf8");

  assert.ok(code.includes("Available · 0 active jobs"), "Must display 0 active jobs badge");
  assert.ok(code.includes("Available · 1 active job"), "Must display 1 active job badge");
  assert.ok(
    code.includes("Busy · {m.activeJobCount} active jobs") || code.includes("Busy"),
    "Must display busy badge for multiple active jobs",
  );
  assert.ok(code.includes("Off-duty / Unavailable"), "Must display unavailable status");
});

test("Admin repair detail renders brand, skill, doorstep, and radius eligibility", () => {
  const adminDetailPath = path.join(ROOT_DIR, "src", "routes", "admin", "repair", "$id.tsx");
  const code = fs.readFileSync(adminDetailPath, "utf8");

  assert.ok(code.includes("Specialist"), "Must display equipment brand specialization badge");
  assert.ok(code.includes("Expert"), "Must display system skill match badge");
  assert.ok(code.includes("Mobile Field Service"), "Must display mobile field capability badge");
  assert.ok(
    code.includes("Workshop Depot Only"),
    "Must display workshop only badge when incapable",
  );
  assert.ok(
    code.includes("Outside") && code.includes("max_travel_radius_km"),
    "Must warn if outside travel radius",
  );
});

test("Admin repair detail displays prominent emergency dispatch explanation for critical stoppages", () => {
  const adminDetailPath = path.join(ROOT_DIR, "src", "routes", "admin", "repair", "$id.tsx");
  const code = fs.readFileSync(adminDetailPath, "utf8");

  assert.ok(code.includes("isCriticalStopped"), "Must evaluate isCriticalStopped state");
  assert.ok(
    code.includes("Emergency Field Dispatch — Operations Halted"),
    "Must display emergency dispatch banner header",
  );
  assert.ok(
    code.includes("Machinery is completely stopped and immobile in the field"),
    "Must explain rapid response weighting criteria to dispatcher",
  );
});

// ==============================================================================
// 2. EXPLICIT MANUAL ASSIGNMENT & REASSIGNMENT WORKFLOW
// ==============================================================================

test("Admin repair detail enforces explicit confirmation dialog and preserves manual assignment", () => {
  const adminDetailPath = path.join(ROOT_DIR, "src", "routes", "admin", "repair", "$id.tsx");
  const code = fs.readFileSync(adminDetailPath, "utf8");

  // Confirmation modal existence
  assert.ok(code.includes("confirmAssignModal"), "Must maintain confirmation modal state");
  assert.ok(
    code.includes("Confirm Technician Dispatch") ||
      code.includes("Confirm Technician Reassignment"),
    "Must show confirmation dialog title",
  );
  assert.ok(
    code.includes("Recommendations do not auto-assign"),
    "Must explicitly remind dispatcher that recommendations do not auto-assign",
  );
  assert.ok(code.includes("Confirm Assignment"), "Must provide explicit confirmation button");

  // Invokes assignTechnician service without bypass
  assert.ok(code.includes("handleAssign"), "Must invoke handleAssign on confirmation");
  assert.ok(
    code.includes("assignTechnician"),
    "Must call assignTechnician from technicians service",
  );
});

test("Admin repair detail allows assigning any verified technician regardless of rank", () => {
  const adminDetailPath = path.join(ROOT_DIR, "src", "routes", "admin", "repair", "$id.tsx");
  const code = fs.readFileSync(adminDetailPath, "utf8");

  // Button exists on all candidates (unless currently assigned)
  assert.ok(
    code.includes("setConfirmAssignModal(m)"),
    "Must allow opening confirmation dialog for any candidate match m",
  );
  assert.ok(
    code.includes("Current Assigned Technician"),
    "Must distinguish currently assigned technician from candidates",
  );
});

// ==============================================================================
// 3. PRIVACY-SAFE FARMER VIEW VERIFICATION
// ==============================================================================

test("Farmer repair detail renders privacy-safe recommendation cards", () => {
  const farmerDetailPath = path.join(ROOT_DIR, "src", "routes", "farmer", "repair", "$id.tsx");
  const code = fs.readFileSync(farmerDetailPath, "utf8");

  // Passes distanceSource to TechCard
  assert.ok(
    code.includes("distanceSource={m.distanceSource}"),
    "Must pass distanceSource to TechCard",
  );
  assert.ok(
    code.includes("formatTechCardData(m.technician, m)"),
    "Must pass matched distance to formatTechCardData",
  );

  // Privacy guarantees: Farmer detail must NEVER expose internal match scores or coordinates
  assert.ok(
    !code.includes("m.score"),
    "Farmer detail view must NEVER display raw recommendation score",
  );
  assert.ok(
    !code.includes("workshop_latitude"),
    "Farmer detail view must NEVER expose technician private latitude",
  );
  assert.ok(
    !code.includes("workshop_longitude"),
    "Farmer detail view must NEVER expose technician private longitude",
  );
});

test("TechCard component formats coarse distance and handles missing distance safely", () => {
  const techCardPath = path.join(ROOT_DIR, "src", "components", "repair-parts.tsx");
  const code = fs.readFileSync(techCardPath, "utf8");

  // Coarse distance formatting
  assert.ok(code.includes("distanceSource"), "TechCard must support distanceSource prop");
  assert.ok(
    code.includes("(approx)"),
    "TechCard must label approximate distance when from tahsil centroid or fallback",
  );
  assert.ok(
    code.includes("Distance estimate unavailable"),
    "TechCard must show graceful fallback when distance is unavailable",
  );
  assert.ok(
    !code.includes("0 km · ~"),
    "TechCard must never print '0 km' when distance is unknown",
  );
});

// ==============================================================================
// 4. UI STATES: EMPTY, LOADING, FALLBACK
// ==============================================================================

test("UI handles loading and empty states gracefully in Service Centre and Farmer views", () => {
  const adminDetailPath = path.join(ROOT_DIR, "src", "routes", "admin", "repair", "$id.tsx");
  const adminCode = fs.readFileSync(adminDetailPath, "utf8");

  assert.ok(
    adminCode.includes("Calculating location-aware recommendations…"),
    "Service Centre view must show loading indicator while calculating recommendations",
  );
  assert.ok(
    adminCode.includes("No eligible technicians found"),
    "Service Centre view must show empty state when 0 technicians match",
  );

  const farmerDetailPath = path.join(ROOT_DIR, "src", "routes", "farmer", "repair", "$id.tsx");
  const farmerCode = fs.readFileSync(farmerDetailPath, "utf8");

  assert.ok(
    farmerCode.includes("No technicians matched currently"),
    "Farmer view must show empty state when 0 technicians match",
  );
});
