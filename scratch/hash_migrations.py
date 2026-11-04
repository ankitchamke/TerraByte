import hashlib
import os

migrations = [
    "supabase/migrations/20261104110000_complete_phase9_parts_desk_rpcs.sql",
    "supabase/migrations/20261104120000_complete_phase9_realtime_and_eta.sql",
    "supabase/migrations/20261104130000_complete_phase5_3_technician_registration_notification.sql"
]

for m in migrations:
    if os.path.exists(m):
        with open(m, "rb") as f:
            data = f.read()
        sha = hashlib.sha256(data).hexdigest()
        size = len(data)
        lines = len(data.split(b"\n"))
        print(f"File: {os.path.basename(m)}")
        print(f"  Path: {m}")
        print(f"  Size: {size} bytes")
        print(f"  Lines: {lines}")
        print(f"  SHA256: {sha}")
    else:
        print(f"Missing: {m}")
