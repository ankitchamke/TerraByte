import subprocess
import json

cmd = ["npx", "supabase", "migration", "list", "--remote", "--output", "json"]
res = subprocess.run(cmd, capture_output=True, text=True, shell=True)

lines = res.stdout.strip().split("\n")
json_str = ""
for line in lines:
    if line.strip().startswith("{"):
        json_str = line.strip()
        break

if not json_str:
    print("Could not find JSON output in:", res.stdout)
    exit(1)

data = json.loads(json_str)
target = data.get("target", {})
print(f"Target: {target.get('project_name')} ({target.get('project_ref')}) · {target.get('environment')}")
print(f"{'Local Version':<16} | {'Remote Version':<16} | {'Timestamp':<20} | Status")
print("-" * 75)

for m in data.get("migrations", []):
    loc = m.get("local") or ""
    rem = m.get("remote") or ""
    ts = m.get("time") or ""
    if loc and rem:
        status = "SYNCHRONIZED"
    elif loc and not rem:
        status = "LOCAL ONLY (PENDING REMOTE)"
    elif rem and not loc:
        status = "REMOTE ONLY (APPLIED ON REMOTE, MISSING LOCAL)"
    else:
        status = "UNKNOWN"
    print(f"{loc:<16} | {rem:<16} | {ts:<20} | {status}")
