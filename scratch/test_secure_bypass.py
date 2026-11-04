import subprocess
import uuid

PSQL = r'D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe'
DB_ARGS = ['-h', '127.0.0.1', '-p', '5433', '-U', 'postgres', '-d', 'terabyte_clean_restore_drill']

TECH_AUTH_ID = '00000000-0000-0000-0000-000000000004'
TECH_PROFILE_ID = '00000000-0000-0000-0002-000000000001'
ADMIN_AUTH_ID = '00000000-0000-0000-0000-000000000005'
ADMIN_PROFILE_ID = '00000000-0000-0000-0003-000000000001'
FARMER_PROFILE_ID = '00000000-0000-0000-0001-000000000001'
EQUIPMENT_ID = '00000000-0000-0000-0010-000000000001'

def run_sql(sql):
    cmd = [PSQL] + DB_ARGS + ["-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    return res.returncode, res.stdout.strip(), res.stderr.strip()

def run_sql_as(role, user_auth_id, sql):
    wrapper = f"""
    SET ROLE authenticated;
    SET request.jwt.claim.role = '{role}';
    SET request.jwt.claim.sub = '{user_auth_id}';
    SET request.jwt.claims = '{{"sub":"{user_auth_id}","role":"{role}"}}';
    {sql}
    """
    cmd = [PSQL] + DB_ARGS + ["-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", wrapper]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    return res.returncode, res.stdout.strip(), res.stderr.strip()

# Apply the proposed trigger definition to drill DB
new_trigger_sql = """
CREATE OR REPLACE FUNCTION public.trg_enforce_technician_part_request_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 1. Database superusers or application administrators bypass technician restrictions
  IF public.current_user_role() = 'admin'::user_role THEN
    RETURN NEW;
  END IF;

  -- 2. Technicians performing direct table updates
  IF public.current_user_role() = 'technician'::user_role THEN
    -- Prevent alteration of core requisition attributes
    IF NEW.quantity IS DISTINCT FROM OLD.quantity OR
       NEW.part_id IS DISTINCT FROM OLD.part_id OR
       NEW.repair_request_id IS DISTINCT FROM OLD.repair_request_id OR
       NEW.requested_by IS DISTINCT FROM OLD.requested_by OR
       NEW.status IS DISTINCT FROM OLD.status OR
       NEW.handed_off_by IS DISTINCT FROM OLD.handed_off_by OR
       NEW.handed_off_at IS DISTINCT FROM OLD.handed_off_at THEN
      RAISE EXCEPTION 'Unauthorized: Technicians can only coordinate part ETA and notes, and cannot modify requisition quantity, part, or status.'
        USING ERRCODE = '42501';
    END IF;

    -- Prevent direct manipulation of audit/metadata columns
    IF NEW.eta_updated_by IS DISTINCT FROM OLD.eta_updated_by OR
       NEW.eta_updated_at IS DISTINCT FROM OLD.eta_updated_at OR
       NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
      RAISE EXCEPTION 'Unauthorized: Technicians cannot directly modify eta_updated_by, eta_updated_at, or updated_at metadata.'
        USING ERRCODE = '42501';
    END IF;

    -- On legitimate ETA or notes update, stamp metadata authoritatively
    IF NEW.estimated_arrival_at IS DISTINCT FROM OLD.estimated_arrival_at OR
       NEW.notes IS DISTINCT FROM OLD.notes THEN
      NEW.eta_updated_by := public.current_profile_id();
      NEW.eta_updated_at := now();
      NEW.updated_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
"""
run_sql(new_trigger_sql)

# Also update update_service_centre_part_request_eta to not update metadata directly
# and remove set_config
update_rpc_sql = """
CREATE OR REPLACE FUNCTION public.update_service_centre_part_request_eta(
  p_request_id uuid,
  p_estimated_arrival_at timestamptz,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_profile_id uuid;
  v_caller_role user_role;
  v_caller_name text;
  v_request record;
  v_part record;
  v_repair record;
  v_is_authorized boolean := false;
  v_now timestamptz := now();
  v_formatted_eta text;
  v_overall_eta_str text;
  v_latest_pending_eta timestamptz;
  v_parts_hold jsonb;
  v_items jsonb;
  v_updated_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_matched boolean := false;
  v_pending_count int := 0;
BEGIN
  -- 1. Caller verification
  SELECT id, role, full_name INTO v_caller_profile_id, v_caller_role, v_caller_name
  FROM public.profiles
  WHERE auth_user_id = auth.uid() 
     OR id = auth.uid()
     OR (clerk_user_id IS NOT NULL AND clerk_user_id = auth.jwt()->>'sub')
  LIMIT 1;

  IF v_caller_profile_id IS NULL THEN
    v_caller_profile_id := public.current_profile_id();
    v_caller_role := public.current_user_role();
  END IF;

  IF v_caller_profile_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  -- 2. Fetch part request with row lock
  SELECT * INTO v_request
  FROM public.service_centre_part_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Part requisition not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_request.status != 'PENDING' THEN
    RAISE EXCEPTION 'Cannot update ETA: Part request is already %.', v_request.status
      USING ERRCODE = '22000';
  END IF;

  -- 3. Fetch linked repair ticket with row lock
  SELECT * INTO v_repair
  FROM public.repair_requests
  WHERE id = v_request.repair_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linked repair request not found.' USING ERRCODE = 'P0002';
  END IF;

  -- 4. Authorize: Admin OR assigned technician (NULL-safe check)
  IF v_caller_role = 'admin' THEN
    v_is_authorized := true;
  ELSIF v_caller_role = 'technician' AND v_repair.technician_id IS NOT DISTINCT FROM v_caller_profile_id THEN
    v_is_authorized := true;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Unauthorized: Only the assigned technician or Service Centre staff can coordinate part ETA.'
      USING ERRCODE = '42501';
  END IF;

  -- 5. Fetch catalog part info
  SELECT * INTO v_part
  FROM public.service_centre_parts
  WHERE id = v_request.part_id;

  IF p_estimated_arrival_at IS NOT NULL THEN
    v_formatted_eta := to_char(p_estimated_arrival_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH24:MI');
  ELSE
    v_formatted_eta := 'ETA pending';
  END IF;

  -- 6. Update requisition row
  -- The trigger authoritatively stamps eta_updated_by, eta_updated_at, and updated_at
  UPDATE public.service_centre_part_requests
  SET
    estimated_arrival_at = p_estimated_arrival_at,
    notes = COALESCE(NULLIF(TRIM(p_notes), ''), notes)
  WHERE id = v_request.id;

  -- 7. Validate and synchronize repair_requests.parts_hold blocker items
  v_parts_hold := COALESCE(v_repair.parts_hold, '{}'::jsonb);
  IF jsonb_typeof(v_parts_hold) <> 'object' THEN
    v_parts_hold := '{}'::jsonb;
  END IF;

  v_items := COALESCE(v_parts_hold->'items', '[]'::jsonb);
  IF jsonb_typeof(v_items) <> 'array' THEN
    v_items := '[]'::jsonb;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    IF (v_item->>'id' = v_request.id::text) OR
       (v_item->>'partId' = v_request.part_id::text) OR
       (LOWER(v_item->>'part') = LOWER(COALESCE(v_part.name, ''))) THEN
      v_matched := true;
      v_updated_items := v_updated_items || jsonb_build_array(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(v_item, '{eta}', to_jsonb(v_formatted_eta)),
              '{eta_updated_by}', to_jsonb(v_caller_profile_id::text)
            ),
            '{eta_updated_at}', to_jsonb(to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
          ),
          '{notes}', to_jsonb(COALESCE(NULLIF(TRIM(p_notes), ''), v_item->>'notes', ''))
        )
      );
    ELSE
      v_updated_items := v_updated_items || jsonb_build_array(v_item);
    END IF;
  END LOOP;

  IF NOT v_matched THEN
    v_updated_items := v_updated_items || jsonb_build_array(
      jsonb_build_object(
        'id', v_request.id,
        'part', COALESCE(v_part.name, 'Spare Part'),
        'partId', v_request.part_id,
        'quantity', v_request.quantity,
        'reason', COALESCE(p_notes, 'Waiting for parts delivery'),
        'eta', v_formatted_eta,
        'status', 'PENDING',
        'since', to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'eta_updated_by', v_caller_profile_id::text,
        'eta_updated_at', to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
    );
  END IF;

  -- 8. Authoritative ETA aggregation across pending requests (comparing timestamptz)
  SELECT MAX(estimated_arrival_at), COUNT(*)
  INTO v_latest_pending_eta, v_pending_count
  FROM public.service_centre_part_requests
  WHERE repair_request_id = v_repair.id
    AND status = 'PENDING';

  IF v_latest_pending_eta IS NOT NULL THEN
    v_overall_eta_str := to_char(v_latest_pending_eta AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH24:MI');
  ELSIF p_estimated_arrival_at IS NOT NULL THEN
    v_overall_eta_str := v_formatted_eta;
  ELSE
    v_overall_eta_str := 'ETA pending';
  END IF;

  -- Check if any updated items in parts_hold are pending
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_updated_items)
  LOOP
    IF COALESCE(v_item->>'status', 'PENDING') = 'PENDING' AND v_pending_count = 0 THEN
      v_pending_count := 1;
    END IF;
  END LOOP;

  UPDATE public.repair_requests
  SET
    parts_hold = jsonb_build_object(
      'part', COALESCE(v_parts_hold->>'part', v_part.name, 'Spare Part'),
      'reason', COALESCE(NULLIF(TRIM(p_notes), ''), v_parts_hold->>'reason', 'Waiting for parts delivery'),
      'eta', v_overall_eta_str,
      'note', COALESCE(NULLIF(TRIM(p_notes), ''), v_parts_hold->>'note', ''),
      'revisedCompletion', v_overall_eta_str,
      'since', COALESCE(v_parts_hold->>'since', to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
      'items', v_updated_items,
      'allPartsArrived', (v_pending_count = 0),
      'updated_at', to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),
    updated_at = v_now
  WHERE id = v_repair.id;

  INSERT INTO public.repair_timeline (
    repair_request_id,
    created_by_id,
    created_by_role,
    status,
    note
  ) VALUES (
    v_repair.id,
    v_caller_profile_id,
    v_caller_role::text,
    'WAITING_FOR_PARTS',
    'Part ETA updated for ' || COALESCE(v_part.name, 'spare part') || ': ' || v_formatted_eta || ' by ' || COALESCE(v_caller_name, 'Staff') || '.'
  );

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_request.id,
    'part_name', COALESCE(v_part.name, 'Spare Part'),
    'estimated_arrival_at', p_estimated_arrival_at,
    'formatted_eta', v_formatted_eta,
    'overall_eta', v_overall_eta_str,
    'eta_updated_by', v_caller_profile_id,
    'eta_updated_at', v_now
  );
END;
$$;
"""
run_sql(update_rpc_sql)

print("Applied clean trigger and RPC definitions to drill database.")

# Now test:
# 1. Test exploit with SET terabyte.in_eta_rpc = 'true' -> MUST BE BLOCKED!
repair_id = str(uuid.uuid4())
part_id = str(uuid.uuid4())
req_id = str(uuid.uuid4())
part_num = "TEST-SEC-" + str(uuid.uuid4())[:8]

run_sql(f"""
INSERT INTO public.service_centre_parts (id, name, part_number, stock_quantity, unit_price)
VALUES ('{part_id}', 'Security Test Part', '{part_num}', 10, 500);

INSERT INTO public.repair_requests (id, equipment_id, farmer_id, technician_id, status, job_number, description, location)
VALUES ('{repair_id}', '{EQUIPMENT_ID}', '{FARMER_PROFILE_ID}', '{TECH_PROFILE_ID}', 'ACCEPTED', 'JOB-SEC-' || substring(gen_random_uuid()::text, 1, 8), 'Security test', 'Depot');

INSERT INTO public.service_centre_part_requests (id, repair_request_id, part_id, quantity, status, requested_by)
VALUES ('{req_id}', '{repair_id}', '{part_id}', 1, 'PENDING', '{TECH_PROFILE_ID}');
""")

# Test 1: Direct update attempting to change quantity with GUC
code1, out1, err1 = run_sql_as("technician", TECH_AUTH_ID, f"""
SET terabyte.in_eta_rpc = 'true';
UPDATE public.service_centre_part_requests SET quantity = 99 WHERE id = '{req_id}';
""")
print("\n1. Exploit attempt with 'SET terabyte.in_eta_rpc = true':")
print("  RC:", code1, "(expected non-zero)")
print("  Error:", err1)
assert code1 != 0 and "Technicians can only coordinate part ETA and notes" in err1, "Exploit was not blocked!"

# Test 2: Direct update attempting to supply eta_updated_by
code2, out2, err2 = run_sql_as("technician", TECH_AUTH_ID, f"""
SET terabyte.in_eta_rpc = 'true';
UPDATE public.service_centre_part_requests SET eta_updated_by = '{ADMIN_PROFILE_ID}'::uuid WHERE id = '{req_id}';
""")
print("\n2. Direct update attempting to supply eta_updated_by with GUC:")
print("  RC:", code2, "(expected non-zero)")
print("  Error:", err2)
assert code2 != 0 and "Technicians cannot directly modify eta_updated_by" in err2, "Metadata spoofing was not blocked!"

# Test 3: Approved ETA RPC by technician -> MUST SUCCEED!
code3, out3, err3 = run_sql_as("technician", TECH_AUTH_ID, f"""
SELECT public.update_service_centre_part_request_eta('{req_id}'::uuid, now() + interval '3 days', 'Valid courier update');
""")
print("\n3. Approved ETA RPC by technician:")
print("  RC:", code3, "(expected 0)")
print("  Output:", out3.splitlines()[-1] if out3 else "")
print("  Error:", err3)
assert code3 == 0, f"RPC failed: {err3}"

# Verify DB state after RPC
code4, out4, err4 = run_sql(f"""
SELECT eta_updated_by = '{TECH_PROFILE_ID}'::uuid,
       eta_updated_at IS NOT NULL,
       estimated_arrival_at IS NOT NULL,
       quantity
FROM public.service_centre_part_requests WHERE id = '{req_id}';
""")
print("\n4. Database record verification after RPC:")
print("  Result (eta_by=tech | eta_at!=null | est_arrival!=null | quantity=1):", out4)
assert out4.strip() == "t|t|t|1", f"Unexpected state: {out4}"

# Test 5: Legitimate direct update to ETA and notes by technician -> MUST SUCCEED & AUTO-STAMP!
code5, out5, err5 = run_sql_as("technician", TECH_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '5 days',
    notes = 'Direct note from tech'
WHERE id = '{req_id}';
""")
print("\n5. Legitimate direct ETA update by technician:")
print("  RC:", code5, "(expected 0)")
assert code5 == 0, f"Direct update failed: {err5}"

# Test 6: Direct update by admin -> MUST SUCCEED!
code6, out6, err6 = run_sql_as("admin", ADMIN_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET eta_updated_by = '{ADMIN_PROFILE_ID}'::uuid,
    quantity = 2
WHERE id = '{req_id}';
""")
print("\n6. Direct update by admin modifying quantity and metadata:")
print("  RC:", code6, "(expected 0)")
assert code6 == 0, f"Admin update failed: {err6}"

print("\nALL SECURITY VALIDATIONS PASSED CLEANLY!")
