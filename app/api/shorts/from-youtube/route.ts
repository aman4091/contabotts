import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ""
const DOWNSUB_API_KEY = process.env.DOWNSUB_API_KEY || ""

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

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&?\s]+)/,
    /^([a-zA-Z0-9_-]{11})$/
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  return null
}

async function fetchTranscript(videoId: string): Promise<string | null> {
  try {
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`

    console.log(`[DownSub] Fetching transcript for: ${videoId}`)

    // Step 1: Get subtitle URLs from DownSub
    const res = await fetch("https://api.downsub.com/download", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${DOWNSUB_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ url: youtubeUrl }),
      cache: 'no-store'
    })

    if (!res.ok) {
      console.error(`[DownSub] Error for ${videoId}: ${res.status}`)
      return null
    }

    const data = await res.json()

    if (data.status !== "success" || !data.data?.subtitles) {
      console.error(`[DownSub] No subtitles found for ${videoId}`)
      return null
    }

    // Step 2: Find English or Hindi subtitle (prefer English)
    const subtitles = data.data.subtitles
    let targetSubtitle = subtitles.find((s: any) => s.language?.toLowerCase().includes("english"))
    if (!targetSubtitle) {
      targetSubtitle = subtitles.find((s: any) => s.language?.toLowerCase().includes("hindi"))
    }
    if (!targetSubtitle && subtitles.length > 0) {
      targetSubtitle = subtitles[0]
    }

    if (!targetSubtitle) return null

    // Step 3: Get txt format URL
    const txtFormat = targetSubtitle.formats?.find((f: any) => f.format === "txt")
    if (!txtFormat?.url) return null

    // Step 4: Fetch the actual transcript text
    const txtRes = await fetch(txtFormat.url)
    if (!txtRes.ok) return null

    const transcript = await txtRes.text()
    return transcript.trim()

  } catch (error) {
    console.error(`[DownSub] Transcript error for ${videoId}:`, error)
    return null
  }
}

async function generateShortsFromTranscript(transcript: string, shortsPrompt: string): Promise<{ number: number; content: string }[]> {
  const fullPrompt = `${shortsPrompt}

IMPORTANT: Output exactly 10 short scripts, numbered 1 to 10. Each short should be under 60 seconds when spoken.
Format each short like this:
---SHORT 1---
[script content]
---SHORT 2---
[script content]
... and so on until SHORT 10.

Here is the transcript to convert:

${transcript}`

  // Use Gemini 3 Pro for shorts
  const model = "gemini-3-pro-preview"
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`

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

function parseShorts(responseText: string): { number: number; content: string }[] {
  const shorts: { number: number; content: string }[] = []

  const shortPattern = /---SHORT\s*(\d+)---\s*([\s\S]*?)(?=---SHORT\s*\d+---|$)/gi
  let match

  while ((match = shortPattern.exec(responseText)) !== null) {
    const number = parseInt(match[1])
    const content = match[2].trim()
    if (number >= 1 && number <= 10 && content.length > 50) {
      shorts.push({ number, content })
    }
  }

  if (shorts.length < 10) {
    const numberedPattern = /(?:^|\n)\s*(?:\*\*)?(\d+)[\.\\)]\s*(?:\*\*)?\s*([\s\S]*?)(?=(?:^|\n)\s*(?:\*\*)?\d+[\.\\)]|$)/gm
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

export async function POST(request: NextRequest) {
  try {
    const username = await getUser()
    if (!username) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const body = await request.json()
    const { youtubeUrl } = body

    if (!youtubeUrl) {
      return NextResponse.json({ error: "YouTube URL is required" }, { status: 400 })
    }

    const videoId = extractVideoId(youtubeUrl)
    if (!videoId) {
      return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 })
    }

    const settings = getSettings(username)
    const shortsPrompt = settings.prompts?.shorts

    if (!shortsPrompt) {
      return NextResponse.json({ error: "Shorts prompt not configured in Settings" }, { status: 400 })
    }

    if (!DOWNSUB_API_KEY) {
      return NextResponse.json({ error: "DownSub API key not configured" }, { status: 500 })
    }

    console.log(`Fetching transcript for ${videoId}...`)
    const transcript = await fetchTranscript(videoId)

    if (!transcript) {
      return NextResponse.json({ error: "Could not fetch transcript for this video" }, { status: 400 })
    }

    console.log(`Generating shorts from transcript (${transcript.length} chars)...`)
    const shorts = await generateShortsFromTranscript(transcript, shortsPrompt)

    if (shorts.length === 0) {
      return NextResponse.json({ error: "Failed to generate shorts from Gemini" }, { status: 500 })
    }

    console.log(`Generated ${shorts.length} shorts from YouTube video`)

    return NextResponse.json({
      success: true,
      shorts,
      videoId,
      totalGenerated: shorts.length
    })
  } catch (error) {
    console.error("From YouTube error:", error)
    return NextResponse.json({ error: "Failed to generate shorts from YouTube" }, { status: 500 })
  }
}
