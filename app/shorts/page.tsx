"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  RefreshCw,
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
  PlayCircle,
  Film,
  Download,
  Zap,
  FolderOpen,
  Eye,
  Check,
  X,
  ImageIcon,
  Sparkles
} from "lucide-react"

interface ShortJob {
  job_id: string
  script_text?: string
  source_video?: string
  short_number?: number
  status: string
  gofile_link?: string
  error_message?: string
  created_at: string
  completed_at?: string
}

interface ScriptOption {
  folder: string
  title?: string
}

interface PreviewShort {
  number: number
  content: string
  selected: boolean
}

// Clean markdown formatting from text (asterisks, bold, etc.)
function cleanContent(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')  // Remove **bold**
    .replace(/\*([^*]+)\*/g, '$1')       // Remove *italic*
    .replace(/#{1,6}\s*/g, '')           // Remove headings
    .replace(/`([^`]+)`/g, '$1')         // Remove inline code
    .replace(/^\s*[-*+]\s+/gm, '')       // Remove list markers
    .trim()
}

export default function ShortsPage() {
  const [jobs, setJobs] = useState<ShortJob[]>([])
  const [scripts, setScripts] = useState<ScriptOption[]>([])
  const [selectedScript, setSelectedScript] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [approving, setApproving] = useState(false)
  const [statusFilter, setStatusFilter] = useState("all")
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)

  // Preview state
  const [previewShorts, setPreviewShorts] = useState<PreviewShort[]>([])
  const [expandedShort, setExpandedShort] = useState<number | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [previewFolder, setPreviewFolder] = useState<string>("")

  useEffect(() => {
    loadJobs()
    loadScripts()
    const interval = setInterval(loadJobs, 30000)
    return () => clearInterval(interval)
  }, [])

  async function loadJobs() {
    try {
      const res = await fetch("/api/shorts/list")
      const data = await res.json()
      setJobs(data.jobs || [])
    } catch (error) {
      console.error("Error loading shorts:", error)
    } finally {
      setLoading(false)
    }
  }

  async function loadScripts() {
    try {
      const res = await fetch("/api/shorts/scripts")
      const data = await res.json()
      setScripts(data.scripts || [])
    } catch (error) {
      console.error("Error loading scripts:", error)
    }
  }

  async function generatePreview() {
    if (!selectedScript) {
      setMessage({ type: "error", text: "Please select a script first" })
      return
    }

    setGenerating(true)
    setMessage(null)
    setShowPreview(false)

    try {
      const res = await fetch("/api/shorts/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoFolder: selectedScript })
      })

      const data = await res.json()

      if (data.success && data.shorts) {
        // Mark all shorts as selected by default
        setPreviewShorts(data.shorts.map((s: { number: number; content: string }) => ({
          ...s,
          selected: true
        })))
        setPreviewFolder(selectedScript)
        setShowPreview(true)
        setMessage({ type: "success", text: `Generated ${data.shorts.length} shorts for preview` })
      } else {
        setMessage({ type: "error", text: data.error || "Failed to generate preview" })
      }
    } catch (error) {
      setMessage({ type: "error", text: "Error generating preview" })
    } finally {
      setGenerating(false)
    }
  }

  function toggleShort(number: number) {
    setPreviewShorts(prev =>
      prev.map(s => s.number === number ? { ...s, selected: !s.selected } : s)
    )
  }

  function selectAll() {
    setPreviewShorts(prev => prev.map(s => ({ ...s, selected: true })))
  }

  function deselectAll() {
    setPreviewShorts(prev => prev.map(s => ({ ...s, selected: false })))
  }

  async function approveShorts() {
    const selected = previewShorts.filter(s => s.selected)
    if (selected.length === 0) {
      setMessage({ type: "error", text: "Please select at least one short to approve" })
      return
    }

    setApproving(true)
    setMessage(null)

    try {
      const res = await fetch("/api/shorts/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoFolder: previewFolder,
          shorts: selected.map(s => ({ number: s.number, content: cleanContent(s.content) }))
        })
      })

      const data = await res.json()

      if (data.success) {
        setMessage({ type: "success", text: `${data.shortsQueued} shorts queued with AI images!` })
        setShowPreview(false)
        setPreviewShorts([])
        setSelectedScript("")
        loadJobs()
        loadScripts()
      } else {
        setMessage({ type: "error", text: data.error || "Failed to approve shorts" })
      }
    } catch (error) {
      setMessage({ type: "error", text: "Error approving shorts" })
    } finally {
      setApproving(false)
    }
  }

  function cancelPreview() {
    setShowPreview(false)
    setPreviewShorts([])
    setPreviewFolder("")
  }

  const filteredJobs = jobs.filter(job => {
    if (statusFilter === "all") return true
    return job.status === statusFilter
  })

  const stats = {
    pending: jobs.filter(j => j.status === "pending").length,
    processing: jobs.filter(j => j.status === "processing").length,
    completed: jobs.filter(j => j.status === "completed").length,
    failed: jobs.filter(j => j.status === "failed").length
  }

  const selectedCount = previewShorts.filter(s => s.selected).length

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
    return date.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
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
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold gradient-text flex items-center gap-2">
            <Film className="w-8 h-8" />
            Shorts
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Generate YouTube Shorts (1080x1920) with AI Images
          </p>
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

      {/* Generate/Preview Card */}
      <Card className="glass border-violet-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Zap className="w-5 h-5 text-violet-400" />
            Generate Shorts
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!showPreview ? (
            <>
              <div className="flex flex-col sm:flex-row gap-3">
                <Select value={selectedScript} onValueChange={setSelectedScript}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select a processed script..." />
                  </SelectTrigger>
                  <SelectContent>
                    {scripts.length === 0 ? (
                      <SelectItem value="_none" disabled>No scripts available</SelectItem>
                    ) : (
                      scripts.map(script => (
                        <SelectItem key={script.folder} value={script.folder}>
                          <div className="flex items-center gap-2">
                            <FolderOpen className="w-4 h-4" />
                            {script.folder} {script.title && `- ${script.title.substring(0, 40)}...`}
                          </div>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <Button
                  onClick={generatePreview}
                  disabled={generating || !selectedScript}
                  className="bg-violet-600 hover:bg-violet-700"
                >
                  {generating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Eye className="w-4 h-4 mr-2" />
                      Preview 10 Shorts
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                This will generate 10 shorts from the script for you to review and approve.
                Approved shorts will be queued with AI-generated images (1080x1920).
              </p>
            </>
          ) : (
            <>
              {/* Preview Header */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-violet-400 border-violet-500/30">
                    {previewFolder}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {selectedCount}/{previewShorts.length} selected
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={selectAll}>
                    <Check className="w-4 h-4 mr-1" />
                    All
                  </Button>
                  <Button variant="outline" size="sm" onClick={deselectAll}>
                    <X className="w-4 h-4 mr-1" />
                    None
                  </Button>
                  <Button variant="ghost" size="sm" onClick={cancelPreview}>
                    Cancel
                  </Button>
                </div>
              </div>

              {/* Shorts Preview Grid */}
              <ScrollArea className="h-[400px] pr-4">
                <div className="space-y-3">
                  {previewShorts.map((short) => {
                    const isExpanded = expandedShort === short.number
                    return (
                      <Card
                        key={short.number}
                        className={`transition-all ${
                          short.selected
                            ? "border-emerald-500/50 bg-emerald-500/5"
                            : "border-border hover:border-muted-foreground/30"
                        }`}
                      >
                        <CardContent className="pt-4">
                          <div className="flex items-start gap-3">
                            <Checkbox
                              checked={short.selected}
                              onCheckedChange={() => toggleShort(short.number)}
                              className="mt-1"
                            />
                            <div className="flex-1 min-w-0">
                              <div
                                className="flex items-center gap-2 mb-2 cursor-pointer"
                                onClick={() => setExpandedShort(isExpanded ? null : short.number)}
                              >
                                <Badge variant="secondary">Short #{short.number}</Badge>
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <ImageIcon className="w-3 h-3" />
                                  AI Image
                                </div>
                                {short.selected && (
                                  <Badge variant="default" className="bg-emerald-600">
                                    <Check className="w-3 h-3 mr-1" />
                                    Selected
                                  </Badge>
                                )}
                                <span className="text-xs text-violet-400 ml-auto">
                                  {isExpanded ? "▲ Collapse" : "▼ Expand"}
                                </span>
                              </div>
                              <div
                                className="cursor-pointer"
                                onClick={() => setExpandedShort(isExpanded ? null : short.number)}
                              >
                                {isExpanded ? (
                                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                                    {cleanContent(short.content)}
                                  </p>
                                ) : (
                                  <p className="text-sm text-muted-foreground line-clamp-2">
                                    {cleanContent(short.content)}
                                  </p>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground/50 mt-1">
                                {short.content.length} chars
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              </ScrollArea>

              {/* Approve Button */}
              <div className="flex items-center justify-between pt-2 border-t border-border">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Sparkles className="w-4 h-4 text-violet-400" />
                  Each short will have an AI-generated image (1080x1920)
                </div>
                <Button
                  onClick={approveShorts}
                  disabled={approving || selectedCount === 0}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  {approving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Approving...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 mr-2" />
                      Approve {selectedCount} Shorts
                    </>
                  )}
                </Button>
              </div>
            </>
          )}

          {message && (
            <div className={`p-3 rounded-lg text-sm ${
              message.type === "success"
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                : "bg-red-500/10 text-red-400 border border-red-500/30"
            }`}>
              {message.text}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats Cards */}
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
                <p className="text-sm text-muted-foreground">Ready</p>
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
      <Tabs defaultValue="all" onValueChange={setStatusFilter} className="mt-4">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="all" className="text-xs sm:text-sm">All ({jobs.length})</TabsTrigger>
          <TabsTrigger value="completed" className="text-xs sm:text-sm">Ready ({stats.completed})</TabsTrigger>
          <TabsTrigger value="processing" className="text-xs sm:text-sm">Processing ({stats.processing})</TabsTrigger>
          <TabsTrigger value="pending" className="text-xs sm:text-sm">Pending ({stats.pending})</TabsTrigger>
          <TabsTrigger value="failed" className="text-xs sm:text-sm">Failed ({stats.failed})</TabsTrigger>
        </TabsList>

        <TabsContent value={statusFilter} className="mt-4">
          <Card className="glass border-white/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-violet-500" />
                Shorts Queue
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                {loading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                ) : filteredJobs.length === 0 ? (
                  <div className="text-center text-muted-foreground py-12">
                    <Film className="w-12 h-12 mx-auto mb-4 opacity-30" />
                    <p>No shorts yet.</p>
                    <p className="text-sm mt-2">
                      Select a script above and preview/approve shorts to start.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredJobs.map(job => (
                      <Card key={job.job_id} className="border border-border hover:border-violet-500/30 transition-colors">
                        <CardContent className="pt-4">
                          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                            <div className="space-y-1 min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2 text-sm">
                                {getStatusIcon(job.status)}
                                {job.source_video && (
                                  <span className="font-medium text-violet-400">
                                    {job.source_video}
                                  </span>
                                )}
                                {job.short_number && (
                                  <Badge variant="outline" className="text-xs">
                                    Short #{job.short_number}
                                  </Badge>
                                )}
                                <Badge variant="secondary" className="text-xs">
                                  <ImageIcon className="w-3 h-3 mr-1" />
                                  AI Image
                                </Badge>
                              </div>
                              {job.script_text && (
                                <div className="text-xs sm:text-sm text-muted-foreground line-clamp-2">
                                  {job.script_text.substring(0, 150)}...
                                </div>
                              )}
                              <div className="text-xs text-muted-foreground/70">
                                {formatDate(job.created_at)}
                              </div>
                              {job.error_message && (
                                <div className="text-xs text-red-400 mt-1">
                                  Error: {job.error_message}
                                </div>
                              )}
                            </div>
                            <div className="flex flex-row sm:flex-col items-center sm:items-end gap-2 self-end sm:self-auto">
                              {getStatusBadge(job.status)}
                              {job.status === "completed" && job.gofile_link && (
                                <a
                                  href={job.gofile_link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 text-xs sm:text-sm px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                                >
                                  <Download className="w-4 h-4" />
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
