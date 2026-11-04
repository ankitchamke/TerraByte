import subprocess
import os

PG_BIN = r"D:\TerraByte_Drill\pgsql17\pgsql\bin"
PSQL = os.path.join(PG_BIN, "psql.exe")
env = os.environ.copy()
env["PGPASSWORD"] = "postgres"

sql = "SELECT routine_schema, routine_name FROM information_schema.routines WHERE routine_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY routine_schema, routine_name;"
cmd = [PSQL, "-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "terabyte_schema_only_drill", "-w", "-c", sql]
res = subprocess.run(cmd, capture_output=True, text=True, env=env)
print(res.stdout)
