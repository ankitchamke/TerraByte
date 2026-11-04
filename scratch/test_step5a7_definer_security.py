import subprocess
import json
import uuid

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
DB_ARGS = ["-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "terabyte_clean_restore_drill"]

def run_sql(sql):
    cmd = [PSQL] + DB_ARGS + ["-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    return res.returncode, res.stdout.strip(), res.stderr.strip()

def run_sql_as(role, user_auth_id, sql, jwt_role="authenticated"):
    wrapper = f"""
    SET ROLE {role};
    SET request.jwt.claim.role = '{jwt_role}';
    SET request.jwt.claim.sub = '{user_auth_id}';
    SET request.jwt.claims = '{{"sub":"{user_auth_id}","role":"{jwt_role}"}}';
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
print("TerraByte — Step 5A.7 SECURITY DEFINER Caller Identity Verification Battery")
print("=" * 80)

# ------------------------------------------------------------------------------
# 1. OWNER & CALLER IDENTITY DEMONSTRATION
# ------------------------------------------------------------------------------
print("\n--- 1. Verification of Function Owner & Invariant CURRENT_USER ---")

c, out, err = run_sql("""
SELECT p.proname, r.rolname as owner, p.prosecdef
FROM pg_proc p JOIN pg_roles r ON p.proowner = r.oid
WHERE p.proname = 'trg_enforce_technician_part_request_fields';
""")
parts = out.strip().split("|")
test("Trigger function is owned by postgres", parts[1] == "postgres", f"Got: {out}")
test("Trigger function is SECURITY DEFINER (prosecdef = t)", parts[2] == "t", f"Got: {out}")

# Install temporary telemetry logger inside a test trigger on service_centre_part_requests
run_sql("""
CREATE TABLE IF NOT EXISTS public._step5a7_telemetry (
  id serial primary key,
  label text,
  cur_user text,
  sess_user text,
  auth_uid text,
  jwt_role text,
  app_role text
);

CREATE OR REPLACE FUNCTION public._trg_telemetry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public._step5a7_telemetry (label, cur_user, sess_user, auth_uid, jwt_role, app_role)
  VALUES (
    COALESCE(NEW.notes, 'unlabeled'),
    CURRENT_USER::text,
    SESSION_USER::text,
    auth.uid()::text,
    auth.jwt()->>'role',
    public.current_user_role()::text
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_test_telemetry ON public.service_centre_part_requests;
CREATE TRIGGER trg_test_telemetry
BEFORE UPDATE ON public.service_centre_part_requests
FOR EACH ROW EXECUTE FUNCTION public._trg_telemetry();
""")

# Seed test fixtures
TECH_A_AUTH_ID = "00000000-0000-0000-0000-000000000004"
ADMIN_AUTH_ID = "00000000-0000-0000-0000-000000000005"
GHOST_AUTH_ID = str(uuid.uuid4())
SERVICE_AUTH_ID = str(uuid.uuid4())

run_sql(f"""
INSERT INTO auth.users (id, email) VALUES ('{GHOST_AUTH_ID}', 'ghost_{GHOST_AUTH_ID[:8]}@tb.dev')
ON CONFLICT (id) DO NOTHING;
DELETE FROM public.profiles WHERE auth_user_id = '{GHOST_AUTH_ID}';
""")

c, req_id, err = run_sql("SELECT id FROM public.service_centre_part_requests WHERE status = 'PENDING' LIMIT 1;")

# Clear telemetry
run_sql("TRUNCATE public._step5a7_telemetry;")

# Run 4 test callers through the telemetry trigger
run_sql_as("authenticated", TECH_A_AUTH_ID, f"UPDATE public.service_centre_part_requests SET notes = 'Tel: Tech A' WHERE id = '{req_id}';")
run_sql_as("authenticated", ADMIN_AUTH_ID, f"UPDATE public.service_centre_part_requests SET notes = 'Tel: Admin' WHERE id = '{req_id}';")
run_sql_as("service_role", SERVICE_AUTH_ID, f"UPDATE public.service_centre_part_requests SET notes = 'Tel: Service Role' WHERE id = '{req_id}';", jwt_role="service_role")
run_sql(f"UPDATE public.service_centre_part_requests SET notes = 'Tel: Direct Postgres' WHERE id = '{req_id}';")

c, tel_out, err = run_sql("SELECT label, cur_user, sess_user, COALESCE(jwt_role, 'NULL'), COALESCE(app_role, 'NULL') FROM public._step5a7_telemetry ORDER BY id;")

print("\nCaptured Telemetry Records:")
for line in tel_out.strip().split("\n"):
    if line:
        lp = line.split("|")
        print(f"  Caller: {lp[0]:<20} | CURRENT_USER: {lp[1]:<10} | SESSION_USER: {lp[2]:<10} | jwt.role: {lp[3]:<14} | app_role: {lp[4]}")
        # Verify CURRENT_USER is invariant postgres
        test(f"CURRENT_USER is function owner ('postgres') for '{lp[0]}'", lp[1] == "postgres", f"Got: {lp[1]}")

# Clean up telemetry trigger
run_sql("""
DROP TRIGGER IF EXISTS trg_test_telemetry ON public.service_centre_part_requests;
DROP FUNCTION IF EXISTS public._trg_telemetry();
DROP TABLE IF EXISTS public._step5a7_telemetry;
""")

# ------------------------------------------------------------------------------
# 2. PRIVILEGED BOUNDARY & IDENTITY ENFORCEMENT
# ------------------------------------------------------------------------------
print("\n--- 2. Privileged Boundary Verification (Corrected Architecture) ---")

# 2.1 Authenticated Ghost User (NULL app_role, jwt_role='authenticated') direct SQL: rejected!
code, out, err = run_sql_as("authenticated", GHOST_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '1 day',
    notes = 'Ghost exploit attempt'
WHERE id = '{req_id}';
""")
c_check, o_check, e_check = run_sql(f"SELECT notes FROM public.service_centre_part_requests WHERE id = '{req_id}';")
test("2.1 Authenticated client with NULL role rejected from direct SQL update",
     "Ghost exploit" not in o_check, f"Notes: {o_check}")

# 2.2 Authenticated Ghost User calling approved RPC: rejected (42501 Authentication required)
code, out, err = run_sql_as("authenticated", GHOST_AUTH_ID, f"""
SELECT public.update_service_centre_part_request_eta(
  '{req_id}'::uuid,
  now() + interval '1 day',
  'Ghost RPC'
);
""")
test("2.2 Authenticated client with NULL role rejected by RPC (42501 Authentication required)",
     code != 0 and ("Authentication required" in err or "42501" in err), f"code={code}, err={err}")

# 2.3 Ordinary authenticated user attempting to forge service-role in JWT: rejected!
# (Cannot SET ROLE service_role because authenticated role lacks privileges, or rejected by trigger)
code, out, err = run_sql_as("authenticated", GHOST_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '1 day',
    notes = 'Fake service role exploit'
WHERE id = '{req_id}';
""", jwt_role="service_role")
c_check, o_check, e_check = run_sql(f"SELECT notes FROM public.service_centre_part_requests WHERE id = '{req_id}';")
test("2.3 Authenticated user forging service-role in JWT claim rejected (active role mismatch)",
     "Fake service role" not in o_check, f"Notes: {o_check}")

# 2.4 Verified service-role JWT context: permitted!
code, out, err = run_sql_as("service_role", SERVICE_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '2 days',
    notes = 'Verified service-role maintenance'
WHERE id = '{req_id}';
""", jwt_role="service_role")
test("2.4 Verified service-role JWT context permitted", code == 0, err)

c_check, o_check, e_check = run_sql(f"""
SELECT notes = 'Verified service-role maintenance',
       updated_at > now() - interval '10 seconds'
FROM public.service_centre_part_requests WHERE id = '{req_id}';
""")
test("2.4 Verified service-role update recorded in database", o_check.strip() == "t|t", f"Got: {o_check}")

# 2.5 Direct postgres maintenance session: permitted!
code, out, err = run_sql(f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '3 days',
    notes = 'Direct postgres session maintenance'
WHERE id = '{req_id}';
""")
test("2.5 Direct postgres session maintenance permitted", code == 0, err)

c_check, o_check, e_check = run_sql(f"""
SELECT notes = 'Direct postgres session maintenance',
       updated_at > now() - interval '10 seconds'
FROM public.service_centre_part_requests WHERE id = '{req_id}';
""")
test("2.5 Direct postgres update recorded in database", o_check.strip() == "t|t", f"Got: {o_check}")

# 2.6 Assigned technician ETA update continues to work cleanly
code, out, err = run_sql_as("authenticated", TECH_A_AUTH_ID, f"""
SELECT public.update_service_centre_part_request_eta(
  '{req_id}'::uuid,
  now() + interval '4 days',
  'Legitimate tech ETA update'
);
""")
test("2.6 Assigned technician RPC ETA update succeeds", code == 0, err)

# 2.7 Administrator ETA update continues to work cleanly
code, out, err = run_sql_as("authenticated", ADMIN_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '5 days',
    notes = 'Legitimate admin ETA update'
WHERE id = '{req_id}';
""")
test("2.7 Administrator direct ETA update succeeds", code == 0, err)

# 2.8 Administrator spoofing attempt continues to be strictly rejected
code, out, err = run_sql_as("authenticated", ADMIN_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET estimated_arrival_at = now() + interval '6 days',
    notes = 'Admin spoof attempt',
    eta_updated_by = '{TECH_A_AUTH_ID}'::uuid
WHERE id = '{req_id}';
""")
test("2.8 Administrator audit spoofing attempt strictly rejected with 42501",
     code != 0 and ("cannot spoof" in err or "42501" in err), f"code={code}, err={err}")

print("\n" + "=" * 80)
print(f"STEP 5A.7 BATTERY SUMMARY: {passed} PASSED, {failed} FAILED")
print("=" * 80)
if failed > 0:
    exit(1)
