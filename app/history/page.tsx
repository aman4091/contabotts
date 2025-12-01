"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"
import { Loader2, RotateCcw, Trash2, History, CheckCircle, XCircle } from "lucide-react"

interface Video {
  videoId: string
  title: string
  thumbnail: string
  duration: number
  viewCount: number
}

interface ChannelVideoStatus {
  channelCode: string
  channelName: string
  totalVideos: number
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
  if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M`
  if (views >= 1000) return `${(views / 1000).toFixed(0)}K`
  return views.toString()
}

export default function HistoryPage() {
  const [loading, setLoading] = useState(true)
  const [skippedVideos, setSkippedVideos] = useState<Video[]>([])
  const [completedVideos, setCompletedVideos] = useState<Video[]>([])
  const [channelsWithVideos, setChannelsWithVideos] = useState<ChannelVideoStatus[]>([])
  const [selectedChannel, setSelectedChannel] = useState<string>("")
  const [restoringId, setRestoringId] = useState<string | null>(null)

  useEffect(() => {
    loadChannels()
  }, [])

  useEffect(() => {
    if (selectedChannel) {
      loadProcessedVideos()
    }
  }, [selectedChannel])

  async function loadChannels() {
    try {
      const res = await fetch("/api/videos/fetch")
      const data = await res.json()
      const channels = data.channels || []
      setChannelsWithVideos(channels)
      if (channels.length > 0) {
        setSelectedChannel(channels[0].channelCode)
      } else {
        setLoading(false)
      }
    } catch (error) {
      console.error("Error loading channels:", error)
      setLoading(false)
    }
  }

  async function loadProcessedVideos() {
    setLoading(true)
    try {
      const res = await fetch(`/api/videos/skip?channel=${selectedChannel}`)
      const data = await res.json()
      setSkippedVideos(data.skipped || [])
      setCompletedVideos(data.completed || [])
    } catch (error) {
      console.error("Error loading processed videos:", error)
    } finally {
      setLoading(false)
    }
  }

  async function handleRestore(videoId: string) {
    setRestoringId(videoId)
    try {
      const res = await fetch(`/api/videos/skip?videoId=${videoId}&channel=${selectedChannel}`, {
        method: "DELETE"
      })
      if (res.ok) {
        // Remove from both lists
        setSkippedVideos(prev => prev.filter(v => v.videoId !== videoId))
        setCompletedVideos(prev => prev.filter(v => v.videoId !== videoId))
        toast.success("Video restored to main list")
      } else {
        toast.error("Failed to restore video")
      }
    } catch (error) {
      toast.error("Failed to restore video")
    } finally {
      setRestoringId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        <p className="mt-4 text-muted-foreground">Loading history...</p>
      </div>
    )
  }

  if (channelsWithVideos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <History className="w-16 h-16 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">No History Yet</h2>
        <p className="text-muted-foreground">Process some videos first to see them here.</p>
      </div>
    )
  }

  const totalProcessed = skippedVideos.length + completedVideos.length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <History className="w-8 h-8 text-violet-500" />
          <div>
            <h1 className="text-2xl font-bold">History</h1>
            <p className="text-muted-foreground text-sm">
              {totalProcessed} processed videos
            </p>
          </div>
        </div>

        {/* Channel Selector */}
        <Select value={selectedChannel} onValueChange={setSelectedChannel}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Select channel" />
          </SelectTrigger>
          <SelectContent>
            {channelsWithVideos.map(ch => (
              <SelectItem key={ch.channelCode} value={ch.channelCode}>
                {ch.channelName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="skipped" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="skipped" className="flex items-center gap-2">
            <XCircle className="w-4 h-4" />
            Skipped ({skippedVideos.length})
          </TabsTrigger>
          <TabsTrigger value="completed" className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4" />
            Completed ({completedVideos.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="skipped" className="mt-6">
          {skippedVideos.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No skipped videos
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {skippedVideos.map(video => (
                <VideoCard
                  key={video.videoId}
                  video={video}
                  type="skipped"
                  onRestore={handleRestore}
                  restoring={restoringId === video.videoId}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="completed" className="mt-6">
          {completedVideos.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No completed videos
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {completedVideos.map(video => (
                <VideoCard
                  key={video.videoId}
                  video={video}
                  type="completed"
                  onRestore={handleRestore}
                  restoring={restoringId === video.videoId}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function VideoCard({
  video,
  type,
  onRestore,
  restoring
}: {
  video: Video
  type: "skipped" | "completed"
  onRestore: (id: string) => void
  restoring: boolean
}) {
  return (
    <div className="group relative">
      {/* Thumbnail */}
      <div className="relative aspect-video rounded-lg overflow-hidden bg-muted">
        <img
          src={video.thumbnail}
          alt={video.title}
          className="w-full h-full object-cover opacity-70"
          loading="lazy"
        />
        {/* Duration badge */}
        <div className="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1 rounded">
          {formatDuration(video.duration)}
        </div>
        {/* Status badge */}
        <Badge
          variant={type === "skipped" ? "destructive" : "default"}
          className="absolute top-1 left-1 text-xs"
        >
          {type === "skipped" ? "Skipped" : "Done"}
        </Badge>
        {/* Restore button on hover */}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onRestore(video.videoId)}
            disabled={restoring}
          >
            {restoring ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RotateCcw className="w-4 h-4 mr-1" />
            )}
            Restore
          </Button>
        </div>
      </div>
      {/* Title */}
      <div className="mt-2">
        <h3 className="text-sm font-medium line-clamp-2 text-muted-foreground">
          {video.title}
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          {formatViews(video.viewCount)} views
        </p>
      </div>
    </div>
  )
}
