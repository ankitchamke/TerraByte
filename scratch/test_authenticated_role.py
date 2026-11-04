import subprocess
import os

PG_BIN = r"D:\TerraByte_Drill\pgsql17\pgsql\bin"
PSQL = os.path.join(PG_BIN, "psql.exe")
env = os.environ.copy()
env["PGPASSWORD"] = "postgres"

test_auth_sql = """
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0001-000000000001';
SET request.jwt.claim.role = 'authenticated';

SELECT id, full_name, role FROM public.profiles WHERE auth_user_id = auth.uid();

SELECT * FROM public.get_session_profile();

RESET ROLE;
"""

cmd = [PSQL, "-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "terabyte_step5b18_drill", "-w", "-c", test_auth_sql]
res = subprocess.run(cmd, capture_output=True, text=True, env=env)
print("Auth test exit code:", res.returncode)
print(res.stdout)
if res.stderr:
    print("Stderr:", res.stderr)
