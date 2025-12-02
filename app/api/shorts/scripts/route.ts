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

    const userDir = path.join(DATA_DIR, "users", username)
    const organizedDir = path.join(userDir, "organized")
    const trackerPath = path.join(userDir, "shorts-tracker.json")

    // Get processed scripts from tracker
    let processedScripts: string[] = []
    if (fs.existsSync(trackerPath)) {
      try {
        const tracker = JSON.parse(fs.readFileSync(trackerPath, "utf-8"))
        processedScripts = tracker.processed || []
      } catch {
        // Ignore parse errors
      }
    }

    // Get all video folders
    if (!fs.existsSync(organizedDir)) {
      return NextResponse.json({ scripts: [] })
    }

    const allFolders = fs.readdirSync(organizedDir)
      .filter(f => f.startsWith("video_"))
      .filter(f => {
        // Check if script.txt exists
        const scriptPath = path.join(organizedDir, f, "script.txt")
        return fs.existsSync(scriptPath)
      })
      .filter(f => !processedScripts.includes(f)) // Exclude already processed
      .sort((a, b) => {
        // Sort by video number
        const numA = parseInt(a.replace("video_", ""))
        const numB = parseInt(b.replace("video_", ""))
        return numA - numB
      })

    // Get titles for each script
    const scripts = allFolders.map(folder => {
      const titlePath = path.join(organizedDir, folder, "title.txt")
      let title = undefined
      if (fs.existsSync(titlePath)) {
        try {
          title = fs.readFileSync(titlePath, "utf-8").trim().split("\n")[0]
        } catch {
          // Ignore
        }
      }
      return { folder, title }
    })

    return NextResponse.json({ scripts })
  } catch (error) {
    console.error("Error getting scripts:", error)
    return NextResponse.json({ error: "Failed to get scripts" }, { status: 500 })
  }
}
