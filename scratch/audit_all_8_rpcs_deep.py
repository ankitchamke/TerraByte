import subprocess
import os
import json

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
PORT = "5433"
HOST = "127.0.0.1"
USER = "postgres"
DB = "terabyte_clean_restore_drill"

env = os.environ.copy()
env["PGPASSWORD"] = "postgres"

RPCS = [
    "confirm_service_centre_part_handoff",
    "adjust_service_centre_part_stock",
    "receive_service_centre_stock",
    "return_service_centre_part",
    "request_service_centre_part",
    "update_service_centre_part_request_eta",
    "create_quote_atomic",
    "revise_quote_atomic"
]

sql_query = """
SELECT 
    p.oid as proc_oid,
    n.nspname as schema_name,
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as identity_args,
    pg_get_function_arguments(p.oid) as full_args_with_defaults,
    pg_get_function_result(p.oid) as return_type,
    p.prosecdef as is_security_definer,
    p.provolatile as volatility,
    COALESCE(array_to_string(p.proconfig, ','), 'NONE') as config_search_path,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_execute,
    has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
    has_function_privilege('public', p.oid, 'EXECUTE') as public_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'confirm_service_centre_part_handoff',
    'adjust_service_centre_part_stock',
    'receive_service_centre_stock',
    'return_service_centre_part',
    'request_service_centre_part',
    'update_service_centre_part_request_eta',
    'create_quote_atomic',
    'revise_quote_atomic'
  )
ORDER BY p.proname;
"""

cmd = [PSQL, "-h", HOST, "-p", PORT, "-U", USER, "-d", DB, "-w", "-t", "-A", "-F", "||", "-c", sql_query]
res = subprocess.run(cmd, capture_output=True, text=True, env=env)

records = []
for line in res.stdout.strip().splitlines():
    if not line.strip():
        continue
    parts = line.split("||")
    records.append({
        "proc_oid": parts[0],
        "schema_name": parts[1],
        "function_name": parts[2],
        "identity_args": parts[3],
        "full_args_with_defaults": parts[4],
        "return_type": parts[5],
        "is_security_definer": parts[6] == 't',
        "volatility": parts[7],
        "search_path": parts[8],
        "anon_execute": parts[9] == 't',
        "auth_execute": parts[10] == 't',
        "service_role_execute": parts[11] == 't',
        "public_execute": parts[12] == 't'
    })

print(json.dumps(records, indent=2))
with open("scratch/verified_rpc_catalog_deep.json", "w", encoding="utf-8") as f:
    json.dump(records, f, indent=2)
