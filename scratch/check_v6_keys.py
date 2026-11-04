import json
with open("scratch/full_request_catalog_v6.json", "r", encoding="utf-8") as f:
    r = json.load(f)[0]
print("Keys in full_request_catalog_v6[0]:", list(r.keys()))
