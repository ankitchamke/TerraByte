import json
import re

with open("scratch/full_request_catalog_v8.json", "r", encoding="utf-8") as f:
    catalog = json.load(f)

mig_a = [r for r in catalog if r["migration_id"] == "A"]
mig_b = [r for r in catalog if r["migration_id"] == "B"]
mig_c = [r for r in catalog if r["migration_id"] == "C"]

def render_table_v8(reqs):
    lines = []
    lines.append("| Request ID | Source Lines | Statement Type | Target Object / Signature | Lock Mode | Idempotent | State-Inspection Before Retry |")
    lines.append("| :--- | :---: | :--- | :--- | :--- | :---: | :--- |")
    for r in reqs:
        short_lock = r['lock_mode'].split(" on ")[0] if " on " in r['lock_mode'] else r['lock_mode']
        # State inspection summary
        if r['type'] == 'CREATE_POLICY':
            insp = "Inspect pg_policies (qual & with_check)"
        elif r['type'] == 'DROP_TRIGGER':
            insp = "Inspect pg_trigger (SKIP if already healthy)"
        elif r['type'] == 'CREATE_TRIGGER':
            insp = "Inspect pg_trigger (SKIP if already healthy)"
        elif 'INDEX' in r['type']:
            insp = "Inspect pg_index (indisvalid)"
        elif 'FUNCTION' in r['type']:
            insp = "Safe to re-execute (OR REPLACE)"
        else:
            insp = "Safe to re-execute (Idempotent)"
        lines.append(f"| **`{r['unit_id']}`** | Lines {r['start_line']}–{r['end_line']} | `{r['type']}` | `{r['target_object']}` | {short_lock} | {r['rerun_safety'].split()[0]} | {insp} |")
    return "\n".join(lines)

def render_details_v8(reqs):
    blocks = []
    for r in reqs:
        sql_text = r['text'].strip()
        vq = r['strengthened_vquery'].strip()
        expected = r['expected_output'].strip()
        recovery = r['ordinary_recovery'].strip()
        state_insp = r['state_inspection_query'].strip()
        session_note = r.get('session_safety_note', '')

        b = f"""#### `{r['unit_id']}`: {r['target_object']}
- **Source Migration:** `{r['migration_ver']}` (Lines {r['start_line']}–{r['end_line']})
- **Statement Type:** `{r['type']}`
- **CLI Acceptance:** `{r['accepted_by_cli']}`
- **Internal Multi-Command:** `{r['multi_command_internal']}`
- **Transaction Semantics:** {r['txn_behavior']}
- **Lock Mode & Concurrency Impact:**
  - **Lock Acquired:** `{r['lock_mode']}`
  - **Impact on Concurrent Traffic:** {r['lock_impact']}
  - **Execution Session Safety Note:** {session_note}
- **Idempotency & Rerun Safety:** {r['rerun_safety']}
- **State-Inspection Query Before Retry (Handles Client Timeouts & Connection Drops):**
```sql
{state_insp}
```
- **Exact Runnable SQL Text:**
```sql
{sql_text}
```
- **Strengthened Verification Query (Using acldefault for Effective ACL):**
```sql
{vq}
```
- **Expected Verification Output:** `{expected}`
- **Safe Request Recovery Protocol:**
{recovery}
"""
        blocks.append(b)
    return "\n".join(blocks)

table_a = render_table_v8(mig_a)
details_a = render_details_v8(mig_a)

table_b = render_table_v8(mig_b)
details_b = render_details_v8(mig_b)

table_c = render_table_v8(mig_c)
details_c = render_details_v8(mig_c)

with open("scratch/tables_rendered_v8.json", "w", encoding="utf-8") as f:
    json.dump({
        "table_a": table_a, "details_a": details_a,
        "table_b": table_b, "details_b": details_b,
        "table_c": table_c, "details_c": details_c
    }, f)

print(f"Rendered v8 successfully: A ({len(table_a)}/{len(details_a)}), B ({len(table_b)}/{len(details_b)}), C ({len(table_c)}/{len(details_c)})")
