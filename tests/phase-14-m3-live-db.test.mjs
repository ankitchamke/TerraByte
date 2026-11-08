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

// Helper to get client with specific JWT context simulating authenticated farmer / anon
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

let master;
let farmerAuthId, farmerProfileId;
let farmer2AuthId, farmer2ProfileId;
let adminAuthId, adminProfileId;
let equipmentId, equipment2Id;
let approvedActiveFacId;
let inactiveFacId;
let unapprovedFacId;
let jobSeq = 1;

function nextJobNumber() {
  return `JOB-M3-ATTACK-${Date.now()}-${jobSeq++}`;
}

test(
  "Phase 14 Milestone 3: Live Database Attack & Integrity Verification Suite",
  { skip: !dbAvailable && "Requires local PostgreSQL test container on port 54332" },
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

    // Clean test tables
    await master.query("TRUNCATE TABLE public.facility_bay_reservations CASCADE;");
    await master.query("TRUNCATE TABLE public.repair_requests CASCADE;");
    await master.query("TRUNCATE TABLE public.facility_memberships CASCADE;");
    await master.query("TRUNCATE TABLE public.repair_facilities CASCADE;");
    await master.query("TRUNCATE TABLE public.equipment CASCADE;");
    await master.query("TRUNCATE TABLE public.profile_auth_secrets CASCADE;");
    await master.query("TRUNCATE TABLE public.profiles CASCADE;");
    await master.query("TRUNCATE TABLE auth.users CASCADE;");

    // Create auth users
    const f1User = await master.query(
      "INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'farmer1@m3test.demo') RETURNING id;",
    );
    farmerAuthId = f1User.rows[0].id;

    const f2User = await master.query(
      "INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'farmer2@m3test.demo') RETURNING id;",
    );
    farmer2AuthId = f2User.rows[0].id;

    const admUser = await master.query(
      "INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'admin@m3test.demo') RETURNING id;",
    );
    adminAuthId = admUser.rows[0].id;

    // Create profiles with decoupled IDs (profiles.id != auth_user_id)
    const p1 = await master.query(
      "INSERT INTO public.profiles (id, auth_user_id, role, full_name, phone) VALUES (gen_random_uuid(), $1, 'farmer', 'Farmer One', '+919811111111') RETURNING id;",
      [farmerAuthId],
    );
    farmerProfileId = p1.rows[0].id;

    const p2 = await master.query(
      "INSERT INTO public.profiles (id, auth_user_id, role, full_name, phone) VALUES (gen_random_uuid(), $1, 'farmer', 'Farmer Two', '+919822222222') RETURNING id;",
      [farmer2AuthId],
    );
    farmer2ProfileId = p2.rows[0].id;

    const pAdm = await master.query(
      "INSERT INTO public.profiles (id, auth_user_id, role, full_name, phone) VALUES (gen_random_uuid(), $1, 'admin', 'Service Admin', '+919899999999') RETURNING id;",
      [adminAuthId],
    );
    adminProfileId = pAdm.rows[0].id;

    // Create equipment
    const eq1 = await master.query(
      "INSERT INTO public.equipment (id, farmer_id, make, model, type, serial_number) VALUES (gen_random_uuid(), $1, 'Mahindra', '575 DI', 'Tractor', 'SN-M3-001') RETURNING id;",
      [farmerProfileId],
    );
    equipmentId = eq1.rows[0].id;

    const eq2 = await master.query(
      "INSERT INTO public.equipment (id, farmer_id, make, model, type, serial_number) VALUES (gen_random_uuid(), $1, 'Sonalika', 'DI 745', 'Tractor', 'SN-M3-002') RETURNING id;",
      [farmer2ProfileId],
    );
    equipment2Id = eq2.rows[0].id;

    // Create facility variations for testing
    // 1. Approved & Active Facility
    const fac1 = await master.query(
      `
    INSERT INTO public.repair_facilities (
      id, name, owner_profile_id, phone, address, village, tahsil, latitude, longitude,
      max_equipment_capacity, drop_off_approved, is_active
    ) VALUES (
      gen_random_uuid(), 'Vidarbha Agro Central (Approved & Active)', $1, '+917122550001',
      'Plot 1, MIDC Hingna', 'Hingna', 'Hingna', 21.0965, 79.0012, 4, TRUE, TRUE
    ) RETURNING id;
  `,
      [adminProfileId],
    );
    approvedActiveFacId = fac1.rows[0].id;

    // 2. Inactive Facility (drop_off_approved = TRUE, is_active = FALSE)
    const fac2 = await master.query(
      `
    INSERT INTO public.repair_facilities (
      id, name, owner_profile_id, phone, address, village, tahsil, latitude, longitude,
      max_equipment_capacity, drop_off_approved, is_active
    ) VALUES (
      gen_random_uuid(), 'Old Depot (Inactive)', $1, '+917122550002',
      'Plot 2, MIDC Hingna', 'Hingna', 'Hingna', 21.0965, 79.0012, 2, TRUE, FALSE
    ) RETURNING id;
  `,
      [adminProfileId],
    );
    inactiveFacId = fac2.rows[0].id;

    // 3. Unapproved Facility (drop_off_approved = FALSE, is_active = TRUE)
    const fac3 = await master.query(
      `
    INSERT INTO public.repair_facilities (
      id, name, owner_profile_id, phone, address, village, tahsil, latitude, longitude,
      max_equipment_capacity, drop_off_approved, is_active
    ) VALUES (
      gen_random_uuid(), 'Private Shed (Unapproved)', $1, '+917122550003',
      'Plot 3, MIDC Hingna', 'Hingna', 'Hingna', 21.0965, 79.0012, 2, FALSE, TRUE
    ) RETURNING id;
  `,
      [adminProfileId],
    );
    unapprovedFacId = fac3.rows[0].id;

    // ============================================================================
    // DIRECT INSERT ATTACK SCENARIOS (Testing DB Constraints & Trigger)
    // ============================================================================

    await t.test(
      "Attack 1 [INSERT]: Immobile + Workshop Drop-Off is rejected and zero rows persisted",
      async () => {
        const jn = nextJobNumber();
        const client = await getContextClient(farmerAuthId);

        await assert.rejects(
          async () => {
            await client.query(
              `
          INSERT INTO public.repair_requests (
            job_number, equipment_id, farmer_id, delivery_mode, is_immobile, facility_id, location
          ) VALUES (
            $1, $2, $3, 'WORKSHOP_DROPOFF', TRUE, $4, 'Nagpur Farm'
          );
        `,
              [jn, equipmentId, farmerProfileId, approvedActiveFacId],
            );
          },
          (err) => {
            assert.equal(err.code, "23514", "Must raise 23514 check_violation");
            assert.match(
              err.message,
              /check_immobile_delivery_mode|Immobile machinery cannot be transported/i,
            );
            return true;
          },
          "Database must reject is_immobile = true with WORKSHOP_DROPOFF",
        );

        // Verify ZERO rows persisted
        const check = await master.query(
          "SELECT COUNT(*) AS count FROM public.repair_requests WHERE job_number = $1;",
          [jn],
        );
        assert.equal(
          Number(check.rows[0].count),
          0,
          "No repair-request row must be persisted on attack rejection",
        );
        await client.end();
      },
    );

    await t.test(
      "Attack 2 [INSERT]: Doorstep + non-null facility_id is rejected and zero rows persisted",
      async () => {
        const jn = nextJobNumber();
        const client = await getContextClient(farmerAuthId);

        await assert.rejects(
          async () => {
            await client.query(
              `
          INSERT INTO public.repair_requests (
            job_number, equipment_id, farmer_id, delivery_mode, is_immobile, facility_id, location
          ) VALUES (
            $1, $2, $3, 'DOORSTEP', FALSE, $4, 'Nagpur Farm'
          );
        `,
              [jn, equipmentId, farmerProfileId, approvedActiveFacId],
            );
          },
          (err) => {
            assert.equal(err.code, "23514", "Must raise 23514 check_violation");
            assert.match(
              err.message,
              /check_delivery_mode_facility_consistency|Facility reference cannot be provided/i,
            );
            return true;
          },
          "Database must reject DOORSTEP carrying a facility reference",
        );

        const check = await master.query(
          "SELECT COUNT(*) AS count FROM public.repair_requests WHERE job_number = $1;",
          [jn],
        );
        assert.equal(
          Number(check.rows[0].count),
          0,
          "No repair-request row must be persisted on attack rejection",
        );
        await client.end();
      },
    );

    await t.test(
      "Attack 3 [INSERT]: Workshop Drop-Off + null facility_id is rejected and zero rows persisted",
      async () => {
        const jn = nextJobNumber();
        const client = await getContextClient(farmerAuthId);

        await assert.rejects(
          async () => {
            await client.query(
              `
          INSERT INTO public.repair_requests (
            job_number, equipment_id, farmer_id, delivery_mode, is_immobile, facility_id, location
          ) VALUES (
            $1, $2, $3, 'WORKSHOP_DROPOFF', FALSE, NULL, 'Nagpur Farm'
          );
        `,
              [jn, equipmentId, farmerProfileId],
            );
          },
          (err) => {
            assert.ok(
              err.code === "23514" || err.code === "23502",
              `Expected 23514 check_violation or 23502 not_null, got ${err.code}`,
            );
            return true;
          },
          "Database must reject WORKSHOP_DROPOFF without facility reference",
        );

        const check = await master.query(
          "SELECT COUNT(*) AS count FROM public.repair_requests WHERE job_number = $1;",
          [jn],
        );
        assert.equal(
          Number(check.rows[0].count),
          0,
          "No repair-request row must be persisted on attack rejection",
        );
        await client.end();
      },
    );

    await t.test(
      "Attack 4 [INSERT]: Workshop Drop-Off + inactive facility is rejected and zero rows persisted",
      async () => {
        const jn = nextJobNumber();
        const client = await getContextClient(farmerAuthId);

        await assert.rejects(
          async () => {
            await client.query(
              `
          INSERT INTO public.repair_requests (
            job_number, equipment_id, farmer_id, delivery_mode, is_immobile, facility_id, location
          ) VALUES (
            $1, $2, $3, 'WORKSHOP_DROPOFF', FALSE, $4, 'Nagpur Farm'
          );
        `,
              [jn, equipmentId, farmerProfileId, inactiveFacId],
            );
          },
          (err) => {
            assert.equal(err.code, "P0001", "Must raise P0001 raise_exception");
            assert.match(err.message, /inactive/i, "Must identify facility as inactive");
            return true;
          },
          "Database must reject WORKSHOP_DROPOFF with inactive facility",
        );

        const check = await master.query(
          "SELECT COUNT(*) AS count FROM public.repair_requests WHERE job_number = $1;",
          [jn],
        );
        assert.equal(
          Number(check.rows[0].count),
          0,
          "No repair-request row must be persisted on attack rejection",
        );
        await client.end();
      },
    );

    await t.test(
      "Attack 5 [INSERT]: Workshop Drop-Off + unapproved facility is rejected and zero rows persisted",
      async () => {
        const jn = nextJobNumber();
        const client = await getContextClient(farmerAuthId);

        await assert.rejects(
          async () => {
            await client.query(
              `
          INSERT INTO public.repair_requests (
            job_number, equipment_id, farmer_id, delivery_mode, is_immobile, facility_id, location
          ) VALUES (
            $1, $2, $3, 'WORKSHOP_DROPOFF', FALSE, $4, 'Nagpur Farm'
          );
        `,
              [jn, equipmentId, farmerProfileId, unapprovedFacId],
            );
          },
          (err) => {
            assert.equal(err.code, "P0001", "Must raise P0001 raise_exception");
            assert.match(
              err.message,
              /not approved for drop-off/i,
              "Must identify facility as not drop_off_approved",
            );
            return true;
          },
          "Database must reject WORKSHOP_DROPOFF with unapproved facility",
        );

        const check = await master.query(
          "SELECT COUNT(*) AS count FROM public.repair_requests WHERE job_number = $1;",
          [jn],
        );
        assert.equal(
          Number(check.rows[0].count),
          0,
          "No repair-request row must be persisted on attack rejection",
        );
        await client.end();
      },
    );

    await t.test(
      "Attack 6 [INSERT]: Workshop Drop-Off + nonexistent facility is rejected and zero rows persisted",
      async () => {
        const jn = nextJobNumber();
        const fakeFacId = "00000000-0000-0000-0000-000000009999";
        const client = await getContextClient(farmerAuthId);

        await assert.rejects(
          async () => {
            await client.query(
              `
          INSERT INTO public.repair_requests (
            job_number, equipment_id, farmer_id, delivery_mode, is_immobile, facility_id, location
          ) VALUES (
            $1, $2, $3, 'WORKSHOP_DROPOFF', FALSE, $4, 'Nagpur Farm'
          );
        `,
              [jn, equipmentId, farmerProfileId, fakeFacId],
            );
          },
          (err) => {
            assert.equal(err.code, "23503", "Must raise 23503 foreign_key_violation");
            return true;
          },
          "Database must reject WORKSHOP_DROPOFF with nonexistent facility",
        );

        const check = await master.query(
          "SELECT COUNT(*) AS count FROM public.repair_requests WHERE job_number = $1;",
          [jn],
        );
        assert.equal(
          Number(check.rows[0].count),
          0,
          "No repair-request row must be persisted on attack rejection",
        );
        await client.end();
      },
    );

    await t.test(
      "Attack 7 [INSERT]: Null delivery_mode is rejected by NOT NULL constraint",
      async () => {
        const jn = nextJobNumber();
        const client = await getContextClient(farmerAuthId);

        await assert.rejects(
          async () => {
            await client.query(
              `
          INSERT INTO public.repair_requests (
            job_number, equipment_id, farmer_id, delivery_mode, is_immobile, facility_id, location
          ) VALUES (
            $1, $2, $3, NULL, FALSE, NULL, 'Nagpur Farm'
          );
        `,
              [jn, equipmentId, farmerProfileId],
            );
          },
          (err) => {
            assert.equal(err.code, "23502", "Must raise 23502 not_null_violation");
            return true;
          },
          "Database must reject NULL delivery_mode",
        );

        const check = await master.query(
          "SELECT COUNT(*) AS count FROM public.repair_requests WHERE job_number = $1;",
          [jn],
        );
        assert.equal(
          Number(check.rows[0].count),
          0,
          "No repair-request row must be persisted on attack rejection",
        );
        await client.end();
      },
    );

    await t.test(
      "Attack 8 [INSERT]: Farmer 1 attempting to create ticket for Farmer 2 is rejected by RLS",
      async () => {
        const jn = nextJobNumber();
        const client = await getContextClient(farmerAuthId);

        await assert.rejects(
          async () => {
            await client.query(
              `
          INSERT INTO public.repair_requests (
            job_number, equipment_id, farmer_id, delivery_mode, is_immobile, facility_id, location
          ) VALUES (
            $1, $2, $3, 'DOORSTEP', FALSE, NULL, 'Nagpur Farm'
          );
        `,
              [jn, equipmentId, farmer2ProfileId],
            ); // farmerProfileId != farmer2ProfileId
          },
          (err) => {
            assert.equal(err.code, "42501", "Must raise 42501 RLS policy check violation");
            return true;
          },
          "RLS must prevent farmer from inserting tickets for another farmer",
        );

        const check = await master.query(
          "SELECT COUNT(*) AS count FROM public.repair_requests WHERE job_number = $1;",
          [jn],
        );
        assert.equal(
          Number(check.rows[0].count),
          0,
          "No repair-request row must be persisted on attack rejection",
        );
        await client.end();
      },
    );

    // ============================================================================
    // VALID SUBMISSIONS (Proving authorized workflows succeed)
    // ============================================================================

    let validDoorstepId, validDropOffId;

    await t.test(
      "Valid [INSERT]: Mobile Doorstep submission succeeds and persists row",
      async () => {
        const jn = nextJobNumber();
        const client = await getContextClient(farmerAuthId);

        const res = await client.query(
          `
      INSERT INTO public.repair_requests (
        job_number, equipment_id, farmer_id, delivery_mode, is_immobile, facility_id, location
      ) VALUES (
        $1, $2, $3, 'DOORSTEP', FALSE, NULL, 'Nagpur Farm'
      ) RETURNING id, job_number, delivery_mode, facility_id, is_immobile;
    `,
          [jn, equipmentId, farmerProfileId],
        );

        assert.equal(res.rows.length, 1);
        assert.equal(res.rows[0].delivery_mode, "DOORSTEP");
        assert.equal(res.rows[0].facility_id, null);
        assert.equal(res.rows[0].is_immobile, false);
        validDoorstepId = res.rows[0].id;
        await client.end();
      },
    );

    await t.test(
      "Valid [INSERT]: Immobile Doorstep submission succeeds and persists row",
      async () => {
        const jn = nextJobNumber();
        const client = await getContextClient(farmerAuthId);

        const res = await client.query(
          `
      INSERT INTO public.repair_requests (
        job_number, equipment_id, farmer_id, delivery_mode, is_immobile, facility_id, location
      ) VALUES (
        $1, $2, $3, 'DOORSTEP', TRUE, NULL, 'Nagpur Farm (Immobile Machine)'
      ) RETURNING id, job_number, delivery_mode, facility_id, is_immobile;
    `,
          [jn, equipmentId, farmerProfileId],
        );

        assert.equal(res.rows.length, 1);
        assert.equal(res.rows[0].delivery_mode, "DOORSTEP");
        assert.equal(res.rows[0].facility_id, null);
        assert.equal(res.rows[0].is_immobile, true);
        await client.end();
      },
    );

    await t.test(
      "Valid [INSERT]: Mobile Workshop Drop-Off with approved facility succeeds and persists row",
      async () => {
        const jn = nextJobNumber();
        const client = await getContextClient(farmerAuthId);

        const res = await client.query(
          `
      INSERT INTO public.repair_requests (
        job_number, equipment_id, farmer_id, delivery_mode, is_immobile, facility_id, location
      ) VALUES (
        $1, $2, $3, 'WORKSHOP_DROPOFF', FALSE, $4, 'Transport to Workshop'
      ) RETURNING id, job_number, delivery_mode, facility_id, is_immobile;
    `,
          [jn, equipmentId, farmerProfileId, approvedActiveFacId],
        );

        assert.equal(res.rows.length, 1);
        assert.equal(res.rows[0].delivery_mode, "WORKSHOP_DROPOFF");
        assert.equal(res.rows[0].facility_id, approvedActiveFacId);
        assert.equal(res.rows[0].is_immobile, false);
        validDropOffId = res.rows[0].id;
        await client.end();
      },
    );

    // ============================================================================
    // UPDATE ATTACK SCENARIOS (Testing DB Constraints & Trigger on UPDATE)
    // ============================================================================

    await t.test(
      "Attack [UPDATE - Client DML]: Farmer client direct UPDATE on dispatch columns is rejected by DAC",
      async () => {
        const client = await getContextClient(farmerAuthId);

        // Direct UPDATE on facility_id
        await assert.rejects(
          async () => {
            await client.query(
              `
          UPDATE public.repair_requests
          SET facility_id = $1
          WHERE id = $2;
        `,
              [approvedActiveFacId, validDoorstepId],
            );
          },
          /permission denied for table repair_requests|permission denied/i,
          "Farmer client must lack direct UPDATE privilege on facility_id",
        );

        // Direct UPDATE on delivery_mode
        await assert.rejects(
          async () => {
            await client.query(
              `
          UPDATE public.repair_requests
          SET delivery_mode = 'WORKSHOP_DROPOFF'
          WHERE id = $1;
        `,
              [validDoorstepId],
            );
          },
          /permission denied for table repair_requests|permission denied/i,
          "Farmer client must lack direct UPDATE privilege on delivery_mode",
        );

        // Direct UPDATE on is_immobile
        await assert.rejects(
          async () => {
            await client.query(
              `
          UPDATE public.repair_requests
          SET is_immobile = TRUE
          WHERE id = $1;
        `,
              [validDoorstepId],
            );
          },
          /permission denied for table repair_requests|permission denied/i,
          "Farmer client must lack direct UPDATE privilege on is_immobile",
        );

        await client.end();
      },
    );

    await t.test(
      "Attack [UPDATE - Trigger Guard]: Updating Doorstep repair to non-null facility_id is rejected",
      async () => {
        // Attempt via master/admin to verify database trigger blocks update even if caller has table permissions
        await assert.rejects(
          async () => {
            await master.query(
              `
          UPDATE public.repair_requests
          SET facility_id = $1
          WHERE id = $2;
        `,
              [approvedActiveFacId, validDoorstepId],
            );
          },
          (err) => {
            assert.equal(err.code, "23514", "Must raise 23514 check_violation");
            return true;
          },
          "Database must reject updating DOORSTEP ticket to have non-null facility_id",
        );

        // Verify facility_id remains NULL
        const row = await master.query(
          "SELECT facility_id FROM public.repair_requests WHERE id = $1;",
          [validDoorstepId],
        );
        assert.equal(row.rows[0].facility_id, null, "State must remain unchanged");
      },
    );

    await t.test(
      "Attack [UPDATE - Trigger Guard]: Updating Workshop Drop-Off to is_immobile = TRUE is rejected",
      async () => {
        await assert.rejects(
          async () => {
            await master.query(
              `
          UPDATE public.repair_requests
          SET is_immobile = TRUE
          WHERE id = $1;
        `,
              [validDropOffId],
            );
          },
          (err) => {
            assert.equal(err.code, "23514", "Must raise 23514 check_violation");
            return true;
          },
          "Database must reject updating WORKSHOP_DROPOFF ticket to is_immobile = true",
        );

        const row = await master.query(
          "SELECT is_immobile FROM public.repair_requests WHERE id = $1;",
          [validDropOffId],
        );
        assert.equal(row.rows[0].is_immobile, false, "is_immobile must remain false");
      },
    );

    await t.test(
      "Attack [UPDATE - Trigger Guard]: Updating Workshop Drop-Off to inactive facility is rejected",
      async () => {
        await assert.rejects(
          async () => {
            await master.query(
              `
          UPDATE public.repair_requests
          SET facility_id = $1
          WHERE id = $2;
        `,
              [inactiveFacId, validDropOffId],
            );
          },
          (err) => {
            assert.equal(err.code, "P0001", "Must raise P0001 raise_exception");
            assert.match(err.message, /inactive/i);
            return true;
          },
          "Database must reject updating facility_id to an inactive facility",
        );

        const row = await master.query(
          "SELECT facility_id FROM public.repair_requests WHERE id = $1;",
          [validDropOffId],
        );
        assert.equal(
          row.rows[0].facility_id,
          approvedActiveFacId,
          "facility_id must remain unchanged",
        );
      },
    );

    await t.test(
      "Attack [UPDATE - Trigger Guard]: Updating Workshop Drop-Off to unapproved facility is rejected",
      async () => {
        await assert.rejects(
          async () => {
            await master.query(
              `
          UPDATE public.repair_requests
          SET facility_id = $1
          WHERE id = $2;
        `,
              [unapprovedFacId, validDropOffId],
            );
          },
          (err) => {
            assert.equal(err.code, "P0001", "Must raise P0001 raise_exception");
            assert.match(err.message, /not approved/i);
            return true;
          },
          "Database must reject updating facility_id to an unapproved facility",
        );

        const row = await master.query(
          "SELECT facility_id FROM public.repair_requests WHERE id = $1;",
          [validDropOffId],
        );
        assert.equal(
          row.rows[0].facility_id,
          approvedActiveFacId,
          "facility_id must remain unchanged",
        );
      },
    );

    await t.test(
      "Attack [UPDATE - Trigger Guard]: Updating Workshop Drop-Off to null facility_id is rejected",
      async () => {
        await assert.rejects(
          async () => {
            await master.query(
              `
          UPDATE public.repair_requests
          SET facility_id = NULL
          WHERE id = $1;
        `,
              [validDropOffId],
            );
          },
          (err) => {
            assert.ok(
              err.code === "23514" || err.code === "23502",
              `Expected 23514 or 23502, got ${err.code}`,
            );
            return true;
          },
          "Database must reject updating facility_id to NULL on WORKSHOP_DROPOFF",
        );

        const row = await master.query(
          "SELECT facility_id FROM public.repair_requests WHERE id = $1;",
          [validDropOffId],
        );
        assert.equal(
          row.rows[0].facility_id,
          approvedActiveFacId,
          "facility_id must remain unchanged",
        );
      },
    );

    // ============================================================================
    // RLS AND IDENTITY BOUNDARIES
    // ============================================================================

    await t.test(
      "Security: Unauthenticated anon caller cannot SELECT or INSERT repair_requests",
      async () => {
        const client = await getContextClient(null, "anon");

        await assert.rejects(
          async () => {
            await client.query("SELECT * FROM public.repair_requests;");
          },
          /permission denied/,
          "Anon must not have SELECT permission on repair_requests",
        );

        await assert.rejects(
          async () => {
            await client.query(
              `
          INSERT INTO public.repair_requests (job_number, equipment_id, farmer_id, location)
          VALUES ('JOB-ANON-001', $1, $2, 'Field');
        `,
              [equipmentId, farmerProfileId],
            );
          },
          /permission denied/,
          "Anon must not have INSERT permission on repair_requests",
        );

        await client.end();
      },
    );

    await t.test(
      "Security: Farmer client direct DELETE on repair_requests is denied by DAC",
      async () => {
        const client = await getContextClient(farmerAuthId);

        await assert.rejects(
          async () => {
            await client.query("DELETE FROM public.repair_requests WHERE id = $1;", [
              validDoorstepId,
            ]);
          },
          /permission denied for table repair_requests|permission denied/i,
          "Authenticated farmer must lack DELETE privilege on repair_requests",
        );

        await client.end();
      },
    );

    await t.test(
      "Security: Farmer 2 cannot SELECT Farmer 1 repair requests under RLS",
      async () => {
        const client = await getContextClient(farmer2AuthId);
        const res = await client.query("SELECT id FROM public.repair_requests WHERE id = $1;", [
          validDoorstepId,
        ]);
        assert.equal(
          res.rows.length,
          0,
          "Farmer 2 query for Farmer 1 ticket must return 0 rows due to RLS",
        );
        await client.end();
      },
    );

    await master.end();
  },
);
