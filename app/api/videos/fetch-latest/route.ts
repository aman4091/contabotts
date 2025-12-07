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
  return path.join(DATA_DIR, "users", username, "videos")
}

// POST - Fetch latest 10 videos for a channel and add new ones
export async function POST(request: NextRequest) {
  try {
    const username = await getUser()
    const videosDir = getUserVideosDir(username)

    const body = await request.json()
    const { channelCode } = body

    if (!channelCode) {
      return NextResponse.json({ error: "Channel code required" }, { status: 400 })
    }

    if (!YOUTUBE_API_KEY) {
      return NextResponse.json({ error: "YouTube API key not configured" }, { status: 500 })
    }

    // Read existing metadata
    const metadataPath = path.join(videosDir, channelCode, "metadata.json")
    if (!fs.existsSync(metadataPath)) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 })
    }

    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"))
    const existingVideoIds = new Set(metadata.videos.map((v: any) => v.videoId))

    // Get uploads playlist ID
    const uploadsPlaylistId = await getUploadsPlaylistId(metadata.channelId)
    if (!uploadsPlaylistId) {
      return NextResponse.json({ error: "Could not find uploads playlist" }, { status: 400 })
    }

    // Fetch latest 10 videos
    const latestVideos = await fetchLatestPlaylistVideos(uploadsPlaylistId, 10)

    // Get video details
    const detailedVideos = await getVideoDetails(latestVideos.map(v => v.videoId))

    // Filter: only videos not already in list and duration >= 30 mins
    const newVideos = detailedVideos.filter(v => {
      const duration = parseDuration(v.duration)
      return !existingVideoIds.has(v.videoId) && duration >= 1800
    })

    if (newVideos.length === 0) {
      return NextResponse.json({
        success: true,
        addedCount: 0,
        message: "No new videos to add"
      })
    }

    // Add new videos to the beginning of the list
    const formattedNewVideos = newVideos.map(v => ({
      videoId: v.videoId,
      title: v.title,
      thumbnail: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
      duration: parseDuration(v.duration),
      viewCount: v.viewCount,
      publishedAt: v.publishedAt
    }))

    metadata.videos = [...formattedNewVideos, ...metadata.videos]
    metadata.totalVideos = metadata.videos.length
    metadata.fetchedAt = new Date().toISOString()

    // Save updated metadata
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2))

    return NextResponse.json({
      success: true,
      addedCount: newVideos.length,
      newVideos: formattedNewVideos,
      message: `Added ${newVideos.length} new video(s)`
    })
  } catch (error) {
    console.error("Error fetching latest videos:", error)
    return NextResponse.json({ error: "Failed to fetch latest videos" }, { status: 500 })
  }
}

async function getUploadsPlaylistId(channelId: string): Promise<string | null> {
  const url = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${YOUTUBE_API_KEY}`
  const res = await fetch(url)
  const data = await res.json()
  return data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads || null
}

async function fetchLatestPlaylistVideos(playlistId: string, count: number): Promise<{ videoId: string; title: string }[]> {
  const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=${count}&key=${YOUTUBE_API_KEY}`
  const res = await fetch(url)
  const data = await res.json()

  if (!data.items) return []

  return data.items.map((item: any) => ({
    videoId: item.snippet.resourceId.videoId,
    title: item.snippet.title
  }))
}

async function getVideoDetails(videoIds: string[]): Promise<any[]> {
  if (videoIds.length === 0) return []

  const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics,snippet&id=${videoIds.join(",")}&key=${YOUTUBE_API_KEY}`
  const res = await fetch(url)
  const data = await res.json()

  if (!data.items) return []

  return data.items.map((item: any) => ({
    videoId: item.id,
    title: item.snippet?.title || "",
    duration: item.contentDetails?.duration,
    viewCount: parseInt(item.statistics?.viewCount || "0"),
    publishedAt: item.snippet?.publishedAt
  }))
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
