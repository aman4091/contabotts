"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
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
  Plus,
  Trash2,
  Tv2,
  Play,
  Download,
  FileText,
  Music,
  Video,
  Clock,
  Eye,
  CheckCircle2,
  XCircle,
  Zap,
  Settings,
  Save,
  X,
  Radio,
  Activity,
  FileCheck,
  RotateCcw,
  Edit3,
  Copy,
  ChevronDown,
  ChevronUp
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"

interface Channel {
  id: string
  name: string
  url: string
  channelId: string
  totalVideos: number
  addedAt: string
  prompt?: string
  liveMonitoring?: boolean
  lastChecked?: string
}

interface CompletedVideo {
  videoId: string
  title: string
  videoNumber: number
  folderName: string
  jobId: string
  processedAt: string
  gofileLink?: string
  status?: string
}

interface PendingScript {
  id: string
  videoId: string
  title: string
  channelId: string
  channelName: string
  transcript: string
  script: string
  transcriptChars: number
  scriptChars: number
  createdAt: string
  source: "auto_create" | "live_monitoring"
  prompt: string
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [completedByChannel, setCompletedByChannel] = useState<{ [key: string]: CompletedVideo[] }>({})
  const [loading, setLoading] = useState(true)
  const [addingChannel, setAddingChannel] = useState(false)
  const [processing, setProcessing] = useState(false)

  // Form states
  const [newChannelUrl, setNewChannelUrl] = useState("")
  const [selectedChannel, setSelectedChannel] = useState("")
  const [numVideos, setNumVideos] = useState(6)
  const [minDuration, setMinDuration] = useState(600)

  // Active tab
  const [activeTab, setActiveTab] = useState("all")

  // Prompt editing
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null)
  const [promptValue, setPromptValue] = useState("")
  const [savingPrompt, setSavingPrompt] = useState(false)

  // Pending scripts
  const [pendingScripts, setPendingScripts] = useState<PendingScript[]>([])
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [reprocessingId, setReprocessingId] = useState<string | null>(null)
  const [expandedScript, setExpandedScript] = useState<string | null>(null)

  // Manual edit dialog
  const [manualDialog, setManualDialog] = useState<PendingScript | null>(null)
  const [manualScript, setManualScript] = useState("")
  const [submittingManual, setSubmittingManual] = useState(false)

  useEffect(() => {
    loadChannels()
    loadPendingScripts()
  }, [])

  useEffect(() => {
    if (channels.length > 0) {
      loadCompletedVideos()
    }
  }, [channels])

  async function loadPendingScripts() {
    try {
      const res = await fetch("/api/channels/pending")
      const data = await res.json()
      setPendingScripts(data.scripts || [])
    } catch (error) {
      console.error("Error loading pending scripts:", error)
    }
  }

  async function loadChannels() {
    setLoading(true)
    try {
      const res = await fetch("/api/channels")
      const data = await res.json()
      setChannels(data.channels || [])
    } catch (error) {
      console.error("Error loading channels:", error)
      toast.error("Failed to load channels")
    } finally {
      setLoading(false)
    }
  }

  async function loadCompletedVideos() {
    const completed: { [key: string]: CompletedVideo[] } = {}

    for (const channel of channels) {
      try {
        const res = await fetch(`/api/channels/completed?channelId=${channel.channelId}`)
        const data = await res.json()
        completed[channel.channelId] = data.completed || []
      } catch {
        completed[channel.channelId] = []
      }
    }

    setCompletedByChannel(completed)
  }

  async function addChannel() {
    if (!newChannelUrl.trim()) {
      toast.error("Please enter a channel URL")
      return
    }

    setAddingChannel(true)
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelUrl: newChannelUrl.trim() })
      })

      const data = await res.json()

      if (data.success) {
        toast.success(`Added ${data.channel.name} with ${data.videosFetched} videos`)
        setNewChannelUrl("")
        loadChannels()
      } else {
        toast.error(data.error || "Failed to add channel")
      }
    } catch (error) {
      toast.error("Failed to add channel")
    } finally {
      setAddingChannel(false)
    }
  }

  function startEditPrompt(channel: Channel) {
    setEditingPrompt(channel.channelId)
    setPromptValue(channel.prompt || "")
  }

  function cancelEditPrompt() {
    setEditingPrompt(null)
    setPromptValue("")
  }

  async function savePrompt(channelId: string) {
    setSavingPrompt(true)
    try {
      const res = await fetch("/api/channels", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, prompt: promptValue })
      })

      if (res.ok) {
        toast.success("Prompt saved")
        setEditingPrompt(null)
        loadChannels()
      } else {
        toast.error("Failed to save prompt")
      }
    } catch {
      toast.error("Failed to save prompt")
    } finally {
      setSavingPrompt(false)
    }
  }

  async function toggleLiveMonitoring(channelId: string, enabled: boolean) {
    try {
      const res = await fetch("/api/channels", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, liveMonitoring: enabled })
      })

      if (res.ok) {
        toast.success(enabled ? "Live monitoring enabled" : "Live monitoring disabled")
        loadChannels()
      } else {
        toast.error("Failed to update live monitoring")
      }
    } catch {
      toast.error("Failed to update live monitoring")
    }
  }

  async function deleteChannel(channelId: string) {
    if (!confirm("Delete this channel and all its data?")) return

    try {
      const res = await fetch(`/api/channels?id=${channelId}`, { method: "DELETE" })

      if (res.ok) {
        toast.success("Channel deleted")
        loadChannels()
      } else {
        toast.error("Failed to delete channel")
      }
    } catch {
      toast.error("Failed to delete channel")
    }
  }

  async function autoCreate() {
    if (!selectedChannel) {
      toast.error("Please select a channel")
      return
    }

    setProcessing(true)

    try {
      const res = await fetch("/api/channels/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: selectedChannel,
          numVideos,
          minDuration
        })
      })

      const data = await res.json()

      if (data.success) {
        toast.success(data.message || "Processing started! Check Pending Scripts for review.")
        // Reload pending scripts after a delay
        setTimeout(loadPendingScripts, 5000)
      } else {
        toast.error(data.error || "Processing failed")
      }
    } catch (error) {
      toast.error("Processing failed")
    } finally {
      setProcessing(false)
    }
  }

  async function approveScript(id: string, script?: string) {
    setApprovingId(id)
    try {
      const res = await fetch("/api/channels/pending/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, script })
      })

      const data = await res.json()

      if (data.success) {
        toast.success(`Approved as ${data.folderName}`)
        loadPendingScripts()
        loadCompletedVideos()
      } else {
        toast.error(data.error || "Failed to approve")
      }
    } catch {
      toast.error("Failed to approve")
    } finally {
      setApprovingId(null)
    }
  }

  async function reprocessScript(pending: PendingScript) {
    setReprocessingId(pending.id)
    try {
      const res = await fetch("/api/channels/pending/reprocess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pending.id })
      })

      const data = await res.json()

      if (data.success) {
        toast.success("Script reprocessed!")
        loadPendingScripts()
      } else {
        toast.error(data.error || "Failed to reprocess")
      }
    } catch {
      toast.error("Failed to reprocess")
    } finally {
      setReprocessingId(null)
    }
  }

  async function deleteScript(id: string) {
    try {
      const res = await fetch(`/api/channels/pending?id=${id}`, { method: "DELETE" })

      if (res.ok) {
        toast.success("Script deleted")
        loadPendingScripts()
      } else {
        toast.error("Failed to delete")
      }
    } catch {
      toast.error("Failed to delete")
    }
  }

  function openManualEdit(pending: PendingScript) {
    setManualDialog(pending)
    setManualScript("")
  }

  function copyPromptWithTranscript() {
    if (manualDialog) {
      const textToCopy = `${manualDialog.prompt}\n\n${manualDialog.transcript}`
      navigator.clipboard.writeText(textToCopy)
        .then(() => toast.success("Prompt + Transcript copied!"))
        .catch(() => toast.error("Failed to copy"))
    }
  }

  async function submitManualScript() {
    if (!manualDialog || !manualScript.trim()) {
      toast.error("Please paste the script")
      return
    }

    setSubmittingManual(true)
    try {
      await approveScript(manualDialog.id, manualScript.trim())
      setManualDialog(null)
      setManualScript("")
    } finally {
      setSubmittingManual(false)
    }
  }

  function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
    return `${m}:${s.toString().padStart(2, "0")}`
  }

  function formatViews(views: number): string {
    if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M`
    if (views >= 1000) return `${(views / 1000).toFixed(1)}K`
    return views.toString()
  }

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    })
  }

  function getStatusBadge(status?: string) {
    switch (status) {
      case "completed":
        return <Badge variant="success" className="text-xs">Ready</Badge>
      case "processing":
        return <Badge variant="default" className="text-xs">Processing</Badge>
      case "pending":
        return <Badge variant="warning" className="text-xs">Pending</Badge>
      case "failed":
        return <Badge variant="destructive" className="text-xs">Failed</Badge>
      default:
        return <Badge variant="outline" className="text-xs">Unknown</Badge>
    }
  }

  // Get all completed videos for "All" tab
  const allCompleted = Object.values(completedByChannel).flat()
    .sort((a, b) => new Date(b.processedAt).getTime() - new Date(a.processedAt).getTime())

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold gradient-text flex items-center gap-2">
            <Tv2 className="w-8 h-8" />
            Channel Automation
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Add YouTube channels and auto-create videos with one click
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { loadChannels(); loadCompletedVideos(); loadPendingScripts() }}
          disabled={loading}
          className="border-violet-500/30 hover:border-violet-500 hover:bg-violet-500/10"
        >
          {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Refresh
        </Button>
      </div>

      {/* Add Channel Card */}
      <Card className="glass border-cyan-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Plus className="w-5 h-5 text-cyan-400" />
            Add Channel
          </CardTitle>
          <CardDescription>Paste a YouTube channel URL to fetch its top 1000 videos</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              placeholder="https://youtube.com/@channelname"
              value={newChannelUrl}
              onChange={e => setNewChannelUrl(e.target.value)}
              className="flex-1"
              onKeyDown={e => e.key === "Enter" && addChannel()}
            />
            <Button
              onClick={addChannel}
              disabled={addingChannel || !newChannelUrl.trim()}
              className="bg-cyan-600 hover:bg-cyan-700"
            >
              {addingChannel ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Fetching...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Channel
                </>
              )}
            </Button>
          </div>

          {/* Channel List with Prompts */}
          {channels.length > 0 && (
            <div className="space-y-3 mt-4">
              {channels.map(channel => (
                <div
                  key={channel.channelId}
                  className="p-3 bg-emerald-500/5 border border-emerald-500/30 rounded-lg"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-emerald-400 font-medium">{channel.name}</span>
                      <span className="text-muted-foreground text-xs">({channel.totalVideos} videos)</span>
                      {channel.prompt && (
                        <Badge variant="outline" className="text-xs text-violet-400 border-violet-500/30">
                          Custom Prompt
                        </Badge>
                      )}
                      {channel.liveMonitoring && (
                        <Badge variant="outline" className="text-xs text-red-400 border-red-500/30 animate-pulse">
                          <Radio className="w-3 h-3 mr-1" />
                          Live
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {/* Live Monitoring Toggle */}
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={channel.liveMonitoring || false}
                          onCheckedChange={(checked) => toggleLiveMonitoring(channel.channelId, checked)}
                        />
                        <span className="text-xs text-muted-foreground hidden sm:inline">Monitor</span>
                      </div>
                      <button
                        onClick={() => startEditPrompt(channel)}
                        className="text-violet-400 hover:text-violet-300 p-1"
                        title="Edit Prompt"
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteChannel(channel.channelId)}
                        className="text-red-400 hover:text-red-300 p-1"
                        title="Delete Channel"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {channel.lastChecked && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Last checked: {new Date(channel.lastChecked).toLocaleString()}
                    </p>
                  )}

                  {/* Prompt Editor */}
                  {editingPrompt === channel.channelId && (
                    <div className="mt-3 space-y-2">
                      <Label className="text-xs text-muted-foreground">Channel-specific Prompt</Label>
                      <Textarea
                        value={promptValue}
                        onChange={e => setPromptValue(e.target.value)}
                        placeholder="Enter custom prompt for this channel... (leave empty to use default Channel Prompt from Settings)"
                        className="min-h-[100px] text-sm"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => savePrompt(channel.channelId)}
                          disabled={savingPrompt}
                          className="bg-emerald-600 hover:bg-emerald-700"
                        >
                          {savingPrompt ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={cancelEditPrompt}
                        >
                          <X className="w-4 h-4 mr-1" />
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Auto Create Card */}
      <Card className="glass border-violet-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Zap className="w-5 h-5 text-violet-400" />
            Auto Create
          </CardTitle>
          <CardDescription>Select a channel and number of videos to process automatically</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-2">
              <Label className="text-xs text-muted-foreground mb-1 block">Channel</Label>
              <Select value={selectedChannel} onValueChange={setSelectedChannel}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a channel..." />
                </SelectTrigger>
                <SelectContent>
                  {channels.map(channel => (
                    <SelectItem key={channel.channelId} value={channel.channelId}>
                      {channel.name} ({channel.totalVideos} videos)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Videos</Label>
              <Input
                type="number"
                value={numVideos}
                onChange={e => setNumVideos(parseInt(e.target.value) || 6)}
                min={1}
                max={50}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Min Duration (sec)</Label>
              <Input
                type="number"
                value={minDuration}
                onChange={e => setMinDuration(parseInt(e.target.value) || 0)}
                min={0}
              />
            </div>
          </div>
          <Button
            onClick={autoCreate}
            disabled={processing || !selectedChannel || channels.length === 0}
            className="w-full sm:w-auto bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500"
          >
            {processing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                Auto Create {numVideos} Videos
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground">
            This will fetch transcripts, process with Gemini using your Channel Prompt (from Settings), and save to Pending Scripts for review.
          </p>
        </CardContent>
      </Card>

      {/* Pending Scripts Section */}
      <Card className="glass border-amber-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileCheck className="w-5 h-5 text-amber-400" />
            Pending Scripts ({pendingScripts.length})
          </CardTitle>
          <CardDescription>Review and approve scripts before queueing for audio/video generation</CardDescription>
        </CardHeader>
        <CardContent>
          {pendingScripts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileCheck className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p>No pending scripts.</p>
              <p className="text-sm mt-2">Use Auto Create above or enable Live Monitoring to generate scripts.</p>
            </div>
          ) : (
            <ScrollArea className="max-h-[600px]">
              <div className="space-y-4">
                {pendingScripts.map(pending => (
                  <div
                    key={pending.id}
                    className="p-4 bg-background/50 border border-amber-500/20 rounded-lg space-y-3"
                  >
                    {/* Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={pending.source === "live_monitoring" ? "destructive" : "default"} className="text-xs">
                            {pending.source === "live_monitoring" ? "Live" : "Auto"}
                          </Badge>
                          <span className="text-sm text-muted-foreground">{pending.channelName}</span>
                        </div>
                        <p className="font-medium text-sm line-clamp-2">{pending.title}</p>
                        <p className="text-xs text-muted-foreground">
                          Created: {new Date(pending.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <button
                        onClick={() => deleteScript(pending.id)}
                        className="text-red-400 hover:text-red-300 p-1 self-start"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Transcript */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-blue-400">Original Transcript</Label>
                        <span className="text-xs text-muted-foreground">{pending.transcriptChars.toLocaleString()} chars</span>
                      </div>
                      <div className="bg-blue-500/5 border border-blue-500/20 rounded p-2 text-xs max-h-32 overflow-y-auto">
                        <pre className="whitespace-pre-wrap font-sans">{pending.transcript}</pre>
                      </div>
                    </div>

                    {/* AI Script */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-emerald-400">AI Script</Label>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{pending.scriptChars.toLocaleString()} chars</span>
                          <button
                            onClick={() => setExpandedScript(expandedScript === pending.id ? null : pending.id)}
                            className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                          >
                            {expandedScript === pending.id ? (
                              <>
                                <ChevronUp className="w-3 h-3" />
                                Collapse
                              </>
                            ) : (
                              <>
                                <ChevronDown className="w-3 h-3" />
                                Expand
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                      <div className={`bg-emerald-500/5 border border-emerald-500/20 rounded p-2 text-xs overflow-y-auto ${expandedScript === pending.id ? 'max-h-96' : 'max-h-32'}`}>
                        <pre className="whitespace-pre-wrap font-sans">{pending.script}</pre>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button
                        size="sm"
                        onClick={() => approveScript(pending.id)}
                        disabled={approvingId === pending.id}
                        className="bg-emerald-600 hover:bg-emerald-700"
                      >
                        {approvingId === pending.id ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 mr-1" />
                        )}
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => reprocessScript(pending)}
                        disabled={reprocessingId === pending.id}
                        className="border-violet-500/30 hover:border-violet-500"
                      >
                        {reprocessingId === pending.id ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <RotateCcw className="w-4 h-4 mr-1" />
                        )}
                        Process Again
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openManualEdit(pending)}
                        className="border-amber-500/30 hover:border-amber-500"
                      >
                        <Edit3 className="w-4 h-4 mr-1" />
                        Manual
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Manual Edit Dialog */}
      <Dialog open={!!manualDialog} onOpenChange={() => setManualDialog(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit3 className="w-5 h-5 text-amber-400" />
              Manual Script Edit
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {manualDialog && (
              <>
                <p className="text-sm text-muted-foreground line-clamp-2">{manualDialog.title}</p>

                {/* Copy Prompt + Transcript Button */}
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Step 1: Copy the prompt + transcript and paste in ChatGPT/Gemini</Label>
                  <Button
                    variant="outline"
                    onClick={copyPromptWithTranscript}
                    className="w-full justify-center border-violet-500/30 hover:border-violet-500"
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    Copy Prompt + Transcript
                  </Button>
                </div>

                {/* Paste Script */}
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Step 2: Paste the generated script here</Label>
                  <Textarea
                    value={manualScript}
                    onChange={e => setManualScript(e.target.value)}
                    placeholder="Paste the script from ChatGPT/Gemini here..."
                    className="min-h-[200px]"
                  />
                  {manualScript && (
                    <p className="text-xs text-muted-foreground">{manualScript.length.toLocaleString()} chars</p>
                  )}
                </div>

                {/* Submit */}
                <Button
                  onClick={submitManualScript}
                  disabled={submittingManual || !manualScript.trim()}
                  className="w-full bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500"
                >
                  {submittingManual ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                  )}
                  Approve with Manual Script
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Completed Videos Tabs */}
      {channels.length > 0 && (
        <Card className="glass border-white/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              Completed Videos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="flex flex-wrap h-auto gap-1 mb-4">
                <TabsTrigger value="all" className="text-xs sm:text-sm">
                  All ({allCompleted.length})
                </TabsTrigger>
                {channels.map(channel => (
                  <TabsTrigger key={channel.channelId} value={channel.channelId} className="text-xs sm:text-sm">
                    {channel.name} ({completedByChannel[channel.channelId]?.length || 0})
                  </TabsTrigger>
                ))}
              </TabsList>

              {/* All Tab */}
              <TabsContent value="all">
                <VideoList videos={allCompleted} formatDate={formatDate} getStatusBadge={getStatusBadge} />
              </TabsContent>

              {/* Per-Channel Tabs */}
              {channels.map(channel => (
                <TabsContent key={channel.channelId} value={channel.channelId}>
                  <VideoList
                    videos={completedByChannel[channel.channelId] || []}
                    formatDate={formatDate}
                    getStatusBadge={getStatusBadge}
                  />
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// Video List Component
function VideoList({
  videos,
  formatDate,
  getStatusBadge
}: {
  videos: CompletedVideo[]
  formatDate: (date: string) => string
  getStatusBadge: (status?: string) => JSX.Element
}) {
  if (videos.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Video className="w-12 h-12 mx-auto mb-4 opacity-30" />
        <p>No videos processed yet.</p>
        <p className="text-sm mt-2">Use Auto Create above to process videos.</p>
      </div>
    )
  }

  return (
    <ScrollArea className="h-[400px]">
      <div className="space-y-3">
        {videos.map(video => (
          <Card key={video.jobId} className="border border-border hover:border-violet-500/30 transition-colors">
            <CardContent className="pt-4">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {getStatusBadge(video.status)}
                    <span className="font-medium text-violet-400 text-sm">
                      {video.folderName}
                    </span>
                  </div>
                  <p className="text-sm line-clamp-2">{video.title}</p>
                  <p className="text-xs text-muted-foreground/70">
                    Processed: {formatDate(video.processedAt)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Download buttons */}
                  <a
                    href={`/api/calendar/download?videoId=${video.folderName}&file=transcript`}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                  >
                    <FileText className="w-3 h-3" />
                    Transcript
                  </a>
                  <a
                    href={`/api/calendar/download?videoId=${video.folderName}&file=script`}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors"
                  >
                    <FileText className="w-3 h-3" />
                    Script
                  </a>
                  {video.status === "completed" && video.gofileLink && (
                    <a
                      href={video.gofileLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                    >
                      <Download className="w-3 h-3" />
                      Video
                    </a>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </ScrollArea>
  )
}
