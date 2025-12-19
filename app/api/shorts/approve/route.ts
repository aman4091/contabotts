import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { randomUUID } from "crypto"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"
const FILE_SERVER_URL = process.env.FILE_SERVER_URL || ""
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || ""

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

function getSettings(username: string) {
  const settingsPath = path.join(DATA_DIR, "users", username, "settings.json")
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, "utf-8"))
    }
  } catch {}
  return { prompts: {} }
}

function markAsProcessed(username: string, videoFolder: string) {
  const trackerPath = path.join(DATA_DIR, "users", username, "shorts-tracker.json")
  let tracker: { processed: string[]; lastRun: string; dailyCount: number } = {
    processed: [],
    lastRun: "",
    dailyCount: 0
  }

  if (fs.existsSync(trackerPath)) {
    try {
      tracker = JSON.parse(fs.readFileSync(trackerPath, "utf-8"))
      if (!Array.isArray(tracker.processed)) tracker.processed = []
    } catch {}
  }

  if (!tracker.processed.includes(videoFolder)) {
    tracker.processed.push(videoFolder)
  }
  tracker.lastRun = new Date().toISOString()

  fs.writeFileSync(trackerPath, JSON.stringify(tracker, null, 2))
}

async function createShortJob(params: {
  jobId: string
  scriptText: string
  sourceVideo: string
  shortNumber: number
  username: string
  referenceAudio?: string
  useAiImage: boolean
}): Promise<boolean> {
  try {
    const response = await fetch(`${FILE_SERVER_URL}/queue/audio/jobs`, {
      method: "POST",
      headers: {
        "x-api-key": FILE_SERVER_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        job_id: params.jobId,
        script_text: params.scriptText,
        channel_code: "SHORTS",
        video_number: 900000 + params.shortNumber, // Offset to avoid clash with regular videos
        date: new Date().toISOString().split("T")[0],
        audio_counter: Date.now() % 1000000,
        organized_path: `/shorts/${params.sourceVideo}`,
        priority: 3,
        username: params.username,
        reference_audio: params.referenceAudio,
        is_short: true,
        source_video: params.sourceVideo,
        short_number: params.shortNumber,
        use_ai_image: params.useAiImage,
        image_folder: "shorts"
      })
    })
    return response.ok
  } catch (error) {
    console.error("Error creating short job:", error)
    return false
  }
}

export async function POST(request: NextRequest) {
  try {
    const username = await getUser()
    if (!username) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const body = await request.json()
    const { videoFolder, shorts } = body

    if (!videoFolder) {
      return NextResponse.json({ error: "videoFolder is required" }, { status: 400 })
    }

    if (!shorts || !Array.isArray(shorts) || shorts.length === 0) {
      return NextResponse.json({ error: "No shorts selected for approval" }, { status: 400 })
    }

    const settings = getSettings(username)
    const referenceAudio = settings.defaultReferenceAudio

    console.log(`Approving ${shorts.length} shorts for ${username}/${videoFolder}...`)

    let queued = 0
    for (const short of shorts) {
      const jobId = randomUUID()
      const success = await createShortJob({
        jobId,
        scriptText: short.content,
        sourceVideo: videoFolder,
        shortNumber: short.number,
        username,
        referenceAudio,
        useAiImage: true // Always use AI image for approved shorts
      })

      if (success) {
        queued++
        console.log(`Queued short #${short.number} with AI image`)
      }

      await new Promise(resolve => setTimeout(resolve, 100))
    }

    // Mark as processed
    markAsProcessed(username, videoFolder)

    return NextResponse.json({
      success: true,
      shortsApproved: shorts.length,
      shortsQueued: queued,
      videoFolder
    })
  } catch (error) {
    console.error("Approve shorts error:", error)
    return NextResponse.json({ error: "Failed to approve shorts" }, { status: 500 })
  }
}
