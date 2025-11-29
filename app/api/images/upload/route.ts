import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"
const IMAGES_DIR = path.join(DATA_DIR, "images")

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const folder = formData.get("folder") as string
    const files = formData.getAll("files") as File[]

    if (!folder) {
      return NextResponse.json({ error: "Folder name required" }, { status: 400 })
    }

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 })
    }

    const folderPath = path.join(IMAGES_DIR, folder)

    // Create folder if it doesn't exist
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true })
    }

    let uploaded = 0
    let failed = 0

    for (const file of files) {
      try {
        // Validate file type
        if (!file.type.startsWith("image/")) {
          failed++
          continue
        }

        // Generate unique filename
        const ext = path.extname(file.name) || ".jpg"
        const timestamp = Date.now()
        const random = Math.random().toString(36).substring(2, 8)
        const filename = `img_${timestamp}_${random}${ext}`
        const filePath = path.join(folderPath, filename)

        // Save file
        const buffer = Buffer.from(await file.arrayBuffer())
        fs.writeFileSync(filePath, buffer)
        uploaded++
      } catch (err) {
        console.error("Error saving file:", err)
        failed++
      }
    }

    return NextResponse.json({
      success: true,
      uploaded,
      failed,
      total: files.length
    })
  } catch (error) {
    console.error("Error uploading images:", error)
    return NextResponse.json({ error: "Failed to upload images" }, { status: 500 })
  }
}

