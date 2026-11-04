-- ==============================================================================
-- TerraByte — Phase 9 Core: Parts Desk RPCs & Performance Indexes
-- Migration: 20261104110000_complete_phase9_parts_desk_rpcs.sql
-- Description: Completes Phase 9 Parts Desk capabilities with atomic, race-condition-safe
--              RPCs for physical handoff, stock adjustments, part requests, stock receipt,
--              and part returns. Fully enforces row-level locking, admin/technician authorization,
--              stock depletion prevention, and snapshot sales tracking.
-- ==============================================================================

-- 1. PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_sc_sales_sold_at 
  ON public.service_centre_part_sales(sold_at DESC);

CREATE INDEX IF NOT EXISTS idx_sc_stock_audit_movement 
  ON public.service_centre_stock_audit(movement_type, created_at DESC);

-- 2. ATOMIC PARTS HANDOFF RPC
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
  v_repair record;
  v_part record;
  v_current_stock int;
  v_new_stock int;
  v_approved_quote record;
  v_quote_item record;
  v_quote_id uuid := NULL;
  v_quote_item_id uuid := NULL;
  v_sale_id uuid := NULL;
  v_unit_price numeric := NULL;
  v_total_amount numeric := NULL;
  v_audit_id uuid;
BEGIN
  -- 1. Validate caller identity and role
  SELECT id, role INTO v_caller_profile_id, v_caller_role
  FROM public.profiles
  WHERE auth_user_id = auth.uid() 
     OR id = auth.uid()
     OR (clerk_user_id IS NOT NULL AND clerk_user_id = auth.jwt()->>'sub')
  LIMIT 1;

  IF v_caller_profile_id IS NULL THEN
    v_caller_profile_id := public.current_profile_id();
    v_caller_role := public.current_user_role();
  END IF;

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
    RAISE EXCEPTION 'Part requisition not found.'
      USING ERRCODE = 'P0002';
  END IF;

  -- Prevent duplicate handoff or double-decrementing stock on retries
  IF v_request.status != 'PENDING' THEN
    RAISE EXCEPTION 'Cannot confirm handoff: Part request is already %.', v_request.status
      USING ERRCODE = '22000';
  END IF;

  -- 3. Lock repair ticket row BEFORE locking part catalog row to preserve consistent global lock hierarchy
  SELECT * INTO v_repair
  FROM public.repair_requests
  WHERE id = v_request.repair_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Associated repair request not found.'
      USING ERRCODE = 'P0002';
  END IF;

  -- 4. Lock part row to prevent concurrent race conditions
  SELECT * INTO v_part
  FROM public.service_centre_parts
  WHERE id = v_request.part_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Part item not found in catalog.'
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

  -- Touch repair_requests to emit Realtime CDC event to connected clients
  UPDATE public.repair_requests
  SET updated_at = now()
  WHERE id = v_request.repair_request_id;

  -- 7. Check if there is an approved quote line for this part on the repair
  SELECT q.id, q.repair_request_id INTO v_approved_quote
  FROM public.quotes q
  WHERE q.repair_request_id = v_request.repair_request_id
    AND q.status = 'APPROVED'
  ORDER BY q.version DESC
  LIMIT 1;

  IF FOUND THEN
    v_quote_id := v_approved_quote.id;

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
      v_quote_item_id := v_quote_item.id;
      v_unit_price := v_quote_item.unit_price;
      v_total_amount := v_request.quantity * v_unit_price;

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
        v_quote_id,
        v_quote_item_id,
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
    'Issued to technician for repair',
    v_caller_profile_id,
    v_request.repair_request_id,
    v_request.id,
    v_quote_id,
    v_quote_item_id,
    v_unit_price,
    v_total_amount,
    CASE WHEN v_sale_id IS NOT NULL THEN 'Commercial sale against approved quote' ELSE 'Depot handoff to technician' END
  )
  RETURNING id INTO v_audit_id;

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

-- 3. ATOMIC STOCK ADJUSTMENT RPC
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
  SELECT id, role INTO v_caller_profile_id, v_caller_role
  FROM public.profiles
  WHERE auth_user_id = auth.uid() 
     OR id = auth.uid()
     OR (clerk_user_id IS NOT NULL AND clerk_user_id = auth.jwt()->>'sub')
  LIMIT 1;

  IF v_caller_profile_id IS NULL THEN
    v_caller_profile_id := public.current_profile_id();
    v_caller_role := public.current_user_role();
  END IF;

  IF v_caller_role IS NULL OR v_caller_role != 'admin' THEN
    RAISE EXCEPTION 'Unauthorized: Only Service Centre administrators can adjust part stock.'
      USING ERRCODE = '42501';
  END IF;

  IF p_change_quantity IS NULL OR p_change_quantity = 0 THEN
    RAISE EXCEPTION 'Stock change quantity cannot be zero or null.' USING ERRCODE = '22000';
  END IF;

  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Adjustment reason is required.' USING ERRCODE = '22000';
  END IF;

  SELECT * INTO v_part
  FROM public.service_centre_parts
  WHERE id = p_part_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Part not found in catalog.' USING ERRCODE = 'P0002';
  END IF;

  v_current_stock := v_part.stock_quantity;
  v_new_stock := v_current_stock + p_change_quantity;

  IF v_new_stock < 0 THEN
    RAISE EXCEPTION 'Adjustment would result in negative stock: % available, change is %.',
      v_current_stock, p_change_quantity
      USING ERRCODE = '22003';
  END IF;

  UPDATE public.service_centre_parts
  SET stock_quantity = v_new_stock,
      updated_at = now()
  WHERE id = v_part.id;

  INSERT INTO public.service_centre_stock_audit (
    part_id,
    change_quantity,
    previous_stock,
    new_stock,
    reason,
    movement_type,
    changed_by
  ) VALUES (
    v_part.id,
    p_change_quantity,
    v_current_stock,
    v_new_stock,
    trim(p_reason),
    'ADJUSTMENT',
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

-- 4. ATOMIC PART REQUISITION RPC
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
  SELECT id, role INTO v_caller_profile_id, v_caller_role
  FROM public.profiles
  WHERE auth_user_id = auth.uid() 
     OR id = auth.uid()
     OR (clerk_user_id IS NOT NULL AND clerk_user_id = auth.jwt()->>'sub')
  LIMIT 1;

  IF v_caller_profile_id IS NULL THEN
    v_caller_profile_id := public.current_profile_id();
    v_caller_role := public.current_user_role();
  END IF;

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('technician', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: Only technicians or administrators can request spare parts.'
      USING ERRCODE = '42501';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Requested quantity must be at least 1.'
      USING ERRCODE = '22000';
  END IF;

  -- Validate repair assignment with row lock to serialize concurrent ticket reassignment
  SELECT * INTO v_repair
  FROM public.repair_requests
  WHERE id = p_repair_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Repair request not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_caller_role = 'technician' AND v_repair.technician_id IS DISTINCT FROM v_caller_profile_id THEN
    RAISE EXCEPTION 'Unauthorized: You are not assigned to this repair ticket.'
      USING ERRCODE = '42501';
  END IF;

  IF v_repair.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Cannot request parts for a closed repair (status: %).', v_repair.status
      USING ERRCODE = '22000';
  END IF;

  -- Validate part exists
  SELECT * INTO v_part
  FROM public.service_centre_parts
  WHERE id = p_part_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Part not found in Service Centre catalog.'
      USING ERRCODE = 'P0002';
  END IF;

  -- Insert requisition
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

-- 5. ATOMIC STOCK RECEIPT RPC
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
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Received quantity must be positive.' USING ERRCODE = '22003';
  END IF;

  SELECT id, role INTO v_caller_profile_id, v_caller_role
  FROM public.profiles
  WHERE auth_user_id = auth.uid() 
     OR id = auth.uid()
     OR (clerk_user_id IS NOT NULL AND clerk_user_id = auth.jwt()->>'sub')
  LIMIT 1;

  IF v_caller_profile_id IS NULL THEN
    v_caller_profile_id := public.current_profile_id();
    v_caller_role := public.current_user_role();
  END IF;

  IF v_caller_role IS NULL OR v_caller_role != 'admin' THEN
    RAISE EXCEPTION 'Unauthorized: Only Service Centre administrators can receive stock.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_part
  FROM public.service_centre_parts
  WHERE id = p_part_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Part not found in catalog.' USING ERRCODE = 'P0002';
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
    coalesce(trim(p_reason), 'Supplier stock delivery received'),
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

-- 6. ATOMIC UNUSED PART RETURN RPC
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
  v_repair record;
  v_part record;
  v_current_stock int;
  v_new_stock int;
  v_issued_quantity int := 0;
  v_already_returned_quantity int := 0;
  v_remaining_issued int := 0;
  v_audit_id uuid;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Return quantity must be positive.' USING ERRCODE = '22003';
  END IF;

  SELECT id, role INTO v_caller_profile_id, v_caller_role
  FROM public.profiles
  WHERE auth_user_id = auth.uid() 
     OR id = auth.uid()
     OR (clerk_user_id IS NOT NULL AND clerk_user_id = auth.jwt()->>'sub')
  LIMIT 1;

  IF v_caller_profile_id IS NULL THEN
    v_caller_profile_id := public.current_profile_id();
    v_caller_role := public.current_user_role();
  END IF;

  IF v_caller_role IS NULL OR v_caller_role != 'admin' THEN
    RAISE EXCEPTION 'Unauthorized: Only Service Centre administrators can confirm part returns.'
      USING ERRCODE = '42501';
  END IF;

  -- 1. Verify repair request exists and lock it to serialize concurrent returns for this ticket
  SELECT id, job_number INTO v_repair
  FROM public.repair_requests
  WHERE id = p_repair_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Repair request not found.' USING ERRCODE = 'P0002';
  END IF;

  -- 2. Lock part row in catalog
  SELECT * INTO v_part
  FROM public.service_centre_parts
  WHERE id = p_part_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Part not found in catalog.' USING ERRCODE = 'P0002';
  END IF;

  -- 3. Calculate issued and already returned quantities from immutable audit history
  SELECT COALESCE(SUM(ABS(change_quantity)), 0)
  INTO v_issued_quantity
  FROM public.service_centre_stock_audit
  WHERE repair_request_id = p_repair_request_id
    AND part_id = p_part_id
    AND movement_type = 'ISSUED_TO_REPAIR';

  SELECT COALESCE(SUM(change_quantity), 0)
  INTO v_already_returned_quantity
  FROM public.service_centre_stock_audit
  WHERE repair_request_id = p_repair_request_id
    AND part_id = p_part_id
    AND movement_type = 'RETURNED';

  v_remaining_issued := v_issued_quantity - v_already_returned_quantity;

  IF v_issued_quantity = 0 THEN
    RAISE EXCEPTION 'Cannot return part: Part % was never issued to repair request %.', v_part.name, v_repair.job_number
      USING ERRCODE = '22023';
  END IF;

  IF v_remaining_issued <= 0 THEN
    RAISE EXCEPTION 'Cannot return part: All issued units of % have already been returned for repair %.', v_part.name, v_repair.job_number
      USING ERRCODE = '22023';
  END IF;

  IF p_quantity > v_remaining_issued THEN
    RAISE EXCEPTION 'Cannot return % units of %: Only % unit(s) remain eligible for return on repair %.', p_quantity, v_part.name, v_remaining_issued, v_repair.job_number
      USING ERRCODE = '22023';
  END IF;

  v_current_stock := v_part.stock_quantity;
  v_new_stock := v_current_stock + p_quantity;

  -- 4. Restore physical stock on hand
  UPDATE public.service_centre_parts
  SET stock_quantity = v_new_stock,
      updated_at = now()
  WHERE id = v_part.id;

  -- 5. Append immutable RETURNED movement record without rewriting prior records
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
    COALESCE(NULLIF(TRIM(p_reason), ''), 'Unused part returned from repair'),
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
    'remaining_issued', v_remaining_issued - p_quantity,
    'previous_stock', v_current_stock,
    'new_stock', v_new_stock,
    'movement_type', 'RETURNED',
    'repair_request_id', p_repair_request_id,
    'audit_id', v_audit_id
  );
END;
$$;

-- 7. GRANTS AND PRIVILEGES
REVOKE ALL ON FUNCTION public.confirm_service_centre_part_handoff(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_service_centre_part_handoff(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirm_service_centre_part_handoff(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.adjust_service_centre_part_stock(uuid, int, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.adjust_service_centre_part_stock(uuid, int, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.adjust_service_centre_part_stock(uuid, int, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.request_service_centre_part(uuid, uuid, int, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.request_service_centre_part(uuid, uuid, int, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_service_centre_part(uuid, uuid, int, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.receive_service_centre_stock(uuid, int, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.receive_service_centre_stock(uuid, int, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.receive_service_centre_stock(uuid, int, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.return_service_centre_part(uuid, uuid, int, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.return_service_centre_part(uuid, uuid, int, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.return_service_centre_part(uuid, uuid, int, text) TO authenticated, service_role;
