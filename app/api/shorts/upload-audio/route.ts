import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { randomUUID } from "crypto"

const FILE_SERVER_URL = process.env.FILE_SERVER_URL || ""
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || ""

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

export async function POST(request: NextRequest) {
  try {
    const username = await getUser()
    if (!username) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const formData = await request.formData()
    const audioFile = formData.get("audio") as File
    const scriptText = (formData.get("script") as string) || "" // Optional

    if (!audioFile) {
      return NextResponse.json({ error: "Audio file is required" }, { status: 400 })
    }

    // Generate unique job ID and short number
    const jobId = randomUUID()
    const shortNumber = Date.now() % 100000

    // Upload audio to file server
    const audioFilename = `short_${shortNumber}_${jobId.slice(0, 8)}.mp3`
    const audioPath = `shorts-audio/${audioFilename}`

    const uploadFormData = new FormData()
    uploadFormData.append("file", audioFile, audioFilename)

    const uploadRes = await fetch(`${FILE_SERVER_URL}/files/${audioPath}`, {
      method: "POST",
      headers: {
        "x-api-key": FILE_SERVER_API_KEY
      },
      body: uploadFormData
    })

    if (!uploadRes.ok) {
      return NextResponse.json({ error: "Failed to upload audio file" }, { status: 500 })
    }

    // Create audio link URL
    const audioLink = `${FILE_SERVER_URL}/files/${audioPath}`

    // Create shorts job with audio link
    const jobRes = await fetch(`${FILE_SERVER_URL}/queue/audio/jobs`, {
      method: "POST",
      headers: {
        "x-api-key": FILE_SERVER_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        job_id: jobId,
        script_text: scriptText.trim(),
        channel_code: "SHORTS",
        video_number: shortNumber,
        date: new Date().toISOString().split("T")[0],
        audio_counter: shortNumber,
        organized_path: `/shorts/upload_${shortNumber}`,
        priority: 5, // Higher priority for manual uploads
        username: username,
        is_short: true,
        source_video: "MP3 Upload",
        short_number: shortNumber,
        use_ai_image: true,
        image_folder: "shorts",
        existing_audio_link: audioLink // Audio already uploaded
      })
    })

    if (!jobRes.ok) {
      return NextResponse.json({ error: "Failed to create job" }, { status: 500 })
    }

    console.log(`Created shorts job ${jobId} with uploaded audio for ${username}`)

    return NextResponse.json({
      success: true,
      job_id: jobId,
      short_number: shortNumber,
      message: "Short queued with AI image!"
    })

  } catch (error) {
    console.error("Upload audio error:", error)
    return NextResponse.json({ error: "Failed to process upload" }, { status: 500 })
  }
}
