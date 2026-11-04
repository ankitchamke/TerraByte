import json
import os

with open("scratch/full_request_catalog_v4.json", "r", encoding="utf-8") as f:
    catalog = json.load(f)

mig_a = [r for r in catalog if r["migration_id"] == "A"]
mig_b = [r for r in catalog if r["migration_id"] == "B"]
mig_c = [r for r in catalog if r["migration_id"] == "C"]

def render_table_v4(reqs):
    lines = []
    lines.append("| Request ID | Source Lines | Statement Type | Target Object / Signature | Lock Mode | CLI Accept | Rerun Safe |")
    lines.append("| :--- | :---: | :--- | :--- | :--- | :---: | :---: |")
    for r in reqs:
        # short lock mode
        short_lock = r['lock_mode'].split(" on ")[0] if " on " in r['lock_mode'] else r['lock_mode']
        lines.append(f"| **`{r['unit_id']}`** | Lines {r['start_line']}–{r['end_line']} | `{r['type']}` | `{r['target_object']}` | {short_lock} | YES | {r['rerun_safety'].split()[0]} |")
    return "\n".join(lines)

def render_details_v4(reqs):
    blocks = []
    for r in reqs:
        first_line = r['boundary_first'][:100].replace('|', '\\|')
        last_line = r['boundary_last'][:100].replace('|', '\\|')
        b = f"""#### `{r['unit_id']}`: {r['target_object']}
- **Source File:** `{r['migration_ver']}` (Lines {r['start_line']}–{r['end_line']})
- **Statement Boundary:**
  ```sql
  -- First line:
  {r['boundary_first']}
  ...
  -- Terminating line:
  {r['boundary_last']}
  ```
- **CLI Acceptance:** `{r['accepted_by_cli']}`
- **Multiple Internal Commands:** `{r['multi_command_internal']}`
- **Transaction Behavior:** {r['txn_behavior']}
- **Lock Mode & Concurrency Impact:**
  - **Lock Level:** `{r['lock_mode']}`
  - **Impact:** {r['lock_impact']}
- **Rerun Safety / Idempotency:** {r['rerun_safety']}
- **Required Verification Query:**
  ```sql
  {r['vquery']}
  ```
- **Ordinary Request Recovery:** {r['ordinary_recovery']}
"""
        blocks.append(b)
    return "\n".join(blocks)

table_a = render_table_v4(mig_a)
details_a = render_details_v4(mig_a)

table_b = render_table_v4(mig_b)
details_b = render_details_v4(mig_b)

table_c = render_table_v4(mig_c)
details_c = render_details_v4(mig_c)

with open("scratch/tables_rendered_v4.json", "w", encoding="utf-8") as f:
    json.dump({
        "table_a": table_a, "details_a": details_a,
        "table_b": table_b, "details_b": details_b,
        "table_c": table_c, "details_c": details_c
    }, f)

print(f"Rendered v4: Table A {len(table_a)} chars, Table B {len(table_b)} chars, Table C {len(table_c)} chars.")
