import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { randomUUID } from "crypto"
import fs from "fs"
import path from "path"
import {
  getSettings
} from "@/lib/file-storage"
import { getTomorrowDate } from "@/lib/utils"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

// Required: Set FILE_SERVER_URL and FILE_SERVER_API_KEY in environment
const FILE_SERVER_URL = process.env.FILE_SERVER_URL || ""
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || ""

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

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
  image_folder?: string
  reference_audio?: string
  custom_images?: string[]
  audio_only?: boolean
  use_ai_image?: boolean
  enhance_audio?: boolean
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

// Get user-specific data directory
function getUserDataDir(username?: string): string {
  return path.join(DATA_DIR, "users", username || "default")
}

// Get next sequential video number from counter file (user-specific)
function getNextSequentialVideoNumber(username?: string): number {
  const userDir = getUserDataDir(username)
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true })
  }

  const counterPath = path.join(userDir, "video_counter.json")
  let counter = { next: 1 }

  if (fs.existsSync(counterPath)) {
    try {
      counter = JSON.parse(fs.readFileSync(counterPath, "utf-8"))
    } catch {
      counter = { next: 1 }
    }
  }

  const nextNum = counter.next
  counter.next = nextNum + 1
  fs.writeFileSync(counterPath, JSON.stringify(counter, null, 2))

  return nextNum
}

// Save files to simplified organized folder structure (user-specific)
function saveToSimplifiedOrganized(username: string | undefined, videoNumber: number, transcript: string, script: string): string {
  const organizedDir = path.join(getUserDataDir(username), "organized")
  const folderName = `video_${videoNumber}`
  const folderPath = path.join(organizedDir, folderName)

  // Create folder
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true })
  }

  // Save transcript and script
  fs.writeFileSync(path.join(folderPath, "transcript.txt"), transcript)
  fs.writeFileSync(path.join(folderPath, "script.txt"), script)

  return folderPath
}

export async function POST(request: NextRequest) {
  try {
    const username = await getUser()
    const body = await request.json()
    const {
      script,
      transcript,
      videoTitle,
      videoId,
      audioEnabled = true,
      referenceAudio: customReferenceAudio,
      customImages,
      audioOnly = false,
      aiImageMode = false,
      enhanceAudio = true
    } = body

    if (!script) {
      return NextResponse.json({ error: "Script required" }, { status: 400 })
    }

    // Get settings for reference audio
    const settings = getSettings(username)
    const referenceAudio = customReferenceAudio || settings.defaultReferenceAudio

    if (!referenceAudio) {
      return NextResponse.json({ error: "No reference audio specified. Set default voice in Settings." }, { status: 400 })
    }

    // Get next sequential video number (user-specific)
    const videoNumber = getNextSequentialVideoNumber(username)
    const folderName = `video_${videoNumber}`

    // Save files (user-specific)
    saveToSimplifiedOrganized(username, videoNumber, transcript || "", script)

    // Get audio counter
    const audioCounter = await getNextAudioCounter()

    // If audio is disabled, skip creating job
    if (!audioEnabled) {
      return NextResponse.json({
        success: true,
        jobId: null,
        folderName,
        videoNumber,
        audioCounter,
        organizedPath: `/organized/${folderName}`,
        audioSkipped: true
      })
    }

    // Create audio job
    // Priority: anu = 10 (high), aman = 5 (normal)
    const priority = username === "anu" ? 10 : 5
    const jobId = randomUUID()
    const result = await createAudioJob({
      job_id: jobId,
      script_text: script,
      channel_code: "VIDEO",
      video_number: videoNumber,
      date: getTomorrowDate(),
      audio_counter: audioCounter,
      organized_path: `/organized/${folderName}`,
      priority,
      username,
      reference_audio: referenceAudio,
      custom_images: customImages, // Array of image paths for fade transition
      audio_only: audioOnly,
      use_ai_image: aiImageMode, // ON = AI images, OFF = nature folder
      enhance_audio: enhanceAudio // ON = enhance, OFF = no enhancement
    })

    if (!result.success) {
      return NextResponse.json({ error: "Failed to create audio job" }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      jobId: result.job_id,
      folderName,
      videoNumber,
      audioCounter,
      organizedPath: `/organized/${folderName}`
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
