import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { getSettings, saveSettings } from "@/lib/file-storage"

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

export async function GET() {
  try {
    const username = await getUser()
    const settings = getSettings(username)
    return NextResponse.json(settings)
  } catch (error) {
    console.error("Error getting settings:", error)
    return NextResponse.json({ error: "Failed to get settings" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const username = await getUser()
    const body = await request.json()
    const currentSettings = getSettings(username)

    // Merge settings
    const newSettings = {
      ...currentSettings,
      ...body,
      prompts: { ...currentSettings.prompts, ...body.prompts },
      ai: { ...currentSettings.ai, ...body.ai },
      audio: { ...currentSettings.audio, ...body.audio },
      video: { ...currentSettings.video, ...body.video }
    }

    saveSettings(newSettings, username)
    return NextResponse.json({ success: true, settings: newSettings })
  } catch (error) {
    console.error("Error updating settings:", error)
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 })
  }
}
