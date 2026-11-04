import subprocess
import json
import os

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
PORT = "5433"
HOST = "127.0.0.1"
USER = "postgres"
DB = "terabyte_clean_restore_drill"

env = os.environ.copy()
env["PGPASSWORD"] = "postgres"

def run_query(sql):
    with open("scratch/temp_trigger_test.sql", "w", encoding="utf-8") as f:
        f.write(sql)
    cmd = [PSQL, "-p", PORT, "-h", HOST, "-U", USER, "-d", DB, "-w", "-t", "-A", "-F|", "-f", "scratch/temp_trigger_test.sql"]
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    return res.returncode, res.stdout.strip(), res.stderr.strip()

# Classifier query template for disposable table public._test_trigger_table
CLASSIFIER_QUERY = """
WITH trigger_info AS (
  SELECT 
    tg.oid,
    tg.tgname,
    c.relname AS table_name,
    n.nspname AS schema_name,
    tg.tgenabled,
    tg.tgfoid::regprocedure AS bound_fn,
    pg_get_triggerdef(tg.oid) AS trigger_def,
    tg.tgisinternal,
    -- Structural checks
    ((tg.tgtype & 1) = 1) AS is_row_level,
    ((tg.tgtype & 2) = 2) AS is_before,
    ((tg.tgtype & 16) = 16) AS is_update
  FROM pg_trigger tg
  JOIN pg_class c ON c.oid = tg.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' 
    AND c.relname = '_test_trigger_table'
    AND tg.tgname = '_test_guard_trg'
)
SELECT 
  COALESCE(tgname, '_test_guard_trg') AS trigger_name,
  COALESCE(table_name, '_test_trigger_table') AS table_name,
  COALESCE(tgenabled, 'NONE') AS enabled_state,
  COALESCE(bound_fn::text, 'NONE') AS bound_function,
  CASE 
    WHEN (SELECT count(*) FROM trigger_info) = 0 THEN 'ABSENT'
    WHEN (SELECT count(*) FROM trigger_info) > 1 THEN 'UNEXPECTED_STATE'
    WHEN tgisinternal = true THEN 'UNEXPECTED_STATE'
    WHEN tgenabled = 'O' 
         AND bound_fn = 'public._test_valid_func()'::regprocedure
         AND is_row_level = true AND is_before = true AND is_update = true
      THEN 'HEALTHY_ACTIVE'
    WHEN tgenabled != 'O' THEN 'DISABLED'
    WHEN bound_fn != 'public._test_valid_func()'::regprocedure THEN 'WRONG_FUNCTION'
    WHEN NOT (is_row_level = true AND is_before = true AND is_update = true) THEN 'WRONG_DEFINITION'
    ELSE 'UNEXPECTED_STATE'
  END AS operational_state,
  CASE 
    WHEN (SELECT count(*) FROM trigger_info) = 0 THEN 'PROCEED: Trigger absent; creation may proceed after verifying prerequisites.'
    WHEN tgenabled = 'O' 
         AND bound_fn = 'public._test_valid_func()'::regprocedure
         AND is_row_level = true AND is_before = true AND is_update = true
      THEN 'SKIP: Trigger is healthy and active. DO NOT DROP. Skip both DROP and CREATE.'
    ELSE 'HALT: Anomalous trigger state detected. STOP AND INVESTIGATE immediately. Do not drop or recreate.'
  END AS action_required
FROM (SELECT 1) AS dummy
LEFT JOIN trigger_info ON true;
"""

# Setup disposable test environment
setup_sql = """
DROP TABLE IF EXISTS public._test_trigger_table CASCADE;
CREATE TABLE public._test_trigger_table (id serial primary key, val text);

CREATE OR REPLACE FUNCTION public._test_valid_func() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public._test_wrong_func() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RETURN NEW; END; $$;
"""
run_query(setup_sql)

states_to_test = [
    {
        "state_name": "ABSENT",
        "setup_sql": "-- Ensure trigger is absent\nDROP TRIGGER IF EXISTS _test_guard_trg ON public._test_trigger_table;",
        "expected_state": "ABSENT"
    },
    {
        "state_name": "HEALTHY_ACTIVE",
        "setup_sql": """
CREATE TRIGGER _test_guard_trg
BEFORE UPDATE ON public._test_trigger_table
FOR EACH ROW
EXECUTE FUNCTION public._test_valid_func();
""",
        "expected_state": "HEALTHY_ACTIVE"
    },
    {
        "state_name": "DISABLED",
        "setup_sql": """
ALTER TABLE public._test_trigger_table DISABLE TRIGGER _test_guard_trg;
""",
        "expected_state": "DISABLED"
    },
    {
        "state_name": "WRONG_FUNCTION",
        "setup_sql": """
DROP TRIGGER IF EXISTS _test_guard_trg ON public._test_trigger_table;
CREATE TRIGGER _test_guard_trg
BEFORE UPDATE ON public._test_trigger_table
FOR EACH ROW
EXECUTE FUNCTION public._test_wrong_func();
""",
        "expected_state": "WRONG_FUNCTION"
    },
    {
        "state_name": "WRONG_DEFINITION",
        "setup_sql": """
DROP TRIGGER IF EXISTS _test_guard_trg ON public._test_trigger_table;
-- Create as AFTER INSERT instead of BEFORE UPDATE
CREATE TRIGGER _test_guard_trg
AFTER INSERT ON public._test_trigger_table
FOR EACH ROW
EXECUTE FUNCTION public._test_valid_func();
""",
        "expected_state": "WRONG_DEFINITION"
    },
    {
        "state_name": "UNEXPECTED_STATE",
        "setup_sql": """
-- Create a second trigger with same name on a different table or simulate internal trigger
-- In PostgreSQL, internal triggers have tgisinternal = true
-- Let's test constraint trigger or update pg_trigger directly in test transaction
DROP TRIGGER IF EXISTS _test_guard_trg ON public._test_trigger_table;
CREATE CONSTRAINT TRIGGER _test_guard_trg
AFTER INSERT ON public._test_trigger_table
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public._test_valid_func();
-- Mark tgisinternal = true
UPDATE pg_trigger SET tgisinternal = true WHERE tgname = '_test_guard_trg';
""",
        "expected_state": "UNEXPECTED_STATE"
    }
]

audit_results = []
all_passed = True

for st in states_to_test:
    name = st["state_name"]
    print(f"=== Testing State: {name} ===")
    rc, out, err = run_query(st["setup_sql"])
    if rc != 0:
        print(f"Setup failed for {name}: {err}")
        all_passed = False
        continue
        
    rc, out, err = run_query(CLASSIFIER_QUERY)
    lines = [l.strip() for l in out.splitlines() if l.strip()]
    detected_state = "UNKNOWN"
    if lines:
        parts = lines[0].split("|")
        if len(parts) >= 5:
            detected_state = parts[4].strip()
            
    is_pass = (detected_state == st["expected_state"])
    print(f"  Expected: {st['expected_state']} | Detected: {detected_state} | Result: {'PASS' if is_pass else 'FAIL'}")
    if not is_pass:
        all_passed = False
        
    audit_results.append({
        "state": name,
        "setup_sql": st["setup_sql"].strip(),
        "classifier_output": out,
        "expected_state": st["expected_state"],
        "detected_state": detected_state,
        "status": "PASS" if is_pass else "FAIL"
    })

# Clean up disposable test objects
run_query("""
DROP TABLE IF EXISTS public._test_trigger_table CASCADE;
DROP FUNCTION IF EXISTS public._test_valid_func() CASCADE;
DROP FUNCTION IF EXISTS public._test_wrong_func() CASCADE;
""")

with open("scratch/six_trigger_states_results.json", "w", encoding="utf-8") as f:
    json.dump(audit_results, f, indent=2)

print(f"\nFinal Six-State Verification: {'ALL 6 PASSED' if all_passed else 'SOME FAILED'}")
