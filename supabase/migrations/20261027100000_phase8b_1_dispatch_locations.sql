-- Phase 8B.1: Secure Repair Dispatch Locations
-- Creates a protected child table for optional exact GPS coordinates.
-- Access is strictly restricted via RLS to:
-- 1. The farmer who owns the repair request
-- 2. The technician actively assigned to the repair request
-- 3. Platform administrators
-- Unassigned technicians in the open queue and third parties are strictly denied.

CREATE TABLE IF NOT EXISTS public.repair_dispatch_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_request_id uuid NOT NULL UNIQUE REFERENCES public.repair_requests(id) ON DELETE CASCADE,
  latitude double precision NOT NULL CHECK (latitude >= -90.0 AND latitude <= 90.0),
  longitude double precision NOT NULL CHECK (longitude >= -180.0 AND longitude <= 180.0),
  accuracy double precision CHECK (accuracy IS NULL OR accuracy >= 0),
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_repair_dispatch_locations_ticket
  ON public.repair_dispatch_locations (repair_request_id);

-- Enable RLS
ALTER TABLE public.repair_dispatch_locations ENABLE ROW LEVEL SECURITY;

-- Operational table permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.repair_dispatch_locations TO authenticated;
GRANT ALL ON public.repair_dispatch_locations TO service_role;

-- 1. SELECT Policy
DROP POLICY IF EXISTS "Authorized viewers can view repair dispatch location" ON public.repair_dispatch_locations;
CREATE POLICY "Authorized viewers can view repair dispatch location"
ON public.repair_dispatch_locations
FOR SELECT
TO authenticated
USING (
  public.current_user_role() = 'admin'::public.user_role
  OR EXISTS (
    SELECT 1 FROM public.repair_requests r
    WHERE r.id = repair_dispatch_locations.repair_request_id
      AND (
        r.farmer_id = public.current_profile_id()
        OR (
          r.technician_id = public.current_profile_id()
          AND r.status NOT IN ('CANCELLED'::public.repair_status)
        )
      )
  )
);

-- 2. INSERT Policy: Only ticket farmer or admin
DROP POLICY IF EXISTS "Farmers can insert repair dispatch location for own repair" ON public.repair_dispatch_locations;
CREATE POLICY "Farmers can insert repair dispatch location for own repair"
ON public.repair_dispatch_locations
FOR INSERT
TO authenticated
WITH CHECK (
  public.current_user_role() = 'admin'::public.user_role
  OR EXISTS (
    SELECT 1 FROM public.repair_requests r
    WHERE r.id = repair_dispatch_locations.repair_request_id
      AND r.farmer_id = public.current_profile_id()
  )
);

-- 3. UPDATE Policy: Only ticket farmer or admin
DROP POLICY IF EXISTS "Farmers and admins can update own repair dispatch location" ON public.repair_dispatch_locations;
CREATE POLICY "Farmers and admins can update own repair dispatch location"
ON public.repair_dispatch_locations
FOR UPDATE
TO authenticated
USING (
  public.current_user_role() = 'admin'::public.user_role
  OR EXISTS (
    SELECT 1 FROM public.repair_requests r
    WHERE r.id = repair_dispatch_locations.repair_request_id
      AND r.farmer_id = public.current_profile_id()
  )
)
WITH CHECK (
  public.current_user_role() = 'admin'::public.user_role
  OR EXISTS (
    SELECT 1 FROM public.repair_requests r
    WHERE r.id = repair_dispatch_locations.repair_request_id
      AND r.farmer_id = public.current_profile_id()
  )
);

-- 4. DELETE Policy: Admin or ticket farmer
DROP POLICY IF EXISTS "Admins and ticket farmers can delete repair dispatch location" ON public.repair_dispatch_locations;
CREATE POLICY "Admins and ticket farmers can delete repair dispatch location"
ON public.repair_dispatch_locations
FOR DELETE
TO authenticated
USING (
  public.current_user_role() = 'admin'::public.user_role
  OR EXISTS (
    SELECT 1 FROM public.repair_requests r
    WHERE r.id = repair_dispatch_locations.repair_request_id
      AND r.farmer_id = public.current_profile_id()
  )
);
