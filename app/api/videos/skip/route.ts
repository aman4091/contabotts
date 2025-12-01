import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value || "default"
}

function getUserVideosDir(username: string) {
  return path.join(DATA_DIR, "users", username, "videos")
}

interface ProcessedVideos {
  skipped: string[]
  completed: string[]
}

function getProcessedVideos(videosDir: string, channelCode: string): ProcessedVideos {
  const processedPath = path.join(videosDir, channelCode, "processed.json")
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
    const username = await getUser()
    const videosDir = getUserVideosDir(username)

    const body = await request.json()
    const { videoId, channelCode } = body

    if (!videoId) {
      return NextResponse.json({ error: "videoId required" }, { status: 400 })
    }

    if (!channelCode) {
      return NextResponse.json({ error: "channelCode required" }, { status: 400 })
    }

    const processedDir = path.join(videosDir, channelCode)
    const processedPath = path.join(processedDir, "processed.json")
    const processed = getProcessedVideos(videosDir, channelCode)

    if (!processed.skipped.includes(videoId)) {
      processed.skipped.push(videoId)
    }

    // Ensure directory exists
    if (!fs.existsSync(processedDir)) {
      fs.mkdirSync(processedDir, { recursive: true })
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

// GET - Get all processed videos (skipped + completed)
export async function GET(request: NextRequest) {
  try {
    const username = await getUser()
    const videosDir = getUserVideosDir(username)

    const { searchParams } = new URL(request.url)
    const channelCode = searchParams.get("channel")

    if (!channelCode) {
      return NextResponse.json({ error: "channelCode required" }, { status: 400 })
    }

    // Get processed videos list
    const processed = getProcessedVideos(videosDir, channelCode)

    // Load video metadata to get full details
    const metadataPath = path.join(videosDir, channelCode, "metadata.json")
    let allVideos: Array<{videoId: string, title: string, thumbnail: string, duration: number, viewCount: number}> = []

    if (fs.existsSync(metadataPath)) {
      try {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"))
        allVideos = metadata.videos || []
      } catch {}
    }

    // Filter to get only processed videos with their details
    const skippedVideos = allVideos.filter(v => processed.skipped.includes(v.videoId))
    const completedVideos = allVideos.filter(v => processed.completed.includes(v.videoId))

    return NextResponse.json({
      skipped: skippedVideos,
      completed: completedVideos,
      skippedCount: processed.skipped.length,
      completedCount: processed.completed.length
    })
  } catch (error) {
    console.error("Error getting processed videos:", error)
    return NextResponse.json({ error: "Failed to get processed videos" }, { status: 500 })
  }
}

// DELETE - Unskip a video (restore it)
export async function DELETE(request: NextRequest) {
  try {
    const username = await getUser()
    const videosDir = getUserVideosDir(username)

    const { searchParams } = new URL(request.url)
    const videoId = searchParams.get("videoId")
    const channelCode = searchParams.get("channel")

    if (!videoId) {
      return NextResponse.json({ error: "videoId required" }, { status: 400 })
    }

    if (!channelCode) {
      return NextResponse.json({ error: "channelCode required" }, { status: 400 })
    }

    const processedDir = path.join(videosDir, channelCode)
    const processedPath = path.join(processedDir, "processed.json")
    const processed = getProcessedVideos(videosDir, channelCode)

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
