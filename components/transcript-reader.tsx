"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, ChevronLeft, ChevronRight, Check } from "lucide-react"

interface TranscriptFile {
  index: number
  title: string
  videoId: string
  charCount: number
}

interface TranscriptReaderProps {
  channelCode: string
  onSelect: (videoId: string, title: string, transcript: string) => void
}

export function TranscriptReader({ channelCode, onSelect }: TranscriptReaderProps) {
  const [transcripts, setTranscripts] = useState<TranscriptFile[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingContent, setLoadingContent] = useState(false)
  const [transcriptContent, setTranscriptContent] = useState("")
  const [currentMeta, setCurrentMeta] = useState<TranscriptFile | null>(null)
  const [pageInput, setPageInput] = useState("")

  // Load transcript list on mount
  useEffect(() => {
    loadTranscriptList()
  }, [channelCode])

  // Load transcript content when index changes
  useEffect(() => {
    if (transcripts.length > 0 && currentIndex >= 0) {
      loadTranscriptContent(transcripts[currentIndex])
    }
  }, [currentIndex, transcripts])

  async function loadTranscriptList() {
    setLoading(true)
    try {
      const res = await fetch(`/api/transcripts/list?channel=${channelCode}`)
      if (res.ok) {
        const data = await res.json()
        setTranscripts(data.transcripts || [])
        if (data.transcripts?.length > 0) {
          setCurrentIndex(0)
        }
      }
    } catch (error) {
      console.error("Failed to load transcripts:", error)
    } finally {
      setLoading(false)
    }
  }

  async function loadTranscriptContent(meta: TranscriptFile) {
    setLoadingContent(true)
    setCurrentMeta(meta)
    try {
      const res = await fetch(`/api/transcripts/${meta.index}?channel=${channelCode}`)
      if (res.ok) {
        const data = await res.json()
        setTranscriptContent(data.content || "")
      }
    } catch (error) {
      console.error("Failed to load transcript content:", error)
    } finally {
      setLoadingContent(false)
    }
  }

  function goToPrevious() {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1)
    }
  }

  function goToNext() {
    if (currentIndex < transcripts.length - 1) {
      setCurrentIndex(currentIndex + 1)
    }
  }

  function goToPage() {
    const pageNum = parseInt(pageInput)
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= transcripts.length) {
      setCurrentIndex(pageNum - 1)
      setPageInput("")
    }
  }

  function handleSelect() {
    if (currentMeta && transcriptContent) {
      onSelect(currentMeta.videoId, currentMeta.title, transcriptContent)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-violet-500" />
      </div>
    )
  }

  if (transcripts.length === 0) {
    return (
      <div className="flex items-center justify-center h-96 text-muted-foreground">
        No transcripts found for this channel
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="flex-1 min-w-0 mr-4">
          <h2 className="text-lg font-semibold truncate text-foreground">
            {currentMeta?.title || "Loading..."}
          </h2>
          <p className="text-sm text-muted-foreground">
            Video ID: {currentMeta?.videoId || "..."}
          </p>
        </div>

        {/* Navigation */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={goToPrevious}
            disabled={currentIndex === 0 || loadingContent}
            className="border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
          >
            <ChevronLeft className="w-4 h-4" />
            Previous
          </Button>

          <div className="flex items-center gap-1">
            <Input
              type="number"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && goToPage()}
              placeholder={String(currentIndex + 1)}
              className="w-16 h-8 text-center text-sm"
              min={1}
              max={transcripts.length}
            />
            <span className="text-sm text-muted-foreground">/ {transcripts.length}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={goToPage}
              disabled={!pageInput || loadingContent}
              className="h-8 px-2 border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
            >
              Go
            </Button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={goToNext}
            disabled={currentIndex === transcripts.length - 1 || loadingContent}
            className="border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Transcript Content */}
      <div className="flex-1 overflow-auto p-4">
        {loadingContent ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
          </div>
        ) : (
          <div className="max-w-4xl mx-auto">
            <div className="prose prose-invert max-w-none">
              <pre className="whitespace-pre-wrap font-sans text-base leading-relaxed text-foreground bg-muted/30 p-6 rounded-lg">
                {transcriptContent}
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* Footer with Select Button */}
      <div className="flex items-center justify-between p-4 border-t border-border bg-background/80 backdrop-blur-sm">
        <div className="text-sm text-muted-foreground">
          {currentMeta?.charCount?.toLocaleString() || 0} characters
        </div>
        <Button
          onClick={handleSelect}
          disabled={loadingContent || !transcriptContent}
          className="bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500"
        >
          <Check className="w-4 h-4 mr-2" />
          Select & Process
        </Button>
      </div>
    </div>
  )
}
