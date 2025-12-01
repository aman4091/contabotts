import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"
import { cookies } from "next/headers"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

function getTemplates(username?: string): any[] {
  const templatesPath = path.join(DATA_DIR, "users", username || "default", "thumbnail-templates.json")
  if (fs.existsSync(templatesPath)) {
    try {
      return JSON.parse(fs.readFileSync(templatesPath, "utf-8"))
    } catch {
      return []
    }
  }
  return []
}

function getRandomImage(folderName: string): string | null {
  const folderPath = path.join(DATA_DIR, "images", folderName)
  if (!fs.existsSync(folderPath)) return null

  const images = fs.readdirSync(folderPath).filter(f =>
    /\.(jpg|jpeg|png|webp)$/i.test(f)
  )

  if (images.length === 0) return null
  return path.join(folderPath, images[Math.floor(Math.random() * images.length)])
}

export async function POST(
  request: NextRequest,
  { params }: { params: { slot: string } }
) {
  try {
    const { slot } = params
    const username = await getUser()
    const body = await request.json()
    const { title, templateId } = body

    if (!title) {
      return NextResponse.json({ error: "Title required" }, { status: 400 })
    }

    if (!templateId) {
      return NextResponse.json({ error: "Template ID required" }, { status: 400 })
    }

    const slotDir = path.join(DATA_DIR, "organized", slot)
    if (!fs.existsSync(slotDir)) {
      return NextResponse.json({ error: "Slot not found" }, { status: 404 })
    }

    // Get template
    const templates = getTemplates(username)
    const template = templates.find((t: any) => t.id === templateId)
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 })
    }

    // Get random background image from template's folder
    const bgImage = getRandomImage(template.backgroundImageFolder)
    if (!bgImage) {
      return NextResponse.json({ error: "No background images in template folder" }, { status: 400 })
    }

    // Generate thumbnail using canvas or external service
    // For now, we'll create a placeholder and use the existing thumbnail generation logic
    const thumbnailPath = path.join(slotDir, "thumbnail.png")

    // Call the thumbnail generation API
    const baseUrl = request.nextUrl.origin
    const generateRes = await fetch(`${baseUrl}/api/thumbnail-templates/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": request.headers.get("cookie") || ""
      },
      body: JSON.stringify({
        templateId,
        title,
        outputPath: thumbnailPath
      })
    })

    if (!generateRes.ok) {
      const errorData = await generateRes.json()
      return NextResponse.json({ error: errorData.error || "Failed to generate thumbnail" }, { status: 500 })
    }

    return NextResponse.json({ success: true, path: thumbnailPath })
  } catch (error) {
    console.error("Error generating thumbnail:", error)
    return NextResponse.json({ error: "Error generating thumbnail" }, { status: 500 })
  }
}
