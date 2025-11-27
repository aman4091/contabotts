import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { getSourceChannels, saveSourceChannels, SourceChannel } from "@/lib/file-storage"

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

export async function GET() {
  try {
    const username = await getUser()
    const channels = getSourceChannels(username)
    return NextResponse.json({ channels })
  } catch (error) {
    console.error("Error getting source channels:", error)
    return NextResponse.json({ error: "Failed to get source channels" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const username = await getUser()
    const body = await request.json()
    const channels = getSourceChannels(username)

    // Check if channel code already exists
    const existing = channels.find(c => c.channel_code === body.channel_code)
    if (existing) {
      return NextResponse.json({ error: "Channel code already exists" }, { status: 400 })
    }

    const newChannel: SourceChannel = {
      channel_code: body.channel_code,
      channel_name: body.channel_name,
      youtube_channel_url: body.youtube_channel_url,
      min_duration_seconds: body.min_duration_seconds || 600,
      max_duration_seconds: body.max_duration_seconds || 7200,
      max_videos: body.max_videos || 1000,
      is_active: body.is_active !== false
    }

    channels.push(newChannel)
    saveSourceChannels(channels, username)

    return NextResponse.json({ success: true, channel: newChannel })
  } catch (error) {
    console.error("Error creating source channel:", error)
    return NextResponse.json({ error: "Failed to create source channel" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const username = await getUser()
    const body = await request.json()
    const channels = getSourceChannels(username)

    const index = channels.findIndex(c => c.channel_code === body.channel_code)
    if (index === -1) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 })
    }

    channels[index] = { ...channels[index], ...body }
    saveSourceChannels(channels, username)

    return NextResponse.json({ success: true, channel: channels[index] })
  } catch (error) {
    console.error("Error updating source channel:", error)
    return NextResponse.json({ error: "Failed to update source channel" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const username = await getUser()
    const { searchParams } = new URL(request.url)
    const code = searchParams.get("code")

    if (!code) {
      return NextResponse.json({ error: "Channel code required" }, { status: 400 })
    }

    const channels = getSourceChannels(username)
    const filtered = channels.filter(c => c.channel_code !== code)

    if (filtered.length === channels.length) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 })
    }

    saveSourceChannels(filtered, username)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting source channel:", error)
    return NextResponse.json({ error: "Failed to delete source channel" }, { status: 500 })
  }
}
