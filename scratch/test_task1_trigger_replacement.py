import subprocess

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
DB = "terabyte_clean_restore_drill"
PORT = "5433"
USER = "postgres"

test_sql = """
-- 1. Clean slate for testing
DROP TRIGGER IF EXISTS trg_protect_technician_part_request_fields ON public.service_centre_part_requests;
DROP TRIGGER IF EXISTS trg_notify_admin_on_technician_registration ON public.technician_profiles;

-- 2. Test Initial Creation using CREATE OR REPLACE TRIGGER
CREATE OR REPLACE TRIGGER trg_protect_technician_part_request_fields
  BEFORE UPDATE ON public.service_centre_part_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_enforce_technician_part_request_fields();

CREATE OR REPLACE TRIGGER trg_notify_admin_on_technician_registration
  AFTER INSERT ON public.technician_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_admin_on_technician_registration();

-- Verify state after initial creation
SELECT 
  tgname, 
  relname, 
  proname, 
  tgenabled, 
  tgtype
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE tgname IN ('trg_protect_technician_part_request_fields', 'trg_notify_admin_on_technician_registration');

-- 3. Test Repeated Execution (Idempotency)
CREATE OR REPLACE TRIGGER trg_protect_technician_part_request_fields
  BEFORE UPDATE ON public.service_centre_part_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_enforce_technician_part_request_fields();

CREATE OR REPLACE TRIGGER trg_notify_admin_on_technician_registration
  AFTER INSERT ON public.technician_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_admin_on_technician_registration();

-- Verify state after repeated execution
SELECT 
  tgname, 
  tgenabled,
  tgfoid::regproc AS func_binding
FROM pg_trigger
WHERE tgname IN ('trg_protect_technician_part_request_fields', 'trg_notify_admin_on_technician_registration');

-- 4. Test Failure Recovery: Attempt replacement with non-existent function
DO $$
BEGIN
  EXECUTE 'CREATE OR REPLACE TRIGGER trg_protect_technician_part_request_fields BEFORE UPDATE ON public.service_centre_part_requests FOR EACH ROW EXECUTE FUNCTION public.non_existent_func()';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Expected failure caught: %', SQLERRM;
END $$;

-- Verify existing trigger was NOT dropped or broken by failed replacement
SELECT 
  tgname, 
  tgenabled,
  tgfoid::regproc AS func_binding
FROM pg_trigger
WHERE tgname = 'trg_protect_technician_part_request_fields';
"""

p = subprocess.run([PSQL, "-p", PORT, "-U", USER, "-d", DB, "-c", test_sql], capture_output=True, text=True)
print(p.stdout)
print(p.stderr)
