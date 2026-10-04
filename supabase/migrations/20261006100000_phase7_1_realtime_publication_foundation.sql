-- Phase 7.1: Realtime Publication Foundation
-- Description: Idempotently registers domain tables required for Phase 7 multi-user realtime synchronization
-- into the existing `supabase_realtime` publication:
-- 1. public.notifications
-- 2. public.repair_requests
-- 3. public.quotes
-- 4. public.repair_timeline
--
-- Safety Guarantees:
-- - Idempotent DO block: skips any table already present in pg_publication_tables.
-- - No alterations to tables, columns, constraints, triggers, functions, or RLS policies.
-- - Preserves existing publication tables (specifically public.repair_messages).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN

    -- 1. public.notifications
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'notifications'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    END IF;

    -- 2. public.repair_requests
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'repair_requests'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.repair_requests;
    END IF;

    -- 3. public.quotes
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'quotes'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.quotes;
    END IF;

    -- 4. public.repair_timeline
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'repair_timeline'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.repair_timeline;
    END IF;

  END IF;
END $$;
