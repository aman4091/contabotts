import { NextRequest, NextResponse } from "next/server"

// Required: Set FILE_SERVER_URL and FILE_SERVER_API_KEY in environment
const FILE_SERVER_URL = process.env.FILE_SERVER_URL || ""
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || ""

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status") || "completed"

    // Get jobs from file server
    const response = await fetch(
      `${FILE_SERVER_URL}/queue/audio/jobs?status=${status}`,
      {
        headers: { "x-api-key": FILE_SERVER_API_KEY }
      }
    )

    if (!response.ok) {
      return NextResponse.json({ error: "Failed to fetch audio files" }, { status: 500 })
    }

    const data = await response.json()

    return NextResponse.json({
      success: true,
      jobs: data.jobs || []
    })
  } catch (error) {
    console.error("Error fetching audio files:", error)
    return NextResponse.json({ error: "Failed to fetch audio files" }, { status: 500 })
  }
}
