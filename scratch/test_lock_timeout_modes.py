import subprocess
import os
import json

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
PORT = "5433"
HOST = "127.0.0.1"
USER = "postgres"
DB = "terabyte_clean_restore_drill"

env = os.environ.copy()
env["PGPASSWORD"] = "postgres"

tests = [
    {
        "id": "STANDALONE_SET_LOCK_TIMEOUT",
        "description": "Standalone SET lock_timeout at session level",
        "sql": "SET lock_timeout = '3s'; SHOW lock_timeout;"
    },
    {
        "id": "SET_LOCAL_OUTSIDE_TRANSACTION",
        "description": "SET LOCAL outside a transaction block (PostgreSQL behavior)",
        "sql": "SET LOCAL lock_timeout = '3s'; SHOW lock_timeout;"
    },
    {
        "id": "TRANSACTION_SET_LOCAL_WRAPPER",
        "description": "Wrapped transaction with BEGIN; SET LOCAL lock_timeout = '3s'; COMMIT;",
        "sql": "BEGIN; SET LOCAL lock_timeout = '3s'; SHOW lock_timeout; COMMIT; SHOW lock_timeout;"
    }
]

results = []

for t in tests:
    cmd = [PSQL, "-p", PORT, "-h", HOST, "-U", USER, "-d", DB, "-w", "-c", t["sql"]]
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    print(f"=== {t['id']} ===")
    print("Return code:", res.returncode)
    print("STDOUT:\n", res.stdout)
    print("STDERR:\n", res.stderr)
    results.append({
        "test_id": t["id"],
        "description": t["description"],
        "sql": t["sql"],
        "return_code": res.returncode,
        "stdout": res.stdout,
        "stderr": res.stderr
    })

with open("scratch/lock_timeout_drill_results.json", "w", encoding="utf-8") as f:
    json.dump(results, f, indent=2)
