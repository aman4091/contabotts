"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  RefreshCw,
  Download,
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
  PlayCircle,
  Music,
  RotateCcw,
  ExternalLink,
  Trash2,
  Pause,
  Play,
  Link2,
  FileText,
  Video,
  FileAudio
} from "lucide-react"
import { toast } from "sonner"

interface Job {
  job_id: string
  script_text?: string
  channel_code: string
  video_number: number
  date: string
  audio_counter?: number
  organized_path?: string
  status: string
  gofile_link?: string
  audio_link?: string
  video_link?: string
  video_links?: {
    primary?: string
    pixeldrain?: string
    gofile?: string
  }
  existing_audio_link?: string
  video_only_waiting?: boolean
  error_message?: string
  created_at: string
  completed_at?: string
  username?: string
}

export default function AudioFilesPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState("all")
  const [updating, setUpdating] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [pausing, setPausing] = useState<string | null>(null)
  const [skipping, setSkipping] = useState<string | null>(null)

  // Audio Link Dialog (PixelDrain)
  const [gofileLinkDialog, setGofileLinkDialog] = useState(false)
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [gofileLink, setGofileLink] = useState("")
  const [imageSource, setImageSource] = useState("nature")
  const [introVideo, setIntroVideo] = useState("none")
  const [submittingLink, setSubmittingLink] = useState(false)

  useEffect(() => {
    loadJobs()
    const interval = setInterval(loadJobs, 30000)
    return () => clearInterval(interval)
  }, [])

  async function loadJobs() {
    try {
      const res = await fetch("/api/audio-files?limit=100")
      const data = await res.json()
      setJobs(data.jobs || [])
    } catch (error) {
      console.error("Error loading jobs:", error)
    } finally {
      setLoading(false)
    }
  }

  async function updateJobStatus(jobId: string, newStatus: string) {
    setUpdating(jobId)
    try {
      const res = await fetch("/api/queue-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queue_type: "audio",
          job_id: jobId,
          new_status: newStatus
        })
      })
      const data = await res.json()
      if (data.success) {
        await loadJobs()
      } else {
        alert("Failed to update status: " + (data.error || "Unknown error"))
      }
    } catch (error) {
      alert("Error updating status")
    } finally {
      setUpdating(null)
    }
  }

  async function deleteJob(jobId: string) {
    if (!confirm("Are you sure you want to delete this job?")) return

    setDeleting(jobId)
    try {
      const res = await fetch(`/api/queue-status?queue_type=audio&job_id=${jobId}`, {
        method: "DELETE"
      })
      const data = await res.json()
      if (data.success) {
        await loadJobs()
      } else {
        alert("Failed to delete job: " + (data.error || "Unknown error"))
      }
    } catch (error) {
      alert("Error deleting job")
    } finally {
      setDeleting(null)
    }
  }

  async function pauseResumeJob(jobId: string, action: "pause" | "resume") {
    setPausing(jobId)
    try {
      const res = await fetch("/api/queue-status", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queue_type: "audio",
          job_id: jobId,
          action
        })
      })
      const data = await res.json()
      if (data.success) {
        await loadJobs()
      } else {
        alert(`Failed to ${action} job: ` + (data.error || "Unknown error"))
      }
    } catch (error) {
      alert(`Error ${action}ing job`)
    } finally {
      setPausing(null)
    }
  }

  async function skipJob(job: Job) {
    if (!confirm(`Skip job #${job.audio_counter}?\n\nThis will:\n- Delete audio file if exists\n- Mark job as completed\n\nVideo will NOT be created for this job.`)) {
      return
    }

    setSkipping(job.job_id)
    try {
      const res = await fetch("/api/queue/skip-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: job.job_id,
          audio_counter: job.audio_counter,
          username: job.username
        })
      })
      const data = await res.json()
      if (data.success) {
        toast.success(`Job #${job.audio_counter} skipped`)
        await loadJobs()
      } else {
        toast.error("Failed to skip job: " + (data.error || "Unknown error"))
      }
    } catch (error) {
      toast.error("Error skipping job")
    } finally {
      setSkipping(null)
    }
  }

  function openGofileLinkDialog(job: Job) {
    setSelectedJob(job)
    setGofileLink(job.existing_audio_link || "")
    setImageSource("nature")
    setIntroVideo("none")
    setGofileLinkDialog(true)
  }

  async function submitGofileLink() {
    if (!selectedJob || !gofileLink.trim()) {
      toast.error("Please enter an audio link")
      return
    }

    // Validate link format - accept PixelDrain or direct URLs
    if (!gofileLink.includes("pixeldrain.com") && !gofileLink.startsWith("http")) {
      toast.error("Please enter a valid PixelDrain or HTTP link")
      return
    }

    setSubmittingLink(true)
    try {
      const res = await fetch("/api/queue-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queue_type: "audio",
          job_id: selectedJob.job_id,
          existing_audio_link: gofileLink.trim(),
          image_source: imageSource,
          intro_video: introVideo !== "none" ? introVideo : undefined
        })
      })
      const data = await res.json()
      if (data.success) {
        toast.success("Audio link added! Job will skip audio generation.")
        setGofileLinkDialog(false)
        setGofileLink("")
        setSelectedJob(null)
        await loadJobs()
      } else {
        toast.error("Failed to add link: " + (data.error || "Unknown error"))
      }
    } catch (error) {
      toast.error("Error adding link")
    } finally {
      setSubmittingLink(false)
    }
  }

  async function downloadFile(job: Job, fileType: "script" | "transcript" | "audio" | "video") {
    try {
      let url = ""
      let filename = ""

      if (fileType === "script" || fileType === "transcript") {
        // Download from organized path
        url = `/api/queue/download?job_id=${job.job_id}&type=${fileType}`
        filename = `video_${job.video_number}_${fileType}.txt`
      } else if (fileType === "audio" && job.audio_link) {
        window.open(job.audio_link, "_blank")
        return
      } else if (fileType === "video" && job.video_link) {
        window.open(job.video_link, "_blank")
        return
      } else if (fileType === "audio" || fileType === "video") {
        // Fallback to gofile_link
        if (job.gofile_link) {
          window.open(job.gofile_link, "_blank")
        } else {
          toast.error(`No ${fileType} link available`)
        }
        return
      }

      const res = await fetch(url)
      if (!res.ok) {
        toast.error(`Failed to download ${fileType}`)
        return
      }

      const blob = await res.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = downloadUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(downloadUrl)
      document.body.removeChild(a)
      toast.success(`${fileType} downloaded`)
    } catch (error) {
      toast.error(`Error downloading ${fileType}`)
    }
  }

  const [clearing, setClearing] = useState(false)

  async function clearAllPendingJobs() {
    if (!confirm("Delete ALL pending jobs and audio files?\n\nThis will:\n- Delete all pending jobs\n- Clear external-audio folder\n- Clear audio-ready folder\n\nThis cannot be undone!")) {
      return
    }

    setClearing(true)
    try {
      const res = await fetch("/api/queue/clear-all", {
        method: "POST"
      })
      const data = await res.json()
      if (data.success) {
        toast.success(`Cleared ${data.deleted_jobs} jobs, ${data.deleted_audio_files} audio files`)
        await loadJobs()
      } else {
        toast.error("Failed to clear: " + (data.error || "Unknown error"))
      }
    } catch (error) {
      toast.error("Error clearing queue")
    } finally {
      setClearing(false)
    }
  }

  const filteredJobs = jobs.filter(job => {
    if (statusFilter === "all") return true
    return job.status === statusFilter
  })

  const stats = {
    pending: jobs.filter(j => j.status === "pending").length,
    processing: jobs.filter(j => j.status === "processing").length,
    completed: jobs.filter(j => j.status === "completed").length,
    failed: jobs.filter(j => j.status === "failed").length,
    paused: jobs.filter(j => j.status === "paused").length
  }

  function getStatusIcon(status: string) {
    switch (status) {
      case "pending":
        return <Clock className="w-4 h-4 text-yellow-500" />
      case "processing":
        return <PlayCircle className="w-4 h-4 text-blue-500 animate-pulse" />
      case "completed":
        return <CheckCircle2 className="w-4 h-4 text-green-500" />
      case "failed":
        return <XCircle className="w-4 h-4 text-red-500" />
      case "paused":
        return <Pause className="w-4 h-4 text-orange-500" />
      default:
        return null
    }
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case "pending":
        return <Badge variant="warning">Pending</Badge>
      case "processing":
        return <Badge variant="default">Processing</Badge>
      case "completed":
        return <Badge variant="success">Completed</Badge>
      case "failed":
        return <Badge variant="destructive">Failed</Badge>
      case "paused":
        return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">Paused</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  function formatDate(dateStr: string) {
    const date = new Date(dateStr)
    return date.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold gradient-text">Queue Manager</h1>
          <p className="text-muted-foreground text-sm mt-1">Track audio & video generation jobs</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={clearAllPendingJobs}
            disabled={clearing || stats.pending === 0}
            className="border-red-500/30 hover:border-red-500 hover:bg-red-500/10 transition-all text-red-400"
          >
            {clearing ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4 mr-2" />
            )}
            Clear All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={loadJobs}
            disabled={loading}
            className="border-violet-500/30 hover:border-violet-500 hover:bg-violet-500/10 transition-all"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="glass border-yellow-500/20 card-hover">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Pending</p>
                  <p className="text-2xl font-bold text-yellow-400">{stats.pending}</p>
                </div>
                <div className="p-2 rounded-xl bg-yellow-500/10">
                  <Clock className="w-6 h-6 text-yellow-500" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="glass border-blue-500/20 card-hover">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Processing</p>
                  <p className="text-2xl font-bold text-blue-400">{stats.processing}</p>
                </div>
                <div className="p-2 rounded-xl bg-blue-500/10">
                  <PlayCircle className="w-6 h-6 text-blue-500 animate-pulse" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="glass border-emerald-500/20 card-hover">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Completed</p>
                  <p className="text-2xl font-bold text-emerald-400">{stats.completed}</p>
                </div>
                <div className="p-2 rounded-xl bg-emerald-500/10">
                  <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="glass border-red-500/20 card-hover">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Failed</p>
                  <p className="text-2xl font-bold text-red-400">{stats.failed}</p>
                </div>
                <div className="p-2 rounded-xl bg-red-500/10">
                  <XCircle className="w-6 h-6 text-red-500" />
                </div>
              </div>
            </CardContent>
          </Card>
      </div>

      {/* Status Filter Tabs */}
      <Tabs defaultValue="all" onValueChange={setStatusFilter} className="mt-4">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="all" className="text-xs sm:text-sm">All ({jobs.length})</TabsTrigger>
          <TabsTrigger value="pending" className="text-xs sm:text-sm">Pending ({stats.pending})</TabsTrigger>
          <TabsTrigger value="paused" className="text-xs sm:text-sm">Paused ({stats.paused})</TabsTrigger>
          <TabsTrigger value="processing" className="text-xs sm:text-sm">Processing ({stats.processing})</TabsTrigger>
          <TabsTrigger value="completed" className="text-xs sm:text-sm">Done ({stats.completed})</TabsTrigger>
          <TabsTrigger value="failed" className="text-xs sm:text-sm">Failed ({stats.failed})</TabsTrigger>
        </TabsList>

        <TabsContent value={statusFilter} className="mt-4">
          <Card className="glass border-white/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-violet-500" />
                Jobs (Audio + Video)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                {loading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                ) : filteredJobs.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    No jobs found.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {filteredJobs.map(job => (
                      <Card key={job.job_id} className="border border-border">
                        <CardContent className="pt-4">
                          <div className="flex flex-col gap-3">
                            {/* Job Info Row */}
                            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                              <div className="space-y-1 min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1 sm:gap-2 text-sm sm:text-base">
                                  {getStatusIcon(job.status)}
                                  {job.audio_counter && (
                                    <span className="font-bold text-foreground">#{job.audio_counter}</span>
                                  )}
                                  <span className="text-muted-foreground hidden sm:inline">|</span>
                                  <span className="font-medium text-foreground">{job.channel_code}</span>
                                  <span className="text-muted-foreground text-xs sm:text-sm">V{job.video_number}</span>
                                  <span className="text-muted-foreground hidden sm:inline">|</span>
                                  <span className="text-xs sm:text-sm text-muted-foreground">{job.date}</span>
                                  {job.existing_audio_link && (
                                    <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-xs">
                                      Audio Ready
                                    </Badge>
                                  )}
                                  {job.video_only_waiting && !job.existing_audio_link && (
                                    <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-xs animate-pulse">
                                      Waiting for Audio
                                    </Badge>
                                  )}
                                </div>
                                {job.script_text && (
                                  <div className="text-xs sm:text-sm text-muted-foreground line-clamp-2">
                                    {job.script_text.substring(0, 100)}...
                                  </div>
                                )}
                                <div className="text-xs text-muted-foreground/70">
                                  Created: {formatDate(job.created_at)}
                                  {job.completed_at && <span className="hidden sm:inline"> | Completed: {formatDate(job.completed_at)}</span>}
                                </div>
                                {job.error_message && (
                                  <div className="text-xs sm:text-sm text-red-500">
                                    Error: {job.error_message}
                                  </div>
                                )}
                              </div>
                              <div className="flex flex-col items-end gap-2">
                                {getStatusBadge(job.status)}
                              </div>
                            </div>

                            {/* Action Buttons Row */}
                            <div className="flex flex-wrap gap-2 pt-2 border-t border-border/50">
                              {/* Script download - available for all jobs */}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => downloadFile(job, "script")}
                                className="flex items-center gap-1 text-xs px-2 py-1 h-auto border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
                              >
                                <FileText className="w-3 h-3" />
                                Script
                              </Button>

                              {/* Other download buttons for completed jobs */}
                              {job.status === "completed" && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => downloadFile(job, "transcript")}
                                    className="flex items-center gap-1 text-xs px-2 py-1 h-auto border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                                  >
                                    <FileText className="w-3 h-3" />
                                    Transcript
                                  </Button>
                                  {(job.audio_link || job.gofile_link) && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => downloadFile(job, "audio")}
                                      className="flex items-center gap-1 text-xs px-2 py-1 h-auto border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                                    >
                                      <FileAudio className="w-3 h-3" />
                                      Audio
                                    </Button>
                                  )}
                                  {/* PixelDrain Video Link */}
                                  {(job.video_links?.pixeldrain || job.gofile_link) && (
                                    <a
                                      href={job.video_links?.pixeldrain || job.gofile_link}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors border border-blue-500/30"
                                    >
                                      <Video className="w-3 h-3" />
                                      PD
                                    </a>
                                  )}
                                  {/* GoFile Video Link */}
                                  {job.video_links?.gofile && (
                                    <a
                                      href={job.video_links.gofile}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-colors border border-purple-500/30"
                                    >
                                      <Video className="w-3 h-3" />
                                      GF
                                    </a>
                                  )}
                                </>
                              )}

                              {/* Audio Link button for pending/paused jobs */}
                              {(job.status === "pending" || job.status === "paused") && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openGofileLinkDialog(job)}
                                  className="flex items-center gap-1 text-xs px-2 py-1 h-auto border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
                                >
                                  <Link2 className="w-3 h-3" />
                                  {job.existing_audio_link ? "Update Audio Link" : "Add Audio Link"}
                                </Button>
                              )}

                              {/* Reprocess button */}
                              {(job.status === "completed" || job.status === "failed") && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => updateJobStatus(job.job_id, "pending")}
                                  disabled={updating === job.job_id}
                                  className="flex items-center gap-1 text-xs px-2 py-1 h-auto bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 border-orange-500/30"
                                >
                                  {updating === job.job_id ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <RotateCcw className="w-3 h-3" />
                                  )}
                                  Reprocess
                                </Button>
                              )}

                              {/* Pause button */}
                              {job.status === "pending" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => pauseResumeJob(job.job_id, "pause")}
                                  disabled={pausing === job.job_id}
                                  className="flex items-center gap-1 text-xs px-2 py-1 h-auto bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 border-orange-500/30"
                                >
                                  {pausing === job.job_id ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Pause className="w-3 h-3" />
                                  )}
                                  Pause
                                </Button>
                              )}

                              {/* Skip Job button - mark as completed without creating video */}
                              {job.status === "pending" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => skipJob(job)}
                                  disabled={skipping === job.job_id}
                                  className="flex items-center gap-1 text-xs px-2 py-1 h-auto bg-gray-500/10 text-gray-400 hover:bg-gray-500/20 border-gray-500/30"
                                >
                                  {skipping === job.job_id ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <CheckCircle2 className="w-3 h-3" />
                                  )}
                                  Skip Job
                                </Button>
                              )}

                              {/* Resume button */}
                              {job.status === "paused" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => pauseResumeJob(job.job_id, "resume")}
                                  disabled={pausing === job.job_id}
                                  className="flex items-center gap-1 text-xs px-2 py-1 h-auto bg-green-500/10 text-green-400 hover:bg-green-500/20 border-green-500/30"
                                >
                                  {pausing === job.job_id ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Play className="w-3 h-3" />
                                  )}
                                  Resume
                                </Button>
                              )}

                              {/* Delete button */}
                              {(job.status === "pending" || job.status === "processing" || job.status === "paused") && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => deleteJob(job.job_id)}
                                  disabled={deleting === job.job_id}
                                  className="flex items-center gap-1 text-xs px-2 py-1 h-auto bg-red-500/10 text-red-400 hover:bg-red-500/20 border-red-500/30"
                                >
                                  {deleting === job.job_id ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-3 h-3" />
                                  )}
                                  Remove
                                </Button>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Audio Link Dialog */}
      <Dialog open={gofileLinkDialog} onOpenChange={setGofileLinkDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="w-5 h-5 text-purple-400" />
              Add Audio Link
            </DialogTitle>
            <DialogDescription>
              Enter the PixelDrain link where audio is uploaded. Worker will download and use this audio for video.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="gofile-link">Audio Link (PixelDrain)</Label>
              <Input
                id="gofile-link"
                placeholder="https://pixeldrain.com/api/file/xxxxx?download"
                value={gofileLink}
                onChange={(e) => setGofileLink(e.target.value)}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                The audio file will be downloaded from this link when processing.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="image-source">Image Source</Label>
              <Select value={imageSource} onValueChange={setImageSource}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select image source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ai">AI Generated</SelectItem>
                  <SelectItem value="nature">Nature (folder)</SelectItem>
                  <SelectItem value="jesus">Jesus (folder)</SelectItem>
                  <SelectItem value="shorts">Shorts (folder)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Choose where to get images for video generation.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="intro-video">Intro Video</Label>
              <Select value={introVideo} onValueChange={setIntroVideo}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select intro" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="Jimmy">Jimmy</SelectItem>
                  <SelectItem value="Gyh">Gyh</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Intro video will be added at the start of the main video.
              </p>
            </div>
            {selectedJob && (
              <div className="p-3 bg-muted/50 rounded-lg text-sm">
                <p><strong>Job:</strong> #{selectedJob.audio_counter} - V{selectedJob.video_number}</p>
                <p className="text-muted-foreground truncate">{selectedJob.script_text?.substring(0, 50)}...</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setGofileLinkDialog(false)}
              disabled={submittingLink}
            >
              Cancel
            </Button>
            <Button
              onClick={submitGofileLink}
              disabled={submittingLink || !gofileLink.trim()}
              className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500"
            >
              {submittingLink ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Link2 className="w-4 h-4 mr-2" />
                  Save Link
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
