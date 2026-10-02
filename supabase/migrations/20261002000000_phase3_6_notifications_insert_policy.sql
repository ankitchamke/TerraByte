-- ==============================================================================
-- TerraByte Phase 3.6 — Notifications RLS Policies
-- Migration: 20261002000000_phase3_6_notifications_insert_policy.sql
-- Description: Hardens notifications RLS:
-- 1. Restricts notification creation strictly to legitimate workflow relationships
--    (admin broadcast, farmer <-> assigned technician, and participant -> admin).
-- 2. Ensures targeted notifications are only visible to the targeted recipient
--    while role broadcasts (recipient_user_id IS NULL) are visible to that role.
-- 3. Allows recipients (and admins) to update is_read status.
-- ==============================================================================

-- 1. Hardened Workflow-Bound Insert Policy
DROP POLICY IF EXISTS "Notifications insert policy" ON public.notifications;

CREATE POLICY "Notifications insert policy"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (
  public.current_user_role() = 'admin'::public.user_role

  OR (
    public.current_user_role() = 'technician'::public.user_role
    AND (
      recipient_role = 'admin'::public.user_role
      OR (
        recipient_role = 'farmer'::public.user_role
        AND recipient_user_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.repair_requests r
          WHERE (
            r.technician_id = public.current_profile_id()
            OR public.current_profile_id() = ANY(r.declined_by)
          )
          AND r.farmer_id = notifications.recipient_user_id
        )
      )
    )
  )

  OR (
    public.current_user_role() = 'farmer'::public.user_role
    AND (
      recipient_role = 'admin'::public.user_role
      OR (
        recipient_role = 'technician'::public.user_role
        AND recipient_user_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.repair_requests r
          WHERE r.farmer_id = public.current_profile_id()
            AND r.technician_id = notifications.recipient_user_id
        )
      )
    )
  )
);

-- 2. Hardened Select Policy
DROP POLICY IF EXISTS "Notifications view policy" ON public.notifications;
CREATE POLICY "Notifications view policy"
ON public.notifications
FOR SELECT
TO authenticated
USING (
  recipient_user_id = public.current_profile_id()
  OR (recipient_user_id IS NULL AND recipient_role = public.current_user_role())
  OR public.current_user_role() = 'admin'::public.user_role
);

-- 3. Hardened Update Policy
DROP POLICY IF EXISTS "Notifications update read status" ON public.notifications;
CREATE POLICY "Notifications update read status"
ON public.notifications
FOR UPDATE
TO authenticated
USING (
  recipient_user_id = public.current_profile_id()
  OR (recipient_user_id IS NULL AND recipient_role = public.current_user_role())
  OR public.current_user_role() = 'admin'::public.user_role
);
