import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

export async function GET(
  request: NextRequest,
  { params }: { params: { slot: string } }
) {
  try {
    const { slot } = params
    const titlePath = path.join(DATA_DIR, "organized", slot, "title.txt")

    if (!fs.existsSync(titlePath)) {
      return NextResponse.json({ title: null })
    }

    const title = fs.readFileSync(titlePath, "utf-8").trim()
    return NextResponse.json({ title })
  } catch (error) {
    console.error("Error reading title:", error)
    return NextResponse.json({ error: "Error reading title" }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { slot: string } }
) {
  try {
    const { slot } = params
    const body = await request.json()
    const { title } = body

    if (!title) {
      return NextResponse.json({ error: "Title required" }, { status: 400 })
    }

    const slotDir = path.join(DATA_DIR, "organized", slot)
    if (!fs.existsSync(slotDir)) {
      return NextResponse.json({ error: "Slot not found" }, { status: 404 })
    }

    const titlePath = path.join(slotDir, "title.txt")
    fs.writeFileSync(titlePath, title)

    return NextResponse.json({ success: true, title })
  } catch (error) {
    console.error("Error saving title:", error)
    return NextResponse.json({ error: "Error saving title" }, { status: 500 })
  }
}
