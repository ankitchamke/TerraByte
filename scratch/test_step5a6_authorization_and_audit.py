import subprocess
import json
import uuid
import time

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
DB_ARGS = ["-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "terabyte_clean_restore_drill"]

# Identities:
# Tech A: Assigned to Repair 1
TECH_A_PROFILE_ID = "00000000-0000-0000-0002-000000000001"
TECH_A_AUTH_ID = "00000000-0000-0000-0000-000000000004"

# Tech B: Assigned to Repair 2 (dynamically unique)
TECH_B_AUTH_ID = str(uuid.uuid4())

# Tech C: Unassigned (dynamically unique)
TECH_C_AUTH_ID = str(uuid.uuid4())

# Farmer / Customer
FARMER_PROFILE_ID = "00000000-0000-0000-0001-000000000001"
FARMER_AUTH_ID = "00000000-0000-0000-0000-000000000001"

# Admin
ADMIN_PROFILE_ID = "00000000-0000-0000-0003-000000000001"
ADMIN_AUTH_ID = "00000000-0000-0000-0000-000000000005"

# Authenticated user without profile (NULL role, dynamically unique)
GHOST_AUTH_ID = str(uuid.uuid4())

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

def run_sql_anon(sql):
    wrapper = f"""
    SET ROLE anon;
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
print("TerraByte — Step 5A.6 Authorization, Assignment & Audit Integrity Battery")
print("=" * 80)

# Setup fixtures: Create Tech B, Tech C, and Ghost auth records
c, o, e = run_sql(f"""
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  ('{TECH_B_AUTH_ID}', 'tech_b_{TECH_B_AUTH_ID[:8]}@tb.dev', json_build_object('role', 'technician', 'full_name', 'Tech B')::jsonb),
  ('{TECH_C_AUTH_ID}', 'tech_c_{TECH_C_AUTH_ID[:8]}@tb.dev', json_build_object('role', 'technician', 'full_name', 'Tech C')::jsonb),
  ('{GHOST_AUTH_ID}', 'ghost_{GHOST_AUTH_ID[:8]}@tb.dev', json_build_object('role', 'farmer', 'full_name', 'Ghost')::jsonb);

-- Strip ghost user's profile row so role is strictly NULL
DELETE FROM public.profiles WHERE auth_user_id = '{GHOST_AUTH_ID}';
""")
if c != 0:
    print(f"FATAL: Setup 1 failed: {e}")
    exit(1)

# Retrieve generated profile IDs for Tech B and Tech C
c, o, e = run_sql(f"SELECT id FROM public.profiles WHERE auth_user_id = '{TECH_B_AUTH_ID}';")
TECH_B_PROFILE_ID = o.strip()

c, o, e = run_sql(f"SELECT id FROM public.profiles WHERE auth_user_id = '{TECH_C_AUTH_ID}';")
TECH_C_PROFILE_ID = o.strip()

print(f"  Configured Tech A Profile: {TECH_A_PROFILE_ID}")
print(f"  Configured Tech B Profile: {TECH_B_PROFILE_ID}")
print(f"  Configured Tech C Profile: {TECH_C_PROFILE_ID}")

repair_1_id = str(uuid.uuid4())
repair_2_id = str(uuid.uuid4())
part_1_id = str(uuid.uuid4())
part_2_id = str(uuid.uuid4())

req_1_pending_id = str(uuid.uuid4())
req_2_cancelled_id = str(uuid.uuid4())
req_3_handed_off_id = str(uuid.uuid4())
req_4_repair2_id = str(uuid.uuid4())

c, o, e = run_sql(f"""
INSERT INTO public.service_centre_parts (id, name, part_number, stock_quantity, unit_price)
VALUES
  ('{part_1_id}', 'Auth Part 1', 'PART-AUT1-' || substring(gen_random_uuid()::text, 1, 6), 50, 500),
  ('{part_2_id}', 'Auth Part 2', 'PART-AUT2-' || substring(gen_random_uuid()::text, 1, 6), 50, 750);

-- Repair 1 assigned to Tech A
INSERT INTO public.repair_requests (id, equipment_id, farmer_id, technician_id, status, job_number, description, location)
VALUES ('{repair_1_id}', '{EQUIPMENT_ID}', '{FARMER_PROFILE_ID}', '{TECH_A_PROFILE_ID}', 'ACCEPTED', 'JOB-A-' || substring(gen_random_uuid()::text, 1, 8), 'Repair 1 for Tech A', 'Depot');

-- Repair 2 assigned to Tech B
INSERT INTO public.repair_requests (id, equipment_id, farmer_id, technician_id, status, job_number, description, location)
VALUES ('{repair_2_id}', '{EQUIPMENT_ID}', '{FARMER_PROFILE_ID}', '{TECH_B_PROFILE_ID}', 'ACCEPTED', 'JOB-B-' || substring(gen_random_uuid()::text, 1, 8), 'Repair 2 for Tech B', 'Depot');

-- Requisitions on Repair 1
INSERT INTO public.service_centre_part_requests (id, repair_request_id, part_id, quantity, status, requested_by, notes)
VALUES
  ('{req_1_pending_id}', '{repair_1_id}', '{part_1_id}', 1, 'PENDING', '{TECH_A_PROFILE_ID}', 'Initial pending notes'),
  ('{req_2_cancelled_id}', '{repair_1_id}', '{part_1_id}', 1, 'CANCELLED', '{TECH_A_PROFILE_ID}', 'Cancelled part'),
  ('{req_3_handed_off_id}', '{repair_1_id}', '{part_1_id}', 1, 'HANDED_OFF', '{TECH_A_PROFILE_ID}', 'Handed off part');

-- Requisition on Repair 2
INSERT INTO public.service_centre_part_requests (id, repair_request_id, part_id, quantity, status, requested_by, notes)
VALUES
  ('{req_4_repair2_id}', '{repair_2_id}', '{part_2_id}', 1, 'PENDING', '{TECH_B_PROFILE_ID}', 'Repair 2 pending');
""")
if c != 0:
    print(f"FATAL: Setup 2 failed: {e}")
    exit(1)

# Verify fixture setup in DB
c, o, e = run_sql(f"SELECT count(*) FROM public.service_centre_part_requests WHERE id = '{req_1_pending_id}';")
if o.strip() != "1":
    print(f"FATAL: Requisition {req_1_pending_id} was not created!")
    exit(1)

# ------------------------------------------------------------------------------
# SECTION 1: TECHNICIAN ASSIGNMENT & STATUS ENFORCEMENT
# ------------------------------------------------------------------------------
print("\n--- 1. Technician Assignment & Status Enforcement (Direct SQL & RPC) ---")

# 1.1 Direct SQL: Assigned Tech A on PENDING Requisition 1
sql_1_1 = f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '2 days', notes = 'Assigned Tech A updating'
WHERE id = '{req_1_pending_id}';
"""
code, out, err = run_sql_as("technician", TECH_A_AUTH_ID, sql_1_1)
test("1.1 Direct SQL: Assigned Tech A updating PENDING requisition succeeds", code == 0, err)

code, out, err = run_sql(f"""
SELECT eta_updated_by = '{TECH_A_PROFILE_ID}'::uuid, notes
FROM public.service_centre_part_requests WHERE id = '{req_1_pending_id}';
""")
test("1.1 Metadata auto-stamped with Tech A profile ID", out.startswith("t|"), f"Got: {out}")

# 1.2 Direct SQL: Unassigned Tech C on Requisition 1
sql_1_2 = f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '5 days', notes = 'Unassigned Tech C trying to update'
WHERE id = '{req_1_pending_id}';
"""
code, out, err = run_sql_as("technician", TECH_C_AUTH_ID, sql_1_2)
# Under RLS, unassigned tech matches 0 rows (code == 0 with 0 rows, or error)
code_check, out_check, err_check = run_sql(f"""
SELECT notes FROM public.service_centre_part_requests WHERE id = '{req_1_pending_id}';
""")
test("1.2 Direct SQL: Unassigned Tech C update rejected (notes unchanged)", "Unassigned Tech C" not in out_check, f"Notes: {out_check}")

# 1.3 Direct SQL: Tech B (assigned to different repair) on Requisition 1
sql_1_3 = f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '5 days', notes = 'Tech B on different repair trying to update'
WHERE id = '{req_1_pending_id}';
"""
code, out, err = run_sql_as("technician", TECH_B_AUTH_ID, sql_1_3)
code_check, out_check, err_check = run_sql(f"""
SELECT notes FROM public.service_centre_part_requests WHERE id = '{req_1_pending_id}';
""")
test("1.3 Direct SQL: Different-repair Tech B update rejected (notes unchanged)", "Tech B" not in out_check, f"Notes: {out_check}")

# 1.4 Direct SQL: Assigned Tech A on CANCELLED Requisition 2 (non-PENDING)
sql_1_4 = f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '3 days', notes = 'Tech A updating non-pending'
WHERE id = '{req_2_cancelled_id}';
"""
code, out, err = run_sql_as("technician", TECH_A_AUTH_ID, sql_1_4)
code_check, out_check, err_check = run_sql(f"""
SELECT notes FROM public.service_centre_part_requests WHERE id = '{req_2_cancelled_id}';
""")
test("1.4 Direct SQL: Updating non-PENDING (CANCELLED) requisition rejected", "Tech A updating non-pending" not in out_check, f"Notes: {out_check}")

# 1.5 Direct SQL: Assigned Tech A on HANDED_OFF Requisition 3 (non-PENDING)
sql_1_5 = f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '3 days', notes = 'Tech A updating handed off'
WHERE id = '{req_3_handed_off_id}';
"""
code, out, err = run_sql_as("technician", TECH_A_AUTH_ID, sql_1_5)
code_check, out_check, err_check = run_sql(f"""
SELECT notes FROM public.service_centre_part_requests WHERE id = '{req_3_handed_off_id}';
""")
test("1.5 Direct SQL: Updating non-PENDING (HANDED_OFF) requisition rejected", "Tech A updating handed off" not in out_check, f"Notes: {out_check}")

# 1.6 RPC: Assigned Tech A on PENDING Requisition 1
code, out, err = run_sql_as("technician", TECH_A_AUTH_ID, f"""
SELECT public.update_service_centre_part_request_eta(
  '{req_1_pending_id}'::uuid,
  now() + interval '1 day',
  'RPC update by assigned Tech A'
);
""")
test("1.6 RPC: Assigned Tech A on PENDING requisition succeeds", code == 0, err)

# 1.7 RPC: Unassigned Tech C on Requisition 1
code, out, err = run_sql_as("technician", TECH_C_AUTH_ID, f"""
SELECT public.update_service_centre_part_request_eta(
  '{req_1_pending_id}'::uuid,
  now() + interval '2 days',
  'RPC update by unassigned Tech C'
);
""")
test("1.7 RPC: Unassigned Tech C rejected with 42501 Unauthorized",
     code != 0 and ("Unauthorized" in err or "42501" in err), f"code={code}, err={err}")

# 1.8 RPC: Tech B (assigned to different repair) on Requisition 1
code, out, err = run_sql_as("technician", TECH_B_AUTH_ID, f"""
SELECT public.update_service_centre_part_request_eta(
  '{req_1_pending_id}'::uuid,
  now() + interval '2 days',
  'RPC update by Tech B'
);
""")
test("1.8 RPC: Tech B on different repair rejected with 42501 Unauthorized",
     code != 0 and ("Unauthorized" in err or "42501" in err), f"code={code}, err={err}")

# 1.9 RPC: Assigned Tech A on CANCELLED Requisition 2
code, out, err = run_sql_as("technician", TECH_A_AUTH_ID, f"""
SELECT public.update_service_centre_part_request_eta(
  '{req_2_cancelled_id}'::uuid,
  now() + interval '2 days',
  'RPC update on cancelled'
);
""")
test("1.9 RPC: Assigned Tech A on CANCELLED requisition rejected with 22000",
     code != 0 and ("already CANCELLED" in err or "22000" in err), f"code={code}, err={err}")

# 1.10 RPC: Assigned Tech A on HANDED_OFF Requisition 3
code, out, err = run_sql_as("technician", TECH_A_AUTH_ID, f"""
SELECT public.update_service_centre_part_request_eta(
  '{req_3_handed_off_id}'::uuid,
  now() + interval '2 days',
  'RPC update on handed off'
);
""")
test("1.10 RPC: Assigned Tech A on HANDED_OFF requisition rejected with 22000",
     code != 0 and ("already HANDED_OFF" in err or "22000" in err), f"code={code}, err={err}")

# ------------------------------------------------------------------------------
# SECTION 2: ADMINISTRATOR AUDIT INTEGRITY & SPOOFING PREVENTION
# ------------------------------------------------------------------------------
print("\n--- 2. Administrator Audit Integrity & Spoofing Prevention ---")

# 2.1 Admin ETA update without metadata: auto-stamps actual admin profile ID and current timestamp
sql_admin_legit = f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '3 days',
    notes = 'Legitimate admin ETA update'
WHERE id = '{req_1_pending_id}';
"""
code, out, err = run_sql_as("admin", ADMIN_AUTH_ID, sql_admin_legit)
test("2.1 Admin legitimate ETA update succeeds", code == 0, err)

code, out, err = run_sql(f"""
SELECT eta_updated_by = '{ADMIN_PROFILE_ID}'::uuid,
       eta_updated_at > now() - interval '10 seconds',
       updated_at > now() - interval '10 seconds'
FROM public.service_centre_part_requests WHERE id = '{req_1_pending_id}';
""")
test("2.1 Admin ETA update authoritatively records admin profile ID and timestamp", out.strip() == "t|t|t", f"Got: {out}")

# 2.2 Admin ETA update explicitly passing own profile ID (like parts-desk.ts does): permitted
sql_admin_self = f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '4 days',
    notes = 'Admin explicitly passing own profile ID',
    eta_updated_by = '{ADMIN_PROFILE_ID}'::uuid
WHERE id = '{req_1_pending_id}';
"""
code, out, err = run_sql_as("admin", ADMIN_AUTH_ID, sql_admin_self)
test("2.2 Admin passing own profile ID succeeds", code == 0, err)

# 2.3 Admin attempting to spoof eta_updated_by (framing Tech A): strictly rejected!
sql_admin_spoof = f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '4 days',
    notes = 'Admin spoofing tech ID',
    eta_updated_by = '{TECH_A_PROFILE_ID}'::uuid
WHERE id = '{req_1_pending_id}';
"""
code, out, err = run_sql_as("admin", ADMIN_AUTH_ID, sql_admin_spoof)
test("2.3 Admin attempting to spoof eta_updated_by rejected with 42501",
     code != 0 and ("cannot spoof" in err or "42501" in err), f"code={code}, err={err}")

# 2.4 Admin attempting to forge eta_updated_at (backdating to 2020): strictly rejected!
sql_admin_backdate = f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '4 days',
    notes = 'Admin backdating timestamp',
    eta_updated_at = '2020-01-01 00:00:00+00'::timestamptz
WHERE id = '{req_1_pending_id}';
"""
code, out, err = run_sql_as("admin", ADMIN_AUTH_ID, sql_admin_backdate)
test("2.4 Admin attempting to forge eta_updated_at timestamp rejected with 42501",
     code != 0 and ("system-managed" in err or "42501" in err), f"code={code}, err={err}")

# 2.5 Admin attempting direct update to eta_updated_by WITHOUT changing ETA/notes: rejected!
sql_admin_direct_meta = f"""
UPDATE public.service_centre_part_requests
SET eta_updated_by = '{TECH_A_PROFILE_ID}'::uuid
WHERE id = '{req_1_pending_id}';
"""
code, out, err = run_sql_as("admin", ADMIN_AUTH_ID, sql_admin_direct_meta)
test("2.5 Admin direct mutation of eta_updated_* without ETA change rejected with 42501",
     code != 0 and ("Cannot modify eta_updated_*" in err or "42501" in err), f"code={code}, err={err}")

# 2.6 Admin modifying legitimate business fields (quantity, status) without touching ETA: permitted!
sql_admin_biz = f"""
UPDATE public.service_centre_part_requests
SET quantity = 10,
    status = 'CANCELLED'
WHERE id = '{req_1_pending_id}';
"""
code, out, err = run_sql_as("admin", ADMIN_AUTH_ID, sql_admin_biz)
test("2.6 Admin updating business fields (quantity, status) succeeds", code == 0, err)

code, out, err = run_sql(f"""
SELECT quantity = 10,
       status = 'CANCELLED',
       eta_updated_by = '{ADMIN_PROFILE_ID}'::uuid,
       updated_at > now() - interval '10 seconds'
FROM public.service_centre_part_requests WHERE id = '{req_1_pending_id}';
""")
test("2.6 Business fields updated while eta_updated_by preserved and updated_at refreshed", out.strip() == "t|t|t|t", f"Got: {out}")

# Reset status back to PENDING for subsequent tests
run_sql(f"UPDATE public.service_centre_part_requests SET status = 'PENDING' WHERE id = '{req_1_pending_id}';")

# ------------------------------------------------------------------------------
# SECTION 3: INTERNAL / SERVICE-ROLE PATH & NULL-ROLE SECURITY
# ------------------------------------------------------------------------------
print("\n--- 3. Internal / Service-Role Path & NULL-Role Boundary Verification ---")

# 3.1 Authenticated client with NULL role (Ghost user without profile) attempting direct SQL: strictly rejected!
sql_ghost = f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '1 day',
    notes = 'Ghost user update'
WHERE id = '{req_1_pending_id}';
"""
code, out, err = run_sql_as("authenticated", GHOST_AUTH_ID, sql_ghost)
# Under RLS + trigger: blocked
code_check, out_check, err_check = run_sql(f"""
SELECT notes FROM public.service_centre_part_requests WHERE id = '{req_1_pending_id}';
""")
test("3.1 Authenticated client with NULL role rejected from modifying part requests",
     "Ghost user" not in out_check, f"Notes: {out_check}")

# 3.2 Ghost user calling approved RPC: rejected with 42501 Authentication required
code, out, err = run_sql_as("authenticated", GHOST_AUTH_ID, f"""
SELECT public.update_service_centre_part_request_eta(
  '{req_1_pending_id}'::uuid,
  now() + interval '1 day',
  'Ghost RPC'
);
""")
test("3.2 Authenticated client with NULL role rejected from RPC (42501 Authentication required)",
     code != 0 and ("Authentication required" in err or "42501" in err), f"code={code}, err={err}")

# 3.3 Anonymous client attempting direct SQL: rejected!
code, out, err = run_sql_anon(f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '1 day',
    notes = 'Anon hacker update'
WHERE id = '{req_1_pending_id}';
""")
code_check, out_check, err_check = run_sql(f"""
SELECT notes FROM public.service_centre_part_requests WHERE id = '{req_1_pending_id}';
""")
test("3.3 Anonymous client direct SQL update rejected", "Anon hacker" not in out_check, f"Notes: {out_check}")

# 3.4 Anonymous client calling approved RPC: rejected (permission denied / revoked grant)!
code, out, err = run_sql_anon(f"""
SELECT public.update_service_centre_part_request_eta(
  '{req_1_pending_id}'::uuid,
  now() + interval '1 day',
  'Anon RPC'
);
""")
test("3.4 Anonymous client calling RPC rejected (permission denied)",
     code != 0 and ("permission denied" in err or "42501" in err), f"code={code}, err={err}")

# 3.5 Privileged server-side maintenance path (superuser postgres / service_role): permitted!
code, out, err = run_sql(f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '1 day',
    notes = 'Privileged maintenance update'
WHERE id = '{req_1_pending_id}';
""")
test("3.5 Privileged server-side maintenance path (postgres/service_role) succeeds", code == 0, err)

code, out, err = run_sql(f"""
SELECT notes = 'Privileged maintenance update',
       updated_at > now() - interval '10 seconds'
FROM public.service_centre_part_requests WHERE id = '{req_1_pending_id}';
""")
test("3.5 Privileged maintenance update verified in database", out.strip() == "t|t", f"Got: {out}")

print("\n" + "=" * 80)
print(f"STEP 5A.6 BATTERY SUMMARY: {passed} PASSED, {failed} FAILED")
print("=" * 80)
if failed > 0:
    exit(1)
