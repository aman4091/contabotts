import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"

const FILE_SERVER_URL = process.env.FILE_SERVER_URL || ""
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || ""

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

export async function GET(request: NextRequest) {
  try {
    const username = await getUser()

    // Fetch all shorts jobs from file server (filter by is_short=true)
    const statuses = ["pending", "processing", "completed", "failed"]
    const allJobs: any[] = []

    for (const status of statuses) {
      try {
        // Shorts are in video queue with is_short=true
        const videoRes = await fetch(`${FILE_SERVER_URL}/queue/video/jobs?status=${status}`, {
          headers: { "x-api-key": FILE_SERVER_API_KEY },
          cache: "no-store"
        })

        if (videoRes.ok) {
          const data = await videoRes.json()
          // Filter for shorts only
          const shortsJobs = (data.jobs || [])
            .filter((job: any) => job.is_short === true)
            .map((job: any) => ({
              ...job,
              status
            }))
          allJobs.push(...shortsJobs)
        }
      } catch (e) {
        console.error(`Error fetching ${status} shorts:`, e)
      }
    }

    // Filter by username
    const userJobs = username
      ? allJobs.filter(job => job.username === username)
      : allJobs

    // Sort by created_at desc
    userJobs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    return NextResponse.json({
      success: true,
      jobs: userJobs
    })
  } catch (error) {
    console.error("Error fetching shorts:", error)
    return NextResponse.json({ error: "Failed to fetch shorts" }, { status: 500 })
  }
}
