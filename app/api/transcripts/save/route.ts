import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { saveTranscript } from "@/lib/file-storage"

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

export async function POST(request: NextRequest) {
  try {
    const username = await getUser()
    const body = await request.json()
    const { channelCode, transcripts } = body

    if (!channelCode || !transcripts || !Array.isArray(transcripts)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }

    let saved = 0
    for (const item of transcripts) {
      try {
        saveTranscript(
          channelCode,
          item.index,
          item.title || "",
          item.videoId || "",
          item.transcript || "",
          username
        )
        saved++
      } catch (err) {
        console.error(`Error saving transcript ${item.index}:`, err)
      }
    }

    return NextResponse.json({ success: true, saved })
  } catch (error) {
    console.error("Error saving transcripts:", error)
    return NextResponse.json({ error: "Failed to save transcripts" }, { status: 500 })
  }
}
