import subprocess

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
DB = "terabyte_clean_restore_drill"
PORT = "5433"
USER = "postgres"

test_sql = """
-- Test 3: Assigned technician trying to spoof eta_updated_by
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004'; -- Tech 1
UPDATE public.service_centre_part_requests 
SET eta_updated_by = '00000000-0000-0000-0001-000000000001'
WHERE id = '33333333-3333-3333-3333-333333333333';
ROLLBACK;
"""

p = subprocess.run([PSQL, "-p", PORT, "-U", USER, "-d", DB, "-c", test_sql], capture_output=True, text=True)
print("Test 3 (Spoofing) STDERR:\n", p.stderr)

test_sql_4 = """
-- Test 4: Unassigned technician update
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006'; -- Tech 2 (Not assigned to repair 22222222)
UPDATE public.service_centre_part_requests 
SET estimated_arrival_at = now() + interval '1 day', notes = 'Unassigned tech hack'
WHERE id = '33333333-3333-3333-3333-333333333333';
SELECT 'T4: Unassigned tech update' AS test, count(*) AS updated 
FROM public.service_centre_part_requests 
WHERE id = '33333333-3333-3333-3333-333333333333' AND notes = 'Unassigned tech hack';
ROLLBACK;
"""

p4 = subprocess.run([PSQL, "-p", PORT, "-U", USER, "-d", DB, "-c", test_sql_4], capture_output=True, text=True)
print("Test 4 (Unassigned) STDOUT:\n", p4.stdout)
print("Test 4 (Unassigned) STDERR:\n", p4.stderr)
