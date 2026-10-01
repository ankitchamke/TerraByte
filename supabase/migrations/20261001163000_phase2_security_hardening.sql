-- Phase 2.2 Final Security Hardening Migration
-- 1. Fix Technician Self-Approval Vulnerability
-- 2. Harden SECURITY DEFINER functions with explicit search_path
-- 3. Remove overly permissive anonymous demo read policies

-- ============================================================================
-- 1. HARDEN SECURITY DEFINER FUNCTIONS (Explicit safe search_path)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT id
  FROM public.profiles
  WHERE auth_user_id = auth.uid()
     OR (clerk_user_id IS NOT NULL AND clerk_user_id = auth.jwt()->>'sub')
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS user_role
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT role
  FROM public.profiles
  WHERE auth_user_id = auth.uid()
     OR (clerk_user_id IS NOT NULL AND clerk_user_id = auth.jwt()->>'sub')
  LIMIT 1;
$function$;

-- ============================================================================
-- 2. PROTECT TECHNICIAN VERIFICATION (Prevent Self-Approval)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.protect_technician_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- If is_verified is being modified, require caller to be an admin / service-centre
  IF NEW.is_verified IS DISTINCT FROM OLD.is_verified THEN
    IF public.current_user_role() != 'admin'::public.user_role THEN
      RAISE EXCEPTION 'Unauthorized: Technician verification status can only be modified by an administrator.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_protect_technician_verification ON public.technician_profiles;

CREATE TRIGGER trg_protect_technician_verification
BEFORE UPDATE ON public.technician_profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_technician_verification();

-- ============================================================================
-- 3. REMOVE OVERLY PERMISSIVE ANONYMOUS DEMO READ POLICIES
-- ============================================================================

-- Drop anon read on profiles
DROP POLICY IF EXISTS "Profiles demo public read" ON public.profiles;

-- Drop anon read on equipment
DROP POLICY IF EXISTS "Equipment demo public read" ON public.equipment;

-- Drop anon read on repair_requests
DROP POLICY IF EXISTS "Repair requests demo public read" ON public.repair_requests;

-- Drop anon read on quotes
DROP POLICY IF EXISTS "Quotes demo public read" ON public.quotes;

-- Drop anon read on notifications
DROP POLICY IF EXISTS "Notifications demo public read" ON public.notifications;

-- Restrict technician_profiles: authenticated users can view; anon cannot dump unverified technicians
DROP POLICY IF EXISTS "Technician profiles are viewable by all" ON public.technician_profiles;
CREATE POLICY "Technician profiles are viewable by authenticated users"
ON public.technician_profiles
FOR SELECT TO authenticated
USING (true);

-- Restrict quote_items: only viewable by authenticated users
DROP POLICY IF EXISTS "Quote items view policy" ON public.quote_items;
CREATE POLICY "Quote items view policy"
ON public.quote_items
FOR SELECT TO authenticated
USING (
  (EXISTS (
    SELECT 1 FROM quotes q
    WHERE q.id = quote_items.quote_id
      AND (
        q.technician_id = current_profile_id()
        OR EXISTS (
          SELECT 1 FROM repair_requests r
          WHERE r.id = q.repair_request_id AND r.farmer_id = current_profile_id()
        )
        OR current_user_role() = 'admin'::user_role
      )
  ))
);

-- Restrict repair_notes: only viewable by authenticated participants or admins
DROP POLICY IF EXISTS "Repair notes view policy" ON public.repair_notes;
CREATE POLICY "Repair notes view policy"
ON public.repair_notes
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM repair_requests r
    WHERE r.id = repair_notes.repair_request_id
      AND (
        r.farmer_id = current_profile_id()
        OR r.technician_id = current_profile_id()
        OR (r.technician_id IS NULL AND r.status = 'REQUESTED'::repair_status)
        OR current_user_role() = 'admin'::user_role
      )
  )
);

-- Restrict repair_timeline: only viewable by authenticated participants or admins
DROP POLICY IF EXISTS "Repair timeline view policy" ON public.repair_timeline;
CREATE POLICY "Repair timeline view policy"
ON public.repair_timeline
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM repair_requests r
    WHERE r.id = repair_timeline.repair_request_id
      AND (
        r.farmer_id = current_profile_id()
        OR r.technician_id = current_profile_id()
        OR (r.technician_id IS NULL AND r.status = 'REQUESTED'::repair_status)
        OR current_user_role() = 'admin'::user_role
      )
  )
);

-- Restrict service_history: only viewable by authenticated users
DROP POLICY IF EXISTS "Service history view policy" ON public.service_history;
CREATE POLICY "Service history view policy"
ON public.service_history
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM equipment e
    WHERE e.id = service_history.equipment_id
      AND (
        e.farmer_id = current_profile_id()
        OR current_user_role() = ANY (ARRAY['technician'::user_role, 'admin'::user_role])
      )
  )
);
