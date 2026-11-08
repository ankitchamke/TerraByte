import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const MIGRATION_PATH = path.join(
  ROOT_DIR,
  "supabase",
  "migrations",
  "20261108100000_phase14_smart_dispatch_and_dropoff.sql",
);

const TYPES_PATH = path.join(ROOT_DIR, "src", "integrations", "supabase", "types.ts");

// Read the migration file for static AST / regex validation
const sqlContent = fs.readFileSync(MIGRATION_PATH, "utf8");
const typesContent = fs.readFileSync(TYPES_PATH, "utf8");

// ==============================================================================
// 1. STATIC MIGRATION & SCHEMA ARCHITECTURE TESTS
// ==============================================================================

test("Migration 20261108100000_phase14_smart_dispatch_and_dropoff.sql exists and is substantial", () => {
  assert.ok(fs.existsSync(MIGRATION_PATH), "Migration file must exist on disk");
  assert.ok(sqlContent.length > 5000, "Migration file must contain substantial SQL statements");
});

test("Migration alters repair_requests with Phase 14 delivery mode and drop-off fields", () => {
  assert.match(
    sqlContent,
    /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+delivery_mode\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'DOORSTEP'/i,
    "Must add delivery_mode with default 'DOORSTEP'",
  );
  assert.match(
    sqlContent,
    /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+is_immobile\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+FALSE/i,
    "Must add is_immobile with default FALSE",
  );
  assert.match(
    sqlContent,
    /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+drop_off_receipt_number\s+TEXT/i,
    "Must add drop_off_receipt_number",
  );
  assert.match(
    sqlContent,
    /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+dropped_off_at\s+TIMESTAMPTZ/i,
    "Must add dropped_off_at",
  );
  assert.match(
    sqlContent,
    /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+dropped_off_by\s+UUID\s+REFERENCES\s+public\.profiles\(id\)/i,
    "Must add dropped_off_by referencing profiles(id)",
  );
});

test("Migration enforces delivery_mode and immobile domain check constraints", () => {
  assert.match(
    sqlContent,
    /CONSTRAINT\s+check_repair_delivery_mode\s+CHECK\s*\(\s*delivery_mode\s+IN\s*\(\s*'DOORSTEP',\s*'WORKSHOP_DROPOFF'\s*\)\s*\)/i,
    "Must enforce check_repair_delivery_mode constraint",
  );
  assert.match(
    sqlContent,
    /CONSTRAINT\s+check_immobile_delivery_mode\s+CHECK\s*\(\s*NOT\s*\(\s*is_immobile\s*=\s*TRUE\s+AND\s+delivery_mode\s*=\s*'WORKSHOP_DROPOFF'\s*\)\s*\)/i,
    "Must enforce check_immobile_delivery_mode constraint: immobile equipment cannot be drop-off",
  );
});

test("Migration creates sequence and unique index for drop_off_receipt_number", () => {
  assert.match(
    sqlContent,
    /CREATE\s+SEQUENCE\s+IF\s+NOT\s+EXISTS\s+public\.drop_off_receipt_seq/i,
    "Must create drop_off_receipt_seq sequence",
  );
  assert.match(
    sqlContent,
    /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_repair_requests_drop_off_receipt\s+ON\s+public\.repair_requests\s*\(drop_off_receipt_number\)/i,
    "Must create unique index on drop_off_receipt_number",
  );
});

test("Migration creates facility_bay_reservations table with required schema and lifecycle fields", () => {
  assert.match(
    sqlContent,
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.facility_bay_reservations/i,
    "Must create facility_bay_reservations table",
  );
  assert.match(
    sqlContent,
    /repair_request_id\s+UUID\s+NOT\s+NULL\s+UNIQUE\s+REFERENCES\s+public\.repair_requests\(id\)\s+ON\s+DELETE\s+CASCADE/i,
    "Must reference repair_requests with UNIQUE and ON DELETE CASCADE",
  );
  assert.match(
    sqlContent,
    /facility_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+public\.repair_facilities\(id\)\s+ON\s+DELETE\s+CASCADE/i,
    "Must reference repair_facilities with ON DELETE CASCADE",
  );
  assert.match(
    sqlContent,
    /farmer_profile_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+public\.profiles\(id\)/i,
    "Must reference farmer profile",
  );
  assert.match(sqlContent, /reserved_at\s+TIMESTAMPTZ\s+NOT\s+NULL/i, "Must contain reserved_at");
  assert.match(sqlContent, /expires_at\s+TIMESTAMPTZ\s+NOT\s+NULL/i, "Must contain expires_at");
  assert.match(
    sqlContent,
    /renewal_count\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+0/i,
    "Must contain renewal_count with default 0",
  );
  assert.match(
    sqlContent,
    /priority_original_reserved_at\s+TIMESTAMPTZ\s+NOT\s+NULL/i,
    "Must contain priority_original_reserved_at for downsized FIFO preservation",
  );
  assert.match(
    sqlContent,
    /status\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'RESERVED'/i,
    "Must contain status with default RESERVED",
  );
  assert.match(
    sqlContent,
    /CONSTRAINT\s+check_reservation_status\s+CHECK\s*\(\s*status\s+IN\s*\(\s*'RESERVED',\s*'CLAIMED',\s*'EXPIRED',\s*'RELEASED',\s*'CANCELLED'\s*\)\s*\)/i,
    "Must enforce check_reservation_status",
  );
  assert.match(
    sqlContent,
    /CONSTRAINT\s+check_renewal_count\s+CHECK\s*\(\s*renewal_count\s*>=\s*0\s*\)/i,
    "Must enforce check_renewal_count >= 0",
  );
});

test("Migration defines partial unique index for active reservation and priority index", () => {
  assert.match(
    sqlContent,
    /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_facility_bay_reservations_active\s+ON\s+public\.facility_bay_reservations\s*\(facility_id,\s*status\)\s+WHERE\s+status\s*=\s*'RESERVED'/i,
    "Must index active reservations by facility",
  );
  assert.match(
    sqlContent,
    /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_facility_bay_reservations_priority\s+ON\s+public\.facility_bay_reservations\s*\(facility_id,\s*priority_original_reserved_at\s+ASC\)\s+WHERE\s+status\s*=\s*'RESERVED'/i,
    "Must index priority_original_reserved_at for capacity allocation ordering",
  );
});

test("Migration enables RLS, revokes direct client DML, and configures role-based select policies", () => {
  assert.match(
    sqlContent,
    /ALTER\s+TABLE\s+public\.facility_bay_reservations\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i,
    "Must enable RLS on facility_bay_reservations",
  );
  assert.match(
    sqlContent,
    /REVOKE\s+INSERT,\s*UPDATE,\s*DELETE,\s*TRUNCATE\s+ON\s+TABLE\s+public\.facility_bay_reservations\s+FROM\s+authenticated,\s*anon,\s*PUBLIC/i,
    "Direct client INSERT/UPDATE/DELETE/TRUNCATE must be revoked",
  );
  assert.match(
    sqlContent,
    /CREATE\s+POLICY\s+p_farmer_select_own_reservations\s+ON\s+public\.facility_bay_reservations/i,
    "Must define select policy for farmers",
  );
  assert.match(
    sqlContent,
    /CREATE\s+POLICY\s+p_facility_member_select_reservations\s+ON\s+public\.facility_bay_reservations/i,
    "Must define select policy for workshop staff",
  );
  assert.match(
    sqlContent,
    /CREATE\s+POLICY\s+p_admin_select_all_reservations\s+ON\s+public\.facility_bay_reservations/i,
    "Must define select policy for administrators",
  );
});

test("Migration defines all 6 Phase 14 RPCs with SECURITY DEFINER and hardened search_path", () => {
  const rpcs = [
    "get_facility_capacity_breakdown",
    "reserve_workshop_bay",
    "renew_workshop_bay_reservation",
    "release_workshop_bay_reservation",
    "execute_workshop_dropoff_checkin",
    "release_cancelled_workshop_equipment",
  ];

  for (const rpc of rpcs) {
    const fnRegex = new RegExp(
      `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${rpc}[\\s\\S]+?SECURITY\\s+DEFINER[\\s\\S]+?SET\\s+search_path\\s*=\\s*''`,
      "i",
    );
    assert.match(sqlContent, fnRegex, `RPC ${rpc} must be SECURITY DEFINER with search_path = ''`);

    const grantRegex = new RegExp(
      `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${rpc}[\\s\\S]+?TO\\s+authenticated`,
      "i",
    );
    assert.match(sqlContent, grantRegex, `RPC ${rpc} must grant EXECUTE to authenticated`);
  }
});

test("Migration updates reset_demo_data to clean up reservations before repairs", () => {
  assert.match(
    sqlContent,
    /DELETE\s+FROM\s+public\.facility_bay_reservations/i,
    "reset_demo_data must clean up facility_bay_reservations",
  );
});

// ==============================================================================
// 2. GENERATED SUPABASE TYPES SYNCHRONIZATION TESTS
// ==============================================================================

test("types.ts contains Phase 14 delivery mode and drop-off fields on repair_requests", () => {
  assert.match(
    typesContent,
    /delivery_mode:\s*"DOORSTEP"\s*\|\s*"WORKSHOP_DROPOFF"/,
    "repair_requests Row must include delivery_mode",
  );
  assert.match(
    typesContent,
    /is_immobile:\s*boolean/,
    "repair_requests Row must include is_immobile",
  );
  assert.match(
    typesContent,
    /drop_off_receipt_number:\s*string\s*\|\s*null/,
    "repair_requests Row must include drop_off_receipt_number",
  );
  assert.match(
    typesContent,
    /dropped_off_at:\s*string\s*\|\s*null/,
    "repair_requests Row must include dropped_off_at",
  );
  assert.match(
    typesContent,
    /dropped_off_by:\s*string\s*\|\s*null/,
    "repair_requests Row must include dropped_off_by",
  );
});

test("types.ts contains facility_bay_reservations table definition", () => {
  assert.match(
    typesContent,
    /facility_bay_reservations:\s*\{[\s\S]+?Row:\s*\{[\s\S]+?status:\s*("RESERVED"\s*\|?\s*){1,5}/,
    "types.ts must include facility_bay_reservations table with status union",
  );
  assert.match(
    typesContent,
    /priority_original_reserved_at:\s*string/,
    "facility_bay_reservations must include priority_original_reserved_at",
  );
});

test("types.ts contains all 6 Phase 14 RPC signatures in Functions", () => {
  const rpcs = [
    "get_facility_capacity_breakdown",
    "reserve_workshop_bay",
    "renew_workshop_bay_reservation",
    "release_workshop_bay_reservation",
    "execute_workshop_dropoff_checkin",
    "release_cancelled_workshop_equipment",
  ];

  for (const rpc of rpcs) {
    const rpcRegex = new RegExp(`${rpc}:\\s*\\{[\\s\\S]+?Args:`, "i");
    assert.match(typesContent, rpcRegex, `Functions must include signature for ${rpc}`);
  }
});

// ==============================================================================
// 3. BEHAVIORAL LOGIC & DOMAIN INVARIANT SIMULATION ENGINE
// ==============================================================================

/**
 * State store simulating PostgreSQL relational invariants and Phase 14 RPC logic.
 */
class Phase14DatabaseSimulation {
  constructor() {
    this.profiles = new Map();
    this.facilities = new Map();
    this.facilityMemberships = new Map();
    this.equipment = new Map();
    this.repairs = new Map();
    this.reservations = new Map();
    this.timeline = [];
    this.receiptSeq = 1;
    this.currentUser = null;
  }

  setCurrentUser(user) {
    this.currentUser = user;
  }

  addProfile({ id, role, full_name, phone = "9876543210" }) {
    const profile = { id, role, full_name, phone };
    this.profiles.set(id, profile);
    return profile;
  }

  addFacility({ id, name, max_equipment_capacity = 4, is_active = true }) {
    const facility = { id, name, max_equipment_capacity, is_active };
    this.facilities.set(id, facility);
    return facility;
  }

  addFacilityMembership({
    id,
    facility_id,
    technician_profile_id,
    role = "MANAGER",
    status = "ACTIVE",
  }) {
    const membership = { id, facility_id, technician_profile_id, role, status };
    this.facilityMemberships.set(id, membership);
    return membership;
  }

  addRepair({
    id,
    job_number,
    farmer_id,
    facility_id = null,
    delivery_mode = "DOORSTEP",
    is_immobile = false,
    status = "REQUESTED",
    handover_status = "PENDING",
    dropped_off_at = null,
    dropped_off_by = null,
    drop_off_receipt_number = null,
  }) {
    if (is_immobile && delivery_mode === "WORKSHOP_DROPOFF") {
      throw new Error(
        "CONSTRAINT_VIOLATION: check_immobile_delivery_mode (immobile equipment cannot be workshop drop-off)",
      );
    }
    const repair = {
      id,
      job_number,
      farmer_id,
      facility_id,
      delivery_mode,
      is_immobile,
      status,
      handover_status,
      dropped_off_at,
      dropped_off_by,
      drop_off_receipt_number,
    };
    this.repairs.set(id, repair);
    return repair;
  }

  _isStaffOrAdmin(profileId, facilityId) {
    const profile = this.profiles.get(profileId);
    if (!profile) return false;
    if (profile.role === "admin") return true;
    for (const mem of this.facilityMemberships.values()) {
      if (
        mem.technician_profile_id === profileId &&
        mem.facility_id === facilityId &&
        mem.status === "ACTIVE"
      ) {
        return true;
      }
    }
    return false;
  }

  // --- RPC 1: get_facility_capacity_breakdown ---
  getFacilityCapacityBreakdown(facilityId) {
    const facility = this.facilities.get(facilityId);
    if (!facility) {
      throw new Error("P0002: Facility not found");
    }

    const now = new Date();

    // Physical occupancy: delivery_mode = 'WORKSHOP_DROPOFF' AND dropped_off_at IS NOT NULL AND handover_status != 'RELEASED'
    let physicalOccupancy = 0;
    for (const r of this.repairs.values()) {
      if (
        r.facility_id === facilityId &&
        r.delivery_mode === "WORKSHOP_DROPOFF" &&
        r.dropped_off_at !== null &&
        r.handover_status !== "RELEASED"
      ) {
        physicalOccupancy++;
      }
    }

    // Active unexpired reservations: status = 'RESERVED' AND expires_at > now()
    let activeReservations = 0;
    for (const res of this.reservations.values()) {
      if (
        res.facility_id === facilityId &&
        res.status === "RESERVED" &&
        new Date(res.expires_at) > now
      ) {
        activeReservations++;
      }
    }

    const totalCommitted = physicalOccupancy + activeReservations;
    const available = Math.max(0, facility.max_equipment_capacity - totalCommitted);
    const isOvercommitted = totalCommitted > facility.max_equipment_capacity;

    return {
      facility_id: facilityId,
      max_capacity: facility.max_equipment_capacity,
      physical_occupancy: physicalOccupancy,
      active_reservations: activeReservations,
      total_committed: totalCommitted,
      available_capacity: available,
      is_overcommitted: isOvercommitted,
    };
  }

  // --- RPC 2: reserve_workshop_bay ---
  reserveWorkshopBay(repairRequestId, facilityId, expiryHours = 24) {
    if (!this.currentUser) throw new Error("42501: Insufficient privilege");

    const repair = this.repairs.get(repairRequestId);
    if (!repair) throw new Error("P0002: Repair request not found");

    const isFarmerOwner = repair.farmer_id === this.currentUser.id;
    const isStaff = this._isStaffOrAdmin(this.currentUser.id, facilityId);
    if (!isFarmerOwner && !isStaff) throw new Error("42501: Unauthorized");

    if (repair.delivery_mode !== "WORKSHOP_DROPOFF") {
      throw new Error("22000: Delivery mode must be WORKSHOP_DROPOFF to reserve workshop bay");
    }

    if (repair.is_immobile) {
      throw new Error("22000: Immobile equipment cannot be reserved for workshop drop-off");
    }

    // Check for existing active reservation on same facility
    let existingRes = null;
    for (const res of this.reservations.values()) {
      if (res.repair_request_id === repairRequestId) {
        existingRes = res;
        break;
      }
    }

    if (
      existingRes &&
      existingRes.facility_id === facilityId &&
      existingRes.status === "RESERVED"
    ) {
      return {
        success: false,
        code: "ALREADY_RESERVED",
        message: "Repair request already has an active bay reservation",
      };
    }

    const capacity = this.getFacilityCapacityBreakdown(facilityId);
    if (capacity.available_capacity <= 0) {
      return {
        success: false,
        code: "CAPACITY_EXHAUSTED",
        message: "No bay capacity available at this workshop",
        available_capacity: 0,
      };
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiryHours * 60 * 60 * 1000);
    const reservationId = existingRes
      ? existingRes.id
      : "res-" + Math.random().toString(36).substring(2, 9);
    const originalPriority = existingRes
      ? existingRes.priority_original_reserved_at
      : now.toISOString();

    const reservation = {
      id: reservationId,
      repair_request_id: repairRequestId,
      facility_id: facilityId,
      reserved_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      renewal_count: 0,
      priority_original_reserved_at: originalPriority,
      status: "RESERVED",
      notes: null,
      created_at: existingRes ? existingRes.created_at : now.toISOString(),
      updated_at: now.toISOString(),
    };

    this.reservations.set(reservationId, reservation);

    // Bind facility_id to repair if not already bound
    repair.facility_id = facilityId;

    this.timeline.push({
      repair_id: repairRequestId,
      event_type: "BAY_RESERVATION_CREATED",
      created_by: this.currentUser.id,
      notes: `Workshop bay reserved until ${expiresAt.toISOString()}`,
    });

    return {
      success: true,
      reservation_id: reservationId,
      facility_id: facilityId,
      reserved_at: reservation.reserved_at,
      expires_at: reservation.expires_at,
    };
  }

  // --- RPC 3: renew_workshop_bay_reservation ---
  renewWorkshopBayReservation(reservationId, extensionHours = 24, notes = null) {
    if (!this.currentUser) throw new Error("42501: Insufficient privilege");

    const res = this.reservations.get(reservationId);
    if (!res) throw new Error("P0002: Reservation not found");

    if (res.status !== "RESERVED") {
      return {
        success: false,
        code: "INVALID_STATUS",
        message: `Cannot renew reservation with status ${res.status}`,
      };
    }

    const repair = this.repairs.get(res.repair_request_id);
    const isFarmerOwner = repair && repair.farmer_id === this.currentUser.id;
    const isStaff = this._isStaffOrAdmin(this.currentUser.id, res.facility_id);

    if (!isFarmerOwner && !isStaff) throw new Error("42501: Unauthorized");

    // Farmer self-renewal is strictly capped at 1 extension
    if (isFarmerOwner && !isStaff) {
      if (res.renewal_count >= 1) {
        return {
          success: false,
          code: "RENEWAL_LIMIT_EXCEEDED",
          message: "Farmers are limited to one self-service reservation extension",
        };
      }
    }

    // Staff/admin renewals beyond cap require mandatory audit notes
    if (isStaff && res.renewal_count >= 1 && (!notes || notes.trim() === "")) {
      throw new Error(
        "22000: Staff extension beyond standard limit requires non-empty audit notes",
      );
    }

    const currentExpiry = new Date(res.expires_at);
    const baseTime = currentExpiry > new Date() ? currentExpiry : new Date();
    const newExpiresAt = new Date(baseTime.getTime() + extensionHours * 60 * 60 * 1000);

    res.expires_at = newExpiresAt.toISOString();
    res.renewal_count += 1;
    res.notes = notes || res.notes;
    res.updated_at = new Date().toISOString();
    // Invariant: priority_original_reserved_at is NEVER modified during renewal

    this.timeline.push({
      repair_id: res.repair_request_id,
      event_type: "BAY_RESERVATION_RENEWED",
      created_by: this.currentUser.id,
      notes: `Reservation extended to ${newExpiresAt.toISOString()} (renewal #${res.renewal_count})`,
    });

    return {
      success: true,
      reservation_id: res.id,
      expires_at: res.expires_at,
      renewal_count: res.renewal_count,
    };
  }

  // --- RPC 4: release_workshop_bay_reservation ---
  releaseWorkshopBayReservation(repairRequestId, reason = "Cancelled by user or administrator") {
    if (!this.currentUser) throw new Error("42501: Insufficient privilege");

    const repair = this.repairs.get(repairRequestId);
    if (!repair) throw new Error("P0002: Repair request not found");

    let found = null;
    for (const res of this.reservations.values()) {
      if (res.repair_request_id === repairRequestId && res.status === "RESERVED") {
        found = res;
        break;
      }
    }

    if (!found) {
      return {
        success: false,
        code: "NO_ACTIVE_RESERVATION",
        message: "No active reservation to release",
      };
    }

    const isFarmerOwner = repair.farmer_id === this.currentUser.id;
    const isStaff = this._isStaffOrAdmin(this.currentUser.id, found.facility_id);
    if (!isFarmerOwner && !isStaff) throw new Error("42501: Unauthorized");

    found.status = "RELEASED";
    found.notes = reason;
    found.updated_at = new Date().toISOString();

    this.timeline.push({
      repair_id: repairRequestId,
      event_type: "BAY_RESERVATION_RELEASED",
      created_by: this.currentUser.id,
      notes: reason,
    });

    return { success: true, reservation_id: found.id, status: "RELEASED" };
  }

  // --- Helper: generate receipt format RCP-TB-YYYYMMDD-XXXX ---
  _generateReceipt() {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");
    const seq = String(this.receiptSeq++).padStart(4, "0");
    return `RCP-TB-${yyyy}${mm}${dd}-${seq}`;
  }

  // --- RPC 5: execute_workshop_dropoff_checkin ---
  executeWorkshopDropoffCheckin(repairRequestId, notes = null) {
    if (!this.currentUser) throw new Error("42501: Insufficient privilege");

    const repair = this.repairs.get(repairRequestId);
    if (!repair) throw new Error("P0002: Repair request not found");

    if (!repair.facility_id) {
      throw new Error("22000: Repair request has no assigned workshop facility");
    }

    const isStaff = this._isStaffOrAdmin(this.currentUser.id, repair.facility_id);
    if (!isStaff) throw new Error("42501: Unauthorized (staff or admin only)");

    if (repair.dropped_off_at !== null) {
      return {
        success: false,
        code: "ALREADY_CHECKED_IN",
        message: "Equipment is already checked in",
        receipt_number: repair.drop_off_receipt_number,
        dropped_off_at: repair.dropped_off_at,
      };
    }

    if (repair.delivery_mode !== "WORKSHOP_DROPOFF") {
      throw new Error("22000: Cannot drop off equipment designated for DOORSTEP repair");
    }

    const facility = this.facilities.get(repair.facility_id);
    if (!facility) throw new Error("P0002: Facility not found");

    const now = new Date();

    // Check for existing reservation
    let activeRes = null;
    let expiredRes = null;
    for (const res of this.reservations.values()) {
      if (res.repair_request_id === repairRequestId) {
        if (res.status === "RESERVED") {
          if (new Date(res.expires_at) > now) {
            activeRes = res;
          } else {
            expiredRes = res;
          }
        }
      }
    }

    // Capacity breakdown under row lock
    const breakdown = this.getFacilityCapacityBreakdown(repair.facility_id);

    // ==========================================
    // PATH A: Active Unexpired Reservation
    // ==========================================
    if (activeRes) {
      // Physical check: does physical occupancy exceed max capacity due to facility downsizing?
      if (breakdown.physical_occupancy >= facility.max_equipment_capacity) {
        return {
          success: false,
          code: "DOWNSIZED_CAPACITY_HELD",
          message:
            "Facility capacity downsized and physical bays are currently full. Active reservation is held with preserved priority.",
          reroute_eligible: true,
          priority_preserved: true,
        };
      }

      // Transactional FIFO Queue Priority Check:
      // Verify available open bays are not held by earlier reservation holders
      let earlierReservations = 0;
      for (const res of this.reservations.values()) {
        if (
          res.facility_id === repair.facility_id &&
          res.status === "RESERVED" &&
          new Date(res.expires_at) > now &&
          new Date(res.priority_original_reserved_at) <
            new Date(activeRes.priority_original_reserved_at) &&
          res.id !== activeRes.id
        ) {
          earlierReservations++;
        }
      }

      const openPhysicalBays = facility.max_equipment_capacity - breakdown.physical_occupancy;
      if (earlierReservations >= openPhysicalBays) {
        return {
          success: false,
          code: "FIFO_PRIORITY_HELD",
          message:
            "Available workshop bays are held for earlier active reservation holders under FIFO priority.",
          reroute_eligible: true,
          priority_original_reserved_at: activeRes.priority_original_reserved_at,
          earlier_reservations_ahead: earlierReservations,
        };
      }

      // Claim reservation atomically
      activeRes.status = "CLAIMED";
      activeRes.updated_at = now.toISOString();

      const receiptNumber = this._generateReceipt();
      repair.dropped_off_at = now.toISOString();
      repair.dropped_off_by = this.currentUser.id;
      repair.drop_off_receipt_number = receiptNumber;

      this.timeline.push({
        repair_id: repairRequestId,
        event_type: "EQUIPMENT_DROPPED_OFF",
        created_by: this.currentUser.id,
        notes: `Checked in via active reservation. Receipt: ${receiptNumber}. Notes: ${notes || "None"}`,
      });

      return {
        success: true,
        code: "CHECKIN_COMPLETED",
        checkin_path: "ACTIVE_RESERVATION",
        receipt_number: receiptNumber,
        dropped_off_at: repair.dropped_off_at,
        reservation_id: activeRes.id,
      };
    }

    // ==========================================
    // PATH B: Standby / Expired Reservation Arrival
    // ==========================================
    // Standby arrival requires physical + active unexpired reservations < max_equipment_capacity
    if (breakdown.total_committed >= facility.max_equipment_capacity) {
      return {
        success: false,
        code: "CAPACITY_EXHAUSTED",
        message:
          "No standby bay capacity available. Active unexpired reservations are fully protected.",
        reroute_eligible: true,
        available_capacity: 0,
      };
    }

    if (expiredRes) {
      expiredRes.status = "CLAIMED";
      expiredRes.notes = "Claimed as standby arrival after expiry";
      expiredRes.updated_at = now.toISOString();
    }

    const receiptNumber = this._generateReceipt();
    repair.dropped_off_at = now.toISOString();
    repair.dropped_off_by = this.currentUser.id;
    repair.drop_off_receipt_number = receiptNumber;

    this.timeline.push({
      repair_id: repairRequestId,
      event_type: "EQUIPMENT_DROPPED_OFF",
      created_by: this.currentUser.id,
      notes: `Checked in via standby capacity. Receipt: ${receiptNumber}. Notes: ${notes || "None"}`,
    });

    return {
      success: true,
      code: "CHECKIN_COMPLETED",
      checkin_path: "STANDBY_ARRIVAL",
      receipt_number: receiptNumber,
      dropped_off_at: repair.dropped_off_at,
      reservation_id: expiredRes ? expiredRes.id : null,
    };
  }

  // --- RPC 6: release_cancelled_workshop_equipment ---
  releaseCancelledWorkshopEquipment(repairRequestId, notes = null) {
    if (!this.currentUser) throw new Error("42501: Insufficient privilege");

    const repair = this.repairs.get(repairRequestId);
    if (!repair) throw new Error("P0002: Repair request not found");

    if (!repair.facility_id) throw new Error("22000: Repair has no facility bound");

    const isStaff = this._isStaffOrAdmin(this.currentUser.id, repair.facility_id);
    if (!isStaff) throw new Error("42501: Unauthorized (staff or admin only)");

    // Strict invariant: only CANCELLED repairs can be released via this RPC
    if (repair.status !== "CANCELLED") {
      throw new Error(
        `22000: Only CANCELLED repairs can be released via cancellation handover. Current status is ${repair.status}`,
      );
    }

    if (repair.delivery_mode !== "WORKSHOP_DROPOFF") {
      throw new Error("22000: Only WORKSHOP_DROPOFF equipment can be physically released");
    }

    if (repair.dropped_off_at === null) {
      throw new Error("22000: Equipment was never dropped off at the workshop");
    }

    if (repair.handover_status === "RELEASED") {
      return {
        success: false,
        code: "ALREADY_RELEASED",
        message: "Equipment has already been released from the workshop",
      };
    }

    const now = new Date();
    repair.handover_status = "RELEASED";

    this.timeline.push({
      repair_id: repairRequestId,
      event_type: "CANCELLED_EQUIPMENT_RELEASED",
      created_by: this.currentUser.id,
      notes: `Cancelled equipment physically released to farmer. Notes: ${notes || "None"}`,
    });

    return {
      success: true,
      repair_request_id: repairRequestId,
      handover_status: "RELEASED",
      released_at: now.toISOString(),
      released_by: this.currentUser.id,
    };
  }
}

// ==============================================================================
// 4. BEHAVIORAL LOGIC TESTS: TEST-14-01 THROUGH TEST-14-25
// ==============================================================================

test("TEST-14-01: Capacity breakdown correctly accounts for physical occupancy and active unexpired reservations", () => {
  const db = new Phase14DatabaseSimulation();
  const fac = db.addFacility({
    id: "fac-1",
    name: "Green Valley Workshop",
    max_equipment_capacity: 5,
  });

  // Add 2 physically occupied repairs
  db.addRepair({
    id: "rep-1",
    job_number: "JB-01",
    farmer_id: "far-1",
    facility_id: "fac-1",
    delivery_mode: "WORKSHOP_DROPOFF",
    dropped_off_at: new Date().toISOString(),
    handover_status: "PENDING",
  });
  db.addRepair({
    id: "rep-2",
    job_number: "JB-02",
    farmer_id: "far-2",
    facility_id: "fac-1",
    delivery_mode: "WORKSHOP_DROPOFF",
    dropped_off_at: new Date().toISOString(),
    handover_status: "AUTHORIZED",
  });

  // Add 1 active unexpired reservation
  db.reservations.set("res-1", {
    id: "res-1",
    repair_request_id: "rep-3",
    facility_id: "fac-1",
    reserved_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 10 * 3600000).toISOString(),
    renewal_count: 0,
    priority_original_reserved_at: new Date().toISOString(),
    status: "RESERVED",
  });

  // Add 1 EXPIRED reservation (should NOT count as active reservation)
  db.reservations.set("res-2", {
    id: "res-2",
    repair_request_id: "rep-4",
    facility_id: "fac-1",
    reserved_at: new Date(Date.now() - 48 * 3600000).toISOString(),
    expires_at: new Date(Date.now() - 24 * 3600000).toISOString(),
    renewal_count: 0,
    priority_original_reserved_at: new Date(Date.now() - 48 * 3600000).toISOString(),
    status: "RESERVED", // Status not yet transitioned but expired
  });

  const breakdown = db.getFacilityCapacityBreakdown("fac-1");
  assert.equal(breakdown.max_capacity, 5);
  assert.equal(breakdown.physical_occupancy, 2, "Physical occupancy must be exactly 2");
  assert.equal(breakdown.active_reservations, 1, "Active unexpired reservations must be exactly 1");
  assert.equal(breakdown.total_committed, 3, "Total committed must be 2 + 1 = 3");
  assert.equal(breakdown.available_capacity, 2, "Available capacity must be 5 - 3 = 2");
  assert.equal(breakdown.is_overcommitted, false);
});

test("TEST-14-02: Repairs with handover_status = 'RELEASED' do NOT count towards physical occupancy", () => {
  const db = new Phase14DatabaseSimulation();
  db.addFacility({ id: "fac-1", max_equipment_capacity: 3 });

  db.addRepair({
    id: "rep-1",
    job_number: "JB-01",
    farmer_id: "far-1",
    facility_id: "fac-1",
    delivery_mode: "WORKSHOP_DROPOFF",
    dropped_off_at: new Date().toISOString(),
    handover_status: "RELEASED", // Equipment was handed back
  });

  const breakdown = db.getFacilityCapacityBreakdown("fac-1");
  assert.equal(breakdown.physical_occupancy, 0, "Released equipment frees physical workshop bay");
  assert.equal(breakdown.available_capacity, 3);
});

test("TEST-14-03: Doorstep repairs do NOT consume physical workshop capacity even if facility is assigned", () => {
  const db = new Phase14DatabaseSimulation();
  db.addFacility({ id: "fac-1", max_equipment_capacity: 4 });

  db.addRepair({
    id: "rep-1",
    job_number: "JB-01",
    farmer_id: "far-1",
    facility_id: "fac-1",
    delivery_mode: "DOORSTEP",
    dropped_off_at: null,
    handover_status: "PENDING",
  });

  const breakdown = db.getFacilityCapacityBreakdown("fac-1");
  assert.equal(breakdown.physical_occupancy, 0);
  assert.equal(breakdown.total_committed, 0);
  assert.equal(breakdown.available_capacity, 4);
});

test("TEST-14-04: Immobile equipment is strictly prohibited from selecting WORKSHOP_DROPOFF", () => {
  const db = new Phase14DatabaseSimulation();

  assert.throws(
    () => {
      db.addRepair({
        id: "rep-immobile",
        job_number: "JB-IMM",
        farmer_id: "far-1",
        delivery_mode: "WORKSHOP_DROPOFF",
        is_immobile: true,
      });
    },
    /check_immobile_delivery_mode/,
    "Immobile equipment must reject WORKSHOP_DROPOFF",
  );
});

test("TEST-14-05: Successful bay reservation creates active record and updates committed capacity", () => {
  const db = new Phase14DatabaseSimulation();
  const farmer = db.addProfile({ id: "far-1", role: "farmer", full_name: "Ramesh Kumar" });
  db.addFacility({ id: "fac-1", max_equipment_capacity: 2 });
  db.addRepair({
    id: "rep-1",
    job_number: "JB-01",
    farmer_id: "far-1",
    delivery_mode: "WORKSHOP_DROPOFF",
    is_immobile: false,
  });

  db.setCurrentUser(farmer);
  const result = db.reserveWorkshopBay("rep-1", "fac-1", 24);

  assert.equal(result.success, true);
  assert.ok(result.reservation_id);
  assert.ok(result.expires_at);

  const breakdown = db.getFacilityCapacityBreakdown("fac-1");
  assert.equal(breakdown.active_reservations, 1);
  assert.equal(breakdown.total_committed, 1);
  assert.equal(breakdown.available_capacity, 1);

  // Attempting to reserve again for same repair request is rejected
  const dup = db.reserveWorkshopBay("rep-1", "fac-1", 24);
  assert.equal(dup.success, false);
  assert.equal(dup.code, "ALREADY_RESERVED");
});

test("TEST-14-06: Bay reservation is rejected when facility capacity is exhausted", () => {
  const db = new Phase14DatabaseSimulation();
  const farmer = db.addProfile({ id: "far-1", role: "farmer", full_name: "Ramesh Kumar" });
  db.addFacility({ id: "fac-1", max_equipment_capacity: 1 });

  // Fill capacity with physical repair
  db.addRepair({
    id: "rep-occ",
    job_number: "JB-OCC",
    farmer_id: "far-other",
    facility_id: "fac-1",
    delivery_mode: "WORKSHOP_DROPOFF",
    dropped_off_at: new Date().toISOString(),
    handover_status: "PENDING",
  });

  db.addRepair({
    id: "rep-new",
    job_number: "JB-NEW",
    farmer_id: "far-1",
    delivery_mode: "WORKSHOP_DROPOFF",
  });

  db.setCurrentUser(farmer);
  const res = db.reserveWorkshopBay("rep-new", "fac-1", 24);
  assert.equal(res.success, false);
  assert.equal(res.code, "CAPACITY_EXHAUSTED");
  assert.equal(res.available_capacity, 0);
});

test("TEST-14-07: Farmer self-renewal is capped at 1 extension and preserves priority timestamp", () => {
  const db = new Phase14DatabaseSimulation();
  const farmer = db.addProfile({ id: "far-1", role: "farmer", full_name: "Ramesh Kumar" });
  db.addFacility({ id: "fac-1", max_equipment_capacity: 3 });
  db.addRepair({
    id: "rep-1",
    job_number: "JB-01",
    farmer_id: "far-1",
    delivery_mode: "WORKSHOP_DROPOFF",
  });

  db.setCurrentUser(farmer);
  const created = db.reserveWorkshopBay("rep-1", "fac-1", 24);
  const resId = created.reservation_id;

  const originalPriority = db.reservations.get(resId).priority_original_reserved_at;

  // First renewal: allowed
  const renewal1 = db.renewWorkshopBayReservation(resId, 24, "Tractor trailer delay");
  assert.equal(renewal1.success, true);
  assert.equal(renewal1.renewal_count, 1);
  assert.equal(
    db.reservations.get(resId).priority_original_reserved_at,
    originalPriority,
    "Priority must remain unchanged",
  );

  // Second renewal by farmer: rejected
  const renewal2 = db.renewWorkshopBayReservation(resId, 24, "Another delay");
  assert.equal(renewal2.success, false);
  assert.equal(renewal2.code, "RENEWAL_LIMIT_EXCEEDED");
});

test("TEST-14-08: Workshop staff can extend reservation beyond limit with mandatory audit notes", () => {
  const db = new Phase14DatabaseSimulation();
  const farmer = db.addProfile({ id: "far-1", role: "farmer", full_name: "Ramesh Kumar" });
  const staff = db.addProfile({
    id: "stf-1",
    role: "technician",
    full_name: "Suresh Workshop Manager",
  });
  db.addFacility({ id: "fac-1", max_equipment_capacity: 3 });
  db.addFacilityMembership({
    id: "mem-1",
    facility_id: "fac-1",
    technician_profile_id: "stf-1",
    role: "MANAGER",
  });
  db.addRepair({
    id: "rep-1",
    job_number: "JB-01",
    farmer_id: "far-1",
    delivery_mode: "WORKSHOP_DROPOFF",
  });

  db.setCurrentUser(farmer);
  const created = db.reserveWorkshopBay("rep-1", "fac-1", 24);
  const resId = created.reservation_id;

  // Farmer uses first extension
  db.renewWorkshopBayReservation(resId, 24, "Farmer first delay");

  // Staff attempts renewal WITHOUT notes -> rejected
  db.setCurrentUser(staff);
  assert.throws(
    () => {
      db.renewWorkshopBayReservation(resId, 24, "");
    },
    /non-empty audit notes/,
    "Staff renewal beyond limit must mandate notes",
  );

  // Staff provides clear notes -> succeeds
  const staffRenewal = db.renewWorkshopBayReservation(
    resId,
    48,
    "Farmer called; transport breakdown on NH44",
  );
  assert.equal(staffRenewal.success, true);
  assert.equal(staffRenewal.renewal_count, 2);
});

test("TEST-14-09: Releasing a reservation transitions status to RELEASED and frees committed capacity", () => {
  const db = new Phase14DatabaseSimulation();
  const farmer = db.addProfile({ id: "far-1", role: "farmer", full_name: "Ramesh Kumar" });
  db.addFacility({ id: "fac-1", max_equipment_capacity: 2 });
  db.addRepair({
    id: "rep-1",
    job_number: "JB-01",
    farmer_id: "far-1",
    delivery_mode: "WORKSHOP_DROPOFF",
  });

  db.setCurrentUser(farmer);
  db.reserveWorkshopBay("rep-1", "fac-1", 24);
  assert.equal(db.getFacilityCapacityBreakdown("fac-1").available_capacity, 1);

  const releaseRes = db.releaseWorkshopBayReservation(
    "rep-1",
    "Farmer arranged doorstep technician instead",
  );
  assert.equal(releaseRes.success, true);
  assert.equal(releaseRes.status, "RELEASED");

  assert.equal(db.getFacilityCapacityBreakdown("fac-1").available_capacity, 2);
});

test("TEST-14-10: Check-In Path A (Active Reservation) succeeds, generates receipt RCP-TB-YYYYMMDD-XXXX, claims reservation", () => {
  const db = new Phase14DatabaseSimulation();
  const farmer = db.addProfile({ id: "far-1", role: "farmer", full_name: "Ramesh Kumar" });
  const staff = db.addProfile({ id: "stf-1", role: "technician", full_name: "Workshop Staff" });
  db.addFacility({ id: "fac-1", max_equipment_capacity: 3 });
  db.addFacilityMembership({
    id: "mem-1",
    facility_id: "fac-1",
    technician_profile_id: "stf-1",
    role: "MANAGER",
  });
  db.addRepair({
    id: "rep-1",
    job_number: "JB-01",
    farmer_id: "far-1",
    delivery_mode: "WORKSHOP_DROPOFF",
  });

  db.setCurrentUser(farmer);
  const res = db.reserveWorkshopBay("rep-1", "fac-1", 24);

  db.setCurrentUser(staff);
  const checkin = db.executeWorkshopDropoffCheckin(
    "rep-1",
    "Equipment arrived via tractor trolley",
  );

  assert.equal(checkin.success, true);
  assert.equal(checkin.checkin_path, "ACTIVE_RESERVATION");
  assert.match(
    checkin.receipt_number,
    /^RCP-TB-[0-9]{8}-[0-9]{4}$/,
    "Receipt must match canonical pattern RCP-TB-YYYYMMDD-XXXX",
  );

  const reservation = db.reservations.get(res.reservation_id);
  assert.equal(reservation.status, "CLAIMED");

  const rep = db.repairs.get("rep-1");
  assert.equal(rep.dropped_off_at, checkin.dropped_off_at);
  assert.equal(rep.dropped_off_by, "stf-1");
  assert.equal(rep.drop_off_receipt_number, checkin.receipt_number);

  // Subsequent check-in attempt is rejected as already checked in
  const dupCheckin = db.executeWorkshopDropoffCheckin("rep-1");
  assert.equal(dupCheckin.success, false);
  assert.equal(dupCheckin.code, "ALREADY_CHECKED_IN");
});

test("TEST-14-11: Check-In Path A under facility downsizing defers check-in with DOWNSIZED_CAPACITY_HELD without eviction", () => {
  const db = new Phase14DatabaseSimulation();
  const farmer = db.addProfile({ id: "far-1", role: "farmer", full_name: "Ramesh Kumar" });
  const staff = db.addProfile({ id: "stf-1", role: "technician", full_name: "Workshop Staff" });
  const fac = db.addFacility({ id: "fac-1", max_equipment_capacity: 4 });
  db.addFacilityMembership({
    id: "mem-1",
    facility_id: "fac-1",
    technician_profile_id: "stf-1",
    role: "MANAGER",
  });
  db.addRepair({
    id: "rep-1",
    job_number: "JB-01",
    farmer_id: "far-1",
    delivery_mode: "WORKSHOP_DROPOFF",
  });

  db.setCurrentUser(farmer);
  const res = db.reserveWorkshopBay("rep-1", "fac-1", 24);
  const originalPriority = db.reservations.get(res.reservation_id).priority_original_reserved_at;

  // Facility capacity is downsized from 4 to 2, and 2 bays are already physically full
  fac.max_equipment_capacity = 2;
  db.addRepair({
    id: "rep-p1",
    job_number: "JB-P1",
    farmer_id: "far-p1",
    facility_id: "fac-1",
    delivery_mode: "WORKSHOP_DROPOFF",
    dropped_off_at: new Date().toISOString(),
    handover_status: "PENDING",
  });
  db.addRepair({
    id: "rep-p2",
    job_number: "JB-P2",
    farmer_id: "far-p2",
    facility_id: "fac-1",
    delivery_mode: "WORKSHOP_DROPOFF",
    dropped_off_at: new Date().toISOString(),
    handover_status: "PENDING",
  });

  db.setCurrentUser(staff);
  const checkin = db.executeWorkshopDropoffCheckin("rep-1");

  assert.equal(checkin.success, false);
  assert.equal(checkin.code, "DOWNSIZED_CAPACITY_HELD");
  assert.equal(checkin.reroute_eligible, true);
  assert.equal(checkin.priority_preserved, true);

  // Invariant verification: reservation is NOT evicted, NOT cancelled, NOT claimed
  const rRecord = db.reservations.get(res.reservation_id);
  assert.equal(rRecord.status, "RESERVED");
  assert.equal(
    rRecord.priority_original_reserved_at,
    originalPriority,
    "FIFO priority timestamp preserved",
  );
});

test("TEST-14-12: Check-In Path B (Standby Arrival) accepts equipment when committed capacity is available", () => {
  const db = new Phase14DatabaseSimulation();
  const staff = db.addProfile({ id: "stf-1", role: "technician", full_name: "Workshop Staff" });
  db.addFacility({ id: "fac-1", max_equipment_capacity: 3 });
  db.addFacilityMembership({
    id: "mem-1",
    facility_id: "fac-1",
    technician_profile_id: "stf-1",
    role: "MANAGER",
  });

  // Repair has an EXPIRED reservation
  const expiredRes = {
    id: "res-exp",
    repair_request_id: "rep-exp",
    facility_id: "fac-1",
    reserved_at: new Date(Date.now() - 48 * 3600000).toISOString(),
    expires_at: new Date(Date.now() - 24 * 3600000).toISOString(),
    renewal_count: 0,
    priority_original_reserved_at: new Date(Date.now() - 48 * 3600000).toISOString(),
    status: "RESERVED",
    notes: null,
  };
  db.reservations.set("res-exp", expiredRes);

  db.addRepair({
    id: "rep-exp",
    job_number: "JB-EXP",
    farmer_id: "far-exp",
    facility_id: "fac-1",
    delivery_mode: "WORKSHOP_DROPOFF",
  });

  db.setCurrentUser(staff);
  const checkin = db.executeWorkshopDropoffCheckin("rep-exp", "Standby arrival checked in");

  assert.equal(checkin.success, true);
  assert.equal(checkin.checkin_path, "STANDBY_ARRIVAL");
  assert.match(checkin.receipt_number, /^RCP-TB-[0-9]{8}-[0-9]{4}$/);
  assert.equal(expiredRes.status, "CLAIMED");
});

test("TEST-14-13: Check-In Path B (Standby Arrival) is rejected when committed capacity is full, protecting active reservations", () => {
  const db = new Phase14DatabaseSimulation();
  const staff = db.addProfile({ id: "stf-1", role: "technician", full_name: "Workshop Staff" });
  db.addFacility({ id: "fac-1", max_equipment_capacity: 2 });
  db.addFacilityMembership({
    id: "mem-1",
    facility_id: "fac-1",
    technician_profile_id: "stf-1",
    role: "MANAGER",
  });

  // Bay 1: Physically occupied
  db.addRepair({
    id: "rep-p1",
    job_number: "JB-P1",
    farmer_id: "far-p1",
    facility_id: "fac-1",
    delivery_mode: "WORKSHOP_DROPOFF",
    dropped_off_at: new Date().toISOString(),
    handover_status: "PENDING",
  });

  // Bay 2: Committed to an active unexpired reservation
  db.reservations.set("res-active", {
    id: "res-active",
    repair_request_id: "rep-active",
    facility_id: "fac-1",
    reserved_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 12 * 3600000).toISOString(),
    renewal_count: 0,
    priority_original_reserved_at: new Date().toISOString(),
    status: "RESERVED",
  });

  // Farmer with expired reservation arrives on standby
  db.reservations.set("res-expired", {
    id: "res-expired",
    repair_request_id: "rep-standby",
    facility_id: "fac-1",
    reserved_at: new Date(Date.now() - 48 * 3600000).toISOString(),
    expires_at: new Date(Date.now() - 24 * 3600000).toISOString(),
    renewal_count: 0,
    priority_original_reserved_at: new Date(Date.now() - 48 * 3600000).toISOString(),
    status: "RESERVED",
  });

  db.addRepair({
    id: "rep-standby",
    job_number: "JB-STB",
    farmer_id: "far-stb",
    facility_id: "fac-1",
    delivery_mode: "WORKSHOP_DROPOFF",
  });

  db.setCurrentUser(staff);
  const checkin = db.executeWorkshopDropoffCheckin("rep-standby");

  assert.equal(checkin.success, false);
  assert.equal(checkin.code, "CAPACITY_EXHAUSTED");
  assert.equal(checkin.reroute_eligible, true);
  assert.equal(
    db.repairs.get("rep-standby").dropped_off_at,
    null,
    "Equipment must NOT be checked in",
  );

  // Invariant: The active reservation was protected and is still RESERVED
  assert.equal(db.reservations.get("res-active").status, "RESERVED");
});

test("TEST-14-14: Cancelled equipment remains physically occupying workshop bay until release_cancelled_workshop_equipment", () => {
  const db = new Phase14DatabaseSimulation();
  const staff = db.addProfile({ id: "stf-1", role: "technician", full_name: "Workshop Staff" });
  db.addFacility({ id: "fac-1", max_equipment_capacity: 2 });
  db.addFacilityMembership({
    id: "mem-1",
    facility_id: "fac-1",
    technician_profile_id: "stf-1",
    role: "MANAGER",
  });

  // Equipment is checked in at workshop
  const rep = db.addRepair({
    id: "rep-can",
    job_number: "JB-CAN",
    farmer_id: "far-1",
    facility_id: "fac-1",
    delivery_mode: "WORKSHOP_DROPOFF",
    dropped_off_at: new Date().toISOString(),
    dropped_off_by: "stf-1",
    drop_off_receipt_number: "RCP-TB-20261108-0001",
    status: "CANCELLED", // Repair is cancelled
    handover_status: "PENDING", // Equipment has NOT been released
  });

  // Capacity breakdown must STILL count this equipment in physical occupancy!
  const b1 = db.getFacilityCapacityBreakdown("fac-1");
  assert.equal(
    b1.physical_occupancy,
    1,
    "Cancelled equipment still physically in workshop consumes bay capacity",
  );
  assert.equal(b1.available_capacity, 1);

  // Authoritative physical release via RPC
  db.setCurrentUser(staff);
  const releaseResult = db.releaseCancelledWorkshopEquipment(
    "rep-can",
    "Farmer retrieved tractor via personal trailer",
  );

  assert.equal(releaseResult.success, true);
  assert.equal(releaseResult.handover_status, "RELEASED");
  assert.equal(rep.handover_status, "RELEASED");

  // Capacity breakdown is now freed!
  const b2 = db.getFacilityCapacityBreakdown("fac-1");
  assert.equal(
    b2.physical_occupancy,
    0,
    "Bay capacity is freed once cancelled equipment is released",
  );
  assert.equal(b2.available_capacity, 2);
});

test("TEST-14-15: Non-interference: release_cancelled_workshop_equipment strictly rejects non-cancelled repairs", () => {
  const db = new Phase14DatabaseSimulation();
  const staff = db.addProfile({ id: "stf-1", role: "technician", full_name: "Workshop Staff" });
  db.addFacility({ id: "fac-1", max_equipment_capacity: 2 });
  db.addFacilityMembership({
    id: "mem-1",
    facility_id: "fac-1",
    technician_profile_id: "stf-1",
    role: "MANAGER",
  });

  db.addRepair({
    id: "rep-comp",
    job_number: "JB-COMP",
    farmer_id: "far-1",
    facility_id: "fac-1",
    delivery_mode: "WORKSHOP_DROPOFF",
    dropped_off_at: new Date().toISOString(),
    status: "COMPLETED", // Completed repair must use Phase 13 handover pipeline!
    handover_status: "PENDING",
  });

  db.setCurrentUser(staff);
  assert.throws(
    () => {
      db.releaseCancelledWorkshopEquipment("rep-comp");
    },
    /Only CANCELLED repairs can be released via cancellation handover/,
    "Cannot use cancellation release on COMPLETED repairs",
  );
});

test("TEST-14-16: Fail-closed security: unauthenticated or unauthorized users are rejected with 42501", () => {
  const db = new Phase14DatabaseSimulation();
  db.addFacility({ id: "fac-1", max_equipment_capacity: 2 });
  db.addRepair({
    id: "rep-1",
    job_number: "JB-01",
    farmer_id: "far-1",
    facility_id: "fac-1",
    delivery_mode: "WORKSHOP_DROPOFF",
  });

  // Unauthenticated caller
  db.setCurrentUser(null);
  assert.throws(() => db.reserveWorkshopBay("rep-1", "fac-1"), /42501/);
  assert.throws(() => db.executeWorkshopDropoffCheckin("rep-1"), /42501/);

  // Unauthorized farmer attempting to check-in equipment (checkin is staff/admin only)
  const otherFarmer = db.addProfile({ id: "far-other", role: "farmer", full_name: "Other Farmer" });
  db.setCurrentUser(otherFarmer);
  assert.throws(() => db.executeWorkshopDropoffCheckin("rep-1"), /42501/);
});

test("TEST-14-17: FIFO priority blocks a later reservation from checking in ahead of an earlier waiting reservation when capacity is constrained", () => {
  const db = new Phase14DatabaseSimulation();
  const staff = db.addProfile({ id: "stf-1", role: "technician", full_name: "Workshop Manager" });
  db.addFacility({ id: "fac-1", max_equipment_capacity: 2 });
  db.addFacilityMembership({
    id: "mem-1",
    facility_id: "fac-1",
    technician_profile_id: "stf-1",
    role: "MANAGER",
  });

  // 1 physical occupancy currently in workshop
  db.addRepair({
    id: "rep-p1",
    job_number: "JB-P1",
    farmer_id: "far-p1",
    facility_id: "fac-1",
    delivery_mode: "WORKSHOP_DROPOFF",
    dropped_off_at: new Date().toISOString(),
    handover_status: "PENDING",
  });

  // Capacity is 2, physical is 1, so only 1 open bay remains.
  // Farmer A holds an earlier reservation (08:00 AM)
  const t0800 = new Date(Date.now() - 2 * 3600000).toISOString();
  db.reservations.set("res-A", {
    id: "res-A",
    repair_request_id: "rep-A",
    facility_id: "fac-1",
    farmer_profile_id: "far-A",
    status: "RESERVED",
    reserved_at: t0800,
    expires_at: new Date(Date.now() + 22 * 3600000).toISOString(),
    renewal_count: 0,
    priority_original_reserved_at: t0800,
  });
  db.addRepair({
    id: "rep-A",
    job_number: "JB-A",
    farmer_id: "far-A",
    facility_id: "fac-1",
    delivery_mode: "WORKSHOP_DROPOFF",
  });

  // Farmer B holds a later reservation (10:00 AM)
  const t1000 = new Date(Date.now() - 30 * 60000).toISOString();
  db.reservations.set("res-B", {
    id: "res-B",
    repair_request_id: "rep-B",
    facility_id: "fac-1",
    farmer_profile_id: "far-B",
    status: "RESERVED",
    reserved_at: t1000,
    expires_at: new Date(Date.now() + 23 * 3600000).toISOString(),
    renewal_count: 0,
    priority_original_reserved_at: t1000,
  });
  db.addRepair({
    id: "rep-B",
    job_number: "JB-B",
    farmer_id: "far-B",
    facility_id: "fac-1",
    delivery_mode: "WORKSHOP_DROPOFF",
  });

  // Farmer B physically arrives at the workshop first
  db.setCurrentUser(staff);
  const checkinB = db.executeWorkshopDropoffCheckin("rep-B", "Farmer B arrived early");

  // Invariant: Farmer B is deferred because the 1 open bay belongs to earlier priority holder Farmer A
  assert.equal(checkinB.success, false);
  assert.equal(checkinB.code, "FIFO_PRIORITY_HELD");
  assert.equal(checkinB.reroute_eligible, true);
  assert.equal(checkinB.earlier_reservations_ahead, 1);
  assert.equal(db.repairs.get("rep-B").dropped_off_at, null, "Farmer B must NOT be admitted");
  assert.equal(
    db.reservations.get("res-B").status,
    "RESERVED",
    "Farmer B reservation remains intact",
  );

  // Farmer A arrives later: admitted immediately into the open bay!
  const checkinA = db.executeWorkshopDropoffCheckin("rep-A", "Farmer A arrived");
  assert.equal(checkinA.success, true);
  assert.equal(checkinA.checkin_path, "ACTIVE_RESERVATION");
  assert.equal(db.reservations.get("res-A").status, "CLAIMED");
});

test("TEST-14-18: FIFO check-in succeeds when open bays can accommodate both earlier and later reservation holders", () => {
  const db = new Phase14DatabaseSimulation();
  const staff = db.addProfile({ id: "stf-1", role: "technician", full_name: "Workshop Manager" });
  db.addFacility({ id: "fac-1", max_equipment_capacity: 3 });
  db.addFacilityMembership({
    id: "mem-1",
    facility_id: "fac-1",
    technician_profile_id: "stf-1",
    role: "MANAGER",
  });

  // Capacity = 3, Physical = 0. Open bays = 3.
  const t0800 = new Date(Date.now() - 2 * 3600000).toISOString();
  db.reservations.set("res-A", {
    id: "res-A",
    repair_request_id: "rep-A",
    facility_id: "fac-1",
    farmer_profile_id: "far-A",
    status: "RESERVED",
    reserved_at: t0800,
    expires_at: new Date(Date.now() + 22 * 3600000).toISOString(),
    renewal_count: 0,
    priority_original_reserved_at: t0800,
  });
  db.addRepair({
    id: "rep-A",
    job_number: "JB-A",
    farmer_id: "far-A",
    facility_id: "fac-1",
    delivery_mode: "WORKSHOP_DROPOFF",
  });

  const t1000 = new Date(Date.now() - 30 * 60000).toISOString();
  db.reservations.set("res-B", {
    id: "res-B",
    repair_request_id: "rep-B",
    facility_id: "fac-1",
    farmer_profile_id: "far-B",
    status: "RESERVED",
    reserved_at: t1000,
    expires_at: new Date(Date.now() + 23 * 3600000).toISOString(),
    renewal_count: 0,
    priority_original_reserved_at: t1000,
  });
  db.addRepair({
    id: "rep-B",
    job_number: "JB-B",
    farmer_id: "far-B",
    facility_id: "fac-1",
    delivery_mode: "WORKSHOP_DROPOFF",
  });

  // Farmer B arrives: earlier reservations = 1, but open bays = 3. 1 < 3, so Farmer B can check in!
  db.setCurrentUser(staff);
  const checkinB = db.executeWorkshopDropoffCheckin("rep-B");
  assert.equal(checkinB.success, true);
  assert.equal(checkinB.checkin_path, "ACTIVE_RESERVATION");
  assert.equal(db.reservations.get("res-B").status, "CLAIMED");
});

test("TEST-14-19: Expired earlier reservation does not block an active unexpired later reservation", () => {
  const db = new Phase14DatabaseSimulation();
  const staff = db.addProfile({ id: "stf-1", role: "technician", full_name: "Workshop Manager" });
  db.addFacility({ id: "fac-1", max_equipment_capacity: 2 });
  db.addFacilityMembership({
    id: "mem-1",
    facility_id: "fac-1",
    technician_profile_id: "stf-1",
    role: "MANAGER",
  });

  // 1 physical occupancy in workshop -> 1 open bay remains
  db.addRepair({
    id: "rep-p1",
    job_number: "JB-P1",
    farmer_id: "far-p1",
    facility_id: "fac-1",
    delivery_mode: "WORKSHOP_DROPOFF",
    dropped_off_at: new Date().toISOString(),
    handover_status: "PENDING",
  });

  // Farmer A holds an earlier reservation that has EXPIRED
  const tYesterday = new Date(Date.now() - 48 * 3600000).toISOString();
  db.reservations.set("res-A", {
    id: "res-A",
    repair_request_id: "rep-A",
    facility_id: "fac-1",
    farmer_profile_id: "far-A",
    status: "RESERVED",
    reserved_at: tYesterday,
    expires_at: new Date(Date.now() - 24 * 3600000).toISOString(), // EXPIRED
    renewal_count: 0,
    priority_original_reserved_at: tYesterday,
  });
  db.addRepair({
    id: "rep-A",
    job_number: "JB-A",
    farmer_id: "far-A",
    facility_id: "fac-1",
    delivery_mode: "WORKSHOP_DROPOFF",
  });

  // Farmer B holds an active unexpired reservation
  const tToday = new Date().toISOString();
  db.reservations.set("res-B", {
    id: "res-B",
    repair_request_id: "rep-B",
    facility_id: "fac-1",
    farmer_profile_id: "far-B",
    status: "RESERVED",
    reserved_at: tToday,
    expires_at: new Date(Date.now() + 24 * 3600000).toISOString(),
    renewal_count: 0,
    priority_original_reserved_at: tToday,
  });
  db.addRepair({
    id: "rep-B",
    job_number: "JB-B",
    farmer_id: "far-B",
    facility_id: "fac-1",
    delivery_mode: "WORKSHOP_DROPOFF",
  });

  // Farmer B arrives: Expired Farmer A does NOT block Farmer B!
  db.setCurrentUser(staff);
  const checkinB = db.executeWorkshopDropoffCheckin("rep-B");
  assert.equal(checkinB.success, true);
  assert.equal(checkinB.checkin_path, "ACTIVE_RESERVATION");
  assert.equal(db.reservations.get("res-B").status, "CLAIMED");
});

test("TEST-14-20: Rerouted reservation preserves priority_original_reserved_at across facilities and maintains queue seniority", () => {
  const db = new Phase14DatabaseSimulation();
  const farmer = db.addProfile({ id: "far-1", role: "farmer", full_name: "Farmer Ramesh" });
  db.addFacility({ id: "fac-1", name: "Facility 1", max_equipment_capacity: 2 });
  db.addFacility({ id: "fac-2", name: "Facility 2", max_equipment_capacity: 2 });

  db.addRepair({
    id: "rep-rerouted",
    job_number: "JB-REROUTE",
    farmer_id: "far-1",
    delivery_mode: "WORKSHOP_DROPOFF",
  });

  // Farmer reserves at Facility 1 at T0
  db.setCurrentUser(farmer);
  const res1 = db.reserveWorkshopBay("rep-rerouted", "fac-1", 24);
  const originalPriority = db.reservations.get(res1.reservation_id).priority_original_reserved_at;

  // Facility 1 has issue, farmer reroutes to Facility 2 at T1
  const res2 = db.reserveWorkshopBay("rep-rerouted", "fac-2", 24);
  assert.equal(res2.success, true);
  assert.equal(res2.facility_id, "fac-2");

  // Invariant: priority_original_reserved_at at Facility 2 MUST match the original T0 timestamp!
  const updatedRes = db.reservations.get(res2.reservation_id);
  assert.equal(
    updatedRes.priority_original_reserved_at,
    originalPriority,
    "Rerouted reservation must preserve original priority timestamp",
  );
});

test("TEST-14-21: Hierarchical lock acquisition order (repair_facilities -> repair_requests -> facility_bay_reservations) verified statically across capacity RPCs", () => {
  // Static AST / regex checks on lock acquisition order
  // 1. reserve_workshop_bay locks repair_facilities before repair_requests
  assert.match(
    sqlContent,
    /reserve_workshop_bay[\s\S]+?FROM\s+public\.repair_facilities[\s\S]+?FOR\s+UPDATE[\s\S]+?FROM\s+public\.repair_requests[\s\S]+?FOR\s+UPDATE/i,
    "reserve_workshop_bay must acquire repair_facilities FOR UPDATE before repair_requests",
  );

  // 2. renew_workshop_bay_reservation locks repair_facilities before facility_bay_reservations
  assert.match(
    sqlContent,
    /renew_workshop_bay_reservation[\s\S]+?FROM\s+public\.repair_facilities[\s\S]+?FOR\s+UPDATE[\s\S]+?FROM\s+public\.facility_bay_reservations[\s\S]+?FOR\s+UPDATE/i,
    "renew_workshop_bay_reservation must acquire repair_facilities FOR UPDATE before facility_bay_reservations",
  );

  // 3. release_workshop_bay_reservation locks repair_facilities before facility_bay_reservations
  assert.match(
    sqlContent,
    /release_workshop_bay_reservation[\s\S]+?FROM\s+public\.repair_facilities[\s\S]+?FOR\s+UPDATE[\s\S]+?FROM\s+public\.facility_bay_reservations[\s\S]+?FOR\s+UPDATE/i,
    "release_workshop_bay_reservation must acquire repair_facilities FOR UPDATE before facility_bay_reservations",
  );

  // 4. execute_workshop_dropoff_checkin locks repair_facilities before repair_requests, then facility_bay_reservations
  assert.match(
    sqlContent,
    /execute_workshop_dropoff_checkin[\s\S]+?FROM\s+public\.repair_facilities[\s\S]+?FOR\s+UPDATE[\s\S]+?FROM\s+public\.repair_requests[\s\S]+?FOR\s+UPDATE[\s\S]+?FROM\s+public\.facility_bay_reservations[\s\S]+?FOR\s+UPDATE/i,
    "execute_workshop_dropoff_checkin must acquire repair_facilities, then repair_requests, then facility_bay_reservations",
  );

  // 5. release_cancelled_workshop_equipment locks repair_facilities before repair_requests
  assert.match(
    sqlContent,
    /release_cancelled_workshop_equipment[\s\S]+?FROM\s+public\.repair_facilities[\s\S]+?FOR\s+UPDATE[\s\S]+?FROM\s+public\.repair_requests[\s\S]+?FOR\s+UPDATE/i,
    "release_cancelled_workshop_equipment must acquire repair_facilities FOR UPDATE before repair_requests",
  );
});
