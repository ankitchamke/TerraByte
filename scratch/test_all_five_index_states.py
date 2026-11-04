import subprocess
import os
import json

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
PORT = "5433"
HOST = "127.0.0.1"
USER = "postgres"
DB = "terabyte_clean_restore_drill"

env = os.environ.copy()
env["PGPASSWORD"] = "postgres"

def run_query(sql):
    with open("scratch/temp_index_test.sql", "w", encoding="utf-8") as f:
        f.write(sql)
    cmd = [PSQL, "-p", PORT, "-h", HOST, "-U", USER, "-d", DB, "-w", "-t", "-A", "-F|", "-f", "scratch/temp_index_test.sql"]
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    return res.returncode, res.stdout.strip(), res.stderr.strip()

INDEX_CLASSIFIER_QUERY = """
WITH idx_info AS (
  SELECT 
    ic.relname AS index_name,
    tc.relname AS table_name,
    tn.nspname AS schema_name,
    i.indisvalid,
    i.indisready,
    pg_get_indexdef(i.indexrelid) AS index_def
  FROM pg_class ic
  JOIN pg_namespace in_nsp ON in_nsp.oid = ic.relnamespace
  JOIN pg_index i ON i.indexrelid = ic.oid
  JOIN pg_class tc ON tc.oid = i.indrelid
  JOIN pg_namespace tn ON tn.oid = tc.relnamespace
  WHERE ic.relkind = 'i' AND in_nsp.nspname = 'public' AND ic.relname = '_test_guard_idx'
)
SELECT 
  COALESCE(index_name, '_test_guard_idx') AS index_name,
  COALESCE(table_name, 'NONE') AS table_name,
  COALESCE(indisvalid::text, 'NONE') AS is_valid,
  COALESCE(indisready::text, 'NONE') AS is_ready,
  CASE 
    WHEN (SELECT count(*) FROM idx_info) = 0 THEN 'ABSENT'
    WHEN (SELECT count(*) FROM idx_info) > 1 THEN 'UNEXPECTED_STATE'
    WHEN table_name != '_test_index_table' THEN 'UNEXPECTED_TABLE_BINDING'
    WHEN indisvalid = false THEN 'INVALID_INDEX_RESIDUE'
    WHEN indisvalid = true AND indisready = true 
         AND index_def = 'CREATE INDEX _test_guard_idx ON public._test_index_table USING btree (ticket_id)'
      THEN 'CORRECT_VALID'
    WHEN indisvalid = true AND indisready = true THEN 'VALID_WRONG_DEFINITION'
    ELSE 'UNEXPECTED_STATE'
  END AS index_state,
  CASE
    WHEN (SELECT count(*) FROM idx_info) = 0 THEN 'PROCEED: Index absent; safe to create.'
    WHEN table_name != '_test_index_table' THEN 'HALT: Index exists on unexpected table. DO NOT AUTO-DROP. Investigate schema conflict.'
    WHEN indisvalid = false THEN 'HALT: Invalid index residue detected (indisvalid=false). Requires manual DBA investigation before cleanup.'
    WHEN indisvalid = true AND indisready = true 
         AND index_def = 'CREATE INDEX _test_guard_idx ON public._test_index_table USING btree (ticket_id)'
      THEN 'SKIP: Index exists, is valid, and matches desired definition. Do not recreate.'
    WHEN indisvalid = true AND indisready = true THEN 'HALT: Valid index exists with conflicting definition. DO NOT AUTO-DROP. Investigate application usage.'
    ELSE 'HALT: Unknown index condition. Stop and inspect.'
  END AS action_required
FROM (SELECT 1) AS dummy
LEFT JOIN idx_info ON true;
"""

# Setup disposable tables
setup_sql = """
DROP TABLE IF EXISTS public._test_index_table CASCADE;
DROP TABLE IF EXISTS public._test_other_table CASCADE;
CREATE TABLE public._test_index_table (id serial primary key, ticket_id uuid, status text);
CREATE TABLE public._test_other_table (id serial primary key, other_col uuid);
"""
run_query(setup_sql)

states_to_test = [
    {
        "state_name": "ABSENT",
        "setup_sql": "DROP INDEX IF EXISTS public._test_guard_idx;",
        "expected_state": "ABSENT"
    },
    {
        "state_name": "CORRECT_VALID",
        "setup_sql": """
DROP INDEX IF EXISTS public._test_guard_idx;
CREATE INDEX _test_guard_idx ON public._test_index_table(ticket_id);
""",
        "expected_state": "CORRECT_VALID"
    },
    {
        "state_name": "VALID_WRONG_DEFINITION",
        "setup_sql": """
DROP INDEX IF EXISTS public._test_guard_idx;
CREATE INDEX _test_guard_idx ON public._test_index_table(status);
""",
        "expected_state": "VALID_WRONG_DEFINITION"
    },
    {
        "state_name": "INVALID_INDEX_RESIDUE",
        "setup_sql": """
DROP INDEX IF EXISTS public._test_guard_idx;
CREATE INDEX _test_guard_idx ON public._test_index_table(ticket_id);
-- Simulate failed CREATE INDEX CONCURRENTLY residue by toggling indisvalid in pg_index
UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'public._test_guard_idx'::regclass;
""",
        "expected_state": "INVALID_INDEX_RESIDUE"
    },
    {
        "state_name": "UNEXPECTED_TABLE_BINDING",
        "setup_sql": """
DROP INDEX IF EXISTS public._test_guard_idx;
CREATE INDEX _test_guard_idx ON public._test_other_table(other_col);
""",
        "expected_state": "UNEXPECTED_TABLE_BINDING"
    }
]

audit_results = []
all_passed = True

for st in states_to_test:
    name = st["state_name"]
    print(f"=== Testing Index State: {name} ===")
    rc, out, err = run_query(st["setup_sql"])
    if rc != 0:
        print(f"Setup failed for {name}: {err}")
        all_passed = False
        continue
        
    rc, out, err = run_query(INDEX_CLASSIFIER_QUERY)
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

# Cleanup
run_query("""
DROP TABLE IF EXISTS public._test_index_table CASCADE;
DROP TABLE IF EXISTS public._test_other_table CASCADE;
""")

with open("scratch/five_index_states_results.json", "w", encoding="utf-8") as f:
    json.dump(audit_results, f, indent=2)

print(f"\nFinal Five-State Index Verification: {'ALL 5 PASSED' if all_passed else 'SOME FAILED'}")
