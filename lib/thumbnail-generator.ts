import { exec } from "child_process"
import { promisify } from "util"
import fs from "fs"
import path from "path"

const execAsync = promisify(exec)
const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"
const SCRIPT_PATH = "/root/tts/scripts/thumbnail_generator.py"

export interface TextBoxConfig {
  x: number
  y: number
  width: number
  height: number
  fontFamily: string
  fontSize: number
  fontColor: string
  textAlign: "left" | "center" | "right"
  padding: { top: number; right: number; bottom: number; left: number }
  shadow: {
    enabled: boolean
    color: string
    offsetX: number
    offsetY: number
    blur: number
  }
  outline: {
    enabled: boolean
    color: string
    width: number
  }
}

export interface ThumbnailOptions {
  backgroundImagePath?: string
  backgroundImageFolder?: string
  overlayImagePath?: string
  overlayPosition?: { x: number; y: number }
  overlaySize?: { width: number; height: number }
  title: string
  textBox: TextBoxConfig
  outputPath: string
}

export async function generateThumbnail(options: ThumbnailOptions): Promise<Buffer> {
  const {
    backgroundImagePath,
    backgroundImageFolder,
    overlayImagePath,
    overlayPosition,
    overlaySize,
    title,
    textBox,
    outputPath
  } = options

  // Build config for Python script
  const config = {
    backgroundImage: backgroundImagePath,
    backgroundImageFolder: backgroundImageFolder
      ? path.join(DATA_DIR, "images", backgroundImageFolder)
      : undefined,
    overlayImage: overlayImagePath,
    overlayPosition: overlayPosition || { x: 0, y: 0 },
    overlaySize: overlaySize || { width: 400, height: 400 },
    title,
    textBox
  }

  // Write config to temp file
  const configPath = `/tmp/thumb_config_${Date.now()}.json`
  console.log("Thumbnail config:", JSON.stringify(config, null, 2))
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

    // Parse result
    const result = JSON.parse(stdout.trim())

    if (!result.success) {
      throw new Error("Thumbnail generation failed")
    }

    // Read and return the generated image
    const buffer = fs.readFileSync(outputPath)
    return buffer
  } finally {
    // Cleanup temp config file
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath)
    }
  }
}

// Get random image from a folder
export function getRandomImage(folder: string): string | null {
  const folderPath = path.join(DATA_DIR, "images", folder)
  if (!fs.existsSync(folderPath)) {
    return null
  }

  const images = fs.readdirSync(folderPath).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))

  if (images.length === 0) {
    return null
  }

  const randomIndex = Math.floor(Math.random() * images.length)
  return path.join(folderPath, images[randomIndex])
}

// Get overlay image path
export function getOverlayPath(filename: string): string {
  return path.join(DATA_DIR, "thumbnail-overlays", filename)
}

// List available image folders
export function listImageFolders(): string[] {
  const imagesDir = path.join(DATA_DIR, "images")
  if (!fs.existsSync(imagesDir)) {
    return []
  }

  return fs
    .readdirSync(imagesDir)
    .filter((f) => fs.statSync(path.join(imagesDir, f)).isDirectory())
}

// List images in a folder
export function listImagesInFolder(folder: string): string[] {
  const folderPath = path.join(DATA_DIR, "images", folder)
  if (!fs.existsSync(folderPath)) {
    return []
  }

  return fs.readdirSync(folderPath).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
}

// List overlay images
export function listOverlayImages(): string[] {
  const overlaysDir = path.join(DATA_DIR, "thumbnail-overlays")
  if (!fs.existsSync(overlaysDir)) {
    return []
  }

  return fs.readdirSync(overlaysDir).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
}
