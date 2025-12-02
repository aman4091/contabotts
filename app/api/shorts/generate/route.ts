import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { randomUUID } from "crypto"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"
const FILE_SERVER_URL = process.env.FILE_SERVER_URL || ""
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || ""
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ""

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

// Get user settings
function getSettings(username: string) {
  const settingsPath = path.join(DATA_DIR, "users", username, "settings.json")
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, "utf-8"))
    }
  } catch {}
  return { prompts: {} }
}

// Get script content
function getScriptContent(username: string, videoFolder: string): string | null {
  const scriptPath = path.join(DATA_DIR, "users", username, "organized", videoFolder, "script.txt")
  if (!fs.existsSync(scriptPath)) return null
  return fs.readFileSync(scriptPath, "utf-8")
}

// Mark script as processed
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

// Call Gemini to generate shorts
async function generateShortsFromScript(script: string, shortsPrompt: string): Promise<{ number: number; content: string }[]> {
  const fullPrompt = `${shortsPrompt}

IMPORTANT: Output exactly 10 short scripts, numbered 1 to 10. Each short should be under 60 seconds when spoken.
Format each short like this:
---SHORT 1---
[script content]
---SHORT 2---
[script content]
... and so on until SHORT 10.

Here is the full script to convert:

${script}`

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro-preview-06-05:generateContent?key=${GEMINI_API_KEY}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 300000)

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 65536 }
      }),
      signal: controller.signal
    })

    clearTimeout(timeout)

    if (!res.ok) {
      console.error("Gemini API error:", res.status)
      return []
    }

    const data = await res.json()

    if (data.candidates?.[0]?.finishReason === "SAFETY") {
      console.error("Content blocked by safety filters")
      return []
    }

    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || ""
    return parseShorts(responseText)
  } catch (error) {
    clearTimeout(timeout)
    console.error("Gemini error:", error)
    return []
  }
}

// Parse shorts from Gemini response
function parseShorts(responseText: string): { number: number; content: string }[] {
  const shorts: { number: number; content: string }[] = []

  // Try ---SHORT N--- format
  const shortPattern = /---SHORT\s*(\d+)---\s*([\s\S]*?)(?=---SHORT\s*\d+---|$)/gi
  let match

  while ((match = shortPattern.exec(responseText)) !== null) {
    const number = parseInt(match[1])
    const content = match[2].trim()
    if (number >= 1 && number <= 10 && content.length > 50) {
      shorts.push({ number, content })
    }
  }

  // Fallback to numbered format
  if (shorts.length < 10) {
    const numberedPattern = /(?:^|\n)\s*(?:\*\*)?(\d+)[\.\)]\s*(?:\*\*)?\s*([\s\S]*?)(?=(?:^|\n)\s*(?:\*\*)?\d+[\.\)]|$)/gm
    while ((match = numberedPattern.exec(responseText)) !== null) {
      const number = parseInt(match[1])
      const content = match[2].trim()
      if (number >= 1 && number <= 10 && content.length > 50 && !shorts.find(s => s.number === number)) {
        shorts.push({ number, content })
      }
    }
  }

  return shorts.sort((a, b) => a.number - b.number).slice(0, 10)
}

// Create audio job for a short
async function createShortJob(params: {
  jobId: string
  scriptText: string
  sourceVideo: string
  shortNumber: number
  username: string
  referenceAudio?: string
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
        video_number: params.shortNumber,
        date: new Date().toISOString().split("T")[0],
        audio_counter: Date.now() % 1000000,
        organized_path: `/shorts/${params.sourceVideo}`,
        priority: 3,
        username: params.username,
        reference_audio: params.referenceAudio,
        is_short: true,
        source_video: params.sourceVideo,
        short_number: params.shortNumber,
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
    const { videoFolder } = body

    if (!videoFolder) {
      return NextResponse.json({ error: "videoFolder is required" }, { status: 400 })
    }

    // Get settings
    const settings = getSettings(username)
    const shortsPrompt = settings.prompts?.shorts

    if (!shortsPrompt) {
      return NextResponse.json({ error: "Shorts prompt not configured in Settings" }, { status: 400 })
    }

    // Get script content
    const scriptContent = getScriptContent(username, videoFolder)
    if (!scriptContent) {
      return NextResponse.json({ error: `Script not found for ${videoFolder}` }, { status: 404 })
    }

    console.log(`Generating shorts for ${username}/${videoFolder}...`)

    // Generate shorts using Gemini
    const shorts = await generateShortsFromScript(scriptContent, shortsPrompt)

    if (shorts.length === 0) {
      return NextResponse.json({ error: "Failed to generate shorts from Gemini" }, { status: 500 })
    }

    console.log(`Generated ${shorts.length} shorts`)

    // Get reference audio
    const referenceAudio = settings.defaultReferenceAudio

    // Queue each short
    let queued = 0
    for (const short of shorts) {
      const jobId = randomUUID()
      const success = await createShortJob({
        jobId,
        scriptText: short.content,
        sourceVideo: videoFolder,
        shortNumber: short.number,
        username,
        referenceAudio
      })

      if (success) {
        queued++
        console.log(`Queued short #${short.number}`)
      }

      // Small delay
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    // Mark as processed
    markAsProcessed(username, videoFolder)

    return NextResponse.json({
      success: true,
      shortsGenerated: shorts.length,
      shortsQueued: queued,
      videoFolder
    })
  } catch (error) {
    console.error("Generate shorts error:", error)
    return NextResponse.json({ error: "Failed to generate shorts" }, { status: 500 })
  }
}
