import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { randomUUID } from "crypto"
import {
  saveToOrganized,
  getNextVideoNumber,
  completeTranscript,
  getTranscript,
  getTargetChannels
} from "@/lib/file-storage"
import { getTomorrowDate, addDays } from "@/lib/utils"

const FILE_SERVER_URL = process.env.FILE_SERVER_URL || ""
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || ""

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

const MAX_VIDEOS_PER_DAY = 4

async function createFinalBotJob(job: {
  job_id: string
  script_text: string
  channel_code: string
  video_number: number
  date: string
  organized_path: string
  priority: number
  username?: string
  image_folder?: string
}): Promise<{ success: boolean; job_id?: string; error?: string }> {
  try {
    const response = await fetch(`${FILE_SERVER_URL}/finalbot/jobs`, {
      method: "POST",
      headers: {
        "x-api-key": FILE_SERVER_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(job)
    })

    if (response.ok) {
      const data = await response.json()
      return { success: true, job_id: data.job_id }
    }

    return { success: false, error: "Failed to create FinalBot job" }
  } catch (error) {
    console.error("Create FinalBot job error:", error)
    return { success: false, error: String(error) }
  }
}

export async function POST(request: NextRequest) {
  try {
    const username = await getUser()
    const body = await request.json()
    const {
      script,
      transcript,
      targetChannel,
      sourceChannel,
      transcriptIndex,
      date: customDate,
      slot: customSlot,
      priority: customPriority
    } = body

    if (!script || !targetChannel) {
      return NextResponse.json({ error: "Script and target channel required" }, { status: 400 })
    }

    // Priority mode: use exact date and slot
    let date: string
    let videoNumber: number

    if (customDate && customSlot) {
      date = customDate
      videoNumber = parseInt(customSlot)
    } else {
      // Find next available slot
      date = customDate || getTomorrowDate()
      videoNumber = getNextVideoNumber(date, targetChannel)
      let daysChecked = 0
      const maxDaysAhead = 30

      while (videoNumber > MAX_VIDEOS_PER_DAY && daysChecked < maxDaysAhead) {
        daysChecked++
        date = addDays(getTomorrowDate(), daysChecked)
        videoNumber = getNextVideoNumber(date, targetChannel)
      }

      if (videoNumber > MAX_VIDEOS_PER_DAY) {
        return NextResponse.json({ error: `No available slots for ${targetChannel} in next ${maxDaysAhead} days` }, { status: 400 })
      }
    }

    // Create organized folder and save files
    const organizedPath = `/organized/${date}/${targetChannel}/video_${videoNumber}`

    // Get full transcript content if not provided
    let fullTranscript = transcript
    if (!fullTranscript && sourceChannel && transcriptIndex) {
      fullTranscript = getTranscript(sourceChannel, transcriptIndex, username) || ""
    }

    // Save to organized folder
    saveToOrganized(date, targetChannel, videoNumber, fullTranscript, script)

    // Priority: 10 for replacement jobs, 5 for manual jobs
    const jobPriority = customPriority ? parseInt(customPriority) : (customSlot ? 10 : 5)

    // Get target channel's config
    const targetChannels = getTargetChannels(username)
    const targetChannelConfig = targetChannels.find(c => c.channel_code === targetChannel)
    const imageFolder = targetChannelConfig?.image_folder || undefined

    // Create FinalBot job
    const jobId = randomUUID()
    const result = await createFinalBotJob({
      job_id: jobId,
      script_text: script,
      channel_code: targetChannel,
      video_number: videoNumber,
      date: date,
      organized_path: organizedPath,
      priority: jobPriority,
      username: username,
      image_folder: imageFolder
    })

    if (!result.success) {
      console.error("FinalBot job creation error:", result.error)
      return NextResponse.json({ error: "Failed to create FinalBot job" }, { status: 500 })
    }

    // Move transcript to completed folder
    if (sourceChannel && transcriptIndex) {
      completeTranscript(sourceChannel, transcriptIndex, username)
    }

    return NextResponse.json({
      success: true,
      jobId: result.job_id,
      channelCode: targetChannel,
      videoNumber: videoNumber,
      date: date,
      organizedPath: organizedPath,
      mode: "finalbot"
    })
  } catch (error) {
    console.error("Error creating FinalBot job:", error)
    return NextResponse.json({ error: "Failed to create FinalBot job" }, { status: 500 })
  }
}

export async function GET() {
  try {
    const response = await fetch(`${FILE_SERVER_URL}/finalbot/stats`, {
      headers: { "x-api-key": FILE_SERVER_API_KEY }
    })

    if (response.ok) {
      return NextResponse.json(await response.json())
    }

    return NextResponse.json({ pending: 0, processing: 0, completed: 0, failed: 0 })
  } catch (error) {
    console.error("FinalBot stats error:", error)
    return NextResponse.json({ error: "Failed to get stats" }, { status: 500 })
  }
}
