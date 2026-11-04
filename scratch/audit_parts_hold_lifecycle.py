import os
import re

search_terms = ['WAITING_FOR_PARTS', 'parts_hold', 'partsHold']

results = {term: [] for term in search_terms}

for root, dirs, files in os.walk('src'):
    for f in files:
        if f.endswith(('.ts', '.tsx')):
            fp = os.path.join(root, f)
            with open(fp, 'r', encoding='utf-8', errors='ignore') as sf:
                c = sf.read()
                for t in search_terms:
                    if t in c:
                        lines = [i+1 for i, line in enumerate(c.split('\n')) if t in line]
                        results[t].append({'file': fp.replace('\\', '/'), 'lines': lines})

for t, hits in results.items():
    print(f"=== {t} ({len(hits)} files) ===")
    for h in hits:
        print(f"  {h['file']}: lines {h['lines']}")
