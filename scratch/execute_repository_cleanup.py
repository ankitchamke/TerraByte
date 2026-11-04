import os
import shutil
import glob

REPO_ROOT = r"d:\Projects\TerraByte"
DOCS_AUDITS = os.path.join(REPO_ROOT, "docs", "audits")
PHASE_9_DIR = os.path.join(DOCS_AUDITS, "phase-9")
PHASE_11_DIR = os.path.join(DOCS_AUDITS, "phase-11")
ARCHIVE_DIR = os.path.join(DOCS_AUDITS, "archive")

# Ensure target directories exist
for d in [PHASE_9_DIR, PHASE_11_DIR, ARCHIVE_DIR]:
    os.makedirs(d, exist_ok=True)
    print(f"Directory ready: {d}")

# Classify files
files_to_move = []

# 1. Historical / Archive
archive_file = "phase9_step5b_production_deployment_assessment.md"
if os.path.exists(os.path.join(REPO_ROOT, archive_file)):
    files_to_move.append((archive_file, ARCHIVE_DIR))

# 2. Phase 11
phase11_file = "STEP5B19_PHASE11_COMPLETION_STATUS.md"
if os.path.exists(os.path.join(REPO_ROOT, phase11_file)):
    files_to_move.append((phase11_file, PHASE_11_DIR))

# 3. Phase 9 (Step 5B12 onwards)
step5b_files = glob.glob(os.path.join(REPO_ROOT, "STEP5B*.md"))
for full_path in step5b_files:
    fname = os.path.basename(full_path)
    if fname == phase11_file:
        continue
    files_to_move.append((fname, PHASE_9_DIR))

print(f"Total files scheduled to move: {len(files_to_move)}")

moved_log = []
for fname, target_dir in files_to_move:
    src = os.path.join(REPO_ROOT, fname)
    dst = os.path.join(target_dir, fname)
    if not os.path.exists(src):
        print(f"WARNING: Source does not exist: {src}")
        continue
    if os.path.exists(dst):
        print(f"WARNING: Destination already exists: {dst}")
        continue
    
    # Move file safely
    shutil.move(src, dst)
    assert os.path.exists(dst), f"Failed to verify destination: {dst}"
    assert not os.path.exists(src), f"Source still exists after move: {src}"
    moved_log.append((fname, os.path.relpath(dst, REPO_ROOT)))
    print(f"Moved: {fname} -> {os.path.relpath(dst, REPO_ROOT)}")

print(f"\nSuccessfully moved {len(moved_log)} files.")
