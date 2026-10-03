-- ==============================================================================
-- TerraByte Phase 5.1 — Step 3D: Secure Account Deletion RPC
-- Migration: 20261003140000_phase5_1_account_deletion_rpc.sql
-- Description: Provides an atomic, secure PostgreSQL function for authenticated
-- users to permanently delete their account.
-- Features:
-- 1. Strictly operates on auth.uid() (no arbitrary user ID accepted).
-- 2. Protects pre-seeded Nagpur demo accounts (@terrabyte.demo and demo_code).
-- 3. Protects Service Centre Admin accounts against self-deletion.
-- 4. Blocks deletion if active repair requests/jobs are in progress.
-- 5. Handles RESTRICT foreign keys safely:
--    - If historical completed repairs/quotes exist: anonymizes PII and unlinks
--      auth credentials while preserving machinery service records.
--    - If no restrictive dependencies exist: performs clean hard delete.
-- 6. Permanently purges user from auth.users, revoking all credentials and sessions.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.delete_user_account()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID;
  v_profile RECORD;
  v_has_active_repairs BOOLEAN := false;
  v_has_restrictive_dependencies BOOLEAN := false;
BEGIN
  -- 1. Authorization: Strictly operate on caller's auth.uid()
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  -- 2. Resolve Profile Record
  SELECT id, role, email, demo_code, auth_user_id
  INTO v_profile
  FROM public.profiles
  WHERE auth_user_id = v_user_id OR id = v_user_id
  LIMIT 1;

  IF v_profile.id IS NULL THEN
    -- If no public profile row exists, clean up auth user directly
    DELETE FROM auth.users WHERE id = v_user_id;
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Account deleted successfully.'
    );
  END IF;

  -- 3. Demo Account Protection: Backend enforcement
  IF (v_profile.email IS NOT NULL AND v_profile.email ILIKE '%@terrabyte.demo')
     OR v_profile.demo_code IS NOT NULL THEN
    RAISE EXCEPTION 'Demo evaluation accounts cannot be deleted.'
      USING ERRCODE = '42501';
  END IF;

  -- 4. Service Centre Admin Protection
  IF v_profile.role = 'admin' OR v_profile.role = 'service_centre' THEN
    RAISE EXCEPTION 'Service Centre administrator accounts cannot be self-deleted.'
      USING ERRCODE = '42501';
  END IF;

  -- 5. Active Repair Check: Cannot delete with open workflow tickets
  IF v_profile.role = 'farmer' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.repair_requests
      WHERE farmer_id = v_profile.id
        AND status NOT IN ('COMPLETED'::public.repair_status, 'CANCELLED'::public.repair_status)
    ) INTO v_has_active_repairs;

    IF v_has_active_repairs THEN
      RAISE EXCEPTION 'Cannot delete your account while you have active repair requests in progress. Please complete or cancel all open repairs before deleting your account.'
        USING ERRCODE = 'P0001';
    END IF;

  ELSIF v_profile.role = 'technician' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.repair_requests
      WHERE technician_id = v_profile.id
        AND status NOT IN ('COMPLETED'::public.repair_status, 'CANCELLED'::public.repair_status)
    ) INTO v_has_active_repairs;

    IF v_has_active_repairs THEN
      RAISE EXCEPTION 'Cannot delete your account while you are assigned to active repair jobs. Please complete or resolve all open jobs before deleting your account.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 6. Check for Restrictive Dependencies
  -- Detect if profile is referenced by any ON DELETE RESTRICT constraints:
  -- - repair_requests.farmer_id
  -- - equipment referenced in repair_requests.equipment_id
  -- - quotes.technician_id
  -- - repair_notes.author_id
  SELECT (
    EXISTS (
      SELECT 1 FROM public.repair_requests WHERE farmer_id = v_profile.id
    ) OR EXISTS (
      SELECT 1 FROM public.equipment e
      JOIN public.repair_requests r ON r.equipment_id = e.id
      WHERE e.farmer_id = v_profile.id
    ) OR EXISTS (
      SELECT 1 FROM public.quotes WHERE technician_id = v_profile.id
    ) OR EXISTS (
      SELECT 1 FROM public.repair_notes WHERE author_id = v_profile.id
    )
  ) INTO v_has_restrictive_dependencies;

  -- 7. Execute Deletion or Anonymization
  IF v_has_restrictive_dependencies THEN
    -- A. Historical business records exist: Anonymize PII to protect permanent machinery service records
    DELETE FROM public.notifications WHERE recipient_user_id = v_profile.id;

    IF v_profile.role = 'technician' THEN
      UPDATE public.technician_profiles
      SET is_available = false,
          phone = NULL,
          updated_at = NOW()
      WHERE profile_id = v_profile.id;
    END IF;

    -- Anonymize public.profiles and unlink auth_user_id
    UPDATE public.profiles
    SET full_name = 'Former Member',
        phone = NULL,
        village = NULL,
        email = NULL,
        auth_user_id = NULL,
        updated_at = NOW()
    WHERE id = v_profile.id;

    -- Permanently purge credentials from auth.users
    DELETE FROM auth.users WHERE id = v_user_id;

  ELSE
    -- B. No restrictive dependencies exist: Hard delete all user data
    DELETE FROM public.notifications WHERE recipient_user_id = v_profile.id;

    IF v_profile.role = 'farmer' THEN
      DELETE FROM public.equipment WHERE farmer_id = v_profile.id;
    ELSIF v_profile.role = 'technician' THEN
      DELETE FROM public.technician_profiles WHERE profile_id = v_profile.id;
    END IF;

    DELETE FROM public.profiles WHERE id = v_profile.id;
    DELETE FROM auth.users WHERE id = v_user_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Account deleted successfully.'
  );
END;
$$;

-- Security Privileges: Revoke from public/anon, grant strictly to authenticated and service_role
REVOKE EXECUTE ON FUNCTION public.delete_user_account() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_user_account() FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_user_account() TO authenticated, service_role;
