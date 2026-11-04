import subprocess
import json
import sys
import os

PSQL = r"D:\TerraByte_Drill\pgsql17\pgsql\bin\psql.exe"
DB_HOST = "127.0.0.1"
DB_PORT = "5433"
DB_USER = "postgres"
DB_NAME = "terabyte_clean_restore_drill"

TECH_PROFILE_ID = "00000000-0000-0000-0002-000000000001"
TECH_AUTH_ID = "00000000-0000-0000-0000-000000000004"

FARMER_PROFILE_ID = "00000000-0000-0000-0001-000000000001"
FARMER_AUTH_ID = "00000000-0000-0000-0000-000000000001"

ADMIN_PROFILE_ID = "00000000-0000-0000-0003-000000000001"
ADMIN_AUTH_ID = "00000000-0000-0000-0000-000000000005"

OTHER_TECH_PROFILE_ID = "00000000-0000-0000-0000-000000000006"
OTHER_TECH_AUTH_ID = "00000000-0000-0000-0000-000000000006"

EQUIPMENT_ID = "00000000-0000-0000-0010-000000000001"

results = []

def run_sql(sql, check=True):
    cmd = [
        PSQL,
        "-h", DB_HOST,
        "-p", DB_PORT,
        "-U", DB_USER,
        "-d", DB_NAME,
        "-v", "ON_ERROR_STOP=1",
        "-tAc", sql
    ]
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if check and p.returncode != 0:
        raise RuntimeError(f"SQL failed (code {p.returncode}):\n{p.stderr}\nQuery: {sql}")
    return p.returncode, p.stdout.strip(), p.stderr.strip()

def test(test_id, name, fn):
    print(f"Running [{test_id}] {name}...", end=" ", flush=True)
    try:
        fn()
        print("PASSED")
        results.append({"id": test_id, "name": name, "status": "PASSED", "error": None})
    except Exception as e:
        print(f"FAILED: {e}")
        results.append({"id": test_id, "name": name, "status": "FAILED", "error": str(e)})

# Setup test fixtures
def setup_fixtures():
    print("Setting up clean test fixtures in drill DB...")
    setup_sql = f"""
    DELETE FROM public.notifications WHERE link_target LIKE '%/repair/%' OR link_target = '/admin/technicians' OR link_target = '/admin/parts-desk';
    DELETE FROM public.repair_timeline;
    DELETE FROM public.service_centre_part_sales;
    DELETE FROM public.service_centre_stock_audit;
    DELETE FROM public.service_centre_part_requests;
    DELETE FROM public.quote_items;
    DELETE FROM public.quotes;
    DELETE FROM public.repair_requests;
    DELETE FROM public.technician_profiles WHERE profile_id IN (
      '99999999-9999-9999-9999-999999999999',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
      'dddddddd-dddd-dddd-dddd-dddddddddddd'
    );
    DELETE FROM public.profiles WHERE id IN (
      '99999999-9999-9999-9999-999999999999',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
      'dddddddd-dddd-dddd-dddd-dddddddddddd'
    );
    
    INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-000000000006', 'other@test.demo') ON CONFLICT DO NOTHING;

    INSERT INTO public.profiles (id, auth_user_id, role, full_name, email, phone)
    VALUES 
      ('{OTHER_TECH_PROFILE_ID}', '{OTHER_TECH_AUTH_ID}', 'technician', 'Other Technician', 'other@test.demo', '+91 98000 00006')
    ON CONFLICT (id) DO UPDATE SET auth_user_id = EXCLUDED.auth_user_id, role = EXCLUDED.role;

    -- Reset part stock
    UPDATE public.service_centre_parts SET stock_quantity = 10 WHERE part_number = '0433171';
    UPDATE public.service_centre_parts SET stock_quantity = 15 WHERE part_number = '005556958R1';
    """
    run_sql(setup_sql)

# -------------------------------------------------------------
# CATEGORY 1: PART RETURN INTEGRITY TESTS
# -------------------------------------------------------------
def test_1_1_return_nonexistent_repair_rejected():
    _, part_id, _ = run_sql("SELECT id FROM public.service_centre_parts WHERE part_number = '0433171';")
    sql = f"""
    SET request.jwt.claim.sub = '{ADMIN_AUTH_ID}';
    SELECT public.return_service_centre_part('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, '{part_id}'::uuid, 1, 'Return test');
    """
    code, out, err = run_sql(sql, check=False)
    assert code != 0
    assert "P0002" in err or "Repair request not found" in err, f"Expected P0002, got: {err}"

def test_1_2_return_part_never_issued_rejected():
    sql_repair = f"""
    INSERT INTO public.repair_requests (
      id, job_number, equipment_id, farmer_id, technician_id, status, description, location
    ) VALUES (
      '22222222-2222-2222-2222-222222222222', 'TB-2002',
      '{EQUIPMENT_ID}', '{FARMER_PROFILE_ID}', '{TECH_PROFILE_ID}',
      'ACCEPTED', 'Engine check', 'Wardha Depot'
    ) ON CONFLICT (id) DO NOTHING;
    """
    run_sql(sql_repair)

    _, part_id, _ = run_sql("SELECT id FROM public.service_centre_parts WHERE part_number = '0433171';")
    sql = f"""
    SET request.jwt.claim.sub = '{ADMIN_AUTH_ID}';
    SELECT public.return_service_centre_part('22222222-2222-2222-2222-222222222222'::uuid, '{part_id}'::uuid, 1, 'Return unissued');
    """
    code, out, err = run_sql(sql, check=False)
    assert code != 0
    assert "22023" in err or "never issued" in err, f"Expected 22023 never issued, got: {err}"

def test_1_3_return_part_lifecycle_and_quantity_limit():
    _, part_id, _ = run_sql("SELECT id FROM public.service_centre_parts WHERE part_number = '0433171';")
    _, stock_initial, _ = run_sql(f"SELECT stock_quantity FROM public.service_centre_parts WHERE id = '{part_id}';")
    stock_initial = int(stock_initial)

    # 1. Request 3 units
    req_sql = f"""
    SET request.jwt.claim.sub = '{TECH_AUTH_ID}';
    SELECT public.request_service_centre_part('22222222-2222-2222-2222-222222222222'::uuid, '{part_id}'::uuid, 3, 'Need 3 injectors');
    """
    _, out, _ = run_sql(req_sql)
    req_res = json.loads(out.splitlines()[-1])
    req_id = req_res["request_id"]

    # 2. Admin confirms handoff of 3 units
    handoff_sql = f"""
    SET request.jwt.claim.sub = '{ADMIN_AUTH_ID}';
    SELECT public.confirm_service_centre_part_handoff('{req_id}'::uuid);
    """
    run_sql(handoff_sql)

    _, stock_after_handoff, _ = run_sql(f"SELECT stock_quantity FROM public.service_centre_parts WHERE id = '{part_id}';")
    assert int(stock_after_handoff) == stock_initial - 3

    # 3. Return 1 unit successfully
    ret1_sql = f"""
    SET request.jwt.claim.sub = '{ADMIN_AUTH_ID}';
    SELECT public.return_service_centre_part('22222222-2222-2222-2222-222222222222'::uuid, '{part_id}'::uuid, 1, 'Only 2 needed');
    """
    _, out1, _ = run_sql(ret1_sql)
    res1 = json.loads(out1.splitlines()[-1])
    assert res1["success"] is True
    assert res1["quantity_returned"] == 1
    assert res1["remaining_issued"] == 2
    assert res1["new_stock"] == stock_initial - 2

    # 4. Attempt to return 3 units (only 2 remain) -> Must be rejected with 22023!
    ret_excess_sql = f"""
    SET request.jwt.claim.sub = '{ADMIN_AUTH_ID}';
    SELECT public.return_service_centre_part('22222222-2222-2222-2222-222222222222'::uuid, '{part_id}'::uuid, 3, 'Excess return attempt');
    """
    code, out, err = run_sql(ret_excess_sql, check=False)
    assert code != 0
    assert "22023" in err or "remain eligible" in err, f"Expected 22023 return limit guard, got: {err}"

    # 5. Return remaining 2 units
    ret2_sql = f"""
    SET request.jwt.claim.sub = '{ADMIN_AUTH_ID}';
    SELECT public.return_service_centre_part('22222222-2222-2222-2222-222222222222'::uuid, '{part_id}'::uuid, 2, 'Returned last 2');
    """
    _, out2, _ = run_sql(ret2_sql)
    res2 = json.loads(out2.splitlines()[-1])
    assert res2["remaining_issued"] == 0
    assert res2["new_stock"] == stock_initial

    # 6. Attempt return when 0 remain -> Must be rejected!
    ret_zero_sql = f"""
    SET request.jwt.claim.sub = '{ADMIN_AUTH_ID}';
    SELECT public.return_service_centre_part('22222222-2222-2222-2222-222222222222'::uuid, '{part_id}'::uuid, 1, 'Return when none left');
    """
    code, out, err = run_sql(ret_zero_sql, check=False)
    assert code != 0
    assert "22023" in err or "already been returned" in err, f"Expected 22023 all returned, got: {err}"

    # 7. Verify immutable audit log: 1 handoff (-3), 1 return (+1), 1 return (+2)
    _, audit_count, _ = run_sql(f"""
      SELECT count(*) FROM public.service_centre_stock_audit
      WHERE repair_request_id = '22222222-2222-2222-2222-222222222222'
        AND part_id = '{part_id}';
    """)
    assert int(audit_count) == 3, f"Expected 3 audit rows, found {audit_count}"

# -------------------------------------------------------------
# CATEGORY 2: ETA UPDATE PERMISSIONS & RLS POLICY
# -------------------------------------------------------------
def test_2_1_technician_rls_cannot_modify_unrelated_fields():
    _, part_id, _ = run_sql("SELECT id FROM public.service_centre_parts WHERE part_number = '005556958R1';")
    req_sql = f"""
    SET request.jwt.claim.sub = '{TECH_AUTH_ID}';
    SELECT public.request_service_centre_part('22222222-2222-2222-2222-222222222222'::uuid, '{part_id}'::uuid, 1, 'Filter request');
    """
    _, out, _ = run_sql(req_sql)
    req_id = json.loads(out.splitlines()[-1])["request_id"]

    # As assigned technician, try direct table UPDATE to change quantity from 1 to 999
    # RLS WITH CHECK must reject this!
    tamper_qty_sql = f"""
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '{TECH_AUTH_ID}';
    UPDATE public.service_centre_part_requests
    SET quantity = 999
    WHERE id = '{req_id}';
    """
    code, _, err = run_sql(tamper_qty_sql, check=False)
    assert code != 0, f"Technician direct quantity update should fail, but succeeded! {err}"
    assert "42501" in err or "cannot modify" in err or "Unauthorized" in err or "violates" in err, f"Unexpected error: {err}"

    # As assigned technician, try direct table UPDATE to change status to HANDED_OFF
    tamper_status_sql = f"""
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '{TECH_AUTH_ID}';
    UPDATE public.service_centre_part_requests
    SET status = 'HANDED_OFF'
    WHERE id = '{req_id}';
    """
    code, _, err = run_sql(tamper_status_sql, check=False)
    assert code != 0, f"Technician direct status update should fail, but succeeded! {err}"
    assert "42501" in err or "cannot modify" in err or "Unauthorized" in err or "violates" in err, f"Unexpected error: {err}"

    # As assigned technician, legitimate ETA update via direct UPDATE is allowed
    legit_eta_sql = f"""
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '{TECH_AUTH_ID}';
    UPDATE public.service_centre_part_requests
    SET estimated_arrival_at = now() + interval '2 days', notes = 'Supplier confirmed shipment'
    WHERE id = '{req_id}';
    """
    code, _, err = run_sql(legit_eta_sql)
    assert code == 0, f"Legitimate ETA update failed: {err}"

def test_2_2_unassigned_technician_cannot_update_part_request():
    _, req_id, _ = run_sql("SELECT id FROM public.service_centre_part_requests WHERE repair_request_id = '22222222-2222-2222-2222-222222222222' LIMIT 1;")
    sql = f"""
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '{OTHER_TECH_AUTH_ID}';
    UPDATE public.service_centre_part_requests
    SET estimated_arrival_at = now() + interval '5 days'
    WHERE id = '{req_id}';
    """
    run_sql(sql, check=False)
    _, count, _ = run_sql(f"SELECT count(*) FROM public.service_centre_part_requests WHERE id = '{req_id}' AND estimated_arrival_at > now() + interval '4 days';")
    assert int(count) == 0, "Unassigned technician was able to update part request!"

# -------------------------------------------------------------
# CATEGORY 3: ETA AGGREGATION & JSON RESILIENCE
# -------------------------------------------------------------
def test_3_1_eta_update_with_null_and_malformed_parts_hold():
    run_sql("""
    UPDATE public.repair_requests
    SET parts_hold = '"malformed_string"'::jsonb
    WHERE id = '22222222-2222-2222-2222-222222222222';
    """)

    _, req_id, _ = run_sql("SELECT id FROM public.service_centre_part_requests WHERE repair_request_id = '22222222-2222-2222-2222-222222222222' AND status = 'PENDING' LIMIT 1;")
    
    sql = f"""
    SET request.jwt.claim.sub = '{ADMIN_AUTH_ID}';
    SELECT public.update_service_centre_part_request_eta(
      '{req_id}'::uuid,
      now() + interval '3 days',
      'Handled malformed hold gracefully'
    );
    """
    code, out, err = run_sql(sql)
    assert code == 0, f"Malformed parts_hold failed: {err}"
    res = json.loads(out.splitlines()[-1])
    assert res["success"] is True

def test_3_2_authoritative_latest_pending_eta_aggregation():
    _, p1, _ = run_sql("SELECT id FROM public.service_centre_parts WHERE part_number = '0433171';")
    _, p2, _ = run_sql("SELECT id FROM public.service_centre_parts WHERE part_number = '005556958R1';")

    run_sql(f"""
    INSERT INTO public.repair_requests (
      id, job_number, equipment_id, farmer_id, technician_id, status, description, location
    ) VALUES (
      '33333333-3333-3333-3333-333333333333', 'TB-3003',
      '{EQUIPMENT_ID}', '{FARMER_PROFILE_ID}', '{TECH_PROFILE_ID}',
      'WAITING_FOR_PARTS', 'Hydraulic leak', 'Nagpur Depot'
    ) ON CONFLICT (id) DO NOTHING;
    """)

    # Req 1
    _, out1, _ = run_sql(f"""
    SET request.jwt.claim.sub = '{TECH_AUTH_ID}';
    SELECT public.request_service_centre_part('33333333-3333-3333-3333-333333333333'::uuid, '{p1}'::uuid, 1, 'Part A');
    """)
    r1 = json.loads(out1.splitlines()[-1])["request_id"]

    # Req 2
    _, out2, _ = run_sql(f"""
    SET request.jwt.claim.sub = '{TECH_AUTH_ID}';
    SELECT public.request_service_centre_part('33333333-3333-3333-3333-333333333333'::uuid, '{p2}'::uuid, 1, 'Part B');
    """)
    r2 = json.loads(out2.splitlines()[-1])["request_id"]

    # Set Req 1 ETA to Nov 5
    run_sql(f"""
    SET request.jwt.claim.sub = '{ADMIN_AUTH_ID}';
    SELECT public.update_service_centre_part_request_eta('{r1}'::uuid, '2026-11-05 10:00:00+05:30'::timestamptz, 'Arriving early');
    """)

    _, eta1, _ = run_sql("SELECT parts_hold->>'eta' FROM public.repair_requests WHERE id = '33333333-3333-3333-3333-333333333333';")
    assert "05 Nov 2026" in eta1

    # Set Req 2 ETA to Nov 12 -> Overall ETA MUST become Nov 12 (latest pending)
    run_sql(f"""
    SET request.jwt.claim.sub = '{ADMIN_AUTH_ID}';
    SELECT public.update_service_centre_part_request_eta('{r2}'::uuid, '2026-11-12 15:00:00+05:30'::timestamptz, 'Arriving later');
    """)

    _, eta2, _ = run_sql("SELECT parts_hold->>'eta' FROM public.repair_requests WHERE id = '33333333-3333-3333-3333-333333333333';")
    assert "12 Nov 2026" in eta2, f"Expected latest ETA '12 Nov 2026', got: {eta2}"

    # Now update Req 1 to Nov 08 (earlier than Nov 12) -> Overall ETA MUST STILL BE Nov 12!
    run_sql(f"""
    SET request.jwt.claim.sub = '{ADMIN_AUTH_ID}';
    SELECT public.update_service_centre_part_request_eta('{r1}'::uuid, '2026-11-08 10:00:00+05:30'::timestamptz, 'Slight delay on part A');
    """)

    _, eta3, _ = run_sql("SELECT parts_hold->>'eta' FROM public.repair_requests WHERE id = '33333333-3333-3333-3333-333333333333';")
    assert "12 Nov 2026" in eta3, f"Expected overall ETA to stay latest '12 Nov 2026', got: {eta3}"

# -------------------------------------------------------------
# CATEGORY 4: QUOTE STATE VALIDATION & REVISION ELIGIBILITY
# -------------------------------------------------------------
def test_4_1_waiting_for_parts_empty_hold_rejected():
    run_sql(f"""
    INSERT INTO public.repair_requests (
      id, job_number, equipment_id, farmer_id, technician_id, status, description, location, parts_hold
    ) VALUES (
      '44444444-4444-4444-4444-444444444444', 'TB-4004',
      '{EQUIPMENT_ID}', '{FARMER_PROFILE_ID}', '{TECH_PROFILE_ID}',
      'WAITING_FOR_PARTS', 'Transmission gear slip', 'Nagpur',
      '{{"allPartsArrived": true, "items": []}}'::jsonb
    ) ON CONFLICT (id) DO UPDATE SET status = 'WAITING_FOR_PARTS', parts_hold = '{{"allPartsArrived": true, "items": []}}'::jsonb;
    """)

    sql = f"""
    SET request.jwt.claim.sub = '{TECH_AUTH_ID}';
    SELECT public.create_quote_atomic(
      '44444444-4444-4444-4444-444444444444'::uuid,
      'Gear inspection'::text,
      1200::numeric,
      18::numeric,
      '2 days'::text,
      '30 days'::text,
      '[]'::jsonb
    );
    """
    code, _, err = run_sql(sql, check=False)
    assert code != 0
    assert "22023" in err or "without an active parts hold" in err, f"Expected 22023 without active hold, got: {err}"

def test_4_2_cannot_revise_approved_or_rejected_quote():
    run_sql(f"""
    INSERT INTO public.repair_requests (
      id, job_number, equipment_id, farmer_id, technician_id, status, description, location
    ) VALUES (
      '55555555-5555-5555-5555-555555555555', 'TB-5005',
      '{EQUIPMENT_ID}', '{FARMER_PROFILE_ID}', '{TECH_PROFILE_ID}',
      'ACCEPTED', 'Water seal broken', 'Amravati'
    ) ON CONFLICT (id) DO NOTHING;
    """)

    # Formulate v1
    _, out, _ = run_sql(f"""
    SET request.jwt.claim.sub = '{TECH_AUTH_ID}';
    SELECT public.create_quote_atomic(
      '55555555-5555-5555-5555-555555555555'::uuid,
      'Seal replacement'::text,
      800::numeric,
      18::numeric,
      '1 day'::text,
      '60 days'::text,
      '[]'::jsonb
    );
    """)
    q1_id = json.loads(out.splitlines()[-1])["id"]

    # Farmer approves quote v1
    run_sql(f"UPDATE public.quotes SET status = 'APPROVED' WHERE id = '{q1_id}';")

    # Attempt to revise APPROVED quote -> Must be rejected with 22023!
    rev_approved_sql = f"""
    SET request.jwt.claim.sub = '{TECH_AUTH_ID}';
    SELECT public.revise_quote_atomic(
      '{q1_id}'::uuid,
      '55555555-5555-5555-5555-555555555555'::uuid,
      'Revised labor'::text,
      1000::numeric,
      18::numeric,
      '2 days'::text,
      '60 days'::text,
      'Extra seal needed'::text,
      '[]'::jsonb
    );
    """
    code, _, err = run_sql(rev_approved_sql, check=False)
    assert code != 0
    assert "22023" in err or "already APPROVED" in err, f"Expected 22023 cannot revise approved quote, got: {err}"

    # Change to REJECTED
    run_sql(f"UPDATE public.quotes SET status = 'REJECTED' WHERE id = '{q1_id}';")
    code, _, err = run_sql(rev_approved_sql, check=False)
    assert code != 0
    assert "22023" in err or "already REJECTED" in err, f"Expected 22023 cannot revise rejected quote, got: {err}"

def test_4_3_cannot_revise_quote_for_completed_or_cancelled_repair():
    _, q1_id, _ = run_sql("SELECT id FROM public.quotes WHERE repair_request_id = '55555555-5555-5555-5555-555555555555' LIMIT 1;")
    run_sql(f"UPDATE public.quotes SET status = 'PENDING' WHERE id = '{q1_id}';")

    # Set repair to COMPLETED
    run_sql("UPDATE public.repair_requests SET status = 'COMPLETED' WHERE id = '55555555-5555-5555-5555-555555555555';")

    sql = f"""
    SET request.jwt.claim.sub = '{TECH_AUTH_ID}';
    SELECT public.revise_quote_atomic(
      '{q1_id}'::uuid,
      '55555555-5555-5555-5555-555555555555'::uuid,
      'Revised labor'::text,
      900::numeric,
      18::numeric,
      '1 day'::text,
      '30 days'::text,
      'Note'::text,
      '[]'::jsonb
    );
    """
    code, _, err = run_sql(sql, check=False)
    assert code != 0
    assert "22000" in err or "COMPLETED status" in err, f"Expected 22000 on closed repair, got: {err}"

# -------------------------------------------------------------
# CATEGORY 5: INPUT AND DATA VALIDATION
# -------------------------------------------------------------
def test_5_1_null_and_negative_quantity_validation():
    _, part_id, _ = run_sql("SELECT id FROM public.service_centre_parts WHERE part_number = '0433171';")

    # receive with NULL quantity
    sql_rec_null = f"""
    SET request.jwt.claim.sub = '{ADMIN_AUTH_ID}';
    SELECT public.receive_service_centre_stock('{part_id}'::uuid, NULL, 'Supplier delivery');
    """
    code, _, err = run_sql(sql_rec_null, check=False)
    assert code != 0
    assert "22003" in err or "must be positive" in err, f"Expected 22003 on NULL receive qty, got: {err}"

    # receive with 0 quantity
    sql_rec_zero = f"""
    SET request.jwt.claim.sub = '{ADMIN_AUTH_ID}';
    SELECT public.receive_service_centre_stock('{part_id}'::uuid, 0, 'Supplier delivery');
    """
    code, _, err = run_sql(sql_rec_zero, check=False)
    assert code != 0
    assert "22003" in err or "must be positive" in err, f"Expected 22003 on 0 receive qty, got: {err}"

    # return with NULL quantity
    sql_ret_null = f"""
    SET request.jwt.claim.sub = '{ADMIN_AUTH_ID}';
    SELECT public.return_service_centre_part('22222222-2222-2222-2222-222222222222'::uuid, '{part_id}'::uuid, NULL, 'Return');
    """
    code, _, err = run_sql(sql_ret_null, check=False)
    assert code != 0
    assert "22003" in err or "must be positive" in err, f"Expected 22003 on NULL return qty, got: {err}"

def test_5_2_monetary_validation_in_quotes():
    # Negative labour amount
    sql_neg_labour = f"""
    SET request.jwt.claim.sub = '{TECH_AUTH_ID}';
    SELECT public.create_quote_atomic(
      '22222222-2222-2222-2222-222222222222'::uuid,
      'Test'::text,
      -500::numeric,
      18::numeric,
      '1 day'::text,
      '30 days'::text,
      '[]'::jsonb
    );
    """
    code, _, err = run_sql(sql_neg_labour, check=False)
    assert code != 0
    assert "22003" in err or "non-negative" in err, f"Expected 22003 on negative labour, got: {err}"

    # Tax percent > 100
    sql_high_tax = f"""
    SET request.jwt.claim.sub = '{TECH_AUTH_ID}';
    SELECT public.create_quote_atomic(
      '22222222-2222-2222-2222-222222222222'::uuid,
      'Test'::text,
      500::numeric,
      150::numeric,
      '1 day'::text,
      '30 days'::text,
      '[]'::jsonb
    );
    """
    code, _, err = run_sql(sql_high_tax, check=False)
    assert code != 0
    assert "22003" in err or "between 0 and 100" in err, f"Expected 22003 on tax > 100, got: {err}"

    # Non-array JSON items
    sql_obj_items = f"""
    SET request.jwt.claim.sub = '{TECH_AUTH_ID}';
    SELECT public.create_quote_atomic(
      '22222222-2222-2222-2222-222222222222'::uuid,
      'Test'::text,
      500::numeric,
      18::numeric,
      '1 day'::text,
      '30 days'::text,
      '{{"item": "invalid"}}'::jsonb
    );
    """
    code, _, err = run_sql(sql_obj_items, check=False)
    assert code != 0
    assert "22023" in err or "JSON array" in err, f"Expected 22023 on non-array items, got: {err}"

# -------------------------------------------------------------
# CATEGORY 6: TECHNICIAN REGISTRATION DEDUPLICATION
# -------------------------------------------------------------
def test_6_1_two_technicians_with_same_name_both_notified():
    # Register Tech 1: Rajesh Sharma (profile ccc...)
    sql_tech1 = """
    INSERT INTO public.profiles (id, auth_user_id, role, full_name, email, phone)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', NULL, 'technician', 'Rajesh Sharma', 'rajesh1@demo.test', '+91 99999 11111');

    INSERT INTO public.technician_profiles (profile_id, workshop_name, is_verified, is_available)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Sharma Motors Wardha', false, true);
    """
    run_sql(sql_tech1)

    # Register Tech 2: SAME NAME 'Rajesh Sharma' but different profile ID (ddd...)
    sql_tech2 = """
    INSERT INTO public.profiles (id, auth_user_id, role, full_name, email, phone)
    VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', NULL, 'technician', 'Rajesh Sharma', 'rajesh2@demo.test', '+91 99999 22222');

    INSERT INTO public.technician_profiles (profile_id, workshop_name, is_verified, is_available)
    VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Sharma Agro Nagpur', false, true);
    """
    run_sql(sql_tech2)

    # Both technicians MUST have an admin notification because profile_id differs!
    _, count1, _ = run_sql("SELECT count(*) FROM public.notifications WHERE notification_text LIKE '%[Ref: cccccccc-cccc-cccc-cccc-cccccccccccc]%';")
    _, count2, _ = run_sql("SELECT count(*) FROM public.notifications WHERE notification_text LIKE '%[Ref: dddddddd-dddd-dddd-dddd-dddddddddddd]%';")
    assert int(count1) == 1, f"Expected 1 notification for tech 1, got {count1}"
    assert int(count2) == 1, f"Expected 1 notification for tech 2, got {count2}"

    # Verify link_target is exactly '/admin/technicians' and recipient_role is 'admin'
    _, row, _ = run_sql("SELECT recipient_role, recipient_user_id, link_target FROM public.notifications WHERE notification_text LIKE '%[Ref: cccccccc-cccc-cccc-cccc-cccccccccccc]%';")
    assert "admin||/admin/technicians" in row, f"Unexpected notification row attributes: {row}"

def test_6_2_concurrent_or_duplicate_registration_deduplicated():
    # Remove technician_profile for ccc... but leave the existing notification in notifications table
    # Then re-insert technician_profile ccc... to trigger notify_admin_on_technician_registration again
    run_sql("DELETE FROM public.technician_profiles WHERE profile_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';")
    
    # Re-insert technician_profile
    reinsert_sql = """
    INSERT INTO public.technician_profiles (profile_id, workshop_name, is_verified, is_available)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Sharma Motors Wardha (Re-attempt)', false, true);
    """
    run_sql(reinsert_sql)

    # Notification count MUST remain exactly 1 (deduplicated by [Ref: ccc...])
    _, count, _ = run_sql("SELECT count(*) FROM public.notifications WHERE notification_text LIKE '%[Ref: cccccccc-cccc-cccc-cccc-cccccccccccc]%';")
    assert int(count) == 1, f"Expected exactly 1 notification after re-insertion, got {count} (duplicate created!)"

# -------------------------------------------------------------
# MAIN RUNNER
# -------------------------------------------------------------
def main():
    setup_fixtures()

    print("\n--- CATEGORY 1: PART RETURN INTEGRITY TESTS ---")
    test("T1.1", "Return for Non-Existent Repair Ticket Rejected (P0002)", test_1_1_return_nonexistent_repair_rejected)
    test("T1.2", "Return for Part Never Issued to Repair Rejected (22023)", test_1_2_return_part_never_issued_rejected)
    test("T1.3", "Return Part Lifecycle, Quantity-Limit Guard & Audit Immutability", test_1_3_return_part_lifecycle_and_quantity_limit)

    print("\n--- CATEGORY 2: ETA UPDATE PERMISSIONS & RLS POLICY TESTS ---")
    test("T2.1", "Technician RLS Policy Prevents Modifying Unrelated Requisition Fields", test_2_1_technician_rls_cannot_modify_unrelated_fields)
    test("T2.2", "Unassigned Technician Cannot Update Part Requisition", test_2_2_unassigned_technician_cannot_update_part_request)

    print("\n--- CATEGORY 3: ETA AGGREGATION & JSON RESILIENCE TESTS ---")
    test("T3.1", "ETA Update RPC Resilient to NULL & Malformed parts_hold JSON", test_3_1_eta_update_with_null_and_malformed_parts_hold)
    test("T3.2", "Authoritative Latest Pending ETA Aggregation Across Multiple Parts", test_3_2_authoritative_latest_pending_eta_aggregation)

    print("\n--- CATEGORY 4: QUOTE STATE VALIDATION & REVISION ELIGIBILITY TESTS ---")
    test("T4.1", "Quote in WAITING_FOR_PARTS Rejected when Parts Hold is Empty/Resolved", test_4_1_waiting_for_parts_empty_hold_rejected)
    test("T4.2", "Revising APPROVED or REJECTED Quotes Rejected (22023)", test_4_2_cannot_revise_approved_or_rejected_quote)
    test("T4.3", "Revising Quote for COMPLETED Repair Rejected (22000)", test_4_3_cannot_revise_quote_for_completed_or_cancelled_repair)

    print("\n--- CATEGORY 5: INPUT AND DATA VALIDATION TESTS ---")
    test("T5.1", "NULL and Zero/Negative Quantities Rejected in Stock RPCs (22003)", test_5_1_null_and_negative_quantity_validation)
    test("T5.2", "Monetary & Array Validation in Quotes (Labour, Tax, Items)", test_5_2_monetary_validation_in_quotes)

    print("\n--- CATEGORY 6: TECHNICIAN REGISTRATION DEDUPLICATION TESTS ---")
    test("T6.1", "Two Technicians with Same Name Both Generate Admin Notifications", test_6_1_two_technicians_with_same_name_both_notified)
    test("T6.2", "Concurrent/Duplicate Registration for Same Profile Deduplicated", test_6_2_concurrent_or_duplicate_registration_deduplicated)

    print("\n=======================================================")
    passed = sum(1 for r in results if r["status"] == "PASSED")
    failed = sum(1 for r in results if r["status"] == "FAILED")
    print(f"TOTAL TESTS: {len(results)} | PASSED: {passed} | FAILED: {failed}")
    if failed == 0:
        print("ALL STEP 5A.1 CORRECTION TESTS PASSED CLEANLY!")
    else:
        print("SOME TESTS FAILED. Review errors above.")
    print("=======================================================")

    with open("scratch/step5a1_test_results.json", "w") as f:
        json.dump(results, f, indent=2)

if __name__ == "__main__":
    main()
