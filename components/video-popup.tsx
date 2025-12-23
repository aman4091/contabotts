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
  Music,
  Scissors,
  ChevronRight,
  Check,
  Merge,
  Edit3,
  ChevronDown,
  RotateCcw,
  ImageIcon,
  Trash2,
  Upload
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
  channelCode?: string
  initialTranscript?: string
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
  channelCode,
  initialTranscript,
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

  // Chunks mode state
  const [chunksMode, setChunksMode] = useState(false)
  const [chunks, setChunks] = useState<string[]>([])
  const [processedChunks, setProcessedChunks] = useState<string[]>([])
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0)
  const [chunkInput, setChunkInput] = useState("")

  // Custom prompt state
  const [customPrompt, setCustomPrompt] = useState(prompt)
  const [showPromptEditor, setShowPromptEditor] = useState(false)

  // Custom images state
  const [customImages, setCustomImages] = useState<File[]>([])
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([])
  const [showImageSection, setShowImageSection] = useState(false)
  const [uploadingImages, setUploadingImages] = useState(false)

  // AI Image generation mode (default ON for 12 sec per image)
  const [aiImageMode, setAiImageMode] = useState(true)

  useEffect(() => {
    // If initialTranscript is provided, use it instead of fetching
    if (initialTranscript) {
      setTranscript(initialTranscript)
      setLoading(false)
    } else {
      fetchTranscript()
    }
  }, [video.videoId, initialTranscript])

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
    console.log("handleCopy called, transcript length:", transcript.length, "prompt length:", customPrompt.length)
    if (!transcript) {
      toast.error("No transcript to copy")
      return
    }
    const textToCopy = customPrompt + "\n\n" + transcript
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
          prompt: customPrompt
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

  // Split transcript into chunks of <7000 chars on fullstop
  function startChunksMode() {
    if (!transcript) {
      toast.error("No transcript to chunk")
      return
    }

    const maxChunkSize = 7000
    const sentences = transcript.split(/(?<=[।.!?])\s*/)
    const newChunks: string[] = []
    let currentChunk = ""

    for (const sentence of sentences) {
      if ((currentChunk + sentence).length > maxChunkSize && currentChunk.length > 0) {
        newChunks.push(currentChunk.trim())
        currentChunk = sentence
      } else {
        currentChunk += sentence + " "
      }
    }
    if (currentChunk.trim()) {
      newChunks.push(currentChunk.trim())
    }

    if (newChunks.length === 1) {
      toast.info("Transcript is small enough, no chunking needed")
      return
    }

    setChunks(newChunks)
    setProcessedChunks(new Array(newChunks.length).fill(""))
    setCurrentChunkIndex(0)
    setChunkInput("")
    setChunksMode(true)
    toast.success(`Split into ${newChunks.length} chunks`)
  }

  function copyCurrentChunk() {
    const currentChunk = chunks[currentChunkIndex]
    const textToCopy = customPrompt + "\n\n" + currentChunk
    try {
      const textarea = document.createElement("textarea")
      textarea.value = textToCopy
      textarea.style.position = "fixed"
      textarea.style.left = "-9999px"
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()
      document.execCommand("copy")
      document.body.removeChild(textarea)
      toast.success(`Copied chunk ${currentChunkIndex + 1}/${chunks.length}`)
    } catch (error) {
      toast.error("Copy failed")
    }
  }

  function saveChunkAndNext() {
    if (!chunkInput.trim()) {
      toast.error("Please paste the processed chunk")
      return
    }

    // Clean the input - convert curly quotes to apostrophe, remove other symbols
    const cleaned = chunkInput.replace(/[\u2018\u2019]/g, "'").replace(/[*""\u201C\u201D`#@&^~]/g, '')

    const newProcessed = [...processedChunks]
    newProcessed[currentChunkIndex] = cleaned
    setProcessedChunks(newProcessed)

    if (currentChunkIndex < chunks.length - 1) {
      setCurrentChunkIndex(currentChunkIndex + 1)
      setChunkInput("")
      toast.success(`Saved chunk ${currentChunkIndex + 1}, moving to next`)
    } else {
      toast.success("All chunks processed! Click Merge to combine.")
    }
  }

  function mergeAllChunks() {
    const emptyChunks = processedChunks.filter(c => !c.trim()).length
    if (emptyChunks > 0) {
      toast.error(`${emptyChunks} chunks are still empty`)
      return
    }

    const merged = processedChunks.join("\n\n")
    setScript(merged)
    setChunksMode(false)
    toast.success("All chunks merged into script!")
  }

  function exitChunksMode() {
    setChunksMode(false)
    setChunks([])
    setProcessedChunks([])
    setCurrentChunkIndex(0)
    setChunkInput("")
  }

  function handleOpenGemini() {
    console.log("handleOpenGemini called")
    if (!transcript) {
      toast.error("No transcript to copy")
      return
    }
    const textToCopy = customPrompt + "\n\n" + transcript
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

  // Image handling functions
  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files) return

    const newFiles = Array.from(files)
    const validFiles = newFiles.filter(f => f.type.startsWith('image/'))

    if (validFiles.length === 0) {
      toast.error("Please select image files")
      return
    }

    // Add to existing images
    setCustomImages(prev => [...prev, ...validFiles])

    // Create preview URLs
    const newUrls = validFiles.map(f => URL.createObjectURL(f))
    setImagePreviewUrls(prev => [...prev, ...newUrls])

    toast.success(`Added ${validFiles.length} image(s)`)
  }

  function removeImage(index: number) {
    // Revoke URL to free memory
    URL.revokeObjectURL(imagePreviewUrls[index])

    setCustomImages(prev => prev.filter((_, i) => i !== index))
    setImagePreviewUrls(prev => prev.filter((_, i) => i !== index))
  }

  function clearAllImages() {
    imagePreviewUrls.forEach(url => URL.revokeObjectURL(url))
    setCustomImages([])
    setImagePreviewUrls([])
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
      // If custom images, upload them first
      let uploadedImagePaths: string[] = []

      if (customImages.length > 0) {
        setUploadingImages(true)
        toast.info("Uploading images...")

        const formData = new FormData()
        customImages.forEach((file, index) => {
          formData.append(`image_${index}`, file)
        })

        const uploadRes = await fetch("/api/custom-images/upload", {
          method: "POST",
          body: formData
        })

        const uploadData = await uploadRes.json()
        if (uploadRes.ok && uploadData.paths) {
          uploadedImagePaths = uploadData.paths
          toast.success(`Uploaded ${uploadedImagePaths.length} images`)
        } else {
          toast.error("Failed to upload images, using default")
        }
        setUploadingImages(false)
      }

      const res = await fetch("/api/queue/audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script: script.trim(),
          transcript,
          videoTitle: video.title,
          videoId: video.videoId,
          channelCode: channelCode || "VIDEO",
          referenceAudio: selectedAudio,
          customImages: uploadedImagePaths.length > 0 ? uploadedImagePaths : undefined,
          aiImageMode
        })
      })

      const data = await res.json()
      if (res.ok) {
        toast.success(`Added to queue: ${data.folderName || "video"}`)
        // Clean up image URLs
        clearAllImages()
        onAddToQueue(video.videoId)
        onClose()
      } else {
        toast.error(data.error || "Failed to add to queue")
      }
    } catch (error) {
      toast.error("Failed to add to queue")
    } finally {
      setAddingToQueue(false)
      setUploadingImages(false)
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
            <Button
              type="button"
              variant="outline"
              onClick={() => startChunksMode()}
              disabled={!transcript || chunksMode}
              className="border-pink-500/30 text-pink-400 hover:bg-pink-500/10"
            >
              <Scissors className="w-4 h-4 mr-2" />
              Chunks
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowPromptEditor(!showPromptEditor)}
              className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
            >
              <Edit3 className="w-4 h-4 mr-2" />
              Prompt
              {customPrompt !== prompt && (
                <Badge variant="secondary" className="ml-2 text-xs bg-amber-500/20 text-amber-400">
                  Modified
                </Badge>
              )}
              <ChevronDown className={`w-4 h-4 ml-1 transition-transform ${showPromptEditor ? 'rotate-180' : ''}`} />
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowImageSection(!showImageSection)}
              className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
            >
              <ImageIcon className="w-4 h-4 mr-2" />
              Images
              {customImages.length > 0 && (
                <Badge variant="secondary" className="ml-2 text-xs bg-emerald-500/20 text-emerald-400">
                  {customImages.length}
                </Badge>
              )}
              <ChevronDown className={`w-4 h-4 ml-1 transition-transform ${showImageSection ? 'rotate-180' : ''}`} />
            </Button>
          </div>

          {/* Custom Prompt Editor */}
          {showPromptEditor && (
            <div className="border border-amber-500/30 rounded-lg p-4 bg-amber-500/5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Edit3 className="w-4 h-4 text-amber-400" />
                  <span className="text-sm font-medium text-amber-400">Custom Prompt (one-time)</span>
                  {customPrompt !== prompt && (
                    <Badge variant="outline" className="text-xs border-amber-500/30 text-amber-400">
                      Modified
                    </Badge>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCustomPrompt(prompt)}
                  disabled={customPrompt === prompt}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <RotateCcw className="w-4 h-4 mr-1" />
                  Reset to Default
                </Button>
              </div>
              <Textarea
                value={customPrompt}
                onChange={e => setCustomPrompt(e.target.value)}
                className="h-32 font-mono text-sm resize-none"
                placeholder="Enter custom prompt..."
              />
              <p className="text-xs text-muted-foreground">
                This prompt will be used only for this video. Refresh or close popup to reset.
              </p>
            </div>
          )}

          {/* Custom Images Section */}
          {showImageSection && (
            <div className="border border-emerald-500/30 rounded-lg p-4 bg-emerald-500/5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm font-medium text-emerald-400">Custom Images</span>
                  {customImages.length > 0 && (
                    <Badge variant="outline" className="text-xs border-emerald-500/30 text-emerald-400">
                      {customImages.length} image{customImages.length > 1 ? 's' : ''}
                    </Badge>
                  )}
                </div>
                {customImages.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAllImages}
                    className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Clear All
                  </Button>
                )}
              </div>

              {/* Upload Area */}
              <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-emerald-500/30 rounded-lg cursor-pointer hover:bg-emerald-500/5 transition-colors">
                <div className="flex flex-col items-center justify-center">
                  <Upload className="w-6 h-6 text-emerald-400 mb-1" />
                  <p className="text-sm text-emerald-400">Click to upload images</p>
                  <p className="text-xs text-muted-foreground">Multiple images will fade transition</p>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageSelect}
                  className="hidden"
                />
              </label>

              {/* Image Previews */}
              {imagePreviewUrls.length > 0 && (
                <div className="grid grid-cols-4 gap-2">
                  {imagePreviewUrls.map((url, index) => (
                    <div key={index} className="relative group aspect-video rounded-lg overflow-hidden bg-muted">
                      <img
                        src={url}
                        alt={`Image ${index + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeImage(index)}
                          className="text-white hover:text-red-400 hover:bg-red-500/20"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                      <div className="absolute bottom-1 left-1 bg-black/70 text-white text-xs px-1.5 rounded">
                        {index + 1}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                {customImages.length === 0
                  ? "No custom images. Video will use default image folder."
                  : customImages.length === 1
                    ? "Single image will be used as static background."
                    : `${customImages.length} images will fade transition throughout the video.`}
              </p>
            </div>
          )}

          {/* Chunks Mode UI */}
          {chunksMode && (
            <div className="border border-pink-500/30 rounded-lg p-4 bg-pink-500/5 space-y-4">
              {/* Header with progress */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Scissors className="w-5 h-5 text-pink-400" />
                  <span className="font-medium text-pink-400">
                    Chunk {currentChunkIndex + 1} of {chunks.length}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {processedChunks.filter(c => c.trim()).length}/{chunks.length} done
                  </Badge>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={exitChunksMode}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {/* Chunk indicators */}
              <div className="flex gap-1 flex-wrap">
                {chunks.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setCurrentChunkIndex(idx)
                      setChunkInput(processedChunks[idx] || "")
                    }}
                    className={`w-8 h-8 rounded text-xs font-medium transition-colors ${
                      idx === currentChunkIndex
                        ? "bg-pink-500 text-white"
                        : processedChunks[idx]?.trim()
                        ? "bg-green-500/20 text-green-400 border border-green-500/30"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {processedChunks[idx]?.trim() ? <Check className="w-4 h-4 mx-auto" /> : idx + 1}
                  </button>
                ))}
              </div>

              {/* Current chunk display */}
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-2 block">
                  Current Chunk ({chunks[currentChunkIndex]?.length.toLocaleString()} chars)
                </label>
                <div className="bg-background border border-border rounded-lg p-3 max-h-32 overflow-y-auto">
                  <p className="text-sm font-mono whitespace-pre-wrap text-muted-foreground">
                    {chunks[currentChunkIndex]?.substring(0, 500)}
                    {chunks[currentChunkIndex]?.length > 500 && "..."}
                  </p>
                </div>
              </div>

              {/* Copy button */}
              <div className="flex gap-2">
                <Button
                  onClick={copyCurrentChunk}
                  className="bg-gradient-to-r from-pink-600 to-purple-500 hover:from-pink-500 hover:to-purple-400"
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Copy Prompt + Chunk {currentChunkIndex + 1}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    copyCurrentChunk()
                    window.open("https://gemini.google.com", "_blank")
                  }}
                  className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Open Gemini
                </Button>
              </div>

              {/* Paste processed chunk */}
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-2 block">
                  Paste Processed Chunk Here ({chunkInput.length.toLocaleString()} chars)
                </label>
                <Textarea
                  value={chunkInput}
                  onChange={e => setChunkInput(e.target.value)}
                  className="h-32 font-mono text-sm resize-none"
                  placeholder="Paste the processed script for this chunk..."
                />
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <Button
                  onClick={saveChunkAndNext}
                  disabled={!chunkInput.trim()}
                  className="bg-gradient-to-r from-emerald-600 to-cyan-500 hover:from-emerald-500 hover:to-cyan-400"
                >
                  {currentChunkIndex < chunks.length - 1 ? (
                    <>
                      <ChevronRight className="w-4 h-4 mr-2" />
                      Save & Next
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 mr-2" />
                      Save Last
                    </>
                  )}
                </Button>
                {processedChunks.every(c => c.trim()) && (
                  <Button
                    onClick={mergeAllChunks}
                    className="bg-gradient-to-r from-violet-600 to-pink-500 hover:from-violet-500 hover:to-pink-400"
                  >
                    <Merge className="w-4 h-4 mr-2" />
                    Merge All ({processedChunks.length} chunks)
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Script Box */}
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-2 block">
              Script (paste or generate with AI) - {script.length.toLocaleString()} chars
            </label>
            <Textarea
              value={script}
              onChange={e => {
                // Clean script: convert curly quotes to apostrophe, remove other symbols
                const cleaned = e.target.value
                  .replace(/[\u2018\u2019]/g, "'").replace(/[*""\u201C\u201D`#@&^~]/g, '')
                setScript(cleaned)
              }}
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
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={aiImageMode}
                onChange={e => setAiImageMode(e.target.checked)}
                className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-violet-500 focus:ring-violet-500"
              />
              <Sparkles className="w-4 h-4 text-violet-400" />
              <span className="text-sm text-muted-foreground">AI Images</span>
            </label>
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
