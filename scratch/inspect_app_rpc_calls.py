import json

with open('scratch/app_code_search_phase9.json') as f:
    data = json.load(f)

for term in [
    'confirm_service_centre_part_handoff',
    'adjust_service_centre_part_stock',
    'request_service_centre_part',
    'receive_service_centre_stock',
    'return_service_centre_part',
    'update_service_centre_part_request_eta',
    'supabase.channel',
    'postgres_changes'
]:
    print(f"=== {term} ===")
    for item in data[term]:
        print(f"  {item['file']} (lines: {item['lines']})")
