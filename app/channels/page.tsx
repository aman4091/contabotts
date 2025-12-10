"use client"

import { useState, useEffect } from "react"
import { formatIST, formatISTDate } from "@/lib/utils"
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
  Video,
  Zap,
  Settings,
  Save,
  X,
  Radio,
  Clock,
  Image as ImageIcon,
  List
} from "lucide-react"
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

interface DelayedVideo {
  id: string
  videoId: string
  title: string
  channelId: string
  channelName: string
  thumbnail: string
  scheduledFor: string
  createdAt: string
  status: "waiting" | "processing" | "completed" | "failed"
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [completedByChannel, setCompletedByChannel] = useState<{ [key: string]: CompletedVideo[] }>({})
  const [delayedVideos, setDelayedVideos] = useState<DelayedVideo[]>([])
  const [loading, setLoading] = useState(true)
  const [addingChannel, setAddingChannel] = useState(false)
  const [processing, setProcessing] = useState(false)

  // Form states
  const [newChannelUrl, setNewChannelUrl] = useState("")
  const [selectedChannel, setSelectedChannel] = useState("")
  const [numVideos, setNumVideos] = useState(6)
  const [minDuration, setMinDuration] = useState(600)

  // Active tabs
  const [activeTab, setActiveTab] = useState("all")
  const [scheduledTab, setScheduledTab] = useState("all-scheduled")
  const [scheduledDateFilter, setScheduledDateFilter] = useState("all")

  // Prompt editing
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null)
  const [promptValue, setPromptValue] = useState("")
  const [savingPrompt, setSavingPrompt] = useState(false)

  useEffect(() => {
    loadChannels()
  }, [])

  useEffect(() => {
    if (channels.length > 0) {
      loadCompletedVideos()
      loadDelayedVideos()
    }
  }, [channels])

  async function loadDelayedVideos() {
    try {
      const res = await fetch("/api/channels/delayed")
      const data = await res.json()
      setDelayedVideos(data.videos || [])
    } catch (error) {
      console.error("Error loading delayed videos:", error)
    }
  }

  async function removeDelayedVideo(videoId: string) {
    try {
      const res = await fetch(`/api/channels/delayed?videoId=${videoId}`, { method: "DELETE" })
      if (res.ok) {
        toast.success("Video removed from queue")
        loadDelayedVideos()
      } else {
        toast.error("Failed to remove video")
      }
    } catch {
      toast.error("Failed to remove video")
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
        toast.success(data.message || "Processing started! Videos will be added to queue directly.")
      } else {
        toast.error(data.error || "Processing failed")
      }
    } catch (error) {
      toast.error("Processing failed")
    } finally {
      setProcessing(false)
    }
  }

  function formatDateLocal(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
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

  // Get date in IST (India timezone)
  const getISTDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) // YYYY-MM-DD format
  }

  // Get unique scheduled dates for dropdown (in IST)
  const scheduledDates = Array.from(new Set(
    delayedVideos
      .filter(v => v.status === "waiting")
      .map(v => getISTDate(v.scheduledFor))
  )).sort()

  // Today's date in IST
  const todayIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })

  // Filter delayed videos by date (using IST)
  const filterByDate = (videos: DelayedVideo[]) => {
    if (scheduledDateFilter === "all") return videos
    return videos.filter(v => getISTDate(v.scheduledFor) === scheduledDateFilter)
  }

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
          onClick={() => { loadChannels(); loadCompletedVideos(); loadDelayedVideos() }}
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
          <CardDescription>Paste a YouTube channel URL to fetch last 10 days videos</CardDescription>
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
                      Last checked: {formatIST(channel.lastChecked)}
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
          <CardDescription>Select a channel and number of videos to process automatically (direct to queue)</CardDescription>
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
            This will fetch transcripts, process with Gemini, and add directly to the audio queue.
          </p>
        </CardContent>
      </Card>

      {/* Delayed Videos Section with Tabs */}
      {delayedVideos.length > 0 && channels.length > 0 && (
        <Card className="glass border-amber-500/30">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Clock className="w-5 h-5 text-amber-400" />
                  Scheduled Videos ({filterByDate(delayedVideos.filter(v => v.status === "waiting")).length} {scheduledDateFilter !== "all" ? `on ${new Date(scheduledDateFilter).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}` : "waiting"})
                </CardTitle>
                <CardDescription>Videos will be processed 7 days after publish date</CardDescription>
              </div>
              <Select value={scheduledDateFilter} onValueChange={setScheduledDateFilter}>
                <SelectTrigger className="w-[150px] border-amber-500/30">
                  <SelectValue placeholder="Filter by date" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Dates</SelectItem>
                  {scheduledDates.map(date => {
                    const label = date === todayIST ? "Today" : new Date(date + "T00:00:00").toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" })
                    return (
                      <SelectItem key={date} value={date}>{label}</SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            <Tabs value={scheduledTab} onValueChange={setScheduledTab}>
              <TabsList className="flex flex-wrap h-auto gap-1 mb-4">
                <TabsTrigger value="all-scheduled" className="text-xs sm:text-sm">
                  All ({filterByDate(delayedVideos.filter(v => v.status === "waiting")).length})
                </TabsTrigger>
                {channels.map(channel => {
                  const count = filterByDate(delayedVideos.filter(v => v.channelId === channel.channelId && v.status === "waiting")).length
                  if (count === 0) return null
                  return (
                    <TabsTrigger key={`scheduled-${channel.channelId}`} value={`scheduled-${channel.channelId}`} className="text-xs sm:text-sm">
                      {channel.name} ({count})
                    </TabsTrigger>
                  )
                })}
              </TabsList>

              <TabsContent value="all-scheduled">
                <ScheduledVideoList videos={filterByDate(delayedVideos.filter(v => v.status === "waiting"))} formatDate={formatDateLocal} removeVideo={removeDelayedVideo} />
              </TabsContent>

              {channels.map(channel => (
                <TabsContent key={`scheduled-${channel.channelId}`} value={`scheduled-${channel.channelId}`}>
                  <ScheduledVideoList
                    videos={filterByDate(delayedVideos.filter(v => v.channelId === channel.channelId && v.status === "waiting"))}
                    formatDate={formatDateLocal}
                    removeVideo={removeDelayedVideo}
                  />
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      )}

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
                <VideoList videos={allCompleted} formatDate={formatDateLocal} getStatusBadge={getStatusBadge} />
              </TabsContent>

              {/* Per-Channel Tabs */}
              {channels.map(channel => (
                <TabsContent key={channel.channelId} value={channel.channelId}>
                  <VideoList
                    videos={completedByChannel[channel.channelId] || []}
                    formatDate={formatDateLocal}
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
                  <a
                    href={`/api/calendar/download?videoId=${video.folderName}&file=titles`}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors"
                  >
                    <List className="w-3 h-3" />
                    Titles
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

// Scheduled Video List Component
function ScheduledVideoList({
  videos,
  formatDate,
  removeVideo
}: {
  videos: DelayedVideo[]
  formatDate: (date: string) => string
  removeVideo: (videoId: string) => void
}) {
  if (videos.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Clock className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p>No scheduled videos</p>
      </div>
    )
  }

  // Sort by scheduledFor date
  const sorted = [...videos].sort((a, b) =>
    new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime()
  )

  return (
    <ScrollArea className="h-[300px]">
      <div className="space-y-2">
        {sorted.map(video => {
          const daysLeft = Math.ceil((new Date(video.scheduledFor).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          return (
            <div
              key={video.id}
              className="flex items-center gap-3 p-2 rounded-lg border bg-amber-500/5 border-amber-500/20"
            >
              <img
                src={video.thumbnail}
                alt={video.title}
                className="w-16 h-10 rounded object-cover shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{video.title}</p>
                <p className="text-xs text-muted-foreground">
                  Scheduled: {formatDate(video.scheduledFor)}
                </p>
              </div>
              <Badge variant="outline" className="shrink-0 text-amber-400 border-amber-500/30">
                <Clock className="w-3 h-3 mr-1" />
                {daysLeft <= 0 ? "Today" : `${daysLeft}d`}
              </Badge>
              <button
                onClick={() => removeVideo(video.videoId)}
                className="p-1.5 text-red-400 hover:bg-red-500/10 rounded"
                title="Remove from queue"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}
