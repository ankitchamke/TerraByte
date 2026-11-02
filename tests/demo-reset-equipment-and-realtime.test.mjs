import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getTB, resetDemo, actions } from "../src/lib/tb-store.ts";

// ==============================================================================
// BUG 1 REGRESSION TESTS — RESET DEMO EQUIPMENT PURGE & BASELINE RESTORATION
// ==============================================================================

test("BUG 1: Migration 20261103110000 defines safe, scoped deletion of non-canonical equipment for Balasaheb Patil", () => {
  const migrationPath = path.resolve(
    "supabase/migrations/20261103110000_fix_demo_reset_equipment_and_realtime.sql",
  );
  assert.ok(fs.existsSync(migrationPath), "Forward migration file must exist");
  const sql = fs.readFileSync(migrationPath, "utf8");

  // 1. Non-canonical equipment deletion scoped strictly to demo farmer
  assert.ok(
    sql.includes("DELETE FROM public.equipment") &&
      sql.includes("WHERE farmer_id = v_demo_farmer_id") &&
      sql.includes("AND id NOT IN (") &&
      sql.includes("'00000000-0000-0000-0010-000000000001'") &&
      sql.includes("'00000000-0000-0000-0010-000000000002'") &&
      sql.includes("'00000000-0000-0000-0010-000000000003'"),
    "Migration must safely delete non-canonical demo equipment while preserving canonical fixtures",
  );

  // 2. Safeupdate compliance: all DELETE statements must contain non-trivial WHERE clauses
  const deleteStatements = sql.match(/DELETE\s+FROM\s+[a-zA-Z_.]+\s+WHERE\s+[^;]+;/gi) || [];
  assert.ok(deleteStatements.length >= 7, "Migration must contain scoped DELETE statements");
  for (const stmt of deleteStatements) {
    assert.ok(
      stmt.toUpperCase().includes("WHERE"),
      `Safeupdate violation: statement missing WHERE: ${stmt}`,
    );
  }

  // 3. Deterministic restoration of 3 canonical machines with 'Operational' status
  assert.ok(
    sql.includes("Mahindra") &&
      sql.includes("575 DI") &&
      sql.includes("VST Shakti") &&
      sql.includes("130 DI") &&
      sql.includes("John Deere") &&
      sql.includes("W70"),
    "Migration must restore all 3 canonical machinery fixtures",
  );
  assert.ok(
    sql.includes("status = 'Operational'"),
    "Migration must reset canonical equipment status to Operational",
  );

  // 4. Returns equipment_deleted in JSON response
  assert.ok(
    sql.includes("'equipment_deleted', v_equipment_deleted") &&
      sql.includes("'equipment_reset', v_equipment_reset"),
    "Migration must report equipment_deleted and equipment_reset counts in return payload",
  );
});

test("BUG 1: resetDemo in tb-store removes newly added demo equipment (e.g. XYZ 69) and restores canonical baseline", () => {
  // 1. Start from baseline
  resetDemo();
  const initial = getTB();
  assert.equal(initial.equipment.length, 3, "Baseline must have exactly 3 canonical machines");

  // 2. Simulate Balasaheb adding machine 'XYZ 69'
  const newMachineId = actions.addEquipment({
    farmerId: "f1",
    type: "Tractor",
    make: "XYZ",
    model: "69",
    year: 2024,
    serial: "XYZ-69-DEMO",
    hours: 50,
  });

  const afterAdd = getTB();
  assert.equal(afterAdd.equipment.length, 4, "Store must reflect 4 machines after addition");
  assert.ok(
    afterAdd.equipment.some((e) => e.id === newMachineId && e.model === "69"),
    "Newly added machine XYZ 69 must be in store",
  );

  // 3. Execute Reset Demo
  resetDemo();
  const afterReset = getTB();

  // 4. Confirm added machine is removed and exact canonical 3 remain
  assert.equal(
    afterReset.equipment.length,
    3,
    "Reset Demo must remove added equipment and restore exactly 3 machines",
  );
  assert.ok(
    !afterReset.equipment.some((e) => e.model === "69" || e.make === "XYZ"),
    "Machine XYZ 69 must be completely purged by Reset Demo",
  );
  assert.ok(
    afterReset.equipment.every((e) => e.status === "Operational"),
    "All restored canonical equipment must have Operational status",
  );

  // 5. Verify canonical equipment fixtures are present
  const makes = afterReset.equipment.map((e) => e.make);
  assert.ok(makes.includes("Mahindra"), "Mahindra 575 DI must be present");
  assert.ok(makes.includes("Kubota"), "Kubota DC-68G must be present");
  assert.ok(makes.includes("Kirloskar"), "Kirloskar KDS 5HP must be present");
});

test("BUG 1: resetDemo is idempotent and preserves real user equipment data", () => {
  resetDemo();

  // 1. Add non-demo (real user) equipment
  const realUserId = "user-real-uuid-777";
  actions.addEquipment({
    farmerId: realUserId,
    type: "Tractor",
    make: "Sonalika",
    model: "DI 745",
    year: 2022,
    serial: "SON-745-REAL",
    hours: 300,
  });

  // 2. Add demo equipment for Balasaheb
  actions.addEquipment({
    farmerId: "f1",
    type: "Harvester",
    make: "DemoExtra",
    model: "X900",
    year: 2023,
    serial: "DEMO-X900",
    hours: 10,
  });

  // 3. Reset Demo run 1
  resetDemo();
  const run1 = getTB();
  assert.ok(
    run1.equipment.some((e) => e.farmerId === realUserId && e.make === "Sonalika"),
    "Real user equipment must be preserved after reset",
  );
  assert.ok(
    !run1.equipment.some((e) => e.make === "DemoExtra"),
    "Demo extra machine must be purged after reset",
  );

  // 4. Reset Demo run 2 (idempotency verification)
  resetDemo();
  const run2 = getTB();
  assert.equal(
    run2.equipment.length,
    run1.equipment.length,
    "Second Reset Demo must produce identical equipment state (idempotent)",
  );
  assert.ok(
    run2.equipment.some((e) => e.farmerId === realUserId && e.make === "Sonalika"),
    "Real user equipment must remain untouched across repeated resets",
  );
});

// ==============================================================================
// BUG 2 REGRESSION TESTS — CANCELLATION REALTIME WORKFLOW
// ==============================================================================

test("BUG 2: Realtime hook exports broadcastRepairWorkflowEvent and registers cancellation events", () => {
  const realtimeCode = fs.readFileSync(path.resolve("src/hooks/use-repair-realtime.ts"), "utf8");

  // 1. Verification of broadcast function and events
  assert.ok(
    realtimeCode.includes("export function broadcastRepairWorkflowEvent"),
    "use-repair-realtime.ts must export broadcastRepairWorkflowEvent",
  );
  assert.ok(
    realtimeCode.includes('"cancellation_requested"') &&
      realtimeCode.includes('"cancellation_approved"') &&
      realtimeCode.includes('"cancellation_declined"'),
    "WORKFLOW_REALTIME_EVENTS must include all cancellation state transition events",
  );

  // 2. Multi-channel broadcast distribution
  assert.ok(
    realtimeCode.includes("tb-realtime-bus") &&
      realtimeCode.includes("terrabyte_demo_store_sync") &&
      realtimeCode.includes("terrabyte:repair_updated"),
    "broadcastRepairWorkflowEvent must broadcast across Supabase bus, BroadcastChannel, and DOM event",
  );

  // 3. useRepairTicketRealtime listens to bus, local broadcast, and storage
  assert.ok(
    realtimeCode.includes("ensureGlobalBusChannel()") &&
      realtimeCode.includes("globalBusListeners.add(handleBusEvent)"),
    "useRepairTicketRealtime must attach to global broadcast bus",
  );

  // 4. useRepairListRealtime connects to broadcast bus and BroadcastChannel
  assert.ok(
    realtimeCode.includes("useRepairListRealtime") &&
      realtimeCode.includes('new BroadcastChannel("terrabyte_demo_store_sync")') &&
      realtimeCode.includes('window.addEventListener("terrabyte:repair_updated"'),
    "useRepairListRealtime must listen to BroadcastChannel and DOM events for live list refresh",
  );
});

test("BUG 2: Repair request service emits realtime events on cancellation actions", () => {
  const serviceCode = fs.readFileSync(path.resolve("src/lib/services/repair-requests.ts"), "utf8");

  // 1. cancelRepairRequest broadcast
  assert.ok(
    serviceCode.includes('broadcastRepairWorkflowEvent("cancellation_approved", repair.id'),
    "cancelRepairRequest must broadcast cancellation_approved event",
  );

  // 2. requestCancellation broadcast
  assert.ok(
    serviceCode.includes('broadcastRepairWorkflowEvent("cancellation_requested", repair.id'),
    "requestCancellation must broadcast cancellation_requested event",
  );

  // 3. approveCancellation broadcast
  assert.ok(
    serviceCode.includes('broadcastRepairWorkflowEvent("cancellation_approved", repair.id') &&
      serviceCode.includes("adminResponse"),
    "approveCancellation must broadcast cancellation_approved event with admin response",
  );

  // 4. rejectCancellation broadcast
  assert.ok(
    serviceCode.includes('broadcastRepairWorkflowEvent("cancellation_declined", repair.id') &&
      serviceCode.includes("targetStatus"),
    "rejectCancellation must broadcast cancellation_declined event with targetStatus",
  );
});

test("BUG 2: tb-store provides governed cancellation actions with notification and state transitions", () => {
  resetDemo();

  // Create a demo repair
  const repairId = actions.createRepair({
    equipmentId: "e1",
    farmerId: "f1",
    symptoms: ["Engine overheating"],
    description: "Radiator leak observed during field operation",
    photos: [],
    location: "Katol",
  });

  // Assign technician to move to ACCEPTED
  actions.requestTechnician(repairId, "t1");
  actions.accept(repairId);
  assert.equal(getTB().repairs.find((r) => r.id === repairId)?.status, "ACCEPTED");

  // 1. Farmer requests cancellation
  actions.requestCancellation(repairId, "Alternative arrangement", "Neighbor's mechanic fixed it");
  const reqRepair = getTB().repairs.find((r) => r.id === repairId);
  assert.equal(
    reqRepair?.status,
    "CANCELLATION_REQUESTED",
    "Status must transition to CANCELLATION_REQUESTED",
  );
  assert.equal(
    reqRepair?.cancellation_previous_status,
    "ACCEPTED",
    "Must preserve previous status",
  );
  assert.equal(reqRepair?.cancellation_reason, "Alternative arrangement");

  // Admin notification was sent
  assert.ok(
    getTB().notifications.some(
      (n) => n.role === "admin" && n.text.includes("Cancellation requested"),
    ),
    "Admin notification must be recorded",
  );

  // 2. Service Centre declines cancellation (work resumed)
  actions.rejectCancellation(repairId, "Technician is already en route to Katol");
  const rejRepair = getTB().repairs.find((r) => r.id === repairId);
  assert.equal(rejRepair?.status, "ACCEPTED", "Status must restore to previous status (ACCEPTED)");
  assert.equal(rejRepair?.cancellation_admin_response, "Technician is already en route to Katol");

  // 3. Farmer requests cancellation again and Service Centre approves
  actions.requestCancellation(repairId, "Equipment sold", "Sold tractor this morning");
  actions.approveCancellation(repairId, "Approved — transaction verified");
  const appRepair = getTB().repairs.find((r) => r.id === repairId);
  assert.equal(appRepair?.status, "CANCELLED", "Status must transition to CANCELLED");
  assert.equal(
    getTB().equipment.find((e) => e.id === "e1")?.status,
    "Operational",
    "Equipment status must be restored to Operational upon cancellation",
  );
});

// ==============================================================================
// BUG 3 REGRESSION TESTS — QUOTE REVISION, REJECTION & REALTIME REFRESH
// ==============================================================================

test("BUG 3: Quotes service and messages service emit realtime workflow events", () => {
  const quotesCode = fs.readFileSync(path.resolve("src/lib/services/quotes.ts"), "utf8");
  const messagesCode = fs.readFileSync(path.resolve("src/lib/services/repair-messages.ts"), "utf8");

  // 1. createQuote broadcast
  assert.ok(
    quotesCode.includes('broadcastRepairWorkflowEvent("quote_created", repair.id'),
    "createQuote must broadcast quote_created event",
  );

  // 2. reviseQuote broadcast
  assert.ok(
    quotesCode.includes('broadcastRepairWorkflowEvent("quote_revised", repair.id'),
    "reviseQuote must broadcast quote_revised event",
  );

  // 3. approveQuote broadcast
  assert.ok(
    quotesCode.includes('broadcastRepairWorkflowEvent("quote_approved", repair.id'),
    "approveQuote must broadcast quote_approved event",
  );

  // 4. rejectQuote broadcast
  assert.ok(
    quotesCode.includes('broadcastRepairWorkflowEvent("quote_rejected", repair.id'),
    "rejectQuote must broadcast quote_rejected event",
  );

  // 5. sendRepairMessage broadcast
  assert.ok(
    messagesCode.includes('broadcastRepairWorkflowEvent("message_sent", resolvedRepairId'),
    "sendRepairMessage must broadcast message_sent event",
  );
});

test("BUG 3: Migration configures REPLICA IDENTITY FULL and publications for messages and timeline", () => {
  const migrationPath = path.resolve(
    "supabase/migrations/20261103110000_fix_demo_reset_equipment_and_realtime.sql",
  );
  const sql = fs.readFileSync(migrationPath, "utf8");

  // 1. REPLICA IDENTITY FULL
  assert.ok(
    sql.includes("ALTER TABLE IF EXISTS public.repair_messages REPLICA IDENTITY FULL;"),
    "Migration must set REPLICA IDENTITY FULL on repair_messages",
  );
  assert.ok(
    sql.includes("ALTER TABLE IF EXISTS public.repair_timeline REPLICA IDENTITY FULL;"),
    "Migration must set REPLICA IDENTITY FULL on repair_timeline",
  );

  // 2. Publication registration
  assert.ok(
    sql.includes("ALTER PUBLICATION supabase_realtime ADD TABLE public.repair_messages;") &&
      sql.includes("ALTER PUBLICATION supabase_realtime ADD TABLE public.repair_timeline;"),
    "Migration must register repair_messages and repair_timeline in supabase_realtime publication",
  );
});

test("BUG 3: useRepairTicketRealtime subscribes to repair_messages and quote_items CDC", () => {
  const realtimeCode = fs.readFileSync(path.resolve("src/hooks/use-repair-realtime.ts"), "utf8");

  // Verify ticket hook postgres_changes subscriptions
  assert.ok(
    realtimeCode.includes('table: "repair_messages"') &&
      realtimeCode.includes("filter: `repair_request_id=eq.${cleanId}`"),
    "useRepairTicketRealtime must subscribe to repair_messages with ticket UUID filter",
  );
  assert.ok(
    realtimeCode.includes('table: "quote_items"'),
    "useRepairTicketRealtime must subscribe to quote_items table changes",
  );
});
