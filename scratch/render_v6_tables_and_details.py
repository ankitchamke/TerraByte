import json
import re

with open("scratch/full_request_catalog_v6.json", "r", encoding="utf-8") as f:
    catalog = json.load(f)

mig_a = [r for r in catalog if r["migration_id"] == "A"]
mig_b = [r for r in catalog if r["migration_id"] == "B"]
mig_c = [r for r in catalog if r["migration_id"] == "C"]

def render_table_v6(reqs):
    lines = []
    lines.append("| Request ID | Source Lines | Statement Type | Target Object / Signature | Lock Mode | Idempotent | State-Inspection Before Retry |")
    lines.append("| :--- | :---: | :--- | :--- | :--- | :---: | :--- |")
    for r in reqs:
        short_lock = r['lock_mode'].split(" on ")[0] if " on " in r['lock_mode'] else r['lock_mode']
        # state inspection summary
        if r['type'] == 'CREATE_POLICY':
            insp = "Query pg_policies before retry"
        elif r['type'] == 'CREATE_TRIGGER':
            insp = "Query pg_trigger before retry"
        elif 'INDEX' in r['type']:
            insp = "Query pg_index (indisvalid)"
        elif 'FUNCTION' in r['type']:
            insp = "Safe to re-execute (OR REPLACE)"
        else:
            insp = "Safe to re-execute (Idempotent)"
        lines.append(f"| **`{r['unit_id']}`** | Lines {r['start_line']}–{r['end_line']} | `{r['type']}` | `{r['target_object']}` | {short_lock} | {r['rerun_safety'].split()[0]} | {insp} |")
    return "\n".join(lines)

def render_details_v6(reqs):
    blocks = []
    for r in reqs:
        sql_text = r['text'].strip()
        vq = r['strengthened_vquery'].strip()
        expected = r['expected_output'].strip()

        # Generate state inspection before retry
        stype = r['type']
        if stype == 'CREATE_POLICY':
            state_insp = """```sql
SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'service_centre_part_requests' AND policyname = 'Assigned technicians or admins can update part request ETA';
-- If count = 1: Statement already committed during client timeout; mark SUCCESS and proceed.
-- If count = 0: Statement failed/rolled back. Run DROP POLICY IF EXISTS before re-executing.
```"""
        elif stype == 'CREATE_TRIGGER':
            tname = "trg_protect_technician_part_request_fields" if "protect" in r['target_object'] else "trg_notify_admin_on_technician_registration"
            state_insp = f"""```sql
SELECT count(*), coalesce(max(tgenabled), 'none') FROM pg_trigger WHERE tgname = '{tname}';
-- If count = 1 and tgenabled = 'O': Trigger committed during client timeout; mark SUCCESS.
-- If count = 0: Statement failed/rolled back. Re-execute preceding DROP TRIGGER IF EXISTS or use CREATE OR REPLACE TRIGGER.
```"""
        elif stype == 'INDEX_CREATION':
            m = re.search(r"INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)", sql_text)
            iname = m.group(1) if m else "idx"
            state_insp = f"""```sql
SELECT c.relname, i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = '{iname}';
-- If count = 1 and indisvalid = true: Index committed; mark SUCCESS.
-- If count = 1 and indisvalid = false: Index build failed partially; run DROP INDEX public.{iname} before retrying.
-- If count = 0: Statement failed/rolled back; safe to re-execute CREATE INDEX IF NOT EXISTS.
```"""
        elif stype == 'FUNCTION_DEFINITION':
            m = re.search(r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-zA-Z0-9_]+)", sql_text)
            fname = m.group(1) if m else "func"
            state_insp = f"""```sql
SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = '{fname}';
-- CREATE OR REPLACE FUNCTION is atomic and idempotent. Safe to re-execute directly.
```"""
        else:
            state_insp = f"""```sql
-- Statement is inherently idempotent. Safe to re-execute directly after resolving network/client errors.
```"""

        b = f"""#### `{r['unit_id']}`: {r['target_object']}
- **Source Migration:** `{r['migration_ver']}` (Lines {r['start_line']}–{r['end_line']})
- **Statement Type:** `{r['type']}`
- **CLI Acceptance:** `{r['accepted_by_cli']}`
- **Internal Multi-Command:** `{r['multi_command_internal']}`
- **Transaction Semantics:** {r['txn_behavior']}
- **Lock Mode & Concurrency Impact:**
  - **Lock Acquired:** `{r['lock_mode']}`
  - **Impact on Concurrent Traffic:** {r['lock_impact']}
- **Idempotency & Rerun Safety:** {r['rerun_safety']}
- **State-Inspection Query Before Retry (Handles Client Timeouts & Lost Connections):**
{state_insp}
- **Exact Runnable SQL Text:**
```sql
{sql_text}
```
- **Strengthened Verification Query:**
```sql
{vq}
```
- **Expected Verification Output:** `{expected}`
- **Ordinary Request Recovery Protocol:** {r['ordinary_recovery']}
"""
        blocks.append(b)
    return "\n".join(blocks)

table_a = render_table_v6(mig_a)
details_a = render_details_v6(mig_a)

table_b = render_table_v6(mig_b)
details_b = render_details_v6(mig_b)

table_c = render_table_v6(mig_c)
details_c = render_details_v6(mig_c)

with open("scratch/tables_rendered_v6.json", "w", encoding="utf-8") as f:
    json.dump({
        "table_a": table_a, "details_a": details_a,
        "table_b": table_b, "details_b": details_b,
        "table_c": table_c, "details_c": details_c
    }, f)

print(f"Rendered v6 successfully: A ({len(table_a)}/{len(details_a)}), B ({len(table_b)}/{len(details_b)}), C ({len(table_c)}/{len(details_c)})")
