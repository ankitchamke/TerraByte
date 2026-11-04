import subprocess

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
DB = "terabyte_clean_restore_drill"
PORT = "5433"
USER = "postgres"

test_sql = """
CREATE OR REPLACE FUNCTION public._test_priv_check() RETURNS void LANGUAGE sql AS $$ SELECT 1; $$;

SELECT 
  has_function_privilege('public', 'public._test_priv_check()', 'execute') AS pub_has_it,
  has_function_privilege('anon', 'public._test_priv_check()', 'execute') AS anon_has_it,
  has_function_privilege('authenticated', 'public._test_priv_check()', 'execute') AS auth_has_it;

REVOKE ALL ON FUNCTION public._test_priv_check() FROM PUBLIC;

SELECT 
  has_function_privilege('public', 'public._test_priv_check()', 'execute') AS pub_after_revoke,
  has_function_privilege('anon', 'public._test_priv_check()', 'execute') AS anon_after_revoke,
  has_function_privilege('authenticated', 'public._test_priv_check()', 'execute') AS auth_after_revoke;

GRANT EXECUTE ON FUNCTION public._test_priv_check() TO authenticated;

SELECT 
  has_function_privilege('public', 'public._test_priv_check()', 'execute') AS pub_after_grant,
  has_function_privilege('anon', 'public._test_priv_check()', 'execute') AS anon_after_grant,
  has_function_privilege('authenticated', 'public._test_priv_check()', 'execute') AS auth_after_grant;

-- Also let's inspect pg_proc proacl and how ACL parsing works
SELECT proname, proacl FROM pg_proc WHERE proname = '_test_priv_check';

DROP FUNCTION public._test_priv_check();
"""

p = subprocess.run([PSQL, "-p", PORT, "-U", USER, "-d", DB, "-c", test_sql], capture_output=True, text=True)
print(p.stdout)
print(p.stderr)
