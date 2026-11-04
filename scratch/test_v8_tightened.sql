
-- 1. Test effective ACL with acldefault on all 10 functions
SELECT 
  'confirm_service_centre_part_handoff' as fn,
  NOT EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) 
    WHERE grantee = 0 AND privilege_type = 'EXECUTE'
  ) AS public_revoked,
  NOT EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) 
    WHERE grantee = 'anon'::regrole AND privilege_type = 'EXECUTE'
  ) AS anon_revoked,
  EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) 
    WHERE grantee = 'authenticated'::regrole AND privilege_type = 'EXECUTE'
  ) AS auth_granted,
  EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) 
    WHERE grantee = 'service_role'::regrole AND privilege_type = 'EXECUTE'
  ) AS service_role_granted
FROM pg_proc p 
WHERE p.oid = 'public.confirm_service_centre_part_handoff(uuid)'::regprocedure;

-- 2. Test policy qual and with_check
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  (qual = '((current_user_role() = ''admin''::user_role) OR ((current_user_role() = ''technician''::user_role) AND (status = ''PENDING''::text) AND (EXISTS ( SELECT 1 FROM repair_requests rr WHERE ((rr.id = service_centre_part_requests.repair_request_id) AND (rr.technician_id = current_profile_id()))))))') AS qual_matches,
  (with_check = '((current_user_role() = ''admin''::user_role) OR ((current_user_role() = ''technician''::user_role) AND (status = ''PENDING''::text) AND (EXISTS ( SELECT 1 FROM repair_requests rr WHERE ((rr.id = service_centre_part_requests.repair_request_id) AND (rr.technician_id = current_profile_id()))))))') AS with_check_matches
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'service_centre_part_requests'
  AND policyname = 'Assigned technicians or admins can update part request ETA'
  AND cmd = 'UPDATE'
  AND permissive = 'PERMISSIVE'
  AND roles = '{authenticated}';

-- 3. Test trigger guard for REQ-33/34
SELECT 
  tg.tgname,
  c.relname AS table_name,
  n.nspname AS schema_name,
  tg.tgenabled,
  tg.tgfoid::regprocedure AS bound_function,
  (tg.tgfoid = 'public.trg_enforce_technician_part_request_fields()'::regprocedure) AS function_valid,
  pg_get_triggerdef(tg.oid) AS trigger_definition,
  NOT tg.tgisinternal AS is_not_internal
FROM pg_trigger tg
JOIN pg_class c ON c.oid = tg.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' 
  AND c.relname = 'service_centre_part_requests'
  AND tg.tgname = 'trg_protect_technician_part_request_fields';

-- 4. Test trigger guard for REQ-51/52
SELECT 
  tg.tgname,
  c.relname AS table_name,
  n.nspname AS schema_name,
  tg.tgenabled,
  tg.tgfoid::regprocedure AS bound_function,
  (tg.tgfoid = 'public.notify_admin_on_technician_registration()'::regprocedure) AS function_valid,
  pg_get_triggerdef(tg.oid) AS trigger_definition,
  NOT tg.tgisinternal AS is_not_internal
FROM pg_trigger tg
JOIN pg_class c ON c.oid = tg.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' 
  AND c.relname = 'technician_profiles'
  AND tg.tgname = 'trg_notify_admin_on_technician_registration';
