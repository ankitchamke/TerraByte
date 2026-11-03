import difflib

with open('scratch/confirm_handoff_v2_9_2.sql', 'r', encoding='utf-8') as f:
    v2 = f.readlines()
with open('scratch/confirm_handoff_v3_9_3.sql', 'r', encoding='utf-8') as f:
    v3 = f.readlines()

diff = list(difflib.unified_diff(v2, v3, fromfile='9.2_stock_sales', tofile='9.3_handoff_rpcs'))
print("=== Diff between 9.2 and 9.3 confirm_service_centre_part_handoff ===")
for line in diff[:80]:
    print(line, end='')
if len(diff) > 80:
    print(f"\n... and {len(diff) - 80} more lines")
