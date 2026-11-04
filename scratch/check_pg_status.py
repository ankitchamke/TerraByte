import subprocess
import os

PG_BIN = r"D:\TerraByte_Drill\pgsql17\pgsql\bin"
PSQL = os.path.join(PG_BIN, "psql.exe")
env = os.environ.copy()
env["PGPASSWORD"] = "postgres"

# Check if local postgres daemon is running on port 5433
cmd = [PSQL, "-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "postgres", "-w", "-c", "SELECT 1;"]
res = subprocess.run(cmd, capture_output=True, text=True, env=env)
print("PG running?", res.returncode == 0)

if res.returncode != 0:
    print("Starting daemon...")
    # will start via run_command if needed
