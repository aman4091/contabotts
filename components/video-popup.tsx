"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import {
  X,
  Copy,
  Sparkles,
  SkipForward,
  ExternalLink,
  Loader2,
  Plus,
  Music
} from "lucide-react"

interface Video {
  videoId: string
  title: string
  thumbnail: string
  duration: number
  viewCount: number
}

interface AudioFile {
  name: string
  sizeFormatted: string
}

interface VideoPopupProps {
  video: Video
  audioFiles: AudioFile[]
  defaultReferenceAudio: string
  prompt: string
  onClose: () => void
  onSkip: (videoId: string) => void
  onAddToQueue: (videoId: string) => void
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

function formatViews(views: number): string {
  if (views >= 1000000) {
    return `${(views / 1000000).toFixed(1)}M views`
  }
  if (views >= 1000) {
    return `${(views / 1000).toFixed(0)}K views`
  }
  return `${views} views`
}

export function VideoPopup({
  video,
  audioFiles,
  defaultReferenceAudio,
  prompt,
  onClose,
  onSkip,
  onAddToQueue
}: VideoPopupProps) {
  const [transcript, setTranscript] = useState<string>("")
  const [script, setScript] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [addingToQueue, setAddingToQueue] = useState(false)
  const [selectedAudio, setSelectedAudio] = useState(defaultReferenceAudio)

  useEffect(() => {
    fetchTranscript()
  }, [video.videoId])

  async function fetchTranscript() {
    setLoading(true)
    try {
      const res = await fetch(`/api/videos/transcript?videoId=${video.videoId}`)
      const data = await res.json()

      if (res.ok && data.transcript) {
        setTranscript(data.transcript)
      } else {
        toast.error(data.error || "Failed to fetch transcript")
        setTranscript("")
      }
    } catch (error) {
      toast.error("Failed to fetch transcript")
      setTranscript("")
    } finally {
      setLoading(false)
    }
  }

  async function handleCopy() {
    console.log("handleCopy called, transcript length:", transcript.length, "prompt length:", prompt.length)
    if (!transcript) {
      toast.error("No transcript to copy")
      return
    }
    const textToCopy = prompt + "\n\n" + transcript
    console.log("Text to copy length:", textToCopy.length)
    try {
      // Always use fallback method for reliability
      const textarea = document.createElement("textarea")
      textarea.value = textToCopy
      textarea.style.position = "fixed"
      textarea.style.left = "-9999px"
      textarea.style.top = "0"
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()
      const success = document.execCommand("copy")
      document.body.removeChild(textarea)
      if (success) {
        toast.success("Copied prompt + transcript")
      } else {
        toast.error("Copy failed")
      }
    } catch (error) {
      console.error("Copy failed:", error)
      toast.error("Failed to copy")
    }
  }

  async function handleAIProcess() {
    if (!transcript) {
      toast.error("No transcript to process")
      return
    }

    setProcessing(true)
    try {
      const res = await fetch("/api/ai/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          prompt
        })
      })

      const data = await res.json()
      if (res.ok && data.result) {
        setScript(data.result)
        toast.success("Script generated!")
      } else {
        toast.error(data.error || "Failed to process")
      }
    } catch (error) {
      toast.error("Failed to process transcript")
    } finally {
      setProcessing(false)
    }
  }

  function handleSkip() {
    onSkip(video.videoId)
    onClose()
  }

  function handleOpenGemini() {
    console.log("handleOpenGemini called")
    if (!transcript) {
      toast.error("No transcript to copy")
      return
    }
    const textToCopy = prompt + "\n\n" + transcript
    try {
      const textarea = document.createElement("textarea")
      textarea.value = textToCopy
      textarea.style.position = "fixed"
      textarea.style.left = "-9999px"
      textarea.style.top = "0"
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()
      document.execCommand("copy")
      document.body.removeChild(textarea)
      toast.success("Copied - paste in Gemini")
    } catch (error) {
      console.error("Copy failed:", error)
    }
    window.open("https://gemini.google.com", "_blank")
  }

  async function handleAddToQueue() {
    if (!script.trim()) {
      toast.error("Please add a script first")
      return
    }

    if (!selectedAudio) {
      toast.error("Please select a voice")
      return
    }

    setAddingToQueue(true)
    try {
      const res = await fetch("/api/queue/audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script: script.trim(),
          transcript,
          videoTitle: video.title,
          videoId: video.videoId,
          referenceAudio: selectedAudio,
          audioEnabled: true
        })
      })

      const data = await res.json()
      if (res.ok) {
        toast.success(`Added to queue: ${data.folderName || "video"}`)
        onAddToQueue(video.videoId)
        onClose()
      } else {
        toast.error(data.error || "Failed to add to queue")
      }
    } catch (error) {
      toast.error("Failed to add to queue")
    } finally {
      setAddingToQueue(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background border border-border rounded-lg w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-border">
          <div className="flex-1 min-w-0 pr-4">
            <h2 className="font-semibold text-lg truncate">{video.title}</h2>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="secondary">{formatDuration(video.duration)}</Badge>
              <Badge variant="outline">{formatViews(video.viewCount)}</Badge>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Transcript Box */}
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-2 block">
              Transcript ({transcript.length.toLocaleString()} chars)
            </label>
            {loading ? (
              <div className="h-48 flex items-center justify-center border border-border rounded-lg bg-muted/20">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">Fetching transcript...</span>
              </div>
            ) : (
              <Textarea
                value={transcript}
                onChange={e => setTranscript(e.target.value)}
                className="h-48 font-mono text-sm resize-none"
                placeholder="Transcript will appear here..."
              />
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleCopy()}
              disabled={!transcript}
              className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
            >
              <Copy className="w-4 h-4 mr-2" />
              Copy
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleAIProcess()}
              disabled={!transcript || processing}
              className="border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
            >
              {processing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 mr-2" />
              )}
              AI Process
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleSkip()}
              className="border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
            >
              <SkipForward className="w-4 h-4 mr-2" />
              Skip
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenGemini()}
              disabled={!transcript}
              className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Open Gemini
            </Button>
          </div>

          {/* Script Box */}
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-2 block">
              Script (paste or generate with AI) - {script.length.toLocaleString()} chars
            </label>
            <Textarea
              value={script}
              onChange={e => setScript(e.target.value)}
              className="h-48 font-mono text-sm resize-none"
              placeholder="Paste your processed script here..."
            />
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex items-center gap-2 flex-1">
              <Music className="w-4 h-4 text-muted-foreground" />
              <Select value={selectedAudio} onValueChange={setSelectedAudio}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select voice" />
                </SelectTrigger>
                <SelectContent>
                  {audioFiles.map(audio => (
                    <SelectItem key={audio.name} value={audio.name}>
                      {audio.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleAddToQueue}
              disabled={!script.trim() || !selectedAudio || addingToQueue}
              className="bg-gradient-to-r from-emerald-600 to-cyan-500 hover:from-emerald-500 hover:to-cyan-400 text-white"
            >
              {addingToQueue ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Plus className="w-4 h-4 mr-2" />
              )}
              Add to Queue
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
