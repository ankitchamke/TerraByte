import json
import subprocess
import os

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
DB = "terabyte_clean_restore_drill"
USER = "postgres"

with open("scratch/full_request_catalog_v8.json", "r", encoding="utf-8") as f:
    catalog = json.load(f)

print(f"Testing {len(catalog)} strengthened verification queries on drill DB...")
passed = 0
failed = 0
errors = []

env = os.environ.copy()
env["PGPASSWORD"] = "postgres"

for r in catalog:
    uid = r["unit_id"]
    vq = r["strengthened_vquery"].strip()
    with open("scratch/temp_vq.sql", "w", encoding="utf-8") as f:
        f.write(vq)
    cmd = [PSQL, "-p", "5433", "-h", "127.0.0.1", "-U", USER, "-d", DB, "-w", "-v", "ON_ERROR_STOP=1", "-f", "scratch/temp_vq.sql"]
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if res.returncode == 0:
        passed += 1
    else:
        failed += 1
        errors.append((uid, res.stderr.strip()))

print(f"Results: {passed} PASSED, {failed} FAILED out of {len(catalog)}")
if errors:
    print("ERRORS:")
    for uid, err in errors:
        print(f"  {uid}: {err}")
