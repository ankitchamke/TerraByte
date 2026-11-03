import subprocess
import json
import re

queries = {
    "20261001151000": """
        SELECT pg_get_functiondef('public.handle_new_user'::regproc) AS fdef,
               (SELECT count(*) FROM pg_trigger WHERE tgname = 'on_auth_user_created') AS trg_count;
    """,
    "20261001151200": """
        SELECT pg_get_functiondef('public.current_profile_id'::regproc) AS fdef_id,
               pg_get_functiondef('public.current_user_role'::regproc) AS fdef_role,
               (SELECT count(*) FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can update own profile') AS pol1,
               (SELECT count(*) FROM pg_policies WHERE tablename = 'technician_profiles' AND policyname = 'Admins can update technician profiles') AS pol2;
    """,
    "20261001153500": """
        SELECT count(*) AS confirmed_demo_users
        FROM auth.users
        WHERE email IN ('farmer.nagpur@terrabyte.demo', 'tech.nagpur@terrabyte.demo', 'admin.nagpur@terrabyte.demo')
          AND encrypted_password LIKE '$2a$10$%'
          AND email_confirmed_at IS NOT NULL;
    """,
    "20261001163000": """
        SELECT pg_get_functiondef('public.protect_technician_verification'::regproc) AS fdef_prot,
               (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_protect_technician_verification') AS trg_prot,
               (SELECT count(*) FROM pg_policies WHERE policyname IN (
                   'Quote items view policy',
                   'Repair timeline view policy',
                   'Repair notes view policy',
                   'Service history view policy',
                   'Technician profiles are viewable by authenticated users'
               )) AS hardened_policies_count;
    """,
    "20261001170000": """
        SELECT (SELECT count(*) FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Allow authenticated users to insert profile') AS pol_ins,
               (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (
                   'idx_profiles_clerk_user_id',
                   'idx_quotes_ticket_id',
                   'idx_repair_notes_ticket_id',
                   'idx_repair_timeline_ticket_id',
                   'idx_service_history_equipment_id',
                   'idx_technician_profiles_verified',
                   'idx_technician_profiles_rating'
               )) AS index_count;
    """,
    "20261002000000": """
        SELECT count(*) AS notif_policies
        FROM pg_policies
        WHERE tablename = 'notifications' AND policyname IN (
            'Users can insert own notifications and admins insert any',
            'Users can view own notifications',
            'Users can update read status of own notifications'
        );
    """,
    "20261004100000": """
        SELECT (SELECT count(*) FROM pg_enum WHERE enumlabel = 'CANCELLATION_REQUESTED') AS enum_exists,
               (SELECT count(*) FROM information_schema.columns WHERE table_name = 'repair_requests' AND column_name IN (
                   'cancellation_reason', 'cancellation_status', 'cancelled_by', 'cancellation_notes', 'cancelled_at', 'cancellation_reviewed_by'
               )) AS col_count,
               (SELECT count(*) FROM pg_indexes WHERE indexname = 'idx_repair_requests_cancellation_pending') AS idx_exists,
               (SELECT count(*) FROM pg_policies WHERE tablename = 'repair_requests' AND policyname IN (
                   'Admins have full operational update access',
                   'Farmers can update active repair requests',
                   'Farmers can directly cancel unassigned repairs'
               )) AS pol_count;
    """,
    "20261005100000": """
        SELECT (SELECT count(*) FROM information_schema.tables WHERE table_name = 'repair_messages') AS tbl_exists,
               (SELECT count(*) FROM pg_indexes WHERE indexname IN ('idx_repair_messages_unread', 'idx_repair_messages_ticket')) AS idx_count,
               (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_guard_repair_messages_update') AS trg_exists,
               (SELECT count(*) FROM pg_policies WHERE tablename = 'repair_messages') AS pol_count;
    """,
    "20261006100000": """
        SELECT count(*) AS pub_tables_count
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename IN ('notifications', 'repair_requests', 'quotes', 'repair_timeline');
    """,
    "20261006110000": """
        SELECT count(*) AS tech_decline_policy_count,
               pg_get_expr(polwithcheck, polrelid) AS with_check_expr
        FROM pg_policy
        WHERE polname = 'Technicians can update assigned repairs and accept jobs';
    """,
    "20261102100000": """
        SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name = 'repair_requests' AND column_name IN (
                   'service_type', 'is_machine_stopped', 'urgency_level', 'preferred_time_slot', 'field_landmark'
               )) AS doorstep_cols,
               (SELECT count(*) FROM pg_constraint WHERE conname IN ('check_service_type', 'check_urgency_level')) AS constraints_count,
               (SELECT count(*) FROM pg_indexes WHERE indexname IN ('idx_repair_requests_urgency_triage', 'idx_repair_requests_service_type')) AS idx_count;
    """,
    "20261103110000": """
        SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN ('repair_messages', 'repair_timeline') AND c.relreplident = 'f') AS full_repl_count,
               (SELECT prosrc FROM pg_proc WHERE proname = 'reset_demo_data') LIKE '%v_equipment_deleted%' AS reset_has_cleanup;
    """
}

results = {}

for ver, q in queries.items():
    cmd = ["npx", "supabase", "db", "query", "--remote", "--read-only", q.strip().replace("\n", " ")]
    res = subprocess.run(cmd, capture_output=True, text=True, shell=True)
    results[ver] = {
        "returncode": res.returncode,
        "stdout": res.stdout,
        "stderr": res.stderr
    }

with open("scratch/step3a_candidate_live_verification.json", "w") as out:
    json.dump(results, out, indent=2)

print("All 12 live database queries executed.")
