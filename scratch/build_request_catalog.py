import json

with open("scratch/all_parsed_requests.json", "r", encoding="utf-8") as f:
    requests = json.load(f)

# Verification query generator based on statement characteristics
def get_verification_details(req):
    text = req["text"].strip()
    stype = req["type"]
    lines = [l for l in text.split("\n") if l.strip() and not l.strip().startswith("--")]
    
    # Defaults
    accepted_by_cli = "YES (Single top-level statement)"
    multi_command_internal = "NO"
    txn_behavior = "Implicit single-statement transaction (auto-commits on HTTP response)"
    rerun_safety = "YES (Idempotent)"
    recovery = "Review error log, resolve root cause, and re-execute this request."
    
    vquery = ""
    target_object = ""
    
    if stype == "INDEX_CREATION":
        # Extract index name
        import re
        m = re.search(r"CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)\s+ON\s+public\.([a-zA-Z0-9_]+)", text, re.IGNORECASE)
        idx_name = m.group(1) if m else "index_name"
        tbl_name = m.group(2) if m else "table_name"
        target_object = f"Index: public.{idx_name}"
        vquery = f"SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = '{tbl_name}' AND indexname = '{idx_name}'; -- Expected: 1"
        rerun_safety = "YES (`CREATE INDEX IF NOT EXISTS` is a no-op if index exists)"
        recovery = f"DROP INDEX IF EXISTS public.{idx_name}; and retry."

    elif stype == "FUNCTION_DEFINITION":
        import re
        m = re.search(r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-zA-Z0-9_]+)", text, re.IGNORECASE)
        func_name = m.group(1) if m else "function_name"
        target_object = f"Function: public.{func_name}()"
        vquery = f"SELECT count(*) FROM pg_proc WHERE proname = '{func_name}' AND pronamespace = 'public'::regnamespace; -- Expected: 1"
        rerun_safety = "YES (`CREATE OR REPLACE FUNCTION` overwrites existing function body)"
        recovery = f"Inspect pg_proc for {func_name}. Function creation is atomic; re-executing replaces cleanly."

    elif stype == "PERMISSION_REVOKE":
        import re
        m = re.search(r"REVOKE\s+([A-Z\s]+)\s+ON\s+(?:FUNCTION\s+)?public\.([a-zA-Z0-9_]+)", text, re.IGNORECASE)
        priv = m.group(1).strip() if m else "PRIVILEGE"
        obj_name = m.group(2).strip() if m else "object"
        target_object = f"Revoke {priv} on public.{obj_name}"
        vquery = f"SELECT has_function_privilege('public', 'public.{obj_name}()', 'execute'); -- Expected: false" if "EXECUTE" in priv else f"SELECT count(*) FROM pg_proc WHERE proname = '{obj_name}'; -- Expected: 1"
        rerun_safety = "YES (REVOKE on non-existent grant is a safe no-op in PostgreSQL)"
        recovery = "Re-execute REVOKE; idempotent."

    elif stype == "PERMISSION_GRANT":
        import re
        m = re.search(r"GRANT\s+([A-Z\s]+)\s+ON\s+(?:FUNCTION\s+)?public\.([a-zA-Z0-9_]+)\s+TO\s+([a-zA-Z0-9_,\s]+)", text, re.IGNORECASE)
        priv = m.group(1).strip() if m else "PRIVILEGE"
        obj_name = m.group(2).strip() if m else "object"
        roles = m.group(3).strip() if m else "roles"
        target_object = f"Grant {priv} on public.{obj_name} to {roles}"
        vquery = f"SELECT has_function_privilege('authenticated', 'public.{obj_name}()', 'execute'); -- Expected: true"
        rerun_safety = "YES (GRANT is an idempotent catalog operation)"
        recovery = "Re-execute GRANT; idempotent."

    elif stype == "DO_BLOCK":
        target_object = "Realtime Publication Tables Registration"
        multi_command_internal = "YES (PL/pgSQL block evaluates IF NOT EXISTS logic for 5 tables)"
        txn_behavior = "Atomic execution block (all 5 publications registered or rolled back)"
        vquery = "SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename IN ('service_centre_part_requests', 'quotes', 'repair_requests', 'service_centre_parts', 'service_centre_stock_audit'); -- Expected: >= 3"
        rerun_safety = "YES (Guarded by `IF NOT EXISTS` for each table membership)"
        recovery = "Re-execute DO block. Safe to rerun."

    elif stype == "ALTER_REPLICA_IDENTITY":
        import re
        m = re.search(r"ALTER\s+TABLE\s+public\.([a-zA-Z0-9_]+)\s+REPLICA\s+IDENTITY\s+FULL", text, re.IGNORECASE)
        tbl_name = m.group(1) if m else "table_name"
        target_object = f"Replica Identity FULL on public.{tbl_name}"
        vquery = f"SELECT relreplident FROM pg_class WHERE relname = '{tbl_name}' AND relnamespace = 'public'::regnamespace; -- Expected: 'f' (FULL)"
        rerun_safety = "YES (Setting REPLICA IDENTITY FULL repeatedly is a safe idempotent no-op)"
        recovery = "Re-execute ALTER TABLE. Safe to rerun."

    elif stype == "ALTER_ADD_COLUMNS":
        target_object = "Columns addition: estimated_arrival_at, eta_updated_by, eta_updated_at"
        multi_command_internal = "NO (1 ALTER TABLE statement with 3 ADD COLUMN clauses)"
        vquery = "SELECT count(*) FROM information_schema.columns WHERE table_name = 'service_centre_part_requests' AND column_name IN ('estimated_arrival_at', 'eta_updated_by', 'eta_updated_at'); -- Expected: 3"
        rerun_safety = "YES (Each column clause guarded by `ADD COLUMN IF NOT EXISTS`)"
        recovery = "Re-execute ALTER TABLE. Safe to rerun."

    elif stype == "DROP_POLICY":
        import re
        m = re.search(r'DROP\s+POLICY\s+IF\s+EXISTS\s+"([^"]+)"\s+ON\s+public\.([a-zA-Z0-9_]+)', text, re.IGNORECASE)
        pol_name = m.group(1) if m else "policy_name"
        tbl_name = m.group(2) if m else "table_name"
        target_object = f'Drop Policy: "{pol_name}" on public.{tbl_name}'
        vquery = f"SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = '{tbl_name}' AND policyname = '{pol_name}'; -- Expected: 0"
        rerun_safety = "YES (`DROP POLICY IF EXISTS` is a safe no-op if policy does not exist)"
        recovery = "Re-execute DROP POLICY. Safe to rerun."

    elif stype == "CREATE_POLICY":
        import re
        m = re.search(r'CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+public\.([a-zA-Z0-9_]+)', text, re.IGNORECASE)
        pol_name = m.group(1) if m else "policy_name"
        tbl_name = m.group(2) if m else "table_name"
        target_object = f'Create Policy: "{pol_name}" on public.{tbl_name}'
        vquery = f"SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = '{tbl_name}' AND policyname = '{pol_name}'; -- Expected: 1"
        rerun_safety = "CONDITIONAL (Fails if policy exists; requires preceding DROP POLICY to rerun cleanly)"
        recovery = f'DROP POLICY IF EXISTS "{pol_name}" ON public.{tbl_name}; then re-execute CREATE POLICY.'

    elif stype == "DROP_TRIGGER":
        import re
        m = re.search(r"DROP\s+TRIGGER\s+IF\s+EXISTS\s+([a-zA-Z0-9_]+)\s+ON\s+public\.([a-zA-Z0-9_]+)", text, re.IGNORECASE)
        trg_name = m.group(1) if m else "trigger_name"
        tbl_name = m.group(2) if m else "table_name"
        target_object = f"Drop Trigger: {trg_name} on public.{tbl_name}"
        vquery = f"SELECT count(*) FROM pg_trigger WHERE tgname = '{trg_name}'; -- Expected: 0"
        rerun_safety = "YES (`DROP TRIGGER IF EXISTS` is a safe no-op if trigger does not exist)"
        recovery = "Re-execute DROP TRIGGER. Safe to rerun."

    elif stype == "CREATE_TRIGGER":
        import re
        m = re.search(r"CREATE\s+TRIGGER\s+([a-zA-Z0-9_]+)\s+(?:BEFORE|AFTER)", text, re.IGNORECASE)
        m_tbl = re.search(r"ON\s+public\.([a-zA-Z0-9_]+)", text, re.IGNORECASE)
        trg_name = m.group(1) if m else "trigger_name"
        tbl_name = m_tbl.group(1) if m_tbl else "table_name"
        target_object = f"Create Trigger: {trg_name} on public.{tbl_name}"
        vquery = f"SELECT count(*) FROM pg_trigger WHERE tgname = '{trg_name}'; -- Expected: 1"
        rerun_safety = "CONDITIONAL (Fails if trigger exists; requires preceding DROP TRIGGER to rerun cleanly, or `CREATE OR REPLACE TRIGGER`)"
        recovery = f"DROP TRIGGER IF EXISTS {trg_name} ON public.{tbl_name}; then re-execute CREATE TRIGGER."

    return {
        "target_object": target_object,
        "accepted_by_cli": accepted_by_cli,
        "multi_command_internal": multi_command_internal,
        "txn_behavior": txn_behavior,
        "rerun_safety": rerun_safety,
        "vquery": vquery,
        "recovery": recovery
    }

catalog = []
for req in requests:
    details = get_verification_details(req)
    combined = {**req, **details}
    catalog.append(combined)

with open("scratch/full_request_catalog.json", "w", encoding="utf-8") as f:
    json.dump(catalog, f, indent=2)

print(f"Generated catalog with {len(catalog)} items.")
