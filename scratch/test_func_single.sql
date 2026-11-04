CREATE OR REPLACE FUNCTION public.test_func_single()
RETURNS int
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN 42;
END;
$$;
