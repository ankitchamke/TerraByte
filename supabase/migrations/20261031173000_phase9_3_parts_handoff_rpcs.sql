-- ==============================================================================
-- TerraByte — Phase 9.3: Parts Handoff & Stock Movement Atomic RPCs
-- Migration: 20261031173000_phase9_3_parts_handoff_rpcs.sql
-- Description: Forward migration defining atomic RPCs for physical handoff,
--              stock adjustments, stock deliveries, and part returns.
--              Fully compliant with PostgreSQL safeupdate, strict RLS, and idempotency.
-- ==============================================================================

-- 1. ATOMIC PARTS HANDOFF RPC
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
    RAISE EXCEPTION 'Part requisition not found.'
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
    reason,
    movement_type,
    changed_by,
    repair_request_id,
    part_request_id,
    quote_id,
    unit_price,
    total_value,
    notes
  ) VALUES (
    v_part.id,
    -v_request.quantity,
    v_current_stock,
    v_new_stock,
    'Issued to technician for repair',
    'ISSUED_TO_REPAIR',
    v_caller_profile_id,
    v_request.repair_request_id,
    v_request.id,
    CASE WHEN v_approved_quote.id IS NOT NULL THEN v_approved_quote.id ELSE NULL END,
    v_unit_price,
    v_total_amount,
    CASE WHEN v_sale_id IS NOT NULL THEN 'Commercial sale against approved quote' ELSE 'Depot handoff to technician' END
  );

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

-- 2. ATOMIC STOCK ADJUSTMENT RPC
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
  WHERE auth_user_id = auth.uid() OR id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role != 'admin' THEN
    RAISE EXCEPTION 'Unauthorized: Only Service Centre administrators can adjust part stock.'
      USING ERRCODE = '42501';
  END IF;

  IF p_change_quantity = 0 THEN
    RAISE EXCEPTION 'Change quantity cannot be zero.' USING ERRCODE = '22000';
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
    'previous_stock', v_current_stock,
    'new_stock', v_new_stock
  );
END;
$$;
