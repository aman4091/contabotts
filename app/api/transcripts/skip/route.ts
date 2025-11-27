import { NextRequest, NextResponse } from "next/server"
import { skipTranscript } from "@/lib/file-storage"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { channelCode, index } = body

    if (!channelCode || index === undefined) {
      return NextResponse.json({ error: "Channel code and index required" }, { status: 400 })
    }

    const success = skipTranscript(channelCode, index)

    if (!success) {
      return NextResponse.json({ error: "Transcript not found" }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error skipping transcript:", error)
    return NextResponse.json({ error: "Failed to skip transcript" }, { status: 500 })
  }
}
