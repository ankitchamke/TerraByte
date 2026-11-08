-- ==============================================================================
-- TerraByte Migration: 20261108100000_phase14_smart_dispatch_and_dropoff.sql
-- Description: Phase 14 Milestone 1 — Database Foundation & Domain Invariants
-- Scope:
--   1. Schema Extensions: Alter public.repair_requests (delivery_mode, is_immobile,
--      drop_off_receipt_number, dropped_off_at, dropped_off_by)
--   2. New Tables & Sequences:
--      - public.drop_off_receipt_seq (atomic sequential receipt counter)
--      - public.facility_bay_reservations (temporary bay capacity reservations with
--        configurable expiry, renewal limits, and FIFO priority timestamps)
--   3. Relational Invariants & Constraints:
--      - check_repair_delivery_mode (DOORSTEP, WORKSHOP_DROPOFF)
--      - check_immobile_delivery_mode (NOT (is_immobile = TRUE AND delivery_mode = 'WORKSHOP_DROPOFF'))
--      - check_reservation_status (RESERVED, CLAIMED, EXPIRED, RELEASED, CANCELLED)
--      - check_renewal_count (>= 0)
--   4. Hardened SECURITY DEFINER RPCs (SET search_path = ''):
--      - public.get_facility_capacity_breakdown (physical vs active committed accounting)
--      - public.reserve_workshop_bay (row-locking capacity reservation with configurable expiry)
--      - public.renew_workshop_bay_reservation (1x farmer limit, audited admin renewal)
--      - public.release_workshop_bay_reservation (safe capacity hold release)
--      - public.execute_workshop_dropoff_checkin (Path A active vs Path B standby under lock,
--        structured business rejections, immutable RCP-TB-YYYYMMDD-XXXX receipts)
--      - public.release_cancelled_workshop_equipment (authorized staff exit release for cancelled drop-offs)
--   5. Discretionary Access Control (DAC) & Row Level Security (RLS):
--      - Revoke direct client write on drop-off columns and reservations
--      - Granular read policies for farmers, workshop members, and service centre staff
-- Author: TerraByte Engineering Team
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. SCHEMA EXTENSIONS ON public.repair_requests
-- ------------------------------------------------------------------------------

ALTER TABLE public.repair_requests
  ADD COLUMN IF NOT EXISTS delivery_mode TEXT NOT NULL DEFAULT 'DOORSTEP',
  ADD COLUMN IF NOT EXISTS is_immobile BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS drop_off_receipt_number TEXT,
  ADD COLUMN IF NOT EXISTS dropped_off_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dropped_off_by UUID REFERENCES public.profiles(id);

-- Enforce valid delivery modes
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_repair_delivery_mode') THEN
    ALTER TABLE public.repair_requests
      ADD CONSTRAINT check_repair_delivery_mode
      CHECK (delivery_mode IN ('DOORSTEP', 'WORKSHOP_DROPOFF'));
  END IF;
END $$;

-- Enforce immobile machinery lock (cannot select drop-off if machine is immobile)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_immobile_delivery_mode') THEN
    ALTER TABLE public.repair_requests
      ADD CONSTRAINT check_immobile_delivery_mode
      CHECK (NOT (is_immobile = TRUE AND delivery_mode = 'WORKSHOP_DROPOFF'));
  END IF;
END $$;

-- Unique receipt number index for quick lookup and collision prevention
CREATE UNIQUE INDEX IF NOT EXISTS idx_repair_requests_drop_off_receipt
  ON public.repair_requests(drop_off_receipt_number)
  WHERE drop_off_receipt_number IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 2. SEQUENCES & RESERVATIONS TABLE
-- ------------------------------------------------------------------------------

-- Sequential counter for immutable custody receipts: RCP-TB-YYYYMMDD-XXXX
CREATE SEQUENCE IF NOT EXISTS public.drop_off_receipt_seq
  START WITH 1
  INCREMENT BY 1;

-- Facility bay reservations table
CREATE TABLE IF NOT EXISTS public.facility_bay_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES public.repair_facilities(id) ON DELETE CASCADE,
  repair_request_id UUID NOT NULL UNIQUE REFERENCES public.repair_requests(id) ON DELETE CASCADE,
  farmer_profile_id UUID NOT NULL REFERENCES public.profiles(id),
  status TEXT NOT NULL DEFAULT 'RESERVED',
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  expires_at TIMESTAMPTZ NOT NULL,
  renewal_count INTEGER NOT NULL DEFAULT 0,
  renewed_at TIMESTAMPTZ,
  renewed_by UUID REFERENCES public.profiles(id),
  renewal_notes TEXT,
  claimed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  priority_original_reserved_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT check_reservation_status CHECK (
    status IN ('RESERVED', 'CLAIMED', 'EXPIRED', 'RELEASED', 'CANCELLED')
  ),
  CONSTRAINT check_renewal_count CHECK (renewal_count >= 0)
);

-- Performance and query indexes
CREATE INDEX IF NOT EXISTS idx_facility_bay_reservations_active
  ON public.facility_bay_reservations (facility_id, status)
  WHERE status = 'RESERVED';

CREATE INDEX IF NOT EXISTS idx_facility_bay_reservations_farmer
  ON public.facility_bay_reservations (farmer_profile_id);

CREATE INDEX IF NOT EXISTS idx_facility_bay_reservations_priority
  ON public.facility_bay_reservations (facility_id, priority_original_reserved_at ASC)
  WHERE status = 'RESERVED';

-- ------------------------------------------------------------------------------
-- 3. DISCRETIONARY ACCESS CONTROL (DAC) & ROW LEVEL SECURITY (RLS)
-- ------------------------------------------------------------------------------

-- Enable RLS on reservations
ALTER TABLE public.facility_bay_reservations ENABLE ROW LEVEL SECURITY;

-- Revoke direct table-level mutations from authenticated and anon
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.facility_bay_reservations FROM authenticated, anon, PUBLIC;

-- Revoke direct client update on drop-off columns on repair_requests
REVOKE UPDATE (
  drop_off_receipt_number,
  dropped_off_at,
  dropped_off_by,
  delivery_mode,
  is_immobile
) ON TABLE public.repair_requests FROM authenticated, anon, PUBLIC;

-- RLS Policies on facility_bay_reservations (SELECT only)
DROP POLICY IF EXISTS p_farmer_select_own_reservations ON public.facility_bay_reservations;
CREATE POLICY p_farmer_select_own_reservations ON public.facility_bay_reservations
  FOR SELECT
  TO authenticated
  USING (farmer_profile_id = public.current_profile_id());

DROP POLICY IF EXISTS p_facility_member_select_reservations ON public.facility_bay_reservations;
CREATE POLICY p_facility_member_select_reservations ON public.facility_bay_reservations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facility_memberships fm
      WHERE fm.facility_id = facility_bay_reservations.facility_id
        AND fm.technician_profile_id = public.current_profile_id()
        AND fm.status = 'ACTIVE'
    )
  );

DROP POLICY IF EXISTS p_admin_select_all_reservations ON public.facility_bay_reservations;
CREATE POLICY p_admin_select_all_reservations ON public.facility_bay_reservations
  FOR SELECT
  TO authenticated
  USING (public.current_user_role()::text IN ('admin', 'service_centre'));

GRANT SELECT ON TABLE public.facility_bay_reservations TO authenticated;

-- Sequence permissions
REVOKE ALL ON SEQUENCE public.drop_off_receipt_seq FROM PUBLIC, anon;
GRANT USAGE, SELECT ON SEQUENCE public.drop_off_receipt_seq TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 4. HARDENED SECURITY DEFINER RPCS
-- ------------------------------------------------------------------------------

-- A. public.get_facility_capacity_breakdown(p_facility_id UUID)
CREATE OR REPLACE FUNCTION public.get_facility_capacity_breakdown(p_facility_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_facility RECORD;
  v_physical_occupancy INTEGER := 0;
  v_active_reservations INTEGER := 0;
  v_total_committed INTEGER := 0;
  v_available_capacity INTEGER := 0;
BEGIN
  -- 1. Fetch Facility Capacity
  SELECT id, name, max_equipment_capacity, is_active, drop_off_approved
  INTO v_facility
  FROM public.repair_facilities
  WHERE id = p_facility_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Facility does not exist.' USING ERRCODE = '02000';
  END IF;

  -- 2. Physical Occupancy: Equipment physically in bays (delivery_mode = WORKSHOP_DROPOFF,
  -- dropped_off_at IS NOT NULL, and not yet physically released)
  SELECT pg_catalog.count(*)::INTEGER
  INTO v_physical_occupancy
  FROM public.repair_requests
  WHERE facility_id = p_facility_id
    AND delivery_mode = 'WORKSHOP_DROPOFF'
    AND dropped_off_at IS NOT NULL
    AND handover_status != 'RELEASED';

  -- 3. Active Unexpired Reservations: Machines currently in transit
  SELECT pg_catalog.count(*)::INTEGER
  INTO v_active_reservations
  FROM public.facility_bay_reservations
  WHERE facility_id = p_facility_id
    AND status = 'RESERVED'
    AND expires_at > pg_catalog.now();

  v_total_committed := v_physical_occupancy + v_active_reservations;
  v_available_capacity := GREATEST(0, v_facility.max_equipment_capacity - v_total_committed);

  RETURN pg_catalog.jsonb_build_object(
    'facility_id', p_facility_id,
    'facility_name', v_facility.name,
    'max_equipment_capacity', v_facility.max_equipment_capacity,
    'physical_occupancy', v_physical_occupancy,
    'active_reservations', v_active_reservations,
    'total_committed_capacity', v_total_committed,
    'available_capacity', v_available_capacity,
    'is_at_capacity', (v_total_committed >= v_facility.max_equipment_capacity),
    'is_overcommitted', (v_total_committed > v_facility.max_equipment_capacity)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_facility_capacity_breakdown FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_facility_capacity_breakdown FROM anon;
GRANT EXECUTE ON FUNCTION public.get_facility_capacity_breakdown TO authenticated, service_role;


-- B. public.reserve_workshop_bay(p_repair_request_id UUID, p_facility_id UUID, p_expiry_interval INTERVAL)
CREATE OR REPLACE FUNCTION public.reserve_workshop_bay(
  p_repair_request_id UUID,
  p_facility_id UUID,
  p_expiry_interval INTERVAL DEFAULT INTERVAL '24 hours'
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
  v_physical_occupancy INTEGER := 0;
  v_active_reservations INTEGER := 0;
  v_total_committed INTEGER := 0;
  v_interval INTERVAL;
  v_expires_at TIMESTAMPTZ;
  v_reservation_id UUID;
BEGIN
  IF v_caller_profile_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
  END IF;

  -- 1. Lock Facility Row FIRST for Concurrency Serialization
  SELECT id, name, max_equipment_capacity, is_active, drop_off_approved
  INTO v_facility
  FROM public.repair_facilities
  WHERE id = p_facility_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Facility does not exist.' USING ERRCODE = '02000';
  END IF;

  IF NOT (v_facility.is_active AND v_facility.drop_off_approved) THEN
    RAISE EXCEPTION 'FACILITY_UNAVAILABLE: Facility is not approved for workshop drop-offs or is inactive.'
      USING ERRCODE = '22000';
  END IF;

  -- 2. Fetch & Verify Repair Request SECOND
  SELECT id, farmer_id, facility_id, delivery_mode, is_immobile, status
  INTO v_repair
  FROM public.repair_requests
  WHERE id = p_repair_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Repair request does not exist.' USING ERRCODE = '02000';
  END IF;

  -- Authorization: Owning farmer or Service Centre admin
  IF NOT (v_repair.farmer_id = v_caller_profile_id OR v_caller_role IN ('admin', 'service_centre')) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Only the owning farmer or Service Centre admin can reserve a bay.'
      USING ERRCODE = '42501';
  END IF;

  -- Domain Invariants
  IF v_repair.is_immobile THEN
    RAISE EXCEPTION 'IMMOBILE_MACHINERY: Immobile machines cannot be transported. Mode locked to DOORSTEP.'
      USING ERRCODE = '22000';
  END IF;

  IF v_repair.delivery_mode != 'WORKSHOP_DROPOFF' THEN
    RAISE EXCEPTION 'INVALID_DELIVERY_MODE: Bay reservations require delivery_mode = WORKSHOP_DROPOFF.'
      USING ERRCODE = '22000';
  END IF;

  IF v_repair.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'INVALID_STATE: Cannot reserve a bay for a completed or cancelled repair ticket.'
      USING ERRCODE = '22000';
  END IF;

  -- 3. Calculate Capacity
  SELECT pg_catalog.count(*)::INTEGER
  INTO v_physical_occupancy
  FROM public.repair_requests
  WHERE facility_id = p_facility_id
    AND delivery_mode = 'WORKSHOP_DROPOFF'
    AND dropped_off_at IS NOT NULL
    AND handover_status != 'RELEASED';

  SELECT pg_catalog.count(*)::INTEGER
  INTO v_active_reservations
  FROM public.facility_bay_reservations
  WHERE facility_id = p_facility_id
    AND status = 'RESERVED'
    AND expires_at > pg_catalog.now()
    AND repair_request_id != p_repair_request_id;

  v_total_committed := v_physical_occupancy + v_active_reservations;

  IF v_total_committed >= v_facility.max_equipment_capacity THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', false,
      'code', 'CAPACITY_EXHAUSTED',
      'message', 'Workshop has reached maximum capacity. No bay reservation available.',
      'reroute_eligible', true
    );
  END IF;

  -- 4. Calculate Expiry (Configurable interval, default 24h)
  v_interval := COALESCE(p_expiry_interval, INTERVAL '24 hours');
  IF v_interval <= INTERVAL '0 seconds' THEN
    v_interval := INTERVAL '24 hours';
  END IF;
  v_expires_at := pg_catalog.now() + v_interval;

  -- 5. Upsert / Insert Reservation Row (Preserves priority_original_reserved_at on conflict)
  INSERT INTO public.facility_bay_reservations (
    facility_id,
    repair_request_id,
    farmer_profile_id,
    status,
    reserved_at,
    expires_at,
    priority_original_reserved_at,
    created_at,
    updated_at
  ) VALUES (
    p_facility_id,
    p_repair_request_id,
    v_repair.farmer_id,
    'RESERVED',
    pg_catalog.now(),
    v_expires_at,
    pg_catalog.now(),
    pg_catalog.now(),
    pg_catalog.now()
  )
  ON CONFLICT (repair_request_id) DO UPDATE
  SET facility_id = EXCLUDED.facility_id,
      status = 'RESERVED',
      reserved_at = pg_catalog.now(),
      expires_at = EXCLUDED.expires_at,
      renewal_count = 0,
      renewed_at = NULL,
      renewed_by = NULL,
      renewal_notes = NULL,
      priority_original_reserved_at = public.facility_bay_reservations.priority_original_reserved_at,
      updated_at = pg_catalog.now()
  RETURNING id INTO v_reservation_id;

  -- Bind facility_id to repair ticket
  UPDATE public.repair_requests
  SET facility_id = p_facility_id,
      updated_at = pg_catalog.now()
  WHERE id = p_repair_request_id;

  -- 6. Insert Timeline Audit Record
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
    'Workshop bay reserved at facility ' || v_facility.name || ' (expires in ' || v_interval::text || ')',
    v_caller_role,
    v_caller_profile_id,
    pg_catalog.now()
  );

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'reservation_id', v_reservation_id,
    'facility_id', p_facility_id,
    'expires_at', v_expires_at,
    'priority_original_reserved_at', pg_catalog.now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_workshop_bay FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reserve_workshop_bay FROM anon;
GRANT EXECUTE ON FUNCTION public.reserve_workshop_bay TO authenticated, service_role;


-- C. public.renew_workshop_bay_reservation(p_reservation_id UUID, p_extension_interval INTERVAL, p_notes TEXT)
CREATE OR REPLACE FUNCTION public.renew_workshop_bay_reservation(
  p_reservation_id UUID,
  p_extension_interval INTERVAL DEFAULT INTERVAL '24 hours',
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
  v_facility_id UUID;
  v_reservation RECORD;
  v_facility RECORD;
  v_breakdown JSONB;
  v_interval INTERVAL;
  v_new_expires_at TIMESTAMPTZ;
  v_new_count INTEGER;
BEGIN
  IF v_caller_profile_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
  END IF;

  -- 1. Fetch Reservation Facility Reference
  SELECT facility_id
  INTO v_facility_id
  FROM public.facility_bay_reservations
  WHERE id = p_reservation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Reservation does not exist.' USING ERRCODE = '02000';
  END IF;

  -- 2. Lock Facility Row FIRST for Concurrency Serialization
  SELECT id, name, max_equipment_capacity
  INTO v_facility
  FROM public.repair_facilities
  WHERE id = v_facility_id
  FOR UPDATE;

  -- 3. Lock Reservation Row SECOND
  SELECT id, facility_id, repair_request_id, farmer_profile_id, status, expires_at, renewal_count, priority_original_reserved_at
  INTO v_reservation
  FROM public.facility_bay_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  -- 3. Authorization & Policy Enforcement
  IF v_reservation.farmer_profile_id = v_caller_profile_id THEN
    -- Farmer Self-Renewal: Max 1 renewal allowed
    IF v_reservation.renewal_count >= 1 THEN
      RAISE EXCEPTION 'RENEWAL_LIMIT_EXCEEDED: Farmers are limited to one self-renewal extension per reservation.'
        USING ERRCODE = '22000';
    END IF;
  ELSIF v_caller_role IN ('admin', 'service_centre') THEN
    -- Admin Renewal: Mandatory audit notes required
    IF p_notes IS NULL OR TRIM(p_notes) = '' THEN
      RAISE EXCEPTION 'AUDIT_NOTES_REQUIRED: Service Centre administrator renewal requires mandatory audit notes.'
        USING ERRCODE = '22000';
    END IF;
  ELSE
    RAISE EXCEPTION 'UNAUTHORIZED: Caller is not authorized to renew this reservation.'
      USING ERRCODE = '42501';
  END IF;

  -- 4. Calculate Extension
  v_interval := COALESCE(p_extension_interval, INTERVAL '24 hours');
  IF v_interval <= INTERVAL '0 seconds' THEN
    v_interval := INTERVAL '24 hours';
  END IF;

  v_new_expires_at := v_reservation.expires_at + v_interval;
  v_new_count := v_reservation.renewal_count + 1;

  -- 5. Update Reservation
  UPDATE public.facility_bay_reservations
  SET expires_at = v_new_expires_at,
      renewal_count = v_new_count,
      renewed_at = pg_catalog.now(),
      renewed_by = v_caller_profile_id,
      renewal_notes = p_notes,
      updated_at = pg_catalog.now()
  WHERE id = p_reservation_id;

  -- 6. Audit in repair_timeline
  INSERT INTO public.repair_timeline (
    repair_request_id,
    status,
    note,
    created_by_role,
    created_by_id,
    created_at
  ) VALUES (
    v_reservation.repair_request_id,
    'REQUESTED',
    'Workshop bay reservation renewed (extension count: ' || v_new_count::text || ', expires: ' || v_new_expires_at::text || ')' ||
      CASE WHEN p_notes IS NOT NULL THEN '. Notes: ' || p_notes ELSE '' END,
    v_caller_role,
    v_caller_profile_id,
    pg_catalog.now()
  );

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'reservation_id', p_reservation_id,
    'new_expires_at', v_new_expires_at,
    'renewal_count', v_new_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.renew_workshop_bay_reservation FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.renew_workshop_bay_reservation FROM anon;
GRANT EXECUTE ON FUNCTION public.renew_workshop_bay_reservation TO authenticated, service_role;


-- D. public.release_workshop_bay_reservation(p_repair_request_id UUID, p_reason TEXT)
CREATE OR REPLACE FUNCTION public.release_workshop_bay_reservation(
  p_repair_request_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_profile_id UUID := public.current_profile_id();
  v_caller_role TEXT := public.current_user_role()::text;
  v_reservation RECORD;
BEGIN
  IF v_caller_profile_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
  END IF;

  -- 1. Fetch Reservation Facility Reference
  SELECT id, facility_id, farmer_profile_id, status
  INTO v_reservation
  FROM public.facility_bay_reservations
  WHERE repair_request_id = p_repair_request_id;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('success', true, 'already_released', true);
  END IF;

  -- 2. Lock Facility Row FIRST for Concurrency Serialization
  IF v_reservation.facility_id IS NOT NULL THEN
    PERFORM 1
    FROM public.repair_facilities
    WHERE id = v_reservation.facility_id
    FOR UPDATE;
  END IF;

  -- 3. Lock Reservation Row SECOND
  SELECT id, facility_id, farmer_profile_id, status
  INTO v_reservation
  FROM public.facility_bay_reservations
  WHERE id = v_reservation.id
  FOR UPDATE;

  -- Authorization check
  IF NOT (
    v_reservation.farmer_profile_id = v_caller_profile_id OR
    v_caller_role IN ('admin', 'service_centre') OR
    EXISTS (
      SELECT 1 FROM public.facility_memberships fm
      WHERE fm.facility_id = v_reservation.facility_id
        AND fm.technician_profile_id = v_caller_profile_id
        AND fm.status = 'ACTIVE'
    )
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Caller cannot release this reservation.' USING ERRCODE = '42501';
  END IF;

  IF v_reservation.status = 'RESERVED' THEN
    UPDATE public.facility_bay_reservations
    SET status = 'RELEASED',
        released_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE id = v_reservation.id;

    INSERT INTO public.repair_timeline (
      repair_request_id,
      status,
      note,
      created_by_role,
      created_by_id,
      created_at
    ) VALUES (
      p_repair_request_id,
      'REQUESTED',
      'Workshop bay reservation released' || CASE WHEN p_reason IS NOT NULL THEN ': ' || p_reason ELSE '' END,
      v_caller_role,
      v_caller_profile_id,
      pg_catalog.now()
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'reservation_id', v_reservation.id,
    'status', 'RELEASED'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.release_workshop_bay_reservation FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_workshop_bay_reservation FROM anon;
GRANT EXECUTE ON FUNCTION public.release_workshop_bay_reservation TO authenticated, service_role;


-- E. public.execute_workshop_dropoff_checkin(p_repair_request_id UUID, p_notes TEXT)
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
  v_is_facility_member BOOLEAN := FALSE;
  v_physical_occupancy INTEGER := 0;
  v_active_reservations INTEGER := 0;
  v_earlier_active_reservations INTEGER := 0;
  v_total_committed INTEGER := 0;
  v_receipt_number TEXT;
  v_now TIMESTAMPTZ := pg_catalog.now();
  v_is_standby BOOLEAN := FALSE;
BEGIN
  -- ----------------------------------------------------------------------------
  -- 1. Security & Precondition Validation (Fail Closed with PostgreSQL Exceptions)
  -- ----------------------------------------------------------------------------
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

  -- ----------------------------------------------------------------------------
  -- 2. Lock Facility Row FIRST for Concurrency Serialization & Deadlock Freedom
  -- ----------------------------------------------------------------------------
  SELECT id, name, max_equipment_capacity, is_active, drop_off_approved
  INTO v_facility
  FROM public.repair_facilities
  WHERE id = v_repair.facility_id
  FOR UPDATE;

  IF NOT (v_facility.is_active AND v_facility.drop_off_approved) THEN
    RAISE EXCEPTION 'FACILITY_UNAVAILABLE: Facility is inactive or not approved for drop-offs.'
      USING ERRCODE = '22000';
  END IF;

  -- ----------------------------------------------------------------------------
  -- 3. Lock Repair Request SECOND
  -- ----------------------------------------------------------------------------
  SELECT id, farmer_id, technician_id, facility_id, delivery_mode, status,
         dropped_off_at, drop_off_receipt_number, handover_status
  INTO v_repair
  FROM public.repair_requests
  WHERE id = p_repair_request_id
  FOR UPDATE;

  -- Authorization check: Admin OR Active Facility Member
  SELECT EXISTS (
    SELECT 1 FROM public.facility_memberships fm
    WHERE fm.facility_id = v_repair.facility_id
      AND fm.technician_profile_id = v_caller_profile_id
      AND fm.status = 'ACTIVE'
  ) INTO v_is_facility_member;

  IF NOT (v_caller_role IN ('admin', 'service_centre') OR v_is_facility_member) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Caller is not authorized to check in equipment at this facility.'
      USING ERRCODE = '42501';
  END IF;

  -- ----------------------------------------------------------------------------
  -- 4. Idempotency Guard
  -- ----------------------------------------------------------------------------
  IF v_repair.dropped_off_at IS NOT NULL AND v_repair.drop_off_receipt_number IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', true,
      'already_checked_in', true,
      'receipt_number', v_repair.drop_off_receipt_number,
      'dropped_off_at', v_repair.dropped_off_at,
      'message', 'Equipment is already checked in.'
    );
  END IF;

  -- Calculate current physical occupancy (machinery currently in bays)
  SELECT pg_catalog.count(*)::INTEGER
  INTO v_physical_occupancy
  FROM public.repair_requests
  WHERE facility_id = v_repair.facility_id
    AND delivery_mode = 'WORKSHOP_DROPOFF'
    AND dropped_off_at IS NOT NULL
    AND handover_status != 'RELEASED';

  -- ----------------------------------------------------------------------------
  -- 5. Lock Reservation Row THIRD & Evaluate FIFO / Standby Path
  -- ----------------------------------------------------------------------------
  SELECT id, status, expires_at, priority_original_reserved_at
  INTO v_reservation
  FROM public.facility_bay_reservations
  WHERE repair_request_id = p_repair_request_id
  FOR UPDATE;

  -- Determine if Path A (Active) or Path B (Standby)
  IF FOUND AND v_reservation.status = 'RESERVED' AND v_reservation.expires_at >= v_now THEN
    v_is_standby := FALSE;
  ELSE
    v_is_standby := TRUE;
  END IF;

  -- PATH A: ACTIVE UNEXPIRED RESERVATION
  IF NOT v_is_standby THEN
    -- Check physical bay capacity
    IF v_physical_occupancy >= v_facility.max_equipment_capacity THEN
      -- DOWNSIZED FACILITY OVERCOMMITMENT EDGE CASE
      -- Physical bays are completely full due to post-booking facility capacity reduction.
      -- Defer entry, preserve RESERVED status with original priority, insert audit event.
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
        'Active reservation arrival deferred: Workshop at physical capacity due to facility downsizing. Reservation held in priority queue (reserved_at timestamp preserved). Dispatcher rerouting or turnaround offered.',
        v_caller_role,
        v_caller_profile_id,
        v_now
      );

      RETURN pg_catalog.jsonb_build_object(
        'success', false,
        'code', 'DOWNSIZED_CAPACITY_HELD',
        'message', 'Physical bays are currently full due to workshop capacity reduction. Reservation is held with original priority.',
        'reroute_eligible', true,
        'priority_original_reserved_at', v_reservation.priority_original_reserved_at
      );
    END IF;

    -- Transactional FIFO Queue Priority Check:
    -- If earlier reservation holders exist at this facility, verify they do not crowd out available open bays
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

  -- PATH B: EXPIRED RESERVATION / STANDBY ARRIVAL
  ELSE
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
      -- CAPACITY EXHAUSTED: Machine cannot enter bay without breaching active reservation holders
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

  -- ----------------------------------------------------------------------------
  -- 5. Atomic Check-in Execution & Receipt Generation
  -- ----------------------------------------------------------------------------
  -- Generate unique server-side receipt: RCP-TB-YYYYMMDD-XXXX
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
      v_now + INTERVAL '24 hours',
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

REVOKE ALL ON FUNCTION public.execute_workshop_dropoff_checkin FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.execute_workshop_dropoff_checkin FROM anon;
GRANT EXECUTE ON FUNCTION public.execute_workshop_dropoff_checkin TO authenticated, service_role;


-- F. public.release_cancelled_workshop_equipment(p_repair_request_id UUID, p_notes TEXT)
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
  v_is_facility_member BOOLEAN := FALSE;
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

  -- 2. Domain Precondition Checks
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

  -- 3. Authorization Check: Active Facility Member OR Admin
  IF v_repair.facility_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.facility_memberships fm
      WHERE fm.facility_id = v_repair.facility_id
        AND fm.technician_profile_id = v_caller_profile_id
        AND fm.status = 'ACTIVE'
    ) INTO v_is_facility_member;
  END IF;

  IF NOT (v_caller_role IN ('admin', 'service_centre') OR v_is_facility_member) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Caller is not authorized to release equipment from this facility.'
      USING ERRCODE = '42501';
  END IF;

  -- 4. Authoritative Physical Release Execution
  UPDATE public.repair_requests
  SET handover_status = 'RELEASED',
      handover_released_at = v_now,
      handover_released_by = v_caller_profile_id,
      handover_notes = COALESCE(
        handover_notes || E'\nCancelled Equipment Retrieval: ' || COALESCE(p_notes, 'Physical pickup verified'),
        p_notes,
        'Physical pickup verified'
      ),
      updated_at = v_now
  WHERE id = p_repair_request_id;

  -- 5. Insert Mandatory Audit Record
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
    'Equipment physically removed and released to farmer following cancellation' ||
      CASE WHEN p_notes IS NOT NULL THEN ': ' || p_notes ELSE '.' END,
    v_caller_role,
    v_caller_profile_id,
    v_now
  );

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'repair_id', p_repair_request_id,
    'handover_status', 'RELEASED',
    'released_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.release_cancelled_workshop_equipment FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_cancelled_workshop_equipment FROM anon;
GRANT EXECUTE ON FUNCTION public.release_cancelled_workshop_equipment TO authenticated, service_role;


-- ------------------------------------------------------------------------------
-- 5. DEMO DATA RESET FORWARD COMPATIBILITY
-- ------------------------------------------------------------------------------

-- Purge any pre-existing demo reservations during initial migration execution.
-- In runtime, public.reset_demo_data() cleans up demo reservations automatically
-- via declarative ON DELETE CASCADE on repair_request_id when demo repair_requests are deleted.
-- The sequence public.drop_off_receipt_seq is intentionally NOT reset to prevent duplicate
-- receipt number collisions (RCP-TB-YYYYMMDD-XXXX) across same-day resets.
DO $$
DECLARE
  v_func_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'reset_demo_data'
  ) INTO v_func_exists;

  IF v_func_exists THEN
    DELETE FROM public.facility_bay_reservations
    WHERE farmer_profile_id IN (
      '00000000-0000-0000-0001-000000000001'::uuid,
      '00000000-0000-0000-0001-000000000002'::uuid,
      '00000000-0000-0000-0001-000000000003'::uuid
    );
  END IF;
END $$;
