import subprocess
import os

PG_BIN = r"D:\TerraByte_Drill\pgsql17\pgsql\bin"
PSQL = os.path.join(PG_BIN, "psql.exe")
env = os.environ.copy()
env["PGPASSWORD"] = "postgres"

sql = """
SELECT table_schema, table_name, table_type 
FROM information_schema.tables 
WHERE table_schema IN ('public', 'app_security') 
ORDER BY table_schema, table_name;
"""
cmd = [PSQL, "-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "terabyte_schema_only_drill", "-w", "-c", sql]
res = subprocess.run(cmd, capture_output=True, text=True, env=env)
print(res.stdout)
