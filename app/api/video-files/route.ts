import { NextRequest, NextResponse } from "next/server"

const FILE_SERVER_URL = process.env.FILE_SERVER_URL || ""
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || ""

export async function GET(request: NextRequest) {
  try {
    // Fetch all statuses in parallel
    const statuses = ["pending", "processing", "completed", "failed"]
    const responses = await Promise.all(
      statuses.map(status =>
        fetch(`${FILE_SERVER_URL}/queue/video/jobs?status=${status}`, {
          headers: { "x-api-key": FILE_SERVER_API_KEY },
          cache: "no-store"
        })
      )
    )

    const allJobs: any[] = []
    for (let i = 0; i < responses.length; i++) {
      if (responses[i].ok) {
        const data = await responses[i].json()
        const jobs = (data.jobs || []).map((job: any) => ({
          ...job,
          status: statuses[i]
        }))
        allJobs.push(...jobs)
      }
    }

    // Sort by created_at desc
    allJobs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    return NextResponse.json({
      success: true,
      jobs: allJobs
    })
  } catch (error) {
    console.error("Error fetching video files:", error)
    return NextResponse.json({ error: "Failed to fetch video files" }, { status: 500 })
  }
}
