import glob
import os
import re

mig_files = sorted(glob.glob("supabase/migrations/*.sql"))

categories = {
    # 1. Base initial schema
    "20260930000001_initial_schema.sql": {
        "classification": "HISTORICAL / SUPERSEDED",
        "reason": "Initial schema missing columns (clerk_user_id, email, status_history, catalog_part_id) added by later migrations and consolidated in canonical schema."
    },
    "20260930000002_storage_setup.sql": {
        "classification": "REQUIRED FOR CURRENT APPLICATION",
        "reason": "Creates avatars and repair-images storage buckets."
    },
    "20260930000003_grant_permissions.sql": {
        "classification": "REQUIRED FOR CURRENT APPLICATION",
        "reason": "Grants schema usage and table privileges to anon and authenticated roles."
    },
    "20260930000004_storage_policies.sql": {
        "classification": "REQUIRED FOR CURRENT APPLICATION",
        "reason": "Defines RLS policies on storage.objects for avatars and repair-images."
    },
    "20260930000005_verify_rls_helper.sql": {
        "classification": "REQUIRED FOR CURRENT APPLICATION",
        "reason": "Defines public.check_table_rls() diagnostic helper function."
    },
    "20260930000006_legacy_remote_placeholder.sql": {
        "classification": "HISTORICAL / SUPERSEDED",
        "reason": "Empty no-op DO block created to align version timestamps."
    },
    "20260930000007_legacy_remote_placeholder.sql": {
        "classification": "HISTORICAL / SUPERSEDED",
        "reason": "Empty no-op DO block created to align version timestamps."
    },
    "20260930000008_legacy_remote_placeholder.sql": {
        "classification": "HISTORICAL / SUPERSEDED",
        "reason": "Empty no-op DO block created to align version timestamps."
    },
    "20261001151000_fix_technician_signup_trigger.sql": {
        "classification": "REQUIRED FOR CURRENT APPLICATION",
        "reason": "Defines public.handle_new_user() trigger function on auth.users."
    },
    "20261001151200_restore_supabase_auth_rls_helpers.sql": {
        "classification": "DUPLICATE / CONFLICTING",
        "reason": "References profiles.clerk_user_id which does not exist in initial schema; superseded by auth helper functions."
    },
    "20261001153500_set_demo_users_password.sql": {
        "classification": "HISTORICAL / SUPERSEDED",
        "reason": "Hardcoded password reset for production demo accounts; prohibited on staging."
    },
    "20261001163000_phase2_security_hardening.sql": {
        "classification": "DUPLICATE / CONFLICTING",
        "reason": "References profiles.clerk_user_id in RLS policies; superseded by Phase 11 profile security."
    },
    "20261001170000_phase2_3_database_foundation.sql": {
        "classification": "DUPLICATE / CONFLICTING",
        "reason": "Attempts to add unique constraint on profiles(email) before email column is created in initial schema."
    },
    "20261002000000_phase3_6_notifications_insert_policy.sql": {
        "classification": "REQUIRED FOR CURRENT APPLICATION",
        "reason": "Permits authenticated users to insert system notifications."
    },
    "20261002130000_phase3_7_rls_integrity_hardening.sql": {
        "classification": "REQUIRED FOR CURRENT APPLICATION",
        "reason": "Hardens RLS policies on equipment, repair_requests, and technician_profiles."
    },
    "20261003131500_phase5_1_technician_profile_update_policy.sql": {
        "classification": "REQUIRED FOR CURRENT APPLICATION",
        "reason": "Allows technicians to update their own profile."
    },
    "20261003140000_phase5_1_account_deletion_rpc.sql": {
        "classification": "HISTORICAL / SUPERSEDED",
        "reason": "Initial account deletion RPC; superseded by 141000 enum fix."
    },
    "20261003141000_phase5_1_account_deletion_role_enum_fix.sql": {
        "classification": "REQUIRED FOR CURRENT APPLICATION",
        "reason": "Defines public.delete_user_account() with proper user_role casting."
    },
    "20261003150000_phase5_2_reset_demo_rpc.sql": {
        "classification": "HISTORICAL / SUPERSEDED",
        "reason": "Early monolithic reset_demo_data() RPC; superseded by phase8b and phase9_3."
    },
    "20261003170000_phase5_3_technician_registration_notification.sql": {
        "classification": "HISTORICAL / SUPERSEDED",
        "reason": "Initial tech registration trigger; superseded by 20261104130000."
    },
    "20261004100000_phase5_4_cancellation_approval_foundation.sql": {
        "classification": "REQUIRED FOR CURRENT APPLICATION",
        "reason": "Adds cancellation request workflow fields and approval transitions to repair_requests."
    },
    "20261005100000_phase5_5_communication_foundation.sql": {
        "classification": "REQUIRED FOR CURRENT APPLICATION",
        "reason": "Creates public.repair_messages table and RLS policies for farmer-technician chat."
    },
    "20261006100000_phase7_1_realtime_publication_foundation.sql": {
        "classification": "REQUIRED FOR CURRENT APPLICATION",
        "reason": "Adds repair_requests and notifications to supabase_realtime publication."
    },
    "20261006110000_phase7_3_technician_decline_rls.sql": {
        "classification": "REQUIRED FOR CURRENT APPLICATION",
        "reason": "Hardens RLS for technician decline operations."
    },
    "20261027100000_phase8b_1_dispatch_locations.sql": {
        "classification": "REQUIRED FOR CURRENT APPLICATION",
        "reason": "Creates public.repair_dispatch_locations table for GPS coordinates and routing."
    },
    "20261028110000_phase8b_cleanup_reset_demo_rpc.sql": {
        "classification": "HISTORICAL / SUPERSEDED",
        "reason": "Phase 8b demo reset update; superseded by phase9_3 safe scoped reset."
    },
    "20261029100000_phase9_1_parts_pickup.sql": {
        "classification": "HISTORICAL / SUPERSEDED",
        "reason": "Initial Phase 9.1 parts pickup; contains embedded demo seed errors and superseded RPCs. Consolidated into 20261104110000."
    },
    "20261029120000_phase9_2_stock_movement_sales.sql": {
        "classification": "HISTORICAL / SUPERSEDED",
        "reason": "Initial stock movements and sales; consolidated into 20261104110000 and 20261104120000."
    },
    "20261031153000_phase9_3_safe_scoped_reset_demo_rpc.sql": {
        "classification": "REQUIRED FOR CURRENT APPLICATION",
        "reason": "Defines safe scoped reset_demo_data() preserving non-demo records."
    },
    "20261031170000_phase9_2_quote_catalog_and_inventory.sql": {
        "classification": "HISTORICAL / SUPERSEDED",
        "reason": "Initial quote catalog link; contains embedded demo seed errors. Consolidated into 20261104120000."
    },
    "20261031173000_phase9_3_parts_handoff_rpcs.sql": {
        "classification": "HISTORICAL / SUPERSEDED",
        "reason": "Early parts handoff RPC draft; consolidated into 20261104110000."
    },
    "20261031183000_phase9_3_realtime_publications.sql": {
        "classification": "HISTORICAL / SUPERSEDED",
        "reason": "Early realtime publications draft; consolidated into 20261104120000."
    },
    "20261101140000_phase9_3_unavailable_parts_eta.sql": {
        "classification": "HISTORICAL / SUPERSEDED",
        "reason": "Early ETA RPC draft with enum cast error; consolidated into 20261104120000."
    },
    "20261103120000_phase11_visual_defect_diagnostics.sql": {
        "classification": "REQUIRED FOR CURRENT APPLICATION",
        "reason": "Phase 11 visual defect assessment, consent tracking, and photo diagnostics."
    },
    "20261104100000_profile_security_separation.sql": {
        "classification": "REQUIRED FOR CURRENT APPLICATION",
        "reason": "Hardens profile security, creates app_security schema, profile_contacts, profile_auth_secrets, get_session_profile RPC."
    },
    "20261104110000_complete_phase9_parts_desk_rpcs.sql": {
        "classification": "REQUIRED FOR CLEAN INSTALL",
        "reason": "Consolidated forward migration A: creates parts desk stock audit ledger and 5 hardened SECURITY DEFINER RPCs."
    },
    "20261104120000_complete_phase9_realtime_and_eta.sql": {
        "classification": "REQUIRED FOR CLEAN INSTALL",
        "reason": "Consolidated forward migration B: creates ETA tracking, atomic quote formulation RPCs, catalog foreign keys, and realtime publications."
    },
    "20261104130000_complete_phase5_3_technician_registration_notification.sql": {
        "classification": "REQUIRED FOR CLEAN INSTALL",
        "reason": "Consolidated forward migration C: registers administrative notification trigger on technician registration."
    }
}

for mf in mig_files:
    fname = os.path.basename(mf)
    c = categories.get(fname, {"classification": "NEEDS INVESTIGATION", "reason": "Uncategorized"})
    print(f"### {fname}\n- **Classification:** `{c['classification']}`\n- **Rationale:** {c['reason']}\n")
