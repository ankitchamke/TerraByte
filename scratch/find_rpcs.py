import os
import re

rpc_pattern = re.compile(r'rpc\s*\(\s*["\']([^"\']+)["\']|\)\s*\(\s*["\']([^"\']+)["\']')

found = set()
for root, _, files in os.walk("src"):
    for file in files:
        if file.endswith((".ts", ".tsx")):
            path = os.path.join(root, file)
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            matches = rpc_pattern.findall(content)
            for m in matches:
                name = m[0] or m[1]
                if name:
                    found.add((name, file))

print("=== ALL RPC NAMES CALLED IN FRONTEND ===")
for name, file in sorted(found):
    print(f"  {name:<45} in {file}")
