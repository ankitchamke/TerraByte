import subprocess
import os

PG_BIN = r"D:\TerraByte_Drill\pgsql17\pgsql\bin"
PSQL = os.path.join(PG_BIN, "psql.exe")
env = os.environ.copy()
env["PGPASSWORD"] = "postgres"

def run_file(filepath, db="terabyte_schema_only_drill"):
    cmd = [PSQL, "-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", db, "-w", "-f", filepath]
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    return res.returncode, res.stdout, res.stderr

migs = [
    "supabase/migrations/20261104100000_profile_security_separation.sql",
    "supabase/migrations/20261104110000_complete_phase9_parts_desk_rpcs.sql",
    "supabase/migrations/20261104120000_complete_phase9_realtime_and_eta.sql",
    "supabase/migrations/20261104130000_complete_phase5_3_technician_registration_notification.sql"
]

for m in migs:
    fname = os.path.basename(m)
    rc, out, err = run_file(m)
    err_lines = [l for l in err.splitlines() if "ERROR" in l]
    print(f"{fname}: ExitCode={rc}, Errors={len(err_lines)}")
    for el in err_lines[:5]:
        print("  ->", el)
