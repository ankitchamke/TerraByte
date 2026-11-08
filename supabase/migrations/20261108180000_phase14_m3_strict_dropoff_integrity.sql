-- ==============================================================================
-- TerraByte Migration: 20261108180000_phase14_m3_strict_dropoff_integrity.sql
-- Description: Phase 14 Milestone 3 — Strict Workshop Drop-Off & Delivery Mode Integrity
-- Scope:
--   1. Relational Invariants & Constraints:
--      - check_delivery_mode_facility_consistency:
--        Enforce that DOORSTEP tickets strictly have facility_id IS NULL, and
--        WORKSHOP_DROPOFF tickets strictly have facility_id IS NOT NULL.
--   2. Hardened SECURITY DEFINER Trigger & Validation Function:
--      - fn_validate_repair_request_facility_drop_off():
--        Enforces atomic validation during INSERT or UPDATE of delivery_mode,
--        facility_id, or is_immobile with strict SQLSTATE handling:
--        * 23514: Immobile machinery locked to DOORSTEP (cannot select WORKSHOP_DROPOFF)
--        * 23514: DOORSTEP cannot specify facility_id
--        * 23502: WORKSHOP_DROPOFF requires non-null facility_id
--        * 23503: Referenced workshop facility must exist in public.repair_facilities
--        * P0001: Referenced workshop facility must have is_active = TRUE
--        * P0001: Referenced workshop facility must have drop_off_approved = TRUE
--      - trg_validate_repair_request_facility_drop_off:
--        BEFORE INSERT OR UPDATE OF delivery_mode, facility_id, is_immobile
--        ON public.repair_requests FOR EACH ROW.
-- Invariants Maintained:
--   - Hardened with SET search_path = '' and fully qualified catalog/table names.
--   - Atomic rollback on violation, zero rows persisted.
--   - Fully compatible with Phase 14 M1 schema and permissions.
-- Author: TerraByte Engineering Team
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. RELATIONAL INTEGRITY CHECK CONSTRAINT
-- ------------------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_delivery_mode_facility_consistency'
  ) THEN
    ALTER TABLE public.repair_requests
      ADD CONSTRAINT check_delivery_mode_facility_consistency
      CHECK (
        (delivery_mode = 'DOORSTEP' AND facility_id IS NULL) OR
        (delivery_mode = 'WORKSHOP_DROPOFF' AND facility_id IS NOT NULL)
      );
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 2. HARDENED VALIDATION TRIGGER FUNCTION
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_validate_repair_request_facility_drop_off()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_is_active pg_catalog.bool;
  v_drop_off_approved pg_catalog.bool;
BEGIN
  -- Invariant 1: Immobile machinery cannot be transported for workshop drop-off
  IF NEW.is_immobile = TRUE AND NEW.delivery_mode = 'WORKSHOP_DROPOFF' THEN
    RAISE EXCEPTION 'Immobile machinery cannot be transported for workshop drop-off'
      USING ERRCODE = '23514';
  END IF;

  -- Invariant 2: Doorstep delivery mode must have NULL facility_id
  IF NEW.delivery_mode = 'DOORSTEP' AND NEW.facility_id IS NOT NULL THEN
    RAISE EXCEPTION 'Facility reference cannot be provided when delivery mode is DOORSTEP'
      USING ERRCODE = '23514';
  END IF;

  -- Invariants 3, 4, 5, 6: Workshop Drop-Off facility verification
  IF NEW.delivery_mode = 'WORKSHOP_DROPOFF' THEN
    IF NEW.facility_id IS NULL THEN
      RAISE EXCEPTION 'Workshop drop-off requires an explicit facility reference'
        USING ERRCODE = '23502';
    END IF;

    SELECT is_active, drop_off_approved
      INTO v_is_active, v_drop_off_approved
      FROM public.repair_facilities
     WHERE id = NEW.facility_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Referenced workshop facility % does not exist', NEW.facility_id
        USING ERRCODE = '23503';
    END IF;

    IF v_is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'Referenced workshop facility % is currently inactive', NEW.facility_id
        USING ERRCODE = 'P0001';
    END IF;

    IF v_drop_off_approved IS NOT TRUE THEN
      RAISE EXCEPTION 'Referenced workshop facility % is not approved for drop-off', NEW.facility_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. TRIGGER REGISTRATION
-- ------------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_validate_repair_request_facility_drop_off ON public.repair_requests;

CREATE TRIGGER trg_validate_repair_request_facility_drop_off
  BEFORE INSERT OR UPDATE OF delivery_mode, facility_id, is_immobile
  ON public.repair_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_repair_request_facility_drop_off();
