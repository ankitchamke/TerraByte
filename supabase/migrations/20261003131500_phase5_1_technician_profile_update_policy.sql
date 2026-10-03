-- Phase 5.1 Step 3B: Allow authenticated technicians to update their own workshop profile
-- Migration: 20261003131500_phase5_1_technician_profile_update_policy.sql
-- Description: Updates the 'tech_update_own' policy on technician_profiles to match
-- by profile_id = current_profile_id() in addition to id = auth.uid(), allowing
-- technicians to update their own workshop information safely.

DROP POLICY IF EXISTS "tech_update_own" ON public.technician_profiles;

CREATE POLICY "tech_update_own"
ON public.technician_profiles
FOR UPDATE
TO authenticated
USING (
  profile_id = public.current_profile_id()
  OR id = auth.uid()
)
WITH CHECK (
  profile_id = public.current_profile_id()
  OR id = auth.uid()
);
