import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

// GET - Get title for a slot
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const date = searchParams.get("date")
    const channel = searchParams.get("channel")
    const slot = searchParams.get("slot")

    if (!date || !channel || !slot) {
      return NextResponse.json({ error: "Date, channel and slot required" }, { status: 400 })
    }

    const titlePath = path.join(DATA_DIR, "organized", date, channel, `video_${slot}`, "title.txt")

    if (!fs.existsSync(titlePath)) {
      return NextResponse.json({ title: null })
    }

    const title = fs.readFileSync(titlePath, "utf-8").trim()
    return NextResponse.json({ title })
  } catch (error) {
    console.error("Get title error:", error)
    return NextResponse.json({ error: "Failed to get title" }, { status: 500 })
  }
}

// PUT - Save title to slot
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { date, channel, slot, title } = body

    if (!date || !channel || !slot || !title) {
      return NextResponse.json({ error: "Date, channel, slot and title required" }, { status: 400 })
    }

    const slotDir = path.join(DATA_DIR, "organized", date, channel, `video_${slot}`)

    // Create directory if it doesn't exist
    if (!fs.existsSync(slotDir)) {
      fs.mkdirSync(slotDir, { recursive: true })
    }

    const titlePath = path.join(slotDir, "title.txt")
    fs.writeFileSync(titlePath, title.trim())

    return NextResponse.json({
      success: true,
      message: "Title saved",
      path: titlePath
    })
  } catch (error) {
    console.error("Save title error:", error)
    return NextResponse.json({ error: "Failed to save title" }, { status: 500 })
  }
}
