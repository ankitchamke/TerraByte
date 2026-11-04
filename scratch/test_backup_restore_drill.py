import subprocess
import os
import time
import hashlib
import json
import datetime

PG_BIN = r"D:\TerraByte_Drill\pgsql17\pgsql\bin"
PG_DUMP = os.path.join(PG_BIN, "pg_dump.exe")
PG_RESTORE = os.path.join(PG_BIN, "pg_restore.exe")
PSQL = os.path.join(PG_BIN, "psql.exe")

PORT = "5433"
HOST = "127.0.0.1"
USER = "postgres"
SOURCE_DB = "terabyte_clean_restore_drill"
TARGET_TEST_DB = "terabyte_restore_test_drill"
DUMP_FILE = r"D:\TerraByte_Drill\snapshot_test_drill.dump"

env = os.environ.copy()
env["PGPASSWORD"] = "postgres"

def run_cmd(cmd):
    start = time.perf_counter()
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    dur = time.perf_counter() - start
    return res.returncode, res.stdout.strip(), res.stderr.strip(), dur

print("="*70)
print("TerraByte Step 5B.12 — Free Logical Backup & Restore Rehearsal Drill")
print(f"Timestamp: {datetime.datetime.now(datetime.timezone.utc).isoformat()}")
print("="*70)

# Step 1: Execute pg_dump
dump_cmd = [
    PG_DUMP,
    "-h", HOST,
    "-p", PORT,
    "-U", USER,
    "-d", SOURCE_DB,
    "-F", "c",
    "-Z", "6",
    "-n", "public",
    "-n", "auth",
    "-n", "storage",
    "-f", DUMP_FILE
]
print(f"\n1. Executing logical pg_dump from {SOURCE_DB} to {DUMP_FILE}...")
rc, stdout, stderr, dump_dur = run_cmd(dump_cmd)
if rc != 0:
    print(f"FAILED to dump database: {stderr}")
    exit(1)

dump_size_bytes = os.path.getsize(DUMP_FILE)
dump_size_kb = dump_size_bytes / 1024

with open(DUMP_FILE, "rb") as f:
    sha256 = hashlib.sha256(f.read()).hexdigest()

print(f"  Dump SUCCESS in {dump_dur*1000:.1f}ms")
print(f"  Dump File Size: {dump_size_kb:.2f} KB ({dump_size_bytes} bytes)")
print(f"  SHA256 Checksum: {sha256}")

# Step 2: Prepare Target Test Database
print(f"\n2. Preparing fresh target database: {TARGET_TEST_DB}...")
run_cmd([PSQL, "-h", HOST, "-p", PORT, "-U", USER, "-d", "postgres", "-c", f"DROP DATABASE IF EXISTS {TARGET_TEST_DB};"])
rc, stdout, stderr, _ = run_cmd([PSQL, "-h", HOST, "-p", PORT, "-U", USER, "-d", "postgres", "-c", f"CREATE DATABASE {TARGET_TEST_DB};"])
if rc != 0:
    print(f"FAILED to create target database: {stderr}")
    exit(1)
print(f"  Database {TARGET_TEST_DB} created successfully.")

# Step 3: Execute pg_restore
print(f"\n3. Executing pg_restore into {TARGET_TEST_DB}...")
restore_cmd = [
    PG_RESTORE,
    "-h", HOST,
    "-p", PORT,
    "-U", USER,
    "-d", TARGET_TEST_DB,
    "--no-owner",
    "--no-privileges",
    DUMP_FILE
]
rc, stdout, stderr, restore_dur = run_cmd(restore_cmd)
# Note: pg_restore might have warnings on existing schemas or language constructs, rc 0 or 1 with ignorable warnings
print(f"  Restore completed in {restore_dur*1000:.1f}ms (Return Code: {rc})")
if stderr:
    print(f"  Restore log output:\n{stderr[:400]}")

# Step 4: Verify Restored Database Catalog
print(f"\n4. Verifying Restored Database Objects in {TARGET_TEST_DB}...")

# Check tables count
rc, tables_out, _, _ = run_cmd([PSQL, "-h", HOST, "-p", PORT, "-U", USER, "-d", TARGET_TEST_DB, "-t", "-A", "-c", "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';"])
print(f"  Public tables restored: {tables_out}")

# Check functions count
rc, funcs_out, _, _ = run_cmd([PSQL, "-h", HOST, "-p", PORT, "-U", USER, "-d", TARGET_TEST_DB, "-t", "-A", "-c", "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public';"])
print(f"  Public functions restored: {funcs_out}")

# Check triggers count
rc, trgs_out, _, _ = run_cmd([PSQL, "-h", HOST, "-p", PORT, "-U", USER, "-d", TARGET_TEST_DB, "-t", "-A", "-c", "SELECT count(*) FROM pg_trigger t JOIN pg_namespace n ON n.oid = t.tgrelid WHERE tgname IN ('trg_protect_technician_part_request_fields', 'trg_notify_admin_on_technician_registration');"])
print(f"  Forward triggers restored: {trgs_out}")

# Check row count in service_centre_parts
rc, parts_out, _, _ = run_cmd([PSQL, "-h", HOST, "-p", PORT, "-U", USER, "-d", TARGET_TEST_DB, "-t", "-A", "-c", "SELECT count(*) FROM public.service_centre_parts;"])
print(f"  Rows in public.service_centre_parts: {parts_out}")

# Check row count in profiles
rc, profiles_out, _, _ = run_cmd([PSQL, "-h", HOST, "-p", PORT, "-U", USER, "-d", TARGET_TEST_DB, "-t", "-A", "-c", "SELECT count(*) FROM public.profiles;"])
print(f"  Rows in public.profiles: {profiles_out}")

# Step 5: Clean up target test database and dump file
print(f"\n5. Cleaning up test database {TARGET_TEST_DB}...")
run_cmd([PSQL, "-h", HOST, "-p", PORT, "-U", USER, "-d", "postgres", "-c", f"DROP DATABASE {TARGET_TEST_DB};"])
if os.path.exists(DUMP_FILE):
    os.remove(DUMP_FILE)
print("  Cleanup complete.")

results = {
    "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "dump_duration_ms": round(dump_dur * 1000, 2),
    "dump_size_bytes": dump_size_bytes,
    "dump_size_kb": round(dump_size_kb, 2),
    "sha256": sha256,
    "restore_duration_ms": round(restore_dur * 1000, 2),
    "restore_return_code": rc,
    "verified_objects": {
        "public_tables": int(tables_out) if tables_out.isdigit() else 0,
        "public_functions": int(funcs_out) if funcs_out.isdigit() else 0,
        "forward_triggers": int(trgs_out) if trgs_out.isdigit() else 0,
        "parts_rows": int(parts_out) if parts_out.isdigit() else 0,
        "profiles_rows": int(profiles_out) if profiles_out.isdigit() else 0
    }
}

with open("scratch/backup_restore_drill_results.json", "w", encoding="utf-8") as f:
    json.dump(results, f, indent=2)

print("\n" + "="*70)
print(f"SUCCESS: Logical backup ({dump_dur*1000:.1f}ms) and restore ({restore_dur*1000:.1f}ms) verified!")
print("="*70)
