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
print("TerraByte — Step 5A.3 Lock-Order Reconciliation & Verification Battery")
print("=" * 80)

# ------------------------------------------------------------------------------
# 1. HANDOFF VERSUS RETURN ON SAME REPAIR & PART
# ------------------------------------------------------------------------------
print("\n--- 1. Handoff vs Return on Same Repair & Part ---")
repair_id_1 = str(uuid.uuid4())
part_id_1 = str(uuid.uuid4())
part_num_1 = "PART-HR-" + str(uuid.uuid4())[:8]
req_seed_id = str(uuid.uuid4())
req_concurrent_id = str(uuid.uuid4())

# Setup fixture: Part with 100 initial stock, repair request
run_sql(f"""
INSERT INTO public.service_centre_parts (id, name, part_number, stock_quantity, unit_price)
VALUES ('{part_id_1}', 'Heavy Duty Injector', '{part_num_1}', 100, 2500);

INSERT INTO public.repair_requests (id, equipment_id, farmer_id, technician_id, status, job_number, description, location)
VALUES ('{repair_id_1}', '{EQUIPMENT_ID}', '{FARMER_PROFILE_ID}', '{TECH_PROFILE_ID}', 'ACCEPTED', 'JOB-HR-' || substring(gen_random_uuid()::text, 1, 8), 'Handoff vs Return Test', 'Wardha Depot');

-- Requisition 1: Seed requisition of 10 units (to establish issued baseline for return)
INSERT INTO public.service_centre_part_requests (id, repair_request_id, part_id, quantity, status, requested_by)
VALUES ('{req_seed_id}', '{repair_id_1}', '{part_id_1}', 10, 'PENDING', '{TECH_PROFILE_ID}');

-- Requisition 2: Requisition of 10 units for concurrent handoff
INSERT INTO public.service_centre_part_requests (id, repair_request_id, part_id, quantity, status, requested_by)
VALUES ('{req_concurrent_id}', '{repair_id_1}', '{part_id_1}', 10, 'PENDING', '{TECH_PROFILE_ID}');
""")

# Seed handoff: Confirm req 1 handoff -> stock drops from 100 to 90, issued = 10
code, out, err = run_sql_as("admin", ADMIN_AUTH_ID, f"SELECT public.confirm_service_centre_part_handoff('{req_seed_id}'::uuid);")
assert code == 0, f"Seed handoff failed: {err}"

# Now launch simultaneous transactions across independent DB connections:
# Worker A: confirm_service_centre_part_handoff on req_concurrent_id (10 units)
# Worker B: return_service_centre_part on repair_id_1 (5 units)
thread_errors = []
barrier_1 = threading.Barrier(2)
handoff_res = {}
return_res = {}

def worker_handoff_1():
    try:
        barrier_1.wait()
        c, o, e = run_sql_as("admin", ADMIN_AUTH_ID, f"SELECT public.confirm_service_centre_part_handoff('{req_concurrent_id}'::uuid);")
        handoff_res['code'] = c
        handoff_res['out'] = o
        handoff_res['err'] = e
        if c != 0:
            thread_errors.append(f"Worker Handoff Error: {e}")
    except Exception as ex:
        thread_errors.append(f"Worker Handoff Exception: {str(ex)}")

def worker_return_1():
    try:
        barrier_1.wait()
        c, o, e = run_sql_as("admin", ADMIN_AUTH_ID, f"SELECT public.return_service_centre_part('{repair_id_1}'::uuid, '{part_id_1}'::uuid, 5, 'Unused 5 units');")
        return_res['code'] = c
        return_res['out'] = o
        return_res['err'] = e
        if c != 0:
            thread_errors.append(f"Worker Return Error: {e}")
    except Exception as ex:
        thread_errors.append(f"Worker Return Exception: {str(ex)}")

t1 = threading.Thread(target=worker_handoff_1)
t2 = threading.Thread(target=worker_return_1)
t1.start()
t2.start()
t1.join(timeout=10)
t2.join(timeout=10)

test("No deadlocks encountered during simultaneous handoff and return",
     len(thread_errors) == 0, f"Errors: {thread_errors}")
test("Handoff worker succeeded", handoff_res.get('code') == 0, handoff_res.get('err', ''))
test("Return worker succeeded", return_res.get('code') == 0, return_res.get('err', ''))

# Verify final stock quantity: 100 - 10 (seed) - 10 (concurrent handoff) + 5 (concurrent return) = 85
code, out, err = run_sql(f"SELECT stock_quantity FROM public.service_centre_parts WHERE id = '{part_id_1}';")
test("Stock quantity correctly reconciled (100 - 10 - 10 + 5 = 85)",
     out.strip() == "85", f"Expected 85, got: {out}")

# Verify audit trail immutability and record integrity
code, out, err = run_sql(f"""
SELECT count(*),
       sum(case when movement_type = 'ISSUED_TO_REPAIR' then change_quantity else 0 end),
       sum(case when movement_type = 'RETURNED' then change_quantity else 0 end)
FROM public.service_centre_stock_audit
WHERE part_id = '{part_id_1}' AND repair_request_id = '{repair_id_1}';
""")
# Expected: 3 rows total (2 ISSUED_TO_REPAIR of -10 each -> sum = -20; 1 RETURNED of +5 -> sum = +5)
audit_counts = out.strip().split('|')
test("Audit trail contains exactly 3 records (2 issued, 1 returned)", audit_counts[0] == "3", f"Got: {out}")
test("Audit issued quantity sum is exactly -20", audit_counts[1] == "-20", f"Got: {out}")
test("Audit returned quantity sum is exactly +5", audit_counts[2] == "5", f"Got: {out}")

# ------------------------------------------------------------------------------
# 2. HANDOFF VERSUS ETA UPDATE ON SAME PART REQUEST
# ------------------------------------------------------------------------------
print("\n--- 2. Handoff vs ETA Update on Same Part Request ---")

# Scenario 2A: Simultaneous execution with barrier
repair_id_2a = str(uuid.uuid4())
part_id_2a = str(uuid.uuid4())
part_num_2a = "PART-HE-" + str(uuid.uuid4())[:8]
req_id_2a = str(uuid.uuid4())

run_sql(f"""
INSERT INTO public.service_centre_parts (id, name, part_number, stock_quantity, unit_price)
VALUES ('{part_id_2a}', 'Hydraulic Pump Seal', '{part_num_2a}', 50, 800);

INSERT INTO public.repair_requests (id, equipment_id, farmer_id, technician_id, status, job_number, description, location)
VALUES ('{repair_id_2a}', '{EQUIPMENT_ID}', '{FARMER_PROFILE_ID}', '{TECH_PROFILE_ID}', 'ACCEPTED', 'JOB-HE-' || substring(gen_random_uuid()::text, 1, 8), 'Handoff vs ETA Test A', 'Wardha Depot');

INSERT INTO public.service_centre_part_requests (id, repair_request_id, part_id, quantity, status, requested_by)
VALUES ('{req_id_2a}', '{repair_id_2a}', '{part_id_2a}', 2, 'PENDING', '{TECH_PROFILE_ID}');
""")

barrier_2a = threading.Barrier(2)
errors_2a = []
handoff_2a_res = {}
eta_2a_res = {}

def worker_handoff_2a():
    try:
        barrier_2a.wait()
        c, o, e = run_sql_as("admin", ADMIN_AUTH_ID, f"SELECT public.confirm_service_centre_part_handoff('{req_id_2a}'::uuid);")
        handoff_2a_res['code'] = c
        handoff_2a_res['out'] = o
        handoff_2a_res['err'] = e
    except Exception as ex:
        errors_2a.append(f"Handoff 2A Exception: {str(ex)}")

def worker_eta_2a():
    try:
        barrier_2a.wait()
        c, o, e = run_sql_as("technician", TECH_AUTH_ID, f"SELECT public.update_service_centre_part_request_eta('{req_id_2a}'::uuid, now() + interval '3 days', 'In transit via courier');")
        eta_2a_res['code'] = c
        eta_2a_res['out'] = o
        eta_2a_res['err'] = e
    except Exception as ex:
        errors_2a.append(f"ETA 2A Exception: {str(ex)}")

t_h2a = threading.Thread(target=worker_handoff_2a)
t_e2a = threading.Thread(target=worker_eta_2a)
t_h2a.start()
t_e2a.start()
t_h2a.join(timeout=10)
t_e2a.join(timeout=10)

test("No deadlocks between simultaneous handoff and ETA update", len(errors_2a) == 0, f"Errors: {errors_2a}")

# Analyze outcome:
# Either handoff won the lock first (so ETA update was rejected with 'already HANDED_OFF')
# Or ETA update won the lock first (so both succeeded, ETA updated then handed off)
if handoff_2a_res.get('code') == 0 and eta_2a_res.get('code') == 0:
    print("  -> Execution order: ETA update committed first, then handoff committed.")
    test("Both operations completed cleanly", True)
elif handoff_2a_res.get('code') == 0 and eta_2a_res.get('code') != 0:
    print("  -> Execution order: Handoff committed first, ETA update serialized and rejected.")
    test("Handoff succeeded and ETA rejected because request already HANDED_OFF",
         "already HANDED_OFF" in eta_2a_res.get('err', ''), f"ETA err: {eta_2a_res.get('err')}")
else:
    test("Unexpected outcome in simultaneous handoff vs ETA", False, f"Handoff: {handoff_2a_res}, ETA: {eta_2a_res}")

# Verify no duplicate stock decrements (must be exactly 50 - 2 = 48)
code, out, err = run_sql(f"SELECT stock_quantity FROM public.service_centre_parts WHERE id = '{part_id_2a}';")
test("Stock decremented exactly once (50 - 2 = 48)", out.strip() == "48", f"Got stock: {out}")

# Verify request status is HANDED_OFF
code, out, err = run_sql(f"SELECT status FROM public.service_centre_part_requests WHERE id = '{req_id_2a}';")
test("Part request status is HANDED_OFF", out.strip() == "HANDED_OFF", f"Got status: {out}")

# Scenario 2B: Strict serialization test - Handoff holds lock while ETA waits
print("\n--- 2B. Controlled Serialization: Handoff precedes ETA Update ---")
repair_id_2b = str(uuid.uuid4())
part_id_2b = str(uuid.uuid4())
part_num_2b = "PART-HEB-" + str(uuid.uuid4())[:8]
req_id_2b = str(uuid.uuid4())

run_sql(f"""
INSERT INTO public.service_centre_parts (id, name, part_number, stock_quantity, unit_price)
VALUES ('{part_id_2b}', 'Transmission Gasket', '{part_num_2b}', 30, 450);

INSERT INTO public.repair_requests (id, equipment_id, farmer_id, technician_id, status, job_number, description, location)
VALUES ('{repair_id_2b}', '{EQUIPMENT_ID}', '{FARMER_PROFILE_ID}', '{TECH_PROFILE_ID}', 'ACCEPTED', 'JOB-HEB-' || substring(gen_random_uuid()::text, 1, 8), 'Handoff vs ETA Test B', 'Wardha Depot');

INSERT INTO public.service_centre_part_requests (id, repair_request_id, part_id, quantity, status, requested_by)
VALUES ('{req_id_2b}', '{repair_id_2b}', '{part_id_2b}', 3, 'PENDING', '{TECH_PROFILE_ID}');
""")

# Confirm handoff first
code_h, out_h, err_h = run_sql_as("admin", ADMIN_AUTH_ID, f"SELECT public.confirm_service_centre_part_handoff('{req_id_2b}'::uuid);")
test("Handoff confirms successfully", code_h == 0, err_h)

# Now technician attempts to update ETA on the already handed-off request
code_e, out_e, err_e = run_sql_as("technician", TECH_AUTH_ID, f"SELECT public.update_service_centre_part_request_eta('{req_id_2b}'::uuid, now() + interval '2 days', 'Post-handoff ETA attempt');")
test("ETA update rejected on handed-off request (Cannot update ETA: Part request is already HANDED_OFF)",
     code_e != 0 and "already HANDED_OFF" in err_e,
     f"code={code_e}, err={err_e}")

# Verify single audit record
code, out, err = run_sql(f"""
SELECT count(*), sum(change_quantity)
FROM public.service_centre_stock_audit
WHERE part_id = '{part_id_2b}' AND part_request_id = '{req_id_2b}';
""")
test("Audit trail contains exactly 1 ISSUED_TO_REPAIR record (-3)", out.strip() == "1|-3", f"Got: {out}")

# Verify final stock = 30 - 3 = 27
code, out, err = run_sql(f"SELECT stock_quantity FROM public.service_centre_parts WHERE id = '{part_id_2b}';")
test("Final stock is exactly 27", out.strip() == "27", f"Got stock: {out}")

# Scenario 2C: Controlled Serialization - ETA Update precedes Handoff
print("\n--- 2C. Controlled Serialization: ETA Update precedes Handoff ---")
repair_id_2c = str(uuid.uuid4())
part_id_2c = str(uuid.uuid4())
part_num_2c = "PART-HEC-" + str(uuid.uuid4())[:8]
req_id_2c = str(uuid.uuid4())

run_sql(f"""
INSERT INTO public.service_centre_parts (id, name, part_number, stock_quantity, unit_price)
VALUES ('{part_id_2c}', 'Fuel Filter Element', '{part_num_2c}', 20, 600);

INSERT INTO public.repair_requests (id, equipment_id, farmer_id, technician_id, status, job_number, description, location)
VALUES ('{repair_id_2c}', '{EQUIPMENT_ID}', '{FARMER_PROFILE_ID}', '{TECH_PROFILE_ID}', 'ACCEPTED', 'JOB-HEC-' || substring(gen_random_uuid()::text, 1, 8), 'Handoff vs ETA Test C', 'Wardha Depot');

INSERT INTO public.service_centre_part_requests (id, repair_request_id, part_id, quantity, status, requested_by)
VALUES ('{req_id_2c}', '{repair_id_2c}', '{part_id_2c}', 1, 'PENDING', '{TECH_PROFILE_ID}');
""")

# First update ETA as technician
code_ec, out_ec, err_ec = run_sql_as("technician", TECH_AUTH_ID, f"SELECT public.update_service_centre_part_request_eta('{req_id_2c}'::uuid, now() + interval '1 day', 'Arriving tomorrow morning');")
test("Pre-handoff ETA update succeeds", code_ec == 0, err_ec)

# Verify ETA was updated on requisition
code, out, err = run_sql(f"SELECT estimated_arrival_at IS NOT NULL, notes FROM public.service_centre_part_requests WHERE id = '{req_id_2c}';")
test("Requisition row contains updated ETA and notes", "Arriving tomorrow morning" in out, f"Got: {out}")

# Next confirm handoff as admin
code_hc, out_hc, err_hc = run_sql_as("admin", ADMIN_AUTH_ID, f"SELECT public.confirm_service_centre_part_handoff('{req_id_2c}'::uuid);")
test("Handoff confirmed on ETA-updated request", code_hc == 0, err_hc)

# Verify stock decremented by 1: 20 - 1 = 19
code, out, err = run_sql(f"SELECT stock_quantity FROM public.service_centre_parts WHERE id = '{part_id_2c}';")
test("Stock quantity correctly decremented (20 - 1 = 19)", out.strip() == "19", f"Got stock: {out}")

# Verify audit trail has exactly 1 ISSUED_TO_REPAIR record (-1)
code, out, err = run_sql(f"SELECT count(*), sum(change_quantity) FROM public.service_centre_stock_audit WHERE part_id = '{part_id_2c}' AND part_request_id = '{req_id_2c}';")
test("Audit trail has exactly 1 record (-1)", out.strip() == "1|-1", f"Got: {out}")

print("\n" + "=" * 80)
print(f"STEP 5A.3 LOCK RECONCILIATION SUMMARY: {passed} PASSED, {failed} FAILED")
print("=" * 80)
if failed > 0:
    exit(1)
