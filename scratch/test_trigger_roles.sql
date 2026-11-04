CREATE TABLE IF NOT EXISTS public._test_trg (id int, val text);
TRUNCATE public._test_trg;
INSERT INTO public._test_trg VALUES (1, 'initial');
GRANT ALL ON public._test_trg TO authenticated;

-- Non-SECURITY DEFINER trigger
CREATE OR REPLACE FUNCTION public._trg_test_func()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE NOTICE 'Trigger: CURRENT_USER=%, SESSION_USER=%', CURRENT_USER, SESSION_USER;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_test ON public._test_trg;
CREATE TRIGGER trg_test BEFORE UPDATE ON public._test_trg
FOR EACH ROW EXECUTE FUNCTION public._trg_test_func();

-- SECURITY DEFINER function owned by postgres
CREATE OR REPLACE FUNCTION public._test_secdef_update()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RAISE NOTICE 'SecDef RPC: CURRENT_USER=%, SESSION_USER=%', CURRENT_USER, SESSION_USER;
  UPDATE public._test_trg SET val = 'from_secdef';
END;
$$;
GRANT EXECUTE ON FUNCTION public._test_secdef_update() TO authenticated;

-- Test 1: Direct update as authenticated
SET ROLE authenticated;
UPDATE public._test_trg SET val = 'direct_update';

-- Test 2: Update via SECURITY DEFINER function as authenticated
SELECT public._test_secdef_update();

RESET ROLE;
DROP TABLE public._test_trg CASCADE;
DROP FUNCTION public._test_secdef_update();
DROP FUNCTION public._trg_test_func();
