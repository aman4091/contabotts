"use client"

import { useState, useEffect, useRef } from "react"
import { formatISTDate } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { toast } from "sonner"
import {
  Save,
  Plus,
  Trash2,
  Loader2,
  Upload,
  FolderPlus,
  Image as ImageIcon,
  Music,
  Check,
  AlertTriangle,
  RotateCcw,
  Youtube,
  RefreshCw
} from "lucide-react"

interface Settings {
  prompts: {
    youtube: string
    channel: string
    title: string
    shorts: string
  }
  ai: {
    provider: string
    model: string
    max_chunk_size: number
    temperature: number
  }
  video?: {
    default_image_folder: string
    subtitle_style: string
    useAiImage: boolean
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

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [imageFolders, setImageFolders] = useState<ImageFolder[]>([])
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

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
  const [defaultReferenceAudio, setDefaultReferenceAudio] = useState("")
  const [channelVideoStatus, setChannelVideoStatus] = useState<{
    [channelCode: string]: {
      channelName: string
      channelUrl: string
      totalVideos: number
      fetchedAt: string
    }
  }>({})

  // Channel management
  const [newChannelCode, setNewChannelCode] = useState("")
  const [newChannelUrl, setNewChannelUrl] = useState("")
  const [fetchingChannel, setFetchingChannel] = useState<string | null>(null)
  const [deletingChannel, setDeletingChannel] = useState<string | null>(null)

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [settingsRes, foldersRes, audioRes, videoFetchRes] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/images/folders"),
        fetch("/api/reference-audio"),
        fetch("/api/videos/fetch")
      ])

      const settingsData = await settingsRes.json()
      const foldersData = await foldersRes.json()
      const audioData = await audioRes.json()
      const videoFetchData = await videoFetchRes.json()

      setSettings(settingsData)
      setImageFolders(foldersData.folders || [])
      setAudioFiles(audioData.files || [])

      // Build channel video status map
      const statusMap: { [key: string]: { channelName: string; channelUrl: string; totalVideos: number; fetchedAt: string } } = {}
      if (videoFetchData.channels) {
        for (const ch of videoFetchData.channels) {
          statusMap[ch.channelCode] = {
            channelName: ch.channelName,
            channelUrl: ch.channelUrl || "",
            totalVideos: ch.totalVideos,
            fetchedAt: ch.fetchedAt
          }
        }
      }
      setChannelVideoStatus(statusMap)

      // Set default audio from settings
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

  // Channel management functions
  async function addAndFetchChannel() {
    if (!newChannelCode.trim()) {
      toast.error("Channel code required")
      return
    }
    if (!newChannelUrl.trim()) {
      toast.error("YouTube URL required")
      return
    }

    const channelCode = newChannelCode.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-")
    setFetchingChannel(channelCode)
    toast.info(`Fetching videos from channel...`)

    try {
      const res = await fetch("/api/videos/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelUrl: newChannelUrl.trim(),
          channelCode,
          minDuration: 1800,
          maxResults: 1000
        })
      })

      const data = await res.json()
      if (res.ok) {
        toast.success(`Fetched ${data.totalFetched} videos from ${data.channelName}`)
        setNewChannelCode("")
        setNewChannelUrl("")
        loadAll()
      } else {
        toast.error(data.error || "Failed to fetch videos")
      }
    } catch (error) {
      toast.error("Failed to fetch videos")
    } finally {
      setFetchingChannel(null)
    }
  }

  async function refetchChannel(channelCode: string, channelUrl?: string) {
    if (!channelUrl) {
      toast.error("Channel URL not available for refetch")
      return
    }

    setFetchingChannel(channelCode)
    toast.info(`Refetching videos...`)

    try {
      const res = await fetch("/api/videos/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelUrl,
          channelCode,
          minDuration: 1800,
          maxResults: 1000
        })
      })

      const data = await res.json()
      if (res.ok) {
        toast.success(`Fetched ${data.totalFetched} videos`)
        loadAll()
      } else {
        toast.error(data.error || "Failed to fetch videos")
      }
    } catch (error) {
      toast.error("Failed to fetch videos")
    } finally {
      setFetchingChannel(null)
    }
  }

  async function deleteChannel(channelCode: string) {
    if (!confirm(`Delete channel "${channelCode}" and all its video data?`)) return

    setDeletingChannel(channelCode)
    try {
      const res = await fetch(`/api/videos/fetch?channel=${channelCode}`, {
        method: "DELETE"
      })

      if (res.ok) {
        toast.success("Channel deleted")
        loadAll()
      } else {
        const data = await res.json()
        toast.error(data.error || "Failed to delete channel")
      }
    } catch (error) {
      toast.error("Failed to delete channel")
    } finally {
      setDeletingChannel(null)
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

      <Tabs defaultValue="videos" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="videos" className="text-xs sm:text-sm">Video Grid</TabsTrigger>
          <TabsTrigger value="images" className="text-xs sm:text-sm">Images</TabsTrigger>
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
                YouTube Channels
              </CardTitle>
              <CardDescription>Add YouTube channels and fetch their videos for homepage grid</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Add New Channel */}
              <div className="p-4 border border-dashed border-border rounded-lg space-y-3">
                <Label className="text-sm font-medium">Add New Channel</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Input
                    placeholder="Channel code (e.g. motivation)"
                    value={newChannelCode}
                    onChange={e => setNewChannelCode(e.target.value)}
                  />
                  <Input
                    placeholder="YouTube channel URL"
                    value={newChannelUrl}
                    onChange={e => setNewChannelUrl(e.target.value)}
                  />
                </div>
                <Button
                  onClick={addAndFetchChannel}
                  disabled={fetchingChannel !== null || !newChannelCode.trim() || !newChannelUrl.trim()}
                  className="bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-500 hover:to-pink-500"
                >
                  {fetchingChannel ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Fetching...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4 mr-2" />
                      Add & Fetch Videos
                    </>
                  )}
                </Button>
              </div>

              {/* Channel List */}
              {Object.keys(channelVideoStatus).length > 0 ? (
                <div className="space-y-3">
                  <Label className="text-sm font-medium">Your Channels</Label>
                  {Object.entries(channelVideoStatus).map(([code, status]) => (
                    <div key={code} className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-red-500/10">
                          <Youtube className="w-5 h-5 text-red-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-emerald-400">{status.channelName}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            Code: {code} • {status.totalVideos} videos • {formatISTDate(status.fetchedAt)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => refetchChannel(code, status.channelUrl)}
                            disabled={fetchingChannel === code}
                            className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                          >
                            {fetchingChannel === code ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <RefreshCw className="w-4 h-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteChannel(code)}
                            disabled={deletingChannel === code}
                          >
                            {deletingChannel === code ? (
                              <Loader2 className="w-4 h-4 animate-spin text-red-500" />
                            ) : (
                              <Trash2 className="w-4 h-4 text-red-500" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Youtube className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No channels added yet. Add a YouTube channel above.</p>
                </div>
              )}

              {/* Reference Audio Section */}
              <div className="space-y-4 pt-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-base font-medium flex items-center gap-2">
                      <Music className="w-4 h-4 text-cyan-400" />
                      Reference Audio (Voice)
                    </Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Upload voice samples for TTS. Primary voice is used by default.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAudioUpload(!showAudioUpload)}
                    className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Upload New
                  </Button>
                </div>

                {/* Upload Form */}
                {showAudioUpload && (
                  <div className="p-4 border border-dashed border-cyan-500/30 rounded-lg bg-cyan-500/5 space-y-3">
                    <div className="flex gap-2">
                      <Input
                        placeholder="Voice name (optional)"
                        value={newAudioName}
                        onChange={e => setNewAudioName(e.target.value)}
                        className="flex-1"
                      />
                      <Button
                        onClick={triggerAudioUpload}
                        disabled={uploadingAudio}
                        className="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500"
                      >
                        {uploadingAudio ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Upload className="w-4 h-4" />
                        )}
                        <span className="ml-2">Select File</span>
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Supported: .wav, .mp3 (10-30 seconds recommended)
                    </p>
                  </div>
                )}

                {/* Audio Files List */}
                <div className="space-y-2">
                  {audioFiles.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground border border-dashed border-border rounded-lg">
                      <Music className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p>No voice samples yet. Upload one above.</p>
                    </div>
                  ) : (
                    audioFiles.map(audio => {
                      const isPrimary = defaultReferenceAudio === audio.name
                      return (
                        <div
                          key={audio.name}
                          className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                            isPrimary
                              ? "border-cyan-500/50 bg-cyan-500/10"
                              : "border-border hover:border-cyan-500/30"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${isPrimary ? "bg-cyan-500/20" : "bg-muted"}`}>
                              <Music className={`w-5 h-5 ${isPrimary ? "text-cyan-400" : "text-muted-foreground"}`} />
                            </div>
                            <div>
                              <div className="font-medium flex items-center gap-2">
                                {audio.name}
                                {isPrimary && (
                                  <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 text-xs">
                                    Primary
                                  </Badge>
                                )}
                              </div>
                              <div className="text-sm text-muted-foreground">{audio.sizeFormatted}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {!isPrimary && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setDefaultReferenceAudio(audio.name)
                                  // Auto-save when setting primary
                                  fetch("/api/settings", {
                                    method: "PUT",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ defaultReferenceAudio: audio.name })
                                  }).then(() => {
                                    toast.success(`${audio.name} set as primary voice`)
                                  })
                                }}
                                className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                              >
                                <Check className="w-4 h-4 mr-1" />
                                Set Primary
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={async () => {
                                if (!confirm(`Delete "${audio.name}"?`)) return
                                try {
                                  const res = await fetch(`/api/reference-audio?name=${encodeURIComponent(audio.name)}`, {
                                    method: "DELETE"
                                  })
                                  if (res.ok) {
                                    toast.success("Audio deleted")
                                    loadAll()
                                  } else {
                                    toast.error("Failed to delete")
                                  }
                                } catch {
                                  toast.error("Failed to delete")
                                }
                              }}
                            >
                              <Trash2 className="w-4 h-4 text-red-500" />
                            </Button>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
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
              <div>
                <Label className="flex items-center gap-2">
                  Shorts Generation Prompt
                  <Badge variant="secondary" className="text-xs">Auto Cron</Badge>
                </Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Used by automatic daily cron to generate 10 shorts from each processed script (max 3 scripts/day = 30 shorts)
                </p>
                <Textarea
                  value={settings?.prompts.shorts || ""}
                  onChange={e => setSettings(s => s ? {
                    ...s,
                    prompts: { ...s.prompts, shorts: e.target.value }
                  } : s)}
                  className="h-40 mt-1 font-mono text-sm"
                  placeholder="Convert this script into 10 short viral clips for YouTube Shorts (under 60 seconds each). Each short should be numbered 1-10 and contain engaging, standalone content..."
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

              {/* AI Image Generation Toggle */}
              <div className="p-4 border border-dashed border-cyan-500/30 rounded-lg bg-cyan-500/5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-base font-medium flex items-center gap-2">
                      <ImageIcon className="w-4 h-4 text-cyan-400" />
                      AI Image Generation
                    </Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Use Gemini 3 Pro to analyze script and Imagen 3.0 to generate background images for automation videos
                    </p>
                  </div>
                  <Switch
                    checked={settings?.video?.useAiImage || false}
                    onCheckedChange={(checked) => setSettings(s => s ? {
                      ...s,
                      video: {
                        ...s.video,
                        default_image_folder: s.video?.default_image_folder || 'nature',
                        subtitle_style: s.video?.subtitle_style || '',
                        useAiImage: checked
                      }
                    } : s)}
                  />
                </div>
                {settings?.video?.useAiImage && (
                  <div className="text-xs text-cyan-400 bg-cyan-500/10 p-2 rounded">
                    AI image generation is enabled. Automation videos will use AI-generated backgrounds instead of random folder images.
                  </div>
                )}
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
