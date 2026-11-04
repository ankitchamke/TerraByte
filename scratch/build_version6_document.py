import json
import re

with open("scratch/full_request_catalog_v4.json", "r", encoding="utf-8") as f:
    catalog = json.load(f)

# Strengthen verification queries across all 55 requests
for r in catalog:
    stype = r["type"]
    text = r["text"].strip()
    uid = r["unit_id"]
    
    if stype == "FUNCTION_DEFINITION":
        m = re.search(r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-zA-Z0-9_]+)", text, re.IGNORECASE)
        fname = m.group(1) if m else "func"
        r["strengthened_vquery"] = f"""SELECT 
  proname, 
  prosecdef, 
  proowner::regrole AS owner, 
  proconfig,
  NOT EXISTS (SELECT 1 FROM aclexplode(proacl) WHERE grantee = 0) AS public_has_no_execute,
  NOT EXISTS (SELECT 1 FROM aclexplode(proacl) WHERE grantee = 'anon'::regrole) AS anon_has_no_execute,
  EXISTS (SELECT 1 FROM aclexplode(proacl) WHERE grantee = 'authenticated'::regrole AND privilege_type = 'EXECUTE') AS auth_has_execute
FROM pg_proc 
WHERE pronamespace = 'public'::regnamespace AND proname = '{fname}';"""
        r["expected_output"] = "1 row: prosecdef = true, owner = postgres, search_path set, public_has_no_execute = true, anon_has_no_execute = true, auth_has_execute = true"

    elif stype == "PERMISSION_REVOKE":
        m = re.search(r"REVOKE\s+([A-Z\s]+)\s+ON\s+(?:FUNCTION\s+)?public\.([a-zA-Z0-9_]+).*?FROM\s+([a-zA-Z0-9_,\s]+)", text, re.IGNORECASE)
        priv = m.group(1).strip() if m else "PRIVILEGE"
        fname = m.group(2).strip() if m else "object"
        from_role = m.group(3).strip() if m else "role"
        if "PUBLIC" in from_role:
            r["strengthened_vquery"] = f"SELECT NOT EXISTS (SELECT 1 FROM aclexplode(proacl) WHERE grantee = 0) AS public_revoked FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = '{fname}';"
            r["expected_output"] = "public_revoked = true (grantee 0 absent from proacl)"
        else:
            r["strengthened_vquery"] = f"SELECT NOT EXISTS (SELECT 1 FROM aclexplode(proacl) WHERE grantee = '{from_role.lower()}'::regrole) AS role_revoked FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = '{fname}';"
            r["expected_output"] = f"role_revoked = true (grantee {from_role.lower()} absent from proacl)"

    elif stype == "PERMISSION_GRANT":
        m = re.search(r"GRANT\s+([A-Z\s]+)\s+ON\s+(?:FUNCTION\s+)?public\.([a-zA-Z0-9_]+).*?TO\s+([a-zA-Z0-9_,\s]+)", text, re.IGNORECASE)
        priv = m.group(1).strip() if m else "PRIVILEGE"
        fname = m.group(2).strip() if m else "object"
        to_roles = [role.strip().lower() for role in m.group(3).split(",") if role.strip()] if m else ["authenticated"]
        role_checks = " AND ".join([f"EXISTS (SELECT 1 FROM aclexplode(proacl) WHERE grantee = '{role}'::regrole AND privilege_type = 'EXECUTE')" for role in to_roles])
        r["strengthened_vquery"] = f"SELECT {role_checks} AS roles_granted FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = '{fname}';"
        r["expected_output"] = "roles_granted = true (all targeted roles hold EXECUTE in proacl)"

    elif stype == "INDEX_CREATION":
        m = re.search(r"CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)\s+ON\s+public\.([a-zA-Z0-9_]+)", text, re.IGNORECASE)
        idx_name = m.group(1) if m else "index_name"
        tbl_name = m.group(2) if m else "table_name"
        r["strengthened_vquery"] = f"SELECT c.relname AS index_name, i.indisvalid, i.indisready FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = '{idx_name}' AND c.relnamespace = 'public'::regnamespace;"
        r["expected_output"] = f"1 row: index_name = '{idx_name}', indisvalid = true, indisready = true"

    elif stype == "DO_BLOCK":
        r["strengthened_vquery"] = "SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename IN ('service_centre_part_requests', 'quotes', 'repair_requests', 'service_centre_parts', 'service_centre_stock_audit');"
        r["expected_output"] = "count = 5 (all 5 tables registered in supabase_realtime publication)"

    elif stype == "ALTER_REPLICA_IDENTITY":
        m = re.search(r"ALTER\s+TABLE\s+public\.([a-zA-Z0-9_]+)\s+REPLICA\s+IDENTITY\s+FULL", text, re.IGNORECASE)
        tbl_name = m.group(1) if m else "table_name"
        r["strengthened_vquery"] = f"SELECT relname, relreplident FROM pg_class WHERE relname = '{tbl_name}' AND relnamespace = 'public'::regnamespace;"
        r["expected_output"] = f"1 row: relname = '{tbl_name}', relreplident = 'f' (FULL)"

    elif stype == "ALTER_ADD_COLUMNS":
        r["strengthened_vquery"] = "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'service_centre_part_requests' AND column_name IN ('estimated_arrival_at', 'eta_updated_by', 'eta_updated_at') ORDER BY column_name;"
        r["expected_output"] = "3 rows: estimated_arrival_at (timestamptz, YES), eta_updated_at (timestamptz, YES), eta_updated_by (uuid, YES)"

    elif stype == "DROP_POLICY":
        m = re.search(r'DROP\s+POLICY\s+IF\s+EXISTS\s+"([^"]+)"\s+ON\s+public\.([a-zA-Z0-9_]+)', text, re.IGNORECASE)
        pol_name = m.group(1) if m else "policy_name"
        tbl_name = m.group(2) if m else "table_name"
        r["strengthened_vquery"] = f"SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = '{tbl_name}' AND policyname = '{pol_name}';"
        r["expected_output"] = "count = 0 (policy absent)"

    elif stype == "CREATE_POLICY":
        m = re.search(r'CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+public\.([a-zA-Z0-9_]+)', text, re.IGNORECASE)
        pol_name = m.group(1) if m else "policy_name"
        tbl_name = m.group(2) if m else "table_name"
        r["strengthened_vquery"] = f"SELECT policyname, permissive, roles, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = '{tbl_name}' AND policyname = '{pol_name}';"
        r["expected_output"] = f"1 row: policyname = '{pol_name}', cmd = 'UPDATE', roles = '{{authenticated}}', permissive = 'PERMISSIVE'"

    elif stype == "DROP_TRIGGER":
        m = re.search(r"DROP\s+TRIGGER\s+IF\s+EXISTS\s+([a-zA-Z0-9_]+)\s+ON\s+public\.([a-zA-Z0-9_]+)", text, re.IGNORECASE)
        trg_name = m.group(1) if m else "trigger_name"
        tbl_name = m.group(2) if m else "table_name"
        r["strengthened_vquery"] = f"SELECT count(*) FROM pg_trigger WHERE tgname = '{trg_name}';"
        r["expected_output"] = "count = 0 (trigger absent)"

    elif stype == "CREATE_TRIGGER":
        m = re.search(r"CREATE\s+TRIGGER\s+([a-zA-Z0-9_]+)\s+(?:BEFORE|AFTER)", text, re.IGNORECASE)
        m_tbl = re.search(r"ON\s+public\.([a-zA-Z0-9_]+)", text, re.IGNORECASE)
        trg_name = m.group(1) if m else "trigger_name"
        tbl_name = m_tbl.group(1) if m_tbl else "table_name"
        r["strengthened_vquery"] = f"SELECT tgname, tgenabled, tgfoid::regproc AS function_binding FROM pg_trigger WHERE tgname = '{trg_name}';"
        r["expected_output"] = f"1 row: tgname = '{trg_name}', tgenabled = 'O' (enabled), function_binding valid"

with open("scratch/full_request_catalog_v6.json", "w", encoding="utf-8") as f:
    json.dump(catalog, f, indent=2)

print("Saved catalog v6 with strengthened verification queries.")
