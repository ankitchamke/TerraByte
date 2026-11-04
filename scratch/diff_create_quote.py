import difflib

with open('scratch/create_quote_1700.sql', 'r', encoding='utf-8') as f:
    v1 = f.readlines()
with open('scratch/create_quote_1830.sql', 'r', encoding='utf-8') as f:
    v2 = f.readlines()

diff = list(difflib.unified_diff(v1, v2, fromfile='1700_prod', tofile='1830_realtime'))
print("=== Diff: create_quote_atomic (1700 vs 1830) ===")
for line in diff:
    print(line, end='')
