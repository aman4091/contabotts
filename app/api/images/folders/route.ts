import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"
const IMAGES_DIR = path.join(DATA_DIR, "images")

// GET - List all image folders with counts
export async function GET() {
  try {
    if (!fs.existsSync(IMAGES_DIR)) {
      fs.mkdirSync(IMAGES_DIR, { recursive: true })
    }

    const folders = fs.readdirSync(IMAGES_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => {
        const folderPath = path.join(IMAGES_DIR, d.name)
        const images = fs.readdirSync(folderPath)
          .filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))
        return {
          name: d.name,
          imageCount: images.length
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))

    return NextResponse.json({ success: true, folders })
  } catch (error) {
    console.error("Error listing folders:", error)
    return NextResponse.json({ error: "Failed to list folders" }, { status: 500 })
  }
}

// POST - Create new folder
export async function POST(request: NextRequest) {
  try {
    const { name } = await request.json()

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Folder name required" }, { status: 400 })
    }

    // Sanitize folder name
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase()
    if (!safeName) {
      return NextResponse.json({ error: "Invalid folder name" }, { status: 400 })
    }

    const folderPath = path.join(IMAGES_DIR, safeName)

    if (fs.existsSync(folderPath)) {
      return NextResponse.json({ error: "Folder already exists" }, { status: 400 })
    }

    fs.mkdirSync(folderPath, { recursive: true })

    return NextResponse.json({ success: true, name: safeName })
  } catch (error) {
    console.error("Error creating folder:", error)
    return NextResponse.json({ error: "Failed to create folder" }, { status: 500 })
  }
}

// DELETE - Delete folder
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const name = searchParams.get("name")

    if (!name) {
      return NextResponse.json({ error: "Folder name required" }, { status: 400 })
    }

    const folderPath = path.join(IMAGES_DIR, name)

    if (!fs.existsSync(folderPath)) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 })
    }

    // Delete folder and all contents
    fs.rmSync(folderPath, { recursive: true, force: true })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting folder:", error)
    return NextResponse.json({ error: "Failed to delete folder" }, { status: 500 })
  }
}
