import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import fs from "fs"
import path from "path"
import {
  generateThumbnail,
  getRandomImage,
  getOverlayPath,
  TextBoxConfig
} from "@/lib/thumbnail-generator"

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

interface ThumbnailTemplate {
  id: string
  channelCode: string
  name: string
  backgroundImageFolder: string
  overlayImage: string
  overlayPosition: { x: number; y: number }
  overlaySize: { width: number; height: number }
  textBox: TextBoxConfig
}

function loadTemplates(username?: string): ThumbnailTemplate[] {
  const filePath = getTemplatesPath(username)
  if (!fs.existsSync(filePath)) {
    return []
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"))
  } catch {
    return []
  }
}

// GET - Get thumbnail for a slot (serves the image)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const date = searchParams.get("date")
    const channel = searchParams.get("channel")
    const slot = searchParams.get("slot")

    if (!date || !channel || !slot) {
      return NextResponse.json({ error: "Date, channel and slot required" }, { status: 400 })
    }

    const thumbnailPath = path.join(
      DATA_DIR,
      "organized",
      date,
      channel,
      `video_${slot}`,
      "thumbnail.png"
    )

    if (!fs.existsSync(thumbnailPath)) {
      return NextResponse.json({ exists: false })
    }

    const buffer = fs.readFileSync(thumbnailPath)
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-cache"
      }
    })
  } catch (error) {
    console.error("Get thumbnail error:", error)
    return NextResponse.json({ error: "Failed to get thumbnail" }, { status: 500 })
  }
}

// POST - Generate thumbnail
export async function POST(request: NextRequest) {
  try {
    const username = await getUser()
    const body = await request.json()

    const {
      date,
      channel,
      slot,
      title,
      templateId,
      // Optional manual overrides
      textBox: customTextBox,
      backgroundImage: customBackground
    } = body

    if (!date || !channel || !slot || !title) {
      return NextResponse.json(
        { error: "Date, channel, slot and title required" },
        { status: 400 }
      )
    }

    // Get template
    const templates = loadTemplates(username)
    let template = templateId
      ? templates.find((t) => t.id === templateId)
      : templates.find((t) => t.channelCode === channel)

    if (!template) {
      // Use default template
      template = {
        id: "default",
        channelCode: channel,
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

    // Get background image
    const backgroundPath =
      customBackground || getRandomImage(template.backgroundImageFolder)

    if (!backgroundPath) {
      return NextResponse.json(
        { error: `No images found in folder: ${template.backgroundImageFolder}` },
        { status: 400 }
      )
    }

    // Get overlay image path
    const overlayPath = template.overlayImage
      ? getOverlayPath(template.overlayImage)
      : undefined

    // Output path
    const outputPath = path.join(
      DATA_DIR,
      "organized",
      date,
      channel,
      `video_${slot}`,
      "thumbnail.png"
    )

    // Use custom text box if provided, otherwise use template
    const textBox = customTextBox || template.textBox

    // Generate thumbnail
    await generateThumbnail({
      backgroundImagePath: backgroundPath,
      overlayImagePath: overlayPath,
      overlayPosition: template.overlayPosition,
      overlaySize: template.overlaySize,
      title,
      textBox,
      outputPath
    })

    return NextResponse.json({
      success: true,
      path: outputPath,
      message: "Thumbnail generated successfully"
    })
  } catch (error) {
    console.error("Generate thumbnail error:", error)
    return NextResponse.json(
      { error: `Failed to generate thumbnail: ${error}` },
      { status: 500 }
    )
  }
}

// PUT - Update existing thumbnail with manual edits
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()

    const { date, channel, slot, title, textBox, backgroundImage } = body

    if (!date || !channel || !slot || !title || !textBox) {
      return NextResponse.json(
        { error: "Date, channel, slot, title and textBox required" },
        { status: 400 }
      )
    }

    // Get background - use provided or get random from nature
    const backgroundPath = backgroundImage || getRandomImage("nature")

    if (!backgroundPath) {
      return NextResponse.json(
        { error: "No background image available" },
        { status: 400 }
      )
    }

    const outputPath = path.join(
      DATA_DIR,
      "organized",
      date,
      channel,
      `video_${slot}`,
      "thumbnail.png"
    )

    // Generate with custom settings
    await generateThumbnail({
      backgroundImagePath: backgroundPath,
      title,
      textBox,
      outputPath
    })

    return NextResponse.json({
      success: true,
      path: outputPath,
      message: "Thumbnail updated successfully"
    })
  } catch (error) {
    console.error("Update thumbnail error:", error)
    return NextResponse.json(
      { error: `Failed to update thumbnail: ${error}` },
      { status: 500 }
    )
  }
}

// DELETE - Delete thumbnail
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const date = searchParams.get("date")
    const channel = searchParams.get("channel")
    const slot = searchParams.get("slot")

    if (!date || !channel || !slot) {
      return NextResponse.json({ error: "Date, channel and slot required" }, { status: 400 })
    }

    const thumbnailPath = path.join(
      DATA_DIR,
      "organized",
      date,
      channel,
      `video_${slot}`,
      "thumbnail.png"
    )

    if (fs.existsSync(thumbnailPath)) {
      fs.unlinkSync(thumbnailPath)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Delete thumbnail error:", error)
    return NextResponse.json({ error: "Failed to delete thumbnail" }, { status: 500 })
  }
}
