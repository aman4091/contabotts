import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { getTranscriptsList } from "@/lib/file-storage"

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const username = cookieStore.get("user")?.value || "aman"

    const { searchParams } = new URL(request.url)
    const channelCode = searchParams.get("channel")

    if (!channelCode) {
      return NextResponse.json({ error: "Channel code required" }, { status: 400 })
    }

    const transcripts = getTranscriptsList(channelCode, username)

    // Sort by index
    transcripts.sort((a, b) => a.index - b.index)

    return NextResponse.json({
      transcripts,
      total: transcripts.length,
      channel: channelCode
    })
  } catch (error) {
    console.error("Error listing transcripts:", error)
    return NextResponse.json({ error: "Failed to list transcripts" }, { status: 500 })
  }
}
