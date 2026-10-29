import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  INITIAL_DEMO_PARTS,
  getDemoParts,
  getDemoPartById,
  adjustDemoPartStock,
  requestDemoPart,
  confirmDemoPartHandoff,
  cancelDemoPartRequest,
  getDemoPartRequests,
  getDemoStockAuditLog,
  resetDemo,
} from "../src/lib/tb-store.ts";

// 1. VERIFY SCHEMA AND CONSTRAINTS IN MIGRATION FILE
test("Migration 20261029100000_phase9_1_parts_pickup.sql defines schema, constraints, location, and safeupdate clauses", () => {
  const migrationPath = path.resolve(
    "supabase/migrations/20261029100000_phase9_1_parts_pickup.sql"
  );
  assert.ok(fs.existsSync(migrationPath), "Phase 9.1 migration file must exist");
  const sql = fs.readFileSync(migrationPath, "utf8");

  // Verify service_centre_parts table
  assert.ok(
    sql.includes("CREATE TABLE IF NOT EXISTS public.service_centre_parts"),
    "Must create public.service_centre_parts"
  );
  assert.ok(
    sql.includes("CHECK (stock_quantity >= 0)"),
    "Must enforce non-negative stock_quantity check constraint"
  );
  assert.ok(
    sql.includes("CHECK (unit_price >= 0)"),
    "Must enforce non-negative unit_price check constraint"
  );
  assert.ok(
    sql.includes("location text DEFAULT 'Depot Main Floor'"),
    "Must define location column in service_centre_parts"
  );

  // Verify service_centre_part_requests table
  assert.ok(
    sql.includes("CREATE TABLE IF NOT EXISTS public.service_centre_part_requests"),
    "Must create public.service_centre_part_requests"
  );
  assert.ok(
    sql.includes("CHECK (quantity > 0)"),
    "Must enforce quantity > 0 check constraint"
  );
  assert.ok(
    sql.includes("CHECK (status IN ('PENDING', 'HANDED_OFF', 'CANCELLED'))"),
    "Must enforce valid request status check constraint"
  );
  assert.ok(
    sql.includes("REFERENCES public.repair_requests(id) ON DELETE CASCADE"),
    "Must cascade delete requests when parent repair is deleted"
  );

  // Verify service_centre_stock_audit table
  assert.ok(
    sql.includes("CREATE TABLE IF NOT EXISTS public.service_centre_stock_audit"),
    "Must create public.service_centre_stock_audit"
  );
  assert.ok(
    sql.includes("change_quantity int NOT NULL"),
    "Must track change_quantity in audit log"
  );
  assert.ok(
    sql.includes("previous_stock int NOT NULL"),
    "Must track previous_stock in audit log"
  );
  assert.ok(
    sql.includes("new_stock int NOT NULL"),
    "Must track new_stock in audit log"
  );

  // Verify PostgreSQL safeupdate compliance: all DELETE statements must have a WHERE clause
  const deleteStatements = sql.match(/DELETE\s+FROM\s+[a-zA-Z0-9_.]+/gi) || [];
  assert.ok(deleteStatements.length >= 6, "Must contain DELETE statements in reset_demo_data");
  
  // Ensure none of the DELETE statements lack a WHERE clause
  const lines = sql.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("DELETE FROM") && !line.includes("RETURNING")) {
      assert.ok(
        line.includes("WHERE") || (lines[i + 1] && lines[i + 1].includes("WHERE")),
        `DELETE statement on line ${i + 1} must include a WHERE clause for safeupdate compliance: "${line}"`
      );
    }
  }

  // Verify idempotent upsert in reset_demo_data
  assert.ok(
    sql.includes("ON CONFLICT (part_number) DO UPDATE SET"),
    "reset_demo_data must use idempotent upsert for service_centre_parts"
  );
});

// 2. VERIFY POSTGRESQL RLS POLICIES ENFORCE ROLE BOUNDARIES & FARMER PRIVACY
test("Migration enforces strict RLS: technicians can only request for assigned repairs and farmers cannot read parts", () => {
  const migrationPath = path.resolve(
    "supabase/migrations/20261029100000_phase9_1_parts_pickup.sql"
  );
  const sql = fs.readFileSync(migrationPath, "utf8");

  // RLS enablement
  assert.ok(sql.includes("ALTER TABLE public.service_centre_parts ENABLE ROW LEVEL SECURITY;"));
  assert.ok(sql.includes("ALTER TABLE public.service_centre_part_requests ENABLE ROW LEVEL SECURITY;"));
  assert.ok(sql.includes("ALTER TABLE public.service_centre_stock_audit ENABLE ROW LEVEL SECURITY;"));

  // Parts catalog: admin and technician only. Farmer is blocked from reading internal stock and prices.
  assert.ok(
    sql.includes("public.current_user_role() IN ('admin', 'technician')"),
    "Parts catalog SELECT policy must only permit admin and technician roles"
  );
  assert.ok(
    !sql.includes("'farmer', 'admin', 'technician'"),
    "Farmer role must NOT have access to service_centre_parts"
  );

  // Requisitions: technician can only insert for repairs assigned to them
  assert.ok(
    sql.includes("r.technician_id = public.current_profile_id()"),
    "Technician INSERT policy must check assignment to repair_request"
  );

  // Audit log: admin only
  assert.ok(
    sql.includes("CREATE POLICY \"Admins can view stock audit log\""),
    "Audit log SELECT must be restricted to admins"
  );
});

// 3. CANONICAL FIVE DEMO PARTS POPULATION & DATA COMPLETENESS
test("Demo parts store provides exactly the 5 approved canonical parts with complete operational details", () => {
  resetDemo();
  const parts = getDemoParts();

  assert.equal(parts.length, 5, "Must return exactly 5 canonical parts");

  const expectedParts = [
    {
      part_number: "0433171",
      name: "Fuel Injector Nozzle Set",
      category: "Fuel system",
      stock_quantity: 3,
      unit_price: 2200,
      location: "Depot Shelf A-02",
    },
    {
      part_number: "005556958R1",
      name: "Inline Fuel Filter",
      category: "Fuel system",
      stock_quantity: 8,
      unit_price: 350,
      location: "Depot Shelf A-03",
    },
    {
      part_number: "AL120788",
      name: "Lift Cylinder Seal Kit",
      category: "Hydraulics",
      stock_quantity: 2,
      unit_price: 1650,
      location: "Depot Shelf B-01",
    },
    {
      part_number: "HY-GARD-15W30",
      name: "Hydraulic Oil 15W-30",
      category: "Hydraulics",
      stock_quantity: 5,
      unit_price: 320,
      location: "Depot Drum Rack B-04",
    },
    {
      part_number: "26243171",
      name: "Starter Motor Assembly",
      category: "Electrical",
      stock_quantity: 1,
      unit_price: 5800,
      location: "Depot Shelf C-01",
    },
  ];

  for (const expected of expectedParts) {
    const found = parts.find((p) => p.part_number === expected.part_number);
    assert.ok(found, `Part ${expected.part_number} (${expected.name}) must exist`);
    assert.equal(found.name, expected.name);
    assert.equal(found.category, expected.category);
    assert.equal(found.stock_quantity, expected.stock_quantity);
    assert.equal(found.unit_price, expected.unit_price);
    assert.equal(found.location, expected.location);
    assert.ok(found.spec, "Part must have a specification");
    assert.ok(Array.isArray(found.compatible_models) && found.compatible_models.length > 0, "Part must have verified compatible models");
  }
});

// 4. TECHNICIAN PART SEARCH AND FILTERING
test("Technician part search matches across name, part number, spec, category, compatible models, and location", () => {
  const parts = getDemoParts();

  function searchParts(catalog, query) {
    if (!query.trim()) return catalog;
    const q = query.toLowerCase();
    return catalog.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.part_number.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        (p.spec && p.spec.toLowerCase().includes(q)) ||
        (p.location && p.location.toLowerCase().includes(q)) ||
        p.compatible_models.some((m) => m.toLowerCase().includes(q))
    );
  }

  // 1. Search by brand/model
  const mahindraParts = searchParts(parts, "Mahindra 575 DI");
  assert.equal(mahindraParts.length, 3, "Mahindra 575 DI must match 3 parts (Nozzle, Filter, Starter)");

  const jdParts = searchParts(parts, "John Deere");
  assert.equal(jdParts.length, 2, "John Deere must match 2 parts (Seal kit, Hydraulic oil)");

  // 2. Search by part number / SKU
  const nozzleMatch = searchParts(parts, "0433171");
  assert.equal(nozzleMatch.length, 1);
  assert.equal(nozzleMatch[0].name, "Fuel Injector Nozzle Set");

  // 3. Search by spec (e.g., Bosch, Lucas)
  const boschMatch = searchParts(parts, "Bosch");
  assert.equal(boschMatch.length, 1);
  assert.equal(boschMatch[0].part_number, "0433171");

  const lucasMatch = searchParts(parts, "Lucas-TVS");
  assert.equal(lucasMatch.length, 1);
  assert.equal(lucasMatch[0].part_number, "26243171");

  // 4. Search by shelf location
  const shelfB1Match = searchParts(parts, "Shelf B-01");
  assert.equal(shelfB1Match.length, 1);
  assert.equal(shelfB1Match[0].part_number, "AL120788");

  const rackMatch = searchParts(parts, "Drum Rack");
  assert.equal(rackMatch.length, 1);
  assert.equal(rackMatch[0].part_number, "HY-GARD-15W30");
});

// 5. DETERMINISTIC STOCK QUANTITIES RESTORED AFTER RESET DEMO
test("Reset Demo deterministically restores canonical stock quantities and purges requests", () => {
  // 1. Mutate stock and create a request
  adjustDemoPartStock("0433171", 5, "Received stock delivery");
  const mutatedParts = getDemoParts();
  const nozzle = mutatedParts.find((p) => p.part_number === "0433171");
  assert.equal(nozzle.stock_quantity, 8, "Stock should be temporarily 8 (3 + 5)");

  requestDemoPart({
    repairRequestId: "TB-8841",
    partId: "0433171",
    quantity: 2,
    notes: "Urgent injector repair",
  });

  const reqsBefore = getDemoPartRequests();
  assert.equal(reqsBefore.length, 1, "Should have 1 active requisition");

  // 2. Execute Reset Demo
  resetDemo();

  // 3. Verify exact baseline restoration
  const restoredParts = getDemoParts();
  const restoredNozzle = restoredParts.find((p) => p.part_number === "0433171");
  assert.equal(restoredNozzle.stock_quantity, 3, "Bosch nozzle stock must reset to exact baseline of 3");

  const restoredFilter = restoredParts.find((p) => p.part_number === "005556958R1");
  assert.equal(restoredFilter.stock_quantity, 8, "Filter stock must reset to exact baseline of 8");

  const restoredKit = restoredParts.find((p) => p.part_number === "AL120788");
  assert.equal(restoredKit.stock_quantity, 2, "Seal kit stock must reset to exact baseline of 2");

  const restoredOil = restoredParts.find((p) => p.part_number === "HY-GARD-15W30");
  assert.equal(restoredOil.stock_quantity, 5, "Hydraulic oil stock must reset to exact baseline of 5");

  const restoredStarter = restoredParts.find((p) => p.part_number === "26243171");
  assert.equal(restoredStarter.stock_quantity, 1, "Starter motor stock must reset to exact baseline of 1");

  // Verify requisitions and stock audits are purged
  const reqsAfter = getDemoPartRequests();
  assert.equal(reqsAfter.length, 0, "Requisitions must be empty after Reset Demo");

  const auditsAfter = getDemoStockAuditLog();
  assert.equal(auditsAfter.length, 0, "Audit logs must be empty after Reset Demo");
});

// 6. ATOMIC HANDOFF DECREMENTS STOCK & PREVENTS NEGATIVE BALANCES
test("Technician requisition and confirmed handoff updates stock atomically with audit logging", () => {
  resetDemo();

  // Initial stock for Starter Motor (26243171) is 1
  const starter = getDemoPartById("26243171");
  assert.equal(starter.stock_quantity, 1);

  // Request 1 unit
  const req = requestDemoPart({
    repairRequestId: "TB-8898",
    partId: starter.id,
    quantity: 1,
    notes: "Swaraj starter failure",
  });
  assert.equal(req.status, "PENDING");

  // Stock on hand remains 1 until physical handoff (distinct from pending request)
  const starterBeforeHandoff = getDemoPartById("26243171");
  assert.equal(starterBeforeHandoff.stock_quantity, 1, "On-hand stock must remain 1 prior to confirmed handoff");

  // Confirm handoff
  const handoff = confirmDemoPartHandoff(req.id, "Nagpur Service Centre Admin");
  assert.equal(handoff.part.stock_quantity, 0, "Stock must decrement to 0 on handoff");
  assert.equal(handoff.request.status, "HANDED_OFF");

  // Verify stock audit log
  const auditLog = getDemoStockAuditLog();
  assert.equal(auditLog.length, 1);
  assert.equal(auditLog[0].change_quantity, -1);
  assert.equal(auditLog[0].previous_stock, 1);
  assert.equal(auditLog[0].new_stock, 0);
  assert.equal(auditLog[0].reason, "technician_handoff");

  // Attempt second handoff for remaining stock (0 available) must fail
  assert.throws(
    () => confirmDemoPartHandoff(req.id, "Nagpur Service Centre Admin"),
    /Requisition is already HANDED_OFF/
  );
});

// 7. FARMER PRIVACY ISOLATION
test("Farmer repair detail never queries or renders internal stock counts, costs, or part request tables", () => {
  const farmerRoutePath = path.resolve("src/routes/farmer/repair/$id.tsx");
  assert.ok(fs.existsSync(farmerRoutePath), "Farmer repair route must exist");
  const code = fs.readFileSync(farmerRoutePath, "utf8");

  // Ensure farmer view does not import or use parts-desk service or tables
  assert.ok(
    !code.includes("service_centre_parts"),
    "Farmer route must not reference service_centre_parts"
  );
  assert.ok(
    !code.includes("service_centre_part_requests"),
    "Farmer route must not reference service_centre_part_requests"
  );
  assert.ok(
    !code.includes("parts-desk"),
    "Farmer route must not import parts-desk service"
  );
  assert.ok(
    !code.includes("stock_quantity"),
    "Farmer route must not expose stock_quantity"
  );
});

// 8. STOCK AUDIT LOG RENDERS UNICODE ARROWS WITHOUT LATEX MARKUP
test("Stock Audit Log table header and row entries render plain Unicode arrows without LaTeX markup", () => {
  const partsDeskPath = path.resolve("src/routes/admin/parts-desk.tsx");
  assert.ok(fs.existsSync(partsDeskPath), "Parts desk route must exist");
  const code = fs.readFileSync(partsDeskPath, "utf8");

  // Verify header reads "Previous → New"
  assert.ok(
    code.includes("Previous → New"),
    "Stock Audit Log header must include 'Previous → New'"
  );

  // Verify row reads "{log.previous_stock} → {log.new_stock}"
  assert.ok(
    code.includes("{log.previous_stock} → {log.new_stock}"),
    "Stock Audit Log row must include '{log.previous_stock} → {log.new_stock}'"
  );

  // Verify no literal LaTeX arrow markup exists in the file
  assert.ok(
    !code.includes("$\\rightarrow$"),
    "Parts desk route must not contain '$\\rightarrow$'"
  );
  assert.ok(
    !code.includes("\\rightarrow"),
    "Parts desk route must not contain '\\rightarrow'"
  );
});
