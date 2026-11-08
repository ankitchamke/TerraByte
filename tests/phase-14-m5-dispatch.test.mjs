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

// Helper to get client with specific JWT context simulating authenticated farmer / admin / tech
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
  "Phase 14 Milestone 5: Manual Technician Dispatch & Reassignment Integration Suite",
  { skip: !dbAvailable && "Requires local PostgreSQL test container on port 54332" },
  async (t) => {
    const master = new Client({ connectionString: DB_URL });
    await master.connect();
    await master.query("SET search_path = public, auth, extensions;");

    // Advisory lock to prevent parallel test collision with other live tests
    await master.query("SELECT pg_advisory_lock(140001);");

    let adminClient;
    let farmerClient;
    let farmer2Client;
    let tech1Client;
    let tech2Client;
    let unverifiedTechClient;

    t.after(async () => {
      try {
        if (adminClient) await adminClient.end();
        if (farmerClient) await farmerClient.end();
        if (farmer2Client) await farmer2Client.end();
        if (tech1Client) await tech1Client.end();
        if (tech2Client) await tech2Client.end();
        if (unverifiedTechClient) await unverifiedTechClient.end();
      } catch {}
      try {
        await master.query("SELECT pg_advisory_unlock(140001);");
      } catch {}
      try {
        await master.end();
      } catch {}
    });

    // 0. Clean slate setup
    await master.query("TRUNCATE TABLE public.repair_assignment_history CASCADE;");
    await master.query("TRUNCATE TABLE public.facility_bay_reservations CASCADE;");
    await master.query("TRUNCATE TABLE public.repair_dispatch_locations CASCADE;");
    await master.query("TRUNCATE TABLE public.repair_timeline CASCADE;");
    await master.query("TRUNCATE TABLE public.repair_requests CASCADE;");
    await master.query("TRUNCATE TABLE public.technician_profiles CASCADE;");
    await master.query("TRUNCATE TABLE public.equipment CASCADE;");
    await master.query("TRUNCATE TABLE public.profiles CASCADE;");
    await master.query("TRUNCATE TABLE auth.users CASCADE;");

    // 1. Seed users & profiles
    // Admin
    const adminUser = await master.query(
      "INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'admin.m5@demo.com') RETURNING id;",
    );
    const adminAuthId = adminUser.rows[0].id;
    const adminProf = await master.query(
      `INSERT INTO public.profiles (id, auth_user_id, full_name, role, phone, village)
       VALUES (gen_random_uuid(), $1, 'Admin Deshpande', 'admin', '+919800000099', 'Nagpur')
       RETURNING id;`,
      [adminAuthId],
    );
    const adminProfileId = adminProf.rows[0].id;

    // Farmer 1
    const farmerUser = await master.query(
      "INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'farmer.m5@demo.com') RETURNING id;",
    );
    const farmerAuthId = farmerUser.rows[0].id;
    const farmerProf = await master.query(
      `INSERT INTO public.profiles (id, auth_user_id, full_name, role, phone, village)
       VALUES (gen_random_uuid(), $1, 'Kishor Patil', 'farmer', '+919800000001', 'Kalmeshwar')
       RETURNING id;`,
      [farmerAuthId],
    );
    const farmerProfileId = farmerProf.rows[0].id;

    // Farmer 2
    const farmer2User = await master.query(
      "INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'farmer2.m5@demo.com') RETURNING id;",
    );
    const farmer2AuthId = farmer2User.rows[0].id;
    const farmer2Prof = await master.query(
      `INSERT INTO public.profiles (id, auth_user_id, full_name, role, phone, village)
       VALUES (gen_random_uuid(), $1, 'Nitin Kale', 'farmer', '+919800000002', 'Saoner')
       RETURNING id;`,
      [farmer2AuthId],
    );
    const farmer2ProfileId = farmer2Prof.rows[0].id;

    // Verified Technician 1 (Mahindra Engine Specialist)
    const tech1User = await master.query(
      "INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'tech1.m5@demo.com') RETURNING id;",
    );
    const tech1AuthId = tech1User.rows[0].id;
    const tech1Prof = await master.query(
      `INSERT INTO public.profiles (id, auth_user_id, full_name, role, phone, village)
       VALUES (gen_random_uuid(), $1, 'Ganesh Shinde', 'technician', '+919800000011', 'Kalmeshwar')
       RETURNING id;`,
      [tech1AuthId],
    );
    const tech1ProfileId = tech1Prof.rows[0].id;
    await master.query(
      `INSERT INTO public.technician_profiles (profile_id, workshop_name, brands, skills, is_verified, is_available)
       VALUES ($1, 'Shinde Agro Workshop', ARRAY['Mahindra'], ARRAY['Engine'], true, true);`,
      [tech1ProfileId],
    );

    // Verified Technician 2 (John Deere Hydraulics Specialist)
    const tech2User = await master.query(
      "INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'tech2.m5@demo.com') RETURNING id;",
    );
    const tech2AuthId = tech2User.rows[0].id;
    const tech2Prof = await master.query(
      `INSERT INTO public.profiles (id, auth_user_id, full_name, role, phone, village)
       VALUES (gen_random_uuid(), $1, 'Anil Jadhav', 'technician', '+919800000012', 'Saoner')
       RETURNING id;`,
      [tech2AuthId],
    );
    const tech2ProfileId = tech2Prof.rows[0].id;
    await master.query(
      `INSERT INTO public.technician_profiles (profile_id, workshop_name, brands, skills, is_verified, is_available)
       VALUES ($1, 'Jadhav Precision Repairs', ARRAY['John Deere'], ARRAY['Hydraulics'], true, true);`,
      [tech2ProfileId],
    );

    // Unverified Technician 3
    const unverifiedTechUser = await master.query(
      "INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'tech.unverified@demo.com') RETURNING id;",
    );
    const unverifiedTechAuthId = unverifiedTechUser.rows[0].id;
    const unverifiedTechProf = await master.query(
      `INSERT INTO public.profiles (id, auth_user_id, full_name, role, phone, village)
       VALUES (gen_random_uuid(), $1, 'Pravin Raut', 'technician', '+919800000013', 'Katol')
       RETURNING id;`,
      [unverifiedTechAuthId],
    );
    const unverifiedTechProfileId = unverifiedTechProf.rows[0].id;
    await master.query(
      `INSERT INTO public.technician_profiles (profile_id, workshop_name, brands, skills, is_verified, is_available)
       VALUES ($1, 'Raut Garage', ARRAY['Sonalika'], ARRAY['General'], false, true);`,
      [unverifiedTechProfileId],
    );

    // Seed equipment for farmer
    const equipRes = await master.query(
      `INSERT INTO public.equipment (farmer_id, make, model, year, type, serial_number, status)
       VALUES ($1, 'Mahindra', '575 DI', 2021, 'Tractor', 'SN-M5-001', 'Operational')
       RETURNING id;`,
      [farmerProfileId],
    );
    const equipmentId = equipRes.rows[0].id;

    // Seed unassigned repair request
    const repairRes = await master.query(
      `INSERT INTO public.repair_requests (job_number, farmer_id, equipment_id, symptoms, location, delivery_mode, is_immobile, status)
       VALUES ('TB-M5-001', $1, $2, ARRAY['Hydraulic lift pump failure'], 'Kalmeshwar Field', 'DOORSTEP', false, 'REQUESTED')
       RETURNING id;`,
      [farmerProfileId, equipmentId],
    );
    const repairId = repairRes.rows[0].id;

    // Seed dispatch location
    await master.query(
      `INSERT INTO public.repair_dispatch_locations (repair_request_id, latitude, longitude, accuracy)
       VALUES ($1, 21.2345, 78.9876, 5.0);`,
      [repairId],
    );

    // Initialize authenticated clients
    adminClient = await getContextClient(adminAuthId, "authenticated");
    farmerClient = await getContextClient(farmerAuthId, "authenticated");
    farmer2Client = await getContextClient(farmer2AuthId, "authenticated");
    tech1Client = await getContextClient(tech1AuthId, "authenticated");
    tech2Client = await getContextClient(tech2AuthId, "authenticated");
    unverifiedTechClient = await getContextClient(unverifiedTechAuthId, "authenticated");

    // =========================================================================
    // Test 1: Unauthorized Callers Rejected (Farmer, Technician, Anon)
    // =========================================================================
    await t.test("Unauthorized callers are rejected with 42501 permission denied", async () => {
      // Farmer attempts dispatch via admin RPC
      await assert.rejects(
        async () => {
          await farmerClient.query(
            "SELECT * FROM public.admin_dispatch_technician($1, $2, 'Farmer trying dispatch', NULL);",
            [repairId, tech1ProfileId],
          );
        },
        (err) => {
          assert.equal(err.code, "42501");
          assert.match(err.message, /Only service centre administrators can dispatch/i);
          return true;
        },
      );

      // Technician attempts dispatch via admin RPC
      await assert.rejects(
        async () => {
          await tech1Client.query(
            "SELECT * FROM public.admin_dispatch_technician($1, $2, 'Tech trying dispatch', NULL);",
            [repairId, tech1ProfileId],
          );
        },
        (err) => {
          assert.equal(err.code, "42501");
          assert.match(err.message, /Only service centre administrators can dispatch/i);
          return true;
        },
      );

      // Anon client attempts dispatch via admin RPC
      const anonClient = await getContextClient(null, "anon");
      await assert.rejects(
        async () => {
          await anonClient.query(
            "SELECT * FROM public.admin_dispatch_technician($1, $2, 'Anon trying dispatch', NULL);",
            [repairId, tech1ProfileId],
          );
        },
        (err) => {
          assert.equal(err.code, "42501");
          return true;
        },
      );
      await anonClient.end();
    });

    // =========================================================================
    // Test 2: Ineligible Technician Candidates Rejected
    // =========================================================================
    await t.test(
      "Ineligible candidate technicians are rejected with descriptive errors",
      async () => {
        // Unverified technician
        await assert.rejects(
          async () => {
            await adminClient.query(
              "SELECT * FROM public.admin_dispatch_technician($1, $2, 'Dispatch to unverified', NULL);",
              [repairId, unverifiedTechProfileId],
            );
          },
          (err) => {
            assert.equal(err.code, "22000");
            assert.match(err.message, /has not been verified by the Service Centre/i);
            return true;
          },
        );

        // Non-existent technician UUID
        const fakeTechUuid = "00000000-0000-0000-0000-000000000099";
        await assert.rejects(
          async () => {
            await adminClient.query(
              "SELECT * FROM public.admin_dispatch_technician($1, $2, 'Dispatch to fake', NULL);",
              [repairId, fakeTechUuid],
            );
          },
          (err) => {
            assert.equal(err.code, "02000");
            assert.match(err.message, /Selected technician profile .* was not found/i);
            return true;
          },
        );

        // Profile that is not a technician (e.g. farmer profile)
        await assert.rejects(
          async () => {
            await adminClient.query(
              "SELECT * FROM public.admin_dispatch_technician($1, $2, 'Dispatch to farmer', NULL);",
              [repairId, farmerProfileId],
            );
          },
          (err) => {
            assert.equal(err.code, "02000");
            return true;
          },
        );

        // Technician who previously declined the ticket
        await master.query(
          "UPDATE public.repair_requests SET declined_by = ARRAY[$1::UUID] WHERE id = $2;",
          [tech2ProfileId, repairId],
        );

        await assert.rejects(
          async () => {
            await adminClient.query(
              "SELECT * FROM public.admin_dispatch_technician($1, $2, 'Dispatch to declined', NULL);",
              [repairId, tech2ProfileId],
            );
          },
          (err) => {
            assert.equal(err.code, "22000");
            assert.match(err.message, /has already declined this repair request/i);
            return true;
          },
        );

        // Reset declined_by array for subsequent tests
        await master.query("UPDATE public.repair_requests SET declined_by = '{}' WHERE id = $1;", [
          repairId,
        ]);
      },
    );

    // =========================================================================
    // Test 3: Admin Successfully Dispatches Unassigned Repair (Initial Dispatch)
    // =========================================================================
    await t.test(
      "Admin successfully dispatches unassigned repair to verified technician",
      async () => {
        const res = await adminClient.query(
          "SELECT * FROM public.admin_dispatch_technician($1, $2, 'Initial dispatch by SC', NULL);",
          [repairId, tech1ProfileId],
        );

        assert.equal(res.rows.length, 1);
        assert.equal(res.rows[0].technician_id, tech1ProfileId);
        assert.equal(res.rows[0].status, "REQUESTED");

        // Verify repair_assignment_history
        const histRes = await master.query(
          "SELECT * FROM public.repair_assignment_history WHERE repair_request_id = $1 ORDER BY created_at ASC;",
          [repairId],
        );
        assert.equal(histRes.rows.length, 1);
        const histRow = histRes.rows[0];
        assert.equal(histRow.assignment_type, "DISPATCH");
        assert.equal(histRow.previous_technician_id, null);
        assert.equal(histRow.assigned_technician_id, tech1ProfileId);
        assert.equal(histRow.assigned_by, adminProfileId);
        assert.equal(histRow.assigned_by_role, "admin");
        assert.equal(histRow.reason, "Initial dispatch by SC");

        // Verify repair_timeline entry
        const timelineRes = await master.query(
          "SELECT * FROM public.repair_timeline WHERE repair_request_id = $1 ORDER BY created_at DESC LIMIT 1;",
          [repairId],
        );
        assert.equal(timelineRes.rows.length, 1);
        assert.match(timelineRes.rows[0].note, /Technician assigned: Ganesh Shinde/i);

        // Verify assigned Technician 1 can access repair data
        const tech1Repair = await tech1Client.query(
          "SELECT id, job_number FROM public.repair_requests WHERE id = $1;",
          [repairId],
        );
        assert.equal(tech1Repair.rows.length, 1);

        const tech1Loc = await tech1Client.query(
          "SELECT latitude, longitude FROM public.repair_dispatch_locations WHERE repair_request_id = $1;",
          [repairId],
        );
        assert.equal(tech1Loc.rows.length, 1);

        const tech1Hist = await tech1Client.query(
          "SELECT * FROM public.repair_assignment_history WHERE repair_request_id = $1;",
          [repairId],
        );
        assert.equal(tech1Hist.rows.length, 1);

        // Seed a quote and quote item while Tech 1 is actively assigned
        const quoteRes = await master.query(
          `INSERT INTO public.quotes (repair_request_id, technician_id, labour_description, labour_amount, tax_percent, estimated_completion, version, status, sent_at)
           VALUES ($1, $2, 'Engine overhaul labour', 2500, 18, '2 days', 1, 'PENDING', now())
           RETURNING id;`,
          [repairId, tech1ProfileId],
        );
        const quoteId = quoteRes.rows[0].id;

        await master.query(
          `INSERT INTO public.quote_items (quote_id, part_name, quantity, unit_price, part_source)
           VALUES ($1, 'Piston Ring Set', 1, 1200, 'CENTRAL_DEPOT');`,
          [quoteId],
        );

        // Seed a part request requested by Tech 1 while assigned
        const partRes = await master.query("SELECT id FROM public.service_centre_parts LIMIT 1;");
        let partId = partRes.rows[0]?.id;
        if (!partId) {
          const newPart = await master.query(
            `INSERT INTO public.service_centre_parts (service_centre_id, part_number, name, spec, category, stock_quantity, unit_price, location)
             VALUES ($1, 'PST-01', 'Piston Ring Set', 'Standard', 'Engine', 10, 1200, 'Shelf A1')
             RETURNING id;`,
            [adminProfileId],
          );
          partId = newPart.rows[0].id;
        }

        await master.query(
          `INSERT INTO public.service_centre_part_requests (repair_request_id, requested_by, part_id, quantity, status)
           VALUES ($1, $2, $3, 1, 'PENDING');`,
          [repairId, tech1ProfileId, partId],
        );
      },
    );

    // =========================================================================
    // Test 4: Duplicate Assignment Guard
    // =========================================================================
    await t.test(
      "Assigning to currently assigned technician is rejected as duplicate",
      async () => {
        await assert.rejects(
          async () => {
            await adminClient.query(
              "SELECT * FROM public.admin_dispatch_technician($1, $2, 'Duplicate assign', $2);",
              [repairId, tech1ProfileId],
            );
          },
          (err) => {
            assert.equal(err.code, "22000");
            assert.match(err.message, /is already assigned to this repair request/i);
            return true;
          },
        );
      },
    );

    // =========================================================================
    // Test 5: Reassignment Mandatory Reason Enforcement
    // =========================================================================
    await t.test(
      "Reassignment of assigned technician strictly requires a non-empty reason",
      async () => {
        // Null reason
        await assert.rejects(
          async () => {
            await adminClient.query(
              "SELECT * FROM public.admin_dispatch_technician($1, $2, NULL, $3);",
              [repairId, tech2ProfileId, tech1ProfileId],
            );
          },
          (err) => {
            assert.equal(err.code, "22000");
            assert.match(
              err.message,
              /mandatory reason is required to reassign an active technician/i,
            );
            return true;
          },
        );

        // Empty / whitespace reason
        await assert.rejects(
          async () => {
            await adminClient.query(
              "SELECT * FROM public.admin_dispatch_technician($1, $2, '    ', $3);",
              [repairId, tech2ProfileId, tech1ProfileId],
            );
          },
          (err) => {
            assert.equal(err.code, "22000");
            assert.match(
              err.message,
              /mandatory reason is required to reassign an active technician/i,
            );
            return true;
          },
        );
      },
    );

    // =========================================================================
    // Test 6: Optimistic Concurrency Control (OCC) Guard
    // =========================================================================
    await t.test(
      "OCC guard rejects assignment when expected current technician does not match",
      async () => {
        const wrongExpectedTechId = "11111111-1111-1111-1111-111111111111";
        await assert.rejects(
          async () => {
            await adminClient.query(
              "SELECT * FROM public.admin_dispatch_technician($1, $2, 'Stale assign', $3);",
              [repairId, tech2ProfileId, wrongExpectedTechId],
            );
          },
          (err) => {
            assert.equal(err.code, "40001");
            assert.match(err.message, /repair assignment was modified by another dispatcher/i);
            return true;
          },
        );
      },
    );

    // =========================================================================
    // Test 7: Successful Reassignment with Audit & Timeline
    // =========================================================================
    await t.test(
      "Admin successfully reassigns technician with mandatory reason and audit records",
      async () => {
        const reassignmentReason =
          "Ganesh had a vehicle breakdown; reassigning to Anil Jadhav for urgent inspection.";

        const res = await adminClient.query(
          "SELECT * FROM public.admin_dispatch_technician($1, $2, $3, $4);",
          [repairId, tech2ProfileId, reassignmentReason, tech1ProfileId],
        );

        assert.equal(res.rows.length, 1);
        assert.equal(res.rows[0].technician_id, tech2ProfileId);

        // Verify repair_assignment_history
        const histRes = await master.query(
          "SELECT * FROM public.repair_assignment_history WHERE repair_request_id = $1 ORDER BY created_at ASC;",
          [repairId],
        );
        assert.equal(histRes.rows.length, 2);

        const reassignRow = histRes.rows[1];
        assert.equal(reassignRow.assignment_type, "REASSIGNMENT");
        assert.equal(reassignRow.previous_technician_id, tech1ProfileId);
        assert.equal(reassignRow.assigned_technician_id, tech2ProfileId);
        assert.equal(reassignRow.assigned_by, adminProfileId);
        assert.equal(reassignRow.reason, reassignmentReason);

        // Verify repair_timeline entry
        const timelineRes = await master.query(
          "SELECT * FROM public.repair_timeline WHERE repair_request_id = $1 AND status = 'REASSIGNED' ORDER BY created_at DESC LIMIT 1;",
          [repairId],
        );
        assert.equal(timelineRes.rows.length, 1);
        assert.match(
          timelineRes.rows[0].note,
          /reassigned from Ganesh Shinde to Anil Jadhav.*Ganesh had a vehicle breakdown/i,
        );
      },
    );

    // =========================================================================
    // Test 8: Former Technician Access Revocation Across All Tables
    // =========================================================================
    await t.test(
      "Former technician loses access across all protected tables, while new tech gains access",
      async () => {
        // Tech 1 (reassigned away) attempts access to repair_requests
        const tech1Repair = await tech1Client.query(
          "SELECT id FROM public.repair_requests WHERE id = $1;",
          [repairId],
        );
        assert.equal(tech1Repair.rows.length, 0, "Former tech must have 0 rows on repair_requests");

        // Tech 1 attempts access to repair_dispatch_locations
        const tech1Loc = await tech1Client.query(
          "SELECT id FROM public.repair_dispatch_locations WHERE repair_request_id = $1;",
          [repairId],
        );
        assert.equal(
          tech1Loc.rows.length,
          0,
          "Former tech must have 0 rows on repair_dispatch_locations",
        );

        // Tech 1 attempts access to repair_timeline
        const tech1Timeline = await tech1Client.query(
          "SELECT id FROM public.repair_timeline WHERE repair_request_id = $1;",
          [repairId],
        );
        assert.equal(
          tech1Timeline.rows.length,
          0,
          "Former tech must have 0 rows on repair_timeline",
        );

        // Tech 1 attempts access to repair_assignment_history directly
        const tech1Hist = await tech1Client.query(
          "SELECT id FROM public.repair_assignment_history WHERE repair_request_id = $1;",
          [repairId],
        );
        assert.equal(
          tech1Hist.rows.length,
          0,
          "Former tech must have 0 rows on repair_assignment_history",
        );

        // Tech 1 attempts access to quotes
        const tech1Quotes = await tech1Client.query(
          "SELECT id FROM public.quotes WHERE repair_request_id = $1;",
          [repairId],
        );
        assert.equal(tech1Quotes.rows.length, 0, "Former tech must have 0 rows on quotes");

        // Tech 1 attempts access to quote_items
        const tech1QuoteItems = await tech1Client.query(
          "SELECT qi.id FROM public.quote_items qi JOIN public.quotes q ON q.id = qi.quote_id WHERE q.repair_request_id = $1;",
          [repairId],
        );
        assert.equal(tech1QuoteItems.rows.length, 0, "Former tech must have 0 rows on quote_items");

        // Tech 1 attempts access to service_centre_part_requests
        const tech1Parts = await tech1Client.query(
          "SELECT id FROM public.service_centre_part_requests WHERE repair_request_id = $1;",
          [repairId],
        );
        assert.equal(
          tech1Parts.rows.length,
          0,
          "Former tech must have 0 rows on service_centre_part_requests",
        );

        // Tech 1 attempts access to get_repair_assignment_history RPC -> 42501
        await assert.rejects(
          async () => {
            await tech1Client.query("SELECT * FROM public.get_repair_assignment_history($1);", [
              repairId,
            ]);
          },
          (err) => {
            assert.equal(err.code, "42501");
            assert.match(err.message, /You do not have permission to view assignment history/i);
            return true;
          },
        );

        // Tech 2 (newly assigned) CAN access all protected tables
        const tech2Repair = await tech2Client.query(
          "SELECT id, job_number, technician_id FROM public.repair_requests WHERE id = $1;",
          [repairId],
        );
        assert.equal(tech2Repair.rows.length, 1);
        assert.equal(tech2Repair.rows[0].technician_id, tech2ProfileId);

        const tech2Loc = await tech2Client.query(
          "SELECT id, latitude, longitude FROM public.repair_dispatch_locations WHERE repair_request_id = $1;",
          [repairId],
        );
        assert.equal(tech2Loc.rows.length, 1);

        const tech2Timeline = await tech2Client.query(
          "SELECT id FROM public.repair_timeline WHERE repair_request_id = $1;",
          [repairId],
        );
        assert.ok(tech2Timeline.rows.length >= 2);

        const tech2Hist = await tech2Client.query(
          "SELECT id FROM public.repair_assignment_history WHERE repair_request_id = $1;",
          [repairId],
        );
        assert.equal(tech2Hist.rows.length, 2);

        const tech2HistRpc = await tech2Client.query(
          "SELECT * FROM public.get_repair_assignment_history($1);",
          [repairId],
        );
        assert.equal(tech2HistRpc.rows.length, 2);

        const tech2Quotes = await tech2Client.query(
          "SELECT id FROM public.quotes WHERE repair_request_id = $1;",
          [repairId],
        );
        assert.equal(tech2Quotes.rows.length, 1, "New tech must have access to repair quotes");

        const tech2QuoteItems = await tech2Client.query(
          "SELECT qi.id FROM public.quote_items qi JOIN public.quotes q ON q.id = qi.quote_id WHERE q.repair_request_id = $1;",
          [repairId],
        );
        assert.equal(tech2QuoteItems.rows.length, 1, "New tech must have access to quote items");

        const tech2Parts = await tech2Client.query(
          "SELECT id FROM public.service_centre_part_requests WHERE repair_request_id = $1;",
          [repairId],
        );
        assert.equal(
          tech2Parts.rows.length,
          1,
          "New tech must have access to service_centre_part_requests",
        );

        // Farmer retains complete access
        const farmerRepair = await farmerClient.query(
          "SELECT id FROM public.repair_requests WHERE id = $1;",
          [repairId],
        );
        assert.equal(farmerRepair.rows.length, 1);

        const farmerLoc = await farmerClient.query(
          "SELECT id FROM public.repair_dispatch_locations WHERE repair_request_id = $1;",
          [repairId],
        );
        assert.equal(farmerLoc.rows.length, 1);

        const farmerQuotes = await farmerClient.query(
          "SELECT id FROM public.quotes WHERE repair_request_id = $1;",
          [repairId],
        );
        assert.equal(farmerQuotes.rows.length, 1, "Farmer must retain access to quotes");

        // Admin retains complete access
        const adminRepair = await adminClient.query(
          "SELECT id FROM public.repair_requests WHERE id = $1;",
          [repairId],
        );
        assert.equal(adminRepair.rows.length, 1);

        const adminQuotes = await adminClient.query(
          "SELECT id FROM public.quotes WHERE repair_request_id = $1;",
          [repairId],
        );
        assert.equal(adminQuotes.rows.length, 1, "Admin must retain access to quotes");

        const adminParts = await adminClient.query(
          "SELECT id FROM public.service_centre_part_requests WHERE repair_request_id = $1;",
          [repairId],
        );
        assert.equal(adminParts.rows.length, 1, "Admin must retain access to part requests");
      },
    );

    // =========================================================================
    // Test 9: DAC Hardening (Direct client UPDATE technician_id revoked)
    // =========================================================================
    await t.test(
      "DAC column privilege revokes direct UPDATE on technician_id from authenticated role",
      async () => {
        // Admin client trying direct UPDATE (technician_id) without RPC
        await assert.rejects(
          async () => {
            await adminClient.query(
              "UPDATE public.repair_requests SET technician_id = $1 WHERE id = $2;",
              [tech1ProfileId, repairId],
            );
          },
          (err) => {
            assert.equal(err.code, "42501");
            assert.match(err.message, /permission denied for (table|column technician_id)/i);
            return true;
          },
        );

        // Farmer client trying direct UPDATE (technician_id) without RPC
        await assert.rejects(
          async () => {
            await farmerClient.query(
              "UPDATE public.repair_requests SET technician_id = $1 WHERE id = $2;",
              [tech1ProfileId, repairId],
            );
          },
          (err) => {
            assert.equal(err.code, "42501");
            assert.match(err.message, /permission denied for (table|column technician_id)/i);
            return true;
          },
        );
      },
    );

    // =========================================================================
    // Test 10: Lifecycle Transition & Terminal State Protection
    // =========================================================================
    await t.test(
      "Lifecycle restrictions reject assignments on terminal, cancelled, and handover states",
      async () => {
        // 1. CANCELLED repair ticket
        const canRepair = await master.query(
          `INSERT INTO public.repair_requests (job_number, farmer_id, equipment_id, symptoms, location, delivery_mode, is_immobile, status)
         VALUES ('TB-M5-CAN', $1, $2, ARRAY['Engine smoke'], 'Kalmeshwar Field', 'DOORSTEP', false, 'CANCELLED')
         RETURNING id;`,
          [farmerProfileId, equipmentId],
        );
        const canId = canRepair.rows[0].id;

        await assert.rejects(
          async () => {
            await adminClient.query(
              "SELECT * FROM public.admin_dispatch_technician($1, $2, 'Reassign cancelled', $3);",
              [canId, tech1ProfileId, tech2ProfileId],
            );
          },
          (err) => {
            assert.equal(err.code, "22000");
            assert.match(
              err.message,
              /Cannot assign or reassign technician on a CANCELLED repair request/i,
            );
            return true;
          },
        );

        // 2. COMPLETED repair ticket
        const cmpRepair = await master.query(
          `INSERT INTO public.repair_requests (job_number, farmer_id, equipment_id, symptoms, location, delivery_mode, is_immobile, status, technician_id, load_test_passed)
         VALUES ('TB-M5-CMP', $1, $2, ARRAY['Hydraulic leak'], 'Kalmeshwar Field', 'DOORSTEP', false, 'COMPLETED', $3, true)
         RETURNING id;`,
          [farmerProfileId, equipmentId, tech1ProfileId],
        );
        const cmpId = cmpRepair.rows[0].id;

        await assert.rejects(
          async () => {
            await adminClient.query(
              "SELECT * FROM public.admin_dispatch_technician($1, $2, 'Reassign completed', $3);",
              [cmpId, tech2ProfileId, tech1ProfileId],
            );
          },
          (err) => {
            assert.equal(err.code, "22000");
            assert.match(
              err.message,
              /Cannot assign or reassign technician on a COMPLETED repair request/i,
            );
            return true;
          },
        );

        // 3. CANCELLATION_REQUESTED repair ticket
        const canReqRepair = await master.query(
          `INSERT INTO public.repair_requests (job_number, farmer_id, equipment_id, symptoms, location, delivery_mode, is_immobile, status, technician_id)
         VALUES ('TB-M5-CREQ', $1, $2, ARRAY['Hydraulic leak'], 'Kalmeshwar Field', 'DOORSTEP', false, 'CANCELLATION_REQUESTED', $3)
         RETURNING id;`,
          [farmerProfileId, equipmentId, tech1ProfileId],
        );
        const canReqId = canReqRepair.rows[0].id;

        await assert.rejects(
          async () => {
            await adminClient.query(
              "SELECT * FROM public.admin_dispatch_technician($1, $2, 'Reassign cancel pending', $3);",
              [canReqId, tech2ProfileId, tech1ProfileId],
            );
          },
          (err) => {
            assert.equal(err.code, "22000");
            assert.match(
              err.message,
              /Cannot assign or reassign technician on a CANCELLATION_REQUESTED repair request/i,
            );
            return true;
          },
        );

        // 4. Equipment Handover AUTHORIZED / RELEASED ticket
        const handoverRepair = await master.query(
          `INSERT INTO public.repair_requests (job_number, farmer_id, equipment_id, symptoms, location, delivery_mode, is_immobile, status, technician_id, load_test_passed, handover_status)
         VALUES ('TB-M5-HO', $1, $2, ARRAY['Clutch slipping'], 'Kalmeshwar Field', 'DOORSTEP', false, 'COMPLETED', $3, true, 'AUTHORIZED')
         RETURNING id;`,
          [farmerProfileId, equipmentId, tech1ProfileId],
        );
        const hoId = handoverRepair.rows[0].id;

        await assert.rejects(
          async () => {
            await adminClient.query(
              "SELECT * FROM public.admin_dispatch_technician($1, $2, 'Reassign handover auth', $3);",
              [hoId, tech2ProfileId, tech1ProfileId],
            );
          },
          (err) => {
            assert.equal(err.code, "22000");
            assert.match(err.message, /Cannot assign or reassign technician/i);
            return true;
          },
        );

        // 4B. Equipment Handover RELEASED ticket
        const releasedRepair = await master.query(
          `INSERT INTO public.repair_requests (job_number, farmer_id, equipment_id, symptoms, location, delivery_mode, is_immobile, status, technician_id, load_test_passed, handover_status)
         VALUES ('TB-M5-REL', $1, $2, ARRAY['Transmission noise'], 'Kalmeshwar Field', 'DOORSTEP', false, 'COMPLETED', $3, true, 'RELEASED')
         RETURNING id;`,
          [farmerProfileId, equipmentId, tech1ProfileId],
        );
        const relId = releasedRepair.rows[0].id;

        await assert.rejects(
          async () => {
            await adminClient.query(
              "SELECT * FROM public.admin_dispatch_technician($1, $2, 'Reassign handover released', $3);",
              [relId, tech2ProfileId, tech1ProfileId],
            );
          },
          (err) => {
            assert.equal(err.code, "22000");
            assert.match(err.message, /Cannot assign or reassign technician/i);
            return true;
          },
        );

        // 4C. Initial dispatch rejected if ticket is not in REQUESTED status
        const nonRequestedRepair = await master.query(
          `INSERT INTO public.repair_requests (job_number, farmer_id, equipment_id, symptoms, location, delivery_mode, is_immobile, status)
         VALUES ('TB-M5-NREQ', $1, $2, ARRAY['Brake failure'], 'Kalmeshwar Field', 'DOORSTEP', false, 'IN_PROGRESS')
         RETURNING id;`,
          [farmerProfileId, equipmentId],
        );
        const nreqId = nonRequestedRepair.rows[0].id;

        await assert.rejects(
          async () => {
            await adminClient.query("SELECT * FROM public.admin_dispatch_technician($1, $2);", [
              nreqId,
              tech1ProfileId,
            ]);
          },
          (err) => {
            assert.equal(err.code, "22000");
            assert.match(
              err.message,
              /Initial dispatch is only permitted on repair in REQUESTED status/i,
            );
            return true;
          },
        );

        // 5. Active IN_PROGRESS repair permits reassignment with mandatory reason
        const inProgressRepair = await master.query(
          `INSERT INTO public.repair_requests (job_number, farmer_id, equipment_id, symptoms, location, delivery_mode, is_immobile, status, technician_id)
         VALUES ('TB-M5-PROG', $1, $2, ARRAY['PTO grinding'], 'Kalmeshwar Field', 'DOORSTEP', false, 'IN_PROGRESS', $3)
         RETURNING id;`,
          [farmerProfileId, equipmentId, tech1ProfileId],
        );
        const progId = inProgressRepair.rows[0].id;

        const reassignProgRes = await adminClient.query(
          "SELECT * FROM public.admin_dispatch_technician($1, $2, 'Specialized PTO tooling needed; reassigned to Anil Jadhav', $3);",
          [progId, tech2ProfileId, tech1ProfileId],
        );
        assert.equal(reassignProgRes.rows.length, 1);
        assert.equal(reassignProgRes.rows[0].technician_id, tech2ProfileId);
        assert.equal(reassignProgRes.rows[0].status, "IN_PROGRESS");
      },
    );

    // =========================================================================
    // Test 11: get_repair_assignment_history RPC Functionality & RLS
    // =========================================================================
    await t.test(
      "get_repair_assignment_history returns full audit details in chronological order",
      async () => {
        // Admin query
        const adminHist = await adminClient.query(
          "SELECT * FROM public.get_repair_assignment_history($1);",
          [repairId],
        );

        assert.equal(adminHist.rows.length, 2);

        // Entry 1: Initial dispatch
        const e1 = adminHist.rows[0];
        assert.equal(e1.assignment_type, "DISPATCH");
        assert.equal(e1.assigned_technician_name, "Ganesh Shinde");
        assert.equal(e1.previous_technician_name, null);
        assert.equal(e1.assigned_by_name, "Admin Deshpande");

        // Entry 2: Reassignment
        const e2 = adminHist.rows[1];
        assert.equal(e2.assignment_type, "REASSIGNMENT");
        assert.equal(e2.previous_technician_name, "Ganesh Shinde");
        assert.equal(e2.assigned_technician_name, "Anil Jadhav");
        assert.equal(e2.assigned_by_name, "Admin Deshpande");
        assert.match(e2.reason, /Ganesh had a vehicle breakdown/i);

        // Farmer query (owner can view history of their own repair)
        const farmerHist = await farmerClient.query(
          "SELECT * FROM public.get_repair_assignment_history($1);",
          [repairId],
        );
        assert.equal(farmerHist.rows.length, 2);
      },
    );

    // =========================================================================
    // Test 12: Existing Farmer Workflow (farmer_request_technician RPC)
    // =========================================================================
    await t.test(
      "Farmer workflow: Machinery owner can nominate technician on unassigned REQUESTED repair",
      async () => {
        // Create a new unassigned repair for Farmer 1
        const farmerRepairRes = await master.query(
          `INSERT INTO public.repair_requests (job_number, farmer_id, equipment_id, symptoms, location, delivery_mode, is_immobile, status)
         VALUES ('TB-M5-FARMER', $1, $2, ARRAY['Fuel injector clogged'], 'Kalmeshwar Farm', 'DOORSTEP', false, 'REQUESTED')
         RETURNING id;`,
          [farmerProfileId, equipmentId],
        );
        const fRepairId = farmerRepairRes.rows[0].id;

        // Farmer requests Technician 1
        const fReqRes = await farmerClient.query(
          "SELECT * FROM public.farmer_request_technician($1, $2);",
          [fRepairId, tech1ProfileId],
        );
        assert.equal(fReqRes.rows.length, 1);
        assert.equal(fReqRes.rows[0].technician_id, tech1ProfileId);
        assert.equal(fReqRes.rows[0].status, "REQUESTED");

        // Verify audit history was written with assigned_by_role = 'farmer'
        const fHist = await master.query(
          "SELECT * FROM public.repair_assignment_history WHERE repair_request_id = $1;",
          [fRepairId],
        );
        assert.equal(fHist.rows.length, 1);
        assert.equal(fHist.rows[0].assigned_by, farmerProfileId);
        assert.equal(fHist.rows[0].assigned_by_role, "farmer");
        assert.equal(fHist.rows[0].assignment_type, "DISPATCH");

        // Verify timeline entry
        const fTimeline = await master.query(
          "SELECT * FROM public.repair_timeline WHERE repair_request_id = $1;",
          [fRepairId],
        );
        assert.equal(fTimeline.rows.length, 1);
        assert.match(fTimeline.rows[0].note, /Technician requested by farmer/i);

        // Negative: Farmer 2 cannot request technician for Farmer 1's repair
        await assert.rejects(
          async () => {
            await farmer2Client.query("SELECT * FROM public.farmer_request_technician($1, $2);", [
              fRepairId,
              tech2ProfileId,
            ]);
          },
          (err) => {
            assert.equal(err.code, "42501");
            assert.match(err.message, /only request technicians for your own machinery/i);
            return true;
          },
        );

        // Negative: Farmer 1 cannot reassign once technician is already assigned
        await assert.rejects(
          async () => {
            await farmerClient.query("SELECT * FROM public.farmer_request_technician($1, $2);", [
              fRepairId,
              tech2ProfileId,
            ]);
          },
          (err) => {
            assert.equal(err.code, "42501");
            assert.match(
              err.message,
              /A technician is already assigned.*Only Service Centre administrators can reassign/i,
            );
            return true;
          },
        );

        // Negative: Technician cannot invoke farmer_request_technician
        await assert.rejects(
          async () => {
            await tech1Client.query("SELECT * FROM public.farmer_request_technician($1, $2);", [
              fRepairId,
              tech2ProfileId,
            ]);
          },
          (err) => {
            assert.equal(err.code, "42501");
            assert.match(err.message, /Only machinery owners can request/i);
            return true;
          },
        );
      },
    );

    // =========================================================================
    // Test 13: Direct Client Mutation Denial on repair_assignment_history
    // =========================================================================
    await t.test(
      "Direct client INSERT, UPDATE, DELETE on repair_assignment_history is strictly blocked by DAC",
      async () => {
        // Authenticated admin direct INSERT
        await assert.rejects(
          async () => {
            await adminClient.query(
              `INSERT INTO public.repair_assignment_history
             (repair_request_id, assigned_technician_id, assigned_by, assigned_by_role, assignment_type, reason)
             VALUES ($1, $2, $3, 'admin', 'DISPATCH', 'Direct bypass');`,
              [repairId, tech1ProfileId, adminProfileId],
            );
          },
          (err) => {
            assert.equal(err.code, "42501");
            assert.match(err.message, /permission denied for table repair_assignment_history/i);
            return true;
          },
        );

        // Authenticated client direct UPDATE
        await assert.rejects(
          async () => {
            await adminClient.query(
              "UPDATE public.repair_assignment_history SET reason = 'Tampered' WHERE repair_request_id = $1;",
              [repairId],
            );
          },
          (err) => {
            assert.equal(err.code, "42501");
            assert.match(err.message, /permission denied for table repair_assignment_history/i);
            return true;
          },
        );

        // Authenticated client direct DELETE
        await assert.rejects(
          async () => {
            await adminClient.query(
              "DELETE FROM public.repair_assignment_history WHERE repair_request_id = $1;",
              [repairId],
            );
          },
          (err) => {
            assert.equal(err.code, "42501");
            assert.match(err.message, /permission denied for table repair_assignment_history/i);
            return true;
          },
        );
      },
    );

    // =========================================================================
    // Test 14: Non-Forgeable Actor Identity and Audit Immutability
    // =========================================================================
    await t.test(
      "Audit records bind non-forgeably to caller session identity and role",
      async () => {
        const histRes = await master.query(
          "SELECT assigned_by, assigned_by_role FROM public.repair_assignment_history WHERE repair_request_id = $1 ORDER BY created_at ASC;",
          [repairId],
        );
        assert.ok(histRes.rows.length >= 2);

        // Admin dispatches are strictly tied to adminProfileId and 'admin'
        for (const row of histRes.rows) {
          assert.equal(row.assigned_by, adminProfileId);
          assert.equal(row.assigned_by_role, "admin");
        }
      },
    );
  },
);
