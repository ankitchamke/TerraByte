import subprocess
import json
import uuid
import time

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
print("TerraByte — Step 5A.5 Column Coverage & Admin Audit Test Battery")
print("=" * 80)

# Setup initial test fixtures
repair_id = str(uuid.uuid4())
part_id = str(uuid.uuid4())
part_id_2 = str(uuid.uuid4())
req_id = str(uuid.uuid4())
part_num_1 = "PART-COV1-" + str(uuid.uuid4())[:6]
part_num_2 = "PART-COV2-" + str(uuid.uuid4())[:6]

run_sql(f"""
INSERT INTO public.service_centre_parts (id, name, part_number, stock_quantity, unit_price)
VALUES
  ('{part_id}', 'Coverage Test Part 1', '{part_num_1}', 20, 1000),
  ('{part_id_2}', 'Coverage Test Part 2', '{part_num_2}', 20, 1200);

INSERT INTO public.repair_requests (id, equipment_id, farmer_id, technician_id, status, job_number, description, location)
VALUES ('{repair_id}', '{EQUIPMENT_ID}', '{FARMER_PROFILE_ID}', '{TECH_PROFILE_ID}', 'ACCEPTED', 'JOB-COV-' || substring(gen_random_uuid()::text, 1, 8), 'Coverage test', 'Depot');

INSERT INTO public.service_centre_part_requests (
  id, repair_request_id, part_id, quantity, status, requested_by, notes, created_at, updated_at
) VALUES (
  '{req_id}', '{repair_id}', '{part_id}', 2, 'PENDING', '{TECH_PROFILE_ID}', 'Initial notes', now() - interval '1 hour', now() - interval '1 hour'
);
""")

# ------------------------------------------------------------------------------
# 1. COLUMN-BY-COLUMN PROTECTION TESTS (AUTHENTICATED TECHNICIAN CONTEXT)
# ------------------------------------------------------------------------------
print("\n--- 1. Column-by-Column Technician Rejection Tests ---")

# List of all 12 protected columns and their unauthorized update attempts:
protected_column_tests = [
    ("id", f"id = '{uuid.uuid4()}'::uuid"),
    ("repair_request_id", f"repair_request_id = '{uuid.uuid4()}'::uuid"),
    ("part_id", f"part_id = '{part_id_2}'::uuid"),
    ("quantity", "quantity = 99"),
    ("status", "status = 'HANDED_OFF'"),
    ("requested_by", f"requested_by = '{ADMIN_PROFILE_ID}'::uuid"),
    ("handed_off_by", f"handed_off_by = '{ADMIN_PROFILE_ID}'::uuid"),
    ("handed_off_at", "handed_off_at = now()"),
    ("created_at", "created_at = '2020-01-01 00:00:00+00'::timestamptz"),
    ("updated_at", "updated_at = '2020-01-01 00:00:00+00'::timestamptz"),
    ("eta_updated_by", f"eta_updated_by = '{ADMIN_PROFILE_ID}'::uuid"),
    ("eta_updated_at", "eta_updated_at = '2020-01-01 00:00:00+00'::timestamptz"),
]

for col_name, update_clause in protected_column_tests:
    sql = f"""
    UPDATE public.service_centre_part_requests
    SET {update_clause}
    WHERE id = '{req_id}';
    """
    code, out, err = run_sql_as("technician", TECH_AUTH_ID, sql)
    test(f"Technician direct update to '{col_name}' is rejected",
         code != 0 and ("Unauthorized" in err or "42501" in err),
         f"code={code}, err={err}")

# Also test attempting bypass with arbitrary custom GUCs:
gucs_to_test = [
    "terabyte.in_eta_rpc",
    "terabyte.bypass_rls",
    "terabyte.admin_mode",
    "app.is_admin"
]
for guc in gucs_to_test:
    sql = f"""
    SET {guc} = 'true';
    UPDATE public.service_centre_part_requests
    SET quantity = 50
    WHERE id = '{req_id}';
    """
    code, out, err = run_sql_as("technician", TECH_AUTH_ID, sql)
    test(f"Arbitrary custom GUC '{guc}' cannot bypass technician trigger",
         code != 0 and "Unauthorized" in err,
         f"code={code}, err={err}")

# ------------------------------------------------------------------------------
# 2. TECHNICIAN PERMITTED UPDATES (ESTIMATED_ARRIVAL_AT & NOTES)
# ------------------------------------------------------------------------------
print("\n--- 2. Technician Permitted Updates & Authoritative Auto-Stamping ---")

sql_tech_direct = f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '4 days',
    notes = 'Parts delayed due to rain'
WHERE id = '{req_id}';
"""
code, out, err = run_sql_as("technician", TECH_AUTH_ID, sql_tech_direct)
test("Technician direct update to estimated_arrival_at and notes succeeds", code == 0, err)

# Verify trigger authoritatively stamped eta_updated_by = tech profile, eta_updated_at = now(), updated_at = now()
code, out, err = run_sql(f"""
SELECT eta_updated_by = '{TECH_PROFILE_ID}'::uuid,
       eta_updated_at > now() - interval '10 seconds',
       updated_at > now() - interval '10 seconds',
       notes
FROM public.service_centre_part_requests
WHERE id = '{req_id}';
""")
tech_stamp_data = out.strip().split('|')
test("eta_updated_by auto-stamped with technician profile ID", tech_stamp_data[0] == "t", f"Got: {out}")
test("eta_updated_at auto-stamped with current timestamp", tech_stamp_data[1] == "t", f"Got: {out}")
test("updated_at auto-stamped with current timestamp", tech_stamp_data[2] == "t", f"Got: {out}")

# ------------------------------------------------------------------------------
# 3. ADMINISTRATOR AUDIT BEHAVIOR & PERMISSIONS
# ------------------------------------------------------------------------------
print("\n--- 3. Administrator Audit Behavior & Permissions ---")

# Test 3.1: Admin direct update modifying ETA without explicitly specifying metadata
# MUST authoritatively stamp eta_updated_by with admin's profile ID and eta_updated_at / updated_at with now()
sql_admin_eta = f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '2 days',
    notes = 'Expedited air shipment by admin'
WHERE id = '{req_id}';
"""
code, out, err = run_sql_as("admin", ADMIN_AUTH_ID, sql_admin_eta)
test("Admin direct update to ETA succeeds", code == 0, err)

code, out, err = run_sql(f"""
SELECT eta_updated_by = '{ADMIN_PROFILE_ID}'::uuid,
       eta_updated_at > now() - interval '10 seconds',
       updated_at > now() - interval '10 seconds',
       notes
FROM public.service_centre_part_requests
WHERE id = '{req_id}';
""")
admin_stamp_data = out.strip().split('|')
test("Admin ETA change stamps eta_updated_by with admin profile ID", admin_stamp_data[0] == "t", f"Got: {out}")
test("Admin ETA change stamps eta_updated_at with now()", admin_stamp_data[1] == "t", f"Got: {out}")
test("Admin ETA change stamps updated_at with now()", admin_stamp_data[2] == "t", f"Got: {out}")

# Test 3.2: Admin explicit metadata override
# Passing own profile ID is permitted:
sql_admin_self = f"""
UPDATE public.service_centre_part_requests
SET eta_updated_by = '{ADMIN_PROFILE_ID}'::uuid,
    notes = 'Admin explicitly passing own profile ID',
    estimated_arrival_at = now() + interval '3 days'
WHERE id = '{req_id}';
"""
code, out, err = run_sql_as("admin", ADMIN_AUTH_ID, sql_admin_self)
test("Admin passing own profile ID succeeds", code == 0, err)

# Spoofing another user's profile ID is strictly rejected:
sql_admin_spoof = f"""
UPDATE public.service_centre_part_requests
SET eta_updated_by = '{TECH_PROFILE_ID}'::uuid,
    notes = 'Admin spoofing tech profile',
    estimated_arrival_at = now() + interval '3 days'
WHERE id = '{req_id}';
"""
code, out, err = run_sql_as("admin", ADMIN_AUTH_ID, sql_admin_spoof)
test("Admin attempting to spoof another user ID rejected with 42501", code != 0 and "cannot spoof" in err, f"code={code}, err={err}")

# Test 3.3: Admin updates core lifecycle columns (quantity, status)
sql_admin_lifecycle = f"""
UPDATE public.service_centre_part_requests
SET quantity = 5
WHERE id = '{req_id}';
"""
code, out, err = run_sql_as("admin", ADMIN_AUTH_ID, sql_admin_lifecycle)
test("Admin can update core lifecycle/quantity columns", code == 0, err)

# ------------------------------------------------------------------------------
# 4. APPROVED ETA RPC VALIDATION FOR TECHNICIANS
# ------------------------------------------------------------------------------
print("\n--- 4. Approved ETA RPC Verification ---")

code, out, err = run_sql_as("technician", TECH_AUTH_ID, f"""
SELECT public.update_service_centre_part_request_eta(
  '{req_id}'::uuid,
  now() + interval '1 day',
  'Arriving tomorrow morning via depot van'
);
""")
test("Approved ETA RPC succeeds for assigned technician", code == 0, err)

code, out, err = run_sql(f"""
SELECT eta_updated_by = '{TECH_PROFILE_ID}'::uuid,
       estimated_arrival_at IS NOT NULL,
       notes
FROM public.service_centre_part_requests WHERE id = '{req_id}';
""")
rpc_data = out.strip().split('|')
test("RPC updated ETA and stamped technician profile ID", rpc_data[0] == "t", f"Got: {out}")

print("\n" + "=" * 80)
print(f"STEP 5A.5 COVERAGE REVIEW SUMMARY: {passed} PASSED, {failed} FAILED")
print("=" * 80)
if failed > 0:
    exit(1)
