import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"
const AUDIO_DIR = path.join(DATA_DIR, "reference-audio")

// GET - List all reference audio files
export async function GET() {
  try {
    if (!fs.existsSync(AUDIO_DIR)) {
      fs.mkdirSync(AUDIO_DIR, { recursive: true })
    }

    const files = fs.readdirSync(AUDIO_DIR)
      .filter(f => /\.(wav|mp3)$/i.test(f))
      .map(f => {
        const filePath = path.join(AUDIO_DIR, f)
        const stats = fs.statSync(filePath)
        return {
          name: f,
          size: stats.size,
          sizeFormatted: formatBytes(stats.size)
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))

    return NextResponse.json({ success: true, files })
  } catch (error) {
    console.error("Error listing audio files:", error)
    return NextResponse.json({ error: "Failed to list audio files" }, { status: 500 })
  }
}

// POST - Upload new reference audio
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File
    const customName = formData.get("name") as string

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    // Validate file type
    if (!file.type.includes("audio") && !file.name.match(/\.(wav|mp3)$/i)) {
      return NextResponse.json({ error: "Only .wav and .mp3 files allowed" }, { status: 400 })
    }

    // Create directory if not exists
    if (!fs.existsSync(AUDIO_DIR)) {
      fs.mkdirSync(AUDIO_DIR, { recursive: true })
    }

    // Determine filename
    let filename: string
    if (customName && customName.trim()) {
      // Use custom name with original extension
      const ext = path.extname(file.name) || ".wav"
      const safeName = customName.trim().replace(/[^a-zA-Z0-9_-]/g, "")
      filename = safeName + ext
    } else {
      filename = file.name
    }

    const filePath = path.join(AUDIO_DIR, filename)

    // Save file
    const buffer = Buffer.from(await file.arrayBuffer())
    fs.writeFileSync(filePath, buffer)

    return NextResponse.json({
      success: true,
      filename,
      size: buffer.length,
      sizeFormatted: formatBytes(buffer.length)
    })
  } catch (error) {
    console.error("Error uploading audio:", error)
    return NextResponse.json({ error: "Failed to upload audio" }, { status: 500 })
  }
}

// DELETE - Delete reference audio
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const name = searchParams.get("name")

    if (!name) {
      return NextResponse.json({ error: "Filename required" }, { status: 400 })
    }

    const filePath = path.join(AUDIO_DIR, name)

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 })
    }

    fs.unlinkSync(filePath)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting audio:", error)
    return NextResponse.json({ error: "Failed to delete audio" }, { status: 500 })
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}
