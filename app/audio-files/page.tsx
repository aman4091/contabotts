"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  RefreshCw,
  ExternalLink,
  Download,
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
  PlayCircle
} from "lucide-react"

interface AudioJob {
  job_id: string
  script_text: string
  channel_code: string
  video_number: number
  date: string
  audio_counter: number
  organized_path: string
  status: string
  gofile_link?: string
  error_message?: string
  created_at: string
  completed_at?: string
}

export default function AudioFilesPage() {
  const [jobs, setJobs] = useState<AudioJob[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("all")

  useEffect(() => {
    loadJobs()
    // Auto-refresh every 30 seconds
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

  const filteredJobs = jobs.filter(job => {
    if (filter === "all") return true
    return job.status === filter
  })

  const stats = {
    pending: jobs.filter(j => j.status === "pending").length,
    processing: jobs.filter(j => j.status === "processing").length,
    completed: jobs.filter(j => j.status === "completed").length,
    failed: jobs.filter(j => j.status === "failed").length
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
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  function formatDate(dateStr: string) {
    const date = new Date(dateStr)
    return date.toLocaleString()
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold gradient-text">Audio Files</h1>
          <p className="text-muted-foreground text-sm mt-1">Track your audio generation jobs</p>
        </div>
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

      {/* Tabs */}
      <Tabs defaultValue="all" onValueChange={setFilter}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="all" className="text-xs sm:text-sm">All ({jobs.length})</TabsTrigger>
          <TabsTrigger value="pending" className="text-xs sm:text-sm">Pending ({stats.pending})</TabsTrigger>
          <TabsTrigger value="processing" className="text-xs sm:text-sm">Processing ({stats.processing})</TabsTrigger>
          <TabsTrigger value="completed" className="text-xs sm:text-sm">Done ({stats.completed})</TabsTrigger>
          <TabsTrigger value="failed" className="text-xs sm:text-sm">Failed ({stats.failed})</TabsTrigger>
        </TabsList>

        <TabsContent value={filter} className="mt-4">
          <Card className="glass border-white/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-violet-500" />
                Audio Jobs
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
                    No audio jobs found.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {filteredJobs.map(job => (
                      <Card key={job.job_id} className="border border-border">
                        <CardContent className="pt-4">
                          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                            <div className="space-y-1 min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1 sm:gap-2 text-sm sm:text-base">
                                {getStatusIcon(job.status)}
                                <span className="font-bold text-foreground">#{job.audio_counter}</span>
                                <span className="text-muted-foreground hidden sm:inline">|</span>
                                <span className="font-medium text-foreground">{job.channel_code}</span>
                                <span className="text-muted-foreground text-xs sm:text-sm">V{job.video_number}</span>
                                <span className="text-muted-foreground hidden sm:inline">|</span>
                                <span className="text-xs sm:text-sm text-muted-foreground">{job.date}</span>
                              </div>
                              <div className="text-xs sm:text-sm text-muted-foreground line-clamp-2">
                                {job.script_text?.substring(0, 100)}...
                              </div>
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
                            <div className="flex flex-row sm:flex-col items-center sm:items-end gap-2 self-end sm:self-auto">
                              {getStatusBadge(job.status)}
                              {job.gofile_link && (
                                <a
                                  href={job.gofile_link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 text-xs sm:text-sm px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors"
                                >
                                  <Download className="w-3 h-3 sm:w-4 sm:h-4" />
                                  Download
                                </a>
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
    </div>
  )
}
