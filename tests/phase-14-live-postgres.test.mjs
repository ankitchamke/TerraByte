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

// Helper to get client with specific JWT context
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
  } else if (role === "authenticated_no_claims") {
    await client.query(`SELECT set_config('request.jwt.claim.sub', '', false);`);
    await client.query(`SELECT set_config('request.jwt.claim.role', '', false);`);
    await client.query(`SET ROLE authenticated;`);
  } else {
    await client.query(`SELECT set_config('request.jwt.claim.sub', '', false);`);
    await client.query(`SELECT set_config('request.jwt.claim.role', '', false);`);
    await client.query(`SET ROLE anon;`);
  }
  return client;
}

// Master client for fixtures setup
let master;
let farmerAuthId, farmerProfileId;
let farmer2AuthId, farmer2ProfileId;
let techAuthId, techProfileId;
let adminAuthId, adminProfileId;
let facilityId;
let equipmentId, equipment2Id;
let jobSeq = 1;

function nextJobNumber() {
  return `JOB-P14-${Date.now()}-${jobSeq++}`;
}

test(
  "Phase 14 Milestone 1: Live PostgreSQL Integration Suite",
  {
    skip:
      !dbAvailable &&
      "Live PostgreSQL integration tests require local test database container on port 54332",
  },
  async (t) => {
    master = new Client({ connectionString: DB_URL });
    await master.connect();
    await master.query("SET search_path = public, auth, extensions;");

    // Acquire database advisory lock for parallel worker test isolation
    await master.query("SELECT pg_advisory_lock(140001);");
    t.after(async () => {
      try {
        await master.query("SELECT pg_advisory_unlock(140001);");
      } catch {}
      try {
        await master.end();
      } catch {}
    });

    // 1. Clean existing test data
    await master.query("TRUNCATE TABLE public.facility_bay_reservations CASCADE;");
    await master.query("TRUNCATE TABLE public.repair_requests CASCADE;");
    await master.query("TRUNCATE TABLE public.facility_memberships CASCADE;");
    await master.query("TRUNCATE TABLE public.repair_facilities CASCADE;");
    await master.query("TRUNCATE TABLE public.equipment CASCADE;");
    await master.query("TRUNCATE TABLE public.profile_auth_secrets CASCADE;");
    await master.query("TRUNCATE TABLE public.profiles CASCADE;");
    await master.query("TRUNCATE TABLE auth.users CASCADE;");
    await master.query("ALTER SEQUENCE public.drop_off_receipt_seq RESTART WITH 1;");

    // 2. Insert personas in auth.users
    const fRes = await master.query(`
    INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'farmer@test.demo') RETURNING id;
  `);
    farmerAuthId = fRes.rows[0].id;

    const f2Res = await master.query(`
    INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'farmer2@test.demo') RETURNING id;
  `);
    farmer2AuthId = f2Res.rows[0].id;

    const tRes = await master.query(`
    INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'tech@test.demo') RETURNING id;
  `);
    techAuthId = tRes.rows[0].id;

    const aRes = await master.query(`
    INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'admin@test.demo') RETURNING id;
  `);
    adminAuthId = aRes.rows[0].id;

    // 3. Insert profiles (profiles.id != auth_user_id to prove independence!)
    const pFarmer = await master.query(
      `
    INSERT INTO public.profiles (id, auth_user_id, role, full_name, phone)
    VALUES (gen_random_uuid(), $1, 'farmer', 'Balasaheb Patil', '+919876543210') RETURNING id;
  `,
      [farmerAuthId],
    );
    farmerProfileId = pFarmer.rows[0].id;

    const pFarmer2 = await master.query(
      `
    INSERT INTO public.profiles (id, auth_user_id, role, full_name, phone)
    VALUES (gen_random_uuid(), $1, 'farmer', 'Tukaram Shinde', '+919876543211') RETURNING id;
  `,
      [farmer2AuthId],
    );
    farmer2ProfileId = pFarmer2.rows[0].id;

    const pTech = await master.query(
      `
    INSERT INTO public.profiles (id, auth_user_id, role, full_name, phone)
    VALUES (gen_random_uuid(), $1, 'technician', 'Ramesh Kumar', '+919876543212') RETURNING id;
  `,
      [techAuthId],
    );
    techProfileId = pTech.rows[0].id;

    const pAdmin = await master.query(
      `
    INSERT INTO public.profiles (id, auth_user_id, role, full_name, phone)
    VALUES (gen_random_uuid(), $1, 'admin', 'Nagpur Service Centre', '+919876543213') RETURNING id;
  `,
      [adminAuthId],
    );
    adminProfileId = pAdmin.rows[0].id;

    // 4. Insert profile_auth_secrets
    await master.query(
      `
    INSERT INTO public.profile_auth_secrets (profile_id, auth_user_id, email)
    VALUES 
      ($1, $2, 'farmer@test.demo'),
      ($3, $4, 'farmer2@test.demo'),
      ($5, $6, 'tech@test.demo'),
      ($7, $8, 'admin@test.demo');
  `,
      [
        farmerProfileId,
        farmerAuthId,
        farmer2ProfileId,
        farmer2AuthId,
        techProfileId,
        techAuthId,
        adminProfileId,
        adminAuthId,
      ],
    );

    // 5. Create a test workshop facility with max_equipment_capacity = 2, drop_off_approved = TRUE
    const facRes = await master.query(
      `
    INSERT INTO public.repair_facilities (
      id, name, owner_profile_id, phone, address, village, tahsil,
      latitude, longitude, max_equipment_capacity, drop_off_approved, is_active
    ) VALUES (
      gen_random_uuid(), 'Nagpur Central Hub', $1, '+919876543213',
      'MIDC Hingna', 'Hingna', 'Nagpur Rural',
      21.0965, 79.0012, 2, TRUE, TRUE
    ) RETURNING id;
  `,
      [adminProfileId],
    );
    facilityId = facRes.rows[0].id;

    // Add tech as TECHNICIAN member (admin is auto-provisioned as OWNER by Phase 13 trigger)
    await master.query(
      `
    INSERT INTO public.facility_memberships (facility_id, technician_profile_id, role, status)
    VALUES ($1, $2, 'TECHNICIAN', 'ACTIVE')
    ON CONFLICT (facility_id, technician_profile_id) DO NOTHING;
  `,
      [facilityId, techProfileId],
    );

    // 6. Create equipment owned by farmer
    const eqRes = await master.query(
      `
    INSERT INTO public.equipment (id, farmer_id, make, model, type, serial_number)
    VALUES (gen_random_uuid(), $1, 'Mahindra', '575 DI', 'Tractor', 'SN-MH-575-001') RETURNING id;
  `,
      [farmerProfileId],
    );
    equipmentId = eqRes.rows[0].id;

    const eq2Res = await master.query(
      `
    INSERT INTO public.equipment (id, farmer_id, make, model, type, serial_number)
    VALUES (gen_random_uuid(), $1, 'John Deere', '5050D', 'Tractor', 'SN-JD-5050-002') RETURNING id;
  `,
      [farmerProfileId],
    );
    equipment2Id = eq2Res.rows[0].id;

    // ============================================================================
    // SUBTESTS
    // ============================================================================

    await t.test(
      "Auth: current_profile_id() correctly maps auth.uid() to distinct profile_id",
      async () => {
        const client = await getContextClient(farmerAuthId);
        const res = await client.query("SELECT public.current_profile_id() AS pid;");
        assert.equal(res.rows[0].pid, farmerProfileId, "Must return correct farmer profile ID");
        assert.notEqual(res.rows[0].pid, farmerAuthId, "Must not assume profiles.id == auth.uid()");
        await client.end();
      },
    );

    await t.test(
      "Auth: current_user_role() correctly resolves role for authenticated session",
      async () => {
        const client = await getContextClient(techAuthId);
        const res = await client.query("SELECT public.current_user_role() AS role;");
        assert.equal(res.rows[0].role, "technician", "Must return correct technician role");
        await client.end();
      },
    );

    await t.test(
      "Auth: Unauthenticated anon caller is rejected with 42501 permission denied",
      async () => {
        const client = await getContextClient(null, "anon");
        await assert.rejects(
          async () => {
            await client.query("SELECT public.current_profile_id() AS pid;");
          },
          /permission denied/,
          "Anon must not have execute permission on current_profile_id",
        );
        await client.end();
      },
    );

    await t.test(
      "Auth: Authenticated session without JWT sub returns NULL for identity helpers",
      async () => {
        const client = await getContextClient(null, "authenticated_no_claims");
        const res = await client.query(
          "SELECT public.current_profile_id() AS pid, public.current_user_role() AS role;",
        );
        assert.equal(res.rows[0].pid, null, "pid must be null");
        assert.equal(res.rows[0].role, null, "role must be null");
        await client.end();
      },
    );

    await t.test(
      "Capacity: get_facility_capacity_breakdown returns initial zero occupancy on 2 bays",
      async () => {
        const client = await getContextClient(farmerAuthId);
        const res = await client.query(
          "SELECT public.get_facility_capacity_breakdown($1) AS data;",
          [facilityId],
        );
        const cap = res.rows[0].data;
        assert.equal(cap.max_equipment_capacity, 2);
        assert.equal(cap.physical_occupancy, 0);
        assert.equal(cap.active_reservations, 0);
        assert.equal(cap.total_committed_capacity, 0);
        assert.equal(cap.available_capacity, 2);
        assert.equal(cap.is_at_capacity, false);
        await client.end();
      },
    );

    let repairId1, reservationId1;

    await t.test(
      "Reservation: reserve_workshop_bay allocates bay and updates committed capacity",
      async () => {
        const rRes = await master.query(
          `
      INSERT INTO public.repair_requests (
        id, job_number, farmer_id, equipment_id, location, delivery_mode, is_immobile, status, facility_id
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, 'Nagpur Farm', 'WORKSHOP_DROPOFF', FALSE, 'REQUESTED', $4
      ) RETURNING id;
    `,
          [nextJobNumber(), farmerProfileId, equipmentId, facilityId],
        );
        repairId1 = rRes.rows[0].id;

        const client = await getContextClient(farmerAuthId);
        const res = await client.query("SELECT public.reserve_workshop_bay($1, $2) AS data;", [
          repairId1,
          facilityId,
        ]);
        const data = res.rows[0].data;
        assert.equal(data.success, true);
        assert.ok(data.reservation_id, "Must return reservation_id");
        reservationId1 = data.reservation_id;

        const capRes = await client.query(
          "SELECT public.get_facility_capacity_breakdown($1) AS data;",
          [facilityId],
        );
        const cap = capRes.rows[0].data;
        assert.equal(cap.active_reservations, 1);
        assert.equal(cap.total_committed_capacity, 1);
        assert.equal(cap.available_capacity, 1);
        assert.equal(cap.is_at_capacity, false);
        await client.end();
      },
    );

    await t.test(
      "Invariant: Immobile equipment is strictly prohibited from selecting drop-off",
      async () => {
        const rRes = await master.query(
          `
      INSERT INTO public.repair_requests (
        id, job_number, farmer_id, equipment_id, location, delivery_mode, is_immobile, status
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, 'Nagpur Field', 'DOORSTEP', TRUE, 'REQUESTED'
      ) RETURNING id;
    `,
          [nextJobNumber(), farmerProfileId, equipment2Id],
        );
        const immobileRepairId = rRes.rows[0].id;

        const client = await getContextClient(farmerAuthId);
        await assert.rejects(
          async () => {
            await client.query("SELECT public.reserve_workshop_bay($1, $2);", [
              immobileRepairId,
              facilityId,
            ]);
          },
          /IMMOBILE_MACHINERY/,
          "Must reject dropoff reservation for immobile equipment",
        );
        await client.end();
      },
    );

    let repairId2, reservationId2;

    await t.test("Reservation: Second reservation consumes last available bay", async () => {
      const rRes = await master.query(
        `
      INSERT INTO public.repair_requests (
        id, job_number, farmer_id, equipment_id, location, delivery_mode, is_immobile, status, facility_id
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, 'Wardha Farm', 'WORKSHOP_DROPOFF', FALSE, 'REQUESTED', $4
      ) RETURNING id;
    `,
        [nextJobNumber(), farmer2ProfileId, equipment2Id, facilityId],
      );
      repairId2 = rRes.rows[0].id;

      const client = await getContextClient(farmer2AuthId);
      const res = await client.query("SELECT public.reserve_workshop_bay($1, $2) AS data;", [
        repairId2,
        facilityId,
      ]);
      assert.equal(res.rows[0].data.success, true);
      reservationId2 = res.rows[0].data.reservation_id;

      const capRes = await client.query(
        "SELECT public.get_facility_capacity_breakdown($1) AS data;",
        [facilityId],
      );
      const cap = capRes.rows[0].data;
      assert.equal(cap.active_reservations, 2);
      assert.equal(cap.total_committed_capacity, 2);
      assert.equal(cap.available_capacity, 0);
      assert.equal(cap.is_at_capacity, true);
      await client.end();
    });

    await t.test("Reservation: Third reservation rejected with CAPACITY_EXHAUSTED", async () => {
      const rRes = await master.query(
        `
      INSERT INTO public.repair_requests (
        id, job_number, farmer_id, equipment_id, location, delivery_mode, is_immobile, status, facility_id
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, 'Katol Farm', 'WORKSHOP_DROPOFF', FALSE, 'REQUESTED', $4
      ) RETURNING id;
    `,
        [nextJobNumber(), farmerProfileId, equipmentId, facilityId],
      );
      const repairId3 = rRes.rows[0].id;

      const client = await getContextClient(farmerAuthId);
      const res = await client.query("SELECT public.reserve_workshop_bay($1, $2) AS data;", [
        repairId3,
        facilityId,
      ]);
      assert.equal(res.rows[0].data.success, false);
      assert.equal(res.rows[0].data.code, "CAPACITY_EXHAUSTED");
      assert.equal(res.rows[0].data.reroute_eligible, true);
      await client.end();
    });

    await t.test("Renewal: Farmer self-renewal increments renewal_count to 1", async () => {
      const client = await getContextClient(farmerAuthId);
      const res = await client.query(
        "SELECT public.renew_workshop_bay_reservation($1, INTERVAL '12 hours') AS data;",
        [reservationId1],
      );
      assert.equal(res.rows[0].data.success, true);
      assert.equal(res.rows[0].data.renewal_count, 1);

      await assert.rejects(
        async () => {
          await client.query(
            "SELECT public.renew_workshop_bay_reservation($1, INTERVAL '12 hours');",
            [reservationId1],
          );
        },
        /RENEWAL_LIMIT_EXCEEDED/,
        "Farmer self-renewal cap must reject second extension",
      );
      await client.end();
    });

    await t.test(
      "Renewal: Service Centre Admin override with mandatory audit notes succeeds",
      async () => {
        const client = await getContextClient(adminAuthId);
        await assert.rejects(
          async () => {
            await client.query(
              "SELECT public.renew_workshop_bay_reservation($1, INTERVAL '24 hours', NULL);",
              [reservationId1],
            );
          },
          /AUDIT_NOTES_REQUIRED/,
          "Admin renewal without notes must fail",
        );

        const res = await client.query(
          "SELECT public.renew_workshop_bay_reservation($1, INTERVAL '24 hours', 'Approved due to severe highway road block') AS data;",
          [reservationId1],
        );
        assert.equal(res.rows[0].data.success, true);
        assert.equal(res.rows[0].data.renewal_count, 2);
        await client.end();
      },
    );

    await t.test(
      "Release: release_workshop_bay_reservation transitions status to RELEASED and frees bay",
      async () => {
        const client = await getContextClient(farmerAuthId);
        const res = await client.query(
          "SELECT public.release_workshop_bay_reservation($1, 'Found local tyre replacement') AS data;",
          [repairId1],
        );
        assert.equal(res.rows[0].data.success, true);
        assert.equal(res.rows[0].data.status, "RELEASED");

        const capRes = await client.query(
          "SELECT public.get_facility_capacity_breakdown($1) AS data;",
          [facilityId],
        );
        assert.equal(capRes.rows[0].data.total_committed_capacity, 1);
        assert.equal(capRes.rows[0].data.available_capacity, 1);
        await client.end();
      },
    );

    await t.test(
      "Check-In: Path A (Active Reservation) claims reservation and generates formatted receipt",
      async () => {
        const client = await getContextClient(adminAuthId);
        const res = await client.query(
          "SELECT public.execute_workshop_dropoff_checkin($1, 'Tractor unloaded at Bay 1') AS data;",
          [repairId2],
        );
        const data = res.rows[0].data;
        assert.equal(data.success, true);
        assert.equal(data.path, "ACTIVE");
        assert.match(
          data.receipt_number,
          /^RCP-TB-\d{8}-\d{4}$/,
          "Receipt must match RCP-TB-YYYYMMDD-XXXX",
        );

        const rCheck = await master.query(
          "SELECT dropped_off_at, drop_off_receipt_number FROM public.repair_requests WHERE id = $1;",
          [repairId2],
        );
        assert.ok(rCheck.rows[0].dropped_off_at);
        assert.equal(rCheck.rows[0].drop_off_receipt_number, data.receipt_number);

        const resCheck = await master.query(
          "SELECT status, claimed_at FROM public.facility_bay_reservations WHERE id = $1;",
          [reservationId2],
        );
        assert.equal(resCheck.rows[0].status, "CLAIMED");
        assert.ok(resCheck.rows[0].claimed_at);
        await client.end();
      },
    );

    await t.test(
      "Idempotency: Repeated check-in on already checked-in repair returns already_checked_in = true",
      async () => {
        const client = await getContextClient(adminAuthId);
        const res = await client.query(
          "SELECT public.execute_workshop_dropoff_checkin($1, 'Second check-in attempt') AS data;",
          [repairId2],
        );
        const data = res.rows[0].data;
        assert.equal(data.success, true);
        assert.equal(data.already_checked_in, true);
        assert.match(data.receipt_number, /^RCP-TB-\d{8}-\d{4}$/);
        await client.end();
      },
    );

    let standbyRepairId;

    await t.test(
      "Check-In: Path B (Standby Arrival) succeeds when uncommitted capacity exists",
      async () => {
        const rRes = await master.query(
          `
      INSERT INTO public.repair_requests (
        id, job_number, farmer_id, equipment_id, location, delivery_mode, is_immobile, status, facility_id
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, 'Umred Farm', 'WORKSHOP_DROPOFF', FALSE, 'REQUESTED', $4
      ) RETURNING id;
    `,
          [nextJobNumber(), farmerProfileId, equipmentId, facilityId],
        );
        standbyRepairId = rRes.rows[0].id;

        const client = await getContextClient(adminAuthId);
        const res = await client.query(
          "SELECT public.execute_workshop_dropoff_checkin($1, 'Unscheduled standby tractor arrived') AS data;",
          [standbyRepairId],
        );
        const data = res.rows[0].data;
        assert.equal(data.success, true);
        assert.equal(data.path, "STANDBY");
        assert.match(data.receipt_number, /^RCP-TB-\d{8}-\d{4}$/);
        await client.end();
      },
    );

    await t.test(
      "Check-In: Path B (Standby Arrival) REJECTED when capacity is full to protect bays",
      async () => {
        const rRes = await master.query(
          `
      INSERT INTO public.repair_requests (
        id, job_number, farmer_id, equipment_id, location, delivery_mode, is_immobile, status, facility_id
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, 'Bhandara Farm', 'WORKSHOP_DROPOFF', FALSE, 'REQUESTED', $4
      ) RETURNING id;
    `,
          [nextJobNumber(), farmerProfileId, equipmentId, facilityId],
        );
        const walkinRepairId = rRes.rows[0].id;

        const client = await getContextClient(adminAuthId);
        const rejRes = await client.query(
          "SELECT public.execute_workshop_dropoff_checkin($1) AS data;",
          [walkinRepairId],
        );
        assert.equal(rejRes.rows[0].data.success, false);
        assert.equal(rejRes.rows[0].data.code, "CAPACITY_EXHAUSTED");
        assert.equal(rejRes.rows[0].data.reroute_eligible, true);
        await client.end();
      },
    );

    await t.test(
      "Cancellation: Cancelled workshop equipment physically occupies bay until explicit release",
      async () => {
        await master.query(
          "UPDATE public.repair_requests SET status = 'CANCELLED' WHERE id = $1;",
          [repairId2],
        );

        const capBefore = await master.query(
          "SELECT public.get_facility_capacity_breakdown($1) AS data;",
          [facilityId],
        );
        assert.equal(
          capBefore.rows[0].data.physical_occupancy,
          2,
          "Cancelled machine still holds bay",
        );

        const client = await getContextClient(adminAuthId);
        const relRes = await client.query(
          "SELECT public.release_cancelled_workshop_equipment($1, 'Farmer retrieved cancelled tractor') AS data;",
          [repairId2],
        );
        assert.equal(relRes.rows[0].data.success, true);
        assert.equal(relRes.rows[0].data.handover_status, "RELEASED");

        const capAfter = await master.query(
          "SELECT public.get_facility_capacity_breakdown($1) AS data;",
          [facilityId],
        );
        assert.equal(
          capAfter.rows[0].data.physical_occupancy,
          1,
          "Physical occupancy freed after release",
        );
        await client.end();
      },
    );

    await t.test("Security: Unauthorized caller cannot execute check-in", async () => {
      const client = await getContextClient(farmerAuthId);
      await assert.rejects(
        async () => {
          await client.query("SELECT public.execute_workshop_dropoff_checkin($1);", [repairId1]);
        },
        /UNAUTHORIZED/,
        "Farmer cannot execute physical check-in",
      );
      await client.end();
    });

    await t.test(
      "Concurrency: Parallel reservation race serializes via facility lock without overcommitment",
      async () => {
        const fac1Res = await master.query(
          `
      INSERT INTO public.repair_facilities (
        id, name, owner_profile_id, phone, address, village, tahsil,
        latitude, longitude, max_equipment_capacity, drop_off_approved, is_active
      ) VALUES (
        gen_random_uuid(), 'Wardha Express Bay', $1, '+919876543213',
        'Civil Lines', 'Wardha', 'Wardha',
        20.7453, 78.6022, 1, TRUE, TRUE
      ) RETURNING id;
    `,
          [adminProfileId],
        );
        const fac1BayId = fac1Res.rows[0].id;

        const rA = await master.query(
          `
      INSERT INTO public.repair_requests (
        id, job_number, farmer_id, equipment_id, location, delivery_mode, is_immobile, status, facility_id
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, 'Wardha Farm A', 'WORKSHOP_DROPOFF', FALSE, 'REQUESTED', $4
      ) RETURNING id;
    `,
          [nextJobNumber(), farmerProfileId, equipmentId, fac1BayId],
        );
        const repairA = rA.rows[0].id;

        const rB = await master.query(
          `
      INSERT INTO public.repair_requests (
        id, job_number, farmer_id, equipment_id, location, delivery_mode, is_immobile, status, facility_id
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, 'Wardha Farm B', 'WORKSHOP_DROPOFF', FALSE, 'REQUESTED', $4
      ) RETURNING id;
    `,
          [nextJobNumber(), farmer2ProfileId, equipment2Id, fac1BayId],
        );
        const repairB = rB.rows[0].id;

        const clientA = await getContextClient(farmerAuthId);
        const clientB = await getContextClient(farmer2AuthId);

        const [resA, resB] = await Promise.all([
          clientA.query("SELECT public.reserve_workshop_bay($1, $2) AS data;", [
            repairA,
            fac1BayId,
          ]),
          clientB.query("SELECT public.reserve_workshop_bay($1, $2) AS data;", [
            repairB,
            fac1BayId,
          ]),
        ]);

        const outcomes = [resA.rows[0].data, resB.rows[0].data];
        const successCount = outcomes.filter((o) => o.success === true).length;
        const rejectedCount = outcomes.filter(
          (o) => o.success === false && o.code === "CAPACITY_EXHAUSTED",
        ).length;

        assert.equal(
          successCount,
          1,
          "Exactly one concurrent reservation must succeed on a 1-bay facility",
        );
        assert.equal(
          rejectedCount,
          1,
          "Exactly one concurrent reservation must be rejected with CAPACITY_EXHAUSTED",
        );

        const countRes = await master.query(
          "SELECT COUNT(*)::int AS cnt FROM public.facility_bay_reservations WHERE facility_id = $1 AND status = 'RESERVED';",
          [fac1BayId],
        );
        assert.equal(countRes.rows[0].cnt, 1, "Facility must have exactly 1 reservation in DB");

        await clientA.end();
        await clientB.end();
      },
    );

    await t.test(
      "FIFO: Earlier reservation holder priority holds remaining bay against later arrival",
      async () => {
        const facFifoRes = await master.query(
          `
      INSERT INTO public.repair_facilities (
        id, name, owner_profile_id, phone, address, village, tahsil,
        latitude, longitude, max_equipment_capacity, drop_off_approved, is_active
      ) VALUES (
        gen_random_uuid(), 'Amravati FIFO Facility', $1, '+919876543213',
        'MIDC', 'Amravati', 'Amravati',
        20.9320, 77.7523, 2, TRUE, TRUE
      ) RETURNING id;
    `,
          [adminProfileId],
        );
        const fifoFacId = facFifoRes.rows[0].id;

        await master.query(
          `
      INSERT INTO public.repair_requests (
        id, job_number, farmer_id, equipment_id, location, delivery_mode, is_immobile, status,
        facility_id, dropped_off_at, drop_off_receipt_number, handover_status
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, 'Occupied Machine', 'WORKSHOP_DROPOFF', FALSE, 'ACCEPTED',
        $4, NOW(), 'RCP-TB-OCCUPIED-0099', 'PENDING'
      ) RETURNING id;
    `,
          [nextJobNumber(), farmerProfileId, equipmentId, fifoFacId],
        );

        const rF1Res = await master.query(
          `
      INSERT INTO public.repair_requests (
        id, job_number, farmer_id, equipment_id, location, delivery_mode, is_immobile, status, facility_id
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, 'Farmer 1 Repair', 'WORKSHOP_DROPOFF', FALSE, 'REQUESTED', $4
      ) RETURNING id;
    `,
          [nextJobNumber(), farmerProfileId, equipmentId, fifoFacId],
        );
        const repairF1 = rF1Res.rows[0].id;

        await master.query(
          `
      INSERT INTO public.facility_bay_reservations (
        facility_id, repair_request_id, farmer_profile_id, status,
        reserved_at, expires_at, priority_original_reserved_at
      ) VALUES (
        $1, $2, $3, 'RESERVED',
        NOW() - INTERVAL '1 hour', NOW() + INTERVAL '23 hours', NOW() - INTERVAL '1 hour'
      );
    `,
          [fifoFacId, repairF1, farmerProfileId],
        );

        const rF2Res = await master.query(
          `
      INSERT INTO public.repair_requests (
        id, job_number, farmer_id, equipment_id, location, delivery_mode, is_immobile, status, facility_id
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, 'Farmer 2 Repair', 'WORKSHOP_DROPOFF', FALSE, 'REQUESTED', $4
      ) RETURNING id;
    `,
          [nextJobNumber(), farmer2ProfileId, equipment2Id, fifoFacId],
        );
        const repairF2 = rF2Res.rows[0].id;

        await master.query(
          `
      INSERT INTO public.facility_bay_reservations (
        facility_id, repair_request_id, farmer_profile_id, status,
        reserved_at, expires_at, priority_original_reserved_at
      ) VALUES (
        $1, $2, $3, 'RESERVED',
        NOW() - INTERVAL '5 minutes', NOW() + INTERVAL '23 hours 55 minutes', NOW() - INTERVAL '5 minutes'
      );
    `,
          [fifoFacId, repairF2, farmer2ProfileId],
        );

        const clientAdmin = await getContextClient(adminAuthId);
        const f2CheckinRes = await clientAdmin.query(
          "SELECT public.execute_workshop_dropoff_checkin($1, 'Farmer 2 arrived ahead of earlier holder') AS data;",
          [repairF2],
        );
        const f2Data = f2CheckinRes.rows[0].data;
        assert.equal(
          f2Data.success,
          false,
          "Must defer later reservation arrival when earlier reservation exists",
        );
        assert.equal(f2Data.code, "FIFO_PRIORITY_HELD", "Must return FIFO_PRIORITY_HELD code");
        assert.equal(
          f2Data.earlier_reservations_ahead,
          1,
          "Must indicate 1 earlier reservation ahead",
        );
        assert.equal(f2Data.reroute_eligible, true, "Must flag reroute eligibility");

        const f1CheckinRes = await clientAdmin.query(
          "SELECT public.execute_workshop_dropoff_checkin($1, 'Farmer 1 arrived on time') AS data;",
          [repairF1],
        );
        const f1Data = f1CheckinRes.rows[0].data;
        assert.equal(f1Data.success, true, "Earlier reservation check-in must succeed");
        assert.equal(f1Data.path, "ACTIVE");
        assert.match(f1Data.receipt_number, /^RCP-TB-\d{8}-\d{4}$/);

        await clientAdmin.end();
      },
    );

    await t.test(
      "Downsizing: Active reservation deferred with DOWNSIZED_CAPACITY_HELD when workshop full due to capacity cut",
      async () => {
        // 1-bay facility
        const dsFacRes = await master.query(
          `
      INSERT INTO public.repair_facilities (
        id, name, owner_profile_id, phone, address, village, tahsil,
        latitude, longitude, max_equipment_capacity, drop_off_approved, is_active
      ) VALUES (
        gen_random_uuid(), 'Downsized Katol Hub', $1, '+919876543213',
        'MIDC', 'Katol', 'Katol',
        21.2720, 78.5823, 1, TRUE, TRUE
      ) RETURNING id;
    `,
          [adminProfileId],
        );
        const dsFacId = dsFacRes.rows[0].id;

        // Create active reservation for Farmer 1
        const rRes = await master.query(
          `
      INSERT INTO public.repair_requests (
        id, job_number, farmer_id, equipment_id, location, delivery_mode, is_immobile, status, facility_id
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, 'Katol Farm', 'WORKSHOP_DROPOFF', FALSE, 'REQUESTED', $4
      ) RETURNING id;
    `,
          [nextJobNumber(), farmerProfileId, equipmentId, dsFacId],
        );
        const dsRepairId = rRes.rows[0].id;

        await master.query(
          `
      INSERT INTO public.facility_bay_reservations (
        facility_id, repair_request_id, farmer_profile_id, status,
        reserved_at, expires_at, priority_original_reserved_at
      ) VALUES (
        $1, $2, $3, 'RESERVED',
        NOW(), NOW() + INTERVAL '24 hours', NOW()
      );
    `,
          [dsFacId, dsRepairId, farmerProfileId],
        );

        // Physically occupy the only 1 bay with an ongoing repair (P = 1 >= M = 1)
        await master.query(
          `
      INSERT INTO public.repair_requests (
        id, job_number, farmer_id, equipment_id, location, delivery_mode, is_immobile, status,
        facility_id, dropped_off_at, drop_off_receipt_number, handover_status
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, 'Occupying Machine', 'WORKSHOP_DROPOFF', FALSE, 'ACCEPTED',
        $4, NOW(), 'RCP-TB-OCCUPIED-0101', 'PENDING'
      );
    `,
          [nextJobNumber(), farmer2ProfileId, equipment2Id, dsFacId],
        );

        // Farmer 1 arrives with active reservation, but workshop has zero physical bays open
        const clientAdmin = await getContextClient(adminAuthId);
        const checkinRes = await clientAdmin.query(
          "SELECT public.execute_workshop_dropoff_checkin($1, 'Arrived during downsized full capacity') AS data;",
          [dsRepairId],
        );
        const data = checkinRes.rows[0].data;
        assert.equal(data.success, false);
        assert.equal(data.code, "DOWNSIZED_CAPACITY_HELD");
        assert.equal(data.reroute_eligible, true);
        await clientAdmin.end();
      },
    );

    if (master) {
      try {
        await master.end();
      } catch {}
    }
  },
);
