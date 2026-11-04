import json
import subprocess
import os
import time

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
PORT = "5433"
HOST = "127.0.0.1"
USER = "postgres"
DB = "terabyte_clean_restore_drill"

env = os.environ.copy()
env["PGPASSWORD"] = "postgres"

with open("scratch/full_request_catalog_v8.json", "r", encoding="utf-8") as f:
    catalog = json.load(f)

print(f"Loaded {len(catalog)} requests from full_request_catalog_v8.json")

results = []

def run_psql(sql_text):
    with open("scratch/temp_audit_stmt.sql", "w", encoding="utf-8") as f:
        f.write(sql_text)
    cmd = [PSQL, "-p", PORT, "-h", HOST, "-U", USER, "-d", DB, "-w", "-v", "ON_ERROR_STOP=1", "-f", "scratch/temp_audit_stmt.sql"]
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    return res.returncode, res.stdout.strip(), res.stderr.strip()

print("--- Phase 1: Executing All 55 Verification Queries Against Clean Drill DB ---")
vq_passed = 0
vq_failed = 0

for r in catalog:
    uid = r["unit_id"]
    vq = r["strengthened_vquery"].strip()
    rc, stdout, stderr = run_psql(vq)
    item = {
        "unit_id": uid,
        "type": r["type"],
        "target": r["target_object"],
        "vq_rc": rc,
        "vq_status": "PASS" if rc == 0 else "FAIL",
        "vq_error": stderr if rc != 0 else None
    }
    if rc == 0:
        vq_passed += 1
    else:
        vq_failed += 1
    results.append(item)

print(f"Phase 1 Complete: {vq_passed} PASSED, {vq_failed} FAILED out of {len(catalog)}")

print("\n--- Phase 2: Testing Rerun Idempotency for All 55 Statements ---")
rerun_passed = 0
rerun_failed = 0

for i, r in enumerate(catalog):
    uid = r["unit_id"]
    sql = r["text"].strip()
    rc, stdout, stderr = run_psql(sql)
    results[i]["rerun_rc"] = rc
    results[i]["rerun_status"] = "PASS" if rc == 0 else "FAIL"
    results[i]["rerun_error"] = stderr if rc != 0 else None
    if rc == 0:
        rerun_passed += 1
    else:
        rerun_failed += 1

print(f"Phase 2 Complete: {rerun_passed} PASSED, {rerun_failed} FAILED out of {len(catalog)}")

print("\n--- Phase 3: Post-Rerun Verification Queries ---")
post_passed = 0
post_failed = 0

for i, r in enumerate(catalog):
    uid = r["unit_id"]
    vq = r["strengthened_vquery"].strip()
    rc, stdout, stderr = run_psql(vq)
    results[i]["post_vq_rc"] = rc
    results[i]["post_vq_status"] = "PASS" if rc == 0 else "FAIL"
    results[i]["post_vq_error"] = stderr if rc != 0 else None
    if rc == 0:
        post_passed += 1
    else:
        post_failed += 1

print(f"Phase 3 Complete: {post_passed} PASSED, {post_failed} FAILED out of {len(catalog)}")

summary = {
    "total_requests": len(catalog),
    "target_db": DB,
    "pg_version": "PostgreSQL 17.6 on x86_64-windows",
    "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "phase1_initial_verification": {"passed": vq_passed, "failed": vq_failed},
    "phase2_rerun_idempotency": {"passed": rerun_passed, "failed": rerun_failed},
    "phase3_post_rerun_verification": {"passed": post_passed, "failed": post_failed},
    "items": results
}

with open("scratch/step5b8_drill_test_results.json", "w", encoding="utf-8") as f:
    json.dump(summary, f, indent=2)

print("\nMachine-readable evidence saved to scratch/step5b8_drill_test_results.json")
