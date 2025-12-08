import { NextResponse } from "next/server"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

export async function GET() {
  try {
    const progressFile = path.join(DATA_DIR, "transcript_progress.json")

    if (!fs.existsSync(progressFile)) {
      return NextResponse.json({
        status: "not_started",
        processed: 0,
        total: 0,
        message: "Transcript fetcher has not run yet"
      })
    }

    const progress = JSON.parse(fs.readFileSync(progressFile, "utf-8"))

    // Calculate percentage
    const percentage = progress.total > 0
      ? Math.round((progress.processed / progress.total) * 100)
      : 0

    return NextResponse.json({
      ...progress,
      percentage,
      message: getStatusMessage(progress)
    })
  } catch (error) {
    console.error("Error getting transcript status:", error)
    return NextResponse.json({
      status: "error",
      error: "Failed to get status"
    }, { status: 500 })
  }
}

function getStatusMessage(progress: any): string {
  switch (progress.status) {
    case "running":
      return `Downloading... ${progress.current_video || ""}`
    case "completed":
      return "All transcripts downloaded!"
    case "idle":
      return `${progress.processed}/${progress.total} done. Next batch in ~30 min.`
    case "error":
      return `Error: ${progress.error}`
    default:
      return "Unknown status"
  }
}
