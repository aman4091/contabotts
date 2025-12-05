"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "sonner"
import { Loader2, Video, Link, Image as ImageIcon, ExternalLink } from "lucide-react"

interface ImageFolder {
  name: string
  imageCount: number
}

export default function AudioToVideoPage() {
  const [gofileLinks, setGofileLinks] = useState("")
  const [imageFolders, setImageFolders] = useState<ImageFolder[]>([])
  const [selectedFolder, setSelectedFolder] = useState("")
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState("")
  const [addedCount, setAddedCount] = useState(0)

  useEffect(() => {
    fetchImageFolders()
  }, [])

  async function fetchImageFolders() {
    try {
      const res = await fetch("/api/images/folders")
      const data = await res.json()
      if (res.ok) {
        setImageFolders(data.folders || [])
        if (data.folders?.length > 0) {
          setSelectedFolder(data.folders[0].name)
        }
      }
    } catch (error) {
      toast.error("Failed to load image folders")
    } finally {
      setLoading(false)
    }
  }

  async function handleProcess() {
    if (!gofileLinks.trim()) {
      toast.error("Gofile links daalo")
      return
    }

    if (!selectedFolder) {
      toast.error("Background image folder select karo")
      return
    }

    // Parse multiple links (one per line)
    const links = gofileLinks
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.includes('gofile.io'))

    if (links.length === 0) {
      toast.error("No valid Gofile links found")
      return
    }

    setProcessing(true)
    setProgress(`Processing 0/${links.length}...`)
    setAddedCount(0)

    let successCount = 0

    for (let i = 0; i < links.length; i++) {
      setProgress(`Processing ${i + 1}/${links.length}...`)

      try {
        const res = await fetch("/api/audio-to-video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gofileLink: links[i],
            imageFolder: selectedFolder
          })
        })

        if (res.ok) {
          successCount++
        }
      } catch (error) {
        console.error(`Failed to add ${links[i]}:`, error)
      }
    }

    if (successCount > 0) {
      toast.success(`${successCount} jobs added to queue!`)
      setAddedCount(successCount)
      setGofileLinks("")
      setProgress("Done!")
    } else {
      toast.error("Failed to add any jobs")
      setProgress("Failed")
    }

    setProcessing(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="container mx-auto py-8 px-4 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Video className="w-6 h-6" />
            Audio to Video
          </CardTitle>
          <CardDescription>
            Gofile audio link do, video ban jayegi with subtitles
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Gofile Links Input */}
          <div className="space-y-2">
            <Label htmlFor="gofileLinks" className="flex items-center gap-2">
              <Link className="w-4 h-4" />
              Gofile Audio Links (one per line)
            </Label>
            <Textarea
              id="gofileLinks"
              placeholder="https://gofile.io/d/xxxxx&#10;https://gofile.io/d/yyyyy&#10;https://gofile.io/d/zzzzz"
              value={gofileLinks}
              onChange={(e) => setGofileLinks(e.target.value)}
              disabled={processing}
              className="min-h-[120px] font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              {gofileLinks.split('\n').filter(l => l.trim().includes('gofile.io')).length} valid links detected
            </p>
          </div>

          {/* Image Folder Selection */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4" />
              Background Image Folder
            </Label>
            <Select value={selectedFolder} onValueChange={setSelectedFolder} disabled={processing}>
              <SelectTrigger>
                <SelectValue placeholder="Select folder" />
              </SelectTrigger>
              <SelectContent>
                {imageFolders.map((folder) => (
                  <SelectItem key={folder.name} value={folder.name}>
                    {folder.name} ({folder.imageCount} images)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Process Button */}
          <Button
            onClick={handleProcess}
            disabled={processing || !gofileLinks.trim() || !selectedFolder}
            className="w-full bg-gradient-to-r from-violet-600 to-purple-500 hover:from-violet-500 hover:to-purple-400"
          >
            {processing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {progress}
              </>
            ) : (
              <>
                <Video className="w-4 h-4 mr-2" />
                Create Videos
              </>
            )}
          </Button>

          {/* Result */}
          {addedCount > 0 && (
            <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg space-y-3">
              <p className="text-green-400 font-medium">{addedCount} Jobs Added to Queue!</p>
              <p className="text-sm text-muted-foreground">
                Check Queue page for results when processing is done.
              </p>
              <Button
                variant="outline"
                className="w-full border-green-500/30 text-green-400 hover:bg-green-500/10"
                onClick={() => window.location.href = "/audio-files"}
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Go to Queue
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
