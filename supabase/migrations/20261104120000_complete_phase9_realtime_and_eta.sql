-- ==============================================================================
-- TerraByte — Phase 9 Realtime, ETA & Quote System Completion
-- Migration: 20261104120000_complete_phase9_realtime_and_eta.sql
-- Description: Registers missing parts tables in supabase_realtime publication,
--              configures minimal REPLICA IDENTITY FULL on quotes and part requests,
--              adds item-level ETA tracking columns and atomic update RPC, and deploys
--              updated create_quote_atomic and revise_quote_atomic with mandatory NULL-safe
--              authorization checks, WAITING_FOR_PARTS preservation, and labour-only quote support.
-- ==============================================================================

-- 1. REALTIME PUBLICATIONS
-- Register 5 parts tables into supabase_realtime publication idempotently
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  -- 1. public.service_centre_parts
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'service_centre_parts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.service_centre_parts;
  END IF;

  -- 2. public.service_centre_part_requests
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'service_centre_part_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.service_centre_part_requests;
  END IF;

  -- 3. public.service_centre_stock_audit
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'service_centre_stock_audit'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.service_centre_stock_audit;
  END IF;

  -- 4. public.service_centre_part_sales
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'service_centre_part_sales'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.service_centre_part_sales;
  END IF;

  -- 5. public.quote_items
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'quote_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.quote_items;
  END IF;
END $$;

-- 2. MINIMAL REPLICA IDENTITY SCOPE
-- Enable FULL strictly on tables requiring old_record non-PK filters (repair_request_id=eq.${cleanId})
-- All other tables (repair_requests, service_centre_parts, service_centre_stock_audit,
-- service_centre_part_sales, quote_items) remain on DEFAULT replica identity to eliminate WAL amplification.
ALTER TABLE public.quotes REPLICA IDENTITY FULL;
ALTER TABLE public.service_centre_part_requests REPLICA IDENTITY FULL;

-- 3. ITEM-LEVEL ETA TRACKING COLUMNS & INDEX
ALTER TABLE public.service_centre_part_requests
  ADD COLUMN IF NOT EXISTS estimated_arrival_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS eta_updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL NULL,
  ADD COLUMN IF NOT EXISTS eta_updated_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_sc_part_requests_estimated_arrival
  ON public.service_centre_part_requests(estimated_arrival_at);

-- 4. RLS POLICIES & INTEGRITY FOR ETA COORDINATION
DROP POLICY IF EXISTS "Assigned technicians or admins can update part request ETA" ON public.service_centre_part_requests;
DROP POLICY IF EXISTS "Technicians can update ETA on assigned repair part requests" ON public.service_centre_part_requests;
DROP POLICY IF EXISTS "Assigned technicians can update part request ETA" ON public.service_centre_part_requests;

CREATE POLICY "Assigned technicians or admins can update part request ETA"
ON public.service_centre_part_requests
FOR UPDATE
TO authenticated
USING (
  current_user_role() = 'admin'::user_role
  OR (
    current_user_role() = 'technician'::user_role
    AND status = 'PENDING'
    AND EXISTS (
      SELECT 1 FROM public.repair_requests rr
      WHERE rr.id = service_centre_part_requests.repair_request_id
        AND rr.technician_id = current_profile_id()
    )
  )
)
WITH CHECK (
  current_user_role() = 'admin'::user_role
  OR (
    current_user_role() = 'technician'::user_role
    AND status = 'PENDING'
    AND EXISTS (
      SELECT 1 FROM public.repair_requests rr
      WHERE rr.id = service_centre_part_requests.repair_request_id
        AND rr.technician_id = current_profile_id()
    )
  )
);

-- Integrity trigger: strictly prevents technicians from altering requisition quantity, part, status, handoff columns,
-- primary key, or creation timestamps, and prevents technicians from spoofing or directly modifying eta_updated_by,
-- eta_updated_at, or updated_at metadata.
-- Enforces technician assignment to the linked repair ticket and PENDING requisition status.
-- For administrators, authoritatively records the administrator profile and current timestamp on ETA/notes updates,
-- prevents arbitrary administrator metadata spoofing, and preserves legitimate business modifications (e.g. quantity, status).
-- Restricts privileged maintenance bypass strictly to verified service-role JWT contexts or direct database maintenance sessions.
CREATE OR REPLACE FUNCTION public.trg_enforce_technician_part_request_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role public.user_role;
  v_caller_id uuid;
  v_active_role text;
  v_jwt_role text;
  v_session_user text;
  v_is_service_role boolean := false;
  v_is_direct_maintenance boolean := false;
BEGIN
  v_role := public.current_user_role();
  v_caller_id := public.current_profile_id();
  v_active_role := current_setting('role', true);
  v_jwt_role := auth.jwt()->>'role';
  v_session_user := SESSION_USER;

  -- 1. Verified service-role JWT context:
  -- Server-side background jobs / Edge Functions executing with verified service_role JWT
  IF (v_jwt_role = 'service_role' AND v_active_role = 'service_role') OR
     (v_jwt_role = 'service_role' AND v_session_user = 'service_role') THEN
    v_is_service_role := true;
  END IF;

  -- 2. Direct database maintenance session:
  -- Direct superuser / migration connections without client JWT context
  IF v_session_user IN ('postgres', 'supabase_admin') AND
     v_active_role IN ('none', 'postgres', 'supabase_admin') AND
     auth.uid() IS NULL AND
     v_jwt_role IS NULL THEN
    v_is_direct_maintenance := true;
  END IF;

  -- 3. PRIVILEGED SERVER-SIDE MAINTENANCE / SERVICE-ROLE PATH
  IF (v_is_service_role OR v_is_direct_maintenance) AND v_role IS NULL THEN
    IF NEW.estimated_arrival_at IS DISTINCT FROM OLD.estimated_arrival_at OR
       NEW.notes IS DISTINCT FROM OLD.notes THEN
      IF NEW.eta_updated_by IS NOT DISTINCT FROM OLD.eta_updated_by THEN
        NEW.eta_updated_by := COALESCE(v_caller_id, OLD.eta_updated_by);
      END IF;
      IF NEW.eta_updated_at IS NOT DISTINCT FROM OLD.eta_updated_at THEN
        NEW.eta_updated_at := now();
      END IF;
    END IF;

    IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
      NEW.updated_at := now();
    END IF;

    RETURN NEW;
  END IF;

  -- 4. ADMINISTRATOR CLIENT PATH
  IF v_role = 'admin'::public.user_role THEN
    -- If administrator is updating ETA or notes:
    IF NEW.estimated_arrival_at IS DISTINCT FROM OLD.estimated_arrival_at OR
       NEW.notes IS DISTINCT FROM OLD.notes THEN
      -- Prevent arbitrary metadata spoofing:
      -- If admin explicitly supplied an eta_updated_by that is NOT their own profile ID, reject spoofing
      IF NEW.eta_updated_by IS DISTINCT FROM OLD.eta_updated_by AND
         NEW.eta_updated_by IS DISTINCT FROM v_caller_id THEN
        RAISE EXCEPTION 'Unauthorized: Administrators cannot spoof audit identity (eta_updated_by).'
          USING ERRCODE = '42501';
      END IF;

      -- If admin explicitly supplied an eta_updated_at different from current time, reject timestamp forgery
      IF NEW.eta_updated_at IS DISTINCT FROM OLD.eta_updated_at AND
         NEW.eta_updated_at IS DISTINCT FROM now() THEN
        RAISE EXCEPTION 'Unauthorized: eta_updated_at timestamp is system-managed and cannot be manually overridden.'
          USING ERRCODE = '42501';
      END IF;

      -- Authoritatively stamp metadata with actual admin profile and current timestamp
      NEW.eta_updated_by := v_caller_id;
      NEW.eta_updated_at := now();
      NEW.updated_at := now();
    ELSE
      -- When NOT updating ETA/notes, prevent direct mutation of eta_updated_* metadata
      IF NEW.eta_updated_by IS DISTINCT FROM OLD.eta_updated_by OR
         NEW.eta_updated_at IS DISTINCT FROM OLD.eta_updated_at THEN
        RAISE EXCEPTION 'Unauthorized: Cannot modify eta_updated_* metadata when not updating ETA or notes.'
          USING ERRCODE = '42501';
      END IF;

      -- Preserves legitimate admin updates to business fields (quantity, status, etc.)
      IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
        NEW.updated_at := now();
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  -- 5. TECHNICIAN CLIENT PATH
  IF v_role = 'technician'::public.user_role THEN
    -- Verify requisition status is PENDING
    IF OLD.status != 'PENDING' THEN
      RAISE EXCEPTION 'Cannot update ETA: Part request is already %.', OLD.status
        USING ERRCODE = '22000';
    END IF;

    -- Verify technician is assigned to this repair
    IF NOT EXISTS (
      SELECT 1 FROM public.repair_requests rr
      WHERE rr.id = OLD.repair_request_id
        AND rr.technician_id = v_caller_id
    ) THEN
      RAISE EXCEPTION 'Unauthorized: Only the assigned technician or Service Centre staff can coordinate part ETA.'
        USING ERRCODE = '42501';
    END IF;

    -- Prevent alteration of core requisition attributes or primary key/creation audit
    IF NEW.id IS DISTINCT FROM OLD.id OR
       NEW.repair_request_id IS DISTINCT FROM OLD.repair_request_id OR
       NEW.part_id IS DISTINCT FROM OLD.part_id OR
       NEW.quantity IS DISTINCT FROM OLD.quantity OR
       NEW.status IS DISTINCT FROM OLD.status OR
       NEW.requested_by IS DISTINCT FROM OLD.requested_by OR
       NEW.handed_off_by IS DISTINCT FROM OLD.handed_off_by OR
       NEW.handed_off_at IS DISTINCT FROM OLD.handed_off_at OR
       NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Unauthorized: Technicians can only coordinate part ETA and notes, and cannot modify requisition quantity, part, or status.'
        USING ERRCODE = '42501';
    END IF;

    -- Prevent direct manipulation of audit/metadata columns
    IF NEW.eta_updated_by IS DISTINCT FROM OLD.eta_updated_by OR
       NEW.eta_updated_at IS DISTINCT FROM OLD.eta_updated_at OR
       NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
      RAISE EXCEPTION 'Unauthorized: Technicians cannot directly modify eta_updated_by, eta_updated_at, or updated_at metadata.'
        USING ERRCODE = '42501';
    END IF;

    -- On legitimate ETA or notes update, stamp metadata authoritatively
    IF NEW.estimated_arrival_at IS DISTINCT FROM OLD.estimated_arrival_at OR
       NEW.notes IS DISTINCT FROM OLD.notes THEN
      NEW.eta_updated_by := v_caller_id;
      NEW.eta_updated_at := now();
      NEW.updated_at := now();
    END IF;

    RETURN NEW;
  END IF;

  -- 6. ALL OTHER ROLES OR UNAUTHENTICATED CALLERS ARE REJECTED
  RAISE EXCEPTION 'Unauthorized: Caller with role % cannot update service_centre_part_requests.', COALESCE(v_role::text, 'none')
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_technician_part_request_fields ON public.service_centre_part_requests;
CREATE TRIGGER trg_protect_technician_part_request_fields
BEFORE UPDATE ON public.service_centre_part_requests
FOR EACH ROW
EXECUTE FUNCTION public.trg_enforce_technician_part_request_fields();

-- 5. ATOMIC ETA UPDATE RPC
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
  v_overall_eta_str text;
  v_latest_pending_eta timestamptz;
  v_parts_hold jsonb;
  v_items jsonb;
  v_updated_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_matched boolean := false;
  v_pending_count int := 0;
BEGIN
  -- 1. Caller verification
  SELECT id, role, full_name INTO v_caller_profile_id, v_caller_role, v_caller_name
  FROM public.profiles
  WHERE auth_user_id = auth.uid() 
     OR id = auth.uid()
     OR (clerk_user_id IS NOT NULL AND clerk_user_id = auth.jwt()->>'sub')
  LIMIT 1;

  IF v_caller_profile_id IS NULL THEN
    v_caller_profile_id := public.current_profile_id();
    v_caller_role := public.current_user_role();
  END IF;

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

  IF v_request.status != 'PENDING' THEN
    RAISE EXCEPTION 'Cannot update ETA: Part request is already %.', v_request.status
      USING ERRCODE = '22000';
  END IF;

  -- 3. Fetch linked repair ticket with row lock
  SELECT * INTO v_repair
  FROM public.repair_requests
  WHERE id = v_request.repair_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linked repair request not found.' USING ERRCODE = 'P0002';
  END IF;

  -- 4. Authorize: Admin OR assigned technician (NULL-safe check)
  IF v_caller_role = 'admin' THEN
    v_is_authorized := true;
  ELSIF v_caller_role = 'technician' AND v_repair.technician_id IS NOT DISTINCT FROM v_caller_profile_id THEN
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

  IF p_estimated_arrival_at IS NOT NULL THEN
    v_formatted_eta := to_char(p_estimated_arrival_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH24:MI');
  ELSE
    v_formatted_eta := 'ETA pending';
  END IF;

  -- 6. Update requisition row
  -- The trigger authoritatively stamps eta_updated_by, eta_updated_at, and updated_at
  UPDATE public.service_centre_part_requests
  SET
    estimated_arrival_at = p_estimated_arrival_at,
    notes = COALESCE(NULLIF(TRIM(p_notes), ''), notes)
  WHERE id = v_request.id;

  -- 7. Validate and synchronize repair_requests.parts_hold blocker items
  v_parts_hold := COALESCE(v_repair.parts_hold, '{}'::jsonb);
  IF jsonb_typeof(v_parts_hold) <> 'object' THEN
    v_parts_hold := '{}'::jsonb;
  END IF;

  v_items := COALESCE(v_parts_hold->'items', '[]'::jsonb);
  IF jsonb_typeof(v_items) <> 'array' THEN
    v_items := '[]'::jsonb;
  END IF;

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

  -- 8. Authoritative ETA aggregation across pending requests (comparing timestamptz)
  SELECT MAX(estimated_arrival_at), COUNT(*)
  INTO v_latest_pending_eta, v_pending_count
  FROM public.service_centre_part_requests
  WHERE repair_request_id = v_repair.id
    AND status = 'PENDING';

  IF v_latest_pending_eta IS NOT NULL THEN
    v_overall_eta_str := to_char(v_latest_pending_eta AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH24:MI');
  ELSIF p_estimated_arrival_at IS NOT NULL THEN
    v_overall_eta_str := v_formatted_eta;
  ELSE
    v_overall_eta_str := 'ETA pending';
  END IF;

  -- Check if any updated items in parts_hold are pending
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_updated_items)
  LOOP
    IF COALESCE(v_item->>'status', 'PENDING') = 'PENDING' AND v_pending_count = 0 THEN
      v_pending_count := 1;
    END IF;
  END LOOP;

  UPDATE public.repair_requests
  SET
    parts_hold = jsonb_build_object(
      'part', COALESCE(v_parts_hold->>'part', v_part.name, 'Spare Part'),
      'reason', COALESCE(NULLIF(TRIM(p_notes), ''), v_parts_hold->>'reason', 'Waiting for parts delivery'),
      'eta', v_overall_eta_str,
      'note', COALESCE(NULLIF(TRIM(p_notes), ''), v_parts_hold->>'note', ''),
      'revisedCompletion', v_overall_eta_str,
      'since', COALESCE(v_parts_hold->>'since', to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
      'items', v_updated_items,
      'allPartsArrived', (v_pending_count = 0),
      'updated_at', to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),
    updated_at = v_now
  WHERE id = v_repair.id;

  INSERT INTO public.repair_timeline (
    repair_request_id,
    created_by_id,
    created_by_role,
    status,
    note
  ) VALUES (
    v_repair.id,
    v_caller_profile_id,
    v_caller_role::text,
    'WAITING_FOR_PARTS',
    'Part ETA updated for ' || COALESCE(v_part.name, 'spare part') || ': ' || v_formatted_eta || ' by ' || COALESCE(v_caller_name, 'Staff') || '.'
  );

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_request.id,
    'part_name', COALESCE(v_part.name, 'Spare Part'),
    'estimated_arrival_at', p_estimated_arrival_at,
    'formatted_eta', v_formatted_eta,
    'overall_eta', v_overall_eta_str,
    'eta_updated_by', v_caller_profile_id,
    'eta_updated_at', v_now
  );
END;
$$;

-- 6. ATOMIC CREATE QUOTE RPC (NULL-SAFE ASSIGNMENT, WAITING_FOR_PARTS PRESERVATION, LABOUR-ONLY SUPPORT)
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
  v_has_pending_req boolean := false;
  v_has_pending_hold_item boolean := false;
  v_all_arrived boolean := false;
  v_is_malformed_hold boolean := false;
  v_is_hold_active boolean := false;
  v_inserted_items jsonb := '[]'::jsonb;
  v_item_row record;
BEGIN
  -- 1. Input validation
  IF p_labour_amount IS NULL OR p_labour_amount < 0 THEN
    RAISE EXCEPTION 'Labour amount must be non-negative.' USING ERRCODE = '22003';
  END IF;

  IF p_tax_percent IS NULL OR p_tax_percent < 0 OR p_tax_percent > 100 THEN
    RAISE EXCEPTION 'Tax percent must be between 0 and 100.' USING ERRCODE = '22003';
  END IF;

  IF p_items IS NOT NULL AND jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Quote items must be a JSON array.' USING ERRCODE = '22023';
  END IF;

  -- 2. Caller verification
  SELECT id, role INTO v_caller_id, v_caller_role
  FROM public.profiles
  WHERE auth_user_id = auth.uid() 
     OR id = auth.uid()
     OR (clerk_user_id IS NOT NULL AND clerk_user_id = auth.jwt()->>'sub')
  LIMIT 1;

  IF v_caller_id IS NULL THEN
    v_caller_id := public.current_profile_id();
    v_caller_role := public.current_user_role();
  END IF;

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required: User profile not found.' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('technician', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: Only technicians or administrators can formulate repair quotes.' USING ERRCODE = '42501';
  END IF;

  -- 3. Verify repair request eligibility & assignment (FOR UPDATE lock)
  SELECT id, job_number, farmer_id, technician_id, status, parts_hold INTO v_repair
  FROM public.repair_requests
  WHERE id = p_repair_request_id
  FOR UPDATE;

  IF v_repair.id IS NULL THEN
    RAISE EXCEPTION 'Repair request % not found or inaccessible.', p_repair_request_id;
  END IF;

  -- Mandatory NULL-safe authorization check: technician must be explicitly assigned to this ticket
  IF v_caller_role = 'technician' AND v_repair.technician_id IS DISTINCT FROM v_caller_id THEN
    RAISE EXCEPTION 'Unauthorized: You are not assigned to this repair ticket.' USING ERRCODE = '42501';
  END IF;

  -- Authoritative active parts-hold verification with safe boolean/type parsing
  v_has_pending_req := EXISTS (
    SELECT 1 FROM public.service_centre_part_requests scpr
    WHERE scpr.repair_request_id = v_repair.id AND scpr.status = 'PENDING'
  );

  v_has_pending_hold_item := false;
  IF v_repair.parts_hold IS NOT NULL AND jsonb_typeof(v_repair.parts_hold) = 'object' THEN
    v_all_arrived := false;
    v_is_malformed_hold := false;

    IF v_repair.parts_hold ? 'allPartsArrived' THEN
      IF jsonb_typeof(v_repair.parts_hold->'allPartsArrived') = 'boolean' THEN
        v_all_arrived := (v_repair.parts_hold->'allPartsArrived')::boolean;
      ELSIF jsonb_typeof(v_repair.parts_hold->'allPartsArrived') = 'string' THEN
        IF lower(v_repair.parts_hold->>'allPartsArrived') IN ('true', 't', '1') THEN
          v_all_arrived := true;
        ELSIF lower(v_repair.parts_hold->>'allPartsArrived') IN ('false', 'f', '0') THEN
          v_all_arrived := false;
        ELSE
          v_is_malformed_hold := true;
        END IF;
      ELSIF jsonb_typeof(v_repair.parts_hold->'allPartsArrived') = 'number' THEN
        IF (v_repair.parts_hold->>'allPartsArrived')::numeric = 1 THEN
          v_all_arrived := true;
        ELSIF (v_repair.parts_hold->>'allPartsArrived')::numeric = 0 THEN
          v_all_arrived := false;
        ELSE
          v_is_malformed_hold := true;
        END IF;
      ELSE
        v_is_malformed_hold := true;
      END IF;
    END IF;

    -- Only consider hold active if allPartsArrived is false and hold payload is well-formed
    IF v_all_arrived = false AND NOT v_is_malformed_hold THEN
      IF v_repair.parts_hold ? 'items' AND jsonb_typeof(v_repair.parts_hold->'items') = 'array' THEN
        SELECT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_repair.parts_hold->'items') elem
          WHERE elem->>'status' = 'PENDING'
        ) INTO v_has_pending_hold_item;
      ELSIF v_repair.parts_hold ? 'part' AND (v_repair.parts_hold->>'part') IS NOT NULL AND trim(v_repair.parts_hold->>'part') <> '' THEN
        v_has_pending_hold_item := true;
      END IF;
    END IF;
  END IF;

  v_is_hold_active := (v_has_pending_req OR v_has_pending_hold_item);

  -- State machine enforcement
  IF v_repair.status NOT IN ('ACCEPTED', 'REQUESTED', 'QUOTE_REVISED', 'WAITING_FOR_PARTS') THEN
    RAISE EXCEPTION 'Cannot create quote: Repair ticket is in % status.', v_repair.status USING ERRCODE = '22000';
  END IF;

  IF v_repair.status = 'WAITING_FOR_PARTS' AND NOT v_is_hold_active THEN
    RAISE EXCEPTION 'Cannot create quote: Repair ticket is in WAITING_FOR_PARTS status without an active parts hold.' USING ERRCODE = '22023';
  END IF;

  -- 4. One-pending-quote enforcement: Clean up any 0-item, 0-labour orphan quote or reject collision
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

  -- 5. Validate items array or positive labour amount (permits labour-only inspection quotes)
  IF (p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0) 
     AND COALESCE(p_labour_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Quote must contain at least one itemized part or supply, or a valid labour charge.';
  END IF;

  -- 6. Insert quote header (version 1, PENDING)
  INSERT INTO public.quotes (
    repair_request_id, technician_id, labour_description, labour_amount,
    tax_percent, estimated_completion, warranty_terms, version, status, sent_at, created_at, updated_at
  ) VALUES (
    v_repair.id, v_caller_id, trim(p_labour_description), p_labour_amount,
    p_tax_percent, trim(p_estimated_completion), nullif(trim(p_warranty_terms), ''),
    1, 'PENDING', v_now, v_now, v_now
  )
  RETURNING id INTO v_quote_id;

  -- 7. Insert items (if any specified)
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
        RAISE EXCEPTION 'Part name is required for all quote items.' USING ERRCODE = '22023';
      END IF;
      IF v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
        RAISE EXCEPTION 'Quantity must be greater than 0 for item %.', v_item.part_name USING ERRCODE = '22003';
      END IF;
      IF v_item.unit_price IS NULL OR v_item.unit_price < 0 THEN
        RAISE EXCEPTION 'Unit price must be non-negative for item %.', v_item.part_name USING ERRCODE = '22003';
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

  -- 8. Calculate totals
  v_tax_amount := round(((v_parts_total + p_labour_amount) * (p_tax_percent / 100.0)), 2);
  v_total_amount := round((v_parts_total + p_labour_amount + v_tax_amount), 2);

  -- 9. Advance repair status: preserve WAITING_FOR_PARTS strictly if hold is genuinely active
  IF v_repair.status = 'WAITING_FOR_PARTS' AND v_is_hold_active THEN
    v_next_status := 'WAITING_FOR_PARTS';
  ELSE
    v_next_status := 'QUOTE_PENDING';
  END IF;

  UPDATE public.repair_requests
  SET
    status = v_next_status,
    clarification_note = NULL,
    status_since = v_now,
    updated_at = v_now
  WHERE id = v_repair.id;

  -- 10. Timeline event
  INSERT INTO public.repair_timeline (
    repair_request_id, status, note, created_by_role, created_by_id, created_at
  ) VALUES (
    v_repair.id, v_next_status,
    'Quote formulated & sent (v1: ₹' || v_total_amount::text || ')',
    v_caller_role::text, v_caller_id, v_now
  );

  -- 11. Farmer notification
  INSERT INTO public.notifications (
    recipient_role, recipient_user_id, notification_text, link_target, is_read, created_at
  ) VALUES (
    'farmer'::user_role, v_repair.farmer_id,
    'Quote ready for repair ' || v_repair.job_number || '. Review and approve the proposed repair.',
    '/farmer/repair/' || v_repair.id::text, false, v_now
  );

  -- 12. Return complete structured quote
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

-- 7. ATOMIC REVISE QUOTE RPC (NULL-SAFE ASSIGNMENT, WAITING_FOR_PARTS PRESERVATION, LABOUR-ONLY SUPPORT)
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
  v_latest_quote record;
  v_quote_id uuid;
  v_new_version int;
  v_now timestamptz := now();
  v_item record;
  v_parts_total numeric := 0;
  v_tax_amount numeric := 0;
  v_total_amount numeric := 0;
  v_next_status repair_status;
  v_has_pending_req boolean := false;
  v_has_pending_hold_item boolean := false;
  v_all_arrived boolean := false;
  v_is_malformed_hold boolean := false;
  v_is_hold_active boolean := false;
  v_inserted_items jsonb := '[]'::jsonb;
  v_item_row record;
BEGIN
  -- 1. Input validation
  IF p_labour_amount IS NULL OR p_labour_amount < 0 THEN
    RAISE EXCEPTION 'Labour amount must be non-negative.' USING ERRCODE = '22003';
  END IF;

  IF p_tax_percent IS NULL OR p_tax_percent < 0 OR p_tax_percent > 100 THEN
    RAISE EXCEPTION 'Tax percent must be between 0 and 100.' USING ERRCODE = '22003';
  END IF;

  IF p_items IS NOT NULL AND jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Quote items must be a JSON array.' USING ERRCODE = '22023';
  END IF;

  -- 2. Caller verification
  SELECT id, role INTO v_caller_id, v_caller_role
  FROM public.profiles
  WHERE auth_user_id = auth.uid() 
     OR id = auth.uid()
     OR (clerk_user_id IS NOT NULL AND clerk_user_id = auth.jwt()->>'sub')
  LIMIT 1;

  IF v_caller_id IS NULL THEN
    v_caller_id := public.current_profile_id();
    v_caller_role := public.current_user_role();
  END IF;

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required: User profile not found.' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('technician', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: Only technicians or administrators can formulate repair quotes.' USING ERRCODE = '42501';
  END IF;

  -- 3. Fetch and lock previous quote
  SELECT id, version, status, repair_request_id, technician_id INTO v_prev_quote
  FROM public.quotes
  WHERE id = p_previous_quote_id
  FOR UPDATE;

  IF v_prev_quote.id IS NULL THEN
    RAISE EXCEPTION 'Previous quote % not found or inaccessible.', p_previous_quote_id;
  END IF;

  IF v_prev_quote.repair_request_id <> p_repair_request_id THEN
    RAISE EXCEPTION 'Previous quote does not belong to this repair request.' USING ERRCODE = '22023';
  END IF;

  -- Require previous quote to be the latest quote for this repair ticket
  SELECT id, version, status INTO v_latest_quote
  FROM public.quotes
  WHERE repair_request_id = p_repair_request_id
  ORDER BY version DESC
  LIMIT 1
  FOR UPDATE;

  IF v_latest_quote.id IS DISTINCT FROM v_prev_quote.id THEN
    RAISE EXCEPTION 'Cannot revise quote: Quote % is superseded by newer quote version % (quote %).',
      p_previous_quote_id, v_latest_quote.version, v_latest_quote.id
      USING ERRCODE = '22023';
  END IF;

  -- Validate previous quote status: strictly only PENDING quotes can be revised
  IF v_prev_quote.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Cannot revise quote: Previous quote is already % (only PENDING quotes can be revised).', v_prev_quote.status
      USING ERRCODE = '22023';
  END IF;

  v_new_version := v_prev_quote.version + 1;

  -- 4. Verify repair request eligibility & assignment (FOR UPDATE lock)
  SELECT id, job_number, farmer_id, technician_id, status, parts_hold INTO v_repair
  FROM public.repair_requests
  WHERE id = p_repair_request_id
  FOR UPDATE;

  IF v_repair.id IS NULL THEN
    RAISE EXCEPTION 'Repair request % not found.', p_repair_request_id;
  END IF;

  -- Mandatory NULL-safe authorization check: technician must be explicitly assigned to this ticket
  IF v_caller_role = 'technician' AND v_repair.technician_id IS DISTINCT FROM v_caller_id THEN
    RAISE EXCEPTION 'Unauthorized: You are not assigned to this repair ticket.' USING ERRCODE = '42501';
  END IF;

  -- State machine enforcement: repair must be in an eligible state for revision
  IF v_repair.status NOT IN ('ACCEPTED', 'REQUESTED', 'QUOTE_PENDING', 'QUOTE_REVISED', 'WAITING_FOR_PARTS') THEN
    RAISE EXCEPTION 'Cannot revise quote: Repair ticket is in % status.', v_repair.status USING ERRCODE = '22000';
  END IF;

  -- Authoritative active parts-hold verification with safe boolean/type parsing
  v_has_pending_req := EXISTS (
    SELECT 1 FROM public.service_centre_part_requests scpr
    WHERE scpr.repair_request_id = v_repair.id AND scpr.status = 'PENDING'
  );

  v_has_pending_hold_item := false;
  IF v_repair.parts_hold IS NOT NULL AND jsonb_typeof(v_repair.parts_hold) = 'object' THEN
    v_all_arrived := false;
    v_is_malformed_hold := false;

    IF v_repair.parts_hold ? 'allPartsArrived' THEN
      IF jsonb_typeof(v_repair.parts_hold->'allPartsArrived') = 'boolean' THEN
        v_all_arrived := (v_repair.parts_hold->'allPartsArrived')::boolean;
      ELSIF jsonb_typeof(v_repair.parts_hold->'allPartsArrived') = 'string' THEN
        IF lower(v_repair.parts_hold->>'allPartsArrived') IN ('true', 't', '1') THEN
          v_all_arrived := true;
        ELSIF lower(v_repair.parts_hold->>'allPartsArrived') IN ('false', 'f', '0') THEN
          v_all_arrived := false;
        ELSE
          v_is_malformed_hold := true;
        END IF;
      ELSIF jsonb_typeof(v_repair.parts_hold->'allPartsArrived') = 'number' THEN
        IF (v_repair.parts_hold->>'allPartsArrived')::numeric = 1 THEN
          v_all_arrived := true;
        ELSIF (v_repair.parts_hold->>'allPartsArrived')::numeric = 0 THEN
          v_all_arrived := false;
        ELSE
          v_is_malformed_hold := true;
        END IF;
      ELSE
        v_is_malformed_hold := true;
      END IF;
    END IF;

    -- Only consider hold active if allPartsArrived is false and hold payload is well-formed
    IF v_all_arrived = false AND NOT v_is_malformed_hold THEN
      IF v_repair.parts_hold ? 'items' AND jsonb_typeof(v_repair.parts_hold->'items') = 'array' THEN
        SELECT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_repair.parts_hold->'items') elem
          WHERE elem->>'status' = 'PENDING'
        ) INTO v_has_pending_hold_item;
      ELSIF v_repair.parts_hold ? 'part' AND (v_repair.parts_hold->>'part') IS NOT NULL AND trim(v_repair.parts_hold->>'part') <> '' THEN
        v_has_pending_hold_item := true;
      END IF;
    END IF;
  END IF;

  v_is_hold_active := (v_has_pending_req OR v_has_pending_hold_item);

  -- 5. Validate items array or positive labour amount (permits labour-only revised quotes)
  IF (p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0) 
     AND COALESCE(p_labour_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Quote must contain at least one itemized part or supply, or a valid labour charge.';
  END IF;

  -- 6. Mark previous quote as REVISED
  UPDATE public.quotes
  SET status = 'REVISED', updated_at = v_now
  WHERE id = v_prev_quote.id;

  -- 7. Insert new quote version (PENDING)
  INSERT INTO public.quotes (
    repair_request_id, technician_id, labour_description, labour_amount,
    tax_percent, estimated_completion, warranty_terms, version, status, sent_at, created_at, updated_at
  ) VALUES (
    v_repair.id, v_caller_id, trim(p_labour_description), p_labour_amount,
    p_tax_percent, trim(p_estimated_completion), nullif(trim(p_warranty_terms), ''),
    v_new_version, 'PENDING', v_now, v_now, v_now
  )
  RETURNING id INTO v_quote_id;

  -- 8. Insert items (if any specified)
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
        RAISE EXCEPTION 'Part name is required for all quote items.' USING ERRCODE = '22023';
      END IF;
      IF v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
        RAISE EXCEPTION 'Quantity must be greater than 0 for item %.', v_item.part_name USING ERRCODE = '22003';
      END IF;
      IF v_item.unit_price IS NULL OR v_item.unit_price < 0 THEN
        RAISE EXCEPTION 'Unit price must be non-negative for item %.', v_item.part_name USING ERRCODE = '22003';
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

  -- 9. Calculate totals
  v_tax_amount := round(((v_parts_total + p_labour_amount) * (p_tax_percent / 100.0)), 2);
  v_total_amount := round((v_parts_total + p_labour_amount + v_tax_amount), 2);

  -- 10. Advance repair status: preserve WAITING_FOR_PARTS strictly if hold is genuinely active
  IF v_repair.status = 'WAITING_FOR_PARTS' AND v_is_hold_active THEN
    v_next_status := 'WAITING_FOR_PARTS';
  ELSE
    v_next_status := 'QUOTE_PENDING';
  END IF;

  UPDATE public.repair_requests
  SET status = v_next_status,
      clarification_note = NULL,
      status_since = v_now,
      updated_at = v_now
  WHERE id = v_repair.id;

  -- 11. Record timeline event
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

  -- 12. Notify farmer
  INSERT INTO public.notifications (
    recipient_role, recipient_user_id, notification_text, link_target, is_read, created_at
  ) VALUES (
    'farmer'::user_role, v_repair.farmer_id,
    'Revised quote ready for repair ' || v_repair.job_number || ' (v' || v_new_version::text || '). Review and approve the updated repair.',
    '/farmer/repair/' || v_repair.id::text, false, v_now
  );

  -- 13. Return complete structured revised quote
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
$$;

-- 8. GRANTS AND PRIVILEGES
REVOKE ALL ON FUNCTION public.update_service_centre_part_request_eta(uuid, timestamptz, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_service_centre_part_request_eta(uuid, timestamptz, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_service_centre_part_request_eta(uuid, timestamptz, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_quote_atomic(uuid, text, numeric, numeric, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_quote_atomic(uuid, text, numeric, numeric, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_quote_atomic(uuid, text, numeric, numeric, text, text, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.revise_quote_atomic(uuid, uuid, text, numeric, numeric, text, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revise_quote_atomic(uuid, uuid, text, numeric, numeric, text, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.revise_quote_atomic(uuid, uuid, text, numeric, numeric, text, text, text, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.trg_enforce_technician_part_request_fields() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_enforce_technician_part_request_fields() FROM anon;
GRANT EXECUTE ON FUNCTION public.trg_enforce_technician_part_request_fields() TO authenticated, service_role;

