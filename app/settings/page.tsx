"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "sonner"
import {
  Save,
  Plus,
  Trash2,
  Loader2,
  Upload,
  FolderPlus,
  Image as ImageIcon,
  Edit2,
  X,
  Music,
  Check
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
    title: string
  }
  ai: {
    provider: string
    model: string
    max_chunk_size: number
    temperature: number
  }
}

interface ImageFolder {
  name: string
  imageCount: number
}

interface AudioFile {
  name: string
  size: number
  sizeFormatted: string
}

export default function SettingsPage() {
  const [sourceChannels, setSourceChannels] = useState<SourceChannel[]>([])
  const [targetChannels, setTargetChannels] = useState<TargetChannel[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [imageFolders, setImageFolders] = useState<ImageFolder[]>([])
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([])
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

  // Edit target channel
  const [editingChannel, setEditingChannel] = useState<TargetChannel | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  // Image folder states
  const [newFolderName, setNewFolderName] = useState("")
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [uploadingTo, setUploadingTo] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Audio upload states
  const [showAudioUpload, setShowAudioUpload] = useState(false)
  const [newAudioName, setNewAudioName] = useState("")
  const [uploadingAudio, setUploadingAudio] = useState(false)
  const audioInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [sourceRes, targetRes, settingsRes, foldersRes, audioRes] = await Promise.all([
        fetch("/api/source-channels"),
        fetch("/api/target-channels"),
        fetch("/api/settings"),
        fetch("/api/images/folders"),
        fetch("/api/reference-audio")
      ])

      const sourceData = await sourceRes.json()
      const targetData = await targetRes.json()
      const settingsData = await settingsRes.json()
      const foldersData = await foldersRes.json()
      const audioData = await audioRes.json()

      setSourceChannels(sourceData.channels || [])
      setTargetChannels(targetData.channels || [])
      setSettings(settingsData)
      setImageFolders(foldersData.folders || [])
      setAudioFiles(audioData.files || [])
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
      toast.error("Code, Name and Reference Audio required")
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

  async function updateTargetChannel() {
    if (!editingChannel) return

    setSavingEdit(true)
    try {
      const res = await fetch("/api/target-channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingChannel)
      })

      if (res.ok) {
        toast.success("Channel updated")
        setEditingChannel(null)
        loadAll()
      } else {
        const data = await res.json()
        toast.error(data.error || "Failed to update channel")
      }
    } catch (error) {
      toast.error("Failed to update channel")
    } finally {
      setSavingEdit(false)
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

  // Image folder functions
  async function createFolder() {
    if (!newFolderName.trim()) {
      toast.error("Folder name required")
      return
    }

    setCreatingFolder(true)
    try {
      const res = await fetch("/api/images/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newFolderName.trim() })
      })

      const data = await res.json()
      if (res.ok) {
        toast.success(`Folder "${data.name}" created`)
        setNewFolderName("")
        loadAll()
      } else {
        toast.error(data.error || "Failed to create folder")
      }
    } catch (error) {
      toast.error("Failed to create folder")
    } finally {
      setCreatingFolder(false)
    }
  }

  async function deleteFolder(name: string) {
    if (!confirm(`Delete folder "${name}" and all its images?`)) return

    try {
      const res = await fetch(`/api/images/folders?name=${name}`, {
        method: "DELETE"
      })

      if (res.ok) {
        toast.success("Folder deleted")
        loadAll()
      } else {
        toast.error("Failed to delete folder")
      }
    } catch (error) {
      toast.error("Failed to delete folder")
    }
  }

  function triggerUpload(folderName: string) {
    setUploadingTo(folderName)
    fileInputRef.current?.click()
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0 || !uploadingTo) return

    const formData = new FormData()
    formData.append("folder", uploadingTo)
    for (let i = 0; i < files.length; i++) {
      formData.append("files", files[i])
    }

    toast.info(`Uploading ${files.length} images...`)

    try {
      const res = await fetch("/api/images/upload", {
        method: "POST",
        body: formData
      })

      const data = await res.json()
      if (res.ok) {
        toast.success(`Uploaded ${data.uploaded} images`)
        loadAll()
      } else {
        toast.error(data.error || "Upload failed")
      }
    } catch (error) {
      toast.error("Upload failed")
    } finally {
      setUploadingTo(null)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  // Audio upload functions
  function triggerAudioUpload() {
    audioInputRef.current?.click()
  }

  async function handleAudioUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingAudio(true)
    const formData = new FormData()
    formData.append("file", file)
    if (newAudioName.trim()) {
      formData.append("name", newAudioName.trim())
    }

    try {
      const res = await fetch("/api/reference-audio", {
        method: "POST",
        body: formData
      })

      const data = await res.json()
      if (res.ok) {
        toast.success(`Uploaded: ${data.filename}`)
        setNewAudioName("")
        setShowAudioUpload(false)
        loadAll()
      } else {
        toast.error(data.error || "Upload failed")
      }
    } catch (error) {
      toast.error("Upload failed")
    } finally {
      setUploadingAudio(false)
      if (audioInputRef.current) audioInputRef.current.value = ""
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
        <p className="text-muted-foreground text-sm mt-1">Configure channels, prompts, images and AI settings</p>
      </div>

      {/* Hidden file inputs */}
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="image/*"
        multiple
        onChange={handleFileUpload}
      />
      <input
        type="file"
        ref={audioInputRef}
        className="hidden"
        accept=".wav,.mp3,audio/*"
        onChange={handleAudioUpload}
      />

      <Tabs defaultValue="target" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="target" className="text-xs sm:text-sm">Target</TabsTrigger>
          <TabsTrigger value="images" className="text-xs sm:text-sm">Images</TabsTrigger>
          <TabsTrigger value="source" className="text-xs sm:text-sm">Source</TabsTrigger>
          <TabsTrigger value="prompts" className="text-xs sm:text-sm">Prompts</TabsTrigger>
          <TabsTrigger value="ai" className="text-xs sm:text-sm">AI</TabsTrigger>
        </TabsList>

        {/* Target Channels Tab */}
        <TabsContent value="target" className="space-y-4">
          <Card className="glass border-white/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                Target Channels
              </CardTitle>
              <CardDescription>Output channels for generated audio/video</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Existing channels */}
              <div className="space-y-2">
                {targetChannels.map(channel => (
                  <div key={channel.channel_code}>
                    {editingChannel?.channel_code === channel.channel_code ? (
                      // Edit mode
                      <div className="p-4 border border-emerald-500/50 rounded-lg bg-emerald-500/5 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-emerald-400">Editing: {channel.channel_code}</span>
                          <Button variant="ghost" size="sm" onClick={() => setEditingChannel(null)}>
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs text-muted-foreground">Reference Audio</Label>
                            <Select
                              value={editingChannel.reference_audio}
                              onValueChange={v => setEditingChannel({ ...editingChannel, reference_audio: v })}
                            >
                              <SelectTrigger className="mt-1">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {audioFiles.map(audio => (
                                  <SelectItem key={audio.name} value={audio.name}>
                                    {audio.name} ({audio.sizeFormatted})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Image Folder</Label>
                            <Select
                              value={editingChannel.image_folder || ""}
                              onValueChange={v => setEditingChannel({ ...editingChannel, image_folder: v })}
                            >
                              <SelectTrigger className="mt-1">
                                <SelectValue placeholder="Select folder" />
                              </SelectTrigger>
                              <SelectContent>
                                {imageFolders.map(folder => (
                                  <SelectItem key={folder.name} value={folder.name}>
                                    {folder.name} ({folder.imageCount} images)
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          onClick={updateTargetChannel}
                          disabled={savingEdit}
                          className="bg-emerald-600 hover:bg-emerald-500"
                        >
                          {savingEdit ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Check className="w-4 h-4 mr-1" />}
                          Save Changes
                        </Button>
                      </div>
                    ) : (
                      // View mode
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 border border-border rounded gap-2 hover:border-emerald-500/30 transition-colors">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-foreground">{channel.channel_name}</div>
                          <div className="text-sm text-muted-foreground truncate">
                            {channel.channel_code} | Audio: {channel.reference_audio} | Images: {channel.image_folder || "nature"}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 self-end sm:self-auto">
                          <Badge variant={channel.is_active ? "success" : "secondary"}>
                            {channel.is_active ? "Active" : "Inactive"}
                          </Badge>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditingChannel({ ...channel })}
                            className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteTargetChannel(channel.channel_code)}
                          >
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Add new */}
              <div className="border-t border-border pt-4">
                <h4 className="font-medium mb-3 text-foreground">Add New Target Channel</h4>

                {/* Upload Audio Section */}
                {showAudioUpload ? (
                  <div className="mb-4 p-3 rounded-lg border border-cyan-500/30 bg-cyan-500/5">
                    <div className="flex items-center gap-2 mb-2">
                      <Music className="w-4 h-4 text-cyan-400" />
                      <span className="text-sm font-medium">Upload Reference Audio</span>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Audio name (optional)"
                        value={newAudioName}
                        onChange={e => setNewAudioName(e.target.value)}
                        className="flex-1"
                      />
                      <Button
                        onClick={triggerAudioUpload}
                        disabled={uploadingAudio}
                        className="bg-cyan-600 hover:bg-cyan-500"
                      >
                        {uploadingAudio ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        <span className="ml-1">Select File</span>
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setShowAudioUpload(false)}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Supports .wav and .mp3</p>
                  </div>
                ) : null}

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
                  <div className="flex gap-2">
                    <Select
                      value={newTarget.reference_audio}
                      onValueChange={v => setNewTarget(s => ({ ...s, reference_audio: v }))}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Select Reference Audio" />
                      </SelectTrigger>
                      <SelectContent>
                        {audioFiles.map(audio => (
                          <SelectItem key={audio.name} value={audio.name}>
                            {audio.name} ({audio.sizeFormatted})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setShowAudioUpload(true)}
                      className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                      title="Upload new audio"
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                  <Select
                    value={newTarget.image_folder}
                    onValueChange={v => setNewTarget(s => ({ ...s, image_folder: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select Image Folder" />
                    </SelectTrigger>
                    <SelectContent>
                      {imageFolders.map(folder => (
                        <SelectItem key={folder.name} value={folder.name}>
                          {folder.name} ({folder.imageCount} images)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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

        {/* Images Tab */}
        <TabsContent value="images" className="space-y-4">
          <Card className="glass border-white/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-pink-500" />
                Image Folders
              </CardTitle>
              <CardDescription>Manage image folders for video backgrounds</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Create new folder */}
              <div className="flex gap-2">
                <Input
                  placeholder="New folder name..."
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && createFolder()}
                  className="flex-1"
                />
                <Button
                  onClick={createFolder}
                  disabled={creatingFolder}
                  className="bg-gradient-to-r from-pink-600 to-violet-600 hover:from-pink-500 hover:to-violet-500"
                >
                  {creatingFolder ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderPlus className="w-4 h-4" />}
                  <span className="ml-2 hidden sm:inline">Add Folder</span>
                </Button>
              </div>

              {/* Folder list */}
              <div className="space-y-2">
                {imageFolders.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    No image folders. Create one to get started.
                  </div>
                ) : (
                  imageFolders.map(folder => (
                    <div key={folder.name} className="flex items-center justify-between p-3 border border-border rounded hover:border-pink-500/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-pink-500/10">
                          <ImageIcon className="w-5 h-5 text-pink-500" />
                        </div>
                        <div>
                          <div className="font-medium text-foreground">{folder.name}</div>
                          <div className="text-sm text-muted-foreground">{folder.imageCount} images</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => triggerUpload(folder.name)}
                          disabled={uploadingTo === folder.name}
                          className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                        >
                          {uploadingTo === folder.name ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Upload className="w-4 h-4" />
                          )}
                          <span className="ml-1 hidden sm:inline">Upload</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteFolder(folder.name)}
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
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
              <div>
                <Label>Title Generation Prompt</Label>
                <Textarea
                  value={settings?.prompts.title || ""}
                  onChange={e => setSettings(s => s ? {
                    ...s,
                    prompts: { ...s.prompts, title: e.target.value }
                  } : s)}
                  className="h-32 mt-1 font-mono text-sm"
                  placeholder="Generate 20 viral YouTube titles for the following script. Titles should be catchy, attention-grabbing, and optimized for clicks..."
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
