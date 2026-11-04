import json
import subprocess
import os

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
DB = "terabyte_clean_restore_drill"
PORT = "5433"
USER = "postgres"

def run_psql(sql):
    cmd = [PSQL, "-p", PORT, "-U", USER, "-d", DB, "-v", "ON_ERROR_STOP=1"]
    p = subprocess.run(cmd, input=sql, capture_output=True, text=True)
    return p.returncode, p.stdout.strip(), p.stderr.strip()

with open("scratch/all_parsed_requests.json", "r", encoding="utf-8") as f:
    requests = json.load(f)

print(f"Loaded {len(requests)} requests.")

results = []
success_count = 0
fail_count = 0

for req in requests:
    uid = req["unit_id"]
    stype = req["type"]
    text = req["text"]
    mver = req["migration_ver"]
    lstart = req["start_line"]
    lend = req["end_line"]
    
    rc, out, err = run_psql(text)
    if rc == 0:
        status = "SUCCESS"
        success_count += 1
    else:
        status = "FAILED"
        fail_count += 1
        print(f"FAILED {uid} ({stype}, {lstart}-{lend}): {err}")
    
    results.append({
        "unit_id": uid,
        "migration_ver": mver,
        "lines": f"{lstart}-{lend}",
        "type": stype,
        "status": status,
        "error": err
    })

print(f"\nExecution 1: {success_count} succeeded, {fail_count} failed.")

# Test Idempotent Rerun: Run all 55 statements again!
print("\nTesting rerun idempotency...")
rerun_success = 0
rerun_fail = 0
for req in requests:
    rc, out, err = run_psql(req["text"])
    if rc == 0:
        rerun_success += 1
    else:
        rerun_fail += 1
        print(f"Rerun FAILED {req['unit_id']}: {err}")

print(f"Execution 2 (Rerun): {rerun_success} succeeded, {rerun_fail} failed.")
