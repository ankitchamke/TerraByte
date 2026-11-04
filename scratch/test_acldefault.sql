-- Test a function without explicit GRANT/REVOKE (proacl will be NULL)
CREATE OR REPLACE FUNCTION public._test_acl_null() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;

SELECT 
  p.proname,
  p.proacl,
  (SELECT count(*) FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner)))) as eff_entries,
  (SELECT bool_or(grantee = 0) FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner)))) as public_has_eff,
  (SELECT bool_or(grantee = 0) FROM aclexplode(p.proacl)) as public_has_raw
FROM pg_proc p 
WHERE p.proname = '_test_acl_null';

-- Now revoke from public
REVOKE ALL ON FUNCTION public._test_acl_null() FROM PUBLIC;

SELECT 
  p.proname,
  p.proacl,
  (SELECT count(*) FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner)))) as eff_entries,
  (SELECT bool_or(grantee = 0) FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner)))) as public_has_eff
FROM pg_proc p 
WHERE p.proname = '_test_acl_null';

DROP FUNCTION public._test_acl_null();
