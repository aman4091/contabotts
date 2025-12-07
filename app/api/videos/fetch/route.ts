import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import fs from "fs"
import path from "path"

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY
const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value || "default"
}

function getUserVideosDir(username: string) {
  const dir = path.join(DATA_DIR, "users", username, "videos")
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

export async function POST(request: NextRequest) {
  try {
    const username = await getUser()
    const videosDir = getUserVideosDir(username)

    const body = await request.json()
    const { channelUrl, channelCode, minDuration = 1800, maxResults = 1000 } = body

    if (!YOUTUBE_API_KEY) {
      return NextResponse.json({ error: "YouTube API key not configured" }, { status: 500 })
    }

    if (!channelUrl) {
      return NextResponse.json({ error: "Channel URL required" }, { status: 400 })
    }

    if (!channelCode) {
      return NextResponse.json({ error: "Channel code required" }, { status: 400 })
    }

    // Extract channel ID from URL
    const channelId = await getChannelId(channelUrl)
    if (!channelId) {
      return NextResponse.json({ error: "Could not find channel ID" }, { status: 400 })
    }

    // Get channel info for name
    const channelInfo = await getChannelInfo(channelId)

    // Get uploads playlist ID
    const uploadsPlaylistId = await getUploadsPlaylistId(channelId)
    if (!uploadsPlaylistId) {
      return NextResponse.json({ error: "Could not find uploads playlist" }, { status: 400 })
    }

    // Fetch videos (get more than needed to account for filtering)
    const fetchCount = Math.min(maxResults * 3, 3000)
    const videos = await fetchPlaylistVideos(uploadsPlaylistId, fetchCount)

    // Get video details (duration, views)
    const detailedVideos = await getVideoDetails(videos.map(v => v.videoId))

    // Filter by duration (30+ minutes)
    const filteredVideos = detailedVideos.filter(v => {
      const duration = parseDuration(v.duration)
      return duration >= minDuration
    })

    // Sort by views (descending)
    filteredVideos.sort((a, b) => b.viewCount - a.viewCount)

    // Take top N
    const topVideos = filteredVideos.slice(0, maxResults)

    // Create channel-specific directory for this user
    const channelDir = path.join(videosDir, channelCode)
    if (!fs.existsSync(channelDir)) {
      fs.mkdirSync(channelDir, { recursive: true })
    }

    // Save to channel-specific metadata.json
    const metadata = {
      channelUrl,
      channelId,
      channelCode,
      channelName: channelInfo?.title || "Unknown",
      channelLogo: channelInfo?.logo || "",
      fetchedAt: new Date().toISOString(),
      totalVideos: topVideos.length,
      videos: topVideos.map(v => ({
        videoId: v.videoId,
        title: v.title,
        thumbnail: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
        duration: parseDuration(v.duration),
        viewCount: v.viewCount,
        publishedAt: v.publishedAt
      }))
    }

    const metadataPath = path.join(channelDir, "metadata.json")
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2))

    // Initialize processed.json if it doesn't exist
    const processedPath = path.join(channelDir, "processed.json")
    if (!fs.existsSync(processedPath)) {
      fs.writeFileSync(processedPath, JSON.stringify({ skipped: [], completed: [] }, null, 2))
    }

    return NextResponse.json({
      success: true,
      channelId,
      channelName: channelInfo?.title,
      totalFetched: topVideos.length,
      message: `Fetched ${topVideos.length} videos (30+ minutes, sorted by views)`
    })
  } catch (error) {
    console.error("Error fetching videos:", error)
    return NextResponse.json({ error: "Failed to fetch videos" }, { status: 500 })
  }
}

// GET - Return current fetch status for a channel
export async function GET(request: NextRequest) {
  try {
    const username = await getUser()
    const videosDir = getUserVideosDir(username)

    const { searchParams } = new URL(request.url)
    const channelCode = searchParams.get("channel")

    // If no channel specified, return all channels status
    if (!channelCode) {
      const channels: any[] = []
      if (fs.existsSync(videosDir)) {
        // Check channel subdirectories
        const dirs = fs.readdirSync(videosDir, { withFileTypes: true })
        for (const dir of dirs) {
          if (dir.isDirectory()) {
            const metadataPath = path.join(videosDir, dir.name, "metadata.json")
            if (fs.existsSync(metadataPath)) {
              try {
                const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"))
                channels.push({
                  channelCode: dir.name,
                  channelName: metadata.channelName,
                  channelUrl: metadata.channelUrl,
                  channelLogo: metadata.channelLogo || "",
                  channelId: metadata.channelId,
                  fetchedAt: metadata.fetchedAt,
                  totalVideos: metadata.totalVideos
                })
              } catch {}
            }
          }
        }
      }
      return NextResponse.json({ channels })
    }

    const metadataPath = path.join(videosDir, channelCode, "metadata.json")

    if (!fs.existsSync(metadataPath)) {
      return NextResponse.json({
        hasFetched: false,
        totalVideos: 0
      })
    }

    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"))

    return NextResponse.json({
      hasFetched: true,
      channelCode: metadata.channelCode,
      channelUrl: metadata.channelUrl,
      channelName: metadata.channelName,
      fetchedAt: metadata.fetchedAt,
      totalVideos: metadata.totalVideos
    })
  } catch (error) {
    console.error("Error getting fetch status:", error)
    return NextResponse.json({ error: "Failed to get status" }, { status: 500 })
  }
}

// DELETE - Delete a channel and its data
export async function DELETE(request: NextRequest) {
  try {
    const username = await getUser()
    const videosDir = getUserVideosDir(username)

    const { searchParams } = new URL(request.url)
    const channelCode = searchParams.get("channel")

    if (!channelCode) {
      return NextResponse.json({ error: "Channel code required" }, { status: 400 })
    }

    const channelDir = path.join(videosDir, channelCode)

    if (!fs.existsSync(channelDir)) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 })
    }

    // Delete the channel directory recursively
    fs.rmSync(channelDir, { recursive: true, force: true })

    return NextResponse.json({
      success: true,
      message: `Channel ${channelCode} deleted`
    })
  } catch (error) {
    console.error("Error deleting channel:", error)
    return NextResponse.json({ error: "Failed to delete channel" }, { status: 500 })
  }
}

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

      // If it's already a channel ID (starts with UC)
      if (identifier.startsWith("UC")) {
        return identifier
      }

      // Try forHandle endpoint first (for @handles)
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

async function getChannelInfo(channelId: string): Promise<{ title: string; logo: string } | null> {
  const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${channelId}&key=${YOUTUBE_API_KEY}`
  const res = await fetch(url)
  const data = await res.json()

  if (data.items?.[0]?.snippet) {
    return {
      title: data.items[0].snippet.title,
      logo: data.items[0].snippet.thumbnails?.default?.url || data.items[0].snippet.thumbnails?.medium?.url || ""
    }
  }
  return null
}

async function getUploadsPlaylistId(channelId: string): Promise<string | null> {
  const url = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${YOUTUBE_API_KEY}`
  const res = await fetch(url)
  const data = await res.json()

  return data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads || null
}

async function fetchPlaylistVideos(playlistId: string, maxResults: number): Promise<{ videoId: string; title: string }[]> {
  const videos: { videoId: string; title: string }[] = []
  let pageToken = ""

  while (videos.length < maxResults) {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=50&pageToken=${pageToken}&key=${YOUTUBE_API_KEY}`
    const res = await fetch(url)
    const data = await res.json()

    if (!data.items) break

    for (const item of data.items) {
      if (videos.length >= maxResults) break
      videos.push({
        videoId: item.snippet.resourceId.videoId,
        title: item.snippet.title
      })
    }

    pageToken = data.nextPageToken || ""
    if (!pageToken) break
  }

  return videos
}

async function getVideoDetails(videoIds: string[]): Promise<any[]> {
  const details: any[] = []

  // Process in batches of 50
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50)
    const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics,snippet&id=${batch.join(",")}&key=${YOUTUBE_API_KEY}`
    const res = await fetch(url)
    const data = await res.json()

    if (data.items) {
      for (const item of data.items) {
        details.push({
          videoId: item.id,
          title: item.snippet?.title || "",
          duration: item.contentDetails?.duration,
          viewCount: parseInt(item.statistics?.viewCount || "0"),
          publishedAt: item.snippet?.publishedAt
        })
      }
    }
  }

  return details
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
