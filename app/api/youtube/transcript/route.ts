import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { saveTranscript, getSourceChannels } from "@/lib/file-storage"

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

export async function POST(request: NextRequest) {
  try {
    const username = await getUser()
    const body = await request.json()
    const { channelCode, videos, maxVideos = 1000 } = body

    const DOWNSUB_API_KEY = process.env.DOWNSUB_API_KEY
    if (!DOWNSUB_API_KEY) {
      return NextResponse.json({ error: "DownSub API key not configured" }, { status: 500 })
    }

    if (!channelCode) {
      return NextResponse.json({ error: "Channel code required" }, { status: 400 })
    }

    // If videos provided, use them; otherwise fetch from YouTube first
    let videoList = videos
    if (!videoList || videoList.length === 0) {
      // Get channel config (user-specific)
      const channels = getSourceChannels(username)
      const channel = channels.find(c => c.channel_code === channelCode)
      if (!channel) {
        return NextResponse.json({ error: "Channel not found" }, { status: 404 })
      }

      // Fetch videos first
      const videosRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/youtube/videos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelUrl: channel.youtube_channel_url,
          maxResults: maxVideos,
          minDuration: channel.min_duration_seconds,
          maxDuration: channel.max_duration_seconds
        })
      })
      const videosData = await videosRes.json()
      videoList = videosData.videos || []
    }

    if (videoList.length === 0) {
      return NextResponse.json({ error: "No videos to process" }, { status: 400 })
    }

    // Fetch transcripts with rate limiting (10/sec)
    let saved = 0
    let failed = 0
    const batchSize = 10
    const delayBetweenBatches = 1000 // 1 second

    for (let i = 0; i < videoList.length; i += batchSize) {
      const batch = videoList.slice(i, i + batchSize)

      // Process batch in parallel
      const results = await Promise.allSettled(
        batch.map(async (video: any, batchIndex: number) => {
          const index = i + batchIndex + 1
          const transcript = await fetchTranscript(video.videoId, DOWNSUB_API_KEY)

          if (transcript) {
            saveTranscript(channelCode, index, video.title, video.videoId, transcript, username)
            return { success: true, index }
          } else {
            return { success: false, index, videoId: video.videoId }
          }
        })
      )

      // Count results
      for (const result of results) {
        if (result.status === "fulfilled" && result.value.success) {
          saved++
        } else {
          failed++
        }
      }

      // Wait before next batch (rate limiting)
      if (i + batchSize < videoList.length) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches))
      }
    }

    return NextResponse.json({
      success: true,
      saved,
      failed,
      total: videoList.length
    })
  } catch (error) {
    console.error("Error fetching transcripts:", error)
    return NextResponse.json({ error: "Failed to fetch transcripts" }, { status: 500 })
  }
}

async function fetchTranscript(videoId: string, apiKey: string): Promise<string | null> {
  try {
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`

    console.log(`[DownSub] Fetching transcript for: ${videoId}`)

    // Step 1: Get subtitle URLs from DownSub
    const res = await fetch("https://api.downsub.com/download", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ url: youtubeUrl }),
      cache: 'no-store'
    })

    if (!res.ok) {
      const text = await res.text()
      console.error(`[DownSub] Error for ${videoId}: ${res.status} - ${text}`)
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
      targetSubtitle = subtitles[0] // fallback to first available
    }

    if (!targetSubtitle) {
      console.error(`[DownSub] No suitable subtitle found for ${videoId}`)
      return null
    }

    // Step 3: Get txt format URL
    const txtFormat = targetSubtitle.formats?.find((f: any) => f.format === "txt")
    if (!txtFormat?.url) {
      console.error(`[DownSub] No txt format available for ${videoId}`)
      return null
    }

    // Step 4: Fetch the actual transcript text
    const txtRes = await fetch(txtFormat.url)
    if (!txtRes.ok) {
      console.error(`[DownSub] Failed to fetch txt for ${videoId}: ${txtRes.status}`)
      return null
    }

    const transcript = await txtRes.text()
    console.log(`[DownSub] Got transcript for ${videoId}: ${transcript.length} chars`)
    return transcript.trim()

  } catch (error) {
    console.error(`[DownSub] Error fetching transcript for ${videoId}:`, error)
    return null
  }
}
