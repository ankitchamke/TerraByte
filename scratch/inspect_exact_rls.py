import subprocess

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
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'service_centre_part_requests'
  AND policyname = 'Assigned technicians or admins can update part request ETA';
"""

cmd = [PSQL, "-p", "5433", "-U", USER, "-d", DB, "-c", sql]
res = subprocess.run(cmd, capture_output=True, text=True)
print("STDOUT:")
print(res.stdout)
