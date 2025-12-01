"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "sonner"
import {
  Save,
  Upload,
  Type,
  Image as ImageIcon,
  RefreshCw,
  Download,
  Trash2,
  Loader2
} from "lucide-react"

interface ImageFolder {
  name: string
  imageCount: number
}

interface ThumbnailTemplate {
  id: string
  name: string
  backgroundImageFolder: string
  overlayImage: string
  overlayPosition: { x: number; y: number }
  overlaySize: { width: number; height: number }
  textBox: {
    x: number
    y: number
    width: number
    height: number
    fontFamily: string
    fontSize: number
    fontColor: string
    textAlign: "left" | "center" | "right"
    padding: { top: number; right: number; bottom: number; left: number }
    shadow: { enabled: boolean; color: string; offsetX: number; offsetY: number; blur: number }
    outline: { enabled: boolean; color: string; width: number }
  }
}

interface Props {
  template?: ThumbnailTemplate | null
  imageFolders: ImageFolder[]
  overlayImages: string[]
  onSave: (template: ThumbnailTemplate) => void
  onClose: () => void
}

const CANVAS_WIDTH = 1280
const CANVAS_HEIGHT = 720
const SCALE = 0.5 // Display at 50% size

export function ThumbnailEditor({
  template,
  imageFolders,
  overlayImages,
  onSave,
  onClose
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Template state
  const [name, setName] = useState(template?.name || "New Template")
  const [bgFolder, setBgFolder] = useState(template?.backgroundImageFolder || imageFolders[0]?.name || "nature")
  const [overlayImg, setOverlayImg] = useState(template?.overlayImage || "")
  const [overlays, setOverlays] = useState<string[]>(overlayImages)

  // Positions (in actual canvas coordinates)
  const [overlayPos, setOverlayPos] = useState(template?.overlayPosition || { x: 50, y: 50 })
  const [overlaySize, setOverlaySize] = useState(template?.overlaySize || { width: 300, height: 300 })
  const [textPos, setTextPos] = useState({ x: template?.textBox?.x || 50, y: template?.textBox?.y || 500 })
  const [textWidth, setTextWidth] = useState(template?.textBox?.width || 1180)
  const [textBoxHeight, setTextBoxHeight] = useState(150) // Dynamic based on text

  // Text styling
  const [fontFamily, setFontFamily] = useState(template?.textBox?.fontFamily || "Impact")
  const [fontSize, setFontSize] = useState(template?.textBox?.fontSize || 72)
  const [fontColor, setFontColor] = useState(template?.textBox?.fontColor || "#FFFFFF")
  const [textAlign, setTextAlign] = useState<"left" | "center" | "right">(template?.textBox?.textAlign || "center")
  const [shadowEnabled, setShadowEnabled] = useState(template?.textBox?.shadow?.enabled ?? true)
  const [shadowColor, setShadowColor] = useState(template?.textBox?.shadow?.color || "#000000")
  const [shadowBlur, setShadowBlur] = useState(template?.textBox?.shadow?.blur || 6)
  const [outlineEnabled, setOutlineEnabled] = useState(template?.textBox?.outline?.enabled ?? true)
  const [outlineColor, setOutlineColor] = useState(template?.textBox?.outline?.color || "#000000")
  const [outlineWidth, setOutlineWidth] = useState(template?.textBox?.outline?.width || 3)

  // Sample text for preview
  const [sampleText, setSampleText] = useState("Sample Title Preview")

  // Images
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null)
  const [overlayImage, setOverlayImage] = useState<HTMLImageElement | null>(null)

  // Drag state
  const [dragging, setDragging] = useState<"overlay" | "text" | null>(null)
  const [resizing, setResizing] = useState<"overlay" | "text" | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })

  // Loading
  const [loadingBg, setLoadingBg] = useState(false)
  const [saving, setSaving] = useState(false)

  // Load background image
  const loadBackground = useCallback(async () => {
    setLoadingBg(true)
    try {
      const res = await fetch(`/api/images/random?folder=${bgFolder}`)
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const img = new Image()
        img.onload = () => {
          setBgImage(img)
          setLoadingBg(false)
        }
        img.src = url
      } else {
        setLoadingBg(false)
      }
    } catch {
      setLoadingBg(false)
    }
  }, [bgFolder])

  // Load overlay image
  const loadOverlay = useCallback(async () => {
    if (!overlayImg) {
      setOverlayImage(null)
      return
    }
    try {
      const res = await fetch(`/api/images/overlay?name=${overlayImg}`)
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const img = new Image()
        img.onload = () => setOverlayImage(img)
        img.src = url
      }
    } catch {
      setOverlayImage(null)
    }
  }, [overlayImg])

  // Initial load
  useEffect(() => {
    loadBackground()
  }, [loadBackground])

  useEffect(() => {
    loadOverlay()
  }, [loadOverlay])

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Clear
    ctx.fillStyle = "#1a1a1a"
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

    // Draw background
    if (bgImage) {
      ctx.drawImage(bgImage, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    }

    // Draw overlay
    if (overlayImage && overlayImg) {
      ctx.drawImage(
        overlayImage,
        overlayPos.x,
        overlayPos.y,
        overlaySize.width,
        overlaySize.height
      )

      // Draw resize handle
      ctx.fillStyle = "#00bcd4"
      ctx.fillRect(
        overlayPos.x + overlaySize.width - 10,
        overlayPos.y + overlaySize.height - 10,
        10,
        10
      )
    }

    // Draw text
    ctx.save()

    // Text settings
    ctx.font = `bold ${fontSize}px ${fontFamily}, Impact, sans-serif`
    ctx.textAlign = textAlign
    ctx.textBaseline = "top"

    // Calculate x position based on alignment
    let textX = textPos.x
    if (textAlign === "center") {
      textX = textPos.x + textWidth / 2
    } else if (textAlign === "right") {
      textX = textPos.x + textWidth
    }

    // Wrap text
    const words = sampleText.split(" ")
    const lines: string[] = []
    let currentLine = ""
    const maxWidth = textWidth - 40 // padding

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word
      const metrics = ctx.measureText(testLine)
      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine)
        currentLine = word
      } else {
        currentLine = testLine
      }
    }
    if (currentLine) lines.push(currentLine)

    const lineHeight = fontSize * 1.2

    // Draw each line
    lines.forEach((line, i) => {
      const y = textPos.y + 20 + i * lineHeight

      // Shadow
      if (shadowEnabled) {
        ctx.shadowColor = shadowColor
        ctx.shadowBlur = shadowBlur
        ctx.shadowOffsetX = 3
        ctx.shadowOffsetY = 3
      }

      // Outline
      if (outlineEnabled) {
        ctx.strokeStyle = outlineColor
        ctx.lineWidth = outlineWidth * 2
        ctx.lineJoin = "round"
        ctx.strokeText(line, textX, y)
      }

      // Fill
      ctx.shadowColor = "transparent"
      ctx.fillStyle = fontColor
      ctx.fillText(line, textX, y)
    })

    ctx.restore()

    // Draw text box border (for editing reference)
    const calculatedHeight = Math.max(100, lines.length * lineHeight + 40)
    setTextBoxHeight(calculatedHeight)
    ctx.strokeStyle = "rgba(0, 188, 212, 0.5)"
    ctx.lineWidth = 2
    ctx.setLineDash([5, 5])
    ctx.strokeRect(textPos.x, textPos.y, textWidth, textBoxHeight)
    ctx.setLineDash([])

    // Draw text resize handle (right edge)
    ctx.fillStyle = "#f97316" // orange
    ctx.fillRect(textPos.x + textWidth - 10, textPos.y + textBoxHeight / 2 - 15, 10, 30)

  }, [
    bgImage, overlayImage, overlayImg, overlayPos, overlaySize,
    textPos, textWidth, sampleText, fontFamily, fontSize, fontColor,
    textAlign, shadowEnabled, shadowColor, shadowBlur,
    outlineEnabled, outlineColor, outlineWidth
  ])

  // Get position from mouse or touch event
  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()

    let clientX: number, clientY: number
    if ('touches' in e) {
      clientX = e.touches[0]?.clientX || e.changedTouches[0]?.clientX || 0
      clientY = e.touches[0]?.clientY || e.changedTouches[0]?.clientY || 0
    } else {
      clientX = e.clientX
      clientY = e.clientY
    }

    return {
      x: (clientX - rect.left) / SCALE,
      y: (clientY - rect.top) / SCALE
    }
  }

  // Track which element is selected
  const [selected, setSelected] = useState<"overlay" | "text" | null>(null)

  const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
    if ('touches' in e) e.preventDefault()
    const pos = getPos(e)

    // Check text box resize handle FIRST (right edge - larger hit area)
    const textHandleX = textPos.x + textWidth - 30
    if (pos.x >= textHandleX && pos.x <= textPos.x + textWidth + 10 &&
        pos.y >= textPos.y && pos.y <= textPos.y + textBoxHeight) {
      setResizing("text")
      setSelected("text")
      return
    }

    // Check text box drag (rest of the text box)
    if (pos.x >= textPos.x && pos.x < textHandleX &&
        pos.y >= textPos.y && pos.y <= textPos.y + textBoxHeight) {
      setDragging("text")
      setSelected("text")
      setDragOffset({ x: pos.x - textPos.x, y: pos.y - textPos.y })
      return
    }

    // Then check overlay
    if (overlayImg && overlayImage) {
      const handleX = overlayPos.x + overlaySize.width - 10
      const handleY = overlayPos.y + overlaySize.height - 10

      // Check resize handle
      if (pos.x >= handleX && pos.x <= handleX + 25 &&
          pos.y >= handleY && pos.y <= handleY + 25) {
        setResizing("overlay")
        setSelected("overlay")
        return
      }

      // Check overlay drag
      if (pos.x >= overlayPos.x && pos.x <= overlayPos.x + overlaySize.width &&
          pos.y >= overlayPos.y && pos.y <= overlayPos.y + overlaySize.height) {
        setDragging("overlay")
        setSelected("overlay")
        setDragOffset({ x: pos.x - overlayPos.x, y: pos.y - overlayPos.y })
        return
      }
    }

    // Clicked on empty area - deselect
    setSelected(null)
  }

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!dragging && !resizing) return
    e.preventDefault()
    const pos = getPos(e)

    if (resizing === "text") {
      // Resize text width
      const newWidth = Math.max(200, Math.min(CANVAS_WIDTH - textPos.x, pos.x - textPos.x))
      setTextWidth(newWidth)
      return
    }

    if (resizing === "overlay") {
      const newWidth = Math.max(50, pos.x - overlayPos.x)
      const newHeight = Math.max(50, pos.y - overlayPos.y)
      setOverlaySize({ width: newWidth, height: newHeight })
      return
    }

    if (dragging === "overlay") {
      setOverlayPos({
        x: Math.max(0, Math.min(CANVAS_WIDTH - overlaySize.width, pos.x - dragOffset.x)),
        y: Math.max(0, Math.min(CANVAS_HEIGHT - overlaySize.height, pos.y - dragOffset.y))
      })
    } else if (dragging === "text") {
      setTextPos({
        x: Math.max(0, Math.min(CANVAS_WIDTH - textWidth, pos.x - dragOffset.x)),
        y: Math.max(0, Math.min(CANVAS_HEIGHT - 100, pos.y - dragOffset.y))
      })
    }
  }

  const handleEnd = () => {
    setDragging(null)
    setResizing(null)
  }

  // Upload overlay
  const handleOverlayUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const formData = new FormData()
    formData.append("file", file)

    try {
      const res = await fetch("/api/images", {
        method: "POST",
        body: formData
      })
      const data = await res.json()
      if (res.ok) {
        toast.success("Overlay uploaded!")
        setOverlays([...overlays, data.filename])
        setOverlayImg(data.filename)
      }
    } catch {
      toast.error("Upload failed")
    }
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  // Save template
  const handleSave = async () => {
    setSaving(true)
    const templateData: ThumbnailTemplate = {
      id: template?.id || `template_${Date.now()}`,
      name,
      backgroundImageFolder: bgFolder,
      overlayImage: overlayImg,
      overlayPosition: overlayPos,
      overlaySize: overlaySize,
      textBox: {
        x: textPos.x,
        y: textPos.y,
        width: textWidth,
        height: 200,
        fontFamily,
        fontSize,
        fontColor,
        textAlign,
        padding: { top: 20, right: 20, bottom: 20, left: 20 },
        shadow: { enabled: shadowEnabled, color: shadowColor, offsetX: 3, offsetY: 3, blur: shadowBlur },
        outline: { enabled: outlineEnabled, color: outlineColor, width: outlineWidth }
      }
    }
    onSave(templateData)
    setSaving(false)
  }

  // Download preview
  const handleDownload = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const link = document.createElement("a")
    link.download = `thumbnail_preview_${Date.now()}.png`
    link.href = canvas.toDataURL("image/png")
    link.click()
  }

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleOverlayUpload}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-64 font-medium"
            placeholder="Template name"
          />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="w-4 h-4 mr-1" />
            Download
          </Button>
          <Button onClick={handleSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-500">
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
            Save
          </Button>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Canvas */}
        <div className="lg:col-span-2">
          <div
            ref={containerRef}
            className="relative bg-black rounded-lg overflow-hidden border border-border"
            style={{
              width: CANVAS_WIDTH * SCALE,
              height: CANVAS_HEIGHT * SCALE,
              cursor: dragging || resizing ? "grabbing" : "default"
            }}
          >
            <canvas
              ref={canvasRef}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              style={{
                width: CANVAS_WIDTH * SCALE,
                height: CANVAS_HEIGHT * SCALE,
                touchAction: "none"
              }}
              onMouseDown={handleStart}
              onMouseMove={handleMove}
              onMouseUp={handleEnd}
              onMouseLeave={handleEnd}
              onTouchStart={handleStart}
              onTouchMove={handleMove}
              onTouchEnd={handleEnd}
            />
            {loadingBg && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <Loader2 className="w-8 h-8 animate-spin text-white" />
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Drag overlay/text to move. Drag corner handle to resize overlay.
          </p>
        </div>

        {/* Settings Panel */}
        <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
          {/* Background */}
          <div className="p-3 rounded-lg border border-border space-y-2">
            <Label className="text-xs font-medium flex items-center gap-2">
              <ImageIcon className="w-4 h-4" />
              Background
            </Label>
            <div className="flex gap-2">
              <Select value={bgFolder} onValueChange={setBgFolder}>
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {imageFolders.map(f => (
                    <SelectItem key={f.name} value={f.name}>
                      {f.name} ({f.imageCount})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" onClick={loadBackground} disabled={loadingBg}>
                <RefreshCw className={`w-4 h-4 ${loadingBg ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          {/* Overlay */}
          <div className="p-3 rounded-lg border border-border space-y-2">
            <Label className="text-xs font-medium flex items-center gap-2">
              <ImageIcon className="w-4 h-4" />
              Overlay Image
            </Label>
            <div className="flex gap-2">
              <Select value={overlayImg || "none"} onValueChange={v => setOverlayImg(v === "none" ? "" : v)}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="No overlay" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No overlay</SelectItem>
                  {overlays.map(img => (
                    <SelectItem key={img} value={img}>{img}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" onClick={() => fileInputRef.current?.click()}>
                <Upload className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Sample Text */}
          <div className="p-3 rounded-lg border border-border space-y-2">
            <Label className="text-xs font-medium flex items-center gap-2">
              <Type className="w-4 h-4" />
              Preview Text
            </Label>
            <Input
              value={sampleText}
              onChange={e => setSampleText(e.target.value)}
              placeholder="Enter sample text"
            />
          </div>

          {/* Text Style */}
          <div className="p-3 rounded-lg border border-border space-y-3">
            <Label className="text-xs font-medium">Text Style</Label>
            <div className="grid grid-cols-2 gap-2">
              <Select value={fontFamily} onValueChange={setFontFamily}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Impact">Impact</SelectItem>
                  <SelectItem value="Arial Black">Arial Black</SelectItem>
                  <SelectItem value="Verdana">Verdana</SelectItem>
                  <SelectItem value="Georgia">Georgia</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                value={fontSize}
                onChange={e => setFontSize(parseInt(e.target.value) || 48)}
                className="w-full"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Color</Label>
                <Input
                  type="color"
                  value={fontColor}
                  onChange={e => setFontColor(e.target.value)}
                  className="h-9 p-1 mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Align</Label>
                <Select value={textAlign} onValueChange={(v: "left" | "center" | "right") => setTextAlign(v)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="left">Left</SelectItem>
                    <SelectItem value="center">Center</SelectItem>
                    <SelectItem value="right">Right</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Text Width</Label>
              <Input
                type="number"
                value={textWidth}
                onChange={e => setTextWidth(parseInt(e.target.value) || 1180)}
                className="mt-1"
              />
            </div>
          </div>

          {/* Shadow */}
          <div className="p-3 rounded-lg border border-border space-y-2">
            <Label className="text-xs font-medium flex items-center gap-2">
              <input
                type="checkbox"
                checked={shadowEnabled}
                onChange={e => setShadowEnabled(e.target.checked)}
                className="rounded"
              />
              Shadow
            </Label>
            {shadowEnabled && (
              <div className="flex gap-2">
                <Input
                  type="color"
                  value={shadowColor}
                  onChange={e => setShadowColor(e.target.value)}
                  className="w-12 h-8 p-0.5"
                />
                <Input
                  type="number"
                  value={shadowBlur}
                  onChange={e => setShadowBlur(parseInt(e.target.value) || 0)}
                  placeholder="Blur"
                  className="flex-1"
                />
              </div>
            )}
          </div>

          {/* Outline */}
          <div className="p-3 rounded-lg border border-border space-y-2">
            <Label className="text-xs font-medium flex items-center gap-2">
              <input
                type="checkbox"
                checked={outlineEnabled}
                onChange={e => setOutlineEnabled(e.target.checked)}
                className="rounded"
              />
              Outline
            </Label>
            {outlineEnabled && (
              <div className="flex gap-2">
                <Input
                  type="color"
                  value={outlineColor}
                  onChange={e => setOutlineColor(e.target.value)}
                  className="w-12 h-8 p-0.5"
                />
                <Input
                  type="number"
                  value={outlineWidth}
                  onChange={e => setOutlineWidth(parseInt(e.target.value) || 0)}
                  placeholder="Width"
                  className="flex-1"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
