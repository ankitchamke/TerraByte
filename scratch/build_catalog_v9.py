import json
import re

with open("scratch/full_request_catalog_v8.json", "r", encoding="utf-8") as f:
    catalog_v8 = json.load(f)

catalog_v9 = []

for r in catalog_v8:
    req = dict(r)
    uid = req["unit_id"]
    stype = req["type"]
    target = req["target_object"]
    sql_text = req["text"].strip()
    lock_impact = req["lock_impact"]

    # 1. Clean unsupported duration claims from lock_impact
    clean_lock = lock_impact
    clean_lock = re.sub(r"\(~?1[–-]2ms on empty tables\)", "", clean_lock)
    clean_lock = re.sub(r"for < 1ms\.?", "", clean_lock)
    clean_lock = re.sub(r"\(< 1ms\)\.?", "", clean_lock)
    clean_lock = re.sub(r"Duration on 0-row table is < 1ms\.?", "", clean_lock)
    clean_lock = re.sub(r"lock duration is < 1ms\.?", "", clean_lock)
    clean_lock = re.sub(r"for catalog update \(< 1ms\)\.?", "for catalog update.", clean_lock)
    clean_lock = clean_lock.strip()
    if clean_lock.endswith(".."):
        clean_lock = clean_lock[:-1]
    req["lock_impact"] = clean_lock

    # 2. Update index recovery (REQ-01, REQ-02, REQ-27)
    if stype == "INDEX_CREATION":
        m = re.search(r"INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)", sql_text)
        iname = m.group(1) if m else "idx"
        tbl = "service_centre_part_sales" if "sales" in iname else ("service_centre_stock_audit" if "stock" in iname else "service_centre_part_requests")
        req["state_inspection_query"] = f"""SELECT 
  c.relname AS index_name,
  t.relname AS table_name,
  i.indisvalid,
  i.indisready,
  pg_get_indexdef(i.indexrelid) AS index_definition
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_class t ON t.oid = i.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public' 
  AND t.relname = '{tbl}'
  AND c.relname = '{iname}';"""
        req["ordinary_recovery"] = f"""SAFE INDEX RECOVERY PROTOCOL:
Inspect pg_index via the state-inspection query before taking any action.
- If 1 row returned with indisvalid = true: The index is fully built and operational. SKIP EXECUTION. Do NOT drop a valid index.
- If 1 row returned with indisvalid = false: The index build was interrupted or corrupted. STOP AND INVESTIGATE. Do not auto-drop. An operator must review locks, verify table health, and manually drop the invalid index ('DROP INDEX CONCURRENTLY public.{iname};' if traffic exists) before retrying.
- If 0 rows returned: Index is absent. Safe to proceed with CREATE INDEX IF NOT EXISTS."""

    # 3. Update trigger drop/create (REQ-33, 34, 51, 52)
    elif stype in ["DROP_TRIGGER", "CREATE_TRIGGER"]:
        tname = "trg_protect_technician_part_request_fields" if "protect" in target else "trg_notify_admin_on_technician_registration"
        tbl = "service_centre_part_requests" if "protect" in target else "technician_profiles"
        fn_expected = "public.trg_enforce_technician_part_request_fields()" if "protect" in target else "public.notify_admin_on_technician_registration()"
        def_expected = f"CREATE TRIGGER {tname} BEFORE UPDATE ON public.{tbl} FOR EACH ROW EXECUTE FUNCTION trg_enforce_technician_part_request_fields()" if "protect" in target else f"CREATE TRIGGER {tname} AFTER INSERT ON public.{tbl} FOR EACH ROW EXECUTE FUNCTION notify_admin_on_technician_registration()"
        
        classifier_query = f"""WITH trigger_info AS (
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
    AND c.relname = '{tbl}'
    AND tg.tgname = '{tname}'
)
SELECT 
  COALESCE(tgname, '{tname}') AS trigger_name,
  COALESCE(table_name, '{tbl}') AS table_name,
  tgenabled,
  bound_fn,
  CASE 
    WHEN (SELECT count(*) FROM trigger_info) = 0 THEN 'ABSENT'
    WHEN (SELECT count(*) FROM trigger_info) > 1 THEN 'UNEXPECTED_STATE'
    WHEN tgisinternal = true THEN 'UNEXPECTED_STATE'
    WHEN tgenabled = 'O' 
         AND bound_fn = '{fn_expected}'::regprocedure
         AND trigger_def = '{def_expected}'
      THEN 'HEALTHY_ACTIVE'
    WHEN tgenabled != 'O' THEN 'DISABLED'
    WHEN bound_fn != '{fn_expected}'::regprocedure THEN 'WRONG_FUNCTION'
    WHEN trigger_def != '{def_expected}' THEN 'WRONG_DEFINITION'
    ELSE 'UNEXPECTED_STATE'
  END AS operational_state,
  CASE 
    WHEN (SELECT count(*) FROM trigger_info) = 0 THEN 'PROCEED: Trigger absent; creation may proceed after verifying prerequisites.'
    WHEN tgenabled = 'O' 
         AND bound_fn = '{fn_expected}'::regprocedure
         AND trigger_def = '{def_expected}'
      THEN 'SKIP: Trigger is healthy and active. DO NOT DROP. Skip both DROP and CREATE.'
    ELSE 'HALT: Anomalous trigger state detected. STOP AND INVESTIGATE immediately. Do not drop or recreate.'
  END AS action_required
FROM (SELECT 1) AS dummy
LEFT JOIN trigger_info ON true;"""

        req["state_inspection_query"] = classifier_query
        req["ordinary_recovery"] = f"""STRICT TRIGGER RECOVERY DECISION RULES:
Run the state classifier query without WHERE clause filtering.
1. If operational_state = 'ABSENT': Creation may proceed after verifying all function prerequisites. Safe to execute DROP (no-op) and CREATE.
2. If operational_state = 'HEALTHY_ACTIVE': Trigger is active, enabled ('O'), and guarding production data. SKIP BOTH DROP TRIGGER ({uid if 'DROP' in stype else 'preceding DROP'}) AND CREATE TRIGGER ENTIRELY! Never drop an active protection trigger.
3. If operational_state in ('DISABLED', 'WRONG_FUNCTION', 'WRONG_DEFINITION', 'UNEXPECTED_STATE'): STOP AND INVESTIGATE! Do not auto-skip, do not blindly drop, and do not recreate over an anomalous trigger."""

    # 4. Session safety note update
    if any(kw in stype for kw in ["INDEX", "REPLICA", "ADD_COLUMN", "POLICY", "TRIGGER"]):
        req["session_safety_note"] = "PostgreSQL lock timeouts are session-scoped. In Supabase CLI standalone remote queries ('supabase db query --remote'), each invocation establishes an independent session. Standalone DDL must prepend 'SET lock_timeout = ''3s'';' or be executed in an explicit 'BEGIN; SET LOCAL lock_timeout = ''3s''; ...; COMMIT;' transaction block."

    catalog_v9.append(req)

with open("scratch/full_request_catalog_v9.json", "w", encoding="utf-8") as f:
    json.dump(catalog_v9, f, indent=2)

print(f"Built full_request_catalog_v9.json with {len(catalog_v9)} requests.")
