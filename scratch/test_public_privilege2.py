import subprocess

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
DB = "terabyte_clean_restore_drill"
PORT = "5433"
USER = "postgres"

test_sql = """
CREATE OR REPLACE FUNCTION public._test_priv_check2() RETURNS void LANGUAGE sql AS $$ SELECT 1; $$;

-- 1. Initial creation (default privileges applied)
SELECT 
  has_function_privilege('public', 'public._test_priv_check2()', 'execute') AS pub_init,
  has_function_privilege('anon', 'public._test_priv_check2()', 'execute') AS anon_init,
  has_function_privilege('authenticated', 'public._test_priv_check2()', 'execute') AS auth_init;

-- 2. Step 1: Revoke from PUBLIC
REVOKE ALL ON FUNCTION public._test_priv_check2() FROM PUBLIC;

-- 3. Step 2: Revoke from anon
REVOKE EXECUTE ON FUNCTION public._test_priv_check2() FROM anon;

-- 4. Step 3: Grant to authenticated, service_role
GRANT EXECUTE ON FUNCTION public._test_priv_check2() TO authenticated, service_role;

-- 5. Inspect final privileges
SELECT 
  has_function_privilege('public', 'public._test_priv_check2()', 'execute') AS pub_final,
  has_function_privilege('anon', 'public._test_priv_check2()', 'execute') AS anon_final,
  has_function_privilege('authenticated', 'public._test_priv_check2()', 'execute') AS auth_final,
  has_function_privilege('service_role', 'public._test_priv_check2()', 'execute') AS sr_final;

SELECT proname, proacl FROM pg_proc WHERE proname = '_test_priv_check2';

DROP FUNCTION public._test_priv_check2();
"""

p = subprocess.run([PSQL, "-p", PORT, "-U", USER, "-d", DB, "-c", test_sql], capture_output=True, text=True)
print(p.stdout)
print(p.stderr)
