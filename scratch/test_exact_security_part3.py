import subprocess

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
DB = "terabyte_clean_restore_drill"
PORT = "5433"
USER = "postgres"

test_sql = """
-- Test 5: Assigned technician updating HANDED_OFF requisition
BEGIN;
UPDATE public.service_centre_part_requests SET status = 'HANDED_OFF' WHERE id = '33333333-3333-3333-3333-333333333333';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004'; -- Tech 1
UPDATE public.service_centre_part_requests 
SET estimated_arrival_at = now() + interval '1 day', notes = 'Updating handed off item'
WHERE id = '33333333-3333-3333-3333-333333333333';
SELECT 'T5: Non-PENDING tech update' AS test, count(*) AS updated 
FROM public.service_centre_part_requests 
WHERE id = '33333333-3333-3333-3333-333333333333' AND notes = 'Updating handed off item';
ROLLBACK;
"""

p = subprocess.run([PSQL, "-p", PORT, "-U", USER, "-d", DB, "-c", test_sql], capture_output=True, text=True)
print("Test 5 (HANDED_OFF) STDOUT:\n", p.stdout)
print("Test 5 (HANDED_OFF) STDERR:\n", p.stderr)
