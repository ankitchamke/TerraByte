-- ==============================================================================
-- TerraByte — Phase 9.1: Service Centre Parts Pickup & Inventory Management
-- Migration: 20261029100000_phase9_1_parts_pickup.sql
-- Description: Establishes the Service Centre Parts Desk schema, enabling:
--              1. Service Centre catalog & stock tracking (service_centre_parts)
--              2. Technician part pickup requisitions for assigned repairs (service_centre_part_requests)
--              3. Immutable stock movement audit log (service_centre_stock_audit)
--              4. Atomic, race-condition-safe handoff and stock adjustment RPCs
--              5. Strict PostgreSQL RLS policies enforcing technician assignment & farmer privacy
--              6. Deterministic inventory baseline restoration in reset_demo_data()
-- ==============================================================================

-- 1. SERVICE CENTRE PARTS CATALOG & INVENTORY TABLE
CREATE TABLE IF NOT EXISTS public.service_centre_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_number text NOT NULL UNIQUE,
  name text NOT NULL,
  spec text,
  category text NOT NULL DEFAULT 'General Mechanical',
  compatible_models text[] NOT NULL DEFAULT '{}',
  stock_quantity int NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  unit_price numeric NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  location text DEFAULT 'Depot Main Floor',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. SERVICE CENTRE PART REQUISITIONS TABLE
CREATE TABLE IF NOT EXISTS public.service_centre_part_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_request_id uuid NOT NULL REFERENCES public.repair_requests(id) ON DELETE CASCADE,
  part_id uuid NOT NULL REFERENCES public.service_centre_parts(id) ON DELETE RESTRICT,
  quantity int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'HANDED_OFF', 'CANCELLED')),
  requested_by uuid NOT NULL REFERENCES public.profiles(id),
  handed_off_by uuid REFERENCES public.profiles(id),
  handed_off_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. IMMUTABLE STOCK MOVEMENT AUDIT LOG
CREATE TABLE IF NOT EXISTS public.service_centre_stock_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id uuid NOT NULL REFERENCES public.service_centre_parts(id) ON DELETE CASCADE,
  change_quantity int NOT NULL,
  previous_stock int NOT NULL,
  new_stock int NOT NULL,
  reason text NOT NULL,
  changed_by uuid NOT NULL REFERENCES public.profiles(id),
  repair_request_id uuid REFERENCES public.repair_requests(id) ON DELETE SET NULL,
  part_request_id uuid REFERENCES public.service_centre_part_requests(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4. PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_sc_part_requests_repair_id 
  ON public.service_centre_part_requests(repair_request_id);

CREATE INDEX IF NOT EXISTS idx_sc_part_requests_status 
  ON public.service_centre_part_requests(status);

CREATE INDEX IF NOT EXISTS idx_sc_stock_audit_part_id 
  ON public.service_centre_stock_audit(part_id);

CREATE INDEX IF NOT EXISTS idx_sc_stock_audit_created_at 
  ON public.service_centre_stock_audit(created_at DESC);

-- 5. ENABLE ROW LEVEL SECURITY
ALTER TABLE public.service_centre_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_centre_part_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_centre_stock_audit ENABLE ROW LEVEL SECURITY;

-- 6. RLS POLICIES FOR service_centre_parts
-- Staff and technicians can view parts catalog. Farmers are strictly denied to preserve internal privacy.
DROP POLICY IF EXISTS "Staff and technicians can view parts catalog" ON public.service_centre_parts;
CREATE POLICY "Staff and technicians can view parts catalog"
ON public.service_centre_parts
FOR SELECT
TO authenticated
USING (
  public.current_user_role() IN ('admin', 'technician')
);

-- Only Service Centre admins can create, modify, or delete catalog items
DROP POLICY IF EXISTS "Admins can manage parts catalog" ON public.service_centre_parts;
CREATE POLICY "Admins can manage parts catalog"
ON public.service_centre_parts
FOR ALL
TO authenticated
USING (public.current_user_role() = 'admin')
WITH CHECK (public.current_user_role() = 'admin');

-- 7. RLS POLICIES FOR service_centre_part_requests
-- Admins can view all part requests
DROP POLICY IF EXISTS "Admins can view all part requests" ON public.service_centre_part_requests;
CREATE POLICY "Admins can view all part requests"
ON public.service_centre_part_requests
FOR SELECT
TO authenticated
USING (public.current_user_role() = 'admin');

-- Technicians can view part requests for repairs assigned to them
DROP POLICY IF EXISTS "Technicians can view part requests for their assigned repairs" ON public.service_centre_part_requests;
CREATE POLICY "Technicians can view part requests for their assigned repairs"
ON public.service_centre_part_requests
FOR SELECT
TO authenticated
USING (
  public.current_user_role() = 'technician'
  AND (
    requested_by = public.current_profile_id()
    OR EXISTS (
      SELECT 1 FROM public.repair_requests r
      WHERE r.id = repair_request_id
        AND r.technician_id = public.current_profile_id()
    )
  )
);

-- Technicians can create part requests ONLY for their active assigned repairs
DROP POLICY IF EXISTS "Technicians can request parts for assigned repairs" ON public.service_centre_part_requests;
CREATE POLICY "Technicians can request parts for assigned repairs"
ON public.service_centre_part_requests
FOR INSERT
TO authenticated
WITH CHECK (
  (
    public.current_user_role() = 'technician'
    AND requested_by = public.current_profile_id()
    AND EXISTS (
      SELECT 1 FROM public.repair_requests r
      WHERE r.id = repair_request_id
        AND r.technician_id = public.current_profile_id()
        AND r.status IN ('ACCEPTED', 'QUOTE_PENDING', 'QUOTE_REVISED', 'IN_PROGRESS', 'WAITING_FOR_PARTS')
    )
  )
  OR public.current_user_role() = 'admin'
);

-- Admins can update any part request (e.g. handoff or cancel)
DROP POLICY IF EXISTS "Admins can update part requests" ON public.service_centre_part_requests;
CREATE POLICY "Admins can update part requests"
ON public.service_centre_part_requests
FOR UPDATE
TO authenticated
USING (public.current_user_role() = 'admin')
WITH CHECK (public.current_user_role() = 'admin');

-- Technicians can cancel their own PENDING requests
DROP POLICY IF EXISTS "Technicians can cancel own pending part requests" ON public.service_centre_part_requests;
CREATE POLICY "Technicians can cancel own pending part requests"
ON public.service_centre_part_requests
FOR UPDATE
TO authenticated
USING (
  public.current_user_role() = 'technician'
  AND requested_by = public.current_profile_id()
  AND status = 'PENDING'
)
WITH CHECK (
  status = 'CANCELLED'
);

-- 8. RLS POLICIES FOR service_centre_stock_audit
-- Only admins can inspect audit logs
DROP POLICY IF EXISTS "Admins can view stock audit log" ON public.service_centre_stock_audit;
CREATE POLICY "Admins can view stock audit log"
ON public.service_centre_stock_audit
FOR SELECT
TO authenticated
USING (public.current_user_role() = 'admin');

-- 9. ATOMIC HANDOFF FUNCTION (TRANSACTIONAL, PREVENTS NEGATIVE STOCK & RACE CONDITIONS)
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
BEGIN
  -- 1. Caller identity and role validation
  SELECT id, role INTO v_caller_profile_id, v_caller_role
  FROM public.profiles
  WHERE auth_user_id = auth.uid() OR id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role != 'admin' THEN
    RAISE EXCEPTION 'Unauthorized: Only Service Centre administrators can confirm parts handoff.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Fetch request with row lock
  SELECT * INTO v_request
  FROM public.service_centre_part_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Part request not found.'
      USING ERRCODE = 'P0002';
  END IF;

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

  -- 5. Atomically decrement stock
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

  -- 7. Insert audit record
  INSERT INTO public.service_centre_stock_audit (
    part_id,
    change_quantity,
    previous_stock,
    new_stock,
    reason,
    changed_by,
    repair_request_id,
    part_request_id
  ) VALUES (
    v_part.id,
    -v_request.quantity,
    v_current_stock,
    v_new_stock,
    'technician_handoff',
    v_caller_profile_id,
    v_request.repair_request_id,
    v_request.id
  );

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_request.id,
    'part_id', v_part.id,
    'part_name', v_part.name,
    'quantity', v_request.quantity,
    'previous_stock', v_current_stock,
    'new_stock', v_new_stock,
    'handed_off_at', now()
  );
END;
$$;

-- 10. ATOMIC STOCK ADJUSTMENT FUNCTION
CREATE OR REPLACE FUNCTION public.adjust_service_centre_part_stock(
  p_part_id uuid,
  p_change_quantity int,
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
BEGIN
  -- 1. Caller identity and role validation
  SELECT id, role INTO v_caller_profile_id, v_caller_role
  FROM public.profiles
  WHERE auth_user_id = auth.uid() OR id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role != 'admin' THEN
    RAISE EXCEPTION 'Unauthorized: Only Service Centre administrators can adjust part stock.'
      USING ERRCODE = '42501';
  END IF;

  IF p_change_quantity = 0 THEN
    RAISE EXCEPTION 'Stock change quantity cannot be zero.'
      USING ERRCODE = '22000';
  END IF;

  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Adjustment reason is required.'
      USING ERRCODE = '22000';
  END IF;

  -- 2. Lock part row
  SELECT * INTO v_part
  FROM public.service_centre_parts
  WHERE id = p_part_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Part item not found.'
      USING ERRCODE = 'P0002';
  END IF;

  v_current_stock := v_part.stock_quantity;
  v_new_stock := v_current_stock + p_change_quantity;

  IF v_new_stock < 0 THEN
    RAISE EXCEPTION 'Adjustment would result in negative stock: current % + change % = %.',
      v_current_stock, p_change_quantity, v_new_stock
      USING ERRCODE = '22003';
  END IF;

  -- 3. Update stock
  UPDATE public.service_centre_parts
  SET stock_quantity = v_new_stock,
      updated_at = now()
  WHERE id = v_part.id;

  -- 4. Write audit record
  INSERT INTO public.service_centre_stock_audit (
    part_id,
    change_quantity,
    previous_stock,
    new_stock,
    reason,
    changed_by
  ) VALUES (
    v_part.id,
    p_change_quantity,
    v_current_stock,
    v_new_stock,
    trim(p_reason),
    v_caller_profile_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'part_id', v_part.id,
    'part_name', v_part.name,
    'change_quantity', p_change_quantity,
    'previous_stock', v_current_stock,
    'new_stock', v_new_stock
  );
END;
$$;

-- 11. SAFE SERVER-SIDE PART REQUISITION FUNCTION
CREATE OR REPLACE FUNCTION public.request_service_centre_part(
  p_repair_request_id uuid,
  p_part_id uuid,
  p_quantity int DEFAULT 1,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_profile_id uuid;
  v_caller_role user_role;
  v_repair record;
  v_part record;
  v_new_request_id uuid;
BEGIN
  -- 1. Identity validation
  SELECT id, role INTO v_caller_profile_id, v_caller_role
  FROM public.profiles
  WHERE auth_user_id = auth.uid() OR id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('technician', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: Only technicians or administrators can request spare parts.'
      USING ERRCODE = '42501';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Requested quantity must be at least 1.'
      USING ERRCODE = '22000';
  END IF;

  -- 2. Validate repair assignment
  SELECT * INTO v_repair
  FROM public.repair_requests
  WHERE id = p_repair_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Repair request not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_caller_role = 'technician' AND v_repair.technician_id != v_caller_profile_id THEN
    RAISE EXCEPTION 'Unauthorized: You are not assigned to this repair ticket.'
      USING ERRCODE = '42501';
  END IF;

  IF v_repair.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Cannot request parts for a closed repair (status: %).', v_repair.status
      USING ERRCODE = '22000';
  END IF;

  -- 3. Validate part exists
  SELECT * INTO v_part
  FROM public.service_centre_parts
  WHERE id = p_part_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Part not found in Service Centre catalog.'
      USING ERRCODE = 'P0002';
  END IF;

  -- 4. Insert requisition
  INSERT INTO public.service_centre_part_requests (
    repair_request_id,
    part_id,
    quantity,
    status,
    requested_by,
    notes
  ) VALUES (
    v_repair.id,
    v_part.id,
    p_quantity,
    'PENDING',
    v_caller_profile_id,
    trim(p_notes)
  ) RETURNING id INTO v_new_request_id;

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_new_request_id,
    'repair_id', v_repair.id,
    'job_number', v_repair.job_number,
    'part_id', v_part.id,
    'part_name', v_part.name,
    'quantity', p_quantity,
    'available_stock', v_part.stock_quantity,
    'status', 'PENDING'
  );
END;
$$;

-- 12. SEED CANONICAL VERIFIED PARTS (EXACT PARTS FROM EXISTING DEMO STATE)
INSERT INTO public.service_centre_parts (
  part_number,
  name,
  spec,
  category,
  compatible_models,
  stock_quantity,
  unit_price
) VALUES
  ('0433171', 'Fuel Injector Nozzle Set', 'Bosch 0433171 (x4)', 'Fuel system', ARRAY['Mahindra 575 DI'], 3, 2200),
  ('005556958R1', 'Inline Fuel Filter', 'Mahindra 005556958R1', 'Fuel system', ARRAY['Mahindra 575 DI'], 8, 350),
  ('AL120788', 'Lift Cylinder Seal Kit', 'JD AL120788', 'Hydraulics', ARRAY['John Deere 5050D'], 2, 1650),
  ('HY-GARD-15W30', 'Hydraulic Oil 15W-30', 'JD Hy-Gard, litres', 'Hydraulics', ARRAY['John Deere 5050D'], 5, 320),
  ('26243171', 'Starter Motor Assembly', 'Lucas-TVS 12V 2.2kW', 'Electrical', ARRAY['Mahindra 575 DI', 'Swaraj 744 FE'], 1, 5800)
ON CONFLICT (part_number) DO UPDATE SET
  name = EXCLUDED.name,
  spec = EXCLUDED.spec,
  category = EXCLUDED.category,
  compatible_models = EXCLUDED.compatible_models,
  unit_price = EXCLUDED.unit_price;

-- 13. UPDATE reset_demo_data() TO RESTORE INVENTORY BASELINE
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
  v_part_requests_deleted int := 0;
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
  -- 2. PURGE PART REQUISITIONS & AUDIT LOGS
  -- ============================================================================
  WITH del_reqs AS (
    DELETE FROM public.service_centre_part_requests
    WHERE id IS NOT NULL
    RETURNING id
  )
  SELECT count(*) INTO v_part_requests_deleted FROM del_reqs;

  DELETE FROM public.service_centre_stock_audit WHERE id IS NOT NULL;

  -- Restore canonical stock quantities (idempotent upsert)
  INSERT INTO public.service_centre_parts (
    part_number,
    name,
    spec,
    category,
    compatible_models,
    stock_quantity,
    unit_price,
    location
  ) VALUES
    ('0433171', 'Fuel Injector Nozzle Set', 'Bosch 0433171 (x4)', 'Fuel system', ARRAY['Mahindra 575 DI'], 3, 2200, 'Depot Shelf A-02'),
    ('005556958R1', 'Inline Fuel Filter', 'Mahindra 005556958R1', 'Fuel system', ARRAY['Mahindra 575 DI'], 8, 350, 'Depot Shelf A-03'),
    ('AL120788', 'Lift Cylinder Seal Kit', 'JD AL120788', 'Hydraulics', ARRAY['John Deere 5050D'], 2, 1650, 'Depot Shelf B-01'),
    ('HY-GARD-15W30', 'Hydraulic Oil 15W-30', 'JD Hy-Gard, litres', 'Hydraulics', ARRAY['John Deere 5050D'], 5, 320, 'Depot Drum Rack B-04'),
    ('26243171', 'Starter Motor Assembly', 'Lucas-TVS 12V 2.2kW', 'Electrical', ARRAY['Mahindra 575 DI', 'Swaraj 744 FE'], 1, 5800, 'Depot Shelf C-01')
  ON CONFLICT (part_number) DO UPDATE SET
    stock_quantity = EXCLUDED.stock_quantity,
    location = EXCLUDED.location,
    unit_price = EXCLUDED.unit_price,
    updated_at = now();

  -- ============================================================================
  -- 3. PURGE ALL SAMPLE REPAIR REQUESTS & DEPENDENT DATA
  -- ============================================================================
  WITH deleted_repairs AS (
    DELETE FROM public.repair_requests
    WHERE id IS NOT NULL
    RETURNING id
  )
  SELECT count(*) INTO v_repairs_deleted FROM deleted_repairs;

  DELETE FROM public.repair_dispatch_locations WHERE id IS NOT NULL;
  DELETE FROM public.repair_messages WHERE id IS NOT NULL;
  DELETE FROM public.repair_notes WHERE id IS NOT NULL;
  DELETE FROM public.repair_timeline WHERE id IS NOT NULL;
  DELETE FROM public.quote_items WHERE id IS NOT NULL;
  DELETE FROM public.quotes WHERE id IS NOT NULL;

  -- ============================================================================
  -- 4. PURGE SERVICE HISTORY & NOTIFICATIONS
  -- ============================================================================
  WITH deleted_history AS (
    DELETE FROM public.service_history
    WHERE id IS NOT NULL
    RETURNING id
  )
  SELECT count(*) INTO v_service_history_deleted FROM deleted_history;

  WITH deleted_notifs AS (
    DELETE FROM public.notifications
    WHERE id IS NOT NULL
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
      'part_requests_deleted', v_part_requests_deleted,
      'service_history_deleted', v_service_history_deleted,
      'notifications_deleted', v_notifications_deleted
    )
  );
END;
$$;
