-- ==============================================================================
-- TerraByte — Phase 9.3: Safe, Forward-Only Scoped Demo Reset RPC
-- Migration: 20261031153000_phase9_3_safe_scoped_reset_demo_rpc.sql
-- Description: Forward migration replacing public.reset_demo_data() with a strictly
--              scoped, safeupdate-compliant, and idempotent RPC that:
--              1. Enforces PostgreSQL safeupdate by ensuring every DELETE and UPDATE
--                 contains an explicit, non-trivial, demo-scoped WHERE clause.
--              2. Strictly identifies demo repairs by demo farmer ownership (Balasaheb Patil)
--                 and NEVER by technician_id, preserving real repairs assigned to Ramesh.
--              3. Cascades deletions to child records (notes, chat messages, quotes, quote_items,
--                 dispatch locations, part requisitions, part sales, stock audits) ONLY when
--                 they belong to identified demo repair IDs.
--              4. Safely bypasses child table deletions when no demo repairs exist.
--              5. Does NOT delete records by actor or part ID alone, and never treats
--                 service_centre_id IS NULL as proof of Nagpur ownership.
--              6. Scopes Nagpur inventory restoration strictly to (service_centre_id, part_number)
--                 without overwriting or deleting other service centres' stock.
--              7. Restores canonical parts baseline using exact seed schema & values
--                 (3, 8, 2, 5, 1) and Balasaheb's 3 tractors to Operational.
--              8. Maintains dual-key authentication and RLS protections.
-- ==============================================================================

-- 1. Ensure service_centre_parts has service_centre_id and scoped compound uniqueness
DO $$
BEGIN
  IF to_regclass('public.service_centre_parts') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name = 'service_centre_parts' 
        AND column_name = 'service_centre_id'
    ) THEN
      ALTER TABLE public.service_centre_parts 
        ADD COLUMN service_centre_id uuid REFERENCES public.profiles(id) DEFAULT '00000000-0000-0000-0003-000000000001'::uuid;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_constraint 
      WHERE conname = 'service_centre_parts_part_number_key' 
        AND conrelid = 'public.service_centre_parts'::regclass
    ) THEN
      ALTER TABLE public.service_centre_parts DROP CONSTRAINT service_centre_parts_part_number_key;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint 
      WHERE conname = 'service_centre_parts_centre_part_key' 
        AND conrelid = 'public.service_centre_parts'::regclass
    ) THEN
      ALTER TABLE public.service_centre_parts 
        ADD CONSTRAINT service_centre_parts_centre_part_key UNIQUE (service_centre_id, part_number);
    END IF;
  END IF;
END $$;

-- 2. Forward-only replacement of public.reset_demo_data()
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

    -- Phase 9: Purge parts requisitions and sales linked strictly to demo repairs
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
  -- Does NOT delete by changed_by alone; does NOT touch other service centres;
  -- does NOT treat service_centre_id IS NULL as Nagpur.
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
  -- Scoped strictly to service_centre_id = v_demo_admin_id.
  -- Never deletes or assigns rows where service_centre_id IS NULL or other centres.
  -- ============================================================================
  IF to_regclass('public.service_centre_parts') IS NOT NULL THEN
    DELETE FROM public.service_centre_parts
    WHERE service_centre_id = v_demo_admin_id
      AND part_number NOT IN ('0433171', '005556958R1', 'AL120788', 'HY-GARD-15W30', '26243171');
  END IF;

  -- ============================================================================
  -- 8. DETERMINISTICALLY RESTORE NAGPUR CANONICAL PARTS BASELINE (5 PARTS)
  -- Uses documented schema fields & exact baseline counts (3, 8, 2, 5, 1).
  -- Scoped strictly to Nagpur Service Centre via (service_centre_id, part_number).
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
  -- 9. RESTORE BALASAHEB'S 3 TRACTORS TO OPERATIONAL WITH BASELINE HOURS
  -- ============================================================================
  WITH updated_equipment AS (
    UPDATE public.equipment
    SET status = 'Operational',
        operating_hours = CASE
          WHEN id = '00000000-0000-0000-0010-000000000001'::uuid THEN 1240
          WHEN id = '00000000-0000-0000-0010-000000000002'::uuid THEN 3120
          WHEN id = '00000000-0000-0000-0010-000000000003'::uuid THEN 890
          ELSE operating_hours
        END,
        updated_at = now()
    WHERE farmer_id = v_demo_farmer_id
    RETURNING id
  )
  SELECT count(*) INTO v_equipment_reset FROM updated_equipment;

  -- ============================================================================
  -- 10. RESTORE RAMESH KUMAR'S TECHNICIAN PROFILE MUTABLE SETTINGS TO BASELINE
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
    'equipment_reset', v_equipment_reset,
    'notifications_deleted', v_notifications_deleted,
    'service_history_deleted', v_service_history_deleted,
    'timestamp', now()
  );
END;
$$;

COMMENT ON FUNCTION public.reset_demo_data() IS
  'Forward migration: safely resets demo repair requests, demo notifications, and canonical Nagpur Service Centre stock without touching other centres, real customer repairs, or violating PostgreSQL safeupdate.';
