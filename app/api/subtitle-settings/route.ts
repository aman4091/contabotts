import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

const SETTINGS_FILE = path.join(process.cwd(), "data", "subtitle-settings.json")

// Default subtitle settings - charWidth 0.6 for better text fitting
const defaultSettings = {
  font: {
    family: "Arial",
    size: 48,
    color: "#FFFFFF"
  },
  background: {
    color: "#000000",
    opacity: 80,  // 0-100 percentage
    cornerRadius: 20
  },
  box: {
    hPadding: 25,
    vPadding: 15,
    charWidth: 0.6  // character width multiplier (higher = wider box)
  },
  position: {
    alignment: 5,  // 1-9 numpad style (5 = center)
    marginV: 40,
    marginL: 40,
    marginR: 40
  }
}

// Ensure data directory exists
function ensureDataDir() {
  const dataDir = path.dirname(SETTINGS_FILE)
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
}

// GET - Load settings
export async function GET() {
  try {
    ensureDataDir()

    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, "utf-8")
      const settings = JSON.parse(data)
      return NextResponse.json({ success: true, settings })
    }

    // Return defaults if no file exists
    return NextResponse.json({ success: true, settings: defaultSettings })
  } catch (error) {
    console.error("Error loading subtitle settings:", error)
    return NextResponse.json({ success: true, settings: defaultSettings })
  }
}

// POST - Save settings
export async function POST(request: NextRequest) {
  try {
    ensureDataDir()

    const settings = await request.json()

    // Validate settings structure
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
        charWidth: Number(settings.box?.charWidth) || defaultSettings.box.charWidth
      },
      position: {
        alignment: Number(settings.position?.alignment) || defaultSettings.position.alignment,
        marginV: Number(settings.position?.marginV) || defaultSettings.position.marginV,
        marginL: Number(settings.position?.marginL) || defaultSettings.position.marginL,
        marginR: Number(settings.position?.marginR) || defaultSettings.position.marginR
      }
    }

    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(validatedSettings, null, 2))

    return NextResponse.json({ success: true, settings: validatedSettings })
  } catch (error) {
    console.error("Error saving subtitle settings:", error)
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 })
  }
}
