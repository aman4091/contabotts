import { NextRequest, NextResponse } from "next/server"
import { processShortsForAllUsers } from "@/lib/shorts-worker"

const CRON_SECRET = process.env.SHORTS_CRON_SECRET || "shorts-cron-secret-key"

export async function POST(request: NextRequest) {
  try {
    // Verify cron secret for security
    const cronSecret = request.headers.get("x-cron-secret")

    if (cronSecret !== CRON_SECRET) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    console.log("Shorts cron triggered via API")

    // Run the shorts processing
    await processShortsForAllUsers()

    return NextResponse.json({
      success: true,
      message: "Shorts processing completed",
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error("Shorts processing error:", error)
    return NextResponse.json(
      { error: "Processing failed", details: String(error) },
      { status: 500 }
    )
  }
}

// Also support GET for manual testing
export async function GET(request: NextRequest) {
  return NextResponse.json({
    message: "Use POST request with x-cron-secret header to trigger shorts processing",
    endpoint: "/api/shorts/process"
  })
}
