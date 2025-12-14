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

// Get job details from file server
async function getJobDetails(jobId: string): Promise<any | null> {
  try {
    // Check all statuses to find the job
    const statuses = ["pending", "processing", "completed", "failed", "paused"]

    for (const status of statuses) {
      const response = await fetch(`${FILE_SERVER_URL}/queue/audio/jobs?status=${status}`, {
        headers: { "x-api-key": FILE_SERVER_API_KEY },
        cache: "no-store"
      })

      if (response.ok) {
        const data = await response.json()
        const job = (data.jobs || []).find((j: any) => j.job_id === jobId)
        if (job) {
          return { ...job, status }
        }
      }
    }

    return null
  } catch (error) {
    console.error("Error fetching job:", error)
    return null
  }
}

export async function GET(request: NextRequest) {
  try {
    const username = await getUser()
    const { searchParams } = new URL(request.url)
    const jobId = searchParams.get("job_id")
    const fileType = searchParams.get("type") // "script" or "transcript"

    if (!jobId || !fileType) {
      return NextResponse.json({ error: "job_id and type required" }, { status: 400 })
    }

    if (fileType !== "script" && fileType !== "transcript") {
      return NextResponse.json({ error: "type must be 'script' or 'transcript'" }, { status: 400 })
    }

    // Get job details
    const job = await getJobDetails(jobId)
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 })
    }

    // Check if user has access to this job
    if (username && job.username && job.username !== username) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    // For script, check if script_text is available in job data (pending jobs)
    if (fileType === "script" && job.script_text) {
      return new NextResponse(job.script_text, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="video_${job.video_number}_script.txt"`
        }
      })
    }

    // Build file path
    const fileName = fileType === "script" ? "script.txt" : "transcript.txt"

    // Try local first (for backward compatibility)
    const localPath = path.join(DATA_DIR, "users", job.username || "default", job.organized_path || "", fileName)

    if (fs.existsSync(localPath)) {
      const content = fs.readFileSync(localPath, "utf-8")
      return new NextResponse(content, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="video_${job.video_number}_${fileType}.txt"`
        }
      })
    }

    // Try fetching from file server
    const remotePath = `users/${job.username || "default"}${job.organized_path || ""}/${fileName}`
    const response = await fetch(`${FILE_SERVER_URL}/files/${remotePath}`, {
      headers: { "x-api-key": FILE_SERVER_API_KEY }
    })

    if (response.ok) {
      const content = await response.text()
      return new NextResponse(content, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="video_${job.video_number}_${fileType}.txt"`
        }
      })
    }

    return NextResponse.json({ error: `${fileType} file not found` }, { status: 404 })
  } catch (error) {
    console.error("Error downloading file:", error)
    return NextResponse.json({ error: "Failed to download file" }, { status: 500 })
  }
}
