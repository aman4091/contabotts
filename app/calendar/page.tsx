"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  FileAudio,
  Video,
  Check,
  Calendar as CalendarIcon,
  Loader2,
  Trash2
} from "lucide-react"
import { useRouter } from "next/navigation"

interface Slot {
  slotNumber: number
  date: string
  channelCode: string
  hasTranscript: boolean
  hasScript: boolean
  hasAudio: boolean
  hasVideo: boolean
  isCompleted: boolean
  path: string
}

interface TargetChannel {
  channel_code: string
  channel_name: string
  is_active: boolean
}

export default function CalendarPage() {
  const router = useRouter()
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedChannel, setSelectedChannel] = useState<string>("")
  const [targetChannels, setTargetChannels] = useState<TargetChannel[]>([])
  const [slots, setSlots] = useState<Slot[]>([])
  const [todaySlots, setTodaySlots] = useState<Slot[]>([])
  const [todayChannel, setTodayChannel] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const [datesWithData, setDatesWithData] = useState<string[]>([])
  const [deleting, setDeleting] = useState<string | null>(null)

  const today = new Date().toISOString().split("T")[0]

  useEffect(() => {
    loadTargetChannels()
    loadDatesWithData()
  }, [])

  useEffect(() => {
    if (targetChannels.length > 0 && !todayChannel) {
      setTodayChannel(targetChannels[0].channel_code)
    }
  }, [targetChannels])

  useEffect(() => {
    if (todayChannel) {
      loadTodaySlots()
    }
  }, [todayChannel])

  useEffect(() => {
    if (selectedDate && selectedChannel) {
      loadSlots(selectedDate, selectedChannel)
    }
  }, [selectedDate, selectedChannel])

  async function loadTargetChannels() {
    try {
      const res = await fetch("/api/target-channels")
      const data = await res.json()
      setTargetChannels(data.channels || [])
    } catch (error) {
      console.error("Error loading channels:", error)
    }
  }

  async function loadDatesWithData() {
    try {
      const res = await fetch("/api/calendar", { method: "OPTIONS" })
      const data = await res.json()
      setDatesWithData(data.dates || [])
    } catch (error) {
      console.error("Error loading dates:", error)
    }
  }

  async function loadTodaySlots() {
    try {
      const res = await fetch(`/api/calendar?date=${today}&channel=${todayChannel}`)
      const data = await res.json()
      setTodaySlots(data.slots || [])
    } catch (error) {
      console.error("Error loading today slots:", error)
    }
  }

  async function loadSlots(date: string, channel: string) {
    setLoading(true)
    try {
      const res = await fetch(`/api/calendar?date=${date}&channel=${channel}`)
      const data = await res.json()
      setSlots(data.slots || [])
    } catch (error) {
      console.error("Error loading slots:", error)
      toast.error("Failed to load slots")
    } finally {
      setLoading(false)
    }
  }

  async function toggleComplete(slot: Slot, isToday: boolean = false) {
    try {
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: slot.date,
          channelCode: slot.channelCode,
          slotNumber: slot.slotNumber,
          completed: !slot.isCompleted
        })
      })

      if (res.ok) {
        if (isToday) {
          loadTodaySlots()
        } else {
          loadSlots(slot.date, slot.channelCode)
        }
        toast.success(slot.isCompleted ? "Unmarked" : "Marked as completed")
      }
    } catch (error) {
      toast.error("Failed to update")
    }
  }

  function downloadFile(slot: Slot, fileType: string) {
    const url = `/api/calendar/download?date=${slot.date}&channel=${slot.channelCode}&slot=${slot.slotNumber}&file=${fileType}`
    window.open(url, "_blank")
  }

  async function deleteSlot(slot: Slot) {
    if (!confirm(`Delete Slot ${slot.slotNumber} for ${slot.channelCode} on ${slot.date}?\n\nThis will delete all files (transcript, script, audio, video).`)) {
      return
    }

    const slotKey = `${slot.date}_${slot.channelCode}_${slot.slotNumber}`
    setDeleting(slotKey)

    try {
      const res = await fetch(
        `/api/calendar?date=${slot.date}&channel=${slot.channelCode}&slot=${slot.slotNumber}`,
        { method: "DELETE" }
      )

      if (res.ok) {
        toast.success("Slot deleted! Redirecting to Process page...")
        // Redirect to process page with channel pre-selected and priority flag
        router.push(`/?channel=${slot.channelCode}&priority=true&date=${slot.date}&slot=${slot.slotNumber}`)
      } else {
        const data = await res.json()
        toast.error(data.error || "Failed to delete slot")
      }
    } catch (error) {
      toast.error("Failed to delete slot")
    } finally {
      setDeleting(null)
    }
  }

  // Calendar generation
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startPadding = firstDay.getDay()
  const totalDays = lastDay.getDate()

  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"]

  const days = []
  for (let i = 0; i < startPadding; i++) {
    days.push(null)
  }
  for (let i = 1; i <= totalDays; i++) {
    days.push(i)
  }

  function getDateString(day: number): string {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  }

  function hasDataForDate(day: number): boolean {
    return datesWithData.includes(getDateString(day))
  }

  function SlotCard({ slot, isToday = false }: { slot: Slot; isToday?: boolean }) {
    const hasAnyFile = slot.hasTranscript || slot.hasScript || slot.hasAudio || slot.hasVideo

    return (
      <div
        className={`p-4 rounded-lg border transition-all ${
          slot.isCompleted
            ? "bg-zinc-900/80 border-zinc-700 opacity-60"
            : "bg-zinc-800/50 border-zinc-700 hover:border-zinc-600"
        }`}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Badge variant={slot.isCompleted ? "secondary" : "default"} className="text-xs">
              Slot {slot.slotNumber}
            </Badge>
            {slot.isCompleted && (
              <Badge variant="success" className="text-xs">
                <Check className="w-3 h-3 mr-1" />
                Uploaded
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant={slot.isCompleted ? "secondary" : "outline"}
              onClick={() => toggleComplete(slot, isToday)}
              className={slot.isCompleted ? "bg-green-600/20 text-green-400 hover:bg-green-600/30" : ""}
            >
              <Check className="w-4 h-4 mr-1" />
              {slot.isCompleted ? "Done" : "Mark"}
            </Button>
            {hasAnyFile && !slot.isCompleted && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => deleteSlot(slot)}
                disabled={deleting === `${slot.date}_${slot.channelCode}_${slot.slotNumber}`}
                className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
              >
                {deleting === `${slot.date}_${slot.channelCode}_${slot.slotNumber}` ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {/* Transcript */}
          <Button
            size="sm"
            variant="ghost"
            disabled={!slot.hasTranscript || slot.isCompleted}
            onClick={() => downloadFile(slot, "transcript")}
            className="justify-start text-xs h-9"
          >
            <FileText className="w-4 h-4 mr-2 text-blue-400" />
            Transcript
            {slot.hasTranscript && <Download className="w-3 h-3 ml-auto" />}
          </Button>

          {/* Script */}
          <Button
            size="sm"
            variant="ghost"
            disabled={!slot.hasScript || slot.isCompleted}
            onClick={() => downloadFile(slot, "script")}
            className="justify-start text-xs h-9"
          >
            <FileText className="w-4 h-4 mr-2 text-purple-400" />
            Script
            {slot.hasScript && <Download className="w-3 h-3 ml-auto" />}
          </Button>

          {/* Audio */}
          <Button
            size="sm"
            variant="ghost"
            disabled={!slot.hasAudio || slot.isCompleted}
            onClick={() => downloadFile(slot, "audio")}
            className="justify-start text-xs h-9"
          >
            <FileAudio className="w-4 h-4 mr-2 text-green-400" />
            Audio
            {slot.hasAudio && <Download className="w-3 h-3 ml-auto" />}
          </Button>

          {/* Video */}
          <Button
            size="sm"
            variant="ghost"
            disabled={!slot.hasVideo || slot.isCompleted}
            onClick={() => downloadFile(slot, "video")}
            className="justify-start text-xs h-9"
          >
            <Video className="w-4 h-4 mr-2 text-red-400" />
            Video
            {slot.hasVideo && <Download className="w-3 h-3 ml-auto" />}
          </Button>
        </div>

        {!hasAnyFile && !slot.isCompleted && (
          <p className="text-xs text-muted-foreground mt-2 text-center">No files yet</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold gradient-text">Calendar</h1>
        <p className="text-muted-foreground text-sm mt-1">View and download organized content by date</p>
      </div>

      {/* Today's Slots */}
      <Card className="glass border-white/10">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <CalendarIcon className="w-5 h-5 text-cyan-400" />
              Today - {today}
            </CardTitle>
            <Select value={todayChannel} onValueChange={setTodayChannel}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Select channel" />
              </SelectTrigger>
              <SelectContent>
                {targetChannels.map(ch => (
                  <SelectItem key={ch.channel_code} value={ch.channel_code}>
                    {ch.channel_name} ({ch.channel_code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {todaySlots.map(slot => (
              <SlotCard key={slot.slotNumber} slot={slot} isToday />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Calendar */}
      <Card className="glass border-white/10">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" onClick={() => setCurrentDate(new Date(year, month - 1))}>
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <CardTitle className="text-lg">
              {monthNames[month]} {year}
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={() => setCurrentDate(new Date(year, month + 1))}>
              <ChevronRight className="w-5 h-5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => (
              <div key={day} className="text-center text-xs text-muted-foreground py-2">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {days.map((day, idx) => {
              if (day === null) {
                return <div key={idx} className="aspect-square" />
              }

              const dateStr = getDateString(day)
              const isToday = dateStr === today
              const isSelected = dateStr === selectedDate
              const hasData = hasDataForDate(day)

              return (
                <button
                  key={idx}
                  onClick={() => {
                    setSelectedDate(dateStr)
                    if (targetChannels.length > 0) {
                      setSelectedChannel(targetChannels[0].channel_code)
                    }
                  }}
                  className={`
                    aspect-square rounded-lg text-sm font-medium transition-all
                    flex flex-col items-center justify-center gap-1
                    ${isToday ? "ring-2 ring-cyan-500" : ""}
                    ${isSelected ? "bg-violet-600 text-white" : "hover:bg-zinc-800"}
                    ${hasData && !isSelected ? "bg-zinc-800/50" : ""}
                  `}
                >
                  {day}
                  {hasData && (
                    <div className={`w-1.5 h-1.5 rounded-full ${isSelected ? "bg-white" : "bg-cyan-400"}`} />
                  )}
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Selected Date Slots */}
      {selectedDate && (
        <Card className="glass border-white/10">
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <CardTitle className="text-lg">{selectedDate}</CardTitle>
              <Select value={selectedChannel} onValueChange={setSelectedChannel}>
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue placeholder="Select channel" />
                </SelectTrigger>
                <SelectContent>
                  {targetChannels.map(ch => (
                    <SelectItem key={ch.channel_code} value={ch.channel_code}>
                      {ch.channel_name} ({ch.channel_code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {slots.map(slot => (
                  <SlotCard key={slot.slotNumber} slot={slot} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
