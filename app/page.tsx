"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { Loader2, RefreshCw, Settings, Youtube, Search, X } from "lucide-react"
import { VideoPopup } from "@/components/video-popup"
import { TranscriptPopup } from "@/components/transcript-popup"
import Link from "next/link"

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

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:00`
  }
  return `${minutes}:00`
}

function formatViews(views: number): string {
  if (views >= 1000000) {
    return `${(views / 1000000).toFixed(1)}M`
  }
  if (views >= 1000) {
    return `${(views / 1000).toFixed(0)}K`
  }
  return views.toString()
}

export default function HomePage() {
  const [videos, setVideos] = useState<Video[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [remaining, setRemaining] = useState(0)
  const [channelName, setChannelName] = useState<string | null>(null)

  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null)
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([])
  const [defaultReferenceAudio, setDefaultReferenceAudio] = useState("")
  const [prompt, setPrompt] = useState("")

  // YouTube URL input state
  const [youtubeUrl, setYoutubeUrl] = useState("")
  const [fetchingTranscript, setFetchingTranscript] = useState(false)
  const [showTranscriptPopup, setShowTranscriptPopup] = useState(false)
  const [urlTranscript, setUrlTranscript] = useState("")
  const [urlVideoId, setUrlVideoId] = useState("")

  useEffect(() => {
    loadVideos(1)
    loadAudioFiles()
    loadSettings()
  }, [])

  async function loadVideos(pageNum: number, append: boolean = false) {
    if (pageNum === 1) {
      setLoading(true)
    } else {
      setLoadingMore(true)
    }

    try {
      const res = await fetch(`/api/videos?page=${pageNum}&limit=100`)
      const data = await res.json()

      if (data.videos) {
        if (append) {
          setVideos(prev => [...prev, ...data.videos])
        } else {
          setVideos(data.videos)
        }
        setHasMore(data.hasMore)
        setTotal(data.total)
        setRemaining(data.remaining)
        setChannelName(data.channelName)
        setPage(pageNum)
      }
    } catch (error) {
      console.error("Error loading videos:", error)
      toast.error("Failed to load videos")
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  async function loadAudioFiles() {
    try {
      const res = await fetch("/api/reference-audio")
      const data = await res.json()
      setAudioFiles(data.files || [])
    } catch (error) {
      console.error("Error loading audio files:", error)
    }
  }

  async function loadSettings() {
    try {
      const res = await fetch("/api/settings")
      const data = await res.json()
      setDefaultReferenceAudio(data.defaultReferenceAudio || "")
      if (data.prompts?.youtube) {
        setPrompt(data.prompts.youtube)
      }
    } catch (error) {
      console.error("Error loading settings:", error)
    }
  }

  function handleLoadMore() {
    loadVideos(page + 1, true)
  }

  function handleVideoClick(video: Video) {
    setSelectedVideo(video)
  }

  async function handleSkip(videoId: string) {
    try {
      await fetch("/api/videos/skip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId })
      })
      // Remove from list
      setVideos(prev => prev.filter(v => v.videoId !== videoId))
      setTotal(prev => prev - 1)
      toast.success("Video skipped")
    } catch (error) {
      console.error("Error skipping video:", error)
    }
  }

  async function handleAddToQueue(videoId: string) {
    // Mark as completed
    try {
      await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId, action: "complete" })
      })
      // Remove from list
      setVideos(prev => prev.filter(v => v.videoId !== videoId))
      setTotal(prev => prev - 1)
    } catch (error) {
      console.error("Error marking video as complete:", error)
    }
  }

  function handleRefresh() {
    loadVideos(1)
  }

  // Extract videoId from YouTube URL
  function extractVideoId(url: string): string | null {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\s?]+)/,
      /^([a-zA-Z0-9_-]{11})$/
    ]
    for (const pattern of patterns) {
      const match = url.match(pattern)
      if (match) return match[1]
    }
    return null
  }

  async function handleProcessUrl() {
    if (!youtubeUrl.trim()) {
      toast.error("Enter YouTube URL")
      return
    }

    const videoId = extractVideoId(youtubeUrl.trim())
    if (!videoId) {
      toast.error("Invalid YouTube URL")
      return
    }

    setFetchingTranscript(true)
    try {
      const res = await fetch(`/api/videos/transcript?videoId=${videoId}`)
      const data = await res.json()

      if (res.ok && data.transcript) {
        setUrlTranscript(data.transcript)
        setUrlVideoId(videoId)
        setShowTranscriptPopup(true)
      } else {
        toast.error(data.error || "Failed to fetch transcript")
      }
    } catch (error) {
      toast.error("Failed to fetch transcript")
    } finally {
      setFetchingTranscript(false)
    }
  }

  function handleCloseTranscriptPopup() {
    setShowTranscriptPopup(false)
    setUrlTranscript("")
    setUrlVideoId("")
    setYoutubeUrl("")
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        <p className="mt-4 text-muted-foreground">Loading videos...</p>
      </div>
    )
  }

  // No videos fetched yet - show setup message with URL input
  if (videos.length === 0 && !channelName) {
    return (
      <div className="space-y-6">
        {/* YouTube URL Input */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Youtube className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-500" />
            <Input
              value={youtubeUrl}
              onChange={e => setYoutubeUrl(e.target.value)}
              placeholder="Paste YouTube video URL..."
              className="pl-10 pr-10"
              onKeyDown={e => e.key === "Enter" && handleProcessUrl()}
            />
            {youtubeUrl && (
              <button
                onClick={() => setYoutubeUrl("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <Button
            onClick={handleProcessUrl}
            disabled={fetchingTranscript || !youtubeUrl.trim()}
            className="bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400"
          >
            {fetchingTranscript ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            <span className="ml-2 hidden sm:inline">Process</span>
          </Button>
        </div>

        {/* Setup Message */}
        <div className="flex flex-col items-center justify-center py-12">
          <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
            <Youtube className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-xl font-semibold mb-2">No Videos Yet</h2>
          <p className="text-muted-foreground text-center mb-6 max-w-md">
            Paste a YouTube URL above or set up your source channel in Settings.
          </p>
          <Link href="/settings">
            <Button className="bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400">
              <Settings className="w-4 h-4 mr-2" />
              Go to Settings
            </Button>
          </Link>
        </div>

        {/* Transcript Popup for URL */}
        {showTranscriptPopup && (
          <TranscriptPopup
            transcript={urlTranscript}
            videoId={urlVideoId}
            audioFiles={audioFiles}
            defaultReferenceAudio={defaultReferenceAudio}
            prompt={prompt}
            onClose={handleCloseTranscriptPopup}
          />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* YouTube URL Input */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Youtube className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-500" />
          <Input
            value={youtubeUrl}
            onChange={e => setYoutubeUrl(e.target.value)}
            placeholder="Paste YouTube video URL..."
            className="pl-10 pr-10"
            onKeyDown={e => e.key === "Enter" && handleProcessUrl()}
          />
          {youtubeUrl && (
            <button
              onClick={() => setYoutubeUrl("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <Button
          onClick={handleProcessUrl}
          disabled={fetchingTranscript || !youtubeUrl.trim()}
          className="bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400"
        >
          {fetchingTranscript ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Search className="w-4 h-4" />
          )}
          <span className="ml-2 hidden sm:inline">Process</span>
        </Button>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Youtube className="w-6 h-6 text-red-500" />
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold">{channelName || "Videos"}</h1>
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            {total} videos available
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          className="border-violet-500/30 hover:border-violet-500 hover:bg-violet-500/10"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Video Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {videos.map(video => (
          <div
            key={video.videoId}
            onClick={() => handleVideoClick(video)}
            className="group cursor-pointer"
          >
            {/* Thumbnail */}
            <div className="relative aspect-video rounded-lg overflow-hidden bg-muted">
              <img
                src={video.thumbnail}
                alt={video.title}
                className="w-full h-full object-cover transition-transform group-hover:scale-105"
                loading="lazy"
              />
              {/* Duration badge */}
              <div className="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1 rounded">
                {formatDuration(video.duration)}
              </div>
              {/* Hover overlay */}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
            </div>
            {/* Title */}
            <div className="mt-2">
              <h3 className="text-sm font-medium line-clamp-2 group-hover:text-violet-400 transition-colors">
                {video.title}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                {formatViews(video.viewCount)} views
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Load More */}
      {hasMore && (
        <div className="flex justify-center py-4">
          <Button
            variant="outline"
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="px-8"
          >
            {loadingMore ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : null}
            Load More ({remaining} remaining)
          </Button>
        </div>
      )}

      {/* All videos processed */}
      {videos.length === 0 && channelName && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">All videos have been processed!</p>
          <Link href="/settings">
            <Button variant="link" className="mt-2">
              Fetch more videos in Settings
            </Button>
          </Link>
        </div>
      )}

      {/* Video Popup */}
      {selectedVideo && (
        <VideoPopup
          video={selectedVideo}
          audioFiles={audioFiles}
          defaultReferenceAudio={defaultReferenceAudio}
          prompt={prompt}
          onClose={() => setSelectedVideo(null)}
          onSkip={handleSkip}
          onAddToQueue={handleAddToQueue}
        />
      )}

      {/* Transcript Popup for URL */}
      {showTranscriptPopup && (
        <TranscriptPopup
          transcript={urlTranscript}
          videoId={urlVideoId}
          audioFiles={audioFiles}
          defaultReferenceAudio={defaultReferenceAudio}
          prompt={prompt}
          onClose={handleCloseTranscriptPopup}
        />
      )}
    </div>
  )
}
