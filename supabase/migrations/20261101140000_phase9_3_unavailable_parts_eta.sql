-- ==============================================================================
-- TerraByte — Phase 9.3: Unavailable Parts & ETA Coordination
-- Migration: 20261101140000_phase9_3_unavailable_parts_eta.sql
-- Description: Forward migration adding item-level ETA tracking and audit
--              attributes to service_centre_part_requests, RLS update for
--              technician/admin coordination, and atomic ETA update RPC.
--              Fully compliant with PostgreSQL safeupdate, strict RLS, and idempotency.
-- ==============================================================================

-- 1. ADD ITEM-LEVEL ETA AND AUDIT COLUMNS
ALTER TABLE public.service_centre_part_requests
  ADD COLUMN IF NOT EXISTS estimated_arrival_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS eta_updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL NULL,
  ADD COLUMN IF NOT EXISTS eta_updated_at timestamptz NULL;

-- 2. CREATE INDEX FOR REALTIME & FILTERING QUERIES
CREATE INDEX IF NOT EXISTS idx_sc_part_requests_estimated_arrival
  ON public.service_centre_part_requests (estimated_arrival_at);

-- 3. UPDATE RLS POLICIES FOR ETA COORDINATION
-- Allow assigned technicians and Service Centre admins to update ETA on part requests
DROP POLICY IF EXISTS "Assigned technicians or admins can update part request ETA" ON public.service_centre_part_requests;
DROP POLICY IF EXISTS "Technicians can update ETA on assigned repair part requests" ON public.service_centre_part_requests;

CREATE POLICY "Assigned technicians or admins can update part request ETA"
ON public.service_centre_part_requests
FOR UPDATE
TO authenticated
USING (
  -- Service Centre staff can update all requests
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE (p.auth_user_id = auth.uid() OR p.id = auth.uid())
      AND p.role IN ('admin', 'service_centre')
  )
  OR
  -- Assigned technician can update their own repair's requests
  EXISTS (
    SELECT 1 FROM public.repair_requests rr
    JOIN public.profiles p ON (p.auth_user_id = auth.uid() OR p.id = auth.uid())
    WHERE rr.id = service_centre_part_requests.repair_request_id
      AND rr.technician_id = p.id
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE (p.auth_user_id = auth.uid() OR p.id = auth.uid())
      AND p.role IN ('admin', 'service_centre')
  )
  OR
  EXISTS (
    SELECT 1 FROM public.repair_requests rr
    JOIN public.profiles p ON (p.auth_user_id = auth.uid() OR p.id = auth.uid())
    WHERE rr.id = service_centre_part_requests.repair_request_id
      AND rr.technician_id = p.id
  )
);

-- 4. ATOMIC ETA UPDATE RPC
CREATE OR REPLACE FUNCTION public.update_service_centre_part_request_eta(
  p_request_id uuid,
  p_estimated_arrival_at timestamptz,
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
  v_caller_name text;
  v_request record;
  v_part record;
  v_repair record;
  v_is_authorized boolean := false;
  v_now timestamptz := now();
  v_formatted_eta text;
  v_parts_hold jsonb;
  v_items jsonb;
  v_updated_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_matched boolean := false;
  v_pending_count int := 0;
  v_max_eta text := NULL;
  v_summary_part text;
BEGIN
  -- 1. Validate caller identity and role
  SELECT id, role, full_name INTO v_caller_profile_id, v_caller_role, v_caller_name
  FROM public.profiles
  WHERE auth_user_id = auth.uid() OR id = auth.uid();

  IF v_caller_profile_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  -- 2. Fetch part request with row lock
  SELECT * INTO v_request
  FROM public.service_centre_part_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Part requisition not found.' USING ERRCODE = 'P0002';
  END IF;

  -- Cannot update ETA on already handed-off or cancelled parts
  IF v_request.status != 'PENDING' THEN
    RAISE EXCEPTION 'Cannot update ETA: Part request is already %.', v_request.status
      USING ERRCODE = '22000';
  END IF;

  -- 3. Fetch linked repair ticket
  SELECT * INTO v_repair
  FROM public.repair_requests
  WHERE id = v_request.repair_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linked repair request not found.' USING ERRCODE = 'P0002';
  END IF;

  -- 4. Authorize: Must be Service Centre admin OR assigned technician
  IF v_caller_role = 'admin' THEN
    v_is_authorized := true;
  ELSIF v_caller_role = 'technician' AND v_repair.technician_id = v_caller_profile_id THEN
    v_is_authorized := true;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Unauthorized: Only the assigned technician or Service Centre staff can coordinate part ETA.'
      USING ERRCODE = '42501';
  END IF;

  -- 5. Fetch catalog part info
  SELECT * INTO v_part
  FROM public.service_centre_parts
  WHERE id = v_request.part_id;

  -- Format ETA for human display
  IF p_estimated_arrival_at IS NOT NULL THEN
    v_formatted_eta := to_char(p_estimated_arrival_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH24:MI');
  ELSE
    v_formatted_eta := 'ETA pending';
  END IF;

  -- 6. Update service_centre_part_requests record
  UPDATE public.service_centre_part_requests
  SET
    estimated_arrival_at = p_estimated_arrival_at,
    eta_updated_by = v_caller_profile_id,
    eta_updated_at = v_now,
    notes = COALESCE(NULLIF(TRIM(p_notes), ''), notes),
    updated_at = v_now
  WHERE id = v_request.id;

  -- 7. Synchronize repair_requests.parts_hold blocker items
  v_parts_hold := COALESCE(v_repair.parts_hold, '{}'::jsonb);
  v_items := COALESCE(v_parts_hold->'items', '[]'::jsonb);

  -- Iterate over items and update matching part blocker
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    IF (v_item->>'id' = v_request.id::text) OR
       (v_item->>'partId' = v_request.part_id::text) OR
       (LOWER(v_item->>'part') = LOWER(COALESCE(v_part.name, ''))) THEN
      v_matched := true;
      v_updated_items := v_updated_items || jsonb_build_array(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(v_item, '{eta}', to_jsonb(v_formatted_eta)),
              '{eta_updated_by}', to_jsonb(v_caller_profile_id::text)
            ),
            '{eta_updated_at}', to_jsonb(to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
          ),
          '{notes}', to_jsonb(COALESCE(NULLIF(TRIM(p_notes), ''), v_item->>'notes', ''))
        )
      );
    ELSE
      v_updated_items := v_updated_items || jsonb_build_array(v_item);
    END IF;
  END LOOP;

  -- If not in items list, append it
  IF NOT v_matched THEN
    v_updated_items := v_updated_items || jsonb_build_array(
      jsonb_build_object(
        'id', v_request.id,
        'part', COALESCE(v_part.name, 'Spare Part'),
        'partId', v_request.part_id,
        'quantity', v_request.quantity,
        'reason', COALESCE(p_notes, 'Waiting for parts delivery'),
        'eta', v_formatted_eta,
        'status', 'PENDING',
        'since', to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'eta_updated_by', v_caller_profile_id::text,
        'eta_updated_at', to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
    );
  END IF;

  -- Compute pending count and overall max ETA
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_updated_items)
  LOOP
    IF v_item->>'status' = 'PENDING' THEN
      v_pending_count := v_pending_count + 1;
      IF v_max_eta IS NULL OR (v_item->>'eta' IS NOT NULL AND v_item->>'eta' != 'ETA pending') THEN
        v_max_eta := v_item->>'eta';
      END IF;
    END IF;
  END LOOP;

  -- Update repair_requests touching updated_at for Realtime broadcast
  UPDATE public.repair_requests
  SET
    parts_hold = jsonb_build_object(
      'part', COALESCE(v_parts_hold->>'part', v_part.name, 'Spare Part'),
      'reason', COALESCE(NULLIF(TRIM(p_notes), ''), v_parts_hold->>'reason', 'Waiting for parts delivery'),
      'eta', COALESCE(v_max_eta, v_formatted_eta),
      'note', COALESCE(NULLIF(TRIM(p_notes), ''), v_parts_hold->>'note', ''),
      'revisedCompletion', COALESCE(v_max_eta, v_formatted_eta),
      'since', COALESCE(v_parts_hold->>'since', to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
      'items', v_updated_items,
      'allPartsArrived', (v_pending_count = 0),
      'updated_at', to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),
    updated_at = v_now
  WHERE id = v_repair.id;

  -- 8. Add immutable audit entry to repair_timeline
  INSERT INTO public.repair_timeline (
    repair_request_id,
    created_by_id,
    created_by_role,
    status,
    note
  ) VALUES (
    v_repair.id,
    v_caller_profile_id,
    v_caller_role,
    'WAITING_FOR_PARTS',
    'Part ETA updated for ' || COALESCE(v_part.name, 'spare part') || ': ' || v_formatted_eta || ' by ' || COALESCE(v_caller_name, 'Staff') || '.'
  );

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_request.id,
    'part_name', COALESCE(v_part.name, 'Spare Part'),
    'estimated_arrival_at', p_estimated_arrival_at,
    'formatted_eta', v_formatted_eta,
    'eta_updated_by', v_caller_profile_id,
    'eta_updated_at', v_now
  );
END;
$$;

-- 5. UPDATE ATOMIC QUOTE RPC TO PERMIT LABOUR-ONLY QUOTES
CREATE OR REPLACE FUNCTION public.create_quote_atomic(
  p_repair_request_id uuid,
  p_labour_description text,
  p_labour_amount numeric,
  p_tax_percent numeric,
  p_estimated_completion text,
  p_warranty_terms text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;
