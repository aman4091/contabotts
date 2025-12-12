import { NextRequest, NextResponse } from "next/server"

const FILE_SERVER_URL = process.env.FILE_SERVER_URL || ""
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || ""

// PUT - Pause or Resume a job
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { queue_type = "audio", job_id, action } = body

    if (!job_id || !action) {
      return NextResponse.json({ error: "job_id and action required" }, { status: 400 })
    }

    if (action !== "pause" && action !== "resume") {
      return NextResponse.json({ error: "action must be 'pause' or 'resume'" }, { status: 400 })
    }

    const response = await fetch(
      `${FILE_SERVER_URL}/queue/${queue_type}/jobs/${job_id}/${action}`,
      {
        method: "POST",
        headers: {
          "x-api-key": FILE_SERVER_API_KEY
        }
      }
    )

    if (!response.ok) {
      const error = await response.text()
      return NextResponse.json({ error: error || `Failed to ${action} job` }, { status: 500 })
    }

    const data = await response.json()
    return NextResponse.json({ success: true, ...data })
  } catch (error) {
    console.error("Error pausing/resuming job:", error)
    return NextResponse.json({ error: "Failed to pause/resume job" }, { status: 500 })
  }
}

// DELETE - Remove job from queue (sets status to "cancelled")
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const queue_type = searchParams.get("queue_type") || "audio"
    const job_id = searchParams.get("job_id")

    if (!job_id) {
      return NextResponse.json({ error: "job_id required" }, { status: 400 })
    }

    // Set status to "failed" to remove from active queue
    const response = await fetch(
      `${FILE_SERVER_URL}/queue/${queue_type}/jobs/${job_id}/status`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": FILE_SERVER_API_KEY
        },
        body: JSON.stringify({ new_status: "failed", error_message: "Manually removed by user" })
      }
    )

    if (!response.ok) {
      const error = await response.text()
      return NextResponse.json({ error: error || "Failed to cancel job" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error cancelling job:", error)
    return NextResponse.json({ error: "Failed to cancel job" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { queue_type, job_id, new_status } = body

    if (!queue_type || !job_id || !new_status) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const response = await fetch(
      `${FILE_SERVER_URL}/queue/${queue_type}/jobs/${job_id}/status`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": FILE_SERVER_API_KEY
        },
        body: JSON.stringify({ new_status })
      }
    )

    if (!response.ok) {
      const error = await response.text()
      return NextResponse.json({ error: error || "Failed to update status" }, { status: 500 })
    }

    const data = await response.json()

    return NextResponse.json({
      success: true,
      ...data
    })
  } catch (error) {
    console.error("Error updating job status:", error)
    return NextResponse.json({ error: "Failed to update job status" }, { status: 500 })
  }
}

// PATCH - Update job fields (like existing_audio_link)
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { queue_type = "audio", job_id, existing_audio_link } = body

    if (!job_id) {
      return NextResponse.json({ error: "job_id required" }, { status: 400 })
    }

    // Update job with existing_audio_link
    const response = await fetch(
      `${FILE_SERVER_URL}/queue/${queue_type}/jobs/${job_id}/update`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": FILE_SERVER_API_KEY
        },
        body: JSON.stringify({ existing_audio_link })
      }
    )

    if (!response.ok) {
      const error = await response.text()
      return NextResponse.json({ error: error || "Failed to update job" }, { status: 500 })
    }

    const data = await response.json()
    return NextResponse.json({ success: true, ...data })
  } catch (error) {
    console.error("Error updating job:", error)
    return NextResponse.json({ error: "Failed to update job" }, { status: 500 })
  }
}
