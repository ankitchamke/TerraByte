-- ==============================================================================
-- TerraByte — Set Deterministic Password for Demo Nagpur Accounts
-- Migration: 20261001153500_set_demo_users_password.sql
-- Description: Sets password to 'TerraByte@2026' for demo Nagpur accounts
-- and ensures email_confirmed_at is populated for quick demo login.
-- ==============================================================================

UPDATE auth.users
SET encrypted_password = crypt('TerraByte@2026', gen_salt('bf', 10)),
    email_confirmed_at = COALESCE(email_confirmed_at, now())
WHERE email IN (
  'farmer.nagpur@terrabyte.demo',
  'tech.nagpur@terrabyte.demo',
  'admin.nagpur@terrabyte.demo',
  'farmer2.nagpur@terrabyte.demo',
  'farmer3.nagpur@terrabyte.demo'
);
