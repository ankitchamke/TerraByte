import os
import re

IGNORE_DIRS = {
    'node_modules', 'dist', '.output', '.wrangler', '.tanstack', '.vercel',
    '.git', 'scratch', '__pycache__'
}

PATTERNS = [
    re.compile(r'STEP5B\d+_[A-Z0-9_]+\.md', re.IGNORECASE),
    re.compile(r'phase9_step5b_production_deployment_assessment\.md', re.IGNORECASE)
]

found_references = {}

for root, dirs, files in os.walk('.'):
    # filter dirs
    dirs[:] = [d for d in dirs if d not in IGNORE_DIRS and not d.startswith('.git')]
    for file in files:
        if file.endswith(('.md', '.ts', '.tsx', '.js', '.json', '.html')):
            file_path = os.path.join(root, file)
            try:
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    for line_no, line in enumerate(f, 1):
                        for pattern in PATTERNS:
                            matches = pattern.findall(line)
                            if matches:
                                if file_path not in found_references:
                                    found_references[file_path] = []
                                found_references[file_path].append((line_no, matches, line.strip()))
            except Exception as e:
                pass

print(f"Total files with references: {len(found_references)}")
for fpath, refs in found_references.items():
    print(f"\n--- {fpath} ({len(refs)} references) ---")
    for line_no, matches, line in refs[:5]:
        print(f"  L{line_no}: {matches} -> {line[:100]}")
    if len(refs) > 5:
        print(f"  ... and {len(refs) - 5} more")
