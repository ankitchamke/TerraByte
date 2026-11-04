import subprocess

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
DB = "terabyte_clean_restore_drill"
PORT = "5433"
USER = "postgres"

test_sql = """
-- Re-apply trigger to ensure clean state
CREATE OR REPLACE TRIGGER trg_protect_technician_part_request_fields
  BEFORE UPDATE ON public.service_centre_part_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_enforce_technician_part_request_fields();

-- Test 1: Assigned technician legitimate update
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004'; -- Tech 1
UPDATE public.service_centre_part_requests 
SET estimated_arrival_at = now() + interval '1 day', notes = 'Legitimate ETA update'
WHERE id = '33333333-3333-3333-3333-333333333333';
SELECT 'T1: Legitimate ETA update' AS test, count(*) AS updated 
FROM public.service_centre_part_requests 
WHERE id = '33333333-3333-3333-3333-333333333333' AND notes = 'Legitimate ETA update';
ROLLBACK;

-- Test 2: Assigned technician trying to alter quantity
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004'; -- Tech 1
UPDATE public.service_centre_part_requests 
SET quantity = 99
WHERE id = '33333333-3333-3333-3333-333333333333';
ROLLBACK;

-- Test 3: Assigned technician trying to spoof eta_updated_by
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004'; -- Tech 1
UPDATE public.service_centre_part_requests 
SET eta_updated_by = '00000000-0000-0000-0001-000000000001'
WHERE id = '33333333-3333-3333-3333-333333333333';
ROLLBACK;

-- Test 4: Unassigned technician update
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006'; -- Tech 2
UPDATE public.service_centre_part_requests 
SET estimated_arrival_at = now() + interval '1 day'
WHERE id = '33333333-3333-3333-3333-333333333333';
SELECT 'T4: Unassigned tech update' AS test, count(*) AS updated 
FROM public.service_centre_part_requests 
WHERE id = '33333333-3333-3333-3333-333333333333' AND estimated_arrival_at > now();
ROLLBACK;
"""

p = subprocess.run([PSQL, "-p", PORT, "-U", USER, "-d", DB, "-c", test_sql], capture_output=True, text=True)
print("RC:", p.returncode)
print("STDOUT:\n", p.stdout)
print("STDERR:\n", p.stderr)
