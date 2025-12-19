import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

export async function GET(request: NextRequest) {
  try {
    const username = await getUser()
    if (!username) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const folder = request.nextUrl.searchParams.get("folder")
    if (!folder) {
      return NextResponse.json({ error: "Folder parameter required" }, { status: 400 })
    }

    const userDir = path.join(DATA_DIR, "users", username)

    // Try organized folder first (video_X folders)
    const organizedPath = path.join(userDir, "organized", folder, "script.txt")
    if (fs.existsSync(organizedPath)) {
      const content = fs.readFileSync(organizedPath, "utf-8")
      return NextResponse.json({ success: true, content })
    }

    // Try transcripts folder
    const transcriptPath = path.join(userDir, "transcripts", folder, "script.txt")
    if (fs.existsSync(transcriptPath)) {
      const content = fs.readFileSync(transcriptPath, "utf-8")
      return NextResponse.json({ success: true, content })
    }

    // Try transcript.txt in transcripts
    const transcript2Path = path.join(userDir, "transcripts", folder, "transcript.txt")
    if (fs.existsSync(transcript2Path)) {
      const content = fs.readFileSync(transcript2Path, "utf-8")
      return NextResponse.json({ success: true, content })
    }

    return NextResponse.json({ error: "Script not found" }, { status: 404 })

  } catch (error) {
    console.error("Error getting script content:", error)
    return NextResponse.json({ error: "Failed to get script" }, { status: 500 })
  }
}
