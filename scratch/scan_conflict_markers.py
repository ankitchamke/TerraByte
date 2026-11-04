import os
import re

ignore_dirs = {".git", "node_modules", "dist", "scratch", ".gemini", "build"}
conflict_patterns = [
    re.compile(r"^<<<<<<<", re.MULTILINE),
    re.compile(r"^=======$", re.MULTILINE),
    re.compile(r"^>>>>>>>", re.MULTILINE)
]

found_conflicts = []

for root, dirs, files in os.walk("."):
    dirs[:] = [d for d in dirs if d not in ignore_dirs]
    for f in files:
        fpath = os.path.join(root, f)
        # Skip binary files or specific large files if needed
        try:
            with open(fpath, "r", encoding="utf-8", errors="ignore") as fh:
                content = fh.read()
            
            lines = content.splitlines()
            file_markers = []
            for idx, line in enumerate(lines, 1):
                if line.startswith("<<<<<<<") or line == "=======" or line.startswith(">>>>>>>"):
                    file_markers.append((idx, line))
                    
            if file_markers:
                found_conflicts.append({
                    "file": fpath,
                    "marker_count": len(file_markers),
                    "markers": file_markers
                })
        except Exception as e:
            pass

print(f"Total files with conflict markers: {len(found_conflicts)}")
total_markers = sum(fc["marker_count"] for fc in found_conflicts)
print(f"Total conflict marker lines: {total_markers}\n")

for fc in found_conflicts:
    print(f"File: {fc['file']} (markers: {fc['marker_count']})")
    for lnum, text in fc["markers"]:
        print(f"  Line {lnum}: {text}")
