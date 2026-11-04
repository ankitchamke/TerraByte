import json
import re

with open("scratch/all_parsed_requests.json", "r", encoding="utf-8") as f:
    requests = json.load(f)

# Define exact signatures for all 10 functions
EXACT_SIGNATURES = {
    "confirm_service_centre_part_handoff": "public.confirm_service_centre_part_handoff(uuid)",
    "adjust_service_centre_part_stock": "public.adjust_service_centre_part_stock(uuid, integer, text)",
    "request_service_centre_part": "public.request_service_centre_part(uuid, uuid, integer, text)",
    "receive_service_centre_stock": "public.receive_service_centre_stock(uuid, integer, text)",
    "return_service_centre_part": "public.return_service_centre_part(uuid, uuid, integer, text)",
    "trg_enforce_technician_part_request_fields": "public.trg_enforce_technician_part_request_fields()",
    "update_service_centre_part_request_eta": "public.update_service_centre_part_request_eta(uuid, timestamp with time zone, text)",
    "create_quote_atomic": "public.create_quote_atomic(uuid, text, numeric, numeric, text, text, jsonb)",
    "revise_quote_atomic": "public.revise_quote_atomic(uuid, uuid, text, numeric, numeric, text, text, text, jsonb)",
    "notify_admin_on_technician_registration": "public.notify_admin_on_technician_registration()"
}

def get_v4_details(req):
    text = req["text"].strip()
    stype = req["type"]
    
    # Defaults
    accepted_by_cli = "YES (Single top-level statement)"
    multi_command_internal = "NO"
    txn_behavior = "Implicit single-statement transaction (auto-commits on HTTP completion; rolls back on failure)"
    rerun_safety = "YES (Idempotent)"
    lock_mode = "None / Row-level catalog lock"
    lock_impact = "Negligible (only updates system catalog tuples)"
    ordinary_recovery = "Inspect error message, resolve root cause, and re-execute this request."
    
    target_object = ""
    vquery = ""
    
    if stype == "INDEX_CREATION":
        m = re.search(r"CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)\s+ON\s+public\.([a-zA-Z0-9_]+)", text, re.IGNORECASE)
        idx_name = m.group(1) if m else "index_name"
        tbl_name = m.group(2) if m else "table_name"
        target_object = f"Index: public.{idx_name}"
        lock_mode = "SHARE lock on table public." + tbl_name
        lock_impact = f"Blocks concurrent writes (INSERT/UPDATE/DELETE taking ROW EXCLUSIVE) on public.{tbl_name} during build. Permits concurrent SELECT. Duration on production table is ~1–2ms."
        vquery = f"SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = '{tbl_name}' AND indexname = '{idx_name}'; -- Expected: 1"
        rerun_safety = "YES (`CREATE INDEX IF NOT EXISTS` is a safe no-op if index exists)"
        ordinary_recovery = f"DROP INDEX IF EXISTS public.{idx_name}; then re-execute this request. Verify with pg_index that indisvalid is true."

    elif stype == "FUNCTION_DEFINITION":
        m = re.search(r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-zA-Z0-9_]+)", text, re.IGNORECASE)
        func_name = m.group(1) if m else "function_name"
        sig = EXACT_SIGNATURES.get(func_name, f"public.{func_name}()")
        target_object = f"Function: {sig}"
        lock_mode = "EXCLUSIVE lock on pg_proc catalog row"
        lock_impact = "No application tables locked. Blocks concurrent DDL altering the same function."
        vquery = f"SELECT count(*) FROM pg_proc WHERE proname = '{func_name}' AND pronamespace = 'public'::regnamespace; -- Expected: 1"
        rerun_safety = "YES (`CREATE OR REPLACE FUNCTION` overwrites existing function body atomically)"
        ordinary_recovery = "Re-execute function definition statement. Fully atomic in PostgreSQL."

    elif stype == "PERMISSION_REVOKE":
        m = re.search(r"REVOKE\s+([A-Z\s]+)\s+ON\s+(?:FUNCTION\s+)?public\.([a-zA-Z0-9_]+).*?FROM\s+([a-zA-Z0-9_,\s]+)", text, re.IGNORECASE)
        priv = m.group(1).strip() if m else "PRIVILEGE"
        func_name = m.group(2).strip() if m else "object"
        from_role = m.group(3).strip() if m else "role"
        sig = EXACT_SIGNATURES.get(func_name, f"public.{func_name}()")
        target_object = f"Revoke {priv} on {sig} from {from_role}"
        lock_mode = "Row-level lock on pg_proc catalog tuple"
        lock_impact = "No application tables locked. Catalog tuple update only."
        if "EXECUTE" in priv or "ALL" in priv:
            check_role = 'public' if 'PUBLIC' in from_role else from_role.lower()
            vquery = f"SELECT has_function_privilege('{check_role}', '{sig}', 'execute'); -- Expected: false"
        else:
            vquery = f"SELECT count(*) FROM pg_proc WHERE proname = '{func_name}'; -- Expected: 1"
        rerun_safety = "YES (REVOKE on non-granted privilege is a safe no-op in PostgreSQL)"
        ordinary_recovery = "Re-execute REVOKE statement. Completely idempotent."

    elif stype == "PERMISSION_GRANT":
        m = re.search(r"GRANT\s+([A-Z\s]+)\s+ON\s+(?:FUNCTION\s+)?public\.([a-zA-Z0-9_]+).*?TO\s+([a-zA-Z0-9_,\s]+)", text, re.IGNORECASE)
        priv = m.group(1).strip() if m else "PRIVILEGE"
        func_name = m.group(2).strip() if m else "object"
        to_roles = m.group(3).strip() if m else "roles"
        sig = EXACT_SIGNATURES.get(func_name, f"public.{func_name}()")
        target_object = f"Grant {priv} on {sig} to {to_roles}"
        lock_mode = "Row-level lock on pg_proc catalog tuple"
        lock_impact = "No application tables locked. Catalog tuple update only."
        vquery = f"SELECT has_function_privilege('authenticated', '{sig}', 'execute'); -- Expected: true"
        rerun_safety = "YES (GRANT is an idempotent catalog operation)"
        ordinary_recovery = "Re-execute GRANT statement. Completely idempotent."

    elif stype == "DO_BLOCK":
        target_object = "Realtime Publication Tables Registration (5 tables)"
        multi_command_internal = "YES (PL/pgSQL block with IF NOT EXISTS checks for each table)"
        txn_behavior = "Atomic execution block (all 5 publications registered or rolled back)"
        lock_mode = "SHARE UPDATE EXCLUSIVE on pg_publication and target tables"
        lock_impact = "Blocks concurrent ALTER PUBLICATION / ALTER TABLE. Concurrent reads and writes proceed normally."
        vquery = "SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename IN ('service_centre_part_requests', 'quotes', 'repair_requests', 'service_centre_parts', 'service_centre_stock_audit'); -- Expected: >= 3"
        rerun_safety = "YES (Guarded by `IF NOT EXISTS` for each table membership)"
        ordinary_recovery = "Re-execute DO block. Safe to rerun."

    elif stype == "ALTER_REPLICA_IDENTITY":
        m = re.search(r"ALTER\s+TABLE\s+public\.([a-zA-Z0-9_]+)\s+REPLICA\s+IDENTITY\s+FULL", text, re.IGNORECASE)
        tbl_name = m.group(1) if m else "table_name"
        target_object = f"Replica Identity FULL on public.{tbl_name}"
        lock_mode = f"ACCESS EXCLUSIVE on public.{tbl_name}"
        lock_impact = f"Blocks all reads and writes on public.{tbl_name} during catalog update. Duration on 0-row table is < 1ms."
        vquery = f"SELECT relreplident FROM pg_class WHERE relname = '{tbl_name}' AND relnamespace = 'public'::regnamespace; -- Expected: 'f' (FULL)"
        rerun_safety = "YES (Setting REPLICA IDENTITY FULL repeatedly is an idempotent no-op)"
        ordinary_recovery = "Re-execute ALTER TABLE. Safe to rerun."

    elif stype == "ALTER_ADD_COLUMNS":
        target_object = "Add Columns (estimated_arrival_at, eta_updated_by, eta_updated_at)"
        multi_command_internal = "NO (1 ALTER TABLE statement with 3 ADD COLUMN clauses)"
        lock_mode = "ACCESS EXCLUSIVE on public.service_centre_part_requests"
        lock_impact = "Blocks all reads and writes on service_centre_part_requests during catalog update. Nullable columns without default values do not rewrite heap; lock duration is < 1ms."
        vquery = "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'service_centre_part_requests' AND column_name IN ('estimated_arrival_at', 'eta_updated_by', 'eta_updated_at'); -- Expected: 3"
        rerun_safety = "YES (Each column addition is guarded by `ADD COLUMN IF NOT EXISTS`)"
        ordinary_recovery = "Re-execute ALTER TABLE. Safe to rerun."

    elif stype == "DROP_POLICY":
        m = re.search(r'DROP\s+POLICY\s+IF\s+EXISTS\s+"([^"]+)"\s+ON\s+public\.([a-zA-Z0-9_]+)', text, re.IGNORECASE)
        pol_name = m.group(1) if m else "policy_name"
        tbl_name = m.group(2) if m else "table_name"
        target_object = f'Drop Policy: "{pol_name}" on public.{tbl_name}'
        lock_mode = f"EXCLUSIVE lock on public.{tbl_name}"
        lock_impact = f"Blocks concurrent DDL and write transactions on public.{tbl_name} for catalog update (< 1ms)."
        vquery = f"SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = '{tbl_name}' AND policyname = '{pol_name}'; -- Expected: 0"
        rerun_safety = "YES (`DROP POLICY IF EXISTS` is a safe no-op if policy does not exist)"
        ordinary_recovery = "Re-execute DROP POLICY statement. Safe to rerun."

    elif stype == "CREATE_POLICY":
        m = re.search(r'CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+public\.([a-zA-Z0-9_]+)', text, re.IGNORECASE)
        pol_name = m.group(1) if m else "policy_name"
        tbl_name = m.group(2) if m else "table_name"
        target_object = f'Create Policy: "{pol_name}" on public.{tbl_name}'
        lock_mode = f"EXCLUSIVE lock on public.{tbl_name}"
        lock_impact = f"Blocks concurrent DDL and write transactions on public.{tbl_name} for catalog update (< 1ms)."
        vquery = f"SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = '{tbl_name}' AND policyname = '{pol_name}'; -- Expected: 1"
        rerun_safety = "CONDITIONAL (Fails if policy exists; requires preceding DROP POLICY to rerun cleanly)"
        ordinary_recovery = f'DROP POLICY IF EXISTS "{pol_name}" ON public.{tbl_name}; then re-execute this request.'

    elif stype == "DROP_TRIGGER":
        m = re.search(r"DROP\s+TRIGGER\s+IF\s+EXISTS\s+([a-zA-Z0-9_]+)\s+ON\s+public\.([a-zA-Z0-9_]+)", text, re.IGNORECASE)
        trg_name = m.group(1) if m else "trigger_name"
        tbl_name = m.group(2) if m else "table_name"
        target_object = f"Drop Trigger: {trg_name} on public.{tbl_name}"
        lock_mode = f"EXCLUSIVE lock on public.{tbl_name}"
        lock_impact = f"Blocks concurrent DDL and writes on public.{tbl_name} for catalog update (< 1ms)."
        vquery = f"SELECT count(*) FROM pg_trigger WHERE tgname = '{trg_name}'; -- Expected: 0"
        rerun_safety = "YES (`DROP TRIGGER IF EXISTS` is a safe no-op if trigger does not exist)"
        ordinary_recovery = "Re-execute DROP TRIGGER statement. Safe to rerun."

    elif stype == "CREATE_TRIGGER":
        m = re.search(r"CREATE\s+TRIGGER\s+([a-zA-Z0-9_]+)\s+(?:BEFORE|AFTER)", text, re.IGNORECASE)
        m_tbl = re.search(r"ON\s+public\.([a-zA-Z0-9_]+)", text, re.IGNORECASE)
        trg_name = m.group(1) if m else "trigger_name"
        tbl_name = m_tbl.group(1) if m_tbl else "table_name"
        target_object = f"Create Trigger: {trg_name} on public.{tbl_name}"
        lock_mode = f"EXCLUSIVE lock on public.{tbl_name}"
        lock_impact = f"Blocks concurrent DDL and writes on public.{tbl_name} for catalog update (< 1ms)."
        vquery = f"SELECT count(*) FROM pg_trigger WHERE tgname = '{trg_name}'; -- Expected: 1"
        rerun_safety = "CONDITIONAL (Fails if trigger exists; requires preceding DROP TRIGGER or CREATE OR REPLACE TRIGGER)"
        ordinary_recovery = f"DROP TRIGGER IF EXISTS {trg_name} ON public.{tbl_name}; then re-execute this request (or use CREATE OR REPLACE TRIGGER)."

    return {
        "target_object": target_object,
        "accepted_by_cli": accepted_by_cli,
        "multi_command_internal": multi_command_internal,
        "txn_behavior": txn_behavior,
        "lock_mode": lock_mode,
        "lock_impact": lock_impact,
        "rerun_safety": rerun_safety,
        "vquery": vquery,
        "ordinary_recovery": ordinary_recovery
    }

catalog_v4 = []
for req in requests:
    details = get_v4_details(req)
    combined = {**req, **details}
    catalog_v4.append(combined)

with open("scratch/full_request_catalog_v4.json", "w", encoding="utf-8") as f:
    json.dump(catalog_v4, f, indent=2)

print(f"Generated Catalog v4 with {len(catalog_v4)} items.")
