import subprocess

# The exact 10 functions across migrations A, B, and C
functions = [
    "public.confirm_service_centre_part_handoff(uuid)",
    "public.adjust_service_centre_part_stock(uuid, integer, text)",
    "public.request_service_centre_part(uuid, uuid, integer, text)",
    "public.receive_service_centre_stock(uuid, integer, text)",
    "public.return_service_centre_part(uuid, uuid, integer, text)",
    "public.trg_enforce_technician_part_request_fields()",
    "public.update_service_centre_part_request_eta(uuid, timestamp with time zone, text)",
    "public.create_quote_atomic(uuid, text, numeric, numeric, text, text, jsonb)",
    "public.revise_quote_atomic(uuid, uuid, text, numeric, numeric, text, text, text, jsonb)",
    "public.notify_admin_on_technician_registration()"
]

sql_statements = []
for fn in functions:
    # Trigger functions (trg_enforce..., notify_admin...) are NOT granted to authenticated
    is_trigger = "trg_" in fn or "notify_admin" in fn
    auth_check = "NOT EXISTS" if is_trigger else "EXISTS"
    
    sql = f"""
SELECT 
  '{fn}' AS func_id,
  p.proname,
  r.rolname AS owner,
  p.prosecdef AS is_secdef,
  (p.proconfig IS NOT NULL AND 'search_path=public, pg_temp' = ANY(p.proconfig)) AS search_path_ok,
  -- Effective PUBLIC revoke check using acldefault
  NOT EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) 
    WHERE grantee = 0 AND privilege_type = 'EXECUTE'
  ) AS public_revoked,
  -- Effective anon revoke check
  NOT EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) 
    WHERE grantee = 'anon'::regrole AND privilege_type = 'EXECUTE'
  ) AS anon_revoked,
  -- Effective authenticated check ({auth_check} expected)
  {auth_check} (
    SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) 
    WHERE grantee = 'authenticated'::regrole AND privilege_type = 'EXECUTE'
  ) AS auth_check_passed,
  -- Effective service_role check (all granted)
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
with open("scratch/test_v7_funcs_exact.sql", "w", encoding="utf-8") as f:
    f.write(full_sql)

print(f"Generated exact test SQL for {len(functions)} functions.")
