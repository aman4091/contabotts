import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const folder = searchParams.get("folder") || "nature"

    const folderPath = path.join(DATA_DIR, "images", folder)

    if (!fs.existsSync(folderPath)) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 })
    }

    const images = fs.readdirSync(folderPath).filter(f =>
      /\.(jpg|jpeg|png|webp)$/i.test(f)
    )

    if (images.length === 0) {
      return NextResponse.json({ error: "No images in folder" }, { status: 404 })
    }

    // Pick random image
    const randomImage = images[Math.floor(Math.random() * images.length)]
    const imagePath = path.join(folderPath, randomImage)

    const buffer = fs.readFileSync(imagePath)
    const ext = path.extname(randomImage).toLowerCase()
    const mimeType = ext === ".png" ? "image/png" :
                     ext === ".webp" ? "image/webp" : "image/jpeg"

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": mimeType,
        "Content-Length": buffer.length.toString(),
        "Cache-Control": "no-cache",
        "X-Image-Path": imagePath
      }
    })
  } catch (error) {
    console.error("Random image error:", error)
    return NextResponse.json({ error: "Failed to get image" }, { status: 500 })
  }
}
