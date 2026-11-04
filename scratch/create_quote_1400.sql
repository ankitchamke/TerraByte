DECLARE
  v_caller_id uuid;
  v_caller_role user_role;
  v_repair record;
  v_existing_quote record;
  v_quote_id uuid;
  v_now timestamptz := now();
  v_item record;
  v_parts_total numeric := 0;
  v_tax_amount numeric := 0;
  v_total_amount numeric := 0;
  v_next_status repair_status;
  v_inserted_items jsonb := '[]'::jsonb;
  v_item_row record;
BEGIN
  -- 1. Caller verification
  SELECT id, role INTO v_caller_id, v_caller_role
  FROM public.profiles
  WHERE auth_user_id = auth.uid() OR id = auth.uid()
  LIMIT 1;

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required: User profile not found.' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('technician', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: Only technicians or administrators can formulate repair quotes.' USING ERRCODE = '42501';
  END IF;

  -- 2. Verify repair request eligibility & assignment
  SELECT id, job_number, farmer_id, technician_id, status, parts_hold INTO v_repair
  FROM public.repair_requests
  WHERE id = p_repair_request_id
  FOR UPDATE;

  IF v_repair.id IS NULL THEN
    RAISE EXCEPTION 'Repair request % not found or inaccessible.', p_repair_request_id;
  END IF;

  IF v_caller_role = 'technician' AND v_repair.technician_id <> v_caller_id THEN
    RAISE EXCEPTION 'Unauthorized: You are not assigned to this repair ticket.' USING ERRCODE = '42501';
  END IF;

  -- Enforce state machine: WAITING_FOR_PARTS strictly requires an active parts hold
  IF v_repair.status NOT IN ('ACCEPTED', 'REQUESTED', 'QUOTE_REVISED') THEN
    IF v_repair.status = 'WAITING_FOR_PARTS' THEN
      IF v_repair.parts_hold IS NULL AND NOT EXISTS (
        SELECT 1 FROM public.service_centre_part_requests scpr
        WHERE scpr.repair_request_id = v_repair.id AND scpr.status <> 'CANCELLED'
      ) THEN
        RAISE EXCEPTION 'Cannot create quote: Repair ticket is in WAITING_FOR_PARTS status without an active parts hold.' USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'Cannot create quote: Repair ticket is in % status.', v_repair.status;
    END IF;
  END IF;

  -- 3. One-pending-quote enforcement: Clean up any 0-item, 0-labour orphan quote or reject collision
  FOR v_existing_quote IN
    SELECT q.id, count(qi.id) AS item_count, COALESCE(q.labour_amount, 0) AS labour_amt
    FROM public.quotes q
    LEFT JOIN public.quote_items qi ON qi.quote_id = q.id
    WHERE q.repair_request_id = p_repair_request_id
      AND q.status = 'PENDING'
    GROUP BY q.id, q.labour_amount
  LOOP
    IF v_existing_quote.item_count > 0 OR v_existing_quote.labour_amt > 0 THEN
      RAISE EXCEPTION 'Cannot create quote: A pending quote already exists for this repair. Wait for the farmer to respond or request changes.';
    ELSE
      DELETE FROM public.quotes WHERE id = v_existing_quote.id;
    END IF;
  END LOOP;

  -- 4. Validate items array or positive labour amount (allows labour-only inspection quotes)
  IF (p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0) AND COALESCE(p_labour_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Quote must contain at least one itemized part or supply, or a valid labour charge.';
  END IF;

  -- 5. Insert quote header (version 1, PENDING)
  INSERT INTO public.quotes (
    repair_request_id, technician_id, labour_description, labour_amount,
    tax_percent, estimated_completion, warranty_terms, version, status, sent_at, created_at, updated_at
  ) VALUES (
    v_repair.id, v_caller_id, trim(p_labour_description), p_labour_amount,
    p_tax_percent, trim(p_estimated_completion), nullif(trim(p_warranty_terms), ''),
    1, 'PENDING', v_now, v_now, v_now
  )
  RETURNING id INTO v_quote_id;

  -- 6. Insert items (if any)
  IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' AND jsonb_array_length(p_items) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
      part_name text,
      part_spec text,
      quantity int,
      unit_price numeric,
      part_source text,
      catalog_part_id uuid
    )
    LOOP
      IF v_item.part_name IS NULL OR trim(v_item.part_name) = '' THEN
        RAISE EXCEPTION 'Part name is required for all quote items.';
      END IF;

      INSERT INTO public.quote_items (
        quote_id, part_name, part_spec, quantity, unit_price, part_source, catalog_part_id, created_at
      ) VALUES (
        v_quote_id, trim(v_item.part_name), nullif(trim(v_item.part_spec), ''),
        v_item.quantity, v_item.unit_price, coalesce(nullif(trim(v_item.part_source), ''), 'In van stock'),
        v_item.catalog_part_id, v_now
      )
      RETURNING * INTO v_item_row;

      v_parts_total := v_parts_total + (v_item.quantity * v_item.unit_price);
      v_inserted_items := v_inserted_items || to_jsonb(v_item_row);
    END LOOP;
  END IF;

  -- 7. Calculate totals
  v_tax_amount := round(((v_parts_total + p_labour_amount) * (p_tax_percent / 100.0)), 2);
  v_total_amount := round((v_parts_total + p_labour_amount + v_tax_amount), 2);

  -- 8. Advance repair status to QUOTE_PENDING (preserving WAITING_FOR_PARTS if active)
  IF v_repair.status = 'WAITING_FOR_PARTS' THEN
    v_next_status := 'WAITING_FOR_PARTS';
  ELSE
    v_next_status := 'QUOTE_PENDING';
  END IF;

  UPDATE public.repair_requests
  SET
    status = v_next_status,
    updated_at = v_now
  WHERE id = v_repair.id;

  -- Record timeline entry
  INSERT INTO public.repair_timeline (
    repair_request_id, status, note, created_by_role, created_by_id, created_at
  ) VALUES (
    v_repair.id, v_next_status,
    'Quote formulated & sent (v1: ₹' || v_total_amount::text || ')',
    v_caller_role::text, v_caller_id, v_now
  );

  -- Notify farmer
  INSERT INTO public.notifications (
    recipient_role, recipient_user_id, notification_text, link_target, is_read, created_at
  ) VALUES (
    'farmer'::user_role, v_repair.farmer_id,
    'Quote ready for repair ' || v_repair.job_number || '. Review and approve the proposed repair.',
    '/farmer/repair/' || v_repair.id::text, false, v_now
  );

  -- Return complete structured quote
  RETURN jsonb_build_object(
    'id', v_quote_id,
    'repair_request_id', v_repair.id,
    'technician_id', v_caller_id,
    'labour_description', trim(p_labour_description),
    'labour_amount', p_labour_amount,
    'tax_percent', p_tax_percent,
    'estimated_completion', trim(p_estimated_completion),
    'warranty_terms', nullif(trim(p_warranty_terms), ''),
    'version', 1,
    'status', 'PENDING',
    'sent_at', v_now,
    'created_at', v_now,
    'updated_at', v_now,
    'quote_items', v_inserted_items,
    'totals', jsonb_build_object(
      'partsTotal', v_parts_total,
      'labourAmount', p_labour_amount,
      'taxAmount', v_tax_amount,
      'totalAmount', v_total_amount
    )
  );
END;