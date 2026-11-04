import subprocess

# The exact 10 functions with their expected configurations
functions_meta = [
    {
        "id": "public.confirm_service_centre_part_handoff(uuid)",
        "name": "confirm_service_centre_part_handoff",
        "search_path": "search_path=public, auth, pg_temp",
        "auth_granted": True
    },
    {
        "id": "public.adjust_service_centre_part_stock(uuid, integer, text)",
        "name": "adjust_service_centre_part_stock",
        "search_path": "search_path=public, auth, pg_temp",
        "auth_granted": True
    },
    {
        "id": "public.request_service_centre_part(uuid, uuid, integer, text)",
        "name": "request_service_centre_part",
        "search_path": "search_path=public, auth, pg_temp",
        "auth_granted": True
    },
    {
        "id": "public.receive_service_centre_stock(uuid, integer, text)",
        "name": "receive_service_centre_stock",
        "search_path": "search_path=public, auth, pg_temp",
        "auth_granted": True
    },
    {
        "id": "public.return_service_centre_part(uuid, uuid, integer, text)",
        "name": "return_service_centre_part",
        "search_path": "search_path=public, auth, pg_temp",
        "auth_granted": True
    },
    {
        "id": "public.trg_enforce_technician_part_request_fields()",
        "name": "trg_enforce_technician_part_request_fields",
        "search_path": "search_path=public, pg_temp",
        "auth_granted": False
    },
    {
        "id": "public.update_service_centre_part_request_eta(uuid, timestamp with time zone, text)",
        "name": "update_service_centre_part_request_eta",
        "search_path": "search_path=public, auth, pg_temp",
        "auth_granted": True
    },
    {
        "id": "public.create_quote_atomic(uuid, text, numeric, numeric, text, text, jsonb)",
        "name": "create_quote_atomic",
        "search_path": "search_path=public, pg_temp",
        "auth_granted": True
    },
    {
        "id": "public.revise_quote_atomic(uuid, uuid, text, numeric, numeric, text, text, text, jsonb)",
        "name": "revise_quote_atomic",
        "search_path": "search_path=public, pg_temp",
        "auth_granted": True
    },
    {
        "id": "public.notify_admin_on_technician_registration()",
        "name": "notify_admin_on_technician_registration",
        "search_path": "search_path=public, auth, pg_temp",
        "auth_granted": True
    }
]

sql_statements = []
for m in functions_meta:
    fn = m["id"]
    sp = m["search_path"]
    auth_check = "EXISTS" if m["auth_granted"] else "NOT EXISTS"
    
    sql = f"""
SELECT 
  '{fn}' AS func_id,
  p.proname,
  r.rolname AS owner,
  p.prosecdef AS is_secdef,
  (p.proconfig IS NOT NULL AND '{sp}' = ANY(p.proconfig)) AS search_path_ok,
  NOT EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) 
    WHERE grantee = 0 AND privilege_type = 'EXECUTE'
  ) AS public_revoked,
  NOT EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) 
    WHERE grantee = 'anon'::regrole AND privilege_type = 'EXECUTE'
  ) AS anon_revoked,
  {auth_check} (
    SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) 
    WHERE grantee = 'authenticated'::regrole AND privilege_type = 'EXECUTE'
  ) AS auth_check_ok,
  EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) 
    WHERE grantee = 'service_role'::regrole AND privilege_type = 'EXECUTE'
  ) AS service_role_granted
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_roles r ON r.oid = p.proowner
WHERE p.oid = '{fn}'::regprocedure;
"""
    sql_statements.append(sql)

full_sql = "\n".join(sql_statements)
with open("scratch/test_v7_funcs_all_pass.sql", "w", encoding="utf-8") as f:
    f.write(full_sql)

print(f"Generated verified test SQL for {len(functions_meta)} functions.")
