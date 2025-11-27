import { NextRequest, NextResponse } from "next/server"
import { saveTranscript } from "@/lib/file-storage"

export async function POST(request: NextRequest) {
  try {
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
          item.transcript || ""
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
