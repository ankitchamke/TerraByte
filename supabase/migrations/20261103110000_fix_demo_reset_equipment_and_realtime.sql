-- ==============================================================================
-- TerraByte — Demo Reset Equipment Cleanup & Realtime Publications Fix
-- Migration: 20261103110000_fix_demo_reset_equipment_and_realtime.sql
-- Description:
--   1. Ensures REPLICA IDENTITY FULL and publication registration on
--      repair_messages and repair_timeline for CDC subscription filtering.
--   2. Updates public.reset_demo_data() to:
--      - Safely delete non-canonical equipment added by demo farmer (e.g. XYZ 69)
--        after dependent demo repairs and service history are cleared.
--      - Deterministically upsert the 3 canonical equipment fixtures (Mahindra 575 DI,
--        Kubota DC-68G, Kirloskar KDS 5HP) with baseline hours and 'Operational' status.
--      - Maintain strict dual-key security and real-user data isolation.
--      - Comply with safeupdate (explicit non-trivial WHERE clauses on all deletions).
-- ==============================================================================

-- 1. Ensure REPLICA IDENTITY FULL for complete CDC row payloads
ALTER TABLE IF EXISTS public.repair_messages REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.repair_timeline REPLICA IDENTITY FULL;

-- 2. Ensure publication registration in supabase_realtime
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'repair_messages'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.repair_messages;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'repair_timeline'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.repair_timeline;
    END IF;
  END IF;
END $$;

-- 3. Replace public.reset_demo_data()
CREATE OR REPLACE FUNCTION public.reset_demo_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
BEGIN
  -- ============================================================================
  -- 1. AUTHORIZATION & DUAL-KEY INTEGRITY CHECK
  -- Requires valid Supabase Auth session, designated demo UUIDs, designated demo email, and demo_code.
  -- ============================================================================
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL OR v_caller_id NOT IN (
    '00000000-0000-0000-0000-000000000001'::uuid, -- farmer (Balasaheb Patil)
    '00000000-0000-0000-0000-000000000004'::uuid, -- technician (Ramesh Kumar)
    '00000000-0000-0000-0000-000000000005'::uuid  -- admin (Nagpur Service Centre)
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Demo reset is strictly reserved for designated demo evaluation personas.'
      USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_caller_email
  FROM auth.users
  WHERE id = v_caller_id;

  IF v_caller_email IS NULL OR v_caller_email NOT IN (
    'farmer.nagpur@terrabyte.demo',
    'tech.nagpur@terrabyte.demo',
    'admin.nagpur@terrabyte.demo'
  ) THEN
    RAISE EXCEPTION 'Forbidden: reset_demo_data is restricted to designated demo accounts';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE (auth_user_id = v_caller_id OR id = v_caller_id) AND demo_code IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Forbidden: caller profile is missing demo_code';
  END IF;

  -- ============================================================================
  -- 2. IDENTIFY DEMO REPAIRS (EXCLUSIVELY DEMO-OWNED: BALASAHEB'S TRACTORS & REPAIRS)
  -- Real customer tickets are NEVER matched, even if Ramesh Kumar is assigned.
  -- ============================================================================
  SELECT COALESCE(ARRAY_AGG(id), '{}') INTO v_demo_repair_ids
  FROM public.repair_requests
  WHERE farmer_id = v_demo_farmer_id
     OR equipment_id IN (
       SELECT id FROM public.equipment WHERE farmer_id = v_demo_farmer_id
     );

  -- ============================================================================
  -- 3. SCOPED DELETION OF DEMO REPAIRS & DEPENDENT ACTIVITY
  -- If no demo repairs exist, safely bypass repair child deletions.
  -- All DELETEs have non-trivial WHERE clauses for safeupdate compliance.
  -- ============================================================================
  IF v_demo_repair_ids IS NOT NULL AND array_length(v_demo_repair_ids, 1) > 0 THEN
    SELECT COALESCE(ARRAY_AGG(id), '{}') INTO v_demo_quote_ids
    FROM public.quotes
    WHERE repair_request_id = ANY(v_demo_repair_ids);

    IF v_demo_quote_ids IS NOT NULL AND array_length(v_demo_quote_ids, 1) > 0 THEN
      DELETE FROM public.quote_items
      WHERE quote_id = ANY(v_demo_quote_ids);
    END IF;

    DELETE FROM public.quotes
    WHERE repair_request_id = ANY(v_demo_repair_ids);

    DELETE FROM public.repair_dispatch_locations
    WHERE repair_request_id = ANY(v_demo_repair_ids);

    DELETE FROM public.repair_messages
    WHERE repair_request_id = ANY(v_demo_repair_ids);

    DELETE FROM public.repair_notes
    WHERE repair_request_id = ANY(v_demo_repair_ids);

    DELETE FROM public.repair_timeline
    WHERE repair_request_id = ANY(v_demo_repair_ids);

    IF to_regclass('public.service_centre_part_sales') IS NOT NULL THEN
      DELETE FROM public.service_centre_part_sales
      WHERE repair_request_id = ANY(v_demo_repair_ids);
    END IF;

    IF to_regclass('public.service_centre_part_requests') IS NOT NULL THEN
      DELETE FROM public.service_centre_part_requests
      WHERE repair_request_id = ANY(v_demo_repair_ids);
    END IF;

    IF to_regclass('public.service_centre_stock_audit') IS NOT NULL THEN
      DELETE FROM public.service_centre_stock_audit
      WHERE repair_request_id = ANY(v_demo_repair_ids);
    END IF;

    WITH deleted_repairs AS (
      DELETE FROM public.repair_requests
      WHERE id = ANY(v_demo_repair_ids)
      RETURNING id
    )
    SELECT count(*) INTO v_repairs_deleted FROM deleted_repairs;
  END IF;

  -- ============================================================================
  -- 4. PURGE DEMO SERVICE HISTORY (ONLY BALASAHEB'S TRACTORS & DEMO REPAIRS)
  -- ============================================================================
  WITH deleted_history AS (
    DELETE FROM public.service_history
    WHERE equipment_id IN (
      SELECT id FROM public.equipment WHERE farmer_id = v_demo_farmer_id
    )
    OR (v_demo_repair_ids IS NOT NULL AND array_length(v_demo_repair_ids, 1) > 0 AND repair_request_id = ANY(v_demo_repair_ids))
    RETURNING id
  )
  SELECT count(*) INTO v_service_history_deleted FROM deleted_history;

  -- ============================================================================
  -- 5. PURGE DEMO NOTIFICATIONS (EXCLUSIVELY DEMO-OWNED)
  -- ============================================================================
  WITH deleted_notifs AS (
    DELETE FROM public.notifications
    WHERE recipient_user_id = v_demo_farmer_id
       OR (
         v_demo_repair_ids IS NOT NULL AND array_length(v_demo_repair_ids, 1) > 0
         AND EXISTS (
           SELECT 1 FROM unnest(v_demo_repair_ids) r_id
           WHERE public.notifications.link_target LIKE '%' || r_id::text || '%'
         )
       )
    RETURNING id
  )
  SELECT count(*) INTO v_notifications_deleted FROM deleted_notifs;

  -- ============================================================================
  -- 6. PURGE NON-REPAIR STOCK AUDITS EXCLUSIVELY FOR NAGPUR SERVICE CENTRE PARTS
  -- ============================================================================
  IF to_regclass('public.service_centre_stock_audit') IS NOT NULL AND to_regclass('public.service_centre_parts') IS NOT NULL THEN
    DELETE FROM public.service_centre_stock_audit
    WHERE repair_request_id IS NULL
      AND part_id IN (
        SELECT id FROM public.service_centre_parts WHERE service_centre_id = v_demo_admin_id
      );
  END IF;

  -- ============================================================================
  -- 7. CLEAN UP NON-CANONICAL PARTS CREATED UNDER NAGPUR SERVICE CENTRE ONLY
  -- ============================================================================
  IF to_regclass('public.service_centre_parts') IS NOT NULL THEN
    DELETE FROM public.service_centre_parts
    WHERE service_centre_id = v_demo_admin_id
      AND part_number NOT IN ('0433171', '005556958R1', 'AL120788', 'HY-GARD-15W30', '26243171');
  END IF;

  -- ============================================================================
  -- 8. DETERMINISTICALLY RESTORE NAGPUR CANONICAL PARTS BASELINE (5 PARTS)
  -- ============================================================================
  IF to_regclass('public.service_centre_parts') IS NOT NULL THEN
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
      updated_at = now()
    WHERE public.service_centre_parts.service_centre_id = v_demo_admin_id;
  END IF;

  -- ============================================================================
  -- 9. DELETE NON-CANONICAL DEMO EQUIPMENT (e.g. newly added machines like XYZ 69)
  -- Scoped strictly to v_demo_farmer_id and preserves the 3 canonical equipment fixtures (e1, e2, e3).
  -- Safeupdate compliant: Explicit non-trivial WHERE clause scoped to demo farmer.
  -- ============================================================================
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

  -- ============================================================================
  -- 10. DETERMINISTICALLY RESTORE BALASAHEB'S 3 CANONICAL TRACTORS/MACHINERY TO BASELINE
  -- ============================================================================
  INSERT INTO public.equipment (
    id, farmer_id, type, make, model, year, serial_number, operating_hours, photo_url, status, demo_code
  ) VALUES
    ('00000000-0000-0000-0010-000000000001'::uuid, v_demo_farmer_id, 'Tractor', 'Mahindra', '575 DI', 2021, 'MH575-21-0048821', 1240, NULL, 'Operational', 'e1'),
    ('00000000-0000-0000-0010-000000000002'::uuid, v_demo_farmer_id, 'Harvester', 'Kubota', 'DC-68G', 2023, 'KBDC68-23-7710', 3120, NULL, 'Operational', 'e2'),
    ('00000000-0000-0000-0010-000000000003'::uuid, v_demo_farmer_id, 'Pump', 'Kirloskar', 'KDS 5HP', 2019, 'KIR-5HP-19-3321', 890, NULL, 'Operational', 'e3')
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
    updated_at = now();

  SELECT count(*) INTO v_equipment_reset
  FROM public.equipment
  WHERE farmer_id = v_demo_farmer_id;

  -- ============================================================================
  -- 11. RESTORE RAMESH KUMAR'S TECHNICIAN PROFILE MUTABLE SETTINGS TO BASELINE
  -- ============================================================================
  UPDATE public.technician_profiles
  SET is_available = true,
      is_verified = true,
      updated_at = now()
  WHERE profile_id = v_demo_tech_id
     OR id = '00000000-0000-0000-0002-000000000011'::uuid;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Demo baseline successfully and deterministically restored for Nagpur Service Centre',
    'repairs_deleted', v_repairs_deleted,
    'equipment_deleted', v_equipment_deleted,
    'equipment_reset', v_equipment_reset,
    'notifications_deleted', v_notifications_deleted,
    'service_history_deleted', v_service_history_deleted,
    'timestamp', now()
  );
END;
$$;

COMMENT ON FUNCTION public.reset_demo_data() IS
  'Forward migration: safely resets demo repair requests, demo notifications, removes non-canonical demo equipment, restores Balasaheb Patil machinery baseline, and resets canonical Nagpur Service Centre stock without touching real customer accounts or violating PostgreSQL safeupdate.';

REVOKE ALL ON FUNCTION public.reset_demo_data() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reset_demo_data() FROM anon;
GRANT EXECUTE ON FUNCTION public.reset_demo_data() TO authenticated;
