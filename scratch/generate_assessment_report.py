import json
import os

with open("scratch/full_request_catalog.json", "r", encoding="utf-8") as f:
    catalog = json.load(f)

mig_a = [r for r in catalog if r["migration_id"] == "A"]
mig_b = [r for r in catalog if r["migration_id"] == "B"]
mig_c = [r for r in catalog if r["migration_id"] == "C"]

def render_request_table(reqs):
    lines = []
    lines.append("| Request ID | Source Lines | Statement Type | Target Object / Purpose | Internal Cmds | CLI Accept | Rerun Safe |")
    lines.append("| :--- | :---: | :--- | :--- | :---: | :---: | :---: |")
    for r in reqs:
        lines.append(f"| **`{r['unit_id']}`** | Lines {r['start_line']}–{r['end_line']} | `{r['type']}` | {r['target_object']} | {r['multi_command_internal']} | YES | {r['rerun_safety'].split()[0]} |")
    return "\n".join(lines)

def render_request_details(reqs):
    blocks = []
    for r in reqs:
        first_line = r['boundary_first'][:100].replace('|', '\|')
        last_line = r['boundary_last'][:100].replace('|', '\|')
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
- **Rerun Safety / Idempotency:** {r['rerun_safety']}
- **Required Verification Query:**
  ```sql
  {r['vquery']}
  ```
- **Failure Recovery Action:** {r['recovery']}
"""
        blocks.append(b)
    return "\n".join(blocks)

table_a = render_request_table(mig_a)
details_a = render_request_details(mig_a)

table_b = render_request_table(mig_b)
details_b = render_request_details(mig_b)

table_c = render_request_table(mig_c)
details_c = render_request_details(mig_c)

print(f"Table A: {len(table_a)} chars, Details A: {len(details_a)} chars")
print(f"Table B: {len(table_b)} chars, Details B: {len(details_b)} chars")
print(f"Table C: {len(table_c)} chars, Details C: {len(details_c)} chars")

with open("scratch/tables_rendered.json", "w", encoding="utf-8") as f:
    json.dump({
        "table_a": table_a, "details_a": details_a,
        "table_b": table_b, "details_b": details_b,
        "table_c": table_c, "details_c": details_c
    }, f)

print("Rendered successfully.")
