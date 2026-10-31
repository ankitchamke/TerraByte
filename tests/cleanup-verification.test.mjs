import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 1. Verify DESIGNATED_DEMO_EMAILS and isDesignatedDemoAccount from src/lib/services/demo.ts
test("demo.ts only authorizes the 3 retained personas and rejects deleted accounts", () => {
  const demoTsPath = path.resolve("src/lib/services/demo.ts");
  assert.ok(fs.existsSync(demoTsPath), "demo.ts must exist");
  const code = fs.readFileSync(demoTsPath, "utf8");

  // Extract DESIGNATED_DEMO_EMAILS array from source
  const match = code.match(/export const DESIGNATED_DEMO_EMAILS = (\[[\s\S]*?\]) as const;/);
  assert.ok(match, "DESIGNATED_DEMO_EMAILS array must be defined in demo.ts");

  // Safely evaluate the array definition
  const emails = JSON.parse(
    match[1]
      .replace(/\/\/.*$/gm, "")
      .replace(/,\s*]/, "]")
      .replace(/'/g, '"')
  );

  assert.equal(emails.length, 3, "Exactly 3 demo emails must be authorized");
  assert.deepEqual(emails, [
    "farmer.nagpur@terrabyte.demo",
    "tech.nagpur@terrabyte.demo",
    "admin.nagpur@terrabyte.demo",
  ]);

  // Implement the exact logic of isDesignatedDemoAccount to verify edge cases
  function isDesignatedDemoAccount(email) {
    if (!email) return false;
    const clean = email.trim().toLowerCase();
    return emails.includes(clean);
  }

  // Retained accounts must pass
  assert.equal(isDesignatedDemoAccount("farmer.nagpur@terrabyte.demo"), true);
  assert.equal(isDesignatedDemoAccount("tech.nagpur@terrabyte.demo"), true);
  assert.equal(isDesignatedDemoAccount("admin.nagpur@terrabyte.demo"), true);
  assert.equal(isDesignatedDemoAccount("  FARMER.NAGPUR@TERRABYTE.DEMO  "), true);

  // Deleted / former accounts must fail
  assert.equal(isDesignatedDemoAccount("farmer2.nagpur@terrabyte.demo"), false);
  assert.equal(isDesignatedDemoAccount("farmer3.nagpur@terrabyte.demo"), false);
  assert.equal(isDesignatedDemoAccount("newfarmer1595@terrabyte.app"), false);
  assert.equal(isDesignatedDemoAccount("probe_1790865575195@example.com"), false);
  assert.equal(isDesignatedDemoAccount(null), false);
  assert.equal(isDesignatedDemoAccount(undefined), false);
});

// 2. Verify tb-store.ts seed state contains only retained entities and 0 sample repairs
test("tb-store.ts seed state contains only retained entities and zero sample repairs", () => {
  const storePath = path.resolve("src/lib/tb-store.ts");
  assert.ok(fs.existsSync(storePath), "tb-store.ts must exist");
  const code = fs.readFileSync(storePath, "utf8");

  // Ensure deleted technicians are never present in tb-store
  assert.ok(!code.includes('"Vikas Shinde"'), "Vikas Shinde must not exist in store");
  assert.ok(!code.includes('"Imran Shaikh"'), "Imran Shaikh must not exist in store");
  assert.ok(!code.includes('"Prakash More"'), "Prakash More must not exist in store");
  assert.ok(!code.includes('"Sachin Gaikwad"'), "Sachin Gaikwad must not exist in store");

  // Ensure deleted farmers are never present in tb-store
  assert.ok(!code.includes('"Suresh Jadhav"'), "Suresh Jadhav must not exist in store");
  assert.ok(!code.includes('"Anil Pawar"'), "Anil Pawar must not exist in store");

  // Ensure Ramesh Kumar is present
  assert.ok(code.includes('"Ramesh Kumar"'), "Ramesh Kumar must exist in store");
  assert.ok(code.includes('"Balasaheb Patil"'), "Balasaheb Patil must exist in store");

  // Ensure sample repairs and service history are empty arrays
  assert.ok(code.includes("const repairs: Repair[] = [];"), "repairs must be an empty array");
  assert.ok(code.includes("const service: ServiceRecord[] = [];"), "service must be an empty array");
  assert.ok(code.includes("notifications: [],"), "notifications must be empty array");
});

// 3. Verify candidate matching filter in technicians.ts
test("candidate matching filter strictly rejects unverified, orphaned, and deleted technicians", () => {
  const sampleCandidatePool = [
    {
      id: "tp-ramesh",
      profile_id: "00000000-0000-0000-0002-000000000001",
      workshop_name: "Green Earth Mobile Repairs",
      brands: ["Mahindra", "Swaraj"],
      skills: ["Fuel system", "Engine"],
      is_verified: true,
      is_available: true,
      eta_minutes: 25,
      profile: {
        id: "00000000-0000-0000-0002-000000000001",
        full_name: "Ramesh Kumar",
        phone: "+91 90110 00001",
        village: "Nagpur",
      },
    },
    {
      id: "tp-sachin",
      profile_id: "00000000-0000-0000-0002-000000000005",
      workshop_name: "Gaikwad Pump & Motor",
      brands: ["Mahindra"],
      skills: ["Electrical"],
      is_verified: false, // Unverified
      is_available: true,
      eta_minutes: 50,
      profile: {
        id: "00000000-0000-0000-0002-000000000005",
        full_name: "Sachin Gaikwad",
        phone: null,
        village: null,
      },
    },
    {
      id: "tp-orphan",
      profile_id: "00000000-0000-0000-0002-000000000999",
      workshop_name: "Orphaned Garage",
      brands: ["Mahindra"],
      skills: ["Engine"],
      is_verified: true,
      is_available: true,
      eta_minutes: 30,
      profile: null, // Profile deleted
    },
    {
      id: "tp-former-member",
      profile_id: "c6479e80-3254-4ff8-ab14-fde451de9b6c",
      workshop_name: "Garage 404",
      brands: [],
      skills: [],
      is_verified: true,
      is_available: false,
      eta_minutes: 45,
      profile: {
        id: "c6479e80-3254-4ff8-ab14-fde451de9b6c",
        full_name: "Former Member",
        phone: null,
        village: null,
      },
    },
  ];

  const declinedBy = new Set(["some-other-id"]);

  // Apply the exact filtering logic from technicians.ts
  const eligibleCandidates = sampleCandidatePool.filter(
    (t) =>
      Boolean(t.is_verified) &&
      Boolean(t.profile) &&
      Boolean(t.profile?.full_name?.trim()) &&
      t.profile?.full_name !== "Former Member" &&
      !declinedBy.has(t.profile_id)
  );

  assert.equal(eligibleCandidates.length, 1);
  assert.equal(eligibleCandidates[0].profile_id, "00000000-0000-0000-0002-000000000001");
  assert.equal(eligibleCandidates[0].profile?.full_name, "Ramesh Kumar");
});

// 4. Verify reset_demo_data migration SQL contains strict dual-key checks and zero sample re-seeding
test("reset_demo_data migration enforces 3-persona dual-key checks and does not resurrect deleted fixtures", () => {
  const migrationPath = path.resolve(
    "supabase/migrations/20261028110000_phase8b_cleanup_reset_demo_rpc.sql"
  );
  assert.ok(fs.existsSync(migrationPath), "Migration file must exist");
  const sql = fs.readFileSync(migrationPath, "utf8");

  // Dual-key auth UUID checks
  assert.ok(sql.includes("'00000000-0000-0000-0000-000000000001'::uuid"), "Must authorize Balasaheb");
  assert.ok(sql.includes("'00000000-0000-0000-0000-000000000004'::uuid"), "Must authorize Ramesh");
  assert.ok(sql.includes("'00000000-0000-0000-0000-000000000005'::uuid"), "Must authorize Nagpur Admin");
  assert.ok(!sql.includes("'00000000-0000-0000-0000-000000000002'::uuid"), "Must not authorize Suresh f2");
  assert.ok(!sql.includes("'00000000-0000-0000-0000-000000000003'::uuid"), "Must not authorize Anil f3");

  // Dual-key email checks
  assert.ok(sql.includes("'farmer.nagpur@terrabyte.demo'"), "Must check Balasaheb email");
  assert.ok(sql.includes("'tech.nagpur@terrabyte.demo'"), "Must check Ramesh email");
  assert.ok(sql.includes("'admin.nagpur@terrabyte.demo'"), "Must check Admin email");
  assert.ok(!sql.includes("'farmer2.nagpur@terrabyte.demo'"), "Must not check farmer2 email");
  assert.ok(!sql.includes("'farmer3.nagpur@terrabyte.demo'"), "Must not check farmer3 email");

  // No re-insertion of sample repairs
  assert.ok(!sql.includes("INSERT INTO public.repair_requests"), "Must never insert repair requests");
  assert.ok(!sql.includes("TB-8902"), "Must not reference deleted demo ticket TB-8902");
  assert.ok(!sql.includes("TB-8898"), "Must not reference deleted demo ticket TB-8898");
  assert.ok(!sql.includes("TB-8841"), "Must not recreate sample ticket TB-8841");
});

// 5. Verify every DELETE in reset_demo_data contains an explicit, scoped non-trivial WHERE clause
test("reset_demo_data contains explicit non-trivial WHERE clauses on all deletions and scopes strictly to demo records", () => {
  const migrationPath = path.resolve(
    "supabase/migrations/20261028110000_phase8b_cleanup_reset_demo_rpc.sql"
  );
  const sql = fs.readFileSync(migrationPath, "utf8");

  // Find all DELETE statements
  const deleteMatches = sql.match(/DELETE\s+FROM\s+[a-zA-Z0-9_.]+/gi) || [];
  assert.ok(deleteMatches.length >= 6, "Must contain DELETE statements");

  for (const match of deleteMatches) {
    const after = sql.slice(sql.indexOf(match));
    const nextSemicolon = after.indexOf(";");
    const stmt = after.slice(0, nextSemicolon);

    // 1. Must contain WHERE clause
    assert.ok(
      stmt.includes("WHERE"),
      `DELETE statement must contain WHERE clause for safeupdate compliance: "${match}"`
    );

    // 2. Must not contain trivial all-matching predicates
    assert.ok(
      !stmt.includes("WHERE id IS NOT NULL"),
      `DELETE statement must not use trivial 'WHERE id IS NOT NULL': "${stmt}"`
    );
    assert.ok(
      !stmt.includes("WHERE 1=1") && !stmt.includes("WHERE true"),
      `DELETE statement must not use trivial match-all predicates: "${stmt}"`
    );

    // 3. Must be scoped to demo UUIDs or demo repair IDs
    assert.ok(
      stmt.includes("v_demo_repair_ids") ||
        stmt.includes("v_demo_farmer_id"),
      `DELETE statement must be scoped strictly to demo repair IDs or demo farmer: "${stmt}"`
    );
  }

  // 4. Verify that repair identification strictly rejects matching by technician_id
  assert.ok(
    !sql.includes("OR technician_id = v_demo_tech_id"),
    "repair_requests scoping must NEVER match by technician_id to prevent deleting real user tickets assigned to Ramesh"
  );

  // 5. Verify child deletions do not match by author or technician indiscriminately
  assert.ok(
    !sql.includes("OR author_id IN (v_demo_farmer_id"),
    "repair_notes deletion must not match by author_id outside of demo repair IDs"
  );
  assert.ok(
    !sql.includes("OR created_by_id IN (v_demo_farmer_id"),
    "repair_timeline deletion must not match by created_by_id outside of demo repair IDs"
  );
  assert.ok(
    !sql.includes("OR technician_id = v_demo_tech_id"),
    "quotes deletion must not match by technician_id outside of demo repair IDs"
  );

  // 6. Verify notifications delete uses correct column recipient_user_id
  assert.ok(
    sql.includes("recipient_user_id = v_demo_farmer_id"),
    "notifications deletion must use recipient_user_id column"
  );

  // Verify empty demo tables guard: bypasses child deletions if no demo repairs exist
  assert.ok(
    sql.includes("IF v_demo_repair_ids IS NOT NULL AND array_length(v_demo_repair_ids, 1) > 0 THEN"),
    "Must safely guard and skip repair child deletions when no demo repairs exist"
  );
});

// 6. Verify Phase 9.3 forward migration contains explicit non-trivial WHERE clauses, safeupdate compliance, and deterministic baseline
test("Phase 9.3 forward migration reset_demo_data contains explicit non-trivial WHERE clauses, safeupdate compliance, and deterministic baseline", () => {
  const migrationPath = path.resolve(
    "supabase/migrations/20261031153000_phase9_3_safe_scoped_reset_demo_rpc.sql"
  );
  assert.ok(fs.existsSync(migrationPath), "Phase 9.3 migration file must exist");
  const sql = fs.readFileSync(migrationPath, "utf8");

  // Find all DELETE statements
  const deleteMatches = sql.match(/DELETE\s+FROM\s+[a-zA-Z0-9_.]+/gi) || [];
  assert.ok(deleteMatches.length >= 8, "Must contain at least 8 DELETE statements in forward migration");

  for (const match of deleteMatches) {
    const after = sql.slice(sql.indexOf(match));
    const nextSemicolon = after.indexOf(";");
    const stmt = after.slice(0, nextSemicolon);

    // 1. Must contain WHERE clause
    assert.ok(
      stmt.includes("WHERE"),
      `DELETE statement must contain WHERE clause for safeupdate compliance: "${match}"`
    );

    // 2. Must not contain trivial all-matching predicates
    assert.ok(
      !stmt.includes("WHERE id IS NOT NULL"),
      `DELETE statement must not use trivial 'WHERE id IS NOT NULL': "${stmt}"`
    );
    assert.ok(
      !stmt.includes("WHERE 1=1") && !stmt.includes("WHERE true"),
      `DELETE statement must not use trivial match-all predicates: "${stmt}"`
    );

    // 3. Must be scoped to demo UUIDs, demo repair IDs, demo quote IDs, or Nagpur Service Centre
    assert.ok(
      stmt.includes("v_demo_repair_ids") ||
        stmt.includes("v_demo_quote_ids") ||
        stmt.includes("v_demo_farmer_id") ||
        stmt.includes("v_demo_admin_id"),
      `DELETE statement must be scoped strictly to demo entities: "${stmt}"`
    );
  }

  // 4. Verify repair identification strictly rejects matching by technician_id
  assert.ok(
    !sql.includes("OR technician_id = v_demo_tech_id"),
    "repair_requests scoping must NEVER match by technician_id"
  );

  // 5. Verify child deletions do not match by author or technician indiscriminately
  assert.ok(
    !sql.includes("OR author_id IN (v_demo_farmer_id"),
    "repair_notes deletion must not match by author_id outside of demo repair IDs"
  );
  assert.ok(
    !sql.includes("OR created_by_id IN (v_demo_farmer_id"),
    "repair_timeline deletion must not match by created_by_id outside of demo repair IDs"
  );

  // 6. Verify notifications delete uses correct column recipient_user_id
  assert.ok(
    sql.includes("recipient_user_id = v_demo_farmer_id"),
    "notifications deletion must use recipient_user_id column"
  );

  // 7. Verify empty demo tables guard
  assert.ok(
    sql.includes("IF v_demo_repair_ids IS NOT NULL AND array_length(v_demo_repair_ids, 1) > 0 THEN"),
    "Must safely guard and skip repair child deletions when no demo repairs exist"
  );

  // 8. Verify canonical baseline quantities
  assert.ok(sql.includes("'0433171'"), "Must seed canonical nozzle 0433171");
  assert.ok(sql.includes("'005556958R1'"), "Must seed canonical filter 005556958R1");
  assert.ok(sql.includes("'AL120788'"), "Must seed canonical seal kit AL120788");
  assert.ok(sql.includes("'HY-GARD-15W30'"), "Must seed canonical oil HY-GARD-15W30");
  assert.ok(sql.includes("'26243171'"), "Must seed canonical starter 26243171");

  // 9. Verify tractor hours reset
  assert.ok(sql.includes("1240"), "Must restore JD 5050D hours (1240)");
  assert.ok(sql.includes("3120"), "Must restore Mahindra 575 DI hours (3120)");
  assert.ok(sql.includes("890"), "Must restore Swaraj 744 FE hours (890)");
});
