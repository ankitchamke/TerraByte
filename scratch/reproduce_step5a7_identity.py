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

# Create a temporary diagnostic trigger function that logs identity values to a temp table
run_sql("""
CREATE TABLE IF NOT EXISTS public._step5a7_identity_log (
  id serial primary key,
  label text,
  current_user_val text,
  session_user_val text,
  auth_uid_val text,
  jwt_role_val text,
  app_role_val text,
  created_at timestamptz default now()
);

CREATE OR REPLACE FUNCTION public._diag_trg_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public._step5a7_identity_log (
    label,
    current_user_val,
    session_user_val,
    auth_uid_val,
    jwt_role_val,
    app_role_val
  ) VALUES (
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

DROP TRIGGER IF EXISTS trg_diag_step5a7 ON public.service_centre_part_requests;
CREATE TRIGGER trg_diag_step5a7
BEFORE UPDATE ON public.service_centre_part_requests
FOR EACH ROW
EXECUTE FUNCTION public._diag_trg_identity();
""")

# Identities
TECH_A_AUTH_ID = "00000000-0000-0000-0000-000000000004"
ADMIN_AUTH_ID = "00000000-0000-0000-0000-000000000005"
GHOST_AUTH_ID = str(uuid.uuid4())
SERVICE_ROLE_AUTH_ID = str(uuid.uuid4())

# Setup ghost auth user without profile
run_sql(f"""
INSERT INTO auth.users (id, email) VALUES ('{GHOST_AUTH_ID}', 'ghost_{GHOST_AUTH_ID[:8]}@tb.dev')
ON CONFLICT (id) DO NOTHING;
DELETE FROM public.profiles WHERE auth_user_id = '{GHOST_AUTH_ID}';
""")

# Get a test request
c, req_id, e = run_sql("SELECT id FROM public.service_centre_part_requests WHERE status = 'PENDING' LIMIT 1;")
print(f"Target requisition: {req_id}")

# Clear log
run_sql("TRUNCATE public._step5a7_identity_log;")

# 1. Assigned technician
run_sql_as("authenticated", TECH_A_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET notes = 'Test Technician A'
WHERE id = '{req_id}';
""")

# 2. Authenticated user with NO profile (Ghost user)
c, o, err = run_sql_as("authenticated", GHOST_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET notes = 'Test Ghost User'
WHERE id = '{req_id}';
""")
if err:
    print(f"Ghost User error: {err}")

# 3. Administrator
c, o, err = run_sql_as("authenticated", ADMIN_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET notes = 'Test Administrator'
WHERE id = '{req_id}';
""")
if err:
    print(f"Admin error: {err}")

# 4. Service-role JWT context
c, o, err = run_sql_as("service_role", SERVICE_ROLE_AUTH_ID, f"""
UPDATE public.service_centre_part_requests
SET notes = 'Test Service Role'
WHERE id = '{req_id}';
""", jwt_role="service_role")
if err:
    print(f"Service Role error: {err}")

# 5. Direct postgres maintenance session
run_sql(f"""
UPDATE public.service_centre_part_requests
SET notes = 'Test Direct Postgres'
WHERE id = '{req_id}';
""")

# Retrieve logged values
c, out, e = run_sql("""
SELECT label, current_user_val, session_user_val, COALESCE(auth_uid_val, 'NULL'), COALESCE(jwt_role_val, 'NULL'), COALESCE(app_role_val, 'NULL')
FROM public._step5a7_identity_log
ORDER BY id;
""")

print("\n--- Identity Signals Captured Inside SECURITY DEFINER Trigger ---")
print(f"{'Label':<25} | {'CURRENT_USER':<12} | {'SESSION_USER':<12} | {'auth.uid()':<36} | {'jwt.role':<14} | {'app_role'}")
print("-" * 115)
for line in out.strip().split("\n"):
    if line:
        parts = line.split("|")
        print(f"{parts[0]:<25} | {parts[1]:<12} | {parts[2]:<12} | {parts[3]:<36} | {parts[4]:<14} | {parts[5]}")

# Clean up diagnostic trigger & table
run_sql("""
DROP TRIGGER IF EXISTS trg_diag_step5a7 ON public.service_centre_part_requests;
DROP FUNCTION IF EXISTS public._diag_trg_identity();
DROP TABLE IF EXISTS public._step5a7_identity_log;
""")
