import json
import re

# Load base requests from v6 catalog
with open("scratch/full_request_catalog_v6.json", "r", encoding="utf-8") as f:
    requests = json.load(f)

# Map function names to their exact PostgreSQL identity signatures
func_identities = {
    "confirm_service_centre_part_handoff": "public.confirm_service_centre_part_handoff(uuid)",
    "adjust_service_centre_part_stock": "public.adjust_service_centre_part_stock(uuid, integer, text)",
    "request_service_centre_part": "public.request_service_centre_part(uuid, uuid, integer, text)",
    "receive_service_centre_stock": "public.receive_service_centre_stock(uuid, integer, text)",
    "return_service_centre_part": "public.return_service_centre_part(uuid, uuid, integer, text)",
    "trg_enforce_technician_part_request_fields": "public.trg_enforce_technician_part_request_fields()",
    "update_service_centre_part_request_eta": "public.update_service_centre_part_request_eta(uuid, timestamp with time zone, text)",
    "create_quote_atomic": "public.create_quote_atomic(uuid, text, numeric, numeric, text, text, jsonb)",
    "revise_quote_atomic": "public.revise_quote_atomic(uuid, uuid, text, numeric, numeric, text, text, text, jsonb)",
    "notify_admin_on_technician_registration": "public.notify_admin_on_technician_registration()"
}

catalog_v8 = []

for r in requests:
    uid = r["unit_id"]
    stype = r["type"]
    target = r["target_object"]
    sql_text = r["text"].strip()
    
    # Identify which function is targeted if applicable
    matched_fn = None
    for fname, fident in func_identities.items():
        if fname in target or fname in sql_text:
            matched_fn = (fname, fident)
            break

    # Determine exact verification query and recovery protocol
    vquery = ""
    expected = ""
    recovery = ""
    state_insp = ""

    # Lock timeout session safety note
    lock_mode = r.get("lock_mode", "AccessShareLock")
    is_ddl = any(kw in stype for kw in ["INDEX", "REPLICA", "ADD_COLUMN", "POLICY", "TRIGGER"])
    if is_ddl:
        session_note = "When executed as a standalone remote query, must prepend 'SET lock_timeout = ''3s'';' to prevent lock queueing behind active read transactions."
    else:
        session_note = "Locks metadata catalog rows only. Does not block application table traffic."

    if stype == "FUNCTION_DEFINITION":
        fname, fident = matched_fn
        sp = "public, auth, pg_temp" if fname in ["confirm_service_centre_part_handoff", "adjust_service_centre_part_stock", "request_service_centre_part", "receive_service_centre_stock", "return_service_centre_part", "update_service_centre_part_request_eta", "notify_admin_on_technician_registration"] else "public, pg_temp"
        auth_cond = "NOT EXISTS" if fname == "trg_enforce_technician_part_request_fields" else "EXISTS"
        vquery = f"""SELECT 
  p.proname,
  p.proowner::regrole AS owner,
  p.prosecdef,
  (p.proconfig IS NOT NULL AND 'search_path={sp}' = ANY(p.proconfig)) AS search_path_ok,
  NOT EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) 
    WHERE grantee = 0 AND privilege_type = 'EXECUTE'
  ) AS public_revoked,
  NOT EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) 
    WHERE grantee = 'anon'::regrole AND privilege_type = 'EXECUTE'
  ) AS anon_revoked,
  {auth_cond} (
    SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) 
    WHERE grantee = 'authenticated'::regrole AND privilege_type = 'EXECUTE'
  ) AS auth_check_ok,
  EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) 
    WHERE grantee = 'service_role'::regrole AND privilege_type = 'EXECUTE'
  ) AS service_role_granted
FROM pg_proc p
WHERE p.oid = '{fident}'::regprocedure;"""
        expected = "1 row: proname, owner=postgres, prosecdef=t, search_path_ok=t, public_revoked=t, anon_revoked=t, auth_check_ok=t, service_role_granted=t"
        recovery = "Re-execute function definition statement. CREATE OR REPLACE FUNCTION is atomic and idempotent in PostgreSQL."
        state_insp = f"SELECT count(*) FROM pg_proc WHERE p.oid = '{fident}'::regprocedure;"

    elif stype == "PERMISSION_REVOKE":
        fname, fident = matched_fn
        if "PUBLIC" in target or "PUBLIC" in sql_text:
            vquery = f"""SELECT NOT EXISTS (
  SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) 
  WHERE grantee = 0 AND privilege_type = 'EXECUTE'
) AS public_revoked
FROM pg_proc p 
WHERE p.oid = '{fident}'::regprocedure;"""
            expected = "1 row: public_revoked = t"
        elif "anon" in target or "anon" in sql_text:
            vquery = f"""SELECT NOT EXISTS (
  SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) 
  WHERE grantee = 'anon'::regrole AND privilege_type = 'EXECUTE'
) AS anon_revoked
FROM pg_proc p 
WHERE p.oid = '{fident}'::regprocedure;"""
            expected = "1 row: anon_revoked = t"
        elif "authenticated" in target or "authenticated" in sql_text:
            vquery = f"""SELECT NOT EXISTS (
  SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) 
  WHERE grantee = 'authenticated'::regrole AND privilege_type = 'EXECUTE'
) AS auth_revoked
FROM pg_proc p 
WHERE p.oid = '{fident}'::regprocedure;"""
            expected = "1 row: auth_revoked = t"
        recovery = "Re-execute REVOKE statement. Completely idempotent."
        state_insp = "-- Statement is inherently idempotent. Safe to rerun directly."

    elif stype == "PERMISSION_GRANT":
        fname, fident = matched_fn
        vquery = f"""SELECT 
  EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) 
    WHERE grantee = 'authenticated'::regrole AND privilege_type = 'EXECUTE'
  ) AS auth_granted,
  EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) 
    WHERE grantee = 'service_role'::regrole AND privilege_type = 'EXECUTE'
  ) AS service_role_granted
FROM pg_proc p 
WHERE p.oid = '{fident}'::regprocedure;"""
        expected = "1 row: auth_granted = t, service_role_granted = t"
        recovery = "Re-execute GRANT statement. Completely idempotent."
        state_insp = "-- Statement is inherently idempotent. Safe to rerun directly."

    elif stype == "CREATE_POLICY":
        vquery = """SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check,
  (regexp_replace(qual, '\\s+', ' ', 'g') = '((current_user_role() = ''admin''::user_role) OR ((current_user_role() = ''technician''::user_role) AND (status = ''PENDING''::text) AND (EXISTS ( SELECT 1 FROM repair_requests rr WHERE ((rr.id = service_centre_part_requests.repair_request_id) AND (rr.technician_id = current_profile_id()))))))') AS qual_matches,
  (qual = with_check) AS qual_equals_with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'service_centre_part_requests'
  AND policyname = 'Assigned technicians or admins can update part request ETA'
  AND cmd = 'UPDATE'
  AND permissive = 'PERMISSIVE'
  AND roles = '{authenticated}';"""
        expected = "1 row: schemaname=public, tablename=service_centre_part_requests, policyname=Assigned technicians..., cmd=UPDATE, roles={authenticated}, qual_matches=t, qual_equals_with_check=t"
        recovery = "Inspect pg_policies. If policy exists and qual_matches=t, mark SUCCESS. If policy exists with wrong definition, execute DROP POLICY IF EXISTS before re-creating. If absent, re-execute CREATE POLICY."
        state_insp = "SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'service_centre_part_requests' AND policyname = 'Assigned technicians or admins can update part request ETA';"

    elif stype == "DROP_POLICY":
        pname = re.search(r'DROP\s+POLICY\s+IF\s+EXISTS\s+"([^"]+)"', sql_text).group(1)
        vquery = f"SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'service_centre_part_requests' AND policyname = '{pname}';"
        expected = "1 row: count = 0"
        recovery = "Re-execute DROP POLICY IF EXISTS. Inherently idempotent."
        state_insp = "-- Statement is inherently idempotent. Safe to rerun directly."

    elif stype == "DROP_TRIGGER":
        tname = "trg_protect_technician_part_request_fields" if "protect" in target else "trg_notify_admin_on_technician_registration"
        tbl = "service_centre_part_requests" if "protect" in target else "technician_profiles"
        fn_expected = "public.trg_enforce_technician_part_request_fields()" if "protect" in target else "public.notify_admin_on_technician_registration()"
        vquery = f"""SELECT 
  tg.tgname,
  c.relname AS table_name,
  n.nspname AS schema_name,
  tg.tgenabled,
  tg.tgfoid::regprocedure AS bound_function,
  (tg.tgfoid = '{fn_expected}'::regprocedure) AS function_valid,
  pg_get_triggerdef(tg.oid) AS trigger_definition
FROM pg_trigger tg
JOIN pg_class c ON c.oid = tg.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' 
  AND c.relname = '{tbl}'
  AND tg.tgname = '{tname}';"""
        expected = "If prior to CREATE TRIGGER: 0 rows (trigger dropped). If post-deployment recovery: 1 row healthy."
        recovery = f"""CRITICAL SAFEGUARD: Before running or retrying {uid}, inspect pg_trigger using the state inspection query.
- If 1 row is returned with tgenabled = 'O' and function_valid = true: The target trigger is ALREADY ACTIVE and protecting data. SKIP {uid} AND SKIP THE SUBSEQUENT CREATE TRIGGER ENTIRELY! Never blindly drop an active protection trigger.
- If 1 row is returned with tgenabled != 'O' or function_valid = false: STOP AND INVESTIGATE anomalous trigger state.
- If 0 rows: Trigger is absent. Safe to proceed to CREATE TRIGGER."""
        state_insp = vquery

    elif stype == "CREATE_TRIGGER":
        tname = "trg_protect_technician_part_request_fields" if "protect" in target else "trg_notify_admin_on_technician_registration"
        tbl = "service_centre_part_requests" if "protect" in target else "technician_profiles"
        fn_expected = "public.trg_enforce_technician_part_request_fields()" if "protect" in target else "public.notify_admin_on_technician_registration()"
        vquery = f"""SELECT 
  tg.tgname,
  c.relname AS table_name,
  n.nspname AS schema_name,
  tg.tgenabled,
  tg.tgfoid::regprocedure AS bound_function,
  (tg.tgfoid = '{fn_expected}'::regprocedure) AS function_valid,
  pg_get_triggerdef(tg.oid) AS trigger_definition,
  NOT tg.tgisinternal AS is_not_internal
FROM pg_trigger tg
JOIN pg_class c ON c.oid = tg.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' 
  AND c.relname = '{tbl}'
  AND tg.tgname = '{tname}'
  AND tg.tgenabled = 'O'
  AND tg.tgfoid = '{fn_expected}'::regprocedure
  AND NOT tg.tgisinternal;"""
        expected = f"1 row: tgname={tname}, table_name={tbl}, schema_name=public, tgenabled=O, function_valid=t, is_not_internal=t"
        recovery = f"""Inspect pg_trigger.
- If 1 row returned healthy: Trigger already committed during client timeout; mark SUCCESS and proceed.
- If 0 rows: Trigger absent. Re-execute {uid} directly.
- If trigger exists in disabled state or bound to wrong function: STOP AND INVESTIGATE."""
        state_insp = vquery

    elif stype == "INDEX_CREATION":
        m = re.search(r"INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)", sql_text)
        iname = m.group(1) if m else "idx"
        vquery = f"""SELECT 
  c.relname AS index_name,
  t.relname AS table_name,
  i.indisvalid,
  i.indisready,
  pg_get_indexdef(i.indexrelid) AS index_def
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_class t ON t.oid = i.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = '{iname}'
  AND i.indisvalid = true;"""
        expected = f"1 row: index_name={iname}, indisvalid=t, indisready=t"
        recovery = f"Inspect pg_index. If count=1 and indisvalid=t: mark SUCCESS. If count=1 and indisvalid=f: partial build failure; execute 'DROP INDEX public.{iname};' before retrying. If count=0: safe to re-execute CREATE INDEX IF NOT EXISTS directly."
        state_insp = f"SELECT c.relname, i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = '{iname}';"

    elif stype == "ALTER_REPLICA_IDENTITY":
        tbl = "quotes" if "quotes" in target else "service_centre_part_requests"
        vquery = f"""SELECT c.relname, c.relreplident 
FROM pg_class c 
JOIN pg_namespace n ON n.oid = c.relnamespace 
WHERE n.nspname = 'public' AND c.relname = '{tbl}' AND c.relreplident = 'f';"""
        expected = f"1 row: relname={tbl}, relreplident=f (FULL)"
        recovery = "Re-execute ALTER TABLE ... REPLICA IDENTITY FULL. Idempotent catalog metadata update."
        state_insp = f"SELECT relreplident FROM pg_class WHERE relname = '{tbl}';"

    elif stype == "ALTER_ADD_COLUMNS":
        vquery = """SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'service_centre_part_requests'
  AND column_name IN ('estimated_arrival_at', 'eta_updated_by', 'eta_updated_at')
ORDER BY column_name;"""
        expected = "3 rows: estimated_arrival_at (timestamptz), eta_updated_at (timestamptz), eta_updated_by (uuid)"
        recovery = "Re-execute ALTER TABLE ... ADD COLUMN IF NOT EXISTS. Fully idempotent."
        state_insp = "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'service_centre_part_requests' AND column_name IN ('estimated_arrival_at', 'eta_updated_by', 'eta_updated_at');"

    elif stype == "DO_BLOCK":
        vquery = """SELECT pubname, schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND schemaname = 'public'
  AND tablename = 'service_centre_part_requests';"""
        expected = "1 row: pubname=supabase_realtime, schemaname=public, tablename=service_centre_part_requests"
        recovery = "Re-execute DO block. Conditional IF NOT EXISTS logic guarantees safe idempotency."
        state_insp = vquery

    req_v8 = dict(r)
    req_v8["strengthened_vquery"] = vquery
    req_v8["expected_output"] = expected
    req_v8["ordinary_recovery"] = recovery
    req_v8["state_inspection_query"] = state_insp
    req_v8["session_safety_note"] = session_note
    catalog_v8.append(req_v8)

with open("scratch/full_request_catalog_v8.json", "w", encoding="utf-8") as f:
    json.dump(catalog_v8, f, indent=2)

print(f"Built full_request_catalog_v8.json with {len(catalog_v8)} requests.")
