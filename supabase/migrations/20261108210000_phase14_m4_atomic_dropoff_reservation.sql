-- ==============================================================================
-- TerraByte Migration: 20261108210000_phase14_m4_atomic_dropoff_reservation.sql
-- Description: Phase 14 Milestone 4 - Atomic Drop-Off Intake & Role Isolation
-- Scope:
--   1. Transactional RPC public.submit_workshop_dropoff_repair:
--      - Single database transaction for intake persistence & bay reservation
--      - Atomically aborts repair creation if bay capacity is exhausted or reservation fails
--      - Invokes trusted M1 reserve_workshop_bay directly (zero logic duplication)
--      - Prevents orphan WORKSHOP_DROPOFF repair requests without frontend cancellation
--   2. Strict Workshop Manager & Staff Authorization Hardening:
--      - Limits execute_workshop_dropoff_checkin to Admin and facility OWNER/MANAGER
--      - Strictly denies farmers, ordinary technicians, and foreign facility managers
--      - Limits release_cancelled_workshop_equipment to Admin and facility OWNER/MANAGER
--      - Strictly denies farmers, ordinary technicians, and foreign facility managers
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TRANSACTIONAL WORKSHOP DROP-OFF REPAIR INTAKE & RESERVATION RPC
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_workshop_dropoff_repair(
  p_equipment_id UUID,
  p_facility_id UUID,
  p_symptoms TEXT[],
  p_description TEXT,
  p_location TEXT,
  p_photos TEXT[] DEFAULT '{}'::TEXT[],
  p_assessment JSONB DEFAULT '{}'::JSONB,
  p_gps_lat DOUBLE PRECISION DEFAULT NULL,
  p_gps_lng DOUBLE PRECISION DEFAULT NULL,
  p_gps_acc DOUBLE PRECISION DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_profile_id UUID := public.current_profile_id();
  v_caller_role TEXT := public.current_user_role()::text;
  v_job_number TEXT;
  v_repair_id UUID;
  v_reservation_res JSONB;
BEGIN
  IF v_caller_profile_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
  END IF;

  -- 1. Validate equipment ownership and operational status
  PERFORM 1 FROM public.equipment
  WHERE id = p_equipment_id
    AND (farmer_id = v_caller_profile_id OR v_caller_role IN ('admin', 'service_centre'))
    AND status != 'In Repair';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_EQUIPMENT: Equipment not found, not owned by authenticated farmer, or already in repair.'
      USING ERRCODE = '22000';
  END IF;

  -- 2. Validate facility exists, is active, and is approved for drop-offs
  PERFORM 1 FROM public.repair_facilities
  WHERE id = p_facility_id AND is_active = TRUE AND drop_off_approved = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FACILITY_UNAVAILABLE: Facility is inactive or not approved for drop-off.'
      USING ERRCODE = '22000';
  END IF;

  -- 3. Generate unique job number
  v_job_number := 'TB-' || pg_catalog.lpad(pg_catalog.floor(pg_catalog.random() * 9000 + 1000)::text, 4, '0');

  -- 4. Insert repair request with delivery_mode = WORKSHOP_DROPOFF
  INSERT INTO public.repair_requests (
    job_number, equipment_id, farmer_id, status, is_testing,
    symptoms, description, photos, location, assessment,
    status_since, delivery_mode, is_immobile, facility_id
  ) VALUES (
    v_job_number, p_equipment_id, v_caller_profile_id, 'REQUESTED', FALSE,
    p_symptoms, COALESCE(p_description, ''), COALESCE(p_photos, '{}'::TEXT[]), p_location, COALESCE(p_assessment, '{}'::JSONB),
    pg_catalog.now(), 'WORKSHOP_DROPOFF', FALSE, p_facility_id
  ) RETURNING id INTO v_repair_id;

  -- 5. Optional dispatch location
  IF p_gps_lat IS NOT NULL AND p_gps_lng IS NOT NULL THEN
    INSERT INTO public.repair_dispatch_locations (
      repair_request_id, latitude, longitude, accuracy, captured_at
    ) VALUES (
      v_repair_id, p_gps_lat, p_gps_lng, p_gps_acc, pg_catalog.now()
    );
  END IF;

  -- 6. Advance equipment status to 'In Repair'
  UPDATE public.equipment
  SET status = 'In Repair', updated_at = pg_catalog.now()
  WHERE id = p_equipment_id;

  -- 7. Call trusted M1 reserve_workshop_bay RPC directly (Zero logic duplication)
  v_reservation_res := public.reserve_workshop_bay(v_repair_id, p_facility_id, INTERVAL '24 hours');

  -- 8. Atomicity check: If bay reservation was rejected (e.g. CAPACITY_EXHAUSTED), ABORT transaction
  IF v_reservation_res IS NULL OR (v_reservation_res->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'BAY_RESERVATION_FAILED: %', COALESCE(v_reservation_res->>'message', 'Workshop bay reservation failed.')
      USING ERRCODE = '22000';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'repair_id', v_repair_id,
    'job_number', v_job_number,
    'reservation', v_reservation_res
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_workshop_dropoff_repair FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_workshop_dropoff_repair FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_workshop_dropoff_repair TO authenticated, service_role;


-- ------------------------------------------------------------------------------
-- 2. HARDENED CHECK-IN & PHYSICAL RELEASE AUTHORIZATION
-- ------------------------------------------------------------------------------

-- Update execute_workshop_dropoff_checkin to strictly require Admin or facility OWNER/MANAGER
CREATE OR REPLACE FUNCTION public.execute_workshop_dropoff_checkin(
  p_repair_request_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_profile_id UUID := public.current_profile_id();
  v_caller_role TEXT := public.current_user_role()::text;
  v_repair RECORD;
  v_facility RECORD;
  v_reservation RECORD;
  v_is_facility_manager BOOLEAN := FALSE;
  v_physical_occupancy INTEGER := 0;
  v_active_reservations INTEGER := 0;
  v_earlier_active_reservations INTEGER := 0;
  v_total_committed INTEGER := 0;
  v_receipt_number TEXT;
  v_now TIMESTAMPTZ := pg_catalog.now();
  v_is_standby BOOLEAN := FALSE;
BEGIN
  -- 1. Security & Precondition Validation
  IF v_caller_profile_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
  END IF;

  -- Read Repair Request for facility resolution
  SELECT id, farmer_id, technician_id, facility_id, delivery_mode, status,
         dropped_off_at, drop_off_receipt_number, handover_status
  INTO v_repair
  FROM public.repair_requests
  WHERE id = p_repair_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Repair request does not exist.' USING ERRCODE = '02000';
  END IF;

  IF v_repair.delivery_mode != 'WORKSHOP_DROPOFF' THEN
    RAISE EXCEPTION 'INVALID_DELIVERY_MODE: Only WORKSHOP_DROPOFF tickets can execute physical drop-off check-in.'
      USING ERRCODE = '22000';
  END IF;

  IF v_repair.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'INVALID_STATE: Cannot check in equipment for a completed or cancelled repair ticket.'
      USING ERRCODE = '22000';
  END IF;

  IF v_repair.handover_status = 'RELEASED' THEN
    RAISE EXCEPTION 'INVALID_STATE: Equipment has already been released from workshop.'
      USING ERRCODE = '22000';
  END IF;

  IF v_repair.facility_id IS NULL THEN
    RAISE EXCEPTION 'FACILITY_UNASSIGNED: Repair ticket has no bound facility.'
      USING ERRCODE = '22000';
  END IF;

  -- 2. Lock Facility Row FIRST for Concurrency Serialization & Deadlock Freedom
  SELECT id, name, max_equipment_capacity, is_active, drop_off_approved
  INTO v_facility
  FROM public.repair_facilities
  WHERE id = v_repair.facility_id
  FOR UPDATE;

  IF NOT (v_facility.is_active AND v_facility.drop_off_approved) THEN
    RAISE EXCEPTION 'FACILITY_UNAVAILABLE: Facility is inactive or not approved for drop-offs.'
      USING ERRCODE = '22000';
  END IF;

  -- 3. Lock Repair Request SECOND
  SELECT id, farmer_id, technician_id, facility_id, delivery_mode, status,
         dropped_off_at, drop_off_receipt_number, handover_status
  INTO v_repair
  FROM public.repair_requests
  WHERE id = p_repair_request_id
  FOR UPDATE;

  -- Authorization check: Admin OR Active Facility Manager/Owner (Strictly denies technicians and farmers)
  SELECT EXISTS (
    SELECT 1 FROM public.facility_memberships fm
    WHERE fm.facility_id = v_repair.facility_id
      AND fm.technician_profile_id = v_caller_profile_id
      AND fm.status = 'ACTIVE'
      AND fm.role IN ('OWNER', 'MANAGER')
  ) INTO v_is_facility_manager;

  IF NOT (v_caller_role IN ('admin', 'service_centre') OR v_is_facility_manager) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Caller is not authorized to check in equipment at this facility. Must be Admin or Workshop Manager.'
      USING ERRCODE = '42501';
  END IF;

  -- 4. Idempotency Guard: Repeated check-in returns existing receipt safely
  IF v_repair.dropped_off_at IS NOT NULL AND v_repair.drop_off_receipt_number IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', true,
      'already_checked_in', true,
      'receipt_number', v_repair.drop_off_receipt_number,
      'dropped_off_at', v_repair.dropped_off_at,
      'facility_id', v_repair.facility_id
    );
  END IF;

  -- 5. Lock Reservation Row THIRD (if exists)
  SELECT id, status, expires_at, priority_original_reserved_at
  INTO v_reservation
  FROM public.facility_bay_reservations
  WHERE repair_request_id = p_repair_request_id
  FOR UPDATE;

  -- Calculate current physical occupancy (machinery in bays not yet released)
  SELECT pg_catalog.count(*)::INTEGER
  INTO v_physical_occupancy
  FROM public.repair_requests
  WHERE facility_id = v_repair.facility_id
    AND delivery_mode = 'WORKSHOP_DROPOFF'
    AND dropped_off_at IS NOT NULL
    AND handover_status != 'RELEASED';

  -- Dual-Path Verification
  IF v_reservation.id IS NOT NULL AND v_reservation.status = 'RESERVED' AND v_reservation.expires_at > v_now THEN
    -- Path A: Active, Unexpired Reservation Holder
    v_is_standby := FALSE;

    -- Downsizing Guard: If physical occupancy >= max capacity due to downsizing
    IF v_physical_occupancy >= v_facility.max_equipment_capacity THEN
      INSERT INTO public.repair_timeline (
        repair_request_id,
        status,
        note,
        created_by_role,
        created_by_id,
        created_at
      ) VALUES (
        p_repair_request_id,
        v_repair.status::text,
        'Drop-off deferred: Workshop physically at capacity due to capacity downsizing. Active reservation priority held (DOWNSIZED_CAPACITY_HELD). Dispatcher notification emitted.',
        v_caller_role,
        v_caller_profile_id,
        v_now
      );

      RETURN pg_catalog.jsonb_build_object(
        'success', false,
        'code', 'DOWNSIZED_CAPACITY_HELD',
        'message', 'Workshop bays are physically occupied. Active reservation priority is retained.',
        'reroute_eligible', true
      );
    END IF;

    -- FIFO Check: Earlier unexpired reservation holders take precedence
    SELECT pg_catalog.count(*)::INTEGER
    INTO v_earlier_active_reservations
    FROM public.facility_bay_reservations
    WHERE facility_id = v_repair.facility_id
      AND status = 'RESERVED'
      AND expires_at > v_now
      AND priority_original_reserved_at < v_reservation.priority_original_reserved_at
      AND id != v_reservation.id;

    IF v_earlier_active_reservations >= (v_facility.max_equipment_capacity - v_physical_occupancy) THEN
      INSERT INTO public.repair_timeline (
        repair_request_id,
        status,
        note,
        created_by_role,
        created_by_id,
        created_at
      ) VALUES (
        p_repair_request_id,
        v_repair.status::text,
        'Active reservation arrival deferred: Available bay capacity is held for an earlier reservation holder (FIFO priority queue enforced). Dispatcher rerouting or turnaround offered.',
        v_caller_role,
        v_caller_profile_id,
        v_now
      );

      RETURN pg_catalog.jsonb_build_object(
        'success', false,
        'code', 'FIFO_PRIORITY_HELD',
        'message', 'Available workshop bays are held for earlier active reservation holders under FIFO priority.',
        'reroute_eligible', true,
        'priority_original_reserved_at', v_reservation.priority_original_reserved_at,
        'earlier_reservations_ahead', v_earlier_active_reservations
      );
    END IF;

  ELSE
    -- Path B: Standby Arrival (No active reservation or expired reservation)
    v_is_standby := TRUE;

    -- Calculate active reservations held by OTHER farmers
    SELECT pg_catalog.count(*)::INTEGER
    INTO v_active_reservations
    FROM public.facility_bay_reservations
    WHERE facility_id = v_repair.facility_id
      AND status = 'RESERVED'
      AND expires_at > v_now
      AND repair_request_id != p_repair_request_id;

    v_total_committed := v_physical_occupancy + v_active_reservations;

    IF v_total_committed >= v_facility.max_equipment_capacity THEN
      INSERT INTO public.repair_timeline (
        repair_request_id,
        status,
        note,
        created_by_role,
        created_by_id,
        created_at
      ) VALUES (
        p_repair_request_id,
        v_repair.status::text,
        'Standby check-in rejected: Workshop at full committed capacity (Physical Occupancy + Active Reservations exhausted). Dispatcher reroute offered.',
        v_caller_role,
        v_caller_profile_id,
        v_now
      );

      RETURN pg_catalog.jsonb_build_object(
        'success', false,
        'code', 'CAPACITY_EXHAUSTED',
        'message', 'Workshop is at full committed capacity. Standby check-in rejected.',
        'reroute_eligible', true
      );
    END IF;
  END IF;

  -- 6. Atomic Check-in Execution & Receipt Generation: RCP-TB-YYYYMMDD-XXXX
  v_receipt_number := 'RCP-TB-' ||
    pg_catalog.to_char(v_now, 'YYYYMMDD') || '-' ||
    pg_catalog.lpad(pg_catalog.nextval('public.drop_off_receipt_seq')::text, 4, '0');

  -- Update Repair Request
  UPDATE public.repair_requests
  SET dropped_off_at = v_now,
      dropped_off_by = v_caller_profile_id,
      drop_off_receipt_number = v_receipt_number,
      updated_at = v_now
  WHERE id = p_repair_request_id;

  -- Update / Create Reservation Row
  IF v_reservation.id IS NOT NULL THEN
    UPDATE public.facility_bay_reservations
    SET status = 'CLAIMED',
        claimed_at = v_now,
        updated_at = v_now
    WHERE id = v_reservation.id;
  ELSE
    INSERT INTO public.facility_bay_reservations (
      facility_id,
      repair_request_id,
      farmer_profile_id,
      status,
      reserved_at,
      expires_at,
      claimed_at,
      priority_original_reserved_at,
      created_at,
      updated_at
    ) VALUES (
      v_repair.facility_id,
      p_repair_request_id,
      v_repair.farmer_id,
      'CLAIMED',
      v_now,
      v_now,
      v_now,
      v_now,
      v_now,
      v_now
    );
  END IF;

  -- Insert Success Timeline Audit Record
  INSERT INTO public.repair_timeline (
    repair_request_id,
    status,
    note,
    created_by_role,
    created_by_id,
    created_at
  ) VALUES (
    p_repair_request_id,
    v_repair.status::text,
    CASE
      WHEN v_is_standby THEN 'Standby arrival accepted: Equipment checked in under available workshop bay capacity. Receipt: ' || v_receipt_number
      ELSE 'Equipment physically checked in at workshop. Receipt: ' || v_receipt_number
    END || CASE WHEN p_notes IS NOT NULL THEN E'\nNotes: ' || p_notes ELSE '' END,
    v_caller_role,
    v_caller_profile_id,
    v_now
  );

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'receipt_number', v_receipt_number,
    'dropped_off_at', v_now,
    'facility_id', v_repair.facility_id,
    'path', CASE WHEN v_is_standby THEN 'STANDBY' ELSE 'ACTIVE' END
  );
END;
$$;


-- Update release_cancelled_workshop_equipment to strictly require Admin or facility OWNER/MANAGER
CREATE OR REPLACE FUNCTION public.release_cancelled_workshop_equipment(
  p_repair_request_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_profile_id UUID := public.current_profile_id();
  v_caller_role TEXT := public.current_user_role()::text;
  v_repair RECORD;
  v_is_facility_manager BOOLEAN := FALSE;
  v_now TIMESTAMPTZ := pg_catalog.now();
BEGIN
  IF v_caller_profile_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
  END IF;

  -- 1. Fetch Repair Ticket Facility Reference
  SELECT id, facility_id, delivery_mode, status, dropped_off_at,
         handover_status, handover_notes
  INTO v_repair
  FROM public.repair_requests
  WHERE id = p_repair_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Repair request does not exist.' USING ERRCODE = '02000';
  END IF;

  -- 2. Lock Facility Row FIRST for Concurrency Serialization & Deadlock Freedom
  IF v_repair.facility_id IS NOT NULL THEN
    PERFORM 1
    FROM public.repair_facilities
    WHERE id = v_repair.facility_id
    FOR UPDATE;
  END IF;

  -- 3. Lock Repair Ticket SECOND
  SELECT id, facility_id, delivery_mode, status, dropped_off_at,
         handover_status, handover_notes
  INTO v_repair
  FROM public.repair_requests
  WHERE id = p_repair_request_id
  FOR UPDATE;

  -- Domain Precondition Checks
  IF v_repair.delivery_mode != 'WORKSHOP_DROPOFF' THEN
    RAISE EXCEPTION 'INVALID_DELIVERY_MODE: Only WORKSHOP_DROPOFF tickets occupy facility bays.'
      USING ERRCODE = '22000';
  END IF;

  IF v_repair.dropped_off_at IS NULL THEN
    RAISE EXCEPTION 'PRECONDITION_FAILED: Equipment was never physically dropped off at a workshop.'
      USING ERRCODE = '22000';
  END IF;

  -- Strict segregation: Only CANCELLED repairs can use this RPC
  IF v_repair.status != 'CANCELLED' THEN
    RAISE EXCEPTION 'PRECONDITION_FAILED: Only cancelled repair tickets may use cancelled equipment release. Completed repairs must follow Phase 13 handover authorization.'
      USING ERRCODE = '22000';
  END IF;

  IF v_repair.handover_status = 'RELEASED' THEN
    RAISE EXCEPTION 'ALREADY_RELEASED: Equipment has already been released from the facility.'
      USING ERRCODE = '22000';
  END IF;

  -- Authorization Check: Active Facility Manager/Owner OR Admin (Strictly denies technicians and farmers)
  IF v_repair.facility_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.facility_memberships fm
      WHERE fm.facility_id = v_repair.facility_id
        AND fm.technician_profile_id = v_caller_profile_id
        AND fm.status = 'ACTIVE'
        AND fm.role IN ('OWNER', 'MANAGER')
    ) INTO v_is_facility_manager;
  END IF;

  IF NOT (v_caller_role IN ('admin', 'service_centre') OR v_is_facility_manager) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Caller is not authorized to release equipment from this facility. Must be Admin or Workshop Manager.'
      USING ERRCODE = '42501';
  END IF;

  -- Atomic Physical Release Execution
  UPDATE public.repair_requests
  SET handover_status = 'RELEASED',
      handover_notes = COALESCE(p_notes, 'Physical release of cancelled drop-off equipment confirmed by authorized workshop staff'),
      updated_at = v_now
  WHERE id = p_repair_request_id;

  -- Release linked reservation if still holding capacity
  UPDATE public.facility_bay_reservations
  SET status = 'RELEASED',
      released_at = v_now,
      updated_at = v_now
  WHERE repair_request_id = p_repair_request_id
    AND status IN ('RESERVED', 'CLAIMED');

  -- Insert Timeline Record
  INSERT INTO public.repair_timeline (
    repair_request_id,
    status,
    note,
    created_by_role,
    created_by_id,
    created_at
  ) VALUES (
    p_repair_request_id,
    'CANCELLED',
    'Equipment physically released from workshop bay.' || CASE WHEN p_notes IS NOT NULL THEN E'\nNotes: ' || p_notes ELSE '' END,
    v_caller_role,
    v_caller_profile_id,
    v_now
  );

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'handover_status', 'RELEASED',
    'released_at', v_now,
    'facility_id', v_repair.facility_id
  );
END;
$$;
