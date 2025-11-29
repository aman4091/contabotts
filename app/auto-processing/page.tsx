"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { toast } from "sonner"
import {
  RefreshCw,
  Plus,
  Loader2,
  Play,
  Pause,
  Trash2,
  Edit2,
  Save,
  X,
  Zap,
  Clock,
  CheckCircle2,
  Youtube,
  Target,
  Timer,
  Hash
} from "lucide-react"

interface MonitoredChannel {
  id: string
  sourceChannelUrl: string
  sourceChannelId: string
  sourceChannelName: string
  targetChannelCode: string
  minDuration: number
  maxDuration: number
  dailyVideoCount: number
  customPrompt: string
  isActive: boolean
  createdAt: string
  lastProcessedAt: string | null
  stats: {
    poolSize: number
    processedCount: number
    pendingCount: number
  }
}

interface TargetChannel {
  channel_code: string
  channel_name: string
  is_active: boolean
}

export default function AutoProcessingPage() {
  const [channels, setChannels] = useState<MonitoredChannel[]>([])
  const [targetChannels, setTargetChannels] = useState<TargetChannel[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [processing, setProcessing] = useState<string | null>(null)

  // Add/Edit form state
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    sourceChannelUrl: "",
    targetChannelCode: "",
    minDuration: 300,
    maxDuration: 900,
    dailyVideoCount: 6,
    customPrompt: ""
  })

  // Add new target channel
  const [showAddTarget, setShowAddTarget] = useState(false)
  const [newTarget, setNewTarget] = useState({ code: "", name: "" })
  const [addingTarget, setAddingTarget] = useState(false)

  useEffect(() => {
    loadChannels()
    loadTargetChannels()
  }, [])

  async function loadChannels() {
    try {
      const res = await fetch("/api/auto-processing/channels")
      const data = await res.json()
      if (data.success) {
        setChannels(data.channels || [])
      }
    } catch (error) {
      console.error("Error loading channels:", error)
    } finally {
      setLoading(false)
    }
  }

  async function loadTargetChannels() {
    try {
      const res = await fetch("/api/target-channels")
      const data = await res.json()
      setTargetChannels(data.channels || [])
    } catch (error) {
      console.error("Error loading target channels:", error)
    }
  }

  async function addTargetChannel() {
    if (!newTarget.code || !newTarget.name) {
      toast.error("Code and Name required")
      return
    }

    setAddingTarget(true)
    try {
      const res = await fetch("/api/target-channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel_code: newTarget.code.toUpperCase(),
          channel_name: newTarget.name,
          reference_audio: `${newTarget.code.toUpperCase()}.wav`,
          is_active: true
        })
      })
      const data = await res.json()

      if (data.success) {
        toast.success("Target channel added!")
        setNewTarget({ code: "", name: "" })
        setShowAddTarget(false)
        setFormData({ ...formData, targetChannelCode: newTarget.code.toUpperCase() })
        await loadTargetChannels()
      } else {
        toast.error(data.error || "Failed to add channel")
      }
    } catch (error) {
      toast.error("Error adding channel")
    } finally {
      setAddingTarget(false)
    }
  }

  async function handleSubmit() {
    if (!formData.sourceChannelUrl || !formData.targetChannelCode) {
      toast.error("Source URL and Target Channel required")
      return
    }

    setSaving(true)
    try {
      const url = editingId
        ? `/api/auto-processing/channels?id=${editingId}`
        : "/api/auto-processing/channels"

      const res = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData)
      })

      const data = await res.json()

      if (data.success) {
        toast.success(editingId ? "Channel updated!" : "Channel added! Fetching videos...")
        resetForm()
        await loadChannels()
      } else {
        toast.error(data.error || "Failed to save channel")
      }
    } catch (error) {
      toast.error("Error saving channel")
    } finally {
      setSaving(false)
    }
  }

  async function deleteChannel(id: string) {
    if (!confirm("Delete this channel?")) return

    try {
      const res = await fetch(`/api/auto-processing/channels?id=${id}`, {
        method: "DELETE"
      })
      const data = await res.json()

      if (data.success) {
        toast.success("Channel deleted")
        await loadChannels()
      } else {
        toast.error(data.error || "Failed to delete")
      }
    } catch (error) {
      toast.error("Error deleting channel")
    }
  }

  async function toggleActive(channel: MonitoredChannel) {
    try {
      const res = await fetch(`/api/auto-processing/channels?id=${channel.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !channel.isActive })
      })
      const data = await res.json()

      if (data.success) {
        toast.success(channel.isActive ? "Channel paused" : "Channel activated")
        await loadChannels()
      }
    } catch (error) {
      toast.error("Error updating channel")
    }
  }

  async function processNow(channelId: string) {
    setProcessing(channelId)
    try {
      const res = await fetch("/api/auto-processing/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId })
      })
      const data = await res.json()

      if (data.success) {
        toast.success(`Processing started! ${data.videosQueued || 0} videos queued`)
        await loadChannels()
      } else {
        toast.error(data.error || "Failed to process")
      }
    } catch (error) {
      toast.error("Error processing channel")
    } finally {
      setProcessing(null)
    }
  }

  function editChannel(channel: MonitoredChannel) {
    setFormData({
      sourceChannelUrl: channel.sourceChannelUrl,
      targetChannelCode: channel.targetChannelCode,
      minDuration: channel.minDuration,
      maxDuration: channel.maxDuration,
      dailyVideoCount: channel.dailyVideoCount,
      customPrompt: channel.customPrompt || ""
    })
    setEditingId(channel.id)
    setShowForm(true)
  }

  function resetForm() {
    setFormData({
      sourceChannelUrl: "",
      targetChannelCode: "",
      minDuration: 300,
      maxDuration: 900,
      dailyVideoCount: 6,
      customPrompt: ""
    })
    setEditingId(null)
    setShowForm(false)
  }

  function formatDuration(seconds: number) {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return "Never"
    const date = new Date(dateStr)
    return date.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    })
  }

  // Stats
  const totalPool = channels.reduce((sum, c) => sum + (c.stats?.poolSize || 0), 0)
  const totalProcessed = channels.reduce((sum, c) => sum + (c.stats?.processedCount || 0), 0)
  const totalPending = channels.reduce((sum, c) => sum + (c.stats?.pendingCount || 0), 0)
  const activeChannels = channels.filter(c => c.isActive).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold gradient-text">Auto Processing</h1>
          <p className="text-muted-foreground text-sm mt-1">Automated daily video processing</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadChannels}
            disabled={loading}
            className="border-violet-500/30 hover:border-violet-500 hover:bg-violet-500/10"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
          <Button
            size="sm"
            onClick={() => setShowForm(true)}
            className="bg-gradient-to-r from-violet-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Channel
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="glass border-violet-500/20 card-hover">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Channels</p>
                <p className="text-2xl font-bold text-violet-400">{activeChannels}/{channels.length}</p>
              </div>
              <div className="p-2 rounded-xl bg-violet-500/10">
                <Youtube className="w-6 h-6 text-violet-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass border-cyan-500/20 card-hover">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Video Pool</p>
                <p className="text-2xl font-bold text-cyan-400">{totalPool}</p>
              </div>
              <div className="p-2 rounded-xl bg-cyan-500/10">
                <Hash className="w-6 h-6 text-cyan-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass border-emerald-500/20 card-hover">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Processed</p>
                <p className="text-2xl font-bold text-emerald-400">{totalProcessed}</p>
              </div>
              <div className="p-2 rounded-xl bg-emerald-500/10">
                <CheckCircle2 className="w-6 h-6 text-emerald-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass border-orange-500/20 card-hover">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending</p>
                <p className="text-2xl font-bold text-orange-400">{totalPending}</p>
              </div>
              <div className="p-2 rounded-xl bg-orange-500/10">
                <Clock className="w-6 h-6 text-orange-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <Card className="glass border-violet-500/30">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center justify-between">
              <span>{editingId ? "Edit Channel" : "Add New Channel"}</span>
              <Button variant="ghost" size="sm" onClick={resetForm}>
                <X className="w-4 h-4" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Source Channel URL</Label>
                <Input
                  placeholder="https://youtube.com/@channelname"
                  value={formData.sourceChannelUrl}
                  onChange={e => setFormData({ ...formData, sourceChannelUrl: e.target.value })}
                  className="bg-background/50"
                />
              </div>
              <div className="space-y-2">
                <Label>Target Channel</Label>
                {!showAddTarget ? (
                  <div className="flex gap-2">
                    <Select
                      value={formData.targetChannelCode}
                      onValueChange={v => setFormData({ ...formData, targetChannelCode: v })}
                    >
                      <SelectTrigger className="bg-background/50 flex-1">
                        <SelectValue placeholder="Select target channel" />
                      </SelectTrigger>
                      <SelectContent>
                        {targetChannels.map(ch => (
                          <SelectItem key={ch.channel_code} value={ch.channel_code}>
                            {ch.channel_name} ({ch.channel_code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setShowAddTarget(true)}
                      className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                      title="Add new target channel"
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2 p-3 rounded-lg border border-cyan-500/30 bg-cyan-500/5">
                    <div className="flex gap-2">
                      <Input
                        placeholder="Code (e.g. AIVI)"
                        value={newTarget.code}
                        onChange={e => setNewTarget({ ...newTarget, code: e.target.value.toUpperCase() })}
                        className="bg-background/50 w-24"
                        maxLength={10}
                      />
                      <Input
                        placeholder="Channel Name"
                        value={newTarget.name}
                        onChange={e => setNewTarget({ ...newTarget, name: e.target.value })}
                        className="bg-background/50 flex-1"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={addTargetChannel}
                        disabled={addingTarget}
                        className="bg-cyan-600 hover:bg-cyan-500"
                      >
                        {addingTarget ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
                        Add
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => { setShowAddTarget(false); setNewTarget({ code: "", name: "" }) }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>Min Duration (sec)</Label>
                <Input
                  type="number"
                  value={formData.minDuration}
                  onChange={e => setFormData({ ...formData, minDuration: parseInt(e.target.value) || 0 })}
                  className="bg-background/50"
                />
                <p className="text-xs text-muted-foreground">{formatDuration(formData.minDuration)}</p>
              </div>
              <div className="space-y-2">
                <Label>Max Duration (sec)</Label>
                <Input
                  type="number"
                  value={formData.maxDuration}
                  onChange={e => setFormData({ ...formData, maxDuration: parseInt(e.target.value) || 0 })}
                  className="bg-background/50"
                />
                <p className="text-xs text-muted-foreground">{formatDuration(formData.maxDuration)}</p>
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Daily Video Count</Label>
                <Input
                  type="number"
                  value={formData.dailyVideoCount}
                  onChange={e => setFormData({ ...formData, dailyVideoCount: parseInt(e.target.value) || 6 })}
                  className="bg-background/50"
                  min={1}
                  max={20}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Custom Prompt (optional)</Label>
              <Textarea
                placeholder="Leave empty to use global prompt from settings..."
                value={formData.customPrompt}
                onChange={e => setFormData({ ...formData, customPrompt: e.target.value })}
                className="bg-background/50 min-h-[100px]"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={resetForm}>Cancel</Button>
              <Button
                onClick={handleSubmit}
                disabled={saving}
                className="bg-gradient-to-r from-violet-600 to-cyan-600"
              >
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                {editingId ? "Update" : "Add Channel"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Channels List */}
      <Card className="glass border-white/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-violet-500" />
            Monitored Channels
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px]">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : channels.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No channels added yet. Click "Add Channel" to start.
              </div>
            ) : (
              <div className="space-y-4">
                {channels.map(channel => (
                  <Card key={channel.id} className="border border-border">
                    <CardContent className="pt-4">
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        {/* Channel Info */}
                        <div className="space-y-2 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant={channel.isActive ? "default" : "secondary"}>
                              {channel.isActive ? "Active" : "Paused"}
                            </Badge>
                            <span className="font-bold text-lg">{channel.sourceChannelName}</span>
                            <span className="text-muted-foreground">→</span>
                            <Badge variant="outline" className="border-cyan-500/50 text-cyan-400">
                              {channel.targetChannelCode}
                            </Badge>
                          </div>

                          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Timer className="w-4 h-4" />
                              {formatDuration(channel.minDuration)} - {formatDuration(channel.maxDuration)}
                            </span>
                            <span className="flex items-center gap-1">
                              <Hash className="w-4 h-4" />
                              {channel.dailyVideoCount}/day
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="w-4 h-4" />
                              Last: {formatDate(channel.lastProcessedAt)}
                            </span>
                          </div>

                          {/* Stats */}
                          <div className="flex gap-4 text-sm">
                            <span className="text-cyan-400">Pool: {channel.stats?.poolSize || 0}</span>
                            <span className="text-emerald-400">Done: {channel.stats?.processedCount || 0}</span>
                            <span className="text-orange-400">Left: {channel.stats?.pendingCount || 0}</span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={channel.isActive}
                            onCheckedChange={() => toggleActive(channel)}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => processNow(channel.id)}
                            disabled={processing === channel.id || !channel.isActive}
                            className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                          >
                            {processing === channel.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Zap className="w-4 h-4" />
                            )}
                            <span className="ml-1 hidden sm:inline">Process</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => editChannel(channel)}
                            className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => deleteChannel(channel.id)}
                            className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
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

      {/* Info */}
      <Card className="glass border-cyan-500/20">
        <CardContent className="pt-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/10">
              <Clock className="w-5 h-5 text-cyan-500" />
            </div>
            <div>
              <p className="font-medium text-foreground">Automatic Processing</p>
              <p className="text-sm text-muted-foreground">
                Runs daily at midnight (00:00 IST). Picks top videos by views from pool,
                generates transcripts and scripts, adds to queue with low priority.
                Pool refreshes every 7 days.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
