import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { getTranscriptsList, getTranscript } from "@/lib/file-storage"

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

export async function GET(request: NextRequest) {
  try {
    const username = await getUser()
    const { searchParams } = new URL(request.url)
    const channel = searchParams.get("channel")
    const index = searchParams.get("index")

    if (!channel) {
      return NextResponse.json({ error: "Channel code required" }, { status: 400 })
    }

    // If index provided, return single transcript
    if (index) {
      const content = getTranscript(channel, parseInt(index), username)
      if (!content) {
        return NextResponse.json({ error: "Transcript not found" }, { status: 404 })
      }
      return NextResponse.json({ content })
    }

    // Otherwise return list
    const transcripts = getTranscriptsList(channel, username)
    return NextResponse.json({ transcripts })
  } catch (error) {
    console.error("Error getting transcripts:", error)
    return NextResponse.json({ error: "Failed to get transcripts" }, { status: 500 })
  }
}
