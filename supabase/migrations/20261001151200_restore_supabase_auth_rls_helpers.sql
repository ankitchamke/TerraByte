-- ==============================================================================
-- TerraByte — Restore Supabase Auth Compatibility to RLS Helpers & Policies
-- Migration: 20261001151200_restore_supabase_auth_rls_helpers.sql
-- Description: Ensures current_profile_id(), current_user_role(), and update
-- policies support native Supabase Auth (auth.uid() = auth_user_id) while
-- keeping clerk_user_id backward compatibility intact.
-- Adds admin update policy on technician_profiles for Service Centre verification.
-- ==============================================================================

-- 1. Helper function: current_profile_id()
CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS UUID AS $$
  SELECT id
  FROM public.profiles
  WHERE auth_user_id = auth.uid()
     OR (clerk_user_id IS NOT NULL AND clerk_user_id = auth.jwt()->>'sub')
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 2. Helper function: current_user_role()
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role AS $$
  SELECT role
  FROM public.profiles
  WHERE auth_user_id = auth.uid()
     OR (clerk_user_id IS NOT NULL AND clerk_user_id = auth.jwt()->>'sub')
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 3. Profiles UPDATE policy
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR (clerk_user_id IS NOT NULL AND clerk_user_id = auth.jwt()->>'sub')
  );

-- 4. Service Centre approval policy on technician_profiles
DROP POLICY IF EXISTS "Admins can update technician profiles" ON public.technician_profiles;
CREATE POLICY "Admins can update technician profiles"
  ON public.technician_profiles
  FOR UPDATE
  TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

GRANT EXECUTE ON FUNCTION public.current_profile_id() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO anon, authenticated, service_role;
