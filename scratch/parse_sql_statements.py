import os
import re

MIGRATIONS_DIR = r"D:\Projects\TerraByte\supabase\migrations"

files = [
    "20261104110000_complete_phase9_parts_desk_rpcs.sql",
    "20261104120000_complete_phase9_realtime_and_eta.sql",
    "20261104130000_complete_phase5_3_technician_registration_notification.sql"
]

def split_sql_statements(content):
    lines = content.split("\n")
    statements = []
    current_stmt = []
    start_line = 1
    in_dollar_block = False
    dollar_tag = ""

    for line_num, line in enumerate(lines, start=1):
        stripped = line.strip()
        
        # Check dollar quote boundaries like $$ or $tag$
        dollar_matches = re.findall(r"(\$[a-zA-Z0-9_]*\$)", line)
        for dm in dollar_matches:
            if not in_dollar_block:
                in_dollar_block = True
                dollar_tag = dm
            elif in_dollar_block and dm == dollar_tag:
                in_dollar_block = False
                dollar_tag = ""

        if not current_stmt:
            # Skip empty lines or pure comment lines before statement starts
            if not stripped or stripped.startswith("--"):
                continue
            start_line = line_num

        current_stmt.append(line)

        # Statement terminates if semicolon at end of line and not in dollar block
        if not in_dollar_block and stripped.endswith(";"):
            stmt_text = "\n".join(current_stmt).strip()
            statements.append({
                "start": start_line,
                "end": line_num,
                "text": stmt_text
            })
            current_stmt = []

    if current_stmt:
        stmt_text = "\n".join(current_stmt).strip()
        if stmt_text:
            statements.append({
                "start": start_line,
                "end": len(lines),
                "text": stmt_text
            })

    return statements

for fname in files:
    path = os.path.join(MIGRATIONS_DIR, fname)
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    stmts = split_sql_statements(content)
    print(f"\n========================================================")
    print(f"File: {fname} -> Total Top-Level Statements: {len(stmts)}")
    print(f"========================================================")
    for idx, s in enumerate(stmts, start=1):
        first_line = s["text"].split("\n")[0]
        # classify type
        s_type = first_line.split()[0].upper() if first_line else "UNKNOWN"
        if s_type == "CREATE":
            parts = first_line.split()
            s_type = " ".join(parts[:4])
        elif s_type == "ALTER":
            s_type = " ".join(first_line.split()[:3])
        elif s_type == "DROP":
            s_type = " ".join(first_line.split()[:4])
        elif s_type == "REVOKE" or s_type == "GRANT":
            s_type = " ".join(first_line.split()[:3])
        elif s_type == "DO":
            s_type = "DO $$"

        print(f"  [{idx:2d}] Lines {s['start']:4d}-{s['end']:4d} | {s_type:<35} | {first_line[:50]}...")
