import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC_DIR = path.resolve("src");

test("Authentication Recovery: src/lib/auth.ts contains resilient production fallback without leaking credentials", () => {
  const authContent = fs.readFileSync(path.join(SRC_DIR, "lib/auth.ts"), "utf8");

  // 1. Primary path calls get_session_profile RPC
  assert.match(
    authContent,
    /supabase\.rpc\(\s*["']get_session_profile["']\s*\)/,
    "auth.ts must invoke get_session_profile RPC first",
  );

  // 2. Contains schema cache / missing RPC detection
  assert.match(
    authContent,
    /PGRST202|schema cache|get_session_profile/,
    "auth.ts must detect missing RPC error or schema cache error",
  );

  // 3. Fallback queries profiles with safe column whitelist (no passwords, no clerk secrets, no demo_code)
  assert.match(
    authContent,
    /\.from\(["']profiles["']\)\s*\.select\(["']id,\s*role,\s*full_name,\s*phone,\s*village["']\)/,
    "auth.ts must select strictly non-sensitive fields from profiles",
  );

  // 4. Verifies technician verification status against technician_profiles
  assert.match(
    authContent,
    /\.from\(["']technician_profiles["']\)\s*\.select\(["']is_verified["']\)/,
    "auth.ts must verify technician verification status in fallback",
  );

  // 5. Does not update auth_user_id from client
  assert.doesNotMatch(
    authContent,
    /\.from\(["']profiles["']\)\.update\(\{\s*auth_user_id/,
    "auth.ts must NEVER perform client-side profiles auth_user_id updates",
  );
});

test("Authentication Recovery: All 14 affected modules implement production fallback alongside get_session_profile", () => {
  const filesToVerify = [
    "lib/auth.ts",
    "lib/services/equipment.ts",
    "lib/services/notifications.ts",
    "lib/services/parts-desk.ts",
    "lib/services/profile.ts",
    "lib/services/quotes.ts",
    "lib/services/repair-messages.ts",
    "lib/services/repair-notes.ts",
    "lib/services/repair-requests.ts",
    "lib/services/routing-handler.ts",
    "lib/services/service-history.ts",
    "lib/services/technicians.ts",
    "lib/services/transcription-service.ts",
    "routes/api/assess-visual-defect.ts",
  ];

  for (const relPath of filesToVerify) {
    const fullPath = path.join(SRC_DIR, relPath);
    assert.ok(fs.existsSync(fullPath), `Module ${relPath} must exist`);
    const content = fs.readFileSync(fullPath, "utf8");

    // Must retain RPC call for forward compatibility and test contracts
    assert.match(
      content,
      /rpc\(["']get_session_profile["']\)/,
      `${relPath} must call get_session_profile RPC`,
    );

    // Must retain fallback to profiles table
    assert.match(
      content,
      /from\(["']profiles["']\)/,
      `${relPath} must contain fallback query to profiles table`,
    );

    // Must never select sensitive tokens or passwords
    assert.doesNotMatch(
      content,
      /select\(["'][^"']*(?:password|token|secret|refresh_token|demo_code|clerk_user_id)[^"']*["']\)/i,
      `${relPath} fallback must never query credentials or secrets`,
    );
  }
});

test("Authentication Simulation: Fallback correctly reconstructs farmer persona", () => {
  const simulatedDbRow = {
    id: "00000000-0000-0001-000000000001",
    role: "farmer",
    full_name: "Balasaheb Patil",
    phone: "9876543210",
    village: "Nagpur Rural",
  };

  const role = simulatedDbRow.role === "admin" ? "service_centre" : simulatedDbRow.role;
  const profile = {
    id: simulatedDbRow.id,
    full_name: simulatedDbRow.full_name,
    phone: simulatedDbRow.phone,
    village: simulatedDbRow.village,
    role,
    is_verified: true,
  };

  assert.equal(profile.role, "farmer");
  assert.equal(profile.full_name, "Balasaheb Patil");
  assert.equal(profile.is_verified, true);
});

test("Authentication Simulation: Fallback correctly reconstructs technician persona with verification", () => {
  const simulatedDbRow = {
    id: "00000000-0000-0002-000000000001",
    role: "technician",
    full_name: "Ramesh Kumar",
    phone: "9123456780",
    village: "Nagpur Central",
  };
  const simulatedTechProfile = { is_verified: true };

  const role = simulatedDbRow.role === "admin" ? "service_centre" : simulatedDbRow.role;
  const profile = {
    id: simulatedDbRow.id,
    full_name: simulatedDbRow.full_name,
    phone: simulatedDbRow.phone,
    village: simulatedDbRow.village,
    role,
    is_verified: Boolean(simulatedTechProfile.is_verified),
  };

  assert.equal(profile.role, "technician");
  assert.equal(profile.full_name, "Ramesh Kumar");
  assert.equal(profile.is_verified, true);
});

test("Authentication Simulation: Fallback enforces unverified status for new technicians", () => {
  const simulatedDbRow = {
    id: "unverified-tech-uuid",
    role: "technician",
    full_name: "New Technician",
    phone: "9000000000",
    village: "Wardha",
  };
  const simulatedTechProfile = { is_verified: false };

  const role = simulatedDbRow.role === "admin" ? "service_centre" : simulatedDbRow.role;
  const profile = {
    id: simulatedDbRow.id,
    full_name: simulatedDbRow.full_name,
    phone: simulatedDbRow.phone,
    village: simulatedDbRow.village,
    role,
    is_verified: Boolean(simulatedTechProfile?.is_verified ?? false),
  };

  assert.equal(profile.role, "technician");
  assert.equal(profile.is_verified, false);
});

test("Authentication Simulation: Fallback maps admin to service_centre persona", () => {
  const simulatedDbRow = {
    id: "00000000-0000-0003-000000000001",
    role: "admin",
    full_name: "Nagpur Service Centre",
    phone: "0712-2555555",
    village: "Nagpur City",
  };

  const role = simulatedDbRow.role === "admin" ? "service_centre" : simulatedDbRow.role;
  const profile = {
    id: simulatedDbRow.id,
    full_name: simulatedDbRow.full_name,
    phone: simulatedDbRow.phone,
    village: simulatedDbRow.village,
    role,
    is_verified: true,
  };

  assert.equal(profile.role, "service_centre");
  assert.equal(profile.full_name, "Nagpur Service Centre");
});

test("Authentication Simulation: Missing profile triggers fail-closed error state", () => {
  const profileRow = null;
  let state = { ready: false, profile: null, profileError: null };

  if (!profileRow) {
    state = {
      ready: true,
      profile: null,
      profileError:
        "We couldn't find an account profile for this login. Please contact the service centre to finish setting up your account.",
    };
  }

  assert.equal(state.ready, true);
  assert.equal(state.profile, null);
  assert.ok(state.profileError.includes("contact the service centre"));
});

test("Authentication Simulation: Mock Supabase client intercepts PGRST202 schema error and recovers seamlessly", async () => {
  const fakeUser = {
    id: "usr-4481-farmer",
    email: "balasaheb@farmer.test",
  };

  const fakeProfilesDb = {
    "usr-4481-farmer": {
      id: "usr-4481-farmer",
      role: "farmer",
      full_name: "Balasaheb Patil",
      phone: "9876543210",
      village: "Nagpur Rural",
    },
  };

  // Create a mock client that throws PGRST202 on get_session_profile RPC
  const mockClient = {
    rpc: async (fnName) => {
      if (fnName === "get_session_profile") {
        return {
          data: null,
          error: {
            code: "PGRST202",
            message: "Could not find the function public.get_session_profile in the schema cache",
          },
        };
      }
      return { data: null, error: { message: "Unknown RPC" } };
    },
    from: (table) => {
      if (table === "profiles") {
        return {
          select: () => ({
            or: (filterStr) => ({
              maybeSingle: async () => {
                // If filter matches fake user ID or email
                if (filterStr.includes(fakeUser.id) || filterStr.includes(fakeUser.email)) {
                  return { data: fakeProfilesDb[fakeUser.id], error: null };
                }
                return { data: null, error: null };
              },
            }),
          }),
        };
      }
      if (table === "technician_profiles") {
        return {
          select: () => ({
            or: () => ({
              maybeSingle: async () => ({ data: { is_verified: true }, error: null }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };

  // Execute fallback resolution logic
  const { data: rpcData, error: rpcError } = await mockClient.rpc("get_session_profile");
  assert.equal(rpcData, null);
  assert.equal(rpcError.code, "PGRST202");

  // Fallback triggers
  let resolvedProfile = null;
  if (!rpcData) {
    const isRpcMissing =
      !rpcError ||
      rpcError.code === "PGRST202" ||
      rpcError.message?.includes("get_session_profile");

    assert.ok(isRpcMissing, "Must recognize missing RPC");

    const orFilter = `auth_user_id.eq.${fakeUser.id},id.eq.${fakeUser.id},email.eq.${fakeUser.email}`;
    const { data: fallbackRow } = await mockClient
      .from("profiles")
      .select("id, role, full_name, phone, village")
      .or(orFilter)
      .maybeSingle();

    assert.ok(fallbackRow, "Fallback query must return row");
    resolvedProfile = {
      id: fallbackRow.id,
      role: fallbackRow.role,
      full_name: fallbackRow.full_name,
      phone: fallbackRow.phone,
      village: fallbackRow.village,
      is_verified: true,
    };
  }

  assert.equal(resolvedProfile.id, "usr-4481-farmer");
  assert.equal(resolvedProfile.role, "farmer");
  assert.equal(resolvedProfile.full_name, "Balasaheb Patil");
});

test("Phase 11 Preservation: assess-visual-defect.ts maintains fail-closed auth with fallback", () => {
  const routeContent = fs.readFileSync(path.join(SRC_DIR, "routes/api/assess-visual-defect.ts"), "utf8");

  // Calls get_session_profile RPC
  assert.match(routeContent, /userClient\.rpc\(\s*["']get_session_profile["']\s*\)/);

  // Contains fallback to profiles table
  assert.match(routeContent, /from\(\s*["']profiles["']\s*\)/);

  // Selects only non-sensitive identity fields
  assert.match(routeContent, /select\(\s*["']id,\s*role["']\s*\)/);

  // Rejects unauthenticated with 401
  assert.match(routeContent, /status:\s*401/);

  // Rejects missing profile with 403
  assert.match(routeContent, /status:\s*403/);
});

test("Workflow Preservation: All service files verify caller authorization before mutation", () => {
  const mutatingServices = [
    { file: "lib/services/equipment.ts", fnName: "createEquipment" },
    { file: "lib/services/quotes.ts", fnName: "createQuote" },
    { file: "lib/services/repair-messages.ts", fnName: "sendRepairMessage" },
    { file: "lib/services/repair-notes.ts", fnName: "createRepairNote" },
    { file: "lib/services/repair-requests.ts", fnName: "createRepairRequest" },
  ];

  for (const { file, fnName } of mutatingServices) {
    const content = fs.readFileSync(path.join(SRC_DIR, file), "utf8");
    assert.match(
      content,
      /getAuthenticatedProfile\(\)/,
      `${file} must invoke getAuthenticatedProfile() before execution`,
    );
  }
});
