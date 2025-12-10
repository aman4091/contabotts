import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"
const FILE_SERVER_URL = process.env.FILE_SERVER_URL || ""
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || ""
const SUPADATA_API_KEY = process.env.SUPADATA_API_KEY
const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const CRON_SECRET = process.env.CRON_SECRET || "monitor-secret-2024"

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

// GET - Process delayed videos that are due (called by cron)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const secret = searchParams.get("secret")

  // Verify cron secret
  if (secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  console.log("🕐 Starting delayed videos processing check...")

  const results: { username: string; channel: string; video: string; status: string }[] = []
  const now = new Date()

  // Get all users
  const usersDir = path.join(DATA_DIR, "users")
  if (!fs.existsSync(usersDir)) {
    return NextResponse.json({ message: "No users found", results: [] })
  }

  const users = fs.readdirSync(usersDir).filter(f =>
    fs.statSync(path.join(usersDir, f)).isDirectory()
  )

  for (const username of users) {
    const delayedPath = path.join(DATA_DIR, "users", username, "channel-automation", "delayed-videos.json")

    if (!fs.existsSync(delayedPath)) continue

    let delayedVideos: DelayedVideo[] = []
    try {
      delayedVideos = JSON.parse(fs.readFileSync(delayedPath, "utf-8"))
    } catch {
      continue
    }

    // Only process videos scheduled for TODAY (exactly 7 days after publish)
    // Videos from past dates are skipped - they missed their window
    const today = new Date()
    const todayStr = today.toISOString().split('T')[0] // YYYY-MM-DD

    const dueVideos = delayedVideos.filter(v => {
      if (v.status !== "waiting") return false
      const scheduledStr = new Date(v.scheduledFor).toISOString().split('T')[0]
      return scheduledStr === todayStr
    })

    if (dueVideos.length === 0) continue

    console.log(`📡 Processing ${dueVideos.length} videos scheduled for today (${todayStr}) for ${username}...`)

    // Get settings
    const settings = getSettings(username)
    const referenceAudio = settings.defaultReferenceAudio
    const useAiImage = settings.video?.useAiImage || false
    const maxChunkSize = settings.ai?.max_chunk_size || 7000

    if (!referenceAudio) {
      console.log(`   No reference audio configured for ${username}, skipping`)
      continue
    }

    // Load channel data for prompts
    const channelsPath = path.join(DATA_DIR, "users", username, "channel-automation", "channels.json")
    let channels: any[] = []
    if (fs.existsSync(channelsPath)) {
      try {
        channels = JSON.parse(fs.readFileSync(channelsPath, "utf-8"))
      } catch {}
    }

    for (const video of dueVideos) {
      console.log(`   Processing: ${video.title}`)

      // Update status to processing
      video.status = "processing"
      fs.writeFileSync(delayedPath, JSON.stringify(delayedVideos, null, 2))

      try {
        // Get channel prompt
        const channel = channels.find(c => c.channelId === video.channelId)
        const channelPrompt = channel?.prompt || settings.prompts?.channel

        if (!channelPrompt) {
          console.log(`   No prompt for channel ${video.channelName}, skipping`)
          video.status = "failed"
          fs.writeFileSync(delayedPath, JSON.stringify(delayedVideos, null, 2))
          results.push({ username, channel: video.channelName, video: video.title, status: "failed - no prompt" })
          continue
        }

        // 1. Fetch transcript
        console.log(`   Fetching transcript...`)
        const transcript = await fetchTranscript(video.videoId)
        if (!transcript) {
          console.log(`   No transcript found`)
          video.status = "failed"
          fs.writeFileSync(delayedPath, JSON.stringify(delayedVideos, null, 2))
          results.push({ username, channel: video.channelName, video: video.title, status: "failed - no transcript" })
          continue
        }

        // 2. Process with Gemini
        console.log(`   Processing with Gemini...`)
        const script = await processWithGemini(transcript, channelPrompt, maxChunkSize)
        if (!script) {
          console.log(`   Gemini failed`)
          video.status = "failed"
          fs.writeFileSync(delayedPath, JSON.stringify(delayedVideos, null, 2))
          results.push({ username, channel: video.channelName, video: video.title, status: "failed - gemini error" })
          continue
        }

        // 3. Generate 100 titles (5 calls x 20 titles each)
        console.log(`   Generating titles...`)
        const titlePrompt = settings.prompts?.title || "give me 20 clickbait titles for the below script"
        const titles = await generateTitles(script, titlePrompt)
        console.log(`   Generated ${titles.length} titles`)

        // 4. Get next video number and save to organized
        const videoNumber = getNextVideoNumber(username)
        const folderName = `video_${videoNumber}`
        saveToOrganized(username, videoNumber, transcript, script, video.title, titles)

        // 6. Download and save thumbnail
        console.log(`   Downloading thumbnail...`)
        await downloadThumbnail(username, videoNumber, video.thumbnail, video.videoId)

        // 7. Add to audio queue
        const audioCounter = await getNextAudioCounter()
        const job = {
          id: randomUUID(),
          script,
          referenceAudio,
          audioOnly: false,
          aiImage: useAiImage,
          enhanceAudio: true,
          username,
          videoId: video.videoId,
          title: video.title,
          folderName,
          audioNumber: audioCounter,
          channelId: video.channelId,
          channelName: video.channelName,
          source: "delayed_processing",
          createdAt: new Date().toISOString()
        }

        const result = await createAudioJob(job)
        if (result.success) {
          console.log(`   ✅ Added to queue as ${folderName}`)
          video.status = "completed"
          results.push({ username, channel: video.channelName, video: video.title, status: "completed" })

          // Save to completed tracking
          saveToCompleted(username, video.channelId, video.videoId, video.title, videoNumber, folderName, job.id)
        } else {
          console.log(`   Failed to add to queue`)
          video.status = "failed"
          results.push({ username, channel: video.channelName, video: video.title, status: "failed - queue error" })
        }

        fs.writeFileSync(delayedPath, JSON.stringify(delayedVideos, null, 2))

        // Delay between videos
        await new Promise(r => setTimeout(r, 2000))
      } catch (error) {
        console.error(`   Error processing ${video.title}:`, error)
        video.status = "failed"
        fs.writeFileSync(delayedPath, JSON.stringify(delayedVideos, null, 2))
        results.push({ username, channel: video.channelName, video: video.title, status: "failed - error" })
      }
    }

    // Clean up completed/failed videos older than 7 days
    const cleanupDate = new Date()
    cleanupDate.setDate(cleanupDate.getDate() - 7)
    delayedVideos = delayedVideos.filter(v =>
      v.status === "waiting" ||
      v.status === "processing" ||
      new Date(v.scheduledFor) > cleanupDate
    )
    fs.writeFileSync(delayedPath, JSON.stringify(delayedVideos, null, 2))
  }

  console.log("✅ Delayed videos processing complete")

  return NextResponse.json({
    success: true,
    message: "Delayed videos processing complete",
    results,
    processedAt: new Date().toISOString()
  })
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

function saveToOrganized(username: string, videoNumber: number, transcript: string, script: string, title: string, titles: string[] = []) {
  const folderPath = path.join(DATA_DIR, "users", username, "organized", `video_${videoNumber}`)

  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true })
  }

  fs.writeFileSync(path.join(folderPath, "transcript.txt"), transcript)
  fs.writeFileSync(path.join(folderPath, "script.txt"), script)
  fs.writeFileSync(path.join(folderPath, "title.txt"), title)

  // Save generated titles
  if (titles.length > 0) {
    fs.writeFileSync(path.join(folderPath, "titles.txt"), titles.join("\n"))
  }
}

// Generate 100 titles (5 calls x 20 titles each)
async function generateTitles(script: string, titlePrompt: string): Promise<string[]> {
  const allTitles: string[] = []

  for (let i = 0; i < 5; i++) {
    try {
      const fullPrompt = `${titlePrompt}\n\n${script}`
      const result = await callGemini(fullPrompt)

      if (result) {
        // Parse titles from response - split by newlines and clean up
        const titles = result
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0)
          .map(line => {
            // Remove numbering like "1.", "1)", "1:" etc
            return line.replace(/^\d+[\.\)\:\-]\s*/, '').trim()
          })
          .filter(line => line.length > 10) // Filter out very short lines

        allTitles.push(...titles)
      }

      // Small delay between calls
      if (i < 4) {
        await new Promise(r => setTimeout(r, 1000))
      }
    } catch (error) {
      console.error(`Error generating titles batch ${i + 1}:`, error)
    }
  }

  return allTitles
}

async function downloadThumbnail(username: string, videoNumber: number, thumbnailUrl: string, videoId: string) {
  try {
    const folderPath = path.join(DATA_DIR, "users", username, "organized", `video_${videoNumber}`)

    // Try high quality first, then fallback
    const urls = [
      thumbnailUrl,
      `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    ]

    for (const url of urls) {
      try {
        const res = await fetch(url)
        if (res.ok) {
          const buffer = await res.arrayBuffer()
          fs.writeFileSync(path.join(folderPath, "thumbnail.jpg"), Buffer.from(buffer))
          console.log(`   Thumbnail saved from ${url}`)
          return
        }
      } catch {}
    }
  } catch (error) {
    console.error(`Error downloading thumbnail for video ${videoNumber}:`, error)
  }
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

function saveToCompleted(
  username: string,
  channelId: string,
  videoId: string,
  title: string,
  videoNumber: number,
  folderName: string,
  jobId: string
) {
  const completedPath = path.join(DATA_DIR, "users", username, "channel-automation", channelId, "completed.json")

  let completed: any[] = []
  if (fs.existsSync(completedPath)) {
    try {
      completed = JSON.parse(fs.readFileSync(completedPath, "utf-8"))
    } catch {}
  }

  completed.push({
    videoId,
    title,
    videoNumber,
    folderName,
    jobId,
    processedAt: new Date().toISOString(),
    status: "pending"
  })

  const completedDir = path.dirname(completedPath)
  if (!fs.existsSync(completedDir)) {
    fs.mkdirSync(completedDir, { recursive: true })
  }
  fs.writeFileSync(completedPath, JSON.stringify(completed, null, 2))
}
