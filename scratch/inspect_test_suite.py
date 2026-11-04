import glob
import re

total_tests = 0
for test_file in sorted(glob.glob('tests/*.test.mjs')):
    with open(test_file, 'r', encoding='utf-8') as f:
        content = f.read()
    matches = re.findall(r'test\([\"\'](.*?)[\"\']', content)
    total_tests += len(matches)
    print(f"=== {test_file} ({len(matches)} tests) ===")
    for m in matches:
        print(f"  * {m}")

print(f"\nTOTAL TESTS COUNTED: {total_tests}")
