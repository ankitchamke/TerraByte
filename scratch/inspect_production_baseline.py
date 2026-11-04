import subprocess
import json
import os

def run_remote_query(sql):
    single_line_sql = " ".join(sql.strip().split())
    cmd = ["npx", "supabase", "db", "query", "--remote", "--read-only", single_line_sql]
    res = subprocess.run(cmd, capture_output=True, text=True, shell=True)
    if res.returncode != 0:
        print(f"ERROR executing SQL: {single_line_sql[:60]}...")
        print("STDERR:", res.stderr)
        return []
    
    stdout = res.stdout.strip()
    lines = stdout.split("\n")
    json_str = ""
    for i, line in enumerate(lines):
        if line.strip().startswith("{"):
            json_str = "\n".join(lines[i:])
            break
            
    if not json_str:
        print("No JSON found in stdout:", stdout[:200])
        return []
        
    try:
        data = json.loads(json_str)
        return data.get("rows", [])
    except Exception as e:
        print("JSON parse error:", e, "on:", json_str[:200])
        return []

print("=== 1. Production Migration History ===")
rows = run_remote_query("SELECT version, inserted_at FROM supabase_migrations.schema_migrations ORDER BY version;")
print(f"Total applied migrations on remote: {len(rows)}")
for r in rows:
    print(f"  {r.get('version')} | {r.get('inserted_at')}")

print("\n=== 2. Realtime Publication Tables ===")
rows = run_remote_query("SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY tablename;")
print("Tables in supabase_realtime:")
for r in rows:
    print(f"  {r.get('tablename')}")

print("\n=== 3. Replica Identity Status ===")
rows = run_remote_query("""
SELECT c.relname, 
       CASE c.relreplident
         WHEN 'd' THEN 'default (primary key)'
         WHEN 'n' THEN 'nothing'
         WHEN 'f' THEN 'full (entire row)'
         WHEN 'i' THEN 'index'
       END as replica_identity
FROM pg_class c 
JOIN pg_namespace n ON c.relnamespace = n.oid 
WHERE n.nspname = 'public' 
  AND c.relname IN ('service_centre_parts', 'service_centre_inventory_audit', 'service_centre_part_requests', 'quotes', 'quote_items', 'repair_requests', 'profiles')
ORDER BY c.relname;
""")
for r in rows:
    print(f"  {r.get('relname'):<30} | {r.get('replica_identity')}")

print("\n=== 4. Target RPC Function Definitions & Signatures ===")
rows = run_remote_query("""
SELECT p.proname, 
       pg_get_function_identity_arguments(p.oid) as args,
       r.rolname as owner,
       p.prosecdef as is_security_definer
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
JOIN pg_roles r ON p.proowner = r.oid
WHERE n.nspname = 'public'
  AND p.proname IN (
    'receive_service_centre_stock',
    'request_service_centre_part',
    'adjust_service_centre_stock',
    'confirm_service_centre_part_handoff',
    'return_service_centre_part',
    'update_service_centre_part_request_eta',
    'create_quote_atomic',
    'revise_quote_atomic',
    'notify_admin_on_technician_registration'
  )
ORDER BY p.proname;
""")
print(f"Target RPCs existing in production: {len(rows)}")
for r in rows:
    print(f"  {r.get('proname'):<40} | secdef={r.get('is_security_definer')} | args: {r.get('args')}")

print("\n=== 5. Target Indexes in Production ===")
rows = run_remote_query("""
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND (
    indexname IN (
      'idx_service_centre_inventory_audit_repair_part',
      'idx_service_centre_inventory_audit_request_id',
      'idx_service_centre_part_requests_repair_id',
      'idx_service_centre_part_requests_status',
      'idx_repair_requests_parts_hold'
    )
    OR tablename IN ('service_centre_parts', 'service_centre_part_requests', 'service_centre_inventory_audit')
  )
ORDER BY tablename, indexname;
""")
print(f"Indexes found: {len(rows)}")
for r in rows:
    print(f"  {r.get('tablename'):<30} | {r.get('indexname'):<45}")

print("\n=== 6. Triggers in Production ===")
rows = run_remote_query("""
SELECT c.relname as table_name,
       t.tgname as trigger_name,
       p.proname as function_name,
       t.tgenabled
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_proc p ON t.tgfoid = p.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'public'
  AND c.relname IN ('service_centre_part_requests', 'profiles', 'quotes', 'repair_requests')
  AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;
""")
print(f"Triggers found: {len(rows)}")
for r in rows:
    print(f"  {r.get('table_name'):<30} | {r.get('trigger_name'):<45} | fn: {r.get('function_name')}")

print("\n=== 7. Columns of service_centre_part_requests in Production ===")
rows = run_remote_query("""
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'service_centre_part_requests'
ORDER BY ordinal_position;
""")
print("service_centre_part_requests columns:")
for r in rows:
    print(f"  {r.get('column_name'):<25} | {r.get('data_type'):<25} | nullable={r.get('is_nullable'):<5} | default={r.get('column_default')}")
