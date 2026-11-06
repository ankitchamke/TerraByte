-- ==============================================================================
-- TerraByte Migration: 20261106153000_phase12_staging_reset_demo_rpc_pair_auth.sql
-- Description: Forward migration updating public.reset_demo_data() with exact
--              caller ID-and-email pair matching for designated staging & demo personas.
-- Author: TerraByte Team
-- Target: Staging & Development Environments
-- ==============================================================================

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

  -- 4. Identify Scoped Demo Repairs
  SELECT COALESCE(ARRAY_AGG(id), '{}') INTO v_demo_repair_ids
  FROM public.repair_requests
  WHERE farmer_id = v_demo_farmer_id
     OR equipment_id IN (
       SELECT id FROM public.equipment WHERE farmer_id = v_demo_farmer_id
     );

  -- 5. Cascade Deletion of Scoped Demo Repair Fixtures
  IF v_demo_repair_ids IS NOT NULL AND array_length(v_demo_repair_ids, 1) > 0 THEN
    SELECT COALESCE(ARRAY_AGG(id), '{}') INTO v_demo_quote_ids
    FROM public.quotes
    WHERE repair_request_id = ANY(v_demo_repair_ids);

    IF v_demo_quote_ids IS NOT NULL AND array_length(v_demo_quote_ids, 1) > 0 THEN
      DELETE FROM public.quote_items WHERE quote_id = ANY(v_demo_quote_ids);
    END IF;

    DELETE FROM public.quotes WHERE repair_request_id = ANY(v_demo_repair_ids);
    DELETE FROM public.repair_dispatch_locations WHERE repair_request_id = ANY(v_demo_repair_ids);
    DELETE FROM public.repair_messages WHERE repair_request_id = ANY(v_demo_repair_ids);
    DELETE FROM public.repair_notes WHERE repair_request_id = ANY(v_demo_repair_ids);
    DELETE FROM public.repair_timeline WHERE repair_request_id = ANY(v_demo_repair_ids);

    IF to_regclass('public.service_centre_part_sales') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.service_centre_part_sales WHERE repair_request_id = ANY($1)' USING v_demo_repair_ids;
    END IF;

    IF to_regclass('public.service_centre_part_requests') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.service_centre_part_requests WHERE repair_request_id = ANY($1)' USING v_demo_repair_ids;
    END IF;

    IF to_regclass('public.service_centre_stock_audit') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.service_centre_stock_audit WHERE repair_request_id = ANY($1)' USING v_demo_repair_ids;
    END IF;

    WITH deleted_repairs AS (
      DELETE FROM public.repair_requests WHERE id = ANY(v_demo_repair_ids) RETURNING id
    )
    SELECT count(*) INTO v_repairs_deleted FROM deleted_repairs;
  END IF;

  WITH deleted_history AS (
    DELETE FROM public.service_history
    WHERE equipment_id IN (SELECT id FROM public.equipment WHERE farmer_id = v_demo_farmer_id)
       OR (v_demo_repair_ids IS NOT NULL AND array_length(v_demo_repair_ids, 1) > 0 AND repair_request_id = ANY(v_demo_repair_ids))
    RETURNING id
  )
  SELECT count(*) INTO v_service_history_deleted FROM deleted_history;

  WITH deleted_notifs AS (
    DELETE FROM public.notifications
    WHERE recipient_user_id = v_demo_farmer_id
       OR (v_demo_repair_ids IS NOT NULL AND array_length(v_demo_repair_ids, 1) > 0 AND EXISTS (
            SELECT 1 FROM unnest(v_demo_repair_ids) r_id
            WHERE public.notifications.link_target LIKE '%' || r_id::text || '%'
          ))
    RETURNING id
  )
  SELECT count(*) INTO v_notifications_deleted FROM deleted_notifs;

  -- 6. Restore Parts Inventory Baseline for Service Centre
  IF to_regclass('public.service_centre_stock_audit') IS NOT NULL AND to_regclass('public.service_centre_parts') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.service_centre_stock_audit WHERE repair_request_id IS NULL AND part_id IN (SELECT id FROM public.service_centre_parts WHERE service_centre_id = $1)' USING v_demo_admin_id;
  END IF;

  IF to_regclass('public.service_centre_parts') IS NOT NULL THEN
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
      updated_at = now()
    WHERE public.service_centre_parts.service_centre_id = v_demo_admin_id;
  END IF;

  -- 7. Delete Non-Canonical Demo Equipment
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

  -- 8. Restore Canonical Equipment (3 Machines)
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
    updated_at = now();

  SELECT count(*) INTO v_equipment_reset
  FROM public.equipment
  WHERE farmer_id = v_demo_farmer_id;

  -- 9. Reset Technician Operational State
  UPDATE public.technician_profiles
  SET is_available = true,
      is_verified = true,
      updated_at = now()
  WHERE profile_id = v_demo_tech_id
     OR id = '00000000-0000-0000-0002-000000000011'::uuid;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Demo baseline successfully and deterministically restored',
    'repairs_deleted', v_repairs_deleted,
    'equipment_deleted', v_equipment_deleted,
    'equipment_reset', v_equipment_reset,
    'notifications_deleted', v_notifications_deleted,
    'service_history_deleted', v_service_history_deleted,
    'timestamp', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reset_demo_data() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reset_demo_data() FROM anon;
GRANT EXECUTE ON FUNCTION public.reset_demo_data() TO authenticated, service_role;

COMMENT ON FUNCTION public.reset_demo_data() IS
  'Deterministically resets demo data to baseline fixtures with strict pair authorization for designated staging and canonical demo personas.';
