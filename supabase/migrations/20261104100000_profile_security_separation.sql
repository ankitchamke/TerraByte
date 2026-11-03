-- ==============================================================================
-- TerraByte — Phase 11 Three-Tier Profile Security Architecture
-- Migration: 20261104100000_profile_security_separation.sql
-- Description: Physically isolates profile attribution, private contact details,
-- and authentication secrets into dedicated tables.
-- 
-- Architecture:
-- 1. public.profiles: Identity & attribution (id, role, full_name, created_at, updated_at).
--    Preserves profiles.id as the universal foreign key target for all 16 existing foreign keys.
--    Old columns (phone, village, email, auth_user_id, demo_code, clerk_user_id) are
--    retained during the transition period with dual-write synchronization.
-- 2. public.profile_contacts: Private contact details (profile_id PK/FK, phone, village, updated_at).
--    Restricted to self, admin, and active assigned repair counterpart.
-- 3. public.profile_auth_secrets: Credential & identifier secrets (profile_id PK/FK,
--    auth_user_id, email, demo_code, clerk_user_id, created_at, updated_at).
--    Sealed from admins; readable ONLY by the authenticated owner (auth_user_id = auth.uid()).
-- 4. app_security schema: Internal helper functions (can_view_profile) excluded from PostgREST.
-- 5. public.get_session_profile(): Parameterless session hydration RPC.
-- 6. public.admin_provision_staff(): Pre-provisions staff stubs with auth_user_id = NULL.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. SCHEMA ISOLATION: Create private app_security schema
-- ------------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app_security;

REVOKE ALL ON SCHEMA app_security FROM PUBLIC;
REVOKE ALL ON SCHEMA app_security FROM anon;
GRANT USAGE ON SCHEMA app_security TO authenticated;
GRANT USAGE ON SCHEMA app_security TO service_role;

-- ------------------------------------------------------------------------------
-- 2. CREATE TABLE: public.profile_contacts
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profile_contacts (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  phone text,
  village text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profile_contacts_profile_id_idx ON public.profile_contacts (profile_id);

-- ------------------------------------------------------------------------------
-- 3. CREATE TABLE: public.profile_auth_secrets
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profile_auth_secrets (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  auth_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  demo_code text UNIQUE,
  clerk_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive unique email index and unique auth_user_id index
CREATE UNIQUE INDEX IF NOT EXISTS profile_auth_secrets_lower_email_idx
  ON public.profile_auth_secrets (lower(email))
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profile_auth_secrets_auth_user_id_idx
  ON public.profile_auth_secrets (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 4. BACKFILL EXISTING PROFILES DATA (Idempotent)
-- ------------------------------------------------------------------------------
INSERT INTO public.profile_contacts (profile_id, phone, village, updated_at)
SELECT id, phone, village, updated_at
FROM public.profiles
ON CONFLICT (profile_id) DO UPDATE SET
  phone = COALESCE(EXCLUDED.phone, public.profile_contacts.phone),
  village = COALESCE(EXCLUDED.village, public.profile_contacts.village),
  updated_at = now();

INSERT INTO public.profile_auth_secrets (profile_id, auth_user_id, email, demo_code, clerk_user_id, created_at, updated_at)
SELECT id, auth_user_id, email, demo_code, clerk_user_id, created_at, updated_at
FROM public.profiles
ON CONFLICT (profile_id) DO UPDATE SET
  auth_user_id = COALESCE(EXCLUDED.auth_user_id, public.profile_auth_secrets.auth_user_id),
  email = COALESCE(EXCLUDED.email, public.profile_auth_secrets.email),
  demo_code = COALESCE(EXCLUDED.demo_code, public.profile_auth_secrets.demo_code),
  clerk_user_id = COALESCE(EXCLUDED.clerk_user_id, public.profile_auth_secrets.clerk_user_id),
  updated_at = now();

-- ------------------------------------------------------------------------------
-- 5. UPDATED IDENTITY & ATTRIBUTION HELPERS (Fail-Closed, Safe search_path)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pid uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  -- 1. Check profile_auth_secrets
  SELECT pas.profile_id INTO v_pid
  FROM public.profile_auth_secrets pas
  WHERE pas.auth_user_id = auth.uid()
  LIMIT 1;

  IF v_pid IS NOT NULL THEN
    RETURN v_pid;
  END IF;

  -- 2. Fallback check on profiles for backward compatibility
  SELECT p.id INTO v_pid
  FROM public.profiles p
  WHERE p.auth_user_id = auth.uid()
     OR (p.clerk_user_id IS NOT NULL AND p.clerk_user_id = auth.jwt()->>'sub')
  LIMIT 1;

  RETURN v_pid;
END;
$$;

REVOKE ALL ON FUNCTION public.current_profile_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_profile_id() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_profile_id() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role public.user_role;
  v_pid uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  v_pid := public.current_profile_id();
  IF v_pid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT p.role INTO v_role
  FROM public.profiles p
  WHERE p.id = v_pid;

  RETURN v_role;
END;
$$;

REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_user_role() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 6. PRIVATE AUTHORIZATION HELPER: app_security.can_view_profile
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_security.can_view_profile(target_profile_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_pid uuid;
  v_caller_role public.user_role;
  v_target_role public.user_role;
BEGIN
  -- Fail-closed on missing authentication or missing target
  IF auth.uid() IS NULL OR target_profile_id IS NULL THEN
    RETURN FALSE;
  END IF;

  v_caller_pid := public.current_profile_id();
  IF v_caller_pid IS NULL THEN
    RETURN FALSE;
  END IF;

  -- 1. Self profile access
  IF v_caller_pid = target_profile_id THEN
    RETURN TRUE;
  END IF;

  -- 2. Admin access
  v_caller_role := public.current_user_role();
  IF v_caller_role = 'admin'::public.user_role THEN
    RETURN TRUE;
  END IF;

  -- 3. Resolve target profile role
  SELECT p.role INTO v_target_role
  FROM public.profiles p
  WHERE p.id = target_profile_id;

  IF v_target_role IS NULL THEN
    RETURN FALSE;
  END IF;

  -- 4. Technicians and Admin profiles are public attribution records for authenticated users
  IF v_target_role IN ('technician'::public.user_role, 'admin'::public.user_role) THEN
    RETURN TRUE;
  END IF;

  -- 5. Farmer profiles: only visible to assigned technician on active/accepted jobs or note author
  IF v_target_role = 'farmer'::public.user_role THEN
    RETURN EXISTS (
      SELECT 1 FROM public.repair_requests rr
      WHERE rr.farmer_id = target_profile_id
        AND rr.technician_id = v_caller_pid
        AND (rr.declined_by IS NULL OR NOT (v_caller_pid = ANY(rr.declined_by)))
    ) OR EXISTS (
      SELECT 1 FROM public.repair_notes rn
      JOIN public.repair_requests rr ON rr.id = rn.repair_request_id
      WHERE rr.farmer_id = target_profile_id
        AND (rr.technician_id = v_caller_pid OR rn.author_id = v_caller_pid)
    );
  END IF;

  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION app_security.can_view_profile(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_security.can_view_profile(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION app_security.can_view_profile(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 7. PARAMETERLESS SESSION HYDRATION RPC: public.get_session_profile()
-- Minimizes data: returns only identity and contact fields needed by the client.
-- Excludes auth_user_id, clerk_user_id, demo_code, and email.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_session_profile()
RETURNS TABLE (
  id uuid,
  role public.user_role,
  full_name text,
  phone text,
  village text,
  is_verified boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
  v_pid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  -- Resolve profile_id from profile_auth_secrets with fallback to profiles
  SELECT pas.profile_id INTO v_pid
  FROM public.profile_auth_secrets pas
  WHERE pas.auth_user_id = v_uid
  LIMIT 1;

  IF v_pid IS NULL THEN
    SELECT p.id INTO v_pid
    FROM public.profiles p
    WHERE p.auth_user_id = v_uid OR p.id = v_uid
    LIMIT 1;
  END IF;

  IF v_pid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.role,
    p.full_name,
    COALESCE(pc.phone, p.phone),
    COALESCE(pc.village, p.village),
    CASE
      WHEN p.role = 'technician'::public.user_role THEN
        COALESCE(
          (SELECT tp.is_verified FROM public.technician_profiles tp WHERE tp.profile_id = p.id OR tp.id = p.id LIMIT 1),
          false
        )
      ELSE true
    END AS is_verified,
    p.created_at,
    p.updated_at
  FROM public.profiles p
  LEFT JOIN public.profile_contacts pc ON pc.profile_id = p.id
  WHERE p.id = v_pid;
END;
$$;

REVOKE ALL ON FUNCTION public.get_session_profile() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_session_profile() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_session_profile() TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 8. STAFF PRE-PROVISIONING RPC: public.admin_provision_staff
-- Strictly restricted to technician provisioning. Pre-provisioned technicians
-- start UNVERIFIED (is_verified = false) pending formal admin verification.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_provision_staff(
  p_full_name text,
  p_email text,
  p_role public.user_role,
  p_phone text DEFAULT NULL,
  p_village text DEFAULT NULL,
  p_workshop_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_role public.user_role;
  v_new_profile_id uuid;
  v_norm_email text;
BEGIN
  -- 1. Authorization: Only admin can provision staff (fail-closed on NULL)
  v_caller_role := public.current_user_role();
  IF v_caller_role IS NULL OR v_caller_role != 'admin'::public.user_role THEN
    RAISE EXCEPTION 'Unauthorized: Only Service Centre administrators can provision staff.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Validate role: Strictly restricted to technician provisioning
  IF p_role IS NULL OR p_role != 'technician'::public.user_role THEN
    RAISE EXCEPTION 'Invalid role: Staff provisioning is restricted exclusively to technician accounts.'
      USING ERRCODE = '22023';
  END IF;

  -- 3. Validate name and email
  IF p_full_name IS NULL OR TRIM(p_full_name) = '' THEN
    RAISE EXCEPTION 'Full name is required.' USING ERRCODE = '22023';
  END IF;

  IF p_email IS NULL OR TRIM(p_email) = '' OR TRIM(p_email) NOT LIKE '%_@__%.__%' THEN
    RAISE EXCEPTION 'Invalid email address.' USING ERRCODE = '22023';
  END IF;

  v_norm_email := LOWER(TRIM(p_email));

  -- 4. Check uniqueness against profile_auth_secrets and profiles
  IF EXISTS (SELECT 1 FROM public.profile_auth_secrets WHERE LOWER(email) = v_norm_email)
     OR EXISTS (SELECT 1 FROM public.profiles WHERE LOWER(email) = v_norm_email) THEN
    RAISE EXCEPTION 'An account with this email address already exists.' USING ERRCODE = '23505';
  END IF;

  -- 5. Insert stub into public.profiles
  v_new_profile_id := gen_random_uuid();

  INSERT INTO public.profiles (
    id,
    role,
    full_name,
    email,
    phone,
    village,
    created_at,
    updated_at
  ) VALUES (
    v_new_profile_id,
    p_role,
    TRIM(p_full_name),
    v_norm_email,
    NULLIF(TRIM(p_phone), ''),
    NULLIF(TRIM(p_village), ''),
    now(),
    now()
  );

  -- 6. Insert into public.profile_contacts
  INSERT INTO public.profile_contacts (
    profile_id,
    phone,
    village,
    updated_at
  ) VALUES (
    v_new_profile_id,
    NULLIF(TRIM(p_phone), ''),
    NULLIF(TRIM(p_village), ''),
    now()
  );

  -- 7. Insert into public.profile_auth_secrets with auth_user_id = NULL
  INSERT INTO public.profile_auth_secrets (
    profile_id,
    auth_user_id,
    email,
    created_at,
    updated_at
  ) VALUES (
    v_new_profile_id,
    NULL,
    v_norm_email,
    now(),
    now()
  );

  -- 8. Create UNVERIFIED technician_profiles record (must undergo formal review)
  INSERT INTO public.technician_profiles (
    profile_id,
    workshop_name,
    is_verified,
    is_available,
    phone,
    created_at,
    updated_at
  ) VALUES (
    v_new_profile_id,
    COALESCE(NULLIF(TRIM(p_workshop_name), ''), TRIM(p_full_name) || ' Workshop'),
    false, -- Pre-provisioned technicians must start unverified
    true,
    NULLIF(TRIM(p_phone), ''),
    now(),
    now()
  );

  RETURN v_new_profile_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_provision_staff(text, text, public.user_role, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_provision_staff(text, text, public.user_role, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_provision_staff(text, text, public.user_role, text, text, text) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 9. PREVENT PROFILE ROLE ESCALATION TRIGGER: public.protect_profile_role()
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF public.current_user_role() != 'admin'::public.user_role THEN
      RAISE EXCEPTION 'Unauthorized: Profile role cannot be modified except by an administrator.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_protect_profile_role ON public.profiles;
CREATE TRIGGER tr_protect_profile_role
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_role();

-- ------------------------------------------------------------------------------
-- 10. UPDATED AUTH USER TRIGGER: public.handle_new_user()
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_full_name text;
  v_email text;
  v_phone text;
  v_village text;
  v_role public.user_role;
  v_workshop text;
  v_new_profile_id uuid;
  v_matched_profile_id uuid;
BEGIN
  v_email := NULLIF(LOWER(TRIM(NEW.email)), '');
  v_phone := COALESCE(NEW.phone, NULLIF(TRIM(NEW.raw_user_meta_data->>'phone'), ''));
  v_village := NULLIF(TRIM(NEW.raw_user_meta_data->>'village'), '');
  v_workshop := NULLIF(TRIM(NEW.raw_user_meta_data->>'workshop'), '');

  v_full_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''),
    NULLIF(SPLIT_PART(v_email, '@', 1), ''),
    v_phone,
    'TerraByte User'
  );

  -- Self-registration: only 'farmer' or 'technician' allowed
  IF LOWER(COALESCE(NEW.raw_user_meta_data->>'role', '')) = 'technician' THEN
    v_role := 'technician'::public.user_role;
  ELSE
    v_role := 'farmer'::public.user_role;
  END IF;

  -- 1. Check for unlinked pre-provisioned account matching this email
  IF v_email IS NOT NULL THEN
    SELECT pas.profile_id INTO v_matched_profile_id
    FROM public.profile_auth_secrets pas
    WHERE LOWER(pas.email) = v_email
      AND pas.auth_user_id IS NULL
    FOR UPDATE;

    IF v_matched_profile_id IS NULL THEN
      -- Fallback check on profiles during migration window
      SELECT p.id INTO v_matched_profile_id
      FROM public.profiles p
      WHERE LOWER(p.email) = v_email
        AND p.auth_user_id IS NULL
      FOR UPDATE;
    END IF;
  END IF;

  IF v_matched_profile_id IS NOT NULL THEN
    -- Link pre-provisioned profile
    UPDATE public.profile_auth_secrets
    SET auth_user_id = NEW.id,
        updated_at = now()
    WHERE profile_id = v_matched_profile_id;

    UPDATE public.profiles
    SET auth_user_id = NEW.id,
        updated_at = now()
    WHERE id = v_matched_profile_id;

    IF v_phone IS NOT NULL OR v_village IS NOT NULL THEN
      UPDATE public.profile_contacts
      SET phone = COALESCE(phone, v_phone),
          village = COALESCE(village, v_village),
          updated_at = now()
      WHERE profile_id = v_matched_profile_id;

      UPDATE public.profiles
      SET phone = COALESCE(phone, v_phone),
          village = COALESCE(village, v_village),
          updated_at = now()
      WHERE id = v_matched_profile_id;
    END IF;

    RETURN NEW;
  END IF;

  -- 2. New self-registration (if profile does not exist yet)
  IF NOT EXISTS (SELECT 1 FROM public.profile_auth_secrets WHERE auth_user_id = NEW.id)
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE auth_user_id = NEW.id) THEN

    v_new_profile_id := gen_random_uuid();

    INSERT INTO public.profiles (
      id,
      role,
      full_name,
      auth_user_id,
      email,
      phone,
      village,
      created_at,
      updated_at
    ) VALUES (
      v_new_profile_id,
      v_role,
      v_full_name,
      NEW.id,
      v_email,
      v_phone,
      v_village,
      now(),
      now()
    );

    INSERT INTO public.profile_contacts (
      profile_id,
      phone,
      village,
      updated_at
    ) VALUES (
      v_new_profile_id,
      v_phone,
      v_village,
      now()
    ) ON CONFLICT (profile_id) DO NOTHING;

    INSERT INTO public.profile_auth_secrets (
      profile_id,
      auth_user_id,
      email,
      created_at,
      updated_at
    ) VALUES (
      v_new_profile_id,
      NEW.id,
      v_email,
      now(),
      now()
    ) ON CONFLICT (profile_id) DO NOTHING;

    IF v_role = 'technician'::public.user_role THEN
      INSERT INTO public.technician_profiles (
        profile_id,
        workshop_name,
        is_verified,
        is_available,
        phone,
        created_at,
        updated_at
      ) VALUES (
        v_new_profile_id,
        COALESCE(v_workshop, v_full_name || ' Workshop'),
        false,
        true,
        v_phone,
        now(),
        now()
      ) ON CONFLICT (profile_id) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------
-- 11. UPDATED ACCOUNT DELETION RPC: public.delete_user_account()
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_user_account()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
  SELECT p.id, p.role, COALESCE(pas.email, p.email) AS email, COALESCE(pas.demo_code, p.demo_code) AS demo_code
  INTO v_profile
  FROM public.profiles p
  LEFT JOIN public.profile_auth_secrets pas ON pas.profile_id = p.id
  WHERE pas.auth_user_id = v_user_id OR p.auth_user_id = v_user_id OR p.id = v_user_id
  LIMIT 1;

  IF v_profile.id IS NULL THEN
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
  IF v_profile.role = 'admin'::public.user_role THEN
    RAISE EXCEPTION 'Service Centre administrator accounts cannot be self-deleted.'
      USING ERRCODE = '42501';
  END IF;

  -- 5. Active Repair Check: Cannot delete with open workflow tickets
  IF v_profile.role = 'farmer'::public.user_role THEN
    SELECT EXISTS (
      SELECT 1 FROM public.repair_requests
      WHERE farmer_id = v_profile.id
        AND status NOT IN ('COMPLETED'::public.repair_status, 'CANCELLED'::public.repair_status)
    ) INTO v_has_active_repairs;

    IF v_has_active_repairs THEN
      RAISE EXCEPTION 'Cannot delete your account while you have active repair requests in progress. Please complete or cancel all open repairs before deleting your account.'
        USING ERRCODE = 'P0001';
    END IF;

  ELSIF v_profile.role = 'technician'::public.user_role THEN
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
    -- A. Historical business records exist: Anonymize PII
    DELETE FROM public.notifications WHERE recipient_user_id = v_profile.id;

    IF v_profile.role = 'technician'::public.user_role THEN
      UPDATE public.technician_profiles
      SET is_available = false,
          phone = NULL,
          updated_at = now()
      WHERE profile_id = v_profile.id;
    END IF;

    -- Purge contact details & auth secrets completely
    DELETE FROM public.profile_contacts WHERE profile_id = v_profile.id;
    DELETE FROM public.profile_auth_secrets WHERE profile_id = v_profile.id;

    -- Anonymize public.profiles stub and unlink
    UPDATE public.profiles
    SET full_name = 'Former Member',
        phone = NULL,
        village = NULL,
        email = NULL,
        auth_user_id = NULL,
        updated_at = now()
    WHERE id = v_profile.id;

    -- Permanently purge credentials from auth.users
    DELETE FROM auth.users WHERE id = v_user_id;

  ELSE
    -- B. No restrictive dependencies exist: Hard delete all user data
    DELETE FROM public.notifications WHERE recipient_user_id = v_profile.id;

    IF v_profile.role = 'farmer'::public.user_role THEN
      DELETE FROM public.equipment WHERE farmer_id = v_profile.id;
    ELSIF v_profile.role = 'technician'::public.user_role THEN
      DELETE FROM public.technician_profiles WHERE profile_id = v_profile.id;
    END IF;

    -- Cascades delete to profile_contacts and profile_auth_secrets
    DELETE FROM public.profiles WHERE id = v_profile.id;
    DELETE FROM auth.users WHERE id = v_user_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Account deleted successfully.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_user_account() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_user_account() FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_user_account() TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 12. UPDATED DEMO RESET RPC: public.reset_demo_data()
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_demo_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_email text;
  v_demo_farmer_id CONSTANT uuid := '00000000-0000-0000-0001-000000000001'::uuid;
  v_demo_tech_id CONSTANT uuid   := '00000000-0000-0000-0002-000000000001'::uuid;
  v_demo_admin_id CONSTANT uuid  := '00000000-0000-0000-0003-000000000001'::uuid;
  v_demo_repair_ids uuid[] := '{}';
  v_demo_quote_ids uuid[] := '{}';
  v_repairs_deleted int := 0;
  v_equipment_reset int := 0;
  v_equipment_deleted int := 0;
  v_notifications_deleted int := 0;
  v_service_history_deleted int := 0;
BEGIN
  -- 1. Authorization
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL OR v_caller_id NOT IN (
    '00000000-0000-0000-0000-000000000001'::uuid, -- farmer (Balasaheb Patil)
    '00000000-0000-0000-0000-000000000004'::uuid, -- technician (Ramesh Kumar)
    '00000000-0000-0000-0000-000000000005'::uuid  -- admin (Nagpur Service Centre)
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Demo reset is strictly reserved for designated demo evaluation personas.'
      USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_caller_email
  FROM auth.users
  WHERE id = v_caller_id;

  IF v_caller_email IS NULL OR v_caller_email NOT IN (
    'farmer.nagpur@terrabyte.demo',
    'tech.nagpur@terrabyte.demo',
    'admin.nagpur@terrabyte.demo'
  ) THEN
    RAISE EXCEPTION 'Forbidden: reset_demo_data is restricted to designated demo accounts';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profile_auth_secrets pas
    WHERE pas.auth_user_id = v_caller_id AND pas.demo_code IS NOT NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE (p.auth_user_id = v_caller_id OR p.id = v_caller_id) AND p.demo_code IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Forbidden: caller profile is missing demo_code';
  END IF;

  -- 2. Identify Demo Repairs
  SELECT COALESCE(ARRAY_AGG(id), '{}') INTO v_demo_repair_ids
  FROM public.repair_requests
  WHERE farmer_id = v_demo_farmer_id
     OR equipment_id IN (
       SELECT id FROM public.equipment WHERE farmer_id = v_demo_farmer_id
     );

  -- 3. Scoped Deletion
  IF v_demo_repair_ids IS NOT NULL AND array_length(v_demo_repair_ids, 1) > 0 THEN
    SELECT COALESCE(ARRAY_AGG(id), '{}') INTO v_demo_quote_ids
    FROM public.quotes
    WHERE repair_request_id = ANY(v_demo_repair_ids);

    IF v_demo_quote_ids IS NOT NULL AND array_length(v_demo_quote_ids, 1) > 0 THEN
      DELETE FROM public.quote_items
      WHERE quote_id = ANY(v_demo_quote_ids);
    END IF;

    DELETE FROM public.quotes
    WHERE repair_request_id = ANY(v_demo_repair_ids);

    DELETE FROM public.repair_dispatch_locations
    WHERE repair_request_id = ANY(v_demo_repair_ids);

    DELETE FROM public.repair_messages
    WHERE repair_request_id = ANY(v_demo_repair_ids);

    DELETE FROM public.repair_notes
    WHERE repair_request_id = ANY(v_demo_repair_ids);

    DELETE FROM public.repair_timeline
    WHERE repair_request_id = ANY(v_demo_repair_ids);

    IF to_regclass('public.service_centre_part_sales') IS NOT NULL THEN
      DELETE FROM public.service_centre_part_sales
      WHERE repair_request_id = ANY(v_demo_repair_ids);
    END IF;

    IF to_regclass('public.service_centre_part_requests') IS NOT NULL THEN
      DELETE FROM public.service_centre_part_requests
      WHERE repair_request_id = ANY(v_demo_repair_ids);
    END IF;

    IF to_regclass('public.service_centre_stock_audit') IS NOT NULL THEN
      DELETE FROM public.service_centre_stock_audit
      WHERE repair_request_id = ANY(v_demo_repair_ids);
    END IF;

    WITH deleted_repairs AS (
      DELETE FROM public.repair_requests
      WHERE id = ANY(v_demo_repair_ids)
      RETURNING id
    )
    SELECT count(*) INTO v_repairs_deleted FROM deleted_repairs;
  END IF;

  -- 4. Purge Demo Service History
  WITH deleted_history AS (
    DELETE FROM public.service_history
    WHERE equipment_id IN (
      SELECT id FROM public.equipment WHERE farmer_id = v_demo_farmer_id
    )
    OR (v_demo_repair_ids IS NOT NULL AND array_length(v_demo_repair_ids, 1) > 0 AND repair_request_id = ANY(v_demo_repair_ids))
    RETURNING id
  )
  SELECT count(*) INTO v_service_history_deleted FROM deleted_history;

  -- 5. Purge Demo Notifications
  WITH deleted_notifs AS (
    DELETE FROM public.notifications
    WHERE recipient_user_id = v_demo_farmer_id
       OR (
         v_demo_repair_ids IS NOT NULL AND array_length(v_demo_repair_ids, 1) > 0
         AND EXISTS (
           SELECT 1 FROM unnest(v_demo_repair_ids) r_id
           WHERE public.notifications.link_target LIKE '%' || r_id::text || '%'
         )
       )
    RETURNING id
  )
  SELECT count(*) INTO v_notifications_deleted FROM deleted_notifs;

  -- 6. Purge Non-Repair Stock Audits
  IF to_regclass('public.service_centre_stock_audit') IS NOT NULL AND to_regclass('public.service_centre_parts') IS NOT NULL THEN
    DELETE FROM public.service_centre_stock_audit
    WHERE repair_request_id IS NULL
      AND part_id IN (
        SELECT id FROM public.service_centre_parts WHERE service_centre_id = v_demo_admin_id
      );
  END IF;

  -- 7. Clean up Non-Canonical Parts
  IF to_regclass('public.service_centre_parts') IS NOT NULL THEN
    DELETE FROM public.service_centre_parts
    WHERE service_centre_id = v_demo_admin_id
      AND part_number NOT IN ('0433171', '005556958R1', 'AL120788', 'HY-GARD-15W30', '26243171');
  END IF;

  -- 8. Deterministically Restore Parts Baseline
  IF to_regclass('public.service_centre_parts') IS NOT NULL THEN
    INSERT INTO public.service_centre_parts (
      service_centre_id, part_number, name, spec, category,
      compatible_models, stock_quantity, unit_price, location
    ) VALUES
      (v_demo_admin_id, '0433171', 'Fuel Injector Nozzle Set', 'Bosch 0433171 (x4)', 'Fuel system', ARRAY['Mahindra 575 DI'], 3, 2200, 'Depot Shelf A-02'),
      (v_demo_admin_id, '005556958R1', 'Inline Fuel Filter', 'Mahindra 005556958R1', 'Fuel system', ARRAY['Mahindra 575 DI'], 8, 350, 'Depot Shelf A-03'),
      (v_demo_admin_id, 'AL120788', 'Lift Cylinder Seal Kit', 'JD AL120788', 'Hydraulics', ARRAY['John Deere 5050D'], 2, 1650, 'Depot Shelf B-01'),
      (v_demo_admin_id, 'HY-GARD-15W30', 'Hydraulic Oil 15W-30', 'JD Hy-Gard, litres', 'Hydraulics', ARRAY['John Deere 5050D'], 5, 320, 'Depot Drum Rack B-04'),
      (v_demo_admin_id, '26243171', 'Starter Motor Assembly', 'Lucas-TVS 12V 2.2kW', 'Electrical', ARRAY['Mahindra 575 DI', 'Swaraj 744 FE'], 1, 5800, 'Depot Shelf C-01')
    ON CONFLICT (service_centre_id, part_number) DO UPDATE SET
      name = EXCLUDED.name,
      spec = EXCLUDED.spec,
      category = EXCLUDED.category,
      compatible_models = EXCLUDED.compatible_models,
      stock_quantity = EXCLUDED.stock_quantity,
      unit_price = EXCLUDED.unit_price,
      location = EXCLUDED.location,
      updated_at = now()
    WHERE public.service_centre_parts.service_centre_id = v_demo_admin_id;
  END IF;

  -- 9. Delete Non-Canonical Demo Equipment
  WITH deleted_equipment AS (
    DELETE FROM public.equipment
    WHERE farmer_id = v_demo_farmer_id
      AND id NOT IN (
        '00000000-0000-0000-0010-000000000001'::uuid,
        '00000000-0000-0000-0010-000000000002'::uuid,
        '00000000-0000-0000-0010-000000000003'::uuid
      )
    RETURNING id
  )
  SELECT count(*) INTO v_equipment_deleted FROM deleted_equipment;

  -- 10. Restore Canonical Equipment
  INSERT INTO public.equipment (
    id, farmer_id, type, make, model, year, serial_number, operating_hours, photo_url, status, demo_code
  ) VALUES
    ('00000000-0000-0000-0010-000000000001'::uuid, v_demo_farmer_id, 'Tractor', 'Mahindra', '575 DI', 2021, 'MH575-21-0048821', 1240, NULL, 'Operational', 'e1'),
    ('00000000-0000-0000-0010-000000000002'::uuid, v_demo_farmer_id, 'Power Tiller', 'VST Shakti', '130 DI', 2023, 'VST130-23-009112', 3120, NULL, 'Operational', 'e2'),
    ('00000000-0000-0000-0010-000000000003'::uuid, v_demo_farmer_id, 'Harvester', 'John Deere', 'W70', 2020, 'JD-W70-20-00192', 890, NULL, 'Operational', 'e3')
  ON CONFLICT (id) DO UPDATE SET
    farmer_id = EXCLUDED.farmer_id,
    type = EXCLUDED.type,
    make = EXCLUDED.make,
    model = EXCLUDED.model,
    year = EXCLUDED.year,
    serial_number = EXCLUDED.serial_number,
    operating_hours = EXCLUDED.operating_hours,
    photo_url = EXCLUDED.photo_url,
    status = 'Operational',
    demo_code = EXCLUDED.demo_code,
    updated_at = now();

  SELECT count(*) INTO v_equipment_reset
  FROM public.equipment
  WHERE farmer_id = v_demo_farmer_id;

  -- 11. Restore Ramesh Kumar's Technician Profile Baseline
  UPDATE public.technician_profiles
  SET is_available = true,
      is_verified = true,
      updated_at = now()
  WHERE profile_id = v_demo_tech_id
     OR id = '00000000-0000-0000-0002-000000000011'::uuid;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Demo baseline successfully and deterministically restored for Nagpur Service Centre',
    'repairs_deleted', v_repairs_deleted,
    'equipment_deleted', v_equipment_deleted,
    'equipment_reset', v_equipment_reset,
    'notifications_deleted', v_notifications_deleted,
    'service_history_deleted', v_service_history_deleted,
    'timestamp', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reset_demo_data() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reset_demo_data() FROM anon;
GRANT EXECUTE ON FUNCTION public.reset_demo_data() TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 13. UPDATED ATOMIC QUOTE RPCs
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_quote_atomic(
  p_repair_request_id uuid,
  p_labour_description text,
  p_labour_amount numeric,
  p_tax_percent numeric,
  p_estimated_completion text,
  p_warranty_terms text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_role public.user_role;
  v_repair record;
  v_existing_quote record;
  v_quote_id uuid;
  v_now timestamptz := now();
  v_item record;
  v_parts_total numeric := 0;
  v_tax_amount numeric := 0;
  v_total_amount numeric := 0;
  v_next_status public.repair_status;
  v_inserted_items jsonb := '[]'::jsonb;
  v_item_row record;
BEGIN
  -- 1. Caller verification
  v_caller_id := public.current_profile_id();
  v_caller_role := public.current_user_role();

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required: User profile not found.' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('technician'::public.user_role, 'admin'::public.user_role) THEN
    RAISE EXCEPTION 'Unauthorized: Only technicians or administrators can formulate repair quotes.' USING ERRCODE = '42501';
  END IF;

  -- 2. Verify repair request eligibility & assignment
  SELECT id, job_number, farmer_id, technician_id, status, parts_hold INTO v_repair
  FROM public.repair_requests
  WHERE id = p_repair_request_id
  FOR UPDATE;

  IF v_repair.id IS NULL THEN
    RAISE EXCEPTION 'Repair request not found: %', p_repair_request_id USING ERRCODE = 'P0002';
  END IF;

  IF v_caller_role = 'technician'::public.user_role AND (v_repair.technician_id IS NULL OR v_repair.technician_id != v_caller_id) THEN
    RAISE EXCEPTION 'Unauthorized: You are not assigned to repair job %', v_repair.job_number USING ERRCODE = '42501';
  END IF;

  IF v_repair.status NOT IN ('ASSIGNED'::public.repair_status, 'ACCEPTED'::public.repair_status, 'IN_PROGRESS'::public.repair_status, 'DIAGNOSED'::public.repair_status) THEN
    RAISE EXCEPTION 'Cannot formulate quote: Repair request % is in status %', v_repair.job_number, v_repair.status USING ERRCODE = '22023';
  END IF;

  -- 3. Check for existing active quote
  SELECT id, version, status INTO v_existing_quote
  FROM public.quotes
  WHERE repair_request_id = p_repair_request_id
    AND status IN ('DRAFT'::public.quote_status, 'PENDING_APPROVAL'::public.quote_status, 'APPROVED'::public.quote_status)
  LIMIT 1;

  IF v_existing_quote.id IS NOT NULL THEN
    RAISE EXCEPTION 'An active quote already exists for repair job % (status: %)', v_repair.job_number, v_existing_quote.status USING ERRCODE = '23505';
  END IF;

  -- 4. Calculate totals
  IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' AND jsonb_array_length(p_items) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
      part_id uuid,
      part_number text,
      part_name text,
      quantity integer,
      unit_price numeric,
      is_custom boolean,
      service_centre_part_id uuid,
      expected_delivery_date date,
      delivery_sla_working_days integer
    )
    LOOP
      IF v_item.quantity <= 0 THEN
        RAISE EXCEPTION 'Invalid item quantity: % for part %', v_item.quantity, v_item.part_name USING ERRCODE = '22023';
      END IF;
      IF v_item.unit_price < 0 THEN
        RAISE EXCEPTION 'Invalid unit price: % for part %', v_item.unit_price, v_item.part_name USING ERRCODE = '22023';
      END IF;
      v_parts_total := v_parts_total + (v_item.quantity * v_item.unit_price);
    END LOOP;
  END IF;

  v_tax_amount := ROUND(((p_labour_amount + v_parts_total) * (p_tax_percent / 100.0)), 2);
  v_total_amount := p_labour_amount + v_parts_total + v_tax_amount;

  -- 5. Insert quote record
  INSERT INTO public.quotes (
    repair_request_id,
    technician_id,
    version,
    status,
    labour_amount,
    labour_description,
    parts_total,
    tax_percent,
    tax_amount,
    total_amount,
    estimated_completion,
    warranty_terms,
    created_at,
    updated_at
  ) VALUES (
    p_repair_request_id,
    v_repair.technician_id,
    1,
    'PENDING_APPROVAL'::public.quote_status,
    p_labour_amount,
    p_labour_description,
    v_parts_total,
    p_tax_percent,
    v_tax_amount,
    v_total_amount,
    p_estimated_completion,
    p_warranty_terms,
    v_now,
    v_now
  )
  RETURNING id INTO v_quote_id;

  -- 6. Insert quote line items
  IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' AND jsonb_array_length(p_items) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
      part_id uuid,
      part_number text,
      part_name text,
      quantity integer,
      unit_price numeric,
      is_custom boolean,
      service_centre_part_id uuid,
      expected_delivery_date date,
      delivery_sla_working_days integer
    )
    LOOP
      INSERT INTO public.quote_items (
        quote_id,
        part_id,
        part_number,
        part_name,
        quantity,
        unit_price,
        total_price,
        is_custom,
        service_centre_part_id,
        expected_delivery_date,
        delivery_sla_working_days
      ) VALUES (
        v_quote_id,
        v_item.part_id,
        COALESCE(v_item.part_number, 'CUSTOM'),
        v_item.part_name,
        v_item.quantity,
        v_item.unit_price,
        ROUND((v_item.quantity * v_item.unit_price), 2),
        COALESCE(v_item.is_custom, false),
        v_item.service_centre_part_id,
        v_item.expected_delivery_date,
        v_item.delivery_sla_working_days
      )
      RETURNING * INTO v_item_row;

      v_inserted_items := v_inserted_items || jsonb_build_array(to_jsonb(v_item_row));
    END LOOP;
  END IF;

  -- 7. Advance repair request status
  IF v_repair.parts_hold IS TRUE THEN
    v_next_status := 'WAITING_FOR_PARTS'::public.repair_status;
  ELSE
    v_next_status := 'DIAGNOSED'::public.repair_status;
  END IF;

  UPDATE public.repair_requests
  SET status = v_next_status,
      status_since = v_now,
      updated_at = v_now
  WHERE id = p_repair_request_id;

  -- 8. Record timeline entry
  INSERT INTO public.repair_timeline (
    repair_request_id,
    created_by_id,
    action,
    note,
    created_at
  ) VALUES (
    p_repair_request_id,
    v_caller_id,
    'Quote Submitted',
    format('Formal estimate v1 formulated for ₹%s (Labour: ₹%s, Parts: ₹%s, GST: ₹%s)', v_total_amount, p_labour_amount, v_parts_total, v_tax_amount),
    v_now
  );

  RETURN jsonb_build_object(
    'success', true,
    'quote_id', v_quote_id,
    'repair_request_id', p_repair_request_id,
    'version', 1,
    'status', 'PENDING_APPROVAL',
    'total_amount', v_total_amount,
    'labour_amount', p_labour_amount,
    'parts_total', v_parts_total,
    'tax_amount', v_tax_amount,
    'items', v_inserted_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_quote_atomic(uuid, text, numeric, numeric, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_quote_atomic(uuid, text, numeric, numeric, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_quote_atomic(uuid, text, numeric, numeric, text, text, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.revise_quote_atomic(
  p_previous_quote_id uuid,
  p_repair_request_id uuid,
  p_labour_description text,
  p_labour_amount numeric,
  p_tax_percent numeric,
  p_estimated_completion text,
  p_warranty_terms text,
  p_technician_explanation text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_role public.user_role;
  v_repair record;
  v_prev_quote record;
  v_quote_id uuid;
  v_new_version int;
  v_now timestamptz := now();
  v_item record;
  v_parts_total numeric := 0;
  v_tax_amount numeric := 0;
  v_total_amount numeric := 0;
  v_next_status public.repair_status;
  v_inserted_items jsonb := '[]'::jsonb;
  v_item_row record;
BEGIN
  -- 1. Caller verification
  v_caller_id := public.current_profile_id();
  v_caller_role := public.current_user_role();

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required: User profile not found.' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('technician'::public.user_role, 'admin'::public.user_role) THEN
    RAISE EXCEPTION 'Unauthorized: Only technicians or administrators can formulate repair quotes.' USING ERRCODE = '42501';
  END IF;

  -- 2. Fetch and lock previous quote
  SELECT id, version, status, repair_request_id, technician_id INTO v_prev_quote
  FROM public.quotes
  WHERE id = p_previous_quote_id
  FOR UPDATE;

  IF v_prev_quote.id IS NULL THEN
    RAISE EXCEPTION 'Previous quote not found: %', p_previous_quote_id USING ERRCODE = 'P0002';
  END IF;

  IF v_prev_quote.repair_request_id != p_repair_request_id THEN
    RAISE EXCEPTION 'Quote % does not belong to repair %', p_previous_quote_id, p_repair_request_id USING ERRCODE = '22023';
  END IF;

  IF v_prev_quote.status != 'REJECTED'::public.quote_status THEN
    RAISE EXCEPTION 'Only rejected quotes can be revised (current status: %)', v_prev_quote.status USING ERRCODE = '22023';
  END IF;

  -- 3. Verify repair request eligibility & assignment
  SELECT id, job_number, farmer_id, technician_id, status, parts_hold INTO v_repair
  FROM public.repair_requests
  WHERE id = p_repair_request_id
  FOR UPDATE;

  IF v_repair.id IS NULL THEN
    RAISE EXCEPTION 'Repair request not found: %', p_repair_request_id USING ERRCODE = 'P0002';
  END IF;

  IF v_caller_role = 'technician'::public.user_role AND (v_repair.technician_id IS NULL OR v_repair.technician_id != v_caller_id) THEN
    RAISE EXCEPTION 'Unauthorized: You are not assigned to repair job %', v_repair.job_number USING ERRCODE = '42501';
  END IF;

  -- 4. Calculate totals
  IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' AND jsonb_array_length(p_items) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
      part_id uuid,
      part_number text,
      part_name text,
      quantity integer,
      unit_price numeric,
      is_custom boolean,
      service_centre_part_id uuid,
      expected_delivery_date date,
      delivery_sla_working_days integer
    )
    LOOP
      IF v_item.quantity <= 0 THEN
        RAISE EXCEPTION 'Invalid item quantity: % for part %', v_item.quantity, v_item.part_name USING ERRCODE = '22023';
      END IF;
      IF v_item.unit_price < 0 THEN
        RAISE EXCEPTION 'Invalid unit price: % for part %', v_item.unit_price, v_item.part_name USING ERRCODE = '22023';
      END IF;
      v_parts_total := v_parts_total + (v_item.quantity * v_item.unit_price);
    END LOOP;
  END IF;

  v_tax_amount := ROUND(((p_labour_amount + v_parts_total) * (p_tax_percent / 100.0)), 2);
  v_total_amount := p_labour_amount + v_parts_total + v_tax_amount;
  v_new_version := v_prev_quote.version + 1;

  -- 5. Mark previous quote as REVISED
  UPDATE public.quotes
  SET status = 'REVISED'::public.quote_status,
      updated_at = v_now
  WHERE id = p_previous_quote_id;

  -- 6. Insert new quote version
  INSERT INTO public.quotes (
    repair_request_id,
    technician_id,
    version,
    status,
    labour_amount,
    labour_description,
    parts_total,
    tax_percent,
    tax_amount,
    total_amount,
    estimated_completion,
    warranty_terms,
    created_at,
    updated_at
  ) VALUES (
    p_repair_request_id,
    v_repair.technician_id,
    v_new_version,
    'PENDING_APPROVAL'::public.quote_status,
    p_labour_amount,
    p_labour_description,
    v_parts_total,
    p_tax_percent,
    v_tax_amount,
    v_total_amount,
    p_estimated_completion,
    p_warranty_terms,
    v_now,
    v_now
  )
  RETURNING id INTO v_quote_id;

  -- 7. Insert line items
  IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' AND jsonb_array_length(p_items) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
      part_id uuid,
      part_number text,
      part_name text,
      quantity integer,
      unit_price numeric,
      is_custom boolean,
      service_centre_part_id uuid,
      expected_delivery_date date,
      delivery_sla_working_days integer
    )
    LOOP
      INSERT INTO public.quote_items (
        quote_id,
        part_id,
        part_number,
        part_name,
        quantity,
        unit_price,
        total_price,
        is_custom,
        service_centre_part_id,
        expected_delivery_date,
        delivery_sla_working_days
      ) VALUES (
        v_quote_id,
        v_item.part_id,
        COALESCE(v_item.part_number, 'CUSTOM'),
        v_item.part_name,
        v_item.quantity,
        v_item.unit_price,
        ROUND((v_item.quantity * v_item.unit_price), 2),
        COALESCE(v_item.is_custom, false),
        v_item.service_centre_part_id,
        v_item.expected_delivery_date,
        v_item.delivery_sla_working_days
      )
      RETURNING * INTO v_item_row;

      v_inserted_items := v_inserted_items || jsonb_build_array(to_jsonb(v_item_row));
    END LOOP;
  END IF;

  -- 8. Advance status
  IF v_repair.parts_hold IS TRUE THEN
    v_next_status := 'WAITING_FOR_PARTS'::public.repair_status;
  ELSE
    v_next_status := 'DIAGNOSED'::public.repair_status;
  END IF;

  UPDATE public.repair_requests
  SET status = v_next_status,
      status_since = v_now,
      updated_at = v_now
  WHERE id = p_repair_request_id;

  -- 9. Record timeline event
  INSERT INTO public.repair_timeline (
    repair_request_id,
    created_by_id,
    action,
    note,
    created_at
  ) VALUES (
    p_repair_request_id,
    v_caller_id,
    'Quote Revised',
    format('Revised estimate v%s formulated for ₹%s. Explanation: %s', v_new_version, v_total_amount, COALESCE(p_technician_explanation, 'No explanation provided')),
    v_now
  );

  RETURN jsonb_build_object(
    'success', true,
    'quote_id', v_quote_id,
    'repair_request_id', p_repair_request_id,
    'version', v_new_version,
    'status', 'PENDING_APPROVAL',
    'total_amount', v_total_amount,
    'labour_amount', p_labour_amount,
    'parts_total', v_parts_total,
    'tax_amount', v_tax_amount,
    'items', v_inserted_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.revise_quote_atomic(uuid, uuid, text, numeric, numeric, text, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revise_quote_atomic(uuid, uuid, text, numeric, numeric, text, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.revise_quote_atomic(uuid, uuid, text, numeric, numeric, text, text, text, jsonb) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 14. ROW LEVEL SECURITY (RLS) POLICIES
-- ------------------------------------------------------------------------------

-- Enable RLS on all 3 tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_auth_secrets ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- A. public.profiles RLS Policies
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_service_centre" ON public.profiles;
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Profiles read policy" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
DROP POLICY IF EXISTS "profiles_read_policy" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_service_centre" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_policy" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_policy" ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete_policy" ON public.profiles;

CREATE POLICY "profiles_select_policy"
ON public.profiles
FOR SELECT
TO authenticated
USING (app_security.can_view_profile(id));

CREATE POLICY "profiles_update_policy"
ON public.profiles
FOR UPDATE
TO authenticated
USING (id = public.current_profile_id() OR public.current_user_role() = 'admin'::public.user_role)
WITH CHECK (id = public.current_profile_id() OR public.current_user_role() = 'admin'::public.user_role);

-- Direct client INSERT on public.profiles is intentionally disallowed (no INSERT policy is created).
-- In TerraByte, profiles.id is a distinct UUID separate from auth.uid().
-- Profile records are created strictly through audited server-side SECURITY DEFINER routines:
--   1. public.handle_new_user() trigger on auth.users (for self-signup registration)
--   2. public.admin_provision_staff() RPC (for staff pre-provisioning)
--   3. public.reset_demo_data() RPC (for demo resets)

CREATE POLICY "profiles_delete_policy"
ON public.profiles
FOR DELETE
TO authenticated
USING (public.current_user_role() = 'admin'::public.user_role);

-- ------------------------------------------------------------------------------
-- B. public.profile_contacts RLS Policies
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "profile_contacts_select_policy" ON public.profile_contacts;
DROP POLICY IF EXISTS "profile_contacts_update_policy" ON public.profile_contacts;
DROP POLICY IF EXISTS "profile_contacts_insert_policy" ON public.profile_contacts;
DROP POLICY IF EXISTS "profile_contacts_delete_policy" ON public.profile_contacts;

CREATE POLICY "profile_contacts_select_policy"
ON public.profile_contacts
FOR SELECT
TO authenticated
USING (
  -- 1. Self access
  profile_id = public.current_profile_id()
  -- 2. Scoped admin access: operational needs only (technicians or farmers with active/existing repairs)
  OR (
    public.current_user_role() = 'admin'::public.user_role
    AND (
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = profile_contacts.profile_id
          AND p.role = 'technician'::public.user_role
      )
      OR EXISTS (
        SELECT 1 FROM public.repair_requests rr
        WHERE rr.farmer_id = profile_contacts.profile_id
      )
    )
  )
  -- 3. Active assigned repair counterpart (farmer <-> technician)
  OR EXISTS (
    SELECT 1 FROM public.repair_requests rr
    WHERE (
      (rr.farmer_id = profile_contacts.profile_id AND rr.technician_id = public.current_profile_id())
      OR
      (rr.technician_id = profile_contacts.profile_id AND rr.farmer_id = public.current_profile_id())
    )
    AND rr.status NOT IN ('COMPLETED'::public.repair_status, 'CANCELLED'::public.repair_status)
    AND (rr.declined_by IS NULL OR NOT (public.current_profile_id() = ANY(rr.declined_by)))
  )
);

CREATE POLICY "profile_contacts_update_policy"
ON public.profile_contacts
FOR UPDATE
TO authenticated
USING (profile_id = public.current_profile_id() OR public.current_user_role() = 'admin'::public.user_role)
WITH CHECK (profile_id = public.current_profile_id() OR public.current_user_role() = 'admin'::public.user_role);

CREATE POLICY "profile_contacts_insert_policy"
ON public.profile_contacts
FOR INSERT
TO authenticated
WITH CHECK (profile_id = public.current_profile_id() OR public.current_user_role() = 'admin'::public.user_role);

CREATE POLICY "profile_contacts_delete_policy"
ON public.profile_contacts
FOR DELETE
TO authenticated
USING (profile_id = public.current_profile_id() OR public.current_user_role() = 'admin'::public.user_role);

-- ------------------------------------------------------------------------------
-- C. public.profile_auth_secrets RLS Policies (Sealed from Admin)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "profile_auth_secrets_select_own" ON public.profile_auth_secrets;
DROP POLICY IF EXISTS "profile_auth_secrets_update_own" ON public.profile_auth_secrets;
DROP POLICY IF EXISTS "profile_auth_secrets_insert_own" ON public.profile_auth_secrets;
DROP POLICY IF EXISTS "profile_auth_secrets_delete_own" ON public.profile_auth_secrets;

CREATE POLICY "profile_auth_secrets_select_own"
ON public.profile_auth_secrets
FOR SELECT
TO authenticated
USING (auth_user_id = auth.uid());

CREATE POLICY "profile_auth_secrets_update_own"
ON public.profile_auth_secrets
FOR UPDATE
TO authenticated
USING (auth_user_id = auth.uid())
WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY "profile_auth_secrets_insert_own"
ON public.profile_auth_secrets
FOR INSERT
TO authenticated
WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY "profile_auth_secrets_delete_own"
ON public.profile_auth_secrets
FOR DELETE
TO authenticated
USING (auth_user_id = auth.uid());

-- ------------------------------------------------------------------------------
-- 15. TABLE & COLUMN PRIVILEGES: Minimal least-privilege grants
-- ------------------------------------------------------------------------------

-- Revoke all table-level privileges on public.profiles from anon and public
REVOKE ALL ON TABLE public.profiles FROM PUBLIC;
REVOKE ALL ON TABLE public.profiles FROM anon;

-- Revoke table-level access from authenticated so sensitive legacy columns cannot be selected
REVOKE ALL ON TABLE public.profiles FROM authenticated;

-- Grant column-level SELECT strictly on safe identity/attribution columns:
-- (auth_user_id, email, demo_code, clerk_user_id are NOT granted to authenticated)
GRANT SELECT (id, role, full_name, phone, village, created_at, updated_at)
  ON TABLE public.profiles TO authenticated;

-- Grant column-level UPDATE strictly on user-editable profile fields:
GRANT UPDATE (full_name, phone, village, updated_at)
  ON TABLE public.profiles TO authenticated;

-- Direct INSERT on public.profiles is strictly revoked from authenticated and anon clients:
-- Profile lifecycle creation is managed exclusively by server-side SECURITY DEFINER routines.
REVOKE INSERT ON TABLE public.profiles FROM authenticated, anon, PUBLIC;

-- Ensure service_role retains full table privileges for background workers
GRANT ALL ON TABLE public.profiles TO service_role;

-- Profile contacts privileges
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profile_contacts TO authenticated, service_role;
REVOKE ALL ON TABLE public.profile_contacts FROM anon, PUBLIC;

-- Profile auth secrets privileges (RLS strictly seals from admin)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profile_auth_secrets TO authenticated, service_role;
REVOKE ALL ON TABLE public.profile_auth_secrets FROM anon, PUBLIC;
