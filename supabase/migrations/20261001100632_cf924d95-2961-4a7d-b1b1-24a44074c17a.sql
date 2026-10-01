
CREATE OR REPLACE FUNCTION public.guard_profile_privileges()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.is_verified IS DISTINCT FROM OLD.is_verified)
     AND auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'service_centre') THEN
    RAISE EXCEPTION 'Only the service centre can change role or verification status';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
