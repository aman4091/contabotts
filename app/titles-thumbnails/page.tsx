"use client"

import { useState, useEffect } from "react"
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
  RefreshCw,
  FolderOpen,
  Palette
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
}

export default function TitlesThumbnailsPage() {
  const [slots, setSlots] = useState<VideoSlot[]>([])
  const [templates, setTemplates] = useState<ThumbnailTemplate[]>([])
  const [selectedSlot, setSelectedSlot] = useState<string>("")
  const [selectedTemplate, setSelectedTemplate] = useState<string>("")
  const [scriptContent, setScriptContent] = useState<string>("")
  const [loadingScript, setLoadingScript] = useState(false)
  const [loading, setLoading] = useState(true)

  // Title state
  const [generatedTitles, setGeneratedTitles] = useState<string[]>([])
  const [selectedTitle, setSelectedTitle] = useState<string>("")
  const [savedTitle, setSavedTitle] = useState<string>("")
  const [customTitle, setCustomTitle] = useState<string>("")
  const [generatingTitles, setGeneratingTitles] = useState(false)
  const [savingTitle, setSavingTitle] = useState(false)
  const [generatingThumbnail, setGeneratingThumbnail] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (selectedSlot) {
      loadSlotData()
    }
  }, [selectedSlot])

  async function loadData() {
    setLoading(true)
    try {
      // Load video slots
      const slotsRes = await fetch("/api/video-slots")
      const slotsData = await slotsRes.json()
      setSlots(slotsData.slots || [])

      // Load templates
      const templatesRes = await fetch("/api/thumbnail-templates")
      const templatesData = await templatesRes.json()
      setTemplates(templatesData.templates || [])

      // Set default template if available
      if (templatesData.templates?.length > 0) {
        setSelectedTemplate(templatesData.templates[0].id)
      }
    } catch (error) {
      console.error("Error loading data:", error)
      toast.error("Failed to load data")
    } finally {
      setLoading(false)
    }
  }

  async function loadSlotData() {
    setLoadingScript(true)
    setScriptContent("")
    setSavedTitle("")
    setSelectedTitle("")
    setGeneratedTitles([])

    try {
      // Load script
      const scriptRes = await fetch(`/api/video-slots/${selectedSlot}/script`)
      if (scriptRes.ok) {
        const text = await scriptRes.text()
        setScriptContent(text)
      }

      // Load saved title
      const titleRes = await fetch(`/api/video-slots/${selectedSlot}/title`)
      if (titleRes.ok) {
        const data = await titleRes.json()
        if (data.title) {
          setSavedTitle(data.title)
          setSelectedTitle(data.title)
        }
      }
    } catch (error) {
      console.error("Error loading slot data:", error)
    } finally {
      setLoadingScript(false)
    }
  }

  async function generateTitles() {
    if (!scriptContent) {
      toast.error("No script available")
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
      toast.error("Failed to generate titles")
    } finally {
      setGeneratingTitles(false)
    }
  }

  async function saveTitle(title: string) {
    if (!title || !selectedSlot) return

    setSavingTitle(true)
    try {
      const res = await fetch(`/api/video-slots/${selectedSlot}/title`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title })
      })

      const data = await res.json()
      if (data.success) {
        setSavedTitle(title)
        setSelectedTitle(title)
        toast.success("Title saved!")

        // Update slot status
        setSlots(prev => prev.map(s =>
          s.name === selectedSlot ? { ...s, hasTitle: true } : s
        ))
      } else {
        toast.error(data.error || "Failed to save title")
      }
    } catch (error) {
      toast.error("Failed to save title")
    } finally {
      setSavingTitle(false)
    }
  }

  async function generateThumbnail() {
    if (!selectedSlot || !savedTitle) {
      toast.error("Select a slot and save a title first")
      return
    }

    if (!selectedTemplate) {
      toast.error("Select a template")
      return
    }

    setGeneratingThumbnail(true)
    try {
      const res = await fetch(`/api/video-slots/${selectedSlot}/thumbnail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: savedTitle,
          templateId: selectedTemplate
        })
      })

      const data = await res.json()
      if (data.success) {
        toast.success("Thumbnail created!")
        setSlots(prev => prev.map(s =>
          s.name === selectedSlot ? { ...s, hasThumbnail: true } : s
        ))
      } else {
        toast.error(data.error || "Failed to create thumbnail")
      }
    } catch (error) {
      toast.error("Failed to create thumbnail")
    } finally {
      setGeneratingThumbnail(false)
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold gradient-text">
            Titles & Thumbnails
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Generate AI titles and create thumbnails for your videos
          </p>
        </div>
        <Button variant="outline" onClick={loadData}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Template & Slot Selection */}
      <Card className="glass border-white/10">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Video Slot Selector */}
            <div className="flex-1">
              <Label className="text-sm text-muted-foreground mb-2 block">
                <FolderOpen className="w-4 h-4 inline mr-1" />
                Video Slot
              </Label>
              <Select value={selectedSlot} onValueChange={setSelectedSlot}>
                <SelectTrigger>
                  <SelectValue placeholder="Select video slot" />
                </SelectTrigger>
                <SelectContent>
                  {slots.map((slot) => (
                    <SelectItem key={slot.name} value={slot.name}>
                      <div className="flex items-center gap-2">
                        <span>{slot.name}</span>
                        {slot.hasScript && (
                          <Badge variant="outline" className="text-xs">Script</Badge>
                        )}
                        {slot.hasTitle && (
                          <Badge variant="outline" className="text-xs text-violet-400">Title</Badge>
                        )}
                        {slot.hasThumbnail && (
                          <Badge variant="outline" className="text-xs text-emerald-400">Thumb</Badge>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Template Selector */}
            <div className="flex-1">
              <Label className="text-sm text-muted-foreground mb-2 block">
                <Palette className="w-4 h-4 inline mr-1" />
                Thumbnail Template
              </Label>
              <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                <SelectTrigger>
                  <SelectValue placeholder="Select template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.length === 0 ? (
                    <SelectItem value="none" disabled>
                      No templates - Create one in Settings
                    </SelectItem>
                  ) : (
                    templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Content */}
      {selectedSlot && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left - Script & Title Generation */}
          <div className="space-y-6">
            {/* Script Preview */}
            <Card className="glass border-white/10">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileText className="w-5 h-5 text-emerald-400" />
                  Script Preview
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingScript ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                ) : scriptContent ? (
                  <div className="max-h-48 overflow-y-auto p-4 bg-background/50 rounded-lg border border-border">
                    <p className="text-sm whitespace-pre-wrap">{scriptContent.slice(0, 1500)}...</p>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">No script found</p>
                )}

                {scriptContent && (
                  <Button
                    onClick={generateTitles}
                    disabled={generatingTitles}
                    className="w-full mt-4 bg-gradient-to-r from-violet-600 to-cyan-500"
                  >
                    {generatingTitles ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Sparkles className="w-4 h-4 mr-2" />
                    )}
                    Generate Titles with AI
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Generated Titles */}
            {generatedTitles.length > 0 && (
              <Card className="glass border-white/10">
                <CardHeader>
                  <CardTitle className="text-lg">Generated Titles</CardTitle>
                  <CardDescription>Click to select, then save</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {generatedTitles.map((title, idx) => (
                    <div
                      key={idx}
                      onClick={() => setSelectedTitle(title)}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${
                        selectedTitle === title
                          ? "border-cyan-500 bg-cyan-500/10"
                          : "border-border hover:border-cyan-500/50"
                      }`}
                    >
                      <p className="text-sm">{title}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right - Title & Thumbnail */}
          <div className="space-y-6">
            {/* Title Input */}
            <Card className="glass border-white/10">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileText className="w-5 h-5 text-violet-400" />
                  Video Title
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {savedTitle && (
                  <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                    <div className="flex items-center gap-2 mb-1">
                      <Check className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs text-emerald-400">Saved Title</span>
                    </div>
                    <p className="text-sm">{savedTitle}</p>
                  </div>
                )}

                <div>
                  <Label className="text-sm text-muted-foreground mb-2 block">
                    {selectedTitle ? "Selected Title" : "Custom Title"}
                  </Label>
                  <Input
                    value={selectedTitle || customTitle}
                    onChange={(e) => {
                      setSelectedTitle("")
                      setCustomTitle(e.target.value)
                    }}
                    placeholder="Enter or select a title..."
                  />
                </div>

                <Button
                  onClick={() => saveTitle(selectedTitle || customTitle)}
                  disabled={savingTitle || (!selectedTitle && !customTitle)}
                  className="w-full"
                >
                  {savingTitle ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Save className="w-4 h-4 mr-2" />
                  )}
                  Save Title
                </Button>
              </CardContent>
            </Card>

            {/* Thumbnail Generation */}
            <Card className="glass border-white/10">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ImageIcon className="w-5 h-5 text-cyan-400" />
                  Thumbnail
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {!savedTitle ? (
                  <p className="text-muted-foreground text-center py-4">
                    Save a title first to generate thumbnail
                  </p>
                ) : !selectedTemplate ? (
                  <p className="text-muted-foreground text-center py-4">
                    Select a template to generate thumbnail
                  </p>
                ) : (
                  <>
                    <div className="p-3 rounded-lg bg-background/50 border border-border">
                      <p className="text-xs text-muted-foreground mb-1">Will use:</p>
                      <p className="text-sm">
                        Template: <span className="text-cyan-400">{templates.find(t => t.id === selectedTemplate)?.name}</span>
                      </p>
                      <p className="text-sm">
                        Title: <span className="text-violet-400">{savedTitle}</span>
                      </p>
                    </div>

                    <Button
                      onClick={generateThumbnail}
                      disabled={generatingThumbnail}
                      className="w-full bg-gradient-to-r from-cyan-600 to-emerald-500"
                    >
                      {generatingThumbnail ? (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      ) : (
                        <ImageIcon className="w-4 h-4 mr-2" />
                      )}
                      Generate Thumbnail
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* No Slot Selected */}
      {!selectedSlot && slots.length > 0 && (
        <Card className="glass border-white/10">
          <CardContent className="py-12 text-center">
            <FolderOpen className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Select a video slot to get started</p>
          </CardContent>
        </Card>
      )}

      {/* No Slots */}
      {slots.length === 0 && (
        <Card className="glass border-white/10">
          <CardContent className="py-12 text-center">
            <FolderOpen className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No video slots found</p>
            <p className="text-sm text-muted-foreground mt-2">
              Add videos from the home page first
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
