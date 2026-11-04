import psycopg2

conn = psycopg2.connect('postgresql://postgres:postgres@127.0.0.1:5433/postgres')
cur = conn.cursor()

# Test a function without explicit GRANT/REVOKE (proacl will be NULL)
cur.execute("CREATE OR REPLACE FUNCTION public._test_acl_null() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;")
cur.execute("""
SELECT 
  p.proname,
  p.proacl,
  (SELECT count(*) FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner)))) as eff_entries,
  (SELECT bool_or(grantee = 0) FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner)))) as public_has_eff,
  (SELECT bool_or(grantee = 0) FROM aclexplode(p.proacl)) as public_has_raw
FROM pg_proc p 
WHERE p.proname = '_test_acl_null';
""")
row = cur.fetchone()
print("_test_acl_null with NULL proacl:")
print("  proname:", row[0])
print("  proacl:", row[1])
print("  eff_entries:", row[2])
print("  public_has_eff:", row[3])
print("  public_has_raw (raw aclexplode):", row[4])

# Now revoke from public
cur.execute("REVOKE ALL ON FUNCTION public._test_acl_null() FROM PUBLIC;")
cur.execute("""
SELECT 
  p.proname,
  p.proacl,
  (SELECT count(*) FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner)))) as eff_entries,
  (SELECT bool_or(grantee = 0) FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner)))) as public_has_eff
FROM pg_proc p 
WHERE p.proname = '_test_acl_null';
""")
row = cur.fetchone()
print("after REVOKE ALL FROM PUBLIC:")
print("  proname:", row[0])
print("  proacl:", row[1])
print("  eff_entries:", row[2])
print("  public_has_eff:", row[3])

# Clean up
cur.execute("DROP FUNCTION public._test_acl_null();")
conn.commit()
conn.close()
