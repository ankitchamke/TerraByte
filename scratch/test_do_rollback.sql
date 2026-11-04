DO $$
BEGIN
  CREATE TABLE public.test_table_rollback (id int);
  INSERT INTO public.test_table_rollback VALUES (100);
  RAISE EXCEPTION 'Simulated error inside DO block!';
END $$;
