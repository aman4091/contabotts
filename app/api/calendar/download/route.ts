import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const date = searchParams.get("date")
    const channel = searchParams.get("channel")
    const slot = searchParams.get("slot")
    const file = searchParams.get("file") // transcript, script, audio, video

    if (!date || !channel || !slot || !file) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 })
    }

    // Map file type to filename
    const fileMap: Record<string, string> = {
      transcript: "transcript.txt",
      script: "script.txt",
      audio: "audio.wav",
      video: "video.mp4"
    }

    const filename = fileMap[file]
    if (!filename) {
      return NextResponse.json({ error: "Invalid file type" }, { status: 400 })
    }

    const filePath = path.join(DATA_DIR, "organized", date, channel, `video_${slot}`, filename)

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 })
    }

    const fileBuffer = fs.readFileSync(filePath)
    const stat = fs.statSync(filePath)

    // Determine content type
    const contentTypes: Record<string, string> = {
      transcript: "text/plain",
      script: "text/plain",
      audio: "audio/wav",
      video: "video/mp4"
    }

    const headers = new Headers()
    headers.set("Content-Type", contentTypes[file])
    headers.set("Content-Length", stat.size.toString())
    headers.set("Content-Disposition", `attachment; filename="${channel}_${date}_slot${slot}_${file}${path.extname(filename)}"`)

    return new NextResponse(fileBuffer, { headers })
  } catch (error) {
    console.error("Download error:", error)
    return NextResponse.json({ error: "Download failed" }, { status: 500 })
  }
}
