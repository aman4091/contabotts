"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import {
  Download,
  FileText,
  FileAudio,
  Video,
  Check,
  Loader2,
  Trash2,
  ExternalLink,
  Image as ImageIcon,
  FolderOpen,
  RefreshCw
} from "lucide-react"

interface VideoItem {
  id: string
  videoNumber: number
  hasTranscript: boolean
  hasScript: boolean
  hasAudio: boolean
  hasVideo: boolean
  hasThumbnail: boolean
  isCompleted: boolean
  path: string
  gofileLink?: string | null
}

export default function CalendarPage() {
  const [videos, setVideos] = useState<VideoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    loadVideos()
  }, [])

  async function loadVideos() {
    setLoading(true)
    try {
      const res = await fetch("/api/calendar")
      const data = await res.json()
      setVideos(data.videos || [])
    } catch (error) {
      console.error("Error loading videos:", error)
      toast.error("Failed to load videos")
    } finally {
      setLoading(false)
    }
  }

  async function toggleComplete(video: VideoItem) {
    try {
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: video.id,
          completed: !video.isCompleted
        })
      })

      if (res.ok) {
        loadVideos()
        toast.success(video.isCompleted ? "Unmarked" : "Marked as uploaded")
      }
    } catch (error) {
      toast.error("Failed to update")
    }
  }

  function downloadFile(video: VideoItem, fileType: string) {
    if ((fileType === "audio" || fileType === "video") && video.gofileLink) {
      window.open(video.gofileLink, "_blank")
      return
    }
    const url = `/api/calendar/download?videoId=${video.id}&file=${fileType}`
    window.open(url, "_blank")
  }

  async function deleteVideo(video: VideoItem) {
    if (!confirm(`Delete ${video.id}?\n\nThis will delete all files.`)) {
      return
    }

    setDeleting(video.id)
    try {
      const res = await fetch(`/api/calendar?videoId=${video.id}`, { method: "DELETE" })

      if (res.ok) {
        toast.success("Video deleted")
        loadVideos()
      } else {
        const data = await res.json()
        toast.error(data.error || "Failed to delete")
      }
    } catch (error) {
      toast.error("Failed to delete")
    } finally {
      setDeleting(null)
    }
  }

  const pendingVideos = videos.filter(v => !v.isCompleted)
  const completedVideos = videos.filter(v => v.isCompleted)

  function VideoCard({ video }: { video: VideoItem }) {
    const hasAnyFile = video.hasTranscript || video.hasScript || video.hasAudio || video.hasVideo || video.hasThumbnail

    return (
      <div
        className={`p-4 rounded-lg border transition-all ${
          video.isCompleted
            ? "bg-zinc-900/80 border-zinc-700 opacity-60"
            : "bg-zinc-800/50 border-zinc-700 hover:border-zinc-600"
        }`}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Badge variant={video.isCompleted ? "secondary" : "default"} className="text-sm font-bold">
              Video {video.videoNumber}
            </Badge>
            {video.isCompleted && (
              <Badge variant="outline" className="text-xs text-green-400 border-green-500/30">
                <Check className="w-3 h-3 mr-1" />
                Uploaded
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant={video.isCompleted ? "secondary" : "outline"}
              onClick={() => toggleComplete(video)}
              className={video.isCompleted ? "bg-green-600/20 text-green-400 hover:bg-green-600/30" : ""}
            >
              <Check className="w-4 h-4 mr-1" />
              {video.isCompleted ? "Done" : "Mark"}
            </Button>
            {hasAnyFile && !video.isCompleted && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => deleteVideo(video)}
                disabled={deleting === video.id}
                className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
              >
                {deleting === video.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={!video.hasTranscript}
            onClick={() => downloadFile(video, "transcript")}
            className="justify-start text-xs h-9"
          >
            <FileText className="w-4 h-4 mr-2 text-blue-400" />
            Transcript
            {video.hasTranscript && <Download className="w-3 h-3 ml-auto" />}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            disabled={!video.hasScript}
            onClick={() => downloadFile(video, "script")}
            className="justify-start text-xs h-9"
          >
            <FileText className="w-4 h-4 mr-2 text-purple-400" />
            Script
            {video.hasScript && <Download className="w-3 h-3 ml-auto" />}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            disabled={!video.hasAudio}
            onClick={() => downloadFile(video, "audio")}
            className="justify-start text-xs h-9"
          >
            <FileAudio className="w-4 h-4 mr-2 text-green-400" />
            Audio
            {video.hasAudio && <ExternalLink className="w-3 h-3 ml-auto" />}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            disabled={!video.hasVideo}
            onClick={() => downloadFile(video, "video")}
            className="justify-start text-xs h-9"
          >
            <Video className="w-4 h-4 mr-2 text-red-400" />
            Video
            {video.hasVideo && <ExternalLink className="w-3 h-3 ml-auto" />}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            disabled={!video.hasThumbnail}
            onClick={() => downloadFile(video, "thumbnail")}
            className="justify-start text-xs h-9 col-span-2"
          >
            <ImageIcon className="w-4 h-4 mr-2 text-pink-400" />
            Thumbnail
            {video.hasThumbnail && <Download className="w-3 h-3 ml-auto" />}
          </Button>
        </div>

        {!hasAnyFile && (
          <p className="text-xs text-muted-foreground mt-2 text-center">Processing...</p>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold gradient-text">Organized Videos</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {videos.length} videos total - {pendingVideos.length} pending, {completedVideos.length} uploaded
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadVideos}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {videos.length === 0 ? (
        <Card className="glass border-white/10">
          <CardContent className="py-12 text-center">
            <FolderOpen className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No videos yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Process videos from the Videos page to see them here
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Pending Videos */}
          {pendingVideos.length > 0 && (
            <Card className="glass border-white/10">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  Pending ({pendingVideos.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {pendingVideos.map(video => (
                    <VideoCard key={video.id} video={video} />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Completed Videos */}
          {completedVideos.length > 0 && (
            <Card className="glass border-white/10">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  Uploaded ({completedVideos.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {completedVideos.map(video => (
                    <VideoCard key={video.id} video={video} />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
