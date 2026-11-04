import os
import re

REPO_ROOT = r"d:\Projects\TerraByte"
DOCS_AUDITS = os.path.join(REPO_ROOT, "docs", "audits")

# Build mapping of target filename -> relative path from repo root
moved_files_map = {}
for root, dirs, files in os.walk(DOCS_AUDITS):
    for file in files:
        if file.endswith(".md") and file != "README.md":
            rel_path = os.path.relpath(os.path.join(root, file), REPO_ROOT).replace("\\", "/")
            moved_files_map[file] = rel_path

print(f"Mapping {len(moved_files_map)} files...")

# Iterate through all files in docs/audits
updated_files_count = 0
total_replacements = 0

for root, dirs, files in os.walk(DOCS_AUDITS):
    for file in files:
        if file.endswith(".md"):
            fpath = os.path.join(root, file)
            with open(fpath, "r", encoding="utf-8") as f:
                content = f.read()

            original_content = content
            file_replacements = 0

            for target_name, rel_dest in moved_files_map.items():
                # Pattern: file:///d:/Projects/TerraByte/<target_name> (case insensitive on drive letter)
                pat = re.compile(rf'file:///[dD]:/Projects/TerraByte/{re.escape(target_name)}')
                replacement = f"file:///d:/Projects/TerraByte/{rel_dest}"
                
                content, count = pat.subn(replacement, content)
                file_replacements += count

            if content != original_content:
                with open(fpath, "w", encoding="utf-8") as f:
                    f.write(content)
                updated_files_count += 1
                total_replacements += file_replacements
                print(f"Updated {file_replacements} links in {os.path.relpath(fpath, REPO_ROOT)}")

print(f"\nDone. Updated {total_replacements} links across {updated_files_count} files.")
