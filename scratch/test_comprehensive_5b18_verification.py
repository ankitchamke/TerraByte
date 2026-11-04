import subprocess
import os
import json

PG_BIN = r"D:\TerraByte_Drill\pgsql17\pgsql\bin"
PSQL = os.path.join(PG_BIN, "psql.exe")
PORT = "5433"
HOST = "127.0.0.1"
USER = "postgres"

env = os.environ.copy()
env["PGPASSWORD"] = "postgres"

def run_cmd(sql, db="postgres"):
    cmd = [PSQL, "-h", HOST, "-p", PORT, "-U", USER, "-d", db, "-w", "-t", "-c", sql]
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    return res.returncode, res.stdout, res.stderr

def run_file(filepath, db="terabyte_step5b18_drill"):
    cmd = [PSQL, "-h", HOST, "-p", PORT, "-U", USER, "-d", db, "-w", "-f", filepath]
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    return res.returncode, res.stdout, res.stderr

print("=================================================================")
print(" TerraByte Step 5B.18: Comprehensive Clean-Install Verification   ")
print("=================================================================")

# 1. Fresh Database Creation
print("\n1. Resetting test database 'terabyte_step5b18_drill'...")
run_cmd("DROP DATABASE IF EXISTS terabyte_step5b18_drill;")
run_cmd("CREATE DATABASE terabyte_step5b18_drill;")

# 2. Supabase Platform Emulation Layer
print("2. Emulating Supabase Platform Primitives (auth, storage, roles, publication)...")
init_sql = """
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  public boolean DEFAULT false,
  avif_autodetection boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    '00000000-0000-0000-0000-000000000000'
  )::uuid;
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    'authenticated'
  );
$$;
CREATE OR REPLACE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    'test@example.com'
  );
$$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT json_build_object(
    'sub', auth.uid()::text,
    'role', auth.role(),
    'email', auth.email()
  )::jsonb;
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;
"""
run_cmd(init_sql, db="terabyte_step5b18_drill")

# 3. Apply Baseline DDL
schema_path = r"D:\TerraByte_Backups\production_backup_20261103_151328\terabyte_public_schema.sql"
print(f"3. Applying Baseline Schema DDL: {schema_path}...")
rc, out, err = run_file(schema_path)
non_trivial_errors = [l for l in err.splitlines() if "ERROR" in l and "already exists" not in l]
print(f"   -> ExitCode={rc}, Non-Trivial Errors={len(non_trivial_errors)}")

# 4. Apply Forward Migrations in Exact Order
forward_sequence = [
  "supabase/migrations/20261103120000_phase11_visual_defect_diagnostics.sql",
  "supabase/migrations/20261104100000_profile_security_separation.sql",
  "supabase/migrations/20261104110000_complete_phase9_parts_desk_rpcs.sql",
  "supabase/migrations/20261104120000_complete_phase9_realtime_and_eta.sql",
  "supabase/migrations/20261104130000_complete_phase5_3_technician_registration_notification.sql"
]

print("\n4. Applying Forward Migrations in Exact Order...")
mig_errors = []
for mig in forward_sequence:
    fname = os.path.basename(mig)
    rc, out, err = run_file(mig)
    err_lines = [l for l in err.splitlines() if "ERROR" in l]
    print(f"   -> {fname}: ExitCode={rc}, Errors={len(err_lines)}")
    for el in err_lines:
        print(f"      [ERROR] {el}")
        mig_errors.append((fname, el))

# 5. Idempotency Test (Re-run All Forward Migrations)
print("\n5. Testing Idempotency (Second Pass Execution of All Forward Migrations)...")
idempotency_errors = []
for mig in forward_sequence:
    fname = os.path.basename(mig)
    rc, out, err = run_file(mig)
    err_lines = [l for l in err.splitlines() if "ERROR" in l]
    print(f"   -> Re-apply {fname}: ExitCode={rc}, Errors={len(err_lines)}")
    for el in err_lines:
        print(f"      [ERROR] {el}")
        idempotency_errors.append((fname, el))

# 6. Apply Synthetic Fixtures
seed_path = "scratch/staging_synthetic_seed.sql"
print(f"\n6. Seeding Synthetic Privacy-Compliant Fixtures: {seed_path}...")
rc, out, err = run_file(seed_path)
seed_errors = [l for l in err.splitlines() if "ERROR" in l]
print(f"   -> ExitCode={rc}, Errors={len(seed_errors)}")
for el in seed_errors:
    print(f"      [ERROR] {el}")

# 7. Comprehensive Catalog Audit
print("\n7. Auditing Resulting Catalog...")
rc, out, err = run_cmd("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';", db="terabyte_step5b18_drill")
table_count = int(out.strip().split()[-1])

rc, out, err = run_cmd("SELECT count(*) FROM information_schema.routines WHERE routine_schema = 'public';", db="terabyte_step5b18_drill")
routine_count = int(out.strip().split()[-1])

rc, out, err = run_cmd("SELECT count(*) FROM pg_policies WHERE schemaname = 'public';", db="terabyte_step5b18_drill")
policy_count = int(out.strip().split()[-1])

print(f"   Public Base Tables: {table_count} (Expected 18)")
print(f"   Public Routines: {routine_count}")
print(f"   Public RLS Policies: {policy_count}")

# 8. Check RLS Enforcement on All 18 Tables
rls_check_sql = """
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity 
FROM pg_class c 
JOIN pg_namespace n ON c.relnamespace = n.oid 
WHERE n.nspname = 'public' AND c.relkind = 'r' 
ORDER BY c.relname;
"""
rc, out, err = run_cmd(rls_check_sql, db="terabyte_step5b18_drill")
lines = [l.strip() for l in out.splitlines() if '|' in l and not 'relname' in l]
disabled_rls = [l.split('|')[0].strip() for l in lines if 'f' in l.split('|')[1]]

print(f"   RLS Enabled on all tables: {len(disabled_rls) == 0}")
if disabled_rls:
    print(f"   WARNING: RLS disabled on {disabled_rls}")

# 9. Verify 6 Frontend RPCs directly callable
frontend_rpcs = [
  "get_session_profile",
  "delete_user_account",
  "reset_demo_data",
  "claim_repair_visual_diagnostic",
  "save_repair_visual_diagnostic",
  "finalize_repair_visual_diagnostic_failure"
]

rc, out, err = run_cmd("SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public';", db="terabyte_step5b18_drill")
routines_set = set(out.split())

rpc_presence = {rpc: (rpc in routines_set) for rpc in frontend_rpcs}
print("\n8. Frontend Critical RPC Availability:")
for rpc, present in rpc_presence.items():
    print(f"   - {rpc:<45}: {'PRESENT' if present else 'MISSING'}")

# Save JSON results
report = {
    "clean_install_success": (rc == 0 and len(non_trivial_errors) == 0 and len(mig_errors) == 0 and len(seed_errors) == 0),
    "tables_count": table_count,
    "routines_count": routine_count,
    "policies_count": policy_count,
    "rls_disabled_tables": disabled_rls,
    "frontend_rpc_presence": rpc_presence,
    "idempotency_errors_count": len(idempotency_errors)
}

with open("scratch/step5b18_comprehensive_verification.json", "w") as f:
    json.dump(report, f, indent=2)

print("\nVerification execution complete! Saved to scratch/step5b18_comprehensive_verification.json")
