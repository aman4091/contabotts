import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"
const FILE_SERVER_URL = process.env.FILE_SERVER_URL || ""
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || ""

export async function POST(request: NextRequest) {
  try {
    const { job_id, audio_counter, username } = await request.json()

    if (!job_id) {
      return NextResponse.json({ error: "job_id required" }, { status: 400 })
    }

    // Delete audio file from audio-ready folder if exists
    const audioReadyDir = path.join(DATA_DIR, "audio-ready", username || "default")
    if (fs.existsSync(audioReadyDir)) {
      const files = fs.readdirSync(audioReadyDir)
      // Look for files starting with the audio_counter
      for (const file of files) {
        if (file.startsWith(`${audio_counter}_`)) {
          const filePath = path.join(audioReadyDir, file)
          try {
            fs.unlinkSync(filePath)
            console.log(`Deleted audio file: ${filePath}`)
          } catch (err) {
            console.error(`Error deleting audio file: ${err}`)
          }
        }
      }
    }

    // Also check external-audio folder
    const externalAudioDir = path.join(DATA_DIR, "external-audio")
    if (fs.existsSync(externalAudioDir)) {
      const files = fs.readdirSync(externalAudioDir)
      for (const file of files) {
        if (file.startsWith(`${audio_counter}_`) || file.startsWith(`${audio_counter}.`)) {
          const filePath = path.join(externalAudioDir, file)
          try {
            fs.unlinkSync(filePath)
            console.log(`Deleted external audio file: ${filePath}`)
          } catch (err) {
            console.error(`Error deleting external audio file: ${err}`)
          }
        }
      }
    }

    // Mark job as completed on file server
    const response = await fetch(`${FILE_SERVER_URL}/queue/audio/jobs/${job_id}/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": FILE_SERVER_API_KEY
      },
      body: JSON.stringify({
        new_status: "completed"
      })
    })

    if (!response.ok) {
      return NextResponse.json({ error: "Failed to update job status" }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: "Job skipped and marked as completed" })
  } catch (error) {
    console.error("Error skipping job:", error)
    return NextResponse.json({ error: "Failed to skip job" }, { status: 500 })
  }
}
