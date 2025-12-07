import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

// Global settings path - same for all users
function getSettingsPath(): string {
  return path.join(DATA_DIR, "subtitle-settings.json")
}

// Default subtitle settings
const defaultSettings = {
  font: {
    family: "Arial",
    size: 48,
    color: "#FFFFFF"
  },
  background: {
    color: "#000000",
    opacity: 80,
    cornerRadius: 20
  },
  box: {
    hPadding: 25,
    vPadding: 15,
    charWidth: 0.6,
    maxChars: 50
  },
  position: {
    alignment: 5,
    marginV: 40,
    marginL: 40,
    marginR: 40
  }
}

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export async function GET() {
  try {
    const settingsPath = getSettingsPath()

    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, "utf-8")
      const settings = JSON.parse(data)
      return NextResponse.json({ success: true, settings })
    }

    return NextResponse.json({ success: true, settings: defaultSettings })
  } catch (error) {
    console.error("Error loading subtitle settings:", error)
    return NextResponse.json({ success: true, settings: defaultSettings })
  }
}

export async function POST(request: NextRequest) {
  try {
    const settingsPath = getSettingsPath()
    ensureDir(settingsPath)

    const settings = await request.json()

    const validatedSettings = {
      font: {
        family: settings.font?.family || defaultSettings.font.family,
        size: Number(settings.font?.size) || defaultSettings.font.size,
        color: settings.font?.color || defaultSettings.font.color
      },
      background: {
        color: settings.background?.color || defaultSettings.background.color,
        opacity: Number(settings.background?.opacity) ?? defaultSettings.background.opacity,
        cornerRadius: Number(settings.background?.cornerRadius) || defaultSettings.background.cornerRadius
      },
      box: {
        hPadding: Number(settings.box?.hPadding) ?? defaultSettings.box.hPadding,
        vPadding: Number(settings.box?.vPadding) ?? defaultSettings.box.vPadding,
        charWidth: Number(settings.box?.charWidth) || defaultSettings.box.charWidth,
        maxChars: Number(settings.box?.maxChars) || defaultSettings.box.maxChars
      },
      position: {
        alignment: Number(settings.position?.alignment) || defaultSettings.position.alignment,
        marginV: Number(settings.position?.marginV) || defaultSettings.position.marginV,
        marginL: Number(settings.position?.marginL) || defaultSettings.position.marginL,
        marginR: Number(settings.position?.marginR) || defaultSettings.position.marginR
      }
    }

    fs.writeFileSync(settingsPath, JSON.stringify(validatedSettings, null, 2))

    return NextResponse.json({ success: true, settings: validatedSettings })
  } catch (error) {
    console.error("Error saving subtitle settings:", error)
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 })
  }
}
