import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const { Client } = pg;
const DB_URL =
  process.env.TEST_DATABASE_URL || "postgresql://supabase_admin:postgres@127.0.0.1:54332/postgres";

// Check if database container is reachable
let dbAvailable = false;
let checkClient;
try {
  checkClient = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 });
  await checkClient.connect();
  await checkClient.query("SELECT 1;");
  dbAvailable = true;
  await checkClient.end();
} catch {
  dbAvailable = false;
  if (checkClient) {
    try {
      await checkClient.end();
    } catch {}
  }
}

// Helper to get client with specific JWT context simulating authenticated farmer / admin / manager / tech
async function getContextClient(sub = null, role = "authenticated") {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  await client.query("SET search_path = public, auth, extensions;");
  if (sub) {
    const cleanSub = String(sub).replace(/'/g, "''");
    const cleanRole = String(role).replace(/'/g, "''");
    await client.query(`SELECT set_config('request.jwt.claim.sub', '${cleanSub}', false);`);
    await client.query(`SELECT set_config('request.jwt.claim.role', '${cleanRole}', false);`);
    await client.query(`SET ROLE ${role === "anon" ? "anon" : "authenticated"};`);
  } else {
    await client.query(`SELECT set_config('request.jwt.claim.sub', '', false);`);
    await client.query(`SELECT set_config('request.jwt.claim.role', '', false);`);
    await client.query(`SET ROLE anon;`);
  }
  return client;
}

test(
  "Phase 14 Milestone 4: Workshop Drop-Off Lifecycle, Check-in Receipt & Bay Occupancy",
  { skip: !dbAvailable && "Requires local PostgreSQL test container on port 54332" },
  async (t) => {
    const master = new Client({ connectionString: DB_URL });
    await master.connect();
    await master.query("SET search_path = public, auth, extensions;");

    // Advisory lock to prevent parallel test collision with other live tests
    await master.query("SELECT pg_advisory_lock(140001);");

    let farmerClient;
    let farmer2Client;
    let adminClient;
    let mgrAlphaClient;
    let mgrBetaClient;
    let techAlphaClient;

    t.after(async () => {
      try {
        if (farmerClient) await farmerClient.end();
        if (farmer2Client) await farmer2Client.end();
        if (adminClient) await adminClient.end();
        if (mgrAlphaClient) await mgrAlphaClient.end();
        if (mgrBetaClient) await mgrBetaClient.end();
        if (techAlphaClient) await techAlphaClient.end();
      } catch {}
      try {
        await master.query("SELECT pg_advisory_unlock(140001);");
      } catch {}
      try {
        await master.end();
      } catch {}
    });

    // 0. Clean slate setup
    await master.query("TRUNCATE TABLE public.facility_bay_reservations CASCADE;");
    await master.query("TRUNCATE TABLE public.repair_requests CASCADE;");
    await master.query("TRUNCATE TABLE public.facility_memberships CASCADE;");
    await master.query("TRUNCATE TABLE public.repair_facilities CASCADE;");
    await master.query("TRUNCATE TABLE public.equipment CASCADE;");
    await master.query("TRUNCATE TABLE public.profile_auth_secrets CASCADE;");
    await master.query("TRUNCATE TABLE public.profiles CASCADE;");
    await master.query("TRUNCATE TABLE auth.users CASCADE;");
    await master.query("ALTER SEQUENCE public.drop_off_receipt_seq RESTART WITH 1;");

    // 1. Seed auth users & profiles (Decoupled IDs: profiles.id != auth_user_id)
    // Farmer 1
    const farmerUser = await master.query(
      "INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'farmer@m4test.demo') RETURNING id;",
    );
    const farmerAuthId = farmerUser.rows[0].id;
    const farmerProf = await master.query(
      `INSERT INTO public.profiles (id, auth_user_id, full_name, role, phone, village)
       VALUES (gen_random_uuid(), $1, 'Ramesh Patil', 'farmer', '+919800000001', 'Kalmeshwar')
       RETURNING id;`,
      [farmerAuthId],
    );
    const farmerProfileId = farmerProf.rows[0].id;

    // Farmer 2
    const farmer2User = await master.query(
      "INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'farmer2@m4test.demo') RETURNING id;",
    );
    const farmer2AuthId = farmer2User.rows[0].id;
    const farmer2Prof = await master.query(
      `INSERT INTO public.profiles (id, auth_user_id, full_name, role, phone, village)
       VALUES (gen_random_uuid(), $1, 'Suresh Deshmukh', 'farmer', '+919800000002', 'Saoner')
       RETURNING id;`,
      [farmer2AuthId],
    );
    const farmer2ProfileId = farmer2Prof.rows[0].id;

    // Admin
    const adminUser = await master.query(
      "INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'admin@m4test.demo') RETURNING id;",
    );
    const adminAuthId = adminUser.rows[0].id;
    const adminProf = await master.query(
      `INSERT INTO public.profiles (id, auth_user_id, full_name, role, phone, village)
       VALUES (gen_random_uuid(), $1, 'Admin Deshpande', 'admin', '+919800000099', 'Nagpur')
       RETURNING id;`,
      [adminAuthId],
    );
    const adminProfileId = adminProf.rows[0].id;

    // Manager Alpha (Staff of Facility Alpha)
    const mgrAlphaUser = await master.query(
      "INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'manager.alpha@m4test.demo') RETURNING id;",
    );
    const mgrAlphaAuthId = mgrAlphaUser.rows[0].id;
    const mgrAlphaProf = await master.query(
      `INSERT INTO public.profiles (id, auth_user_id, full_name, role, phone, village)
       VALUES (gen_random_uuid(), $1, 'Vijay Manager Alpha', 'technician', '+919800000010', 'Kalmeshwar')
       RETURNING id;`,
      [mgrAlphaAuthId],
    );
    const mgrAlphaProfileId = mgrAlphaProf.rows[0].id;

    // Manager Beta (Staff of Facility Beta)
    const mgrBetaUser = await master.query(
      "INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'manager.beta@m4test.demo') RETURNING id;",
    );
    const mgrBetaAuthId = mgrBetaUser.rows[0].id;
    const mgrBetaProf = await master.query(
      `INSERT INTO public.profiles (id, auth_user_id, full_name, role, phone, village)
       VALUES (gen_random_uuid(), $1, 'Ganesh Manager Beta', 'technician', '+919800000020', 'Saoner')
       RETURNING id;`,
      [mgrBetaAuthId],
    );
    const mgrBetaProfileId = mgrBetaProf.rows[0].id;

    // Ordinary Technician Alpha (Staff of Facility Alpha with role 'TECHNICIAN')
    const techAlphaUser = await master.query(
      "INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'tech.alpha@m4test.demo') RETURNING id;",
    );
    const techAlphaAuthId = techAlphaUser.rows[0].id;
    const techAlphaProf = await master.query(
      `INSERT INTO public.profiles (id, auth_user_id, full_name, role, phone, village)
       VALUES (gen_random_uuid(), $1, 'Anil Technician Alpha', 'technician', '+919800000030', 'Kalmeshwar')
       RETURNING id;`,
      [techAlphaAuthId],
    );
    const techAlphaProfileId = techAlphaProf.rows[0].id;

    // 2. Initialize authenticated context clients
    farmerClient = await getContextClient(farmerAuthId, "authenticated");
    farmer2Client = await getContextClient(farmer2AuthId, "authenticated");
    adminClient = await getContextClient(adminAuthId, "authenticated");
    mgrAlphaClient = await getContextClient(mgrAlphaAuthId, "authenticated");
    mgrBetaClient = await getContextClient(mgrBetaAuthId, "authenticated");
    techAlphaClient = await getContextClient(techAlphaAuthId, "authenticated");

    // Helper to get capacity breakdown JSON
    async function getCapacity(client, facilityId) {
      const res = await client.query(
        "SELECT public.get_facility_capacity_breakdown($1) AS breakdown;",
        [facilityId],
      );
      return res.rows[0].breakdown;
    }

    // 3. Seed equipment
    const eq1 = await master.query(
      `INSERT INTO public.equipment (id, farmer_id, make, model, type, serial_number, status)
       VALUES (gen_random_uuid(), $1, 'Mahindra', '575 DI', 'Tractor', 'SN-M4-001', 'Operational')
       RETURNING id;`,
      [farmerProfileId],
    );
    const equipment1Id = eq1.rows[0].id;

    const eq2 = await master.query(
      `INSERT INTO public.equipment (id, farmer_id, make, model, type, serial_number, status)
       VALUES (gen_random_uuid(), $1, 'John Deere', '5050 D', 'Tractor', 'SN-M4-002', 'Operational')
       RETURNING id;`,
      [farmer2ProfileId],
    );
    const equipment2Id = eq2.rows[0].id;

    // 4. Seed facilities
    // Facility Alpha: Approved drop-off, max capacity 3 bays
    const facAlpha = await master.query(
      `INSERT INTO public.repair_facilities (
         id, name, owner_profile_id, phone, address, village, tahsil, latitude, longitude, is_active, drop_off_approved, max_equipment_capacity
       ) VALUES (
         gen_random_uuid(), 'Alpha Agro Workshop', $1, '+917122550001', 'Plot 10, MIDC', 'Kalmeshwar', 'Kalmeshwar', 21.2333, 78.9167, true, true, 3
       ) RETURNING id;`,
      [adminProfileId],
    );
    const facilityAlphaId = facAlpha.rows[0].id;

    // Facility Beta: Approved drop-off, max capacity 2 bays (for rerouting and foreign checks)
    const facBeta = await master.query(
      `INSERT INTO public.repair_facilities (
         id, name, owner_profile_id, phone, address, village, tahsil, latitude, longitude, is_active, drop_off_approved, max_equipment_capacity
       ) VALUES (
         gen_random_uuid(), 'Beta Agro Workshop', $1, '+917122550002', 'Plot 20, MIDC', 'Saoner', 'Saoner', 21.3833, 78.9167, true, true, 2
       ) RETURNING id;`,
      [adminProfileId],
    );
    const facilityBetaId = facBeta.rows[0].id;

    // 5. Seed facility memberships
    // Manager Alpha -> Alpha (role: MANAGER)
    await master.query(
      `INSERT INTO public.facility_memberships (facility_id, technician_profile_id, role, status)
       VALUES ($1, $2, 'MANAGER', 'ACTIVE');`,
      [facilityAlphaId, mgrAlphaProfileId],
    );

    // Manager Beta -> Beta (role: MANAGER)
    await master.query(
      `INSERT INTO public.facility_memberships (facility_id, technician_profile_id, role, status)
       VALUES ($1, $2, 'MANAGER', 'ACTIVE');`,
      [facilityBetaId, mgrBetaProfileId],
    );

    // Technician Alpha -> Alpha (role: TECHNICIAN)
    await master.query(
      `INSERT INTO public.facility_memberships (facility_id, technician_profile_id, role, status)
       VALUES ($1, $2, 'TECHNICIAN', 'ACTIVE');`,
      [facilityAlphaId, techAlphaProfileId],
    );

    // ------------------------------------------------------------------------
    // TEST 1: Initial Capacity Breakdown RPC
    // ------------------------------------------------------------------------
    await t.test("get_facility_capacity_breakdown reports accurate empty metrics", async () => {
      const breakdown = await getCapacity(adminClient, facilityAlphaId);
      assert.equal(Number(breakdown.max_equipment_capacity), 3);
      assert.equal(Number(breakdown.physical_occupancy), 0);
      assert.equal(Number(breakdown.active_reservations), 0);
      assert.equal(Number(breakdown.total_committed_capacity), 0);
      assert.equal(Number(breakdown.available_capacity), 3);
      assert.equal(Boolean(breakdown.is_at_capacity), false);
      assert.equal(Boolean(breakdown.is_overcommitted), false);
    });

    // ------------------------------------------------------------------------
    // TEST 2: Transactional submit_workshop_dropoff_repair (Atomic Intake + Reservation)
    // ------------------------------------------------------------------------
    let atomicTicketId;
    let atomicReservationId;

    await t.test(
      "End-to-End: submit_workshop_dropoff_repair atomically creates ticket + bay reservation in 1 transaction",
      async () => {
        // Farmer 1 submits a valid workshop drop-off request
        const res = await farmerClient.query(
          `SELECT public.submit_workshop_dropoff_repair(
             $1, $2, ARRAY['Engine overheating', 'Coolant leak'],
             'Tractor started steaming during plowing', 'Kalmeshwar Field 4',
             ARRAY[]::text[], '{"source":"farmer"}'::jsonb, 21.235, 78.918, 5.0
           ) AS data;`,
          [equipment1Id, facilityAlphaId],
        );

        const data = res.rows[0].data;
        assert.equal(data.success, true);
        assert.ok(data.repair_id);
        assert.match(data.job_number, /^TB-\d{4}$/);
        atomicTicketId = data.repair_id;

        // Verify reservation was created atomically via M1 reserve_workshop_bay
        assert.ok(data.reservation);
        assert.equal(data.reservation.success, true);
        atomicReservationId = data.reservation.reservation_id;
        assert.ok(atomicReservationId);

        // Verify repair request row in database
        const repRow = await master.query(
          "SELECT delivery_mode, facility_id, status, is_immobile FROM public.repair_requests WHERE id = $1;",
          [atomicTicketId],
        );
        assert.equal(repRow.rows[0].delivery_mode, "WORKSHOP_DROPOFF");
        assert.equal(repRow.rows[0].facility_id, facilityAlphaId);
        assert.equal(repRow.rows[0].status, "REQUESTED");
        assert.equal(repRow.rows[0].is_immobile, false);

        // Verify equipment status advanced to 'In Repair'
        const eqRow = await master.query("SELECT status FROM public.equipment WHERE id = $1;", [
          equipment1Id,
        ]);
        assert.equal(eqRow.rows[0].status, "In Repair");

        // Verify reservation row in database
        const resvRow = await master.query(
          "SELECT status, farmer_profile_id, facility_id, repair_request_id FROM public.facility_bay_reservations WHERE id = $1;",
          [atomicReservationId],
        );
        assert.equal(resvRow.rows[0].status, "RESERVED");
        assert.equal(resvRow.rows[0].farmer_profile_id, farmerProfileId);
        assert.equal(resvRow.rows[0].facility_id, facilityAlphaId);
        assert.equal(resvRow.rows[0].repair_request_id, atomicTicketId);

        // Verify workshop capacity reflects exactly 1 active reservation
        const cap = await getCapacity(adminClient, facilityAlphaId);
        assert.equal(Number(cap.active_reservations), 1);
        assert.equal(Number(cap.physical_occupancy), 0);
        assert.equal(Number(cap.total_committed_capacity), 1);
        assert.equal(Number(cap.available_capacity), 2);
      },
    );

    // ------------------------------------------------------------------------
    // TEST 3: Atomicity & Failure Behavior (Zero Orphan Repair Requests on Exhaustion)
    // ------------------------------------------------------------------------
    await t.test(
      "Atomicity: submit_workshop_dropoff_repair on full workshop aborts and leaves ZERO orphan tickets",
      async () => {
        // Temporarily downsize Alpha capacity to 1 bay (committed capacity is already 1)
        await master.query(
          "UPDATE public.repair_facilities SET max_equipment_capacity = 1 WHERE id = $1;",
          [facilityAlphaId],
        );

        // Create 3rd equipment for farmer 2
        const eq3 = await master.query(
          `INSERT INTO public.equipment (id, farmer_id, make, model, type, serial_number, status)
           VALUES (gen_random_uuid(), $1, 'Sonalika', 'DI 745', 'Tractor', 'SN-M4-003', 'Operational')
           RETURNING id;`,
          [farmer2ProfileId],
        );
        const equipment3Id = eq3.rows[0].id;

        // Count repair requests before attack
        const countBefore = await master.query(
          "SELECT COUNT(*)::int AS count FROM public.repair_requests;",
        );

        // Farmer 2 attempts drop-off at full workshop
        let threw = false;
        try {
          await farmer2Client.query(
            `SELECT public.submit_workshop_dropoff_repair(
               $1, $2, ARRAY['Brake failure'],
               'Brakes gave out on slope', 'Saoner Field',
               ARRAY[]::text[], '{}'::jsonb
             );`,
            [equipment3Id, facilityAlphaId],
          );
        } catch (err) {
          threw = true;
          assert.match(err.message, /BAY_RESERVATION_FAILED|maximum capacity|CAPACITY_EXHAUSTED/i);
        }
        assert.equal(threw, true, "Must reject submission when workshop bay capacity is exhausted");

        // Verify 100% database atomicity: ZERO repair requests were persisted!
        const countAfter = await master.query(
          "SELECT COUNT(*)::int AS count FROM public.repair_requests;",
        );
        assert.equal(
          countAfter.rows[0].count,
          countBefore.rows[0].count,
          "Transaction must roll back entirely: zero orphan repair requests persisted",
        );

        // Verify equipment status was NOT updated to 'In Repair'
        const eq3Check = await master.query("SELECT status FROM public.equipment WHERE id = $1;", [
          equipment3Id,
        ]);
        assert.equal(
          eq3Check.rows[0].status,
          "Operational",
          "Equipment status must remain unchanged on aborted submission",
        );

        // Restore Alpha capacity to 3 bays
        await master.query(
          "UPDATE public.repair_facilities SET max_equipment_capacity = 3 WHERE id = $1;",
          [facilityAlphaId],
        );
      },
    );

    // ------------------------------------------------------------------------
    // TEST 3B: Negative Security Verification on submit_workshop_dropoff_repair
    // ------------------------------------------------------------------------
    await t.test(
      "Negative Security: submit_workshop_dropoff_repair enforces role, profile identity, equipment ownership, and facility status",
      async () => {
        // Create an operational equipment owned by farmer 1 specifically for negative checks
        const eqNegRes = await master.query(
          `INSERT INTO public.equipment (id, farmer_id, make, model, type, serial_number, status)
           VALUES (gen_random_uuid(), $1, 'Eicher', '380 Super DI', 'Tractor', 'SN-NEG-001', 'Operational')
           RETURNING id;`,
          [farmerProfileId],
        );
        const eqNegId = eqNegRes.rows[0].id;

        // 1. Farmer A cannot submit using Farmer B's profile ID
        let threwForgedProfile = false;
        try {
          await farmerClient.query(
            `SELECT public.submit_workshop_dropoff_repair(
               $1, $2, ARRAY['Engine smoke'], 'Description', 'Nagpur Farm',
               ARRAY[]::text[], '{}'::jsonb, NULL, NULL, NULL,
               $3, FALSE
             );`,
            [eqNegId, facilityAlphaId, farmer2ProfileId],
          );
        } catch (err) {
          threwForgedProfile = true;
          assert.match(
            err.message,
            /UNAUTHORIZED|Farmer cannot submit a repair request for another farmer profile/i,
          );
        }
        assert.equal(
          threwForgedProfile,
          true,
          "Farmer 1 submitting using Farmer 2 profile ID must be rejected with 42501",
        );

        // 2. Farmer A cannot submit using Farmer B's equipment ID
        let threwForeignEquipment = false;
        try {
          await farmerClient.query(
            `SELECT public.submit_workshop_dropoff_repair(
               $1, $2, ARRAY['Transmission noise'], 'Description', 'Nagpur Farm',
               ARRAY[]::text[], '{}'::jsonb, NULL, NULL, NULL,
               $3, FALSE
             );`,
            [equipment2Id, facilityAlphaId, farmerProfileId],
          );
        } catch (err) {
          threwForeignEquipment = true;
          assert.match(
            err.message,
            /UNAUTHORIZED|Equipment does not belong to authenticated farmer/i,
          );
        }
        assert.equal(
          threwForeignEquipment,
          true,
          "Farmer 1 submitting using Farmer 2 equipment ID must be rejected with 42501",
        );

        // 3. An ordinary technician cannot submit a farmer repair request
        let threwTechSubmission = false;
        try {
          await techAlphaClient.query(
            `SELECT public.submit_workshop_dropoff_repair(
               $1, $2, ARRAY['Hydraulic leak'], 'Description', 'Workshop Floor',
               ARRAY[]::text[], '{}'::jsonb, NULL, NULL, NULL,
               $3, FALSE
             );`,
            [eqNegId, facilityAlphaId, farmerProfileId],
          );
        } catch (err) {
          threwTechSubmission = true;
          assert.match(
            err.message,
            /UNAUTHORIZED|Caller role.*is not authorized to submit repair requests/i,
          );
        }
        assert.equal(
          threwTechSubmission,
          true,
          "Ordinary technician submitting repair request must be rejected with 42501",
        );

        // 4. An inactive or unapproved facility is rejected
        const unapprovedFac = await master.query(
          `INSERT INTO public.repair_facilities (
             id, name, owner_profile_id, phone, address, village, tahsil, latitude, longitude, is_active, drop_off_approved, max_equipment_capacity
           ) VALUES (
             gen_random_uuid(), 'Unapproved Shed', $1, '+917122550099', 'Wardha Road', 'Butibori', 'Nagpur Rural', 20.9167, 79.0000, true, false, 2
           ) RETURNING id;`,
          [adminProfileId],
        );
        const unapprovedFacId = unapprovedFac.rows[0].id;

        let threwUnapproved = false;
        try {
          await farmerClient.query(
            `SELECT public.submit_workshop_dropoff_repair(
               $1, $2, ARRAY['PTO failure'], 'Description', 'Nagpur Farm',
               ARRAY[]::text[], '{}'::jsonb, NULL, NULL, NULL,
               $3, FALSE
             );`,
            [eqNegId, unapprovedFacId, farmerProfileId],
          );
        } catch (err) {
          threwUnapproved = true;
          assert.match(err.message, /FACILITY_UNAVAILABLE|inactive or not approved for drop-off/i);
        }
        assert.equal(
          threwUnapproved,
          true,
          "Submission referencing unapproved facility must be rejected with 22000",
        );

        // 5. An immobile equipment submission is rejected
        let threwImmobile = false;
        try {
          await farmerClient.query(
            `SELECT public.submit_workshop_dropoff_repair(
               $1, $2, ARRAY['Engine seized'], 'Tractor cannot move', 'Nagpur Farm',
               ARRAY[]::text[], '{}'::jsonb, NULL, NULL, NULL,
               $3, TRUE
             );`,
            [eqNegId, facilityAlphaId, farmerProfileId],
          );
        } catch (err) {
          threwImmobile = true;
          assert.match(
            err.message,
            /IMMOBILE_LOCK|Immobile machinery cannot use Workshop Drop-Off mode/i,
          );
        }
        assert.equal(
          threwImmobile,
          true,
          "Immobile machinery submission to Workshop Drop-Off must be rejected with 22000",
        );
      },
    );

    // ------------------------------------------------------------------------
    // TEST 4: Active Reservation Check-in (Path A) by Authorized Workshop Manager
    // ------------------------------------------------------------------------
    let receipt1Number;

    await t.test(
      "Path A: Authorized Workshop Manager executes drop-off check-in & issues receipt",
      async () => {
        // Manager Alpha executes check-in for atomicTicketId (which has an active reservation at Alpha)
        const checkinRes = await mgrAlphaClient.query(
          "SELECT public.execute_workshop_dropoff_checkin($1, 'Tractor brought in by farmer trailer');",
          [atomicTicketId],
        );
        const checkinJson = checkinRes.rows[0].execute_workshop_dropoff_checkin;
        assert.equal(checkinJson.success, true);
        assert.equal(checkinJson.path, "ACTIVE");
        receipt1Number = checkinJson.receipt_number;

        // Verify receipt format RCP-TB-YYYYMMDD-XXXX
        assert.match(
          receipt1Number,
          /^RCP-TB-\d{8}-\d{4}$/,
          "Receipt must match RCP-TB-YYYYMMDD-XXXX format",
        );

        // Verify repair request row authoritatively updated
        const repCheck = await master.query(
          "SELECT dropped_off_at, drop_off_receipt_number, handover_status FROM public.repair_requests WHERE id = $1;",
          [atomicTicketId],
        );
        assert.ok(repCheck.rows[0].dropped_off_at);
        assert.equal(repCheck.rows[0].drop_off_receipt_number, receipt1Number);
        assert.equal(repCheck.rows[0].handover_status, "PENDING");

        // Verify reservation transitioned to CLAIMED
        const resCheck = await master.query(
          "SELECT status, claimed_at FROM public.facility_bay_reservations WHERE id = $1;",
          [atomicReservationId],
        );
        assert.equal(resCheck.rows[0].status, "CLAIMED");
        assert.ok(resCheck.rows[0].claimed_at);

        // Verify capacity: physical occupancy = 1, active reservations = 0, total committed = 1
        const capPost = await getCapacity(adminClient, facilityAlphaId);
        assert.equal(Number(capPost.physical_occupancy), 1);
        assert.equal(Number(capPost.active_reservations), 0);
        assert.equal(Number(capPost.total_committed_capacity), 1);
        assert.equal(Number(capPost.available_capacity), 2);
      },
    );

    // ------------------------------------------------------------------------
    // TEST 5: Standby Arrival (Path B) Drop-Off Check-In
    // ------------------------------------------------------------------------
    let ticket2Id;
    let receipt2Number;

    await t.test(
      "Path B: Standby drop-off without prior reservation succeeds and issues unique receipt",
      async () => {
        // Create second repair ticket with NO active reservation
        const rep2Res = await master.query(
          `INSERT INTO public.repair_requests (
             id, job_number, farmer_id, equipment_id, location, symptoms,
             delivery_mode, is_immobile, facility_id, status
           ) VALUES (
             gen_random_uuid(), 'JOB-M4-002', $1, $2, 'Saoner Field', ARRAY['Hydraulic leak'],
             'WORKSHOP_DROPOFF', false, $3, 'REQUESTED'
           ) RETURNING id;`,
          [farmer2ProfileId, equipment2Id, facilityAlphaId],
        );
        ticket2Id = rep2Res.rows[0].id;

        // Standby check-in via Manager Alpha
        const checkinRes = await mgrAlphaClient.query(
          "SELECT public.execute_workshop_dropoff_checkin($1, 'Standby walk-in drop-off');",
          [ticket2Id],
        );
        const checkinJson = checkinRes.rows[0].execute_workshop_dropoff_checkin;
        assert.equal(checkinJson.success, true);
        assert.equal(checkinJson.path, "STANDBY");
        receipt2Number = checkinJson.receipt_number;
        assert.match(receipt2Number, /^RCP-TB-\d{8}-\d{4}$/);
        assert.notEqual(receipt1Number, receipt2Number, "Each receipt must be strictly unique");

        // Verify capacity now has 2 physical occupancies
        const capPost = await getCapacity(adminClient, facilityAlphaId);
        assert.equal(Number(capPost.physical_occupancy), 2);
        assert.equal(Number(capPost.total_committed_capacity), 2);
        assert.equal(Number(capPost.available_capacity), 1);
      },
    );

    // ------------------------------------------------------------------------
    // TEST 6: Check-In Idempotency Guard
    // ------------------------------------------------------------------------
    await t.test(
      "Check-In Idempotency: Repeated check-in returns already_checked_in = true with existing receipt",
      async () => {
        const checkinRepeat = await mgrAlphaClient.query(
          "SELECT public.execute_workshop_dropoff_checkin($1, 'Repeated checkin');",
          [ticket2Id],
        );
        const json = checkinRepeat.rows[0].execute_workshop_dropoff_checkin;
        assert.equal(json.success, true);
        assert.equal(json.already_checked_in, true);
        assert.equal(json.receipt_number, receipt2Number);
      },
    );

    // ------------------------------------------------------------------------
    // TEST 7: Role & Facility Authorization Matrix (Check-In)
    // ------------------------------------------------------------------------
    await t.test(
      "Authorization Matrix: Manager can check-in at own facility; denied at foreign facility; farmer & tech denied",
      async () => {
        // Create 4th ticket assigned to Facility Beta
        const repBeta = await master.query(
          `INSERT INTO public.repair_requests (
             id, job_number, farmer_id, equipment_id, location, symptoms,
             delivery_mode, is_immobile, facility_id, status
           ) VALUES (
             gen_random_uuid(), 'JOB-M4-BETA', $1, $2, 'Saoner Farm', ARRAY['Transmission grind'],
             'WORKSHOP_DROPOFF', false, $3, 'REQUESTED'
           ) RETURNING id;`,
          [farmer2ProfileId, equipment2Id, facilityBetaId],
        );
        const ticketBetaId = repBeta.rows[0].id;

        // 1. Manager Alpha attempts check-in at Facility Beta -> REJECTED (Foreign facility manager)
        let threwAlphaAtBeta = false;
        try {
          await mgrAlphaClient.query(
            "SELECT public.execute_workshop_dropoff_checkin($1, 'Alpha manager intruding on Beta');",
            [ticketBetaId],
          );
        } catch (err) {
          threwAlphaAtBeta = true;
          assert.match(err.message, /UNAUTHORIZED|not authorized to check in equipment/i);
        }
        assert.equal(
          threwAlphaAtBeta,
          true,
          "Manager of Facility Alpha must NOT be authorized to check in at Facility Beta",
        );

        // 2. Farmer attempts check-in -> REJECTED
        let threwFarmer = false;
        try {
          await farmerClient.query(
            "SELECT public.execute_workshop_dropoff_checkin($1, 'Farmer trying to check in self');",
            [ticketBetaId],
          );
        } catch (err) {
          threwFarmer = true;
          assert.match(err.message, /UNAUTHORIZED|not authorized to check in equipment/i);
        }
        assert.equal(
          threwFarmer,
          true,
          "Farmers must NOT be authorized to execute physical check-in",
        );

        // 3. Ordinary Technician Alpha attempts check-in at Alpha -> REJECTED
        let threwTech = false;
        try {
          await techAlphaClient.query(
            "SELECT public.execute_workshop_dropoff_checkin($1, 'Ordinary tech attempting check in');",
            [ticket2Id],
          );
        } catch (err) {
          threwTech = true;
          assert.match(err.message, /UNAUTHORIZED|not authorized to check in equipment/i);
        }
        assert.equal(
          threwTech,
          true,
          "Ordinary technicians without MANAGER/OWNER role must NOT be authorized to check in equipment",
        );

        // 4. Manager Beta executes check-in at Facility Beta -> SUCCEEDS
        const betaCheckin = await mgrBetaClient.query(
          "SELECT public.execute_workshop_dropoff_checkin($1, 'Beta manager authorized checkin');",
          [ticketBetaId],
        );
        assert.equal(betaCheckin.rows[0].execute_workshop_dropoff_checkin.success, true);
      },
    );

    // ------------------------------------------------------------------------
    // TEST 8: Downsized Capacity Rejection on Standby
    // ------------------------------------------------------------------------
    await t.test("Downsized capacity rejects standby intake when bays are full", async () => {
      // Downsize Alpha from 3 to 2 bays (physical occupancy is already 2 from tickets 1 and 2)
      await master.query(
        "UPDATE public.repair_facilities SET max_equipment_capacity = 2 WHERE id = $1;",
        [facilityAlphaId],
      );

      const capCheck = await getCapacity(adminClient, facilityAlphaId);
      assert.equal(Number(capCheck.max_equipment_capacity), 2);
      assert.equal(Number(capCheck.physical_occupancy), 2);
      assert.equal(Number(capCheck.available_capacity), 0);
      assert.equal(Boolean(capCheck.is_at_capacity), true);

      // Create another ticket and attempt standby drop-off at Alpha
      const repOver = await master.query(
        `INSERT INTO public.repair_requests (
           id, job_number, farmer_id, equipment_id, location, symptoms,
           delivery_mode, is_immobile, facility_id, status
         ) VALUES (
           gen_random_uuid(), 'JOB-M4-OVER', $1, $2, 'Overflow Field', ARRAY['Battery dead'],
           'WORKSHOP_DROPOFF', false, $3, 'REQUESTED'
         ) RETURNING id;`,
        [farmerProfileId, equipment1Id, facilityAlphaId],
      );
      const ticketOverId = repOver.rows[0].id;

      // Standby check-in should be rejected with CAPACITY_EXHAUSTED
      const failCheckin = await mgrAlphaClient.query(
        "SELECT public.execute_workshop_dropoff_checkin($1, 'Should fail');",
        [ticketOverId],
      );
      const failJson = failCheckin.rows[0].execute_workshop_dropoff_checkin;
      assert.equal(failJson.success, false);
      assert.equal(failJson.code, "CAPACITY_EXHAUSTED");
      assert.equal(failJson.reroute_eligible, true);

      // Restore Alpha capacity to 4 for subsequent tests
      await master.query(
        "UPDATE public.repair_facilities SET max_equipment_capacity = 4 WHERE id = $1;",
        [facilityAlphaId],
      );
    });

    // ------------------------------------------------------------------------
    // TEST 9: FIFO Priority Preservation Across Rerouting
    // ------------------------------------------------------------------------
    await t.test("Rerouting preserves original reserved_at FIFO priority timestamp", async () => {
      const repReroute = await master.query(
        `INSERT INTO public.repair_requests (
           id, job_number, farmer_id, equipment_id, location, symptoms,
           delivery_mode, is_immobile, facility_id, status
         ) VALUES (
           gen_random_uuid(), 'JOB-M4-REROUTE', $1, $2, 'Far Field', ARRAY['Clutch slipping'],
           'WORKSHOP_DROPOFF', false, $3, 'REQUESTED'
         ) RETURNING id;`,
        [farmerProfileId, equipment1Id, facilityAlphaId],
      );
      const ticketRerouteId = repReroute.rows[0].id;

      // 1. Initial reservation at Facility Alpha (as Farmer)
      await farmerClient.query(
        "SELECT public.reserve_workshop_bay($1, $2, '24 hours'::interval);",
        [ticketRerouteId, facilityAlphaId],
      );
      const row1 = await master.query(
        "SELECT priority_original_reserved_at FROM public.facility_bay_reservations WHERE repair_request_id = $1;",
        [ticketRerouteId],
      );
      const t1Priority = row1.rows[0].priority_original_reserved_at;
      assert.ok(t1Priority, "Initial reservation must have priority_original_reserved_at");

      // 2. Reroute to Facility Beta (as Admin)
      await adminClient.query("SELECT public.reserve_workshop_bay($1, $2, '24 hours'::interval);", [
        ticketRerouteId,
        facilityBetaId,
      ]);
      const row2 = await master.query(
        "SELECT priority_original_reserved_at, facility_id FROM public.facility_bay_reservations WHERE repair_request_id = $1;",
        [ticketRerouteId],
      );
      const t2Priority = row2.rows[0].priority_original_reserved_at;

      assert.equal(
        t2Priority.toISOString(),
        t1Priority.toISOString(),
        "Original priority_original_reserved_at must be strictly preserved across rerouting",
      );
      assert.equal(row2.rows[0].facility_id, facilityBetaId);

      // 3. Unauthorized actor (Technician Alpha) attempts to reroute ticket -> REJECTED (42501 UNAUTHORIZED)
      let threwTechReroute = false;
      try {
        await techAlphaClient.query(
          "SELECT public.reserve_workshop_bay($1, $2, '24 hours'::interval);",
          [ticketRerouteId, facilityAlphaId],
        );
      } catch (err) {
        threwTechReroute = true;
        assert.match(
          err.message,
          /UNAUTHORIZED|Only the owning farmer or Service Centre admin can reserve a bay/i,
        );
      }
      assert.equal(
        threwTechReroute,
        true,
        "Ordinary technician cannot reroute repair reservations",
      );

      // 4. Unauthorized actor (Farmer 2) attempts to reroute Farmer 1's ticket -> REJECTED (42501 UNAUTHORIZED)
      let threwFarmer2Reroute = false;
      try {
        await farmer2Client.query(
          "SELECT public.reserve_workshop_bay($1, $2, '24 hours'::interval);",
          [ticketRerouteId, facilityAlphaId],
        );
      } catch (err) {
        threwFarmer2Reroute = true;
        assert.match(
          err.message,
          /UNAUTHORIZED|Only the owning farmer or Service Centre admin can reserve a bay/i,
        );
      }
      assert.equal(
        threwFarmer2Reroute,
        true,
        "Foreign farmer cannot reroute another farmer's reservation",
      );
    });

    // ------------------------------------------------------------------------
    // TEST 10: Farmer 1x Self-Renewal vs Admin Renewal with Mandatory Audit Notes
    // ------------------------------------------------------------------------
    await t.test("Farmer is limited to 1x self-renewal; Admin requires audit notes", async () => {
      const repRenew = await master.query(
        `INSERT INTO public.repair_requests (
           id, job_number, farmer_id, equipment_id, location, symptoms,
           delivery_mode, is_immobile, facility_id, status
         ) VALUES (
           gen_random_uuid(), 'JOB-M4-RENEW', $1, $2, 'Field East', ARRAY['PTO stuck'],
           'WORKSHOP_DROPOFF', false, $3, 'REQUESTED'
         ) RETURNING id;`,
        [farmerProfileId, equipment1Id, facilityAlphaId],
      );
      const ticketRenewId = repRenew.rows[0].id;

      const resv = await farmerClient.query(
        "SELECT public.reserve_workshop_bay($1, $2, '24 hours'::interval);",
        [ticketRenewId, facilityAlphaId],
      );
      const resvId = resv.rows[0].reserve_workshop_bay.reservation_id;

      // 1. Farmer 1st self-renewal succeeds
      const renew1 = await farmerClient.query(
        "SELECT public.renew_workshop_bay_reservation($1, '24 hours'::interval, NULL);",
        [resvId],
      );
      assert.equal(renew1.rows[0].renew_workshop_bay_reservation.success, true);
      assert.equal(renew1.rows[0].renew_workshop_bay_reservation.renewal_count, 1);

      // 2. Farmer 2nd self-renewal without notes is rejected
      let threw = false;
      try {
        await farmerClient.query(
          "SELECT public.renew_workshop_bay_reservation($1, '24 hours'::interval, NULL);",
          [resvId],
        );
      } catch (err) {
        threw = true;
        assert.match(
          err.message,
          /RENEWAL_LIMIT_EXCEEDED|limited to one self-renewal|already been renewed/i,
        );
      }
      assert.equal(threw, true, "2nd self-renewal without admin audit notes must throw");

      // 3. Admin renewal with empty notes is rejected
      let threwEmptyNotes = false;
      try {
        await adminClient.query(
          "SELECT public.renew_workshop_bay_reservation($1, '24 hours'::interval, '   ');",
          [resvId],
        );
      } catch (err) {
        threwEmptyNotes = true;
        assert.match(err.message, /AUDIT_NOTES_REQUIRED|mandatory audit notes/i);
      }
      assert.equal(
        threwEmptyNotes,
        true,
        "Admin renewal without non-empty audit notes must be rejected",
      );

      // 4. Admin renewal with mandatory audit notes succeeds
      const adminRenew = await adminClient.query(
        "SELECT public.renew_workshop_bay_reservation($1, '24 hours'::interval, 'Admin granted weather delay extension');",
        [resvId],
      );
      assert.equal(adminRenew.rows[0].renew_workshop_bay_reservation.success, true);
      assert.equal(adminRenew.rows[0].renew_workshop_bay_reservation.renewal_count, 2);

      // 5. Farmer 2 attempts to renew Farmer 1's reservation -> REJECTED (42501 UNAUTHORIZED)
      let threwForeignRenewal = false;
      try {
        await farmer2Client.query(
          "SELECT public.renew_workshop_bay_reservation($1, '24 hours'::interval, NULL);",
          [resvId],
        );
      } catch (err) {
        threwForeignRenewal = true;
        assert.match(
          err.message,
          /UNAUTHORIZED|Caller is not authorized to renew this reservation/i,
        );
      }
      assert.equal(threwForeignRenewal, true, "Farmer 2 cannot renew Farmer 1's reservation");

      // 6. Farmer 1 attempts staff renewal with audit notes beyond limit -> REJECTED (22000 RENEWAL_LIMIT_EXCEEDED)
      let threwFarmerStaffRenewal = false;
      try {
        await farmerClient.query(
          "SELECT public.renew_workshop_bay_reservation($1, '24 hours'::interval, 'Farmer attempting staff override');",
          [resvId],
        );
      } catch (err) {
        threwFarmerStaffRenewal = true;
        assert.match(err.message, /RENEWAL_LIMIT_EXCEEDED|limited to one self-renewal/i);
      }
      assert.equal(
        threwFarmerStaffRenewal,
        true,
        "Farmer cannot perform staff renewal or bypass 1x limit with notes",
      );
    });

    // ------------------------------------------------------------------------
    // TEST 11: Physical Custody Independence from Ticket Cancellation & Release Guards
    // ------------------------------------------------------------------------
    await t.test(
      "Cancelled ticket physically occupying bay holds occupancy until authorized physical release",
      async () => {
        // atomicTicketId is currently in Alpha bay (checked in earlier)
        const capBefore = await getCapacity(adminClient, facilityAlphaId);
        const initialOccupancy = Number(capBefore.physical_occupancy);
        assert.ok(initialOccupancy >= 1, "Must have equipment physically in bay");

        // Cancel atomicTicketId
        await master.query(
          "UPDATE public.repair_requests SET status = 'CANCELLED' WHERE id = $1;",
          [atomicTicketId],
        );

        // Crucial invariant: physical occupancy is NOT silently released on ticket cancellation!
        const capAfterCancel = await getCapacity(adminClient, facilityAlphaId);
        assert.equal(
          Number(capAfterCancel.physical_occupancy),
          initialOccupancy,
          "Physical occupancy must NOT be decremented on repair cancellation alone",
        );

        // 1. Farmer attempts physical release -> REJECTED (42501 UNAUTHORIZED)
        let threwFarmerRelease = false;
        try {
          await farmerClient.query(
            "SELECT public.release_cancelled_workshop_equipment($1, 'Farmer attempting release');",
            [atomicTicketId],
          );
        } catch (err) {
          threwFarmerRelease = true;
          assert.match(err.message, /UNAUTHORIZED|not authorized to release equipment/i);
        }
        assert.equal(
          threwFarmerRelease,
          true,
          "Farmers must NOT be authorized to execute physical release",
        );

        // 2. Ordinary Technician attempts physical release -> REJECTED (42501 UNAUTHORIZED)
        let threwTechRelease = false;
        try {
          await techAlphaClient.query(
            "SELECT public.release_cancelled_workshop_equipment($1, 'Tech attempting release');",
            [atomicTicketId],
          );
        } catch (err) {
          threwTechRelease = true;
          assert.match(err.message, /UNAUTHORIZED|not authorized to release equipment/i);
        }
        assert.equal(
          threwTechRelease,
          true,
          "Ordinary technicians must NOT be authorized to execute physical release",
        );

        // 3. Manager Beta attempts release of equipment at Facility Alpha -> REJECTED (Foreign manager)
        let threwForeignRelease = false;
        try {
          await mgrBetaClient.query(
            "SELECT public.release_cancelled_workshop_equipment($1, 'Beta manager intruding on Alpha');",
            [atomicTicketId],
          );
        } catch (err) {
          threwForeignRelease = true;
          assert.match(err.message, /UNAUTHORIZED|not authorized to release equipment/i);
        }
        assert.equal(
          threwForeignRelease,
          true,
          "Manager of Beta must NOT be authorized to release at Alpha",
        );

        // 3B. Manager Beta attempts release of reservation at Facility Alpha -> REJECTED (Foreign manager)
        let threwForeignResvRelease = false;
        try {
          await mgrBetaClient.query(
            "SELECT public.release_workshop_bay_reservation($1, 'Beta manager trying to release Alpha reservation');",
            [atomicTicketId],
          );
        } catch (err) {
          threwForeignResvRelease = true;
          assert.match(err.message, /UNAUTHORIZED|Caller cannot release this reservation/i);
        }
        assert.equal(
          threwForeignResvRelease,
          true,
          "Manager Beta cannot release reservation at Facility Alpha",
        );

        // 4. Authorized Manager Alpha executes physical equipment release -> SUCCEEDS
        const releaseRes = await mgrAlphaClient.query(
          "SELECT public.release_cancelled_workshop_equipment($1, 'Farmer picked up machine from workshop');",
          [atomicTicketId],
        );
        const releaseJson = releaseRes.rows[0].release_cancelled_workshop_equipment;
        assert.equal(releaseJson.success, true);
        assert.equal(releaseJson.handover_status, "RELEASED");

        // Verify physical occupancy is NOW decremented!
        const capAfterRelease = await getCapacity(adminClient, facilityAlphaId);
        assert.equal(
          Number(capAfterRelease.physical_occupancy),
          initialOccupancy - 1,
          "Physical occupancy must decrement only after authorized release_cancelled_workshop_equipment",
        );

        // Verify repair request row has handover_status = RELEASED
        const repRow = await master.query(
          "SELECT handover_status FROM public.repair_requests WHERE id = $1;",
          [atomicTicketId],
        );
        assert.equal(repRow.rows[0].handover_status, "RELEASED");
      },
    );

    // ------------------------------------------------------------------------
    // TEST 12: Phase 13 Handover Gate Preservation
    // ------------------------------------------------------------------------
    await t.test(
      "Phase 13 Handover Gate: release_cancelled_workshop_equipment strictly rejects non-cancelled repairs",
      async () => {
        // ticket2Id is IN_PROGRESS / REQUESTED (checked in, not cancelled)
        let threwNonCancelled = false;
        try {
          await mgrAlphaClient.query(
            "SELECT public.release_cancelled_workshop_equipment($1, 'Attempting early exit');",
            [ticket2Id],
          );
        } catch (err) {
          threwNonCancelled = true;
          assert.match(
            err.message,
            /PRECONDITION_FAILED|Only cancelled repair tickets may use cancelled equipment release/i,
          );
        }
        assert.equal(
          threwNonCancelled,
          true,
          "Non-cancelled repair tickets must follow Phase 13 verified collection/handover protocol",
        );
      },
    );

    // ------------------------------------------------------------------------
    // TEST 13: Facility-Level Data Isolation via Row-Level Security
    // ------------------------------------------------------------------------
    await t.test(
      "Facility-level data isolation: RLS strictly partitions reservations across facilities and farmers",
      async () => {
        // Manager Alpha queries facility_bay_reservations
        const alphaView = await mgrAlphaClient.query(
          "SELECT facility_id FROM public.facility_bay_reservations;",
        );
        // All rows visible to Manager Alpha must belong to Facility Alpha
        for (const row of alphaView.rows) {
          assert.equal(
            row.facility_id,
            facilityAlphaId,
            "Manager of Alpha must ONLY see reservations for Facility Alpha",
          );
        }

        // Farmer 1 queries facility_bay_reservations
        const farmerView = await farmerClient.query(
          "SELECT farmer_profile_id FROM public.facility_bay_reservations;",
        );
        // All rows visible to Farmer 1 must belong to Farmer 1
        for (const row of farmerView.rows) {
          assert.equal(
            row.farmer_profile_id,
            farmerProfileId,
            "Farmer must ONLY see their own reservations under RLS",
          );
        }

        // Receipt Privacy Guard: Farmer 2 querying Farmer 1's checked-in repair request cannot see receipt
        const receiptQuery = await farmer2Client.query(
          "SELECT drop_off_receipt_number FROM public.repair_requests WHERE id = $1;",
          [atomicTicketId],
        );
        assert.equal(
          receiptQuery.rows.length,
          0,
          "Farmer 2 must not be able to retrieve Farmer 1's custody receipt under RLS",
        );
      },
    );

    // ------------------------------------------------------------------------
    // TEST 14: Concurrency Lock & Deduplication on Same Equipment
    // ------------------------------------------------------------------------
    await t.test(
      "Concurrency: Concurrent duplicate drop-off submissions on same equipment serialize and reject conflict",
      async () => {
        // Create dedicated operational equipment for concurrent race test
        const eqRaceRes = await master.query(
          `INSERT INTO public.equipment (id, farmer_id, make, model, type, serial_number, status)
           VALUES (gen_random_uuid(), $1, 'Mahindra', 'Arjun 555', 'Tractor', 'SN-RACE-001', 'Operational')
           RETURNING id;`,
          [farmerProfileId],
        );
        const eqRaceId = eqRaceRes.rows[0].id;

        // Create dedicated facility with capacity 5 for concurrent test
        const facRace = await master.query(
          `INSERT INTO public.repair_facilities (
             id, name, owner_profile_id, phone, address, village, tahsil, latitude, longitude, is_active, drop_off_approved, max_equipment_capacity
           ) VALUES (
             gen_random_uuid(), 'Race Test Facility', $1, '+917122550055', 'Race Road', 'Nagpur', 'Nagpur', 21.1458, 79.0882, true, true, 5
           ) RETURNING id;`,
          [adminProfileId],
        );
        const facRaceId = facRace.rows[0].id;

        // Two distinct concurrent client connections
        const clientA = await getContextClient(farmerAuthId, "authenticated");
        const clientB = await getContextClient(farmerAuthId, "authenticated");

        const submitSql = `
          SELECT public.submit_workshop_dropoff_repair(
            $1, $2, ARRAY['Overheating in field'],
            'Engine overheating during plowing', 'Hingna Farm',
            ARRAY[]::text[], '{}'::jsonb
          ) AS result;
        `;

        // Launch both submissions concurrently with Promise.allSettled
        const [resA, resB] = await Promise.allSettled([
          clientA.query(submitSql, [eqRaceId, facRaceId]),
          clientB.query(submitSql, [eqRaceId, facRaceId]),
        ]);

        await clientA.end();
        await clientB.end();

        // Exactly one submission must succeed, and exactly one must fail
        const fulfilled = [resA, resB].filter((r) => r.status === "fulfilled");
        const rejected = [resA, resB].filter((r) => r.status === "rejected");

        assert.equal(fulfilled.length, 1, "Exactly one concurrent submission must succeed");
        assert.equal(
          rejected.length,
          1,
          "Exactly one concurrent submission must be rejected with conflict",
        );

        // The succeeded submission must return valid repair and reservation
        const successData = fulfilled[0].value.rows[0].result;
        assert.equal(successData.success, true);
        assert.ok(successData.repair_id);
        const createdRepairId = successData.repair_id;

        // The failed submission must throw EQUIPMENT_IN_REPAIR
        const failureError = rejected[0].reason;
        assert.match(
          failureError.message,
          /EQUIPMENT_IN_REPAIR|Equipment is already marked as in repair|Equipment already has an active repair request/i,
          "Conflicting concurrent submission must receive clear EQUIPMENT_IN_REPAIR error",
        );

        // Verify database state: Exactly one active repair request exists for this equipment
        const repCount = await master.query(
          "SELECT COUNT(*)::int AS count FROM public.repair_requests WHERE equipment_id = $1;",
          [eqRaceId],
        );
        assert.equal(
          repCount.rows[0].count,
          1,
          "Exactly one repair request must exist for equipment",
        );

        // Exactly one reservation exists
        const resvCount = await master.query(
          "SELECT COUNT(*)::int AS count FROM public.facility_bay_reservations WHERE repair_request_id = $1;",
          [createdRepairId],
        );
        assert.equal(resvCount.rows[0].count, 1, "Exactly one reservation must exist");

        // Equipment status is consistent ('In Repair')
        const eqStatus = await master.query("SELECT status FROM public.equipment WHERE id = $1;", [
          eqRaceId,
        ]);
        assert.equal(eqStatus.rows[0].status, "In Repair", "Equipment status must be 'In Repair'");
      },
    );

    // ------------------------------------------------------------------------
    // TEST 15: Admin/Service-Centre Ownership Consistency
    // ------------------------------------------------------------------------
    await t.test(
      "Admin Integrity: submit_workshop_dropoff_repair enforces farmer ownership consistency for admin callers",
      async () => {
        // Create separate equipment owned by Farmer 1
        const eqAdminTest = await master.query(
          `INSERT INTO public.equipment (id, farmer_id, make, model, type, serial_number, status)
           VALUES (gen_random_uuid(), $1, 'Kubota', 'MU4501', 'Tractor', 'SN-ADM-001', 'Operational')
           RETURNING id;`,
          [farmerProfileId],
        );
        const eqAdminId = eqAdminTest.rows[0].id;

        // 1. Admin attempts to submit Farmer 1's equipment specifying Farmer 2's profile -> REJECTED (22000 INVALID_ARGUMENT)
        let threwMismatchedAdmin = false;
        try {
          await adminClient.query(
            `SELECT public.submit_workshop_dropoff_repair(
               $1, $2, ARRAY['Hydraulic leak'], 'Admin intake mismatch', 'Nagpur',
               ARRAY[]::text[], '{}'::jsonb, NULL, NULL, NULL,
               $3, FALSE
             );`,
            [eqAdminId, facilityAlphaId, farmer2ProfileId],
          );
        } catch (err) {
          threwMismatchedAdmin = true;
          assert.match(
            err.message,
            /INVALID_ARGUMENT|Equipment owner does not match specified farmer profile/i,
          );
        }
        assert.equal(
          threwMismatchedAdmin,
          true,
          "Admin cannot associate Farmer 1 equipment with Farmer 2 profile ID",
        );

        // 2. Legitimate admin workflow: Admin submits with matching farmer_id (Farmer 1) -> SUCCEEDS
        const adminMatchingRes = await adminClient.query(
          `SELECT public.submit_workshop_dropoff_repair(
             $1, $2, ARRAY['Hydraulic leak'], 'Admin legitimate intake', 'Nagpur',
             ARRAY[]::text[], '{}'::jsonb, NULL, NULL, NULL,
             $3, FALSE
           ) AS data;`,
          [eqAdminId, facilityAlphaId, farmerProfileId],
        );
        const adminData = adminMatchingRes.rows[0].data;
        assert.equal(adminData.success, true);
        assert.ok(adminData.repair_id);

        // Verify repair request in database is correctly bound to Farmer 1
        const repRow = await master.query(
          "SELECT farmer_id, equipment_id FROM public.repair_requests WHERE id = $1;",
          [adminData.repair_id],
        );
        assert.equal(
          repRow.rows[0].farmer_id,
          farmerProfileId,
          "Repair request must be associated with true equipment owner",
        );
        assert.equal(repRow.rows[0].equipment_id, eqAdminId);
      },
    );

    // ------------------------------------------------------------------------
    // TEST 16: Zero Remote Database Invariant
    // ------------------------------------------------------------------------
    await t.test("Zero remote database operation invariant is strictly satisfied", () => {
      assert.ok(
        DB_URL.includes("127.0.0.1:54332") || DB_URL.includes("localhost"),
        "Tests must run strictly against local container",
      );
      assert.ok(
        !DB_URL.includes("ubqgvhcfmrvnmrbllcom"),
        "Staging project reference must not be present in DB_URL",
      );
      assert.ok(
        !DB_URL.includes("hwdrypkvszwrcraujctw"),
        "Production project reference must not be present in DB_URL",
      );
    });
  },
);
