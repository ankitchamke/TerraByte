-- 1. Trigger on service_centre_part_requests
SELECT 
  'Trigger 1' AS test_name,
  tg.tgname,
  c.relname AS table_name,
  n.nspname AS schema_name,
  tg.tgenabled,
  p.proname AS trigger_function
FROM pg_trigger tg
JOIN pg_class c ON c.oid = tg.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = tg.tgfoid
WHERE n.nspname = 'public'
  AND c.relname = 'service_centre_part_requests'
  AND tg.tgname = 'trg_protect_technician_part_request_fields'
  AND tg.tgenabled = 'O'
  AND p.proname = 'trg_enforce_technician_part_request_fields'
  AND NOT tg.tgisinternal;

-- 2. Trigger on technician_profiles
SELECT 
  'Trigger 2' AS test_name,
  tg.tgname,
  c.relname AS table_name,
  n.nspname AS schema_name,
  tg.tgenabled,
  p.proname AS trigger_function
FROM pg_trigger tg
JOIN pg_class c ON c.oid = tg.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = tg.tgfoid
WHERE n.nspname = 'public'
  AND c.relname = 'technician_profiles'
  AND tg.tgname = 'trg_notify_admin_on_technician_registration'
  AND tg.tgenabled = 'O'
  AND p.proname = 'notify_admin_on_technician_registration'
  AND NOT tg.tgisinternal;

-- 3. RLS Policy on service_centre_part_requests
SELECT 
  'RLS Policy' AS test_name,
  schemaname,
  tablename,
  policyname,
  cmd,
  roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'service_centre_part_requests'
  AND policyname = 'service_centre_part_requests_update_technician_or_admin';

-- 4. Index on service_centre_part_requests
SELECT 
  'Index' AS test_name,
  c.relname AS index_name,
  t.relname AS table_name,
  i.indisvalid,
  i.indisready
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_class t ON t.oid = i.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname = 'service_centre_part_requests'
  AND c.relname = 'idx_service_centre_part_requests_repair_status'
  AND i.indisvalid = true;

-- 5. Replica Identity on service_centre_part_requests
SELECT 
  'Replica Identity' AS test_name,
  c.relname,
  c.relreplident
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'service_centre_part_requests'
  AND c.relreplident = 'f';

-- 6. Realtime Publication Membership
SELECT 
  'Realtime Pub' AS test_name,
  pubname,
  schemaname,
  tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND schemaname = 'public'
  AND tablename = 'service_centre_part_requests';

-- 7. ETA Columns
SELECT 
  'Columns' AS test_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'service_centre_part_requests'
  AND column_name IN ('estimated_arrival_at', 'eta_updated_by', 'eta_updated_at')
ORDER BY column_name;
