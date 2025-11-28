import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import fs from "fs"
import path from "path"

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY
const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

// Get fetched videoIds for a channel
function getFetchedVideoIds(channelCode: string, username?: string): Set<string> {
  const userDir = username ? path.join(DATA_DIR, "users", username) : DATA_DIR
  const filePath = path.join(userDir, "fetched-videos", `${channelCode}.json`)

  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"))
      return new Set(data.videoIds || [])
    } catch {
      return new Set()
    }
  }
  return new Set()
}

// Save fetched videoIds for a channel
function saveFetchedVideoIds(channelCode: string, videoIds: string[], username?: string): void {
  const userDir = username ? path.join(DATA_DIR, "users", username) : DATA_DIR
  const dirPath = path.join(userDir, "fetched-videos")
  const filePath = path.join(dirPath, `${channelCode}.json`)

  // Create directory if not exists
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }

  // Get existing and merge
  const existing = getFetchedVideoIds(channelCode, username)
  videoIds.forEach(id => existing.add(id))

  fs.writeFileSync(filePath, JSON.stringify({
    videoIds: Array.from(existing),
    lastUpdated: new Date().toISOString()
  }, null, 2))
}

export async function POST(request: NextRequest) {
  try {
    const username = await getUser()
    const body = await request.json()
    const { channelUrl, channelCode, maxResults = 1000, minDuration = 600, maxDuration = 7200 } = body

    if (!YOUTUBE_API_KEY) {
      return NextResponse.json({ error: "YouTube API key not configured" }, { status: 500 })
    }

    if (!channelUrl) {
      return NextResponse.json({ error: "Channel URL required" }, { status: 400 })
    }

    // Extract channel ID from URL
    const channelId = await getChannelId(channelUrl)
    if (!channelId) {
      return NextResponse.json({ error: "Could not find channel ID" }, { status: 400 })
    }

    // Get uploads playlist ID
    const uploadsPlaylistId = await getUploadsPlaylistId(channelId)
    if (!uploadsPlaylistId) {
      return NextResponse.json({ error: "Could not find uploads playlist" }, { status: 400 })
    }

    // Get already fetched videoIds (to exclude)
    const alreadyFetched = channelCode ? getFetchedVideoIds(channelCode, username) : new Set<string>()
    console.log(`Already fetched ${alreadyFetched.size} videos for ${channelCode}`)

    // Fetch more videos to account for filtering
    const fetchCount = maxResults + alreadyFetched.size + 500 // Fetch extra to have enough after filtering
    const videos = await fetchPlaylistVideos(uploadsPlaylistId, fetchCount)

    // Get video details (duration, views) and filter
    const detailedVideos = await getVideoDetails(videos.map(v => v.videoId))

    // Filter by duration AND exclude already fetched
    const filteredVideos = detailedVideos.filter(v => {
      const duration = parseDuration(v.duration)
      const isValidDuration = duration >= minDuration && duration <= maxDuration
      const isNew = !alreadyFetched.has(v.videoId)
      return isValidDuration && isNew
    })

    // Sort by views
    filteredVideos.sort((a, b) => b.viewCount - a.viewCount)

    // Take top N
    const topVideos = filteredVideos.slice(0, maxResults)

    // Save newly fetched videoIds
    if (channelCode && topVideos.length > 0) {
      saveFetchedVideoIds(channelCode, topVideos.map(v => v.videoId), username)
    }

    return NextResponse.json({
      success: true,
      channelId,
      total: topVideos.length,
      alreadyFetched: alreadyFetched.size,
      videos: topVideos
    })
  } catch (error) {
    console.error("Error fetching YouTube videos:", error)
    return NextResponse.json({ error: "Failed to fetch videos" }, { status: 500 })
  }
}

async function getChannelId(url: string): Promise<string | null> {
  // Handle different URL formats
  // @username, /channel/ID, /c/name, /user/name

  const patterns = [
    /youtube\.com\/@([^\/\?]+)/,           // @username
    /youtube\.com\/channel\/([^\/\?]+)/,   // /channel/ID
    /youtube\.com\/c\/([^\/\?]+)/,         // /c/name
    /youtube\.com\/user\/([^\/\?]+)/       // /user/name
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) {
      const identifier = match[1]

      // If it's already a channel ID (starts with UC)
      if (identifier.startsWith("UC")) {
        return identifier
      }

      // Otherwise, search for the channel
      const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(identifier)}&key=${YOUTUBE_API_KEY}`
      const res = await fetch(searchUrl)
      const data = await res.json()

      if (data.items?.[0]?.snippet?.channelId) {
        return data.items[0].snippet.channelId
      }

      // Try channels endpoint for handle
      const channelsUrl = `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${identifier}&key=${YOUTUBE_API_KEY}`
      const channelsRes = await fetch(channelsUrl)
      const channelsData = await channelsRes.json()

      if (channelsData.items?.[0]?.id) {
        return channelsData.items[0].id
      }
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
          title: item.snippet.title,
          duration: item.contentDetails.duration,
          viewCount: parseInt(item.statistics.viewCount || "0"),
          publishedAt: item.snippet.publishedAt
        })
      }
    }
  }

  return details
}

function parseDuration(iso8601: string): number {
  // Parse ISO 8601 duration (PT1H2M3S)
  const match = iso8601.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return 0

  const hours = parseInt(match[1] || "0")
  const minutes = parseInt(match[2] || "0")
  const seconds = parseInt(match[3] || "0")

  return hours * 3600 + minutes * 60 + seconds
}
