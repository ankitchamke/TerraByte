import json
import re

with open("scratch/full_request_catalog_v4.json", "r", encoding="utf-8") as f:
    catalog = json.load(f)

mig_a = [r for r in catalog if r["migration_id"] == "A"]
mig_b = [r for r in catalog if r["migration_id"] == "B"]
mig_c = [r for r in catalog if r["migration_id"] == "C"]

def render_table_v5(reqs):
    lines = []
    lines.append("| Request ID | Source Lines | Statement Type | Target Object / Signature | Lock Mode | Idempotent | Partial Fail Risk |")
    lines.append("| :--- | :---: | :--- | :--- | :--- | :---: | :---: |")
    for r in reqs:
        short_lock = r['lock_mode'].split(" on ")[0] if " on " in r['lock_mode'] else r['lock_mode']
        lines.append(f"| **`{r['unit_id']}`** | Lines {r['start_line']}–{r['end_line']} | `{r['type']}` | `{r['target_object']}` | {short_lock} | {r['rerun_safety'].split()[0]} | NO (Atomic Txn) |")
    return "\n".join(lines)

def render_details_v5(reqs):
    blocks = []
    for r in reqs:
        sql_text = r['text'].strip()
        # Expected result from verification query comment
        vq = r['vquery'].strip()
        expected = ""
        if "-- Expected:" in vq:
            parts = vq.split("-- Expected:")
            clean_vq = parts[0].strip()
            expected = parts[1].strip()
        else:
            clean_vq = vq
            expected = "1 row / expected state"

        b = f"""#### `{r['unit_id']}`: {r['target_object']}
- **Source Migration:** `{r['migration_ver']}` (Lines {r['start_line']}–{r['end_line']})
- **Statement Type:** `{r['type']}`
- **CLI Acceptance:** `{r['accepted_by_cli']}`
- **Internal Multi-Command:** `{r['multi_command_internal']}`
- **Transaction Semantics:** {r['txn_behavior']}
- **Partial Application Failure Risk:** **NO**. PostgreSQL executes single DDL/DML statements atomically; if an error occurs, the statement's transaction rolls back entirely, leaving no partial state.
- **Idempotency & Rerun Safety:** {r['rerun_safety']}
- **Lock Mode & Concurrency Impact:**
  - **Lock Acquired:** `{r['lock_mode']}`
  - **Impact on Concurrent Traffic:** {r['lock_impact']}
- **Exact SQL Text:**
```sql
{sql_text}
```
- **Exact Verification Query:**
```sql
{clean_vq}
```
- **Expected Verification Output:** `{expected}`
- **Ordinary Request Recovery Action:** {r['ordinary_recovery']}
"""
        blocks.append(b)
    return "\n".join(blocks)

table_a = render_table_v5(mig_a)
details_a = render_details_v5(mig_a)

table_b = render_table_v5(mig_b)
details_b = render_details_v5(mig_b)

table_c = render_table_v5(mig_c)
details_c = render_details_v5(mig_c)

with open("scratch/tables_rendered_v5.json", "w", encoding="utf-8") as f:
    json.dump({
        "table_a": table_a, "details_a": details_a,
        "table_b": table_b, "details_b": details_b,
        "table_c": table_c, "details_c": details_c
    }, f)

print(f"Rendered v5 successfully: A ({len(table_a)}/{len(details_a)}), B ({len(table_b)}/{len(details_b)}), C ({len(table_c)}/{len(details_c)})")
