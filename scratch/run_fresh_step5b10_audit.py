import json
import subprocess
import os
import time
import datetime
import hashlib

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
PORT = "5433"
HOST = "127.0.0.1"
USER = "postgres"
DB = "terabyte_clean_restore_drill"

env = os.environ.copy()
env["PGPASSWORD"] = "postgres"

with open("scratch/full_request_catalog_v9.json", "r", encoding="utf-8") as f:
    catalog = json.load(f)

log_file = open("scratch/step5b10_drill_execution.log", "w", encoding="utf-8")

def log(msg):
    ts = datetime.datetime.now(datetime.timezone.utc).isoformat()
    log_line = f"[{ts}] {msg}"
    print(log_line)
    log_file.write(log_line + "\n")
    log_file.flush()

log(f"=== Starting Step 5B.10 Fresh 165-Execution Drill Audit ===")
log(f"Database: {DB} on {HOST}:{PORT}")

# Check PG Version
cmd_ver = [PSQL, "-p", PORT, "-h", HOST, "-U", USER, "-d", DB, "-w", "-t", "-A", "-c", "SELECT version();"]
res_ver = subprocess.run(cmd_ver, capture_output=True, text=True, env=env)
pg_version_str = res_ver.stdout.strip()
log(f"PostgreSQL Version: {pg_version_str}")

def run_psql(sql_text):
    with open("scratch/temp_audit_stmt.sql", "w", encoding="utf-8") as f:
        f.write(sql_text)
    cmd = [PSQL, "-p", PORT, "-h", HOST, "-U", USER, "-d", DB, "-w", "-v", "ON_ERROR_STOP=1", "-f", "scratch/temp_audit_stmt.sql"]
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    return res.returncode, res.stdout.strip(), res.stderr.strip()

results = []

# Phase 1: Initial Verification Queries
log("--- Phase 1: Executing All 55 Verification Queries Against Clean Drill DB ---")
p1_passed = 0
p1_failed = 0

for idx, r in enumerate(catalog, 1):
    uid = r["unit_id"]
    vq = r["strengthened_vquery"].strip()
    rc, stdout, stderr = run_psql(vq)
    status = "PASS" if rc == 0 else "FAIL"
    if rc == 0:
        p1_passed += 1
    else:
        p1_failed += 1
    log(f"Phase 1 [{idx}/55] {uid} ({r['type']}): {status} (rc={rc})")
    if rc != 0:
        log(f"  ERROR: {stderr}")
    results.append({
        "unit_id": uid,
        "type": r["type"],
        "target_object": r["target_object"],
        "source_line_range": r.get("source_line_range"),
        "phase1_verification": {
            "return_code": rc,
            "status": status,
            "output_preview": stdout[:120] if stdout else None,
            "error": stderr if rc != 0 else None
        }
    })

log(f"Phase 1 Finished: {p1_passed} PASSED, {p1_failed} FAILED out of {len(catalog)}")

# Phase 2: Rerun Idempotency Test
log("\n--- Phase 2: Testing Rerun Idempotency for All 55 Discrete SQL Statements ---")
p2_passed = 0
p2_failed = 0

for idx, r in enumerate(catalog):
    uid = r["unit_id"]
    sql = r["text"].strip()
    rc, stdout, stderr = run_psql(sql)
    status = "PASS" if rc == 0 else "FAIL"
    if rc == 0:
        p2_passed += 1
    else:
        p2_failed += 1
    log(f"Phase 2 [{idx+1}/55] {uid} ({r['type']}): {status} (rc={rc})")
    if rc != 0:
        log(f"  ERROR: {stderr}")
    results[idx]["phase2_rerun_idempotency"] = {
        "return_code": rc,
        "status": status,
        "output_preview": stdout[:120] if stdout else None,
        "error": stderr if rc != 0 else None
    }

log(f"Phase 2 Finished: {p2_passed} PASSED, {p2_failed} FAILED out of {len(catalog)}")

# Phase 3: Post-Rerun Verification Queries
log("\n--- Phase 3: Executing Post-Rerun Verification Queries ---")
p3_passed = 0
p3_failed = 0

for idx, r in enumerate(catalog):
    uid = r["unit_id"]
    vq = r["strengthened_vquery"].strip()
    rc, stdout, stderr = run_psql(vq)
    status = "PASS" if rc == 0 else "FAIL"
    if rc == 0:
        p3_passed += 1
    else:
        p3_failed += 1
    log(f"Phase 3 [{idx+1}/55] {uid} ({r['type']}): {status} (rc={rc})")
    if rc != 0:
        log(f"  ERROR: {stderr}")
    results[idx]["phase3_post_rerun_verification"] = {
        "return_code": rc,
        "status": status,
        "output_preview": stdout[:120] if stdout else None,
        "error": stderr if rc != 0 else None
    }

log(f"Phase 3 Finished: {p3_passed} PASSED, {p3_failed} FAILED out of {len(catalog)}")

end_ts = datetime.datetime.now(datetime.timezone.utc).isoformat()

summary = {
    "audit_step": "Step 5B.10 Fresh Revalidation",
    "timestamp_utc": end_ts,
    "target_database": DB,
    "pg_version": pg_version_str,
    "total_requests": len(catalog),
    "total_executions": len(catalog) * 3,
    "phase1_initial_verification": {"passed": p1_passed, "failed": p1_failed},
    "phase2_rerun_idempotency": {"passed": p2_passed, "failed": p2_failed},
    "phase3_post_rerun_verification": {"passed": p3_passed, "failed": p3_failed},
    "overall_pass_rate": f"{(p1_passed + p2_passed + p3_passed)} / {(len(catalog) * 3)}",
    "requests": results
}

with open("scratch/step5b10_drill_test_results.json", "w", encoding="utf-8") as f:
    json.dump(summary, f, indent=2)

log("\nFresh Step 5B.10 results saved to scratch/step5b10_drill_test_results.json")
log_file.close()
