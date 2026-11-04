import subprocess
import os
import time
import json
import datetime

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
PORT = "5433"
HOST = "127.0.0.1"
USER = "postgres"
DB = "terabyte_clean_restore_drill"

env = os.environ.copy()
env["PGPASSWORD"] = "postgres"

MIGRATIONS = [
    {
        "letter": "A",
        "file": "supabase/migrations/20261104110000_complete_phase9_parts_desk_rpcs.sql",
        "name": "Phase 9.1 & 9.2 Parts Desk RPCs & Index Optimization"
    },
    {
        "letter": "B",
        "file": "supabase/migrations/20261104120000_complete_phase9_realtime_and_eta.sql",
        "name": "Phase 9.3 Realtime Publications, ETA & Quote Atomic Operations"
    },
    {
        "letter": "C",
        "file": "supabase/migrations/20261104130000_complete_phase5_3_technician_registration_notification.sql",
        "name": "Phase 5.3 Technician Registration Notification Trigger"
    }
]

def run_psql_file(filepath):
    start = time.perf_counter()
    cmd = [PSQL, "-p", PORT, "-h", HOST, "-U", USER, "-d", DB, "-w", "-v", "ON_ERROR_STOP=1", "-f", filepath]
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    duration = time.perf_counter() - start
    return res.returncode, res.stdout, res.stderr, duration

def run_psql_query(sql):
    cmd = [PSQL, "-p", PORT, "-h", HOST, "-U", USER, "-d", DB, "-w", "-t", "-A", "-c", sql]
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    return res.returncode, res.stdout.strip(), res.stderr.strip()

print("="*70)
print(f"TerraByte Step 5B.12 — Forward Database Migration Rehearsal Drill")
print(f"Target: PostgreSQL 17.6 on {HOST}:{PORT} / {DB}")
print(f"Timestamp: {datetime.datetime.now(datetime.timezone.utc).isoformat()}")
print("="*70)

# Check PG Version
rc, ver, err = run_psql_query("SELECT version();")
if rc != 0:
    print(f"FATAL: Cannot connect to drill DB: {err}")
    exit(1)
print(f"Connected to PG: {ver[:50]}...")

report = {
    "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "pg_version": ver,
    "pass_1": [],
    "pass_2_idempotency": [],
    "catalog_verification": {}
}

# PASS 1: Sequential Migration Application
print("\n--- PASS 1: Sequential Forward Migration Application ---")
all_p1_ok = True
for m in MIGRATIONS:
    print(f"Applying Migration {m['letter']}: {os.path.basename(m['file'])}...")
    rc, stdout, stderr, dur = run_psql_file(m["file"])
    status = "SUCCESS" if rc == 0 else "FAILED"
    print(f"  Status: {status} in {dur*1000:.1f}ms (Return Code: {rc})")
    if rc != 0:
        print(f"  Error output:\n{stderr[:500]}")
        all_p1_ok = False
    report["pass_1"].append({
        "letter": m["letter"],
        "file": m["file"],
        "status": status,
        "return_code": rc,
        "duration_ms": round(dur * 1000, 2),
        "stderr_preview": stderr[:200] if stderr else ""
    })

# PASS 2: Idempotency Re-run
print("\n--- PASS 2: Idempotency Verification (Re-running all 3 migrations) ---")
all_p2_ok = True
for m in MIGRATIONS:
    print(f"Re-applying Migration {m['letter']} (Idempotency check)...")
    rc, stdout, stderr, dur = run_psql_file(m["file"])
    status = "SUCCESS" if rc == 0 else "FAILED"
    print(f"  Status: {status} in {dur*1000:.1f}ms (Return Code: {rc})")
    if rc != 0:
        print(f"  Error output:\n{stderr[:500]}")
        all_p2_ok = False
    report["pass_2_idempotency"].append({
        "letter": m["letter"],
        "file": m["file"],
        "status": status,
        "return_code": rc,
        "duration_ms": round(dur * 1000, 2),
        "stderr_preview": stderr[:200] if stderr else ""
    })

# Verification Queries
print("\n--- CATALOG VERIFICATION DRILL ---")

# 1. Indexes Check
sql_indexes = """
SELECT c.relname, i.indisvalid, i.indisready
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'idx_sc_sales_sold_at',
    'idx_sc_stock_audit_movement',
    'idx_sc_part_requests_estimated_arrival'
  )
ORDER BY c.relname;
"""
rc, out, err = run_psql_query(sql_indexes)
indexes_found = [line.split('|') for line in out.splitlines() if line.strip()]
print(f"Indexes created by forward package verified: {len(indexes_found)} / 3 expected.")
all_idx_valid = all(len(parts) == 3 and parts[1] == 't' and parts[2] == 't' for parts in indexes_found)
print(f"All 3 forward package indexes present and valid: {all_idx_valid and len(indexes_found) == 3}")
report["catalog_verification"]["indexes"] = {
    "count": len(indexes_found),
    "all_valid": all_idx_valid and len(indexes_found) == 3,
    "details": indexes_found
}

# 2. Triggers Check
sql_triggers = """
SELECT tgname, relname, tgenabled
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND tgname IN (
    'trg_protect_technician_part_request_fields',
    'trg_notify_admin_on_technician_registration'
  )
ORDER BY tgname;
"""
rc, out, err = run_psql_query(sql_triggers)
triggers_found = [line.split('|') for line in out.splitlines() if line.strip()]
print(f"Triggers verified: {len(triggers_found)} / 2 expected.")
all_trg_active = all(len(parts) == 3 and parts[2] == 'O' for parts in triggers_found)
print(f"All 2 triggers present and active ('O'): {all_trg_active and len(triggers_found) == 2}")
report["catalog_verification"]["triggers"] = {
    "count": len(triggers_found),
    "all_active": all_trg_active and len(triggers_found) == 2,
    "details": triggers_found
}

# 3. Functions & Security Definer & search_path Check
sql_funcs = """
SELECT p.proname, p.prosecdef, p.provolatile,
       COALESCE(array_to_string(p.proconfig, ','), 'NONE') as search_path
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'confirm_service_centre_part_handoff',
    'adjust_service_centre_part_stock',
    'request_service_centre_part',
    'receive_service_centre_stock',
    'return_service_centre_part',
    'update_service_centre_part_request_eta',
    'create_quote_atomic',
    'revise_quote_atomic',
    'trg_enforce_technician_part_request_fields',
    'notify_admin_on_technician_registration'
  )
ORDER BY p.proname;
"""
rc, out, err = run_psql_query(sql_funcs)
funcs_found = [line.split('|') for line in out.splitlines() if line.strip()]
print(f"Functions verified: {len(funcs_found)} / 10 expected.")
all_secdef = all(len(parts) == 4 and parts[1] == 't' and 'search_path=' in parts[3] and 'pg_temp' in parts[3] for parts in funcs_found)
print(f"All 10 functions SECURITY DEFINER with explicit search_path including pg_temp: {all_secdef and len(funcs_found) == 10}")
report["catalog_verification"]["functions"] = {
    "count": len(funcs_found),
    "all_secdef_and_search_path": all_secdef and len(funcs_found) == 10,
    "details": funcs_found
}

# 4. ACL Check on Functions (PUBLIC/anon denied, authenticated/service_role allowed)
sql_acl = """
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'confirm_service_centre_part_handoff',
    'adjust_service_centre_part_stock',
    'request_service_centre_part',
    'receive_service_centre_stock',
    'return_service_centre_part',
    'update_service_centre_part_request_eta',
    'create_quote_atomic',
    'revise_quote_atomic',
    'notify_admin_on_technician_registration'
  )
ORDER BY p.proname;
"""
rc, out, err = run_psql_query(sql_acl)
acl_found = [line.split('|') for line in out.splitlines() if line.strip()]
print(f"ACL checked for {len(acl_found)} functions.")
all_acl_strict = all(len(parts) == 3 and parts[1] == 'f' and parts[2] == 't' for parts in acl_found)
print(f"Anon denied ('f') and Authenticated allowed ('t') on all functions: {all_acl_strict and len(acl_found) == 9}")
report["catalog_verification"]["acls"] = {
    "count": len(acl_found),
    "all_strict": all_acl_strict and len(acl_found) == 9,
    "details": acl_found
}

# 5. Publication Check
sql_pub = """
SELECT pubname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename IN ('service_centre_part_requests', 'service_centre_parts', 'service_centre_part_sales', 'service_centre_stock_audit', 'quote_items')
ORDER BY tablename;
"""
rc, out, err = run_psql_query(sql_pub)
pubs_found = [line.split('|') for line in out.splitlines() if line.strip()]
print(f"Realtime publication tables found: {len(pubs_found)} / 5 expected.")
report["catalog_verification"]["publication"] = {
    "count": len(pubs_found),
    "details": pubs_found
}

# 6. RLS Policies Check on Phase 9 tables
sql_rls = """
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('service_centre_part_requests', 'service_centre_parts', 'service_centre_part_sales', 'service_centre_stock_audit')
ORDER BY tablename, policyname;
"""
rc, out, err = run_psql_query(sql_rls)
rls_found = [line.split('|') for line in out.splitlines() if line.strip()]
print(f"RLS policies verified: {len(rls_found)} policies across Phase 9 tables.")
report["catalog_verification"]["rls_policies"] = {
    "count": len(rls_found),
    "details": rls_found
}

with open("scratch/step5b12_database_rehearsal_results.json", "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2)

print("\n" + "="*70)
if all_p1_ok and all_p2_ok and all_idx_valid and all_trg_active and all_secdef and all_acl_strict:
    print("SUCCESS: 100% of forward migrations applied, rerun idempotent, and catalog verified!")
else:
    print("WARNING: Some verification criteria failed. Review JSON report.")
print("="*70)
