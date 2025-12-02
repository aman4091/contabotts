import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

// GET - List videos for a channel
export async function GET(request: NextRequest) {
  try {
    const username = await getUser()
    if (!username) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const channelId = searchParams.get("channelId")

    if (!channelId) {
      return NextResponse.json({ error: "Channel ID required" }, { status: 400 })
    }

    const videosPath = path.join(DATA_DIR, "users", username, "channel-automation", channelId, "videos.json")
    const processedPath = path.join(DATA_DIR, "users", username, "channel-automation", channelId, "processed.json")

    if (!fs.existsSync(videosPath)) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 })
    }

    const videosData = JSON.parse(fs.readFileSync(videosPath, "utf-8"))

    // Get processed video IDs
    let processedIds: string[] = []
    if (fs.existsSync(processedPath)) {
      try {
        const processedData = JSON.parse(fs.readFileSync(processedPath, "utf-8"))
        processedIds = processedData.processed || []
      } catch {}
    }

    // Mark videos as processed or not
    const videos = videosData.videos.map((v: any) => ({
      ...v,
      isProcessed: processedIds.includes(v.videoId)
    }))

    return NextResponse.json({
      channelId,
      channelName: videosData.channelName,
      fetchedAt: videosData.fetchedAt,
      totalVideos: videos.length,
      processedCount: processedIds.length,
      videos
    })
  } catch (error) {
    console.error("Error getting videos:", error)
    return NextResponse.json({ error: "Failed to get videos" }, { status: 500 })
  }
}
