"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, ChevronLeft, ChevronRight, Video, Music, Copy, Search, Star, Type } from "lucide-react"
import { toast } from "sonner"

interface Job {
  job_id: string
  script_text: string
  channel_code: string
  video_number: number
  date: string
  username: string
  reference_audio: string
  status: string
  gofile_link?: string
  gofile_audio_link?: string
  video_links?: {
    primary?: string
    pixeldrain?: string
    gofile?: string
  }
  created_at: string
  completed_at?: string
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [goToInput, setGoToInput] = useState("")
  const [markedJobs, setMarkedJobs] = useState<Set<number>>(new Set())
  const [showMarkedOnly, setShowMarkedOnly] = useState(false)

  useEffect(() => {
    loadJobs()
    loadMarks()
  }, [])

  async function loadJobs() {
    setLoading(true)
    try {
      const res = await fetch("/api/jobs")
      const data = await res.json()
      setJobs(data.jobs || [])
    } catch (error) {
      console.error("Error loading jobs:", error)
    } finally {
      setLoading(false)
    }
  }

  async function loadMarks() {
    try {
      const res = await fetch("/api/jobs/marks")
      const data = await res.json()
      if (data.marked) {
        setMarkedJobs(new Set(data.marked))
      }
    } catch (error) {
      console.error("Error loading marks:", error)
    }
  }

  async function saveMarks(marked: Set<number>) {
    try {
      await fetch("/api/jobs/marks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marked: Array.from(marked) })
      })
    } catch (error) {
      console.error("Error saving marks:", error)
    }
  }

  // Filter jobs if showing marked only
  const displayJobs = showMarkedOnly
    ? jobs.filter(j => markedJobs.has(j.video_number))
    : jobs

  const currentJob = displayJobs[currentIndex]

  function goToPrevious() {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1)
    }
  }

  function goToNext() {
    if (currentIndex < displayJobs.length - 1) {
      setCurrentIndex(currentIndex + 1)
    }
  }

  // Reset index when filter changes
  useEffect(() => {
    setCurrentIndex(0)
  }, [showMarkedOnly])

  function goToJob() {
    const num = parseInt(goToInput.replace(/[vV]/g, ""))
    if (isNaN(num)) {
      toast.error("Enter valid V number")
      return
    }
    const idx = displayJobs.findIndex(j => j.video_number === num)
    if (idx >= 0) {
      setCurrentIndex(idx)
      setGoToInput("")
      toast.success(`Jumped to V${num}`)
    } else {
      toast.error(`V${num} not found`)
    }
  }

  function copyScript() {
    if (!currentJob?.script_text) return

    // Try modern clipboard API first
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(currentJob.script_text)
        .then(() => toast.success("Script copied!"))
        .catch(() => fallbackCopy(currentJob.script_text))
    } else {
      fallbackCopy(currentJob.script_text)
    }
  }

  function fallbackCopy(text: string, successMsg: string = "Copied!") {
    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.style.position = "fixed"
    textarea.style.left = "-9999px"
    document.body.appendChild(textarea)
    textarea.select()
    try {
      document.execCommand("copy")
      toast.success(successMsg)
    } catch (e) {
      toast.error("Copy failed - manually select text")
    }
    document.body.removeChild(textarea)
  }

  async function copyTitlePrompt() {
    if (!currentJob?.script_text) return

    try {
      // Fetch title prompt from settings
      const res = await fetch("/api/settings")
      const settings = await res.json()

      const defaultPrompt = `Generate exactly 20 unique, viral YouTube video titles for the following script.

Requirements:
- Each title should be catchy and attention-grabbing
- Titles should be optimized for clicks (curiosity gap, emotional triggers)
- Keep titles under 70 characters
- Use power words and emotional language
- Make titles relevant to the script content
- Number each title from 1 to 20

Format your response as a numbered list:
1. Title one
2. Title two
... and so on

Script:
`
      const titlePrompt = settings.prompts?.title || defaultPrompt
      const fullText = `${titlePrompt}\n\n${currentJob.script_text}`

      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(fullText)
          .then(() => toast.success("Title prompt + script copied!"))
          .catch(() => fallbackCopy(fullText, "Title prompt + script copied!"))
      } else {
        fallbackCopy(fullText, "Title prompt + script copied!")
      }
    } catch (error) {
      toast.error("Failed to get title prompt")
    }
  }

  function toggleMark(videoNumber: number) {
    const newMarked = new Set(markedJobs)
    if (newMarked.has(videoNumber)) {
      newMarked.delete(videoNumber)
      toast.success(`V${videoNumber} unmarked`)
    } else {
      newMarked.add(videoNumber)
      toast.success(`V${videoNumber} marked`)
    }
    setMarkedJobs(newMarked)
    saveMarks(newMarked)
  }

  // Get status badge color
  function getStatusColor(status: string) {
    switch (status) {
      case "completed":
        return "bg-green-500/20 text-green-400 border-green-500/30"
      case "processing":
        return "bg-blue-500/20 text-blue-400 border-blue-500/30"
      case "pending":
        return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
      case "failed":
        return "bg-red-500/20 text-red-400 border-red-500/30"
      case "paused":
        return "bg-gray-500/20 text-gray-400 border-gray-500/30"
      default:
        return "bg-gray-500/20 text-gray-400 border-gray-500/30"
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    )
  }

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <p className="text-muted-foreground">No jobs found</p>
      </div>
    )
  }

  const isMarked = currentJob && markedJobs.has(currentJob.video_number)

  // Handle empty displayJobs (when marked filter is on but no marked jobs)
  if (displayJobs.length === 0 && showMarkedOnly) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold gradient-text">Jobs</h1>
            <p className="text-muted-foreground text-sm mt-1">{jobs.length} total jobs</p>
          </div>
          <Button
            variant="default"
            onClick={() => setShowMarkedOnly(false)}
            className="gap-2"
          >
            <Star className="h-4 w-4 fill-current" />
            Show All
          </Button>
        </div>
        <div className="text-center py-16 text-muted-foreground">
          No marked jobs yet. Go back to all jobs and mark some with the star button!
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold gradient-text">Jobs</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {showMarkedOnly ? `${displayJobs.length} marked` : `${jobs.length} total`} jobs
            {markedJobs.size > 0 && !showMarkedOnly && ` (${markedJobs.size} marked)`}
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Filter toggle */}
          <Button
            variant={showMarkedOnly ? "default" : "outline"}
            onClick={() => setShowMarkedOnly(!showMarkedOnly)}
            size="sm"
            className="gap-1"
          >
            <Star className={`h-4 w-4 ${showMarkedOnly ? "fill-current" : ""}`} />
            <span className="hidden sm:inline">{showMarkedOnly ? "Show All" : "Marked"}</span>
          </Button>

          {/* Go to specific job */}
          <div className="flex items-center gap-1">
            <Input
              placeholder="V no."
              value={goToInput}
              onChange={(e) => setGoToInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && goToJob()}
              className="w-20 sm:w-24 h-9"
            />
            <Button variant="outline" size="sm" onClick={goToJob}>
              <Search className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Navigation Header - Mobile Optimized */}
      <div className="bg-card rounded-xl p-3 sm:p-4 border border-border">
        {/* Top row: Job info */}
        <div className="flex items-center justify-center gap-2 sm:gap-4 mb-3">
          {/* Mark Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => currentJob && toggleMark(currentJob.video_number)}
            className={`p-1 ${isMarked ? "text-yellow-400" : "text-muted-foreground"}`}
          >
            <Star className={`h-5 w-5 ${isMarked ? "fill-yellow-400" : ""}`} />
          </Button>

          {/* Job identifier */}
          <span className="text-xl sm:text-2xl font-bold gradient-text">
            V{currentJob?.video_number}
          </span>

          {/* Status badge */}
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(currentJob?.status || "")}`}>
            {currentJob?.status?.toUpperCase()}
          </span>

          {/* Position indicator */}
          <span className="text-xs sm:text-sm text-muted-foreground">
            {currentIndex + 1}/{displayJobs.length}
          </span>
        </div>

        {/* Bottom row: Navigation buttons */}
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            onClick={goToPrevious}
            disabled={currentIndex === 0}
            size="sm"
            className="flex-1 sm:flex-none"
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="sm:ml-1">Prev</span>
          </Button>

          <Button
            variant="outline"
            onClick={goToNext}
            disabled={currentIndex === displayJobs.length - 1}
            size="sm"
            className="flex-1 sm:flex-none"
          >
            <span className="sm:mr-1">Next</span>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Job Info & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 sm:gap-4 text-xs sm:text-sm text-muted-foreground flex-wrap">
          <span>{currentJob?.channel_code}</span>
          <span>{currentJob?.reference_audio}</span>
          <span>{currentJob?.date}</span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Copy Script */}
          <Button variant="outline" size="sm" onClick={copyScript} className="gap-1">
            <Copy className="h-4 w-4" />
            <span className="hidden sm:inline">Copy</span>
          </Button>

          {/* Title Prompt + Script */}
          <Button variant="outline" size="sm" onClick={copyTitlePrompt} className="gap-1 bg-orange-500/10 border-orange-500/30 hover:bg-orange-500/20">
            <Type className="h-4 w-4 text-orange-400" />
            <span className="text-orange-400">Title</span>
          </Button>

          {/* PixelDrain Video Link */}
          {(currentJob?.video_links?.pixeldrain || currentJob?.gofile_link) && (
            <a href={currentJob?.video_links?.pixeldrain || currentJob.gofile_link} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="gap-1 bg-blue-500/10 border-blue-500/30 hover:bg-blue-500/20">
                <Video className="h-4 w-4 text-blue-400" />
                <span className="text-blue-400">PD</span>
              </Button>
            </a>
          )}

          {/* GoFile Video Link */}
          {currentJob?.video_links?.gofile && (
            <a href={currentJob.video_links.gofile} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="gap-1 bg-purple-500/10 border-purple-500/30 hover:bg-purple-500/20">
                <Video className="h-4 w-4 text-purple-400" />
                <span className="text-purple-400">GF</span>
              </Button>
            </a>
          )}

          {/* Audio Download Link */}
          {currentJob?.gofile_audio_link && (
            <a href={currentJob.gofile_audio_link} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="gap-1 bg-green-500/10 border-green-500/30 hover:bg-green-500/20">
                <Music className="h-4 w-4 text-green-400" />
                <span className="text-green-400">Audio</span>
              </Button>
            </a>
          )}
        </div>
      </div>

      {/* Script Display */}
      <div className="bg-card rounded-xl border border-border p-4 sm:p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base sm:text-lg font-medium">Script</h2>
          <span className="text-xs sm:text-sm text-muted-foreground">
            {currentJob?.script_text?.length || 0} chars
          </span>
        </div>
        <div className="prose prose-invert max-w-none max-h-[50vh] sm:max-h-[60vh] overflow-y-auto">
          <pre className="whitespace-pre-wrap text-sm sm:text-base leading-relaxed font-sans bg-transparent p-0 m-0">
            {currentJob?.script_text || "No script available"}
          </pre>
        </div>
      </div>

      {/* Quick Navigation - Hidden on very small screens */}
      <div className="hidden sm:flex items-center gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground mr-2">Quick:</span>
        {displayJobs.slice(0, 15).map((job, idx) => (
          <Button
            key={job.job_id}
            variant={idx === currentIndex ? "default" : "outline"}
            size="sm"
            onClick={() => setCurrentIndex(idx)}
            className={`text-xs px-2 ${markedJobs.has(job.video_number) ? "border-yellow-500/50" : ""}`}
          >
            {markedJobs.has(job.video_number) && <Star className="h-3 w-3 mr-1 fill-yellow-400 text-yellow-400" />}
            V{job.video_number}
          </Button>
        ))}
        {displayJobs.length > 15 && (
          <span className="text-sm text-muted-foreground">+{displayJobs.length - 15} more</span>
        )}
      </div>
    </div>
  )
}
