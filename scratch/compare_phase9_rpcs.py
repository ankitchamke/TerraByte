import os
import re

mig_dir = 'supabase/migrations'

def extract_function(sql, name):
    pattern = rf'CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?{name}\s*\((.*?)\)\s*RETURNS\s+(.*?)\s+LANGUAGE\s+(\w+)\s+(.*?)\$function\$(.*?)\$function\$;'
    m = re.search(pattern, sql, re.DOTALL | re.IGNORECASE)
    if not m:
        # try $$ style
        pattern2 = rf'CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?{name}\s*\((.*?)\)\s*RETURNS\s+(.*?)\s+LANGUAGE\s+(\w+)\s+(.*?)\$\$(.*?)\$\$;'
        m = re.search(pattern2, sql, re.DOTALL | re.IGNORECASE)
    if m:
        return {
            'args': m.group(1).strip(),
            'returns': m.group(2).strip(),
            'lang': m.group(3).strip(),
            'body': m.group(5).strip()
        }
    return None

files_to_check = [
    '20261029100000_phase9_1_parts_pickup.sql',
    '20261029120000_phase9_2_stock_movement_sales.sql',
    '20261031173000_phase9_3_parts_handoff_rpcs.sql',
    '20261101140000_phase9_3_unavailable_parts_eta.sql'
]

rpcs = [
    'confirm_service_centre_part_handoff',
    'adjust_service_centre_part_stock',
    'request_service_centre_part',
    'receive_service_centre_stock',
    'return_service_centre_part',
    'update_service_centre_part_request_eta'
]

for fn in files_to_check:
    fp = os.path.join(mig_dir, fn)
    with open(fp, 'r', encoding='utf-8') as f:
        sql = f.read()
    print(f"================ {fn} ================")
    for rpc in rpcs:
        res = extract_function(sql, rpc)
        if res:
            print(f"FOUND {rpc}:")
            print(f"  Args: {res['args']}")
            print(f"  Returns: {res['returns']}")
            print(f"  Body length: {len(res['body'])} chars")
        else:
            # check if mentioned
            if rpc in sql:
                print(f"MENTIONED (not matched regex) {rpc}")
