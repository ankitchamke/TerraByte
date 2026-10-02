-- ==============================================================================
-- TerraByte Phase 3.7 — Workflow Integrity & RLS Hardening
-- Migration: 20261002130000_phase3_7_rls_integrity_hardening.sql
-- Description:
-- 1. Restricts unassigned REQUESTED repair ticket visibility and updates
--    strictly to authenticated technicians and admins (preventing cross-farmer leakage).
-- 2. Restricts unassigned REQUESTED notes/timeline visibility to technicians and admins.
-- 3. Grants assigned technicians (and admins) UPDATE permissions on equipment
--    so machinery status can be transitioned back to 'Operational' upon repair completion.
-- ==============================================================================

-- 1. HARDEN REPAIR_REQUESTS SELECT POLICY
DROP POLICY IF EXISTS "Repair requests view policy" ON public.repair_requests;
CREATE POLICY "Repair requests view policy"
ON public.repair_requests
FOR SELECT
TO authenticated
USING (
  farmer_id = public.current_profile_id()
  OR technician_id = public.current_profile_id()
  OR (
    public.current_user_role() = 'technician'::public.user_role
    AND technician_id IS NULL
    AND status = 'REQUESTED'::public.repair_status
  )
  OR public.current_user_role() = 'admin'::public.user_role
);

-- 2. HARDEN REPAIR_REQUESTS UPDATE POLICY
DROP POLICY IF EXISTS "Authorized participants can update repair requests" ON public.repair_requests;
CREATE POLICY "Authorized participants can update repair requests"
ON public.repair_requests
FOR UPDATE
TO authenticated
USING (
  farmer_id = public.current_profile_id()
  OR technician_id = public.current_profile_id()
  OR (
    public.current_user_role() = 'technician'::public.user_role
    AND technician_id IS NULL
    AND status = 'REQUESTED'::public.repair_status
  )
  OR public.current_user_role() = 'admin'::public.user_role
);

-- 3. HARDEN REPAIR_NOTES VIEW POLICY
DROP POLICY IF EXISTS "Repair notes view policy" ON public.repair_notes;
CREATE POLICY "Repair notes view policy"
ON public.repair_notes
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.repair_requests r
    WHERE r.id = repair_notes.repair_request_id
      AND (
        r.farmer_id = public.current_profile_id()
        OR r.technician_id = public.current_profile_id()
        OR (
          public.current_user_role() = 'technician'::public.user_role
          AND r.technician_id IS NULL
          AND r.status = 'REQUESTED'::public.repair_status
        )
        OR public.current_user_role() = 'admin'::public.user_role
      )
  )
);

-- 4. HARDEN REPAIR_TIMELINE VIEW POLICY
DROP POLICY IF EXISTS "Repair timeline view policy" ON public.repair_timeline;
CREATE POLICY "Repair timeline view policy"
ON public.repair_timeline
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.repair_requests r
    WHERE r.id = repair_timeline.repair_request_id
      AND (
        r.farmer_id = public.current_profile_id()
        OR r.technician_id = public.current_profile_id()
        OR (
          public.current_user_role() = 'technician'::public.user_role
          AND r.technician_id IS NULL
          AND r.status = 'REQUESTED'::public.repair_status
        )
        OR public.current_user_role() = 'admin'::public.user_role
      )
  )
);

-- 5. ALLOW PARTICIPATING TECHNICIANS (AND ADMINS) TO UPDATE EQUIPMENT STATUS
DROP POLICY IF EXISTS "Farmers can update own equipment" ON public.equipment;
DROP POLICY IF EXISTS "Authorized participants can update equipment" ON public.equipment;

CREATE POLICY "Authorized participants can update equipment"
ON public.equipment
FOR UPDATE
TO authenticated
USING (
  farmer_id = public.current_profile_id()
  OR (
    public.current_user_role() = 'technician'::public.user_role
    AND EXISTS (
      SELECT 1 FROM public.repair_requests r
      WHERE r.equipment_id = equipment.id
        AND r.technician_id = public.current_profile_id()
    )
  )
  OR public.current_user_role() = 'admin'::public.user_role
)
WITH CHECK (
  farmer_id = public.current_profile_id()
  OR (
    public.current_user_role() = 'technician'::public.user_role
    AND EXISTS (
      SELECT 1 FROM public.repair_requests r
      WHERE r.equipment_id = equipment.id
        AND r.technician_id = public.current_profile_id()
    )
  )
  OR public.current_user_role() = 'admin'::public.user_role
);
