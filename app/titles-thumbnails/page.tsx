"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import {
  Loader2,
  Sparkles,
  Save,
  FileText,
  Image as ImageIcon,
  Check,
  Settings,
  RefreshCw
} from "lucide-react"

interface VideoSlot {
  name: string
  path: string
  hasScript: boolean
  hasTranscript: boolean
  hasTitle: boolean
  hasThumbnail: boolean
}

interface ThumbnailTemplate {
  id: string
  name: string
  backgroundImageFolder?: string
}

export default function TitlesThumbnailsPage() {
  // State - Video Slots
  const [videoSlots, setVideoSlots] = useState<VideoSlot[]>([])
  const [selectedVideoSlot, setSelectedVideoSlot] = useState<string>("")
  const [templates, setTemplates] = useState<ThumbnailTemplate[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<string>("")
  const [scriptContent, setScriptContent] = useState<string>("")
  const [loadingScript, setLoadingScript] = useState(false)

  // Title state
  const [generatedTitles, setGeneratedTitles] = useState<string[]>([])
  const [selectedTitle, setSelectedTitle] = useState<string>("")
  const [savedTitle, setSavedTitle] = useState<string>("")
  const [generatingTitles, setGeneratingTitles] = useState(false)
  const [savingTitle, setSavingTitle] = useState(false)

  // Loading states
  const [loading, setLoading] = useState(true)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [thumbnailRefreshKey, setThumbnailRefreshKey] = useState(0)

  // Load initial data
  useEffect(() => {
    loadVideoSlots()
    loadTemplates()
  }, [])

  // Load script when video slot is selected
  useEffect(() => {
    if (selectedVideoSlot) {
      loadScript()
      loadSavedTitle()
    } else {
      setScriptContent("")
      setSavedTitle("")
      setSelectedTitle("")
      setGeneratedTitles([])
    }
  }, [selectedVideoSlot])

  async function loadVideoSlots() {
    setLoadingSlots(true)
    try {
      const res = await fetch("/api/video-slots")
      const data = await res.json()
      const slots = data.slots || []
      setVideoSlots(slots)
      if (slots.length > 0 && !selectedVideoSlot) {
        setSelectedVideoSlot(slots[0].name)
      }
    } catch (error) {
      console.error("Error loading video slots:", error)
      toast.error("Failed to load video slots")
    } finally {
      setLoading(false)
      setLoadingSlots(false)
    }
  }

  async function loadTemplates() {
    try {
      const res = await fetch("/api/thumbnail-templates")
      const data = await res.json()
      const templateList = data.templates || []
      setTemplates(templateList)
      if (templateList.length > 0 && !selectedTemplate) {
        setSelectedTemplate(templateList[0].id)
      }
    } catch (error) {
      console.error("Error loading templates:", error)
    }
  }

  async function loadScript() {
    if (!selectedVideoSlot) return
    setLoadingScript(true)
    try {
      const res = await fetch(`/api/video-slots/${selectedVideoSlot}/script`)
      if (res.ok) {
        const data = await res.json()
        setScriptContent(data.script || "")
      } else {
        setScriptContent("")
      }
    } catch (error) {
      console.error("Error loading script:", error)
      setScriptContent("")
    } finally {
      setLoadingScript(false)
    }
  }

  async function loadSavedTitle() {
    if (!selectedVideoSlot) return
    try {
      const res = await fetch(`/api/video-slots/${selectedVideoSlot}/title`)
      const data = await res.json()
      if (data.title) {
        setSavedTitle(data.title)
        setSelectedTitle(data.title)
      } else {
        setSavedTitle("")
        setSelectedTitle("")
      }
    } catch (error) {
      console.error("Error loading saved title:", error)
    }
  }

  async function generateTitles() {
    if (!scriptContent) {
      toast.error("No script available to generate titles")
      return
    }

    setGeneratingTitles(true)
    setGeneratedTitles([])

    try {
      const res = await fetch("/api/titles/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: scriptContent })
      })

      const data = await res.json()

      if (data.success && data.titles) {
        setGeneratedTitles(data.titles)
        toast.success(`Generated ${data.titles.length} titles`)
      } else {
        toast.error(data.error || "Failed to generate titles")
      }
    } catch (error) {
      console.error("Error generating titles:", error)
      toast.error("Failed to generate titles")
    } finally {
      setGeneratingTitles(false)
    }
  }

  async function saveTitle(title: string) {
    if (!title || !selectedVideoSlot) return

    setSavingTitle(true)
    try {
      const res = await fetch(`/api/video-slots/${selectedVideoSlot}/title`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title })
      })

      const data = await res.json()

      if (data.success) {
        setSavedTitle(title)
        setSelectedTitle(title)
        toast.success("Title saved! Creating thumbnail...")

        // Auto generate thumbnail (don't reload slots - keeps titles list)
        await generateThumbnailAuto(title)
      } else {
        toast.error(data.error || "Failed to save title")
      }
    } catch (error) {
      console.error("Error saving title:", error)
      toast.error("Failed to save title")
    } finally {
      setSavingTitle(false)
    }
  }

  async function generateThumbnailAuto(title: string) {
    if (!selectedVideoSlot || !selectedTemplate) {
      toast.error("Select a template first")
      return
    }
    try {
      const res = await fetch(`/api/video-slots/${selectedVideoSlot}/thumbnail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          templateId: selectedTemplate
        })
      })

      const data = await res.json()

      if (data.success) {
        toast.success("Thumbnail created!")
        // Trigger thumbnail section refresh
        setThumbnailRefreshKey(prev => prev + 1)
      } else {
        toast.error(data.error || "Thumbnail failed")
      }
    } catch (error) {
      console.error("Error generating thumbnail:", error)
      toast.error("Thumbnail generation failed")
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold gradient-text">
          Titles & Thumbnails
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Generate AI titles and create thumbnails for your videos
        </p>
      </div>

      {/* Video Slot & Template Selection */}
      <Card className="glass border-white/10">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
            {/* Video Slot Selector */}
            <div className="w-full sm:w-64">
              <Label className="text-sm text-muted-foreground mb-2 block">Video Slot</Label>
              <Select value={selectedVideoSlot} onValueChange={setSelectedVideoSlot}>
                <SelectTrigger>
                  <SelectValue placeholder="Select video slot" />
                </SelectTrigger>
                <SelectContent>
                  {videoSlots.map((slot) => (
                    <SelectItem key={slot.name} value={slot.name}>
                      {slot.name} {slot.hasScript && "(has script)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Template Selector */}
            <div className="w-full sm:w-64">
              <Label className="text-sm text-muted-foreground mb-2 block">Thumbnail Template</Label>
              <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                <SelectTrigger>
                  <SelectValue placeholder="Select template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Refresh */}
            <Button
              variant="outline"
              onClick={loadVideoSlots}
              disabled={loadingSlots}
            >
              {loadingSlots ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              <span className="ml-2">Refresh</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left - Video Slots Selection */}
        <Card className="glass border-white/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <div className="w-2 h-2 rounded-full bg-cyan-400" />
              Video Slots
            </CardTitle>
            <CardDescription>Select a video slot to work with</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {loadingSlots ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : videoSlots.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No video slots found
              </div>
            ) : (
              videoSlots.map((slot) => (
                <div
                  key={slot.name}
                  onClick={() => slot.hasScript && setSelectedVideoSlot(slot.name)}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${
                    selectedVideoSlot === slot.name
                      ? "border-cyan-500 bg-cyan-500/10"
                      : slot.hasScript
                      ? "border-border hover:border-cyan-500/50"
                      : "border-border/50 opacity-50 cursor-not-allowed"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{slot.name}</span>
                    <div className="flex items-center gap-1">
                      {slot.hasScript && (
                        <Badge variant="outline" className="text-xs border-emerald-500/50 text-emerald-400">
                          <FileText className="w-3 h-3 mr-1" />
                          Script
                        </Badge>
                      )}
                      {slot.hasTitle && (
                        <Badge variant="outline" className="text-xs border-violet-500/50 text-violet-400">
                          <Check className="w-3 h-3 mr-1" />
                          Title
                        </Badge>
                      )}
                    </div>
                  </div>
                  {!slot.hasScript && (
                    <p className="text-xs text-muted-foreground mt-1">No script available</p>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Right - Script Preview & Title Generation */}
        <div className="lg:col-span-2 space-y-6">
          {/* Script Preview */}
          <Card className="glass border-white/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                Script Preview
              </CardTitle>
              <CardDescription>
                {selectedVideoSlot
                  ? `${selectedVideoSlot}`
                  : "Select a video slot to view script"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingScript ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : scriptContent ? (
                <div className="max-h-48 overflow-y-auto p-4 bg-background/50 rounded-lg border border-border">
                  <p className="text-sm whitespace-pre-wrap">{scriptContent.slice(0, 1000)}...</p>
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-8">
                  {selectedVideoSlot ? "No script found" : "Select a video slot to view script"}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Title Generation */}
          <Card className="glass border-white/10">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <div className="w-2 h-2 rounded-full bg-violet-500" />
                    Title Generation
                  </CardTitle>
                  <CardDescription>Generate and select a title for this video</CardDescription>
                </div>
                <Button
                  onClick={generateTitles}
                  disabled={!scriptContent || generatingTitles}
                  className="bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400"
                >
                  {generatingTitles ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Sparkles className="w-4 h-4 mr-2" />
                  )}
                  Create 20 Titles
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Saved Title */}
              {savedTitle && (
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                  <div className="flex items-center gap-2 text-sm text-emerald-400 mb-1">
                    <Check className="w-4 h-4" />
                    Saved Title
                  </div>
                  <p className="font-medium">{savedTitle}</p>
                </div>
              )}

              {/* Generated Titles */}
              {generatedTitles.length > 0 && (
                <div className="space-y-3">
                  <Label>Click a title to select & auto-create thumbnail ({generatedTitles.length} generated)</Label>
                  <div className="max-h-80 overflow-y-auto space-y-2">
                    {generatedTitles.map((title, index) => (
                      <div
                        key={index}
                        className={`flex items-start space-x-3 p-3 rounded-lg border transition-all cursor-pointer ${
                          savedTitle === title
                            ? "border-emerald-500 bg-emerald-500/10"
                            : selectedTitle === title
                            ? "border-violet-500 bg-violet-500/10"
                            : "border-border hover:border-violet-500/50"
                        } ${savingTitle ? "opacity-50 pointer-events-none" : ""}`}
                        onClick={() => !savingTitle && saveTitle(title)}
                      >
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 ${
                          savedTitle === title ? "border-emerald-500 bg-emerald-500" : "border-muted-foreground"
                        }`}>
                          {savedTitle === title && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <span className="text-sm flex-1">
                          <span className="text-muted-foreground mr-2">{index + 1}.</span>
                          {title}
                        </span>
                        {savingTitle && selectedTitle === title && (
                          <Loader2 className="w-4 h-4 animate-spin text-violet-500" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty State */}
              {generatedTitles.length === 0 && !generatingTitles && (
                <div className="text-center text-muted-foreground py-8">
                  <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>Click "Create 20 Titles" to generate title suggestions</p>
                </div>
              )}

              {/* Generating State */}
              {generatingTitles && (
                <div className="text-center py-8">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-violet-500" />
                  <p className="text-muted-foreground">Generating titles with AI...</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Thumbnail Section */}
          <ThumbnailSection
            selectedVideoSlot={selectedVideoSlot}
            selectedTemplate={selectedTemplate}
            savedTitle={savedTitle}
            refreshKey={thumbnailRefreshKey}
          />
        </div>
      </div>
    </div>
  )
}

// Thumbnail Section Component
function ThumbnailSection({
  selectedVideoSlot,
  selectedTemplate,
  savedTitle,
  refreshKey
}: {
  selectedVideoSlot: string
  selectedTemplate: string
  savedTitle: string
  refreshKey: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [generatingThumbnail, setGeneratingThumbnail] = useState(false)
  const [savingThumbnail, setSavingThumbnail] = useState(false)
  const [showManualEdit, setShowManualEdit] = useState(false)
  const [currentTemplateId, setCurrentTemplateId] = useState<string | null>(null)
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null)
  const [overlayImage, setOverlayImage] = useState<HTMLImageElement | null>(null)
  const [loadingBg, setLoadingBg] = useState(false)
  const [bgFolder, setBgFolder] = useState("nature")
  const [bgImagePath, setBgImagePath] = useState<string | null>(null)
  const [overlayImg, setOverlayImg] = useState("")

  // Overlay position and size from template
  const [overlayPos, setOverlayPos] = useState({ x: 50, y: 50 })
  const [overlaySize, setOverlaySize] = useState({ width: 300, height: 300 })

  // Drag/resize state
  const [dragging, setDragging] = useState(false)
  const [resizing, setResizing] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [textBoxHeight, setTextBoxHeight] = useState(150)

  // Manual edit state
  const [editSettings, setEditSettings] = useState({
    fontFamily: "Impact",
    fontSize: 72,
    fontColor: "#FFFFFF",
    textAlign: "center" as "left" | "center" | "right",
    paddingTop: 10,
    paddingRight: 20,
    paddingBottom: 10,
    paddingLeft: 20,
    positionX: 50,
    positionY: 480,
    textWidth: 1180,
    shadowEnabled: true,
    shadowColor: "#000000",
    shadowBlur: 6,
    outlineEnabled: true,
    outlineColor: "#000000",
    outlineWidth: 3
  })

  // Canvas constants
  const CANVAS_WIDTH = 1280
  const CANVAS_HEIGHT = 720
  const SCALE = 0.45 // Display smaller for mobile friendly

  // Load template when manual edit is opened
  const loadTemplate = useCallback(async () => {
    try {
      const res = await fetch("/api/thumbnail-templates")
      const data = await res.json()
      const templates = data.templates || []

      // Find template by selectedTemplate ID or first available
      let template = templates.find((t: { id: string }) => t.id === selectedTemplate)
      if (!template && templates.length > 0) {
        template = templates[0]
      }

      if (template) {
        setCurrentTemplateId(template.id)
        setBgFolder(template.backgroundImageFolder || "nature")
        setOverlayImg(template.overlayImage || "")
        // Load overlay position and size from template
        setOverlayPos(template.overlayPosition || { x: 50, y: 50 })
        setOverlaySize(template.overlaySize || { width: 300, height: 300 })
        setEditSettings({
          fontFamily: template.textBox?.fontFamily || "Impact",
          fontSize: template.textBox?.fontSize || 72,
          fontColor: template.textBox?.fontColor || "#FFFFFF",
          textAlign: template.textBox?.textAlign || "center",
          paddingTop: template.textBox?.padding?.top || 10,
          paddingRight: template.textBox?.padding?.right || 20,
          paddingBottom: template.textBox?.padding?.bottom || 10,
          paddingLeft: template.textBox?.padding?.left || 20,
          positionX: template.textBox?.x || 50,
          positionY: template.textBox?.y || 480,
          textWidth: template.textBox?.width || 1180,
          shadowEnabled: template.textBox?.shadow?.enabled ?? true,
          shadowColor: template.textBox?.shadow?.color || "#000000",
          shadowBlur: template.textBox?.shadow?.blur || 6,
          outlineEnabled: template.textBox?.outline?.enabled ?? true,
          outlineColor: template.textBox?.outline?.color || "#000000",
          outlineWidth: template.textBox?.outline?.width || 3
        })
      }
    } catch (error) {
      console.error("Error loading template:", error)
    }
  }, [selectedTemplate])

  // Load background image for preview
  const loadBackground = useCallback(async () => {
    if (!showManualEdit) return
    setLoadingBg(true)
    try {
      const res = await fetch(`/api/images/random?folder=${bgFolder}`)
      if (res.ok) {
        // Get image path from header
        const imagePath = res.headers.get("X-Image-Path")
        if (imagePath) {
          setBgImagePath(imagePath)
        }
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
  }, [bgFolder, showManualEdit])

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

  // Load template ONLY when manual edit first opens (not on every render)
  const [templateLoaded, setTemplateLoaded] = useState(false)
  useEffect(() => {
    if (showManualEdit && !templateLoaded) {
      loadTemplate()
      setTemplateLoaded(true)
    }
    if (!showManualEdit) {
      setTemplateLoaded(false)
    }
  }, [showManualEdit, templateLoaded, loadTemplate])

  useEffect(() => {
    if (showManualEdit) {
      loadBackground()
    }
  }, [showManualEdit, bgFolder, loadBackground])

  useEffect(() => {
    if (showManualEdit) {
      loadOverlay()
    }
  }, [showManualEdit, overlayImg, loadOverlay])

  // Draw canvas preview
  useEffect(() => {
    if (!showManualEdit) return
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

    // Draw overlay with template position and size
    if (overlayImage && overlayImg) {
      ctx.drawImage(
        overlayImage,
        overlayPos.x,
        overlayPos.y,
        overlaySize.width,
        overlaySize.height
      )
    }

    // Draw text with effects
    if (savedTitle) {
      ctx.save()
      ctx.font = `bold ${editSettings.fontSize}px ${editSettings.fontFamily}, Impact, sans-serif`
      ctx.textAlign = editSettings.textAlign
      ctx.textBaseline = "top"

      // Calculate x position based on alignment
      let textX = editSettings.positionX
      if (editSettings.textAlign === "center") {
        textX = editSettings.positionX + editSettings.textWidth / 2
      } else if (editSettings.textAlign === "right") {
        textX = editSettings.positionX + editSettings.textWidth
      }

      // Wrap text
      const words = savedTitle.split(" ")
      const lines: string[] = []
      let currentLine = ""
      const maxWidth = editSettings.textWidth - editSettings.paddingLeft - editSettings.paddingRight

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

      const lineHeight = editSettings.fontSize * 1.2

      // Draw each line
      lines.forEach((line, i) => {
        const y = editSettings.positionY + editSettings.paddingTop + i * lineHeight

        // Shadow
        if (editSettings.shadowEnabled) {
          ctx.shadowColor = editSettings.shadowColor
          ctx.shadowBlur = editSettings.shadowBlur
          ctx.shadowOffsetX = 3
          ctx.shadowOffsetY = 3
        }

        // Outline
        if (editSettings.outlineEnabled) {
          ctx.strokeStyle = editSettings.outlineColor
          ctx.lineWidth = editSettings.outlineWidth * 2
          ctx.lineJoin = "round"
          ctx.strokeText(line, textX, y)
        }

        // Fill
        ctx.shadowColor = "transparent"
        ctx.fillStyle = editSettings.fontColor
        ctx.fillText(line, textX, y)
      })

      ctx.restore()

      // Calculate text box height
      const calculatedHeight = Math.max(100, lines.length * lineHeight + editSettings.paddingTop + editSettings.paddingBottom)
      setTextBoxHeight(calculatedHeight)

      // Draw text box border
      ctx.strokeStyle = "rgba(0, 188, 212, 0.7)"
      ctx.lineWidth = 2
      ctx.setLineDash([5, 5])
      ctx.strokeRect(
        editSettings.positionX,
        editSettings.positionY,
        editSettings.textWidth,
        calculatedHeight
      )
      ctx.setLineDash([])

      // Draw resize handle (right middle)
      ctx.fillStyle = "#f97316" // orange
      const handleHeight = 40
      const handleWidth = 12
      ctx.fillRect(
        editSettings.positionX + editSettings.textWidth - handleWidth / 2,
        editSettings.positionY + calculatedHeight / 2 - handleHeight / 2,
        handleWidth,
        handleHeight
      )
    }
  }, [
    showManualEdit, bgImage, overlayImage, overlayImg, overlayPos, overlaySize, savedTitle, editSettings
  ])

  // Get canvas position from mouse/touch event
  const getCanvasPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const scaleX = CANVAS_WIDTH / rect.width
    const scaleY = CANVAS_HEIGHT / rect.height

    let clientX: number, clientY: number
    if ('touches' in e) {
      clientX = e.touches[0]?.clientX || e.changedTouches[0]?.clientX || 0
      clientY = e.touches[0]?.clientY || e.changedTouches[0]?.clientY || 0
    } else {
      clientX = e.clientX
      clientY = e.clientY
    }

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    }
  }

  // Handle mouse/touch start
  const handleCanvasStart = (e: React.MouseEvent | React.TouchEvent) => {
    if ('touches' in e) e.preventDefault()
    const pos = getCanvasPos(e)

    // Check if clicking on resize handle (right middle)
    const handleWidth = 12
    const handleHeight = 40
    const handleX = editSettings.positionX + editSettings.textWidth - handleWidth / 2
    const handleY = editSettings.positionY + textBoxHeight / 2 - handleHeight / 2
    if (pos.x >= handleX - 10 && pos.x <= handleX + handleWidth + 10 &&
        pos.y >= handleY - 10 && pos.y <= handleY + handleHeight + 10) {
      setResizing(true)
      return
    }

    // Check if clicking inside text box for dragging
    if (pos.x >= editSettings.positionX && pos.x <= editSettings.positionX + editSettings.textWidth &&
        pos.y >= editSettings.positionY && pos.y <= editSettings.positionY + textBoxHeight) {
      setDragging(true)
      setDragOffset({
        x: pos.x - editSettings.positionX,
        y: pos.y - editSettings.positionY
      })
    }
  }

  // Handle mouse/touch move
  const handleCanvasMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!dragging && !resizing) return
    e.preventDefault()
    const pos = getCanvasPos(e)

    if (resizing) {
      // Resize text width
      const newWidth = Math.max(200, Math.min(CANVAS_WIDTH - editSettings.positionX, pos.x - editSettings.positionX))
      setEditSettings(prev => ({ ...prev, textWidth: Math.round(newWidth) }))
    } else if (dragging) {
      // Drag text box
      const newX = Math.max(0, Math.min(CANVAS_WIDTH - editSettings.textWidth, pos.x - dragOffset.x))
      const newY = Math.max(0, Math.min(CANVAS_HEIGHT - textBoxHeight, pos.y - dragOffset.y))
      setEditSettings(prev => ({
        ...prev,
        positionX: Math.round(newX),
        positionY: Math.round(newY)
      }))
    }
  }

  // Handle mouse/touch end
  const handleCanvasEnd = () => {
    setDragging(false)
    setResizing(false)
  }

  // Load existing thumbnail on slot change or when refreshKey changes
  useEffect(() => {
    if (selectedVideoSlot) {
      checkExistingThumbnail()
    } else {
      setThumbnailUrl(null)
    }
  }, [selectedVideoSlot, refreshKey])

  async function checkExistingThumbnail() {
    try {
      const res = await fetch(`/api/video-slots/${selectedVideoSlot}/thumbnail`)
      if (res.ok && res.headers.get("Content-Type")?.includes("image")) {
        setThumbnailUrl(`/api/video-slots/${selectedVideoSlot}/thumbnail?t=${Date.now()}`)
      } else {
        setThumbnailUrl(null)
      }
    } catch {
      setThumbnailUrl(null)
    }
  }

  async function generateThumbnail() {
    if (!savedTitle) {
      toast.error("Please save a title first")
      return
    }
    if (!selectedVideoSlot || !selectedTemplate) {
      toast.error("Select a video slot and template first")
      return
    }

    setGeneratingThumbnail(true)
    try {
      const res = await fetch(`/api/video-slots/${selectedVideoSlot}/thumbnail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: savedTitle,
          templateId: selectedTemplate
        })
      })

      const data = await res.json()

      if (data.success) {
        setThumbnailUrl(`/api/video-slots/${selectedVideoSlot}/thumbnail?t=${Date.now()}`)
        toast.success("Thumbnail created!")
      } else {
        toast.error(data.error || "Failed to create thumbnail")
      }
    } catch (error) {
      console.error("Error generating thumbnail:", error)
      toast.error("Failed to create thumbnail")
    } finally {
      setGeneratingThumbnail(false)
    }
  }

  // Save settings to template
  async function saveToTemplate() {
    if (!currentTemplateId) {
      toast.error("No template to save to")
      return
    }

    try {
      // Load current templates
      const res = await fetch("/api/thumbnail-templates")
      const data = await res.json()
      const templates = data.templates || []

      // Find and update the template
      const templateIndex = templates.findIndex((t: { id: string }) => t.id === currentTemplateId)
      if (templateIndex === -1) {
        toast.error("Template not found")
        return
      }

      templates[templateIndex] = {
        ...templates[templateIndex],
        backgroundImageFolder: bgFolder,
        overlayImage: overlayImg,
        overlayPosition: overlayPos,
        overlaySize: overlaySize,
        textBox: {
          x: editSettings.positionX,
          y: editSettings.positionY,
          width: editSettings.textWidth,
          height: 200,
          fontFamily: editSettings.fontFamily,
          fontSize: editSettings.fontSize,
          fontColor: editSettings.fontColor,
          textAlign: editSettings.textAlign,
          padding: {
            top: editSettings.paddingTop,
            right: editSettings.paddingRight,
            bottom: editSettings.paddingBottom,
            left: editSettings.paddingLeft
          },
          shadow: {
            enabled: editSettings.shadowEnabled,
            color: editSettings.shadowColor,
            offsetX: 3,
            offsetY: 3,
            blur: editSettings.shadowBlur
          },
          outline: {
            enabled: editSettings.outlineEnabled,
            color: editSettings.outlineColor,
            width: editSettings.outlineWidth
          }
        }
      }

      // Save templates
      const saveRes = await fetch("/api/thumbnail-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templates })
      })

      if (saveRes.ok) {
        toast.success("Template saved!")
      } else {
        toast.error("Failed to save template")
      }
    } catch (error) {
      console.error("Error saving template:", error)
      toast.error("Failed to save template")
    }
  }

  async function applyManualEdit() {
    if (!savedTitle) {
      toast.error("No title to apply")
      return
    }
    if (!selectedVideoSlot) {
      toast.error("No video slot selected")
      return
    }

    const canvas = canvasRef.current
    if (!canvas) {
      toast.error("Canvas not found")
      return
    }

    setSavingThumbnail(true)
    try {
      // Get canvas image as base64 (without the border/handle - redraw clean version)
      const cleanCanvas = document.createElement("canvas")
      cleanCanvas.width = CANVAS_WIDTH
      cleanCanvas.height = CANVAS_HEIGHT
      const ctx = cleanCanvas.getContext("2d")
      if (!ctx) {
        toast.error("Cannot create canvas context")
        return
      }

      // Draw background
      if (bgImage) {
        ctx.drawImage(bgImage, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
      } else {
        ctx.fillStyle = "#1a1a1a"
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
      }

      // Draw overlay
      if (overlayImage && overlayImg) {
        ctx.drawImage(overlayImage, overlayPos.x, overlayPos.y, overlaySize.width, overlaySize.height)
      }

      // Draw text
      ctx.save()
      ctx.font = `bold ${editSettings.fontSize}px ${editSettings.fontFamily}, Impact, sans-serif`
      ctx.textAlign = editSettings.textAlign
      ctx.textBaseline = "top"

      let textX = editSettings.positionX
      if (editSettings.textAlign === "center") {
        textX = editSettings.positionX + editSettings.textWidth / 2
      } else if (editSettings.textAlign === "right") {
        textX = editSettings.positionX + editSettings.textWidth
      }

      // Wrap text
      const words = savedTitle.split(" ")
      const lines: string[] = []
      let currentLine = ""
      const maxWidth = editSettings.textWidth - editSettings.paddingLeft - editSettings.paddingRight

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

      const lineHeight = editSettings.fontSize * 1.2

      lines.forEach((line, i) => {
        const y = editSettings.positionY + editSettings.paddingTop + i * lineHeight

        if (editSettings.shadowEnabled) {
          ctx.shadowColor = editSettings.shadowColor
          ctx.shadowBlur = editSettings.shadowBlur
          ctx.shadowOffsetX = 3
          ctx.shadowOffsetY = 3
        }

        if (editSettings.outlineEnabled) {
          ctx.strokeStyle = editSettings.outlineColor
          ctx.lineWidth = editSettings.outlineWidth * 2
          ctx.lineJoin = "round"
          ctx.strokeText(line, textX, y)
        }

        ctx.shadowColor = "transparent"
        ctx.fillStyle = editSettings.fontColor
        ctx.fillText(line, textX, y)
      })

      ctx.restore()

      // Get image data
      const imageData = cleanCanvas.toDataURL("image/png")

      // Send to server
      const res = await fetch(`/api/video-slots/${selectedVideoSlot}/thumbnail/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageData })
      })

      const data = await res.json()

      if (data.success) {
        const newUrl = `/api/video-slots/${selectedVideoSlot}/thumbnail?t=${Date.now()}`
        setThumbnailUrl(newUrl)
        toast.success("Thumbnail saved!")
        setTimeout(() => setShowManualEdit(false), 100)
      } else {
        toast.error(data.error || "Failed to save thumbnail")
      }
    } catch (error) {
      console.error("Error updating thumbnail:", error)
      toast.error("Failed to update thumbnail")
    } finally {
      setSavingThumbnail(false)
    }
  }

  const canGenerate = selectedVideoSlot && selectedTemplate && savedTitle

  return (
    <Card className="glass border-white/10">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <div className="w-2 h-2 rounded-full bg-pink-500" />
              Thumbnail
            </CardTitle>
            <CardDescription>
              {thumbnailUrl ? "Edit or regenerate thumbnail" : "Create thumbnail for this video"}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={generateThumbnail}
              disabled={!canGenerate || generatingThumbnail}
              className="bg-gradient-to-r from-pink-600 to-violet-600 hover:from-pink-500 hover:to-violet-500"
            >
              {generatingThumbnail ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <ImageIcon className="w-4 h-4 mr-2" />
              )}
              {thumbnailUrl ? "Regenerate" : "Create Thumbnail"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Thumbnail Preview */}
        {thumbnailUrl ? (
          <div className="space-y-4">
            <div className="rounded-lg overflow-hidden border border-border">
              <img
                key={thumbnailUrl}
                src={thumbnailUrl}
                alt="Thumbnail Preview"
                className="w-full h-auto"
                style={{ maxHeight: "400px", objectFit: "contain" }}
                onError={(e) => {
                  // Retry loading once on error
                  const target = e.target as HTMLImageElement
                  if (!target.dataset.retried) {
                    target.dataset.retried = "true"
                    target.src = thumbnailUrl + "&retry=1"
                  }
                }}
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                onClick={() => setShowManualEdit(!showManualEdit)}
                className="border-pink-500/30 text-pink-400 hover:bg-pink-500/10"
              >
                <Settings className="w-4 h-4 mr-2" />
                Manual Edit
              </Button>
              <Button
                variant="outline"
                onClick={() => window.open("https://www.canva.com", "_blank")}
                className="border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
              >
                <ImageIcon className="w-4 h-4 mr-2" />
                Open Canva
              </Button>
              <a
                href={thumbnailUrl}
                download={`thumbnail_${selectedVideoSlot}.png`}
                className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 h-10 px-4"
              >
                <Save className="w-4 h-4 mr-2" />
                Download
              </a>
            </div>

            {/* Manual Edit Panel */}
            {showManualEdit && (
              <div className="p-4 rounded-lg border border-pink-500/30 bg-pink-500/5 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-pink-400">Manual Edit Mode</h4>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadBackground}
                    disabled={loadingBg}
                    className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                  >
                    <RefreshCw className={`w-4 h-4 mr-1 ${loadingBg ? "animate-spin" : ""}`} />
                    New Background
                  </Button>
                </div>

                {/* Live Canvas Preview */}
                <div
                  className="relative rounded-lg overflow-hidden border border-cyan-500/30 bg-black"
                  style={{ cursor: dragging ? "grabbing" : resizing ? "se-resize" : "default" }}
                >
                  <canvas
                    ref={canvasRef}
                    width={CANVAS_WIDTH}
                    height={CANVAS_HEIGHT}
                    style={{
                      width: "100%",
                      height: "auto",
                      maxHeight: "350px",
                      objectFit: "contain",
                      touchAction: "none"
                    }}
                    onMouseDown={handleCanvasStart}
                    onMouseMove={handleCanvasMove}
                    onMouseUp={handleCanvasEnd}
                    onMouseLeave={handleCanvasEnd}
                    onTouchStart={handleCanvasStart}
                    onTouchMove={handleCanvasMove}
                    onTouchEnd={handleCanvasEnd}
                  />
                  {loadingBg && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <Loader2 className="w-8 h-8 animate-spin text-white" />
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground text-center">Drag text box to move, drag orange handle on right to resize width</p>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {/* Font Family */}
                  <div>
                    <Label className="text-xs">Font</Label>
                    <Select
                      value={editSettings.fontFamily}
                      onValueChange={(v) => setEditSettings({ ...editSettings, fontFamily: v })}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Impact">Impact</SelectItem>
                        <SelectItem value="Arial Black">Arial Black</SelectItem>
                        <SelectItem value="Verdana">Verdana</SelectItem>
                        <SelectItem value="Georgia">Georgia</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Font Size */}
                  <div>
                    <Label className="text-xs">Size</Label>
                    <Input
                      type="number"
                      value={editSettings.fontSize}
                      onChange={(e) =>
                        setEditSettings({ ...editSettings, fontSize: parseInt(e.target.value) || 72 })
                      }
                      className="mt-1"
                    />
                  </div>

                  {/* Font Color */}
                  <div>
                    <Label className="text-xs">Color</Label>
                    <Input
                      type="color"
                      value={editSettings.fontColor}
                      onChange={(e) => setEditSettings({ ...editSettings, fontColor: e.target.value })}
                      className="mt-1 h-10 p-1"
                    />
                  </div>

                  {/* Text Align */}
                  <div>
                    <Label className="text-xs">Align</Label>
                    <Select
                      value={editSettings.textAlign}
                      onValueChange={(v: "left" | "center" | "right") =>
                        setEditSettings({ ...editSettings, textAlign: v })
                      }
                    >
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

                {/* Position & Width */}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label className="text-xs">Position X</Label>
                    <Input
                      type="number"
                      value={editSettings.positionX}
                      onChange={(e) =>
                        setEditSettings({ ...editSettings, positionX: parseInt(e.target.value) || 0 })
                      }
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Position Y</Label>
                    <Input
                      type="number"
                      value={editSettings.positionY}
                      onChange={(e) =>
                        setEditSettings({ ...editSettings, positionY: parseInt(e.target.value) || 0 })
                      }
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Text Width</Label>
                    <Input
                      type="number"
                      value={editSettings.textWidth}
                      onChange={(e) =>
                        setEditSettings({ ...editSettings, textWidth: parseInt(e.target.value) || 1180 })
                      }
                      className="mt-1"
                    />
                  </div>
                </div>

                {/* Shadow & Outline */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={editSettings.shadowEnabled}
                        onChange={(e) =>
                          setEditSettings({ ...editSettings, shadowEnabled: e.target.checked })
                        }
                        className="rounded"
                      />
                      Shadow
                    </Label>
                    {editSettings.shadowEnabled && (
                      <div className="flex gap-2">
                        <Input
                          type="color"
                          value={editSettings.shadowColor}
                          onChange={(e) =>
                            setEditSettings({ ...editSettings, shadowColor: e.target.value })
                          }
                          className="w-12 h-8 p-1"
                        />
                        <Input
                          type="number"
                          placeholder="Blur"
                          value={editSettings.shadowBlur}
                          onChange={(e) =>
                            setEditSettings({ ...editSettings, shadowBlur: parseInt(e.target.value) || 0 })
                          }
                          className="w-20"
                        />
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={editSettings.outlineEnabled}
                        onChange={(e) =>
                          setEditSettings({ ...editSettings, outlineEnabled: e.target.checked })
                        }
                        className="rounded"
                      />
                      Outline
                    </Label>
                    {editSettings.outlineEnabled && (
                      <div className="flex gap-2">
                        <Input
                          type="color"
                          value={editSettings.outlineColor}
                          onChange={(e) =>
                            setEditSettings({ ...editSettings, outlineColor: e.target.value })
                          }
                          className="w-12 h-8 p-1"
                        />
                        <Input
                          type="number"
                          placeholder="Width"
                          value={editSettings.outlineWidth}
                          onChange={(e) =>
                            setEditSettings({ ...editSettings, outlineWidth: parseInt(e.target.value) || 0 })
                          }
                          className="w-20"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 flex-wrap">
                  <Button
                    onClick={applyManualEdit}
                    disabled={savingThumbnail}
                    className="flex-1 bg-pink-600 hover:bg-pink-500"
                  >
                    {savingThumbnail ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Check className="w-4 h-4 mr-2" />
                    )}
                    Apply & Generate
                  </Button>
                  <Button
                    onClick={() => {
                      const canvas = canvasRef.current
                      if (!canvas) return
                      const link = document.createElement("a")
                      link.download = `manual_preview_${Date.now()}.png`
                      link.href = canvas.toDataURL("image/png")
                      link.click()
                    }}
                    variant="outline"
                    className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    Download Preview
                  </Button>
                  <Button
                    onClick={saveToTemplate}
                    variant="outline"
                    className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    Save to Template
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center text-muted-foreground py-8">
            <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
            {canGenerate ? (
              <p>Click "Create Thumbnail" to generate</p>
            ) : (
              <>
                <p>Save a title first to create thumbnail</p>
                <p className="text-xs mt-1">You can also create a template in Settings</p>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
