import { NextResponse } from "next/server"
import fs from "fs"
import path from "path"

const FILE_SERVER_URL = process.env.FILE_SERVER_URL || ""
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || ""

export async function POST() {
  try {
    const dataDir = path.join(process.cwd(), "data")

    const results = {
      organized: false,
      queue: false,
      counters: false,
      deletedFolders: 0
    }

    // 1. Delete organized folder (this is where calendar/scripts/transcripts are stored)
    // Path: /root/tts/data/organized/
    const organizedPath = path.join(dataDir, "organized")
    if (fs.existsSync(organizedPath)) {
      // Count folders before deleting
      const folders = fs.readdirSync(organizedPath)
      results.deletedFolders = folders.length

      fs.rmSync(organizedPath, { recursive: true, force: true })
      fs.mkdirSync(organizedPath, { recursive: true })
      results.organized = true
    }

    // 2. Clear queue via file server
    try {
      const queueRes = await fetch(`${FILE_SERVER_URL}/queue/reset`, {
        method: "POST",
        headers: { "x-api-key": FILE_SERVER_API_KEY }
      })
      results.queue = queueRes.ok
    } catch (e) {
      console.error("Queue reset failed:", e)
    }

    // 3. Reset counters via file server
    try {
      const counterRes = await fetch(`${FILE_SERVER_URL}/counter/reset`, {
        method: "POST",
        headers: { "x-api-key": FILE_SERVER_API_KEY }
      })
      results.counters = counterRes.ok
    } catch (e) {
      console.error("Counter reset failed:", e)
    }

    return NextResponse.json({
      success: true,
      message: "System reset complete",
      results
    })
  } catch (error) {
    console.error("System reset error:", error)
    return NextResponse.json({ error: "Reset failed" }, { status: 500 })
  }
}
