-- ==============================================================================
-- TerraByte — Phase 8B Demo-Data Cleanup: Restrict Reset Demo RPC
-- Migration: 20261028110000_phase8b_cleanup_reset_demo_rpc.sql
-- Description: Updates public.reset_demo_data() to strictly support only the
--              three retained accounts (Balasaheb Patil, Ramesh Kumar, Nagpur Service Centre).
--              Purges all sample repairs, quotes, notes, messages, timeline,
--              service history, and notifications.
--              Resets Balasaheb's three tractors to Operational baseline.
--              Never recreates or references deleted demo personas or sample repairs.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.reset_demo_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_email text;
  v_repairs_deleted int := 0;
  v_equipment_reset int := 0;
  v_notifications_deleted int := 0;
  v_service_history_deleted int := 0;
BEGIN
  -- ============================================================================
  -- 1. STRICT DUAL-KEY AUTHORIZATION (3 RETAINED PERSONAS ONLY)
  -- ============================================================================
  v_caller_id := auth.uid();

  -- Check A: auth.uid() must match one of the 3 designated retained demo UUIDs
  IF v_caller_id IS NULL OR v_caller_id NOT IN (
    '00000000-0000-0000-0000-000000000001'::uuid, -- farmer (Balasaheb Patil)
    '00000000-0000-0000-0000-000000000004'::uuid, -- technician (Ramesh Kumar)
    '00000000-0000-0000-0000-000000000005'::uuid  -- admin (Nagpur Service Centre)
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Demo reset is strictly reserved for designated demo evaluation personas.'
      USING ERRCODE = '42501';
  END IF;

  -- Check B: Caller profile email must match one of the 3 designated retained demo emails
  SELECT email INTO v_caller_email
  FROM public.profiles
  WHERE auth_user_id = v_caller_id OR id = v_caller_id;

  IF v_caller_email IS NULL OR v_caller_email NOT IN (
    'farmer.nagpur@terrabyte.demo',
    'tech.nagpur@terrabyte.demo',
    'admin.nagpur@terrabyte.demo'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Demo reset is strictly reserved for designated demo evaluation personas.'
      USING ERRCODE = '42501';
  END IF;

  -- ============================================================================
  -- 2. PURGE ALL SAMPLE REPAIR REQUESTS & DEPENDENT DATA
  -- Foreign key ON DELETE CASCADE automatically prunes quotes, quote_items,
  -- repair_notes, repair_timeline, repair_messages, and repair_dispatch_locations.
  -- ============================================================================
  WITH deleted_repairs AS (
    DELETE FROM public.repair_requests
    RETURNING id
  )
  SELECT count(*) INTO v_repairs_deleted FROM deleted_repairs;

  -- Explicit safety purge for any orphaned child records
  DELETE FROM public.repair_dispatch_locations;
  DELETE FROM public.repair_messages;
  DELETE FROM public.repair_notes;
  DELETE FROM public.repair_timeline;
  DELETE FROM public.quote_items;
  DELETE FROM public.quotes;

  -- ============================================================================
  -- 3. PURGE SERVICE HISTORY & NOTIFICATIONS
  -- ============================================================================
  WITH deleted_history AS (
    DELETE FROM public.service_history
    RETURNING id
  )
  SELECT count(*) INTO v_service_history_deleted FROM deleted_history;

  WITH deleted_notifs AS (
    DELETE FROM public.notifications
    RETURNING id
  )
  SELECT count(*) INTO v_notifications_deleted FROM deleted_notifs;

  -- ============================================================================
  -- 4. RESTORE BALASAHEB'S THREE TRACTORS TO OPERATIONAL BASELINE
  -- ============================================================================
  WITH reset_eq AS (
    UPDATE public.equipment
    SET status = 'Operational',
        updated_at = NOW()
    WHERE farmer_id = '00000000-0000-0000-0001-000000000001'::uuid
    RETURNING id
  )
  SELECT count(*) INTO v_equipment_reset FROM reset_eq;

  -- ============================================================================
  -- 5. RESTORE RAMESH KUMAR'S TECHNICIAN PROFILE TO OPERATIONAL BASELINE
  -- ============================================================================
  UPDATE public.technician_profiles
  SET is_available = true,
      is_verified = true,
      jobs_completed = 0,
      rating = 5.00,
      updated_at = NOW()
  WHERE id = '00000000-0000-0000-0002-000000000011'::uuid;

  -- ============================================================================
  -- 6. RETURN DETERMINISTIC CLEANUP SUMMARY
  -- ============================================================================
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Demo environment reset to clean baseline successfully.',
    'details', jsonb_build_object(
      'repairs_deleted', v_repairs_deleted,
      'equipment_reset', v_equipment_reset,
      'service_history_deleted', v_service_history_deleted,
      'notifications_deleted', v_notifications_deleted
    )
  );
END;
$$;
