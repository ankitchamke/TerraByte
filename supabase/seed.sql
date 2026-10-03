-- ==============================================================================
-- TerraByte — Seed Data
-- File: supabase/seed.sql
-- Description: Deterministic, reproducible, idempotent simulated seed data.
-- NOTICE: ALL DATA BELOW IS EXPLICITLY SIMULATED DEMO DATA FOR HACKATHON
-- PROTOTYPING. NOT REAL FIELD VALIDATION, USERS, WORKSHOPS, OR INVENTORY.
-- ==============================================================================

-- 1. PROFILES (DEMO DATA)
INSERT INTO public.profiles (id, role, full_name, phone, village, demo_code)
VALUES
  -- Farmers
  ('00000000-0000-0000-0001-000000000001', 'farmer', 'Balasaheb Patil', '+91 98220 11111', 'Katol, Nagpur', 'f1'),
  ('00000000-0000-0000-0001-000000000002', 'farmer', 'Suresh Jadhav', '+91 98220 22222', 'Saoner, Nagpur', 'f2'),
  ('00000000-0000-0000-0001-000000000003', 'farmer', 'Anil Pawar', '+91 98220 33333', 'Umred, Nagpur', 'f3'),
  -- Technicians
  ('00000000-0000-0000-0002-000000000001', 'technician', 'Ramesh Kumar', '+91 90110 00001', 'Green Earth Mobile Repairs, Nagpur', 't1'),
  ('00000000-0000-0000-0002-000000000002', 'technician', 'Vikas Shinde', '+91 90110 00002', 'Shinde Agro Works, Nagpur', 't2'),
  ('00000000-0000-0000-0002-000000000003', 'technician', 'Imran Shaikh', '+91 90110 00003', 'Deccan Tractor Clinic, Nagpur', 't3'),
  ('00000000-0000-0000-0002-000000000004', 'technician', 'Prakash More', '+91 90110 00004', 'More Harvester Service, Nagpur', 't4'),
  ('00000000-0000-0000-0002-000000000005', 'technician', 'Sachin Gaikwad', '+91 90110 00005', 'Gaikwad Pump & Motor, Nagpur', 't5'),
  -- Service Centre Admin
  ('00000000-0000-0000-0003-000000000001', 'admin', 'Nagpur Service Centre', '+91 1800 200 1234', 'Nagpur Central Command', 'admin')
ON CONFLICT (id) DO UPDATE SET
  role = EXCLUDED.role,
  full_name = EXCLUDED.full_name,
  phone = EXCLUDED.phone,
  village = EXCLUDED.village,
  demo_code = EXCLUDED.demo_code;

-- 2. TECHNICIAN PROFILES (DEMO DATA)
INSERT INTO public.technician_profiles (
  id, profile_id, workshop_name, brands, skills, is_verified, distance_km, eta_minutes, is_available, rating, jobs_completed, phone
)
VALUES
  (
    '00000000-0000-0000-0002-000000000011',
    '00000000-0000-0000-0002-000000000001',
    'Green Earth Mobile Repairs',
    ARRAY['Mahindra', 'Swaraj'],
    ARRAY['Fuel system', 'Engine', 'Cooling system'],
    true,
    7.0,
    45,
    false,
    4.8,
    312,
    '+91 90110 00001'
  ),
  (
    '00000000-0000-0000-0002-000000000012',
    '00000000-0000-0000-0002-000000000002',
    'Shinde Agro Works',
    ARRAY['John Deere', 'New Holland', 'Mahindra'],
    ARRAY['Hydraulics', 'Transmission', 'Steering & brakes'],
    true,
    11.0,
    60,
    true,
    4.7,
    244,
    '+91 90110 00002'
  ),
  (
    '00000000-0000-0000-0002-000000000013',
    '00000000-0000-0000-0002-000000000003',
    'Deccan Tractor Clinic',
    ARRAY['Swaraj', 'Sonalika', 'Massey Ferguson'],
    ARRAY['Engine', 'Electrical', 'Fuel system'],
    true,
    4.0,
    30,
    true,
    4.6,
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

-- 3. EQUIPMENT (DEMO DATA)
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
    'Harvester',
    'Kubota',
    'DC-68G',
    2023,
    'KBDC68-23-7710',
    680,
    NULL,
    'Operational',
    'e2'
  ),
  (
    '00000000-0000-0000-0010-000000000003',
    '00000000-0000-0000-0001-000000000001',
    'Pump',
    'Kirloskar',
    'KDS 5HP',
    2019,
    'KIR-5HP-19-3321',
    2210,
    NULL,
    'Operational',
    'e3'
  ),
  (
    '00000000-0000-0000-0010-000000000004',
    '00000000-0000-0000-0001-000000000002',
    'Tractor',
    'John Deere',
    '5050D',
    2020,
    'JD5050D-20-11902',
    2380,
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
  type = EXCLUDED.type,
  make = EXCLUDED.make,
  model = EXCLUDED.model,
  year = EXCLUDED.year,
  serial_number = EXCLUDED.serial_number,
  operating_hours = EXCLUDED.operating_hours,
  status = EXCLUDED.status,
  demo_code = EXCLUDED.demo_code;

-- 4. REPAIR REQUESTS (DEMO DATA)
INSERT INTO public.repair_requests (
  id, job_number, equipment_id, farmer_id, technician_id, status, is_testing, symptoms,
  description, photos, location, assessment, status_since, declined_by, clarification_note, parts_hold
)
VALUES
  (
    '00000000-0000-0000-0020-000000008841',
    'TB-8841',
    '00000000-0000-0000-0010-000000000001', -- Mahindra 575 DI
    '00000000-0000-0000-0001-000000000001', -- Balasaheb Patil
    '00000000-0000-0000-0002-000000000001', -- Ramesh Kumar
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
    }'::jsonb
  ),
  (
    '00000000-0000-0000-0020-000000008902',
    'TB-8902',
    '00000000-0000-0000-0010-000000000004', -- John Deere 5050D
    '00000000-0000-0000-0001-000000000002', -- Suresh Jadhav
    '00000000-0000-0000-0002-000000000002', -- Vikas Shinde
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
    NULL
  ),
  (
    '00000000-0000-0000-0020-000000008898',
    'TB-8898',
    '00000000-0000-0000-0010-000000000005', -- Swaraj 744 FE
    '00000000-0000-0000-0001-000000000003', -- Anil Pawar
    NULL,                                    -- Unassigned
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
    NULL
  )
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  is_testing = EXCLUDED.is_testing,
  technician_id = EXCLUDED.technician_id,
  assessment = EXCLUDED.assessment,
  status_since = EXCLUDED.status_since,
  parts_hold = EXCLUDED.parts_hold;

-- 5. QUOTES (DEMO DATA)
INSERT INTO public.quotes (
  id, repair_request_id, technician_id, labour_description, labour_amount, tax_percent,
  estimated_completion, warranty_terms, version, status, sent_at
)
VALUES
  (
    '00000000-0000-0000-0030-000000008841',
    '00000000-0000-0000-0020-000000008841', -- TB-8841
    '00000000-0000-0000-0002-000000000001', -- Ramesh Kumar
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
    '00000000-0000-0000-0020-000000008902', -- TB-8902
    '00000000-0000-0000-0002-000000000002', -- Vikas Shinde
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
  labour_amount = EXCLUDED.labour_amount,
  status = EXCLUDED.status,
  estimated_completion = EXCLUDED.estimated_completion;

-- 6. QUOTE ITEMS (DEMO DATA)
INSERT INTO public.quote_items (
  id, quote_id, part_name, part_spec, quantity, unit_price, part_source
)
VALUES
  -- Items for TB-8841
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
  -- Items for TB-8902
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
  quantity = EXCLUDED.quantity,
  unit_price = EXCLUDED.unit_price;

-- 7. SERVICE HISTORY (DEMO DATA)
INSERT INTO public.service_history (
  id, equipment_id, repair_request_id, service_date, operating_hours, service_type,
  issue_description, parts_replaced, labour_cost, total_cost, technician_name,
  workshop_name, technician_notes, maintenance_advice, downtime_hours, invoice_reference, demo_code
)
VALUES
  (
    '00000000-0000-0000-0040-000000000001',
    '00000000-0000-0000-0010-000000000001', -- Mahindra 575 DI
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
    '00000000-0000-0000-0010-000000000001', -- Mahindra 575 DI
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
    '00000000-0000-0000-0010-000000000002', -- Kubota DC-68G
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
  total_cost = EXCLUDED.total_cost,
  operating_hours = EXCLUDED.operating_hours;

-- 8. REPAIR TIMELINE (DEMO DATA)
INSERT INTO public.repair_timeline (
  repair_request_id, status, note, created_by_role, created_at
)
VALUES
  ('00000000-0000-0000-0020-000000008841', 'REQUESTED', 'Breakdown reported in field', 'farmer', NOW() - interval '26 hours'),
  ('00000000-0000-0000-0020-000000008841', 'ACCEPTED', 'Technician assigned & dispatched', 'technician', NOW() - interval '25 hours 40 minutes'),
  ('00000000-0000-0000-0020-000000008841', 'QUOTE_PENDING', 'Quote formulated & sent', 'technician', NOW() - interval '23 hours'),
  ('00000000-0000-0000-0020-000000008841', 'IN_PROGRESS', 'Quote approved & repair authorized', 'farmer', NOW() - interval '22 hours 30 minutes'),
  ('00000000-0000-0000-0020-000000008841', 'NOTE', 'Inline filter replaced. Injector 3 spray pattern poor – nozzle wear confirmed.', 'technician', NOW() - interval '5 hours'),
  ('00000000-0000-0000-0020-000000008841', 'WAITING_FOR_PARTS', 'OEM Bosch Fuel Injector Nozzle — ETA Tomorrow 9:30 AM', 'technician', NOW() - interval '3 hours'),

  ('00000000-0000-0000-0020-000000008902', 'REQUESTED', 'Breakdown reported', 'farmer', NOW() - interval '4 hours'),
  ('00000000-0000-0000-0020-000000008902', 'ACCEPTED', 'Job accepted by Vikas Shinde', 'technician', NOW() - interval '3 hours 36 minutes'),
  ('00000000-0000-0000-0020-000000008902', 'QUOTE_PENDING', 'Quote sent to Suresh Jadhav', 'technician', NOW() - interval '70 minutes'),

  ('00000000-0000-0000-0020-000000008898', 'REQUESTED', 'Breakdown reported', 'farmer', NOW() - interval '28 minutes');

-- 9. REPAIR NOTES (DEMO DATA)
INSERT INTO public.repair_notes (
  repair_request_id, author_id, note_text, created_at
)
VALUES
  (
    '00000000-0000-0000-0020-000000008841',
    '00000000-0000-0000-0002-000000000001', -- Ramesh Kumar
    'Inline filter replaced. Injector 3 spray pattern poor – nozzle wear confirmed.',
    NOW() - interval '5 hours'
  );

-- 10. NOTIFICATIONS (DEMO DATA)
INSERT INTO public.notifications (
  recipient_role, recipient_user_id, notification_text, link_target, is_read, created_at
)
VALUES
  (
    'farmer',
    '00000000-0000-0000-0001-000000000001', -- Balasaheb Patil
    'Repair TB-8841 paused: waiting for Bosch injector nozzle (ETA tomorrow 9:30 AM)',
    '/farmer/repair/TB-8841',
    false,
    NOW() - interval '3 hours'
  ),
  (
    'technician',
    '00000000-0000-0000-0002-000000000002', -- Vikas Shinde
    'Quote for TB-8902 sent to Suresh Jadhav',
    '/technician/job/TB-8902',
    true,
    NOW() - interval '70 minutes'
  ),
  (
    'admin',
    NULL,
    'TB-8898 unassigned for 28 min — exception',
    '/admin/repair/TB-8898',
    false,
    NOW() - interval '5 minutes'
  );
