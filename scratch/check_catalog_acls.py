import json

with open("scratch/full_request_catalog_v6.json", "r", encoding="utf-8") as f:
    catalog = json.load(f)

print(f"Catalog requests: {len(catalog)}")
raw_aclexplode_count = 0
for r in catalog:
    v = r.get("verification", "")
    if "aclexplode" in v:
        if "acldefault" not in v:
            raw_aclexplode_count += 1
            print(f"{r['id']}: has raw aclexplode without acldefault")

print(f"Total raw aclexplode requests without acldefault: {raw_aclexplode_count}")
