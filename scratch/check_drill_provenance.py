import os
import hashlib

p1 = r"D:\TerraByte_Drill\preflight_sql\from_pg17_restore.sql"
p2 = r"D:\TerraByte_Drill\preflight_sql\from_pg18_restore.sql"

def hash_file(p):
    with open(p, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()

print(f"from_pg17_restore.sql: {hash_file(p1)}")
print(f"from_pg18_restore.sql: {hash_file(p2)}")
print(f"Are they identical? {hash_file(p1) == hash_file(p2)}")

# Let's check header of both
with open(p1, "r", encoding="utf-8", errors="ignore") as f1, open(p2, "r", encoding="utf-8", errors="ignore") as f2:
    lines1 = f1.readlines()[:25]
    lines2 = f2.readlines()[:25]

print("\nHeader from_pg17_restore.sql:")
for l in lines1[:15]:
    print("  " + l.strip())

print("\nHeader from_pg18_restore.sql:")
for l in lines2[:15]:
    print("  " + l.strip())
