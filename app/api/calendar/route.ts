import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"
const FILE_SERVER_URL = process.env.FILE_SERVER_URL || "http://38.242.144.132:8000"
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || "tts-secret-key-2024"

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

function getUserCompletedFile(username?: string): string {
  if (username) {
    return path.join(DATA_DIR, "users", username, "completed-slots.json")
  }
  return path.join(DATA_DIR, "completed-slots.json")
}

function getCompletedSlots(username?: string): Record<string, boolean> {
  const filePath = getUserCompletedFile(username)
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"))
  }
  return {}
}

function saveCompletedSlots(slots: Record<string, boolean>, username?: string): void {
  const filePath = getUserCompletedFile(username)
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(filePath, JSON.stringify(slots, null, 2))
}

// Get gofile_link from audio jobs for a specific date/channel/slot
async function getGofileLink(date: string, channelCode: string, slotNumber: number, username?: string): Promise<string | null> {
  try {
    // First check local audio queue
    const completedDir = path.join(DATA_DIR, "audio-queue", "completed")
    if (fs.existsSync(completedDir)) {
      const files = fs.readdirSync(completedDir)
      for (const file of files) {
        if (file.endsWith(".json")) {
          const jobPath = path.join(completedDir, file)
          const job = JSON.parse(fs.readFileSync(jobPath, "utf-8"))
          if (job.date === date && job.channel_code === channelCode && job.video_number === slotNumber) {
            if (!username || job.username === username) {
              return job.gofile_link || null
            }
          }
        }
      }
    }

    // Fallback: try file server API
    const res = await fetch(`${FILE_SERVER_URL}/queue/audio/jobs?date=${date}&channel=${channelCode}&slot=${slotNumber}`, {
      headers: { "x-api-key": FILE_SERVER_API_KEY }
    })
    if (res.ok) {
      const data = await res.json()
      if (data.job && data.job.gofile_link) {
        return data.job.gofile_link
      }
    }
    return null
  } catch (error) {
    console.error("Error getting gofile link:", error)
    return null
  }
}

// GET - Get slots for a date and channel
export async function GET(request: NextRequest) {
  try {
    const username = await getUser()
    const { searchParams } = new URL(request.url)
    const date = searchParams.get("date")
    const channelCode = searchParams.get("channel")

    if (!date) {
      return NextResponse.json({ error: "Date required" }, { status: 400 })
    }

    const organizedDir = path.join(DATA_DIR, "organized", date)
    const completedSlots = getCompletedSlots(username)

    // If channel specified, get slots for that channel
    if (channelCode) {
      const channelDir = path.join(organizedDir, channelCode)
      const slots = []

      if (fs.existsSync(channelDir)) {
        const videoDirs = fs.readdirSync(channelDir)
          .filter(d => d.startsWith("video_"))
          .sort((a, b) => {
            const numA = parseInt(a.split("_")[1])
            const numB = parseInt(b.split("_")[1])
            return numA - numB
          })

        for (const videoDir of videoDirs) {
          const slotPath = path.join(channelDir, videoDir)
          const slotNum = parseInt(videoDir.split("_")[1])
          const slotKey = `${date}_${channelCode}_${slotNum}`

          // Get gofile link for this slot
          const gofileLink = await getGofileLink(date, channelCode, slotNum, username)

          const slot = {
            slotNumber: slotNum,
            date,
            channelCode,
            hasTranscript: fs.existsSync(path.join(slotPath, "transcript.txt")),
            hasScript: fs.existsSync(path.join(slotPath, "script.txt")),
            hasAudio: !!gofileLink, // Audio available if gofile link exists
            hasVideo: !!gofileLink, // Video available if gofile link exists
            isCompleted: completedSlots[slotKey] || false,
            path: `/organized/${date}/${channelCode}/${videoDir}`,
            gofileLink: gofileLink
          }
          slots.push(slot)
        }
      }

      // Always return 4 slots
      while (slots.length < 4) {
        const slotNum: number = slots.length + 1
        const slotKey = `${date}_${channelCode}_${slotNum}`
        const gofileLink = await getGofileLink(date, channelCode, slotNum, username)

        slots.push({
          slotNumber: slotNum,
          date,
          channelCode,
          hasTranscript: false,
          hasScript: false,
          hasAudio: !!gofileLink,
          hasVideo: !!gofileLink,
          isCompleted: completedSlots[slotKey] || false,
          path: `/organized/${date}/${channelCode}/video_${slotNum}`,
          gofileLink: gofileLink
        })
      }

      return NextResponse.json({ slots: slots.slice(0, 4) })
    }

    // No channel specified - return available channels for date
    const channels: string[] = []
    if (fs.existsSync(organizedDir)) {
      const dirs = fs.readdirSync(organizedDir)
      for (const dir of dirs) {
        const stat = fs.statSync(path.join(organizedDir, dir))
        if (stat.isDirectory()) {
          channels.push(dir)
        }
      }
    }

    return NextResponse.json({ channels })
  } catch (error) {
    console.error("Calendar API error:", error)
    return NextResponse.json({ error: "Failed to get calendar data" }, { status: 500 })
  }
}

// POST - Mark slot as completed/uncompleted
export async function POST(request: NextRequest) {
  try {
    const username = await getUser()
    const body = await request.json()
    const { date, channelCode, slotNumber, completed } = body

    if (!date || !channelCode || !slotNumber) {
      return NextResponse.json({ error: "Date, channel and slot number required" }, { status: 400 })
    }

    const completedSlots = getCompletedSlots(username)
    const slotKey = `${date}_${channelCode}_${slotNumber}`

    if (completed) {
      completedSlots[slotKey] = true
    } else {
      delete completedSlots[slotKey]
    }

    saveCompletedSlots(completedSlots, username)

    return NextResponse.json({ success: true, slotKey, completed })
  } catch (error) {
    console.error("Calendar POST error:", error)
    return NextResponse.json({ error: "Failed to update slot" }, { status: 500 })
  }
}

// DELETE - Delete a slot folder
export async function DELETE(request: NextRequest) {
  try {
    const username = await getUser()
    const { searchParams } = new URL(request.url)
    const date = searchParams.get("date")
    const channelCode = searchParams.get("channel")
    const slotNumber = searchParams.get("slot")

    if (!date || !channelCode || !slotNumber) {
      return NextResponse.json({ error: "Date, channel and slot required" }, { status: 400 })
    }

    const slotPath = path.join(DATA_DIR, "organized", date, channelCode, `video_${slotNumber}`)

    if (!fs.existsSync(slotPath)) {
      return NextResponse.json({ error: "Slot not found" }, { status: 404 })
    }

    // Delete all files in the slot folder
    const files = fs.readdirSync(slotPath)
    for (const file of files) {
      fs.unlinkSync(path.join(slotPath, file))
    }
    // Delete the folder itself
    fs.rmdirSync(slotPath)

    // Also remove from completed slots
    const completedSlots = getCompletedSlots(username)
    const slotKey = `${date}_${channelCode}_${slotNumber}`
    if (completedSlots[slotKey]) {
      delete completedSlots[slotKey]
      saveCompletedSlots(completedSlots, username)
    }

    return NextResponse.json({
      success: true,
      message: "Slot deleted",
      redirectTo: "/?channel=" + channelCode + "&priority=true&date=" + date + "&slot=" + slotNumber
    })
  } catch (error) {
    console.error("Delete slot error:", error)
    return NextResponse.json({ error: "Failed to delete slot" }, { status: 500 })
  }
}

// GET dates that have data
export async function OPTIONS(request: NextRequest) {
  try {
    const organizedDir = path.join(DATA_DIR, "organized")
    const dates: string[] = []

    if (fs.existsSync(organizedDir)) {
      const dirs = fs.readdirSync(organizedDir)
      for (const dir of dirs) {
        // Check if it's a date format (YYYY-MM-DD)
        if (/^\d{4}-\d{2}-\d{2}$/.test(dir)) {
          dates.push(dir)
        }
      }
    }

    return NextResponse.json({ dates: dates.sort() })
  } catch (error) {
    return NextResponse.json({ error: "Failed to get dates" }, { status: 500 })
  }
}
