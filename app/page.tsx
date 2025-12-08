"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "sonner"
import { Loader2, RefreshCw, Settings, Youtube, Search, X, CheckSquare, Square, Play, ArrowUpDown, Menu } from "lucide-react"
import { VideoPopup } from "@/components/video-popup"
import { TranscriptPopup } from "@/components/transcript-popup"
import Link from "next/link"

interface Video {
  videoId: string
  title: string
  thumbnail: string
  duration: number
  viewCount: number
  publishedAt?: string
}

interface ChannelVideoStatus {
  channelCode: string
  channelName: string
  channelLogo?: string
  channelId?: string
  totalVideos: number
  fetchedAt: string
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

  // Channels
  const [channelsWithVideos, setChannelsWithVideos] = useState<ChannelVideoStatus[]>([])
  const [selectedChannel, setSelectedChannel] = useState<string>("")
  const [fetchingLatest, setFetchingLatest] = useState(false)

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

  // Search state
  const [searchQuery, setSearchQuery] = useState("")

  // Sort state
  const [sortBy, setSortBy] = useState<"views" | "latest" | "oldest">("views")

  // Multi-select state
  const [selectMode, setSelectMode] = useState(false)
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(new Set())

  // Mobile sidebar state
  const [showMobileSidebar, setShowMobileSidebar] = useState(false)

  useEffect(() => {
    loadInitialData()
  }, [])

  // Load videos and fetch latest when channel changes
  useEffect(() => {
    if (selectedChannel) {
      fetchLatestAndLoadVideos()
    }
  }, [selectedChannel])

  // Reload videos when sort changes (with current sort value)
  useEffect(() => {
    if (selectedChannel && videos.length > 0) {
      loadVideos(1, false, sortBy)
    }
  }, [sortBy])

  async function fetchLatestAndLoadVideos() {
    if (!selectedChannel) return

    setFetchingLatest(true)
    try {
      // First fetch latest 10 videos and add new ones
      const res = await fetch("/api/videos/fetch-latest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelCode: selectedChannel })
      })

      const data = await res.json()
      if (data.addedCount > 0) {
        toast.success(`${data.addedCount} new video(s) added!`)
        // Switch to Latest sort to show new videos at top
        setSortBy("latest")
        // Load with latest sort directly
        loadVideos(1, false, "latest")
        return
      }
    } catch (error) {
      console.error("Error fetching latest:", error)
    } finally {
      setFetchingLatest(false)
    }

    // Then load all videos with current sort
    loadVideos(1, false, sortBy)
  }

  async function loadInitialData() {
    setLoading(true)
    try {
      // Load channels that have videos fetched
      const videoFetchRes = await fetch("/api/videos/fetch")
      const videoFetchData = await videoFetchRes.json()

      const channelsWithVids = videoFetchData.channels || []
      setChannelsWithVideos(channelsWithVids)

      // Select first channel that has videos
      if (channelsWithVids.length > 0) {
        setSelectedChannel(channelsWithVids[0].channelCode)
      } else {
        setLoading(false)
      }

      // Load audio files and settings
      loadAudioFiles()
      loadSettings()
    } catch (error) {
      console.error("Error loading initial data:", error)
      setLoading(false)
    }
  }

  async function loadVideos(pageNum: number, append: boolean = false, sort: string = sortBy) {
    if (!selectedChannel) return

    if (pageNum === 1) {
      setLoading(true)
    } else {
      setLoadingMore(true)
    }

    try {
      const res = await fetch(`/api/videos?page=${pageNum}&limit=100&channel=${selectedChannel}&sort=${sort}`)
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
    loadVideos(page + 1, true, sortBy)
  }

  function handleVideoClick(video: Video) {
    setSelectedVideo(video)
  }

  async function handleSkip(videoId: string) {
    try {
      await fetch("/api/videos/skip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId, channelCode: selectedChannel })
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
        body: JSON.stringify({ videoId, action: "complete", channelCode: selectedChannel })
      })
      // Remove from list
      setVideos(prev => prev.filter(v => v.videoId !== videoId))
      setTotal(prev => prev - 1)
    } catch (error) {
      console.error("Error marking video as complete:", error)
    }
  }

  function handleRefresh() {
    loadVideos(1, false, sortBy)
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

  // Filter videos based on search query (videos already sorted by API)
  const filteredVideos = searchQuery.trim()
    ? videos.filter(v => v.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : videos

  // Toggle video selection
  function toggleVideoSelection(videoId: string) {
    setSelectedVideoIds(prev => {
      const newSet = new Set(prev)
      if (newSet.has(videoId)) {
        newSet.delete(videoId)
      } else {
        newSet.add(videoId)
      }
      return newSet
    })
  }

  // Select all filtered videos
  function selectAllFiltered() {
    setSelectedVideoIds(new Set(filteredVideos.map(v => v.videoId)))
  }

  // Clear selection
  function clearSelection() {
    setSelectedVideoIds(new Set())
  }

  // Process first selected video (opens popup, user processes, then moves to next)
  function processNextSelected() {
    if (selectedVideoIds.size === 0) {
      toast.error("No videos selected")
      return
    }
    const firstId = Array.from(selectedVideoIds)[0]
    const video = videos.find(v => v.videoId === firstId)
    if (video) {
      setSelectedVideo(video)
    }
  }

  // When a video is processed (skip or add to queue), remove from selection and open next
  function handleSkipWithSelection(videoId: string) {
    handleSkip(videoId)
    // Remove from selection and open next
    const remainingIds = Array.from(selectedVideoIds).filter(id => id !== videoId)
    setSelectedVideoIds(new Set(remainingIds))

    // Open next video after small delay
    if (remainingIds.length > 0) {
      setTimeout(() => {
        const nextVideo = videos.find(v => v.videoId === remainingIds[0])
        if (nextVideo) {
          setSelectedVideo(nextVideo)
        }
      }, 300)
    }
  }

  function handleAddToQueueWithSelection(videoId: string) {
    handleAddToQueue(videoId)
    // Remove from selection and open next
    const remainingIds = Array.from(selectedVideoIds).filter(id => id !== videoId)
    setSelectedVideoIds(new Set(remainingIds))

    // Open next video after small delay
    if (remainingIds.length > 0) {
      setTimeout(() => {
        // Need to check videos list again since handleAddToQueue removes the video
        const nextVideo = videos.find(v => v.videoId === remainingIds[0])
        if (nextVideo) {
          setSelectedVideo(nextVideo)
        }
      }, 300)
    }
  }

  // When popup closes normally (not via skip/add), just close
  function handlePopupClose() {
    setSelectedVideo(null)
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
    <div className="flex gap-4 h-[calc(100vh-120px)]">
      {/* Mobile Sidebar Overlay */}
      {showMobileSidebar && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setShowMobileSidebar(false)}
        />
      )}

      {/* Channel Sidebar */}
      <div className={`w-36 flex-shrink-0 bg-background border border-border rounded-lg p-2 overflow-y-auto ${showMobileSidebar ? 'fixed left-0 top-0 h-full z-50 block' : 'hidden lg:relative lg:block'}`}>
        {/* Close button for mobile */}
        <button
          className="lg:hidden absolute top-2 right-2 p-1 rounded hover:bg-muted"
          onClick={() => setShowMobileSidebar(false)}
        >
          <X className="w-4 h-4" />
        </button>
        <div className="space-y-2 mt-8 lg:mt-0">
          {channelsWithVideos.map(channel => (
            <button
              key={channel.channelCode}
              onClick={() => {
                setSelectedChannel(channel.channelCode)
                setShowMobileSidebar(false)
              }}
              className={`w-full flex flex-col items-center p-2 rounded-lg transition-colors ${
                selectedChannel === channel.channelCode
                  ? "bg-violet-500/20 border border-violet-500/50"
                  : "hover:bg-muted/50 border border-transparent"
              }`}
              title={channel.channelName}
            >
              {channel.channelLogo ? (
                <img
                  src={channel.channelLogo}
                  alt={channel.channelName}
                  className="w-12 h-12 rounded-full object-cover"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
                  <Youtube className="w-6 h-6 text-red-500" />
                </div>
              )}
              <span className="text-xs font-medium mt-1 truncate w-full text-center">
                {channel.channelName}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {channel.totalVideos} videos
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 space-y-4 overflow-y-auto pr-2">
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

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search videos by title..."
          className="pl-10 pr-10"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              {/* Mobile menu button */}
              <button
                className="lg:hidden p-1 rounded hover:bg-muted"
                onClick={() => setShowMobileSidebar(true)}
              >
                <Menu className="w-6 h-6" />
              </button>
              <Youtube className="w-6 h-6 text-red-500" />
              <h1 className="text-xl sm:text-2xl font-bold">{channelName || "Videos"}</h1>
              {fetchingLatest && <Loader2 className="w-4 h-4 animate-spin text-violet-400" />}
            </div>
            <p className="text-muted-foreground text-sm mt-1">
              {searchQuery ? `${filteredVideos.length} of ${total} videos` : `${total} videos available`}
            </p>
          </div>
          {/* Sort Dropdown */}
          <Select value={sortBy} onValueChange={(v: "views" | "latest" | "oldest") => setSortBy(v)}>
            <SelectTrigger className="w-[130px] border-amber-500/30">
              <ArrowUpDown className="w-4 h-4 mr-2 text-amber-400" />
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="views">Most Views</SelectItem>
              <SelectItem value="latest">Latest</SelectItem>
              <SelectItem value="oldest">Oldest</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          {/* Select Mode Toggle */}
          <Button
            variant={selectMode ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setSelectMode(!selectMode)
              if (selectMode) clearSelection()
            }}
            className={selectMode ? "bg-violet-600 hover:bg-violet-500" : "border-violet-500/30 hover:border-violet-500 hover:bg-violet-500/10"}
          >
            <CheckSquare className="w-4 h-4 mr-2" />
            Select
          </Button>
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
      </div>

      {/* Selection Controls */}
      {selectMode && (
        <div className="flex items-center gap-2 p-3 bg-violet-500/10 border border-violet-500/30 rounded-lg">
          <span className="text-sm text-violet-400">
            {selectedVideoIds.size} selected
          </span>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            onClick={selectAllFiltered}
            className="text-violet-400 hover:text-violet-300"
          >
            Select All ({filteredVideos.length})
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearSelection}
            className="text-muted-foreground hover:text-foreground"
          >
            Clear
          </Button>
          <Button
            size="sm"
            onClick={processNextSelected}
            disabled={selectedVideoIds.size === 0}
            className="bg-gradient-to-r from-emerald-600 to-cyan-500 hover:from-emerald-500 hover:to-cyan-400"
          >
            <Play className="w-4 h-4 mr-2" />
            Process ({selectedVideoIds.size})
          </Button>
        </div>
      )}

      {/* Video Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {filteredVideos.map(video => {
          const isSelected = selectedVideoIds.has(video.videoId)
          return (
            <div
              key={video.videoId}
              onClick={() => {
                if (selectMode) {
                  toggleVideoSelection(video.videoId)
                } else {
                  handleVideoClick(video)
                }
              }}
              className={`group cursor-pointer ${isSelected ? 'ring-2 ring-violet-500 rounded-lg' : ''}`}
            >
              {/* Thumbnail */}
              <div className="relative aspect-video rounded-lg overflow-hidden bg-muted">
                <img
                  src={video.thumbnail}
                  alt={video.title}
                  className="w-full h-full object-cover transition-transform group-hover:scale-105"
                  loading="lazy"
                />
                {/* Selection checkbox in select mode */}
                {selectMode && (
                  <div className="absolute top-2 left-2 z-10">
                    {isSelected ? (
                      <CheckSquare className="w-6 h-6 text-violet-400 drop-shadow-lg" />
                    ) : (
                      <Square className="w-6 h-6 text-white/70 drop-shadow-lg" />
                    )}
                  </div>
                )}
                {/* Duration badge */}
                <div className="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1 rounded">
                  {formatDuration(video.duration)}
                </div>
                {/* Hover/Selected overlay */}
                <div className={`absolute inset-0 transition-colors ${isSelected ? 'bg-violet-500/20' : 'bg-black/0 group-hover:bg-black/20'}`} />
              </div>
              {/* Title */}
              <div className="mt-2">
                <h3 className={`text-sm font-medium line-clamp-2 transition-colors ${isSelected ? 'text-violet-400' : 'group-hover:text-violet-400'}`}>
                  {video.title}
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatViews(video.viewCount)} views
                </p>
              </div>
            </div>
          )
        })}
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
      </div>

      {/* Video Popup */}
      {selectedVideo && (
        <VideoPopup
          video={selectedVideo}
          audioFiles={audioFiles}
          defaultReferenceAudio={defaultReferenceAudio}
          prompt={prompt}
          onClose={handlePopupClose}
          onSkip={selectMode ? handleSkipWithSelection : handleSkip}
          onAddToQueue={selectMode ? handleAddToQueueWithSelection : handleAddToQueue}
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
