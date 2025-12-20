"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, ChevronLeft, ChevronRight, Video, Music, Copy, Search, Star } from "lucide-react"
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
    // Load marked jobs from localStorage
    const saved = localStorage.getItem("markedJobs")
    if (saved) {
      setMarkedJobs(new Set(JSON.parse(saved)))
    }
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
    if (currentJob?.script_text) {
      navigator.clipboard.writeText(currentJob.script_text)
      toast.success("Script copied!")
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
    localStorage.setItem("markedJobs", JSON.stringify(Array.from(newMarked)))
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold gradient-text">Jobs</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {showMarkedOnly ? `${displayJobs.length} marked` : `${jobs.length} total`} jobs
            {markedJobs.size > 0 && !showMarkedOnly && ` (${markedJobs.size} marked)`}
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          {/* Filter toggle */}
          <Button
            variant={showMarkedOnly ? "default" : "outline"}
            onClick={() => setShowMarkedOnly(!showMarkedOnly)}
            className="gap-2"
          >
            <Star className={`h-4 w-4 ${showMarkedOnly ? "fill-current" : ""}`} />
            {showMarkedOnly ? "Show All" : "Marked Only"}
          </Button>

          {/* Go to specific job */}
          <div className="flex items-center gap-2">
            <Input
              placeholder="V number"
              value={goToInput}
              onChange={(e) => setGoToInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && goToJob()}
              className="w-28"
            />
            <Button variant="outline" onClick={goToJob}>
              <Search className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Navigation Header */}
      <div className="flex items-center justify-between bg-card rounded-xl p-4 border border-border">
        <Button
          variant="outline"
          onClick={goToPrevious}
          disabled={currentIndex === 0}
          className="gap-2"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>

        <div className="flex items-center gap-4">
          {/* Mark Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => currentJob && toggleMark(currentJob.video_number)}
            className={isMarked ? "text-yellow-400" : "text-muted-foreground"}
          >
            <Star className={`h-5 w-5 ${isMarked ? "fill-yellow-400" : ""}`} />
          </Button>

          {/* Job identifier */}
          <span className="text-2xl font-bold gradient-text">
            V{currentJob?.video_number}
          </span>

          {/* Status badge */}
          <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(currentJob?.status || "")}`}>
            {currentJob?.status?.toUpperCase()}
          </span>

          {/* Position indicator */}
          <span className="text-sm text-muted-foreground">
            {currentIndex + 1} / {displayJobs.length}
          </span>
        </div>

        <Button
          variant="outline"
          onClick={goToNext}
          disabled={currentIndex === displayJobs.length - 1}
          className="gap-2"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Job Info & Actions */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>Channel: {currentJob?.channel_code}</span>
          <span>Voice: {currentJob?.reference_audio}</span>
          <span>Date: {currentJob?.date}</span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3">
          {/* Copy Script */}
          <Button variant="outline" onClick={copyScript} className="gap-2">
            <Copy className="h-4 w-4" />
            Copy Script
          </Button>

          {/* GoFile Video Link */}
          {currentJob?.gofile_link && (
            <a href={currentJob.gofile_link} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" className="gap-2 bg-purple-500/10 border-purple-500/30 hover:bg-purple-500/20">
                <Video className="h-4 w-4 text-purple-400" />
                <span className="text-purple-400">Video</span>
              </Button>
            </a>
          )}

          {/* GoFile Audio Link */}
          {currentJob?.gofile_audio_link && (
            <a href={currentJob.gofile_audio_link} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" className="gap-2 bg-green-500/10 border-green-500/30 hover:bg-green-500/20">
                <Music className="h-4 w-4 text-green-400" />
                <span className="text-green-400">Audio</span>
              </Button>
            </a>
          )}
        </div>
      </div>

      {/* Script Display */}
      <div className="bg-card rounded-xl border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium">Script</h2>
          <span className="text-sm text-muted-foreground">
            {currentJob?.script_text?.length || 0} characters
          </span>
        </div>
        <div className="prose prose-invert max-w-none max-h-[60vh] overflow-y-auto">
          <pre className="whitespace-pre-wrap text-base leading-relaxed font-sans bg-transparent p-0 m-0">
            {currentJob?.script_text || "No script available"}
          </pre>
        </div>
      </div>

      {/* Quick Navigation */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground mr-2">Quick Jump:</span>
        {displayJobs.slice(0, 20).map((job, idx) => (
          <Button
            key={job.job_id}
            variant={idx === currentIndex ? "default" : "outline"}
            size="sm"
            onClick={() => setCurrentIndex(idx)}
            className={`text-xs ${markedJobs.has(job.video_number) ? "border-yellow-500/50" : ""}`}
          >
            {markedJobs.has(job.video_number) && <Star className="h-3 w-3 mr-1 fill-yellow-400 text-yellow-400" />}
            V{job.video_number}
          </Button>
        ))}
        {displayJobs.length > 20 && (
          <span className="text-sm text-muted-foreground">+{displayJobs.length - 20} more</span>
        )}
      </div>

      {/* Empty state for marked filter */}
      {showMarkedOnly && displayJobs.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          No marked jobs. Mark jobs with the star button!
        </div>
      )}
    </div>
  )
}
