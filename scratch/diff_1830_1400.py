import difflib

with open('scratch/create_quote_1830.sql', 'r', encoding='utf-8') as f:
    v2 = f.readlines()
with open('scratch/create_quote_1400.sql', 'r', encoding='utf-8') as f:
    v3 = f.readlines()

diff = list(difflib.unified_diff(v2, v3, fromfile='1830_realtime', tofile='1400_eta'))
with open('scratch/diff_1830_1400.txt', 'w', encoding='utf-8') as out:
    out.writelines(diff)

print(f"Diff lines: {len(diff)}")
