import subprocess

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
DB = "terabyte_clean_restore_drill"
PORT = "5433"
USER = "postgres"

test_sql = """
-- Setup dummy part request for existing technician
DO $$
DECLARE
  v_pid uuid := '00000000-0000-0000-0002-000000000001';
  v_rid uuid := '22222222-2222-2222-2222-222222222222';
  v_req_id uuid := '33333333-3333-3333-3333-333333333333';
  v_part_id uuid;
  v_eq_id uuid := '00000000-0000-0000-0010-000000000001';
BEGIN
  INSERT INTO public.repair_requests (id, job_number, farmer_id, technician_id, status, equipment_id, location)
    VALUES (v_rid, 'JOB-999', v_pid, v_pid, 'ACCEPTED', v_eq_id, 'Field 1') ON CONFLICT (id) DO NOTHING;
  
  SELECT id INTO v_part_id FROM public.service_centre_parts LIMIT 1;
  IF v_part_id IS NOT NULL THEN
    INSERT INTO public.service_centre_part_requests (id, repair_request_id, part_id, requested_by, quantity, status)
      VALUES (v_req_id, v_rid, v_part_id, v_pid, 1, 'PENDING') ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- Test 1: With EXECUTE revoked from authenticated
REVOKE EXECUTE ON FUNCTION public.trg_enforce_technician_part_request_fields() FROM authenticated;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';

-- Attempt UPDATE
UPDATE public.service_centre_part_requests 
SET estimated_arrival_at = now() + interval '1 day', notes = 'Test notes'
WHERE id = '33333333-3333-3333-3333-333333333333';
COMMIT;

SELECT id, notes, estimated_arrival_at, eta_updated_by 
FROM public.service_centre_part_requests 
WHERE id = '33333333-3333-3333-3333-333333333333';
"""

p = subprocess.run([PSQL, "-p", PORT, "-U", USER, "-d", DB, "-c", test_sql], capture_output=True, text=True)
print("RC:", p.returncode)
print("OUT:\n", p.stdout)
print("ERR:\n", p.stderr)
