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
  RefreshCw,
  Square,
  CheckSquare
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkMarking, setBulkMarking] = useState(false)

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

  function toggleSelect(videoId: string) {
    const newSet = new Set(selectedIds)
    if (newSet.has(videoId)) {
      newSet.delete(videoId)
    } else {
      newSet.add(videoId)
    }
    setSelectedIds(newSet)
  }

  function selectAll() {
    const allPendingIds = pendingVideos.map(v => v.id)
    setSelectedIds(new Set(allPendingIds))
  }

  function deselectAll() {
    setSelectedIds(new Set())
  }

  async function markAllSelected() {
    if (selectedIds.size === 0) return
    setBulkMarking(true)
    try {
      const ids = Array.from(selectedIds)
      for (const videoId of ids) {
        await fetch("/api/calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoId, completed: true })
        })
      }
      toast.success(`Marked ${selectedIds.size} videos as uploaded`)
      setSelectedIds(new Set())
      setSelectMode(false)
      loadVideos()
    } catch {
      toast.error("Failed to mark videos")
    } finally {
      setBulkMarking(false)
    }
  }

  async function deleteAllSelected() {
    if (selectedIds.size === 0) return
    if (!confirm(`Delete ${selectedIds.size} selected videos?`)) return

    setBulkDeleting(true)
    try {
      const ids = Array.from(selectedIds)
      for (const videoId of ids) {
        await fetch(`/api/calendar?videoId=${videoId}`, { method: "DELETE" })
      }
      toast.success(`Deleted ${selectedIds.size} videos`)
      setSelectedIds(new Set())
      setSelectMode(false)
      loadVideos()
    } catch {
      toast.error("Failed to delete videos")
    } finally {
      setBulkDeleting(false)
    }
  }

  async function markAllPending() {
    if (pendingVideos.length === 0) return
    if (!confirm(`Mark all ${pendingVideos.length} pending videos as uploaded?`)) return

    setBulkMarking(true)
    try {
      for (const video of pendingVideos) {
        await fetch("/api/calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoId: video.id, completed: true })
        })
      }
      toast.success(`Marked ${pendingVideos.length} videos as uploaded`)
      loadVideos()
    } catch {
      toast.error("Failed to mark videos")
    } finally {
      setBulkMarking(false)
    }
  }

  async function deleteAllPending() {
    if (pendingVideos.length === 0) return
    if (!confirm(`Delete ALL ${pendingVideos.length} pending videos?`)) return

    setBulkDeleting(true)
    try {
      for (const video of pendingVideos) {
        await fetch(`/api/calendar?videoId=${video.id}`, { method: "DELETE" })
      }
      toast.success(`Deleted ${pendingVideos.length} videos`)
      loadVideos()
    } catch {
      toast.error("Failed to delete videos")
    } finally {
      setBulkDeleting(false)
    }
  }

  function VideoRow({ video }: { video: VideoItem }) {
    const hasAnyFile = video.hasTranscript || video.hasScript || video.hasAudio || video.hasVideo || video.hasThumbnail
    const isSelected = selectedIds.has(video.id)

    return (
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-md border transition-all ${
          video.isCompleted
            ? "bg-zinc-900/50 border-zinc-800 opacity-60"
            : isSelected
            ? "bg-violet-500/10 border-violet-500/50"
            : "bg-zinc-800/30 border-zinc-700/50 hover:border-zinc-600"
        }`}
      >
        {/* Checkbox for select mode */}
        {selectMode && !video.isCompleted && (
          <button
            onClick={() => toggleSelect(video.id)}
            className="p-1 shrink-0"
          >
            {isSelected ? (
              <CheckSquare className="w-4 h-4 text-violet-400" />
            ) : (
              <Square className="w-4 h-4 text-zinc-500" />
            )}
          </button>
        )}

        {/* Video Number */}
        <Badge variant={video.isCompleted ? "secondary" : "default"} className="text-xs font-bold shrink-0">
          {video.videoNumber}
        </Badge>

        {/* File Buttons - compact icons */}
        <div className="flex items-center gap-1 flex-1">
          <button
            disabled={!video.hasTranscript}
            onClick={() => downloadFile(video, "transcript")}
            className={`p-1.5 rounded ${video.hasTranscript ? 'text-blue-400 hover:bg-blue-500/20' : 'text-zinc-600 cursor-not-allowed'}`}
            title="Transcript"
          >
            <FileText className="w-4 h-4" />
          </button>

          <button
            disabled={!video.hasScript}
            onClick={() => downloadFile(video, "script")}
            className={`p-1.5 rounded ${video.hasScript ? 'text-purple-400 hover:bg-purple-500/20' : 'text-zinc-600 cursor-not-allowed'}`}
            title="Script"
          >
            <FileText className="w-4 h-4" />
          </button>

          <button
            disabled={!video.hasAudio}
            onClick={() => downloadFile(video, "audio")}
            className={`p-1.5 rounded ${video.hasAudio ? 'text-green-400 hover:bg-green-500/20' : 'text-zinc-600 cursor-not-allowed'}`}
            title="Audio"
          >
            <FileAudio className="w-4 h-4" />
          </button>

          <button
            disabled={!video.hasVideo}
            onClick={() => downloadFile(video, "video")}
            className={`p-1.5 rounded ${video.hasVideo ? 'text-red-400 hover:bg-red-500/20' : 'text-zinc-600 cursor-not-allowed'}`}
            title="Video"
          >
            <Video className="w-4 h-4" />
          </button>

          <button
            disabled={!video.hasThumbnail}
            onClick={() => downloadFile(video, "thumbnail")}
            className={`p-1.5 rounded ${video.hasThumbnail ? 'text-pink-400 hover:bg-pink-500/20' : 'text-zinc-600 cursor-not-allowed'}`}
            title="Thumbnail"
          >
            <ImageIcon className="w-4 h-4" />
          </button>

          {!hasAnyFile && (
            <span className="text-xs text-muted-foreground ml-2">Processing...</span>
          )}
        </div>

        {/* Status Badge */}
        {video.isCompleted && (
          <Badge variant="outline" className="text-xs text-green-400 border-green-500/30 shrink-0">
            <Check className="w-3 h-3" />
          </Badge>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => toggleComplete(video)}
            className={`p-1.5 rounded ${video.isCompleted ? 'text-green-400 bg-green-600/20' : 'text-zinc-400 hover:bg-zinc-700'}`}
            title={video.isCompleted ? "Unmark" : "Mark as uploaded"}
          >
            <Check className="w-4 h-4" />
          </button>

          {hasAnyFile && !video.isCompleted && (
            <button
              onClick={() => deleteVideo(video)}
              disabled={deleting === video.id}
              className="p-1.5 rounded text-red-400 hover:bg-red-900/20"
              title="Delete"
            >
              {deleting === video.id ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
            </button>
          )}
        </div>
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
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-amber-500" />
                    Pending ({pendingVideos.length})
                    {selectMode && selectedIds.size > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {selectedIds.size} selected
                      </Badge>
                    )}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {/* Select Mode Toggle */}
                    <Button
                      variant={selectMode ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        setSelectMode(!selectMode)
                        if (selectMode) setSelectedIds(new Set())
                      }}
                      className={selectMode ? "bg-violet-600 hover:bg-violet-700" : ""}
                    >
                      {selectMode ? <CheckSquare className="w-4 h-4 mr-1" /> : <Square className="w-4 h-4 mr-1" />}
                      Select
                    </Button>

                    {selectMode ? (
                      <>
                        <Button variant="outline" size="sm" onClick={selectAll}>
                          All
                        </Button>
                        <Button variant="outline" size="sm" onClick={deselectAll}>
                          None
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={markAllSelected}
                          disabled={selectedIds.size === 0 || bulkMarking}
                          className="text-green-400 border-green-500/30 hover:bg-green-500/10"
                        >
                          {bulkMarking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                          Mark
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={deleteAllSelected}
                          disabled={selectedIds.size === 0 || bulkDeleting}
                          className="text-red-400 border-red-500/30 hover:bg-red-500/10"
                        >
                          {bulkDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1" />}
                          Delete
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={markAllPending}
                          disabled={bulkMarking}
                          className="text-green-400 border-green-500/30 hover:bg-green-500/10"
                        >
                          {bulkMarking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                          Mark All
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={deleteAllPending}
                          disabled={bulkDeleting}
                          className="text-red-400 border-red-500/30 hover:bg-red-500/10"
                        >
                          {bulkDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1" />}
                          Delete All
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="space-y-1">
                  {pendingVideos.map(video => (
                    <VideoRow key={video.id} video={video} />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Completed Videos */}
          {completedVideos.length > 0 && (
            <Card className="glass border-white/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  Uploaded ({completedVideos.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="space-y-1">
                  {completedVideos.map(video => (
                    <VideoRow key={video.id} video={video} />
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
