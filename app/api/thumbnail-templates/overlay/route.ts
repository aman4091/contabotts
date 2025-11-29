import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"
const OVERLAY_DIR = path.join(DATA_DIR, "thumbnail-overlays")

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

// GET - List all overlay images
export async function GET() {
  try {
    ensureDir(OVERLAY_DIR)

    const files = fs.readdirSync(OVERLAY_DIR)
      .filter((f) => /\.(png|jpg|jpeg|webp|gif)$/i.test(f))
      .map((filename) => {
        const filePath = path.join(OVERLAY_DIR, filename)
        const stats = fs.statSync(filePath)
        return {
          name: filename,
          size: stats.size,
          sizeFormatted: formatSize(stats.size),
          createdAt: stats.birthtime.toISOString()
        }
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    return NextResponse.json({ files })
  } catch (error) {
    console.error("Get overlays error:", error)
    return NextResponse.json({ error: "Failed to get overlays" }, { status: 500 })
  }
}

// POST - Upload overlay image
export async function POST(request: NextRequest) {
  try {
    ensureDir(OVERLAY_DIR)

    const formData = await request.formData()
    const file = formData.get("file") as File
    const customName = formData.get("name") as string

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    // Validate file type
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Only image files allowed" }, { status: 400 })
    }

    // Generate filename
    const ext = file.name.split(".").pop()?.toLowerCase() || "png"
    const baseName = customName
      ? customName.replace(/[^a-zA-Z0-9_-]/g, "_")
      : `overlay_${Date.now()}`
    const filename = `${baseName}.${ext}`

    // Check if file already exists
    const filePath = path.join(OVERLAY_DIR, filename)
    if (fs.existsSync(filePath)) {
      return NextResponse.json({ error: "File with this name already exists" }, { status: 400 })
    }

    // Save file
    const buffer = Buffer.from(await file.arrayBuffer())
    fs.writeFileSync(filePath, buffer)

    return NextResponse.json({
      success: true,
      filename,
      size: buffer.length,
      sizeFormatted: formatSize(buffer.length)
    })
  } catch (error) {
    console.error("Upload overlay error:", error)
    return NextResponse.json({ error: "Failed to upload overlay" }, { status: 500 })
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

    const filePath = path.join(OVERLAY_DIR, filename)

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 })
    }

    fs.unlinkSync(filePath)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Delete overlay error:", error)
    return NextResponse.json({ error: "Failed to delete overlay" }, { status: 500 })
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
