import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value || "default"
}

function getUserOrganizedDir(username: string) {
  return path.join(DATA_DIR, "users", username, "organized")
}

export async function GET(request: NextRequest) {
  try {
    const username = await getUser()
    const { searchParams } = new URL(request.url)
    const videoId = searchParams.get("videoId")
    const file = searchParams.get("file") // transcript, script, thumbnail

    if (!videoId || !file) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 })
    }

    // Map file type to filename
    const fileMap: Record<string, string[]> = {
      transcript: ["transcript.txt"],
      script: ["script.txt"],
      thumbnail: ["thumbnail.jpg", "thumbnail.png"],
      audio: ["audio.wav"],
      titles: ["titles.txt"]
    }

    const filenames = fileMap[file]
    if (!filenames) {
      return NextResponse.json({ error: "Invalid file type" }, { status: 400 })
    }

    // Try each possible filename
    let filePath = ""
    let actualFilename = ""
    for (const fn of filenames) {
      const tryPath = path.join(getUserOrganizedDir(username), videoId, fn)
      if (fs.existsSync(tryPath)) {
        filePath = tryPath
        actualFilename = fn
        break
      }
    }

    if (!filePath) {
      return NextResponse.json({ error: "File not found" }, { status: 404 })
    }

    const fileBuffer = fs.readFileSync(filePath)
    const stat = fs.statSync(filePath)

    // Determine content type based on actual file extension
    let contentType = "application/octet-stream"
    if (actualFilename.endsWith(".txt")) contentType = "text/plain"
    else if (actualFilename.endsWith(".png")) contentType = "image/png"
    else if (actualFilename.endsWith(".jpg")) contentType = "image/jpeg"
    else if (actualFilename.endsWith(".wav")) contentType = "audio/wav"

    const headers = new Headers()
    headers.set("Content-Type", contentType)
    headers.set("Content-Length", stat.size.toString())
    headers.set("Content-Disposition", `attachment; filename="${videoId}_${file}${path.extname(actualFilename)}"`)

    return new NextResponse(fileBuffer, { headers })
  } catch (error) {
    console.error("Download error:", error)
    return NextResponse.json({ error: "Download failed" }, { status: 500 })
  }
}
