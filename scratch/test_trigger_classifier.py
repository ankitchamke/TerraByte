import subprocess

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
DB = "terabyte_clean_restore_drill"
USER = "postgres"

test_sql = """
-- Test full trigger state classifier query for REQ-33/34
WITH trigger_info AS (
  SELECT 
    tg.oid,
    tg.tgname,
    c.relname AS table_name,
    n.nspname AS schema_name,
    tg.tgenabled,
    tg.tgfoid::regprocedure AS bound_fn,
    pg_get_triggerdef(tg.oid) AS trigger_def,
    tg.tgisinternal
  FROM pg_trigger tg
  JOIN pg_class c ON c.oid = tg.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' 
    AND c.relname = 'service_centre_part_requests'
    AND tg.tgname = 'trg_protect_technician_part_request_fields'
)
SELECT 
  COALESCE(tgname, 'trg_protect_technician_part_request_fields') AS trigger_name,
  COALESCE(table_name, 'service_centre_part_requests') AS table_name,
  tgenabled,
  bound_fn,
  CASE 
    WHEN (SELECT count(*) FROM trigger_info) = 0 THEN 'ABSENT'
    WHEN (SELECT count(*) FROM trigger_info) > 1 THEN 'UNEXPECTED_STATE'
    WHEN tgisinternal = true THEN 'UNEXPECTED_STATE'
    WHEN tgenabled = 'O' 
         AND bound_fn = 'trg_enforce_technician_part_request_fields()'::regprocedure
         AND trigger_def = 'CREATE TRIGGER trg_protect_technician_part_request_fields BEFORE UPDATE ON public.service_centre_part_requests FOR EACH ROW EXECUTE FUNCTION trg_enforce_technician_part_request_fields()'
      THEN 'HEALTHY_ACTIVE'
    WHEN tgenabled != 'O' THEN 'DISABLED'
    WHEN bound_fn != 'trg_enforce_technician_part_request_fields()'::regprocedure THEN 'WRONG_FUNCTION'
    WHEN trigger_def != 'CREATE TRIGGER trg_protect_technician_part_request_fields BEFORE UPDATE ON public.service_centre_part_requests FOR EACH ROW EXECUTE FUNCTION trg_enforce_technician_part_request_fields()' THEN 'WRONG_DEFINITION'
    ELSE 'UNEXPECTED_STATE'
  END AS operational_state,
  CASE 
    WHEN (SELECT count(*) FROM trigger_info) = 0 THEN 'PROCEED: Trigger absent; creation may proceed after verifying prerequisites.'
    WHEN tgenabled = 'O' 
         AND bound_fn = 'trg_enforce_technician_part_request_fields()'::regprocedure
         AND trigger_def = 'CREATE TRIGGER trg_protect_technician_part_request_fields BEFORE UPDATE ON public.service_centre_part_requests FOR EACH ROW EXECUTE FUNCTION trg_enforce_technician_part_request_fields()'
      THEN 'SKIP: Trigger is healthy and active. DO NOT DROP. Skip both DROP and CREATE.'
    ELSE 'HALT: Anomalous trigger state detected. STOP AND INVESTIGATE immediately. Do not drop or recreate.'
  END AS action_required
FROM (SELECT 1) AS dummy
LEFT JOIN trigger_info ON true;
"""

with open("scratch/test_trigger_classifier.sql", "w", encoding="utf-8") as f:
    f.write(test_sql)

cmd = [PSQL, "-p", "5433", "-h", "127.0.0.1", "-U", USER, "-d", DB, "-w", "-f", "scratch/test_trigger_classifier.sql"]
res = subprocess.run(cmd, capture_output=True, text=True, env={"PGPASSWORD": "postgres"})
print("STDOUT:\n", res.stdout)
if res.stderr:
    print("STDERR:\n", res.stderr)
