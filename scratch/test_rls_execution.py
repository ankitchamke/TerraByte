import subprocess
import os

PG_BIN = r"D:\TerraByte_Drill\pgsql17\pgsql\bin"
PSQL = os.path.join(PG_BIN, "psql.exe")
env = os.environ.copy()
env["PGPASSWORD"] = "postgres"

test_rls_sql = """
-- Test 1: Query as anon
SET ROLE anon;
SELECT count(*) FROM public.profiles;

-- Test 2: Query as authenticated farmer Devdas
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0001-000000000001';
SET request.jwt.claim.role = 'authenticated';
SELECT id, full_name, role FROM public.profiles WHERE auth_user_id = auth.uid();

-- Test 3: Test parameterless get_session_profile RPC
SELECT * FROM public.get_session_profile();

-- Reset
RESET ROLE;
"""

cmd = [PSQL, "-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "terabyte_step5b18_drill", "-w", "-c", test_rls_sql]
res = subprocess.run(cmd, capture_output=True, text=True, env=env)
print("RLS test exit code:", res.returncode)
print(res.stdout)
if res.stderr:
    print("Stderr:", res.stderr)
