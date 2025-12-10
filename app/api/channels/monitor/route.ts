import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import fs from "fs"
import path from "path"
import { getTomorrowDate } from "@/lib/utils"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"
const FILE_SERVER_URL = process.env.FILE_SERVER_URL || ""
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || ""
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY
const SUPADATA_API_KEY = process.env.SUPADATA_API_KEY
const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const CRON_SECRET = process.env.CRON_SECRET || "monitor-secret-2024"

interface Channel {
  id: string
  name: string
  url: string
  channelId: string
  totalVideos: number
  addedAt: string
  prompt?: string
  liveMonitoring?: boolean
  lastChecked?: string
}

interface DelayedVideo {
  id: string
  videoId: string
  title: string
  channelId: string
  channelName: string
  thumbnail: string
  scheduledFor: string
  createdAt: string
  status: "waiting" | "processing" | "completed" | "failed"
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

// GET - Run live monitoring check (called by cron)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const secret = searchParams.get("secret")

  // Verify cron secret
  if (secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  console.log("🔄 Starting live monitoring check...")

  const results: { username: string; channel: string; newVideos: number; processed: number }[] = []

  // Get all users
  const usersDir = path.join(DATA_DIR, "users")
  if (!fs.existsSync(usersDir)) {
    return NextResponse.json({ message: "No users found", results: [] })
  }

  const users = fs.readdirSync(usersDir).filter(f =>
    fs.statSync(path.join(usersDir, f)).isDirectory()
  )

  for (const username of users) {
    const channelsPath = path.join(DATA_DIR, "users", username, "channel-automation", "channels.json")

    if (!fs.existsSync(channelsPath)) continue

    let channels: Channel[] = []
    try {
      channels = JSON.parse(fs.readFileSync(channelsPath, "utf-8"))
    } catch {
      continue
    }

    // Filter channels with live monitoring enabled
    const monitoredChannels = channels.filter(c => c.liveMonitoring === true)

    for (const channel of monitoredChannels) {
      console.log(`📡 Checking ${channel.name} for ${username}...`)

      try {
        // Fetch latest 10 videos from YouTube
        const latestVideos = await fetchLatestVideos(channel.channelId, 10)

        if (!latestVideos || latestVideos.length === 0) {
          console.log(`   No videos found`)
          continue
        }

        // Get processed video IDs
        const processedPath = path.join(DATA_DIR, "users", username, "channel-automation", channel.channelId, "processed.json")
        let processedIds: string[] = []
        if (fs.existsSync(processedPath)) {
          try {
            const processedData = JSON.parse(fs.readFileSync(processedPath, "utf-8"))
            processedIds = processedData.processed || []
          } catch {}
        }

        // Find new videos (not processed yet)
        const newVideos = latestVideos.filter(v => !processedIds.includes(v.videoId))

        console.log(`   Found ${newVideos.length} new videos out of ${latestVideos.length}`)

        if (newVideos.length === 0) {
          // Update lastChecked
          updateLastChecked(channelsPath, channels, channel.channelId)
          continue
        }

        // Get settings
        const settings = getSettings(username)
        const channelPrompt = channel.prompt || settings.prompts?.channel
        const referenceAudio = settings.defaultReferenceAudio
        const useAiImage = settings.video?.useAiImage || false
        const maxChunkSize = settings.ai?.max_chunk_size || 7000

        if (!channelPrompt) {
          console.log(`   No prompt configured, skipping`)
          continue
        }

        let processed = 0
        const delayedPath = path.join(DATA_DIR, "users", username, "channel-automation", "delayed-videos.json")

        // Process new videos (max 5 at a time)
        // Save to delayed queue - will be processed 7 days later
        for (const video of newVideos.slice(0, 5)) {
          console.log(`   Adding to delayed queue: ${video.title}`)

          try {
            // Load existing delayed videos
            let delayedVideos: DelayedVideo[] = []
            if (fs.existsSync(delayedPath)) {
              try {
                delayedVideos = JSON.parse(fs.readFileSync(delayedPath, "utf-8"))
              } catch {}
            }

            // Check if already in delayed queue
            if (delayedVideos.find(d => d.videoId === video.videoId)) {
              console.log(`   Already in delayed queue, skipping`)
              continue
            }

            // Calculate scheduled date: video publish date + 7 days
            const publishDate = new Date(video.publishedAt)
            const scheduledDate = new Date(publishDate)
            scheduledDate.setDate(scheduledDate.getDate() + 7)

            // Add to delayed queue
            delayedVideos.push({
              id: randomUUID(),
              videoId: video.videoId,
              title: video.title,
              channelId: channel.channelId,
              channelName: channel.name,
              thumbnail: video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
              scheduledFor: scheduledDate.toISOString(),
              createdAt: new Date().toISOString(),
              status: "waiting"
            })

            const delayedDir = path.dirname(delayedPath)
            if (!fs.existsSync(delayedDir)) {
              fs.mkdirSync(delayedDir, { recursive: true })
            }
            fs.writeFileSync(delayedPath, JSON.stringify(delayedVideos, null, 2))

            // Mark as processed so we don't add it again
            processedIds.push(video.videoId)

            processed++
            console.log(`   ✅ Added to delayed queue (scheduled for ${scheduledDate.toLocaleDateString()})`)

            // Small delay
            await new Promise(r => setTimeout(r, 500))
          } catch (error) {
            console.error(`   Error adding ${video.title}:`, error)
          }
        }

        // Save updated processed list
        const processedDir = path.dirname(processedPath)
        if (!fs.existsSync(processedDir)) {
          fs.mkdirSync(processedDir, { recursive: true })
        }
        fs.writeFileSync(processedPath, JSON.stringify({ processed: processedIds }, null, 2))

        // Update lastChecked
        updateLastChecked(channelsPath, channels, channel.channelId)

        results.push({
          username,
          channel: channel.name,
          newVideos: newVideos.length,
          processed
        })
      } catch (error) {
        console.error(`Error checking ${channel.name}:`, error)
      }
    }
  }

  console.log("✅ Live monitoring check complete")

  return NextResponse.json({
    success: true,
    message: "Live monitoring check complete",
    results,
    checkedAt: new Date().toISOString()
  })
}

function updateLastChecked(channelsPath: string, channels: Channel[], channelId: string) {
  const index = channels.findIndex(c => c.channelId === channelId)
  if (index !== -1) {
    channels[index].lastChecked = new Date().toISOString()
    fs.writeFileSync(channelsPath, JSON.stringify(channels, null, 2))
  }
}

async function fetchLatestVideos(channelId: string, count: number): Promise<{ videoId: string; title: string; thumbnail: string; publishedAt: string }[]> {
  try {
    // Get uploads playlist ID
    const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${YOUTUBE_API_KEY}`
    const channelRes = await fetch(channelUrl)
    const channelData = await channelRes.json()

    const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
    if (!uploadsPlaylistId) return []

    // Get latest videos
    const playlistUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=${count}&key=${YOUTUBE_API_KEY}`
    const playlistRes = await fetch(playlistUrl)
    const playlistData = await playlistRes.json()

    if (!playlistData.items) return []

    return playlistData.items.map((item: any) => ({
      videoId: item.snippet.resourceId.videoId,
      title: item.snippet.title,
      thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url || `https://i.ytimg.com/vi/${item.snippet.resourceId.videoId}/hqdefault.jpg`,
      publishedAt: item.snippet.publishedAt
    }))
  } catch (error) {
    console.error(`Error fetching videos for ${channelId}:`, error)
    return []
  }
}

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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 300000)

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 65536,
          thinkingConfig: { thinkingBudget: 0 }
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
