import subprocess
import os

PG_BIN = r"D:\TerraByte_Drill\pgsql17\pgsql\bin"
PSQL = os.path.join(PG_BIN, "psql.exe")
env = os.environ.copy()
env["PGPASSWORD"] = "postgres"

for table in ["service_centre_parts", "service_centre_part_requests", "service_centre_stock_audit", "repair_dispatch_locations"]:
    sql = f"SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '{table}' ORDER BY ordinal_position;"
    cmd = [PSQL, "-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "terabyte_schema_only_drill", "-w", "-c", sql]
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    print(f"\n--- {table} ---")
    print(res.stdout)
