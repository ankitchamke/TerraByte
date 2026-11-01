-- Phase 10.3: Location-Aware Technician Dispatch & Distance Engine Foundation
-- Adds workshop coordinates, doorstep service capability, and maximum travel radius
-- to public.technician_profiles for proximity-aware dispatch matching.

ALTER TABLE public.technician_profiles
  ADD COLUMN IF NOT EXISTS workshop_latitude double precision NULL
    CHECK (workshop_latitude IS NULL OR (workshop_latitude >= -90.0 AND workshop_latitude <= 90.0)),
  ADD COLUMN IF NOT EXISTS workshop_longitude double precision NULL
    CHECK (workshop_longitude IS NULL OR (workshop_longitude >= -180.0 AND workshop_longitude <= 180.0)),
  ADD COLUMN IF NOT EXISTS is_doorstep_capable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS max_travel_radius_km integer NOT NULL DEFAULT 40
    CHECK (max_travel_radius_km IS NULL OR (max_travel_radius_km > 0 AND max_travel_radius_km <= 500));

-- Column documentation
COMMENT ON COLUMN public.technician_profiles.workshop_latitude IS 'Workshop or primary service depot latitude coordinate.';
COMMENT ON COLUMN public.technician_profiles.workshop_longitude IS 'Workshop or primary service depot longitude coordinate.';
COMMENT ON COLUMN public.technician_profiles.is_doorstep_capable IS 'Flag indicating whether technician provides on-field mobile repair service (van/tools).';
COMMENT ON COLUMN public.technician_profiles.max_travel_radius_km IS 'Maximum operational road travel radius in kilometers for doorstep field dispatch (default 40 km).';

-- Index for verified doorstep-capable technician dispatch lookups
CREATE INDEX IF NOT EXISTS idx_technician_profiles_doorstep_dispatch
  ON public.technician_profiles(is_doorstep_capable, is_available)
  WHERE is_verified = true;

-- Anchor baseline demo technicians with Nagpur district coordinates
UPDATE public.technician_profiles
SET
  workshop_latitude = 21.2682,
  workshop_longitude = 78.5833,
  is_doorstep_capable = true,
  max_travel_radius_km = 45
WHERE workshop_name ILIKE '%Green Earth%' AND workshop_latitude IS NULL;

UPDATE public.technician_profiles
SET
  workshop_latitude = 21.3850,
  workshop_longitude = 78.9167,
  is_doorstep_capable = true,
  max_travel_radius_km = 50
WHERE workshop_name ILIKE '%Shinde%' AND workshop_latitude IS NULL;
