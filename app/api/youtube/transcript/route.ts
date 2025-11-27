import { NextRequest, NextResponse } from "next/server"
import { saveTranscript, getSourceChannels } from "@/lib/file-storage"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { channelCode, videos, maxVideos = 1000 } = body

    const SUPADATA_API_KEY = process.env.SUPADATA_API_KEY
    if (!SUPADATA_API_KEY) {
      return NextResponse.json({ error: "Supadata API key not configured" }, { status: 500 })
    }

    if (!channelCode) {
      return NextResponse.json({ error: "Channel code required" }, { status: 400 })
    }

    // If videos provided, use them; otherwise fetch from YouTube first
    let videoList = videos
    if (!videoList || videoList.length === 0) {
      // Get channel config
      const channels = getSourceChannels()
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

    // Fetch transcripts with rate limiting (20/sec)
    let saved = 0
    let failed = 0
    const batchSize = 20
    const delayBetweenBatches = 1000 // 1 second

    for (let i = 0; i < videoList.length; i += batchSize) {
      const batch = videoList.slice(i, i + batchSize)

      // Process batch in parallel
      const results = await Promise.allSettled(
        batch.map(async (video: any, batchIndex: number) => {
          const index = i + batchIndex + 1
          const transcript = await fetchTranscript(video.videoId, SUPADATA_API_KEY)

          if (transcript) {
            saveTranscript(channelCode, index, video.title, video.videoId, transcript)
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
    const url = `https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}`

    console.log(`Fetching: ${url}`)
    console.log(`API Key: ${apiKey?.substring(0, 10)}...`)

    const res = await fetch(url, {
      headers: {
        "x-api-key": apiKey
      },
      cache: 'no-store'
    })

    if (!res.ok) {
      const text = await res.text()
      console.error(`Supadata error for ${videoId}: ${res.status} - ${text}`)
      return null
    }

    const data = await res.json()

    // Supadata returns transcript in segments, combine them
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
  } catch (error) {
    console.error(`Error fetching transcript for ${videoId}:`, error)
    return null
  }
}
