-- ==============================================================================
-- TerraByte — RLS Verification Helper Function
-- Migration: 20260930000005_verify_rls_helper.sql
-- Description: Provides an inspectable function to verify RLS enablement and policy counts
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.check_table_rls()
RETURNS TABLE (table_name text, rls_enabled boolean, policy_count bigint) AS $$
  SELECT 
    t.tablename::text AS table_name,
    t.rowsecurity AS rls_enabled,
    COUNT(p.policyname)::bigint AS policy_count
  FROM pg_tables t
  LEFT JOIN pg_policies p ON p.schemaname = t.schemaname AND p.tablename = t.tablename
  WHERE t.schemaname = 'public'
    AND t.tablename IN (
      'profiles',
      'technician_profiles',
      'equipment',
      'repair_requests',
      'quotes',
      'quote_items',
      'service_history',
      'repair_timeline',
      'repair_notes',
      'notifications'
    )
  GROUP BY t.tablename, t.rowsecurity
  ORDER BY t.tablename;
$$ LANGUAGE sql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.check_table_rls() TO anon, authenticated, service_role;
