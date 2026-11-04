import subprocess

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
DB = "terabyte_clean_restore_drill"
PORT = "5433"
USER = "postgres"

test_sql = """
-- 1. Test function verification query
SELECT 
  proname, 
  prosecdef, 
  proowner::regrole AS owner, 
  proconfig,
  has_function_privilege('anon', 'public.confirm_service_centre_part_handoff(uuid)', 'execute') AS anon_can_exec,
  has_function_privilege('authenticated', 'public.confirm_service_centre_part_handoff(uuid)', 'execute') AS auth_can_exec,
  NOT (proacl::text LIKE '%=X/%') AS public_revoked
FROM pg_proc 
WHERE pronamespace = 'public'::regnamespace AND proname = 'confirm_service_centre_part_handoff';

-- 2. Test trigger verification query
SELECT 
  tgname, 
  tgenabled, 
  tgfoid::regproc AS func_binding
FROM pg_trigger 
WHERE tgname = 'trg_protect_technician_part_request_fields';

-- 3. Test index validity query
SELECT 
  indexrelid::regclass AS index_name, 
  indisvalid 
FROM pg_index 
WHERE indexrelid = 'public.idx_sc_sales_sold_at'::regclass;

-- 4. Test column definition query
SELECT 
  column_name, 
  data_type, 
  is_nullable 
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'service_centre_part_requests' 
  AND column_name IN ('estimated_arrival_at', 'eta_updated_by', 'eta_updated_at') 
ORDER BY column_name;
"""

p = subprocess.run([PSQL, "-p", PORT, "-U", USER, "-d", DB, "-c", test_sql], capture_output=True, text=True)
print(p.stdout)
print(p.stderr)
