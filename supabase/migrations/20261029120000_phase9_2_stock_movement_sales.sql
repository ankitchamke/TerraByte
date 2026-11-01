-- ==============================================================================
-- TerraByte — Phase 9.2: Stock Movement & Repair Sales History
-- Migration: 20261029120000_phase9_2_stock_movement_sales.sql
-- Description: Establishes durable stock movement classification and repair sales history:
--              1. Adds movement_type ('RECEIVED', 'ISSUED_TO_REPAIR', 'RETURNED', 'ADJUSTMENT')
--                 and quote linkages to service_centre_stock_audit
--              2. Adds catalog_part_id to quote_items for catalog traceability
--              3. Creates durable service_centre_part_sales table recording sales against
--                 farmer-approved quotes with snapshot pricing
--              4. Implements atomic handoff, stock receipt, and unused part return RPCs
--              5. Enforces strict RLS: sales and depot audit restricted to Service Centre admins
--              6. Updates reset_demo_data() to clear movements/sales and restore canonical baseline
-- ==============================================================================

-- 1. EXTEND STOCK AUDIT LOG WITH MOVEMENT TYPES & QUOTE REFERENCES
ALTER TABLE public.service_centre_stock_audit 
  ADD COLUMN IF NOT EXISTS movement_type text NOT NULL DEFAULT 'ADJUSTMENT' 
  CHECK (movement_type IN ('RECEIVED', 'ISSUED_TO_REPAIR', 'RETURNED', 'ADJUSTMENT'));

ALTER TABLE public.service_centre_stock_audit 
  ADD COLUMN IF NOT EXISTS quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL;

ALTER TABLE public.service_centre_stock_audit 
  ADD COLUMN IF NOT EXISTS quote_item_id uuid REFERENCES public.quote_items(id) ON DELETE SET NULL;

ALTER TABLE public.service_centre_stock_audit 
  ADD COLUMN IF NOT EXISTS unit_price numeric CHECK (unit_price IS NULL OR unit_price >= 0);

ALTER TABLE public.service_centre_stock_audit 
  ADD COLUMN IF NOT EXISTS total_value numeric CHECK (total_value IS NULL OR total_value >= 0);

ALTER TABLE public.service_centre_stock_audit 
  ADD COLUMN IF NOT EXISTS notes text;

-- 2. LINK CATALOG PARTS TO QUOTE ITEMS
ALTER TABLE public.quote_items 
  ADD COLUMN IF NOT EXISTS catalog_part_id uuid REFERENCES public.service_centre_parts(id) ON DELETE SET NULL;

-- 2b. SCOPE SERVICE CENTRE PARTS TO SERVICE CENTRES
ALTER TABLE public.service_centre_parts 
  ADD COLUMN IF NOT EXISTS service_centre_id uuid REFERENCES public.profiles(id) 
  DEFAULT '00000000-0000-0000-0003-000000000001'::uuid;

DO $$
BEGIN
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
END $$;

-- 3. CREATE DURABLE REPAIR SALES TABLE
CREATE TABLE IF NOT EXISTS public.service_centre_part_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id uuid NOT NULL REFERENCES public.service_centre_parts(id) ON DELETE RESTRICT,
  repair_request_id uuid NOT NULL REFERENCES public.repair_requests(id) ON DELETE CASCADE,
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  quote_item_id uuid REFERENCES public.quote_items(id) ON DELETE SET NULL,
  part_request_id uuid UNIQUE REFERENCES public.service_centre_part_requests(id) ON DELETE SET NULL,
  movement_audit_id uuid REFERENCES public.service_centre_stock_audit(id) ON DELETE SET NULL,
  quantity int NOT NULL CHECK (quantity > 0),
  unit_price numeric NOT NULL CHECK (unit_price >= 0),
  total_amount numeric NOT NULL CHECK (total_amount >= 0),
  sold_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL REFERENCES public.profiles(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_sc_sales_part_id ON public.service_centre_part_sales(part_id);
CREATE INDEX IF NOT EXISTS idx_sc_sales_repair_id ON public.service_centre_part_sales(repair_request_id);
CREATE INDEX IF NOT EXISTS idx_sc_sales_quote_id ON public.service_centre_part_sales(quote_id);
CREATE INDEX IF NOT EXISTS idx_sc_sales_sold_at ON public.service_centre_part_sales(sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_sc_stock_audit_movement ON public.service_centre_stock_audit(movement_type);

-- 4. ENABLE ROW LEVEL SECURITY
ALTER TABLE public.service_centre_part_sales ENABLE ROW LEVEL SECURITY;

-- 5. RLS POLICIES FOR service_centre_part_sales
-- Strictly restricted to Service Centre staff (admins). Farmers and technicians are denied access.
DROP POLICY IF EXISTS "Admins can view and manage part sales" ON public.service_centre_part_sales;
CREATE POLICY "Admins can view and manage part sales"
ON public.service_centre_part_sales
FOR ALL
TO authenticated
USING (public.current_user_role() = 'admin')
WITH CHECK (public.current_user_role() = 'admin');

-- 6. ATOMIC HANDOFF RPC (HANDOFF ISSUES PART TO REPAIR & RECORDS SALE IF QUOTE APPROVED)
CREATE OR REPLACE FUNCTION public.confirm_service_centre_part_handoff(
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_profile_id uuid;
  v_caller_role user_role;
  v_request record;
  v_part record;
  v_current_stock int;
  v_new_stock int;
  v_audit_id uuid;
  v_approved_quote record;
  v_quote_item record;
  v_sale_id uuid := NULL;
  v_unit_price numeric := NULL;
  v_total_amount numeric := NULL;
BEGIN
  -- 1. Validate caller identity and role
  SELECT id, role INTO v_caller_profile_id, v_caller_role
  FROM public.profiles
  WHERE auth_user_id = auth.uid() OR id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role != 'admin' THEN
    RAISE EXCEPTION 'Unauthorized: Only Service Centre administrators can confirm parts handoff.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Fetch part requisition with row lock
  SELECT * INTO v_request
  FROM public.service_centre_part_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Part request not found.'
      USING ERRCODE = 'P0002';
  END IF;

  -- Prevent duplicate handoff or double-decrementing stock on retries
  IF v_request.status != 'PENDING' THEN
    RAISE EXCEPTION 'Cannot confirm handoff: Part request is already %.', v_request.status
      USING ERRCODE = '22000';
  END IF;

  -- 3. Lock part row to prevent concurrent race conditions
  SELECT * INTO v_part
  FROM public.service_centre_parts
  WHERE id = v_request.part_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Part item not found.'
      USING ERRCODE = 'P0002';
  END IF;

  v_current_stock := v_part.stock_quantity;

  -- 4. Check stock availability
  IF v_current_stock < v_request.quantity THEN
    RAISE EXCEPTION 'Insufficient stock: % requested, but only % available in Service Centre depot.',
      v_request.quantity, v_current_stock
      USING ERRCODE = '22003';
  END IF;

  v_new_stock := v_current_stock - v_request.quantity;

  -- 5. Atomically decrement physical stock on hand
  UPDATE public.service_centre_parts
  SET stock_quantity = v_new_stock,
      updated_at = now()
  WHERE id = v_part.id;

  -- 6. Update request status to HANDED_OFF
  UPDATE public.service_centre_part_requests
  SET status = 'HANDED_OFF',
      handed_off_by = v_caller_profile_id,
      handed_off_at = now(),
      updated_at = now()
  WHERE id = v_request.id;

  -- 7. Check if there is an approved quote line for this part on the repair
  -- A technician handoff is an issue to a repair. It counts as a sale ONLY when
  -- physically handed off against a farmer-approved quote line identifying this catalog part.
  SELECT q.id, q.repair_request_id INTO v_approved_quote
  FROM public.quotes q
  WHERE q.repair_request_id = v_request.repair_request_id
    AND q.status = 'APPROVED'
  ORDER BY q.version DESC
  LIMIT 1;

  IF FOUND THEN
    -- Look for matching quote item either by catalog_part_id or by exact part name / SKU
    SELECT qi.id, qi.unit_price, qi.quantity INTO v_quote_item
    FROM public.quote_items qi
    WHERE qi.quote_id = v_approved_quote.id
      AND (
        qi.catalog_part_id = v_part.id
        OR lower(qi.part_name) = lower(v_part.name)
        OR (v_part.part_number IS NOT NULL AND qi.part_spec ILIKE '%' || v_part.part_number || '%')
      )
    LIMIT 1;

    IF FOUND THEN
      v_unit_price := v_quote_item.unit_price;
      v_total_amount := v_request.quantity * v_unit_price;

      -- Record durable sale entry with snapshot pricing
      INSERT INTO public.service_centre_part_sales (
        part_id,
        repair_request_id,
        quote_id,
        quote_item_id,
        part_request_id,
        quantity,
        unit_price,
        total_amount,
        sold_at,
        recorded_by,
        notes
      ) VALUES (
        v_part.id,
        v_request.repair_request_id,
        v_approved_quote.id,
        v_quote_item.id,
        v_request.id,
        v_request.quantity,
        v_unit_price,
        v_total_amount,
        now(),
        v_caller_profile_id,
        'Sold against approved quote on confirmed handoff'
      )
      RETURNING id INTO v_sale_id;
    END IF;
  END IF;

  -- 8. Insert stock movement record (ISSUED_TO_REPAIR)
  INSERT INTO public.service_centre_stock_audit (
    part_id,
    change_quantity,
    previous_stock,
    new_stock,
    movement_type,
    reason,
    changed_by,
    repair_request_id,
    part_request_id,
    quote_id,
    quote_item_id,
    unit_price,
    total_value,
    notes
  ) VALUES (
    v_part.id,
    -v_request.quantity,
    v_current_stock,
    v_new_stock,
    'ISSUED_TO_REPAIR',
    'technician_handoff',
    v_caller_profile_id,
    v_request.repair_request_id,
    v_request.id,
    v_approved_quote.id,
    v_quote_item.id,
    v_unit_price,
    v_total_amount,
    CASE 
      WHEN v_sale_id IS NOT NULL THEN 'Issued to repair and counted as sale against approved quote'
      ELSE 'Issued to repair (not yet sold; pending approved quote)'
    END
  )
  RETURNING id INTO v_audit_id;

  -- Update sale with audit link if created
  IF v_sale_id IS NOT NULL THEN
    UPDATE public.service_centre_part_sales
    SET movement_audit_id = v_audit_id
    WHERE id = v_sale_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_request.id,
    'part_id', v_part.id,
    'part_name', v_part.name,
    'quantity', v_request.quantity,
    'previous_stock', v_current_stock,
    'new_stock', v_new_stock,
    'movement_type', 'ISSUED_TO_REPAIR',
    'is_sale', (v_sale_id IS NOT NULL),
    'sale_id', v_sale_id,
    'unit_price', v_unit_price,
    'total_amount', v_total_amount,
    'handed_off_at', now()
  );
END;
$$;

-- 7. ATOMIC STOCK RECEIPT RPC
CREATE OR REPLACE FUNCTION public.receive_service_centre_stock(
  p_part_id uuid,
  p_quantity int,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_profile_id uuid;
  v_caller_role user_role;
  v_part record;
  v_current_stock int;
  v_new_stock int;
  v_audit_id uuid;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Received quantity must be positive.' USING ERRCODE = '22003';
  END IF;

  SELECT id, role INTO v_caller_profile_id, v_caller_role
  FROM public.profiles
  WHERE auth_user_id = auth.uid() OR id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role != 'admin' THEN
    RAISE EXCEPTION 'Unauthorized: Only Service Centre administrators can receive stock.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_part
  FROM public.service_centre_parts
  WHERE id = p_part_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Part not found.' USING ERRCODE = 'P0002';
  END IF;

  v_current_stock := v_part.stock_quantity;
  v_new_stock := v_current_stock + p_quantity;

  UPDATE public.service_centre_parts
  SET stock_quantity = v_new_stock,
      updated_at = now()
  WHERE id = v_part.id;

  INSERT INTO public.service_centre_stock_audit (
    part_id,
    change_quantity,
    previous_stock,
    new_stock,
    movement_type,
    reason,
    changed_by,
    notes
  ) VALUES (
    v_part.id,
    p_quantity,
    v_current_stock,
    v_new_stock,
    'RECEIVED',
    coalesce(p_reason, 'Supplier stock delivery received'),
    v_caller_profile_id,
    'Stock received into Service Centre depot'
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'success', true,
    'part_id', v_part.id,
    'part_name', v_part.name,
    'quantity_received', p_quantity,
    'previous_stock', v_current_stock,
    'new_stock', v_new_stock,
    'movement_type', 'RECEIVED',
    'audit_id', v_audit_id
  );
END;
$$;

-- 8. ATOMIC UNUSED PART RETURN RPC
CREATE OR REPLACE FUNCTION public.return_service_centre_part(
  p_repair_request_id uuid,
  p_part_id uuid,
  p_quantity int,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_profile_id uuid;
  v_caller_role user_role;
  v_part record;
  v_current_stock int;
  v_new_stock int;
  v_audit_id uuid;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Return quantity must be positive.' USING ERRCODE = '22003';
  END IF;

  SELECT id, role INTO v_caller_profile_id, v_caller_role
  FROM public.profiles
  WHERE auth_user_id = auth.uid() OR id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role != 'admin' THEN
    RAISE EXCEPTION 'Unauthorized: Only Service Centre administrators can confirm part returns.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_part
  FROM public.service_centre_parts
  WHERE id = p_part_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Part not found.' USING ERRCODE = 'P0002';
  END IF;

  v_current_stock := v_part.stock_quantity;
  v_new_stock := v_current_stock + p_quantity;

  -- Restore physical stock on hand
  UPDATE public.service_centre_parts
  SET stock_quantity = v_new_stock,
      updated_at = now()
  WHERE id = v_part.id;

  -- Append immutable RETURNED movement record without rewriting prior records
  INSERT INTO public.service_centre_stock_audit (
    part_id,
    change_quantity,
    previous_stock,
    new_stock,
    movement_type,
    reason,
    changed_by,
    repair_request_id,
    notes
  ) VALUES (
    v_part.id,
    p_quantity,
    v_current_stock,
    v_new_stock,
    'RETURNED',
    coalesce(p_reason, 'Unused part returned from repair'),
    v_caller_profile_id,
    p_repair_request_id,
    'Restored unused part from repair back to depot stock'
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'success', true,
    'part_id', v_part.id,
    'part_name', v_part.name,
    'quantity_returned', p_quantity,
    'previous_stock', v_current_stock,
    'new_stock', v_new_stock,
    'movement_type', 'RETURNED',
    'repair_request_id', p_repair_request_id,
    'audit_id', v_audit_id
  );
END;
$$;

-- 9. UPDATE reset_demo_data() TO PURGE SALES & STOCK MOVEMENTS
CREATE OR REPLACE FUNCTION public.reset_demo_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_email text;
  v_demo_farmer_id CONSTANT uuid := '00000000-0000-0000-0001-000000000001'::uuid;
  v_demo_tech_id CONSTANT uuid := '00000000-0000-0000-0002-000000000001'::uuid;
  v_demo_admin_id CONSTANT uuid := '00000000-0000-0000-0003-000000000001'::uuid;
  v_demo_repair_ids uuid[] := '{}';
  v_repairs_deleted int := 0;
  v_equipment_reset int := 0;
  v_notifications_deleted int := 0;
  v_service_history_deleted int := 0;
  v_part_requests_deleted int := 0;
  v_sales_deleted int := 0;
BEGIN
  -- ============================================================================
  -- 1. STRICT DUAL-KEY AUTHORIZATION (3 RETAINED PERSONAS ONLY)
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
  -- 2. IDENTIFY DEMO REPAIRS (EXCLUSIVELY DEMO-OWNED: BALASAHEB'S TRACTORS & REPAIRS)
  -- Real customer repairs are NEVER matched, even if Ramesh Kumar is assigned.
  -- ============================================================================
  SELECT COALESCE(ARRAY_AGG(id), '{}') INTO v_demo_repair_ids
  FROM public.repair_requests
  WHERE farmer_id = v_demo_farmer_id
     OR equipment_id IN (
       SELECT id FROM public.equipment WHERE farmer_id = v_demo_farmer_id
     );

  -- ============================================================================
  -- 3. SCOPED DELETION OF DEMO SALES, PART REQUISITIONS & AUDIT LOGS
  -- ============================================================================
  IF v_demo_repair_ids IS NOT NULL AND array_length(v_demo_repair_ids, 1) > 0 THEN
    WITH del_sales AS (
      DELETE FROM public.service_centre_part_sales
      WHERE repair_request_id = ANY(v_demo_repair_ids)
      RETURNING id
    )
    SELECT count(*) INTO v_sales_deleted FROM del_sales;

    WITH del_reqs AS (
      DELETE FROM public.service_centre_part_requests
      WHERE repair_request_id = ANY(v_demo_repair_ids)
      RETURNING id
    )
    SELECT count(*) INTO v_part_requests_deleted FROM del_reqs;

    DELETE FROM public.service_centre_stock_audit
    WHERE repair_request_id = ANY(v_demo_repair_ids);
  END IF;

  -- Delete non-repair stock audit movements exclusively for Nagpur Service Centre's canonical parts
  DELETE FROM public.service_centre_stock_audit
  WHERE changed_by = v_demo_admin_id
    AND repair_request_id IS NULL
    AND part_id IN (
      SELECT id FROM public.service_centre_parts 
      WHERE (service_centre_id = v_demo_admin_id OR service_centre_id IS NULL)
        AND part_number IN ('0433171', '005556958R1', 'AL120788', 'HY-GARD-15W30', '26243171')
    );

  -- Clean up any non-canonical spare parts created under Nagpur Service Centre during testing
  DELETE FROM public.service_centre_parts
  WHERE (service_centre_id = v_demo_admin_id OR service_centre_id IS NULL)
    AND part_number NOT IN ('0433171', '005556958R1', 'AL120788', 'HY-GARD-15W30', '26243171');

  -- Restore canonical stock quantities (idempotent upsert scoped strictly to Nagpur Service Centre)
  INSERT INTO public.service_centre_parts (
    id,
    service_centre_id,
    part_number,
    name,
    spec,
    category,
    compatible_models,
    stock_quantity,
    unit_price,
    location
  ) VALUES
    ('00000000-0000-0000-0040-000000000001'::uuid, v_demo_admin_id, '0433171', 'Fuel Injector Nozzle Set', 'Bosch 0433171 (x4)', 'Fuel system', ARRAY['Mahindra 575 DI'], 3, 2200, 'Depot Shelf A-02'),
    ('00000000-0000-0000-0040-000000000002'::uuid, v_demo_admin_id, '005556958R1', 'Inline Fuel Filter', 'Mahindra 005556958R1', 'Fuel system', ARRAY['Mahindra 575 DI'], 8, 350, 'Depot Shelf A-03'),
    ('00000000-0000-0000-0040-000000000003'::uuid, v_demo_admin_id, 'AL120788', 'Lift Cylinder Seal Kit', 'JD AL120788', 'Hydraulics', ARRAY['John Deere 5050D'], 2, 1650, 'Depot Shelf B-01'),
    ('00000000-0000-0000-0040-000000000004'::uuid, v_demo_admin_id, 'HY-GARD-15W30', 'Hydraulic Oil 15W-30', 'JD Hy-Gard, litres', 'Hydraulics', ARRAY['John Deere 5050D'], 5, 320, 'Depot Drum Rack B-04'),
    ('00000000-0000-0000-0040-000000000005'::uuid, v_demo_admin_id, '26243171', 'Starter Motor Assembly', 'Lucas-TVS 12V 2.2kW', 'Electrical', ARRAY['Mahindra 575 DI', 'Swaraj 744 FE'], 1, 5800, 'Depot Shelf C-01')
  ON CONFLICT (service_centre_id, part_number) DO UPDATE SET
    stock_quantity = EXCLUDED.stock_quantity,
    location = EXCLUDED.location,
    unit_price = EXCLUDED.unit_price,
    updated_at = now()
  WHERE public.service_centre_parts.service_centre_id = v_demo_admin_id;

  -- ============================================================================
  -- 4. SCOPED DELETION OF DEMO REPAIR REQUESTS & DEPENDENT DATA
  -- ============================================================================
  IF v_demo_repair_ids IS NOT NULL AND array_length(v_demo_repair_ids, 1) > 0 THEN
    DELETE FROM public.repair_dispatch_locations
    WHERE repair_request_id = ANY(v_demo_repair_ids);

    DELETE FROM public.repair_messages
    WHERE repair_request_id = ANY(v_demo_repair_ids);

    DELETE FROM public.repair_notes
    WHERE repair_request_id = ANY(v_demo_repair_ids);

    DELETE FROM public.repair_timeline
    WHERE repair_request_id = ANY(v_demo_repair_ids);

    DELETE FROM public.quote_items
    WHERE quote_id IN (
      SELECT id FROM public.quotes
      WHERE repair_request_id = ANY(v_demo_repair_ids)
    );

    DELETE FROM public.quotes
    WHERE repair_request_id = ANY(v_demo_repair_ids);

    WITH deleted_repairs AS (
      DELETE FROM public.repair_requests
      WHERE id = ANY(v_demo_repair_ids)
      RETURNING id
    )
    SELECT count(*) INTO v_repairs_deleted FROM deleted_repairs;
  END IF;

  -- ============================================================================
  -- 5. PURGE DEMO SERVICE HISTORY (ONLY BALASAHEB'S TRACTORS)
  -- ============================================================================
  WITH deleted_history AS (
    DELETE FROM public.service_history
    WHERE equipment_id IN (
      SELECT id FROM public.equipment WHERE farmer_id = v_demo_farmer_id
    )
    RETURNING id
  )
  SELECT count(*) INTO v_service_history_deleted FROM deleted_history;

  -- ============================================================================
  -- 6. PURGE DEMO NOTIFICATIONS (EXCLUSIVELY DEMO-OWNED)
  -- ============================================================================
  WITH deleted_notifs AS (
    DELETE FROM public.notifications
    WHERE recipient_user_id = v_demo_farmer_id
       OR (
         v_demo_repair_ids IS NOT NULL AND array_length(v_demo_repair_ids, 1) > 0
         AND (
           link_target LIKE '%/repair/' || ANY(SELECT id::text FROM unnest(v_demo_repair_ids) id)
           OR link_target LIKE '%/job/' || ANY(SELECT id::text FROM unnest(v_demo_repair_ids) id)
         )
       )
    RETURNING id
  )
  SELECT count(*) INTO v_notifications_deleted FROM deleted_notifs;

  -- ============================================================================
  -- 5. RESTORE BALASAHEB'S THREE TRACTORS TO OPERATIONAL BASELINE
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
  -- 6. RESTORE RAMESH KUMAR'S TECHNICIAN PROFILE TO OPERATIONAL BASELINE
  -- ============================================================================
  UPDATE public.technician_profiles
  SET is_available = true,
      is_verified = true,
      jobs_completed = 0,
      rating = 5.00,
      updated_at = NOW()
  WHERE id = '00000000-0000-0000-0002-000000000011'::uuid;

  -- ============================================================================
  -- 7. RETURN SUMMARY
  -- ============================================================================
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Demo environment reset to clean baseline successfully.',
    'details', jsonb_build_object(
      'repairs_deleted', v_repairs_deleted,
      'equipment_reset', v_equipment_reset,
      'sales_deleted', v_sales_deleted,
      'part_requests_deleted', v_part_requests_deleted,
      'service_history_deleted', v_service_history_deleted,
      'notifications_deleted', v_notifications_deleted
    )
  );
END;
$$;
