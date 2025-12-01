import { NextResponse } from "next/server"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

export async function GET() {
  try {
    const organizedDir = path.join(DATA_DIR, "organized")

    if (!fs.existsSync(organizedDir)) {
      return NextResponse.json({ slots: [] })
    }

    const entries = fs.readdirSync(organizedDir, { withFileTypes: true })
    const slots = entries
      .filter(entry => entry.isDirectory() && entry.name.startsWith("video_"))
      .map(entry => {
        const slotPath = path.join(organizedDir, entry.name)
        const hasScript = fs.existsSync(path.join(slotPath, "script.txt"))
        const hasTranscript = fs.existsSync(path.join(slotPath, "transcript.txt"))
        const hasTitle = fs.existsSync(path.join(slotPath, "title.txt"))
        const hasThumbnail = fs.existsSync(path.join(slotPath, "thumbnail.png")) ||
                            fs.existsSync(path.join(slotPath, "thumbnail.jpg"))

        return {
          name: entry.name,
          path: slotPath,
          hasScript,
          hasTranscript,
          hasTitle,
          hasThumbnail
        }
      })
      .sort((a, b) => {
        const numA = parseInt(a.name.replace("video_", ""))
        const numB = parseInt(b.name.replace("video_", ""))
        return numA - numB
      })

    return NextResponse.json({ slots })
  } catch (error) {
    console.error("Error listing video slots:", error)
    return NextResponse.json({ error: "Failed to list video slots" }, { status: 500 })
  }
}
