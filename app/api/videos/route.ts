import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"
const VIDEOS_DIR = path.join(DATA_DIR, "videos")

interface VideoMetadata {
  channelUrl: string
  channelId: string
  channelName: string
  fetchedAt: string
  totalVideos: number
  videos: {
    videoId: string
    title: string
    thumbnail: string
    duration: number
    viewCount: number
    publishedAt: string
  }[]
}

interface ProcessedVideos {
  skipped: string[]
  completed: string[]
}

function getMetadata(): VideoMetadata | null {
  const metadataPath = path.join(VIDEOS_DIR, "metadata.json")
  if (!fs.existsSync(metadataPath)) {
    return null
  }
  try {
    return JSON.parse(fs.readFileSync(metadataPath, "utf-8"))
  } catch {
    return null
  }
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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get("page") || "1")
    const limit = parseInt(searchParams.get("limit") || "100")
    const showAll = searchParams.get("showAll") === "true"

    const metadata = getMetadata()
    if (!metadata) {
      return NextResponse.json({
        videos: [],
        hasMore: false,
        total: 0,
        remaining: 0,
        channelName: null,
        message: "No videos fetched yet. Go to Settings to fetch videos."
      })
    }

    const processed = getProcessedVideos()
    const processedIds = new Set([...processed.skipped, ...processed.completed])

    // Filter out processed videos unless showAll is true
    const availableVideos = showAll
      ? metadata.videos
      : metadata.videos.filter(v => !processedIds.has(v.videoId))

    // Pagination
    const startIndex = (page - 1) * limit
    const endIndex = startIndex + limit
    const paginatedVideos = availableVideos.slice(startIndex, endIndex)

    return NextResponse.json({
      videos: paginatedVideos,
      hasMore: endIndex < availableVideos.length,
      total: availableVideos.length,
      remaining: availableVideos.length - endIndex > 0 ? availableVideos.length - endIndex : 0,
      channelName: metadata.channelName,
      fetchedAt: metadata.fetchedAt,
      page,
      limit,
      processedCount: processedIds.size,
      skippedCount: processed.skipped.length,
      completedCount: processed.completed.length
    })
  } catch (error) {
    console.error("Error getting videos:", error)
    return NextResponse.json({ error: "Failed to get videos" }, { status: 500 })
  }
}

// POST - Mark video as completed (after adding to queue)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { videoId, action } = body

    if (!videoId) {
      return NextResponse.json({ error: "videoId required" }, { status: 400 })
    }

    if (!action || !["complete", "skip"].includes(action)) {
      return NextResponse.json({ error: "action must be 'complete' or 'skip'" }, { status: 400 })
    }

    const processedPath = path.join(VIDEOS_DIR, "processed.json")
    const processed = getProcessedVideos()

    if (action === "complete") {
      if (!processed.completed.includes(videoId)) {
        processed.completed.push(videoId)
      }
    } else if (action === "skip") {
      if (!processed.skipped.includes(videoId)) {
        processed.skipped.push(videoId)
      }
    }

    // Ensure directory exists
    if (!fs.existsSync(VIDEOS_DIR)) {
      fs.mkdirSync(VIDEOS_DIR, { recursive: true })
    }

    fs.writeFileSync(processedPath, JSON.stringify(processed, null, 2))

    return NextResponse.json({
      success: true,
      action,
      videoId,
      skippedCount: processed.skipped.length,
      completedCount: processed.completed.length
    })
  } catch (error) {
    console.error("Error updating video status:", error)
    return NextResponse.json({ error: "Failed to update status" }, { status: 500 })
  }
}
