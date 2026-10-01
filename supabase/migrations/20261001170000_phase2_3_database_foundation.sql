-- Phase 2.3 Database Foundation Migration
-- 1. Modernize Profiles INSERT Policy for native Supabase Auth
-- 2. Add high-value query & foreign-key indexes across domain tables
-- 3. Solidify domain constraints and model documentation

-- ============================================================================
-- 1. PROFILES INSERT POLICY
-- ============================================================================

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

CREATE POLICY "Users can insert own profile" ON public.profiles
FOR INSERT TO authenticated
WITH CHECK (auth_user_id = auth.uid() OR id = auth.uid());

-- ============================================================================
-- 2. QUERY & FOREIGN-KEY INDEXES
-- ============================================================================

-- Fast profile lookup by email (used during authentication / loadProfile)
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles (email);

-- Fast filtering of approved vs pending technicians in admin dashboard
CREATE INDEX IF NOT EXISTS idx_technician_profiles_verified ON public.technician_profiles (is_verified);

-- Fast lookup of quotes by quoting technician
CREATE INDEX IF NOT EXISTS idx_quotes_technician_id ON public.quotes (technician_id);

-- Fast filtering of quotes by status (PENDING, APPROVED, etc.)
CREATE INDEX IF NOT EXISTS idx_quotes_status ON public.quotes (status);

-- Fast lookup of service history linked to repair requests
CREATE INDEX IF NOT EXISTS idx_service_history_repair_id ON public.service_history (repair_request_id);

-- Fast lookup of repair notes by author
CREATE INDEX IF NOT EXISTS idx_repair_notes_author_id ON public.repair_notes (author_id);

-- Fast lookup of timeline entries by creator
CREATE INDEX IF NOT EXISTS idx_repair_timeline_created_by ON public.repair_timeline (created_by_id);

-- ============================================================================
-- 3. DOMAIN CHECK CONSTRAINTS
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotes_tax_percent_max_check') THEN
    ALTER TABLE public.quotes ADD CONSTRAINT quotes_tax_percent_max_check CHECK (tax_percent <= 100);
  END IF;
END $$;
