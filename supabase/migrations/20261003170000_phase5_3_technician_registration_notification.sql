-- ==============================================================================
-- TerraByte Phase 5.3 Step 3: Technician Registration Admin Notification
-- Migration: 20261003170000_phase5_3_technician_registration_notification.sql
-- Description: Notifies Service Centre administrators whenever a new technician
--              registers and awaits account verification.
-- ==============================================================================

-- 1. Create trigger function to notify admins upon new technician registration
CREATE OR REPLACE FUNCTION public.notify_admin_on_technician_registration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $$
DECLARE
  v_tech_name text;
  v_workshop text;
BEGIN
  -- Only trigger for newly registered unverified technicians
  IF NEW.is_verified = false THEN
    SELECT full_name INTO v_tech_name
    FROM public.profiles
    WHERE id = NEW.profile_id;

    v_tech_name := COALESCE(NULLIF(TRIM(v_tech_name), ''), 'New technician');
    v_workshop := COALESCE(NULLIF(TRIM(NEW.workshop_name), ''), 'Workshop');

    -- Idempotency check: avoid duplicate notifications for this technician
    IF NOT EXISTS (
      SELECT 1 FROM public.notifications
      WHERE recipient_role = 'admin'::public.user_role
        AND link_target = '/admin/technicians'
        AND notification_text ILIKE '%' || v_tech_name || '%'
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
        'New technician registration: ' || v_tech_name || ' (' || v_workshop || '). Pending verification.',
        '/admin/technicians',
        false,
        NOW()
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Bind trigger to technician_profiles AFTER INSERT
DROP TRIGGER IF EXISTS trg_notify_admin_on_technician_registration ON public.technician_profiles;

CREATE TRIGGER trg_notify_admin_on_technician_registration
AFTER INSERT ON public.technician_profiles
FOR EACH ROW
EXECUTE FUNCTION public.notify_admin_on_technician_registration();
