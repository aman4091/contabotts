import sharp from "sharp"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

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
  backgroundImagePath: string
  overlayImagePath?: string
  overlayPosition?: { x: number; y: number }
  overlaySize?: { width: number; height: number }
  title: string
  textBox: TextBoxConfig
  outputPath: string
}

// Calculate font size to fit text in box
function calculateFontSize(
  text: string,
  boxWidth: number,
  boxHeight: number,
  maxFontSize: number,
  padding: { left: number; right: number; top: number; bottom: number }
): number {
  const availableWidth = boxWidth - padding.left - padding.right
  const availableHeight = boxHeight - padding.top - padding.bottom

  // Estimate characters per line (rough approximation)
  // Average character width is about 0.5-0.6 of font size for most fonts
  const charWidthRatio = 0.55

  let fontSize = maxFontSize

  while (fontSize > 16) {
    const charsPerLine = Math.floor(availableWidth / (fontSize * charWidthRatio))
    const words = text.split(" ")
    let lines = 1
    let currentLineLength = 0

    for (const word of words) {
      if (currentLineLength + word.length + 1 > charsPerLine) {
        lines++
        currentLineLength = word.length
      } else {
        currentLineLength += word.length + 1
      }
    }

    const lineHeight = fontSize * 1.2
    const totalHeight = lines * lineHeight

    if (totalHeight <= availableHeight) {
      break
    }

    fontSize -= 2
  }

  return fontSize
}

// Wrap text to fit within width
function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const charWidthRatio = 0.55
  const charsPerLine = Math.floor(maxWidth / (fontSize * charWidthRatio))
  const words = text.split(" ")
  const lines: string[] = []
  let currentLine = ""

  for (const word of words) {
    if ((currentLine + " " + word).trim().length > charsPerLine && currentLine) {
      lines.push(currentLine.trim())
      currentLine = word
    } else {
      currentLine = currentLine ? currentLine + " " + word : word
    }
  }

  if (currentLine) {
    lines.push(currentLine.trim())
  }

  return lines
}

// Generate SVG text element with styling
function generateTextSvg(
  title: string,
  textBox: TextBoxConfig,
  actualFontSize: number
): string {
  const lines = wrapText(
    title,
    actualFontSize,
    textBox.width - textBox.padding.left - textBox.padding.right
  )

  const lineHeight = actualFontSize * 1.2
  const totalTextHeight = lines.length * lineHeight
  const startY =
    textBox.padding.top + (textBox.height - textBox.padding.top - textBox.padding.bottom - totalTextHeight) / 2

  // Calculate text anchor based on alignment
  let textAnchor = "middle"
  let xPosition = textBox.width / 2
  if (textBox.textAlign === "left") {
    textAnchor = "start"
    xPosition = textBox.padding.left
  } else if (textBox.textAlign === "right") {
    textAnchor = "end"
    xPosition = textBox.width - textBox.padding.right
  }

  // Build filter for shadow
  let filterDef = ""
  let filterAttr = ""

  if (textBox.shadow.enabled) {
    filterDef = `
      <defs>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="${textBox.shadow.offsetX}" dy="${textBox.shadow.offsetY}"
            stdDeviation="${textBox.shadow.blur}" flood-color="${textBox.shadow.color}" flood-opacity="0.8"/>
        </filter>
      </defs>
    `
    filterAttr = 'filter="url(#shadow)"'
  }

  // Build text elements
  const textElements = lines
    .map((line, index) => {
      const y = startY + actualFontSize + index * lineHeight

      if (textBox.outline.enabled) {
        // Text with outline (stroke) + fill
        return `
          <text x="${xPosition}" y="${y}" text-anchor="${textAnchor}"
            font-family="${textBox.fontFamily}, Impact, Arial Black, sans-serif"
            font-size="${actualFontSize}px" font-weight="bold"
            stroke="${textBox.outline.color}" stroke-width="${textBox.outline.width * 2}"
            stroke-linejoin="round" fill="${textBox.fontColor}" ${filterAttr}>
            ${escapeXml(line)}
          </text>
          <text x="${xPosition}" y="${y}" text-anchor="${textAnchor}"
            font-family="${textBox.fontFamily}, Impact, Arial Black, sans-serif"
            font-size="${actualFontSize}px" font-weight="bold"
            fill="${textBox.fontColor}">
            ${escapeXml(line)}
          </text>
        `
      } else {
        return `
          <text x="${xPosition}" y="${y}" text-anchor="${textAnchor}"
            font-family="${textBox.fontFamily}, Impact, Arial Black, sans-serif"
            font-size="${actualFontSize}px" font-weight="bold"
            fill="${textBox.fontColor}" ${filterAttr}>
            ${escapeXml(line)}
          </text>
        `
      }
    })
    .join("")

  return `
    <svg width="${textBox.width}" height="${textBox.height}">
      ${filterDef}
      ${textElements}
    </svg>
  `
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

export async function generateThumbnail(options: ThumbnailOptions): Promise<Buffer> {
  const { backgroundImagePath, overlayImagePath, overlayPosition, overlaySize, title, textBox, outputPath } =
    options

  // Start with background image resized to 1280x720
  let image = sharp(backgroundImagePath).resize(1280, 720, {
    fit: "cover",
    position: "center"
  })

  const composites: sharp.OverlayOptions[] = []

  // Add overlay image if provided
  if (overlayImagePath && fs.existsSync(overlayImagePath) && overlaySize) {
    const overlayBuffer = await sharp(overlayImagePath)
      .resize(overlaySize.width, overlaySize.height, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .toBuffer()

    composites.push({
      input: overlayBuffer,
      left: overlayPosition?.x || 0,
      top: overlayPosition?.y || 0
    })
  }

  // Calculate font size to fit
  const actualFontSize = calculateFontSize(
    title,
    textBox.width,
    textBox.height,
    textBox.fontSize,
    textBox.padding
  )

  // Generate text SVG
  const textSvg = generateTextSvg(title, textBox, actualFontSize)
  const textBuffer = Buffer.from(textSvg)

  composites.push({
    input: textBuffer,
    left: textBox.x,
    top: textBox.y
  })

  // Composite all layers
  const result = await image.composite(composites).png().toBuffer()

  // Save to output path
  const outputDir = path.dirname(outputPath)
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }
  fs.writeFileSync(outputPath, result)

  return result
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
