import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { randomUUID } from "crypto"
import fs from "fs"
import path from "path"
import { saveToOrganized, getNextVideoNumber } from "@/lib/file-storage"
import { getTomorrowDate, addDays } from "@/lib/utils"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"
const FILE_SERVER_URL = process.env.FILE_SERVER_URL || ""
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || ""
const SUPADATA_API_KEY = process.env.SUPADATA_API_KEY || ""
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ""
const MAX_VIDEOS_PER_DAY = 4

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

function getChannelsPath(username: string) {
  return path.join(DATA_DIR, "users", username, "auto-processing", "channels.json")
}

function getVideosPath(username: string, channelId: string) {
  return path.join(DATA_DIR, "users", username, "auto-processing", "videos", `${channelId}.json`)
}

function loadChannels(username: string) {
  const filePath = getChannelsPath(username)
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"))
    } catch {
      return { channels: [] }
    }
  }
  return { channels: [] }
}

function saveChannels(username: string, data: any) {
  const filePath = getChannelsPath(username)
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function loadVideoPool(username: string, channelId: string) {
  const filePath = getVideosPath(username, channelId)
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"))
    } catch {
      return { videoPool: [], processedVideoIds: [], lastPoolRefreshAt: null }
    }
  }
  return { videoPool: [], processedVideoIds: [], lastPoolRefreshAt: null }
}

function saveVideoPool(username: string, channelId: string, data: any) {
  const filePath = getVideosPath(username, channelId)
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function getSettings() {
  const settingsPath = path.join(DATA_DIR, "settings.json")
  if (fs.existsSync(settingsPath)) {
    try {
      return JSON.parse(fs.readFileSync(settingsPath, "utf-8"))
    } catch {
      return { prompts: { youtube: "" }, ai: { model: "gemini-2.0-flash-exp", max_chunk_size: 7000 } }
    }
  }
  return { prompts: { youtube: "" }, ai: { model: "gemini-2.0-flash-exp", max_chunk_size: 7000 } }
}

// POST - Run processing for a channel
export async function POST(request: NextRequest) {
  try {
    const username = await getUser()
    if (!username) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { channelId } = body

    const data = loadChannels(username)

    // Find channel(s) to process
    let channelsToProcess = data.channels.filter((ch: any) => ch.isActive)

    if (channelId) {
      channelsToProcess = data.channels.filter((ch: any) => ch.id === channelId)
    }

    if (channelsToProcess.length === 0) {
      return NextResponse.json({ error: "No active channels to process" }, { status: 400 })
    }

    let totalQueued = 0
    const results: any[] = []

    for (const channel of channelsToProcess) {
      const result = await processChannel(username, channel, data)
      results.push(result)
      totalQueued += result.queued
    }

    // Save updated lastProcessedAt
    saveChannels(username, data)

    return NextResponse.json({
      success: true,
      videosQueued: totalQueued,
      results
    })
  } catch (error) {
    console.error("Error running auto-processing:", error)
    return NextResponse.json({ error: "Failed to run processing" }, { status: 500 })
  }
}

async function processChannel(username: string, channel: any, allChannelsData: any) {
  const result = {
    channelId: channel.id,
    channelName: channel.sourceChannelName,
    queued: 0,
    errors: [] as string[]
  }

  try {
    // Load video pool
    const poolData = loadVideoPool(username, channel.sourceChannelId)
    const processedSet = new Set(poolData.processedVideoIds || [])

    // Get unprocessed videos
    const unprocessedVideos = (poolData.videoPool || [])
      .filter((v: any) => !processedSet.has(v.videoId))
      .sort((a: any, b: any) => b.viewCount - a.viewCount)
      .slice(0, channel.dailyVideoCount)

    if (unprocessedVideos.length === 0) {
      result.errors.push("No unprocessed videos available")
      return result
    }

    const settings = getSettings()

    // Process each video
    for (const video of unprocessedVideos) {
      try {
        // 1. Fetch transcript via Supadata
        const transcript = await fetchTranscript(video.videoId)
        if (!transcript) {
          result.errors.push(`Failed to get transcript for ${video.videoId}`)
          continue
        }

        // 2. Generate script via Gemini
        const prompt = channel.customPrompt || settings.prompts?.youtube || ""
        const script = await generateScript(transcript, prompt, settings.ai?.model)
        if (!script) {
          result.errors.push(`Failed to generate script for ${video.videoId}`)
          continue
        }

        // 3. Add to queue with priority 1 (low)
        const queueResult = await addToQueue(username, channel.targetChannelCode, transcript, script)
        if (!queueResult.success) {
          result.errors.push(`Failed to queue ${video.videoId}: ${queueResult.error}`)
          continue
        }

        // 4. Mark video as processed
        poolData.processedVideoIds.push(video.videoId)
        result.queued++

        // Small delay between videos
        await new Promise(resolve => setTimeout(resolve, 500))

      } catch (videoError) {
        result.errors.push(`Error processing ${video.videoId}: ${videoError}`)
      }
    }

    // Save updated pool
    saveVideoPool(username, channel.sourceChannelId, poolData)

    // Update channel lastProcessedAt
    const channelIndex = allChannelsData.channels.findIndex((ch: any) => ch.id === channel.id)
    if (channelIndex !== -1) {
      allChannelsData.channels[channelIndex].lastProcessedAt = new Date().toISOString()
    }

  } catch (error) {
    result.errors.push(`Channel error: ${error}`)
  }

  return result
}

async function fetchTranscript(videoId: string): Promise<string | null> {
  if (!SUPADATA_API_KEY) return null

  try {
    const res = await fetch(`https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}`, {
      headers: { "x-api-key": SUPADATA_API_KEY }
    })

    if (!res.ok) return null

    const data = await res.json()

    if (data.content && Array.isArray(data.content)) {
      return data.content.map((segment: any) => segment.text).join(" ")
    }
    if (typeof data.transcript === "string") {
      return data.transcript
    }
    if (data.text) {
      return data.text
    }

    return null
  } catch {
    return null
  }
}

async function generateScript(transcript: string, prompt: string, model: string = "gemini-2.0-flash-exp"): Promise<string | null> {
  if (!GEMINI_API_KEY) return null

  try {
    const maxChunkSize = 7000

    // Split into chunks if needed
    const chunks = splitIntoChunks(transcript, maxChunkSize)
    const results: string[] = []

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const chunkPrompt = chunks.length > 1
        ? `${prompt}\n\n[Part ${i + 1} of ${chunks.length}]\n\n${chunk}`
        : `${prompt}\n\n${chunk}`

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: chunkPrompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 8192 }
        })
      })

      if (!res.ok) return null

      const data = await res.json()
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text
      if (text) {
        results.push(text)
      } else {
        return null
      }

      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }

    return results.join("\n\n")
  } catch {
    return null
  }
}

function splitIntoChunks(text: string, maxSize: number): string[] {
  if (text.length <= maxSize) return [text]

  const chunks: string[] = []
  const sentences = text.split(/(?<=[.!?])\s+/)
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

async function addToQueue(username: string, targetChannel: string, transcript: string, script: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Find next available slot
    let date = getTomorrowDate()
    let videoNumber = getNextVideoNumber(date, targetChannel)
    let daysChecked = 0

    while (videoNumber > MAX_VIDEOS_PER_DAY && daysChecked < 30) {
      daysChecked++
      date = addDays(getTomorrowDate(), daysChecked)
      videoNumber = getNextVideoNumber(date, targetChannel)
    }

    if (videoNumber > MAX_VIDEOS_PER_DAY) {
      return { success: false, error: "No available slots" }
    }

    // Get audio counter
    const counterRes = await fetch(`${FILE_SERVER_URL}/counter/increment/audio`, {
      method: "POST",
      headers: { "x-api-key": FILE_SERVER_API_KEY }
    })
    const counterData = await counterRes.json()
    const audioCounter = counterData.value || Date.now() % 1000000

    // Save to organized folder
    const organizedPath = `/organized/${date}/${targetChannel}/video_${videoNumber}`
    saveToOrganized(date, targetChannel, videoNumber, transcript, script)

    // Create job with priority 1 (low - for auto processing)
    const jobId = randomUUID()
    const jobRes = await fetch(`${FILE_SERVER_URL}/queue/audio/jobs`, {
      method: "POST",
      headers: {
        "x-api-key": FILE_SERVER_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        job_id: jobId,
        script_text: script,
        channel_code: targetChannel,
        video_number: videoNumber,
        date: date,
        audio_counter: audioCounter,
        organized_path: organizedPath,
        priority: 1, // LOW priority for auto-processing
        username: username
      })
    })

    if (!jobRes.ok) {
      return { success: false, error: "Failed to create job" }
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
