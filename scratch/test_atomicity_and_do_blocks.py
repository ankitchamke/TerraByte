import subprocess

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
DB_ARGS = ["-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "terabyte_clean_restore_drill"]

def run_sql(sql):
    cmd = [PSQL] + DB_ARGS + ["-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    return res.returncode, res.stdout.strip(), res.stderr.strip()

print("--- 1. Testing CREATE OR REPLACE TRIGGER in PostgreSQL 17.6 ---")
c, o, e = run_sql("""
CREATE OR REPLACE TRIGGER trg_test_atomic_replace
BEFORE UPDATE ON public.service_centre_part_requests
FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_technician_part_request_fields();
""")
print(f"CREATE OR REPLACE TRIGGER initial: RC={c}, ERR={e}")

c, o, e = run_sql("""
CREATE OR REPLACE TRIGGER trg_test_atomic_replace
BEFORE UPDATE ON public.service_centre_part_requests
FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_technician_part_request_fields();
""")
print(f"CREATE OR REPLACE TRIGGER replacement: RC={c}, ERR={e}")

run_sql("DROP TRIGGER IF EXISTS trg_test_atomic_replace ON public.service_centre_part_requests;")

print("\n--- 2. Testing CREATE OR REPLACE POLICY in PostgreSQL 17.6 ---")
c, o, e = run_sql("""
CREATE OR REPLACE POLICY "test_policy" ON public.service_centre_part_requests
FOR UPDATE TO authenticated USING (true);
""")
print(f"CREATE OR REPLACE POLICY: RC={c}, ERR={e}")

print("\n--- 3. Testing Policy Atomic Replacement via DO block ---")
c, o, e = run_sql("""
DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "test_policy" ON public.service_centre_part_requests';
  EXECUTE 'CREATE POLICY "test_policy" ON public.service_centre_part_requests FOR UPDATE TO authenticated USING (true)';
END $$;
""")
print(f"Policy replacement in DO block: RC={c}, ERR={e}")

run_sql('DROP POLICY IF EXISTS "test_policy" ON public.service_centre_part_requests;')

print("\n--- 4. Testing Function Definition + Grants inside DO block ---")
c, o, e = run_sql("""
DO $do$
BEGIN
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public._test_do_func()
    RETURNS void LANGUAGE plpgsql AS $$
    BEGIN
      NULL;
    END;
    $$;
  $fn$;
  EXECUTE 'REVOKE ALL ON FUNCTION public._test_do_func() FROM PUBLIC';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public._test_do_func() TO authenticated, service_role';
END $do$;
""")
print(f"Function + Grants in DO block: RC={c}, ERR={e}")

c, o, e = run_sql("SELECT proname, prosecdef FROM pg_proc WHERE proname = '_test_do_func';")
print(f"Function created: {o}")
run_sql("DROP FUNCTION IF EXISTS public._test_do_func();")

print("\n--- 5. Testing CREATE INDEX IF NOT EXISTS in DO block vs separate statement ---")
c, o, e = run_sql("""
DO $$
BEGIN
  EXECUTE 'CREATE INDEX IF NOT EXISTS _test_idx ON public.service_centre_part_requests(status)';
END $$;
""")
print(f"CREATE INDEX inside DO block: RC={c}, ERR={e}")
run_sql("DROP INDEX IF EXISTS public._test_idx;")
