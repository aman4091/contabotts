import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

const SETTINGS_FILE = path.join(process.cwd(), "data", "finalbot-settings.json")

// Ensure directory exists
function ensureDir() {
  const dir = path.dirname(SETTINGS_FILE)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function loadSettings() {
  ensureDir()
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"))
    } catch {
      return { botToken: "", chatId: "" }
    }
  }
  return { botToken: "", chatId: "" }
}

function saveSettings(settings: { botToken: string; chatId: string }) {
  ensureDir()
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))
}

export async function GET() {
  try {
    const settings = loadSettings()
    // Don't expose full token for security - just show if it's set
    return NextResponse.json({
      botToken: settings.botToken ? "***configured***" : "",
      chatId: settings.chatId || ""
    })
  } catch (error) {
    console.error("Error loading FinalBot settings:", error)
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { botToken, chatId } = body

    // Load existing settings
    const existing = loadSettings()

    // Only update token if it's not the placeholder
    const newSettings = {
      botToken: botToken === "***configured***" ? existing.botToken : botToken,
      chatId: chatId || ""
    }

    saveSettings(newSettings)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error saving FinalBot settings:", error)
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 })
  }
}
