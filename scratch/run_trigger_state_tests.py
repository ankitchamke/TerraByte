import subprocess

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
DB = "terabyte_clean_restore_drill"
USER = "postgres"

test_script = """
-- Case 1: Healthy trigger (already active)
SELECT 
  'Case 1: Healthy' AS test_case,
  count(*) AS row_count,
  bool_and(tgenabled = 'O') AS is_enabled,
  bool_and(tgfoid = 'public.trg_enforce_technician_part_request_fields()'::regprocedure) AS is_correct_func
FROM pg_trigger tg
JOIN pg_class c ON c.oid = tg.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' 
  AND c.relname = 'service_centre_part_requests'
  AND tg.tgname = 'trg_protect_technician_part_request_fields';

-- Case 2: Disabled trigger simulation
ALTER TABLE public.service_centre_part_requests DISABLE TRIGGER trg_protect_technician_part_request_fields;

SELECT 
  'Case 2: Disabled Anomaly' AS test_case,
  count(*) AS row_count,
  bool_and(tgenabled = 'O') AS is_enabled,
  bool_and(tgfoid = 'public.trg_enforce_technician_part_request_fields()'::regprocedure) AS is_correct_func
FROM pg_trigger tg
JOIN pg_class c ON c.oid = tg.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' 
  AND c.relname = 'service_centre_part_requests'
  AND tg.tgname = 'trg_protect_technician_part_request_fields';

-- Re-enable trigger
ALTER TABLE public.service_centre_part_requests ENABLE TRIGGER trg_protect_technician_part_request_fields;

-- Case 3: Dropped trigger simulation
DROP TRIGGER trg_protect_technician_part_request_fields ON public.service_centre_part_requests;

SELECT 
  'Case 3: Absent' AS test_case,
  count(*) AS row_count
FROM pg_trigger tg
JOIN pg_class c ON c.oid = tg.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' 
  AND c.relname = 'service_centre_part_requests'
  AND tg.tgname = 'trg_protect_technician_part_request_fields';

-- Re-create trigger cleanly
CREATE TRIGGER trg_protect_technician_part_request_fields
BEFORE UPDATE ON public.service_centre_part_requests
FOR EACH ROW
EXECUTE FUNCTION public.trg_enforce_technician_part_request_fields();

SELECT 
  'Restored' AS test_case,
  count(*) AS row_count,
  bool_and(tgenabled = 'O') AS is_enabled
FROM pg_trigger tg
JOIN pg_class c ON c.oid = tg.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' 
  AND c.relname = 'service_centre_part_requests'
  AND tg.tgname = 'trg_protect_technician_part_request_fields';
"""

with open("scratch/test_trigger_states.sql", "w", encoding="utf-8") as f:
    f.write(test_script)

cmd = [PSQL, "-p", "5433", "-U", USER, "-d", DB, "-f", "scratch/test_trigger_states.sql"]
res = subprocess.run(cmd, capture_output=True, text=True)
print("STDOUT:\n", res.stdout)
