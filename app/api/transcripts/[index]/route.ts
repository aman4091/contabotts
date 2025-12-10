import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { getTranscript } from "@/lib/file-storage"

export async function GET(
  request: NextRequest,
  { params }: { params: { index: string } }
) {
  try {
    const cookieStore = await cookies()
    const username = cookieStore.get("user")?.value || "aman"

    const { searchParams } = new URL(request.url)
    const channel = searchParams.get("channel")
    const index = parseInt(params.index)

    if (!channel) {
      return NextResponse.json({ error: "Channel code required" }, { status: 400 })
    }

    if (isNaN(index)) {
      return NextResponse.json({ error: "Invalid index" }, { status: 400 })
    }

    const rawContent = getTranscript(channel, index, username)
    if (!rawContent) {
      return NextResponse.json({ error: "Transcript not found" }, { status: 404 })
    }

    // Remove Title and Video ID lines, keep only transcript
    const lines = rawContent.split('\n')
    let transcriptStart = 0
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('Title:') || lines[i].startsWith('Video ID:') || lines[i].trim() === '') {
        transcriptStart = i + 1
      } else {
        break
      }
    }
    const content = lines.slice(transcriptStart).join('\n').trim()

    return NextResponse.json({ content, index, channel })
  } catch (error) {
    console.error("Error getting transcript:", error)
    return NextResponse.json({ error: "Failed to get transcript" }, { status: 500 })
  }
}
