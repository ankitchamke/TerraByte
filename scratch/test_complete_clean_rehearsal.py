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
    cmd = [PSQL, "-h", HOST, "-p", PORT, "-U", USER, "-d", db, "-w", "-c", sql]
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    return res.returncode, res.stdout, res.stderr

def run_file(filepath, db="terabyte_schema_only_drill"):
    cmd = [PSQL, "-h", HOST, "-p", PORT, "-U", USER, "-d", db, "-w", "-f", filepath]
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    return res.returncode, res.stdout, res.stderr

print("=================================================================")
print(" TerraByte Step 5B.17: Complete Clean Install Rehearsal Drill    ")
print("=================================================================")

print("\n1. Re-creating pristine test database 'terabyte_schema_only_drill'...")
run_cmd("DROP DATABASE IF EXISTS terabyte_schema_only_drill;")
run_cmd("CREATE DATABASE terabyte_schema_only_drill;")

# Mocks for Supabase environment (Supabase cloud platforms provide these natively)
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

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT '00000000-0000-0000-0000-000000000000'::uuid;
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT 'authenticated';
$$;
CREATE OR REPLACE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT 'test@example.com';
$$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT '{}'::jsonb;
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;
"""
run_cmd(init_sql, db="terabyte_schema_only_drill")

# Step 2: Canonical DDL Snapshot
schema_path = r"D:\TerraByte_Backups\production_backup_20261103_151328\terabyte_public_schema.sql"
print(f"\n2. Applying Canonical Schema DDL Baseline: {schema_path}...")
rc, out, err = run_file(schema_path, db="terabyte_schema_only_drill")
err_lines = [l for l in err.splitlines() if "ERROR" in l and "schema \"public\" already exists" not in l]
print(f"   -> Result: ExitCode={rc}, Non-Trivial Errors={len(err_lines)}")
for el in err_lines:
    print(f"      [ERROR] {el}")

# Step 3: Sequential Forward Migrations
forward_sequence = [
  "supabase/migrations/20261104100000_profile_security_separation.sql",
  "supabase/migrations/20261104110000_complete_phase9_parts_desk_rpcs.sql",
  "supabase/migrations/20261104120000_complete_phase9_realtime_and_eta.sql",
  "supabase/migrations/20261104130000_complete_phase5_3_technician_registration_notification.sql"
]

all_errors = []
print("\n3. Applying Sequential Forward Migrations...")
for mig in forward_sequence:
    fname = os.path.basename(mig)
    rc, out, err = run_file(mig, db="terabyte_schema_only_drill")
    err_lines = [l for l in err.splitlines() if "ERROR" in l]
    print(f"   -> {fname}: ExitCode={rc}, Errors={len(err_lines)}")
    for el in err_lines:
        print(f"      [ERROR] {el}")
        all_errors.append((fname, el))

# Step 4: Verification of Database Objects
print("\n4. Catalog Verification...")
sql_tables = "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;"
rc, out, err = run_cmd(sql_tables, db="terabyte_schema_only_drill")
tables = [l.strip() for l in out.splitlines() if l.strip() and not l.startswith('-') and not l.startswith('table_name') and not '(' in l]

sql_funcs = "SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public' ORDER BY routine_name;"
rc, out, err = run_cmd(sql_funcs, db="terabyte_schema_only_drill")
routines = [l.strip() for l in out.splitlines() if l.strip() and not l.startswith('-') and not l.startswith('routine_name') and not '(' in l]

print(f"   Total Public Tables: {len(tables)}")
print(f"   Tables: {', '.join(tables)}")
print(f"   Total Public Routines: {len(routines)}")

# Verify 12 core RPCs
core_rpcs = [
  "get_session_profile",
  "delete_user_account",
  "reset_demo_data",
  "admin_provision_staff",
  "check_table_rls",
  "confirm_service_centre_part_handoff",
  "adjust_service_centre_part_stock",
  "request_service_centre_part",
  "receive_service_centre_stock",
  "return_service_centre_part",
  "create_quote_atomic",
  "revise_quote_atomic",
  "update_service_centre_part_request_eta",
  "notify_admin_on_technician_registration"
]

rc, out, err = run_cmd("SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public';", db="terabyte_schema_only_drill")
existing_routines = set(out.split())

rpc_status = {}
print("\n5. Critical RPC Verification:")
for rpc in core_rpcs:
    status = "PRESENT" if rpc in existing_routines else "MISSING"
    rpc_status[rpc] = status
    print(f"   - {rpc:<45}: {status}")

# Step 5: Idempotency Re-application
print("\n6. Testing Idempotency (Re-running all forward migrations)...")
idempotency_errors = []
for mig in forward_sequence:
    fname = os.path.basename(mig)
    rc, out, err = run_file(mig, db="terabyte_schema_only_drill")
    err_lines = [l for l in err.splitlines() if "ERROR" in l]
    print(f"   -> Re-apply {fname}: ExitCode={rc}, Errors={len(err_lines)}")
    for el in err_lines:
        print(f"      [ERROR] {el}")
        idempotency_errors.append((fname, el))

# Save report JSON
report = {
    "clean_install_success": (len(err_lines) == 0 and len(all_errors) == 0),
    "tables_count": len(tables),
    "tables": tables,
    "routines_count": len(routines),
    "rpc_verification": rpc_status,
    "initial_forward_errors": len(all_errors),
    "idempotency_errors": len(idempotency_errors)
}

with open("scratch/clean_rehearsal_results.json", "w") as f:
    json.dump(report, f, indent=2)

print("\nRehearsal completed successfully. Results saved to scratch/clean_rehearsal_results.json")
