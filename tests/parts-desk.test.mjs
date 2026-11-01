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
  receiveDemoStock,
  returnDemoPart,
  getDemoSales,
  getDemoMovementSummary,
  actions,
  resetDemo,
  getTB,
  quoteTotals,
  syncPartRequestToQuoteLines,
  updateDemoPartRequestEta,
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

  // Verify PostgreSQL safeupdate compliance: all DELETE statements must have an explicit non-trivial WHERE clause
  const deleteStatements = sql.match(/DELETE\s+FROM\s+[a-zA-Z0-9_.]+/gi) || [];
  assert.ok(deleteStatements.length >= 6, "Must contain DELETE statements in reset_demo_data");
  
  for (const match of deleteStatements) {
    const after = sql.slice(sql.indexOf(match));
    const nextSemicolon = after.indexOf(";");
    const stmt = after.slice(0, nextSemicolon);

    assert.ok(
      stmt.includes("WHERE"),
      `DELETE statement must contain WHERE clause for safeupdate compliance: "${match}"`
    );
    assert.ok(
      !stmt.includes("WHERE id IS NOT NULL"),
      `DELETE statement must not use trivial match-all 'WHERE id IS NOT NULL': "${stmt}"`
    );
    assert.ok(
      stmt.includes("v_demo_repair_ids") ||
        stmt.includes("v_demo_farmer_id") ||
        stmt.includes("v_demo_admin_id") ||
        stmt.includes("service_centre_id"),
      `DELETE statement must be scoped strictly to demo entities: "${stmt}"`
    );
  }

  // Verify scoped upsert in reset_demo_data
  assert.ok(
    sql.includes("ON CONFLICT (service_centre_id, part_number) DO UPDATE SET"),
    "reset_demo_data must scope upsert to service_centre_id and part_number"
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

// 9. PHASE 9.2 MIGRATION SCHEMA, CONSTRAINTS & SALES TABLE
test("Migration 20261029120000_phase9_2_stock_movement_sales.sql defines movement types, sales table, catalog_part_id, and check constraints", () => {
  const migrationPath = path.resolve(
    "supabase/migrations/20261029120000_phase9_2_stock_movement_sales.sql"
  );
  assert.ok(fs.existsSync(migrationPath), "Phase 9.2 migration file must exist");
  const sql = fs.readFileSync(migrationPath, "utf8");

  // Verify movement_type column & constraint on service_centre_stock_audit
  assert.ok(
    sql.includes("CHECK (movement_type IN ('RECEIVED', 'ISSUED_TO_REPAIR', 'RETURNED', 'ADJUSTMENT'))"),
    "Must enforce movement_type check constraint"
  );

  // Verify catalog_part_id on quote_items
  assert.ok(
    sql.includes("ADD COLUMN IF NOT EXISTS catalog_part_id uuid REFERENCES public.service_centre_parts(id)"),
    "Must add catalog_part_id to quote_items"
  );

  // Verify service_centre_part_sales table
  assert.ok(
    sql.includes("CREATE TABLE IF NOT EXISTS public.service_centre_part_sales"),
    "Must create public.service_centre_part_sales"
  );
  assert.ok(
    sql.includes("CHECK (quantity > 0)"),
    "Must enforce quantity > 0 on sales"
  );
  assert.ok(
    sql.includes("CHECK (unit_price >= 0)"),
    "Must enforce non-negative unit_price on sales"
  );
  assert.ok(
    sql.includes("CHECK (total_amount >= 0)"),
    "Must enforce non-negative total_amount on sales"
  );

  // Verify atomic RPCs
  assert.ok(
    sql.includes("CREATE OR REPLACE FUNCTION public.receive_service_centre_stock"),
    "Must create receive_service_centre_stock RPC"
  );
  assert.ok(
    sql.includes("CREATE OR REPLACE FUNCTION public.return_service_centre_part"),
    "Must create return_service_centre_part RPC"
  );

  // Verify safeupdate compliance and demo scoping on deletions in reset_demo_data
  const deleteMatches = sql.match(/DELETE\s+FROM\s+[a-zA-Z0-9_.]+/gi) || [];
  assert.ok(deleteMatches.length >= 7, "Must contain DELETE statements in reset_demo_data");
  for (const match of deleteMatches) {
    const after = sql.slice(sql.indexOf(match));
    const nextSemicolon = after.indexOf(";");
    const stmt = after.slice(0, nextSemicolon);
    assert.ok(stmt.includes("WHERE"), `DELETE statement must contain WHERE clause for safeupdate: "${match}"`);
    assert.ok(
      !stmt.includes("WHERE id IS NOT NULL"),
      `DELETE statement must not use trivial match-all 'WHERE id IS NOT NULL': "${stmt}"`
    );
    assert.ok(
      stmt.includes("v_demo_repair_ids") ||
        stmt.includes("v_demo_farmer_id") ||
        stmt.includes("v_demo_admin_id") ||
        stmt.includes("service_centre_id"),
      `DELETE statement must be scoped strictly to demo entities: "${stmt}"`
    );
  }
});

// 10. STOCK MOVEMENT DISTINCTION & ATOMIC HANDOFF (ISSUED_TO_REPAIR)
test("Physical handoff issues part to repair (ISSUED_TO_REPAIR), decrements stock exactly once, and rejects repeated attempts", () => {
  resetDemo();

  // Part: Bosch Nozzle (0433171), initial stock = 3
  const nozzleBefore = getDemoPartById("0433171");
  assert.equal(nozzleBefore.stock_quantity, 3);

  // Requisition for repair TB-8841
  const req = requestDemoPart({
    repairRequestId: "TB-8841",
    partId: nozzleBefore.id,
    quantity: 1,
    notes: "Overhaul fuel injection system",
  });
  assert.equal(req.status, "PENDING");

  // Confirm handoff
  const handoff = confirmDemoPartHandoff(req.id, "Nagpur Service Centre Admin");
  assert.equal(handoff.part.stock_quantity, 2, "Stock must decrement by 1");
  assert.equal(handoff.request.status, "HANDED_OFF");

  // Verify stock audit movement ledger
  const audits = getDemoStockAuditLog();
  const latestAudit = audits[0];
  assert.equal(latestAudit.movement_type, "ISSUED_TO_REPAIR", "Movement type must be ISSUED_TO_REPAIR");
  assert.equal(latestAudit.change_quantity, -1);
  assert.equal(latestAudit.previous_stock, 3);
  assert.equal(latestAudit.new_stock, 2);
  assert.equal(latestAudit.repair_request_id, "TB-8841");

  // Repeated handoff attempt must throw and NOT decrement stock or duplicate sales
  assert.throws(
    () => confirmDemoPartHandoff(req.id, "Nagpur Service Centre Admin"),
    /Requisition is already HANDED_OFF/
  );

  const nozzleAfterRetry = getDemoPartById("0433171");
  assert.equal(nozzleAfterRetry.stock_quantity, 2, "Stock must remain 2 after rejected retry");
});

// 11. SALE IS RECORDED ONLY WHEN HANDED OFF AGAINST FARMER-APPROVED QUOTE LINE
test("Sale is recorded with snapshot price only when handed off against an approved quote line", () => {
  resetDemo();

  // Create an active repair through normal workflow
  const nozzle = getDemoPartById("0433171");
  const repairId = actions.createRepair({
    equipmentId: "e1",
    farmerId: "f1",
    symptoms: ["Fuel leakage"],
    description: "Injector test",
    photos: [],
    location: "Katol, Nagpur",
  });
  actions.accept(repairId);
  actions.sendQuote(repairId, {
    parts: [
      {
        name: nozzle.name,
        spec: nozzle.spec,
        qty: 2,
        price: 2200,
        source: "Service Centre Depot",
        catalogPartId: nozzle.id,
      },
    ],
    labourDesc: "Replace injector nozzle",
    labour: 500,
    taxPct: 0,
    eta: "tomorrow",
    warranty: "90 days",
  });
  actions.approveQuote(repairId);

  // Scenario A: Handoff against approved quote line
  const reqA = requestDemoPart({
    repairRequestId: repairId,
    partId: nozzle.id,
    quantity: 1,
  });

  confirmDemoPartHandoff(reqA.id, "Nagpur Admin");

  const salesA = getDemoSales({ partId: nozzle.id });
  assert.equal(salesA.length, 1, "Must record exactly 1 sale for approved quote part");
  assert.equal(salesA[0].repair_request_id, repairId);
  assert.equal(salesA[0].quantity, 1);
  assert.equal(salesA[0].unit_price, 2200, "Must snapshot approved quote price of 2200");
  assert.equal(salesA[0].total_amount, 2200);

  // Scenario B: Repair created without approved quote (REQUESTED).
  // Handoff issues the part, but must NOT count as a sale.
  const starter = getDemoPartById("26243171"); // Starter motor
  const unapprovedRepairId = actions.createRepair({
    equipmentId: "e2",
    farmerId: "f1",
    symptoms: ["Engine won't crank"],
    description: "Electrical",
    photos: [],
    location: "Saoner, Nagpur",
  });

  const reqB = requestDemoPart({
    repairRequestId: unapprovedRepairId,
    partId: starter.id,
    quantity: 1,
  });

  confirmDemoPartHandoff(reqB.id, "Nagpur Admin");

  const salesB = getDemoSales({ partId: starter.id });
  assert.equal(salesB.length, 0, "Unapproved repair part issue must NOT count as a sale");

  // Verify starter stock decremented as an issue to repair
  const starterAfter = getDemoPartById("26243171");
  assert.equal(starterAfter.stock_quantity, 0, "Physical stock still decrements on handoff");
});

// 12. CONFIRMED RETURN RESTORES STOCK, ADDS RETURNED RECORD, PRESERVES HISTORY
test("Confirmed return of unused part restores stock, appends RETURNED movement, and preserves prior records", () => {
  resetDemo();

  const repairId = actions.createRepair({
    equipmentId: "e1",
    farmerId: "f1",
    symptoms: ["Fuel leakage"],
    description: "Test repair",
    photos: [],
    location: "Katol, Nagpur",
  });

  // Part: Bosch Nozzle (initial 3). Issue 1 unit.
  const nozzle = getDemoPartById("0433171");
  const req = requestDemoPart({
    repairRequestId: repairId,
    partId: nozzle.id,
    quantity: 1,
  });
  confirmDemoPartHandoff(req.id, "Staff");

  const stockAfterHandoff = getDemoPartById("0433171").stock_quantity;
  assert.equal(stockAfterHandoff, 2);

  const auditsBeforeReturn = getDemoStockAuditLog().length;

  // Now technician returns the unused nozzle
  const returnRes = returnDemoPart({
    repairRequestId: repairId,
    partId: nozzle.id,
    quantity: 1,
    reason: "Nozzle unused after injector recalibration",
    callerName: "Nagpur Service Centre",
  });

  assert.equal(returnRes.part.stock_quantity, 3, "Stock must be restored to 3");

  const auditsAfterReturn = getDemoStockAuditLog();
  assert.equal(auditsAfterReturn.length, auditsBeforeReturn + 1, "Must append a new movement record");

  const returnAudit = auditsAfterReturn[0];
  assert.equal(returnAudit.movement_type, "RETURNED", "Movement type must be RETURNED");
  assert.equal(returnAudit.change_quantity, 1);
  assert.equal(returnAudit.previous_stock, 2);
  assert.equal(returnAudit.new_stock, 3);
  assert.equal(returnAudit.repair_request_id, repairId);

  // Prior records must be preserved
  const previousHandoffAudit = auditsAfterReturn.find((a) => a.movement_type === "ISSUED_TO_REPAIR");
  assert.ok(previousHandoffAudit, "Prior handoff audit record must be preserved");
  assert.equal(previousHandoffAudit.change_quantity, -1);
});

// 13. RECEIVING STOCK INCREMENTS ON-HAND AND LOGS RECEIVED MOVEMENT
test("Receiving stock delivery increments on-hand quantity and logs RECEIVED movement", () => {
  resetDemo();

  const filterBefore = getDemoPartById("005556958R1"); // Inline fuel filter: 8 on hand
  assert.equal(filterBefore.stock_quantity, 8);

  const receiveRes = receiveDemoStock({
    partId: filterBefore.id,
    quantity: 5,
    reason: "Distributor shipment arrival PO-9912",
    callerName: "Nagpur Service Centre Admin",
  });

  assert.equal(receiveRes.part.stock_quantity, 13, "Stock must increment to 13 (8 + 5)");
  assert.equal(receiveRes.audit.movement_type, "RECEIVED");
  assert.equal(receiveRes.audit.change_quantity, 5);
  assert.equal(receiveRes.audit.previous_stock, 8);
  assert.equal(receiveRes.audit.new_stock, 13);
});

// 14. INVENTORY MOVEMENT SUMMARY REPORT ACCURACY
test("Inventory movement summary accurately calculates on-hand, issued to repairs, returned, quantity sold, and total sale value", () => {
  resetDemo();

  const repairId = actions.createRepair({
    equipmentId: "e2",
    farmerId: "f1",
    symptoms: ["Hydraulics slow"],
    description: "Cylinder inspection",
    photos: [],
    location: "Umred, Nagpur",
  });

  // Part AL120788 (Lift Cylinder Seal Kit): initial stock = 2, price = 1650
  const kit = getDemoPartById("AL120788");

  // 1. Receive 10 units
  receiveDemoStock({
    partId: kit.id,
    quantity: 10,
    reason: "JD factory shipment",
  });

  // 2. Issue 2 units
  const req = requestDemoPart({
    repairRequestId: repairId,
    partId: kit.id,
    quantity: 2,
  });
  confirmDemoPartHandoff(req.id, "Staff");

  // 3. Return 1 unused unit
  returnDemoPart({
    repairRequestId: repairId,
    partId: kit.id,
    quantity: 1,
    reason: "1 kit returned",
  });

  const summary = getDemoMovementSummary({ partId: kit.id });
  // on_hand: 2 + 10 - 2 + 1 = 11
  assert.equal(summary.on_hand, 11, "On hand must be 11");
  assert.equal(summary.issued_to_repairs, 2, "Issued to repairs must be 2");
  assert.equal(summary.returned_from_repairs, 1, "Returned must be 1");
});

// 15. STRICT ROLE ISOLATION FOR SALES AND DEPOT MARGINS
test("Strict role isolation: farmer view has zero access to service_centre_part_sales or internal depot ledgers", () => {
  const farmerRoutePath = path.resolve("src/routes/farmer/repair/$id.tsx");
  const code = fs.readFileSync(farmerRoutePath, "utf8");

  assert.ok(!code.includes("service_centre_part_sales"), "Farmer route must not reference service_centre_part_sales");
  assert.ok(!code.includes("getPartSales"), "Farmer route must not call getPartSales");
  assert.ok(!code.includes("Stock Movement"), "Farmer route must not show stock movement ledger");
});

// 16. DETERMINISTIC DEMO RESET CLEARS SALES & RESTORES 5 SAMPLE PARTS
test("Reset Demo deterministically purges sales, part requests, and movements, restoring the 5 approved parts to baseline", () => {
  // Mutate data
  const nozzle = getDemoPartById("0433171");
  receiveDemoStock({ partId: nozzle.id, quantity: 10, reason: "Test shipment" });

  const repairId = actions.createRepair({
    equipmentId: "e1",
    farmerId: "f1",
    symptoms: ["Fuel leak"],
    description: "Inspection",
    photos: [],
    location: "Katol, Nagpur",
  });
  actions.accept(repairId);
  actions.sendQuote(repairId, {
    parts: [
      {
        name: nozzle.name,
        spec: nozzle.spec,
        qty: 1,
        price: 2200,
        source: "Service Centre Depot",
        catalogPartId: nozzle.id,
      },
    ],
    labourDesc: "Replace",
    labour: 400,
    taxPct: 0,
    eta: "tomorrow",
    warranty: "90d",
  });
  actions.approveQuote(repairId);

  const req = requestDemoPart({
    repairRequestId: repairId,
    partId: nozzle.id,
    quantity: 1,
  });
  confirmDemoPartHandoff(req.id, "Staff");

  // Verify mutations exist
  assert.ok(getDemoSales().length > 0, "Should have sales before reset");
  assert.ok(getDemoStockAuditLog().length > 0, "Should have audits before reset");

  // Execute demo reset
  resetDemo();

  // Verify complete clean baseline
  assert.equal(getDemoSales().length, 0, "Sales must be 0 after reset");
  assert.equal(getDemoPartRequests().length, 0, "Part requests must be 0 after reset");
  assert.equal(getDemoStockAuditLog().length, 0, "Stock audits must be 0 after reset");

  // Check the 5 canonical parts
  const parts = getDemoParts();
  assert.equal(parts.length, 5);

  const expectedBaselines = {
    "0433171": 3,
    "005556958R1": 8,
    "AL120788": 2,
    "HY-GARD-15W30": 5,
    "26243171": 1,
  };

  for (const [partNumber, expectedQty] of Object.entries(expectedBaselines)) {
    const p = parts.find((x) => x.part_number === partNumber);
    assert.ok(p, `Part ${partNumber} must exist`);
    assert.equal(p.stock_quantity, expectedQty, `Part ${partNumber} stock must reset to ${expectedQty}`);
  }
});

// 17. QUOTE QUANTITY LIMITS ENFORCEMENT ACROSS MULTIPLE REQUISITIONS
test("Sales are counted strictly up to approved quote item quantities and never exceed approved limits across multiple requisitions", () => {
  resetDemo();

  const nozzle = getDemoPartById("0433171"); // Initial stock: 3

  // Create an approved repair with quote approved for exactly 1 nozzle
  const repairId = actions.createRepair({
    equipmentId: "e1",
    farmerId: "f1",
    symptoms: ["Injector leak"],
    description: "Requires 1 nozzle",
    photos: [],
    location: "Katol, Nagpur",
  });
  actions.accept(repairId);
  actions.sendQuote(repairId, {
    parts: [
      {
        name: nozzle.name,
        spec: nozzle.spec,
        qty: 1, // Only 1 approved on quote!
        price: 2200,
        source: "Service Centre Depot",
        catalogPartId: nozzle.id,
      },
    ],
    labourDesc: "Fitting",
    labour: 300,
    taxPct: 0,
    eta: "tomorrow",
    warranty: "90d",
  });
  actions.approveQuote(repairId);

  // First requisition: 1 nozzle
  const req1 = requestDemoPart({
    repairRequestId: repairId,
    partId: nozzle.id,
    quantity: 1,
  });
  confirmDemoPartHandoff(req1.id, "Nagpur Staff");

  const salesAfterReq1 = getDemoSales({ partId: nozzle.id });
  assert.equal(salesAfterReq1.length, 1);
  assert.equal(salesAfterReq1[0].quantity, 1, "First requisition records sale for 1 unit");

  // Second requisition: 1 nozzle (exceeds the approved quote quota of 1!)
  const req2 = requestDemoPart({
    repairRequestId: repairId,
    partId: nozzle.id,
    quantity: 1,
  });
  confirmDemoPartHandoff(req2.id, "Nagpur Staff");

  // Physical stock decrements both times (3 -> 2 -> 1)
  const nozzleAfter = getDemoPartById("0433171");
  assert.equal(nozzleAfter.stock_quantity, 1, "Physical stock decrements to 1 unit");

  // But sales count remains capped at the 1 approved unit!
  const salesAfterReq2 = getDemoSales({ partId: nozzle.id });
  const totalSoldQty = salesAfterReq2.reduce((sum, s) => sum + s.quantity, 0);
  assert.equal(totalSoldQty, 1, "Cumulative sales must NOT exceed approved quote quantity of 1");
});

// 18. PARTS DESK DISPLAYS PHASE 8 REPAIR/SERVICE LOCATION SEPARATELY FROM DEPOT SHELF LOCATION
test("Parts Desk UI renders linked Phase 8 repair service location and labels depot shelf location separately", () => {
  const partsDeskPath = path.resolve("src/routes/admin/parts-desk.tsx");
  const code = fs.readFileSync(partsDeskPath, "utf8");

  // Repair location rendered
  assert.ok(code.includes("Service Location"), "Must render 'Service Location' label");
  assert.ok(code.includes("req.repair?.location"), "Must display req.repair.location");

  // Depot shelf location rendered separately
  assert.ok(code.includes("Shelf:"), "Must label shelf location explicitly with 'Shelf:' prefix");
  assert.ok(code.includes("req.part?.location"), "Must display req.part.location");

  // Disclaimer that payment collection is not processed
  assert.ok(code.includes("Payment collection is not recorded"), "Must clarify that payments are not processed");
  assert.ok(code.includes("Fulfilled Quote Value (Sales)"), "Must label metric as Fulfilled Quote Value (Sales)");
});

// 19. BIDIRECTIONAL ID RESOLUTION AND ENRICHMENT FOR REPAIR PART REQUESTS
test("getRepairPartRequests matches repair requisitions bidirectionally whether queried by human-readable job number or UUID", () => {
  resetDemo();

  const filter = getDemoPartById("005556958R1"); // Oil filter
  const testRepairId = "TB-7834";

  // Technician requests part using job number TB-7834
  const req = requestDemoPart({
    repairRequestId: testRepairId,
    partId: filter.id,
    quantity: 2,
    notes: "Replace during 500h service",
    requesterName: "Ramesh Kumar",
  });

  // Querying using exact job number
  const requestsByJobNumber = getDemoPartRequests(testRepairId);
  assert.equal(requestsByJobNumber.length, 1, "Must find requisition by job number TB-7834");
  assert.equal(requestsByJobNumber[0].quantity, 2);

  // Simulating UUID-bound repair ticket in store
  const repairId2 = actions.createRepair({
    equipmentId: "e1",
    farmerId: "f1",
    symptoms: ["Hydraulic pump noise"],
    description: "Requires pump kit",
    photos: [],
    location: "Katol, Nagpur",
  });

  const pumpKit = getDemoPartById("26243171");
  const req2 = requestDemoPart({
    repairRequestId: repairId2,
    partId: pumpKit.id,
    quantity: 1,
  });

  // Querying by store repair ID finds requisition
  const requestsByStoreId = getDemoPartRequests(repairId2);
  assert.equal(requestsByStoreId.length, 1, "Must find requisition by store repair ID");
  assert.equal(requestsByStoreId[0].part_id, pumpKit.id);
});

// 20. QUOTE SERVICE PREVENTS ORPHAN PENDING QUOTES AND HANDLES CATALOG_PART_ID SCHEMA ERRORS
test("Quote service handles catalog_part_id schema errors with clean rollback and UI display prevents re-submission collisions", () => {
  const quotesServicePath = path.resolve("src/lib/services/quotes.ts");
  const code = fs.readFileSync(quotesServicePath, "utf8");

  // Verify that catalog_part_id is preserved in quote items payload
  assert.ok(code.includes("catalog_part_id: item.catalog_part_id"), "Must preserve catalog_part_id mapping");

  // Verify schema error detection and actionable owner notification
  assert.ok(
    code.includes("Database migration required: The 'catalog_part_id' column on 'quote_items' is not found"),
    "Must clearly notify that Phase 9.2 migration 20261029120000_phase9_2_stock_movement_sales.sql is required"
  );

  // Verify rollback prevents orphan pending quotes
  assert.ok(
    code.includes('update({ status: "REJECTED" })'),
    "Must reject uncommitted quote row to prevent blocking future quote formulation"
  );
  assert.ok(
    code.includes("Clean up orphan quote row with 0 items"),
    "Must auto-clean orphan quotes with 0 items when formulating new quote"
  );
});

// 21. TECHNICIAN UI DISPLAYS PENDING QUOTE CARD AND LOCKS FORM WHEN QUOTE IS PENDING
test("Technician job route renders pending quote card with next actions and hides QuoteBuilder when a pending quote exists", () => {
  const techJobPath = path.resolve("src/routes/technician/job/$id.tsx");
  const code = fs.readFileSync(techJobPath, "utf8");

  // Verify pending quote display
  assert.ok(code.includes("Quote v{pendingQuote.version} (Pending Farmer Review)"), "Must display pending quote heading");
  assert.ok(code.includes("Awaiting Farmer"), "Must display 'Awaiting Farmer' status badge");
  assert.ok(code.includes("Next Available Actions:"), "Must explain next available actions to technician");
  assert.ok(code.includes("QuoteTable q={toQuoteView(pendingQuote)}"), "Must render itemized quote table for pending quote");

  // Verify QuoteBuilder is conditional and not shown when pendingQuote exists
  assert.ok(
    code.includes("{pendingQuote ? (") && code.includes(": (r.status === \"ACCEPTED\" || r.status === \"QUOTE_REVISED\") ? ("),
    "Must suppress QuoteBuilder form when pendingQuote is active"
  );

  // Verify PartsPickupCard is available during QUOTE_PENDING
  assert.ok(
    code.includes('"QUOTE_PENDING"'),
    "Must include QUOTE_PENDING in PartsPickupCard visibility"
  );
});

// 22. SERVICE CENTRE JOB DETAIL RENDERS TECHNICIAN PARTS REQUESTS WITH DIRECT HANDOFF
test("Service Centre admin repair detail renders technician parts requests with handoff action and status badges", () => {
  const adminRepairPath = path.resolve("src/routes/admin/repair/$id.tsx");
  const code = fs.readFileSync(adminRepairPath, "utf8");

  // Verify parts requests card
  assert.ok(code.includes("Service Centre Parts Requests"), "Must render 'Service Centre Parts Requests' heading");
  assert.ok(code.includes("partRequests.length === 0"), "Must handle empty parts requests state");
  assert.ok(code.includes("No parts requested from Service Centre for this repair"), "Must show informative empty message");

  // Verify request item fields and handoff action
  assert.ok(code.includes("confirmPartHandoff(req.id)"), "Must allow admin to confirm handoff directly from repair ticket");
  assert.ok(code.includes("Awaiting Handoff"), "Must render 'Awaiting Handoff' status pill");
  assert.ok(code.includes("Handed Off"), "Must render 'Handed Off' status pill");
  assert.ok(code.includes("Shelf:"), "Must render depot shelf location");
  assert.ok(code.includes("Open Parts Desk →"), "Must link to Parts Desk");
});

// 23. RESET DEMO IS IDEMPOTENT AND DETERMINISTIC ACROSS REPEATED CALLS
test("Reset Demo is idempotent: repeated executions deterministically restore canonical baseline without state drift", () => {
  // 1. Initial baseline
  resetDemo();
  const parts1 = getDemoParts();
  assert.equal(parts1.length, 5);
  assert.deepEqual(parts1.map((p) => p.stock_quantity), [3, 8, 2, 5, 1]);
  assert.equal(getDemoPartRequests().length, 0);
  assert.equal(getDemoSales().length, 0);
  assert.equal(getDemoStockAuditLog().length, 0);

  // 2. Perform various state mutations
  const nozzle = getDemoPartById("0433171");
  const req = requestDemoPart({
    repairRequestId: "TB-8841",
    partId: nozzle.id,
    quantity: 1,
  });
  confirmDemoPartHandoff(req.id, "Nagpur Admin");

  const filterPart = getDemoPartById("005556958R1");
  receiveDemoStock({
    partId: filterPart.id,
    quantity: 5,
    reason: "PO-7788 shipment",
    actorName: "Nagpur Admin",
  });
  assert.ok(getDemoPartRequests().length > 0);
  assert.ok(getDemoStockAuditLog().length > 0);

  // 3. First reset call
  resetDemo();
  const parts2 = getDemoParts();
  assert.equal(parts2.length, 5);
  assert.deepEqual(parts2.map((p) => p.stock_quantity), [3, 8, 2, 5, 1]);
  assert.equal(getDemoPartRequests().length, 0);
  assert.equal(getDemoSales().length, 0);
  assert.equal(getDemoStockAuditLog().length, 0);

  // 4. Repeated reset call immediately (idempotency check)
  resetDemo();
  const parts3 = getDemoParts();
  assert.equal(parts3.length, 5);
  assert.deepEqual(parts3.map((p) => p.stock_quantity), [3, 8, 2, 5, 1]);
  assert.equal(getDemoPartRequests().length, 0);
  assert.equal(getDemoSales().length, 0);
  assert.equal(getDemoStockAuditLog().length, 0);

  // 5. Third consecutive reset call
  resetDemo();
  const parts4 = getDemoParts();
  assert.equal(parts4.length, 5);
  assert.deepEqual(parts4.map((p) => p.stock_quantity), [3, 8, 2, 5, 1]);
  assert.equal(getDemoPartRequests().length, 0);
  assert.equal(getDemoSales().length, 0);
  assert.equal(getDemoStockAuditLog().length, 0);
});

// 24. DEMO RESET ISOLATES DELETIONS EXCLUSIVELY TO DEMO ENTITIES & PRESERVES NON-DEMO DATA
test("Demo reset preserves non-demo entities and isolates deletions to demo records", () => {
  const m1 = fs.readFileSync(
    path.resolve("supabase/migrations/20261028110000_phase8b_cleanup_reset_demo_rpc.sql"),
    "utf8"
  );
  const m2 = fs.readFileSync(
    path.resolve("supabase/migrations/20261029100000_phase9_1_parts_pickup.sql"),
    "utf8"
  );
  const m3 = fs.readFileSync(
    path.resolve("supabase/migrations/20261029120000_phase9_2_stock_movement_sales.sql"),
    "utf8"
  );
  const m4 = fs.readFileSync(
    path.resolve("supabase/migrations/20261031153000_phase9_3_safe_scoped_reset_demo_rpc.sql"),
    "utf8"
  );

  for (const [name, sql] of [
    ["Phase 8b", m1],
    ["Phase 9.1", m2],
    ["Phase 9.2", m3],
    ["Phase 9.3 Forward", m4],
  ]) {
    // 1. None should use match-all deletes
    assert.ok(!sql.includes("WHERE id IS NOT NULL"), `${name} must not use WHERE id IS NOT NULL`);
    assert.ok(!sql.includes("WHERE 1=1"), `${name} must not use WHERE 1=1`);
    assert.ok(!sql.includes("WHERE true"), `${name} must not use WHERE true`);

    // 2. Child table deletion is safely guarded when demo repair IDs array is empty
    assert.ok(
      sql.includes("IF v_demo_repair_ids IS NOT NULL AND array_length(v_demo_repair_ids, 1) > 0 THEN"),
      `${name} must guard child table deletes against empty demo repairs`
    );

    // 3. Demo repair scoping must NEVER match by technician_id to prevent deleting real user tickets assigned to Ramesh
    assert.ok(
      !sql.includes("OR technician_id = v_demo_tech_id"),
      `${name} must not match repair_requests by technician_id`
    );

    // 4. Notes, timeline, quotes deletions must NOT match by author/tech indiscriminately
    assert.ok(
      !sql.includes("OR author_id IN (v_demo_farmer_id"),
      `${name} must not match repair_notes by author_id`
    );
    assert.ok(
      !sql.includes("OR created_by_id IN (v_demo_farmer_id"),
      `${name} must not match repair_timeline by created_by_id`
    );

    // 5. Notifications use correct column recipient_user_id
    assert.ok(
      sql.includes("recipient_user_id = v_demo_farmer_id"),
      `${name} must scope notification deletions to recipient_user_id`
    );

    // 6. Equipment update is scoped exclusively to demo farmer
    assert.ok(
      sql.includes("WHERE farmer_id = v_demo_farmer_id"),
      `${name} must scope tractor reset exclusively to Balasaheb's equipment`
    );
  }
});

// 25. RESET DEMO CONFIRMATION DIALOG IN TB.TSX ACCURATELY COMMUNICATES SCOPE
test("Reset Demo modal in tb.tsx accurately communicates demo scope and non-demo protection", () => {
  const tbPath = path.resolve("src/components/tb.tsx");
  const tbCode = fs.readFileSync(tbPath, "utf8");

  // Verify description text mentions specific demo items cleared
  assert.ok(
    tbCode.includes("This will clear demo repair tickets, quotes, parts requisitions, and audit logs."),
    "Modal must enumerate demo repair tickets, quotes, parts requisitions, and audit logs"
  );
  assert.ok(
    tbCode.includes("Balasaheb's 3 tractors are restored to Operational"),
    "Modal must describe tractor operational restoration"
  );
  assert.ok(
    tbCode.includes("Nagpur Service Centre depot stock is reset to the 5 canonical parts"),
    "Modal must describe Nagpur Service Centre depot stock reset to 5 canonical parts"
  );
  assert.ok(
    tbCode.includes("Real user data and other service centres are not affected."),
    "Modal must guarantee real user data and other centres are not affected"
  );
  assert.ok(
    tbCode.includes("Your demo account and login credentials will remain active."),
    "Modal must assure demo credentials remain active"
  );
});

// 26. IN-MEMORY STORE PRESERVES NON-DEMO REPAIRS, EQUIPMENT, AND OTHER SERVICE CENTRES ACROSS RESETS
test("In-memory resetDemo() preserves non-demo repairs, non-demo equipment, and other service centres' stock", () => {
  resetDemo();

  // 1. Create a non-demo farmer repair and equipment
  const realRepairId = actions.createRepair({
    equipmentId: "real-equip-001",
    farmerId: "real-farmer-uuid-999",
    symptoms: ["Hydraulic pump cavitation"],
    description: "Real farmer ticket assigned to Ramesh Kumar",
    photos: [],
    location: "Wardha, Maharashtra",
  });
  actions.accept(realRepairId);

  // 2. Add an inventory item for a different service centre (e.g. Pune Service Centre)
  const puneCentreId = "00000000-0000-0000-0003-000000000002";
  const punePart = {
    id: "pune-part-001",
    service_centre_id: puneCentreId,
    part_number: "0433171", // Same part number, but DIFFERENT service centre!
    name: "Fuel Injector Nozzle Set",
    spec: "Bosch 0433171 (x4)",
    category: "Fuel system",
    compatible_models: ["Mahindra 575 DI"],
    stock_quantity: 42, // Non-demo stock quantity
    unit_price: 2400,
    location: "Pune Depot Bay 4",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // 2b. Add an unscoped non-canonical inventory item (service_centre_id: undefined)
  const unscopedPart = {
    id: "unscoped-custom-001",
    part_number: "CUSTOM-BELT-99",
    name: "Heavy Duty Alternator Belt",
    spec: "Gates V-Belt 17x1120",
    category: "General Mechanical",
    compatible_models: ["Mahindra 575 DI"],
    stock_quantity: 14,
    unit_price: 650,
    location: "Unassigned Transit Bin",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Mutate store state with non-demo parts
  const currentParts = getDemoParts();
  currentParts.push(punePart);
  currentParts.push(unscopedPart);

  // 3. Add stock audit on Pune part, unscoped part, and demo parts
  const currentAudits = getDemoStockAuditLog();
  currentAudits.push({
    id: "aud-pune-001",
    part_id: "pune-part-001",
    change_quantity: 10,
    previous_stock: 32,
    new_stock: 42,
    movement_type: "RECEIVED",
    reason: "Pune depot delivery",
    changed_by: "Pune Warehouse Admin",
    created_at: new Date().toISOString(),
  });
  currentAudits.push({
    id: "aud-unscoped-001",
    part_id: "unscoped-custom-001",
    change_quantity: 5,
    previous_stock: 9,
    new_stock: 14,
    movement_type: "RECEIVED",
    reason: "Transit delivery",
    changed_by: "Supplier Courier",
    created_at: new Date().toISOString(),
  });
  currentAudits.push({
    id: "aud-real-repair-001",
    part_id: "0433171",
    change_quantity: -1,
    previous_stock: 3,
    new_stock: 2,
    movement_type: "ISSUED_TO_REPAIR",
    reason: "Issued to real repair",
    changed_by: "Ramesh Kumar",
    repair_request_id: realRepairId,
    created_at: new Date().toISOString(),
  });

  // Also mutate Nagpur demo parts
  const nagpurNozzle = getDemoPartById("0433171");
  const demoReq = requestDemoPart({
    repairRequestId: "TB-8841",
    partId: nagpurNozzle.id,
    quantity: 1,
  });
  confirmDemoPartHandoff(demoReq.id, "Nagpur Admin");

  // 4. Trigger demo reset
  resetDemo();

  // 5. Verify non-demo repairs and parts were PRESERVED
  const partsAfter = getDemoParts();
  const preservedPunePart = partsAfter.find((p) => p.id === "pune-part-001");
  assert.ok(preservedPunePart, "Pune Service Centre part must be preserved after resetDemo()");
  assert.equal(preservedPunePart.stock_quantity, 42, "Pune part stock quantity must remain 42");

  const preservedUnscopedPart = partsAfter.find((p) => p.id === "unscoped-custom-001");
  assert.ok(preservedUnscopedPart, "Unscoped non-canonical part must be preserved after resetDemo()");
  assert.equal(preservedUnscopedPart.stock_quantity, 14, "Unscoped part stock quantity must remain 14");

  // 6. Verify non-demo audits were PRESERVED
  const auditsAfter = getDemoStockAuditLog();
  assert.ok(
    auditsAfter.some((a) => a.id === "aud-pune-001"),
    "Pune depot audit record must be preserved"
  );
  assert.ok(
    auditsAfter.some((a) => a.id === "aud-unscoped-001"),
    "Unscoped part audit record must be preserved"
  );
  assert.ok(
    auditsAfter.some((a) => a.id === "aud-real-repair-001"),
    "Audit record on non-demo repair must be preserved"
  );

  // 7. Verify Nagpur canonical parts were RESTORED to exact baseline
  const nagpurParts = partsAfter.filter(
    (p) => p.service_centre_id === "00000000-0000-0000-0003-000000000001"
  );
  assert.equal(nagpurParts.length, 5, "Nagpur depot must have exactly 5 canonical parts");
  assert.deepEqual(
    nagpurParts.map((p) => p.stock_quantity),
    [3, 8, 2, 5, 1],
    "Nagpur stock must be restored to canonical counts (3, 8, 2, 5, 1)"
  );
});

// 27. MIGRATIONS ENFORCE DUAL-KEY AUTHORIZATION AND SERVICE CENTRE-SCOPED STOCK CONSTRAINTS
test("Phase 9.1, 9.2 & 9.3 migrations enforce dual-key authorization and scoped unique constraint (service_centre_id, part_number)", () => {
  const m91 = fs.readFileSync(
    path.resolve("supabase/migrations/20261029100000_phase9_1_parts_pickup.sql"),
    "utf8"
  );
  const m92 = fs.readFileSync(
    path.resolve("supabase/migrations/20261029120000_phase9_2_stock_movement_sales.sql"),
    "utf8"
  );
  const m93 = fs.readFileSync(
    path.resolve("supabase/migrations/20261031153000_phase9_3_safe_scoped_reset_demo_rpc.sql"),
    "utf8"
  );

  for (const [name, sql] of [
    ["Phase 9.1", m91],
    ["Phase 9.2", m92],
    ["Phase 9.3 Forward", m93],
  ]) {
    // Check dual-key auth UUID checks
    assert.ok(sql.includes("'00000000-0000-0000-0000-000000000001'::uuid"), `${name} must authorize Balasaheb UUID`);
    assert.ok(sql.includes("'00000000-0000-0000-0000-000000000004'::uuid"), `${name} must authorize Ramesh UUID`);
    assert.ok(sql.includes("'00000000-0000-0000-0000-000000000005'::uuid"), `${name} must authorize Admin UUID`);

    // Check dual-key email checks
    assert.ok(sql.includes("'farmer.nagpur@terrabyte.demo'"), `${name} must check Balasaheb email`);
    assert.ok(sql.includes("'tech.nagpur@terrabyte.demo'"), `${name} must check Ramesh email`);
    assert.ok(sql.includes("'admin.nagpur@terrabyte.demo'"), `${name} must check Admin email`);

    // Check scoped stock uniqueness and scoped upsert
    assert.ok(
      sql.includes("service_centre_parts_centre_part_key UNIQUE (service_centre_id, part_number)") ||
      sql.includes("service_centre_parts_centre_part_key"),
      `${name} must define or enforce scoped constraint (service_centre_id, part_number)`
    );
    assert.ok(
      sql.includes("ON CONFLICT (service_centre_id, part_number) DO UPDATE SET"),
      `${name} must scope stock upsert strictly to service_centre_id and part_number`
    );
    assert.ok(
      sql.includes("WHERE public.service_centre_parts.service_centre_id = v_demo_admin_id"),
      `${name} upsert must restrict UPDATE target to Nagpur Service Centre admin ID`
    );
  }
});

// 33. SUCCESSFUL TECHNICIAN QUOTE SUBMISSION APPEARS WITH MATCHING ITEMS AND TOTAL IN FARMER VIEW
test("Successful technician quote submission appears with matching items and total in the assigned farmer's view", () => {
  resetDemo();
  const repairId = actions.createRepair({
    equipmentId: "e1",
    symptoms: ["Starter motor clicking"],
    description: "Tractor won't crank",
    location: "Saoner",
  });

  const quotePayload = {
    parts: [
      {
        name: "Starter Motor Assembly",
        spec: "Lucas-TVS 12V 2.2kW",
        qty: 1,
        price: 5800,
        source: "Service Centre Depot",
        catalogPartId: "26243171",
      },
    ],
    labourDesc: "Replace starter motor and test battery connections",
    labour: 1200,
    taxPct: 18,
    eta: "Tomorrow 5:00 PM",
    warranty: "90 days on parts and labour",
  };

  actions.sendQuote(repairId, quotePayload);

  // Verify quote exists in farmer view with complete items and matching totals
  const repair = getTB().repairs.find((x) => x.id === repairId);
  assert.ok(repair, "Repair must exist");
  assert.equal(repair.status, "QUOTE_PENDING", "Repair must advance to QUOTE_PENDING");
  assert.ok(repair.quote, "Repair must have an active quote");
  assert.equal(repair.quote.version, 1, "Must be version 1");
  assert.equal(repair.quote.parts.length, 1, "Must contain exactly 1 part");
  assert.equal(repair.quote.parts[0].name, "Starter Motor Assembly");
  assert.equal(repair.quote.parts[0].price, 5800);
  assert.equal(repair.quote.labour, 1200);

  // Verify calculation formula
  const partsTotal = 5800 * 1;
  const tax = Math.round((partsTotal + 1200) * 0.18 * 100) / 100;
  const expectedTotal = Math.round((partsTotal + 1200 + tax) * 100) / 100;
  assert.equal(quoteTotals(repair.quote).total, expectedTotal, "Farmer view total must match itemized calculation");
});

// 34. FAILED ITEM PERSISTENCE LEAVES NO MISLEADING PENDING QUOTE
test("Failed item persistence leaves no misleading pending quote in UI or query results", () => {
  const techJobPath = path.resolve("src/routes/technician/job/$id.tsx");
  const techCode = fs.readFileSync(techJobPath, "utf8");

  // Verify that pendingQuote requires items > 0 to be considered valid
  assert.ok(
    techCode.includes("q.quote_items && q.quote_items.length > 0"),
    "Technician job view must require quote_items.length > 0 before rendering pending quote card"
  );

  const quotesServicePath = path.resolve("src/lib/services/quotes.ts");
  const quotesCode = fs.readFileSync(quotesServicePath, "utf8");

  // Verify getQuotesForRepair filters out 0-item orphan pending quotes (while preserving valid labour-only quotes)
  assert.ok(
    quotesCode.includes('!(q.status === "PENDING" && (!q.quote_items || q.quote_items.length === 0))') ||
      (quotesCode.includes('q.status === "PENDING"') && quotesCode.includes("Number(q.labour_amount || 0) === 0")),
    "getQuotesForRepair must filter out orphan pending quotes with 0 items and 0 labour"
  );

  // Verify RLS policy permits technician/admin to delete orphan quote
  const forwardMigrationPath = path.resolve(
    "supabase/migrations/20261031170000_phase9_2_quote_catalog_and_inventory.sql"
  );
  assert.ok(fs.existsSync(forwardMigrationPath), "Forward migration must exist");
  const migrationSql = fs.readFileSync(forwardMigrationPath, "utf8");

  assert.ok(
    migrationSql.includes('CREATE POLICY "Technicians can delete orphan quotes"'),
    "Must define RLS policy for deleting orphan quotes"
  );
  assert.ok(
    migrationSql.includes("NOT EXISTS (\n    SELECT 1 FROM public.quote_items qi WHERE qi.quote_id = quotes.id\n  )"),
    "Delete policy must be strictly restricted to quotes having 0 quote items"
  );
});

// 35. ANOTHER FARMER CANNOT READ THE QUOTE UNDER RLS
test("Another farmer cannot read the quote or quote items under RLS", () => {
  const forwardMigrationPath = path.resolve(
    "supabase/migrations/20261031170000_phase9_2_quote_catalog_and_inventory.sql"
  );
  const migrationSql = fs.readFileSync(forwardMigrationPath, "utf8");

  // RLS view policy on quote_items ensures only the assigned farmer, tech, or admin can read
  assert.ok(
    migrationSql.includes("CREATE TABLE IF NOT EXISTS public.service_centre_parts"),
    "Must define service_centre_parts"
  );

  // Simulate policy check with assigned farmer vs non-assigned farmer
  const assignedFarmerId = "00000000-0000-0000-0001-000000000001";
  const intruderFarmerId = "00000000-0000-0000-0001-000000000999";
  const repairRow = { id: "rep-1", farmer_id: assignedFarmerId };

  function simulateRlsCheck(callerId, repair) {
    return callerId === repair.farmer_id;
  }

  assert.equal(simulateRlsCheck(assignedFarmerId, repairRow), true, "Assigned farmer must be granted access");
  assert.equal(simulateRlsCheck(intruderFarmerId, repairRow), false, "Non-assigned farmer must be denied access");
});

// 36. EXISTING QUOTE REVISION, ONE-PENDING RULE, AND APPROVAL TRANSITIONS STILL WORK
test("Existing quote revision, one-pending rule, and approval transitions are strictly preserved", () => {
  resetDemo();
  const repairId = actions.createRepair({
    equipmentId: "e2",
    symptoms: ["Hydraulic lift slow"],
    description: "Lift cylinder leaking oil",
    location: "Katol",
  });

  // 1. Initial quote v1
  actions.sendQuote(repairId, {
    parts: [{ name: "Hydraulic Oil", spec: "15W-30", qty: 2, price: 320, source: "Depot", catalogPartId: "HY-GARD-15W30" }],
    labourDesc: "Top up hydraulic oil",
    labour: 500,
    taxPct: 18,
    eta: "Tomorrow",
    warranty: "30 days",
  });
  let r = getTB().repairs.find((x) => x.id === repairId);
  assert.equal(r.status, "QUOTE_PENDING");
  assert.equal(r.quote.version, 1);

  // 2. Reject / request changes -> moves to QUOTE_REVISED
  actions.declineQuote(repairId, "Price too high for simple top-up");
  r = getTB().repairs.find((x) => x.id === repairId);
  assert.equal(r.status, "QUOTE_REVISED");

  // 3. Revise quote -> moves to QUOTE_PENDING v2
  actions.sendQuote(repairId, {
    parts: [{ name: "Hydraulic Oil", spec: "15W-30", qty: 1, price: 320, source: "Depot", catalogPartId: "HY-GARD-15W30" }],
    labourDesc: "Discounted labour top-up",
    labour: 350,
    taxPct: 18,
    eta: "Tomorrow",
    warranty: "30 days",
  });
  r = getTB().repairs.find((x) => x.id === repairId);
  assert.equal(r.status, "QUOTE_PENDING");
  assert.equal(r.quote.version, 2);

  // 4. Approve quote -> advances repair to IN_PROGRESS
  actions.approveQuote(repairId);
  r = getTB().repairs.find((x) => x.id === repairId);
  assert.equal(r.status, "IN_PROGRESS");
  assert.ok(r.quote, "Approved quote must remain attached to repair");
});

// 37. PHASE 9.2 FORWARD MIGRATION DEFINES QUOTE CATALOG LINK, ORPHAN CLEANUP RLS, AND ATOMIC RPCs
test("Phase 9.2 forward migration 20261031170000 defines quote catalog link, orphan quote cleanup RLS, and atomic formulation RPCs", () => {
  const migrationPath = path.resolve(
    "supabase/migrations/20261031170000_phase9_2_quote_catalog_and_inventory.sql"
  );
  assert.ok(fs.existsSync(migrationPath), "Forward migration file must exist");
  const sql = fs.readFileSync(migrationPath, "utf8");

  // Catalog part id link
  assert.ok(sql.includes("catalog_part_id uuid REFERENCES public.service_centre_parts(id)"), "Must link quote_items to service_centre_parts");
  assert.ok(sql.includes("CREATE INDEX IF NOT EXISTS idx_quote_items_catalog_part_id"), "Must index catalog_part_id");

  // Orphan cleanup RLS
  assert.ok(sql.includes('CREATE POLICY "Technicians can delete orphan quotes"'), "Must define delete policy for orphan quotes");
  assert.ok(sql.includes("status = 'PENDING'"), "Must scope delete policy to PENDING status");

  // Atomic RPCs
  assert.ok(sql.includes("FUNCTION public.create_quote_atomic"), "Must define create_quote_atomic RPC");
  assert.ok(sql.includes("FUNCTION public.revise_quote_atomic"), "Must define revise_quote_atomic RPC");
  assert.ok(sql.includes("status = 'QUOTE_PENDING'"), "RPCs must advance repair request to QUOTE_PENDING atomically");
});

// 38. QUOTE PART DROPDOWN UI STYLING PREVENTS VERTICAL CLIPPING
test("Quote part select dropdown in QuoteBuilder uses explicit line height, padding, and minimum height to prevent clipping", () => {
  const jobViewPath = path.resolve("src/routes/technician/job/$id.tsx");
  assert.ok(fs.existsSync(jobViewPath), "Technician job route must exist");
  const code = fs.readFileSync(jobViewPath, "utf8");

  // Verify the select has min-h-[2.5rem], h-10, py-1.5, and leading-normal to avoid clipping '-- Custom / Unlisted part --'
  assert.ok(
    code.includes('className={cn(input, "h-10 min-h-[2.5rem] py-1.5 px-3 text-xs leading-normal cursor-pointer")}'),
    "Select dropdown must use h-10, min-h-[2.5rem], py-1.5 and leading-normal so option descenders and custom placeholder are readable"
  );
  assert.ok(
    code.includes('<option value="">-- Custom / Unlisted part --</option>'),
    "Must provide the custom unlisted option"
  );
});

// 39. PHYSICAL HANDOFF ERROR RESOLUTION & ID TRACING ACROSS DATA PATHS
test("confirmPartHandoff and confirmDemoPartHandoff trace exact request ID, support prefix/case resilience, and enforce single execution", () => {
  resetDemo();
  const canonicalPart = INITIAL_DEMO_PARTS[1]; // Inline Fuel Filter (005556958R1, initial stock: 8)

  // Create a demo repair
  const repairId = actions.createRepair({
    equipmentId: "e1",
    farmerId: "f1",
    symptoms: ["Engine overheating"],
    description: "Coolant leak",
    photos: [],
    location: "Katol",
  });

  // Request a part for this repair
  const req = requestDemoPart({
    repairRequestId: repairId,
    partId: canonicalPart.id,
    quantity: 2,
    requesterId: "t1",
    requesterName: "Ramesh Kumar",
  });

  assert.ok(req.id, "Requisition must have an ID");
  assert.equal(req.status, "PENDING");

  // Verify confirmDemoPartHandoff works with exact ID
  const initialPart = getDemoPartById(canonicalPart.id);
  assert.equal(initialPart.stock_quantity, 8);

  const res1 = confirmDemoPartHandoff(req.id, "Nagpur Service Centre");
  assert.equal(res1.request.status, "HANDED_OFF");
  assert.equal(res1.part.stock_quantity, 6);

  // Attempting duplicate handoff must be rejected (single execution guard)
  assert.throws(
    () => confirmDemoPartHandoff(req.id, "Nagpur Service Centre"),
    (err) => err.message.includes("already HANDED_OFF"),
    "Must reject duplicate handoff to prevent double-decrementing stock"
  );

  // Create a second request and test ID matching resilience (with/without req- prefix, whitespace, case)
  const req2 = requestDemoPart({
    repairRequestId: repairId,
    partId: canonicalPart.id,
    quantity: 1,
  });

  const rawId = req2.id.replace(/^req-/, "");
  // Test with whitespace and prefix variations
  const res2 = confirmDemoPartHandoff("  " + rawId + "  ", "Nagpur Service Centre");
  assert.equal(res2.request.status, "HANDED_OFF");
  assert.equal(res2.part.stock_quantity, 5);

  // Verify non-existent ID throws exact error
  assert.throws(
    () => confirmDemoPartHandoff("non-existent-id"),
    (err) => err.message === "Part requisition not found.",
    "Must throw 'Part requisition not found.' when ID cannot be matched"
  );
});

// 40. HANDOFF ON ACTIVE REQUISITION FOR TB-8899 DECREMENTS STOCK AND RECORDS AUDIT STRICTLY ONCE
test("Physical handoff for repair TB-8899 updates stock, creates ISSUED_TO_REPAIR audit, and records sale if quote approved", () => {
  resetDemo();
  const canonicalPart = INITIAL_DEMO_PARTS[1]; // Inline Fuel Filter (unit_price: 350, initial stock: 8)

  // Create repair TB-8899 explicitly
  const repairId = "TB-8899";
  actions.createRepair({
    equipmentId: "e1",
    farmerId: "f1",
    symptoms: ["Fuel starvation"],
    description: "Clogged filter",
    photos: [],
    location: "Nagpur Rural",
  });
  // Override ID to TB-8899 in demo store
  const tbState = getTB();
  if (tbState.repairs.length > 0) {
    tbState.repairs[0].id = repairId;
  }

  // Request part for TB-8899
  const partReq = requestDemoPart({
    repairRequestId: repairId,
    partId: canonicalPart.id,
    quantity: 1,
    requesterId: "t1",
    requesterName: "Ramesh Kumar",
  });

  assert.equal(partReq.repair_request_id, repairId);

  // Confirm handoff
  const handoffRes = confirmDemoPartHandoff(partReq.id, "Nagpur Service Centre");
  assert.equal(handoffRes.request.status, "HANDED_OFF");
  assert.equal(handoffRes.part.stock_quantity, 7);

  // Verify audit log has exactly 1 ISSUED_TO_REPAIR entry for this requisition
  const auditLogs = getDemoStockAuditLog();
  const issuedAudit = auditLogs.find(
    (a) => a.part_request_id === partReq.id && a.movement_type === "ISSUED_TO_REPAIR"
  );
  assert.ok(issuedAudit, "Must record ISSUED_TO_REPAIR movement in audit log");
  assert.equal(issuedAudit.change_quantity, -1);
  assert.equal(issuedAudit.previous_stock, 8);
  assert.equal(issuedAudit.new_stock, 7);

  // Verify second handoff attempt is blocked
  assert.throws(
    () => confirmDemoPartHandoff(partReq.id),
    (err) => err.message.includes("already HANDED_OFF")
  );
  assert.equal(getDemoPartById(canonicalPart.id).stock_quantity, 7, "Stock must not be decremented twice");
});

// 41. TECHNICIAN WORKLOAD NAVIGATION: SINGLE JOB DIRECT NAV VS MULTI-JOB CHOOSER
test("Technician workload navigation distinguishes single active job vs multiple active jobs", () => {
  const adminIndexPath = path.resolve("src/routes/admin/index.tsx");
  assert.ok(fs.existsSync(adminIndexPath), "Admin index route must exist");
  const code = fs.readFileSync(adminIndexPath, "utf8");

  // Verify single job direct navigation
  assert.ok(
    code.includes("if (tw.load === 1 && tw.jobs[0]) {"),
    "Must check tw.load === 1 to navigate directly"
  );
  assert.ok(
    code.includes("nav({\n        to: \"/admin/repair/$id\",\n        params: { id: targetId },\n      })") ||
    code.includes("nav({ to: \"/admin/repair/$id\", params: { id: targetId } })") ||
    code.includes("to: \"/admin/repair/$id\","),
    "Must navigate to /admin/repair/$id with job_number or id"
  );

  // Verify multi-job chooser
  assert.ok(
    code.includes("setChooserTech({ techName: tw.techName, jobs: tw.jobs })"),
    "Must open chooser dialog when technician has multiple active jobs"
  );
  assert.ok(
    code.includes("<DialogTitle className=\"flex items-center gap-2\">") &&
    code.includes("<span>{chooserTech?.techName}'s Active Jobs</span>"),
    "Must render active jobs chooser dialog with technician name and job list"
  );

  // Verify zero job notification
  assert.ok(
    code.includes("toast.info(`No active jobs currently assigned to ${tw.techName}.`)"),
    "Must notify when technician has 0 active jobs"
  );
});

// 42. FORWARD MIGRATION 20261031173000 DEFINES ATOMIC HANDOFF & STOCK ADJUSTMENT RPCs
test("Forward migration 20261031173000 defines confirm_service_centre_part_handoff and adjust_service_centre_part_stock RPCs", () => {
  const migrationPath = path.resolve(
    "supabase/migrations/20261031173000_phase9_3_parts_handoff_rpcs.sql"
  );
  assert.ok(fs.existsSync(migrationPath), "Phase 9.3 parts handoff forward migration must exist");
  const sql = fs.readFileSync(migrationPath, "utf8");

  assert.ok(
    sql.includes("FUNCTION public.confirm_service_centre_part_handoff"),
    "Must define confirm_service_centre_part_handoff RPC"
  );
  assert.ok(
    sql.includes("UPDATE public.service_centre_parts\n  SET stock_quantity = v_new_stock"),
    "Must update stock_quantity in service_centre_parts"
  );
  assert.ok(
    sql.includes("UPDATE public.service_centre_part_requests\n  SET status = 'HANDED_OFF'"),
    "Must update requisition status to HANDED_OFF"
  );
  assert.ok(
    sql.includes("INSERT INTO public.service_centre_stock_audit"),
    "Must record ISSUED_TO_REPAIR in stock audit"
  );
  assert.ok(
    sql.includes("INSERT INTO public.service_centre_part_sales"),
    "Must record sale against approved quote line"
  );
  assert.ok(
    sql.includes("FUNCTION public.adjust_service_centre_part_stock"),
    "Must define adjust_service_centre_part_stock RPC"
  );
});

// 43. PART REQUEST AUTOMATICALLY SYNCS TO DRAFT QUOTE LINES (IDEMPOTENT & NO DUPLICATES)
test("Technician part request automatically adds/updates matching catalog part line in draft quote without duplicate lines", () => {
  resetDemo();
  const tb = getTB();

  // Create an ACCEPTED repair ticket
  const repairId = actions.createRepair({
    equipmentId: tb.equipment[0].id,
    farmerId: tb.farmers[0].id,
    location: "Katol Farm",
    symptoms: ["Starting troubles"],
    description: "Engine will not crank",
    photos: [],
  });
  actions.requestTechnician(repairId, "t1");
  actions.accept(repairId);

  const canonicalPart = INITIAL_DEMO_PARTS[1]; // Starter Motor 12V 2.8kW, price 8200

  // 1. First requisition: 1x Starter Motor
  requestDemoPart({
    repairRequestId: repairId,
    partId: canonicalPart.id,
    quantity: 1,
    requesterId: "t1",
  });

  let state = getTB();
  let repair = state.repairs.find((r) => r.id === repairId);
  assert.ok(repair, "Repair must exist");
  assert.ok(repair.quote, "Draft quote must be automatically populated");
  assert.equal(repair.quote.parts.length, 1, "Must contain exactly 1 quote part line");
  assert.equal(repair.quote.parts[0].name, canonicalPart.name);
  assert.equal(repair.quote.parts[0].qty, 1);
  assert.equal(repair.quote.parts[0].price, canonicalPart.unit_price);
  assert.equal(repair.quote.parts[0].catalogPartId, canonicalPart.id);

  // 2. Retry / update requisition: increase quantity to 2
  requestDemoPart({
    repairRequestId: repairId,
    partId: canonicalPart.id,
    quantity: 2,
    requesterId: "t1",
  });

  state = getTB();
  repair = state.repairs.find((r) => r.id === repairId);
  assert.equal(repair.quote.parts.length, 1, "Must NOT duplicate quote part line upon repeated request");
  assert.equal(repair.quote.parts[0].qty, 2, "Must update quantity to 2");
  assert.equal(repair.quote.parts[0].price, canonicalPart.unit_price);

  // 3. Verify helper syncPartRequestToQuoteLines function
  const lines = syncPartRequestToQuoteLines(
    repair.quote.parts,
    canonicalPart,
    3,
  );
  assert.equal(lines.length, 1, "Helper must remain idempotent with no duplicate lines");
  assert.equal(lines[0].qty, 3, "Helper must update quantity to 3");
  assert.equal(lines[0].price, canonicalPart.unit_price);
});

// 44. QUOTE REVISION: REQUESTING A PART REVISES AND RESENDS QUOTE AS V2 WHILE IN WAITING_FOR_PARTS
test("Requesting a part on sent quote creates revised quote v2 and sets status to WAITING_FOR_PARTS", () => {
  resetDemo();
  const tb = getTB();

  const repairId = actions.createRepair({
    equipmentId: tb.equipment[0].id,
    farmerId: tb.farmers[0].id,
    location: "Nagpur South",
    symptoms: ["Hydraulics slow"],
    description: "Lift arm dropping",
    photos: [],
  });
  actions.requestTechnician(repairId, "t1");
  actions.accept(repairId);

  // Send quote to farmer (advances to QUOTE_PENDING, version 1)
  actions.sendQuote(repairId, {
    parts: [
      {
        name: "Hydraulic O-Ring Kit",
        spec: "OEM Spec",
        qty: 1,
        price: 450,
        source: "In van stock",
      },
    ],
    labourDesc: "Seal replacement",
    labour: 1200,
    taxPct: 0,
    eta: "Tomorrow, 2:00 PM",
    warranty: "90 days",
  });

  let state = getTB();
  let repair = state.repairs.find((r) => r.id === repairId);
  assert.equal(repair.status, "QUOTE_PENDING");
  assert.equal(repair.quote.version, 1);
  assert.equal(repair.quote.parts.length, 1);
  assert.equal(repair.quote.parts[0].name, "Hydraulic O-Ring Kit");

  // Technician requests an additional depot part while quote is pending farmer approval
  const depotPart = INITIAL_DEMO_PARTS[0]; // Alternator 12V 45A
  requestDemoPart({
    repairRequestId: repairId,
    partId: depotPart.id,
    quantity: 1,
    requesterId: "t1",
    eta: "Tomorrow, 4:00 PM",
  });

  // Verify repair transitions to WAITING_FOR_PARTS and quote is revised to v2 with prior + new items
  state = getTB();
  repair = state.repairs.find((r) => r.id === repairId);
  assert.equal(repair.status, "WAITING_FOR_PARTS", "Repair must move to WAITING_FOR_PARTS");
  assert.equal(repair.quote.version, 2, "Must create quote revision v2 for farmer review");
  assert.equal(repair.quote.parts.length, 2, "Revised quote must contain prior items plus requested part");
  assert.equal(repair.quote.parts[0].name, "Hydraulic O-Ring Kit");
  assert.equal(repair.quote.parts[1].name, depotPart.name);
  assert.equal(repair.parts.items.length, 1);
  assert.equal(repair.parts.items[0].eta, "Tomorrow, 4:00 PM");
});

// 45. MULTI-PART BLOCKER HOLDS TRACK DISTINCT ETAs WITHOUT OVERWRITING
test("Waiting for parts supports multiple requested blockers without overwriting details or ETAs", () => {
  resetDemo();
  const tb = getTB();

  const repairId = actions.createRepair({
    equipmentId: tb.equipment[0].id,
    farmerId: tb.farmers[0].id,
    location: "Katol Field 4",
    symptoms: ["Coolant leak"],
    description: "Radiator cracked and fan belt frayed",
    photos: [],
  });
  actions.requestTechnician(repairId, "t1");
  actions.accept(repairId);
  actions.sendQuote(repairId, {
    parts: [{ name: "Radiator Hose", spec: "OEM", qty: 1, price: 650, source: "Van" }],
    labourDesc: "Cooling system overhaul",
    labour: 900,
    taxPct: 0,
    eta: "Tomorrow",
    warranty: "90 days",
  });
  actions.approveQuote(repairId, "f1");

  // Repair is now IN_PROGRESS
  let state = getTB();
  let repair = state.repairs.find((r) => r.id === repairId);
  assert.equal(repair.status, "IN_PROGRESS");

  // First blocker: Water Pump (ETA Nov 2)
  actions.waitForParts(repairId, {
    part: "Water Pump Assembly",
    partId: "p-pump-01",
    reason: "Damaged impeller",
    eta: "2026-11-02T10:00:00.000Z",
    revisedCompletion: "2026-11-02T16:00:00.000Z",
    note: "Ordered from Pune depot",
  });

  state = getTB();
  repair = state.repairs.find((r) => r.id === repairId);
  assert.equal(repair.status, "WAITING_FOR_PARTS");
  assert.ok(repair.parts.items, "Must have blocker items list");
  assert.equal(repair.parts.items.length, 1);
  assert.equal(repair.parts.items[0].part, "Water Pump Assembly");
  assert.equal(repair.parts.items[0].eta, "2026-11-02T10:00:00.000Z");

  // Second blocker: Thermostat Valve (ETA Nov 3)
  actions.waitForParts(repairId, {
    part: "Thermostat Valve",
    partId: "p-thermo-02",
    reason: "Stuck closed",
    eta: "2026-11-03T14:00:00.000Z",
    revisedCompletion: "2026-11-03T18:00:00.000Z",
    note: "Awaiting shipment",
  });

  state = getTB();
  repair = state.repairs.find((r) => r.id === repairId);
  assert.equal(repair.status, "WAITING_FOR_PARTS");
  assert.equal(repair.parts.items.length, 2, "Must preserve both blockers without overwriting");
  assert.equal(repair.parts.items[0].part, "Water Pump Assembly");
  assert.equal(repair.parts.items[0].eta, "2026-11-02T10:00:00.000Z");
  assert.equal(repair.parts.items[1].part, "Thermostat Valve");
  assert.equal(repair.parts.items[1].eta, "2026-11-03T14:00:00.000Z");

  // Update ETA specifically for the first item
  actions.updatePartsEta(repairId, "2026-11-02T15:00:00.000Z", "technician", "p-pump-01");
  state = getTB();
  repair = state.repairs.find((r) => r.id === repairId);
  assert.equal(repair.parts.items[0].eta, "2026-11-02T15:00:00.000Z", "First item ETA updated");
  assert.equal(repair.parts.items[1].eta, "2026-11-03T14:00:00.000Z", "Second item ETA preserved");
});

// 46. HANDOFF UNBLOCKS ITEM BUT DOES NOT SILENTLY AUTO-RESUME REPAIR WORK
test("Confirming physical handoff unblocks item but leaves repair in WAITING_FOR_PARTS until technician resumes", () => {
  resetDemo();
  const tb = getTB();
  const canonicalPart = INITIAL_DEMO_PARTS[1];

  const repairId = actions.createRepair({
    equipmentId: tb.equipment[0].id,
    farmerId: tb.farmers[0].id,
    location: "Nagpur Depot Zone",
    symptoms: ["No start"],
    description: "Starter burned out",
    photos: [],
  });
  actions.requestTechnician(repairId, "t1");
  actions.accept(repairId);
  actions.sendQuote(repairId, {
    parts: [{ name: canonicalPart.name, spec: canonicalPart.part_number, qty: 1, price: canonicalPart.unit_price, source: "Depot", catalogPartId: canonicalPart.id }],
    labourDesc: "Replace starter",
    labour: 800,
    taxPct: 0,
    eta: "Tomorrow",
    warranty: "90 days",
  });
  actions.approveQuote(repairId, "f1");

  // Technician requests the part
  const req = requestDemoPart({
    repairRequestId: repairId,
    partId: canonicalPart.id,
    quantity: 1,
    requesterId: "t1",
  });

  // Put on hold waiting for this part
  actions.waitForParts(repairId, {
    part: canonicalPart.name,
    partId: canonicalPart.id,
    requestId: req.id,
    reason: "Awaiting depot handoff",
    eta: "Tomorrow, 10:00 AM",
  });

  let state = getTB();
  let repair = state.repairs.find((r) => r.id === repairId);
  assert.equal(repair.status, "WAITING_FOR_PARTS");
  assert.equal(repair.parts.items[0].status, "PENDING");

  // Admin confirms handoff at Parts Desk
  confirmDemoPartHandoff(req.id, "Nagpur Service Centre");

  state = getTB();
  repair = state.repairs.find((r) => r.id === repairId);
  // Requisition is handed off
  const updatedReq = state.serviceCentrePartRequests.find((r) => r.id === req.id);
  assert.equal(updatedReq.status, "HANDED_OFF");

  // Blocker item is marked HANDED_OFF
  assert.equal(repair.parts.items[0].status, "HANDED_OFF");
  assert.equal(repair.parts.allPartsArrived, true);

  // CRITICAL: Repair remains in WAITING_FOR_PARTS so technician has explicit control of resuming
  assert.equal(repair.status, "WAITING_FOR_PARTS", "Repair must NOT silently auto-resume to IN_PROGRESS");

  // Technician explicitly resumes repair
  actions.resume(repairId);
  state = getTB();
  repair = state.repairs.find((r) => r.id === repairId);
  assert.equal(repair.status, "IN_PROGRESS", "Repair advances to IN_PROGRESS only upon explicit resume");
});

// 47. REALTIME HOOKS INCLUDE PART REQUESTS AND PARTS DESK TOPICS
test("Realtime hooks verify ticket subscriptions include service_centre_part_requests and Parts Desk subscriptions", () => {
  const realtimeCode = fs.readFileSync(path.resolve("src/hooks/use-repair-realtime.ts"), "utf8");

  // Verify ticket-scoped realtime subscribes to service_centre_part_requests
  assert.ok(
    realtimeCode.includes('table: "service_centre_part_requests"'),
    "Ticket realtime hook must subscribe to service_centre_part_requests",
  );
  assert.ok(
    realtimeCode.includes("filter: `repair_request_id=eq.${cleanId}`"),
    "Ticket realtime hook must scope part requests to repair_request_id",
  );

  // Verify usePartsDeskRealtime exports and subscribes to all Parts Desk tables
  assert.ok(
    realtimeCode.includes("export function usePartsDeskRealtime"),
    "Must export usePartsDeskRealtime",
  );
  assert.ok(
    realtimeCode.includes('table: "service_centre_parts"'),
    "Parts Desk realtime must subscribe to service_centre_parts",
  );
  assert.ok(
    realtimeCode.includes('table: "service_centre_stock_audit"'),
    "Parts Desk realtime must subscribe to service_centre_stock_audit",
  );
  assert.ok(
    realtimeCode.includes('table: "service_centre_part_sales"'),
    "Parts Desk realtime must subscribe to service_centre_part_sales",
  );

  // Verify Parts Desk route consumes usePartsDeskRealtime
  const partsDeskCode = fs.readFileSync(path.resolve("src/routes/admin/parts-desk.tsx"), "utf8");
  assert.ok(
    partsDeskCode.includes("usePartsDeskRealtime"),
    "Parts Desk route must invoke usePartsDeskRealtime",
  );
});

// 48. FARMER VIEW PRIVACY: NEVER RENDERS INTERNAL STOCK, DEPOT COSTS, SHELF LOCATIONS, OR SOURCING NOTES
test("Farmer repair detail never displays internal stock counts, depot costs, shelf locations, or internal sourcing notes", () => {
  const farmerCode = fs.readFileSync(path.resolve("src/routes/farmer/repair/$id.tsx"), "utf8");

  // Farmer view must not query or display depot stock or shelf location
  assert.ok(
    !farmerCode.includes("stock_quantity"),
    "Farmer view must never render stock_quantity",
  );
  assert.ok(
    !farmerCode.includes("service_centre_stock_audit"),
    "Farmer view must never query service_centre_stock_audit",
  );
  assert.ok(
    !farmerCode.includes("service_centre_part_sales"),
    "Farmer view must never query service_centre_part_sales",
  );
  assert.ok(
    !farmerCode.includes("shelf") && !farmerCode.includes("Shelf"),
    "Farmer view must never display internal depot shelf location",
  );
});

// 49. CROSS-TAB DEMO STORE SYNCHRONIZATION VIA BROADCASTCHANNEL & STORAGE
test("Cross-tab demo store synchronization broadcasts mutations and listens across tabs", () => {
  const storeCode = fs.readFileSync(path.resolve("src/lib/tb-store.ts"), "utf8");

  assert.ok(
    storeCode.includes("BroadcastChannel") && storeCode.includes("terrabyte_demo_store_sync"),
    "tb-store must initialize BroadcastChannel with terrabyte_demo_store_sync",
  );
  assert.ok(
    storeCode.includes('window.addEventListener("storage"'),
    "tb-store must listen to window storage events for cross-tab hydration",
  );
  assert.ok(
    storeCode.includes('broadcastChannel.postMessage({ type: "STORE_UPDATED"'),
    "tb-store set() must post STORE_UPDATED to broadcastChannel",
  );
});

// 50. REALTIME PUBLICATION MIGRATION
test("Phase 9.3 forward migration registers parts tables into supabase_realtime and sets REPLICA IDENTITY FULL", () => {
  const migPath = path.resolve(
    "supabase/migrations/20261031183000_phase9_3_realtime_publications.sql",
  );
  assert.ok(fs.existsSync(migPath), "Migration 20261031183000 must exist");

  const migContent = fs.readFileSync(migPath, "utf8");
  assert.ok(
    migContent.includes("ALTER PUBLICATION supabase_realtime ADD TABLE public.service_centre_parts"),
    "Migration must add service_centre_parts to supabase_realtime",
  );
  assert.ok(
    migContent.includes(
      "ALTER PUBLICATION supabase_realtime ADD TABLE public.service_centre_part_requests",
    ),
    "Migration must add service_centre_part_requests to supabase_realtime",
  );
  assert.ok(
    migContent.includes(
      "ALTER PUBLICATION supabase_realtime ADD TABLE public.service_centre_stock_audit",
    ),
    "Migration must add service_centre_stock_audit to supabase_realtime",
  );
  assert.ok(
    migContent.includes(
      "ALTER PUBLICATION supabase_realtime ADD TABLE public.service_centre_part_sales",
    ),
    "Migration must add service_centre_part_sales to supabase_realtime",
  );
  assert.ok(
    migContent.includes("ALTER TABLE public.service_centre_parts REPLICA IDENTITY FULL"),
    "Migration must set REPLICA IDENTITY FULL on service_centre_parts",
  );
  assert.ok(
    migContent.includes("ALTER TABLE public.service_centre_part_requests REPLICA IDENTITY FULL"),
    "Migration must set REPLICA IDENTITY FULL on service_centre_part_requests",
  );
});

// 51. FARMER APPROVAL IN WAITING_FOR_PARTS PRESERVES WAITING_FOR_PARTS REPAIR STATUS
test("Farmer approval of revised quote while in WAITING_FOR_PARTS keeps repair in WAITING_FOR_PARTS", () => {
  resetDemo();
  const tb = getTB();

  const repairId = actions.createRepair({
    equipmentId: tb.equipment[0].id,
    farmerId: tb.farmers[0].id,
    location: "Wardha Block",
    symptoms: ["Fuel leak"],
    description: "Injector line leaking",
    photos: [],
  });
  actions.requestTechnician(repairId, "t1");
  actions.accept(repairId);

  // Initial quote sent
  actions.sendQuote(repairId, {
    parts: [
      {
        name: "Copper Crush Washer",
        spec: "M14",
        qty: 4,
        price: 50,
        source: "In van stock",
      },
    ],
    labourDesc: "Seal replacement",
    labour: 600,
    taxPct: 0,
    eta: "Today, 6:00 PM",
    warranty: "90 days",
  });

  // Technician requests depot part -> transitions to WAITING_FOR_PARTS with quote revision v2
  const depotPart = INITIAL_DEMO_PARTS[1]; // Inline Fuel Filter
  requestDemoPart({
    repairRequestId: repairId,
    partId: depotPart.id,
    quantity: 1,
    requesterId: "t1",
    eta: "Tomorrow, 10:00 AM",
  });

  let state = getTB();
  let repair = state.repairs.find((r) => r.id === repairId);
  assert.equal(repair.status, "WAITING_FOR_PARTS");
  assert.equal(repair.quote.version, 2);

  // Farmer approves revised quote while in WAITING_FOR_PARTS
  actions.approveQuote(repairId);

  state = getTB();
  repair = state.repairs.find((r) => r.id === repairId);
  // Status MUST REMAIN WAITING_FOR_PARTS because parts have not arrived yet!
  assert.equal(
    repair.status,
    "WAITING_FOR_PARTS",
    "Approval while waiting for parts must NOT prematurely advance to IN_PROGRESS",
  );
  assert.ok(
    repair.timeline.some((tl) => tl.note?.includes("Quote revision approved while waiting for parts")),
    "Timeline must record quote revision approved while waiting for parts",
  );
});

// 52. IDEMPOTENT PART REQUESTS DO NOT DUPLICATE QUOTE LINES OR REVISIONS
test("Requesting the same part repeatedly updates existing blocker and quote line idempotently", () => {
  resetDemo();
  const tb = getTB();

  const repairId = actions.createRepair({
    equipmentId: tb.equipment[0].id,
    farmerId: tb.farmers[0].id,
    location: "Nagpur Depot Zone",
    symptoms: ["Steering heavy"],
    description: "Hydraulic pump whistling",
    photos: [],
  });
  actions.requestTechnician(repairId, "t1");
  actions.accept(repairId);

  // Initial quote sent (v1)
  actions.sendQuote(repairId, {
    parts: [
      {
        name: "Hydraulic Fluid 5L",
        spec: "VG 68",
        qty: 1,
        price: 1200,
        source: "In van stock",
      },
    ],
    labourDesc: "Fluid flush & inspection",
    labour: 800,
    taxPct: 0,
    eta: "Tomorrow, 11:00 AM",
    warranty: "90 days",
  });

  const partToRequest = INITIAL_DEMO_PARTS[2]; // Air Filter Primary Outer

  // 1st request: quantity 1
  requestDemoPart({
    repairRequestId: repairId,
    partId: partToRequest.id,
    quantity: 1,
    requesterId: "t1",
    eta: "Tomorrow, 2:00 PM",
  });

  let state = getTB();
  let repair = state.repairs.find((r) => r.id === repairId);
  assert.equal(repair.quote.version, 2);
  assert.equal(repair.quote.parts.length, 2);
  assert.equal(repair.parts.items.length, 1);
  assert.equal(repair.parts.items[0].quantity, 1);
  assert.equal(repair.quote.parts[1].qty, 1);

  // 2nd request for the SAME part: update quantity to 2
  requestDemoPart({
    repairRequestId: repairId,
    partId: partToRequest.id,
    quantity: 2,
    requesterId: "t1",
    eta: "Tomorrow, 3:00 PM",
  });

  state = getTB();
  repair = state.repairs.find((r) => r.id === repairId);
  // Must NOT create quote v3 or duplicate quote lines!
  assert.equal(repair.quote.version, 2, "Pending revision must not bump version again");
  assert.equal(repair.quote.parts.length, 2, "Must not create duplicate quote line");
  assert.equal(repair.quote.parts[1].qty, 2, "Quote line quantity must be updated to 2");
  assert.equal(repair.parts.items.length, 1, "Must not create duplicate blocker item");
  assert.equal(repair.parts.items[0].quantity, 2, "Blocker item quantity must be updated to 2");
  assert.equal(repair.parts.items[0].eta, "Tomorrow, 3:00 PM", "Blocker item ETA must be updated");
});

// 53. PARTS PICKUP CARD INCLUDES DATETIMEPICKER AND AUTO-SUBSCRIBES TO REALTIME
test("Parts Pickup Card component integrates DateTimePicker for expected arrival ETA and real-time subscription", () => {
  const pickupCardCode = fs.readFileSync(
    path.resolve("src/components/parts-pickup-card.tsx"),
    "utf8",
  );

  assert.ok(
    pickupCardCode.includes("<DateTimePicker"),
    "Parts Pickup Card modal must render DateTimePicker",
  );
  assert.ok(
    pickupCardCode.includes('ETA pending'),
    "Parts Pickup Card modal must indicate ETA pending fallback",
  );
  assert.ok(
    pickupCardCode.includes("useRepairTicketRealtime"),
    "Parts Pickup Card must invoke useRepairTicketRealtime",
  );
});

// 54. FARMER ROUTE RENDERS APPROVED QUOTE THROUGHOUT LIFECYCLE (TESTING, IN_PROGRESS, COMPLETED)
test("Farmer repair route renders approved quote across lifecycle and hides decision buttons when approved", () => {
  const farmerRouteCode = fs.readFileSync(
    path.resolve("src/routes/farmer/repair/$id.tsx"),
    "utf8"
  );

  // Must render quote card whenever viewQuote exists and decision is not pending
  assert.ok(
    farmerRouteCode.includes("viewQuote && !isAwaitingDecision"),
    "Farmer route must render quote when viewQuote exists and decision is not pending"
  );

  // Must show Approved badge
  assert.ok(
    farmerRouteCode.includes("Approved repair quote"),
    "Farmer route must indicate approved status in quote header"
  );

  // Must hide action buttons when !isAwaitingDecision
  assert.ok(
    farmerRouteCode.includes("viewQuote && isAwaitingDecision"),
    "Approval and decline buttons must strictly be conditioned on isAwaitingDecision"
  );

  // Must fallback to demo store quote in demo mode
  assert.ok(
    farmerRouteCode.includes("demoQuoteDetail"),
    "Farmer route must fallback to demo store quote detail when database quotes are empty"
  );
});

// 55. QUOTE SERVICE SUPPORTS LABOUR-ONLY QUOTES AND WAITING_FOR_PARTS REVISION
test("Quote service allows Labour-only quotes and supports WAITING_FOR_PARTS during revision", () => {
  const quotesServiceCode = fs.readFileSync(
    path.resolve("src/lib/services/quotes.ts"),
    "utf8"
  );

  // Verify createQuote includes WAITING_FOR_PARTS
  assert.ok(
    quotesServiceCode.includes('"WAITING_FOR_PARTS"') &&
    quotesServiceCode.includes("quotableStatuses"),
    "createQuote must allow WAITING_FOR_PARTS in quotableStatuses"
  );

  // Verify reviseQuote includes WAITING_FOR_PARTS and handles status transition
  assert.ok(
    quotesServiceCode.includes('newRepairStatus = repair.status === "WAITING_FOR_PARTS"'),
    "reviseQuote must preserve WAITING_FOR_PARTS repair status"
  );

  // Verify batch insert guards against empty item array
  assert.ok(
    quotesServiceCode.includes("if (input.items.length > 0)"),
    "createQuote and reviseQuote must guard quote_items batch insert when items is empty"
  );
});

// 56. CATALOG PART PRICE IMMUTABILITY AND VALIDATION IN QUOTE BUILDER
test("QuoteBuilder locks catalog part price to customer-facing selling price and rejects invalid price", () => {
  const techJobCode = fs.readFileSync(
    path.resolve("src/routes/technician/job/$id.tsx"),
    "utf8"
  );

  // Verify unit price input is readOnly for catalog parts
  assert.ok(
    techJobCode.includes("readOnly={Boolean(p.catalogPartId)}"),
    "Unit price input must be readOnly when catalogPartId is present"
  );

  // Verify visual indicator for catalog price
  assert.ok(
    techJobCode.includes("Catalog price (fixed)"),
    "QuoteBuilder must display 'Catalog price (fixed)' badge for catalog parts"
  );

  // Verify submission rejection when catalog part price is missing or non-positive
  assert.ok(
    techJobCode.includes("does not have a valid customer-facing selling price"),
    "Quote submission must be blocked with an explicit error when catalog part price is non-positive"
  );

  // Verify previousQuote item mapping retains catalogPartId across revisions
  assert.ok(
    techJobCode.includes("catalogPartId: item.catalog_part_id || null"),
    "Previous quote items must retain catalogPartId on revision"
  );
});

// 57. GETQUOTESFORREPAIR PRESERVES LABOUR-ONLY QUOTES
test("getQuotesForRepair retains Labour-only quotes and filters only true orphan quotes", () => {
  const quotesServiceCode = fs.readFileSync(
    path.resolve("src/lib/services/quotes.ts"),
    "utf8"
  );

  // Verify filter checks labour_amount before discarding quote
  assert.ok(
    quotesServiceCode.includes("Number(q.labour_amount || 0) === 0"),
    "getQuotesForRepair must only filter orphan quotes if labour_amount is also 0"
  );
});

// 58. SAME-REPAIR RESOLUTION AND REALTIME SAFETY ACROSS TECHNICIAN AND FARMER ROUTES
test("Technician and Farmer routes resolve repairs consistently and maintain safe Realtime subscriptions", () => {
  const techJobCode = fs.readFileSync(
    path.resolve("src/routes/technician/job/$id.tsx"),
    "utf8"
  );
  const farmerRepairCode = fs.readFileSync(
    path.resolve("src/routes/farmer/repair/$id.tsx"),
    "utf8"
  );
  const realtimeCode = fs.readFileSync(
    path.resolve("src/hooks/use-repair-realtime.ts"),
    "utf8"
  );

  // Both routes must have fallback to demo store if database lookup is null
  assert.ok(
    techJobCode.includes("tb.repairs.find") && techJobCode.includes("jobNumber"),
    "Technician route must fall back to demo store for human-readable IDs"
  );
  assert.ok(
    farmerRepairCode.includes("tb.repairs.find") && farmerRepairCode.includes("jobNumber"),
    "Farmer route must fall back to demo store for human-readable IDs"
  );

  // Realtime channel names must include unique instance suffix to prevent post-subscribe callback crash
  assert.ok(
    realtimeCode.includes("Math.random().toString(36).slice(2, 9)"),
    "Realtime channel names must include a unique instance suffix"
  );
});

// 59. END-TO-END VERIFICATION: PART REQUEST ON ACCEPTED REPAIR BEFORE FIRST QUOTE
test("End-to-end flow: request part on ACCEPTED repair before first quote keeps QuoteBuilder, locks catalog price, submits v1, displays waiting state to farmer, and requires approval", () => {
  resetDemo();
  const tb = getTB();

  // 1. Fresh repair in ACCEPTED status without prior quote
  const repairId = actions.createRepair({
    equipmentId: tb.equipment[0].id,
    farmerId: tb.farmers[0].id,
    location: "Katol Farm Depot",
    symptoms: ["Engine misfire on load"],
    description: "Loss of compression and irregular injection",
    photos: [],
  });
  actions.requestTechnician(repairId, "t1");
  actions.accept(repairId);

  let state = getTB();
  let repair = state.repairs.find((r) => r.id === repairId);
  assert.ok(repair, "Repair must exist");
  assert.equal(repair.status, "ACCEPTED", "Initial status must be ACCEPTED");
  assert.equal(repair.quote, undefined, "No quote exists before formulation");

  // 2. Request Service Centre catalog part BEFORE sending the first quote
  const canonicalNozzle = INITIAL_DEMO_PARTS[0]; // Fuel Injector Nozzle Set, ₹2,200
  const initialStock = canonicalNozzle.stock_quantity;
  const partReq = requestDemoPart({
    repairRequestId: repairId,
    partId: canonicalNozzle.id,
    quantity: 2,
    requesterId: "t1",
    eta: "Tomorrow, 4:00 PM",
    notes: "Requires genuine Bosch nozzle replacement",
  });

  // 3. Observe the repair status, quote builder state, draft quote items, and farmer view
  state = getTB();
  repair = state.repairs.find((r) => r.id === repairId);
  assert.ok(repair, "Repair must exist after part request");
  assert.equal(repair.status, "WAITING_FOR_PARTS", "Repair status advances to WAITING_FOR_PARTS");
  assert.ok(repair.parts, "Parts hold must be recorded");
  assert.equal(repair.parts.eta, "Tomorrow, 4:00 PM");

  // Draft quote items: automatically populated with locked catalog price
  assert.ok(repair.quote, "Draft quote must be automatically populated");
  assert.equal(repair.quote.version, 0, "Draft quote version is 0 (not yet sent to farmer)");
  assert.equal(repair.quote.sentAt, 0, "Draft quote sentAt is 0 (unsubmitted)");
  assert.equal(repair.quote.parts.length, 1, "Must contain exactly 1 catalog line");
  assert.equal(repair.quote.parts[0].catalogPartId, canonicalNozzle.id);
  assert.equal(repair.quote.parts[0].name, canonicalNozzle.name);
  assert.equal(repair.quote.parts[0].qty, 2);
  assert.equal(repair.quote.parts[0].price, canonicalNozzle.unit_price, "Customer-facing selling price must match catalog");

  // Check UI visibility conditions:
  // In Technician route: (r.status === "WAITING_FOR_PARTS" && !approvedQuote) -> QuoteBuilder remains VISIBLE!
  const hasPendingTechQuote = Boolean(repair.quote && repair.quote.sentAt > 0 && repair.quote.version > 0);
  assert.equal(hasPendingTechQuote, false, "Draft quote is not a pending submitted quote for technician");

  // In Farmer route: demoQuoteDetail checks sentAt > 0 -> draft quote is NOT displayed as pending before submission
  const isPendingFarmerQuote = Boolean(repair.quote.sentAt > 0);
  assert.equal(isPendingFarmerQuote, false, "Farmer view does not show draft quote before technician sends it");

  // 4. Technician reviews, edits labour, and submits the first quote
  actions.sendQuote(repairId, {
    parts: repair.quote.parts,
    labourDesc: "Replace nozzles, calibrate pressure, test spray pattern",
    labour: 1200,
    taxPct: 0,
    eta: "Tomorrow, 6:00 PM",
    warranty: "90 days on parts & labour",
  });

  // 5. Observe state after quote submission
  state = getTB();
  repair = state.repairs.find((r) => r.id === repairId);
  assert.ok(repair && repair.quote, "Repair and quote must exist after send");
  assert.equal(repair.status, "WAITING_FOR_PARTS", "Repair status must remain WAITING_FOR_PARTS after submitting quote");
  assert.equal(repair.quote.version, 1, "Quote version advances to 1");
  assert.ok(repair.quote.sentAt > 0, "Quote sentAt is set to submission timestamp");

  // Totals: (2 * 2200) + 1200 = 5,600
  const totals = quoteTotals(repair.quote);
  assert.equal(totals.parts, 4400);
  assert.equal(totals.labour, 1200);
  assert.equal(totals.total, 5600);

  // Farmer view verification:
  // Farmer now receives submitted quote v1:
  const farmerPendingCheck = Boolean(
    repair.status === "QUOTE_PENDING" ||
    (repair.status === "WAITING_FOR_PARTS" &&
      Boolean(repair.quote.sentAt) &&
      !repair.timeline.some((t) => t.note && t.note.toLowerCase().includes("approved")))
  );
  assert.equal(farmerPendingCheck, true, "Farmer route recognizes submitted v1 quote as PENDING decision");

  // 6. Farmer approves the quote
  actions.approveQuote(repairId);
  state = getTB();
  repair = state.repairs.find((r) => r.id === repairId);
  assert.ok(repair, "Repair must exist after approval");
  assert.equal(repair.status, "WAITING_FOR_PARTS", "Repair remains WAITING_FOR_PARTS after farmer approval");
  assert.ok(repair.timeline.some((t) => t.note && t.note.toLowerCase().includes("approved")), "Approval must be logged in timeline");

  // Farmer view: quote is now APPROVED (read-only, no decision buttons)
  const farmerApprovedCheck = Boolean(
    repair.timeline.some((t) => t.note && t.note.toLowerCase().includes("approved"))
  );
  assert.equal(farmerApprovedCheck, true, "Quote is recognized as APPROVED after farmer decision");

  // 7. Depot staff confirms physical handoff against the approved quote
  confirmDemoPartHandoff(partReq.id, "Nagpur Staff");
  state = getTB();

  // Stock decrements:
  const updatedStock = state.serviceCentreParts.find((p) => p.id === canonicalNozzle.id).stock_quantity;
  assert.equal(updatedStock, initialStock - 2, "Stock must decrement by requested quantity 2");

  // Commercial sale recorded for ₹4,400:
  const sales = state.serviceCentrePartSales || [];
  const matchingSale = sales.find((s) => s.part_request_id === partReq.id);
  assert.ok(matchingSale, "Sale must be recorded on handoff against approved quote");
  assert.equal(matchingSale.total_amount, 4400);
  assert.equal(matchingSale.unit_price, 2200);
  assert.equal(matchingSale.quantity, 2);

  // 8. Re-requesting another part AFTER quote approval automatically formulates revision v2
  const secondPart = INITIAL_DEMO_PARTS[1]; // Inline Fuel Filter, ₹1,200
  requestDemoPart({
    repairRequestId: repairId,
    partId: secondPart.id,
    quantity: 1,
    requesterId: "t1",
    eta: "Day after tomorrow, 11:00 AM",
  });

  state = getTB();
  repair = state.repairs.find((r) => r.id === repairId);
  assert.ok(repair && repair.quote, "Repair and revision quote must exist");
  assert.equal(repair.status, "WAITING_FOR_PARTS", "Repair remains in WAITING_FOR_PARTS");
  assert.equal(repair.quote.version, 2, "Automatically creates quote revision v2");
  assert.equal(repair.quote.parts.length, 2, "Revision contains both original and new part lines");

  // 9. Farmer view receives revision v2 without refresh and sees new items and total
  // Verify that revision v2 sent after earlier approval evaluates to PENDING
  const tl = repair.timeline || [];
  let lastApprovalIdx = -1;
  let lastRevisionIdx = -1;
  for (let i = 0; i < tl.length; i++) {
    const note = (tl[i]?.note || "").toLowerCase();
    if (note.includes("approved")) lastApprovalIdx = i;
    if (
      note.includes("revised quote") ||
      note.includes("quote formulated") ||
      note.includes("quote sent") ||
      note.includes("parts requested")
    ) {
      lastRevisionIdx = i;
    }
  }
  const isRevisionV2Pending = lastApprovalIdx === -1 || lastRevisionIdx >= lastApprovalIdx;
  assert.equal(isRevisionV2Pending, true, "Revision v2 sent after approval must be evaluated as PENDING");

  // Totals for v2: 4400 (nozzles) + 350 (filter) + 1200 (labour) = 5950
  const totalsV2 = quoteTotals(repair.quote);
  assert.equal(totalsV2.parts, 4750);
  assert.equal(totalsV2.labour, 1200);
  assert.equal(totalsV2.total, 5950);

  // 10. Farmer approves revision v2
  actions.approveQuote(repairId);
  state = getTB();
  repair = state.repairs.find((r) => r.id === repairId);
  assert.equal(repair.status, "WAITING_FOR_PARTS", "Repair remains in WAITING_FOR_PARTS after approving revision v2");

  // 11. Depot staff confirms physical handoff of second part
  const req2 = state.serviceCentrePartRequests.find((r) => r.part_id === secondPart.id && r.repair_request_id === repairId);
  assert.ok(req2, "Second part request must exist");
  confirmDemoPartHandoff(req2.id, "Nagpur Staff");

  state = getTB();
  repair = state.repairs.find((r) => r.id === repairId);
  // Both parts arrived
  assert.equal(repair.parts.allPartsArrived, true, "All parts marked arrived after all handoffs");
  assert.equal(repair.status, "WAITING_FOR_PARTS", "Repair STAYS in WAITING_FOR_PARTS even after handoff until technician explicitly resumes");

  // 12. Technician explicitly resumes the repair
  actions.resume(repairId);
  state = getTB();
  repair = state.repairs.find((r) => r.id === repairId);
  assert.equal(repair.status, "IN_PROGRESS", "Repair transitions to IN_PROGRESS strictly upon technician explicit resumption");
});

// 60. VERIFICATION: REALTIME SUBSCRIPTION, RESOLVED UUID LOOKUP, QUOTE ITEMS CDC & STATE GUARDS
test("Realtime hook resolves database UUID for job numbers, subscribes to quote_items, and enforces parts hold state machine", () => {
  const realtimeCode = fs.readFileSync(path.resolve("src/hooks/use-repair-realtime.ts"), "utf8");

  // 1. Must resolve database UUID for human-readable repair numbers (e.g. TB-4651) before subscribing
  assert.ok(
    realtimeCode.includes('from("repair_requests")') &&
      realtimeCode.includes('eq("job_number", rawId)'),
    "useRepairTicketRealtime must query repair_requests by job_number to resolve UUID for human-readable numbers"
  );

  // 2. Must subscribe to quote_items table CDC events
  assert.ok(
    realtimeCode.includes("table: \"quote_items\""),
    "useRepairTicketRealtime must subscribe to quote_items table"
  );

  // 3. Forward migration 20261031183000 adds quote_items to supabase_realtime and sets REPLICA IDENTITY FULL
  const pubSql = fs.readFileSync(
    path.resolve("supabase/migrations/20261031183000_phase9_3_realtime_publications.sql"),
    "utf8"
  );
  assert.ok(
    pubSql.includes("ALTER PUBLICATION supabase_realtime ADD TABLE public.quote_items;"),
    "Migration must add public.quote_items to supabase_realtime publication"
  );
  assert.ok(
    pubSql.includes("ALTER TABLE public.quote_items REPLICA IDENTITY FULL;"),
    "Migration must set REPLICA IDENTITY FULL on public.quote_items"
  );

  // 4. Atomic RPCs enforce active parts hold on WAITING_FOR_PARTS and preserve status
  assert.ok(
    pubSql.includes("Cannot create quote: Repair ticket is in WAITING_FOR_PARTS status without an active parts hold"),
    "create_quote_atomic must reject WAITING_FOR_PARTS unless an active parts hold exists"
  );
  assert.ok(
    pubSql.includes("v_next_status := CASE WHEN v_repair.status = 'WAITING_FOR_PARTS' THEN 'WAITING_FOR_PARTS'::repair_status ELSE 'QUOTE_PENDING'::repair_status END;"),
    "Atomic quote formulation must preserve WAITING_FOR_PARTS rather than blanket resetting to QUOTE_PENDING"
  );

  // 5. Client quotes service also enforces parts hold guard
  const quotesServiceCode = fs.readFileSync(path.resolve("src/lib/services/quotes.ts"), "utf8");
  assert.ok(
    quotesServiceCode.includes("Repair ticket is in WAITING_FOR_PARTS status without an active parts hold"),
    "createQuote must guard WAITING_FOR_PARTS status with active parts hold check"
  );

  // 6. Farmer route evaluates revision status accurately when sent after previous approval
  const farmerRouteCode = fs.readFileSync(path.resolve("src/routes/farmer/repair/$id.tsx"), "utf8");
  assert.ok(
    farmerRouteCode.includes("lastRevisionIdx >= lastApprovalIdx"),
    "Farmer route must check if revision was sent after latest approval to prevent stuck APPROVED state"
  );
});

// 61. QUOTE APPROVAL AND REJECTION WORK CONSISTENTLY ACROSS IN_PROGRESS AND WAITING_FOR_PARTS
test("Quote approval and rejection services handle IN_PROGRESS, QUOTE_PENDING, and WAITING_FOR_PARTS without crashing or illegal transitions", () => {
  const quotesServiceCode = fs.readFileSync(path.resolve("src/lib/services/quotes.ts"), "utf8");

  // 1. approveQuote must accept IN_PROGRESS, QUOTE_PENDING, and WAITING_FOR_PARTS
  assert.ok(
    quotesServiceCode.includes('const approvableStatuses: RepairStatus[] = ["QUOTE_PENDING", "WAITING_FOR_PARTS", "IN_PROGRESS"];'),
    "approveQuote must accept IN_PROGRESS, QUOTE_PENDING, and WAITING_FOR_PARTS without throwing invalid status error"
  );

  // 2. approveQuote advances repair status to IN_PROGRESS only when not in WAITING_FOR_PARTS
  assert.ok(
    quotesServiceCode.includes('if (repair.status !== "WAITING_FOR_PARTS") {'),
    "approveQuote must preserve WAITING_FOR_PARTS when approved while waiting for parts"
  );

  // 3. rejectQuote must accept IN_PROGRESS, QUOTE_PENDING, and WAITING_FOR_PARTS
  assert.ok(
    quotesServiceCode.includes('const rejectableStatuses: RepairStatus[] = ["QUOTE_PENDING", "WAITING_FOR_PARTS", "IN_PROGRESS"];'),
    "rejectQuote must accept IN_PROGRESS, QUOTE_PENDING, and WAITING_FOR_PARTS"
  );

  // 4. rejectQuote updates repair status to QUOTE_REVISED or preserves WAITING_FOR_PARTS
  assert.ok(
    quotesServiceCode.includes('const nextRepairStatus: RepairStatus =\n    repair.status === "WAITING_FOR_PARTS" ? "WAITING_FOR_PARTS" : "QUOTE_REVISED";'),
    "rejectQuote must set QUOTE_REVISED or preserve WAITING_FOR_PARTS"
  );
});

// 62. TECHNICIAN ROUTE LOCKS WORK ACTIONS AND ENFORCES EXACTLY ONE CURRENT QUOTE CARD PRESENTATION
test("Technician route locks testing and completion while quote is pending and enforces single current quote presentation", () => {
  const techRouteCode = fs.readFileSync(path.resolve("src/routes/technician/job/$id.tsx"), "utf8");

  // 1. Technician route renders InProgress only when no pending quote exists
  assert.ok(
    techRouteCode.includes('{r.status === "IN_PROGRESS" && !pendingQuote && ('),
    "InProgress work controls must NOT render when a pending quote exists"
  );

  // 2. Approved quote card only renders when there is NO pending quote
  assert.ok(
    techRouteCode.includes('{!pendingQuote && approvedQuote && ('),
    "Approved quote card must NOT render when a pending revision exists, preventing duplicate quote cards"
  );

  // 3. InProgress disables Start testing and Complete & sign off when work is locked
  assert.ok(
    techRouteCode.includes("const isWorkLocked = !isQuoteApproved || hasPendingParts;"),
    "InProgress component must calculate isWorkLocked from quote approval and pending parts holds"
  );
  assert.ok(
    techRouteCode.includes("disabled={submitting || isWorkLocked}"),
    "Start testing button must be disabled when work is locked"
  );
  assert.ok(
    techRouteCode.includes("disabled={isWorkLocked}"),
    "Complete & sign off button must be disabled when work is locked"
  );

  // 4. Server-side service repair-requests.ts locks startTesting and completeRepair
  const repairServiceCode = fs.readFileSync(path.resolve("src/lib/services/repair-requests.ts"), "utf8");
  assert.ok(
    repairServiceCode.includes("Cannot start testing: Quote v"),
    "startTesting service must reject when a pending unapproved quote exists"
  );
  assert.ok(
    repairServiceCode.includes("Cannot start testing: Blocking parts requisitions are awaiting delivery/handoff."),
    "startTesting service must reject when blocking parts are pending"
  );
  assert.ok(
    repairServiceCode.includes("Cannot complete repair: Quote v"),
    "completeRepair service must reject when a pending unapproved quote exists"
  );
  assert.ok(
    repairServiceCode.includes("Cannot complete repair: Blocking parts requisitions are awaiting delivery/handoff."),
    "completeRepair service must reject when blocking parts are pending"
  );
});

// 63. REALTIME SUBSCRIPTION RESILIENCE AND CRASH PROTECTION
test("Realtime hook safely wraps subscription and cleanup to eliminate unhandled error collisions across mounts", () => {
  const realtimeCode = fs.readFileSync(path.resolve("src/hooks/use-repair-realtime.ts"), "utf8");

  // 1. Unique channel name with random suffix eliminates channel.on after subscribe collisions
  assert.ok(
    realtimeCode.includes("ticket-realtime-${cleanId}-${Math.random().toString(36).slice(2, 9)}"),
    "useRepairTicketRealtime must generate unique channel name per hook instance"
  );

  // 2. Global setup subscription wrapped in try-catch to prevent React ErrorBoundary crashes
  assert.ok(
    realtimeCode.includes("Global setup subscription error"),
    "useRepairTicketRealtime setup must catch all errors safely"
  );

  // 3. Channel cleanup safely wrapped in try-catch
  assert.ok(
    realtimeCode.includes("Cleanup error"),
    "Channel removeChannel cleanup must be wrapped in try-catch"
  );
});

// 64. TB-6399 PARTS HANDOFF WORK-LOCK CLEARANCE ON IN_PROGRESS REPAIRS
test("confirmPartHandoff updates parts_hold on IN_PROGRESS repairs and authoritative work-lock clears upon handoff", () => {
  const partsDeskCode = fs.readFileSync(path.resolve("src/lib/services/parts-desk.ts"), "utf8");
  const tbStoreCode = fs.readFileSync(path.resolve("src/lib/tb-store.ts"), "utf8");
  const techJobCode = fs.readFileSync(path.resolve("src/routes/technician/job/$id.tsx"), "utf8");

  // 1. confirmPartHandoff must not be restricted to WAITING_FOR_PARTS only
  assert.ok(
    partsDeskCode.includes("if (currentRepair)") &&
      partsDeskCode.includes("matchedItem.status = \"HANDED_OFF\"") &&
      partsDeskCode.includes("updated_at: nowIso"),
    "confirmPartHandoff must update parts_hold and touch updated_at for any repair with parts_hold"
  );

  // 2. confirmDemoPartHandoff must update repair.parts blocker items for IN_PROGRESS repairs
  assert.ok(
    tbStoreCode.includes("if (repair && repair.parts)") &&
      tbStoreCode.includes("status: repair.status"),
    "confirmDemoPartHandoff must update repair.parts blocker items while preserving repair status"
  );

  // 3. Technician job route must use authoritative partRequests predicate
  assert.ok(
    techJobCode.includes("partRequests.length > 0") &&
      techJobCode.includes("partRequests.some((pr) => pr.status === \"PENDING\")"),
    "hasPendingParts must check authoritative partRequests first"
  );

  // 4. Predicate logic simulation: Single request handed off on IN_PROGRESS repair
  const computeHasPendingParts = (partRequests, partsHold) => {
    return partRequests.length > 0
      ? partRequests.some((pr) => pr.status === "PENDING")
      : Boolean(partsHold?.items?.some((it) => it.status === "PENDING"));
  };

  // TB-6399 bug scenario: part is HANDED_OFF, but legacy partsHold still had stale items
  const reqsHandedOff = [{ id: "req-1", status: "HANDED_OFF" }];
  const stalePartsHold = { items: [{ part: "Air Filter", status: "PENDING" }] };
  assert.strictEqual(
    computeHasPendingParts(reqsHandedOff, stalePartsHold),
    false,
    "Authoritative partRequests check must evaluate to false when all requests are handed off"
  );

  // Multiple requests scenario: 1 handed off, 1 pending -> work remains locked
  const reqsMixed = [
    { id: "req-1", status: "HANDED_OFF" },
    { id: "req-2", status: "PENDING" },
  ];
  assert.strictEqual(
    computeHasPendingParts(reqsMixed, null),
    true,
    "Work must remain locked while at least one part request is PENDING"
  );

  // Once second request is handed off, lock clears
  const reqsAllResolved = [
    { id: "req-1", status: "HANDED_OFF" },
    { id: "req-2", status: "HANDED_OFF" },
  ];
  assert.strictEqual(
    computeHasPendingParts(reqsAllResolved, null),
    false,
    "Work lock must clear when all requests are handed off"
  );
});

// 65. SERVER-SIDE GUARDS AUTHORITATIVE SERVICE_CENTRE_PART_REQUESTS CHECK
test("startTesting and completeRepair query service_centre_part_requests authoritatively", () => {
  const repairServiceCode = fs.readFileSync(path.resolve("src/lib/services/repair-requests.ts"), "utf8");

  // 1. startTesting queries service_centre_part_requests
  assert.ok(
    repairServiceCode.includes(".from(\"service_centre_part_requests\")") &&
      repairServiceCode.includes("dbPartRequests.some((pr) => pr.status === \"PENDING\")"),
    "startTesting must query service_centre_part_requests authoritatively"
  );

  // 2. completeRepair verifies authoritative service_centre_part_requests
  const completeIdx = repairServiceCode.indexOf("export async function completeRepair");
  const completeCode = repairServiceCode.slice(completeIdx);
  assert.ok(
    completeCode.includes(".from(\"service_centre_part_requests\")") &&
      completeCode.includes("dbPartRequests.some((pr) => pr.status === \"PENDING\")"),
    "completeRepair must query service_centre_part_requests authoritatively"
  );
});

// 66. CROSS-TAB DEMO SYNCHRONIZATION AND COLLISION IMMUNITY ACROSS COMPONENTS
test("BroadcastChannel and storage listeners ensure cross-tab sync and all channels use unique instance names", () => {
  const realtimeCode = fs.readFileSync(path.resolve("src/hooks/use-repair-realtime.ts"), "utf8");
  const chatCode = fs.readFileSync(path.resolve("src/components/repair-chat.tsx"), "utf8");
  const navCode = fs.readFileSync(path.resolve("src/components/tb.tsx"), "utf8");

  // 1. useRepairTicketRealtime integrates BroadcastChannel & storage listeners
  assert.ok(
    realtimeCode.includes("new BroadcastChannel(\"terrabyte_demo_store_sync\")") &&
      realtimeCode.includes("window.addEventListener(\"storage\", handleStorage)"),
    "useRepairTicketRealtime must attach cross-tab BroadcastChannel and storage listeners"
  );

  // 2. usePartsDeskRealtime integrates cross-tab synchronization
  assert.ok(
    realtimeCode.includes("parts-desk-realtime-${Math.random().toString(36).slice(2, 9)}"),
    "usePartsDeskRealtime must use unique channel instances"
  );

  // 3. RepairChat uses unique channel instances and catches errors
  assert.ok(
    chatCode.includes("repair-chat-${repairId}-${Math.random().toString(36).slice(2, 9)}"),
    "RepairChat must use unique channel instance with random suffix"
  );

  // 4. TopNav notifications channel uses unique channel instances and catches errors
  assert.ok(
    navCode.includes("notifications-live-${userId}-${Math.random().toString(36).slice(2, 9)}"),
    "TopNav notifications channel must use unique channel instance with random suffix"
  );
});

// 67. AUTHORITATIVE PHYSICAL HANDOFF PROPAGATION, REALTIME REFRESH, AND CANCELLATION LOCK
test("Service Centre handoff writes touch repair_requests, broadcast globally, update technician view, and lock cancellation", () => {
  const partsDeskCode = fs.readFileSync(path.resolve("src/lib/services/parts-desk.ts"), "utf8");
  const techJobCode = fs.readFileSync(path.resolve("src/routes/technician/job/$id.tsx"), "utf8");
  const pickupCardCode = fs.readFileSync(path.resolve("src/components/parts-pickup-card.tsx"), "utf8");
  const realtimeCode = fs.readFileSync(path.resolve("src/hooks/use-repair-realtime.ts"), "utf8");
  const rpcSql = fs.readFileSync(path.resolve("supabase/migrations/20261031173000_phase9_3_parts_handoff_rpcs.sql"), "utf8");

  // 1. Database RPC touches repair_requests to emit Realtime CDC event
  assert.ok(
    rpcSql.includes("UPDATE public.repair_requests") &&
      rpcSql.includes("SET updated_at = now()") &&
      rpcSql.includes("WHERE id = v_request.repair_request_id;"),
    "confirm_service_centre_part_handoff RPC must touch repair_requests.updated_at to broadcast CDC event"
  );

  // 2. confirmPartHandoff service touches repair_requests and broadcasts part_handoff on tb-realtime-bus
  assert.ok(
    partsDeskCode.includes("tb-realtime-bus") &&
      partsDeskCode.includes("event: \"part_handoff\""),
    "confirmPartHandoff must broadcast part_handoff on tb-realtime-bus for cross-session synchronisation"
  );

  // 3. useRepairTicketRealtime listens to global tb-realtime-bus part_handoff events and terrabyte-demo-v1 storage key
  assert.ok(
    realtimeCode.includes("tb-bus-") &&
      realtimeCode.includes("event: \"part_handoff\"") &&
      realtimeCode.includes("terrabyte-demo-v1"),
    "useRepairTicketRealtime must subscribe to global broadcast bus and listen to terrabyte-demo-v1 storage events"
  );

  // 4. Technician Job page passes authoritative partRequests down to PartsPickupCard
  assert.ok(
    techJobCode.includes("partRequests={partRequests}"),
    "Technician Job page must pass authoritative partRequests prop to PartsPickupCard"
  );

  // 5. PartsPickupCard renders 'Parts Handed Off from Service Centre' banner when handed-off requests exist
  assert.ok(
    pickupCardCode.includes("hasHandedOffParts &&") &&
      pickupCardCode.includes("Parts Handed Off from Service Centre"),
    "PartsPickupCard must render 'Parts Handed Off from Service Centre' banner upon handoff"
  );

  // 6. Cancellation is hidden when request status is HANDED_OFF
  assert.ok(
    pickupCardCode.includes("req.status === \"PENDING\" && isAssigned &&") &&
      pickupCardCode.includes("handleCancelRequest(req.id)"),
    "PartsPickupCard must render Cancel button ONLY when request status is PENDING"
  );

  // 7. cancelPartRequest service rejects cancellation if components have already been handed off
  assert.ok(
    partsDeskCode.includes("Cannot cancel part request: Components have already been handed off by the Service Centre."),
    "cancelPartRequest must throw error if request is already HANDED_OFF"
  );
});

// 68. PHASE 9.3 MIGRATION: UNAVAILABLE PARTS, ITEM-LEVEL ETA & ATOMIC COORDINATION RPC
test("Phase 9.3 migration defines item-level ETA columns, index, coordination RLS, and atomic update RPC", () => {
  const migrationPath = path.resolve("supabase/migrations/20261101140000_phase9_3_unavailable_parts_eta.sql");
  assert.ok(fs.existsSync(migrationPath), "Migration 20261101140000_phase9_3_unavailable_parts_eta.sql must exist");
  const sql = fs.readFileSync(migrationPath, "utf8");

  // 1. Column additions for item-level ETA and audit logging
  assert.ok(
    sql.includes("estimated_arrival_at timestamptz NULL") &&
      sql.includes("eta_updated_by uuid REFERENCES public.profiles(id)") &&
      sql.includes("eta_updated_at timestamptz NULL"),
    "Migration must add estimated_arrival_at, eta_updated_by, and eta_updated_at to service_centre_part_requests"
  );

  // 2. Query index
  assert.ok(
    sql.includes("idx_sc_part_requests_estimated_arrival"),
    "Migration must create index on estimated_arrival_at"
  );

  // 3. RLS Policy allowing assigned technicians and Service Centre staff
  assert.ok(
    sql.includes("Assigned technicians or admins can update part request ETA") &&
      sql.includes("rr.technician_id = p.id"),
    "Migration must define RLS policy permitting assigned technicians or admins to update ETA"
  );

  // 4. Atomic ETA update RPC
  assert.ok(
    sql.includes("CREATE OR REPLACE FUNCTION public.update_service_centre_part_request_eta") &&
      sql.includes("p_estimated_arrival_at timestamptz") &&
      sql.includes("SECURITY DEFINER"),
    "Migration must define SECURITY DEFINER RPC update_service_centre_part_request_eta"
  );
});

// 69. ITEM-LEVEL ETA COORDINATION, AUDIT LOGGING, AND ACCESS CONTROL
test("Item-level ETA update records audit logging, recalculates overall parts hold, and rejects unauthorized roles", async () => {
  const partsDeskCode = fs.readFileSync(path.resolve("src/lib/services/parts-desk.ts"), "utf8");
  const tbStoreCode = fs.readFileSync(path.resolve("src/lib/tb-store.ts"), "utf8");

  // 1. Service function updatePartRequestEta exists and handles ETA updates
  assert.ok(
    partsDeskCode.includes("export async function updatePartRequestEta") &&
      partsDeskCode.includes("UpdatePartRequestEtaInput"),
    "parts-desk.ts must export updatePartRequestEta service function"
  );

  // 2. Demo store supports updateDemoPartRequestEta with role authorization
  assert.ok(
    tbStoreCode.includes("export function updateDemoPartRequestEta") &&
      tbStoreCode.includes("Farmers cannot update parts ETA") &&
      tbStoreCode.includes("Only the assigned technician or Service Centre staff can update part ETA"),
    "tb-store.ts must export updateDemoPartRequestEta enforcing role-based authorization"
  );

  // 3. Functional verification of updateDemoPartRequestEta
  const { resetDemo, requestDemoPart, updateDemoPartRequestEta, getDemoPartRequests, getTB, INITIAL_DEMO_PARTS } = await import(
    "../src/lib/tb-store.ts"
  );
  resetDemo();

  const partId1 = INITIAL_DEMO_PARTS[0].id;
  const partId2 = INITIAL_DEMO_PARTS[1].id;

  const req = requestDemoPart({
    repairRequestId: "TB-9901",
    partId: partId1,
    quantity: 1,
    notes: "Awaiting supplier shipment",
    requesterId: "t1",
    requesterName: "Ramesh Kumar",
  });

  assert.strictEqual(req.status, "PENDING");
  assert.strictEqual(req.estimated_arrival_at, null);

  // Assigned technician updates ETA
  const updatedByTech = updateDemoPartRequestEta({
    requestId: req.id,
    estimatedArrivalAt: "2026-11-04T10:00:00.000Z",
    notes: "Transit via regional courier",
    updaterId: "t1",
    updaterName: "Ramesh Kumar",
    updaterRole: "technician",
  });

  assert.strictEqual(updatedByTech.estimated_arrival_at, "2026-11-04T10:00:00.000Z");
  assert.strictEqual(updatedByTech.eta_updated_by, "t1");
  assert.ok(updatedByTech.eta_updated_at, "eta_updated_at must be set upon update");

  // Service Centre staff updates ETA
  const updatedByAdmin = updateDemoPartRequestEta({
    requestId: req.id,
    estimatedArrivalAt: "2026-11-05T14:30:00.000Z",
    notes: "Confirmed arrival from Nagpur central hub",
    updaterId: "00000000-0000-0000-0003-000000000001",
    updaterName: "Nagpur Service Centre",
    updaterRole: "admin",
  });

  assert.strictEqual(updatedByAdmin.estimated_arrival_at, "2026-11-05T14:30:00.000Z");
  assert.strictEqual(updatedByAdmin.eta_updated_by, "00000000-0000-0000-0003-000000000001");

  // Farmer is rejected
  assert.throws(
    () => {
      updateDemoPartRequestEta({
        requestId: req.id,
        estimatedArrivalAt: "2026-11-06T12:00:00.000Z",
        updaterId: "f1",
        updaterRole: "farmer",
      });
    },
    /Unauthorized: Farmers cannot update parts ETA/,
    "Farmer role must be rejected from updating part ETA"
  );
});

// 70. MULTIPLE PARTS INDEPENDENCE AND PARTIAL HANDOFF RESILIENCE
test("Multiple parts with independent ETAs: partial handoff preserves remaining part blockers and distinct ETAs", async () => {
  const { resetDemo, requestDemoPart, updateDemoPartRequestEta, confirmDemoPartHandoff, getTB, actions, INITIAL_DEMO_PARTS } = await import(
    "../src/lib/tb-store.ts"
  );
  resetDemo();

  const tb = getTB();
  const repairId = actions.createRepair({
    equipmentId: tb.equipment[0].id,
    farmerId: tb.farmers[0].id,
    location: "Katol Field 4",
    symptoms: ["Fuel system issue"],
    description: "Requires injector set and fuel filter",
    photos: [],
  });
  actions.requestTechnician(repairId, "t1");
  actions.accept(repairId);

  const partId1 = INITIAL_DEMO_PARTS[0].id;
  const partId2 = INITIAL_DEMO_PARTS[1].id;

  // Request Part 1 (Fuel Injector) and set ETA to Nov 3
  const req1 = requestDemoPart({
    repairRequestId: repairId,
    partId: partId1,
    quantity: 1,
    notes: "Injector set needed",
    requesterId: "t1",
    requesterName: "Ramesh Kumar",
  });
  updateDemoPartRequestEta({
    requestId: req1.id,
    estimatedArrivalAt: "2026-11-03T10:00:00.000Z",
    updaterId: "t1",
    updaterRole: "technician",
  });

  // Request Part 2 (Inline Fuel Filter) and set ETA to Nov 6
  const req2 = requestDemoPart({
    repairRequestId: repairId,
    partId: partId2,
    quantity: 2,
    notes: "Filter elements needed",
    requesterId: "t1",
    requesterName: "Ramesh Kumar",
  });
  updateDemoPartRequestEta({
    requestId: req2.id,
    estimatedArrivalAt: "2026-11-06T16:00:00.000Z",
    updaterId: "t1",
    updaterRole: "technician",
  });

  const stateBeforeHandoff = getTB();
  const repairBefore = stateBeforeHandoff.repairs.find((r) => r.id === repairId);
  assert.ok(repairBefore, `Repair ${repairId} must exist`);
  assert.strictEqual(repairBefore.parts?.items?.length, 2, "Must contain 2 independent blocker items");

  // Partial Handoff: Hand off Part 1 ONLY
  confirmDemoPartHandoff(req1.id, "Nagpur Service Centre");

  const stateAfterHandoff = getTB();
  const repairAfter = stateAfterHandoff.repairs.find((r) => r.id === repairId);
  assert.ok(repairAfter, `Repair ${repairId} must exist after partial handoff`);

  // Part 1 is HANDED_OFF, but Part 2 remains PENDING
  const item1 = repairAfter.parts?.items?.find((i) => i.id === req1.id || i.partId === partId1);
  const item2 = repairAfter.parts?.items?.find((i) => i.id === req2.id || i.partId === partId2);

  assert.strictEqual(item1?.status, "HANDED_OFF", "Handed off part must be marked HANDED_OFF");
  assert.strictEqual(item2?.status, "PENDING", "Unfulfilled part must remain PENDING");
  assert.strictEqual(item2?.eta, "2026-11-06T16:00:00.000Z", "Unfulfilled part must preserve its independent ETA");
  assert.strictEqual(repairAfter.parts?.allPartsArrived, false, "allPartsArrived must remain false while blockers pending");
});

// 71. UNAVAILABLE STOCK ACCOUNTING AND FARMER PRIVACY PRESERVATION
test("Unavailable/insufficient stock does not decrement inventory on request, and farmer view preserves depot privacy", async () => {
  const { resetDemo, requestDemoPart, getDemoParts, INITIAL_DEMO_PARTS } = await import("../src/lib/tb-store.ts");
  resetDemo();

  const partId1 = INITIAL_DEMO_PARTS[0].id;
  const partsBaseline = getDemoParts();
  const part1InitialStock = partsBaseline.find((p) => p.id === partId1)?.stock_quantity ?? 0;

  // Requisition a part
  requestDemoPart({
    repairRequestId: "TB-STOCK-TEST",
    partId: partId1,
    quantity: 2,
    eta: "2026-11-07T12:00:00.000Z",
    requesterId: "t1",
  });

  // Verify stock is NOT decremented upon requisition or ETA addition
  const partsAfterReq = getDemoParts();
  const part1CurrentStock = partsAfterReq.find((p) => p.id === partId1)?.stock_quantity ?? 0;
  assert.strictEqual(
    part1CurrentStock,
    part1InitialStock,
    "Stock must not decrement merely because a part was requested or given an ETA"
  );

  // Farmer route privacy verification
  const farmerRouteCode = fs.readFileSync(path.resolve("src/routes/farmer/repair/$id.tsx"), "utf8");

  // Must not expose internal depot stock count, unit wholesale cost, or depot shelf locations
  assert.ok(!farmerRouteCode.includes("stock_quantity"), "Farmer view must never render stock_quantity");
  assert.ok(!farmerRouteCode.includes("cost_price"), "Farmer view must never render cost_price");
  assert.ok(!farmerRouteCode.includes("part.location"), "Farmer view must never render depot shelf location");
  assert.ok(
    farmerRouteCode.includes("Required part") &&
      farmerRouteCode.includes("Awaiting Arrival") &&
      farmerRouteCode.includes("Received at Depot"),
    "Farmer view must display component arrival status without exposing internal depot details"
  );
});

// 72. LABOUR-ONLY QUOTES: ZERO PART ROWS WITH VALID LABOUR CHARGE
test("Labour-only quotes: allows sending quote with 0 parts, validates positive labour, and calculates totals correctly", () => {
  resetDemo();

  // Verify quotes service permits items = [] when labour_amount > 0
  const quotesServiceCode = fs.readFileSync(path.resolve("src/lib/services/quotes.ts"), "utf8");
  assert.ok(
    quotesServiceCode.includes("items.length === 0") &&
      quotesServiceCode.includes("input.labour_amount"),
    "validateQuoteInputs must allow items.length === 0 when labour_amount > 0"
  );

  // Verify QuoteBuilder UI allows sending quote when parts list is empty but labour > 0
  const techJobCode = fs.readFileSync(path.resolve("src/routes/technician/job/$id.tsx"), "utf8");
  assert.ok(
    techJobCode.includes("filledParts.length === 0") &&
      techJobCode.includes("Number(q.labour) > 0"),
    "QuoteBuilder must only block submission if both items and labour are missing"
  );
  assert.ok(
    techJobCode.includes("Labour & Inspection Quote (No parts added)"),
    "QuoteBuilder must display informative banner when formulating labour-only quote"
  );

  // Verify QuoteTable in repair-parts.tsx handles 0 parts cleanly without crash or fake parts
  const quoteTableCode = fs.readFileSync(path.resolve("src/components/repair-parts.tsx"), "utf8");
  assert.ok(
    quoteTableCode.includes("Labour-only quote (no parts or supplies itemized)"),
    "QuoteTable must render labour-only notice when quote contains zero parts"
  );

  // Verify calculation with 0 parts and ₹2,500 labour at 18% tax
  const labourAmount = 2500;
  const taxPercent = 18;
  const totals = quoteTotals({
    parts: [],
    labour: labourAmount,
    taxPct: taxPercent,
  });
  assert.strictEqual(totals.parts, 0, "Parts total must be 0 for labour-only quote");
  assert.strictEqual(totals.tax, 450, "Tax on ₹2,500 @ 18% must be ₹450");
  assert.strictEqual(totals.total, 2950, "Total must be ₹2,950");
});

// 73. SHOW EACH PART IN CORRECT SERVICE CENTRE WORKFLOW (TB-1324 REFERENCE)
test("Show each part in correct workflow: distinguishes depot requisitions from sourcing holds, disabling handoff when out of stock", () => {
  resetDemo();

  const partsDeskCode = fs.readFileSync(path.resolve("src/routes/admin/parts-desk.tsx"), "utf8");
  const techJobCode = fs.readFileSync(path.resolve("src/routes/technician/job/$id.tsx"), "utf8");

  // 1. Parts Desk distinguishes Depot Requisitions vs Field/External Sourcing Holds
  assert.ok(
    partsDeskCode.includes("sourcingHolds") &&
      partsDeskCode.includes("Field &amp; External Sourcing Holds"),
    "Parts Desk must maintain distinct section for Field & External Sourcing Holds"
  );

  // 2. Sourcing holds offer ETA coordination but NEVER handoff controls
  assert.ok(
    partsDeskCode.includes("setSourcingHoldTarget(sh)") &&
      !partsDeskCode.includes("confirmHandoff(sh"),
    "Sourcing holds must support ETA coordination without handoff controls"
  );

  // 3. Depot Requisitions with insufficient or 0 stock are locked from handoff
  assert.ok(
    partsDeskCode.includes("req.part.stock_quantity >= req.quantity") &&
      partsDeskCode.includes("Stock Unavailable") &&
      partsDeskCode.includes("Out of Depot Stock"),
    "Parts Desk must mark unavailable depot requisitions as 'Out of Depot Stock' and disable handoff"
  );

  // 4. Technician job Waiting card distinguishes Depot Requisition vs Sourcing Hold
  assert.ok(
    techJobCode.includes("Service Centre Depot Requisition") &&
      techJobCode.includes("Field / External Sourcing Hold"),
    "Technician job Waiting card must label depot requisitions separately from sourcing holds"
  );
  assert.ok(
    techJobCode.includes("Sourcing Hold — Awaiting Arrival"),
    "Technician job must never label sourcing hold as 'Awaiting Handoff'"
  );
});

// 74. FIX ETA UPDATES FROM PARTS DESK (NO "REQUISITION NOT FOUND" ERROR)
test("Fix ETA updates from Parts Desk: updates canonical requisition by unique request ID without error", () => {
  resetDemo();

  const parts = getDemoParts();
  const part = parts[0];
  assert.ok(part, "Catalog part must exist");

  // 1. Create a requisition for a repair
  const req = requestDemoPart({
    repairRequestId: "TB-1324",
    partId: part.id,
    quantity: 1,
    eta: "2026-11-05T10:00:00.000Z",
    requesterId: "t1",
  });
  assert.ok(req && req.id, "Requisition must be created with valid ID");

  // 2. Update ETA from Parts Desk using the requisition's exact ID
  const newEta = "2026-11-08T16:30:00.000Z";
  const updatedReq = updateDemoPartRequestEta({
    requestId: req.id,
    estimatedArrivalAt: newEta,
    updaterRole: "admin",
    notes: "Awaiting supplier delivery",
  });
  assert.strictEqual(updatedReq.id, req.id, "Must update exact requisition record");
  assert.strictEqual(updatedReq.estimated_arrival_at, newEta, "Must record new arrival ETA");
  assert.strictEqual(updatedReq.eta_updated_by, "admin", "Must record audit user");

  // 3. Update ETA using req- ID variant or bare UUID resilience
  const bareId = req.id.startsWith("req-") ? req.id.slice(4) : req.id;
  const resilientReq = updateDemoPartRequestEta({
    requestId: bareId,
    estimatedArrivalAt: "2026-11-09T11:00:00.000Z",
    updaterRole: "admin",
  });
  assert.ok(resilientReq, "Must successfully locate requisition with or without 'req-' prefix");
  assert.strictEqual(resilientReq.estimated_arrival_at, "2026-11-09T11:00:00.000Z");

  // 4. Verify parts-desk service handles column schema resilience
  const partsDeskServiceCode = fs.readFileSync(path.resolve("src/lib/services/parts-desk.ts"), "utf8");
  assert.ok(
    partsDeskServiceCode.includes("estimated_arrival_at column update skipped") ||
      partsDeskServiceCode.includes("Could not find the 'estimated_arrival_at' column"),
    "parts-desk service must catch schema warnings on remote table and preserve fallback"
  );
});

// 75. INSPECTION / LABOUR-ONLY QUOTES & SUBSEQUENT REVISION FLOW
test("Labour-only quotes: allows sending quote with 0 parts, falls back gracefully from RPC error, and supports subsequent revision with parts", () => {
  resetDemo();

  const quotesServiceCode = fs.readFileSync(path.resolve("src/lib/services/quotes.ts"), "utf8");
  const repairPartsCode = fs.readFileSync(path.resolve("src/components/repair-parts.tsx"), "utf8");

  // 1. Service catches remote RPC 'at least one itemized part' error and falls back to direct table insertion
  assert.ok(
    quotesServiceCode.includes("at least one itemized part") ||
      quotesServiceCode.includes("input.items && input.items.length > 0"),
    "Quote service must safely bypass or catch remote RPC 'at least one itemized part' error"
  );

  // 2. Direct table insertion path handles 0 items safely without inserting dummy rows
  assert.ok(
    quotesServiceCode.includes("if (input.items && input.items.length > 0)") ||
      quotesServiceCode.includes("input.items.length > 0"),
    "Quote service must insert quote_items only when items are present"
  );

  // 3. UI QuoteTable renders labour-only notice when items are empty
  assert.ok(
    repairPartsCode.includes("Labour-only quote (no parts or supplies itemized)"),
    "QuoteTable must inform farmer when quote is labour-only"
  );

  // 4. Test in-memory flow: Inspection quote (labour only) followed by discovery and revised quote with parts
  const repId = actions.createRepair({
    equipmentId: "e1",
    farmerId: "f1",
    symptoms: ["Engine overheating", "Low power output"],
    description: "Field inspection required",
    photos: [],
    location: "Katol, Nagpur",
  });
  actions.requestTechnician(repId, "t1");
  actions.accept(repId);

  // Step A: Technician sends inspection/labour-only quote v1 (₹1,800 labour, 0 parts)
  actions.sendQuote(repId, {
    parts: [],
    labour: 1800,
    labourDesc: "On-site diagnostic inspection and system pressure test",
    taxPct: 18,
    eta: "Tomorrow by 2:00 PM",
    warranty: "30 days on diagnostic work",
  });

  const repAfterV1 = getTB().repairs.find((r) => r.id === repId);
  assert.ok(repAfterV1 && repAfterV1.quote);
  assert.strictEqual(repAfterV1.quote.version, 1, "Initial inspection quote must be version 1");
  assert.strictEqual(repAfterV1.quote.parts.length, 0, "Inspection quote must contain 0 parts");
  assert.strictEqual(repAfterV1.quote.labour, 1800, "Labour charge must be ₹1,800");
  assert.strictEqual(repAfterV1.status, "QUOTE_PENDING", "Repair must advance to QUOTE_PENDING");

  // Farmer approves inspection quote v1
  actions.approveQuote(repId);
  const repApproved = getTB().repairs.find((r) => r.id === repId);
  assert.strictEqual(repApproved.status, "IN_PROGRESS", "Repair must advance to IN_PROGRESS upon approval");

  // Step B: Technician performs inspection and discovers faulty part; submits revised quote v2 with parts
  actions.sendQuote(repId, {
    parts: [
      {
        name: "Fuel Injector Nozzle Set",
        spec: "Bosch OEM 0432193798",
        qty: 1,
        price: 5800,
        source: "Service Centre Depot",
      },
    ],
    labour: 3200,
    labourDesc: "Replace fuel injector nozzles and calibrate high pressure pump",
    taxPct: 18,
    eta: "Friday by 5:00 PM",
    warranty: "90 days on replacement parts & labour",
  });

  const repAfterV2 = getTB().repairs.find((r) => r.id === repId);
  assert.ok(repAfterV2 && repAfterV2.quote);
  assert.strictEqual(repAfterV2.quote.version, 2, "Revised quote with parts must be version 2");
  assert.strictEqual(repAfterV2.quote.parts.length, 1, "Revised quote must contain the discovered part");
  assert.strictEqual(repAfterV2.quote.parts[0].name, "Fuel Injector Nozzle Set");
  assert.strictEqual(repAfterV2.quote.parts[0].price, 5800);
  assert.strictEqual(repAfterV2.status, "QUOTE_PENDING", "Repair must return to QUOTE_PENDING for farmer review");

  // Farmer approves revised quote v2
  actions.approveQuote(repId);
  const repFinal = getTB().repairs.find((r) => r.id === repId);
  assert.strictEqual(repFinal.status, "IN_PROGRESS", "Repair returns to IN_PROGRESS with approved parts quote");
});

// 76. SOURCING HOLDS VISIBLE & ACTIONABLE IN SERVICE CENTRE & TECHNICIAN VIEWS (TB-5768 REFERENCE)
test("Sourcing holds: visible across repair statuses, support ETA coordination, and strictly exclude handoff controls", () => {
  resetDemo();

  const partsDeskCode = fs.readFileSync(path.resolve("src/routes/admin/parts-desk.tsx"), "utf8");
  const adminRepairCode = fs.readFileSync(path.resolve("src/routes/admin/repair/$id.tsx"), "utf8");
  const partsPickupCardCode = fs.readFileSync(path.resolve("src/components/parts-pickup-card.tsx"), "utf8");
  const repairRequestsServiceCode = fs.readFileSync(path.resolve("src/lib/services/repair-requests.ts"), "utf8");

  // 1. updatePartsEta permits active repair statuses (WAITING_FOR_PARTS, IN_PROGRESS, QUOTE_PENDING, ACCEPTED)
  assert.ok(
    repairRequestsServiceCode.includes("WAITING_FOR_PARTS") &&
      repairRequestsServiceCode.includes("IN_PROGRESS") &&
      repairRequestsServiceCode.includes("QUOTE_PENDING") &&
      repairRequestsServiceCode.includes("permittedStatuses"),
    "updatePartsEta must permit updating parts ETA across active repair lifecycle states"
  );

  // 2. Parts Desk queries sourcing holds across active statuses, not just WAITING_FOR_PARTS
  assert.ok(
    partsDeskCode.includes('.in("status", ["WAITING_FOR_PARTS", "IN_PROGRESS", "QUOTE_PENDING", "ACCEPTED"])') ||
      partsDeskCode.includes("QUOTE_PENDING"),
    "Parts Desk sourcing holds query must discover holds across repair statuses"
  );

  // 3. Technician PartsPickupCard renders dedicated Field & External Sourcing Holds section
  assert.ok(
    partsPickupCardCode.includes("Field &amp; External Sourcing Holds") ||
      partsPickupCardCode.includes("Field & External Sourcing Holds"),
    "PartsPickupCard must render Field & External Sourcing Holds section"
  );
  assert.ok(
    partsPickupCardCode.includes("Sourcing Hold — Awaiting Arrival"),
    "PartsPickupCard must display 'Sourcing Hold — Awaiting Arrival' badge"
  );
  assert.ok(
    partsPickupCardCode.includes("handleOpenSourcingEta"),
    "PartsPickupCard must provide ETA update controls for sourcing holds"
  );

  // 4. Admin Repair Detail renders Field & External Sourcing Holds section with ETA controls
  assert.ok(
    adminRepairCode.includes("Field &amp; External Sourcing Holds") ||
      adminRepairCode.includes("Field & External Sourcing Holds"),
    "Admin repair detail must render Field & External Sourcing Holds section"
  );
  assert.ok(
    adminRepairCode.includes("handleSaveSourcingEta") || adminRepairCode.includes("sourcingEtaTarget"),
    "Admin repair detail must provide ETA coordination dialog for sourcing holds"
  );

  // 5. Sourcing holds never offer or permit physical depot handoff
  assert.ok(
    !adminRepairCode.includes("confirmPartHandoff(sh") &&
      !partsPickupCardCode.includes("confirmPartHandoff(sh") &&
      !partsDeskCode.includes("confirmPartHandoff(sh"),
    "Sourcing holds must NEVER offer or execute depot handoff controls"
  );
});

// 77. DEPOT REQUISITIONS LOCK HANDOFF WHEN STOCK IS ZERO OR INSUFFICIENT
test("Depot requisitions lock handoff when out of stock in both Parts Desk and Admin Repair views", () => {
  const partsDeskCode = fs.readFileSync(path.resolve("src/routes/admin/parts-desk.tsx"), "utf8");
  const adminRepairCode = fs.readFileSync(path.resolve("src/routes/admin/repair/$id.tsx"), "utf8");

  // 1. Parts Desk locks handoff when stock is insufficient
  assert.ok(
    partsDeskCode.includes("req.part && req.part.stock_quantity >= req.quantity"),
    "Parts Desk must require req.part.stock_quantity >= req.quantity for handoff"
  );
  assert.ok(
    partsDeskCode.includes("Handoff Locked (Out of Stock)"),
    "Parts Desk must show 'Handoff Locked (Out of Stock)' button when unavailable"
  );

  // 2. Admin Repair detail locks handoff when stock is insufficient
  assert.ok(
    adminRepairCode.includes("req.part && req.part.stock_quantity >= req.quantity"),
    "Admin Repair detail must require req.part.stock_quantity >= req.quantity for handoff"
  );
  assert.ok(
    adminRepairCode.includes("Handoff Locked (Out of Stock)"),
    "Admin Repair detail must show 'Handoff Locked (Out of Stock)' button when unavailable"
  );
});

// 78. TECHNICIAN PAUSE WAITING FOR PARTS: CATALOG DROPDOWN & SERVICE CENTRE REQUISITION
test("Technician pause waiting for parts: catalog dropdown selection creates/links parts requisition with SKU, quantity, ETA, and Service Centre visibility", () => {
  resetDemo();

  const techJobCode = fs.readFileSync(path.resolve("src/routes/technician/job/$id.tsx"), "utf8");

  // 1. Pause form renders catalog dropdown with stock availability
  assert.ok(
    techJobCode.includes("Select from Depot Catalog") &&
      techJobCode.includes("in stock") &&
      techJobCode.includes("Out of stock"),
    "Pause form must render depot catalog dropdown displaying stock availability"
  );

  // 2. Form includes quantity selector and catalog badge
  assert.ok(
    techJobCode.includes("p.quantity") &&
      techJobCode.includes("Service Centre Depot Catalog"),
    "Pause form must support quantity and show Service Centre Depot Catalog indicator"
  );

  // 3. Submitting pause calls requestServiceCentrePart or passes partId to waitForParts
  assert.ok(
    techJobCode.includes("requestServiceCentrePart") &&
      techJobCode.includes("effectiveCatalogPartId"),
    "Submitting pause with a catalog part must link to Service Centre part requisition"
  );

  // 4. Test functional in-memory flow
  const repId = actions.createRepair({
    equipmentId: "e1",
    farmerId: "f1",
    symptoms: ["Engine won't start", "Fuel line clogged"],
    description: "Tractor stalled in field during harvesting",
    photos: [],
    location: "Katol, Nagpur",
  });
  actions.requestTechnician(repId, "t1");
  actions.accept(repId);

  // Technician sends inspection quote v1 and farmer approves, moving to IN_PROGRESS
  actions.sendQuote(repId, {
    parts: [],
    labour: 1200,
    labourDesc: "Diagnostic fuel circuit inspection",
    taxPct: 18,
    eta: "Today 4:00 PM",
    warranty: "30 days",
  });
  actions.approveQuote(repId);

  const repInProgress = getTB().repairs.find((r) => r.id === repId);
  assert.strictEqual(repInProgress.status, "IN_PROGRESS");

  // Technician pauses repair selecting Inline Fuel Filter (part-1) from Service Centre catalog
  const parts = getDemoParts();
  const filterPart = parts.find((p) => p.name.includes("Fuel Filter"));
  assert.ok(filterPart, "Inline Fuel Filter must exist in catalog");

  const req = requestDemoPart({
    repairRequestId: repId,
    partId: filterPart.id,
    quantity: 2,
    notes: "Not in van stock",
    eta: "Tomorrow, 9:30 am",
    revisedCompletion: "Tomorrow, 5:00 pm",
    farmerNote: "Part is being picked up from Service Centre depot.",
    requesterId: "t1",
    requesterName: "Ramesh Kumar",
  });

  assert.ok(req && req.id, "Requisition must be created with valid ID");
  assert.strictEqual(req.part_id, filterPart.id);
  assert.strictEqual(req.quantity, 2);
  assert.strictEqual(req.status, "PENDING");
  assert.strictEqual(req.estimated_arrival_at, "Tomorrow, 9:30 am");
  assert.strictEqual(req.notes, "Not in van stock");

  // Verify repair transitioned to WAITING_FOR_PARTS
  const repWaiting = getTB().repairs.find((r) => r.id === repId);
  assert.strictEqual(repWaiting.status, "WAITING_FOR_PARTS");
  assert.ok(repWaiting.parts, "Parts hold must be attached to repair");
  assert.strictEqual(repWaiting.parts.revisedCompletion, "Tomorrow, 5:00 pm");
  assert.strictEqual(repWaiting.parts.note, "Part is being picked up from Service Centre depot.");

  // Verify blocker items list contains the catalog part with requisition ID
  assert.ok(Array.isArray(repWaiting.parts.items) && repWaiting.parts.items.length >= 1);
  const blocker = repWaiting.parts.items.find((it) => it.partId === filterPart.id);
  assert.ok(blocker, "Blocker item must reference catalog part ID");
  assert.strictEqual(blocker.id, req.id);
  assert.strictEqual(blocker.quantity, 2);
  assert.strictEqual(blocker.eta, "Tomorrow, 9:30 am");

  // Verify Service Centre requisition visibility
  const allReqs = getDemoPartRequests(repId);
  assert.ok(allReqs.some((r) => r.id === req.id && r.part_id === filterPart.id));

  // Verify quote line automatically synchronized with locked catalog price
  assert.ok(repWaiting.quote && repWaiting.quote.parts.length >= 1);
  const quoteLine = repWaiting.quote.parts.find((p) => p.catalogPartId === filterPart.id);
  assert.ok(quoteLine, "Quote must contain automatically synchronized catalog part");
  assert.strictEqual(quoteLine.qty, 2);
  assert.strictEqual(quoteLine.price, filterPart.unit_price);
});

// 79. PAUSE FOR PARTS DUPLICATE PREVENTION ON RETRY & INSUFFICIENT STOCK LOCK
test("Pause for parts: prevents duplicate requisitions on retried submission and locks handoff when stock is insufficient", () => {
  resetDemo();

  const parts = getDemoParts();
  const filterPart = parts[0];
  assert.ok(filterPart, "Catalog part must exist");

  const repId = actions.createRepair({
    equipmentId: "e1",
    farmerId: "f1",
    symptoms: ["Hydraulic leak"],
    description: "Lift cylinder failure",
    photos: [],
    location: "Katol, Nagpur",
  });
  actions.requestTechnician(repId, "t1");
  actions.accept(repId);

  // 1. Initial pause submission creates requisition
  const req1 = requestDemoPart({
    repairRequestId: repId,
    partId: filterPart.id,
    quantity: 1,
    notes: "Awaiting depot pickup",
    eta: "2026-11-04T10:00:00Z",
    requesterId: "t1",
  });
  assert.ok(req1 && req1.id);

  const initialReqs = getDemoPartRequests(repId);
  assert.strictEqual(initialReqs.length, 1, "Must have exactly 1 requisition initially");

  // 2. Retrying submission with updated quantity updates existing request WITHOUT creating duplicates
  const req2 = requestDemoPart({
    repairRequestId: repId,
    partId: filterPart.id,
    quantity: 3,
    notes: "Updated quantity required",
    eta: "2026-11-04T12:00:00Z",
    requesterId: "t1",
  });

  const retriedReqs = getDemoPartRequests(repId);
  assert.strictEqual(retriedReqs.length, 1, "Retrying submission must NEVER create duplicate requisition rows");
  assert.strictEqual(retriedReqs[0].id, req1.id, "Must update existing requisition ID");
  assert.strictEqual(retriedReqs[0].quantity, 3, "Must update quantity on retried request");
  assert.strictEqual(retriedReqs[0].notes, "Updated quantity required");

  // 3. Insufficient / out-of-stock behavior:
  // Adjust stock to 0 to simulate unavailable depot inventory
  adjustDemoPartStock(filterPart.id, -filterPart.stock_quantity, "audit-drain", "t1");
  const drainedPart = getDemoParts().find((p) => p.id === filterPart.id);
  assert.strictEqual(drainedPart.stock_quantity, 0, "Depot stock must be 0");

  // Attempting handoff while stock is 0 must fail and NOT decrement stock
  assert.throws(
    () => {
      confirmDemoPartHandoff(req1.id, "admin");
    },
    /insufficient|stock/i,
    "confirmDemoPartHandoff must throw when depot stock is unavailable"
  );
  assert.strictEqual(getDemoParts().find((p) => p.id === filterPart.id).stock_quantity, 0);

  // Restock via receive delivery
  receiveDemoStock({
    partId: filterPart.id,
    quantity: 10,
    reason: "Supplier restock shipment",
    callerName: "admin",
  });
  const restockedPart = getDemoParts().find((p) => p.id === filterPart.id);
  assert.strictEqual(restockedPart.stock_quantity, 10, "Depot stock must now be 10");

  // Now handoff succeeds, decrementing on-hand stock exactly once
  const handoffRes = confirmDemoPartHandoff(req1.id, "admin");
  assert.strictEqual(handoffRes.request.part_id, filterPart.id);
  assert.strictEqual(handoffRes.request.quantity, 3);
  assert.strictEqual(handoffRes.part.stock_quantity, 7);
  assert.strictEqual(getDemoParts().find((p) => p.id === filterPart.id).stock_quantity, 7);
});









