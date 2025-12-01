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

export async function POST(
  request: NextRequest,
  { params }: { params: { slot: string } }
) {
  try {
    const username = await getUser()
    const { slot } = await params
    const body = await request.json()
    const { imageData } = body

    if (!imageData) {
      return NextResponse.json({ error: "Image data required" }, { status: 400 })
    }

    const slotDir = path.join(getUserOrganizedDir(username), slot)
    if (!fs.existsSync(slotDir)) {
      return NextResponse.json({ error: "Slot not found" }, { status: 404 })
    }

    // Extract base64 data
    const base64Data = imageData.replace(/^data:image\/png;base64,/, "")
    const thumbnailPath = path.join(slotDir, "thumbnail.png")

    // Write image file
    fs.writeFileSync(thumbnailPath, Buffer.from(base64Data, "base64"))

    return NextResponse.json({ success: true, path: thumbnailPath })
  } catch (error) {
    console.error("Error uploading thumbnail:", error)
    return NextResponse.json({ error: "Error uploading thumbnail" }, { status: 500 })
  }
}
