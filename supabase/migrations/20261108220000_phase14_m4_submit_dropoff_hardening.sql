-- ==============================================================================
-- TerraByte Migration: 20261108220000_phase14_m4_submit_dropoff_hardening.sql
-- Description: Phase 14 Milestone 4 - Submit Drop-Off Ownership & Role Hardening
-- Scope:
--   1. Replace public.submit_workshop_dropoff_repair with exhaustive security checks:
--      - Enforces caller profile exists and authenticated (42501)
--      - Enforces caller role IN ('farmer', 'admin', 'service_centre') (42501)
--      - Enforces Farmer A cannot submit using Farmer B's profile ID (42501)
--      - Enforces Farmer A cannot submit using Farmer B's equipment ID (42501)
--      - Enforces ordinary technician cannot submit farmer repair request (42501)
--      - Enforces equipment is not already in repair or conflicting request (22000)
--      - Enforces facility is active and drop_off_approved = TRUE (22000)
--      - Enforces immobile equipment cannot use Workshop Drop-Off (22000)
--      - Enforces request fields validation before persistence (22000)
--      - Enforces atomic transaction rollback on bay reservation failure
-- ==============================================================================

-- Drop 10-parameter signature to prevent overload ambiguity
DROP FUNCTION IF EXISTS public.submit_workshop_dropoff_repair(
  UUID, UUID, TEXT[], TEXT, TEXT, TEXT[], JSONB, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION
);

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
  p_gps_acc DOUBLE PRECISION DEFAULT NULL,
  p_farmer_id UUID DEFAULT NULL,
  p_is_immobile BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_profile_id UUID := public.current_profile_id();
  v_caller_role TEXT := public.current_user_role()::text;
  v_effective_farmer_id UUID;
  v_equipment RECORD;
  v_facility RECORD;
  v_job_number TEXT;
  v_repair_id UUID;
  v_reservation_res JSONB;
BEGIN
  -- 1. Authentication & Caller Identity Check
  IF v_caller_profile_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
  END IF;

  -- 2. Caller Role Verification (Ordinary technicians strictly rejected)
  IF v_caller_role NOT IN ('farmer', 'admin', 'service_centre') THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Caller role % is not authorized to submit repair requests.', v_caller_role
      USING ERRCODE = '42501';
  END IF;

  -- 3. Farmer Profile ID Authorization
  IF v_caller_role = 'farmer' THEN
    IF p_farmer_id IS NOT NULL AND p_farmer_id != v_caller_profile_id THEN
      RAISE EXCEPTION 'UNAUTHORIZED: Farmer cannot submit a repair request for another farmer profile.'
        USING ERRCODE = '42501';
    END IF;
    v_effective_farmer_id := v_caller_profile_id;
  ELSE
    -- Admin or service_centre may submit on behalf of farmer or self
    v_effective_farmer_id := COALESCE(p_farmer_id, v_caller_profile_id);
  END IF;

  -- 4. Immobile Equipment Check (Immobile machinery mode locked to DOORSTEP)
  IF p_is_immobile IS TRUE THEN
    RAISE EXCEPTION 'IMMOBILE_LOCK: Immobile machinery cannot use Workshop Drop-Off mode. Mode locked to DOORSTEP.'
      USING ERRCODE = '22000';
  END IF;

  -- 5. Equipment Existence, Ownership & Operational Status Validation
  IF p_equipment_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Equipment ID is required.' USING ERRCODE = '22000';
  END IF;

  SELECT id, farmer_id, status
  INTO v_equipment
  FROM public.equipment
  WHERE id = p_equipment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Equipment does not exist.' USING ERRCODE = '02000';
  END IF;

  IF v_caller_role = 'farmer' AND v_equipment.farmer_id != v_caller_profile_id THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Equipment does not belong to authenticated farmer.'
      USING ERRCODE = '42501';
  END IF;

  IF v_caller_role IN ('admin', 'service_centre') AND p_farmer_id IS NOT NULL AND v_equipment.farmer_id != p_farmer_id THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Equipment owner does not match specified farmer profile.'
      USING ERRCODE = '22000';
  END IF;

  IF v_equipment.status = 'In Repair' THEN
    RAISE EXCEPTION 'EQUIPMENT_IN_REPAIR: Equipment is already marked as in repair.'
      USING ERRCODE = '22000';
  END IF;

  -- Prevent duplicate or conflicting active requests for the same machinery
  PERFORM 1
  FROM public.repair_requests
  WHERE equipment_id = p_equipment_id
    AND status NOT IN ('COMPLETED', 'CANCELLED');

  IF FOUND THEN
    RAISE EXCEPTION 'EQUIPMENT_IN_REPAIR: Equipment already has an active repair request in progress.'
      USING ERRCODE = '22000';
  END IF;

  -- 6. Facility Existence, Active Status & Drop-Off Approval Validation
  IF p_facility_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Facility ID is required for Workshop Drop-Off.'
      USING ERRCODE = '22000';
  END IF;

  SELECT id, is_active, drop_off_approved
  INTO v_facility
  FROM public.repair_facilities
  WHERE id = p_facility_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Facility does not exist.' USING ERRCODE = '02000';
  END IF;

  IF NOT (v_facility.is_active AND v_facility.drop_off_approved) THEN
    RAISE EXCEPTION 'FACILITY_UNAVAILABLE: Facility is inactive or not approved for drop-offs.'
      USING ERRCODE = '22000';
  END IF;

  -- 7. Request Field Validations
  IF p_location IS NULL OR pg_catalog.btrim(p_location) = '' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Location description is required.' USING ERRCODE = '22000';
  END IF;

  IF (p_symptoms IS NULL OR pg_catalog.cardinality(p_symptoms) = 0)
     AND (p_description IS NULL OR pg_catalog.btrim(p_description) = '') THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Symptoms or description must be provided.' USING ERRCODE = '22000';
  END IF;

  IF p_gps_lat IS NOT NULL THEN
    IF p_gps_lat < -90.0 OR p_gps_lat > 90.0 OR p_gps_lng IS NULL OR p_gps_lng < -180.0 OR p_gps_lng > 180.0 THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: GPS coordinates are out of valid geographic range.' USING ERRCODE = '22000';
    END IF;
  END IF;

  -- 8. Generate Unique Job Number
  v_job_number := 'TB-' || pg_catalog.lpad(pg_catalog.floor(pg_catalog.random() * 9000 + 1000)::text, 4, '0');

  -- 9. Insert Repair Request Row with delivery_mode = 'WORKSHOP_DROPOFF'
  INSERT INTO public.repair_requests (
    job_number, equipment_id, farmer_id, status, is_testing,
    symptoms, description, photos, location, assessment,
    status_since, delivery_mode, is_immobile, facility_id
  ) VALUES (
    v_job_number, p_equipment_id, v_effective_farmer_id, 'REQUESTED', FALSE,
    COALESCE(p_symptoms, '{}'::TEXT[]), COALESCE(p_description, ''), COALESCE(p_photos, '{}'::TEXT[]),
    p_location, COALESCE(p_assessment, '{}'::JSONB),
    pg_catalog.now(), 'WORKSHOP_DROPOFF', FALSE, p_facility_id
  ) RETURNING id INTO v_repair_id;

  -- 10. Optional Dispatch Location
  IF p_gps_lat IS NOT NULL AND p_gps_lng IS NOT NULL THEN
    INSERT INTO public.repair_dispatch_locations (
      repair_request_id, latitude, longitude, accuracy, captured_at
    ) VALUES (
      v_repair_id, p_gps_lat, p_gps_lng, p_gps_acc, pg_catalog.now()
    );
  END IF;

  -- 11. Advance Equipment Status to 'In Repair'
  UPDATE public.equipment
  SET status = 'In Repair', updated_at = pg_catalog.now()
  WHERE id = p_equipment_id;

  -- 12. Atomically Allocate Bay Reservation via Trusted M1 RPC
  v_reservation_res := public.reserve_workshop_bay(v_repair_id, p_facility_id, INTERVAL '24 hours');

  -- 13. Atomicity Guard: If bay reservation fails (e.g. CAPACITY_EXHAUSTED), roll back transaction
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

-- Revoke and Grant Execution Privileges
REVOKE ALL ON FUNCTION public.submit_workshop_dropoff_repair(
  UUID, UUID, TEXT[], TEXT, TEXT, TEXT[], JSONB, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, UUID, BOOLEAN
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.submit_workshop_dropoff_repair(
  UUID, UUID, TEXT[], TEXT, TEXT, TEXT[], JSONB, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, UUID, BOOLEAN
) FROM anon;

GRANT EXECUTE ON FUNCTION public.submit_workshop_dropoff_repair(
  UUID, UUID, TEXT[], TEXT, TEXT, TEXT[], JSONB, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, UUID, BOOLEAN
) TO authenticated, service_role;
