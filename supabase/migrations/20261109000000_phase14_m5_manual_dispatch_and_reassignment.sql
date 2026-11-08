-- ==============================================================================
-- TerraByte Phase 14 Milestone 5 Forward Migration
-- Migration: 20261109000000_phase14_m5_manual_dispatch_and_reassignment.sql
-- Description:
-- 1. Creates public.repair_assignment_history table for chronological tracking of
--    technician dispatch and reassignment events.
-- 2. Revokes direct client UPDATE (technician_id) on repair_requests from authenticated
--    to prevent unauthorized or untracked client-side assignments (DAC Hardening).
-- 3. Implements public.admin_dispatch_technician SECURITY DEFINER RPC with row-level
--    locking (SELECT ... FOR UPDATE), OCC concurrency check, duplicate assignment check,
--    mandatory reassignment reason check, eligibility validation, and dual-table audit logging.
-- 4. Implements public.get_repair_assignment_history SECURITY DEFINER RPC for
--    structured retrieval of chronological assignment history with participant names.
-- 5. Configures Row Level Security (RLS) on public.repair_assignment_history.
-- ==============================================================================

-- 1. Create repair_assignment_history table
CREATE TABLE IF NOT EXISTS public.repair_assignment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_request_id UUID NOT NULL REFERENCES public.repair_requests(id) ON DELETE CASCADE,
  previous_technician_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_technician_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  assigned_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  assigned_by_role TEXT NOT NULL CHECK (assigned_by_role IN ('admin', 'service_centre', 'farmer')),
  assignment_type TEXT NOT NULL CHECK (assignment_type IN ('DISPATCH', 'REASSIGNMENT')),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

-- Indexes for performance and sorting
CREATE INDEX IF NOT EXISTS idx_repair_assignment_history_repair_id
  ON public.repair_assignment_history(repair_request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_repair_assignment_history_assigned_tech
  ON public.repair_assignment_history(assigned_technician_id);

CREATE INDEX IF NOT EXISTS idx_repair_assignment_history_prev_tech
  ON public.repair_assignment_history(previous_technician_id);

-- 2. DAC Hardening: Revoke direct client mutation of technician_id on repair_requests
-- All assignment mutations must execute through authorized SECURITY DEFINER RPCs.
REVOKE UPDATE (technician_id) ON public.repair_requests FROM authenticated;

-- 3. Row Level Security on repair_assignment_history
ALTER TABLE public.repair_assignment_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view all repair assignment history" ON public.repair_assignment_history;
CREATE POLICY "Admins can view all repair assignment history"
  ON public.repair_assignment_history FOR SELECT
  TO authenticated
  USING (
    public.current_user_role()::text IN ('admin', 'service_centre')
  );

DROP POLICY IF EXISTS "Farmers can view assignment history for their repairs" ON public.repair_assignment_history;
CREATE POLICY "Farmers can view assignment history for their repairs"
  ON public.repair_assignment_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.repair_requests rr
      WHERE rr.id = repair_assignment_history.repair_request_id
        AND rr.farmer_id = public.current_profile_id()
    )
  );

DROP POLICY IF EXISTS "Technicians can view their own assignment history" ON public.repair_assignment_history;
DROP POLICY IF EXISTS "Technicians can view assigned repair history" ON public.repair_assignment_history;
CREATE POLICY "Technicians can view assigned repair history"
  ON public.repair_assignment_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.repair_requests rr
      WHERE rr.id = repair_assignment_history.repair_request_id
        AND rr.technician_id = public.current_profile_id()
    )
  );

-- Disallow direct client writes
REVOKE ALL ON public.repair_assignment_history FROM PUBLIC;
REVOKE ALL ON public.repair_assignment_history FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.repair_assignment_history FROM authenticated;
GRANT SELECT ON public.repair_assignment_history TO authenticated;
GRANT ALL ON public.repair_assignment_history TO service_role;

-- 4. RPC: admin_dispatch_technician
DROP FUNCTION IF EXISTS public.admin_dispatch_technician(UUID, UUID, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.admin_dispatch_technician(
  p_repair_request_id UUID,
  p_technician_id UUID,
  p_reassignment_reason TEXT DEFAULT NULL,
  p_expected_current_technician_id UUID DEFAULT NULL
)
RETURNS public.repair_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_profile_id UUID;
  v_caller_role TEXT;
  v_repair RECORD;
  v_tech_profile RECORD;
  v_prev_tech_id UUID;
  v_assignment_type TEXT;
  v_history_id UUID;
  v_timeline_status TEXT;
  v_timeline_note TEXT;
  v_tech_name TEXT;
  v_workshop_name TEXT;
  v_prev_tech_name TEXT;
  v_result public.repair_requests;
BEGIN
  -- 1. Identity & Role Verification
  v_caller_profile_id := public.current_profile_id();
  IF v_caller_profile_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.'
      USING ERRCODE = '42501';
  END IF;

  v_caller_role := public.current_user_role()::text;
  IF v_caller_role NOT IN ('admin', 'service_centre') THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Only Service Centre administrators can dispatch or reassign technicians.'
      USING ERRCODE = '42501';
  END IF;

  IF p_repair_request_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Repair request ID is required.'
      USING ERRCODE = '22000';
  END IF;

  IF p_technician_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Technician ID is required.'
      USING ERRCODE = '22000';
  END IF;

  -- 2. Concurrency Lock: Lock repair_requests row FOR UPDATE
  SELECT id, job_number, farmer_id, technician_id, status, declined_by, handover_status
  INTO v_repair
  FROM public.repair_requests
  WHERE id = p_repair_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Repair request % does not exist.', p_repair_request_id
      USING ERRCODE = '02000';
  END IF;

  -- 3. Explicit Lifecycle Transition Allowlist & Handover State Check
  IF v_repair.status NOT IN ('REQUESTED', 'ACCEPTED', 'QUOTE_PENDING', 'QUOTE_REVISED', 'IN_PROGRESS', 'WAITING_FOR_PARTS') THEN
    RAISE EXCEPTION 'INVALID_STATE: Cannot assign or reassign technician on a % repair request.', v_repair.status
      USING ERRCODE = '22000';
  END IF;

  IF v_repair.handover_status IN ('AUTHORIZED', 'RELEASED') THEN
    RAISE EXCEPTION 'INVALID_STATE: Cannot assign or reassign technician when equipment handover is %.', v_repair.handover_status
      USING ERRCODE = '22000';
  END IF;

  -- Initial dispatch requires REQUESTED status
  IF v_repair.technician_id IS NULL AND v_repair.status != 'REQUESTED' THEN
    RAISE EXCEPTION 'INVALID_STATE: Initial dispatch is only permitted on repair in REQUESTED status.'
      USING ERRCODE = '22000';
  END IF;

  -- 4. Optimistic Concurrency Control (OCC) Check
  IF p_expected_current_technician_id IS NOT NULL AND v_repair.technician_id IS DISTINCT FROM p_expected_current_technician_id THEN
    RAISE EXCEPTION 'CONCURRENT_MUTATION: The repair assignment was modified by another dispatcher. Please refresh.'
      USING ERRCODE = '40001';
  END IF;

  -- 5. Duplicate Assignment Prevention
  IF v_repair.technician_id = p_technician_id THEN
    RAISE EXCEPTION 'DUPLICATE_ASSIGNMENT: Technician % is already assigned to this repair request.', p_technician_id
      USING ERRCODE = '22000';
  END IF;

  -- 6. Mandatory Reassignment Reason
  v_prev_tech_id := v_repair.technician_id;
  IF v_prev_tech_id IS NOT NULL THEN
    v_assignment_type := 'REASSIGNMENT';
    IF p_reassignment_reason IS NULL OR pg_catalog.btrim(p_reassignment_reason) = '' THEN
      RAISE EXCEPTION 'REASON_REQUIRED: A mandatory reason is required to reassign an active technician.'
        USING ERRCODE = '22000';
    END IF;
  ELSE
    v_assignment_type := 'DISPATCH';
  END IF;

  -- 7. Validate Candidate Technician Existence, Role & Verification
  SELECT tp.profile_id, tp.workshop_name, tp.is_verified, p.full_name, p.role
  INTO v_tech_profile
  FROM public.technician_profiles tp
  JOIN public.profiles p ON p.id = tp.profile_id
  WHERE tp.profile_id = p_technician_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Selected technician profile % was not found.', p_technician_id
      USING ERRCODE = '02000';
  END IF;

  IF v_tech_profile.role != 'technician' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Selected profile % is not a registered technician.', p_technician_id
      USING ERRCODE = '22000';
  END IF;

  IF NOT v_tech_profile.is_verified THEN
    RAISE EXCEPTION 'TECHNICIAN_NOT_VERIFIED: Selected technician % has not been verified by the Service Centre.', p_technician_id
      USING ERRCODE = '22000';
  END IF;

  IF v_repair.declined_by IS NOT NULL AND p_technician_id = ANY(v_repair.declined_by) THEN
    RAISE EXCEPTION 'TECHNICIAN_DECLINED: Selected technician % has already declined this repair request.', p_technician_id
      USING ERRCODE = '22000';
  END IF;

  v_tech_name := COALESCE(v_tech_profile.full_name, 'Technician');
  v_workshop_name := COALESCE(v_tech_profile.workshop_name, 'Field Workshop');

  -- Resolve previous tech name if reassigning
  IF v_prev_tech_id IS NOT NULL THEN
    SELECT p.full_name INTO v_prev_tech_name
    FROM public.profiles p
    WHERE p.id = v_prev_tech_id;
    v_prev_tech_name := COALESCE(v_prev_tech_name, 'Previous Technician');
  END IF;

  -- 8. Atomic Updates
  UPDATE public.repair_requests
  SET technician_id = p_technician_id,
      status_since = pg_catalog.now()
  WHERE id = p_repair_request_id;

  -- Insert into repair_assignment_history
  INSERT INTO public.repair_assignment_history (
    repair_request_id,
    previous_technician_id,
    assigned_technician_id,
    assigned_by,
    assigned_by_role,
    assignment_type,
    reason
  ) VALUES (
    p_repair_request_id,
    v_prev_tech_id,
    p_technician_id,
    v_caller_profile_id,
    v_caller_role,
    v_assignment_type,
    p_reassignment_reason
  )
  RETURNING id INTO v_history_id;

  -- Insert into repair_timeline
  IF v_assignment_type = 'DISPATCH' THEN
    v_timeline_status := 'DISPATCHED';
    v_timeline_note := 'Technician assigned: ' || v_tech_name || ' (' || v_workshop_name || ')';
  ELSE
    v_timeline_status := 'REASSIGNED';
    v_timeline_note := 'Technician reassigned from ' || v_prev_tech_name || ' to ' || v_tech_name || ' (' || v_workshop_name || '). Reason: ' || p_reassignment_reason;
  END IF;

  INSERT INTO public.repair_timeline (
    repair_request_id,
    status,
    note,
    created_by_role,
    created_by_id
  ) VALUES (
    p_repair_request_id,
    v_timeline_status,
    v_timeline_note,
    'admin',
    v_caller_profile_id
  );

  SELECT * INTO v_result
  FROM public.repair_requests
  WHERE id = p_repair_request_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_dispatch_technician FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_dispatch_technician FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_dispatch_technician TO authenticated, service_role;

-- 5. RPC: get_repair_assignment_history
CREATE OR REPLACE FUNCTION public.get_repair_assignment_history(
  p_repair_request_id UUID
)
RETURNS TABLE (
  id UUID,
  repair_request_id UUID,
  previous_technician_id UUID,
  previous_technician_name TEXT,
  assigned_technician_id UUID,
  assigned_technician_name TEXT,
  assigned_by UUID,
  assigned_by_name TEXT,
  assigned_by_role TEXT,
  assignment_type TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_profile_id UUID;
  v_caller_role TEXT;
  v_is_authorized BOOLEAN := FALSE;
BEGIN
  v_caller_profile_id := public.current_profile_id();
  IF v_caller_profile_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.'
      USING ERRCODE = '42501';
  END IF;

  v_caller_role := public.current_user_role()::text;

  -- Verify authorization: Admin/Service Centre OR ticket farmer OR currently assigned tech
  IF v_caller_role IN ('admin', 'service_centre') THEN
    v_is_authorized := TRUE;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.repair_requests rr
      WHERE rr.id = p_repair_request_id AND rr.farmer_id = v_caller_profile_id
    ) THEN
      v_is_authorized := TRUE;
    ELSIF EXISTS (
      SELECT 1 FROM public.repair_requests rr
      WHERE rr.id = p_repair_request_id AND rr.technician_id = v_caller_profile_id
    ) THEN
      v_is_authorized := TRUE;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'UNAUTHORIZED: You do not have permission to view assignment history for this repair request.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    rah.id,
    rah.repair_request_id,
    rah.previous_technician_id,
    prev_p.full_name AS previous_technician_name,
    rah.assigned_technician_id,
    curr_p.full_name AS assigned_technician_name,
    rah.assigned_by,
    actor_p.full_name AS assigned_by_name,
    rah.assigned_by_role,
    rah.assignment_type,
    rah.reason,
    rah.created_at
  FROM public.repair_assignment_history rah
  LEFT JOIN public.profiles prev_p ON prev_p.id = rah.previous_technician_id
  JOIN public.profiles curr_p ON curr_p.id = rah.assigned_technician_id
  JOIN public.profiles actor_p ON actor_p.id = rah.assigned_by
  WHERE rah.repair_request_id = p_repair_request_id
  ORDER BY rah.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_repair_assignment_history FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_repair_assignment_history FROM anon;
GRANT EXECUTE ON FUNCTION public.get_repair_assignment_history TO authenticated, service_role;

-- 6. RPC: farmer_request_technician
-- Allows machinery owners to nominate an initial technician for their unassigned repairs in REQUESTED state.
DROP FUNCTION IF EXISTS public.farmer_request_technician(UUID, UUID);

CREATE OR REPLACE FUNCTION public.farmer_request_technician(
  p_repair_request_id UUID,
  p_technician_id UUID
)
RETURNS public.repair_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_profile_id UUID;
  v_caller_role TEXT;
  v_repair RECORD;
  v_tech_profile RECORD;
  v_tech_name TEXT;
  v_workshop_name TEXT;
  v_history_id UUID;
  v_result public.repair_requests;
BEGIN
  -- 1. Identity & Role Verification
  v_caller_profile_id := public.current_profile_id();
  IF v_caller_profile_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.'
      USING ERRCODE = '42501';
  END IF;

  v_caller_role := public.current_user_role()::text;
  IF v_caller_role != 'farmer' THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Only machinery owners can request or nominate a technician.'
      USING ERRCODE = '42501';
  END IF;

  IF p_repair_request_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Repair request ID is required.'
      USING ERRCODE = '22000';
  END IF;

  IF p_technician_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Technician ID is required.'
      USING ERRCODE = '22000';
  END IF;

  -- 2. Concurrency Lock: Lock repair_requests row FOR UPDATE
  SELECT id, job_number, farmer_id, technician_id, status, declined_by, handover_status
  INTO v_repair
  FROM public.repair_requests
  WHERE id = p_repair_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Repair request % does not exist.', p_repair_request_id
      USING ERRCODE = '02000';
  END IF;

  -- 3. Ownership Verification
  IF v_repair.farmer_id != v_caller_profile_id THEN
    RAISE EXCEPTION 'UNAUTHORIZED: You can only request technicians for your own machinery repair requests.'
      USING ERRCODE = '42501';
  END IF;

  -- 4. Status Check: Farmers can only nominate while ticket is in REQUESTED status and unassigned
  IF v_repair.status != 'REQUESTED' THEN
    RAISE EXCEPTION 'INVALID_STATE: Cannot select technician: Repair request is already in % stage. Contact Service Centre.', v_repair.status
      USING ERRCODE = '22000';
  END IF;

  IF v_repair.technician_id IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID_STATE: A technician is already assigned to this repair. Only Service Centre administrators can reassign technicians.'
      USING ERRCODE = '42501';
  END IF;

  IF v_repair.handover_status IN ('AUTHORIZED', 'RELEASED') THEN
    RAISE EXCEPTION 'INVALID_STATE: Cannot assign technician when equipment handover is %.', v_repair.handover_status
      USING ERRCODE = '22000';
  END IF;

  -- 5. Validate Candidate Technician
  SELECT tp.profile_id, tp.workshop_name, tp.is_verified, p.full_name, p.role
  INTO v_tech_profile
  FROM public.technician_profiles tp
  JOIN public.profiles p ON p.id = tp.profile_id
  WHERE tp.profile_id = p_technician_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Selected technician profile % was not found.', p_technician_id
      USING ERRCODE = '02000';
  END IF;

  IF v_tech_profile.role != 'technician' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Selected profile % is not a registered technician.', p_technician_id
      USING ERRCODE = '22000';
  END IF;

  IF NOT v_tech_profile.is_verified THEN
    RAISE EXCEPTION 'TECHNICIAN_NOT_VERIFIED: Selected technician % has not been verified by the Service Centre.', p_technician_id
      USING ERRCODE = '22000';
  END IF;

  IF v_repair.declined_by IS NOT NULL AND p_technician_id = ANY(v_repair.declined_by) THEN
    RAISE EXCEPTION 'TECHNICIAN_DECLINED: Selected technician % has already declined this repair request.', p_technician_id
      USING ERRCODE = '22000';
  END IF;

  v_tech_name := COALESCE(v_tech_profile.full_name, 'Technician');
  v_workshop_name := COALESCE(v_tech_profile.workshop_name, 'Field Workshop');

  -- 6. Atomic Mutation
  UPDATE public.repair_requests
  SET technician_id = p_technician_id,
      status_since = pg_catalog.now()
  WHERE id = p_repair_request_id;

  -- Insert into repair_assignment_history
  INSERT INTO public.repair_assignment_history (
    repair_request_id,
    previous_technician_id,
    assigned_technician_id,
    assigned_by,
    assigned_by_role,
    assignment_type,
    reason
  ) VALUES (
    p_repair_request_id,
    NULL,
    p_technician_id,
    v_caller_profile_id,
    'farmer',
    'DISPATCH',
    'Selected by machinery owner'
  )
  RETURNING id INTO v_history_id;

  -- Insert into repair_timeline
  INSERT INTO public.repair_timeline (
    repair_request_id,
    status,
    note,
    created_by_role,
    created_by_id
  ) VALUES (
    p_repair_request_id,
    'REQUESTED',
    'Technician requested by farmer: ' || v_tech_name || ' (' || v_workshop_name || ')',
    'farmer',
    v_caller_profile_id
  );

  SELECT * INTO v_result
  FROM public.repair_requests
  WHERE id = p_repair_request_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.farmer_request_technician FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.farmer_request_technician FROM anon;
GRANT EXECUTE ON FUNCTION public.farmer_request_technician TO authenticated, service_role;

-- 7. Former Technician Access Revocation Hardening on Quotes & Parts Requests

-- 7.1 Quotes: Tie technician visibility & management to current repair technician
DROP POLICY IF EXISTS "Quotes view policy" ON public.quotes;
CREATE POLICY "Quotes view policy"
  ON public.quotes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.repair_requests r
      WHERE r.id = quotes.repair_request_id
        AND (r.technician_id = public.current_profile_id() OR r.farmer_id = public.current_profile_id())
    )
    OR public.current_user_role()::text IN ('admin', 'service_centre')
  );

DROP POLICY IF EXISTS "Authorized users can update quotes" ON public.quotes;
CREATE POLICY "Authorized users can update quotes"
  ON public.quotes FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.repair_requests r
      WHERE r.id = quotes.repair_request_id
        AND (r.technician_id = public.current_profile_id() OR r.farmer_id = public.current_profile_id())
    )
    OR public.current_user_role()::text IN ('admin', 'service_centre')
  );

DROP POLICY IF EXISTS "Technicians can create quotes" ON public.quotes;
CREATE POLICY "Technicians can create quotes"
  ON public.quotes FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      technician_id = public.current_profile_id()
      AND EXISTS (
        SELECT 1 FROM public.repair_requests r
        WHERE r.id = quotes.repair_request_id
          AND r.technician_id = public.current_profile_id()
          AND r.status NOT IN ('COMPLETED', 'CANCELLED', 'CANCELLATION_REQUESTED')
      )
    )
    OR public.current_user_role()::text IN ('admin', 'service_centre')
  );

-- 7.2 Quote Items: Tie technician visibility & management to current repair technician
DROP POLICY IF EXISTS "Quote items view policy" ON public.quote_items;
CREATE POLICY "Quote items view policy"
  ON public.quote_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.quotes q
      JOIN public.repair_requests r ON r.id = q.repair_request_id
      WHERE q.id = quote_items.quote_id
        AND (r.technician_id = public.current_profile_id() OR r.farmer_id = public.current_profile_id())
    )
    OR public.current_user_role()::text IN ('admin', 'service_centre')
  );

DROP POLICY IF EXISTS "Quote items manage policy" ON public.quote_items;
CREATE POLICY "Quote items manage policy"
  ON public.quote_items FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.quotes q
      JOIN public.repair_requests r ON r.id = q.repair_request_id
      WHERE q.id = quote_items.quote_id
        AND r.technician_id = public.current_profile_id()
    )
    OR public.current_user_role()::text IN ('admin', 'service_centre')
  );

-- 7.3 Service Centre Part Requests: Tie technician visibility to current repair technician
DROP POLICY IF EXISTS "Technicians can view part requests for their assigned repairs" ON public.service_centre_part_requests;
CREATE POLICY "Technicians can view part requests for their assigned repairs"
  ON public.service_centre_part_requests FOR SELECT
  TO authenticated
  USING (
    (
      public.current_user_role() = 'technician'::public.user_role
      AND EXISTS (
        SELECT 1 FROM public.repair_requests r
        WHERE r.id = service_centre_part_requests.repair_request_id
          AND r.technician_id = public.current_profile_id()
      )
    )
    OR public.current_user_role()::text IN ('admin', 'service_centre')
  );

