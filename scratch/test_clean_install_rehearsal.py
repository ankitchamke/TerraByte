import subprocess
import os
import glob

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

def run_file(filepath, db="terabyte_clean_install_drill"):
    cmd = [PSQL, "-h", HOST, "-p", PORT, "-U", USER, "-d", db, "-w", "-f", filepath]
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    return res.returncode, res.stdout, res.stderr

# 1. Recreate clean drill database
run_cmd("DROP DATABASE IF EXISTS terabyte_clean_install_drill;")
run_cmd("CREATE DATABASE terabyte_clean_install_drill;")

# 2. Setup standard Supabase mock environment (auth schema, storage schema, roles)
init_sql = """
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN CREATE ROLE supabase_admin NOLOGIN; END IF;
END $$;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT COALESCE(nullif(current_setting('request.jwt.claim.sub', true), ''), '00000000-0000-0000-0000-000000000000')::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(nullif(current_setting('request.jwt.claim.email', true), ''), '');
$$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;
"""
rc, out, err = run_cmd(init_sql, db="terabyte_clean_install_drill")
print(f"Supabase base mock init: ExitCode={rc}")

# 3. Test replaying migrations
mig_files = sorted(glob.glob("supabase/migrations/*.sql"))
print(f"\n--- Testing Replay of All {len(mig_files)} Migrations ---")

results = []
for mf in mig_files:
    fname = os.path.basename(mf)
    rc, out, err = run_file(mf, db="terabyte_clean_install_drill")
    err_lines = [l for l in err.splitlines() if "ERROR" in l]
    results.append({
        "file": fname,
        "exit_code": rc,
        "errors": err_lines
    })
    status = "OK" if rc == 0 and not err_lines else f"FAILED ({len(err_lines)} errors)"
    print(f"  {fname:<65} : {status}")
    if err_lines:
        for el in err_lines[:3]:
            print(f"    -> {el}")

failed = [r for r in results if r["exit_code"] != 0 or r["errors"]]
print(f"\nReplay Summary: {len(results)-len(failed)} Passed, {len(failed)} Failed")
