import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { randomUUID } from "crypto"
import {
  saveToOrganized,
  getNextVideoNumber,
  completeTranscript,
  getTranscript
} from "@/lib/file-storage"
import { getTomorrowDate, addDays } from "@/lib/utils"

// Required: Set FILE_SERVER_URL and FILE_SERVER_API_KEY in environment
const FILE_SERVER_URL = process.env.FILE_SERVER_URL || ""
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || ""

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

const MAX_VIDEOS_PER_DAY = 4

async function getNextAudioCounter(): Promise<number> {
  try {
    const response = await fetch(`${FILE_SERVER_URL}/counter/increment/audio`, {
      method: "POST",
      headers: { "x-api-key": FILE_SERVER_API_KEY }
    })

    if (response.ok) {
      const data = await response.json()
      return data.value
    }

    // Fallback
    return Date.now() % 1000000
  } catch (error) {
    console.error("Counter error:", error)
    return Date.now() % 1000000
  }
}

async function createAudioJob(job: {
  job_id: string
  script_text: string
  channel_code: string
  video_number: number
  date: string
  audio_counter: number
  organized_path: string
  priority: number
  username?: string
}): Promise<{ success: boolean; job_id?: string; error?: string }> {
  try {
    const response = await fetch(`${FILE_SERVER_URL}/queue/audio/jobs`, {
      method: "POST",
      headers: {
        "x-api-key": FILE_SERVER_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(job)
    })

    if (response.ok) {
      const data = await response.json()
      return { success: true, job_id: data.job_id }
    }

    return { success: false, error: "Failed to create job" }
  } catch (error) {
    console.error("Create job error:", error)
    return { success: false, error: String(error) }
  }
}

async function getQueueStats(): Promise<{ pending: number; processing: number; completed: number; failed: number }> {
  try {
    const response = await fetch(`${FILE_SERVER_URL}/queue/audio/stats`, {
      headers: { "x-api-key": FILE_SERVER_API_KEY }
    })

    if (response.ok) {
      return await response.json()
    }

    return { pending: 0, processing: 0, completed: 0, failed: 0 }
  } catch (error) {
    console.error("Queue stats error:", error)
    return { pending: 0, processing: 0, completed: 0, failed: 0 }
  }
}

export async function POST(request: NextRequest) {
  try {
    const username = await getUser()
    const body = await request.json()
    const {
      script,
      transcript,
      targetChannel,
      sourceChannel,
      transcriptIndex,
      date: customDate,
      slot: customSlot,
      priority: customPriority
    } = body

    if (!script || !targetChannel) {
      return NextResponse.json({ error: "Script and target channel required" }, { status: 400 })
    }

    // Priority mode: use exact date and slot (for replacing deleted slots)
    let date: string
    let videoNumber: number

    if (customDate && customSlot) {
      // Use exact date and slot specified (priority replacement)
      date = customDate
      videoNumber = parseInt(customSlot)
    } else {
      // Find next available slot (max 4 videos per day per channel)
      date = customDate || getTomorrowDate()
      videoNumber = getNextVideoNumber(date, targetChannel)
      let daysChecked = 0
      const maxDaysAhead = 30

      while (videoNumber > MAX_VIDEOS_PER_DAY && daysChecked < maxDaysAhead) {
        daysChecked++
        date = addDays(getTomorrowDate(), daysChecked)
        videoNumber = getNextVideoNumber(date, targetChannel)
      }

      if (videoNumber > MAX_VIDEOS_PER_DAY) {
        return NextResponse.json({ error: `No available slots for ${targetChannel} in next ${maxDaysAhead} days` }, { status: 400 })
      }
    }

    // Get audio counter from file server
    const audioCounter = await getNextAudioCounter()

    // Create organized folder and save files
    const organizedPath = `/organized/${date}/${targetChannel}/video_${videoNumber}`

    // Get full transcript content if not provided
    let fullTranscript = transcript
    if (!fullTranscript && sourceChannel && transcriptIndex) {
      fullTranscript = getTranscript(sourceChannel, transcriptIndex, username) || ""
    }

    // Save to organized folder
    saveToOrganized(date, targetChannel, videoNumber, fullTranscript, script)

    // Priority: 10 for replacement jobs, 1 for normal jobs
    const jobPriority = customPriority ? parseInt(customPriority) : (customSlot ? 10 : 1)

    // Create job via File Server (not Supabase!)
    const jobId = randomUUID()
    const result = await createAudioJob({
      job_id: jobId,
      script_text: script,
      channel_code: targetChannel,
      video_number: videoNumber,
      date: date,
      audio_counter: audioCounter,
      organized_path: organizedPath,
      priority: jobPriority,
      username: username
    })

    if (!result.success) {
      console.error("Job creation error:", result.error)
      return NextResponse.json({ error: "Failed to create job" }, { status: 500 })
    }

    // Move transcript to completed folder
    if (sourceChannel && transcriptIndex) {
      completeTranscript(sourceChannel, transcriptIndex, username)
    }

    return NextResponse.json({
      success: true,
      jobId: result.job_id,
      channelCode: targetChannel,
      videoNumber: videoNumber,
      date: date,
      audioCounter: audioCounter,
      organizedPath: organizedPath
    })
  } catch (error) {
    console.error("Error adding to queue:", error)
    return NextResponse.json({ error: "Failed to add to queue" }, { status: 500 })
  }
}

export async function GET() {
  try {
    // Get queue status from file server
    const stats = await getQueueStats()

    return NextResponse.json({
      pending: stats.pending,
      processing: stats.processing,
      completed: stats.completed,
      failed: stats.failed
    })
  } catch (error) {
    console.error("Error getting queue status:", error)
    return NextResponse.json({ error: "Failed to get queue status" }, { status: 500 })
  }
}
