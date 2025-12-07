import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { writeFile, mkdir } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { v4 as uuidv4 } from "uuid"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

export async function POST(request: NextRequest) {
  try {
    const username = await getUser()
    const userDir = username ? path.join(DATA_DIR, "users", username) : DATA_DIR

    // Create custom-images directory if not exists
    const customImagesDir = path.join(userDir, "custom-images")
    if (!existsSync(customImagesDir)) {
      await mkdir(customImagesDir, { recursive: true })
    }

    // Generate unique folder for this batch
    const batchId = uuidv4().substring(0, 8)
    const batchDir = path.join(customImagesDir, batchId)
    await mkdir(batchDir, { recursive: true })

    const formData = await request.formData()
    const uploadedPaths: string[] = []

    // Process each uploaded file
    const entries = Array.from(formData.entries())

    for (let i = 0; i < entries.length; i++) {
      const [key, value] = entries[i]
      if (!key.startsWith("image_") || !(value instanceof File)) continue

      const file = value
      const buffer = Buffer.from(await file.arrayBuffer())

      // Generate filename with order prefix
      const ext = file.name.split('.').pop() || 'jpg'
      const filename = `${String(i + 1).padStart(2, '0')}_${uuidv4().substring(0, 8)}.${ext}`
      const filePath = path.join(batchDir, filename)

      await writeFile(filePath, buffer)

      // Return relative path from data dir
      const relativePath = path.relative(DATA_DIR, filePath)
      uploadedPaths.push(relativePath)
    }

    if (uploadedPaths.length === 0) {
      return NextResponse.json({ error: "No images uploaded" }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      batchId,
      paths: uploadedPaths,
      count: uploadedPaths.length
    })

  } catch (error) {
    console.error("Error uploading images:", error)
    return NextResponse.json({ error: "Failed to upload images" }, { status: 500 })
  }
}
