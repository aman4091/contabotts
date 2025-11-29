import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const name = searchParams.get("name")

    if (!name) {
      return NextResponse.json({ error: "Name required" }, { status: 400 })
    }

    const imagePath = path.join(DATA_DIR, "thumbnail-overlays", name)

    if (!fs.existsSync(imagePath)) {
      return NextResponse.json({ error: "Overlay not found" }, { status: 404 })
    }

    const buffer = fs.readFileSync(imagePath)
    const ext = path.extname(name).toLowerCase()
    const mimeType = ext === ".png" ? "image/png" :
                     ext === ".webp" ? "image/webp" : "image/jpeg"

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": mimeType,
        "Content-Length": buffer.length.toString()
      }
    })
  } catch (error) {
    console.error("Overlay image error:", error)
    return NextResponse.json({ error: "Failed to get overlay" }, { status: 500 })
  }
}
