"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "sonner"
import {
  X,
  Copy,
  Sparkles,
  ExternalLink,
  Loader2,
  Plus,
  Music,
  Youtube,
  Scissors,
  ChevronRight,
  Check,
  Merge,
  Edit3,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Volume2
} from "lucide-react"

interface AudioFile {
  name: string
  sizeFormatted: string
}

interface TranscriptPopupProps {
  transcript: string
  videoId: string
  audioFiles: AudioFile[]
  defaultReferenceAudio: string
  prompt: string
  onClose: () => void
}

export function TranscriptPopup({
  transcript: initialTranscript,
  videoId,
  audioFiles,
  defaultReferenceAudio,
  prompt,
  onClose
}: TranscriptPopupProps) {
  const [transcript, setTranscript] = useState(initialTranscript)
  const [script, setScript] = useState("")
  const [processing, setProcessing] = useState(false)
  const [addingToQueue, setAddingToQueue] = useState(false)
  const [selectedAudio, setSelectedAudio] = useState(defaultReferenceAudio)

  // Custom prompt (editable, starts with default)
  const [customPrompt, setCustomPrompt] = useState(prompt)
  const [showPromptEditor, setShowPromptEditor] = useState(false)

  // Chunks mode state
  const [chunksMode, setChunksMode] = useState(false)
  const [chunks, setChunks] = useState<string[]>([])
  const [processedChunks, setProcessedChunks] = useState<string[]>([])
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0)
  const [chunkInput, setChunkInput] = useState("")
  const [autoProcessing, setAutoProcessing] = useState(false)

  // Audio only mode
  const [audioOnly, setAudioOnly] = useState(false)

  // AI Image generation mode
  const [aiImageMode, setAiImageMode] = useState(false)

  async function handleCopy() {
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
      const success = document.execCommand("copy")
      document.body.removeChild(textarea)
      if (success) {
        toast.success("Copied prompt + transcript")
      } else {
        toast.error("Copy failed")
      }
    } catch (error) {
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
        body: JSON.stringify({ transcript, prompt: customPrompt })
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

  function handleOpenGemini() {
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

  // Split transcript into chunks
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

  // Auto process all chunks with AI
  async function autoProcessAllChunks() {
    if (chunks.length === 0) return

    setAutoProcessing(true)
    const results: string[] = []

    for (let i = 0; i < chunks.length; i++) {
      setCurrentChunkIndex(i)
      toast.info(`Processing chunk ${i + 1}/${chunks.length}...`)

      try {
        const res = await fetch("/api/ai/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript: chunks[i],
            prompt: customPrompt + `\n\n[Part ${i + 1} of ${chunks.length}]`
          })
        })

        const data = await res.json()
        if (res.ok && data.result) {
          const cleaned = data.result.replace(/[\u2018\u2019]/g, "'").replace(/[*""\u201C\u201D`#@&^~]/g, '')
          results.push(cleaned)

          const newProcessed = [...processedChunks]
          newProcessed[i] = cleaned
          setProcessedChunks([...newProcessed])
        } else {
          toast.error(`Chunk ${i + 1} failed`)
          setAutoProcessing(false)
          return
        }
      } catch (error) {
        toast.error(`Chunk ${i + 1} failed`)
        setAutoProcessing(false)
        return
      }

      // Small delay between chunks
      if (i < chunks.length - 1) {
        await new Promise(r => setTimeout(r, 500))
      }
    }

    // Auto merge
    const merged = results.join("\n\n")
    setScript(merged)
    setChunksMode(false)
    setAutoProcessing(false)
    toast.success("All chunks processed and merged!")
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
          videoTitle: `YouTube Video ${videoId}`,
          videoId,
          referenceAudio: selectedAudio,
          audioEnabled: true,
          audioOnly,
          aiImageMode
        })
      })

      const data = await res.json()
      if (res.ok) {
        toast.success(`Added to queue: ${data.folderName || "video"}`)
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
            <div className="flex items-center gap-2">
              <Youtube className="w-5 h-5 text-red-500" />
              <h2 className="font-semibold text-lg">YouTube Transcript</h2>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Video ID: {videoId}
            </p>
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
            <Textarea
              value={transcript}
              onChange={e => setTranscript(e.target.value)}
              className="h-48 font-mono text-sm resize-none"
              placeholder="Transcript will appear here..."
            />
          </div>

          {/* Prompt Editor (Collapsible) */}
          <div className="border border-border rounded-lg">
            <button
              onClick={() => setShowPromptEditor(!showPromptEditor)}
              className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Custom Prompt</span>
                {customPrompt !== prompt && (
                  <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400">Modified</span>
                )}
              </div>
              {showPromptEditor ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
            {showPromptEditor && (
              <div className="p-3 pt-0 space-y-2">
                <Textarea
                  value={customPrompt}
                  onChange={e => setCustomPrompt(e.target.value)}
                  className="h-32 font-mono text-sm resize-none"
                  placeholder="Enter custom prompt for this transcript..."
                />
                <div className="flex justify-between items-center">
                  <p className="text-xs text-muted-foreground">
                    This prompt will only be used for this transcript
                  </p>
                  {customPrompt !== prompt && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setCustomPrompt(prompt)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      <RotateCcw className="w-3 h-3 mr-1" />
                      Reset to Default
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleCopy}
              disabled={!transcript}
              className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
            >
              <Copy className="w-4 h-4 mr-2" />
              Copy
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleAIProcess}
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
              onClick={startChunksMode}
              disabled={!transcript || chunksMode}
              className="border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
            >
              <Scissors className="w-4 h-4 mr-2" />
              Chunks
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleOpenGemini}
              disabled={!transcript}
              className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Open Gemini
            </Button>
          </div>

          {/* Chunks Mode UI */}
          {chunksMode && (
            <div className="border border-orange-500/30 rounded-lg p-4 space-y-4 bg-orange-500/5">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-orange-400">
                  Chunks Mode ({chunks.length} chunks)
                </h3>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={autoProcessAllChunks}
                    disabled={autoProcessing}
                    className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                  >
                    {autoProcessing ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4 mr-2" />
                    )}
                    Auto Process All
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={exitChunksMode}
                    className="text-muted-foreground"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
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
                        ? "bg-orange-500 text-white"
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
                  className="bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400"
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
                // Clean script: remove asterisks, quotes, and special symbols
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
                checked={audioOnly}
                onChange={e => setAudioOnly(e.target.checked)}
                className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-cyan-500 focus:ring-cyan-500"
              />
              <Volume2 className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Audio Only</span>
            </label>
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
