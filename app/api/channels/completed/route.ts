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

    const completedPath = path.join(DATA_DIR, "users", username, "channel-automation", channelId, "completed.json")

    if (!fs.existsSync(completedPath)) {
      return NextResponse.json({ completed: [] })
    }

    let completedVideos: CompletedVideo[] = []
    try {
      completedVideos = JSON.parse(fs.readFileSync(completedPath, "utf-8"))
    } catch {
      return NextResponse.json({ completed: [] })
    }

    // Get job statuses from file server (fetch all statuses)
    // Store by both job_id and folderName (for jobs added with video_XXX-timestamp format)
    let jobStatusesById: Map<string, { status: string; gofile_link?: string }> = new Map()
    let jobStatusesByFolder: Map<string, { status: string; gofile_link?: string }> = new Map()
    try {
      const statuses = ["pending", "processing", "completed", "failed"]
      const responses = await Promise.all(
        statuses.map(status =>
          fetch(`${FILE_SERVER_URL}/queue/audio/jobs?status=${status}`, {
            headers: { "x-api-key": FILE_SERVER_API_KEY },
            cache: "no-store"
          })
        )
      )

      for (let i = 0; i < responses.length; i++) {
        if (responses[i].ok) {
          const data = await responses[i].json()
          for (const job of data.jobs || []) {
            if (job.username === username) {
              const statusInfo = {
                status: statuses[i],
                gofile_link: job.gofile_link
              }
              jobStatusesById.set(job.job_id, statusInfo)

              // Also index by folder name (extract from job_id like "video_272-timestamp" or from organized_path)
              if (job.job_id && job.job_id.startsWith("video_")) {
                const folderName = job.job_id.split("-")[0]
                jobStatusesByFolder.set(folderName, statusInfo)
              }
              if (job.organized_path) {
                const folderName = job.organized_path.split("/").pop()
                if (folderName) jobStatusesByFolder.set(folderName, statusInfo)
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Error fetching job statuses:", error)
    }

    const completed: CompletedVideo[] = completedVideos.map(video => {
      // Try to find status by jobId first, then by folderName
      const jobStatus = jobStatusesById.get(video.jobId) || jobStatusesByFolder.get(video.folderName)
      return {
        ...video,
        status: jobStatus?.status || video.status || "pending",
        gofileLink: jobStatus?.gofile_link
      }
    })

    // Sort by processedAt descending
    completed.sort((a, b) => new Date(b.processedAt).getTime() - new Date(a.processedAt).getTime())

    return NextResponse.json({ completed })
  } catch (error) {
    console.error("Error getting completed videos:", error)
    return NextResponse.json({ error: "Failed to get completed videos" }, { status: 500 })
  }
}
