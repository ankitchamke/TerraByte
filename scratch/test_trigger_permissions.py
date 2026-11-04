import subprocess

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
DB = "terabyte_clean_restore_drill"
PORT = "5433"
USER = "postgres"

test_sql = """
-- First re-grant execute to authenticated
GRANT EXECUTE ON FUNCTION public.trg_enforce_technician_part_request_fields() TO authenticated, service_role;

-- Check PostgREST exposure:
-- In PostgREST / Supabase, can an authenticated user invoke a trigger function via RPC?
-- In PostgREST, any function in the public schema returning type 'trigger' cannot be called directly via /rpc/
-- PostgREST specifically excludes functions returning 'trigger' or 'event_trigger' from OpenAPI / RPC endpoints!
SELECT proname, prorettype::regtype 
FROM pg_proc 
WHERE proname IN ('trg_enforce_technician_part_request_fields', 'notify_admin_on_technician_registration');
"""

p = subprocess.run([PSQL, "-p", PORT, "-U", USER, "-d", DB, "-c", test_sql], capture_output=True, text=True)
print("RC:", p.returncode)
print(p.stdout)
print(p.stderr)
