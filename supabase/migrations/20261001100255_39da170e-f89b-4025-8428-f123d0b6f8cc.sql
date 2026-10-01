
CREATE TYPE public.app_role AS ENUM ('farmer','technician','service_centre');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  phone text,
  village text,
  role public.app_role NOT NULL DEFAULT 'farmer',
  is_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.technician_profiles (
  id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  workshop text NOT NULL DEFAULT '',
  brands text[] NOT NULL DEFAULT '{}',
  skills text[] NOT NULL DEFAULT '{}',
  service_area text,
  available boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.technician_profiles TO authenticated;
GRANT ALL ON public.technician_profiles TO service_role;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND role = _role);
$$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technician_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "profiles_select_service_centre" ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'service_centre'));
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_update_service_centre" ON public.profiles FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'service_centre')) WITH CHECK (public.has_role(auth.uid(), 'service_centre'));

CREATE POLICY "tech_select_own" ON public.technician_profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "tech_select_service_centre" ON public.technician_profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'service_centre'));
CREATE POLICY "tech_update_own" ON public.technician_profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "tech_update_service_centre" ON public.technician_profiles FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'service_centre')) WITH CHECK (public.has_role(auth.uid(), 'service_centre'));

CREATE OR REPLACE FUNCTION public.guard_profile_privileges()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.is_verified IS DISTINCT FROM OLD.is_verified)
     AND NOT public.has_role(auth.uid(), 'service_centre') THEN
    RAISE EXCEPTION 'Only the service centre can change role or verification status';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_guard_privileges BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileges();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  requested text := COALESCE(NEW.raw_user_meta_data->>'role', 'farmer');
  assigned public.app_role;
BEGIN
  assigned := CASE WHEN requested = 'technician' THEN 'technician'::public.app_role ELSE 'farmer'::public.app_role END;

  INSERT INTO public.profiles (id, full_name, phone, village, role, is_verified)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.raw_user_meta_data->>'phone',
    NEW.raw_user_meta_data->>'village',
    assigned,
    assigned = 'farmer'::public.app_role
  )
  ON CONFLICT (id) DO NOTHING;

  IF assigned = 'technician'::public.app_role THEN
    INSERT INTO public.technician_profiles (id, workshop, service_area)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'workshop', ''), NEW.raw_user_meta_data->>'village')
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
