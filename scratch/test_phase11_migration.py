import subprocess
import os

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

print("Resetting terabyte_schema_only_drill...")
run_cmd("DROP DATABASE IF EXISTS terabyte_schema_only_drill;")
run_cmd("CREATE DATABASE terabyte_schema_only_drill;")

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

# Baseline
rc, out, err = run_file(r"D:\TerraByte_Backups\production_backup_20261103_151328\terabyte_public_schema.sql")
print("Baseline applied. RC =", rc)

# Test 20261103120000
rc, out, err = run_file("supabase/migrations/20261103120000_phase11_visual_defect_diagnostics.sql")
err_lines = [l for l in err.splitlines() if "ERROR" in l]
print(f"20261103120000 (Phase 11 Visual Defect): ExitCode={rc}, Errors={len(err_lines)}")
for el in err_lines[:5]:
    print("  ->", el)
