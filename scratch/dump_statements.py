import os
import sys
from parse_sql_statements import parse_sql_file

migrations = [
    ('Migration A (20261104110000)', 'supabase/migrations/20261104110000_complete_phase9_parts_desk_rpcs.sql'),
    ('Migration B (20261104120000)', 'supabase/migrations/20261104120000_complete_phase9_realtime_and_eta.sql'),
    ('Migration C (20261104130000)', 'supabase/migrations/20261104130000_complete_phase5_3_technician_registration_notification.sql')
]

for name, path in migrations:
    stmts = parse_sql_file(path)
    print(f"\n=======================================================")
    print(f"=== {name}: {len(stmts)} statements ===")
    print(f"=======================================================")
    for s in stmts:
        lines = [line.strip() for line in s['text'].strip().split('\n') if line.strip()]
        preview = lines[0] if lines else ""
        print(f"[{s['index']:02d}] Lines {s['start_line']:3d}-{s['end_line']:3d} | Type: {s['type']:<22} | {preview[:75]}")
