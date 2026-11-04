import subprocess

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
DB = "terabyte_clean_restore_drill"
USER = "postgres"

cmd = [PSQL, "-p", "5433", "-U", USER, "-d", DB, "-t", "-A", "-c", "SELECT qual, with_check FROM pg_policies WHERE policyname = 'Assigned technicians or admins can update part request ETA';"]
res = subprocess.run(cmd, capture_output=True, text=True)
parts = res.stdout.strip().split("|")
print("QUAL (repr):", repr(parts[0]))
print("WITH_CHECK (repr):", repr(parts[1]))
