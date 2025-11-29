import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

function getChannelsPath(username: string) {
  return path.join(DATA_DIR, "users", username, "auto-processing", "channels.json")
}

function getVideosPath(username: string, channelId: string) {
  return path.join(DATA_DIR, "users", username, "auto-processing", "videos", `${channelId}.json`)
}

function loadChannels(username: string) {
  const filePath = getChannelsPath(username)
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"))
    } catch {
      return { channels: [] }
    }
  }
  return { channels: [] }
}

function loadVideoPool(username: string, channelId: string) {
  const filePath = getVideosPath(username, channelId)
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"))
    } catch {
      return { videoPool: [], processedVideoIds: [], lastPoolRefreshAt: null }
    }
  }
  return { videoPool: [], processedVideoIds: [], lastPoolRefreshAt: null }
}

// GET - Get overall status
export async function GET() {
  try {
    const username = await getUser()
    if (!username) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const data = loadChannels(username)
    const channels = data.channels || []

    let totalPool = 0
    let totalProcessed = 0
    let totalPending = 0

    const channelStats = channels.map((channel: any) => {
      const pool = loadVideoPool(username, channel.sourceChannelId)
      const processedSet = new Set(pool.processedVideoIds || [])
      const poolSize = pool.videoPool?.length || 0
      const processedCount = processedSet.size
      const pendingCount = Math.max(0, poolSize - processedCount)

      totalPool += poolSize
      totalProcessed += processedCount
      totalPending += pendingCount

      // Check if pool needs refresh (older than 7 days)
      const lastRefresh = pool.lastPoolRefreshAt ? new Date(pool.lastPoolRefreshAt) : null
      const needsRefresh = !lastRefresh || (Date.now() - lastRefresh.getTime() > 7 * 24 * 60 * 60 * 1000)

      return {
        id: channel.id,
        name: channel.sourceChannelName,
        targetChannel: channel.targetChannelCode,
        isActive: channel.isActive,
        poolSize,
        processedCount,
        pendingCount,
        lastProcessedAt: channel.lastProcessedAt,
        needsPoolRefresh: needsRefresh
      }
    })

    return NextResponse.json({
      success: true,
      summary: {
        totalChannels: channels.length,
        activeChannels: channels.filter((ch: any) => ch.isActive).length,
        totalPool,
        totalProcessed,
        totalPending
      },
      channels: channelStats
    })
  } catch (error) {
    console.error("Error getting status:", error)
    return NextResponse.json({ error: "Failed to get status" }, { status: 500 })
  }
}
