-- ==============================================================================
-- TerraByte — Storage Buckets Visibility & Helper
-- Migration: 20260930000004_storage_policies.sql
-- Description: Ensures storage.buckets has SELECT permissions and policy for public buckets
-- ==============================================================================

-- 1. Ensure buckets exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'equipment-media',
    'equipment-media',
    true,
    5242880, -- 5 MB
    ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
  ),
  (
    'repair-media',
    'repair-media',
    true,
    10485760, -- 10 MB
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4']::text[]
  )
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Grants for storage schema and buckets table
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT SELECT ON storage.buckets TO anon, authenticated, service_role;

-- 3. Policy on storage.buckets so clients can inspect public buckets
DO $$ BEGIN
  CREATE POLICY "Public buckets are viewable by everyone"
    ON storage.buckets FOR SELECT
    USING (public = true);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 4. Helper function to verify buckets from client
CREATE OR REPLACE FUNCTION public.get_storage_buckets()
RETURNS TABLE (id text, name text, public boolean, file_size_limit bigint) AS $$
  SELECT b.id, b.name, b.public, b.file_size_limit FROM storage.buckets b;
$$ LANGUAGE sql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_storage_buckets() TO anon, authenticated, service_role;
