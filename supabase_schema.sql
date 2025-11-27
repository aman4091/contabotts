-- ============================================================================
-- TTS Dashboard - Supabase Schema
-- Run this SQL in Supabase SQL Editor
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- AUDIO JOBS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS audio_jobs (
  job_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  script_text TEXT NOT NULL,
  channel_code TEXT NOT NULL,
  video_number INTEGER NOT NULL,
  date DATE NOT NULL,
  audio_counter INTEGER NOT NULL,
  organized_path TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  priority INTEGER DEFAULT 0,
  retry_count INTEGER DEFAULT 0,
  worker_id TEXT,
  error_message TEXT,
  gofile_link TEXT,
  audio_gdrive_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processing_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Indexes for audio_jobs
CREATE INDEX IF NOT EXISTS idx_audio_jobs_status ON audio_jobs(status);
CREATE INDEX IF NOT EXISTS idx_audio_jobs_date ON audio_jobs(date);
CREATE INDEX IF NOT EXISTS idx_audio_jobs_channel ON audio_jobs(channel_code);
CREATE INDEX IF NOT EXISTS idx_audio_jobs_created ON audio_jobs(created_at DESC);

-- ============================================================================
-- VIDEO JOBS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS video_jobs (
  job_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  audio_job_id UUID REFERENCES audio_jobs(job_id),
  channel_code TEXT NOT NULL,
  video_number INTEGER NOT NULL,
  date DATE NOT NULL,
  organized_path TEXT NOT NULL,
  image_folder TEXT DEFAULT 'nature',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  priority INTEGER DEFAULT 0,
  retry_count INTEGER DEFAULT 0,
  worker_id TEXT,
  error_message TEXT,
  gofile_link TEXT,
  video_gdrive_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processing_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Indexes for video_jobs
CREATE INDEX IF NOT EXISTS idx_video_jobs_status ON video_jobs(status);
CREATE INDEX IF NOT EXISTS idx_video_jobs_audio_job ON video_jobs(audio_job_id);
CREATE INDEX IF NOT EXISTS idx_video_jobs_created ON video_jobs(created_at DESC);

-- ============================================================================
-- AUDIO WORKERS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS audio_workers (
  worker_id TEXT PRIMARY KEY,
  hostname TEXT,
  gpu_model TEXT,
  status TEXT DEFAULT 'offline' CHECK (status IN ('offline', 'online', 'busy')),
  vastai_instance_id TEXT,
  jobs_completed INTEGER DEFAULT 0,
  jobs_failed INTEGER DEFAULT 0,
  last_heartbeat TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- VIDEO WORKERS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS video_workers (
  worker_id TEXT PRIMARY KEY,
  hostname TEXT,
  gpu_model TEXT,
  status TEXT DEFAULT 'offline' CHECK (status IN ('offline', 'online', 'busy')),
  jobs_completed INTEGER DEFAULT 0,
  jobs_failed INTEGER DEFAULT 0,
  last_heartbeat TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- GLOBAL COUNTER TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS global_counter (
  id INTEGER PRIMARY KEY DEFAULT 1,
  audio_counter INTEGER DEFAULT 0,
  video_counter INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (id = 1)
);

-- Initialize counter if not exists
INSERT INTO global_counter (id, audio_counter, video_counter)
VALUES (1, 0, 0)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- ATOMIC INCREMENT FUNCTION FOR AUDIO COUNTER
-- ============================================================================

CREATE OR REPLACE FUNCTION increment_audio_counter()
RETURNS INTEGER AS $$
DECLARE
  new_val INTEGER;
BEGIN
  UPDATE global_counter
  SET audio_counter = audio_counter + 1, updated_at = NOW()
  WHERE id = 1
  RETURNING audio_counter INTO new_val;
  RETURN new_val;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- ATOMIC INCREMENT FUNCTION FOR VIDEO COUNTER
-- ============================================================================

CREATE OR REPLACE FUNCTION increment_video_counter()
RETURNS INTEGER AS $$
DECLARE
  new_val INTEGER;
BEGIN
  UPDATE global_counter
  SET video_counter = video_counter + 1, updated_at = NOW()
  WHERE id = 1
  RETURNING video_counter INTO new_val;
  RETURN new_val;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION TO CLAIM AUDIO JOB (ATOMIC)
-- ============================================================================

CREATE OR REPLACE FUNCTION claim_audio_job(p_worker_id TEXT)
RETURNS TABLE(
  job_id UUID,
  script_text TEXT,
  channel_code TEXT,
  video_number INTEGER,
  date DATE,
  audio_counter INTEGER,
  organized_path TEXT
) AS $$
BEGIN
  RETURN QUERY
  UPDATE audio_jobs
  SET
    status = 'processing',
    worker_id = p_worker_id,
    processing_started_at = NOW()
  WHERE audio_jobs.job_id = (
    SELECT audio_jobs.job_id
    FROM audio_jobs
    WHERE audio_jobs.status = 'pending'
    ORDER BY audio_jobs.priority DESC, audio_jobs.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING
    audio_jobs.job_id,
    audio_jobs.script_text,
    audio_jobs.channel_code,
    audio_jobs.video_number,
    audio_jobs.date,
    audio_jobs.audio_counter,
    audio_jobs.organized_path;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION TO CLAIM VIDEO JOB (ATOMIC)
-- ============================================================================

CREATE OR REPLACE FUNCTION claim_video_job(p_worker_id TEXT)
RETURNS TABLE(
  job_id UUID,
  audio_job_id UUID,
  channel_code TEXT,
  video_number INTEGER,
  date DATE,
  organized_path TEXT,
  image_folder TEXT
) AS $$
BEGIN
  RETURN QUERY
  UPDATE video_jobs
  SET
    status = 'processing',
    worker_id = p_worker_id,
    processing_started_at = NOW()
  WHERE video_jobs.job_id = (
    SELECT video_jobs.job_id
    FROM video_jobs
    WHERE video_jobs.status = 'pending'
    ORDER BY video_jobs.priority DESC, video_jobs.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING
    video_jobs.job_id,
    video_jobs.audio_job_id,
    video_jobs.channel_code,
    video_jobs.video_number,
    video_jobs.date,
    video_jobs.organized_path,
    video_jobs.image_folder;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- ROW LEVEL SECURITY (Optional - Enable if needed)
-- ============================================================================

-- ALTER TABLE audio_jobs ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE video_jobs ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE audio_workers ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE video_workers ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE global_counter ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- GRANTS (for anon and authenticated users)
-- ============================================================================

GRANT ALL ON audio_jobs TO anon, authenticated;
GRANT ALL ON video_jobs TO anon, authenticated;
GRANT ALL ON audio_workers TO anon, authenticated;
GRANT ALL ON video_workers TO anon, authenticated;
GRANT ALL ON global_counter TO anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_audio_counter() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_video_counter() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_audio_job(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_video_job(TEXT) TO anon, authenticated;

-- ============================================================================
-- DONE!
-- ============================================================================

SELECT 'Schema created successfully!' AS message;
