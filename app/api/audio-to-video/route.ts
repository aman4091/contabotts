import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"

const FILE_SERVER_URL = process.env.FILE_SERVER_URL || "http://localhost:8000"
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || ""

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const username = cookieStore.get("username")?.value

    if (!username) {
      return NextResponse.json({ error: "Not logged in" }, { status: 401 })
    }

    const { gofileLink, imageFolder } = await request.json()

    if (!gofileLink || !imageFolder) {
      return NextResponse.json({ error: "gofileLink and imageFolder required" }, { status: 400 })
    }

    // Validate gofile link format
    if (!gofileLink.includes("gofile.io")) {
      return NextResponse.json({ error: "Invalid Gofile link" }, { status: 400 })
    }

    // Create job in audio queue with special videoOnly flag
    const jobData = {
      videoOnly: true,
      audioLink: gofileLink,
      imageFolder: imageFolder,
      videoTitle: `Video_${Date.now()}`,
      username: username,
      priority: username === "anu" ? 10 : 5
    }

    const response = await fetch(`${FILE_SERVER_URL}/queue/audio/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": FILE_SERVER_API_KEY
      },
      body: JSON.stringify(jobData)
    })

    if (!response.ok) {
      const error = await response.text()
      return NextResponse.json({ error: `Failed to create job: ${error}` }, { status: 500 })
    }

    const result = await response.json()

    return NextResponse.json({
      success: true,
      message: "Job added to queue. Check Audio Files page for result.",
      jobId: result.job_id
    })

  } catch (error) {
    console.error("Audio to video error:", error)
    return NextResponse.json({ error: "Failed to process request" }, { status: 500 })
  }
}
