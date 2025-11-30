"use client"

import { useState, useEffect, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { toast } from "sonner"
import {
  RefreshCw,
  Download,
  FileText,
  Copy,
  Bot,
  SkipForward,
  ExternalLink,
  Plus,
  Loader2,
  Mic,
  Play,
  AlertTriangle,
  Volume2,
  VolumeX
} from "lucide-react"

interface SourceChannel {
  channel_code: string
  channel_name: string
  youtube_channel_url: string
  min_duration_seconds: number
  max_duration_seconds: number
  max_videos: number
  is_active: boolean
}

interface TargetChannel {
  channel_code: string
  channel_name: string
  reference_audio: string
  is_active: boolean
}

interface TranscriptItem {
  index: number
  title: string
  videoId: string
  charCount: number
  filename: string
}

function HomeContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  // Priority mode from URL (when redirected from calendar after deleting slot)
  const priorityMode = {
    enabled: searchParams.get("priority") === "true",
    channel: searchParams.get("channel") || "",
    date: searchParams.get("date") || "",
    slot: searchParams.get("slot") || ""
  }

  // State
  const [sourceChannels, setSourceChannels] = useState<SourceChannel[]>([])
  const [targetChannels, setTargetChannels] = useState<TargetChannel[]>([])
  const [selectedSource, setSelectedSource] = useState<string>("")
  const [selectedTarget, setSelectedTarget] = useState<string>(priorityMode.channel)
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([])
  const [selectedTranscript, setSelectedTranscript] = useState<TranscriptItem | null>(null)
  const [transcriptContent, setTranscriptContent] = useState<string>("")
  const [processedScript, setProcessedScript] = useState<string>("")
  const [prompt, setPrompt] = useState<string>("")

  // YouTube URL input
  const [youtubeUrl, setYoutubeUrl] = useState<string>("")
  const [ytLoading, setYtLoading] = useState<"reference" | "process" | null>(null)

  // Loading states
  const [loading, setLoading] = useState(false)
  const [fetchingVideos, setFetchingVideos] = useState(false)
  const [fetchingTranscripts, setFetchingTranscripts] = useState(false)
  const [processingAI, setProcessingAI] = useState(false)
  const [addingToQueue, setAddingToQueue] = useState(false)

  // Audio generation toggle (ON = create audio/video job, OFF = only save files)
  const [audioEnabled, setAudioEnabled] = useState(true)

  // Fetch settings
  const [maxVideos, setMaxVideos] = useState(0)
  const [minDuration, setMinDuration] = useState(0)
  const [maxDuration, setMaxDuration] = useState(0)

  // Progress
  const [fetchProgress, setFetchProgress] = useState({ current: 0, total: 0 })

  // Fetched videos (to pass to transcript fetch)
  const [fetchedVideos, setFetchedVideos] = useState<any[]>([])

  // Clean script - remove asterisks, double quotes, and other special characters
  function cleanScript(text: string): string {
    return text
      .replace(/\*+/g, '')           // Remove asterisks
      .replace(/"/g, '')             // Remove double quotes
      .replace(/"/g, '')             // Remove curly double quote left
      .replace(/"/g, '')             // Remove curly double quote right
      .replace(/'/g, "'")            // Replace curly single quote with straight
      .replace(/'/g, "'")            // Replace curly single quote with straight
      .replace(/…/g, '...')          // Replace ellipsis with dots
      .replace(/—/g, '-')            // Replace em dash with hyphen
      .replace(/–/g, '-')            // Replace en dash with hyphen
      .replace(/\s+/g, ' ')          // Replace multiple spaces with single
      .replace(/^\s+|\s+$/gm, '')    // Trim each line
      .trim()
  }

  // Load initial data
  useEffect(() => {
    loadSourceChannels()
    loadTargetChannels()
    loadSettings()
  }, [])

  // Set target channel from URL if in priority mode
  useEffect(() => {
    if (priorityMode.enabled && priorityMode.channel && targetChannels.length > 0) {
      setSelectedTarget(priorityMode.channel)
    }
  }, [priorityMode.enabled, priorityMode.channel, targetChannels])

  // Load transcripts when source channel changes
  useEffect(() => {
    if (selectedSource) {
      loadTranscripts(selectedSource)
    }
  }, [selectedSource])

  async function loadSourceChannels() {
    try {
      const res = await fetch("/api/source-channels")
      const data = await res.json()
      setSourceChannels(data.channels || [])
    } catch (error) {
      console.error("Error loading source channels:", error)
    }
  }

  async function loadTargetChannels() {
    try {
      const res = await fetch("/api/target-channels")
      const data = await res.json()
      setTargetChannels(data.channels || [])
    } catch (error) {
      console.error("Error loading target channels:", error)
    }
  }

  async function loadSettings() {
    try {
      const res = await fetch("/api/settings")
      const data = await res.json()
      if (data.prompts?.youtube) {
        setPrompt(data.prompts.youtube)
      }
    } catch (error) {
      console.error("Error loading settings:", error)
    }
  }

  async function loadTranscripts(channelCode: string) {
    setLoading(true)
    try {
      const res = await fetch(`/api/transcripts?channel=${channelCode}`)
      const data = await res.json()
      setTranscripts(data.transcripts || [])
      setSelectedTranscript(null)
      setTranscriptContent("")
      setProcessedScript("")
    } catch (error) {
      console.error("Error loading transcripts:", error)
      toast.error("Failed to load transcripts")
    } finally {
      setLoading(false)
    }
  }

  async function handleSelectTranscript(item: TranscriptItem) {
    setSelectedTranscript(item)
    try {
      const res = await fetch(`/api/transcripts?channel=${selectedSource}&index=${item.index}`)
      const data = await res.json()
      // Strip Title and Video ID lines
      const cleanContent = (data.content || "")
        .split("\n")
        .filter((line: string) => !line.startsWith("Title:") && !line.startsWith("Video ID:"))
        .join("\n")
        .trim()
      setTranscriptContent(cleanContent)
      setProcessedScript("")
    } catch (error) {
      console.error("Error loading transcript:", error)
      toast.error("Failed to load transcript content")
    }
  }

  async function handleFetchVideos() {
    if (!selectedSource) {
      toast.error("Select a source channel first")
      return
    }

    const channel = sourceChannels.find(c => c.channel_code === selectedSource)
    if (!channel) return

    setFetchingVideos(true)
    try {
      const res = await fetch("/api/youtube/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelUrl: channel.youtube_channel_url,
          channelCode: selectedSource, // Track fetched videos per channel
          maxResults: maxVideos,
          minDuration: minDuration * 60,
          maxDuration: maxDuration * 60
        })
      })
      const data = await res.json()

      if (data.error) {
        toast.error(data.error)
        setFetchedVideos([])
      } else {
        setFetchedVideos(data.videos || [])
        const skipMsg = data.alreadyFetched > 0 ? ` (skipped ${data.alreadyFetched} already fetched)` : ""
        toast.success(`Found ${data.videos?.length || 0} NEW videos${skipMsg}`)
      }
    } catch (error) {
      console.error("Error fetching videos:", error)
      toast.error("Failed to fetch videos")
      setFetchedVideos([])
    } finally {
      setFetchingVideos(false)
    }
  }

  async function handleFetchTranscripts() {
    if (!selectedSource) {
      toast.error("Select a source channel first")
      return
    }

    if (fetchedVideos.length === 0) {
      toast.error("Fetch videos first!")
      return
    }

    setFetchingTranscripts(true)
    setFetchProgress({ current: 0, total: fetchedVideos.length })

    try {
      const res = await fetch("/api/youtube/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelCode: selectedSource,
          videos: fetchedVideos,
          maxVideos: maxVideos
        })
      })
      const data = await res.json()

      if (data.error) {
        toast.error(data.error)
      } else {
        toast.success(`Saved ${data.saved || 0} transcripts, Failed ${data.failed || 0}`)
        loadTranscripts(selectedSource)
      }
    } catch (error) {
      console.error("Error fetching transcripts:", error)
      toast.error("Failed to fetch transcripts")
    } finally {
      setFetchingTranscripts(false)
    }
  }

  async function handleCopyPrompt() {
    if (!transcriptContent) {
      toast.error("Select a transcript first")
      return
    }
    // Strip Title and Video ID lines from transcript
    const cleanTranscript = transcriptContent
      .split("\n")
      .filter(line => !line.startsWith("Title:") && !line.startsWith("Video ID:"))
      .join("\n")
      .trim()
    const fullText = `${prompt}\n\n${cleanTranscript}`
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(fullText)
      } else {
        // Fallback for non-HTTPS
        const textarea = document.createElement("textarea")
        textarea.value = fullText
        textarea.style.position = "fixed"
        textarea.style.left = "-9999px"
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand("copy")
        document.body.removeChild(textarea)
      }
      toast.success("Copied prompt + transcript to clipboard")
    } catch (error) {
      console.error("Copy failed:", error)
      toast.error("Failed to copy - try selecting text manually")
    }
  }

  async function handleAIProcess() {
    if (!transcriptContent) {
      toast.error("No transcript selected")
      return
    }

    setProcessingAI(true)
    try {
      const res = await fetch("/api/ai/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: transcriptContent,
          prompt: prompt
        })
      })
      const data = await res.json()

      if (data.error) {
        toast.error(data.error)
      } else {
        setProcessedScript(cleanScript(data.result || ""))
        toast.success("AI processing complete")
      }
    } catch (error) {
      console.error("Error processing with AI:", error)
      toast.error("AI processing failed")
    } finally {
      setProcessingAI(false)
    }
  }

  async function handleSkip() {
    if (!selectedTranscript || !selectedSource) return

    try {
      const res = await fetch("/api/transcripts/skip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelCode: selectedSource,
          index: selectedTranscript.index
        })
      })
      const data = await res.json()

      if (data.success) {
        toast.success("Transcript skipped")
        loadTranscripts(selectedSource)
        // Auto-select next
        const currentIndex = transcripts.findIndex(t => t.index === selectedTranscript.index)
        if (currentIndex < transcripts.length - 1) {
          handleSelectTranscript(transcripts[currentIndex + 1])
        }
      }
    } catch (error) {
      console.error("Error skipping transcript:", error)
      toast.error("Failed to skip transcript")
    }
  }

  async function handleAddToQueue() {
    if (!processedScript || !selectedTarget) {
      toast.error("Missing required fields (need processed script and target channel)")
      return
    }

    setAddingToQueue(true)
    try {
      // Build request body - include priority mode params if enabled
      const requestBody: any = {
        script: processedScript,
        transcript: transcriptContent,
        targetChannel: selectedTarget,
        sourceChannel: selectedSource || "YT_URL",
        transcriptIndex: selectedTranscript?.index || 0,
        audioEnabled: audioEnabled  // false = only save files, no audio/video job
      }

      // If in priority mode, add date, slot and priority
      if (priorityMode.enabled && priorityMode.date && priorityMode.slot) {
        requestBody.date = priorityMode.date
        requestBody.slot = priorityMode.slot
        requestBody.priority = "10"  // High priority
      }

      const res = await fetch("/api/queue/audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      })
      const data = await res.json()

      if (data.error) {
        toast.error(data.error)
      } else {
        const priorityLabel = priorityMode.enabled ? " (PRIORITY)" : ""
        const audioLabel = audioEnabled ? "" : " (Files Only)"
        toast.success(`Added${priorityLabel}${audioLabel}! ${data.channelCode} Video ${data.videoNumber} | Date: ${data.date}`)
        setProcessedScript("")
        setTranscriptContent("")
        setYoutubeUrl("")

        // Clear priority mode from URL
        if (priorityMode.enabled) {
          router.replace("/")
        }

        // If from transcript list, reload and select next
        if (selectedTranscript && selectedSource) {
          loadTranscripts(selectedSource)
          const currentIndex = transcripts.findIndex(t => t.index === selectedTranscript.index)
          if (currentIndex < transcripts.length - 1) {
            handleSelectTranscript(transcripts[currentIndex + 1])
          } else {
            setSelectedTranscript(null)
          }
        }
      }
    } catch (error) {
      console.error("Error adding to queue:", error)
      toast.error("Failed to add to queue")
    } finally {
      setAddingToQueue(false)
    }
  }

  function formatCharCount(count: number): string {
    if (count >= 1000) {
      return (count / 1000).toFixed(1) + "K"
    }
    return count.toString()
  }

  async function handleProcessVideo() {
    if (!youtubeUrl) {
      toast.error("Enter a YouTube URL first")
      return
    }

    setYtLoading("process")
    try {
      const res = await fetch("/api/youtube/process-single", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ youtubeUrl })
      })
      const data = await res.json()

      if (data.error) {
        toast.error(data.error)
      } else {
        setTranscriptContent(data.transcript)
        setSelectedTranscript(null) // Clear selected transcript since this is from URL
        setProcessedScript("")
        toast.success("Transcript loaded!")
      }
    } catch (error) {
      console.error("Error processing video:", error)
      toast.error("Failed to fetch transcript")
    } finally {
      setYtLoading(null)
    }
  }

  const totalChars = transcripts.reduce((sum, t) => sum + t.charCount, 0)

  return (
    <div className="space-y-6">
      {/* Priority Mode Banner */}
      {priorityMode.enabled && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-amber-400">Priority Replacement Mode</p>
            <p className="text-sm text-muted-foreground">
              Replacing <span className="text-white font-medium">{priorityMode.channel}</span> Slot {priorityMode.slot} on {priorityMode.date}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.replace("/")}
            className="text-amber-400 hover:text-amber-300"
          >
            Cancel
          </Button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold gradient-text">Source Channel Processor</h1>
          <p className="text-muted-foreground text-sm mt-1">Process YouTube transcripts and generate TTS audio</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            loadSourceChannels()
            loadTargetChannels()
            if (selectedSource) loadTranscripts(selectedSource)
          }}
          className="border-violet-500/30 hover:border-violet-500 hover:bg-violet-500/10 transition-all"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* YouTube URL Input */}
      <Card className="glass border-white/10">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1">
              <Input
                placeholder="Paste YouTube URL here..."
                value={youtubeUrl}
                onChange={e => setYoutubeUrl(e.target.value)}
                className="w-full"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleProcessVideo}
                disabled={!youtubeUrl || ytLoading !== null}
                className="border-green-500/30 hover:border-green-500 hover:bg-green-500/10"
              >
                {ytLoading === "process" ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                Process Video
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Controls */}
      <Card className="glass border-white/10">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Source Channel */}
            <div className="space-y-2">
              <Label>Source Channel</Label>
              <Select value={selectedSource} onValueChange={setSelectedSource}>
                <SelectTrigger>
                  <SelectValue placeholder="Select source..." />
                </SelectTrigger>
                <SelectContent>
                  {sourceChannels.filter(c => c.is_active).map(channel => (
                    <SelectItem key={channel.channel_code} value={channel.channel_code}>
                      {channel.channel_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Target Channel */}
            <div className="space-y-2">
              <Label>Target Channel</Label>
              <Select value={selectedTarget} onValueChange={setSelectedTarget}>
                <SelectTrigger>
                  <SelectValue placeholder="Select target..." />
                </SelectTrigger>
                <SelectContent>
                  {targetChannels.filter(c => c.is_active).map(channel => (
                    <SelectItem key={channel.channel_code} value={channel.channel_code}>
                      {channel.channel_name} ({channel.channel_code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Max Videos */}
            <div className="space-y-2">
              <Label>Max Videos</Label>
              <Input
                type="number"
                value={maxVideos}
                onChange={e => setMaxVideos(Number(e.target.value))}
                min={1}
                max={1000}
              />
            </div>

            {/* Duration Filter (minutes) */}
            <div className="space-y-2">
              <Label>Duration (minutes)</Label>
              <div className="flex gap-2 items-center">
                <Input
                  type="number"
                  placeholder="0"
                  value={minDuration}
                  onChange={e => setMinDuration(parseInt(e.target.value) || 0)}
                  className="w-20"
                  min={0}
                />
                <span className="text-muted-foreground">to</span>
                <Input
                  type="number"
                  placeholder="0"
                  value={maxDuration}
                  onChange={e => setMaxDuration(parseInt(e.target.value) || 0)}
                  className="w-20"
                  min={0}
                />
                <span className="text-xs text-muted-foreground">0 = no limit</span>
              </div>
            </div>
          </div>

          {/* Fetch buttons */}
          <div className="flex gap-2 mt-4">
            <Button
              variant="outline"
              onClick={handleFetchVideos}
              disabled={!selectedSource || fetchingVideos}
            >
              {fetchingVideos ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-2" />
              )}
              Fetch Videos
            </Button>
            <Button
              variant="outline"
              onClick={handleFetchTranscripts}
              disabled={!selectedSource || fetchingTranscripts}
            >
              {fetchingTranscripts ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <FileText className="w-4 h-4 mr-2" />
              )}
              Fetch Transcripts
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      {transcripts.length > 0 && (
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>{transcripts.length} Transcripts</span>
          <span>|</span>
          <span>{formatCharCount(totalChars)} Total Characters</span>
        </div>
      )}

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left panel - Transcript list */}
        <Card className="lg:col-span-1 glass border-white/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-violet-500" />
              Transcripts {selectedSource && <span className="text-xs text-muted-foreground">({selectedSource})</span>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px]">
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : transcripts.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  No transcripts found.<br />
                  Fetch videos and transcripts first.
                </div>
              ) : (
                <div className="space-y-1">
                  {transcripts.map(item => (
                    <button
                      key={item.index}
                      onClick={() => handleSelectTranscript(item)}
                      className={`w-full text-left p-2 rounded hover:bg-accent transition ${
                        selectedTranscript?.index === item.index ? "bg-accent border-l-2 border-primary" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground">{item.index}</span>
                        <span className="text-sm text-muted-foreground">{item.charCount.toLocaleString()}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Right panel - Transcript viewer & actions */}
        <Card className="lg:col-span-2 glass border-white/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">
              {selectedTranscript ? (
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-cyan-400" />
                    #{selectedTranscript.index} - {selectedTranscript.title}
                  </span>
                  <Badge className="bg-violet-500/20 text-violet-300 border-violet-500/30">{formatCharCount(selectedTranscript.charCount)} chars</Badge>
                </div>
              ) : (
                <span className="text-muted-foreground">Select a transcript</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Transcript content */}
            <div>
              <Label>Original Transcript</Label>
              <Textarea
                value={transcriptContent}
                onChange={e => setTranscriptContent(e.target.value)}
                className="h-[200px] mt-1 font-mono text-sm"
                placeholder="Select a transcript from the left panel..."
              />
            </div>

            {/* Action buttons */}
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={handleCopyPrompt}
                disabled={!transcriptContent}
                className="text-xs sm:text-sm"
              >
                <Copy className="w-4 h-4 mr-1 sm:mr-2" />
                <span className="hidden sm:inline">Copy Prompt + </span>Transcript
              </Button>
              <Button
                variant="outline"
                onClick={handleAIProcess}
                disabled={!transcriptContent || processingAI}
                className="text-xs sm:text-sm"
              >
                {processingAI ? (
                  <Loader2 className="w-4 h-4 mr-1 sm:mr-2 animate-spin" />
                ) : (
                  <Bot className="w-4 h-4 mr-1 sm:mr-2" />
                )}
                AI Process
              </Button>
              <Button
                variant="outline"
                onClick={handleSkip}
                disabled={!selectedTranscript}
                className="text-xs sm:text-sm"
              >
                <SkipForward className="w-4 h-4 mr-1 sm:mr-2" />
                Skip
              </Button>
              <Button
                variant="outline"
                onClick={() => window.open("https://gemini.google.com", "_blank")}
                className="text-xs sm:text-sm"
              >
                <ExternalLink className="w-4 h-4 mr-1 sm:mr-2" />
                Gemini
              </Button>
            </div>

            {/* Processed script */}
            <div>
              <div className="flex items-center justify-between">
                <Label>Processed Script</Label>
                {processedScript && (
                  <span className="text-xs text-muted-foreground">
                    {formatCharCount(processedScript.length)} chars
                  </span>
                )}
              </div>
              <Textarea
                value={processedScript}
                onChange={e => setProcessedScript(e.target.value)}
                onPaste={e => {
                  e.preventDefault()
                  const pastedText = e.clipboardData.getData('text')
                  const cleanedText = cleanScript(pastedText)
                  const target = e.target as HTMLTextAreaElement
                  const start = target.selectionStart
                  const end = target.selectionEnd
                  const currentText = processedScript
                  const newText = currentText.substring(0, start) + cleanedText + currentText.substring(end)
                  setProcessedScript(newText)
                }}
                className="h-[200px] mt-1 font-mono text-sm"
                placeholder="AI processed script will appear here, or paste manually..."
              />
            </div>

            {/* Audio toggle + Add to queue button */}
            <div className="flex gap-2 items-center">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setAudioEnabled(!audioEnabled)}
                className={`w-12 h-10 transition-all ${
                  audioEnabled
                    ? "border-green-500/50 bg-green-500/10 hover:bg-green-500/20 text-green-400"
                    : "border-red-500/50 bg-red-500/10 hover:bg-red-500/20 text-red-400"
                }`}
                title={audioEnabled ? "Audio ON - will generate audio/video" : "Audio OFF - only save files"}
              >
                {audioEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
              </Button>
              <Button
                className="flex-1 bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400 border-0 text-white font-semibold shadow-lg shadow-violet-500/25 transition-all duration-300"
                onClick={handleAddToQueue}
                disabled={!processedScript || !selectedTarget || addingToQueue}
              >
                {addingToQueue ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4 mr-2" />
                )}
                {audioEnabled ? "Add to Audio Queue" : "Save Files Only"} ({selectedTarget || "Select Target"})
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// Wrapper with Suspense for useSearchParams
export default function HomePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin" /></div>}>
      <HomeContent />
    </Suspense>
  )
}
