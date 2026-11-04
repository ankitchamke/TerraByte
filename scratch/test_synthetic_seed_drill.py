import subprocess
import os

PG_BIN = r"D:\TerraByte_Drill\pgsql17\pgsql\bin"
PSQL = os.path.join(PG_BIN, "psql.exe")
env = os.environ.copy()
env["PGPASSWORD"] = "postgres"

seed_sql = """
-- ==============================================================================
-- TerraByte: Privacy-Compliant Synthetic Staging Seed Fixtures
-- Target: Staging Environment (Zero Production PII / Zero Auth Dump Restorations)
-- ==============================================================================

BEGIN;

-- 1. Create synthetic auth.users (so FKs from profiles succeed)
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES 
  ('00000000-0000-0000-0001-000000000001', 'farmer.staging@terrabyte.test', '{"role":"farmer","full_name":"Devdas Gaikwad"}'::jsonb),
  ('00000000-0000-0000-0002-000000000001', 'tech.staging@terrabyte.test', '{"role":"technician","full_name":"Santosh Kale"}'::jsonb),
  ('00000000-0000-0000-0003-000000000001', 'admin.staging@terrabyte.test', '{"role":"admin","full_name":"Rahul Patil"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- 2. Seed Public Profiles
INSERT INTO public.profiles (id, auth_user_id, role, full_name, phone, village, demo_code)
VALUES
  ('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0001-000000000001', 'farmer', 'Devdas Gaikwad', '+919876543210', 'Baramati', 'FARMER-DEMO-01'),
  ('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0002-000000000001', 'technician', 'Santosh Kale', '+919876543211', 'Baramati', 'TECH-DEMO-01'),
  ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0003-000000000001', 'admin', 'Rahul Patil', '+919876543212', 'Baramati', 'ADMIN-DEMO-01')
ON CONFLICT (id) DO NOTHING;

-- 3. Seed Technician Profile
INSERT INTO public.technician_profiles (profile_id, workshop_name, brands, skills, is_available, is_verified, rating, jobs_completed)
VALUES
  ('00000000-0000-0000-0002-000000000001', 'Kale Agro Services', ARRAY['John Deere', 'Mahindra'], ARRAY['Tractors', 'Hydraulics', 'Engine Overhaul'], true, true, 4.9, 42)
ON CONFLICT (profile_id) DO NOTHING;

-- 4. Seed Synthetic Equipment
INSERT INTO public.equipment (id, farmer_id, make, model, year, type, serial_number, operating_hours, status, demo_code)
VALUES
  ('00000000-0000-0000-0004-000000000001', '00000000-0000-0000-0001-000000000001', 'John Deere', '5050 D', 2022, 'Tractor', 'JD5050D-2022-7891', 1250, 'Operational', 'EQ-JD-01'),
  ('00000000-0000-0000-0004-000000000002', '00000000-0000-0000-0001-000000000001', 'Mahindra', '575 DI', 2021, 'Tractor', 'MH575DI-2021-4412', 2100, 'Operational', 'EQ-MH-02')
ON CONFLICT (id) DO NOTHING;

-- 5. Seed 5 Canonical Parts Desk Parts (linked to admin Rahul Patil)
INSERT INTO public.service_centre_parts (id, service_centre_id, part_number, name, spec, category, unit_price, stock_quantity, location, compatible_models)
VALUES
  ('00000000-0000-0000-0009-000000000001', '00000000-0000-0000-0003-000000000001', 'TB-FLT-001', 'Oil Filter Cartridge', 'Standard spin-on lube filter for 40-60HP tractors', 'Filters', 450.00, 25, 'Shelf A-12', ARRAY['John Deere 5050 D', 'Mahindra 575 DI']),
  ('00000000-0000-0000-0009-000000000002', '00000000-0000-0000-0003-000000000001', 'TB-BLT-002', 'Alternator Drive Belt', 'Heavy-duty cogged V-belt', 'Belts', 650.00, 15, 'Shelf B-04', ARRAY['John Deere 5050 D']),
  ('00000000-0000-0000-0009-000000000003', '00000000-0000-0000-0003-000000000001', 'TB-HYD-003', 'Hydraulic Hose Assembly', 'High pressure 2-wire braided hydraulic hose 1m', 'Hydraulics', 1200.00, 8, 'Bin H-01', ARRAY['Universal']),
  ('00000000-0000-0000-0009-000000000004', '00000000-0000-0000-0003-000000000001', 'TB-FUL-004', 'Diesel Fuel Filter Element', 'Primary fuel filter insert', 'Filters', 380.00, 30, 'Shelf A-15', ARRAY['Mahindra 575 DI']),
  ('00000000-0000-0000-0009-000000000005', '00000000-0000-0000-0003-000000000001', 'TB-BRG-005', 'Front Wheel Taper Bearing', 'Inner and outer cone roller set', 'Bearings', 850.00, 12, 'Drawer BR-02', ARRAY['John Deere 5050 D', 'Mahindra 575 DI'])
ON CONFLICT (id) DO NOTHING;

-- 6. Seed Sample Repair Request
INSERT INTO public.repair_requests (id, job_number, farmer_id, equipment_id, technician_id, description, urgency_level, service_type, status, preferred_time_slot, location)
VALUES
  ('00000000-0000-0000-0005-000000000001', 'JOB-2026-0001', '00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0004-000000000001', '00000000-0000-0000-0002-000000000001', 'Engine overheating under load and noticeable oil drop near filter mount.', 'HIGH', 'DOORSTEP', 'IN_PROGRESS', '09:00 - 12:00', 'Baramati North Farm Sector 4')
ON CONFLICT (id) DO NOTHING;

-- 7. Seed Sample Quote
INSERT INTO public.quotes (id, repair_request_id, technician_id, labour_description, labour_amount, tax_percent, status, estimated_completion, warranty_terms, version)
VALUES
  ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0005-000000000001', '00000000-0000-0000-0002-000000000001', 'Oil filter seal replacement, coolant flush and hydraulic hose replacement', 1200.00, 18.00, 'APPROVED', 'Within 24 hours', '90 days on workmanship and genuine parts', 1)
ON CONFLICT (id) DO NOTHING;

-- 8. Seed Quote Items
INSERT INTO public.quote_items (quote_id, catalog_part_id, part_name, part_spec, unit_price, quantity, part_source)
VALUES
  ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0009-000000000001', 'Oil Filter Cartridge', 'TB-FLT-001', 450.00, 1, 'service_centre'),
  ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0009-000000000004', 'Diesel Fuel Filter Element', 'TB-FUL-004', 380.00, 1, 'service_centre')
ON CONFLICT DO NOTHING;

-- 9. Seed Part Request
INSERT INTO public.service_centre_part_requests (repair_request_id, part_id, quantity, status, requested_by)
VALUES
  ('00000000-0000-0000-0005-000000000001', '00000000-0000-0000-0009-000000000001', 1, 'PENDING', '00000000-0000-0000-0002-000000000001');

-- 10. Seed Dispatch Location
INSERT INTO public.repair_dispatch_locations (repair_request_id, latitude, longitude, accuracy)
VALUES
  ('00000000-0000-0000-0005-000000000001', 18.1517, 74.5774, 5.0);

COMMIT;
"""

with open("scratch/staging_synthetic_seed.sql", "w") as f:
    f.write(seed_sql)

cmd = [PSQL, "-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "terabyte_schema_only_drill", "-w", "-f", "scratch/staging_synthetic_seed.sql"]
res = subprocess.run(cmd, capture_output=True, text=True, env=env)
err_lines = [l for l in res.stderr.splitlines() if "ERROR" in l]
print(f"Synthetic seed drill: ExitCode={res.returncode}, Errors={len(err_lines)}")
if err_lines:
    for e in err_lines:
        print("  ->", e)

# Check row counts in tables
check_sql = """
SELECT 'profiles' as tbl, count(*) FROM public.profiles
UNION ALL SELECT 'equipment', count(*) FROM public.equipment
UNION ALL SELECT 'technician_profiles', count(*) FROM public.technician_profiles
UNION ALL SELECT 'service_centre_parts', count(*) FROM public.service_centre_parts
UNION ALL SELECT 'repair_requests', count(*) FROM public.repair_requests
UNION ALL SELECT 'quotes', count(*) FROM public.quotes
UNION ALL SELECT 'quote_items', count(*) FROM public.quote_items
UNION ALL SELECT 'service_centre_part_requests', count(*) FROM public.service_centre_part_requests
UNION ALL SELECT 'repair_dispatch_locations', count(*) FROM public.repair_dispatch_locations;
"""
cmd = [PSQL, "-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "terabyte_schema_only_drill", "-w", "-c", check_sql]
res = subprocess.run(cmd, capture_output=True, text=True, env=env)
print(res.stdout)
