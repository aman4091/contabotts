import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

// POST - Upload canvas image directly as thumbnail
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { date, channel, slot, imageData } = body

    if (!date || !channel || !slot || !imageData) {
      return NextResponse.json(
        { error: "Date, channel, slot and imageData required" },
        { status: 400 }
      )
    }

    // Ensure directory exists
    const outputDir = path.join(DATA_DIR, "organized", date, channel, `video_${slot}`)
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    const outputPath = path.join(outputDir, "thumbnail.png")

    // Convert base64 to buffer and save
    const base64Data = imageData.replace(/^data:image\/png;base64,/, "")
    const buffer = Buffer.from(base64Data, "base64")

    fs.writeFileSync(outputPath, buffer)

    console.log("Canvas thumbnail saved to:", outputPath)

    return NextResponse.json({
      success: true,
      path: outputPath,
      message: "Thumbnail uploaded successfully"
    })
  } catch (error) {
    console.error("Upload thumbnail error:", error)
    return NextResponse.json(
      { error: `Failed to upload thumbnail: ${error}` },
      { status: 500 }
    )
  }
}
