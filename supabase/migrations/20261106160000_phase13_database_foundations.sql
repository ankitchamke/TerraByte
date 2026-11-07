-- ==============================================================================
-- TerraByte Migration: 20261106160000_phase13_database_foundations.sql
-- Description: Phase 13 Milestone 1 — Hardened Database Foundations
-- Scope:
--   1. Schema Extensions: Alter technician_profiles, repair_requests, service_history
--   2. New Tables: repair_facilities, facility_memberships, technician_reviews
--   3. Relational Anti-Tamper & Foreign Key Hardening: ON DELETE RESTRICT on service_history
--   4. Triggers & Guards:
--      - trg_facility_owner_membership (atomic owner membership)
--      - trg_guard_owner_membership_mutation (owner mutation protection)
--      - trg_facility_ownership_transfer (atomic owner transfer trigger)
--      - trg_guard_facility_drop_off_approval (drop-off gate)
--      - trg_guard_repair_completion_load_test (load test completion gate & immutability)
--      - trg_guard_service_history_immutability (SECURITY INVOKER unconditional update block)
--      - trg_guard_completed_repair_relationships (relational freeze on completion)
--      - trg_recalculate_technician_rating (row-locking rating aggregation)
--   5. Hardened RPCs:
--      - transfer_facility_ownership
--      - invite_technician_to_facility
--      - accept_facility_invitation
--      - reject_facility_invitation
--      - revoke_facility_invitation
--      - get_facility_handover_location
--      - verify_technician_kyc
--      - approve_technician_skill
--      - dismiss_technician_skill
--      - get_technician_private_profile
--      - get_technician_workshop_profile
--      - admin_set_technician_verification
--      - record_load_test_signoff
--      - record_offline_payment_clearance
--      - authorize_equipment_handover
--      - execute_equipment_handover_release
--      - confirm_farmer_equipment_collection
--      - reset_demo_data (forward migration for Phase 13 baseline)
--   6. Discretionary Access Control (DAC) & Row-Level Security (RLS) Policies
-- Author: TerraByte Engineering Team
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. SCHEMA EXTENSIONS ON EXISTING TABLES
-- ------------------------------------------------------------------------------

-- A. Alter public.technician_profiles (rating nullable, facility FK, KYC, skills)
ALTER TABLE public.technician_profiles
  ALTER COLUMN rating TYPE NUMERIC(3, 2),
  ALTER COLUMN rating DROP NOT NULL,
  ALTER COLUMN rating DROP DEFAULT,
  ALTER COLUMN rating SET DEFAULT NULL;

-- Ensure rating check constraint accommodates NULL (unrated) technicians
ALTER TABLE public.technician_profiles
  DROP CONSTRAINT IF EXISTS technician_profiles_rating_check,
  ADD CONSTRAINT technician_profiles_rating_check
    CHECK (rating IS NULL OR (rating >= 1.00 AND rating <= 5.00));

ALTER TABLE public.technician_profiles
  ADD COLUMN IF NOT EXISTS primary_facility_id UUID,
  ADD COLUMN IF NOT EXISTS review_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS kyc_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS kyc_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kyc_verified_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS kyc_document_type TEXT,
  ADD COLUMN IF NOT EXISTS kyc_masked_id TEXT,
  ADD COLUMN IF NOT EXISTS kyc_remarks TEXT,
  ADD COLUMN IF NOT EXISTS ai_suggested_skills JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS verified_skills JSONB NOT NULL DEFAULT '[]'::jsonb;

-- B. Alter public.repair_requests (facility, load test, payment clearance, handover, collection)
ALTER TABLE public.repair_requests
  ADD COLUMN IF NOT EXISTS facility_id UUID,
  ADD COLUMN IF NOT EXISTS load_test_passed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS load_test_notes TEXT,
  ADD COLUMN IF NOT EXISTS load_tested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS load_tested_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS payment_cleared_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_cleared_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS payment_reference TEXT,
  ADD COLUMN IF NOT EXISTS handover_status TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS handover_authorized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS handover_authorized_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS handover_released_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS handover_released_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS handover_notes TEXT,
  ADD COLUMN IF NOT EXISTS farmer_collection_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS farmer_collection_confirmed_at TIMESTAMPTZ;

-- Add check constraint for handover_status
ALTER TABLE public.repair_requests
  DROP CONSTRAINT IF EXISTS check_handover_status,
  ADD CONSTRAINT check_handover_status
    CHECK (handover_status IN ('PENDING', 'AUTHORIZED', 'RELEASED'));

-- C. Alter public.service_history (technician profile, facility FK, declarative ON DELETE RESTRICT)
ALTER TABLE public.service_history
  ADD COLUMN IF NOT EXISTS technician_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS facility_id UUID;

ALTER TABLE public.service_history
  DROP CONSTRAINT IF EXISTS service_history_repair_request_id_fkey,
  ADD CONSTRAINT service_history_repair_request_id_fkey
    FOREIGN KEY (repair_request_id) REFERENCES public.repair_requests(id) ON DELETE RESTRICT;

ALTER TABLE public.service_history
  DROP CONSTRAINT IF EXISTS service_history_equipment_id_fkey,
  ADD CONSTRAINT service_history_equipment_id_fkey
    FOREIGN KEY (equipment_id) REFERENCES public.equipment(id) ON DELETE RESTRICT;

-- ------------------------------------------------------------------------------
-- 2. NEW TABLES: repair_facilities, facility_memberships, technician_reviews
-- ------------------------------------------------------------------------------

-- A. public.repair_facilities
CREATE TABLE IF NOT EXISTS public.repair_facilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT NOT NULL,
  village TEXT NOT NULL,
  tahsil TEXT NOT NULL,
  latitude NUMERIC(10, 7) NOT NULL,
  longitude NUMERIC(10, 7) NOT NULL,
  max_equipment_capacity INTEGER NOT NULL DEFAULT 4,
  drop_off_approved BOOLEAN NOT NULL DEFAULT FALSE,
  drop_off_approved_at TIMESTAMPTZ,
  drop_off_approved_by UUID REFERENCES public.profiles(id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  operating_hours JSONB NOT NULL DEFAULT '{"open":"08:00","close":"19:00","days":["MON","TUE","WED","THU","FRI","SAT"]}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT check_facility_coordinates CHECK (
    latitude BETWEEN -90.0 AND 90.0 AND
    longitude BETWEEN -180.0 AND 180.0 AND
    (latitude != 0.0 OR longitude != 0.0)
  ),
  CONSTRAINT check_facility_capacity CHECK (max_equipment_capacity > 0)
);

CREATE INDEX IF NOT EXISTS idx_repair_facilities_tahsil ON public.repair_facilities(tahsil) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_repair_facilities_owner ON public.repair_facilities(owner_profile_id);

-- Wire foreign keys from altered tables to repair_facilities
ALTER TABLE public.technician_profiles
  DROP CONSTRAINT IF EXISTS technician_profiles_primary_facility_id_fkey,
  ADD CONSTRAINT technician_profiles_primary_facility_id_fkey
    FOREIGN KEY (primary_facility_id) REFERENCES public.repair_facilities(id) ON DELETE SET NULL;

ALTER TABLE public.repair_requests
  DROP CONSTRAINT IF EXISTS repair_requests_facility_id_fkey,
  ADD CONSTRAINT repair_requests_facility_id_fkey
    FOREIGN KEY (facility_id) REFERENCES public.repair_facilities(id) ON DELETE SET NULL;

ALTER TABLE public.service_history
  DROP CONSTRAINT IF EXISTS service_history_facility_id_fkey,
  ADD CONSTRAINT service_history_facility_id_fkey
    FOREIGN KEY (facility_id) REFERENCES public.repair_facilities(id) ON DELETE SET NULL;

-- B. public.facility_memberships
CREATE TABLE IF NOT EXISTS public.facility_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES public.repair_facilities(id) ON DELETE CASCADE,
  technician_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'MANAGER', 'TECHNICIAN')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INVITED', 'SUSPENDED', 'RESIGNED')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT unique_facility_technician UNIQUE(facility_id, technician_profile_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_single_facility_owner
  ON public.facility_memberships(facility_id)
  WHERE role = 'OWNER';

CREATE INDEX IF NOT EXISTS idx_facility_memberships_tech ON public.facility_memberships(technician_profile_id);

-- C. public.technician_reviews
CREATE TABLE IF NOT EXISTS public.technician_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_id UUID NOT NULL UNIQUE REFERENCES public.repair_requests(id) ON DELETE RESTRICT,
  service_history_id UUID NOT NULL REFERENCES public.service_history(id) ON DELETE RESTRICT,
  farmer_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  technician_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  facility_id UUID REFERENCES public.repair_facilities(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  timeliness_rating INTEGER CHECK (timeliness_rating BETWEEN 1 AND 5),
  quality_rating INTEGER CHECK (quality_rating BETWEEN 1 AND 5),
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX IF NOT EXISTS idx_technician_reviews_tech ON public.technician_reviews(technician_profile_id) WHERE is_published = TRUE;
CREATE INDEX IF NOT EXISTS idx_technician_reviews_farmer ON public.technician_reviews(farmer_profile_id);

-- ------------------------------------------------------------------------------
-- 3. TRIGGERS & SECURITY DEFINER / INVOKER GUARDS
-- ------------------------------------------------------------------------------

-- Invariant A: Exactly One Owner & Automatic Membership Provisioning
CREATE OR REPLACE FUNCTION public.handle_facility_owner_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.facility_memberships (facility_id, technician_profile_id, role, status)
    VALUES (NEW.id, NEW.owner_profile_id, 'OWNER', 'ACTIVE')
    ON CONFLICT (facility_id, technician_profile_id) DO UPDATE
    SET role = 'OWNER', status = 'ACTIVE', updated_at = pg_catalog.now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_facility_owner_membership ON public.repair_facilities;
CREATE TRIGGER trg_facility_owner_membership
AFTER INSERT ON public.repair_facilities
FOR EACH ROW EXECUTE FUNCTION public.handle_facility_owner_membership();

-- Invariant B: Database Enforcement Against Direct Mutation of OWNER Memberships
CREATE OR REPLACE FUNCTION public.guard_owner_membership_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current_owner_id UUID;
BEGIN
  -- 1. Prevent direct DELETE of an OWNER membership while the facility exists
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'OWNER' THEN
      IF EXISTS (SELECT 1 FROM public.repair_facilities WHERE id = OLD.facility_id) THEN
        RAISE EXCEPTION 'CANNOT_DELETE_FACILITY_OWNER: Facility owner membership cannot be deleted while facility exists. Transfer ownership first.'
          USING ERRCODE = '23503';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  -- 2. Prevent inserting role = 'OWNER' directly unless matching repair_facilities.owner_profile_id
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.role = 'OWNER' THEN
    SELECT owner_profile_id INTO v_current_owner_id
    FROM public.repair_facilities
    WHERE id = NEW.facility_id;

    IF v_current_owner_id IS NULL OR v_current_owner_id != NEW.technician_profile_id THEN
      RAISE EXCEPTION 'FORBIDDEN_OWNER_ROLE: Only the verified owner_profile_id of the facility can hold role = OWNER.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 3. Prevent demoting the verified owner while repair_facilities.owner_profile_id still points to them
  IF TG_OP = 'UPDATE' AND OLD.role = 'OWNER' AND NEW.role != 'OWNER' THEN
    SELECT owner_profile_id INTO v_current_owner_id
    FROM public.repair_facilities
    WHERE id = NEW.facility_id;

    IF v_current_owner_id = OLD.technician_profile_id THEN
      RAISE EXCEPTION 'CANNOT_DEMOTE_FACILITY_OWNER: Cannot demote facility owner while owner_profile_id points to them. Execute transfer_facility_ownership first.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_owner_membership_mutation ON public.facility_memberships;
CREATE TRIGGER trg_guard_owner_membership_mutation
BEFORE INSERT OR UPDATE OR DELETE ON public.facility_memberships
FOR EACH ROW EXECUTE FUNCTION public.guard_owner_membership_mutation();

-- Invariant C: Atomic Facility Ownership Transfer Trigger
CREATE OR REPLACE FUNCTION public.handle_facility_ownership_transfer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.owner_profile_id IS DISTINCT FROM OLD.owner_profile_id THEN
    -- Demote old owner to MANAGER in memberships
    UPDATE public.facility_memberships
    SET role = 'MANAGER', updated_at = pg_catalog.now()
    WHERE facility_id = NEW.id AND technician_profile_id = OLD.owner_profile_id;

    -- Promote / insert new owner
    INSERT INTO public.facility_memberships (facility_id, technician_profile_id, role, status)
    VALUES (NEW.id, NEW.owner_profile_id, 'OWNER', 'ACTIVE')
    ON CONFLICT (facility_id, technician_profile_id) DO UPDATE
    SET role = 'OWNER', status = 'ACTIVE', updated_at = pg_catalog.now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_facility_ownership_transfer ON public.repair_facilities;
CREATE TRIGGER trg_facility_ownership_transfer
AFTER UPDATE OF owner_profile_id ON public.repair_facilities
FOR EACH ROW EXECUTE FUNCTION public.handle_facility_ownership_transfer();

-- Invariant D: Drop-Off Gate Protection Trigger
CREATE OR REPLACE FUNCTION public.guard_facility_drop_off_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role_text TEXT := public.current_user_role()::text;
BEGIN
  IF NEW.drop_off_approved IS DISTINCT FROM OLD.drop_off_approved THEN
    IF v_role_text NOT IN ('admin', 'service_centre') THEN
      RAISE EXCEPTION 'ACCESS_DENIED: Only Service Centre administrators can modify drop_off_approved status.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_facility_drop_off_approval ON public.repair_facilities;
CREATE TRIGGER trg_guard_facility_drop_off_approval
BEFORE UPDATE ON public.repair_facilities
FOR EACH ROW EXECUTE FUNCTION public.guard_facility_drop_off_approval();

-- Invariant E: Operational Load Test Completion Gate & Immutability Trigger
CREATE OR REPLACE FUNCTION public.guard_repair_completion_load_test()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'COMPLETED' AND OLD.status != 'COMPLETED' THEN
    IF NEW.load_test_passed IS NOT TRUE THEN
      RAISE EXCEPTION 'CANNOT_COMPLETE_WITHOUT_LOAD_TEST: Repair cannot be marked COMPLETED without a passed operational load test.'
        USING ERRCODE = '22000';
    END IF;
  END IF;

  -- Lock load test fields from post-completion mutation
  IF OLD.status = 'COMPLETED' THEN
    IF (NEW.load_test_passed IS DISTINCT FROM OLD.load_test_passed) OR
       (NEW.load_test_notes IS DISTINCT FROM OLD.load_test_notes) OR
       (NEW.load_tested_at IS DISTINCT FROM OLD.load_tested_at) OR
       (NEW.load_tested_by IS DISTINCT FROM OLD.load_tested_by) THEN
      RAISE EXCEPTION 'IMMUTABLE_LOAD_TEST_RECORD: Load test evidence cannot be modified after repair is completed.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_repair_completion_load_test ON public.repair_requests;
CREATE TRIGGER trg_guard_repair_completion_load_test
BEFORE UPDATE ON public.repair_requests
FOR EACH ROW EXECUTE FUNCTION public.guard_repair_completion_load_test();

-- Invariant F: Service History Permanent Immutability Trigger (SECURITY INVOKER)
CREATE OR REPLACE FUNCTION public.guard_service_history_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_RECORD: Service history records are permanent and immutable. Updates are strictly prohibited.'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_service_history_immutability ON public.service_history;
CREATE TRIGGER trg_guard_service_history_immutability
BEFORE UPDATE ON public.service_history
FOR EACH ROW
EXECUTE FUNCTION public.guard_service_history_immutability();

-- Invariant G: Completed Repair Relational Anti-Tamper Guard
CREATE OR REPLACE FUNCTION public.guard_completed_repair_relationships()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- 1. Ensure core relational identities cannot be altered AFTER completion OR DURING transition to COMPLETED
  IF OLD.status = 'COMPLETED' OR NEW.status = 'COMPLETED' THEN
    IF (NEW.farmer_id IS DISTINCT FROM OLD.farmer_id OR
        NEW.technician_id IS DISTINCT FROM OLD.technician_id OR
        NEW.equipment_id IS DISTINCT FROM OLD.equipment_id) THEN
      RAISE EXCEPTION 'RELATIONSHIP_FROZEN: Core relational identities (farmer, technician, equipment) cannot be altered when transitioning to or remaining in COMPLETED status.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Prevent transitioning away from COMPLETED once completed
  IF OLD.status = 'COMPLETED' AND NEW.status != 'COMPLETED' THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: Completed repair tickets cannot be reverted to any prior status.'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Require assigned technician on completion
  IF NEW.status = 'COMPLETED' AND NEW.technician_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_COMPLETION: Repair request cannot be completed without an assigned technician.'
      USING ERRCODE = '22000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_completed_repair_relationships ON public.repair_requests;
CREATE TRIGGER trg_guard_completed_repair_relationships
BEFORE UPDATE ON public.repair_requests
FOR EACH ROW
EXECUTE FUNCTION public.guard_completed_repair_relationships();

-- Invariant H: Concurrency Row-Locking Recalculation Trigger for Reviews
CREATE OR REPLACE FUNCTION public.recalculate_technician_rating()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tech_1 UUID;
  v_tech_2 UUID;
  v_avg NUMERIC(3, 2);
  v_count INT;
BEGIN
  -- Determine affected technician profile IDs
  IF TG_OP = 'INSERT' THEN
    v_tech_1 := NEW.technician_profile_id;
  ELSIF TG_OP = 'DELETE' THEN
    v_tech_1 := OLD.technician_profile_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.technician_profile_id IS DISTINCT FROM NEW.technician_profile_id THEN
      v_tech_1 := least(OLD.technician_profile_id, NEW.technician_profile_id);
      v_tech_2 := greatest(OLD.technician_profile_id, NEW.technician_profile_id);
    ELSE
      v_tech_1 := NEW.technician_profile_id;
    END IF;
  END IF;

  -- 1. Lock First Technician Profile Row
  IF v_tech_1 IS NOT NULL THEN
    PERFORM profile_id FROM public.technician_profiles WHERE profile_id = v_tech_1 FOR UPDATE;

    SELECT
      CASE WHEN pg_catalog.count(*) = 0 THEN NULL ELSE pg_catalog.round(pg_catalog.avg(rating)::numeric, 2) END,
      pg_catalog.count(*)
    INTO v_avg, v_count
    FROM public.technician_reviews
    WHERE technician_profile_id = v_tech_1 AND is_published = TRUE;

    IF v_count = 0 THEN
      v_avg := NULL;
    END IF;

    UPDATE public.technician_profiles
    SET rating = v_avg, review_count = v_count, updated_at = pg_catalog.now()
    WHERE profile_id = v_tech_1;
  END IF;

  -- 2. Lock Second Technician Profile Row (if reassigned)
  IF v_tech_2 IS NOT NULL THEN
    PERFORM profile_id FROM public.technician_profiles WHERE profile_id = v_tech_2 FOR UPDATE;

    SELECT
      CASE WHEN pg_catalog.count(*) = 0 THEN NULL ELSE pg_catalog.round(pg_catalog.avg(rating)::numeric, 2) END,
      pg_catalog.count(*)
    INTO v_avg, v_count
    FROM public.technician_reviews
    WHERE technician_profile_id = v_tech_2 AND is_published = TRUE;

    IF v_count = 0 THEN
      v_avg := NULL;
    END IF;

    UPDATE public.technician_profiles
    SET rating = v_avg, review_count = v_count, updated_at = pg_catalog.now()
    WHERE profile_id = v_tech_2;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalculate_technician_rating ON public.technician_reviews;
CREATE TRIGGER trg_recalculate_technician_rating
AFTER INSERT OR UPDATE OR DELETE ON public.technician_reviews
FOR EACH ROW EXECUTE FUNCTION public.recalculate_technician_rating();

-- Invariant I: Database Enforcement Against Unauthorized Mutation of Technician Profile Governance & Metric Columns
CREATE OR REPLACE FUNCTION public.guard_technician_profile_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_is_postgres_definer BOOLEAN := (CURRENT_USER = 'postgres');
BEGIN
  -- 1. If executing inside an authorized system SECURITY DEFINER routine owned by postgres
  -- (e.g. recalculate_technician_rating, verify_technician_kyc, approve_technician_skill, dismiss_technician_skill, reset_demo_data), allow
  IF v_is_postgres_definer THEN
    RETURN NEW;
  END IF;

  -- 2. Direct client updates (from authenticated, service_role, anon, or PUBLIC) are strictly forbidden from modifying protected fields
  IF (NEW.is_verified IS DISTINCT FROM OLD.is_verified OR
      NEW.kyc_verified IS DISTINCT FROM OLD.kyc_verified OR
      NEW.kyc_verified_at IS DISTINCT FROM OLD.kyc_verified_at OR
      NEW.kyc_verified_by IS DISTINCT FROM OLD.kyc_verified_by OR
      NEW.kyc_document_type IS DISTINCT FROM OLD.kyc_document_type OR
      NEW.kyc_masked_id IS DISTINCT FROM OLD.kyc_masked_id OR
      NEW.kyc_remarks IS DISTINCT FROM OLD.kyc_remarks OR
      NEW.verified_skills IS DISTINCT FROM OLD.verified_skills OR
      NEW.ai_suggested_skills IS DISTINCT FROM OLD.ai_suggested_skills OR
      NEW.rating IS DISTINCT FROM OLD.rating OR
      NEW.review_count IS DISTINCT FROM OLD.review_count OR
      NEW.jobs_completed IS DISTINCT FROM OLD.jobs_completed) THEN
    RAISE EXCEPTION 'FORBIDDEN_MUTATION: Direct client modification of protected technician profile governance, rating, or KYC fields is strictly prohibited.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_technician_profile_mutation ON public.technician_profiles;
CREATE TRIGGER trg_guard_technician_profile_mutation
BEFORE UPDATE ON public.technician_profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_technician_profile_mutation();

-- ------------------------------------------------------------------------------
-- 4. HARDENED BUSINESS RPCS
-- ------------------------------------------------------------------------------

-- 1. transfer_facility_ownership
CREATE OR REPLACE FUNCTION public.transfer_facility_ownership(
  p_facility_id UUID,
  p_new_owner_profile_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_profile_id UUID := public.current_profile_id();
  v_caller_role_text TEXT := public.current_user_role()::text;
  v_facility RECORD;
  v_new_owner_profile RECORD;
BEGIN
  -- 1. Lock Facility
  SELECT id, owner_profile_id INTO v_facility
  FROM public.repair_facilities
  WHERE id = p_facility_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Facility does not exist.' USING ERRCODE = '02000';
  END IF;

  -- 2. Authorization: Current owner or Service Centre admin only
  IF NOT (v_caller_role_text IN ('admin', 'service_centre') OR v_facility.owner_profile_id = v_caller_profile_id) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Only current owner or Service Centre admin can transfer facility ownership.'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Validate Target Persona
  SELECT id, role INTO v_new_owner_profile
  FROM public.profiles
  WHERE id = p_new_owner_profile_id;

  IF NOT FOUND OR v_new_owner_profile.role::text != 'technician' THEN
    RAISE EXCEPTION 'INVALID_TARGET: Target profile must be a registered technician.' USING ERRCODE = '22000';
  END IF;

  -- 4. Update Facility (Trigger trg_facility_ownership_transfer handles atomic membership demotion/promotion)
  UPDATE public.repair_facilities
  SET owner_profile_id = p_new_owner_profile_id, updated_at = pg_catalog.now()
  WHERE id = p_facility_id;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'facility_id', p_facility_id,
    'previous_owner_id', v_facility.owner_profile_id,
    'new_owner_id', p_new_owner_profile_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_facility_ownership(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.transfer_facility_ownership(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.transfer_facility_ownership(UUID, UUID) TO authenticated;

-- 2. invite_technician_to_facility
CREATE OR REPLACE FUNCTION public.invite_technician_to_facility(
  p_facility_id UUID,
  p_technician_phone TEXT,
  p_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_profile_id UUID := public.current_profile_id();
  v_caller_role_text TEXT := public.current_user_role()::text;
  v_facility RECORD;
  v_target_profile RECORD;
  v_target_tp RECORD;
  v_is_authorized BOOLEAN := FALSE;
  v_clean_phone TEXT := pg_catalog.regexp_replace(p_technician_phone, '[^0-9]', '', 'g');
BEGIN
  -- 1. Validate requested role (cannot invite as OWNER)
  IF p_role NOT IN ('MANAGER', 'TECHNICIAN') THEN
    RAISE EXCEPTION 'INVALID_ROLE: Facility members can only be invited as MANAGER or TECHNICIAN.'
      USING ERRCODE = '22000';
  END IF;

  -- 2. Authorization check: Caller must be OWNER or MANAGER of the facility, or Service Centre admin
  IF v_caller_role_text IN ('admin', 'service_centre') THEN
    v_is_authorized := TRUE;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.facility_memberships
      WHERE facility_id = p_facility_id
        AND technician_profile_id = v_caller_profile_id
        AND role IN ('OWNER', 'MANAGER')
        AND status = 'ACTIVE'
    ) INTO v_is_authorized;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Only facility owners, managers, or Service Centre admins can invite members.'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Lookup technician strictly by registered 10-digit phone number
  IF pg_catalog.length(v_clean_phone) < 10 THEN
    RAISE EXCEPTION 'INVALID_PHONE: Please provide a valid 10-digit registered technician phone number.'
      USING ERRCODE = '22000';
  END IF;

  SELECT p.id, p.full_name, p.role
  INTO v_target_profile
  FROM public.profiles p
  JOIN public.profile_contacts pc ON pc.profile_id = p.id
  WHERE pc.phone LIKE '%' || pg_catalog.substr(v_clean_phone, -10)
    AND p.role::text = 'technician'
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT p.id, p.full_name, p.role
    INTO v_target_profile
    FROM public.profiles p
    WHERE p.phone LIKE '%' || pg_catalog.substr(v_clean_phone, -10)
      AND p.role::text = 'technician'
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TECHNICIAN_NOT_FOUND: No registered technician account found with this phone number.'
      USING ERRCODE = '02000';
  END IF;

  -- 4. Check if technician is approved and verified
  SELECT profile_id, is_verified, kyc_verified
  INTO v_target_tp
  FROM public.technician_profiles
  WHERE profile_id = v_target_profile.id;

  IF NOT FOUND OR NOT (COALESCE(v_target_tp.is_verified, FALSE)) THEN
    RAISE EXCEPTION 'TECHNICIAN_NOT_VERIFIED: Only verified technician accounts can be affiliated with facilities.'
      USING ERRCODE = '22000';
  END IF;

  -- 5. Prevent duplicate membership or pending invitation
  IF EXISTS (
    SELECT 1 FROM public.facility_memberships
    WHERE facility_id = p_facility_id
      AND technician_profile_id = v_target_profile.id
      AND status IN ('ACTIVE', 'INVITED')
  ) THEN
    RAISE EXCEPTION 'MEMBERSHIP_EXISTS: This technician already holds an active membership or pending invitation at this facility.'
      USING ERRCODE = '23505';
  END IF;

  -- 6. Insert PENDING invitation (Does NOT silently become active)
  INSERT INTO public.facility_memberships (
    facility_id,
    technician_profile_id,
    role,
    status
  ) VALUES (
    p_facility_id,
    v_target_profile.id,
    p_role,
    'INVITED'
  );

  -- 7. Audit notification to target technician
  SELECT name INTO v_facility FROM public.repair_facilities WHERE id = p_facility_id;
  INSERT INTO public.notifications (
    recipient_role, recipient_user_id, notification_text, link_target, is_read, created_at
  ) VALUES (
    'technician'::public.user_role,
    v_target_profile.id,
    'You have been invited to join ' || COALESCE(v_facility.name, 'a workshop facility') || ' as ' || p_role || '. Please review and respond in your workshop portal.',
    '/technician',
    FALSE,
    pg_catalog.now()
  );

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'facility_id', p_facility_id,
    'technician_id', v_target_profile.id,
    'technician_name', v_target_profile.full_name,
    'role', p_role,
    'status', 'INVITED'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invite_technician_to_facility(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.invite_technician_to_facility(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.invite_technician_to_facility(UUID, TEXT, TEXT) TO authenticated;

-- 3. accept_facility_invitation
CREATE OR REPLACE FUNCTION public.accept_facility_invitation(
  p_membership_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_profile_id UUID := public.current_profile_id();
  v_membership RECORD;
BEGIN
  SELECT id, facility_id, technician_profile_id, role, status, created_at
  INTO v_membership
  FROM public.facility_memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Membership invitation does not exist.' USING ERRCODE = '02000';
  END IF;

  IF v_membership.technician_profile_id != v_caller_profile_id THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Only the invited technician can accept this invitation.' USING ERRCODE = '42501';
  END IF;

  IF v_membership.status != 'INVITED' THEN
    RAISE EXCEPTION 'INVALID_STATE: Invitation is not in INVITED status.' USING ERRCODE = '22000';
  END IF;

  -- 14-day expiration guard
  IF v_membership.created_at < (pg_catalog.now() - interval '14 days') THEN
    UPDATE public.facility_memberships SET status = 'RESIGNED', updated_at = pg_catalog.now() WHERE id = p_membership_id;
    RAISE EXCEPTION 'INVITATION_EXPIRED: This invitation has expired (valid for 14 days).' USING ERRCODE = '22000';
  END IF;

  UPDATE public.facility_memberships
  SET status = 'ACTIVE',
      joined_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE id = p_membership_id;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'membership_id', p_membership_id,
    'status', 'ACTIVE',
    'joined_at', pg_catalog.now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_facility_invitation(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_facility_invitation(UUID) TO authenticated;

-- 4. reject_facility_invitation
CREATE OR REPLACE FUNCTION public.reject_facility_invitation(
  p_membership_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_profile_id UUID := public.current_profile_id();
  v_membership RECORD;
BEGIN
  SELECT id, technician_profile_id, status
  INTO v_membership
  FROM public.facility_memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Membership invitation does not exist.' USING ERRCODE = '02000';
  END IF;

  IF v_membership.technician_profile_id != v_caller_profile_id THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Only the invited technician can reject this invitation.' USING ERRCODE = '42501';
  END IF;

  IF v_membership.status != 'INVITED' THEN
    RAISE EXCEPTION 'INVALID_STATE: Only pending invitations can be rejected.' USING ERRCODE = '22000';
  END IF;

  DELETE FROM public.facility_memberships WHERE id = p_membership_id;

  RETURN pg_catalog.jsonb_build_object('success', true, 'action', 'REJECTED');
END;
$$;

REVOKE ALL ON FUNCTION public.reject_facility_invitation(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_facility_invitation(UUID) TO authenticated;

-- 5. revoke_facility_invitation
CREATE OR REPLACE FUNCTION public.revoke_facility_invitation(
  p_membership_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_profile_id UUID := public.current_profile_id();
  v_caller_role_text TEXT := public.current_user_role()::text;
  v_membership RECORD;
  v_is_authorized BOOLEAN := FALSE;
BEGIN
  SELECT id, facility_id, status
  INTO v_membership
  FROM public.facility_memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Membership invitation does not exist.' USING ERRCODE = '02000';
  END IF;

  IF v_membership.status != 'INVITED' THEN
    RAISE EXCEPTION 'INVALID_STATE: Only pending invitations can be revoked.' USING ERRCODE = '22000';
  END IF;

  IF v_caller_role_text IN ('admin', 'service_centre') THEN
    v_is_authorized := TRUE;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.facility_memberships
      WHERE facility_id = v_membership.facility_id
        AND technician_profile_id = v_caller_profile_id
        AND role IN ('OWNER', 'MANAGER')
        AND status = 'ACTIVE'
    ) INTO v_is_authorized;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Only facility owners, managers, or Service Centre admins can revoke invitations.'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.facility_memberships WHERE id = p_membership_id;

  RETURN pg_catalog.jsonb_build_object('success', true, 'action', 'REVOKED');
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_facility_invitation(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_facility_invitation(UUID) TO authenticated;

-- 5b. remove_facility_member
CREATE OR REPLACE FUNCTION public.remove_facility_member(
  p_facility_id UUID,
  p_technician_profile_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_profile_id UUID := public.current_profile_id();
  v_caller_role_text TEXT := public.current_user_role()::text;
  v_target_role TEXT;
  v_caller_fac_role TEXT;
  v_is_authorized BOOLEAN := FALSE;
BEGIN
  -- 1. Look up target membership
  SELECT role INTO v_target_role
  FROM public.facility_memberships
  WHERE facility_id = p_facility_id
    AND technician_profile_id = p_technician_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Technician is not a member of this facility.' USING ERRCODE = '02000';
  END IF;

  IF v_target_role = 'OWNER' THEN
    RAISE EXCEPTION 'CANNOT_REMOVE_OWNER: Cannot remove facility owner. Transfer ownership first.' USING ERRCODE = '42501';
  END IF;

  -- 2. Authorization
  IF v_caller_role_text IN ('admin', 'service_centre') THEN
    v_is_authorized := TRUE;
  ELSE
    SELECT role INTO v_caller_fac_role
    FROM public.facility_memberships
    WHERE facility_id = p_facility_id
      AND technician_profile_id = v_caller_profile_id
      AND status = 'ACTIVE';

    IF v_caller_fac_role = 'OWNER' THEN
      v_is_authorized := TRUE;
    ELSIF v_caller_fac_role = 'MANAGER' AND v_target_role = 'TECHNICIAN' THEN
      v_is_authorized := TRUE;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Insufficient permissions to remove this facility member.' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.facility_memberships
  WHERE facility_id = p_facility_id
    AND technician_profile_id = p_technician_profile_id;

  RETURN pg_catalog.jsonb_build_object('success', true, 'action', 'REMOVED');
END;
$$;

REVOKE ALL ON FUNCTION public.remove_facility_member(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_facility_member(UUID, UUID) TO authenticated;

-- 6. get_facility_handover_location
CREATE OR REPLACE FUNCTION public.get_facility_handover_location(
  p_repair_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_profile_id UUID := public.current_profile_id();
  v_caller_role_text TEXT := public.current_user_role()::text;
  v_repair RECORD;
  v_facility RECORD;
BEGIN
  -- 1. Fetch & Verify Repair Ticket
  SELECT id, farmer_id, technician_id, facility_id, handover_status, status
  INTO v_repair
  FROM public.repair_requests
  WHERE id = p_repair_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Repair request does not exist.' USING ERRCODE = '02000';
  END IF;

  IF v_repair.facility_id IS NULL THEN
    RAISE EXCEPTION 'NO_FACILITY: Repair is not associated with a workshop facility.' USING ERRCODE = '22000';
  END IF;

  -- 2. Strict Authorization Evaluation
  IF v_caller_role_text IN ('admin', 'service_centre') THEN
    NULL;
  ELSIF v_repair.technician_id = v_caller_profile_id THEN
    NULL;
  ELSIF EXISTS (
    SELECT 1 FROM public.facility_memberships
    WHERE facility_id = v_repair.facility_id
      AND technician_profile_id = v_caller_profile_id
      AND status = 'ACTIVE'
  ) THEN
    NULL;
  ELSIF v_repair.farmer_id = v_caller_profile_id THEN
    IF v_repair.status = 'CANCELLED' THEN
      RAISE EXCEPTION 'ACCESS_DENIED: Workshop coordinates are not accessible for cancelled repairs.'
        USING ERRCODE = '42501';
    END IF;

    IF v_repair.handover_status = 'PENDING' THEN
      RAISE EXCEPTION 'ACCESS_DENIED: Workshop pickup details are not available until equipment handover is authorized.'
        USING ERRCODE = '42501';
    ELSIF v_repair.handover_status = 'RELEASED' THEN
      RAISE EXCEPTION 'ACCESS_DENIED: Equipment has already been released. Workshop handover access is closed.'
        USING ERRCODE = '42501';
    ELSIF v_repair.handover_status != 'AUTHORIZED' THEN
      RAISE EXCEPTION 'ACCESS_DENIED: Equipment handover is not authorized.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'ACCESS_DENIED: Caller is not authorized to access workshop location for this repair.'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Fetch Facility Record
  SELECT id, name, address, village, tahsil, phone, latitude, longitude, operating_hours
  INTO v_facility
  FROM public.repair_facilities
  WHERE id = v_repair.facility_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Workshop facility record does not exist.' USING ERRCODE = '02000';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'facility_id', v_facility.id,
    'name', v_facility.name,
    'address', v_facility.address,
    'village', v_facility.village,
    'tahsil', v_facility.tahsil,
    'phone', v_facility.phone,
    'latitude', v_facility.latitude,
    'longitude', v_facility.longitude,
    'operating_hours', v_facility.operating_hours
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_facility_handover_location(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_facility_handover_location(UUID) TO authenticated;

-- 6b. get_facility_management_profile
CREATE OR REPLACE FUNCTION public.get_facility_management_profile(
  p_facility_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_profile_id UUID := public.current_profile_id();
  v_caller_role_text TEXT := public.current_user_role()::text;
  v_facility RECORD;
  v_is_authorized BOOLEAN := FALSE;
BEGIN
  -- 1. Authorization Evaluation: Must be facility OWNER, MANAGER, or Service Centre Admin
  IF v_caller_role_text IN ('admin', 'service_centre') THEN
    v_is_authorized := TRUE;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.facility_memberships
      WHERE facility_id = p_facility_id
        AND technician_profile_id = v_caller_profile_id
        AND role IN ('OWNER', 'MANAGER')
        AND status = 'ACTIVE'
    ) INTO v_is_authorized;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'ACCESS_DENIED: Caller is not an authorized owner, manager, or Service Centre administrator for this facility.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Fetch Complete Facility Record
  SELECT id, name, owner_profile_id, phone, email, address, village, tahsil,
         latitude, longitude, max_equipment_capacity, drop_off_approved,
         drop_off_approved_at, drop_off_approved_by, is_active, operating_hours,
         created_at, updated_at
  INTO v_facility
  FROM public.repair_facilities
  WHERE id = p_facility_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Facility record does not exist.'
      USING ERRCODE = '02000';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'id', v_facility.id,
    'name', v_facility.name,
    'owner_profile_id', v_facility.owner_profile_id,
    'phone', v_facility.phone,
    'email', v_facility.email,
    'address', v_facility.address,
    'village', v_facility.village,
    'tahsil', v_facility.tahsil,
    'latitude', v_facility.latitude,
    'longitude', v_facility.longitude,
    'max_equipment_capacity', v_facility.max_equipment_capacity,
    'drop_off_approved', v_facility.drop_off_approved,
    'drop_off_approved_at', v_facility.drop_off_approved_at,
    'drop_off_approved_by', v_facility.drop_off_approved_by,
    'is_active', v_facility.is_active,
    'operating_hours', v_facility.operating_hours,
    'created_at', v_facility.created_at,
    'updated_at', v_facility.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_facility_management_profile(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_facility_management_profile(UUID) TO authenticated;

-- 7. verify_technician_kyc
CREATE OR REPLACE FUNCTION public.verify_technician_kyc(
  p_technician_profile_id UUID,
  p_document_type TEXT,
  p_masked_id TEXT,
  p_remarks TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_profile_id UUID := public.current_profile_id();
  v_admin_role_text TEXT := public.current_user_role()::text;
  v_target_profile RECORD;
  v_trimmed_id TEXT := trim(p_masked_id);
  v_trimmed_remarks TEXT := trim(p_remarks);
BEGIN
  -- 1. Authorization: Service Centre Admin Only
  IF v_admin_role_text NOT IN ('admin', 'service_centre') THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Only Service Centre administrators can verify technician KYC.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Validate Target Persona
  SELECT id, role INTO v_target_profile
  FROM public.profiles
  WHERE id = p_technician_profile_id;

  IF NOT FOUND OR v_target_profile.role::text != 'technician' THEN
    RAISE EXCEPTION 'INVALID_TARGET: Target profile does not exist or is not a technician.'
      USING ERRCODE = '22000';
  END IF;

  -- 3. Reject NULL or Empty Masked ID
  IF v_trimmed_id IS NULL OR v_trimmed_id = '' THEN
    RAISE EXCEPTION 'EMPTY_IDENTIFIER: Masked identifier cannot be empty or whitespace.'
      USING ERRCODE = '22000';
  END IF;

  -- 4. Reject Any Complete Identifiers (Strict Anti-PII Guards)
  IF v_trimmed_id ~* '^[0-9]{12}$' OR v_trimmed_id ~* '^[0-9]{4}[ -][0-9]{4}[ -][0-9]{4}$' THEN
    RAISE EXCEPTION 'ILLEGAL_FULL_UID_STORAGE: Storing full 12-digit Aadhaar numbers is strictly prohibited.'
      USING ERRCODE = '22000';
  END IF;

  IF (v_trimmed_id ~* '^[A-Z]{5}[0-9]{4}[A-Z]$') AND NOT (v_trimmed_id ~* '^[X]{5}') THEN
    RAISE EXCEPTION 'ILLEGAL_FULL_PAN_STORAGE: Storing complete PAN numbers is strictly prohibited.'
      USING ERRCODE = '22000';
  END IF;

  IF v_trimmed_id ~* '^[A-Z]{3}[0-9]{7}$' THEN
    RAISE EXCEPTION 'ILLEGAL_FULL_VOTER_ID_STORAGE: Storing complete Voter IDs is strictly prohibited.'
      USING ERRCODE = '22000';
  END IF;

  IF v_trimmed_id ~* '^[A-Z]{2}[- ]?[0-9]{2}[- ]?[0-9]{4}[- ]?[0-9]{7}$' THEN
    RAISE EXCEPTION 'ILLEGAL_FULL_DL_STORAGE: Storing complete Driving Licence numbers is strictly prohibited.'
      USING ERRCODE = '22000';
  END IF;

  -- 5. Enforce Canonical Masked Format Per Document Type (Exact Match Frontend & DB)
  CASE p_document_type
    WHEN 'AADHAAR_PHYSICAL' THEN
      IF NOT (v_trimmed_id ~* '^XXXX-XXXX-[0-9]{4}$') THEN
        RAISE EXCEPTION 'INVALID_AADHAAR_MASK: Physical Aadhaar must be masked strictly as XXXX-XXXX-1234.'
          USING ERRCODE = '22000';
      END IF;
    WHEN 'PAN_CARD' THEN
      IF NOT (v_trimmed_id ~* '^X{5}[0-9]{4}[A-Z]$') THEN
        RAISE EXCEPTION 'INVALID_PAN_MASK: PAN card must be masked strictly as XXXXX1234X.'
          USING ERRCODE = '22000';
      END IF;
    WHEN 'VOTER_ID' THEN
      IF length(v_trimmed_id) != 10 OR NOT (v_trimmed_id ~* '^[A-Z]{3}[*X]{6}[0-9A-Z]$') THEN
        RAISE EXCEPTION 'INVALID_VOTER_ID_MASK: Voter ID must be 10 characters masked as ABC******7.'
          USING ERRCODE = '22000';
      END IF;
    WHEN 'DRIVING_LICENSE' THEN
      IF NOT (v_trimmed_id ~* '^[A-Z]{2}[- ]?[0-9]{2}[- ]?(?:[0-9]{4}|YYYY)[- ]?[*X]{3,7}[0-9A-Z]{1,4}$') THEN
        RAISE EXCEPTION 'INVALID_DL_MASK: Driving license must be masked with State, RTO, year and masked serial (e.g. MH-31-2018-XXX1234).'
          USING ERRCODE = '22000';
      END IF;
    WHEN 'WORKSHOP_TRADE_LICENSE' THEN
      IF length(v_trimmed_id) < 8 OR length(v_trimmed_id) > 30 THEN
        RAISE EXCEPTION 'INVALID_TRADE_LICENSE_LENGTH: Trade license must be between 8 and 30 characters.'
          USING ERRCODE = '22000';
      END IF;
      IF NOT (v_trimmed_id ~* '^[A-Z0-9][A-Z0-9\-/ ]+[A-Z0-9]$') THEN
        RAISE EXCEPTION 'INVALID_TRADE_LICENSE_CHARS: Trade license contains invalid characters.'
          USING ERRCODE = '22000';
      END IF;
      IF NOT (v_trimmed_id ~* '[*X]{2,}') THEN
        RAISE EXCEPTION 'UNMASKED_TRADE_LICENSE: Trade license must be masked with at least two mask characters (XX or **).'
          USING ERRCODE = '22000';
      END IF;
    ELSE
      RAISE EXCEPTION 'UNSUPPORTED_DOCUMENT_TYPE: Document type % is not recognized.', p_document_type
        USING ERRCODE = '22000';
  END CASE;

  -- 6. Privacy Guard on Remarks: Disallow inserting full number strings in remarks
  IF v_trimmed_remarks ~* '[0-9]{6,}' THEN
    RAISE EXCEPTION 'SENSITIVE_DATA_IN_REMARKS: Remarks must not contain credential numbers.'
      USING ERRCODE = '22000';
  END IF;

  -- 7. Atomic Record Update
  UPDATE public.technician_profiles
  SET kyc_verified = TRUE,
      kyc_verified_at = pg_catalog.now(),
      kyc_verified_by = v_admin_profile_id,
      kyc_document_type = p_document_type,
      kyc_masked_id = v_trimmed_id,
      kyc_remarks = v_trimmed_remarks,
      is_verified = TRUE,
      updated_at = pg_catalog.now()
  WHERE profile_id = p_technician_profile_id;

  -- 8. Audit Notification (Masked ID strictly omitted from notification body)
  INSERT INTO public.notifications (
    recipient_role, recipient_user_id, notification_text, link_target, is_read, created_at
  ) VALUES (
    'technician'::public.user_role,
    p_technician_profile_id,
    'Your technician credentials have been verified in person at the Nagpur Service Centre.',
    '/technician',
    FALSE,
    pg_catalog.now()
  );

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'technician_id', p_technician_profile_id,
    'verified_at', pg_catalog.now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_technician_kyc(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.verify_technician_kyc(UUID, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.verify_technician_kyc(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- 8. approve_technician_skill
CREATE OR REPLACE FUNCTION public.approve_technician_skill(
  p_technician_profile_id UUID,
  p_skill TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_role_text TEXT := public.current_user_role()::text;
  v_trimmed_skill TEXT := trim(p_skill);
  v_tp RECORD;
  v_new_suggested JSONB;
  v_new_verified JSONB;
BEGIN
  -- 1. Authorization: Service Centre Admin Only
  IF v_admin_role_text NOT IN ('admin', 'service_centre') THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Only Service Centre administrators can approve technician skills.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Input validation
  IF v_trimmed_skill IS NULL OR v_trimmed_skill = '' THEN
    RAISE EXCEPTION 'EMPTY_SKILL: Skill cannot be empty or whitespace.'
      USING ERRCODE = '22000';
  END IF;

  -- 3. Fetch technician profile with lock
  SELECT profile_id, ai_suggested_skills, verified_skills
  INTO v_tp
  FROM public.technician_profiles
  WHERE profile_id = p_technician_profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Technician profile does not exist.' USING ERRCODE = '02000';
  END IF;

  -- 4. Remove skill from ai_suggested_skills (if present)
  SELECT coalesce(
    pg_catalog.jsonb_agg(elem),
    '[]'::jsonb
  )
  INTO v_new_suggested
  FROM pg_catalog.jsonb_array_elements_text(COALESCE(v_tp.ai_suggested_skills, '[]'::jsonb)) elem
  WHERE elem != v_trimmed_skill;

  -- 5. Add skill to verified_skills (preventing duplicates)
  IF NOT (COALESCE(v_tp.verified_skills, '[]'::jsonb) ? v_trimmed_skill) THEN
    v_new_verified := COALESCE(v_tp.verified_skills, '[]'::jsonb) || pg_catalog.to_jsonb(v_trimmed_skill);
  ELSE
    v_new_verified := COALESCE(v_tp.verified_skills, '[]'::jsonb);
  END IF;

  -- 6. Update technician_profiles
  UPDATE public.technician_profiles
  SET ai_suggested_skills = v_new_suggested,
      verified_skills = v_new_verified,
      updated_at = pg_catalog.now()
  WHERE profile_id = p_technician_profile_id;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'technician_id', p_technician_profile_id,
    'skill', v_trimmed_skill,
    'action', 'APPROVED',
    'verified_skills', v_new_verified
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_technician_skill(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_technician_skill(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_technician_skill(UUID, TEXT) TO authenticated;

-- 9. dismiss_technician_skill
CREATE OR REPLACE FUNCTION public.dismiss_technician_skill(
  p_technician_profile_id UUID,
  p_skill TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_role_text TEXT := public.current_user_role()::text;
  v_trimmed_skill TEXT := trim(p_skill);
  v_tp RECORD;
  v_new_suggested JSONB;
BEGIN
  -- 1. Authorization: Service Centre Admin Only
  IF v_admin_role_text NOT IN ('admin', 'service_centre') THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Only Service Centre administrators can dismiss technician skills.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Input validation
  IF v_trimmed_skill IS NULL OR v_trimmed_skill = '' THEN
    RAISE EXCEPTION 'EMPTY_SKILL: Skill cannot be empty or whitespace.'
      USING ERRCODE = '22000';
  END IF;

  -- 3. Fetch technician profile with lock
  SELECT profile_id, ai_suggested_skills
  INTO v_tp
  FROM public.technician_profiles
  WHERE profile_id = p_technician_profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Technician profile does not exist.' USING ERRCODE = '02000';
  END IF;

  -- 4. Remove skill from ai_suggested_skills
  SELECT coalesce(
    pg_catalog.jsonb_agg(elem),
    '[]'::jsonb
  )
  INTO v_new_suggested
  FROM pg_catalog.jsonb_array_elements_text(COALESCE(v_tp.ai_suggested_skills, '[]'::jsonb)) elem
  WHERE elem != v_trimmed_skill;

  -- 5. Update technician_profiles
  UPDATE public.technician_profiles
  SET ai_suggested_skills = v_new_suggested,
      updated_at = pg_catalog.now()
  WHERE profile_id = p_technician_profile_id;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'technician_id', p_technician_profile_id,
    'skill', v_trimmed_skill,
    'action', 'DISMISSED',
    'ai_suggested_skills', v_new_suggested
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dismiss_technician_skill(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dismiss_technician_skill(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.dismiss_technician_skill(UUID, TEXT) TO authenticated;

-- 9b. get_technician_private_profile
CREATE OR REPLACE FUNCTION public.get_technician_private_profile(
  p_technician_profile_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_profile_id UUID := public.current_profile_id();
  v_caller_role_text TEXT := public.current_user_role()::text;
  v_tp RECORD;
  v_is_authorized BOOLEAN := FALSE;
BEGIN
  -- 1. Authorization: Only the technician themselves or Service Centre administrators
  IF v_caller_role_text IN ('admin', 'service_centre') THEN
    v_is_authorized := TRUE;
  ELSIF v_caller_profile_id = p_technician_profile_id THEN
    v_is_authorized := TRUE;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'ACCESS_DENIED: Caller is not authorized to view private KYC or AI skill data for this technician.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Fetch Target Technician Profile
  SELECT profile_id, phone, kyc_verified, kyc_verified_at, kyc_verified_by,
         kyc_document_type, kyc_masked_id, kyc_remarks,
         ai_suggested_skills, verified_skills
  INTO v_tp
  FROM public.technician_profiles
  WHERE profile_id = p_technician_profile_id
     OR id = p_technician_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Technician profile does not exist.'
      USING ERRCODE = '02000';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'profile_id', v_tp.profile_id,
    'phone', v_tp.phone,
    'kyc_verified', v_tp.kyc_verified,
    'kyc_verified_at', v_tp.kyc_verified_at,
    'kyc_verified_by', v_tp.kyc_verified_by,
    'kyc_document_type', v_tp.kyc_document_type,
    'kyc_masked_id', v_tp.kyc_masked_id,
    'kyc_remarks', v_tp.kyc_remarks,
    'ai_suggested_skills', v_tp.ai_suggested_skills,
    'verified_skills', v_tp.verified_skills
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_technician_private_profile(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_technician_private_profile(UUID) TO authenticated;

-- 9c. get_technician_workshop_profile (Owner and Admin access to workshop profile including phone)
CREATE OR REPLACE FUNCTION public.get_technician_workshop_profile(
  p_profile_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_profile_id UUID := public.current_profile_id();
  v_caller_role_text TEXT := public.current_user_role()::text;
  v_target_profile_id UUID;
  v_tp RECORD;
BEGIN
  IF p_profile_id IS NULL THEN
    v_target_profile_id := v_caller_profile_id;
  ELSE
    v_target_profile_id := p_profile_id;
  END IF;

  IF v_target_profile_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
  END IF;

  -- Only self or admin/service_centre can read private workshop phone
  IF NOT (v_caller_role_text IN ('admin', 'service_centre') OR v_caller_profile_id = v_target_profile_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: Caller is not authorized to view workshop phone for this technician.'
      USING ERRCODE = '42501';
  END IF;

  SELECT profile_id, workshop_name, phone, is_available, primary_facility_id, updated_at
  INTO v_tp
  FROM public.technician_profiles
  WHERE profile_id = v_target_profile_id
     OR id = v_target_profile_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'profile_id', v_tp.profile_id,
    'workshop_name', v_tp.workshop_name,
    'phone', v_tp.phone,
    'is_available', v_tp.is_available,
    'primary_facility_id', v_tp.primary_facility_id,
    'updated_at', v_tp.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_technician_workshop_profile(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_technician_workshop_profile(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_technician_workshop_profile(UUID) TO authenticated;

-- 9d. admin_set_technician_verification (Admin-only RPC to set is_verified)
CREATE OR REPLACE FUNCTION public.admin_set_technician_verification(
  p_technician_profile_id UUID,
  p_is_verified BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_role_text TEXT := public.current_user_role()::text;
  v_tp RECORD;
BEGIN
  -- 1. Authorization: Only service centre administrators can update account verification
  IF v_admin_role_text NOT IN ('admin', 'service_centre') THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Only service centre administrators can update technician account verification.'
      USING ERRCODE = '42501';
  END IF;

  IF p_technician_profile_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Technician profile ID is required.'
      USING ERRCODE = '22000';
  END IF;

  -- 2. Update is_verified (permitted inside postgres-owned SECURITY DEFINER)
  UPDATE public.technician_profiles
  SET is_verified = p_is_verified,
      updated_at = pg_catalog.now()
  WHERE profile_id = p_technician_profile_id
     OR id = p_technician_profile_id
  RETURNING id, profile_id, is_verified, workshop_name
  INTO v_tp;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Technician profile not found for the specified ID.'
      USING ERRCODE = '02000';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'id', v_tp.id,
    'profile_id', v_tp.profile_id,
    'is_verified', v_tp.is_verified,
    'workshop_name', v_tp.workshop_name,
    'updated_at', pg_catalog.now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_technician_verification(UUID, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_set_technician_verification(UUID, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_technician_verification(UUID, BOOLEAN) TO authenticated;

-- 10. record_load_test_signoff
CREATE OR REPLACE FUNCTION public.record_load_test_signoff(
  p_repair_request_id UUID,
  p_passed BOOLEAN,
  p_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_profile_id UUID := public.current_profile_id();
  v_caller_role_text TEXT := public.current_user_role()::text;
  v_repair RECORD;
  v_is_facility_member BOOLEAN := FALSE;
BEGIN
  -- 1. Lock Target Repair
  SELECT id, status, technician_id, facility_id, load_test_passed
  INTO v_repair
  FROM public.repair_requests
  WHERE id = p_repair_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Repair request does not exist.' USING ERRCODE = '02000';
  END IF;

  -- 2. Immutability Guard: Cannot alter load test after COMPLETED
  IF v_repair.status = 'COMPLETED' THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: Load test results cannot be modified after repair is completed.'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Authorization Check
  IF v_repair.facility_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.facility_memberships
      WHERE facility_id = v_repair.facility_id
        AND technician_profile_id = v_caller_profile_id
        AND status = 'ACTIVE'
    ) INTO v_is_facility_member;
  END IF;

  IF NOT (
    v_caller_role_text IN ('admin', 'service_centre') OR
    v_repair.technician_id = v_caller_profile_id OR
    v_is_facility_member
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Only assigned technician, facility technician, or Service Centre admin can record load testing.'
      USING ERRCODE = '42501';
  END IF;

  -- 4. Minimum Notes Validation (at least 10 characters documenting operational metrics)
  IF p_notes IS NULL OR pg_catalog.length(trim(p_notes)) < 10 THEN
    RAISE EXCEPTION 'INSUFFICIENT_NOTES: Load test notes must detail operational metrics (engine temperature, pressure, etc.).'
      USING ERRCODE = '22000';
  END IF;

  -- 5. Record Result
  UPDATE public.repair_requests
  SET load_test_passed = p_passed,
      load_test_notes = p_notes,
      load_tested_at = pg_catalog.now(),
      load_tested_by = v_caller_profile_id,
      updated_at = pg_catalog.now()
  WHERE id = p_repair_request_id;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'repair_id', p_repair_request_id,
    'load_test_passed', p_passed,
    'recorded_at', pg_catalog.now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_load_test_signoff(UUID, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_load_test_signoff(UUID, BOOLEAN, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_load_test_signoff(UUID, BOOLEAN, TEXT) TO authenticated;

-- 11. record_offline_payment_clearance
CREATE OR REPLACE FUNCTION public.record_offline_payment_clearance(
  p_repair_request_id UUID,
  p_payment_method TEXT,
  p_payment_reference TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_profile_id UUID := public.current_profile_id();
  v_caller_role_text TEXT := public.current_user_role()::text;
  v_repair RECORD;
  v_is_facility_member BOOLEAN := FALSE;
  v_has_approved_quote BOOLEAN := FALSE;
  v_trimmed_ref TEXT := trim(p_payment_reference);
BEGIN
  -- 1. Fetch Repair with Lock
  SELECT id, status, technician_id, facility_id, payment_cleared_at
  INTO v_repair
  FROM public.repair_requests
  WHERE id = p_repair_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Repair request does not exist.' USING ERRCODE = '02000';
  END IF;

  -- 2. Authorization
  IF v_repair.facility_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.facility_memberships
      WHERE facility_id = v_repair.facility_id
        AND technician_profile_id = v_caller_profile_id
        AND role IN ('OWNER', 'MANAGER')
        AND status = 'ACTIVE'
    ) INTO v_is_facility_member;
  END IF;

  IF NOT (
    v_caller_role_text IN ('admin', 'service_centre') OR
    v_repair.technician_id = v_caller_profile_id OR
    v_is_facility_member
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Only assigned technician, facility manager, or Service Centre admin can record payment clearance.'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Verify Approved Quote Exists
  SELECT EXISTS (
    SELECT 1 FROM public.quotes
    WHERE repair_request_id = p_repair_request_id AND status = 'APPROVED'
  ) INTO v_has_approved_quote;

  IF NOT v_has_approved_quote THEN
    RAISE EXCEPTION 'QUOTE_NOT_APPROVED: An approved itemized quote is required before payment clearance can be recorded.'
      USING ERRCODE = '22000';
  END IF;

  -- 4. Validate Method & Mandatory Reference
  IF p_payment_method NOT IN ('CASH_ON_DELIVERY', 'DIRECT_UPI', 'DIRECT_BANK_TRANSFER', 'OFFLINE_CHEQUE', 'WAIVED_WARRANTY') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_METHOD: Supported offline methods: CASH_ON_DELIVERY, DIRECT_UPI, DIRECT_BANK_TRANSFER, OFFLINE_CHEQUE, WAIVED_WARRANTY.'
      USING ERRCODE = '22000';
  END IF;

  IF p_payment_method IN ('DIRECT_UPI', 'DIRECT_BANK_TRANSFER', 'OFFLINE_CHEQUE') THEN
    IF v_trimmed_ref IS NULL OR pg_catalog.length(v_trimmed_ref) < 4 THEN
      RAISE EXCEPTION 'MISSING_PAYMENT_REFERENCE: A valid transaction reference or cheque number is required for %.', p_payment_method
        USING ERRCODE = '22000';
    END IF;
  END IF;

  -- 5. Record Authoritative Clearance
  UPDATE public.repair_requests
  SET payment_cleared_at = pg_catalog.now(),
      payment_cleared_by = v_caller_profile_id,
      payment_method = p_payment_method,
      payment_reference = v_trimmed_ref,
      updated_at = pg_catalog.now()
  WHERE id = p_repair_request_id;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'repair_id', p_repair_request_id,
    'payment_cleared_at', pg_catalog.now(),
    'payment_method', p_payment_method,
    'payment_reference', v_trimmed_ref,
    'payment_cleared_by', v_caller_profile_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_offline_payment_clearance(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_offline_payment_clearance(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_offline_payment_clearance(UUID, TEXT, TEXT) TO authenticated;

-- 12. authorize_equipment_handover
CREATE OR REPLACE FUNCTION public.authorize_equipment_handover(
  p_repair_request_id UUID,
  p_authorization_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_profile_id UUID := public.current_profile_id();
  v_caller_role_text TEXT := public.current_user_role()::text;
  v_repair RECORD;
  v_is_facility_manager BOOLEAN := FALSE;
  v_has_approved_quote BOOLEAN := FALSE;
  v_has_pending_parts BOOLEAN := FALSE;
BEGIN
  -- 1. Fetch & Lock Repair
  SELECT id, status, technician_id, facility_id, load_test_passed, handover_status, payment_cleared_at
  INTO v_repair
  FROM public.repair_requests
  WHERE id = p_repair_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Repair request does not exist.' USING ERRCODE = '02000';
  END IF;

  -- 2. State Guard
  IF v_repair.status != 'COMPLETED' THEN
    RAISE EXCEPTION 'PRECONDITION_FAILED: Repair must be COMPLETED before authorizing equipment handover.'
      USING ERRCODE = '22000';
  END IF;

  IF NOT v_repair.load_test_passed THEN
    RAISE EXCEPTION 'LOAD_TEST_REQUIRED: Operational load test must be verified before handover authorization.'
      USING ERRCODE = '22000';
  END IF;

  IF v_repair.handover_status != 'PENDING' THEN
    RAISE EXCEPTION 'INVALID_STATE: Handover is already %.', v_repair.handover_status
      USING ERRCODE = '22000';
  END IF;

  -- 3. Authorization: Assigned Tech, Facility Owner/Manager, or Admin
  IF v_repair.facility_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.facility_memberships
      WHERE facility_id = v_repair.facility_id
        AND technician_profile_id = v_caller_profile_id
        AND role IN ('OWNER', 'MANAGER')
        AND status = 'ACTIVE'
    ) INTO v_is_facility_manager;
  END IF;

  IF NOT (
    v_caller_role_text IN ('admin', 'service_centre') OR
    v_repair.technician_id = v_caller_profile_id OR
    v_is_facility_manager
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Ordinary facility technicians cannot authorize equipment release.'
      USING ERRCODE = '42501';
  END IF;

  -- 4. Verify Quote Approval in Database
  SELECT EXISTS (
    SELECT 1 FROM public.quotes
    WHERE repair_request_id = p_repair_request_id AND status = 'APPROVED'
  ) INTO v_has_approved_quote;

  IF NOT v_has_approved_quote THEN
    RAISE EXCEPTION 'QUOTE_NOT_APPROVED: An approved itemized quote is required before release.'
      USING ERRCODE = '22000';
  END IF;

  -- 5. Verify No Unfulfilled Depot Parts Holds (actual table: service_centre_part_requests)
  IF pg_catalog.to_regclass('public.service_centre_part_requests') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (
      SELECT 1 FROM public.service_centre_part_requests
      WHERE repair_request_id = $1 AND status = ''PENDING''
    )' INTO v_has_pending_parts USING p_repair_request_id;

    IF v_has_pending_parts THEN
      RAISE EXCEPTION 'PENDING_PARTS_HOLD: Requisitioned parts are still PENDING and must be handed off or cancelled.'
        USING ERRCODE = '22000';
    END IF;
  END IF;

  -- 6. Authoritative Payment Clearance Check
  IF v_repair.payment_cleared_at IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_NOT_CLEARED: Offline payment clearance must be recorded in the database before handover can be authorized.'
      USING ERRCODE = '22000';
  END IF;

  -- 7. Advance to AUTHORIZED
  UPDATE public.repair_requests
  SET handover_status = 'AUTHORIZED',
      handover_authorized_at = pg_catalog.now(),
      handover_authorized_by = v_caller_profile_id,
      handover_notes = p_authorization_notes,
      updated_at = pg_catalog.now()
  WHERE id = p_repair_request_id;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'repair_id', p_repair_request_id,
    'handover_status', 'AUTHORIZED'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_equipment_handover(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.authorize_equipment_handover(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.authorize_equipment_handover(UUID, TEXT) TO authenticated;

-- 13. execute_equipment_handover_release
CREATE OR REPLACE FUNCTION public.execute_equipment_handover_release(
  p_repair_request_id UUID,
  p_release_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_profile_id UUID := public.current_profile_id();
  v_caller_role_text TEXT := public.current_user_role()::text;
  v_repair RECORD;
  v_is_facility_member BOOLEAN := FALSE;
BEGIN
  -- 1. Fetch & Lock Repair
  SELECT id, status, technician_id, farmer_id, facility_id, handover_status, handover_notes
  INTO v_repair
  FROM public.repair_requests
  WHERE id = p_repair_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Repair request does not exist.' USING ERRCODE = '02000';
  END IF;

  -- 2. State Verification: Must be AUTHORIZED
  IF v_repair.handover_status != 'AUTHORIZED' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Equipment handover must be in AUTHORIZED status before executing release.'
      USING ERRCODE = '22000';
  END IF;

  -- 3. Authorization Check
  IF v_repair.facility_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.facility_memberships
      WHERE facility_id = v_repair.facility_id
        AND technician_profile_id = v_caller_profile_id
        AND status = 'ACTIVE'
    ) INTO v_is_facility_member;
  END IF;

  IF NOT (
    v_caller_role_text IN ('admin', 'service_centre') OR
    v_repair.technician_id = v_caller_profile_id OR
    v_is_facility_member
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Caller is not authorized to release this equipment.'
      USING ERRCODE = '42501';
  END IF;

  -- 4. Execute Physical Release
  UPDATE public.repair_requests
  SET handover_status = 'RELEASED',
      handover_released_at = pg_catalog.now(),
      handover_released_by = v_caller_profile_id,
      handover_notes = coalesce(handover_notes || E'\nRelease: ' || p_release_notes, p_release_notes),
      updated_at = pg_catalog.now()
  WHERE id = p_repair_request_id;

  -- 5. Notify Farmer
  INSERT INTO public.notifications (
    recipient_role, recipient_user_id, notification_text, link_target, is_read, created_at
  ) VALUES (
    'farmer'::public.user_role,
    v_repair.farmer_id,
    'Your machinery has been physically handed over. Please confirm receipt in the Farmer Portal.',
    '/farmer/repair/' || p_repair_request_id::text,
    FALSE,
    pg_catalog.now()
  );

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'repair_id', p_repair_request_id,
    'handover_status', 'RELEASED'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.execute_equipment_handover_release(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.execute_equipment_handover_release(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.execute_equipment_handover_release(UUID, TEXT) TO authenticated;

-- 14. confirm_farmer_equipment_collection
CREATE OR REPLACE FUNCTION public.confirm_farmer_equipment_collection(
  p_repair_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_profile_id UUID := public.current_profile_id();
  v_repair RECORD;
BEGIN
  SELECT id, farmer_id, handover_status, farmer_collection_confirmed, farmer_collection_confirmed_at
  INTO v_repair
  FROM public.repair_requests
  WHERE id = p_repair_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Repair request does not exist.' USING ERRCODE = '02000';
  END IF;

  IF v_repair.farmer_id != v_caller_profile_id THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Only the owning farmer can confirm equipment collection.'
      USING ERRCODE = '42501';
  END IF;

  IF v_repair.handover_status != 'RELEASED' THEN
    RAISE EXCEPTION 'PRECONDITION_FAILED: Equipment must be in RELEASED status before collection can be confirmed.'
      USING ERRCODE = '22000';
  END IF;

  IF v_repair.farmer_collection_confirmed THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', true,
      'already_confirmed', true,
      'confirmed_at', v_repair.farmer_collection_confirmed_at
    );
  END IF;

  UPDATE public.repair_requests
  SET farmer_collection_confirmed = TRUE,
      farmer_collection_confirmed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE id = p_repair_request_id;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'repair_id', p_repair_request_id,
    'farmer_collection_confirmed', true,
    'confirmed_at', pg_catalog.now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_farmer_equipment_collection(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_farmer_equipment_collection(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirm_farmer_equipment_collection(UUID) TO authenticated;

-- ------------------------------------------------------------------------------
-- 5. DISCRETIONARY ACCESS CONTROL (DAC) & ROW-LEVEL SECURITY (RLS) POLICIES
-- ------------------------------------------------------------------------------

-- A. public.repair_facilities DAC & RLS
ALTER TABLE public.repair_facilities ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.repair_facilities FROM anon, authenticated, PUBLIC;

-- Grant column-level SELECT strictly on safe coarse attributes
GRANT SELECT (id, name, village, tahsil, operating_hours, drop_off_approved, is_active, created_at, updated_at)
  ON TABLE public.repair_facilities TO authenticated;

-- Grant INSERT and UPDATE to authenticated roles (strictly enforced by RLS policies and trigger guards)
GRANT INSERT, UPDATE ON TABLE public.repair_facilities TO authenticated;

GRANT ALL ON TABLE public.repair_facilities TO service_role;

DROP POLICY IF EXISTS "repair_facilities_select_policy" ON public.repair_facilities;
CREATE POLICY "repair_facilities_select_policy"
  ON public.repair_facilities FOR SELECT
  TO authenticated
  USING (
    (drop_off_approved = TRUE AND is_active = TRUE)
    OR owner_profile_id = public.current_profile_id()
    OR public.current_user_role()::text IN ('admin', 'service_centre')
    OR EXISTS (
      SELECT 1 FROM public.facility_memberships
      WHERE facility_id = repair_facilities.id
        AND technician_profile_id = public.current_profile_id()
        AND status = 'ACTIVE'
    )
  );

DROP POLICY IF EXISTS "repair_facilities_insert_policy" ON public.repair_facilities;
CREATE POLICY "repair_facilities_insert_policy"
  ON public.repair_facilities FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_user_role()::text IN ('admin', 'service_centre', 'technician')
    AND owner_profile_id = public.current_profile_id()
  );

DROP POLICY IF EXISTS "repair_facilities_update_policy" ON public.repair_facilities;
CREATE POLICY "repair_facilities_update_policy"
  ON public.repair_facilities FOR UPDATE
  TO authenticated
  USING (
    owner_profile_id = public.current_profile_id()
    OR public.current_user_role()::text IN ('admin', 'service_centre')
    OR EXISTS (
      SELECT 1 FROM public.facility_memberships
      WHERE facility_id = repair_facilities.id
        AND technician_profile_id = public.current_profile_id()
        AND role IN ('OWNER', 'MANAGER')
        AND status = 'ACTIVE'
    )
  );

-- B. public.facility_memberships DAC & RLS
ALTER TABLE public.facility_memberships ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.facility_memberships FROM anon, authenticated, PUBLIC;
GRANT SELECT, UPDATE, DELETE ON TABLE public.facility_memberships TO authenticated;
GRANT ALL ON TABLE public.facility_memberships TO service_role;

-- Helper routine to evaluate active facility membership without recursive RLS query rewriter expansion
CREATE OR REPLACE FUNCTION public.is_active_facility_member(
  p_facility_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.facility_memberships
    WHERE facility_id = p_facility_id
      AND technician_profile_id = public.current_profile_id()
      AND status = 'ACTIVE'
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_facility_member(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_facility_member(UUID) TO authenticated;

DROP POLICY IF EXISTS "facility_memberships_select_policy" ON public.facility_memberships;
CREATE POLICY "facility_memberships_select_policy"
  ON public.facility_memberships FOR SELECT
  TO authenticated
  USING (
    technician_profile_id = public.current_profile_id()
    OR public.current_user_role()::text IN ('admin', 'service_centre')
    OR public.is_active_facility_member(facility_id)
  );

DROP POLICY IF EXISTS "facility_memberships_delete_policy" ON public.facility_memberships;
CREATE POLICY "facility_memberships_delete_policy"
  ON public.facility_memberships FOR DELETE
  TO authenticated
  USING (
    technician_profile_id = public.current_profile_id()
    OR public.current_user_role()::text IN ('admin', 'service_centre')
    OR EXISTS (
      SELECT 1 FROM public.facility_memberships m
      WHERE m.facility_id = facility_memberships.facility_id
        AND m.technician_profile_id = public.current_profile_id()
        AND m.role = 'OWNER'
        AND m.status = 'ACTIVE'
    )
    OR (
      facility_memberships.role = 'TECHNICIAN'
      AND EXISTS (
        SELECT 1 FROM public.facility_memberships m
        WHERE m.facility_id = facility_memberships.facility_id
          AND m.technician_profile_id = public.current_profile_id()
          AND m.role = 'MANAGER'
          AND m.status = 'ACTIVE'
      )
    )
  );

-- C. public.technician_reviews DAC & RLS
ALTER TABLE public.technician_reviews ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.technician_reviews FROM anon, PUBLIC;
-- Reviews are completely immutable once created (REVOKE direct UPDATE/DELETE/TRUNCATE from all roles)
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.technician_reviews FROM authenticated, anon, PUBLIC, service_role;
GRANT SELECT, INSERT ON TABLE public.technician_reviews TO authenticated;
GRANT SELECT ON TABLE public.technician_reviews TO service_role;

DROP POLICY IF EXISTS "Farmers can insert reviews for completed repairs with service history" ON public.technician_reviews;
CREATE POLICY "Farmers can insert reviews for completed repairs with service history"
  ON public.technician_reviews
  FOR INSERT
  TO authenticated
  WITH CHECK (
    farmer_profile_id = public.current_profile_id()
    AND EXISTS (
      SELECT 1 FROM public.service_history sh
      JOIN public.repair_requests r ON r.id = sh.repair_request_id
      WHERE sh.id = technician_reviews.service_history_id
        AND r.id = technician_reviews.repair_id
        AND r.farmer_id = public.current_profile_id()
        AND r.technician_id = technician_reviews.technician_profile_id
        AND r.status = 'COMPLETED'
    )
  );

DROP POLICY IF EXISTS "Public and authenticated users can view published reviews" ON public.technician_reviews;
CREATE POLICY "Public and authenticated users can view published reviews"
  ON public.technician_reviews
  FOR SELECT
  TO authenticated
  USING (is_published = TRUE);

-- D. public.service_history Hardening & DAC
-- Service history is permanent machinery audit record (REVOKE direct UPDATE/DELETE/TRUNCATE from all roles)
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.service_history FROM authenticated, anon, PUBLIC, service_role;

DROP POLICY IF EXISTS "Service history insert policy" ON public.service_history;
CREATE POLICY "Service history insert policy"
  ON public.service_history FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_user_role()::text IN ('technician', 'admin', 'service_centre')
    AND EXISTS (
      SELECT 1 FROM public.repair_requests r
      WHERE r.id = service_history.repair_request_id
        AND r.status = 'COMPLETED'
        AND (r.technician_id = public.current_profile_id() OR public.current_user_role()::text IN ('admin', 'service_centre'))
    )
  );

-- E. public.repair_requests DAC & Column Partitioning
REVOKE ALL ON TABLE public.repair_requests FROM anon, PUBLIC;
REVOKE UPDATE, DELETE ON TABLE public.repair_requests FROM authenticated;

-- Defensively revoke any potential column ACL retention on payment clearance fields
REVOKE UPDATE (payment_cleared_at, payment_cleared_by, payment_method, payment_reference)
  ON TABLE public.repair_requests FROM authenticated, anon, PUBLIC;

-- Grant column-level UPDATE strictly on 16 verified operational columns
GRANT UPDATE (
  status,
  status_since,
  technician_id,
  declined_by,
  assessment,
  completion_details,
  is_testing,
  parts_hold,
  clarification_note,
  cancellation_reason,
  cancellation_note,
  cancellation_requested_by,
  cancellation_requested_at,
  cancellation_previous_status,
  cancellation_admin_response,
  updated_at
) ON TABLE public.repair_requests TO authenticated;

GRANT ALL ON TABLE public.repair_requests TO service_role;

-- F. public.technician_profiles DAC & Privacy Partitioning
ALTER TABLE public.technician_profiles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.technician_profiles FROM anon, PUBLIC;
REVOKE SELECT, UPDATE, DELETE, TRUNCATE ON TABLE public.technician_profiles FROM authenticated;
REVOKE UPDATE, TRUNCATE ON TABLE public.technician_profiles FROM service_role;

-- Defensively revoke UPDATE on all protected governance, rating, and KYC fields from all roles
REVOKE UPDATE (
  is_verified,
  kyc_verified,
  kyc_verified_at,
  kyc_verified_by,
  kyc_document_type,
  kyc_masked_id,
  kyc_remarks,
  verified_skills,
  ai_suggested_skills,
  rating,
  review_count,
  jobs_completed
) ON TABLE public.technician_profiles FROM authenticated, service_role, anon, PUBLIC;

-- Grant column-level SELECT strictly on safe non-confidential operational columns
-- Note: Sensitive fields (kyc_verified_at, kyc_verified_by, kyc_document_type, kyc_masked_id,
-- kyc_remarks, ai_suggested_skills) are strictly accessible only via get_technician_private_profile() RPC
GRANT SELECT (
  id,
  profile_id,
  workshop_name,
  brands,
  skills,
  verified_skills,
  rating,
  review_count,
  is_available,
  is_verified,
  kyc_verified,
  jobs_completed,
  distance_km,
  eta_minutes,
  primary_facility_id,
  created_at,
  updated_at
) ON TABLE public.technician_profiles TO authenticated;

-- Grant column-level UPDATE strictly on technician-editable operational columns
GRANT UPDATE (
  workshop_name,
  phone,
  brands,
  skills,
  is_available,
  distance_km,
  eta_minutes,
  primary_facility_id,
  updated_at
) ON TABLE public.technician_profiles TO authenticated, service_role;

-- Grant standard SELECT, INSERT, DELETE for administrative backend maintenance
GRANT SELECT, INSERT, DELETE ON TABLE public.technician_profiles TO service_role;

-- ------------------------------------------------------------------------------
-- 6. STAGING DEMO RESET FORWARD COMPATIBILITY (reset_demo_data)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reset_demo_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_email text;
  v_demo_farmer_id CONSTANT uuid := '00000000-0000-0000-0001-000000000001'::uuid;
  v_demo_tech_id CONSTANT uuid   := '00000000-0000-0000-0002-000000000001'::uuid;
  v_demo_admin_id CONSTANT uuid  := '00000000-0000-0000-0003-000000000001'::uuid;
  v_demo_repair_ids uuid[] := '{}';
  v_demo_quote_ids uuid[] := '{}';
  v_repairs_deleted int := 0;
  v_equipment_reset int := 0;
  v_equipment_deleted int := 0;
  v_notifications_deleted int := 0;
  v_service_history_deleted int := 0;
  v_reviews_deleted int := 0;
BEGIN
  -- 1. Caller Authentication Verification
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Demo reset requires an authenticated session.'
      USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_caller_email
  FROM auth.users
  WHERE id = v_caller_id;

  IF v_caller_email IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Caller user record not found.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Exact Pair Matching: strictly disallows cross-pairing of IDs and emails
  IF NOT (
    (v_caller_id = '00000000-0000-0000-0001-000000000001'::uuid AND v_caller_email = 'farmer.staging@terrabyte.app') OR
    (v_caller_id = '00000000-0000-0000-0002-000000000001'::uuid AND v_caller_email = 'tech.staging@terrabyte.app') OR
    (v_caller_id = '00000000-0000-0000-0003-000000000001'::uuid AND v_caller_email = 'admin.staging@terrabyte.app') OR
    (v_caller_id = '00000000-0000-0000-0000-000000000001'::uuid AND v_caller_email = 'farmer.nagpur@terrabyte.demo') OR
    (v_caller_id = '00000000-0000-0000-0000-000000000004'::uuid AND v_caller_email = 'tech.nagpur@terrabyte.demo') OR
    (v_caller_id = '00000000-0000-0000-0000-000000000005'::uuid AND v_caller_email = 'admin.nagpur@terrabyte.demo')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Demo reset is strictly reserved for designated demo evaluation personas.'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Dual-Key Verification (demo_code required)
  IF NOT EXISTS (
    SELECT 1 FROM public.profile_auth_secrets pas
    WHERE pas.auth_user_id = v_caller_id AND pas.demo_code IS NOT NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE (p.auth_user_id = v_caller_id OR p.id = v_caller_id) AND p.demo_code IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Forbidden: caller profile is missing demo_code';
  END IF;

  -- 4. Scoped Demo Repairs (Direct farmer repairs OR equipment belonging to demo farmer)
  SELECT COALESCE(pg_catalog.array_agg(id), '{}') INTO v_demo_repair_ids
  FROM public.repair_requests
  WHERE farmer_id = v_demo_farmer_id
     OR equipment_id IN (
       SELECT id FROM public.equipment WHERE farmer_id = v_demo_farmer_id
     );

  IF v_demo_repair_ids IS NOT NULL AND pg_catalog.array_length(v_demo_repair_ids, 1) > 0 THEN
    -- Collect demo quote IDs
    SELECT COALESCE(pg_catalog.array_agg(id), '{}') INTO v_demo_quote_ids
    FROM public.quotes
    WHERE repair_request_id = ANY(v_demo_repair_ids);

    -- 5. Pre-delete Phase 13 reviews for demo repairs (prevents FK RESTRICT violation with service_history & repair_requests)
    IF pg_catalog.to_regclass('public.technician_reviews') IS NOT NULL THEN
      WITH del_reviews AS (
        DELETE FROM public.technician_reviews
        WHERE repair_id = ANY(v_demo_repair_ids) OR farmer_profile_id = v_demo_farmer_id
        RETURNING id
      )
      SELECT count(*) INTO v_reviews_deleted FROM del_reviews;
    END IF;

    -- 6. Delete dependent service_history BEFORE repair_requests and equipment
    -- (Strictly satisfies ON DELETE RESTRICT on service_history.repair_request_id and service_history.equipment_id)
    WITH del_sh AS (
      DELETE FROM public.service_history
      WHERE equipment_id IN (SELECT id FROM public.equipment WHERE farmer_id = v_demo_farmer_id)
         OR repair_request_id = ANY(v_demo_repair_ids)
      RETURNING id
    )
    SELECT count(*) INTO v_service_history_deleted FROM del_sh;

    -- 7. Delete dependent quote items and quotes
    IF v_demo_quote_ids IS NOT NULL AND pg_catalog.array_length(v_demo_quote_ids, 1) > 0 THEN
      DELETE FROM public.quote_items WHERE quote_id = ANY(v_demo_quote_ids);
    END IF;
    DELETE FROM public.quotes WHERE repair_request_id = ANY(v_demo_repair_ids);

    -- 8. Delete repair sub-tables
    DELETE FROM public.repair_dispatch_locations WHERE repair_request_id = ANY(v_demo_repair_ids);
    DELETE FROM public.repair_messages WHERE repair_request_id = ANY(v_demo_repair_ids);
    DELETE FROM public.repair_notes WHERE repair_request_id = ANY(v_demo_repair_ids);
    DELETE FROM public.repair_timeline WHERE repair_request_id = ANY(v_demo_repair_ids);

    -- 9. Delete parts desk dependent records (Phase 9/12)
    IF pg_catalog.to_regclass('public.service_centre_part_sales') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.service_centre_part_sales WHERE repair_request_id = ANY($1)' USING v_demo_repair_ids;
    END IF;

    IF pg_catalog.to_regclass('public.service_centre_part_requests') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.service_centre_part_requests WHERE repair_request_id = ANY($1)' USING v_demo_repair_ids;
    END IF;

    IF pg_catalog.to_regclass('public.service_centre_stock_audit') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.service_centre_stock_audit WHERE repair_request_id = ANY($1)' USING v_demo_repair_ids;
    END IF;

    -- 10. Delete repair requests (now completely unreferenced by service_history, reviews, quotes, or sub-tables)
    WITH del_repairs AS (
      DELETE FROM public.repair_requests WHERE id = ANY(v_demo_repair_ids) RETURNING id
    )
    SELECT count(*) INTO v_repairs_deleted FROM del_repairs;
  ELSE
    -- If there were no demo repair requests, still clean up any orphaned service history linked to demo equipment
    WITH del_sh AS (
      DELETE FROM public.service_history
      WHERE equipment_id IN (SELECT id FROM public.equipment WHERE farmer_id = v_demo_farmer_id)
      RETURNING id
    )
    SELECT count(*) INTO v_service_history_deleted FROM del_sh;
  END IF;

  -- 11. Delete notifications
  WITH del_notifs AS (
    DELETE FROM public.notifications
    WHERE recipient_user_id = v_demo_farmer_id
       OR (v_demo_repair_ids IS NOT NULL AND pg_catalog.array_length(v_demo_repair_ids, 1) > 0 AND EXISTS (
            SELECT 1 FROM pg_catalog.unnest(v_demo_repair_ids) r_id
            WHERE public.notifications.link_target LIKE '%' || r_id::text || '%'
          ))
    RETURNING id
  )
  SELECT count(*) INTO v_notifications_deleted FROM del_notifs;

  -- 12. Restore Parts Inventory Baseline for Service Centre (Phase 9/12)
  IF pg_catalog.to_regclass('public.service_centre_stock_audit') IS NOT NULL AND pg_catalog.to_regclass('public.service_centre_parts') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.service_centre_stock_audit WHERE repair_request_id IS NULL AND part_id IN (SELECT id FROM public.service_centre_parts WHERE service_centre_id = $1)' USING v_demo_admin_id;
  END IF;

  IF pg_catalog.to_regclass('public.service_centre_parts') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.service_centre_parts WHERE service_centre_id = $1 AND part_number NOT IN (''0433171'', ''005556958R1'', ''AL120788'', ''HY-GARD-15W30'', ''26243171'')' USING v_demo_admin_id;

    INSERT INTO public.service_centre_parts (
      service_centre_id, part_number, name, spec, category,
      compatible_models, stock_quantity, unit_price, location
    ) VALUES
      (v_demo_admin_id, '0433171', 'Fuel Injector Nozzle Set', 'Bosch 0433171 (x4)', 'Fuel system', ARRAY['Mahindra 575 DI'], 3, 2200, 'Depot Shelf A-02'),
      (v_demo_admin_id, '005556958R1', 'Inline Fuel Filter', 'Mahindra 005556958R1', 'Fuel system', ARRAY['Mahindra 575 DI'], 8, 350, 'Depot Shelf A-03'),
      (v_demo_admin_id, 'AL120788', 'Lift Cylinder Seal Kit', 'JD AL120788', 'Hydraulics', ARRAY['John Deere 5050D'], 2, 1650, 'Depot Shelf B-01'),
      (v_demo_admin_id, 'HY-GARD-15W30', 'Hydraulic Oil 15W-30', 'JD Hy-Gard, litres', 'Hydraulics', ARRAY['John Deere 5050D'], 5, 320, 'Depot Drum Rack B-04'),
      (v_demo_admin_id, '26243171', 'Starter Motor Assembly', 'Lucas-TVS 12V 2.2kW', 'Electrical', ARRAY['Mahindra 575 DI', 'Swaraj 744 FE'], 1, 5800, 'Depot Shelf C-01')
    ON CONFLICT (service_centre_id, part_number) DO UPDATE SET
      name = EXCLUDED.name,
      spec = EXCLUDED.spec,
      category = EXCLUDED.category,
      compatible_models = EXCLUDED.compatible_models,
      stock_quantity = EXCLUDED.stock_quantity,
      unit_price = EXCLUDED.unit_price,
      location = EXCLUDED.location,
      updated_at = pg_catalog.now()
    WHERE public.service_centre_parts.service_centre_id = v_demo_admin_id;
  END IF;

  -- 13. Delete Non-Canonical Demo Equipment
  WITH deleted_equipment AS (
    DELETE FROM public.equipment
    WHERE farmer_id = v_demo_farmer_id
      AND id NOT IN (
        '00000000-0000-0000-0010-000000000001'::uuid,
        '00000000-0000-0000-0010-000000000002'::uuid,
        '00000000-0000-0000-0010-000000000003'::uuid
      )
    RETURNING id
  )
  SELECT count(*) INTO v_equipment_deleted FROM deleted_equipment;

  -- 14. Restore Canonical Equipment (3 Machines)
  INSERT INTO public.equipment (
    id, farmer_id, type, make, model, year, serial_number, operating_hours, photo_url, status, demo_code
  ) VALUES
    ('00000000-0000-0000-0010-000000000001'::uuid, v_demo_farmer_id, 'Tractor', 'Mahindra', '575 DI', 2021, 'MH575-21-0048821', 1240, NULL, 'Operational', 'e1'),
    ('00000000-0000-0000-0010-000000000002'::uuid, v_demo_farmer_id, 'Power Tiller', 'VST Shakti', '130 DI', 2023, 'VST130-23-009112', 3120, NULL, 'Operational', 'e2'),
    ('00000000-0000-0000-0010-000000000003'::uuid, v_demo_farmer_id, 'Harvester', 'John Deere', 'W70', 2020, 'JD-W70-20-00192', 890, NULL, 'Operational', 'e3')
  ON CONFLICT (id) DO UPDATE SET
    farmer_id = EXCLUDED.farmer_id,
    type = EXCLUDED.type,
    make = EXCLUDED.make,
    model = EXCLUDED.model,
    year = EXCLUDED.year,
    serial_number = EXCLUDED.serial_number,
    operating_hours = EXCLUDED.operating_hours,
    photo_url = EXCLUDED.photo_url,
    status = 'Operational',
    demo_code = EXCLUDED.demo_code,
    updated_at = pg_catalog.now();

  SELECT count(*) INTO v_equipment_reset
  FROM public.equipment
  WHERE farmer_id = v_demo_farmer_id;

  -- 15. Seed / Reset Canonical Demo Facility (Phase 13)
  IF pg_catalog.to_regclass('public.repair_facilities') IS NOT NULL THEN
    INSERT INTO public.repair_facilities (
      id, name, owner_profile_id, phone, email, address, village, tahsil,
      latitude, longitude, max_equipment_capacity, drop_off_approved, is_active
    ) VALUES (
      '00000000-0000-0000-0020-000000000001'::uuid,
      'Nagpur Central Agro Repairs & Workshop, Hingna',
      v_demo_tech_id,
      '+91-98230-11223',
      'workshop.hingna@terrabyte.demo',
      'Plot 14, MIDC Agro Complex, Hingna Road',
      'Hingna',
      'Hingna',
      21.0965,
      78.9876,
      4,
      TRUE,
      TRUE
    ) ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      owner_profile_id = EXCLUDED.owner_profile_id,
      drop_off_approved = TRUE,
      is_active = TRUE,
      updated_at = pg_catalog.now();
  END IF;

  -- 16. Reset Demo Technician Operational, KYC & AI Skills State (Phase 13)
  UPDATE public.technician_profiles
  SET primary_facility_id = '00000000-0000-0000-0020-000000000001'::uuid,
      rating = NULL,
      review_count = 0,
      kyc_verified = TRUE,
      is_verified = TRUE,
      is_available = TRUE,
      verified_skills = '["Mahindra 575 DI specialist", "Hydraulics expert"]'::jsonb,
      ai_suggested_skills = '["Rotavator Gearbox Specialist"]'::jsonb,
      updated_at = pg_catalog.now()
  WHERE profile_id = v_demo_tech_id
     OR id = '00000000-0000-0000-0002-000000000011'::uuid;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'message', 'Phase 13 Demo baseline successfully and deterministically restored',
    'repairs_deleted', v_repairs_deleted,
    'reviews_deleted', v_reviews_deleted,
    'equipment_deleted', v_equipment_deleted,
    'equipment_reset', v_equipment_reset,
    'notifications_deleted', v_notifications_deleted,
    'service_history_deleted', v_service_history_deleted,
    'timestamp', pg_catalog.now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reset_demo_data() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reset_demo_data() FROM anon;
GRANT EXECUTE ON FUNCTION public.reset_demo_data() TO authenticated, service_role;

COMMENT ON FUNCTION public.reset_demo_data() IS
  'Deterministically resets demo data to baseline fixtures with Phase 13 workshop and review state for designated staging personas.';
