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
  Check,
  AlertTriangle,
  RotateCcw,
  Youtube,
  RefreshCw
} from "lucide-react"
import { ThumbnailEditor } from "@/components/thumbnail-editor"

interface SourceChannel {
  channel_code: string
  channel_name: string
  youtube_channel_url: string
  min_duration_seconds: number
  max_duration_seconds: number
  max_videos: number
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
  sourceChannelUrl?: string
  defaultReferenceAudio?: string
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

interface ThumbnailTemplate {
  id: string
  name: string
  backgroundImageFolder: string
  overlayImage: string
  overlayPosition: { x: number; y: number }
  overlaySize: { width: number; height: number }
  textBox: {
    x: number
    y: number
    width: number
    height: number
    fontFamily: string
    fontSize: number
    fontColor: string
    textAlign: "left" | "center" | "right"
    padding: { top: number; right: number; bottom: number; left: number }
    shadow: { enabled: boolean; color: string; offsetX: number; offsetY: number; blur: number }
    outline: { enabled: boolean; color: string; width: number }
  }
}

export default function SettingsPage() {
  const [sourceChannels, setSourceChannels] = useState<SourceChannel[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [imageFolders, setImageFolders] = useState<ImageFolder[]>([])
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([])
  const [templates, setTemplates] = useState<ThumbnailTemplate[]>([])
  const [overlayImages, setOverlayImages] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Template editor state
  const [editingTemplate, setEditingTemplate] = useState<ThumbnailTemplate | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [generatingPreview, setGeneratingPreview] = useState(false)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const overlayInputRef = useRef<HTMLInputElement>(null)

  // New channel forms
  const [newSource, setNewSource] = useState({
    channel_code: "",
    channel_name: "",
    youtube_channel_url: ""
  })

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

  // Reset system state
  const [resetting, setResetting] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  // Video grid settings
  const [sourceChannelUrl, setSourceChannelUrl] = useState("")
  const [defaultReferenceAudio, setDefaultReferenceAudio] = useState("")
  const [fetchingVideos, setFetchingVideos] = useState(false)
  const [videoFetchStatus, setVideoFetchStatus] = useState<{
    hasFetched: boolean
    channelName?: string
    totalVideos?: number
    fetchedAt?: string
  } | null>(null)

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [sourceRes, settingsRes, foldersRes, audioRes, templatesRes, overlaysRes, videoFetchRes] = await Promise.all([
        fetch("/api/source-channels"),
        fetch("/api/settings"),
        fetch("/api/images/folders"),
        fetch("/api/reference-audio"),
        fetch("/api/thumbnail-templates"),
        fetch("/api/images?type=overlays"),
        fetch("/api/videos/fetch")
      ])

      const sourceData = await sourceRes.json()
      const settingsData = await settingsRes.json()
      const foldersData = await foldersRes.json()
      const audioData = await audioRes.json()
      const templatesData = await templatesRes.json()
      const overlaysData = await overlaysRes.json()
      const videoFetchData = await videoFetchRes.json()

      setSourceChannels(sourceData.channels || [])
      setSettings(settingsData)
      setImageFolders(foldersData.folders || [])
      setAudioFiles(audioData.files || [])
      setTemplates(templatesData.templates || [])
      setOverlayImages(overlaysData.overlays || [])
      setVideoFetchStatus(videoFetchData)

      // Load source channel URL and default audio from settings
      setSourceChannelUrl(settingsData.sourceChannelUrl || "")
      setDefaultReferenceAudio(settingsData.defaultReferenceAudio || "")
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

  // Template functions
  function createNewTemplate() {
    setEditingTemplate({
      id: `template_${Date.now()}`,
      name: "New Template",
      backgroundImageFolder: imageFolders[0]?.name || "nature",
      overlayImage: "",
      overlayPosition: { x: 0, y: 0 },
      overlaySize: { width: 300, height: 300 },
      textBox: {
        x: 50,
        y: 480,
        width: 1180,
        height: 200,
        fontFamily: "Impact",
        fontSize: 72,
        fontColor: "#FFFFFF",
        textAlign: "center",
        padding: { top: 10, right: 20, bottom: 10, left: 20 },
        shadow: { enabled: true, color: "#000000", offsetX: 3, offsetY: 3, blur: 6 },
        outline: { enabled: true, color: "#000000", width: 3 }
      }
    })
    setPreviewUrl(null)
  }

  async function saveTemplate() {
    if (!editingTemplate) return

    setSavingTemplate(true)
    try {
      const res = await fetch("/api/thumbnail-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingTemplate)
      })

      if (res.ok) {
        toast.success("Template saved!")
        setEditingTemplate(null)
        setPreviewUrl(null)
        loadAll()
      } else {
        const data = await res.json()
        toast.error(data.error || "Failed to save template")
      }
    } catch (error) {
      toast.error("Failed to save template")
    } finally {
      setSavingTemplate(false)
    }
  }

  async function deleteTemplate(id: string) {
    if (!confirm("Delete this template?")) return

    try {
      const res = await fetch(`/api/thumbnail-templates?id=${id}`, {
        method: "DELETE"
      })

      if (res.ok) {
        toast.success("Template deleted")
        loadAll()
      } else {
        toast.error("Failed to delete template")
      }
    } catch (error) {
      toast.error("Failed to delete template")
    }
  }

  async function generatePreview() {
    if (!editingTemplate) return

    setGeneratingPreview(true)
    try {
      const res = await fetch("/api/thumbnail-templates/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template: editingTemplate,
          title: "Sample Preview Title Here"
        })
      })

      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        setPreviewUrl(url)
      } else {
        toast.error("Failed to generate preview")
      }
    } catch (error) {
      toast.error("Failed to generate preview")
    } finally {
      setGeneratingPreview(false)
    }
  }

  async function handleOverlayUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const formData = new FormData()
    formData.append("file", file)

    try {
      const res = await fetch("/api/images", {
        method: "POST",
        body: formData
      })

      const data = await res.json()
      if (res.ok) {
        toast.success("Overlay uploaded!")
        // Reload overlays
        const overlaysRes = await fetch("/api/images?type=overlays")
        const overlaysData = await overlaysRes.json()
        setOverlayImages(overlaysData.overlays || [])
        // Select it in the template
        if (editingTemplate) {
          setEditingTemplate({ ...editingTemplate, overlayImage: data.filename })
        }
      } else {
        toast.error(data.error || "Upload failed")
      }
    } catch (error) {
      toast.error("Upload failed")
    } finally {
      if (overlayInputRef.current) overlayInputRef.current.value = ""
    }
  }

  // Full system reset
  async function handleSystemReset() {
    setResetting(true)
    try {
      const res = await fetch("/api/system/reset", {
        method: "POST"
      })

      const data = await res.json()
      if (res.ok) {
        toast.success("System reset complete! Everything cleared.")
        setShowResetConfirm(false)
        loadAll()
      } else {
        toast.error(data.error || "Reset failed")
      }
    } catch (error) {
      toast.error("Reset failed")
    } finally {
      setResetting(false)
    }
  }

  // Video grid functions
  async function saveVideoGridSettings() {
    setSaving(true)
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceChannelUrl,
          defaultReferenceAudio
        })
      })

      if (res.ok) {
        toast.success("Video grid settings saved")
      } else {
        toast.error("Failed to save settings")
      }
    } catch (error) {
      toast.error("Failed to save settings")
    } finally {
      setSaving(false)
    }
  }

  async function fetchVideosFromChannel() {
    if (!sourceChannelUrl) {
      toast.error("Please enter a channel URL")
      return
    }

    setFetchingVideos(true)
    toast.info("Fetching videos... This may take a minute.")

    try {
      const res = await fetch("/api/videos/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelUrl: sourceChannelUrl,
          minDuration: 1800, // 30 minutes
          maxResults: 1000
        })
      })

      const data = await res.json()
      if (res.ok) {
        toast.success(`Fetched ${data.totalFetched} videos from ${data.channelName}`)
        // Reload status
        const statusRes = await fetch("/api/videos/fetch")
        const statusData = await statusRes.json()
        setVideoFetchStatus(statusData)
        // Save the channel URL
        await saveVideoGridSettings()
      } else {
        toast.error(data.error || "Failed to fetch videos")
      }
    } catch (error) {
      toast.error("Failed to fetch videos")
    } finally {
      setFetchingVideos(false)
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
      <input
        type="file"
        ref={overlayInputRef}
        className="hidden"
        accept="image/*"
        onChange={handleOverlayUpload}
      />

      <Tabs defaultValue="videos" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="videos" className="text-xs sm:text-sm">Video Grid</TabsTrigger>
          <TabsTrigger value="images" className="text-xs sm:text-sm">Images</TabsTrigger>
          <TabsTrigger value="thumbnails" className="text-xs sm:text-sm">Thumbnails</TabsTrigger>
          <TabsTrigger value="source" className="text-xs sm:text-sm">Source</TabsTrigger>
          <TabsTrigger value="prompts" className="text-xs sm:text-sm">Prompts</TabsTrigger>
          <TabsTrigger value="ai" className="text-xs sm:text-sm">AI</TabsTrigger>
          <TabsTrigger value="danger" className="text-xs sm:text-sm text-red-400">Reset</TabsTrigger>
        </TabsList>

        {/* Video Grid Tab */}
        <TabsContent value="videos" className="space-y-4">
          <Card className="glass border-white/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                YouTube Source Channel
              </CardTitle>
              <CardDescription>Configure source channel for video grid on homepage</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Current status */}
              {videoFetchStatus?.hasFetched && (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Youtube className="w-5 h-5 text-red-500" />
                    <span className="font-medium text-emerald-400">{videoFetchStatus.channelName}</span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    <p>{videoFetchStatus.totalVideos} videos saved</p>
                    <p className="text-xs">Last fetched: {new Date(videoFetchStatus.fetchedAt || "").toLocaleString()}</p>
                  </div>
                </div>
              )}

              {/* Source Channel URL */}
              <div className="space-y-2">
                <Label>YouTube Channel URL</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="https://youtube.com/@channelname"
                    value={sourceChannelUrl}
                    onChange={e => setSourceChannelUrl(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    onClick={fetchVideosFromChannel}
                    disabled={fetchingVideos || !sourceChannelUrl}
                    className="bg-red-600 hover:bg-red-500"
                  >
                    {fetchingVideos ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <RefreshCw className="w-4 h-4 mr-2" />
                    )}
                    {videoFetchStatus?.hasFetched ? "Refresh" : "Fetch Videos"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Fetches top 1000 videos (30+ minutes) sorted by view count
                </p>
              </div>

              {/* Default Reference Audio */}
              <div className="space-y-2 pt-4 border-t border-border">
                <Label>Default Reference Audio</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Voice used when adding videos to queue from homepage
                </p>
                <Select
                  value={defaultReferenceAudio}
                  onValueChange={v => setDefaultReferenceAudio(v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select default voice" />
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

              {/* Save Button */}
              <Button
                onClick={saveVideoGridSettings}
                disabled={saving}
                className="bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400 border-0 text-white"
              >
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save Settings
              </Button>
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

        {/* Thumbnails Tab */}
        <TabsContent value="thumbnails" className="space-y-4">
          {editingTemplate ? (
            <Card className="glass border-white/10">
              <CardContent className="pt-6">
                <ThumbnailEditor
                  template={editingTemplate}
                  imageFolders={imageFolders}
                  overlayImages={overlayImages}
                  onSave={async (template) => {
                    try {
                      const res = await fetch("/api/thumbnail-templates", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(template)
                      })
                      if (res.ok) {
                        toast.success("Template saved!")
                        setEditingTemplate(null)
                        loadAll()
                      } else {
                        toast.error("Failed to save template")
                      }
                    } catch {
                      toast.error("Failed to save template")
                    }
                  }}
                  onClose={() => setEditingTemplate(null)}
                />
              </CardContent>
            </Card>
          ) : (
            <Card className="glass border-white/10">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-orange-500" />
                      Thumbnail Templates
                    </CardTitle>
                    <CardDescription>Create and manage thumbnail templates with live editor</CardDescription>
                  </div>
                  <Button
                    onClick={createNewTemplate}
                    className="bg-gradient-to-r from-orange-600 to-pink-600 hover:from-orange-500 hover:to-pink-500"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    New Template
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Template List */}
                <div className="space-y-2">
                  {templates.length === 0 && (
                    <div className="text-center text-muted-foreground py-8">
                      <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      No templates yet. Create one to get started.
                    </div>
                  )}
                  {templates.map(template => (
                    <div key={template.id} className="flex items-center justify-between p-3 border border-border rounded hover:border-orange-500/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-orange-500/10">
                          <ImageIcon className="w-5 h-5 text-orange-500" />
                        </div>
                        <div>
                          <div className="font-medium text-foreground">{template.name}</div>
                          <div className="text-sm text-muted-foreground">
                            BG: {template.backgroundImageFolder} | Font: {template.textBox.fontFamily}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingTemplate({ ...template })}
                          className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteTemplate(template.id)}
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
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

        {/* Danger Zone - System Reset */}
        <TabsContent value="danger" className="space-y-4">
          <Card className="glass border-red-500/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-400">
                <AlertTriangle className="w-5 h-5" />
                System Reset
              </CardTitle>
              <CardDescription>Complete system reset - use with caution</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                <h4 className="font-semibold text-red-400 mb-2">This will permanently delete:</h4>
                <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                  <li>All organized folders (transcripts, scripts)</li>
                  <li>All queue jobs (pending, processing, completed, failed)</li>
                  <li>Entire calendar (all scheduled videos for all channels)</li>
                  <li>Video number counters (will restart from 1)</li>
                </ul>
                <p className="text-xs text-red-400 mt-3">This action cannot be undone!</p>
              </div>

              {showResetConfirm ? (
                <div className="flex flex-col gap-3 p-4 border border-red-500/50 rounded-lg bg-red-500/5">
                  <p className="text-sm text-center">Are you sure? Type "RESET" to confirm:</p>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Type RESET"
                      className="flex-1"
                      onChange={e => {
                        if (e.target.value === "RESET") {
                          handleSystemReset()
                        }
                      }}
                    />
                    <Button
                      variant="outline"
                      onClick={() => setShowResetConfirm(false)}
                      disabled={resetting}
                    >
                      Cancel
                    </Button>
                  </div>
                  {resetting && (
                    <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Resetting system...
                    </div>
                  )}
                </div>
              ) : (
                <Button
                  variant="destructive"
                  className="w-full bg-red-600 hover:bg-red-500"
                  onClick={() => setShowResetConfirm(true)}
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Reset Entire System
                </Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
