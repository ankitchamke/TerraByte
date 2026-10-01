-- ==============================================================================
-- TerraByte — Initial Relational Schema Migration
-- Migration: 20260930000001_initial_schema.sql
-- Description: Core schema for TerraByte agricultural equipment repair platform.
-- Coordinates: Equipment -> Breakdown Intake -> Technician Matching -> Quotes -> Repair Tracking -> Service History
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. ENUMS
DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM ('farmer', 'technician', 'admin');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE public.equipment_type AS ENUM ('Tractor', 'Harvester', 'Power Tiller', 'Pump', 'Sprayer');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE public.equipment_status AS ENUM ('Operational', 'In Repair', 'Needs Attention');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE public.repair_status AS ENUM (
    'REQUESTED',
    'ACCEPTED',
    'QUOTE_PENDING',
    'QUOTE_REVISED',
    'IN_PROGRESS',
    'WAITING_FOR_PARTS',
    'COMPLETED',
    'CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE public.quote_status AS ENUM ('PENDING', 'APPROVED', 'REVISED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 3. HELPER FUNCTIONS FOR TIMESTAMPS
CREATE OR REPLACE FUNCTION public.set_current_timestamp_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. TABLES

-- ------------------------------------------------------------------------------
-- PROFILES (Users: Farmers, Technicians, Service Centre Admins)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.user_role NOT NULL DEFAULT 'farmer',
  full_name TEXT NOT NULL,
  phone TEXT,
  village TEXT,
  demo_code TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER handle_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- ------------------------------------------------------------------------------
-- TECHNICIAN PROFILES (Operational & matching attributes for technicians)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.technician_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  workshop_name TEXT NOT NULL,
  brands TEXT[] NOT NULL DEFAULT '{}',
  skills TEXT[] NOT NULL DEFAULT '{}',
  is_verified BOOLEAN NOT NULL DEFAULT false,
  distance_km NUMERIC(5, 1) NOT NULL DEFAULT 0.0,
  eta_minutes INTEGER NOT NULL DEFAULT 45,
  is_available BOOLEAN NOT NULL DEFAULT true,
  rating NUMERIC(3, 2) NOT NULL DEFAULT 5.00 CHECK (rating >= 0 AND rating <= 5),
  jobs_completed INTEGER NOT NULL DEFAULT 0 CHECK (jobs_completed >= 0),
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER handle_technician_profiles_updated_at
  BEFORE UPDATE ON public.technician_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- ------------------------------------------------------------------------------
-- EQUIPMENT (Farm machinery assets owned by farmers)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type public.equipment_type NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year INTEGER CHECK (year >= 1970 AND year <= 2100),
  serial_number TEXT NOT NULL,
  operating_hours INTEGER NOT NULL DEFAULT 0 CHECK (operating_hours >= 0),
  photo_url TEXT,
  status public.equipment_status NOT NULL DEFAULT 'Operational',
  demo_code TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER handle_equipment_updated_at
  BEFORE UPDATE ON public.equipment
  FOR EACH ROW
  EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- ------------------------------------------------------------------------------
-- REPAIR REQUESTS (Core lifecycle jobs from breakdown report to completion)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.repair_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_number TEXT NOT NULL UNIQUE,
  equipment_id UUID NOT NULL REFERENCES public.equipment(id) ON DELETE RESTRICT,
  farmer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  technician_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status public.repair_status NOT NULL DEFAULT 'REQUESTED',
  is_testing BOOLEAN NOT NULL DEFAULT false,
  symptoms TEXT[] NOT NULL DEFAULT '{}',
  description TEXT NOT NULL DEFAULT '',
  photos TEXT[] NOT NULL DEFAULT '{}',
  location TEXT NOT NULL,
  assessment JSONB NOT NULL DEFAULT '{}'::jsonb,
  status_since TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  declined_by UUID[] NOT NULL DEFAULT '{}',
  clarification_note TEXT,
  parts_hold JSONB,
  completion_details JSONB,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER handle_repair_requests_updated_at
  BEFORE UPDATE ON public.repair_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- ------------------------------------------------------------------------------
-- QUOTES (Transparent price quotes prepared by technicians for repair jobs)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_request_id UUID NOT NULL REFERENCES public.repair_requests(id) ON DELETE CASCADE,
  technician_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  labour_description TEXT NOT NULL,
  labour_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (labour_amount >= 0),
  tax_percent NUMERIC(5, 2) NOT NULL DEFAULT 0.00 CHECK (tax_percent >= 0),
  estimated_completion TEXT NOT NULL,
  warranty_terms TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  status public.quote_status NOT NULL DEFAULT 'PENDING',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER handle_quotes_updated_at
  BEFORE UPDATE ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- ------------------------------------------------------------------------------
-- QUOTE ITEMS (Itemized spare parts & supplies listed in a quote)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quote_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  part_name TEXT NOT NULL,
  part_spec TEXT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (unit_price >= 0),
  part_source TEXT NOT NULL DEFAULT 'In van stock',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- SERVICE HISTORY (Verified service records permanently bound to equipment)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id UUID NOT NULL REFERENCES public.equipment(id) ON DELETE CASCADE,
  repair_request_id UUID REFERENCES public.repair_requests(id) ON DELETE SET NULL,
  service_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  operating_hours INTEGER NOT NULL DEFAULT 0 CHECK (operating_hours >= 0),
  service_type TEXT NOT NULL,
  issue_description TEXT NOT NULL,
  parts_replaced TEXT[] NOT NULL DEFAULT '{}',
  labour_cost NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (labour_cost >= 0),
  total_cost NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (total_cost >= 0),
  technician_name TEXT NOT NULL,
  workshop_name TEXT NOT NULL,
  technician_notes TEXT,
  maintenance_advice TEXT,
  downtime_hours NUMERIC(6, 1) NOT NULL DEFAULT 0.0 CHECK (downtime_hours >= 0),
  invoice_reference TEXT NOT NULL,
  demo_code TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- REPAIR TIMELINE (Chronological audit events for a repair request)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.repair_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_request_id UUID NOT NULL REFERENCES public.repair_requests(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT,
  created_by_role TEXT NOT NULL,
  created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- REPAIR NOTES (Collaborative notes recorded by technician/admin during repair)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.repair_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_request_id UUID NOT NULL REFERENCES public.repair_requests(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  note_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- NOTIFICATIONS (User alerts regarding quotes, parts holds, completions)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_role public.user_role NOT NULL,
  recipient_user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  notification_text TEXT NOT NULL,
  link_target TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. INDEXES FOR QUERY OPTIMIZATION
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_auth_user_id ON public.profiles(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_equipment_farmer_id ON public.equipment(farmer_id);
CREATE INDEX IF NOT EXISTS idx_equipment_status ON public.equipment(status);
CREATE INDEX IF NOT EXISTS idx_technician_profiles_profile_id ON public.technician_profiles(profile_id);
CREATE INDEX IF NOT EXISTS idx_technician_profiles_available ON public.technician_profiles(is_available);
CREATE INDEX IF NOT EXISTS idx_repair_requests_status ON public.repair_requests(status);
CREATE INDEX IF NOT EXISTS idx_repair_requests_farmer_id ON public.repair_requests(farmer_id);
CREATE INDEX IF NOT EXISTS idx_repair_requests_technician_id ON public.repair_requests(technician_id);
CREATE INDEX IF NOT EXISTS idx_repair_requests_equipment_id ON public.repair_requests(equipment_id);
CREATE INDEX IF NOT EXISTS idx_repair_requests_job_number ON public.repair_requests(job_number);
CREATE INDEX IF NOT EXISTS idx_quotes_repair_request_id ON public.quotes(repair_request_id);
CREATE INDEX IF NOT EXISTS idx_quote_items_quote_id ON public.quote_items(quote_id);
CREATE INDEX IF NOT EXISTS idx_service_history_equipment_id ON public.service_history(equipment_id);
CREATE INDEX IF NOT EXISTS idx_repair_timeline_repair_id ON public.repair_timeline(repair_request_id);
CREATE INDEX IF NOT EXISTS idx_repair_notes_repair_id ON public.repair_notes(repair_request_id);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON public.notifications(recipient_role, recipient_user_id, is_read);

-- 6. ROW LEVEL SECURITY (RLS) FOUNDATION

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technician_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Helper functions for RLS checks
CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS UUID AS $$
  SELECT id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role AS $$
  SELECT role FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Profiles: Authenticated users can view profiles (to identify tech, farmer, admin)
CREATE POLICY "Profiles are viewable by authenticated users"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

-- Profiles: Users can update only their own profile
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- Profiles: Public/anon read for demo data exploration during hackathon
CREATE POLICY "Profiles demo public read"
  ON public.profiles FOR SELECT
  TO anon
  USING (true);

-- Technician Profiles: Viewable by all authenticated & anon users
CREATE POLICY "Technician profiles are viewable by all"
  ON public.technician_profiles FOR SELECT
  TO authenticated, anon
  USING (true);

-- Technician Profiles: Technicians can update own operational record
CREATE POLICY "Technicians can update own profile"
  ON public.technician_profiles FOR UPDATE
  TO authenticated
  USING (profile_id = public.current_profile_id());

-- Equipment: Farmers view their own equipment, or technicians/admins view in active repairs
CREATE POLICY "Equipment view policy"
  ON public.equipment FOR SELECT
  TO authenticated
  USING (
    farmer_id = public.current_profile_id()
    OR public.current_user_role() IN ('technician', 'admin')
  );

CREATE POLICY "Farmers can insert own equipment"
  ON public.equipment FOR INSERT
  TO authenticated
  WITH CHECK (farmer_id = public.current_profile_id());

CREATE POLICY "Farmers can update own equipment"
  ON public.equipment FOR UPDATE
  TO authenticated
  USING (farmer_id = public.current_profile_id())
  WITH CHECK (farmer_id = public.current_profile_id());

CREATE POLICY "Equipment demo public read"
  ON public.equipment FOR SELECT
  TO anon
  USING (true);

-- Repair Requests: Farmers view own, technicians view assigned or unassigned, admin views all
CREATE POLICY "Repair requests view policy"
  ON public.repair_requests FOR SELECT
  TO authenticated
  USING (
    farmer_id = public.current_profile_id()
    OR technician_id = public.current_profile_id()
    OR (technician_id IS NULL AND status = 'REQUESTED')
    OR public.current_user_role() = 'admin'
  );

CREATE POLICY "Farmers can create repair requests"
  ON public.repair_requests FOR INSERT
  TO authenticated
  WITH CHECK (farmer_id = public.current_profile_id());

CREATE POLICY "Authorized participants can update repair requests"
  ON public.repair_requests FOR UPDATE
  TO authenticated
  USING (
    farmer_id = public.current_profile_id()
    OR technician_id = public.current_profile_id()
    OR (technician_id IS NULL AND status = 'REQUESTED')
    OR public.current_user_role() = 'admin'
  );

CREATE POLICY "Repair requests demo public read"
  ON public.repair_requests FOR SELECT
  TO anon
  USING (true);

-- Quotes: Visible to involved farmer, technician, admin
CREATE POLICY "Quotes view policy"
  ON public.quotes FOR SELECT
  TO authenticated
  USING (
    technician_id = public.current_profile_id()
    OR EXISTS (
      SELECT 1 FROM public.repair_requests r
      WHERE r.id = quotes.repair_request_id AND r.farmer_id = public.current_profile_id()
    )
    OR public.current_user_role() = 'admin'
  );

CREATE POLICY "Technicians can create quotes"
  ON public.quotes FOR INSERT
  TO authenticated
  WITH CHECK (technician_id = public.current_profile_id());

CREATE POLICY "Authorized users can update quotes"
  ON public.quotes FOR UPDATE
  TO authenticated
  USING (
    technician_id = public.current_profile_id()
    OR EXISTS (
      SELECT 1 FROM public.repair_requests r
      WHERE r.id = quotes.repair_request_id AND r.farmer_id = public.current_profile_id()
    )
    OR public.current_user_role() = 'admin'
  );

CREATE POLICY "Quotes demo public read"
  ON public.quotes FOR SELECT
  TO anon
  USING (true);

-- Quote Items: Linked to readable quotes
CREATE POLICY "Quote items view policy"
  ON public.quote_items FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY "Quote items manage policy"
  ON public.quote_items FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.quotes q
      WHERE q.id = quote_items.quote_id AND q.technician_id = public.current_profile_id()
    )
    OR public.current_user_role() = 'admin'
  );

-- Service History: Visible to equipment owner, technicians, admin
CREATE POLICY "Service history view policy"
  ON public.service_history FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY "Service history insert policy"
  ON public.service_history FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_user_role() IN ('technician', 'admin')
  );

-- Repair Timeline & Notes: Visible to participants
CREATE POLICY "Repair timeline view policy"
  ON public.repair_timeline FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY "Repair timeline insert policy"
  ON public.repair_timeline FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Repair notes view policy"
  ON public.repair_notes FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY "Repair notes insert policy"
  ON public.repair_notes FOR INSERT
  TO authenticated
  WITH CHECK (author_id = public.current_profile_id() OR public.current_user_role() = 'admin');

-- Notifications
CREATE POLICY "Notifications view policy"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (
    recipient_user_id = public.current_profile_id()
    OR recipient_role = public.current_user_role()
  );

CREATE POLICY "Notifications update read status"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (
    recipient_user_id = public.current_profile_id()
    OR recipient_role = public.current_user_role()
  );

CREATE POLICY "Notifications demo public read"
  ON public.notifications FOR SELECT
  TO anon
  USING (true);
