-- ==============================================================================
-- TerraByte — Phase 5.3 Step 3: Technician Registration Admin Notification
-- Migration: 20261104130000_complete_phase5_3_technician_registration_notification.sql
-- Description: Notifies Service Centre administrators whenever a new technician
--              registers and awaits account verification.
-- ==============================================================================

-- 1. TRIGGER FUNCTION TO NOTIFY ADMINS UPON NEW TECHNICIAN REGISTRATION
CREATE OR REPLACE FUNCTION public.notify_admin_on_technician_registration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $$
DECLARE
  v_tech_name text;
  v_workshop text;
  v_notif_text text;
BEGIN
  -- Only trigger for newly registered unverified technicians
  IF NEW.is_verified = false THEN
    -- Acquire transaction advisory lock scoped to this technician profile ID
    -- to serialize concurrent registration transactions and prevent duplicate notifications
    PERFORM pg_advisory_xact_lock(hashtext('tech_reg_' || NEW.profile_id::text));

    SELECT full_name INTO v_tech_name
    FROM public.profiles
    WHERE id = NEW.profile_id;

    v_tech_name := COALESCE(NULLIF(TRIM(v_tech_name), ''), 'New technician');
    v_workshop := COALESCE(NULLIF(TRIM(NEW.workshop_name), ''), 'Workshop');
    v_notif_text := 'New technician registration: ' || v_tech_name || ' (' || v_workshop || ') [Ref: ' || NEW.profile_id::text || ']. Pending verification.';

    -- Idempotency check: deduplicate by technician profile ID, not display name
    IF NOT EXISTS (
      SELECT 1 FROM public.notifications
      WHERE recipient_role = 'admin'::public.user_role
        AND link_target = '/admin/technicians'
        AND notification_text LIKE '%[Ref: ' || NEW.profile_id::text || ']%'
    ) THEN
      INSERT INTO public.notifications (
        recipient_role,
        recipient_user_id,
        notification_text,
        link_target,
        is_read,
        created_at
      )
      VALUES (
        'admin'::public.user_role,
        NULL,
        v_notif_text,
        '/admin/technicians',
        false,
        NOW()
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 2. BIND TRIGGER TO technician_profiles AFTER INSERT
DROP TRIGGER IF EXISTS trg_notify_admin_on_technician_registration ON public.technician_profiles;

CREATE TRIGGER trg_notify_admin_on_technician_registration
AFTER INSERT ON public.technician_profiles
FOR EACH ROW
EXECUTE FUNCTION public.notify_admin_on_technician_registration();

-- 3. GRANTS AND PRIVILEGES
REVOKE ALL ON FUNCTION public.notify_admin_on_technician_registration() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_admin_on_technician_registration() FROM anon;
GRANT EXECUTE ON FUNCTION public.notify_admin_on_technician_registration() TO authenticated, service_role;

