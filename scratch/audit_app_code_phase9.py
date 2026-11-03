import os
import re

search_terms = [
    'confirm_service_centre_part_handoff',
    'adjust_service_centre_part_stock',
    'request_service_centre_part',
    'receive_service_centre_stock',
    'return_service_centre_part',
    'update_service_centre_part_request_eta',
    'service_centre_parts',
    'service_centre_part_requests',
    'service_centre_stock_audit',
    'service_centre_part_sales',
    'estimated_arrival_at',
    'eta_updated_by',
    'eta_updated_at',
    'notify_admin_on_technician_registration',
    'supabase.channel',
    'postgres_changes'
]

results = {term: [] for term in search_terms}

src_dir = 'src'
for root, dirs, files in os.walk(src_dir):
    for f in files:
        if f.endswith(('.ts', '.tsx', '.js', '.jsx')):
            fp = os.path.join(root, f)
            with open(fp, 'r', encoding='utf-8', errors='ignore') as sfile:
                content = sfile.read()
                for term in search_terms:
                    if term in content:
                        # find line numbers
                        lines = content.split('\n')
                        matching_lines = [i+1 for i, line in enumerate(lines) if term in line]
                        results[term].append({
                            'file': fp.replace('\\', '/'),
                            'lines': matching_lines
                        })

with open('scratch/app_code_search_phase9.json', 'w') as out:
    import json
    json.dump(results, out, indent=2)

print("Search completed. Summary:")
for term, hits in results.items():
    print(f"{term}: {len(hits)} files matched")
