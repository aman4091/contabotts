import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

function getTemplatesPath(username?: string): string {
  if (username) {
    return path.join(DATA_DIR, "users", username, "thumbnail-templates.json")
  }
  return path.join(DATA_DIR, "thumbnail-templates.json")
}

export interface TextBoxConfig {
  x: number
  y: number
  width: number
  height: number
  fontFamily: string
  fontSize: number
  fontColor: string
  textAlign: "left" | "center" | "right"
  padding: { top: number; right: number; bottom: number; left: number }
  shadow: {
    enabled: boolean
    color: string
    offsetX: number
    offsetY: number
    blur: number
  }
  outline: {
    enabled: boolean
    color: string
    width: number
  }
}

export interface ThumbnailTemplate {
  id: string
  channelCode: string
  name: string
  backgroundImageFolder: string
  overlayImage: string
  overlayPosition: { x: number; y: number }
  overlaySize: { width: number; height: number }
  textBox: TextBoxConfig
  createdAt: string
  updatedAt: string
}

function loadTemplates(username?: string): ThumbnailTemplate[] {
  const filePath = getTemplatesPath(username)
  if (!fs.existsSync(filePath)) {
    return []
  }
  try {
    const content = fs.readFileSync(filePath, "utf-8")
    return JSON.parse(content)
  } catch {
    return []
  }
}

function saveTemplates(templates: ThumbnailTemplate[], username?: string): void {
  const filePath = getTemplatesPath(username)
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(filePath, JSON.stringify(templates, null, 2))
}

// GET - List all templates
export async function GET(request: NextRequest) {
  try {
    const username = await getUser()
    const { searchParams } = new URL(request.url)
    const channelCode = searchParams.get("channel")

    const templates = loadTemplates(username)

    if (channelCode) {
      const filtered = templates.filter((t) => t.channelCode === channelCode)
      return NextResponse.json({ templates: filtered })
    }

    return NextResponse.json({ templates })
  } catch (error) {
    console.error("Get templates error:", error)
    return NextResponse.json({ error: "Failed to get templates" }, { status: 500 })
  }
}

// POST - Create new template
export async function POST(request: NextRequest) {
  try {
    const username = await getUser()
    const body = await request.json()

    const {
      channelCode,
      name,
      backgroundImageFolder,
      overlayImage,
      overlayPosition,
      overlaySize,
      textBox
    } = body

    if (!name) {
      return NextResponse.json({ error: "Template name required" }, { status: 400 })
    }

    const templates = loadTemplates(username)

    // Default text box config
    const defaultTextBox: TextBoxConfig = {
      x: 50,
      y: 500,
      width: 1180,
      height: 180,
      fontFamily: "Impact",
      fontSize: 72,
      fontColor: "#FFFFFF",
      textAlign: "center",
      padding: { top: 10, right: 20, bottom: 10, left: 20 },
      shadow: {
        enabled: true,
        color: "#000000",
        offsetX: 3,
        offsetY: 3,
        blur: 6
      },
      outline: {
        enabled: true,
        color: "#000000",
        width: 3
      }
    }

    const newTemplate: ThumbnailTemplate = {
      id: `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      channelCode: channelCode || "",
      name,
      backgroundImageFolder: backgroundImageFolder || "nature",
      overlayImage: overlayImage || "",
      overlayPosition: overlayPosition || { x: 0, y: 0 },
      overlaySize: overlaySize || { width: 400, height: 400 },
      textBox: textBox || defaultTextBox,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    templates.push(newTemplate)
    saveTemplates(templates, username)

    return NextResponse.json({
      success: true,
      template: newTemplate
    })
  } catch (error) {
    console.error("Create template error:", error)
    return NextResponse.json({ error: "Failed to create template" }, { status: 500 })
  }
}

// PUT - Update template
export async function PUT(request: NextRequest) {
  try {
    const username = await getUser()
    const body = await request.json()
    const { id, ...updates } = body

    if (!id) {
      return NextResponse.json({ error: "Template ID required" }, { status: 400 })
    }

    const templates = loadTemplates(username)
    const index = templates.findIndex((t) => t.id === id)

    if (index === -1) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 })
    }

    templates[index] = {
      ...templates[index],
      ...updates,
      updatedAt: new Date().toISOString()
    }

    saveTemplates(templates, username)

    return NextResponse.json({
      success: true,
      template: templates[index]
    })
  } catch (error) {
    console.error("Update template error:", error)
    return NextResponse.json({ error: "Failed to update template" }, { status: 500 })
  }
}

// DELETE - Delete template
export async function DELETE(request: NextRequest) {
  try {
    const username = await getUser()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json({ error: "Template ID required" }, { status: 400 })
    }

    const templates = loadTemplates(username)
    const filtered = templates.filter((t) => t.id !== id)

    if (filtered.length === templates.length) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 })
    }

    saveTemplates(filtered, username)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Delete template error:", error)
    return NextResponse.json({ error: "Failed to delete template" }, { status: 500 })
  }
}
