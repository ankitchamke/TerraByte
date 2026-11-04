import json
import subprocess

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
DB = "terabyte_clean_restore_drill"
PORT = "5433"
USER = "postgres"

with open("scratch/full_request_catalog_v6.json", "r", encoding="utf-8") as f:
    catalog = json.load(f)

print(f"Testing strengthened verification queries for {len(catalog)} requests...")
success = 0
failed = 0

for item in catalog:
    uid = item["unit_id"]
    sql_query = item["strengthened_vquery"].strip()
    cmd = [PSQL, "-p", PORT, "-U", USER, "-d", DB, "-v", "ON_ERROR_STOP=1", "-c", sql_query]
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode == 0:
        success += 1
    else:
        failed += 1
        print(f"FAILED {uid}: {sql_query}")
        print("  Error:", p.stderr.strip())

print(f"Strengthened Verification Query Test Complete: {success} succeeded, {failed} failed.")
