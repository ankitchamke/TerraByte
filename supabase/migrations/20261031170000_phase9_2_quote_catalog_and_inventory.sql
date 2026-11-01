-- ==============================================================================
-- TerraByte — Phase 9.2: Quote Catalog Linkage, Parts Inventory & Atomic Formulation
-- Migration: 20261031170000_phase9_2_quote_catalog_and_inventory.sql
-- Description: Forward migration ensuring that:
--              1. The Service Centre Parts Desk schema is fully deployed in the remote database:
--                 - service_centre_parts (catalog with scoped unique constraint)
--                 - service_centre_part_requests (technician pickup requisitions)
--                 - service_centre_stock_audit (immutable movements: RECEIVED, ISSUED_TO_REPAIR, RETURNED, ADJUSTMENT)
--                 - service_centre_part_sales (commercial sales against approved quotes)
--              2. quote_items.catalog_part_id is added with FK to service_centre_parts and indexed.
--              3. Safe DELETE policy on public.quotes allowing technicians/admins to clean up
--                 uncommitted orphan quote headers that have 0 items (without weakening one-pending rule).
--              4. Atomic RPCs public.create_quote_atomic and public.revise_quote_atomic that wrap
--                 quote formulation, item batch persistence, repair status advancement to QUOTE_PENDING,
--                 timeline recording, and farmer notification in a single atomic transaction.
--              5. Fully compliant with PostgreSQL safeupdate and strict RLS.
-- ==============================================================================

-- 1. SERVICE CENTRE PARTS CATALOG & INVENTORY TABLE
CREATE TABLE IF NOT EXISTS public.service_centre_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_centre_id uuid REFERENCES public.profiles(id) DEFAULT '00000000-0000-0000-0003-000000000001'::uuid,
  part_number text NOT NULL,
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

-- Compound uniqueness scoped by service_centre_id + part_number
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
  movement_type text NOT NULL DEFAULT 'ADJUSTMENT' CHECK (movement_type IN ('RECEIVED', 'ISSUED_TO_REPAIR', 'RETURNED', 'ADJUSTMENT')),
  changed_by uuid NOT NULL REFERENCES public.profiles(id),
  repair_request_id uuid REFERENCES public.repair_requests(id) ON DELETE SET NULL,
  part_request_id uuid REFERENCES public.service_centre_part_requests(id) ON DELETE SET NULL,
  quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  quote_item_id uuid REFERENCES public.quote_items(id) ON DELETE SET NULL,
  unit_price numeric CHECK (unit_price IS NULL OR unit_price >= 0),
  total_value numeric CHECK (total_value IS NULL OR total_value >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4. DURABLE REPAIR SALES TABLE
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

-- 5. LINK CATALOG PARTS TO QUOTE ITEMS (PHASE 9.2 COLUMN)
ALTER TABLE public.quote_items 
  ADD COLUMN IF NOT EXISTS catalog_part_id uuid REFERENCES public.service_centre_parts(id) ON DELETE SET NULL;

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_quote_items_catalog_part_id 
  ON public.quote_items(catalog_part_id);

CREATE INDEX IF NOT EXISTS idx_sc_part_requests_repair_id 
  ON public.service_centre_part_requests(repair_request_id);

CREATE INDEX IF NOT EXISTS idx_sc_part_requests_status 
  ON public.service_centre_part_requests(status);

CREATE INDEX IF NOT EXISTS idx_sc_stock_audit_part_id 
  ON public.service_centre_stock_audit(part_id);

CREATE INDEX IF NOT EXISTS idx_sc_stock_audit_created_at 
  ON public.service_centre_stock_audit(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sc_sales_part_id 
  ON public.service_centre_part_sales(part_id);

CREATE INDEX IF NOT EXISTS idx_sc_sales_repair_id 
  ON public.service_centre_part_sales(repair_request_id);

CREATE INDEX IF NOT EXISTS idx_sc_sales_quote_id 
  ON public.service_centre_part_sales(quote_id);

-- 6. ENABLE ROW LEVEL SECURITY
ALTER TABLE public.service_centre_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_centre_part_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_centre_stock_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_centre_part_sales ENABLE ROW LEVEL SECURITY;

-- 7. RLS POLICIES FOR service_centre_parts
DROP POLICY IF EXISTS "Staff and technicians can view parts catalog" ON public.service_centre_parts;
CREATE POLICY "Staff and technicians can view parts catalog"
ON public.service_centre_parts
FOR SELECT
TO authenticated
USING (public.current_user_role() IN ('admin', 'technician'));

DROP POLICY IF EXISTS "Admins can manage parts catalog" ON public.service_centre_parts;
CREATE POLICY "Admins can manage parts catalog"
ON public.service_centre_parts
FOR ALL
TO authenticated
USING (public.current_user_role() = 'admin')
WITH CHECK (public.current_user_role() = 'admin');

-- 8. RLS POLICIES FOR service_centre_part_requests
DROP POLICY IF EXISTS "Admins can view all part requests" ON public.service_centre_part_requests;
CREATE POLICY "Admins can view all part requests"
ON public.service_centre_part_requests
FOR SELECT
TO authenticated
USING (public.current_user_role() = 'admin');

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

DROP POLICY IF EXISTS "Technicians can request parts for their assigned repairs" ON public.service_centre_part_requests;
CREATE POLICY "Technicians can request parts for their assigned repairs"
ON public.service_centre_part_requests
FOR INSERT
TO authenticated
WITH CHECK (
  (public.current_user_role() = 'technician' AND requested_by = public.current_profile_id() AND EXISTS (
    SELECT 1 FROM public.repair_requests r
    WHERE r.id = repair_request_id
      AND r.technician_id = public.current_profile_id()
      AND r.status NOT IN ('COMPLETED', 'CANCELLED')
  ))
  OR public.current_user_role() = 'admin'
);

DROP POLICY IF EXISTS "Admins can manage part requests" ON public.service_centre_part_requests;
CREATE POLICY "Admins can manage part requests"
ON public.service_centre_part_requests
FOR ALL
TO authenticated
USING (public.current_user_role() = 'admin')
WITH CHECK (public.current_user_role() = 'admin');

-- 9. RLS POLICIES FOR service_centre_stock_audit
DROP POLICY IF EXISTS "Admins can view stock audit log" ON public.service_centre_stock_audit;
CREATE POLICY "Admins can view stock audit log"
ON public.service_centre_stock_audit
FOR SELECT
TO authenticated
USING (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "Admins can insert stock audit log" ON public.service_centre_stock_audit;
CREATE POLICY "Admins can insert stock audit log"
ON public.service_centre_stock_audit
FOR INSERT
TO authenticated
WITH CHECK (public.current_user_role() = 'admin');

-- 10. RLS POLICIES FOR service_centre_part_sales
DROP POLICY IF EXISTS "Admins can view and manage part sales" ON public.service_centre_part_sales;
CREATE POLICY "Admins can view and manage part sales"
ON public.service_centre_part_sales
FOR ALL
TO authenticated
USING (public.current_user_role() = 'admin')
WITH CHECK (public.current_user_role() = 'admin');

-- 11. RLS POLICY FOR RECOVERING/DELETING UNCOMMITTED ORPHAN QUOTES
DROP POLICY IF EXISTS "Technicians can delete orphan quotes" ON public.quotes;
CREATE POLICY "Technicians can delete orphan quotes"
ON public.quotes
FOR DELETE
TO authenticated
USING (
  (
    (technician_id = public.current_profile_id() AND public.current_user_role() = 'technician')
    OR public.current_user_role() = 'admin'
  )
  AND status = 'PENDING'
  AND NOT EXISTS (
    SELECT 1 FROM public.quote_items qi WHERE qi.quote_id = quotes.id
  )
);

-- 12. SEED CANONICAL NAGPUR PARTS BASELINE IF NOT PRESENT
INSERT INTO public.service_centre_parts (
  service_centre_id, part_number, name, spec, category,
  compatible_models, stock_quantity, unit_price, location
) VALUES
  ('00000000-0000-0000-0003-000000000001'::uuid, '0433171', 'Fuel Injector Nozzle Set', 'Bosch 0433171 (x4)', 'Fuel system', ARRAY['Mahindra 575 DI'], 3, 2200, 'Depot Shelf A-02'),
  ('00000000-0000-0000-0003-000000000001'::uuid, '005556958R1', 'Inline Fuel Filter', 'Mahindra 005556958R1', 'Fuel system', ARRAY['Mahindra 575 DI'], 8, 350, 'Depot Shelf A-03'),
  ('00000000-0000-0000-0003-000000000001'::uuid, 'AL120788', 'Lift Cylinder Seal Kit', 'JD AL120788', 'Hydraulics', ARRAY['John Deere 5050D'], 2, 1650, 'Depot Shelf B-01'),
  ('00000000-0000-0000-0003-000000000001'::uuid, 'HY-GARD-15W30', 'Hydraulic Oil 15W-30', 'JD Hy-Gard, litres', 'Hydraulics', ARRAY['John Deere 5050D'], 5, 320, 'Depot Drum Rack B-04'),
  ('00000000-0000-0000-0003-000000000001'::uuid, '26243171', 'Starter Motor Assembly', 'Lucas-TVS 12V 2.2kW', 'Electrical', ARRAY['Mahindra 575 DI', 'Swaraj 744 FE'], 1, 5800, 'Depot Shelf C-01')
ON CONFLICT (service_centre_id, part_number) DO NOTHING;

-- 13. ATOMIC QUOTE CREATION RPC
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
  v_item_count int := 0;
  v_parts_total numeric := 0;
  v_tax_amount numeric := 0;
  v_total_amount numeric := 0;
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
  SELECT id, job_number, farmer_id, technician_id, status INTO v_repair
  FROM public.repair_requests
  WHERE id = p_repair_request_id
  FOR UPDATE;

  IF v_repair.id IS NULL THEN
    RAISE EXCEPTION 'Repair request % not found or inaccessible.', p_repair_request_id;
  END IF;

  IF v_caller_role = 'technician' AND v_repair.technician_id <> v_caller_id THEN
    RAISE EXCEPTION 'Unauthorized: You are not assigned to this repair ticket.' USING ERRCODE = '42501';
  END IF;

  IF v_repair.status NOT IN ('ACCEPTED', 'REQUESTED', 'QUOTE_REVISED') THEN
    RAISE EXCEPTION 'Cannot create quote: Repair ticket is in % status.', v_repair.status;
  END IF;

  -- 3. One-pending-quote enforcement: Clean up any 0-item orphan quote or reject collision
  FOR v_existing_quote IN
    SELECT q.id, count(qi.id) AS item_count
    FROM public.quotes q
    LEFT JOIN public.quote_items qi ON qi.quote_id = q.id
    WHERE q.repair_request_id = p_repair_request_id
      AND q.status = 'PENDING'
    GROUP BY q.id
  LOOP
    IF v_existing_quote.item_count > 0 THEN
      RAISE EXCEPTION 'Cannot create quote: A pending quote already exists for this repair. Wait for the farmer to respond or request changes.';
    ELSE
      -- Clean up empty orphan quote
      DELETE FROM public.quotes WHERE id = v_existing_quote.id;
    END IF;
  END LOOP;

  -- 4. Validate items array
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Quote must contain at least one itemized part or supply.';
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

  -- 6. Insert quote items
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
    IF v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'Quantity must be greater than 0 for item %.', v_item.part_name;
    END IF;
    IF v_item.unit_price IS NULL OR v_item.unit_price < 0 THEN
      RAISE EXCEPTION 'Unit price must be non-negative for item %.', v_item.part_name;
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
    v_item_count := v_item_count + 1;
    v_inserted_items := v_inserted_items || to_jsonb(v_item_row);
  END LOOP;

  -- Calculate totals
  v_tax_amount := round((v_parts_total + p_labour_amount) * (p_tax_percent / 100.0), 2);
  v_total_amount := round(v_parts_total + p_labour_amount + v_tax_amount, 2);

  -- 7. Advance repair request status to QUOTE_PENDING
  UPDATE public.repair_requests
  SET status = 'QUOTE_PENDING',
      clarification_note = NULL,
      status_since = v_now,
      updated_at = v_now
  WHERE id = v_repair.id;

  -- 8. Record timeline event
  INSERT INTO public.repair_timeline (
    repair_request_id, status, note, created_by_role, created_by_id, created_at
  ) VALUES (
    v_repair.id, 'QUOTE_PENDING',
    'Quote formulated & sent (v1: ₹' || v_total_amount::text || ')',
    v_caller_role::text, v_caller_id, v_now
  );

  -- 9. Notify farmer
  INSERT INTO public.notifications (
    recipient_role, recipient_user_id, notification_text, link_target, is_read, created_at
  ) VALUES (
    'farmer'::user_role, v_repair.farmer_id,
    'Quote ready for repair ' || v_repair.job_number || '. Review and approve the proposed repair.',
    '/farmer/repair/' || v_repair.id::text, false, v_now
  );

  -- 10. Return complete structured quote
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

-- 14. ATOMIC QUOTE REVISION RPC
CREATE OR REPLACE FUNCTION public.revise_quote_atomic(
  p_previous_quote_id uuid,
  p_repair_request_id uuid,
  p_labour_description text,
  p_labour_amount numeric,
  p_tax_percent numeric,
  p_estimated_completion text,
  p_warranty_terms text,
  p_technician_explanation text,
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
  v_prev_quote record;
  v_quote_id uuid;
  v_new_version int;
  v_now timestamptz := now();
  v_item record;
  v_parts_total numeric := 0;
  v_tax_amount numeric := 0;
  v_total_amount numeric := 0;
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

  -- 7. Advance repair status to QUOTE_PENDING and clear clarification_note
  UPDATE public.repair_requests
  SET status = 'QUOTE_PENDING',
      clarification_note = NULL,
      status_since = v_now,
      updated_at = v_now
  WHERE id = v_repair.id;

  -- 8. Record timeline event
  INSERT INTO public.repair_timeline (
    repair_request_id, status, note, created_by_role, created_by_id, created_at
  ) VALUES (
    v_repair.id, 'QUOTE_PENDING',
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
    'Revised quote ready for repair ' || v_repair.job_number || ' (v' || v_new_version::text || '). Review the updated quote.',
    '/farmer/repair/' || v_repair.id::text, false, v_now
  );

  RETURN jsonb_build_object(
    'id', v_quote_id,
    'repair_request_id', v_repair.id,
    'technician_id', v_caller_id,
    'version', v_new_version,
    'status', 'PENDING',
    'sent_at', v_now,
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
