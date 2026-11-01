-- Phase 10.2: Doorstep Service Intake & Operational Urgency Foundation
-- Adds structured columns to public.repair_requests for doorstep repair logistics,
-- farmer availability, machine stoppage status, and operational urgency classification.

ALTER TABLE public.repair_requests
  ADD COLUMN IF NOT EXISTS service_type text NOT NULL DEFAULT 'DOORSTEP'
    CHECK (service_type IN ('DOORSTEP', 'WORKSHOP')),
  ADD COLUMN IF NOT EXISTS urgency_level text NOT NULL DEFAULT 'STANDARD'
    CHECK (urgency_level IN ('CRITICAL', 'HIGH', 'STANDARD', 'FLEXIBLE')),
  ADD COLUMN IF NOT EXISTS is_machine_stopped boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS preferred_time_slot text NULL
    CHECK (preferred_time_slot IS NULL OR char_length(preferred_time_slot) <= 100),
  ADD COLUMN IF NOT EXISTS field_landmark text NULL
    CHECK (field_landmark IS NULL OR char_length(field_landmark) <= 300);

-- Column documentation
COMMENT ON COLUMN public.repair_requests.service_type IS 'Mode of repair delivery: DOORSTEP (technician visits field/farm) or WORKSHOP (equipment brought to service depot).';
COMMENT ON COLUMN public.repair_requests.urgency_level IS 'Farmer operational urgency: CRITICAL (harvest/work halted), HIGH (urgent within 24h), STANDARD (normal timeline), FLEXIBLE (routine).';
COMMENT ON COLUMN public.repair_requests.is_machine_stopped IS 'Flag indicating whether agricultural equipment is completely immobilized in the field.';
COMMENT ON COLUMN public.repair_requests.preferred_time_slot IS 'Farmer availability window or preferred visit timing (max 100 characters).';
COMMENT ON COLUMN public.repair_requests.field_landmark IS 'Granular rural field access instructions or plot landmarks (max 300 characters).';

-- Indexes for Service Centre & Technician triage query optimization
CREATE INDEX IF NOT EXISTS idx_repair_requests_urgency_triage
  ON public.repair_requests(urgency_level, is_machine_stopped)
  WHERE status = 'REQUESTED';

CREATE INDEX IF NOT EXISTS idx_repair_requests_service_type
  ON public.repair_requests(service_type);
