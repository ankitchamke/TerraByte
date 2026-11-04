import subprocess
import os

PG_BIN = r"D:\TerraByte_Drill\pgsql17\pgsql\bin"
PSQL = os.path.join(PG_BIN, "psql.exe")
env = os.environ.copy()
env["PGPASSWORD"] = "postgres"

cmd = [PSQL, "-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "terabyte_schema_only_drill", "-w", "-f", "supabase/migrations/20261104100000_profile_security_separation.sql"]
res = subprocess.run(cmd, capture_output=True, text=True, env=env)
err_lines = [l for l in res.stderr.splitlines() if "ERROR" in l]
print(f"20261104100000 exit={res.returncode}, errors={len(err_lines)}")
for el in err_lines[:5]:
    print("  ->", el)
