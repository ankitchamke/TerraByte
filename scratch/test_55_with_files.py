import json
import subprocess
import os
import time

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
DB = "terabyte_clean_restore_drill"
PORT = "5433"
USER = "postgres"
TEMP_FILE = r"D:\Projects\TerraByte\scratch\temp_stmt.sql"

with open("scratch/all_parsed_requests.json", "r", encoding="utf-8") as f:
    requests = json.load(f)

print(f"Loaded {len(requests)} requests.")

def execute_stmt(sql_text):
    with open(TEMP_FILE, "w", encoding="utf-8") as f:
        f.write(sql_text)
    cmd = [PSQL, "-p", PORT, "-U", USER, "-d", DB, "-v", "ON_ERROR_STOP=1", "-f", TEMP_FILE]
    p = subprocess.run(cmd, capture_output=True, text=True)
    return p.returncode, p.stdout.strip(), p.stderr.strip()

start_time = time.time()
success_1 = 0
fail_1 = 0
details_1 = []

print("--- Starting Run 1 (Initial Execution) ---")
for r in requests:
    rc, out, err = execute_stmt(r["text"])
    if rc == 0:
        success_1 += 1
    else:
        fail_1 += 1
        print(f"FAILED {r['unit_id']} ({r['type']}): {err}")
    details_1.append({"unit_id": r["unit_id"], "rc": rc, "error": err})

print(f"Run 1 complete in {time.time() - start_time:.2f}s: {success_1} succeeded, {fail_1} failed.")

print("--- Starting Run 2 (Rerun Idempotency Test) ---")
start_time_2 = time.time()
success_2 = 0
fail_2 = 0
for r in requests:
    rc, out, err = execute_stmt(r["text"])
    if rc == 0:
        success_2 += 1
    else:
        fail_2 += 1
        print(f"Rerun FAILED {r['unit_id']} ({r['type']}): {err}")

print(f"Run 2 complete in {time.time() - start_time_2:.2f}s: {success_2} succeeded, {fail_2} failed.")

if os.path.exists(TEMP_FILE):
    os.remove(TEMP_FILE)

with open("scratch/execution_verification_results.json", "w", encoding="utf-8") as f:
    json.dump({"run1_success": success_1, "run1_fail": fail_1, "run2_success": success_2, "run2_fail": fail_2, "details": details_1}, f, indent=2)
print("Saved verification results to scratch/execution_verification_results.json")
