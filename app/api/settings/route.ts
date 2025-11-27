import { NextRequest, NextResponse } from "next/server"
import { getSettings, saveSettings } from "@/lib/file-storage"

export async function GET() {
  try {
    const settings = getSettings()
    return NextResponse.json(settings)
  } catch (error) {
    console.error("Error getting settings:", error)
    return NextResponse.json({ error: "Failed to get settings" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const currentSettings = getSettings()

    // Merge settings
    const newSettings = {
      ...currentSettings,
      ...body,
      prompts: { ...currentSettings.prompts, ...body.prompts },
      ai: { ...currentSettings.ai, ...body.ai },
      audio: { ...currentSettings.audio, ...body.audio },
      video: { ...currentSettings.video, ...body.video }
    }

    saveSettings(newSettings)
    return NextResponse.json({ success: true, settings: newSettings })
  } catch (error) {
    console.error("Error updating settings:", error)
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 })
  }
}
