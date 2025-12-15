"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, ChevronLeft, ChevronRight, Check } from "lucide-react"
import { toast } from "sonner"

interface TranscriptFile {
  index: number
  title: string
  videoId: string
  charCount: number
}

interface Video {
  videoId: string
  title: string
  thumbnail: string
  viewCount: number
}

interface TranscriptReaderProps {
  channelCode: string
  onSelect: (videoId: string, title: string, transcript: string) => void
}

export function TranscriptReader({ channelCode, onSelect }: TranscriptReaderProps) {
  const [transcripts, setTranscripts] = useState<TranscriptFile[]>([])
  const [videos, setVideos] = useState<Video[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingContent, setLoadingContent] = useState(false)
  const [fetchingTranscript, setFetchingTranscript] = useState(false)
  const [transcriptContent, setTranscriptContent] = useState("")
  const [currentMeta, setCurrentMeta] = useState<TranscriptFile | null>(null)
  const [currentVideo, setCurrentVideo] = useState<Video | null>(null)
  const [pageInput, setPageInput] = useState("")
  const [mode, setMode] = useState<"transcripts" | "videos">("transcripts")

  useEffect(() => {
    loadData()
  }, [channelCode])

  useEffect(() => {
    if (mode === "transcripts" && transcripts.length > 0 && currentIndex >= 0 && currentIndex < transcripts.length) {
      loadTranscriptContent(transcripts[currentIndex])
    } else if (mode === "videos" && videos.length > 0 && currentIndex >= 0) {
      loadVideoTranscript(videos[currentIndex])
    }
  }, [currentIndex, transcripts, videos, mode])

  async function loadData() {
    setLoading(true)
    try {
      const transRes = await fetch(`/api/transcripts/list?channel=${channelCode}`)
      let transcriptList: TranscriptFile[] = []
      if (transRes.ok) {
        const data = await transRes.json()
        transcriptList = data.transcripts || []
      }

      const videosRes = await fetch(`/api/videos?channel=${channelCode}&limit=1000&sort=views`)
      let videoList: Video[] = []
      if (videosRes.ok) {
        const data = await videosRes.json()
        videoList = data.videos || []
      }

      setTranscripts(transcriptList)
      setVideos(videoList)

      // Always use videos mode - show all 1000 videos, fetch transcript on-demand
      if (videoList.length > 0) {
        setMode("videos")
        setCurrentIndex(0)
      } else if (transcriptList.length > 0) {
        // Fallback to transcripts mode only if no videos (like GS32)
        setMode("transcripts")
        setCurrentIndex(0)
      }
    } catch (error) {
      console.error("Failed to load data:", error)
    } finally {
      setLoading(false)
    }
  }

  async function loadTranscriptContent(meta: TranscriptFile) {
    setLoadingContent(true)
    setCurrentMeta(meta)
    const video = videos.find(v => v.videoId === meta.videoId)
    setCurrentVideo(video || {
      videoId: meta.videoId,
      title: meta.title,
      thumbnail: `https://i.ytimg.com/vi/${meta.videoId}/hqdefault.jpg`,
      viewCount: 0
    })

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

  async function loadVideoTranscript(video: Video) {
    setLoadingContent(true)
    setCurrentVideo(video)
    setCurrentMeta({
      index: currentIndex + 1,
      title: video.title,
      videoId: video.videoId,
      charCount: 0
    })
    setTranscriptContent("")

    const existingIndex = transcripts.findIndex(t => t.videoId === video.videoId)
    if (existingIndex >= 0) {
      try {
        const res = await fetch(`/api/transcripts/${transcripts[existingIndex].index}?channel=${channelCode}`)
        if (res.ok) {
          const data = await res.json()
          setTranscriptContent(data.content || "")
          setLoadingContent(false)
          return
        }
      } catch (error) {
        console.error("Failed to load existing transcript:", error)
      }
    }

    setFetchingTranscript(true)
    try {
      const res = await fetch(`/api/videos/transcript?videoId=${video.videoId}`)
      if (res.ok) {
        const data = await res.json()
        if (data.transcript) {
          setTranscriptContent(data.transcript)
          saveTranscript(video, data.transcript)
        } else {
          toast.error("No transcript available for this video")
        }
      } else {
        toast.error("Failed to fetch transcript")
      }
    } catch (error) {
      console.error("Failed to fetch transcript:", error)
      toast.error("Failed to fetch transcript")
    } finally {
      setFetchingTranscript(false)
      setLoadingContent(false)
    }
  }

  async function saveTranscript(video: Video, transcript: string) {
    try {
      const nextIndex = transcripts.length + 1
      await fetch("/api/transcripts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelCode,
          transcripts: [{
            index: nextIndex,
            title: video.title,
            videoId: video.videoId,
            transcript
          }]
        })
      })
      setTranscripts(prev => [...prev, {
        index: nextIndex,
        title: video.title,
        videoId: video.videoId,
        charCount: transcript.length
      }])
    } catch (error) {
      console.error("Failed to save transcript:", error)
    }
  }

  function goToPrevious() {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1)
    }
  }

  function goToNext() {
    const total = mode === "transcripts" ? transcripts.length : videos.length
    if (currentIndex < total - 1) {
      setCurrentIndex(currentIndex + 1)
    }
  }

  function goToPage() {
    const total = mode === "transcripts" ? transcripts.length : videos.length
    const pageNum = parseInt(pageInput)
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= total) {
      setCurrentIndex(pageNum - 1)
      setPageInput("")
    }
  }

  function handleSelect() {
    if (currentVideo && transcriptContent) {
      onSelect(currentVideo.videoId, currentVideo.title, transcriptContent)
    }
  }

  const total = mode === "transcripts" ? transcripts.length : videos.length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-violet-500" />
      </div>
    )
  }

  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-96 text-muted-foreground">
        No videos found for this channel
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-180px)] sm:h-[calc(100vh-120px)]">
      {/* Header - Mobile: stacked, Desktop: side by side */}
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 p-3 sm:p-4 border-b border-border bg-background/80 backdrop-blur-sm">
        {/* Thumbnail - smaller on mobile */}
        {currentVideo && (
          <div className="flex-shrink-0 flex justify-center sm:justify-start">
            <img
              src={currentVideo.thumbnail}
              alt={currentVideo.title}
              className="w-32 h-20 sm:w-40 sm:h-24 object-cover rounded-lg"
            />
          </div>
        )}

        {/* Title & Info */}
        <div className="flex-1 min-w-0">
          <h2 className="text-sm sm:text-lg font-semibold line-clamp-2 sm:truncate text-foreground">
            {currentMeta?.title || currentVideo?.title || "Loading..."}
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            ID: {currentMeta?.videoId || currentVideo?.videoId || "..."}
            {currentVideo?.viewCount ? ` | ${currentVideo.viewCount.toLocaleString()} views` : ""}
          </p>

          {/* Navigation - wraps on mobile */}
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={goToPrevious}
              disabled={currentIndex === 0 || loadingContent}
              className="border-violet-500/30 text-violet-400 hover:bg-violet-500/10 h-8 px-2 sm:px-3"
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="hidden sm:inline ml-1">Prev</span>
            </Button>

            <div className="flex items-center gap-1">
              <Input
                type="number"
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && goToPage()}
                placeholder={String(currentIndex + 1)}
                className="w-12 sm:w-16 h-8 text-center text-xs sm:text-sm"
                min={1}
                max={total}
              />
              <span className="text-xs sm:text-sm text-muted-foreground">/ {total}</span>
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
              disabled={currentIndex === total - 1 || loadingContent}
              className="border-violet-500/30 text-violet-400 hover:bg-violet-500/10 h-8 px-2 sm:px-3"
            >
              <span className="hidden sm:inline mr-1">Next</span>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Transcript Content */}
      <div className="flex-1 overflow-auto p-3 sm:p-4">
        {loadingContent || fetchingTranscript ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
            {fetchingTranscript && (
              <p className="text-xs sm:text-sm text-muted-foreground">Fetching transcript...</p>
            )}
          </div>
        ) : transcriptContent ? (
          <div className="max-w-4xl mx-auto">
            <pre className="whitespace-pre-wrap font-sans text-sm sm:text-base leading-relaxed text-foreground bg-muted/30 p-3 sm:p-6 rounded-lg">
              {transcriptContent}
            </pre>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No transcript available
          </div>
        )}
      </div>

      {/* Footer - Sticky */}
      <div className="sticky bottom-0 flex items-center justify-between p-3 sm:p-4 border-t border-border bg-background/95 backdrop-blur-sm z-10">
        <div className="text-xs sm:text-sm text-muted-foreground">
          {transcriptContent.length.toLocaleString()} chars
        </div>
        <Button
          onClick={handleSelect}
          disabled={loadingContent || fetchingTranscript || !transcriptContent}
          className="bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 h-9 sm:h-10 text-sm"
        >
          <Check className="w-4 h-4 mr-1 sm:mr-2" />
          <span className="hidden sm:inline">Select & </span>Process
        </Button>
      </div>
    </div>
  )
}
