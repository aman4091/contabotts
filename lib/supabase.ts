// ============================================================================
// SUPABASE REMOVED - Using File Server Queue Instead
// ============================================================================
// This file only exports types for compatibility
// All queue operations now go through FILE_SERVER_URL

// Types for jobs (kept for compatibility)
export interface AudioJob {
  job_id: string
  script_text: string
  channel_code: string
  video_number: number
  date: string
  audio_counter: number
  organized_path: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  priority: number
  retry_count: number
  worker_id?: string
  error_message?: string
  gofile_link?: string
  created_at: string
  processing_started_at?: string
  completed_at?: string
}

export interface VideoJob {
  job_id: string
  audio_job_id: string
  channel_code: string
  video_number: number
  date: string
  organized_path: string
  image_folder: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  priority: number
  retry_count: number
  worker_id?: string
  error_message?: string
  gofile_link?: string
  created_at: string
  processing_started_at?: string
  completed_at?: string
}

// File server configuration - Required: Set in environment
const FILE_SERVER_URL = process.env.FILE_SERVER_URL || ""
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || ""

// Helper functions using file server
export async function getNextAudioCounter(): Promise<number> {
  try {
    const response = await fetch(`${FILE_SERVER_URL}/counter/increment/audio`, {
      method: "POST",
      headers: { "x-api-key": FILE_SERVER_API_KEY }
    })

    if (response.ok) {
      const data = await response.json()
      return data.value
    }

    // Fallback to timestamp-based
    return Date.now() % 1000000
  } catch (error) {
    console.error('Error incrementing counter:', error)
    return Date.now() % 1000000
  }
}

export async function createAudioJob(job: Omit<AudioJob, 'job_id' | 'created_at' | 'status' | 'retry_count'>): Promise<AudioJob | null> {
  try {
    const response = await fetch(`${FILE_SERVER_URL}/queue/audio/jobs`, {
      method: "POST",
      headers: {
        "x-api-key": FILE_SERVER_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...job,
        status: 'pending',
        retry_count: 0
      })
    })

    if (response.ok) {
      const data = await response.json()
      return { ...job, job_id: data.job_id, status: 'pending', retry_count: 0, created_at: new Date().toISOString() } as AudioJob
    }

    return null
  } catch (error) {
    console.error('Error creating audio job:', error)
    return null
  }
}

export async function getAudioJobs(limit = 50, status?: string): Promise<AudioJob[]> {
  try {
    const url = status
      ? `${FILE_SERVER_URL}/queue/audio/jobs?status=${status}`
      : `${FILE_SERVER_URL}/queue/audio/jobs?status=completed`

    const response = await fetch(url, {
      headers: { "x-api-key": FILE_SERVER_API_KEY }
    })

    if (response.ok) {
      const data = await response.json()
      return (data.jobs || []).slice(0, limit)
    }

    return []
  } catch (error) {
    console.error('Error fetching audio jobs:', error)
    return []
  }
}

export async function getQueueStatus(): Promise<{ pending: number; processing: number; completed: number; failed: number }> {
  try {
    const response = await fetch(`${FILE_SERVER_URL}/queue/audio/stats`, {
      headers: { "x-api-key": FILE_SERVER_API_KEY }
    })

    if (response.ok) {
      return await response.json()
    }

    return { pending: 0, processing: 0, completed: 0, failed: 0 }
  } catch (error) {
    console.error('Error getting queue status:', error)
    return { pending: 0, processing: 0, completed: 0, failed: 0 }
  }
}

// Deprecated - kept for backwards compatibility, returns null
export const supabase = null
