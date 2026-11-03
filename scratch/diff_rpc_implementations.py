import os
import re

mig_dir = 'supabase/migrations'

def get_body(fn, rpc):
    with open(os.path.join(mig_dir, fn), 'r', encoding='utf-8') as f:
        text = f.read()
    pattern = rf'CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?{rpc}\s*\((.*?)\)\s*RETURNS\s+(.*?)\s+LANGUAGE\s+(\w+)\s+(.*?)\$(?:function|\$)(.*?)\$(?:function|\$);'
    m = re.search(pattern, text, re.DOTALL | re.IGNORECASE)
    if m:
        return m.group(5).strip()
    return None

print("=== Comparing confirm_service_centre_part_handoff ===")
b1 = get_body('20261029100000_phase9_1_parts_pickup.sql', 'confirm_service_centre_part_handoff')
b2 = get_body('20261029120000_phase9_2_stock_movement_sales.sql', 'confirm_service_centre_part_handoff')
b3 = get_body('20261031173000_phase9_3_parts_handoff_rpcs.sql', 'confirm_service_centre_part_handoff')

with open('scratch/confirm_handoff_v1_9_1.sql', 'w', encoding='utf-8') as f:
    f.write(b1 or '')
with open('scratch/confirm_handoff_v2_9_2.sql', 'w', encoding='utf-8') as f:
    f.write(b2 or '')
with open('scratch/confirm_handoff_v3_9_3.sql', 'w', encoding='utf-8') as f:
    f.write(b3 or '')

print(f"v1 (9.1) len: {len(b1 or '')}")
print(f"v2 (9.2) len: {len(b2 or '')}")
print(f"v3 (9.3) len: {len(b3 or '')}")

print("\n=== Comparing adjust_service_centre_part_stock ===")
a1 = get_body('20261029100000_phase9_1_parts_pickup.sql', 'adjust_service_centre_part_stock')
a3 = get_body('20261031173000_phase9_3_parts_handoff_rpcs.sql', 'adjust_service_centre_part_stock')

with open('scratch/adjust_stock_v1_9_1.sql', 'w', encoding='utf-8') as f:
    f.write(a1 or '')
with open('scratch/adjust_stock_v3_9_3.sql', 'w', encoding='utf-8') as f:
    f.write(a3 or '')

print(f"v1 (9.1) len: {len(a1 or '')}")
print(f"v3 (9.3) len: {len(a3 or '')}")
