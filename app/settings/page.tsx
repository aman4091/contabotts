"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import {
  Save,
  Plus,
  Trash2,
  Loader2
} from "lucide-react"

interface SourceChannel {
  channel_code: string
  channel_name: string
  youtube_channel_url: string
  min_duration_seconds: number
  max_duration_seconds: number
  max_videos: number
  is_active: boolean
}

interface TargetChannel {
  channel_code: string
  channel_name: string
  reference_audio: string
  image_folder?: string
  is_active: boolean
}

interface Settings {
  prompts: {
    youtube: string
    channel: string
  }
  ai: {
    provider: string
    model: string
    max_chunk_size: number
    temperature: number
  }
}

export default function SettingsPage() {
  const [sourceChannels, setSourceChannels] = useState<SourceChannel[]>([])
  const [targetChannels, setTargetChannels] = useState<TargetChannel[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // New channel forms
  const [newSource, setNewSource] = useState({
    channel_code: "",
    channel_name: "",
    youtube_channel_url: ""
  })
  const [newTarget, setNewTarget] = useState({
    channel_code: "",
    channel_name: "",
    reference_audio: "",
    image_folder: ""
  })

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [sourceRes, targetRes, settingsRes] = await Promise.all([
        fetch("/api/source-channels"),
        fetch("/api/target-channels"),
        fetch("/api/settings")
      ])

      const sourceData = await sourceRes.json()
      const targetData = await targetRes.json()
      const settingsData = await settingsRes.json()

      setSourceChannels(sourceData.channels || [])
      setTargetChannels(targetData.channels || [])
      setSettings(settingsData)
    } catch (error) {
      console.error("Error loading settings:", error)
      toast.error("Failed to load settings")
    } finally {
      setLoading(false)
    }
  }

  async function saveSettings() {
    if (!settings) return
    setSaving(true)
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings)
      })

      if (res.ok) {
        toast.success("Settings saved")
      } else {
        toast.error("Failed to save settings")
      }
    } catch (error) {
      toast.error("Failed to save settings")
    } finally {
      setSaving(false)
    }
  }

  async function addSourceChannel() {
    if (!newSource.channel_code || !newSource.channel_name || !newSource.youtube_channel_url) {
      toast.error("All fields required")
      return
    }

    try {
      const res = await fetch("/api/source-channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newSource,
          min_duration_seconds: 600,
          max_duration_seconds: 7200,
          max_videos: 1000,
          is_active: true
        })
      })

      if (res.ok) {
        toast.success("Source channel added")
        setNewSource({ channel_code: "", channel_name: "", youtube_channel_url: "" })
        loadAll()
      } else {
        const data = await res.json()
        toast.error(data.error || "Failed to add channel")
      }
    } catch (error) {
      toast.error("Failed to add channel")
    }
  }

  async function deleteSourceChannel(code: string) {
    try {
      const res = await fetch(`/api/source-channels?code=${code}`, {
        method: "DELETE"
      })

      if (res.ok) {
        toast.success("Channel deleted")
        loadAll()
      } else {
        toast.error("Failed to delete channel")
      }
    } catch (error) {
      toast.error("Failed to delete channel")
    }
  }

  async function addTargetChannel() {
    if (!newTarget.channel_code || !newTarget.channel_name || !newTarget.reference_audio) {
      toast.error("All fields required")
      return
    }

    try {
      const res = await fetch("/api/target-channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newTarget,
          is_active: true
        })
      })

      if (res.ok) {
        toast.success("Target channel added")
        setNewTarget({ channel_code: "", channel_name: "", reference_audio: "", image_folder: "" })
        loadAll()
      } else {
        const data = await res.json()
        toast.error(data.error || "Failed to add channel")
      }
    } catch (error) {
      toast.error("Failed to add channel")
    }
  }

  async function deleteTargetChannel(code: string) {
    try {
      const res = await fetch(`/api/target-channels?code=${code}`, {
        method: "DELETE"
      })

      if (res.ok) {
        toast.success("Channel deleted")
        loadAll()
      } else {
        toast.error("Failed to delete channel")
      }
    } catch (error) {
      toast.error("Failed to delete channel")
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold gradient-text">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">Configure channels, prompts, and AI settings</p>
      </div>

      <Tabs defaultValue="prompts" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="prompts" className="text-xs sm:text-sm">Prompts</TabsTrigger>
          <TabsTrigger value="source" className="text-xs sm:text-sm">Source</TabsTrigger>
          <TabsTrigger value="target" className="text-xs sm:text-sm">Target</TabsTrigger>
          <TabsTrigger value="ai" className="text-xs sm:text-sm">AI</TabsTrigger>
        </TabsList>

        {/* Prompts Tab */}
        <TabsContent value="prompts" className="space-y-4">
          <Card className="glass border-white/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-violet-500" />
                AI Prompts
              </CardTitle>
              <CardDescription>Configure prompts for transcript processing</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>YouTube Transcript Prompt</Label>
                <Textarea
                  value={settings?.prompts.youtube || ""}
                  onChange={e => setSettings(s => s ? {
                    ...s,
                    prompts: { ...s.prompts, youtube: e.target.value }
                  } : s)}
                  className="h-40 mt-1 font-mono text-sm"
                  placeholder="Enter prompt for converting YouTube transcripts..."
                />
              </div>
              <div>
                <Label>Channel Prompt</Label>
                <Textarea
                  value={settings?.prompts.channel || ""}
                  onChange={e => setSettings(s => s ? {
                    ...s,
                    prompts: { ...s.prompts, channel: e.target.value }
                  } : s)}
                  className="h-32 mt-1 font-mono text-sm"
                  placeholder="Enter channel-specific prompt..."
                />
              </div>
              <Button
                onClick={saveSettings}
                disabled={saving}
                className="bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400 border-0 text-white"
              >
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save Prompts
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Source Channels Tab */}
        <TabsContent value="source" className="space-y-4">
          <Card className="glass border-white/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-cyan-400" />
                Source Channels
              </CardTitle>
              <CardDescription>YouTube channels to fetch transcripts from</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Existing channels */}
              <div className="space-y-2">
                {sourceChannels.map(channel => (
                  <div key={channel.channel_code} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 border border-border rounded gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-foreground">{channel.channel_name}</div>
                      <div className="text-sm text-muted-foreground truncate">{channel.channel_code} - {channel.youtube_channel_url}</div>
                    </div>
                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      <Badge variant={channel.is_active ? "success" : "secondary"}>
                        {channel.is_active ? "Active" : "Inactive"}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteSourceChannel(channel.channel_code)}
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add new */}
              <div className="border-t border-border pt-4">
                <h4 className="font-medium mb-2 text-foreground">Add New Source Channel</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <Input
                    placeholder="Code (e.g., MRBEAST)"
                    value={newSource.channel_code}
                    onChange={e => setNewSource(s => ({ ...s, channel_code: e.target.value.toUpperCase() }))}
                  />
                  <Input
                    placeholder="Name (e.g., MrBeast)"
                    value={newSource.channel_name}
                    onChange={e => setNewSource(s => ({ ...s, channel_name: e.target.value }))}
                  />
                  <Input
                    placeholder="YouTube URL"
                    value={newSource.youtube_channel_url}
                    onChange={e => setNewSource(s => ({ ...s, youtube_channel_url: e.target.value }))}
                  />
                </div>
                <Button
                  className="mt-2 bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400 border-0 text-white"
                  onClick={addSourceChannel}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Channel
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Target Channels Tab */}
        <TabsContent value="target" className="space-y-4">
          <Card className="glass border-white/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                Target Channels
              </CardTitle>
              <CardDescription>Output channels for generated audio</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Existing channels */}
              <div className="space-y-2">
                {targetChannels.map(channel => (
                  <div key={channel.channel_code} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 border border-border rounded gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-foreground">{channel.channel_name}</div>
                      <div className="text-sm text-muted-foreground truncate">
                        {channel.channel_code} - Audio: {channel.reference_audio} - Images: {channel.image_folder || "default"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      <Badge variant={channel.is_active ? "success" : "secondary"}>
                        {channel.is_active ? "Active" : "Inactive"}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteTargetChannel(channel.channel_code)}
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add new */}
              <div className="border-t border-border pt-4">
                <h4 className="font-medium mb-2 text-foreground">Add New Target Channel</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Input
                    placeholder="Code (e.g., BI)"
                    value={newTarget.channel_code}
                    onChange={e => setNewTarget(s => ({ ...s, channel_code: e.target.value.toUpperCase() }))}
                  />
                  <Input
                    placeholder="Name"
                    value={newTarget.channel_name}
                    onChange={e => setNewTarget(s => ({ ...s, channel_name: e.target.value }))}
                  />
                  <Input
                    placeholder="Reference Audio (e.g., BI.wav)"
                    value={newTarget.reference_audio}
                    onChange={e => setNewTarget(s => ({ ...s, reference_audio: e.target.value }))}
                  />
                  <Input
                    placeholder="Image Folder (e.g., 1, 2, BI)"
                    value={newTarget.image_folder}
                    onChange={e => setNewTarget(s => ({ ...s, image_folder: e.target.value }))}
                  />
                </div>
                <Button
                  className="mt-2 bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400 border-0 text-white"
                  onClick={addTargetChannel}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Channel
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI Settings Tab */}
        <TabsContent value="ai" className="space-y-4">
          <Card className="glass border-white/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-violet-500" />
                AI Settings
              </CardTitle>
              <CardDescription>Configure AI model and parameters</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Provider</Label>
                  <Input
                    value={settings?.ai.provider || "gemini"}
                    onChange={e => setSettings(s => s ? {
                      ...s,
                      ai: { ...s.ai, provider: e.target.value }
                    } : s)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Model</Label>
                  <Input
                    value={settings?.ai.model || "gemini-2.0-flash"}
                    onChange={e => setSettings(s => s ? {
                      ...s,
                      ai: { ...s.ai, model: e.target.value }
                    } : s)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Max Chunk Size</Label>
                  <Input
                    type="number"
                    value={settings?.ai.max_chunk_size || 7000}
                    onChange={e => setSettings(s => s ? {
                      ...s,
                      ai: { ...s.ai, max_chunk_size: parseInt(e.target.value) }
                    } : s)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Temperature</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={settings?.ai.temperature || 0.7}
                    onChange={e => setSettings(s => s ? {
                      ...s,
                      ai: { ...s.ai, temperature: parseFloat(e.target.value) }
                    } : s)}
                    className="mt-1"
                  />
                </div>
              </div>
              <Button
                onClick={saveSettings}
                disabled={saving}
                className="bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400 border-0 text-white"
              >
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save AI Settings
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
