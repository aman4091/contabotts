import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { getTargetChannels, saveTargetChannels, TargetChannel } from "@/lib/file-storage"

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

export async function GET() {
  try {
    const username = await getUser()
    const channels = getTargetChannels(username)
    return NextResponse.json({ channels })
  } catch (error) {
    console.error("Error getting target channels:", error)
    return NextResponse.json({ error: "Failed to get target channels" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const username = await getUser()
    const body = await request.json()
    const channels = getTargetChannels(username)

    // Check if channel code already exists
    const existing = channels.find(c => c.channel_code === body.channel_code)
    if (existing) {
      return NextResponse.json({ error: "Channel code already exists" }, { status: 400 })
    }

    const newChannel: TargetChannel = {
      channel_code: body.channel_code,
      channel_name: body.channel_name,
      reference_audio: body.reference_audio,
      image_folder: body.image_folder || undefined,
      is_active: body.is_active !== false
    }

    channels.push(newChannel)
    saveTargetChannels(channels, username)

    return NextResponse.json({ success: true, channel: newChannel })
  } catch (error) {
    console.error("Error creating target channel:", error)
    return NextResponse.json({ error: "Failed to create target channel" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const username = await getUser()
    const body = await request.json()
    const channels = getTargetChannels(username)

    const index = channels.findIndex(c => c.channel_code === body.channel_code)
    if (index === -1) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 })
    }

    channels[index] = { ...channels[index], ...body }
    saveTargetChannels(channels, username)

    return NextResponse.json({ success: true, channel: channels[index] })
  } catch (error) {
    console.error("Error updating target channel:", error)
    return NextResponse.json({ error: "Failed to update target channel" }, { status: 500 })
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

    const channels = getTargetChannels(username)
    const filtered = channels.filter(c => c.channel_code !== code)

    if (filtered.length === channels.length) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 })
    }

    saveTargetChannels(filtered, username)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting target channel:", error)
    return NextResponse.json({ error: "Failed to delete target channel" }, { status: 500 })
  }
}
