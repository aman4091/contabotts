import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

// GET - List image folders or images in a folder
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const folder = searchParams.get("folder")
    const type = searchParams.get("type") || "folders" // folders, images, overlays

    const imagesDir = path.join(DATA_DIR, "images")
    const overlaysDir = path.join(DATA_DIR, "thumbnail-overlays")

    if (type === "overlays") {
      // List overlay images
      if (!fs.existsSync(overlaysDir)) {
        return NextResponse.json({ overlays: [] })
      }

      const overlays = fs
        .readdirSync(overlaysDir)
        .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))

      return NextResponse.json({ overlays })
    }

    if (type === "folders") {
      // List image folders
      if (!fs.existsSync(imagesDir)) {
        return NextResponse.json({ folders: [] })
      }

      const folders = fs
        .readdirSync(imagesDir)
        .filter((f) => fs.statSync(path.join(imagesDir, f)).isDirectory())

      return NextResponse.json({ folders })
    }

    if (type === "images" && folder) {
      // List images in folder
      const folderPath = path.join(imagesDir, folder)
      if (!fs.existsSync(folderPath)) {
        return NextResponse.json({ images: [] })
      }

      const images = fs
        .readdirSync(folderPath)
        .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))

      return NextResponse.json({ images, folder })
    }

    return NextResponse.json({ error: "Invalid type or missing folder" }, { status: 400 })
  } catch (error) {
    console.error("Images API error:", error)
    return NextResponse.json({ error: "Failed to get images" }, { status: 500 })
  }
}

// POST - Upload overlay image
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File
    const type = formData.get("type") as string || "overlay"

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    const overlaysDir = path.join(DATA_DIR, "thumbnail-overlays")
    if (!fs.existsSync(overlaysDir)) {
      fs.mkdirSync(overlaysDir, { recursive: true })
    }

    // Generate unique filename
    const ext = path.extname(file.name) || ".png"
    const filename = `overlay_${Date.now()}${ext}`
    const filepath = path.join(overlaysDir, filename)

    // Save file
    const buffer = Buffer.from(await file.arrayBuffer())
    fs.writeFileSync(filepath, buffer)

    return NextResponse.json({
      success: true,
      filename,
      path: filepath
    })
  } catch (error) {
    console.error("Upload error:", error)
    return NextResponse.json({ error: "Failed to upload file" }, { status: 500 })
  }
}

// DELETE - Delete overlay image
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const filename = searchParams.get("filename")

    if (!filename) {
      return NextResponse.json({ error: "Filename required" }, { status: 400 })
    }

    const filepath = path.join(DATA_DIR, "thumbnail-overlays", filename)

    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Delete error:", error)
    return NextResponse.json({ error: "Failed to delete file" }, { status: 500 })
  }
}
