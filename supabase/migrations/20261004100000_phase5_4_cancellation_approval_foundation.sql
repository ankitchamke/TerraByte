-- ==============================================================================
-- TerraByte — Phase 5.4 Step 1: Cancellation Approval Database Foundation
-- Migration: 20261004100000_phase5_4_cancellation_approval_foundation.sql
-- Description:
-- 1. Extends public.repair_status enum with CANCELLATION_REQUESTED.
-- 2. Adds cancellation metadata columns to public.repair_requests.
-- 3. Hardens RLS UPDATE policy on public.repair_requests to prevent unauthorized
--    cancellation mutations while preserving legitimate lifecycle transitions.
-- 4. Updates public.reset_demo_data() to nullify cancellation metadata during
--    canonical fixture restoration.
-- ==============================================================================

-- ============================================================================
-- 1. REPAIR STATUS ENUM EXTENSION
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'repair_status'
      AND n.nspname = 'public'
      AND e.enumlabel = 'CANCELLATION_REQUESTED'
  ) THEN
    ALTER TYPE public.repair_status ADD VALUE 'CANCELLATION_REQUESTED' BEFORE 'CANCELLED';
  END IF;
END $$;

-- ============================================================================
-- 2. CANCELLATION METADATA COLUMNS ON REPAIR_REQUESTS
-- ============================================================================

ALTER TABLE public.repair_requests
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancellation_note text,
  ADD COLUMN IF NOT EXISTS cancellation_requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_previous_status public.repair_status,
  ADD COLUMN IF NOT EXISTS cancellation_admin_response text;

CREATE INDEX IF NOT EXISTS idx_repair_requests_cancellation_status
  ON public.repair_requests (status)
  WHERE status = 'CANCELLATION_REQUESTED';

-- ============================================================================
-- 3. RLS HARDENING: REPAIR_REQUESTS UPDATE POLICIES
-- ============================================================================

-- Clean up any prior update policies on repair_requests
DROP POLICY IF EXISTS "Authorized participants can update repair requests" ON public.repair_requests;
DROP POLICY IF EXISTS "Farmers can directly cancel unassigned repairs" ON public.repair_requests;
DROP POLICY IF EXISTS "Farmers can update active repair requests" ON public.repair_requests;
DROP POLICY IF EXISTS "Technicians can update assigned repairs and accept jobs" ON public.repair_requests;
DROP POLICY IF EXISTS "Admins have full operational update access" ON public.repair_requests;

-- 3.1 Admins: Full operational update access across all repairs and statuses
CREATE POLICY "Admins have full operational update access"
ON public.repair_requests
FOR UPDATE
TO authenticated
USING (
  public.current_user_role() = 'admin'::public.user_role
)
WITH CHECK (
  public.current_user_role() = 'admin'::public.user_role
);

-- 3.2 Farmers: Direct cancellation strictly restricted to unassigned REQUESTED repairs
-- OLD row (USING) MUST be owned by caller, in REQUESTED status, and unassigned (technician_id IS NULL)
-- NEW row (WITH CHECK) ensures status is CANCELLED and technician_id remains NULL
CREATE POLICY "Farmers can directly cancel unassigned repairs"
ON public.repair_requests
FOR UPDATE
TO authenticated
USING (
  farmer_id = public.current_profile_id()
  AND status = 'REQUESTED'::public.repair_status
  AND technician_id IS NULL
)
WITH CHECK (
  farmer_id = public.current_profile_id()
  AND status = 'CANCELLED'::public.repair_status
  AND technician_id IS NULL
);

-- 3.3 Farmers: Ongoing lifecycle updates (quote revision, quote approval, cancellation request)
-- Excludes direct mutation to CANCELLED (governed cancellation must use CANCELLATION_REQUESTED)
-- Excludes mutation to COMPLETED (only technicians complete repairs)
-- Locks rows currently in CANCELLATION_REQUESTED (pending Service Centre review)
CREATE POLICY "Farmers can update active repair requests"
ON public.repair_requests
FOR UPDATE
TO authenticated
USING (
  farmer_id = public.current_profile_id()
  AND status NOT IN (
    'CANCELLATION_REQUESTED'::public.repair_status,
    'CANCELLED'::public.repair_status,
    'COMPLETED'::public.repair_status
  )
)
WITH CHECK (
  farmer_id = public.current_profile_id()
  AND status NOT IN (
    'CANCELLED'::public.repair_status,
    'COMPLETED'::public.repair_status
  )
);

-- 3.4 Technicians: Job progress and unassigned ticket acceptance
-- Can accept unassigned REQUESTED tickets to ACCEPTED
-- Can update assigned ongoing repairs (quote, parts hold, testing, completion)
-- Strictly blocked from setting CANCELLED or CANCELLATION_REQUESTED
-- Locks rows currently in CANCELLATION_REQUESTED (work on hold during review)
CREATE POLICY "Technicians can update assigned repairs and accept jobs"
ON public.repair_requests
FOR UPDATE
TO authenticated
USING (
  (
    technician_id = public.current_profile_id()
    AND status NOT IN (
      'CANCELLATION_REQUESTED'::public.repair_status,
      'CANCELLED'::public.repair_status,
      'COMPLETED'::public.repair_status
    )
  )
  OR (
    public.current_user_role() = 'technician'::public.user_role
    AND technician_id IS NULL
    AND status = 'REQUESTED'::public.repair_status
  )
)
WITH CHECK (
  (
    technician_id = public.current_profile_id()
    AND status NOT IN (
      'CANCELLED'::public.repair_status,
      'CANCELLATION_REQUESTED'::public.repair_status
    )
  )
  OR (
    public.current_user_role() = 'technician'::public.user_role
    AND technician_id = public.current_profile_id()
    AND status = 'ACCEPTED'::public.repair_status
  )
);

-- ============================================================================
-- 4. UPDATE RESET_DEMO_DATA() FUNCTION (PRESERVE CANONICAL REPAIRS & CLEAR CANCELLATION)
-- ============================================================================

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
  v_equipment_deleted int := 0;
  v_notifications_deleted int := 0;
  v_service_history_deleted int := 0;
BEGIN
  -- ============================================================================
  -- 1. STRICT DUAL-KEY AUTHORIZATION
  -- ============================================================================
  v_caller_id := auth.uid();

  -- Check A: auth.uid() must NOT be NULL and must match one of the 5 designated demo UUIDs
  IF v_caller_id IS NULL OR v_caller_id NOT IN (
    '00000000-0000-0000-0000-000000000001'::uuid, -- farmer f1 (Balasaheb Patil)
    '00000000-0000-0000-0000-000000000002'::uuid, -- farmer f2 (Suresh Jadhav)
    '00000000-0000-0000-0000-000000000003'::uuid, -- farmer f3 (Anil Pawar)
    '00000000-0000-0000-0000-000000000004'::uuid, -- technician t1 (Ramesh Kumar)
    '00000000-0000-0000-0000-000000000005'::uuid  -- admin (Service Centre Admin)
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Demo reset is strictly reserved for designated demo evaluation personas.'
      USING ERRCODE = '42501';
  END IF;

  -- Check B: Caller profile email must match one of the 5 designated demo emails
  SELECT email INTO v_caller_email
  FROM public.profiles
  WHERE auth_user_id = v_caller_id OR id = v_caller_id;

  IF v_caller_email IS NULL OR v_caller_email NOT IN (
    'farmer.nagpur@terrabyte.demo',
    'farmer2.nagpur@terrabyte.demo',
    'farmer3.nagpur@terrabyte.demo',
    'tech.nagpur@terrabyte.demo',
    'admin.nagpur@terrabyte.demo'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Demo reset is strictly reserved for designated demo evaluation personas.'
      USING ERRCODE = '42501';
  END IF;

  -- ============================================================================
  -- 2. DISPOSABLE DEMO RECORD CLEANUP (STRICT DEMO SCOPE ONLY)
  -- Real user records have ZERO intersection with these explicit predicates.
  -- ============================================================================

  -- 2.1 Delete disposable test repairs created under demo farmers f1, f2, f3
  -- Excludes canonical repairs (TB-8841, TB-8902, TB-8898) and Phase 5.5 fixture (TB-4489)
  -- Foreign key CASCADE will remove related test quotes, quote_items, repair_notes, repair_timeline
  WITH deleted_repairs AS (
    DELETE FROM public.repair_requests
    WHERE farmer_id IN (
      '00000000-0000-0000-0001-000000000001'::uuid, -- f1
      '00000000-0000-0000-0001-000000000002'::uuid, -- f2
      '00000000-0000-0000-0001-000000000003'::uuid  -- f3
    )
    AND id NOT IN (
      '00000000-0000-0000-0020-000000008841'::uuid, -- TB-8841
      '00000000-0000-0000-0020-000000008902'::uuid, -- TB-8902
      '00000000-0000-0000-0020-000000008898'::uuid, -- TB-8898
      'a0562f3b-4fd3-42d1-9bc1-6d4dfffd3c2b'::uuid  -- TB-4489 (Phase 5.5 fixture)
    )
    RETURNING id
  )
  SELECT count(*) INTO v_repairs_deleted FROM deleted_repairs;

  -- 2.2 Delete extra test quotes on canonical repairs (preserves seed quotes)
  DELETE FROM public.quotes
  WHERE repair_request_id IN (
    '00000000-0000-0000-0020-000000008841'::uuid,
    '00000000-0000-0000-0020-000000008902'::uuid,
    '00000000-0000-0000-0020-000000008898'::uuid
  )
  AND id NOT IN (
    '00000000-0000-0000-0030-000000008841'::uuid,
    '00000000-0000-0000-0030-000000008902'::uuid
  );

  -- 2.3 Delete extra quote items on canonical quotes (preserves seed items)
  DELETE FROM public.quote_items
  WHERE quote_id IN (
    '00000000-0000-0000-0030-000000008841'::uuid,
    '00000000-0000-0000-0030-000000008902'::uuid
  )
  AND id NOT IN (
    '00000000-0000-0000-0031-000000000001'::uuid,
    '00000000-0000-0000-0031-000000000002'::uuid,
    '00000000-0000-0000-0031-000000000003'::uuid,
    '00000000-0000-0000-0031-000000000004'::uuid
  );

  -- 2.4 Delete accumulated test notes on canonical repairs (preserves canonical seed note)
  DELETE FROM public.repair_notes
  WHERE repair_request_id IN (
    '00000000-0000-0000-0020-000000008841'::uuid,
    '00000000-0000-0000-0020-000000008902'::uuid,
    '00000000-0000-0000-0020-000000008898'::uuid
  )
  AND id != 'aead7e08-20cc-4ae9-8874-b21944b303e6'::uuid;

  -- 2.5 Delete accumulated test timeline entries on canonical repairs (preserves 10 canonical seed entries)
  DELETE FROM public.repair_timeline
  WHERE repair_request_id IN (
    '00000000-0000-0000-0020-000000008841'::uuid,
    '00000000-0000-0000-0020-000000008902'::uuid,
    '00000000-0000-0000-0020-000000008898'::uuid
  )
  AND id NOT IN (
    '9f0fb07b-c9ed-4ba6-b4ae-19b7589f890c'::uuid,
    'a0017bf7-7d64-4f83-b9fa-52a4ca0e5dec'::uuid,
    '82e1dfee-84cb-4568-a6ab-6681ce47ac65'::uuid,
    'a12457b9-2bc0-42cf-9de8-02a3b1c75e1d'::uuid,
    'dbf06061-8fc5-44a7-a445-318909b9e14b'::uuid,
    '60587abd-87e5-47ad-8332-7fc9446c3c52'::uuid,
    '3e8da5c2-220a-4374-a310-7d4555ad4212'::uuid,
    '639a20ed-d436-4723-b042-9d9b8355a6c5'::uuid,
    '1e4f1488-3e3f-446c-9e9a-7a1e272ca40b'::uuid,
    '86a36dd1-4c73-418e-8f32-480fa971912c'::uuid
  );

  -- 2.6 Delete accumulated test service history on demo equipment e1..e5 (preserves S-1, S-2, S-3)
  WITH deleted_sh AS (
    DELETE FROM public.service_history
    WHERE equipment_id IN (
      '00000000-0000-0000-0010-000000000001'::uuid, -- e1
      '00000000-0000-0000-0010-000000000002'::uuid, -- e2
      '00000000-0000-0000-0010-000000000003'::uuid, -- e3
      '00000000-0000-0000-0010-000000000004'::uuid, -- e4
      '00000000-0000-0000-0010-000000000005'::uuid  -- e5
    )
    AND id NOT IN (
      '00000000-0000-0000-0040-000000000001'::uuid, -- S-1
      '00000000-0000-0000-0040-000000000002'::uuid, -- S-2
      '00000000-0000-0000-0040-000000000003'::uuid  -- S-3
    )
    RETURNING id
  )
  SELECT count(*) INTO v_service_history_deleted FROM deleted_sh;

  -- 2.7 Delete additional disposable equipment owned by demo farmers f1, f2, f3 (preserves e1..e5)
  -- Foreign key CASCADE removes any associated service history
  WITH deleted_equipment AS (
    DELETE FROM public.equipment
    WHERE farmer_id IN (
      '00000000-0000-0000-0001-000000000001'::uuid,
      '00000000-0000-0000-0001-000000000002'::uuid,
      '00000000-0000-0000-0001-000000000003'::uuid
    )
    AND id NOT IN (
      '00000000-0000-0000-0010-000000000001'::uuid, -- e1
      '00000000-0000-0000-0010-000000000002'::uuid, -- e2
      '00000000-0000-0000-0010-000000000003'::uuid, -- e3
      '00000000-0000-0000-0010-000000000004'::uuid, -- e4
      '00000000-0000-0000-0010-000000000005'::uuid  -- e5
    )
    RETURNING id
  )
  SELECT count(*) INTO v_equipment_deleted FROM deleted_equipment;

  -- 2.8 Delete accumulated demo test notifications (preserves 3 canonical seed notifications)
  WITH deleted_notifs AS (
    DELETE FROM public.notifications
    WHERE (
      recipient_user_id IN (
        '00000000-0000-0000-0001-000000000001'::uuid, -- f1
        '00000000-0000-0000-0001-000000000002'::uuid, -- f2
        '00000000-0000-0000-0001-000000000003'::uuid, -- f3
        '00000000-0000-0000-0002-000000000001'::uuid, -- t1
        '00000000-0000-0000-0002-000000000002'::uuid, -- t2
        '00000000-0000-0000-0002-000000000003'::uuid, -- t3
        '00000000-0000-0000-0002-000000000004'::uuid, -- t4
        '00000000-0000-0000-0002-000000000005'::uuid, -- t5
        '00000000-0000-0000-0003-000000000001'::uuid  -- admin
      )
      OR (recipient_user_id IS NULL AND recipient_role = 'admin')
    )
    AND id NOT IN (
      'e4c7231c-7172-4715-b38f-abd6a2d8c624'::uuid, -- TB-8841 seed notif
      'c7fdc083-fce0-4a73-afb8-f63aa84faf2e'::uuid, -- TB-8841 seed notif (Ramesh Kumar t1)
      'f81fcc10-3c5d-4eb7-be84-1b617db5bfbd'::uuid  -- TB-8898 seed notif
    )
    RETURNING id
  )
  SELECT count(*) INTO v_notifications_deleted FROM deleted_notifs;

  -- ============================================================================
  -- 3. DETERMINISTIC RESTORATION (UPSERT CANONICAL FIXTURES FROM seed.sql)
  -- ============================================================================

  -- 3.1 Restore Canonical Profiles (f1, f2, f3, t1, t2, t3, t4, t5, admin)
  INSERT INTO public.profiles (id, role, full_name, phone, village, demo_code, email, auth_user_id)
  VALUES
    ('00000000-0000-0000-0001-000000000001', 'farmer', 'Balasaheb Patil', '+91 98220 11111', 'Katol, Nagpur', 'f1', 'farmer.nagpur@terrabyte.demo', '00000000-0000-0000-0000-000000000001'),
    ('00000000-0000-0000-0001-000000000002', 'farmer', 'Suresh Jadhav', '+91 98220 22222', 'Saoner, Nagpur', 'f2', 'farmer2.nagpur@terrabyte.demo', '00000000-0000-0000-0000-000000000002'),
    ('00000000-0000-0000-0001-000000000003', 'farmer', 'Anil Pawar', '+91 98220 33333', 'Umred, Nagpur', 'f3', 'farmer3.nagpur@terrabyte.demo', '00000000-0000-0000-0000-000000000003'),
    ('00000000-0000-0000-0002-000000000001', 'technician', 'Ramesh Kumar', '+91 90110 00001', 'Green Earth Mobile Repairs, Nagpur', 't1', 'tech.nagpur@terrabyte.demo', '00000000-0000-0000-0000-000000000004'),
    ('00000000-0000-0000-0002-000000000002', 'technician', 'Vikas Shinde', '+91 90110 00002', 'Shinde Agro Works, Nagpur', 't2', NULL, NULL),
    ('00000000-0000-0000-0002-000000000003', 'technician', 'Imran Shaikh', '+91 90110 00003', 'Deccan Tractor Clinic, Nagpur', 't3', NULL, NULL),
    ('00000000-0000-0000-0002-000000000004', 'technician', 'Prakash More', '+91 90110 00004', 'More Harvester Service, Nagpur', 't4', NULL, NULL),
    ('00000000-0000-0000-0002-000000000005', 'technician', 'Sachin Gaikwad', '+91 90110 00005', 'Gaikwad Pump & Motor, Nagpur', 't5', NULL, NULL),
    ('00000000-0000-0000-0003-000000000001', 'admin', 'Nagpur Service Centre', '+91 1800 200 1234', 'Nagpur Central Command', 'admin', 'admin.nagpur@terrabyte.demo', '00000000-0000-0000-0000-000000000005')
  ON CONFLICT (id) DO UPDATE SET
    role = EXCLUDED.role,
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    village = EXCLUDED.village,
    demo_code = EXCLUDED.demo_code,
    email = COALESCE(EXCLUDED.email, profiles.email),
    auth_user_id = COALESCE(EXCLUDED.auth_user_id, profiles.auth_user_id);

  -- 3.2 Restore Canonical Technician Profiles (t1..t5)
  INSERT INTO public.technician_profiles (
    id, profile_id, workshop_name, brands, skills, is_verified, distance_km, eta_minutes, is_available, rating, jobs_completed, phone
  )
  VALUES
    (
      '00000000-0000-0000-0002-000000000011',
      '00000000-0000-0000-0002-000000000001',
      'Green Earth Mobile Repairs',
      ARRAY['Mahindra', 'Swaraj', 'Tafe', 'Eicher'],
      ARRAY['Engine', 'Fuel system', 'Electrical', 'Transmission'],
      true,
      4.2,
      25,
      true,
      4.8,
      312,
      '+91 90110 00001'
    ),
    (
      '00000000-0000-0000-0002-000000000012',
      '00000000-0000-0000-0002-000000000002',
      'Shinde Agro Works',
      ARRAY['John Deere', 'New Holland', 'Kubota'],
      ARRAY['Hydraulics', 'Electronics', 'Engine overhaul', 'Diagnostics'],
      true,
      7.8,
      40,
      true,
      4.9,
      245,
      '+91 90110 00002'
    ),
    (
      '00000000-0000-0000-0002-000000000013',
      '00000000-0000-0000-0002-000000000003',
      'Deccan Tractor Clinic',
      ARRAY['Sonalika', 'Mahindra', 'Farmtrac'],
      ARRAY['Brakes & clutch', 'Cooling system', 'Mechanical overhaul'],
      true,
      12.1,
      60,
      false,
      4.7,
      189,
      '+91 90110 00003'
    ),
    (
      '00000000-0000-0000-0002-000000000014',
      '00000000-0000-0000-0002-000000000004',
      'More Harvester Service',
      ARRAY['Kubota', 'Class', 'John Deere'],
      ARRAY['Harvester systems', 'Hydraulics', 'Transmission'],
      true,
      18.0,
      80,
      true,
      4.9,
      401,
      '+91 90110 00004'
    ),
    (
      '00000000-0000-0000-0002-000000000015',
      '00000000-0000-0000-0002-000000000005',
      'Gaikwad Pump & Motor',
      ARRAY['Kirloskar', 'Crompton', 'Mahindra'],
      ARRAY['Electrical', 'Pump & motor', 'Engine'],
      false,
      9.0,
      50,
      true,
      4.3,
      76,
      '+91 90110 00005'
    )
  ON CONFLICT (id) DO UPDATE SET
    workshop_name = EXCLUDED.workshop_name,
    brands = EXCLUDED.brands,
    skills = EXCLUDED.skills,
    is_verified = EXCLUDED.is_verified,
    distance_km = EXCLUDED.distance_km,
    eta_minutes = EXCLUDED.eta_minutes,
    is_available = EXCLUDED.is_available,
    rating = EXCLUDED.rating,
    jobs_completed = EXCLUDED.jobs_completed,
    phone = EXCLUDED.phone;

  -- 3.3 Restore Canonical Equipment (e1..e5)
  INSERT INTO public.equipment (
    id, farmer_id, type, make, model, year, serial_number, operating_hours, photo_url, status, demo_code
  )
  VALUES
    (
      '00000000-0000-0000-0010-000000000001',
      '00000000-0000-0000-0001-000000000001',
      'Tractor',
      'Mahindra',
      '575 DI',
      2021,
      'MH575-21-0048821',
      1420,
      NULL,
      'In Repair',
      'e1'
    ),
    (
      '00000000-0000-0000-0010-000000000002',
      '00000000-0000-0000-0001-000000000001',
      'Power Tiller',
      'VST Shakti',
      '130 DI',
      2023,
      'VST130-23-009112',
      380,
      NULL,
      'Operational',
      'e2'
    ),
    (
      '00000000-0000-0000-0010-000000000003',
      '00000000-0000-0000-0001-000000000001',
      'Harvester',
      'John Deere',
      'W70',
      2020,
      'JD-W70-20-00192',
      890,
      NULL,
      'Operational',
      'e3'
    ),
    (
      '00000000-0000-0000-0010-000000000004',
      '00000000-0000-0000-0001-000000000002',
      'Tractor',
      'John Deere',
      '5050 D',
      2022,
      'JD5050-22-108234',
      1890,
      NULL,
      'In Repair',
      'e4'
    ),
    (
      '00000000-0000-0000-0010-000000000005',
      '00000000-0000-0000-0001-000000000003',
      'Tractor',
      'Swaraj',
      '744 FE',
      2018,
      'SW744-18-55120',
      3105,
      NULL,
      'In Repair',
      'e5'
    )
  ON CONFLICT (id) DO UPDATE SET
    farmer_id = EXCLUDED.farmer_id,
    type = EXCLUDED.type,
    make = EXCLUDED.make,
    model = EXCLUDED.model,
    year = EXCLUDED.year,
    serial_number = EXCLUDED.serial_number,
    operating_hours = EXCLUDED.operating_hours,
    status = EXCLUDED.status,
    demo_code = EXCLUDED.demo_code;

  -- 3.4 Restore Canonical Repairs (TB-8841, TB-8902, TB-8898, TB-4489)
  INSERT INTO public.repair_requests (
    id, job_number, equipment_id, farmer_id, technician_id, status, is_testing, symptoms,
    description, photos, location, assessment, status_since, declined_by, clarification_note, parts_hold,
    cancellation_reason, cancellation_note, cancellation_requested_by, cancellation_requested_at,
    cancellation_previous_status, cancellation_admin_response
  )
  VALUES
    (
      '00000000-0000-0000-0020-000000008841',
      'TB-8841',
      '00000000-0000-0000-0010-000000000001',
      '00000000-0000-0000-0001-000000000001',
      '00000000-0000-0000-0002-000000000001',
      'WAITING_FOR_PARTS',
      false,
      ARRAY['Loss of power', 'Black smoke'],
      'Tractor lost pulling power in field, heavy black smoke coming from exhaust and engine is sputtering under load.',
      ARRAY[]::text[],
      'Katol, Nagpur',
      '{
        "system": "Fuel injection / filtration",
        "possibleIssue": "Fuel injector clog or air filter blockage",
        "severity": "Moderate to High",
        "advice": "Avoid operating the machine under heavy load until inspected.",
        "partsCategory": ["Fuel filter", "Injector / nozzle components", "Air filter element"],
        "skill": "Fuel system",
        "confidence": 0.72,
        "maintenanceAdvice": "Replace fuel & air filters every 250 hrs; use filtered diesel.",
        "source": "demo-rules"
      }'::jsonb,
      NOW() - interval '3 hours',
      ARRAY[]::uuid[],
      NULL,
      '{
        "part": "OEM Bosch Fuel Injector Nozzle",
        "reason": "Nozzle set not in van stock; OEM required for 575 DI",
        "eta": "Tomorrow 9:30 AM",
        "note": "Part is being picked up from Taluka distributor.",
        "revisedCompletion": "Tomorrow, 1:00 PM",
        "since": 1759000000000
      }'::jsonb,
      NULL, NULL, NULL, NULL, NULL, NULL
    ),
    (
      '00000000-0000-0000-0020-000000008902',
      'TB-8902',
      '00000000-0000-0000-0010-000000000004',
      '00000000-0000-0000-0001-000000000002',
      '00000000-0000-0000-0002-000000000002',
      'QUOTE_PENDING',
      false,
      ARRAY['Hydraulic lift failure'],
      'Hydraulic arms dropping under load. Plough won''t stay raised.',
      ARRAY[]::text[],
      'Saoner, Nagpur',
      '{
        "system": "Hydraulics",
        "possibleIssue": "Worn lift cylinder seals or low hydraulic oil / pump pressure",
        "severity": "Moderate",
        "advice": "Do not carry raised implements; lower them fully before moving.",
        "partsCategory": ["Seal kit", "Hydraulic oil", "Control valve parts"],
        "skill": "Hydraulics",
        "confidence": 0.64,
        "maintenanceAdvice": "Check hydraulic oil level every 50 hrs; change every 750 hrs.",
        "source": "demo-rules"
      }'::jsonb,
      NOW() - interval '70 minutes',
      ARRAY[]::uuid[],
      NULL,
      NULL,
      NULL, NULL, NULL, NULL, NULL, NULL
    ),
    (
      '00000000-0000-0000-0020-000000008898',
      'TB-8898',
      '00000000-0000-0000-0010-000000000005',
      '00000000-0000-0000-0001-000000000003',
      NULL,
      'REQUESTED',
      false,
      ARRAY['Engine won''t start', 'Electrical/battery issue'],
      'Starter clicks but engine doesn''t crank. Battery was fine yesterday.',
      ARRAY[]::text[],
      'Umred, Nagpur',
      '{
        "system": "Electrical / starting circuit",
        "possibleIssue": "Weak battery, corroded terminals or starter motor fault",
        "severity": "Moderate",
        "advice": "Check terminals are tight; avoid repeated cranking to protect the starter.",
        "partsCategory": ["Battery", "Starter solenoid", "Cables & terminals"],
        "skill": "Electrical",
        "confidence": 0.64,
        "maintenanceAdvice": "Clean battery terminals monthly; check charging voltage every season.",
        "source": "demo-rules"
      }'::jsonb,
      NOW() - interval '28 minutes',
      ARRAY[]::uuid[],
      NULL,
      NULL,
      NULL, NULL, NULL, NULL, NULL, NULL
    ),
    (
      'a0562f3b-4fd3-42d1-9bc1-6d4dfffd3c2b'::uuid,
      'TB-4489',
      '00000000-0000-0000-0010-000000000002'::uuid,
      '00000000-0000-0000-0001-000000000001'::uuid,
      '00000000-0000-0000-0002-000000000001'::uuid,
      'QUOTE_REVISED'::public.repair_status,
      false,
      ARRAY['Rotavator attachment vibration', 'Gearbox oil leakage'],
      'Excessive vibration when rotavator is engaged and slow leak near gearbox seal.',
      ARRAY[]::text[],
      'Katol, Nagpur',
      '{
        "system": "Transmission & PTO",
        "possibleIssue": "Worn PTO bearing or damaged oil seal",
        "severity": "Moderate",
        "advice": "Do not operate PTO at full RPM until seal and bearing are checked.",
        "partsCategory": ["Oil seal", "PTO bearing", "Gear oil"],
        "skill": "Transmission",
        "confidence": 0.68,
        "source": "demo-rules"
      }'::jsonb,
      NOW() - interval '4 hours',
      ARRAY[]::uuid[],
      'Reason: Other' || E'\n' || 'Explanation: Can you finish by 3 PM instead of 6 PM?',
      NULL,
      NULL, NULL, NULL, NULL, NULL, NULL
    )
  ON CONFLICT (id) DO UPDATE SET
    equipment_id = EXCLUDED.equipment_id,
    farmer_id = EXCLUDED.farmer_id,
    technician_id = EXCLUDED.technician_id,
    status = EXCLUDED.status,
    is_testing = EXCLUDED.is_testing,
    symptoms = EXCLUDED.symptoms,
    description = EXCLUDED.description,
    assessment = EXCLUDED.assessment,
    status_since = EXCLUDED.status_since,
    parts_hold = EXCLUDED.parts_hold,
    clarification_note = EXCLUDED.clarification_note,
    cancellation_reason = NULL,
    cancellation_note = NULL,
    cancellation_requested_by = NULL,
    cancellation_requested_at = NULL,
    cancellation_previous_status = NULL,
    cancellation_admin_response = NULL;

  -- 3.5 Explicitly Ensure Cancellation Fields Cleared Across All Canonical Repairs
  UPDATE public.repair_requests
  SET
    cancellation_reason = NULL,
    cancellation_note = NULL,
    cancellation_requested_by = NULL,
    cancellation_requested_at = NULL,
    cancellation_previous_status = NULL,
    cancellation_admin_response = NULL
  WHERE id IN (
    '00000000-0000-0000-0020-000000008841'::uuid, -- TB-8841
    '00000000-0000-0000-0020-000000008902'::uuid, -- TB-8902
    '00000000-0000-0000-0020-000000008898'::uuid, -- TB-8898
    'a0562f3b-4fd3-42d1-9bc1-6d4dfffd3c2b'::uuid  -- TB-4489
  );

  -- 3.6 Ensure Future Phase 5.5 Fixture (TB-4489) Preserved and Valid
  UPDATE public.repair_requests
  SET
    status = 'QUOTE_REVISED',
    farmer_id = '00000000-0000-0000-0001-000000000001',
    technician_id = '00000000-0000-0000-0002-000000000001',
    equipment_id = '00000000-0000-0000-0010-000000000002',
    clarification_note = 'Reason: Other' || E'\n' || 'Explanation: Can you finish by 3 PM instead of 6 PM?',
    cancellation_reason = NULL,
    cancellation_note = NULL,
    cancellation_requested_by = NULL,
    cancellation_requested_at = NULL,
    cancellation_previous_status = NULL,
    cancellation_admin_response = NULL
  WHERE id = 'a0562f3b-4fd3-42d1-9bc1-6d4dfffd3c2b'::uuid;

  -- 3.6 Restore Canonical Quotes
  INSERT INTO public.quotes (
    id, repair_request_id, technician_id, labour_description, labour_amount, tax_percent,
    estimated_completion, warranty_terms, version, status, sent_at
  )
  VALUES
    (
      '00000000-0000-0000-0030-000000008841',
      '00000000-0000-0000-0020-000000008841',
      '00000000-0000-0000-0002-000000000001',
      'Injector removal, nozzle replacement, fuel line bleed & load test',
      900.00,
      0.00,
      'Tomorrow, 1:00 PM',
      '90 days on parts & labour',
      1,
      'APPROVED',
      NOW() - interval '23 hours'
    ),
    (
      '00000000-0000-0000-0030-000000008902',
      '00000000-0000-0000-0020-000000008902',
      '00000000-0000-0000-0002-000000000002',
      'Lift cylinder reseal, oil flush and pressure test',
      1400.00,
      18.00,
      'Today, 6:30 PM',
      '60 days on seals',
      1,
      'PENDING',
      NOW() - interval '70 minutes'
    )
  ON CONFLICT (id) DO UPDATE SET
    labour_description = EXCLUDED.labour_description,
    labour_amount = EXCLUDED.labour_amount,
    tax_percent = EXCLUDED.tax_percent,
    estimated_completion = EXCLUDED.estimated_completion,
    warranty_terms = EXCLUDED.warranty_terms,
    version = EXCLUDED.version,
    status = EXCLUDED.status;

  -- 3.7 Restore Canonical Quote Items
  INSERT INTO public.quote_items (
    id, quote_id, part_name, part_spec, quantity, unit_price, part_source
  )
  VALUES
    (
      '00000000-0000-0000-0031-000000000001',
      '00000000-0000-0000-0030-000000008841',
      'Fuel Injector Nozzle Set',
      'Bosch 0433171 (x4)',
      1,
      2200.00,
      'Taluka distributor'
    ),
    (
      '00000000-0000-0000-0031-000000000002',
      '00000000-0000-0000-0030-000000008841',
      'Inline Fuel Filter',
      'Mahindra 005556958R1',
      1,
      350.00,
      'In van stock'
    ),
    (
      '00000000-0000-0000-0031-000000000003',
      '00000000-0000-0000-0030-000000008902',
      'Lift Cylinder Seal Kit',
      'JD AL120788',
      1,
      1650.00,
      'Shinde Agro stock'
    ),
    (
      '00000000-0000-0000-0031-000000000004',
      '00000000-0000-0000-0030-000000008902',
      'Hydraulic Oil 15W-30',
      'JD Hy-Gard, litres',
      8,
      320.00,
      'In van stock'
    )
  ON CONFLICT (id) DO UPDATE SET
    part_name = EXCLUDED.part_name,
    part_spec = EXCLUDED.part_spec,
    quantity = EXCLUDED.quantity,
    unit_price = EXCLUDED.unit_price,
    part_source = EXCLUDED.part_source;

  -- 3.8 Restore Canonical Service History (S-1, S-2, S-3)
  INSERT INTO public.service_history (
    id, equipment_id, repair_request_id, service_date, operating_hours, service_type,
    issue_description, parts_replaced, labour_cost, total_cost, technician_name,
    workshop_name, technician_notes, maintenance_advice, downtime_hours, invoice_reference, demo_code
  )
  VALUES
    (
      '00000000-0000-0000-0040-000000000001',
      '00000000-0000-0000-0010-000000000001',
      NULL,
      NOW() - interval '45 days',
      1310,
      'Fuel System Overhaul',
      'Hard starting, rough idle',
      ARRAY['Fuel Injector Nozzle Set', 'Inline Filter'],
      900.00,
      3450.00,
      'Ramesh Kumar',
      'Green Earth Mobile Repairs',
      'Water contamination found in fuel tank. Drained and flushed.',
      'Replace fuel filter every 250 hrs. Use filtered diesel.',
      4.5,
      'INV-GE-2291',
      'S-1'
    ),
    (
      '00000000-0000-0000-0040-000000000002',
      '00000000-0000-0000-0010-000000000001',
      NULL,
      NOW() - interval '160 days',
      1020,
      'Scheduled Service',
      '1000-hour service',
      ARRAY['Engine Oil 15W-40 (7L)', 'Oil Filter', 'Air Filter Element'],
      600.00,
      4150.00,
      'Ramesh Kumar',
      'Green Earth Mobile Repairs',
      'Clutch free play adjusted.',
      'Next service at 1250 hrs.',
      2.0,
      'INV-GE-1874',
      'S-2'
    ),
    (
      '00000000-0000-0000-0040-000000000003',
      '00000000-0000-0000-0010-000000000002',
      NULL,
      NOW() - interval '70 days',
      540,
      'Header Belt Replacement',
      'Header drive belt slipping',
      ARRAY['Header Drive Belt'],
      800.00,
      2600.00,
      'Prakash More',
      'More Harvester Service',
      'Tensioner pulley bearing checked OK.',
      'Inspect belts before each season.',
      3.0,
      'INV-MH-0442',
      'S-3'
    )
  ON CONFLICT (id) DO UPDATE SET
    equipment_id = EXCLUDED.equipment_id,
    service_type = EXCLUDED.service_type,
    issue_description = EXCLUDED.issue_description,
    parts_replaced = EXCLUDED.parts_replaced,
    labour_cost = EXCLUDED.labour_cost,
    total_cost = EXCLUDED.total_cost,
    technician_name = EXCLUDED.technician_name,
    workshop_name = EXCLUDED.workshop_name,
    technician_notes = EXCLUDED.technician_notes,
    maintenance_advice = EXCLUDED.maintenance_advice,
    downtime_hours = EXCLUDED.downtime_hours,
    invoice_reference = EXCLUDED.invoice_reference,
    operating_hours = EXCLUDED.operating_hours;

  -- 3.9 Restore Canonical Repair Notes (TB-8841 seed note)
  INSERT INTO public.repair_notes (
    id, repair_request_id, author_id, note_text, created_at
  )
  VALUES (
    'aead7e08-20cc-4ae9-8874-b21944b303e6',
    '00000000-0000-0000-0020-000000008841',
    '00000000-0000-0000-0002-000000000001',
    'Inline filter replaced. Injector 3 spray pattern poor – nozzle wear confirmed.',
    NOW() - interval '5 hours'
  )
  ON CONFLICT (id) DO UPDATE SET
    note_text = EXCLUDED.note_text;

  -- 3.10 Restore Canonical Repair Timeline (10 seed entries)
  INSERT INTO public.repair_timeline (
    id, repair_request_id, status, note, created_by_role, created_at
  )
  VALUES
    ('9f0fb07b-c9ed-4ba6-b4ae-19b7589f890c', '00000000-0000-0000-0020-000000008841', 'REQUESTED', 'Breakdown reported in field', 'farmer', NOW() - interval '26 hours'),
    ('a0017bf7-7d64-4f83-b9fa-52a4ca0e5dec', '00000000-0000-0000-0020-000000008841', 'ACCEPTED', 'Technician assigned & dispatched', 'technician', NOW() - interval '25 hours 40 minutes'),
    ('82e1dfee-84cb-4568-a6ab-6681ce47ac65', '00000000-0000-0000-0020-000000008841', 'QUOTE_PENDING', 'Quote formulated & sent', 'technician', NOW() - interval '23 hours'),
    ('a12457b9-2bc0-42cf-9de8-02a3b1c75e1d', '00000000-0000-0000-0020-000000008841', 'IN_PROGRESS', 'Quote approved & repair authorized', 'farmer', NOW() - interval '22 hours 30 minutes'),
    ('dbf06061-8fc5-44a7-a445-318909b9e14b', '00000000-0000-0000-0020-000000008841', 'NOTE', 'Inline filter replaced. Injector 3 spray pattern poor – nozzle wear confirmed.', 'technician', NOW() - interval '5 hours'),
    ('60587abd-87e5-47ad-8332-7fc9446c3c52', '00000000-0000-0000-0020-000000008841', 'WAITING_FOR_PARTS', 'OEM Bosch Fuel Injector Nozzle — ETA Tomorrow 9:30 AM', 'technician', NOW() - interval '3 hours'),

    ('3e8da5c2-220a-4374-a310-7d4555ad4212', '00000000-0000-0000-0020-000000008902', 'REQUESTED', 'Breakdown reported', 'farmer', NOW() - interval '4 hours'),
    ('639a20ed-d436-4723-b042-9d9b8355a6c5', '00000000-0000-0000-0020-000000008902', 'ACCEPTED', 'Job accepted by Vikas Shinde', 'technician', NOW() - interval '3 hours 36 minutes'),
    ('1e4f1488-3e3f-446c-9e9a-7a1e272ca40b', '00000000-0000-0000-0020-000000008902', 'QUOTE_PENDING', 'Quote sent to Suresh Jadhav', 'technician', NOW() - interval '70 minutes'),

    ('86a36dd1-4c73-418e-8f32-480fa971912c', '00000000-0000-0000-0020-000000008898', 'REQUESTED', 'Breakdown reported', 'farmer', NOW() - interval '28 minutes')
  ON CONFLICT (id) DO UPDATE SET
    status = EXCLUDED.status,
    note = EXCLUDED.note,
    created_by_role = EXCLUDED.created_by_role;

  -- 3.11 Restore Canonical Notifications (3 seed entries)
  INSERT INTO public.notifications (
    id, recipient_role, recipient_user_id, notification_text, link_target, is_read, created_at
  )
  VALUES
    (
      'e4c7231c-7172-4715-b38f-abd6a2d8c624',
      'farmer',
      '00000000-0000-0000-0001-000000000001',
      'Repair TB-8841 paused: waiting for Bosch injector nozzle (ETA tomorrow 9:30 AM)',
      '/farmer/repair/TB-8841',
      false,
      NOW() - interval '3 hours'
    ),
    (
      'c7fdc083-fce0-4a73-afb8-f63aa84faf2e',
      'technician',
      '00000000-0000-0000-0002-000000000001',
      'Repair TB-8841 paused: waiting for Bosch injector nozzle (ETA tomorrow 9:30 AM)',
      '/technician/job/TB-8841',
      true,
      NOW() - interval '70 minutes'
    ),
    (
      'f81fcc10-3c5d-4eb7-be84-1b617db5bfbd',
      'admin',
      NULL,
      'TB-8898 unassigned for 28 min — exception',
      '/admin/repair/TB-8898',
      false,
      NOW() - interval '5 minutes'
    )
  ON CONFLICT (id) DO UPDATE SET
    recipient_role = EXCLUDED.recipient_role,
    recipient_user_id = EXCLUDED.recipient_user_id,
    notification_text = EXCLUDED.notification_text,
    link_target = EXCLUDED.link_target,
    is_read = EXCLUDED.is_read;

  -- ============================================================================
  -- 4. SUCCESS RESULT
  -- ============================================================================
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Demo environment reset to baseline successfully.',
    'details', jsonb_build_object(
      'repairs_deleted', v_repairs_deleted,
      'equipment_deleted', v_equipment_deleted,
      'service_history_deleted', v_service_history_deleted,
      'notifications_deleted', v_notifications_deleted
    )
  );
END;
$$;

-- Secure Execution Privileges
REVOKE EXECUTE ON FUNCTION public.reset_demo_data() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reset_demo_data() FROM anon;
GRANT EXECUTE ON FUNCTION public.reset_demo_data() TO authenticated;
