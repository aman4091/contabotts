import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import fs from "fs"
import path from "path"
import { v4 as uuidv4 } from "uuid"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY

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

function saveChannels(username: string, data: any) {
  const filePath = getChannelsPath(username)
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
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

function saveVideoPool(username: string, channelId: string, data: any) {
  const filePath = getVideosPath(username, channelId)
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

// Get channel stats
function getChannelStats(username: string, channelId: string) {
  const pool = loadVideoPool(username, channelId)
  const processedSet = new Set(pool.processedVideoIds || [])
  const poolSize = pool.videoPool?.length || 0
  const processedCount = processedSet.size
  const pendingCount = poolSize - processedCount

  return {
    poolSize,
    processedCount,
    pendingCount: Math.max(0, pendingCount)
  }
}

// GET - List all channels with stats
export async function GET() {
  try {
    const username = await getUser()
    if (!username) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const data = loadChannels(username)
    const channelsWithStats = data.channels.map((ch: any) => ({
      ...ch,
      stats: getChannelStats(username, ch.sourceChannelId)
    }))

    return NextResponse.json({
      success: true,
      channels: channelsWithStats
    })
  } catch (error) {
    console.error("Error loading channels:", error)
    return NextResponse.json({ error: "Failed to load channels" }, { status: 500 })
  }
}

// POST - Add new channel
export async function POST(request: NextRequest) {
  try {
    const username = await getUser()
    if (!username) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { sourceChannelUrl, targetChannelCode, minDuration, maxDuration, dailyVideoCount, customPrompt } = body

    if (!sourceChannelUrl || !targetChannelCode) {
      return NextResponse.json({ error: "Source URL and Target Channel required" }, { status: 400 })
    }

    // Get channel info from YouTube
    const channelInfo = await getYouTubeChannelInfo(sourceChannelUrl)
    if (!channelInfo) {
      return NextResponse.json({ error: "Could not find YouTube channel" }, { status: 400 })
    }

    // Create channel entry
    const newChannel = {
      id: uuidv4(),
      sourceChannelUrl,
      sourceChannelId: channelInfo.id,
      sourceChannelName: channelInfo.name,
      targetChannelCode,
      minDuration: minDuration || 300,
      maxDuration: maxDuration || 900,
      dailyVideoCount: dailyVideoCount || 6,
      customPrompt: customPrompt || "",
      isActive: true,
      createdAt: new Date().toISOString(),
      lastProcessedAt: null
    }

    // Save channel
    const data = loadChannels(username)

    // Check if channel already exists
    const exists = data.channels.some((ch: any) => ch.sourceChannelId === channelInfo.id)
    if (exists) {
      return NextResponse.json({ error: "Channel already added" }, { status: 400 })
    }

    data.channels.push(newChannel)
    saveChannels(username, data)

    // Fetch initial video pool (top 1000 videos)
    const videoPool = await fetchVideoPool(channelInfo.id, minDuration || 300, maxDuration || 900)
    saveVideoPool(username, channelInfo.id, {
      videoPool,
      processedVideoIds: [],
      lastPoolRefreshAt: new Date().toISOString()
    })

    return NextResponse.json({
      success: true,
      channel: {
        ...newChannel,
        stats: {
          poolSize: videoPool.length,
          processedCount: 0,
          pendingCount: videoPool.length
        }
      },
      poolSize: videoPool.length
    })
  } catch (error) {
    console.error("Error adding channel:", error)
    return NextResponse.json({ error: "Failed to add channel" }, { status: 500 })
  }
}

// PUT - Update channel
export async function PUT(request: NextRequest) {
  try {
    const username = await getUser()
    if (!username) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json({ error: "Channel ID required" }, { status: 400 })
    }

    const body = await request.json()
    const data = loadChannels(username)

    const index = data.channels.findIndex((ch: any) => ch.id === id)
    if (index === -1) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 })
    }

    // Update fields
    const channel = data.channels[index]
    if (body.sourceChannelUrl !== undefined) channel.sourceChannelUrl = body.sourceChannelUrl
    if (body.targetChannelCode !== undefined) channel.targetChannelCode = body.targetChannelCode
    if (body.minDuration !== undefined) channel.minDuration = body.minDuration
    if (body.maxDuration !== undefined) channel.maxDuration = body.maxDuration
    if (body.dailyVideoCount !== undefined) channel.dailyVideoCount = body.dailyVideoCount
    if (body.customPrompt !== undefined) channel.customPrompt = body.customPrompt
    if (body.isActive !== undefined) channel.isActive = body.isActive
    if (body.lastProcessedAt !== undefined) channel.lastProcessedAt = body.lastProcessedAt

    saveChannels(username, data)

    return NextResponse.json({
      success: true,
      channel: {
        ...channel,
        stats: getChannelStats(username, channel.sourceChannelId)
      }
    })
  } catch (error) {
    console.error("Error updating channel:", error)
    return NextResponse.json({ error: "Failed to update channel" }, { status: 500 })
  }
}

// DELETE - Remove channel
export async function DELETE(request: NextRequest) {
  try {
    const username = await getUser()
    if (!username) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json({ error: "Channel ID required" }, { status: 400 })
    }

    const data = loadChannels(username)
    const index = data.channels.findIndex((ch: any) => ch.id === id)

    if (index === -1) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 })
    }

    const channel = data.channels[index]

    // Remove video pool file
    const videosPath = getVideosPath(username, channel.sourceChannelId)
    if (fs.existsSync(videosPath)) {
      fs.unlinkSync(videosPath)
    }

    // Remove channel from list
    data.channels.splice(index, 1)
    saveChannels(username, data)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting channel:", error)
    return NextResponse.json({ error: "Failed to delete channel" }, { status: 500 })
  }
}

// Helper: Get YouTube channel info
async function getYouTubeChannelInfo(url: string): Promise<{ id: string; name: string } | null> {
  if (!YOUTUBE_API_KEY) return null

  // Extract identifier from URL
  const patterns = [
    /youtube\.com\/@([^\/\?]+)/,
    /youtube\.com\/channel\/([^\/\?]+)/,
    /youtube\.com\/c\/([^\/\?]+)/,
    /youtube\.com\/user\/([^\/\?]+)/
  ]

  let identifier = null
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) {
      identifier = match[1]
      break
    }
  }

  if (!identifier) return null

  // If it's already a channel ID
  if (identifier.startsWith("UC")) {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${identifier}&key=${YOUTUBE_API_KEY}`)
    const data = await res.json()
    if (data.items?.[0]) {
      return { id: data.items[0].id, name: data.items[0].snippet.title }
    }
  }

  // Try handle endpoint
  const handleRes = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet&forHandle=${identifier}&key=${YOUTUBE_API_KEY}`)
  const handleData = await handleRes.json()
  if (handleData.items?.[0]) {
    return { id: handleData.items[0].id, name: handleData.items[0].snippet.title }
  }

  // Try search
  const searchRes = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(identifier)}&key=${YOUTUBE_API_KEY}`)
  const searchData = await searchRes.json()
  if (searchData.items?.[0]) {
    return {
      id: searchData.items[0].snippet.channelId,
      name: searchData.items[0].snippet.title
    }
  }

  return null
}

// Helper: Fetch video pool from YouTube
async function fetchVideoPool(channelId: string, minDuration: number, maxDuration: number): Promise<any[]> {
  if (!YOUTUBE_API_KEY) return []

  // Get uploads playlist ID
  const channelRes = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${YOUTUBE_API_KEY}`)
  const channelData = await channelRes.json()
  const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads

  if (!uploadsPlaylistId) return []

  // Fetch videos from playlist (up to 1500 to ensure we get 1000 after filtering)
  const videos: { videoId: string; title: string }[] = []
  let pageToken = ""

  while (videos.length < 1500) {
    const playlistUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=50&pageToken=${pageToken}&key=${YOUTUBE_API_KEY}`
    const res = await fetch(playlistUrl)
    const data = await res.json()

    if (!data.items) break

    for (const item of data.items) {
      videos.push({
        videoId: item.snippet.resourceId.videoId,
        title: item.snippet.title
      })
    }

    pageToken = data.nextPageToken || ""
    if (!pageToken) break
  }

  // Get video details
  const detailedVideos: any[] = []

  for (let i = 0; i < videos.length; i += 50) {
    const batch = videos.slice(i, i + 50)
    const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics,snippet&id=${batch.map(v => v.videoId).join(",")}&key=${YOUTUBE_API_KEY}`
    const res = await fetch(url)
    const data = await res.json()

    if (data.items) {
      for (const item of data.items) {
        const duration = parseDuration(item.contentDetails.duration)
        if (duration >= minDuration && duration <= maxDuration) {
          detailedVideos.push({
            videoId: item.id,
            title: item.snippet.title,
            duration,
            viewCount: parseInt(item.statistics.viewCount || "0"),
            publishedAt: item.snippet.publishedAt
          })
        }
      }
    }
  }

  // Sort by view count and take top 1000
  detailedVideos.sort((a, b) => b.viewCount - a.viewCount)
  return detailedVideos.slice(0, 1000)
}

function parseDuration(iso8601: string): number {
  const match = iso8601.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return 0

  const hours = parseInt(match[1] || "0")
  const minutes = parseInt(match[2] || "0")
  const seconds = parseInt(match[3] || "0")

  return hours * 3600 + minutes * 60 + seconds
}
