import subprocess
import re

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
DB = "terabyte_clean_restore_drill"
USER = "postgres"

sql = """
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check,
  (regexp_replace(qual, '\\s+', ' ', 'g') = '((current_user_role() = ''admin''::user_role) OR ((current_user_role() = ''technician''::user_role) AND (status = ''PENDING''::text) AND (EXISTS ( SELECT 1 FROM repair_requests rr WHERE ((rr.id = service_centre_part_requests.repair_request_id) AND (rr.technician_id = current_profile_id()))))))') AS qual_matches,
  (qual = with_check) AS qual_equals_with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'service_centre_part_requests'
  AND policyname = 'Assigned technicians or admins can update part request ETA';
"""

cmd = [PSQL, "-p", "5433", "-U", USER, "-d", DB, "-c", sql]
res = subprocess.run(cmd, capture_output=True, text=True)
print("STDOUT:\n", res.stdout)
