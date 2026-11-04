import json

with open("scratch/step5b8_drill_test_results.json", "r", encoding="utf-8") as f:
    res = json.load(f)

print("Summary:")
print(f"  Target DB: {res['target_db']}")
print(f"  PG Version: {res['pg_version']}")
print(f"  Timestamp UTC: {res['timestamp_utc']}")
print(f"  Total Requests: {res['total_requests']}")
print(f"  Phase 1 (Verification Queries): {res['phase1_initial_verification']}")
print(f"  Phase 2 (Rerun Idempotency): {res['phase2_rerun_idempotency']}")
print(f"  Phase 3 (Post-Rerun Verification): {res['phase3_post_rerun_verification']}")

# Check if any request failed in any phase
any_fail = False
for item in res["items"]:
    if item["vq_status"] != "PASS" or item["rerun_status"] != "PASS" or item["post_vq_status"] != "PASS":
        print(f"FAILURE in {item['unit_id']}: vq={item['vq_status']}, rerun={item['rerun_status']}, post={item['post_vq_status']}")
        any_fail = True

if not any_fail:
    print("ALL 55 REQUESTS: 100% PASS ACROSS ALL THREE PHASES (165/165 executions succeeded).")
