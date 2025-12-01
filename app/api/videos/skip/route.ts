import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"
const VIDEOS_DIR = path.join(DATA_DIR, "videos")

interface ProcessedVideos {
  skipped: string[]
  completed: string[]
}

function getProcessedVideos(): ProcessedVideos {
  const processedPath = path.join(VIDEOS_DIR, "processed.json")
  if (!fs.existsSync(processedPath)) {
    return { skipped: [], completed: [] }
  }
  try {
    return JSON.parse(fs.readFileSync(processedPath, "utf-8"))
  } catch {
    return { skipped: [], completed: [] }
  }
}

// POST - Skip a video
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { videoId } = body

    if (!videoId) {
      return NextResponse.json({ error: "videoId required" }, { status: 400 })
    }

    const processedPath = path.join(VIDEOS_DIR, "processed.json")
    const processed = getProcessedVideos()

    if (!processed.skipped.includes(videoId)) {
      processed.skipped.push(videoId)
    }

    // Ensure directory exists
    if (!fs.existsSync(VIDEOS_DIR)) {
      fs.mkdirSync(VIDEOS_DIR, { recursive: true })
    }

    fs.writeFileSync(processedPath, JSON.stringify(processed, null, 2))

    return NextResponse.json({
      success: true,
      videoId,
      skippedCount: processed.skipped.length,
      completedCount: processed.completed.length
    })
  } catch (error) {
    console.error("Error skipping video:", error)
    return NextResponse.json({ error: "Failed to skip video" }, { status: 500 })
  }
}

// DELETE - Unskip a video (restore it)
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const videoId = searchParams.get("videoId")

    if (!videoId) {
      return NextResponse.json({ error: "videoId required" }, { status: 400 })
    }

    const processedPath = path.join(VIDEOS_DIR, "processed.json")
    const processed = getProcessedVideos()

    // Remove from both skipped and completed
    processed.skipped = processed.skipped.filter(id => id !== videoId)
    processed.completed = processed.completed.filter(id => id !== videoId)

    fs.writeFileSync(processedPath, JSON.stringify(processed, null, 2))

    return NextResponse.json({
      success: true,
      videoId,
      message: "Video restored",
      skippedCount: processed.skipped.length,
      completedCount: processed.completed.length
    })
  } catch (error) {
    console.error("Error restoring video:", error)
    return NextResponse.json({ error: "Failed to restore video" }, { status: 500 })
  }
}
