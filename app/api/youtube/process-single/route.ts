import { NextRequest, NextResponse } from "next/server"

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  return null
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
      targetSubtitle = subtitles[0]
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

export async function POST(request: NextRequest) {
  try {
    const { youtubeUrl } = await request.json()

    if (!youtubeUrl) {
      return NextResponse.json(
        { error: "YouTube URL is required" },
        { status: 400 }
      )
    }

    const DOWNSUB_API_KEY = process.env.DOWNSUB_API_KEY
    if (!DOWNSUB_API_KEY) {
      return NextResponse.json(
        { error: "DownSub API key not configured" },
        { status: 500 }
      )
    }

    const videoId = extractVideoId(youtubeUrl)
    if (!videoId) {
      return NextResponse.json(
        { error: "Invalid YouTube URL" },
        { status: 400 }
      )
    }

    console.log(`Processing video: ${videoId}`)

    const transcript = await fetchTranscript(videoId, DOWNSUB_API_KEY)

    if (!transcript) {
      return NextResponse.json(
        { error: "Failed to fetch transcript - video may not have captions" },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      transcript,
      videoId
    })

  } catch (error: any) {
    console.error("Process single video error:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
