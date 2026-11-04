import subprocess
import os

PG_BIN = r"D:\TerraByte_Drill\pgsql17\pgsql\bin"
PSQL = os.path.join(PG_BIN, "psql.exe")
env = os.environ.copy()
env["PGPASSWORD"] = "postgres"

sql = """
SELECT t.typname, e.enumlabel
FROM pg_type t 
JOIN pg_enum e ON t.oid = e.enumtypid 
WHERE t.typname IN ('equipment_type', 'equipment_status', 'user_role', 'repair_status', 'quote_status')
ORDER BY t.typname, e.enumsortorder;
"""
cmd = [PSQL, "-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "terabyte_schema_only_drill", "-w", "-c", sql]
res = subprocess.run(cmd, capture_output=True, text=True, env=env)
print(res.stdout)
