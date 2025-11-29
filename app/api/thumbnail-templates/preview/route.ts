import { NextRequest, NextResponse } from "next/server"
import { exec } from "child_process"
import { promisify } from "util"
import fs from "fs"
import path from "path"

const execAsync = promisify(exec)
const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"
const SCRIPT_PATH = "/root/tts/scripts/thumbnail_generator.py"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { template, title } = body

    if (!template) {
      return NextResponse.json({ error: "Template required" }, { status: 400 })
    }

    // Build config for Python script
    const config = {
      backgroundImageFolder: path.join(DATA_DIR, "images", template.backgroundImageFolder),
      overlayImage: template.overlayImage
        ? path.join(DATA_DIR, "thumbnail-overlays", template.overlayImage)
        : undefined,
      overlayPosition: template.overlayPosition || { x: 0, y: 0 },
      overlaySize: template.overlaySize || { width: 300, height: 300 },
      title: title || "Sample Preview Title",
      textBox: template.textBox
    }

    // Write config to temp file
    const configPath = `/tmp/preview_config_${Date.now()}.json`
    const outputPath = `/tmp/preview_thumb_${Date.now()}.png`

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))

    try {
      // Run Python script
      const { stdout, stderr } = await execAsync(
        `python3 "${SCRIPT_PATH}" --config "${configPath}" --output "${outputPath}"`,
        { timeout: 30000 }
      )

      if (stderr) {
        console.error("Python stderr:", stderr)
      }

      // Read and return the generated image
      const buffer = fs.readFileSync(outputPath)

      // Cleanup
      if (fs.existsSync(configPath)) fs.unlinkSync(configPath)
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)

      return new NextResponse(buffer, {
        headers: {
          "Content-Type": "image/png",
          "Content-Length": buffer.length.toString()
        }
      })
    } catch (error: any) {
      console.error("Thumbnail generation error:", error)
      // Cleanup on error
      if (fs.existsSync(configPath)) fs.unlinkSync(configPath)
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
      return NextResponse.json(
        { error: error.message || "Failed to generate preview" },
        { status: 500 }
      )
    }
  } catch (error: any) {
    console.error("Preview API error:", error)
    return NextResponse.json({ error: error.message || "Server error" }, { status: 500 })
  }
}
