import subprocess
import os
import json

PG_BIN = r"D:\TerraByte_Drill\pgsql17\pgsql\bin"
PSQL = os.path.join(PG_BIN, "psql.exe")
env = os.environ.copy()
env["PGPASSWORD"] = "postgres"

sql = """
SELECT 
  p.proname as routine_name,
  n.nspname as routine_schema,
  pg_get_function_result(p.oid) as result_type,
  pg_get_function_arguments(p.oid) as arguments,
  CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END as sec_type,
  d.description as comment
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
LEFT JOIN pg_description d ON d.objoid = p.oid
WHERE n.nspname = 'public'
ORDER BY p.proname;
"""

cmd = [PSQL, "-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "terabyte_step5b18_drill", "-w", "-c", sql]
res = subprocess.run(cmd, capture_output=True, text=True, env=env)

# Also check extensions installed in public schema
ext_sql = "SELECT extname, extversion FROM pg_extension;"
cmd_ext = [PSQL, "-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "terabyte_step5b18_drill", "-w", "-c", ext_sql]
res_ext = subprocess.run(cmd_ext, capture_output=True, text=True, env=env)

print("=== EXTENSIONS INSTALLED ===")
print(res_ext.stdout)

# Parse pg_proc output
print("=== PG_PROC ROUTINES IN PUBLIC SCHEMA ===")
lines = res.stdout.splitlines()
print(f"Total lines in psql output: {len(lines)}")

# Also let's categorize:
# 1. pgcrypto functions
# 2. uuid-ossp functions
# 3. TerraByte custom application functions
# 4. Trigger functions
pgcrypto_funcs = {
    "armor", "dearmor", "decrypt", "decrypt_iv", "digest", "encrypt", "encrypt_iv",
    "gen_random_bytes", "gen_salt", "hmac", "pgp_armor_headers", "pgp_key_id",
    "pgp_pub_decrypt", "pgp_pub_decrypt_bytea", "pgp_pub_encrypt", "pgp_pub_encrypt_bytea",
    "pgp_sym_decrypt", "pgp_sym_decrypt_bytea", "pgp_sym_encrypt", "pgp_sym_encrypt_bytea", "crypt"
}

uuid_ossp_funcs = {
    "uuid_generate_v1", "uuid_generate_v1mc", "uuid_generate_v3", "uuid_generate_v4",
    "uuid_generate_v5", "uuid_nil", "uuid_ns_dns", "uuid_ns_oid", "uuid_ns_url", "uuid_ns_x500"
}

# Let's read types.ts functions
with open("scratch/schema_reconciliation_audit.json") as f:
    audit_data = json.load(f)

# From types.ts position 778
types_funcs = [
    'adjust_service_centre_part_stock', 'admin_provision_staff', 'admin_repair_corrupted_diagnostic',
    'check_table_rls', 'claim_repair_visual_diagnostic', 'confirm_service_centre_part_handoff',
    'create_quote_atomic', 'current_clerk_id', 'current_profile_id', 'current_user_role',
    'delete_user_account', 'finalize_repair_visual_diagnostic_failure', 'get_session_profile',
    'get_storage_buckets', 'grant_repair_visual_consent', 'receive_service_centre_stock',
    'request_service_centre_part', 'reset_demo_data', 'return_service_centre_part',
    'revise_quote_atomic', 'revoke_repair_visual_consent', 'save_repair_visual_diagnostic',
    'update_service_centre_part_request_eta'
]

print(f"Functions in types.ts: {len(types_funcs)}")

# Write detailed comparison
cmd_names = [PSQL, "-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "terabyte_step5b18_drill", "-w", "-t", "-c", 
             "SELECT proname FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' ORDER BY proname;"]
res_names = subprocess.run(cmd_names, capture_output=True, text=True, env=env)
all_pg_routines = [l.strip() for l in res_names.stdout.splitlines() if l.strip()]

print(f"\nTotal pg_proc rows in public: {len(all_pg_routines)}")
distinct_names = sorted(list(set(all_pg_routines)))
print(f"Distinct routine names: {len(distinct_names)}")

custom_app_funcs = []
pgcrypto_present = []
uuid_present = []
other = []

for r in distinct_names:
    if r in pgcrypto_funcs:
        pgcrypto_present.append(r)
    elif r in uuid_ossp_funcs:
        uuid_present.append(r)
    elif r in types_funcs:
        custom_app_funcs.append(r)
    else:
        other.append(r)

print(f"\nBreakdown of {len(distinct_names)} distinct routines in public schema:")
print(f"  1. Custom Application Functions in types.ts: {len(custom_app_funcs)}")
print(f"  2. pgcrypto Extension Functions: {len(pgcrypto_present)}")
print(f"  3. uuid-ossp Extension Functions: {len(uuid_present)}")
print(f"  4. Other Functions (e.g. Triggers not exposed in types.ts): {len(other)}")
print("     Other functions list:", other)

print(f"\nOverloaded routines check (rows vs distinct names): {len(all_pg_routines) - len(distinct_names)} overloads")
