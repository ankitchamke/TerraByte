import os
import re
import glob

test_files = glob.glob("tests/*.test.mjs")
print(f"Found {len(test_files)} test files:")

total_tests = 0
for tf in sorted(test_files):
    with open(tf, "r", encoding="utf-8") as f:
        content = f.read()
    
    # Matches test('name', ...) or it('name', ...)
    tests = re.findall(r"(?:test|it)\s*\(\s*['\"`](.+?)['\"`]", content)
    print(f"\n{tf} ({len(tests)} tests):")
    total_tests += len(tests)
    for i, t in enumerate(tests, 1):
        print(f"  {i}. {t}")

print(f"\nTotal test count across all files: {total_tests}")
