import { NextResponse } from "next/server"

const FILE_SERVER_URL = process.env.FILE_SERVER_URL || "http://localhost:8000"
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || "tts-secret-key-2024"

export async function POST() {
  try {
    // Call file server to clear all pending jobs and audio files
    const response = await fetch(`${FILE_SERVER_URL}/queue/audio/clear-all`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": FILE_SERVER_API_KEY
      }
    })

    if (!response.ok) {
      const error = await response.text()
      return NextResponse.json({ success: false, error }, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json({ success: true, ...data })
  } catch (error) {
    console.error("Error clearing queue:", error)
    return NextResponse.json({ success: false, error: "Failed to clear queue" }, { status: 500 })
  }
}
