import subprocess
import json
import uuid
import time
import threading

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
DB_ARGS = ["-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "terabyte_clean_restore_drill"]

TECH_PROFILE_ID = "00000000-0000-0000-0002-000000000001"
TECH_AUTH_ID = "00000000-0000-0000-0000-000000000004"

FARMER_PROFILE_ID = "00000000-0000-0000-0001-000000000001"
FARMER_AUTH_ID = "00000000-0000-0000-0000-000000000001"

ADMIN_PROFILE_ID = "00000000-0000-0000-0003-000000000001"
ADMIN_AUTH_ID = "00000000-0000-0000-0000-000000000005"

EQUIPMENT_ID = "00000000-0000-0000-0010-000000000001"

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

passed = 0
failed = 0

def test(name, condition, detail=""):
    global passed, failed
    if condition:
        print(f"  [PASS] {name}")
        passed += 1
    else:
        print(f"  [FAIL] {name} - {detail}")
        failed += 1

print("=" * 80)
print("TerraByte — Step 5A.2 Final SQL Review Test Battery")
print("=" * 80)

run_sql("""
DELETE FROM public.service_centre_parts WHERE part_number LIKE 'DM-%' OR part_number LIKE 'HV-%';
""")

# ------------------------------------------------------------------------------
# 1. QUOTE REVISION ELIGIBILITY TESTS
# ------------------------------------------------------------------------------
print("\n--- 1. Quote Revision Eligibility Tests ---")
repair_id = str(uuid.uuid4())
part_id = str(uuid.uuid4())
part_num_1 = "DM-" + str(uuid.uuid4())[:8]

# Seed repair and part
code, out, err = run_sql(f"""
INSERT INTO public.service_centre_parts (id, name, part_number, stock_quantity, unit_price)
VALUES ('{part_id}', 'Diagnostic Module', '{part_num_1}', 10, 750);

INSERT INTO public.repair_requests (id, equipment_id, farmer_id, technician_id, status, job_number, description, location)
VALUES ('{repair_id}', '{EQUIPMENT_ID}', '{FARMER_PROFILE_ID}', '{TECH_PROFILE_ID}', 'ACCEPTED', 'JOB-REV-' || substring(gen_random_uuid()::text, 1, 8), 'Revision eligibility test', 'Wardha Depot');
""")
assert code == 0, f"Seed failed: {err}"

# Create v1 quote
v1_sql = f"""
SELECT public.create_quote_atomic(
  '{repair_id}'::uuid,
  'Initial Inspection',
  1000.0,
  18.0,
  '2 days',
  '30 days',
  '[
    {{"part_name": "Diagnostic Module", "part_spec": "Standard", "quantity": 1, "unit_price": 750.0, "part_source": "Depot", "catalog_part_id": "{part_id}"}}
  ]'::jsonb
);
"""
code, out, err = run_sql_as("technician", TECH_AUTH_ID, v1_sql)
test("Create v1 quote", code == 0, err)
v1_quote_data = json.loads(out.splitlines()[-1])
v1_id = v1_quote_data['id']

# Revise v1 to create v2 quote
v2_sql = f"""
SELECT public.revise_quote_atomic(
  '{v1_id}'::uuid,
  '{repair_id}'::uuid,
  'Revised Labour and Part',
  1200.0,
  18.0,
  '3 days',
  '30 days',
  'Needed more labour time',
  '[
    {{"part_name": "Diagnostic Module", "part_spec": "Standard", "quantity": 1, "unit_price": 750.0, "part_source": "Depot", "catalog_part_id": "{part_id}"}}
  ]'::jsonb
);
"""
code, out, err = run_sql_as("technician", TECH_AUTH_ID, v2_sql)
test("Revise v1 to create v2 quote", code == 0, err)
v2_quote_data = json.loads(out.splitlines()[-1])
v2_id = v2_quote_data['id']

# Test 1.1: Attempt to revise v1 again (now status=REVISED and superseded by v2)
code, out, err = run_sql_as("technician", TECH_AUTH_ID, v2_sql)
test("Reject revising older REVISED quote when newer PENDING quote exists",
     code != 0 and ("superseded" in err or "only PENDING quotes can be revised" in err),
     f"Expected rejection, got out={out}, err={err}")

# Test 1.2: Check that v1 quote is marked REVISED
code, out, err = run_sql(f"SELECT status FROM public.quotes WHERE id = '{v1_id}';")
test("v1 quote status is REVISED", out.strip() == "REVISED", f"Got status={out}")

# Test 1.3: Check that v2 quote is PENDING and version is 2
code, out, err = run_sql(f"SELECT status, version FROM public.quotes WHERE id = '{v2_id}';")
test("v2 quote status is PENDING and version is 2", out.strip() == "PENDING|2", f"Got {out}")

# Test 1.4: Revise v2 to create v3 (succeeds)
v3_sql = f"""
SELECT public.revise_quote_atomic(
  '{v2_id}'::uuid,
  '{repair_id}'::uuid,
  'Final Revision',
  1300.0,
  18.0,
  '4 days',
  '60 days',
  'Adjusted warranty',
  '[
    {{"part_name": "Diagnostic Module", "part_spec": "Standard", "quantity": 1, "unit_price": 750.0, "part_source": "Depot", "catalog_part_id": "{part_id}"}}
  ]'::jsonb
);
"""
code, out, err = run_sql_as("technician", TECH_AUTH_ID, v3_sql)
test("Revise latest PENDING quote (v2 -> v3) succeeds", code == 0, err)

# ------------------------------------------------------------------------------
# 2. TECHNICIAN ETA METADATA PROTECTION TESTS
# ------------------------------------------------------------------------------
print("\n--- 2. Technician ETA Metadata Protection Tests ---")
req_id = str(uuid.uuid4())
run_sql(f"""
INSERT INTO public.service_centre_part_requests (
  id, repair_request_id, part_id, quantity, status, requested_by, notes
) VALUES (
  '{req_id}', '{repair_id}', '{part_id}', 1, 'PENDING', '{TECH_PROFILE_ID}', 'Initial note'
);
""")

# Test 2.1: Direct table update by technician attempting to supply eta_updated_by
fake_admin = str(uuid.uuid4())
code, out, err = run_sql_as("technician", TECH_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET eta_updated_by = '{fake_admin}'::uuid
WHERE id = '{req_id}';
""")
test("Direct technician update supplying eta_updated_by is rejected",
     code != 0 and "Technicians cannot directly modify eta_updated_by" in err,
     f"code={code}, err={err}")

# Test 2.2: Direct table update by technician attempting to supply eta_updated_at
code, out, err = run_sql_as("technician", TECH_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET eta_updated_at = '2020-01-01 00:00:00+00'::timestamptz
WHERE id = '{req_id}';
""")
test("Direct technician update supplying eta_updated_at is rejected",
     code != 0 and "Technicians cannot directly modify eta_updated_by" in err,
     f"code={code}, err={err}")

# Test 2.3: Direct table update by technician attempting to supply updated_at
code, out, err = run_sql_as("technician", TECH_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET updated_at = '2020-01-01 00:00:00+00'::timestamptz
WHERE id = '{req_id}';
""")
test("Direct technician update supplying updated_at is rejected",
     code != 0 and "Technicians cannot directly modify eta_updated_by" in err,
     f"code={code}, err={err}")

# Test 2.4: Direct table update by technician modifying ONLY estimated_arrival_at and notes
code, out, err = run_sql_as("technician", TECH_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '5 days',
    notes = 'Supplier confirmed 5 day delivery'
WHERE id = '{req_id}';
""")
test("Legitimate direct technician update to ETA and notes succeeds", code == 0, err)

# Verify trigger automatically stamped eta_updated_by = TECH_PROFILE_ID
code, out, err = run_sql(f"""
SELECT eta_updated_by = '{TECH_PROFILE_ID}'::uuid, eta_updated_at IS NOT NULL
FROM public.service_centre_part_requests WHERE id = '{req_id}';
""")
test("Trigger stamped eta_updated_by and eta_updated_at authoritatively",
     out.strip() == "t|t", f"Got: {out}")

# Test 2.5: Admin direct update can modify fields
code, out, err = run_sql_as("admin", ADMIN_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET eta_updated_by = '{ADMIN_PROFILE_ID}'::uuid,
    notes = 'Admin manual override'
WHERE id = '{req_id}';
""")
test("Admin can perform direct table updates without restriction", code == 0, err)

# Test 2.6: Approved ETA RPC works seamlessly for assigned technician
code, out, err = run_sql_as("technician", TECH_AUTH_ID, f"""
SELECT public.update_service_centre_part_request_eta(
  '{req_id}'::uuid,
  now() + interval '2 days',
  'Dispatched by courier'
);
""")
test("Approved ETA RPC succeeds for assigned technician", code == 0, err)

# ------------------------------------------------------------------------------
# 3. SAFE PARTS-HOLD BOOLEAN PARSING TESTS
# ------------------------------------------------------------------------------
print("\n--- 3. Safe Parts-Hold Boolean Parsing Tests ---")
# Test 3.1: Malformed allPartsArrived string ("corrupt_string")
repair_malformed = str(uuid.uuid4())
run_sql(f"""
INSERT INTO public.repair_requests (id, equipment_id, farmer_id, technician_id, status, job_number, description, location, parts_hold)
VALUES (
  '{repair_malformed}', '{EQUIPMENT_ID}', '{FARMER_PROFILE_ID}', '{TECH_PROFILE_ID}', 'WAITING_FOR_PARTS', 'JOB-MAL-' || substring(gen_random_uuid()::text, 1, 8),
  'Malformed test', 'Depot',
  '{{"allPartsArrived": "corrupt_non_boolean_data", "part": "Sensor"}}'::jsonb
);
""")
# Because parts_hold is malformed, it should NOT treat it as valid active hold when status is WAITING_FOR_PARTS
code, out, err = run_sql_as("technician", TECH_AUTH_ID, f"""
SELECT public.create_quote_atomic(
  '{repair_malformed}'::uuid,
  'Repair with malformed hold',
  500.0, 18.0, '1 day', 'None', '[]'::jsonb
);
""")
test("create_quote_atomic safely rejects WAITING_FOR_PARTS with malformed hold without crashing",
     code != 0 and "invalid input syntax for type boolean" not in err and "without an active parts hold" in err,
     f"code={code}, err={err}")

# Test 3.2: Malformed boolean on ACCEPTED ticket (quote formulation succeeds and does not crash)
run_sql(f"UPDATE public.repair_requests SET status = 'ACCEPTED' WHERE id = '{repair_malformed}';")
code, out, err = run_sql_as("technician", TECH_AUTH_ID, f"""
SELECT public.create_quote_atomic(
  '{repair_malformed}'::uuid,
  'Labour inspection',
  500.0, 18.0, '1 day', 'None', '[]'::jsonb
);
""")
test("create_quote_atomic succeeds on ACCEPTED ticket without crashing on malformed allPartsArrived",
     code == 0, f"code={code}, err={err}")

# Test 3.3: revise_quote_atomic with malformed allPartsArrived does not crash
code, out, err = run_sql(f"SELECT id FROM public.quotes WHERE repair_request_id = '{repair_malformed}';")
malformed_q1_id = out.strip()
code, out, err = run_sql_as("technician", TECH_AUTH_ID, f"""
SELECT public.revise_quote_atomic(
  '{malformed_q1_id}'::uuid,
  '{repair_malformed}'::uuid,
  'Revised labour inspection',
  600.0, 18.0, '2 days', 'None', 'Updated', '[]'::jsonb
);
""")
test("revise_quote_atomic succeeds without crashing on malformed allPartsArrived",
     code == 0, f"code={code}, err={err}")

# Test 3.4: Legitimate active parts hold with boolean false and pending item preserves WAITING_FOR_PARTS
repair_hold = str(uuid.uuid4())
run_sql(f"""
INSERT INTO public.repair_requests (id, equipment_id, farmer_id, technician_id, status, job_number, description, location, parts_hold)
VALUES (
  '{repair_hold}', '{EQUIPMENT_ID}', '{FARMER_PROFILE_ID}', '{TECH_PROFILE_ID}', 'WAITING_FOR_PARTS', 'JOB-HLD-' || substring(gen_random_uuid()::text, 1, 8),
  'Legit hold test', 'Depot',
  '{{"allPartsArrived": false, "items": [{{"status": "PENDING", "part": "Sensor"}}]}}'::jsonb
);
""")
code, out, err = run_sql_as("technician", TECH_AUTH_ID, f"""
SELECT public.create_quote_atomic(
  '{repair_hold}'::uuid,
  'Labour with active hold',
  500.0, 18.0, '1 day', 'None', '[]'::jsonb
);
""")
test("create_quote_atomic on WAITING_FOR_PARTS with valid active hold succeeds", code == 0, err)
code, out, err = run_sql(f"SELECT status FROM public.repair_requests WHERE id = '{repair_hold}';")
test("WAITING_FOR_PARTS status preserved for valid active hold", out.strip() == "WAITING_FOR_PARTS", f"Got: {out}")

# ------------------------------------------------------------------------------
# 4. PART-REQUEST ASSIGNMENT RACE (ROW LOCKING)
# ------------------------------------------------------------------------------
print("\n--- 4. Part-Request Assignment Race & Row Locking Tests ---")
repair_race = str(uuid.uuid4())
run_sql(f"""
INSERT INTO public.repair_requests (id, equipment_id, farmer_id, technician_id, status, job_number, description, location)
VALUES ('{repair_race}', '{EQUIPMENT_ID}', '{FARMER_PROFILE_ID}', '{TECH_PROFILE_ID}', 'ACCEPTED', 'JOB-RCE-' || substring(gen_random_uuid()::text, 1, 8), 'Race test', 'Depot');
""")

# Unassigned technician cannot request parts
OTHER_TECH_PROFILE_ID = "00000000-0000-0000-0000-000000000006"
OTHER_TECH_AUTH_ID = "00000000-0000-0000-0000-000000000006"
run_sql(f"""
INSERT INTO auth.users (id, email) VALUES ('{OTHER_TECH_AUTH_ID}', 'other_tech@test.demo') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, auth_user_id, role, full_name, email)
VALUES ('{OTHER_TECH_PROFILE_ID}', '{OTHER_TECH_AUTH_ID}', 'technician'::public.user_role, 'Other Technician', 'other_tech@test.demo')
ON CONFLICT (id) DO NOTHING;
""")
code, out, err = run_sql_as("technician", OTHER_TECH_AUTH_ID, f"""
SELECT public.request_service_centre_part(
  '{repair_race}'::uuid,
  '{part_id}'::uuid,
  1,
  'Attempt unassigned request'
);
""")
test("Unassigned technician is rejected by request_service_centre_part",
     code != 0 and "You are not assigned to this repair ticket" in err,
     f"code={code}, err={err}")

# Assigned technician can request parts
code, out, err = run_sql_as("technician", TECH_AUTH_ID, f"""
SELECT public.request_service_centre_part(
  '{repair_race}'::uuid,
  '{part_id}'::uuid,
  2,
  'Technician authorized request'
);
""")
test("Assigned technician successfully requests parts with repair locked FOR UPDATE", code == 0, err)

# ------------------------------------------------------------------------------
# 5. CONSISTENT STOCK-OPERATION LOCK ORDERING & DEADLOCK PREVENTION
# ------------------------------------------------------------------------------
print("\n--- 5. Concurrent Handoff vs Return Lock Ordering Test ---")
repair_deadlock_test = str(uuid.uuid4())
part_deadlock_test = str(uuid.uuid4())
req_deadlock_1 = str(uuid.uuid4())
req_deadlock_2 = str(uuid.uuid4())

part_num_deadlock = "HV-" + str(uuid.uuid4())[:8]

run_sql(f"""
INSERT INTO public.service_centre_parts (id, name, part_number, stock_quantity, unit_price)
VALUES ('{part_deadlock_test}', 'Hydraulic Valve', '{part_num_deadlock}', 50, 1500);

INSERT INTO public.repair_requests (id, equipment_id, farmer_id, technician_id, status, job_number, description, location)
VALUES ('{repair_deadlock_test}', '{EQUIPMENT_ID}', '{FARMER_PROFILE_ID}', '{TECH_PROFILE_ID}', 'ACCEPTED', 'JOB-LCK-' || substring(gen_random_uuid()::text, 1, 8), 'Lock order test', 'Depot');

-- Create 2 requests
INSERT INTO public.service_centre_part_requests (id, repair_request_id, part_id, quantity, status, requested_by)
VALUES
  ('{req_deadlock_1}', '{repair_deadlock_test}', '{part_deadlock_test}', 5, 'PENDING', '{TECH_PROFILE_ID}'),
  ('{req_deadlock_2}', '{repair_deadlock_test}', '{part_deadlock_test}', 5, 'PENDING', '{TECH_PROFILE_ID}');
""")

# Hand off req 1 as admin so repair has issued stock available for return
code, out, err = run_sql_as("admin", ADMIN_AUTH_ID, f"""
SELECT public.confirm_service_centre_part_handoff('{req_deadlock_1}'::uuid);
""")
assert code == 0, f"Handoff 1 failed: {err}"

# Now run simultaneous transactions on separate threads:
# Thread A: confirms handoff of req_deadlock_2 (locks req_deadlock_2 -> repair -> part)
# Thread B: returns 2 units from repair_deadlock_test (locks repair -> part)
thread_errors = []
barrier = threading.Barrier(2)

def worker_handoff():
    try:
        barrier.wait()
        c, o, e = run_sql_as("admin", ADMIN_AUTH_ID, f"""
        SELECT public.confirm_service_centre_part_handoff('{req_deadlock_2}'::uuid);
        """)
        if c != 0:
            thread_errors.append(f"Handoff error: {e}")
    except Exception as ex:
        thread_errors.append(f"Handoff exception: {str(ex)}")

def worker_return():
    try:
        barrier.wait()
        c, o, e = run_sql_as("admin", ADMIN_AUTH_ID, f"""
        SELECT public.return_service_centre_part(
          '{repair_deadlock_test}'::uuid,
          '{part_deadlock_test}'::uuid,
          2,
          'Unused unit return'
        );
        """)
        if c != 0:
            thread_errors.append(f"Return error: {e}")
    except Exception as ex:
        thread_errors.append(f"Return exception: {str(ex)}")

t1 = threading.Thread(target=worker_handoff)
t2 = threading.Thread(target=worker_return)
t1.start()
t2.start()
t1.join(timeout=10)
t2.join(timeout=10)

test("Simultaneous handoff and return serialized with ZERO deadlocks",
     len(thread_errors) == 0,
     f"Errors encountered: {thread_errors}")

# Verify audit trail and stock consistency
code, out, err = run_sql(f"""
SELECT stock_quantity FROM public.service_centre_parts WHERE id = '{part_deadlock_test}';
""")
test("Stock correctly reflects both concurrent operations (50 - 5 - 5 + 2 = 42)",
     out.strip() == "42", f"Got stock: {out}")

# ------------------------------------------------------------------------------
# 6. NOTIFICATION CONCURRENCY & ISOLATION TESTS
# ------------------------------------------------------------------------------
print("\n--- 6. Notification Concurrency & Deduplication Tests ---")
# 6.1: Simultaneous registration for the SAME technician profile_id
duplicate_tech_profile_id = str(uuid.uuid4())
run_sql(f"""
INSERT INTO public.profiles (id, auth_user_id, role, full_name, email)
VALUES ('{duplicate_tech_profile_id}', NULL, 'technician'::public.user_role, 'Same Profile Tech', 'same_tech@test.demo');
""")

barrier_notif = threading.Barrier(2)
notif_thread_errors = []

def worker_reg(worker_id):
    try:
        barrier_notif.wait()
        # Each thread attempts to insert into technician_profiles in its own transaction
        cmd = [PSQL] + DB_ARGS + ["-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", f"""
        INSERT INTO public.technician_profiles (profile_id, workshop_name, is_verified)
        VALUES ('{duplicate_tech_profile_id}', 'Tech Workshop {worker_id}', false)
        ON CONFLICT (profile_id) DO NOTHING;
        """]
        res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
        if res.returncode != 0:
            notif_thread_errors.append(f"Worker {worker_id} error: {res.stderr}")
    except Exception as ex:
        notif_thread_errors.append(f"Worker {worker_id} exception: {str(ex)}")

t_reg1 = threading.Thread(target=worker_reg, args=(1,))
t_reg2 = threading.Thread(target=worker_reg, args=(2,))
t_reg1.start()
t_reg2.start()
t_reg1.join(timeout=10)
t_reg2.join(timeout=10)

test("Simultaneous registration transactions completed without crash",
     len(notif_thread_errors) == 0, f"Errors: {notif_thread_errors}")

# Count notifications for this profile ID
code, out, err = run_sql(f"""
SELECT count(*) FROM public.notifications
WHERE notification_text LIKE '%[Ref: {duplicate_tech_profile_id}]%';
""")
test("Exactly 1 notification created for same profile under concurrent race condition",
     out.strip() == "1", f"Expected count=1, got: {out}")

# 6.2: Two DISTINCT profiles with the SAME full name
name_collision = "Ramesh Kumar"
tech_a_id = str(uuid.uuid4())
tech_b_id = str(uuid.uuid4())

run_sql(f"""
INSERT INTO public.profiles (id, auth_user_id, role, full_name, email)
VALUES
  ('{tech_a_id}', NULL, 'technician'::public.user_role, '{name_collision}', 'ramesh.a@test.demo'),
  ('{tech_b_id}', NULL, 'technician'::public.user_role, '{name_collision}', 'ramesh.b@test.demo');

INSERT INTO public.technician_profiles (profile_id, workshop_name, is_verified)
VALUES
  ('{tech_a_id}', 'Ramesh Workshop Punjab', false),
  ('{tech_b_id}', 'Ramesh Workshop Haryana', false);
""")

code, out_a, err = run_sql(f"""
SELECT count(*) FROM public.notifications
WHERE notification_text LIKE '%[Ref: {tech_a_id}]%';
""")
code, out_b, err = run_sql(f"""
SELECT count(*) FROM public.notifications
WHERE notification_text LIKE '%[Ref: {tech_b_id}]%';
""")
test("Technician A with duplicate name receives notification", out_a.strip() == "1", f"Got {out_a}")
test("Technician B with duplicate name receives separate notification", out_b.strip() == "1", f"Got {out_b}")

print("\n" + "=" * 80)
print(f"STEP 5A.2 TEST SUITE SUMMARY: {passed} PASSED, {failed} FAILED")
print("=" * 80)
if failed > 0:
    exit(1)
