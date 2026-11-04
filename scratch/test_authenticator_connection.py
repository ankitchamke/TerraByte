import subprocess

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
DB_ARGS = ["-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "terabyte_clean_restore_drill"]

def run_sql(sql, user="postgres"):
    args = ["-h", "127.0.0.1", "-p", "5433", "-U", user, "-d", "terabyte_clean_restore_drill"]
    cmd = [PSQL] + args + ["-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    return res.returncode, res.stdout.strip(), res.stderr.strip()

print("Step 1: Create authenticator role on local drill database")
c, o, e = run_sql("""
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator WITH LOGIN NOINHERIT;
    GRANT anon, authenticated, service_role TO authenticator;
  END IF;
END $role$;
""")
print(f"Create authenticator RC: {c}, ERR: {e}")

print("Step 2: Connect as authenticator and run SELECT CURRENT_USER, SESSION_USER;")
c, o, e = run_sql("SELECT CURRENT_USER, SESSION_USER;", user="authenticator")
print(f"Connect authenticator RC: {c}, OUT: {o}, ERR: {e}")

print("Step 3: Connect as authenticator, SET LOCAL ROLE authenticated, check roles:")
c, o, e = run_sql("""
BEGIN;
SET LOCAL ROLE authenticated;
SELECT CURRENT_USER, SESSION_USER, current_setting('role', true);
COMMIT;
""", user="authenticator")
print(f"SET LOCAL ROLE RC: {c}, OUT: {o}, ERR: {e}")
