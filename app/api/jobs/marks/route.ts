import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

const MARKS_FILE = "/root/tts/data/marked-jobs.json"

// GET - Load marked jobs
export async function GET() {
  try {
    if (!fs.existsSync(MARKS_FILE)) {
      return NextResponse.json({ marked: [] })
    }
    const content = fs.readFileSync(MARKS_FILE, "utf-8")
    const data = JSON.parse(content)
    return NextResponse.json({ marked: data.marked || [] })
  } catch (error) {
    console.error("Error loading marks:", error)
    return NextResponse.json({ marked: [] })
  }
}

// POST - Save marked jobs
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { marked } = body

    if (!Array.isArray(marked)) {
      return NextResponse.json({ error: "marked must be an array" }, { status: 400 })
    }

    // Ensure directory exists
    const dir = path.dirname(MARKS_FILE)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    fs.writeFileSync(MARKS_FILE, JSON.stringify({ marked }, null, 2))
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error saving marks:", error)
    return NextResponse.json({ error: "Failed to save marks" }, { status: 500 })
  }
}
