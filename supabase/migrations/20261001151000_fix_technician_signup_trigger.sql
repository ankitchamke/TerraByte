-- ==============================================================================
-- TerraByte — Update Auth User Trigger for Multi-Role Self-Registration
-- Migration: 20261001151000_fix_technician_signup_trigger.sql
-- Description: Allows both farmers and technicians to register via Supabase Auth.
-- Technicians receive role 'technician' and a technician_profiles record with
-- is_verified = false (pending service centre review).
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $$
DECLARE
  v_full_name TEXT;
  v_email TEXT;
  v_phone TEXT;
  v_village TEXT;
  v_role public.user_role;
  v_workshop TEXT;
  v_new_profile_id UUID;
BEGIN
  v_email := NEW.email;
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

  -- Determine role: only 'farmer' or 'technician' can be self-registered
  IF LOWER(COALESCE(NEW.raw_user_meta_data->>'role', '')) = 'technician' THEN
    v_role := 'technician'::public.user_role;
  ELSE
    v_role := 'farmer'::public.user_role;
  END IF;

  -- Idempotency check:
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE auth_user_id = NEW.id) THEN
    -- Check if an unlinked profile already exists matching this email (e.g. provisioned technician/admin)
    IF v_email IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE email = v_email AND auth_user_id IS NULL) THEN
      UPDATE public.profiles
      SET auth_user_id = NEW.id,
          phone = COALESCE(phone, v_phone),
          village = COALESCE(village, v_village),
          updated_at = NOW()
      WHERE email = v_email AND auth_user_id IS NULL;
    ELSIF v_phone IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE phone = v_phone AND auth_user_id IS NULL) THEN
      UPDATE public.profiles
      SET auth_user_id = NEW.id,
          email = COALESCE(email, v_email),
          village = COALESCE(village, v_village),
          updated_at = NOW()
      WHERE phone = v_phone AND auth_user_id IS NULL;
    ELSE
      -- Insert brand-new self-registered profile
      INSERT INTO public.profiles (
        auth_user_id,
        role,
        full_name,
        email,
        phone,
        village,
        created_at,
        updated_at
      )
      VALUES (
        NEW.id,
        v_role,
        v_full_name,
        v_email,
        v_phone,
        v_village,
        NOW(),
        NOW()
      )
      RETURNING id INTO v_new_profile_id;

      -- If registering as technician, also create technician_profiles entry (unverified by default)
      IF v_role = 'technician'::public.user_role THEN
        INSERT INTO public.technician_profiles (
          profile_id,
          workshop_name,
          is_verified,
          is_available,
          phone,
          created_at,
          updated_at
        )
        VALUES (
          v_new_profile_id,
          COALESCE(v_workshop, v_full_name || ' Workshop'),
          false,
          true,
          v_phone,
          NOW(),
          NOW()
        )
        ON CONFLICT (profile_id) DO NOTHING;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
