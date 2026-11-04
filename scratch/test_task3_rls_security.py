import subprocess

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
DB = "terabyte_clean_restore_drill"
PORT = "5433"
USER = "postgres"

test_sql = """
-- Setup repair assigned to Tech 1
DO $$
DECLARE
  v_tech1_prof uuid := '00000000-0000-0000-0002-000000000001';
  v_admin_prof uuid := '00000000-0000-0000-0001-000000000001';
  v_eq_id uuid := '00000000-0000-0000-0010-000000000001';
  v_repair1 uuid := 'aaaaaaaa-1111-1111-1111-111111111111';
  v_part1 uuid;
  v_req1 uuid := 'bbbbbbbb-1111-1111-1111-111111111111';
BEGIN
  INSERT INTO public.repair_requests (id, job_number, farmer_id, technician_id, status, equipment_id, location)
    VALUES (v_repair1, 'JOB-SEC-01', v_admin_prof, v_tech1_prof, 'ACCEPTED', v_eq_id, 'Field A')
    ON CONFLICT (id) DO UPDATE SET technician_id = v_tech1_prof, status = 'ACCEPTED';

  SELECT id INTO v_part1 FROM public.service_centre_parts LIMIT 1;
  
  INSERT INTO public.service_centre_part_requests (id, repair_request_id, part_id, requested_by, quantity, status)
    VALUES (v_req1, v_repair1, v_part1, v_tech1_prof, 1, 'PENDING')
    ON CONFLICT (id) DO UPDATE SET status = 'PENDING', quantity = 1;
END $$;

-- TEST 1: Assigned technician legitimate ETA update (Tech 1)
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004'; -- Tech 1
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '2 days', notes = 'Arriving Wednesday'
WHERE id = 'bbbbbbbb-1111-1111-1111-111111111111';
SELECT 'TEST 1: Assigned tech update' AS test, count(*) AS updated_rows FROM public.service_centre_part_requests WHERE id = 'bbbbbbbb-1111-1111-1111-111111111111' AND notes = 'Arriving Wednesday';
ROLLBACK;

-- TEST 2: Unassigned technician update attempt (Tech 2)
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006'; -- Tech 2 (Not assigned to this repair)
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '5 days', notes = 'Hacked by unassigned tech'
WHERE id = 'bbbbbbbb-1111-1111-1111-111111111111';
SELECT 'TEST 2: Unassigned tech update' AS test, count(*) AS updated_rows FROM public.service_centre_part_requests WHERE id = 'bbbbbbbb-1111-1111-1111-111111111111' AND notes = 'Hacked by unassigned tech';
ROLLBACK;

-- TEST 3: Assigned technician updating non-PENDING requisition
BEGIN;
-- Set status to ORDERED
UPDATE public.service_centre_part_requests SET status = 'ORDERED' WHERE id = 'bbbbbbbb-1111-1111-1111-111111111111';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004'; -- Tech 1
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '5 days', notes = 'Update after ordered'
WHERE id = 'bbbbbbbb-1111-1111-1111-111111111111';
SELECT 'TEST 3: Non-PENDING tech update' AS test, count(*) AS updated_rows FROM public.service_centre_part_requests WHERE id = 'bbbbbbbb-1111-1111-1111-111111111111' AND notes = 'Update after ordered';
ROLLBACK;

-- TEST 4: Assigned technician attempting to modify quantity (Trigger check)
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004'; -- Tech 1
DO $$
BEGIN
  UPDATE public.service_centre_part_requests SET quantity = 99 WHERE id = 'bbbbbbbb-1111-1111-1111-111111111111';
  RAISE EXCEPTION 'TEST 4 FAILED: Quantity update was permitted!';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'TEST 4 PASSED: Quantity update blocked by trigger: %', SQLERRM;
END $$;
ROLLBACK;

-- TEST 5: Assigned technician attempting to spoof eta_updated_by metadata
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004'; -- Tech 1
DO $$
BEGIN
  UPDATE public.service_centre_part_requests 
  SET eta_updated_by = '00000000-0000-0000-0001-000000000001' -- Trying to claim Admin updated it
  WHERE id = 'bbbbbbbb-1111-1111-1111-111111111111';
  RAISE EXCEPTION 'TEST 5 FAILED: Spoofing eta_updated_by was permitted!';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'TEST 5 PASSED: Spoofing blocked by trigger: %', SQLERRM;
END $$;
ROLLBACK;

-- TEST 6: Anonymous role attempting update
BEGIN;
SET LOCAL ROLE anon;
UPDATE public.service_centre_part_requests SET notes = 'Hacked by anon' WHERE id = 'bbbbbbbb-1111-1111-1111-111111111111';
SELECT 'TEST 6: Anon update' AS test, count(*) AS updated_rows FROM public.service_centre_part_requests WHERE id = 'bbbbbbbb-1111-1111-1111-111111111111' AND notes = 'Hacked by anon';
ROLLBACK;

-- TEST 7: Admin updating requisition (allowed)
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001'; -- Admin
UPDATE public.service_centre_part_requests SET notes = 'Admin updated notes', estimated_arrival_at = now() + interval '1 day' WHERE id = 'bbbbbbbb-1111-1111-1111-111111111111';
SELECT 'TEST 7: Admin update' AS test, count(*) AS updated_rows FROM public.service_centre_part_requests WHERE id = 'bbbbbbbb-1111-1111-1111-111111111111' AND notes = 'Admin updated notes';
ROLLBACK;
"""

p = subprocess.run([PSQL, "-p", PORT, "-U", USER, "-d", DB, "-c", test_sql], capture_output=True, text=True)
print(p.stdout)
print(p.stderr)
