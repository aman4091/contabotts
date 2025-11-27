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
    const url = `https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}`

    console.log(`Fetching transcript: ${url}`)

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

export async function POST(request: NextRequest) {
  try {
    const { youtubeUrl } = await request.json()

    if (!youtubeUrl) {
      return NextResponse.json(
        { error: "YouTube URL is required" },
        { status: 400 }
      )
    }

    const SUPADATA_API_KEY = process.env.SUPADATA_API_KEY
    if (!SUPADATA_API_KEY) {
      return NextResponse.json(
        { error: "Supadata API key not configured" },
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

    const transcript = await fetchTranscript(videoId, SUPADATA_API_KEY)

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
