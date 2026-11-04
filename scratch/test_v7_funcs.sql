
SELECT 
  'public.receive_service_centre_stock(uuid,integer,numeric,text,text)' AS func_id,
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
WHERE p.oid = 'public.receive_service_centre_stock(uuid,integer,numeric,text,text)'::regprocedure;


SELECT 
  'public.request_service_centre_part(uuid,uuid,integer,text)' AS func_id,
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
WHERE p.oid = 'public.request_service_centre_part(uuid,uuid,integer,text)'::regprocedure;


SELECT 
  'public.adjust_service_centre_stock(uuid,integer,text,text)' AS func_id,
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
WHERE p.oid = 'public.adjust_service_centre_stock(uuid,integer,text,text)'::regprocedure;


SELECT 
  'public.confirm_service_centre_part_handoff(uuid,text)' AS func_id,
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
WHERE p.oid = 'public.confirm_service_centre_part_handoff(uuid,text)'::regprocedure;


SELECT 
  'public.return_service_centre_part(uuid,integer,text)' AS func_id,
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
WHERE p.oid = 'public.return_service_centre_part(uuid,integer,text)'::regprocedure;


SELECT 
  'public.trg_enforce_technician_part_request_fields()' AS func_id,
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
WHERE p.oid = 'public.trg_enforce_technician_part_request_fields()'::regprocedure;


SELECT 
  'public.update_service_centre_part_request_eta(uuid,timestamp with time zone,text)' AS func_id,
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
WHERE p.oid = 'public.update_service_centre_part_request_eta(uuid,timestamp with time zone,text)'::regprocedure;


SELECT 
  'public.create_service_centre_quote(uuid,uuid,numeric,numeric,text,jsonb,boolean)' AS func_id,
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
WHERE p.oid = 'public.create_service_centre_quote(uuid,uuid,numeric,numeric,text,jsonb,boolean)'::regprocedure;


SELECT 
  'public.revise_service_centre_quote(uuid,numeric,numeric,text,jsonb,boolean)' AS func_id,
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
WHERE p.oid = 'public.revise_service_centre_quote(uuid,numeric,numeric,text,jsonb,boolean)'::regprocedure;


SELECT 
  'public.notify_admin_on_technician_registration()' AS func_id,
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
WHERE p.oid = 'public.notify_admin_on_technician_registration()'::regprocedure;
