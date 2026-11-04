import os
import re

REPO_ROOT = r"d:\Projects\TerraByte"

# Build mapping of filename -> relative path from repo root
moved_files_map = {}
for root, dirs, files in os.walk(os.path.join(REPO_ROOT, "docs", "audits")):
    for file in files:
        if file.endswith(".md"):
            rel_path = os.path.relpath(os.path.join(root, file), REPO_ROOT).replace("\\", "/")
            moved_files_map[file] = rel_path

print(f"Total mapped moved files: {len(moved_files_map)}")

# Scan all markdown files in repo (excluding scratch, node_modules, etc.)
IGNORE_DIRS = {'node_modules', 'dist', '.output', '.wrangler', '.tanstack', '.vercel', '.git', 'scratch'}

files_to_update = {}

for root, dirs, files in os.walk(REPO_ROOT):
    dirs[:] = [d for d in dirs if d not in IGNORE_DIRS and not d.startswith('.git')]
    for file in files:
        if file.endswith(".md"):
            fpath = os.path.join(root, file)
            with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            
            changes = []
            for target_name, repo_rel_target in moved_files_map.items():
                # Pattern 1: file:///d:/Projects/TerraByte/<target_name>
                # Pattern 2: file:///D:/Projects/TerraByte/<target_name>
                # Pattern 3: relative links if in different dir
                
                # Check absolute file URI
                pat_abs = re.compile(rf'file:///[dD]:/Projects/TerraByte/{re.escape(target_name)}')
                if pat_abs.search(content):
                    changes.append(('abs_uri', target_name, repo_rel_target))
                
                # Check relative link: if file is in docs/audits/phase-9 and links to phase-11 file
                # or if file is in root / .planning and links to target_name
                # Let's inspect markdown links: ](target_name) or ](./target_name)
                pat_rel = re.compile(rf'\]\((?:\./)?{re.escape(target_name)}(#[^\)]*)?\)')
                for m in pat_rel.finditer(content):
                    changes.append(('rel_md', target_name, repo_rel_target, m.group(0)))

            if changes:
                files_to_update[fpath] = changes

print(f"Files needing link updates: {len(files_to_update)}")
for fpath, chs in files_to_update.items():
    print(f"\n{os.path.relpath(fpath, REPO_ROOT)}: {len(chs)} occurrences")
    for ch in chs[:3]:
        print(" ", ch)
