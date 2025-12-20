import { NextRequest, NextResponse } from "next/server"

const MIN_REQUEST_INTERVAL = 1000 // 1 second between requests
let lastRequestTime = 0

async function waitForRateLimit() {
  const elapsed = Date.now() - lastRequestTime

  if (elapsed < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - elapsed
    console.log(`⏳ Rate limit: waiting ${waitTime}ms`)
    await new Promise(resolve => setTimeout(resolve, waitTime))
  }
  lastRequestTime = Date.now()
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const videoId = searchParams.get("videoId")

    if (!videoId) {
      return NextResponse.json({ error: "videoId required" }, { status: 400 })
    }

    const DOWNSUB_API_KEY = process.env.DOWNSUB_API_KEY
    if (!DOWNSUB_API_KEY) {
      return NextResponse.json({ error: "DownSub API key not configured" }, { status: 500 })
    }

    // Rate limiting - wait if needed
    await waitForRateLimit()

    const transcript = await fetchTranscript(videoId, DOWNSUB_API_KEY)

    if (!transcript) {
      return NextResponse.json({ error: "Could not fetch transcript" }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      videoId,
      transcript,
      charCount: transcript.length
    })
  } catch (error) {
    console.error("Error fetching transcript:", error)
    return NextResponse.json({ error: "Failed to fetch transcript" }, { status: 500 })
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
