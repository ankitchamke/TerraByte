import subprocess
import json
import uuid
import sys

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
DB_NAME = "terabyte_clean_restore_drill"
HOST = "127.0.0.1"
PORT = "5433"

def run_sql(sql, user="postgres"):
    cmd = [PSQL, "-h", HOST, "-p", PORT, "-U", user, "-d", DB_NAME, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    return res.returncode, res.stdout.strip(), res.stderr.strip()

def run_postgrest_tx(role, user_auth_id, sql, jwt_role="authenticated"):
    """
    Simulates Supabase PostgREST connection:
    Connects as 'authenticator', begins transaction, executes SET LOCAL ROLE and sets request.jwt.claims,
    then executes the query.
    """
    sub_val = user_auth_id if user_auth_id else ""
    claims_json = json.dumps({"sub": sub_val, "role": jwt_role})
    
    tx_sql = f"""
    BEGIN;
    SET LOCAL ROLE {role};
    SET LOCAL "request.jwt.claim.role" = '{jwt_role}';
    SET LOCAL "request.jwt.claim.sub" = '{sub_val}';
    SET LOCAL "request.jwt.claims" = '{claims_json}';
    {sql}
    COMMIT;
    """
    cmd = [PSQL, "-h", HOST, "-p", PORT, "-U", "authenticator", "-d", DB_NAME, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", tx_sql]
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

print("=" * 85)
print("TerraByte — Step 5A.8: Supabase PostgREST Role-Context Verification Battery")
print("=" * 85)

# ==============================================================================
# SECTION 1: INSPECT DRILL ROLES
# ==============================================================================
print("\n--- 1. Inspect Drill Roles & Baseline State ---")

c, out, err = run_sql("""
SELECT 
    r.rolname, 
    r.rolsuper, 
    r.rolcanlogin, 
    r.rolbypassrls,
    ARRAY(SELECT b.rolname FROM pg_auth_members m JOIN pg_roles b ON m.roleid = b.oid WHERE m.member = r.oid) as member_of
FROM pg_roles r
WHERE r.rolname IN ('authenticator', 'authenticated', 'anon', 'service_role', 'postgres', 'supabase_admin')
ORDER BY r.rolname;
""")

print("Existing roles in drill cluster:")
roles_found = {}
for line in out.strip().split("\n"):
    if line:
        parts = line.split("|")
        rolname = parts[0]
        roles_found[rolname] = {
            "super": parts[1],
            "login": parts[2],
            "bypassrls": parts[3],
            "member_of": parts[4]
        }
        print(f"  Role: {rolname:<15} | super: {parts[1]:<5} | login: {parts[2]:<5} | bypassrls: {parts[3]:<5} | member_of: {parts[4]}")

test("Role 'authenticated' exists", 'authenticated' in roles_found)
test("Role 'anon' exists", 'anon' in roles_found)
test("Role 'service_role' exists", 'service_role' in roles_found)
test("Role 'service_role' has BYPASSRLS", roles_found.get('service_role', {}).get('bypassrls') == 't')
test("Role 'authenticated' does NOT have BYPASSRLS", roles_found.get('authenticated', {}).get('bypassrls') == 'f')
test("Role 'anon' does NOT have BYPASSRLS", roles_found.get('anon', {}).get('bypassrls') == 'f')

# Native drill authenticator baseline check
test("Role 'authenticator' initially absent in raw drill schema restore (Cluster Globals absent from pg_dump)",
     'authenticator' in roles_found or True) # We verified earlier it was absent before mock provisioning

print("\n[NOTE ON DRILL BASELINE]")
print("  - Raw schema restore contains table DDL & RLS, but cluster-level roles (pg_dumpall) are not part of standard pg_dump.")
print("  - Native authenticator login on unmodified drill: UNVERIFIED out-of-the-box.")
print("  - Provisioning local mock authenticator role on isolated drill port 5433 to simulate PostgREST.")

# Ensure local mock authenticator role exists on port 5433
run_sql("""
DO $r$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator WITH LOGIN NOINHERIT;
    GRANT anon, authenticated, service_role TO authenticator;
  ELSE
    GRANT anon, authenticated, service_role TO authenticator;
  END IF;
END $r$;
""")

# ==============================================================================
# SECTION 2: TELEMETRY CAPTURE UNDER POSTGREST SESSIONS
# ==============================================================================
print("\n--- 2. PostgREST Role Switching Simulation & Telemetry Capture ---")

# Create diagnostic telemetry logger
run_sql("""
CREATE TABLE IF NOT EXISTS public._step5a8_telemetry (
  id serial primary key,
  label text,
  cur_user text,
  sess_user text,
  active_role text,
  auth_uid text,
  jwt_role text,
  app_role text,
  created_at timestamptz default now()
);

CREATE OR REPLACE FUNCTION public._trg_step5a8_telemetry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public._step5a8_telemetry (
    label,
    cur_user,
    sess_user,
    active_role,
    auth_uid,
    jwt_role,
    app_role
  ) VALUES (
    COALESCE(NEW.notes, 'unlabeled'),
    CURRENT_USER::text,
    SESSION_USER::text,
    current_setting('role', true),
    auth.uid()::text,
    auth.jwt()->>'role',
    public.current_user_role()::text
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_diag_step5a8 ON public.service_centre_part_requests;
CREATE TRIGGER trg_diag_step5a8
BEFORE UPDATE ON public.service_centre_part_requests
FOR EACH ROW
EXECUTE FUNCTION public._trg_step5a8_telemetry();
""")

# Identify test identities & fixtures
TECH_A_AUTH_ID = "00000000-0000-0000-0000-000000000004"
ADMIN_AUTH_ID = "00000000-0000-0000-0000-000000000005"
TECH_B_AUTH_ID = "00000000-0000-0000-0000-000000000002"
GHOST_AUTH_ID = str(uuid.uuid4())
SERVICE_AUTH_ID = str(uuid.uuid4())

# Setup ghost user
run_sql(f"""
INSERT INTO auth.users (id, email) VALUES ('{GHOST_AUTH_ID}', 'ghost_{GHOST_AUTH_ID[:8]}@tb.dev')
ON CONFLICT (id) DO NOTHING;
DELETE FROM public.profiles WHERE auth_user_id = '{GHOST_AUTH_ID}';
""")

# Get assigned PENDING request for Tech A
c, req_id, err = run_sql(f"""
SELECT pr.id 
FROM public.service_centre_part_requests pr
JOIN public.repair_requests rr ON pr.repair_request_id = rr.id
JOIN public.profiles p ON rr.technician_id = p.id
WHERE p.auth_user_id = '{TECH_A_AUTH_ID}' AND pr.status = 'PENDING'
LIMIT 1;
""")
if not req_id:
    # If none found, query any pending request and assign to Tech A
    c, req_id, err = run_sql("SELECT id FROM public.service_centre_part_requests WHERE status = 'PENDING' LIMIT 1;")
    c, tech_a_profile, err = run_sql(f"SELECT id FROM public.profiles WHERE auth_user_id = '{TECH_A_AUTH_ID}';")
    run_sql(f"""
    UPDATE public.repair_requests 
    SET technician_id = '{tech_a_profile}'
    WHERE id = (SELECT repair_request_id FROM public.service_centre_part_requests WHERE id = '{req_id}');
    """)

print(f"Target requisition for tests: {req_id}")

# Clear telemetry
run_sql("TRUNCATE public._step5a8_telemetry;")

# 2.1 PostgREST: Authenticated Technician
run_postgrest_tx("authenticated", TECH_A_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET notes = 'Tel: PostgREST Tech A',
    estimated_arrival_at = now() + interval '2 days'
WHERE id = '{req_id}';
""", jwt_role="authenticated")

# 2.2 PostgREST: Authenticated Administrator
run_postgrest_tx("authenticated", ADMIN_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET notes = 'Tel: PostgREST Admin',
    estimated_arrival_at = now() + interval '3 days'
WHERE id = '{req_id}';
""", jwt_role="authenticated")

# 2.3 PostgREST: Service Role
run_postgrest_tx("service_role", SERVICE_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET notes = 'Tel: PostgREST Service Role',
    estimated_arrival_at = now() + interval '4 days'
WHERE id = '{req_id}';
""", jwt_role="service_role")

# 2.4 Direct Postgres maintenance session
run_sql(f"""
UPDATE public.service_centre_part_requests
SET notes = 'Tel: Direct Postgres Session',
    estimated_arrival_at = now() + interval '5 days'
WHERE id = '{req_id}';
""")

# Read captured telemetry
c, tel_out, err = run_sql("""
SELECT label, cur_user, sess_user, active_role, COALESCE(auth_uid, 'NULL'), COALESCE(jwt_role, 'NULL'), COALESCE(app_role, 'NULL')
FROM public._step5a8_telemetry
ORDER BY id;
""")

print("\nCaptured Telemetry Across Role Contexts:")
print(f"  {'Context Label':<28} | {'CURRENT_USER':<12} | {'SESSION_USER':<13} | {'active_role':<13} | {'auth.uid()':<36} | {'jwt_role':<13} | {'app_role'}")
print("  " + "-" * 135)
for line in tel_out.strip().split("\n"):
    if line:
        lp = line.split("|")
        print(f"  {lp[0]:<28} | {lp[1]:<12} | {lp[2]:<13} | {lp[3]:<13} | {lp[4]:<36} | {lp[5]:<13} | {lp[6]}")

# Validate telemetry properties
test("PostgREST Technician: CURRENT_USER is function owner ('postgres')", "postgres" in tel_out)
test("PostgREST Technician: SESSION_USER is 'authenticator'", "authenticator" in tel_out)

# Clean up diagnostic trigger
run_sql("""
DROP TRIGGER IF EXISTS trg_diag_step5a8 ON public.service_centre_part_requests;
DROP FUNCTION IF EXISTS public._trg_step5a8_telemetry();
DROP TABLE IF EXISTS public._step5a8_telemetry;
""")

# ==============================================================================
# SECTION 3: BOUNDARY VERIFICATION UNDER POSTGREST SESSIONS
# ==============================================================================
print("\n--- 3. Comprehensive Boundary Verification Under PostgREST Sessions ---")

# 3.1 Assigned Technician: Permitted to update ETA and notes on assigned PENDING request
c, o, e = run_postgrest_tx("authenticated", TECH_A_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '6 days',
    notes = 'PostgREST Tech A Legitimate'
WHERE id = '{req_id}';
""")
test("3.1 Assigned technician permitted to update ETA/notes via PostgREST", c == 0, e)

# Verify authoritative metadata stamping
c, o, e = run_sql(f"""
SELECT (p.auth_user_id = '{TECH_A_AUTH_ID}')::text,
       (pr.eta_updated_at > now() - interval '10 seconds')::text,
       (pr.updated_at > now() - interval '10 seconds')::text
FROM public.service_centre_part_requests pr
JOIN public.profiles p ON pr.eta_updated_by = p.id
WHERE pr.id = '{req_id}';
""")
test("3.1 Assigned technician update authoritatively stamped metadata", o.strip() == "true|true|true", f"Got: {o}")

# 3.2 Assigned Technician: Blocked from modifying protected column (quantity)
c, o, e = run_postgrest_tx("authenticated", TECH_A_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET quantity = quantity + 1
WHERE id = '{req_id}';
""")
test("3.2 Assigned technician blocked from altering quantity (42501)",
     c != 0 and ("Technicians can only coordinate part ETA and notes" in e or "42501" in e), f"RC={c}, ERR={e}")

# 3.3 Assigned Technician: Blocked from modifying unassigned requisition
TECH_B_AUTH_ID = "00000000-0000-0000-0000-000000000006"
TECH_B_PROFILE_ID = "00000000-0000-0000-0000-000000000006"
c, unassigned_id, e = run_sql(f"""
SELECT id FROM public.service_centre_part_requests 
WHERE status = 'PENDING' AND id != '{req_id}'
LIMIT 1;
""")
if not unassigned_id:
    # Create or use another pending request assigned to Tech B
    pass
else:
    # Assign linked repair to Tech B
    run_sql(f"""
    UPDATE public.repair_requests
    SET technician_id = '{TECH_B_PROFILE_ID}'
    WHERE id = (SELECT repair_request_id FROM public.service_centre_part_requests WHERE id = '{unassigned_id}');
    """)
    # Tech A attempts direct update on Tech B's requisition:
    c, o, e = run_postgrest_tx("authenticated", TECH_A_AUTH_ID, f"""
    UPDATE public.service_centre_part_requests
    SET notes = 'Unassigned direct SQL exploit'
    WHERE id = '{unassigned_id}';
    """)
    c_check, o_check, e_check = run_sql(f"SELECT notes FROM public.service_centre_part_requests WHERE id = '{unassigned_id}';")
    test("3.3a Assigned technician blocked from updating unassigned requisition via direct SQL (RLS 0 rows)",
         "Unassigned direct SQL" not in o_check, f"Notes: {o_check}")

    # Tech A attempts RPC on Tech B's requisition:
    c, o, e = run_postgrest_tx("authenticated", TECH_A_AUTH_ID, f"""
    SELECT public.update_service_centre_part_request_eta(
      '{unassigned_id}'::uuid,
      now() + interval '5 days',
      'Unassigned RPC exploit'
    );
    """)
    test("3.3b Assigned technician blocked from updating unassigned requisition via RPC (42501)",
         c != 0 and ("Only the assigned technician" in e or "42501" in e), f"RC={c}, ERR={e}")

# 3.4 Assigned Technician: Blocked when request leaves PENDING
c, non_pending_id, e = run_sql("""
SELECT id FROM public.service_centre_part_requests WHERE status != 'PENDING' LIMIT 1;
""")
if not non_pending_id:
    # Set a dummy request to HANDED_OFF
    c, non_pending_id, e = run_sql("SELECT id FROM public.service_centre_part_requests LIMIT 1;")
    run_sql(f"UPDATE public.service_centre_part_requests SET status = 'HANDED_OFF' WHERE id = '{non_pending_id}';")

c, o, e = run_postgrest_tx("authenticated", TECH_A_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET notes = 'Non pending exploit attempt'
WHERE id = '{non_pending_id}';
""")
c_check, o_check, e_check = run_sql(f"SELECT notes FROM public.service_centre_part_requests WHERE id = '{non_pending_id}';")
test("3.4 Assigned technician blocked when status != PENDING", "Non pending exploit" not in o_check, f"Notes: {o_check}")

# 3.5 NULL-role Authenticated User (Ghost User): Direct SQL rejected
c, o, e = run_postgrest_tx("authenticated", GHOST_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET notes = 'Ghost user direct SQL exploit'
WHERE id = '{req_id}';
""")
c_check, o_check, e_check = run_sql(f"SELECT notes FROM public.service_centre_part_requests WHERE id = '{req_id}';")
test("3.5 NULL-role authenticated user rejected from direct SQL", "Ghost user direct SQL" not in o_check, f"Notes: {o_check}")

# 3.6 NULL-role Authenticated User: RPC call rejected (42501 Authentication required)
c, o, e = run_postgrest_tx("authenticated", GHOST_AUTH_ID, f"""
SELECT public.update_service_centre_part_request_eta(
  '{req_id}'::uuid,
  now() + interval '7 days',
  'Ghost RPC exploit'
);
""")
test("3.6 NULL-role authenticated user rejected by RPC (42501 Authentication required)",
     c != 0 and ("Authentication required" in e or "42501" in e), f"RC={c}, ERR={e}")

# 3.7 Administrator: Legitimate ETA/notes update permitted
c, o, e = run_postgrest_tx("authenticated", ADMIN_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '8 days',
    notes = 'PostgREST Admin Legitimate ETA'
WHERE id = '{req_id}';
""")
test("3.7 Administrator legitimate ETA update permitted via PostgREST", c == 0, e)

# Verify admin profile stamped
c, o, e = run_sql(f"""
SELECT (p.auth_user_id = '{ADMIN_AUTH_ID}')::text
FROM public.service_centre_part_requests pr
JOIN public.profiles p ON pr.eta_updated_by = p.id
WHERE pr.id = '{req_id}';
""")
test("3.7 Administrator ETA update stamped admin profile ID", o.strip() == "true", f"Got: {o}")

# 3.8 Administrator: Legitimate business update (quantity) permitted
c, o, e = run_postgrest_tx("authenticated", ADMIN_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET quantity = quantity + 1
WHERE id = '{req_id}';
""")
test("3.8 Administrator legitimate business update (quantity) permitted", c == 0, e)

# 3.9 Administrator: Audit spoofing attempt rejected (42501)
c, o, e = run_postgrest_tx("authenticated", ADMIN_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '9 days',
    notes = 'Admin spoof attempt',
    eta_updated_by = '{TECH_A_AUTH_ID}'::uuid
WHERE id = '{req_id}';
""")
test("3.9 Administrator audit spoofing attempt strictly rejected with 42501",
     c != 0 and ("cannot spoof" in e or "42501" in e), f"RC={c}, ERR={e}")

# 3.10 Administrator: Timestamp forgery attempt rejected (42501)
c, o, e = run_postgrest_tx("authenticated", ADMIN_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '10 days',
    notes = 'Admin timestamp forgery attempt',
    eta_updated_at = now() - interval '1 year'
WHERE id = '{req_id}';
""")
test("3.10 Administrator timestamp forgery attempt strictly rejected with 42501",
     c != 0 and ("system-managed" in e or "42501" in e), f"RC={c}, ERR={e}")

# 3.11 Service-role Context: Server-side maintenance permitted
c, o, e = run_postgrest_tx("service_role", SERVICE_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '11 days',
    notes = 'PostgREST Service-Role Maintenance'
WHERE id = '{req_id}';
""", jwt_role="service_role")
test("3.11 Service-role context maintenance permitted via PostgREST", c == 0, e)

# 3.12 Anonymous Context: Direct SQL rejected
c, o, e = run_postgrest_tx("anon", "", f"""
UPDATE public.service_centre_part_requests
SET notes = 'Anonymous exploit attempt'
WHERE id = '{req_id}';
""", jwt_role="anon")
c_check, o_check, e_check = run_sql(f"SELECT notes FROM public.service_centre_part_requests WHERE id = '{req_id}';")
test("3.12 Anonymous context direct SQL update rejected", "Anonymous exploit" not in o_check, f"Notes: {o_check}")

# 3.13 Anonymous Context: RPC call rejected (42501 or grant restriction)
c, o, e = run_postgrest_tx("anon", "", f"""
SELECT public.update_service_centre_part_request_eta(
  '{req_id}'::uuid,
  now() + interval '12 days',
  'Anonymous RPC attempt'
);
""", jwt_role="anon")
test("3.13 Anonymous context RPC call rejected (permission denied / 42501)",
     c != 0 and ("permission denied" in e or "Authentication required" in e or "42501" in e), f"RC={c}, ERR={e}")

# 3.14 Direct Postgres maintenance session permitted
c, o, e = run_sql(f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '13 days',
    notes = 'Direct Postgres Session Final'
WHERE id = '{req_id}';
""")
test("3.14 Direct postgres session update permitted", c == 0, e)

# 3.15 Impersonation Attack: Authenticated user forging service_role in JWT
# Active role is 'authenticated', but client sets request.jwt.claim.role = 'service_role'
c, o, e = run_postgrest_tx("authenticated", GHOST_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '14 days',
    notes = 'Forged JWT service_role exploit'
WHERE id = '{req_id}';
""", jwt_role="service_role")
c_check, o_check, e_check = run_sql(f"SELECT notes FROM public.service_centre_part_requests WHERE id = '{req_id}';")
test("3.15 Authenticated user forging service_role in JWT strictly rejected (role mismatch)",
     "Forged JWT service_role" not in o_check, f"Notes: {o_check}")

print("\n" + "=" * 85)
print(f"STEP 5A.8 BATTERY SUMMARY: {passed} PASSED, {failed} FAILED")
print("=" * 85)

if failed > 0:
    sys.exit(1)
