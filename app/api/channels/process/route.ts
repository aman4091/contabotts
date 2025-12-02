import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { randomUUID } from "crypto"
import fs from "fs"
import path from "path"
import { getSettings } from "@/lib/file-storage"
import { getTomorrowDate } from "@/lib/utils"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"
const FILE_SERVER_URL = process.env.FILE_SERVER_URL || ""
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || ""
const SUPADATA_API_KEY = process.env.SUPADATA_API_KEY
const GEMINI_API_KEY = process.env.GEMINI_API_KEY

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

// POST - Auto Create: Process N videos from a channel (Background)
export async function POST(request: NextRequest) {
  try {
    const username = await getUser()
    if (!username) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    if (!SUPADATA_API_KEY) {
      return NextResponse.json({ error: "Supadata API key not configured" }, { status: 500 })
    }

    if (!GEMINI_API_KEY) {
      return NextResponse.json({ error: "Gemini API key not configured" }, { status: 500 })
    }

    const body = await request.json()
    const { channelId, numVideos = 6, minDuration = 600 } = body

    if (!channelId) {
      return NextResponse.json({ error: "Channel ID required" }, { status: 400 })
    }

    // Get settings for channel prompt
    const settings = getSettings(username)
    const channelPrompt = settings.prompts?.channel

    if (!channelPrompt) {
      return NextResponse.json({ error: "Channel prompt not configured in Settings" }, { status: 400 })
    }

    const referenceAudio = settings.defaultReferenceAudio
    if (!referenceAudio) {
      return NextResponse.json({ error: "Default reference audio not set in Settings" }, { status: 400 })
    }

    // Load videos
    const videosPath = path.join(DATA_DIR, "users", username, "channel-automation", channelId, "videos.json")
    const processedPath = path.join(DATA_DIR, "users", username, "channel-automation", channelId, "processed.json")

    if (!fs.existsSync(videosPath)) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 })
    }

    const videosData = JSON.parse(fs.readFileSync(videosPath, "utf-8"))

    // Get processed video IDs
    let processedIds: string[] = []
    if (fs.existsSync(processedPath)) {
      try {
        const processedData = JSON.parse(fs.readFileSync(processedPath, "utf-8"))
        processedIds = processedData.processed || []
      } catch {}
    }

    // Filter videos: not processed, meets duration requirement, sorted by views
    const eligibleVideos = videosData.videos
      .filter((v: any) => !processedIds.includes(v.videoId) && v.duration >= minDuration)
      .slice(0, numVideos) // Already sorted by views from fetch

    if (eligibleVideos.length === 0) {
      return NextResponse.json({ error: "No eligible videos found" }, { status: 400 })
    }

    // Start background processing (don't await)
    processVideosInBackground(
      eligibleVideos,
      username,
      channelId,
      channelPrompt,
      referenceAudio,
      processedPath,
      processedIds,
      settings.ai?.max_chunk_size || 7000
    )

    // Return immediately
    return NextResponse.json({
      success: true,
      message: `Started processing ${eligibleVideos.length} videos in background`,
      queued: eligibleVideos.length,
      videos: eligibleVideos.map((v: any) => ({ videoId: v.videoId, title: v.title }))
    })
  } catch (error) {
    console.error("Error in auto create:", error)
    return NextResponse.json({ error: "Auto create failed" }, { status: 500 })
  }
}

// Background processing function
async function processVideosInBackground(
  videos: any[],
  username: string,
  channelId: string,
  channelPrompt: string,
  referenceAudio: string,
  processedPath: string,
  processedIds: string[],
  maxChunkSize: number
) {
  console.log(`[BG] Starting background processing of ${videos.length} videos`)

  for (const video of videos) {
    console.log(`[BG] Processing: ${video.title}`)

    try {
      // 1. Fetch transcript
      console.log(`[BG]   Fetching transcript...`)
      const transcript = await fetchTranscript(video.videoId)
      if (!transcript) {
        console.log(`[BG]   No transcript found, skipping`)
        continue
      }

      // 2. Process with Gemini (chunked if needed)
      console.log(`[BG]   Processing with Gemini (${transcript.length} chars)...`)
      const script = await processWithGemini(transcript, channelPrompt, maxChunkSize)
      if (!script) {
        console.log(`[BG]   Gemini failed, skipping`)
        continue
      }

      // 3. Get next video number and save
      const videoNumber = getNextVideoNumber(username)
      const folderName = `video_${videoNumber}`
      saveToOrganized(username, videoNumber, transcript, script, video.title)

      // 4. Queue for audio/video generation
      console.log(`[BG]   Queueing as ${folderName}...`)
      const audioCounter = await getNextAudioCounter()
      const jobId = randomUUID()

      const jobResult = await createAudioJob({
        job_id: jobId,
        script_text: script,
        channel_code: "AUTO",
        video_number: videoNumber,
        date: getTomorrowDate(),
        audio_counter: audioCounter,
        organized_path: `/organized/${folderName}`,
        priority: 5,
        username,
        reference_audio: referenceAudio,
        source_channel: channelId,
        source_video_id: video.videoId
      })

      if (!jobResult.success) {
        console.log(`[BG]   Queue failed, skipping`)
        continue
      }

      // 5. Mark as processed
      processedIds.push(video.videoId)

      // Save completed info
      const completedDir = path.join(DATA_DIR, "users", username, "channel-automation", channelId, "completed")
      if (!fs.existsSync(completedDir)) {
        fs.mkdirSync(completedDir, { recursive: true })
      }
      fs.writeFileSync(
        path.join(completedDir, `${video.videoId}.json`),
        JSON.stringify({
          videoId: video.videoId,
          title: video.title,
          videoNumber,
          folderName,
          jobId,
          processedAt: new Date().toISOString()
        }, null, 2)
      )

      // Save updated processed list
      fs.writeFileSync(processedPath, JSON.stringify({ processed: processedIds }, null, 2))

      console.log(`[BG]   Done!`)

      // Small delay between videos
      await new Promise(r => setTimeout(r, 1000))
    } catch (error) {
      console.error(`[BG]   Error processing ${video.title}:`, error)
    }
  }

  console.log(`[BG] Background processing complete`)
}

// Helper functions
async function fetchTranscript(videoId: string): Promise<string | null> {
  try {
    const url = `https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}`
    const res = await fetch(url, {
      headers: { "x-api-key": SUPADATA_API_KEY! },
      cache: "no-store"
    })

    if (!res.ok) return null

    const data = await res.json()

    if (data.content && Array.isArray(data.content)) {
      return data.content.map((segment: any) => segment.text).join(" ")
    }
    if (typeof data.transcript === "string") return data.transcript
    if (data.text) return data.text

    return null
  } catch (error) {
    console.error(`Transcript error for ${videoId}:`, error)
    return null
  }
}

async function processWithGemini(transcript: string, prompt: string, maxChunkSize: number): Promise<string | null> {
  const chunks = splitIntoChunks(transcript, maxChunkSize)
  const results: string[] = []

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const chunkPrompt = chunks.length > 1
      ? `${prompt}\n\n[Part ${i + 1} of ${chunks.length}]\n\n${chunk}`
      : `${prompt}\n\n${chunk}`

    const result = await callGemini(chunkPrompt)
    if (!result) return null

    results.push(result)

    // Delay between chunks
    if (i < chunks.length - 1) {
      await new Promise(r => setTimeout(r, 500))
    }
  }

  return results.join("\n\n")
}

function splitIntoChunks(text: string, maxSize: number): string[] {
  if (text.length <= maxSize) return [text]

  const chunks: string[] = []
  const sentences = text.split(/(?<=[।.!?])\s+/)
  let currentChunk = ""

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > maxSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim())
      currentChunk = sentence
    } else {
      currentChunk += (currentChunk ? " " : "") + sentence
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim())
  }

  return chunks
}

async function callGemini(prompt: string): Promise<string | null> {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 300000)

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 65536
        }
      }),
      signal: controller.signal
    })

    clearTimeout(timeout)

    if (!res.ok) return null

    const data = await res.json()

    if (data.candidates?.[0]?.finishReason === "SAFETY") return null
    if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
      return data.candidates[0].content.parts[0].text
    }

    return null
  } catch (error) {
    console.error("Gemini error:", error)
    return null
  }
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
