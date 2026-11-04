-- Test effective ACL audit on PostgreSQL 17.6

-- 1. Create a function with default ACL (NULL proacl)
CREATE OR REPLACE FUNCTION public._test_audit_acl() RETURNS integer LANGUAGE sql AS $$ SELECT 42 $$;

SELECT 
  'DEFAULT (NULL proacl)' AS state,
  p.proname,
  p.proacl,
  -- PUBLIC check using effective ACL
  NOT EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) 
    WHERE grantee = 0 AND privilege_type = 'EXECUTE'
  ) AS public_revoked,
  -- Raw aclexplode check (flawed)
  NOT EXISTS (
    SELECT 1 FROM aclexplode(p.proacl) 
    WHERE grantee = 0 AND privilege_type = 'EXECUTE'
  ) AS raw_public_revoked_FLAWED,
  -- anon check (explicit grant)
  NOT EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) 
    WHERE grantee = 'anon'::regrole AND privilege_type = 'EXECUTE'
  ) AS anon_not_explicit,
  -- authenticated check (explicit grant)
  EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) 
    WHERE grantee = 'authenticated'::regrole AND privilege_type = 'EXECUTE'
  ) AS auth_explicit
FROM pg_proc p WHERE p.proname = '_test_audit_acl';

-- 2. Revoke from PUBLIC, grant to authenticated and service_role
REVOKE ALL ON FUNCTION public._test_audit_acl() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._test_audit_acl() TO authenticated;
GRANT EXECUTE ON FUNCTION public._test_audit_acl() TO service_role;

SELECT 
  'POST-HARDENING' AS state,
  p.proname,
  p.proacl,
  -- PUBLIC check using effective ACL
  NOT EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) 
    WHERE grantee = 0 AND privilege_type = 'EXECUTE'
  ) AS public_revoked,
  -- anon check
  NOT EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) 
    WHERE grantee = 'anon'::regrole AND privilege_type = 'EXECUTE'
  ) AS anon_revoked,
  -- authenticated check
  EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) 
    WHERE grantee = 'authenticated'::regrole AND privilege_type = 'EXECUTE'
  ) AS auth_granted,
  -- service_role check
  EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) 
    WHERE grantee = 'service_role'::regrole AND privilege_type = 'EXECUTE'
  ) AS service_role_granted
FROM pg_proc p WHERE p.proname = '_test_audit_acl';

DROP FUNCTION public._test_audit_acl();
