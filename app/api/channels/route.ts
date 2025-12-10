import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { randomUUID } from "crypto"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY

interface DelayedVideo {
  id: string
  videoId: string
  title: string
  channelId: string
  channelName: string
  thumbnail: string
  scheduledFor: string
  createdAt: string
  status: "waiting" | "processing" | "completed" | "failed"
}

interface Channel {
  id: string
  name: string
  url: string
  channelId: string
  totalVideos: number
  addedAt: string
  prompt?: string  // Channel-specific prompt for transcript processing
  liveMonitoring?: boolean  // Enable live monitoring for this channel
  lastChecked?: string  // Last time new videos were checked
}

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

function getChannelsPath(username: string): string {
  return path.join(DATA_DIR, "users", username, "channel-automation", "channels.json")
}

function getChannels(username: string): Channel[] {
  const filePath = getChannelsPath(username)
  if (!fs.existsSync(filePath)) return []
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"))
  } catch {
    return []
  }
}

function saveChannels(username: string, channels: Channel[]) {
  const filePath = getChannelsPath(username)
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(filePath, JSON.stringify(channels, null, 2))
}

// GET - List channels
export async function GET() {
  try {
    const username = await getUser()
    if (!username) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const channels = getChannels(username)
    return NextResponse.json({ channels })
  } catch (error) {
    console.error("Error getting channels:", error)
    return NextResponse.json({ error: "Failed to get channels" }, { status: 500 })
  }
}

// POST - Add new channel and fetch videos
export async function POST(request: NextRequest) {
  try {
    const username = await getUser()
    if (!username) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    if (!YOUTUBE_API_KEY) {
      return NextResponse.json({ error: "YouTube API key not configured" }, { status: 500 })
    }

    const body = await request.json()
    const { channelUrl } = body

    if (!channelUrl) {
      return NextResponse.json({ error: "Channel URL required" }, { status: 400 })
    }

    // Get channel ID from URL
    const channelId = await getChannelId(channelUrl)
    if (!channelId) {
      return NextResponse.json({ error: "Could not find channel" }, { status: 400 })
    }

    // Get channel name
    const channelInfo = await getChannelInfo(channelId)
    if (!channelInfo) {
      return NextResponse.json({ error: "Could not get channel info" }, { status: 400 })
    }

    // Check if channel already exists
    const channels = getChannels(username)
    if (channels.find(c => c.channelId === channelId)) {
      return NextResponse.json({ error: "Channel already added" }, { status: 400 })
    }

    // Fetch last 10 days videos only
    const uploadsPlaylistId = await getUploadsPlaylistId(channelId)
    if (!uploadsPlaylistId) {
      return NextResponse.json({ error: "Could not find uploads playlist" }, { status: 400 })
    }

    console.log(`Fetching last 10 days videos for channel ${channelInfo.name}...`)
    const videos = await fetchRecentVideos(uploadsPlaylistId, 10)
    console.log(`Fetched ${videos.length} videos from last 10 days`)

    // Save videos to channel folder
    const channelDir = path.join(DATA_DIR, "users", username, "channel-automation", channelId)
    if (!fs.existsSync(channelDir)) {
      fs.mkdirSync(channelDir, { recursive: true })
    }

    fs.writeFileSync(
      path.join(channelDir, "videos.json"),
      JSON.stringify({
        channelId,
        channelName: channelInfo.name,
        fetchedAt: new Date().toISOString(),
        videos
      }, null, 2)
    )

    // Initialize processed tracker
    fs.writeFileSync(
      path.join(channelDir, "processed.json"),
      JSON.stringify({ processed: [] }, null, 2)
    )

    // Add all fetched videos to delayed queue
    // Each video will be scheduled for: publishedAt + 7 days
    const delayedPath = path.join(DATA_DIR, "users", username, "channel-automation", "delayed-videos.json")
    let delayedVideos: DelayedVideo[] = []
    if (fs.existsSync(delayedPath)) {
      try {
        delayedVideos = JSON.parse(fs.readFileSync(delayedPath, "utf-8"))
      } catch {}
    }

    let addedToDelayed = 0
    for (const video of videos) {
      // Skip if already in delayed queue
      if (delayedVideos.find(d => d.videoId === video.videoId)) continue

      // Calculate scheduled date: video publish date + 7 days
      const publishDate = new Date(video.publishedAt)
      const scheduledDate = new Date(publishDate)
      scheduledDate.setDate(scheduledDate.getDate() + 7)

      delayedVideos.push({
        id: randomUUID(),
        videoId: video.videoId,
        title: video.title,
        channelId,
        channelName: channelInfo.name,
        thumbnail: video.thumbnail,
        scheduledFor: scheduledDate.toISOString(),
        createdAt: new Date().toISOString(),
        status: "waiting"
      })
      addedToDelayed++
    }

    // Save delayed videos
    const delayedDir = path.dirname(delayedPath)
    if (!fs.existsSync(delayedDir)) {
      fs.mkdirSync(delayedDir, { recursive: true })
    }
    fs.writeFileSync(delayedPath, JSON.stringify(delayedVideos, null, 2))
    console.log(`Added ${addedToDelayed} videos to delayed queue`)

    // Add channel to list
    const newChannel: Channel = {
      id: channelId,
      name: channelInfo.name,
      url: channelUrl,
      channelId,
      totalVideos: videos.length,
      addedAt: new Date().toISOString()
    }
    channels.push(newChannel)
    saveChannels(username, channels)

    return NextResponse.json({
      success: true,
      channel: newChannel,
      videosFetched: videos.length
    })
  } catch (error) {
    console.error("Error adding channel:", error)
    return NextResponse.json({ error: "Failed to add channel" }, { status: 500 })
  }
}

// PATCH - Update channel (prompt)
export async function PATCH(request: NextRequest) {
  try {
    const username = await getUser()
    if (!username) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const body = await request.json()
    const { channelId, prompt } = body

    if (!channelId) {
      return NextResponse.json({ error: "Channel ID required" }, { status: 400 })
    }

    const channels = getChannels(username)
    const channelIndex = channels.findIndex(c => c.channelId === channelId)

    if (channelIndex === -1) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 })
    }

    // Update prompt if provided
    if (prompt !== undefined) {
      channels[channelIndex].prompt = prompt || ""
    }

    // Update liveMonitoring if provided
    if (body.liveMonitoring !== undefined) {
      channels[channelIndex].liveMonitoring = body.liveMonitoring
    }

    saveChannels(username, channels)

    return NextResponse.json({ success: true, channel: channels[channelIndex] })
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
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const channelId = searchParams.get("id")

    if (!channelId) {
      return NextResponse.json({ error: "Channel ID required" }, { status: 400 })
    }

    // Remove from list
    let channels = getChannels(username)
    channels = channels.filter(c => c.channelId !== channelId)
    saveChannels(username, channels)

    // Delete channel data folder
    const channelDir = path.join(DATA_DIR, "users", username, "channel-automation", channelId)
    if (fs.existsSync(channelDir)) {
      fs.rmSync(channelDir, { recursive: true })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting channel:", error)
    return NextResponse.json({ error: "Failed to delete channel" }, { status: 500 })
  }
}

// Helper functions
async function getChannelId(url: string): Promise<string | null> {
  const patterns = [
    /youtube\.com\/@([^\/\?]+)/,
    /youtube\.com\/channel\/([^\/\?]+)/,
    /youtube\.com\/c\/([^\/\?]+)/,
    /youtube\.com\/user\/([^\/\?]+)/
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) {
      const identifier = match[1]

      if (identifier.startsWith("UC")) {
        return identifier
      }

      // Try forHandle endpoint first
      const channelsUrl = `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${identifier}&key=${YOUTUBE_API_KEY}`
      const channelsRes = await fetch(channelsUrl)
      const channelsData = await channelsRes.json()

      if (channelsData.items?.[0]?.id) {
        return channelsData.items[0].id
      }

      // Fallback to search
      const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(identifier)}&key=${YOUTUBE_API_KEY}`
      const res = await fetch(searchUrl)
      const data = await res.json()

      if (data.items?.[0]?.snippet?.channelId) {
        return data.items[0].snippet.channelId
      }
    }
  }

  return null
}

async function getChannelInfo(channelId: string): Promise<{ name: string } | null> {
  const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${channelId}&key=${YOUTUBE_API_KEY}`
  const res = await fetch(url)
  const data = await res.json()

  if (data.items?.[0]?.snippet?.title) {
    return { name: data.items[0].snippet.title }
  }
  return null
}

async function getUploadsPlaylistId(channelId: string): Promise<string | null> {
  const url = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${YOUTUBE_API_KEY}`
  const res = await fetch(url)
  const data = await res.json()

  return data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads || null
}

// Fetch only videos from last N days
async function fetchRecentVideos(playlistId: string, days: number): Promise<any[]> {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - days)

  const allVideos: { videoId: string; title: string; publishedAt: string }[] = []
  let pageToken = ""

  // Fetch videos until we hit videos older than cutoff date
  while (true) {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=50&pageToken=${pageToken}&key=${YOUTUBE_API_KEY}`
    const res = await fetch(url)
    const data = await res.json()

    if (!data.items || data.items.length === 0) break

    let foundOldVideo = false
    for (const item of data.items) {
      const publishedAt = new Date(item.snippet.publishedAt)

      // Stop if video is older than cutoff
      if (publishedAt < cutoffDate) {
        foundOldVideo = true
        break
      }

      allVideos.push({
        videoId: item.snippet.resourceId.videoId,
        title: item.snippet.title,
        publishedAt: item.snippet.publishedAt
      })
    }

    // Stop fetching if we found old videos or no more pages
    if (foundOldVideo) break
    pageToken = data.nextPageToken || ""
    if (!pageToken) break
  }

  if (allVideos.length === 0) return []

  // Get video details (duration, views)
  const detailedVideos: any[] = []
  for (let i = 0; i < allVideos.length; i += 50) {
    const batch = allVideos.slice(i, i + 50)
    const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics,snippet&id=${batch.map(v => v.videoId).join(",")}&key=${YOUTUBE_API_KEY}`
    const res = await fetch(url)
    const data = await res.json()

    if (data.items) {
      for (const item of data.items) {
        detailedVideos.push({
          videoId: item.id,
          title: item.snippet?.title || "",
          thumbnail: item.snippet?.thumbnails?.high?.url || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
          duration: parseDuration(item.contentDetails?.duration),
          viewCount: parseInt(item.statistics?.viewCount || "0"),
          publishedAt: item.snippet?.publishedAt
        })
      }
    }
  }

  // Sort by publish date (newest first)
  detailedVideos.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())

  return detailedVideos
}

function parseDuration(iso8601: string | undefined): number {
  if (!iso8601) return 0
  const match = iso8601.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return 0

  const hours = parseInt(match[1] || "0")
  const minutes = parseInt(match[2] || "0")
  const seconds = parseInt(match[3] || "0")

  return hours * 3600 + minutes * 60 + seconds
}
