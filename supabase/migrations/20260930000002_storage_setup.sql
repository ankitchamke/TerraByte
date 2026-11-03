-- ==============================================================================
-- TerraByte — Storage Buckets Configuration
-- Migration: 20260930000002_storage_setup.sql
-- Description: Configures buckets for equipment photos and repair/breakdown media
-- ==============================================================================

-- 1. CREATE STORAGE BUCKETS (Idempotent)
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
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. STORAGE POLICIES
-- Allow public viewing of media in these buckets
CREATE POLICY "Public media read access"
  ON storage.objects FOR SELECT
  USING (bucket_id IN ('equipment-media', 'repair-media'));

-- Allow authenticated users to upload media
CREATE POLICY "Authenticated users can upload media"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id IN ('equipment-media', 'repair-media'));

-- Allow anon upload for demo mode if necessary during prototyping
CREATE POLICY "Anon users can upload demo media"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (bucket_id IN ('equipment-media', 'repair-media'));

-- Allow uploaders to update/delete their media
CREATE POLICY "Users can manage own media"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id IN ('equipment-media', 'repair-media') AND owner = auth.uid());

CREATE POLICY "Users can delete own media"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id IN ('equipment-media', 'repair-media') AND owner = auth.uid());
