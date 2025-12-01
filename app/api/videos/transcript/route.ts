import { NextRequest, NextResponse } from "next/server"

const SUPADATA_API_KEY = process.env.SUPADATA_API_KEY

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const videoId = searchParams.get("videoId")

    if (!videoId) {
      return NextResponse.json({ error: "videoId required" }, { status: 400 })
    }

    if (!SUPADATA_API_KEY) {
      return NextResponse.json({ error: "Supadata API key not configured" }, { status: 500 })
    }

    const transcript = await fetchTranscript(videoId)

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

async function fetchTranscript(videoId: string): Promise<string | null> {
  try {
    const url = `https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}`

    const res = await fetch(url, {
      headers: {
        "x-api-key": SUPADATA_API_KEY!
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
