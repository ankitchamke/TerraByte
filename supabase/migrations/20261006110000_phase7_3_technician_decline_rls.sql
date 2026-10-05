-- Phase 7.3: Technician Decline RLS Fix
-- Replaces "Technicians can update assigned repairs and accept jobs" to permit
-- assigned technicians to decline a repair request back to the unassigned REQUESTED state
-- while recording their profile ID in declined_by.

DROP POLICY IF EXISTS "Technicians can update assigned repairs and accept jobs" ON public.repair_requests;

CREATE POLICY "Technicians can update assigned repairs and accept jobs"
ON public.repair_requests
FOR UPDATE
TO authenticated
USING (
  (
    technician_id = public.current_profile_id()
    AND status NOT IN (
      'CANCELLATION_REQUESTED'::public.repair_status,
      'CANCELLED'::public.repair_status,
      'COMPLETED'::public.repair_status
    )
  )
  OR (
    public.current_user_role() = 'technician'::public.user_role
    AND technician_id IS NULL
    AND status = 'REQUESTED'::public.repair_status
  )
)
WITH CHECK (
  (
    technician_id = public.current_profile_id()
    AND status NOT IN (
      'CANCELLED'::public.repair_status,
      'CANCELLATION_REQUESTED'::public.repair_status
    )
  )
  OR (
    public.current_user_role() = 'technician'::public.user_role
    AND technician_id = public.current_profile_id()
    AND status = 'ACCEPTED'::public.repair_status
  )
  OR (
    public.current_user_role() = 'technician'::public.user_role
    AND technician_id IS NULL
    AND status = 'REQUESTED'::public.repair_status
    AND public.current_profile_id() = ANY(declined_by)
  )
);
