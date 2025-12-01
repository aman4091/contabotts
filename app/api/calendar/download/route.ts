import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const videoId = searchParams.get("videoId")
    const file = searchParams.get("file") // transcript, script, thumbnail

    if (!videoId || !file) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 })
    }

    // Map file type to filename
    const fileMap: Record<string, string> = {
      transcript: "transcript.txt",
      script: "script.txt",
      thumbnail: "thumbnail.png"
    }

    const filename = fileMap[file]
    if (!filename) {
      return NextResponse.json({ error: "Invalid file type" }, { status: 400 })
    }

    const filePath = path.join(DATA_DIR, "organized", videoId, filename)

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 })
    }

    const fileBuffer = fs.readFileSync(filePath)
    const stat = fs.statSync(filePath)

    // Determine content type
    const contentTypes: Record<string, string> = {
      transcript: "text/plain",
      script: "text/plain",
      thumbnail: "image/png"
    }

    const headers = new Headers()
    headers.set("Content-Type", contentTypes[file])
    headers.set("Content-Length", stat.size.toString())
    headers.set("Content-Disposition", `attachment; filename="${videoId}_${file}${path.extname(filename)}"`)

    return new NextResponse(fileBuffer, { headers })
  } catch (error) {
    console.error("Download error:", error)
    return NextResponse.json({ error: "Download failed" }, { status: 500 })
  }
}
