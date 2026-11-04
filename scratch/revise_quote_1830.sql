DECLARE
  v_caller_id uuid;
  v_caller_role user_role;
  v_repair record;
  v_prev_quote record;
  v_quote_id uuid;
  v_new_version int;
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

  -- 2. Fetch and lock previous quote
  SELECT id, version, status, repair_request_id, technician_id INTO v_prev_quote
  FROM public.quotes
  WHERE id = p_previous_quote_id
  FOR UPDATE;

  IF v_prev_quote.id IS NULL THEN
    RAISE EXCEPTION 'Previous quote % not found or inaccessible.', p_previous_quote_id;
  END IF;

  v_new_version := v_prev_quote.version + 1;

  -- 3. Verify repair request
  SELECT id, job_number, farmer_id, technician_id, status INTO v_repair
  FROM public.repair_requests
  WHERE id = p_repair_request_id
  FOR UPDATE;

  IF v_repair.id IS NULL THEN
    RAISE EXCEPTION 'Repair request % not found.', p_repair_request_id;
  END IF;

  IF v_caller_role = 'technician' AND v_repair.technician_id <> v_caller_id THEN
    RAISE EXCEPTION 'Unauthorized: You are not assigned to this repair ticket.' USING ERRCODE = '42501';
  END IF;

  -- 4. Mark previous quote as REVISED
  UPDATE public.quotes
  SET status = 'REVISED', updated_at = v_now
  WHERE id = v_prev_quote.id;

  -- 5. Insert new quote version
  INSERT INTO public.quotes (
    repair_request_id, technician_id, labour_description, labour_amount,
    tax_percent, estimated_completion, warranty_terms, version, status, sent_at, created_at, updated_at
  ) VALUES (
    v_repair.id, v_caller_id, trim(p_labour_description), p_labour_amount,
    p_tax_percent, trim(p_estimated_completion), nullif(trim(p_warranty_terms), ''),
    v_new_version, 'PENDING', v_now, v_now, v_now
  )
  RETURNING id INTO v_quote_id;

  -- 6. Insert items
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

  v_tax_amount := round((v_parts_total + p_labour_amount) * (p_tax_percent / 100.0), 2);
  v_total_amount := round(v_parts_total + p_labour_amount + v_tax_amount, 2);

  -- 7. Advance repair status: preserve WAITING_FOR_PARTS if waiting for parts
  v_next_status := CASE WHEN v_repair.status = 'WAITING_FOR_PARTS' THEN 'WAITING_FOR_PARTS'::repair_status ELSE 'QUOTE_PENDING'::repair_status END;

  UPDATE public.repair_requests
  SET status = v_next_status,
      clarification_note = NULL,
      status_since = v_now,
      updated_at = v_now
  WHERE id = v_repair.id;

  -- 8. Record timeline event
  INSERT INTO public.repair_timeline (
    repair_request_id, status, note, created_by_role, created_by_id, created_at
  ) VALUES (
    v_repair.id, v_next_status,
    'Revised quote formulated & sent (v' || v_new_version::text || ': ₹' || v_total_amount::text || ')' ||
    CASE WHEN p_technician_explanation IS NOT NULL AND trim(p_technician_explanation) <> '' 
         THEN ' Note: "' || trim(p_technician_explanation) || '"' 
         ELSE '' END,
    v_caller_role::text, v_caller_id, v_now
  );

  -- 9. Notify farmer
  INSERT INTO public.notifications (
    recipient_role, recipient_user_id, notification_text, link_target, is_read, created_at
  ) VALUES (
    'farmer'::user_role, v_repair.farmer_id,
    'Revised quote ready for repair ' || v_repair.job_number || ' (v' || v_new_version::text || '). Review and approve the updated repair.',
    '/farmer/repair/' || v_repair.id::text, false, v_now
  );

  -- 10. Return complete structured revised quote
  RETURN jsonb_build_object(
    'id', v_quote_id,
    'repair_request_id', v_repair.id,
    'technician_id', v_caller_id,
    'labour_description', trim(p_labour_description),
    'labour_amount', p_labour_amount,
    'tax_percent', p_tax_percent,
    'estimated_completion', trim(p_estimated_completion),
    'warranty_terms', nullif(trim(p_warranty_terms), ''),
    'version', v_new_version,
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