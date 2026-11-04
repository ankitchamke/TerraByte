import json
import hashlib
import os

files_to_check = {
    "runner": "scratch/run_fresh_step5b10_audit.py",
    "json_results": "scratch/step5b10_drill_test_results.json",
    "log": "scratch/step5b10_drill_execution.log"
}

hashes = {}
for k, path in files_to_check.items():
    with open(path, "rb") as f:
        raw = f.read()
    h = hashlib.sha256(raw).hexdigest().upper()
    hashes[k] = {"path": path, "size": len(raw), "sha256": h}

with open(files_to_check["json_results"], "r", encoding="utf-8") as f:
    data = json.load(f)

print("=== FRESH DRILL INTEGRITY AUDIT ===")
print(f"Target Database: {data.get('target_database')}")
print(f"PostgreSQL Version: {data.get('pg_version')}")
print(f"Timestamp UTC: {data.get('timestamp_utc')}")
print(f"Total Requests: {data.get('total_requests')}")
print(f"Total Executions: {data.get('total_executions')}")
print(f"Phase 1 Summary: {data.get('phase1_initial_verification')}")
print(f"Phase 2 Summary: {data.get('phase2_rerun_idempotency')}")
print(f"Phase 3 Summary: {data.get('phase3_post_rerun_verification')}")

reqs = data.get("requests", [])
print(f"Total request items in list: {len(reqs)}")

expected_uids = [f"REQ-{i:02d}" for i in range(1, 56)]
actual_uids = [r["unit_id"] for r in reqs]

missing_uids = set(expected_uids) - set(actual_uids)
extra_uids = set(actual_uids) - set(expected_uids)
order_correct = (actual_uids == expected_uids)

p1_statuses = [r["phase1_verification"]["status"] for r in reqs]
p2_statuses = [r["phase2_rerun_idempotency"]["status"] for r in reqs]
p3_statuses = [r["phase3_post_rerun_verification"]["status"] for r in reqs]

p1_all_pass = all(s == "PASS" for s in p1_statuses)
p2_all_pass = all(s == "PASS" for s in p2_statuses)
p3_all_pass = all(s == "PASS" for s in p3_statuses)

print(f"Missing UIDs: {missing_uids}")
print(f"Extra UIDs: {extra_uids}")
print(f"Order Exact Match (REQ-01..55): {order_correct}")
print(f"Phase 1 All 55 PASS: {p1_all_pass} (Count: {p1_statuses.count('PASS')})")
print(f"Phase 2 All 55 PASS: {p2_all_pass} (Count: {p2_statuses.count('PASS')})")
print(f"Phase 3 All 55 PASS: {p3_all_pass} (Count: {p3_statuses.count('PASS')})")

print("\nArtifact Hashes:")
for k, info in hashes.items():
    print(f"  {k} ({info['path']}): {info['size']} bytes | SHA256: {info['sha256']}")
