import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"
const FILE_SERVER_URL = process.env.FILE_SERVER_URL || ""
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || ""

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

interface CompletedVideo {
  videoId: string
  title: string
  videoNumber: number
  folderName: string
  jobId: string
  processedAt: string
  gofileLink?: string
  status?: string
}

// GET - List completed videos for a channel
export async function GET(request: NextRequest) {
  try {
    const username = await getUser()
    if (!username) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const channelId = searchParams.get("channelId")

    if (!channelId) {
      return NextResponse.json({ error: "Channel ID required" }, { status: 400 })
    }

    const completedDir = path.join(DATA_DIR, "users", username, "channel-automation", channelId, "completed")

    if (!fs.existsSync(completedDir)) {
      return NextResponse.json({ completed: [] })
    }

    const files = fs.readdirSync(completedDir).filter(f => f.endsWith(".json"))
    const completed: CompletedVideo[] = []

    // Get job statuses from file server
    let jobStatuses: Map<string, { status: string; gofile_link?: string }> = new Map()
    try {
      const res = await fetch(`${FILE_SERVER_URL}/queue/audio/jobs?username=${username}`, {
        headers: { "x-api-key": FILE_SERVER_API_KEY }
      })
      if (res.ok) {
        const data = await res.json()
        if (data.jobs) {
          for (const job of data.jobs) {
            jobStatuses.set(job.job_id, {
              status: job.status,
              gofile_link: job.gofile_link
            })
          }
        }
      }
    } catch (error) {
      console.error("Error fetching job statuses:", error)
    }

    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(completedDir, file), "utf-8"))
        const jobStatus = jobStatuses.get(data.jobId)

        completed.push({
          ...data,
          status: jobStatus?.status || "unknown",
          gofileLink: jobStatus?.gofile_link
        })
      } catch {}
    }

    // Sort by processedAt descending
    completed.sort((a, b) => new Date(b.processedAt).getTime() - new Date(a.processedAt).getTime())

    return NextResponse.json({ completed })
  } catch (error) {
    console.error("Error getting completed videos:", error)
    return NextResponse.json({ error: "Failed to get completed videos" }, { status: 500 })
  }
}
