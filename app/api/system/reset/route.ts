import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import fs from "fs"
import path from "path"

const FILE_SERVER_URL = process.env.FILE_SERVER_URL || ""
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || ""

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

export async function POST() {
  try {
    const username = await getUser()
    const dataDir = path.join(process.cwd(), "data")
    const userDir = username ? path.join(dataDir, "users", username) : dataDir

    const results = {
      organized: false,
      calendar: false,
      queue: false,
      counters: false
    }

    // 1. Delete organized folder
    const organizedPath = path.join(userDir, "organized")
    if (fs.existsSync(organizedPath)) {
      fs.rmSync(organizedPath, { recursive: true, force: true })
      fs.mkdirSync(organizedPath, { recursive: true })
      results.organized = true
    }

    // 2. Delete calendar data
    const calendarPath = path.join(userDir, "calendar")
    if (fs.existsSync(calendarPath)) {
      fs.rmSync(calendarPath, { recursive: true, force: true })
      fs.mkdirSync(calendarPath, { recursive: true })
      results.calendar = true
    }

    // 3. Clear queue via file server
    try {
      const queueRes = await fetch(`${FILE_SERVER_URL}/queue/reset`, {
        method: "POST",
        headers: { "x-api-key": FILE_SERVER_API_KEY }
      })
      results.queue = queueRes.ok
    } catch (e) {
      console.error("Queue reset failed:", e)
    }

    // 4. Reset counters via file server
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
