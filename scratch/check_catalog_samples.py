import json

with open("scratch/full_request_catalog_v6.json", "r", encoding="utf-8") as f:
    catalog = json.load(f)

for r in catalog:
    if r["unit_id"] in ["REQ-03", "REQ-08", "REQ-09", "REQ-10", "REQ-31", "REQ-33", "REQ-34", "REQ-51", "REQ-52", "REQ-55"]:
        print(f"=== {r['unit_id']}: {r['target_object']} ===")
        print("VQUERY:\n", r.get("strengthened_vquery", "").strip())
        print("RECOVERY:\n", r.get("ordinary_recovery", "").strip())
