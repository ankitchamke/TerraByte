import json
with open("scratch/all_parsed_requests.json", "r", encoding="utf-8") as f:
    r = json.load(f)[0]
print("Keys in all_parsed_requests[0]:", list(r.keys()))
