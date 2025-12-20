import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

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

const QUEUE_DIR = "/root/tts/data/audio-queue"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const username = searchParams.get("username")
    const status = searchParams.get("status") // optional filter

    const allJobs: Job[] = []
    const statuses = status ? [status] : ["pending", "processing", "completed", "failed", "paused"]

    for (const statusDir of statuses) {
      const dirPath = path.join(QUEUE_DIR, statusDir)
      if (!fs.existsSync(dirPath)) continue

      const files = fs.readdirSync(dirPath).filter(f => f.endsWith(".json"))

      for (const file of files) {
        try {
          const filePath = path.join(dirPath, file)
          const content = fs.readFileSync(filePath, "utf-8")
          const job = JSON.parse(content)

          // Filter by username if provided
          if (username && job.username !== username) continue

          allJobs.push({
            job_id: job.job_id,
            script_text: job.script_text || "",
            channel_code: job.channel_code || "",
            video_number: job.video_number || 0,
            date: job.date || "",
            username: job.username || "",
            reference_audio: job.reference_audio || "",
            status: statusDir,
            gofile_link: job.gofile_link || "",
            gofile_audio_link: job.gofile_audio_link || "",
            created_at: job.created_at || "",
            completed_at: job.completed_at || ""
          })
        } catch (e) {
          console.error(`Error reading job file ${file}:`, e)
        }
      }
    }

    // Sort by video_number descending (newest first)
    allJobs.sort((a, b) => b.video_number - a.video_number)

    return NextResponse.json({
      jobs: allJobs,
      total: allJobs.length
    })
  } catch (error) {
    console.error("Error fetching jobs:", error)
    return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 })
  }
}
