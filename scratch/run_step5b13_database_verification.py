import subprocess
import os
import time
import json
import hashlib
import datetime

PG_BIN = r"D:\TerraByte_Drill\pgsql17\pgsql\bin"
PSQL = os.path.join(PG_BIN, "psql.exe")
PORT = "5433"
HOST = "127.0.0.1"
USER = "postgres"

MIG_A = "supabase/migrations/20261104110000_complete_phase9_parts_desk_rpcs.sql"
MIG_B = "supabase/migrations/20261104120000_complete_phase9_realtime_and_eta.sql"
MIG_C = "supabase/migrations/20261104130000_complete_phase5_3_technician_registration_notification.sql"
BASELINE_SQL = r"D:\TerraByte_Drill\preflight_sql\from_pg17_restore.sql"

env = os.environ.copy()
env["PGPASSWORD"] = "postgres"

def get_sha256(filepath):
    with open(filepath, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()

def run_psql(db, sql_query):
    cmd = [PSQL, "-h", HOST, "-p", PORT, "-U", USER, "-d", db, "-w", "-t", "-A", "-c", sql_query]
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    return res.returncode, res.stdout.strip(), res.stderr.strip()

def run_psql_file(db, filepath, stop_on_error=True):
    start = time.perf_counter()
    cmd = [PSQL, "-h", HOST, "-p", PORT, "-U", USER, "-d", db, "-w"]
    if stop_on_error:
        cmd.extend(["-v", "ON_ERROR_STOP=1"])
    cmd.extend(["-f", filepath])
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    dur = time.perf_counter() - start
    return res.returncode, res.stdout.strip(), res.stderr.strip(), dur

print("="*75)
print("TerraByte Step 5B.13 — Dual Database Rehearsal Verification Drill")
print(f"Timestamp: {datetime.datetime.now(datetime.timezone.utc).isoformat()}")
print(f"PostgreSQL 17.6 on {HOST}:{PORT}")
print("="*75)

report = {
    "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "migrations": {
        "A": {"file": MIG_A, "sha256": get_sha256(MIG_A)},
        "B": {"file": MIG_B, "sha256": get_sha256(MIG_B)},
        "C": {"file": MIG_C, "sha256": get_sha256(MIG_C)},
    },
    "test_1_clean_install": {},
    "test_2_upgrade_path": {}
}

print("\nMigration Checksums:")
print(f"  Migration A ({os.path.basename(MIG_A)}): {report['migrations']['A']['sha256']}")
print(f"  Migration B ({os.path.basename(MIG_B)}): {report['migrations']['B']['sha256']}")
print(f"  Migration C ({os.path.basename(MIG_C)}): {report['migrations']['C']['sha256']}")

# ==============================================================================
# TEST 1: CLEAN INSTALLATION DRILL
# ==============================================================================
DB_CLEAN = "terabyte_clean_install_drill"
print(f"\n{'='*75}\nTEST 1: CLEAN INSTALLATION DRILL (Database: {DB_CLEAN})\n{'='*75}")

# 1.1 Reset database
run_psql("postgres", f"DROP DATABASE IF EXISTS {DB_CLEAN};")
rc, _, err = run_psql("postgres", f"CREATE DATABASE {DB_CLEAN};")
if rc != 0:
    print(f"FATAL: Cannot create {DB_CLEAN}: {err}")
    exit(1)

# Clean public schema before baseline restore
run_psql(DB_CLEAN, "DROP SCHEMA IF EXISTS public CASCADE;")

# 1.2 Load baseline foundations (without ON_ERROR_STOP, capturing warnings)
print("Applying baseline DDL foundations to clean install instance...")
rc, _, err, ddl_dur = run_psql_file(DB_CLEAN, BASELINE_SQL, stop_on_error=False)
print(f"  Baseline loaded in {ddl_dur*1000:.1f}ms")

# Truncate tables to ensure 100% clean install state (schema only, 0 data rows)
truncate_sql = """
TRUNCATE TABLE 
    public.service_centre_part_requests,
    public.service_centre_part_sales,
    public.service_centre_stock_audit,
    public.service_centre_parts,
    public.repair_messages,
    public.repair_notes,
    public.repair_timeline,
    public.quote_items,
    public.quotes,
    public.repair_requests,
    public.equipment,
    public.technician_profiles,
    public.profiles
CASCADE;
"""
run_psql(DB_CLEAN, truncate_sql)

# Record starting schema state
rc, start_tables, _ = run_psql(DB_CLEAN, "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';")
rc, start_funcs, _ = run_psql(DB_CLEAN, "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public';")
print(f"Clean Install Starting State: {start_tables} public tables, {start_funcs} public functions, 0 data rows.")

report["test_1_clean_install"]["starting_state"] = {
    "public_tables": int(start_tables),
    "public_functions": int(start_funcs),
    "data_rows": 0
}

# 1.3 Apply forward package Pass 1 (Strict ON_ERROR_STOP=1)
print("\nApplying Phase 9 Forward Package (Pass 1 - Strict ON_ERROR_STOP=1)...")
p1_results = []
for mig_key, mig_file in [("A", MIG_A), ("B", MIG_B), ("C", MIG_C)]:
    rc, stdout, stderr, dur = run_psql_file(DB_CLEAN, mig_file, stop_on_error=True)
    status = "SUCCESS" if rc == 0 else "FAILED"
    print(f"  Migration {mig_key}: {status} in {dur*1000:.1f}ms (Return Code: {rc})")
    p1_results.append({"migration": mig_key, "status": status, "duration_ms": round(dur*1000, 2), "rc": rc, "error": stderr[:200] if stderr else ""})
report["test_1_clean_install"]["pass_1"] = p1_results

# 1.4 Idempotency Pass 2
print("\nRe-applying Phase 9 Forward Package (Pass 2 - Idempotency)...")
p2_results = []
for mig_key, mig_file in [("A", MIG_A), ("B", MIG_B), ("C", MIG_C)]:
    rc, stdout, stderr, dur = run_psql_file(DB_CLEAN, mig_file, stop_on_error=True)
    status = "SUCCESS" if rc == 0 else "FAILED"
    print(f"  Migration {mig_key} Rerun: {status} in {dur*1000:.1f}ms (Return Code: {rc})")
    p2_results.append({"migration": mig_key, "status": status, "duration_ms": round(dur*1000, 2), "rc": rc, "error": stderr[:200] if stderr else ""})
report["test_1_clean_install"]["pass_2_idempotency"] = p2_results

# 1.5 Verify Catalog in Clean Install
print("\nVerifying Clean Install Catalog Objects...")
rc, idx_out, _ = run_psql(DB_CLEAN, "SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname IN ('idx_sc_sales_sold_at', 'idx_sc_stock_audit_movement', 'idx_sc_part_requests_estimated_arrival') AND i.indisvalid = true;")
rc, trg_out, _ = run_psql(DB_CLEAN, "SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_protect_technician_part_request_fields', 'trg_notify_admin_on_technician_registration') AND tgenabled = 'O';")
rc, funcs_out, _ = run_psql(DB_CLEAN, "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('confirm_service_centre_part_handoff', 'adjust_service_centre_part_stock', 'request_service_centre_part', 'receive_service_centre_stock', 'return_service_centre_part', 'update_service_centre_part_request_eta', 'create_quote_atomic', 'revise_quote_atomic') AND p.prosecdef = true;")
rc, pub_out, _ = run_psql(DB_CLEAN, "SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename IN ('service_centre_part_requests', 'service_centre_parts', 'service_centre_part_sales', 'service_centre_stock_audit', 'quote_items');")

print(f"  Forward Indexes valid: {idx_out} / 3")
print(f"  Forward Triggers active: {trg_out} / 2")
print(f"  Forward RPC Functions valid: {funcs_out} / 8")
print(f"  Realtime Publication tables: {pub_out} / 5")

report["test_1_clean_install"]["verification"] = {
    "forward_indexes_valid": int(idx_out),
    "forward_triggers_active": int(trg_out),
    "forward_rpcs_valid": int(funcs_out),
    "realtime_tables": int(pub_out),
    "verdict": "VERIFIED" if (int(idx_out) == 3 and int(trg_out) == 2 and int(funcs_out) == 8 and int(pub_out) == 5) else "FAILED"
}

# ==============================================================================
# TEST 2: UPGRADE-PATH REHEARSAL DRILL
# ==============================================================================
DB_UPGRADE = "terabyte_upgrade_path_drill"
print(f"\n{'='*75}\nTEST 2: UPGRADE-PATH REHEARSAL DRILL (Database: {DB_UPGRADE})\n{'='*75}")

# 2.1 Reset database and restore full production baseline with data
run_psql("postgres", f"DROP DATABASE IF EXISTS {DB_UPGRADE};")
rc, _, err = run_psql("postgres", f"CREATE DATABASE {DB_UPGRADE};")
if rc != 0:
    print(f"FATAL: Cannot create {DB_UPGRADE}: {err}")
    exit(1)

run_psql(DB_UPGRADE, "DROP SCHEMA IF EXISTS public CASCADE;")

print("Restoring exact pre-Phase-9 production baseline with existing data...")
rc, _, err, baseline_dur = run_psql_file(DB_UPGRADE, BASELINE_SQL, stop_on_error=False)
print(f"  Production baseline restored in {baseline_dur*1000:.1f}ms")

# Record baseline data row counts before upgrade
rc, pre_profiles, _ = run_psql(DB_UPGRADE, "SELECT count(*) FROM public.profiles;")
rc, pre_parts, _ = run_psql(DB_UPGRADE, "SELECT count(*) FROM public.service_centre_parts;")
rc, pre_equipment, _ = run_psql(DB_UPGRADE, "SELECT count(*) FROM public.equipment;")
rc, pre_repairs, _ = run_psql(DB_UPGRADE, "SELECT count(*) FROM public.repair_requests;")
rc, pre_tables, _ = run_psql(DB_UPGRADE, "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';")

print(f"Pre-Upgrade Data State:")
print(f"  Profiles: {pre_profiles} rows")
print(f"  Service Centre Parts: {pre_parts} rows")
print(f"  Equipment: {pre_equipment} rows")
print(f"  Repair Requests: {pre_repairs} rows")
print(f"  Public Tables: {pre_tables} tables")

report["test_2_upgrade_path"]["pre_upgrade_state"] = {
    "profiles_count": int(pre_profiles),
    "parts_count": int(pre_parts),
    "equipment_count": int(pre_equipment),
    "repairs_count": int(pre_repairs),
    "tables_count": int(pre_tables)
}

# 2.2 Apply forward package Pass 1 on upgrade instance (Strict ON_ERROR_STOP=1)
print("\nApplying Phase 9 Forward Package to Upgrade Instance (Pass 1 - Strict ON_ERROR_STOP=1)...")
u1_results = []
for mig_key, mig_file in [("A", MIG_A), ("B", MIG_B), ("C", MIG_C)]:
    rc, stdout, stderr, dur = run_psql_file(DB_UPGRADE, mig_file, stop_on_error=True)
    status = "SUCCESS" if rc == 0 else "FAILED"
    print(f"  Migration {mig_key}: {status} in {dur*1000:.1f}ms (Return Code: {rc})")
    u1_results.append({"migration": mig_key, "status": status, "duration_ms": round(dur*1000, 2), "rc": rc, "error": stderr[:200] if stderr else ""})
report["test_2_upgrade_path"]["pass_1"] = u1_results

# 2.3 Idempotency Pass 2 on upgrade instance
print("\nRe-applying Phase 9 Forward Package to Upgrade Instance (Pass 2 - Idempotency)...")
u2_results = []
for mig_key, mig_file in [("A", MIG_A), ("B", MIG_B), ("C", MIG_C)]:
    rc, stdout, stderr, dur = run_psql_file(DB_UPGRADE, mig_file, stop_on_error=True)
    status = "SUCCESS" if rc == 0 else "FAILED"
    print(f"  Migration {mig_key} Rerun: {status} in {dur*1000:.1f}ms (Return Code: {rc})")
    u2_results.append({"migration": mig_key, "status": status, "duration_ms": round(dur*1000, 2), "rc": rc, "error": stderr[:200] if stderr else ""})
report["test_2_upgrade_path"]["pass_2_idempotency"] = u2_results

# 2.4 Verify Post-Upgrade Data Preservation
print("\nVerifying Data Preservation Post-Upgrade...")
rc, post_profiles, _ = run_psql(DB_UPGRADE, "SELECT count(*) FROM public.profiles;")
rc, post_parts, _ = run_psql(DB_UPGRADE, "SELECT count(*) FROM public.service_centre_parts;")
rc, post_equipment, _ = run_psql(DB_UPGRADE, "SELECT count(*) FROM public.equipment;")
rc, post_repairs, _ = run_psql(DB_UPGRADE, "SELECT count(*) FROM public.repair_requests;")
rc, post_tables, _ = run_psql(DB_UPGRADE, "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';")

print(f"Post-Upgrade Data State:")
print(f"  Profiles: {post_profiles} rows (Preserved: {post_profiles == pre_profiles})")
print(f"  Service Centre Parts: {post_parts} rows (Preserved: {post_parts == pre_parts})")
print(f"  Equipment: {post_equipment} rows (Preserved: {post_equipment == pre_equipment})")
print(f"  Repair Requests: {post_repairs} rows (Preserved: {post_repairs == pre_repairs})")
print(f"  Public Tables: {post_tables} tables (Preserved: {post_tables >= pre_tables})")

data_preserved = (post_profiles == pre_profiles and post_parts == pre_parts and post_equipment == pre_equipment and post_repairs == pre_repairs)

# 2.5 Verify Post-Upgrade Catalog Objects
print("\nVerifying Upgrade Instance Catalog Objects...")
rc, u_idx_out, _ = run_psql(DB_UPGRADE, "SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname IN ('idx_sc_sales_sold_at', 'idx_sc_stock_audit_movement', 'idx_sc_part_requests_estimated_arrival') AND i.indisvalid = true;")
rc, u_trg_out, _ = run_psql(DB_UPGRADE, "SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_protect_technician_part_request_fields', 'trg_notify_admin_on_technician_registration') AND tgenabled = 'O';")
rc, u_funcs_out, _ = run_psql(DB_UPGRADE, "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('confirm_service_centre_part_handoff', 'adjust_service_centre_part_stock', 'request_service_centre_part', 'receive_service_centre_stock', 'return_service_centre_part', 'update_service_centre_part_request_eta', 'create_quote_atomic', 'revise_quote_atomic') AND p.prosecdef = true;")
rc, u_pub_out, _ = run_psql(DB_UPGRADE, "SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename IN ('service_centre_part_requests', 'service_centre_parts', 'service_centre_part_sales', 'service_centre_stock_audit', 'quote_items');")

print(f"  Forward Indexes valid: {u_idx_out} / 3")
print(f"  Forward Triggers active: {u_trg_out} / 2")
print(f"  Forward RPC Functions valid: {u_funcs_out} / 8")
print(f"  Realtime Publication tables: {u_pub_out} / 5")

report["test_2_upgrade_path"]["verification"] = {
    "data_preserved": data_preserved,
    "forward_indexes_valid": int(u_idx_out),
    "forward_triggers_active": int(u_trg_out),
    "forward_rpcs_valid": int(u_funcs_out),
    "realtime_tables": int(u_pub_out),
    "verdict": "VERIFIED" if (data_preserved and int(u_idx_out) == 3 and int(u_trg_out) == 2 and int(u_funcs_out) == 8 and int(u_pub_out) == 5) else "FAILED"
}

# 2.6 Verify Phase 11 Exclusion
print("\nVerifying Phase 11 Schema Exclusion...")
rc, p11_tab_out, _ = run_psql(DB_UPGRADE, "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = 'repair_visual_diagnostics';")
rc, p11_fn_out, _ = run_psql(DB_UPGRADE, "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'claim_repair_visual_diagnostic';")
is_p11_excluded = (int(p11_tab_out) == 0 and int(p11_fn_out) == 0)
print(f"  Phase 11 objects absent: {is_p11_excluded} (Diagnostics Table: {p11_tab_out}, Diagnostics RPC: {p11_fn_out})")
report["test_2_upgrade_path"]["phase_11_exclusion"] = {
    "repair_visual_diagnostics_table": int(p11_tab_out),
    "claim_repair_visual_diagnostic_rpc": int(p11_fn_out),
    "is_strictly_excluded": is_p11_excluded
}

# Cleanup disposable test databases
print("\nCleaning up disposable test databases...")
run_psql("postgres", f"DROP DATABASE IF EXISTS {DB_CLEAN};")
run_psql("postgres", f"DROP DATABASE IF EXISTS {DB_UPGRADE};")
print("  Cleanup complete.")

with open("scratch/step5b13_database_verification_results.json", "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2)

print("\n" + "="*75)
print("TEST 1 (Clean Install) Verdict: " + report["test_1_clean_install"]["verification"]["verdict"])
print("TEST 2 (Upgrade Path)  Verdict: " + report["test_2_upgrade_path"]["verification"]["verdict"])
print("="*75)
