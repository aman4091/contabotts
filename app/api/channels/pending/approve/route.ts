import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { randomUUID } from "crypto"
import fs from "fs"
import path from "path"
import { getTomorrowDate } from "@/lib/utils"

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
  return {}
}

function getPendingPath(username: string): string {
  return path.join(DATA_DIR, "users", username, "channel-automation", "pending-scripts.json")
}

function getPendingScripts(username: string): any[] {
  const filePath = getPendingPath(username)
  if (!fs.existsSync(filePath)) return []
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"))
  } catch {
    return []
  }
}

function savePendingScripts(username: string, scripts: any[]) {
  const filePath = getPendingPath(username)
  fs.writeFileSync(filePath, JSON.stringify(scripts, null, 2))
}

function getNextVideoNumber(username: string): number {
  const userDir = path.join(DATA_DIR, "users", username)
  const counterPath = path.join(userDir, "video_counter.json")

  let counter = { next: 1 }
  if (fs.existsSync(counterPath)) {
    try {
      counter = JSON.parse(fs.readFileSync(counterPath, "utf-8"))
    } catch {}
  }

  const nextNum = counter.next
  counter.next = nextNum + 1
  fs.writeFileSync(counterPath, JSON.stringify(counter, null, 2))

  return nextNum
}

function saveToOrganized(username: string, videoNumber: number, transcript: string, script: string, title: string) {
  const folderPath = path.join(DATA_DIR, "users", username, "organized", `video_${videoNumber}`)

  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true })
  }

  fs.writeFileSync(path.join(folderPath, "transcript.txt"), transcript)
  fs.writeFileSync(path.join(folderPath, "script.txt"), script)
  fs.writeFileSync(path.join(folderPath, "title.txt"), title)
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
    return Date.now() % 1000000
  } catch {
    return Date.now() % 1000000
  }
}

async function createAudioJob(job: any): Promise<{ success: boolean }> {
  try {
    const response = await fetch(`${FILE_SERVER_URL}/queue/audio/jobs`, {
      method: "POST",
      headers: {
        "x-api-key": FILE_SERVER_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(job)
    })

    return { success: response.ok }
  } catch {
    return { success: false }
  }
}

// POST - Approve a pending script and queue it
export async function POST(request: NextRequest) {
  try {
    const username = await getUser()
    if (!username) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const body = await request.json()
    const { id, script: updatedScript } = body

    if (!id) {
      return NextResponse.json({ error: "Script ID required" }, { status: 400 })
    }

    const scripts = getPendingScripts(username)
    const scriptIndex = scripts.findIndex(s => s.id === id)

    if (scriptIndex === -1) {
      return NextResponse.json({ error: "Script not found" }, { status: 404 })
    }

    const pendingScript = scripts[scriptIndex]
    const finalScript = updatedScript || pendingScript.script

    // Get settings
    const settings = getSettings(username)
    const referenceAudio = settings.defaultReferenceAudio
    const useAiImage = settings.video?.useAiImage || false

    if (!referenceAudio) {
      return NextResponse.json({ error: "Default reference audio not set in Settings" }, { status: 400 })
    }

    // 1. Get next video number and save
    const videoNumber = getNextVideoNumber(username)
    const folderName = `video_${videoNumber}`
    saveToOrganized(username, videoNumber, pendingScript.transcript, finalScript, pendingScript.title)

    // 2. Queue for audio/video generation
    const audioCounter = await getNextAudioCounter()
    const jobId = randomUUID()
    const priority = username === "anu" ? 10 : 5

    const jobResult = await createAudioJob({
      job_id: jobId,
      script_text: finalScript,
      channel_code: pendingScript.source === "live_monitoring" ? "LIVE" : "AUTO",
      video_number: videoNumber,
      date: getTomorrowDate(),
      audio_counter: audioCounter,
      organized_path: `/organized/${folderName}`,
      priority,
      username,
      reference_audio: referenceAudio,
      source_channel: pendingScript.channelId,
      source_video_id: pendingScript.videoId,
      use_ai_image: useAiImage
    })

    if (!jobResult.success) {
      return NextResponse.json({ error: "Failed to queue job" }, { status: 500 })
    }

    // 3. Mark as processed in channel's processed list
    if (pendingScript.channelId) {
      const processedPath = path.join(DATA_DIR, "users", username, "channel-automation", pendingScript.channelId, "processed.json")
      let processedIds: string[] = []
      if (fs.existsSync(processedPath)) {
        try {
          const processedData = JSON.parse(fs.readFileSync(processedPath, "utf-8"))
          processedIds = processedData.processed || []
        } catch {}
      }

      if (!processedIds.includes(pendingScript.videoId)) {
        processedIds.push(pendingScript.videoId)
        const processedDir = path.dirname(processedPath)
        if (!fs.existsSync(processedDir)) {
          fs.mkdirSync(processedDir, { recursive: true })
        }
        fs.writeFileSync(processedPath, JSON.stringify({ processed: processedIds }, null, 2))
      }

      // Save completed info
      const completedDir = path.join(DATA_DIR, "users", username, "channel-automation", pendingScript.channelId, "completed")
      if (!fs.existsSync(completedDir)) {
        fs.mkdirSync(completedDir, { recursive: true })
      }
      fs.writeFileSync(
        path.join(completedDir, `${pendingScript.videoId}.json`),
        JSON.stringify({
          videoId: pendingScript.videoId,
          title: pendingScript.title,
          videoNumber,
          folderName,
          jobId,
          processedAt: new Date().toISOString(),
          source: pendingScript.source
        }, null, 2)
      )
    }

    // 4. Remove from pending
    scripts.splice(scriptIndex, 1)
    savePendingScripts(username, scripts)

    return NextResponse.json({
      success: true,
      videoNumber,
      folderName,
      jobId,
      message: `Script approved and queued as ${folderName}`
    })
  } catch (error) {
    console.error("Error approving script:", error)
    return NextResponse.json({ error: "Failed to approve script" }, { status: 500 })
  }
}
