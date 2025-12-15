"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { Loader2, Youtube, Search, X, Menu, Upload } from "lucide-react"
import { VideoPopup } from "@/components/video-popup"
import { TranscriptPopup } from "@/components/transcript-popup"
import { TranscriptReader } from "@/components/transcript-reader"
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

export default function HomePage() {
  const [loading, setLoading] = useState(true)

  // Channels
  const [channelsWithVideos, setChannelsWithVideos] = useState<ChannelVideoStatus[]>([])
  const [selectedChannel, setSelectedChannel] = useState<string>("")

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

  // Mobile sidebar state
  const [showMobileSidebar, setShowMobileSidebar] = useState(false)

  // Preloaded transcript from TranscriptReader
  const [preloadedTranscript, setPreloadedTranscript] = useState("")

  // Bulk mode callback
  const [bulkCallback, setBulkCallback] = useState<(() => void) | null>(null)

  // Uploaded scripts queue
  const [uploadedScripts, setUploadedScripts] = useState<{name: string, content: string}[]>([])
  const [currentScriptIndex, setCurrentScriptIndex] = useState(0)

  useEffect(() => {
    loadInitialData()
  }, [])

  async function loadInitialData() {
    setLoading(true)
    try {
      // Load channels that have videos fetched
      const videoFetchRes = await fetch("/api/videos/fetch")
      const videoFetchData = await videoFetchRes.json()

      const channelsWithVids = videoFetchData.channels || []

      // Add GS32 as special transcript-only channel at the beginning
      const gs32Channel: ChannelVideoStatus = {
        channelCode: "GS32",
        channelName: "God Says 32",
        channelLogo: "",
        totalVideos: 977,
        fetchedAt: new Date().toISOString()
      }
      setChannelsWithVideos([gs32Channel, ...channelsWithVids])

      // Select first channel
      if (channelsWithVids.length > 0) {
        setSelectedChannel(channelsWithVids[0]?.channelCode || "GS32")
      } else {
        setSelectedChannel("GS32")
      }

      // Load audio files and settings
      loadAudioFiles()
      loadSettings()
    } catch (error) {
      console.error("Error loading initial data:", error)
    } finally {
      setLoading(false)
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

    // Check if there are more uploaded scripts to process
    if (uploadedScripts.length > 0 && currentScriptIndex < uploadedScripts.length - 1) {
      const nextIndex = currentScriptIndex + 1
      setCurrentScriptIndex(nextIndex)
      setTimeout(() => {
        showUploadedScript(nextIndex)
      }, 200)
    } else if (uploadedScripts.length > 0) {
      // Clear uploaded scripts when done
      setUploadedScripts([])
      setCurrentScriptIndex(0)
      toast.success("All uploaded scripts processed!")
    }
  }

  function handlePopupClose() {
    setSelectedVideo(null)
    setPreloadedTranscript("")
    // Call bulk callback if exists (to advance to next in bulk mode)
    if (bulkCallback) {
      const cb = bulkCallback
      setBulkCallback(null)
      setTimeout(() => cb(), 100) // Small delay to let popup close
    }
  }

  function showUploadedScript(index: number) {
    const script = uploadedScripts[index]
    if (script) {
      setUrlTranscript(script.content)
      setUrlVideoId(`upload-${index + 1}`)
      setShowTranscriptPopup(true)
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return

    const scripts: {name: string, content: string}[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (file.type === "text/plain" || file.name.endsWith(".txt")) {
        const content = await file.text()
        scripts.push({ name: file.name, content })
      }
    }

    if (scripts.length === 0) {
      toast.error("No valid .txt files found")
      return
    }

    setUploadedScripts(scripts)
    setCurrentScriptIndex(0)
    toast.success(`${scripts.length} script(s) loaded`)

    // Show first script
    setUrlTranscript(scripts[0].content)
    setUrlVideoId(`upload-1`)
    setShowTranscriptPopup(true)

    // Reset file input
    e.target.value = ""
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        <p className="mt-4 text-muted-foreground">Loading...</p>
      </div>
    )
  }

  // No channels - show setup
  if (channelsWithVideos.length === 0) {
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
          <h2 className="text-xl font-semibold mb-2">No Channels Yet</h2>
          <p className="text-muted-foreground text-center mb-6 max-w-md">
            Add a source channel in Settings to start fetching videos.
          </p>
          <Link href="/settings">
            <Button className="bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400">
              Go to Settings
            </Button>
          </Link>
        </div>

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

      {/* Main Content - TranscriptReader for all channels */}
      <div className="flex-1 space-y-4 overflow-y-auto pr-2">
        {/* Mobile menu button */}
        <button
          className="lg:hidden p-2 rounded hover:bg-muted flex items-center gap-2 text-sm"
          onClick={() => setShowMobileSidebar(true)}
        >
          <Menu className="w-5 h-5" />
          <span>{channelsWithVideos.find(c => c.channelCode === selectedChannel)?.channelName || "Select Channel"}</span>
        </button>

        {/* YouTube URL Input + Upload Script */}
        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
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
          {/* Upload Script Button */}
          <label className="cursor-pointer">
            <input
              type="file"
              accept=".txt"
              multiple
              onChange={handleFileUpload}
              className="hidden"
            />
            <div className="h-10 px-4 flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white rounded-md text-sm font-medium transition-colors">
              <Upload className="w-4 h-4" />
              <span>Upload</span>
            </div>
          </label>
        </div>

        {/* Uploaded Scripts Progress */}
        {uploadedScripts.length > 1 && (
          <div className="text-xs text-muted-foreground bg-amber-500/10 border border-amber-500/30 rounded px-3 py-1.5">
            Uploaded Scripts: {currentScriptIndex + 1} / {uploadedScripts.length}
          </div>
        )}

        {/* TranscriptReader for selected channel */}
        {selectedChannel && (
          <TranscriptReader
            key={selectedChannel}
            channelCode={selectedChannel}
            onSelect={(videoId, title, transcript, onDone) => {
              setPreloadedTranscript(transcript)
              setSelectedVideo({
                videoId,
                title,
                thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                duration: 0,
                viewCount: 0
              })
              // Store callback for bulk mode
              if (onDone) {
                setBulkCallback(() => onDone)
              }
            }}
          />
        )}
      </div>

      {/* Video Popup */}
      {selectedVideo && (
        <VideoPopup
          video={selectedVideo}
          audioFiles={audioFiles}
          defaultReferenceAudio={defaultReferenceAudio}
          prompt={prompt}
          initialTranscript={preloadedTranscript}
          onClose={handlePopupClose}
          onSkip={() => {
            handlePopupClose()
          }}
          onAddToQueue={() => {
            handlePopupClose()
          }}
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
