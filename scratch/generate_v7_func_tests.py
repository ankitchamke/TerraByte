import subprocess
import json

# List of 10 target functions with their exact regprocedure identities
functions = [
    "public.receive_service_centre_stock(uuid,integer,numeric,text,text)",
    "public.request_service_centre_part(uuid,uuid,integer,text)",
    "public.adjust_service_centre_stock(uuid,integer,text,text)",
    "public.confirm_service_centre_part_handoff(uuid,text)",
    "public.return_service_centre_part(uuid,integer,text)",
    "public.trg_enforce_technician_part_request_fields()",
    "public.update_service_centre_part_request_eta(uuid,timestamp with time zone,text)",
    "public.create_service_centre_quote(uuid,uuid,numeric,numeric,text,jsonb,boolean)",
    "public.revise_service_centre_quote(uuid,numeric,numeric,text,jsonb,boolean)",
    "public.notify_admin_on_technician_registration()"
]

sql_statements = []
for fn in functions:
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
  -- Effective authenticated check (trigger functions are NOT granted to authenticated)
  EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) 
    WHERE grantee = 'authenticated'::regrole AND privilege_type = 'EXECUTE'
  ) AS auth_granted,
  -- Effective service_role check
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
with open("scratch/test_v7_funcs.sql", "w", encoding="utf-8") as f:
    f.write(full_sql)

print(f"Generated test SQL for {len(functions)} functions.")
