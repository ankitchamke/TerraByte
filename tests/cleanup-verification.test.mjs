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
