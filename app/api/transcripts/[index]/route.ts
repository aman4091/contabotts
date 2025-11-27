import { NextRequest, NextResponse } from "next/server"
import { getTranscript } from "@/lib/file-storage"

export async function GET(
  request: NextRequest,
  { params }: { params: { index: string } }
) {
  try {
    const { searchParams } = new URL(request.url)
    const channel = searchParams.get("channel")
    const index = parseInt(params.index)

    if (!channel) {
      return NextResponse.json({ error: "Channel code required" }, { status: 400 })
    }

    if (isNaN(index)) {
      return NextResponse.json({ error: "Invalid index" }, { status: 400 })
    }

    const content = getTranscript(channel, index)
    if (!content) {
      return NextResponse.json({ error: "Transcript not found" }, { status: 404 })
    }

    return NextResponse.json({ content, index, channel })
  } catch (error) {
    console.error("Error getting transcript:", error)
    return NextResponse.json({ error: "Failed to get transcript" }, { status: 500 })
  }
}
