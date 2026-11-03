import json

with open("scratch/step3a_candidate_live_verification.json") as f:
    data = json.load(f)

for ver, res in data.items():
    print(f"=== {ver} ===")
    print(f"Return code: {res['returncode']}")
    # parse JSON from stdout if present
    stdout = res['stdout']
    try:
        # find json in stdout
        idx = stdout.find('{')
        if idx != -1:
            j = json.loads(stdout[idx:])
            if 'rows' in j:
                print(f"Rows: {json.dumps(j['rows'], indent=2)}")
            elif 'error' in j:
                print(f"Error: {j['error']}")
            else:
                print(f"JSON: {j}")
        else:
            print(f"Output: {stdout.strip()}")
    except Exception as e:
        print(f"Raw output: {stdout.strip()[:300]}")
    print()
