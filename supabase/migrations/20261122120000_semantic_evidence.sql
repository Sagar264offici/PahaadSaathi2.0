-- ============================================================
-- PAHAADSAATHI — SEMANTIC EVIDENCE & PGVECTOR DATABASE SCHEMA
-- Migration: 20261122120000_semantic_evidence.sql
-- ============================================================

-- Enable pgvector extension for image embeddings if supported
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Hazard Media Assets Table
CREATE TABLE IF NOT EXISTS public.hazard_media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hazard_id UUID REFERENCES public.hazards(id) ON DELETE CASCADE,
  image_id TEXT NOT NULL,
  original_storage_path TEXT,
  evidence_storage_path TEXT,
  preview_storage_path TEXT,
  original_sha256 TEXT,
  evidence_sha256 TEXT,
  perceptual_hash TEXT,
  placeholder_hash TEXT,
  compression_ratio NUMERIC(5, 2),
  upload_status TEXT NOT NULL DEFAULT 'uploaded' CHECK (
    upload_status IN ('local_only', 'pending', 'uploading', 'uploaded', 'deferred', 'failed')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_media_assets_hazard_id
  ON public.hazard_media_assets(hazard_id);

CREATE INDEX IF NOT EXISTS idx_media_assets_phash
  ON public.hazard_media_assets(perceptual_hash);

CREATE INDEX IF NOT EXISTS idx_media_assets_sha256
  ON public.hazard_media_assets(evidence_sha256);

-- 2. Hazard Image Structured Analysis Table
CREATE TABLE IF NOT EXISTS public.hazard_image_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hazard_id UUID REFERENCES public.hazards(id) ON DELETE CASCADE,
  image_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'nvidia',
  model TEXT NOT NULL DEFAULT 'google/paligemma',
  structured_analysis JSONB NOT NULL,
  verdict TEXT NOT NULL CHECK (
    verdict IN ('consistent', 'partially_consistent', 'inconsistent', 'insufficient_evidence')
  ),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_image_analysis_hazard_id
  ON public.hazard_image_analysis(hazard_id);

-- 3. Hazard Image Vector Embeddings Table (512-dim Normalized)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector') THEN
    CREATE TABLE IF NOT EXISTS public.hazard_image_embeddings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hazard_id UUID REFERENCES public.hazards(id) ON DELETE CASCADE,
      image_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INT NOT NULL DEFAULT 512,
      embedding vector(512),
      created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
    );
  ELSE
    CREATE TABLE IF NOT EXISTS public.hazard_image_embeddings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hazard_id UUID REFERENCES public.hazards(id) ON DELETE CASCADE,
      image_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INT NOT NULL DEFAULT 512,
      embedding JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
    );
  END IF;
END $$;

-- Enable RLS
ALTER TABLE public.hazard_media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hazard_image_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hazard_image_embeddings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view media assets" ON public.hazard_media_assets;
CREATE POLICY "Public can view media assets" ON public.hazard_media_assets FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role manages media assets" ON public.hazard_media_assets;
CREATE POLICY "Service role manages media assets" ON public.hazard_media_assets FOR ALL USING (true);

DROP POLICY IF EXISTS "Public can view image analysis" ON public.hazard_image_analysis;
CREATE POLICY "Public can view image analysis" ON public.hazard_image_analysis FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role manages image analysis" ON public.hazard_image_analysis;
CREATE POLICY "Service role manages image analysis" ON public.hazard_image_analysis FOR ALL USING (true);

DROP POLICY IF EXISTS "Public can view embeddings" ON public.hazard_image_embeddings;
CREATE POLICY "Public can view embeddings" ON public.hazard_image_embeddings FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role manages embeddings" ON public.hazard_image_embeddings;
CREATE POLICY "Service role manages embeddings" ON public.hazard_image_embeddings FOR ALL USING (true);
