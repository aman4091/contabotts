import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

interface DelayedVideo {
  id: string
  videoId: string
  title: string
  channelId: string
  channelName: string
  thumbnail: string
  scheduledFor: string // ISO date when it should be processed
  createdAt: string
  status: "waiting" | "processing" | "completed" | "failed"
}

// GET - List delayed videos
export async function GET(request: NextRequest) {
  const username = await getUser()
  if (!username) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const delayedPath = path.join(DATA_DIR, "users", username, "channel-automation", "delayed-videos.json")

  let delayed: DelayedVideo[] = []
  if (fs.existsSync(delayedPath)) {
    try {
      delayed = JSON.parse(fs.readFileSync(delayedPath, "utf-8"))
    } catch {}
  }

  // Sort by scheduledFor (soonest first)
  delayed.sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())

  return NextResponse.json({
    success: true,
    videos: delayed,
    waiting: delayed.filter(v => v.status === "waiting").length,
    total: delayed.length
  })
}

// DELETE - Remove a delayed video
export async function DELETE(request: NextRequest) {
  const username = await getUser()
  if (!username) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const videoId = searchParams.get("videoId")

  if (!videoId) {
    return NextResponse.json({ error: "Video ID required" }, { status: 400 })
  }

  const delayedPath = path.join(DATA_DIR, "users", username, "channel-automation", "delayed-videos.json")

  let delayed: DelayedVideo[] = []
  if (fs.existsSync(delayedPath)) {
    try {
      delayed = JSON.parse(fs.readFileSync(delayedPath, "utf-8"))
    } catch {}
  }

  const before = delayed.length
  delayed = delayed.filter(v => v.videoId !== videoId)

  if (delayed.length === before) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 })
  }

  fs.writeFileSync(delayedPath, JSON.stringify(delayed, null, 2))

  return NextResponse.json({ success: true })
}
