"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { toast } from "sonner"
import {
  Loader2,
  Sparkles,
  Save,
  FileText,
  Image as ImageIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  Settings,
  RefreshCw
} from "lucide-react"

interface Slot {
  slotNumber: number
  date: string
  channelCode: string
  hasTranscript: boolean
  hasScript: boolean
  hasAudio: boolean
  hasVideo: boolean
  hasTitle?: boolean
  hasThumbnail?: boolean
  isCompleted: boolean
  path: string
}

interface TargetChannel {
  channel_code: string
  channel_name: string
  is_active: boolean
}

export default function TitlesThumbnailsPage() {
  // State
  const [targetChannels, setTargetChannels] = useState<TargetChannel[]>([])
  const [selectedChannel, setSelectedChannel] = useState<string>("")
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return new Date().toISOString().split("T")[0]
  })
  const [slots, setSlots] = useState<Slot[]>([])
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null)
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

  // Load initial data
  useEffect(() => {
    loadTargetChannels()
  }, [])

  // Load slots when channel or date changes
  useEffect(() => {
    if (selectedChannel && selectedDate) {
      loadSlots()
    }
  }, [selectedChannel, selectedDate])

  // Load script when slot is selected
  useEffect(() => {
    if (selectedSlot !== null && selectedChannel && selectedDate) {
      loadScript()
      loadSavedTitle()
    }
  }, [selectedSlot, selectedChannel, selectedDate])

  async function loadTargetChannels() {
    try {
      const res = await fetch("/api/target-channels")
      const data = await res.json()
      const channels = data.channels || []
      setTargetChannels(channels)
      if (channels.length > 0) {
        setSelectedChannel(channels[0].channel_code)
      }
    } catch (error) {
      console.error("Error loading channels:", error)
      toast.error("Failed to load channels")
    } finally {
      setLoading(false)
    }
  }

  async function loadSlots() {
    setLoadingSlots(true)
    try {
      const res = await fetch(`/api/calendar?date=${selectedDate}&channel=${selectedChannel}`)
      const data = await res.json()
      const slotsData = data.slots || []

      // Check for title and thumbnail in each slot
      const enrichedSlots = await Promise.all(
        slotsData.map(async (slot: Slot) => {
          const titleRes = await fetch(
            `/api/slots/title?date=${selectedDate}&channel=${selectedChannel}&slot=${slot.slotNumber}`
          )
          const titleData = await titleRes.json()
          return {
            ...slot,
            hasTitle: !!titleData.title
          }
        })
      )

      setSlots(enrichedSlots)
      setSelectedSlot(null)
      setScriptContent("")
      setGeneratedTitles([])
      setSelectedTitle("")
      setSavedTitle("")
    } catch (error) {
      console.error("Error loading slots:", error)
      toast.error("Failed to load slots")
    } finally {
      setLoadingSlots(false)
    }
  }

  async function loadScript() {
    if (selectedSlot === null) return
    setLoadingScript(true)
    try {
      const res = await fetch(
        `/api/calendar/download?date=${selectedDate}&channel=${selectedChannel}&slot=${selectedSlot}&file=script`
      )
      if (res.ok) {
        const text = await res.text()
        setScriptContent(text)
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
    if (selectedSlot === null) return
    try {
      const res = await fetch(
        `/api/slots/title?date=${selectedDate}&channel=${selectedChannel}&slot=${selectedSlot}`
      )
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

  async function saveTitle() {
    if (!selectedTitle) {
      toast.error("Please select a title first")
      return
    }

    setSavingTitle(true)
    try {
      const res = await fetch("/api/slots/title", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: selectedDate,
          channel: selectedChannel,
          slot: selectedSlot,
          title: selectedTitle
        })
      })

      const data = await res.json()

      if (data.success) {
        setSavedTitle(selectedTitle)
        toast.success("Title saved!")
        loadSlots() // Refresh to show hasTitle
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

  function changeDate(days: number) {
    const current = new Date(selectedDate)
    current.setDate(current.getDate() + days)
    setSelectedDate(current.toISOString().split("T")[0])
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

      {/* Channel & Date Selection */}
      <Card className="glass border-white/10">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
            {/* Channel Selector */}
            <div className="w-full sm:w-64">
              <Label className="text-sm text-muted-foreground mb-2 block">Target Channel</Label>
              <Select value={selectedChannel} onValueChange={setSelectedChannel}>
                <SelectTrigger>
                  <SelectValue placeholder="Select channel" />
                </SelectTrigger>
                <SelectContent>
                  {targetChannels.map((channel) => (
                    <SelectItem key={channel.channel_code} value={channel.channel_code}>
                      {channel.channel_name} ({channel.channel_code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date Selector */}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => changeDate(-1)}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-40"
              />
              <Button variant="outline" size="icon" onClick={() => changeDate(1)}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>

            {/* Refresh */}
            <Button
              variant="outline"
              onClick={loadSlots}
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
        {/* Left - Slots Selection */}
        <Card className="glass border-white/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <div className="w-2 h-2 rounded-full bg-cyan-400" />
              Slots
            </CardTitle>
            <CardDescription>Select a slot to work with</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {loadingSlots ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : slots.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No slots for this date
              </div>
            ) : (
              slots.map((slot) => (
                <div
                  key={slot.slotNumber}
                  onClick={() => slot.hasScript && setSelectedSlot(slot.slotNumber)}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${
                    selectedSlot === slot.slotNumber
                      ? "border-cyan-500 bg-cyan-500/10"
                      : slot.hasScript
                      ? "border-border hover:border-cyan-500/50"
                      : "border-border/50 opacity-50 cursor-not-allowed"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Slot #{slot.slotNumber}</span>
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
                {selectedSlot !== null
                  ? `Slot #${selectedSlot} - ${selectedDate}`
                  : "Select a slot to view script"}
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
                  {selectedSlot !== null ? "No script found" : "Select a slot to view script"}
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
                  <Label>Select a Title ({generatedTitles.length} generated)</Label>
                  <RadioGroup
                    value={selectedTitle}
                    onValueChange={setSelectedTitle}
                    className="max-h-80 overflow-y-auto space-y-2"
                  >
                    {generatedTitles.map((title, index) => (
                      <div
                        key={index}
                        className={`flex items-start space-x-3 p-3 rounded-lg border transition-all cursor-pointer ${
                          selectedTitle === title
                            ? "border-violet-500 bg-violet-500/10"
                            : "border-border hover:border-violet-500/50"
                        }`}
                        onClick={() => setSelectedTitle(title)}
                      >
                        <RadioGroupItem value={title} id={`title-${index}`} className="mt-1" />
                        <label
                          htmlFor={`title-${index}`}
                          className="text-sm cursor-pointer flex-1"
                        >
                          <span className="text-muted-foreground mr-2">{index + 1}.</span>
                          {title}
                        </label>
                      </div>
                    ))}
                  </RadioGroup>

                  {/* Save Button */}
                  <Button
                    onClick={saveTitle}
                    disabled={!selectedTitle || savingTitle}
                    className="w-full bg-emerald-600 hover:bg-emerald-500"
                  >
                    {savingTitle ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Save className="w-4 h-4 mr-2" />
                    )}
                    Save Title
                  </Button>
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
            selectedDate={selectedDate}
            selectedChannel={selectedChannel}
            selectedSlot={selectedSlot}
            savedTitle={savedTitle}
          />
        </div>
      </div>
    </div>
  )
}

// Thumbnail Section Component
function ThumbnailSection({
  selectedDate,
  selectedChannel,
  selectedSlot,
  savedTitle
}: {
  selectedDate: string
  selectedChannel: string
  selectedSlot: number | null
  savedTitle: string
}) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [generatingThumbnail, setGeneratingThumbnail] = useState(false)
  const [savingThumbnail, setSavingThumbnail] = useState(false)
  const [showManualEdit, setShowManualEdit] = useState(false)

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
    shadowEnabled: true,
    shadowColor: "#000000",
    shadowBlur: 6,
    outlineEnabled: true,
    outlineColor: "#000000",
    outlineWidth: 3
  })

  // Load existing thumbnail on slot change
  useEffect(() => {
    if (selectedSlot !== null && selectedChannel && selectedDate) {
      checkExistingThumbnail()
    } else {
      setThumbnailUrl(null)
    }
  }, [selectedSlot, selectedChannel, selectedDate])

  async function checkExistingThumbnail() {
    try {
      const res = await fetch(
        `/api/slots/thumbnail?date=${selectedDate}&channel=${selectedChannel}&slot=${selectedSlot}`
      )
      if (res.ok && res.headers.get("Content-Type")?.includes("image")) {
        setThumbnailUrl(
          `/api/slots/thumbnail?date=${selectedDate}&channel=${selectedChannel}&slot=${selectedSlot}&t=${Date.now()}`
        )
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

    setGeneratingThumbnail(true)
    try {
      const res = await fetch("/api/slots/thumbnail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: selectedDate,
          channel: selectedChannel,
          slot: selectedSlot,
          title: savedTitle
        })
      })

      const data = await res.json()

      if (data.success) {
        setThumbnailUrl(
          `/api/slots/thumbnail?date=${selectedDate}&channel=${selectedChannel}&slot=${selectedSlot}&t=${Date.now()}`
        )
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

  async function applyManualEdit() {
    if (!savedTitle) {
      toast.error("No title to apply")
      return
    }

    setSavingThumbnail(true)
    try {
      const res = await fetch("/api/slots/thumbnail", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: selectedDate,
          channel: selectedChannel,
          slot: selectedSlot,
          title: savedTitle,
          textBox: {
            x: editSettings.positionX,
            y: editSettings.positionY,
            width: 1180,
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
        })
      })

      const data = await res.json()

      if (data.success) {
        setThumbnailUrl(
          `/api/slots/thumbnail?date=${selectedDate}&channel=${selectedChannel}&slot=${selectedSlot}&t=${Date.now()}`
        )
        toast.success("Thumbnail updated!")
        setShowManualEdit(false)
      } else {
        toast.error(data.error || "Failed to update thumbnail")
      }
    } catch (error) {
      console.error("Error updating thumbnail:", error)
      toast.error("Failed to update thumbnail")
    } finally {
      setSavingThumbnail(false)
    }
  }

  const canGenerate = selectedSlot !== null && savedTitle

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
                src={thumbnailUrl}
                alt="Thumbnail Preview"
                className="w-full h-auto"
                style={{ maxHeight: "400px", objectFit: "contain" }}
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
                onClick={() => window.location.href = "/settings"}
                className="border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
              >
                <Settings className="w-4 h-4 mr-2" />
                Open Canva
              </Button>
              <a
                href={thumbnailUrl}
                download={`thumbnail_${selectedChannel}_${selectedDate}_${selectedSlot}.png`}
                className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 h-10 px-4"
              >
                <Save className="w-4 h-4 mr-2" />
                Download
              </a>
            </div>

            {/* Manual Edit Panel */}
            {showManualEdit && (
              <div className="p-4 rounded-lg border border-pink-500/30 bg-pink-500/5 space-y-4">
                <h4 className="font-medium text-pink-400">Manual Edit Mode</h4>

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

                {/* Padding */}
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <Label className="text-xs">Pad L</Label>
                    <Input
                      type="number"
                      value={editSettings.paddingLeft}
                      onChange={(e) =>
                        setEditSettings({ ...editSettings, paddingLeft: parseInt(e.target.value) || 0 })
                      }
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Pad R</Label>
                    <Input
                      type="number"
                      value={editSettings.paddingRight}
                      onChange={(e) =>
                        setEditSettings({ ...editSettings, paddingRight: parseInt(e.target.value) || 0 })
                      }
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Pad T</Label>
                    <Input
                      type="number"
                      value={editSettings.paddingTop}
                      onChange={(e) =>
                        setEditSettings({ ...editSettings, paddingTop: parseInt(e.target.value) || 0 })
                      }
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Pad B</Label>
                    <Input
                      type="number"
                      value={editSettings.paddingBottom}
                      onChange={(e) =>
                        setEditSettings({ ...editSettings, paddingBottom: parseInt(e.target.value) || 0 })
                      }
                      className="mt-1"
                    />
                  </div>
                </div>

                {/* Position */}
                <div className="grid grid-cols-2 gap-4">
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

                {/* Apply Button */}
                <Button
                  onClick={applyManualEdit}
                  disabled={savingThumbnail}
                  className="w-full bg-pink-600 hover:bg-pink-500"
                >
                  {savingThumbnail ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Check className="w-4 h-4 mr-2" />
                  )}
                  Apply Changes
                </Button>
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
