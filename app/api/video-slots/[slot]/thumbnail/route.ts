import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"
import { cookies } from "next/headers"
import {
  generateThumbnail,
  getRandomImage,
  getOverlayPath,
  TextBoxConfig
} from "@/lib/thumbnail-generator"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value || "default"
}

function getUserOrganizedDir(username: string) {
  return path.join(DATA_DIR, "users", username, "organized")
}

interface ThumbnailTemplate {
  id: string
  name: string
  backgroundImageFolder: string
  overlayImage: string
  overlayPosition: { x: number; y: number }
  overlaySize: { width: number; height: number }
  textBox: TextBoxConfig
}

function getTemplates(username?: string): ThumbnailTemplate[] {
  const templatesPath = path.join(DATA_DIR, "users", username || "default", "thumbnail-templates.json")
  if (fs.existsSync(templatesPath)) {
    try {
      return JSON.parse(fs.readFileSync(templatesPath, "utf-8"))
    } catch {
      return []
    }
  }
  return []
}

// GET existing thumbnail
export async function GET(
  request: NextRequest,
  { params }: { params: { slot: string } }
) {
  try {
    const username = await getUser()
    const { slot } = await params
    const slotDir = path.join(getUserOrganizedDir(username), slot)
    const thumbnailPath = path.join(slotDir, "thumbnail.png")

    if (!fs.existsSync(thumbnailPath)) {
      return NextResponse.json({ error: "Thumbnail not found" }, { status: 404 })
    }

    const imageBuffer = fs.readFileSync(thumbnailPath)
    return new NextResponse(imageBuffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-cache"
      }
    })
  } catch (error) {
    console.error("Error getting thumbnail:", error)
    return NextResponse.json({ error: "Error getting thumbnail" }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { slot: string } }
) {
  try {
    const { slot } = await params
    const username = await getUser()
    const body = await request.json()
    const { title, templateId } = body

    if (!title) {
      return NextResponse.json({ error: "Title required" }, { status: 400 })
    }

    const slotDir = path.join(getUserOrganizedDir(username), slot)
    if (!fs.existsSync(slotDir)) {
      return NextResponse.json({ error: "Slot not found" }, { status: 404 })
    }

    // Get template
    const templates = getTemplates(username)
    let template = templateId
      ? templates.find((t) => t.id === templateId)
      : templates[0]

    if (!template) {
      // Use default template
      template = {
        id: "default",
        name: "Default",
        backgroundImageFolder: "nature",
        overlayImage: "",
        overlayPosition: { x: 0, y: 0 },
        overlaySize: { width: 400, height: 400 },
        textBox: {
          x: 50,
          y: 480,
          width: 1180,
          height: 200,
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
      }
    }

    // Get random background image from template's folder
    const backgroundPath = getRandomImage(template.backgroundImageFolder)
    if (!backgroundPath) {
      return NextResponse.json({ error: `No images in folder: ${template.backgroundImageFolder}` }, { status: 400 })
    }

    // Get overlay image path
    const overlayPath = template.overlayImage
      ? getOverlayPath(template.overlayImage)
      : undefined

    // Output path
    const thumbnailPath = path.join(slotDir, "thumbnail.png")

    // Generate thumbnail
    await generateThumbnail({
      backgroundImagePath: backgroundPath,
      overlayImagePath: overlayPath,
      overlayPosition: template.overlayPosition,
      overlaySize: template.overlaySize,
      title,
      textBox: template.textBox,
      outputPath: thumbnailPath
    })

    return NextResponse.json({ success: true, path: thumbnailPath })
  } catch (error) {
    console.error("Error generating thumbnail:", error)
    return NextResponse.json({ error: `Error generating thumbnail: ${error}` }, { status: 500 })
  }
}
