import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

export async function GET(request: NextRequest) {
  const cookieStore = cookies()
  const username = cookieStore.get("user")?.value

  if (!username) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const statusPath = path.join(DATA_DIR, "users", username, "channel-automation", "processing-status.json")

  try {
    if (fs.existsSync(statusPath)) {
      const status = JSON.parse(fs.readFileSync(statusPath, "utf-8"))
      return NextResponse.json(status)
    }
    return NextResponse.json({ isProcessing: false })
  } catch (error) {
    return NextResponse.json({ isProcessing: false })
  }
}
