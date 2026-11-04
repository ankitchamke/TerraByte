import subprocess

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
DB = "terabyte_clean_restore_drill"
PORT = "5433"
USER = "postgres"

test_sql = """
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';

SELECT 
  auth.uid() AS auth_uid,
  public.current_profile_id() AS current_profile,
  public.current_user_role() AS current_role;

-- Try direct update without DO block to see the raw error
UPDATE public.service_centre_part_requests SET quantity = 99 WHERE id = 'bbbbbbbb-1111-1111-1111-111111111111';
ROLLBACK;
"""

p = subprocess.run([PSQL, "-p", PORT, "-U", USER, "-d", DB, "-c", test_sql], capture_output=True, text=True)
print("RC:", p.returncode)
print("STDOUT:\n", p.stdout)
print("STDERR:\n", p.stderr)
