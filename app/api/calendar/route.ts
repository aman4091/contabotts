import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"
const FILE_SERVER_URL = process.env.FILE_SERVER_URL || "http://38.242.144.132:8000"
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || "tts-secret-key-2024"

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value || "default"
}

function getUserOrganizedDir(username: string) {
  return path.join(DATA_DIR, "users", username, "organized")
}

function getUserDataDir(username: string) {
  return path.join(DATA_DIR, "users", username)
}

function getCompletedVideos(username: string): string[] {
  const filePath = path.join(getUserDataDir(username), "completed-videos.json")
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"))
    } catch {
      return []
    }
  }
  return []
}

function saveCompletedVideos(username: string, videos: string[]): void {
  const userDir = getUserDataDir(username)
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true })
  }
  const filePath = path.join(userDir, "completed-videos.json")
  fs.writeFileSync(filePath, JSON.stringify(videos, null, 2))
}

// GET - Get all organized videos
export async function GET(request: NextRequest) {
  try {
    const username = await getUser()
    const organizedDir = getUserOrganizedDir(username)
    const completedVideos = getCompletedVideos(username)
    const videos = []

    if (fs.existsSync(organizedDir)) {
      const dirs = fs.readdirSync(organizedDir)
        .filter(d => d.startsWith("video_"))
        .sort((a, b) => {
          const numA = parseInt(a.split("_")[1])
          const numB = parseInt(b.split("_")[1])
          return numA - numB
        })

      for (const dir of dirs) {
        const videoPath = path.join(organizedDir, dir)
        const stat = fs.statSync(videoPath)

        if (stat.isDirectory()) {
          const videoNum = parseInt(dir.split("_")[1])

          // Check for gofile link in completed audio jobs
          let gofileLink = null
          const completedDir = path.join(getUserDataDir(username), "audio-queue", "completed")
          if (fs.existsSync(completedDir)) {
            const jobFiles = fs.readdirSync(completedDir)
            for (const jobFile of jobFiles) {
              if (jobFile.endsWith(".json")) {
                try {
                  const job = JSON.parse(fs.readFileSync(path.join(completedDir, jobFile), "utf-8"))
                  if (job.organized_path === `/organized/${dir}` || job.video_number === videoNum) {
                    gofileLink = job.gofile_link || null
                    break
                  }
                } catch {}
              }
            }
          }

          videos.push({
            id: dir,
            videoNumber: videoNum,
            hasTranscript: fs.existsSync(path.join(videoPath, "transcript.txt")),
            hasScript: fs.existsSync(path.join(videoPath, "script.txt")),
            hasAudio: fs.existsSync(path.join(videoPath, "audio.wav")),
            hasVideo: !!gofileLink,
            hasThumbnail: fs.existsSync(path.join(videoPath, "thumbnail.png")) || fs.existsSync(path.join(videoPath, "thumbnail.jpg")),
            isCompleted: completedVideos.includes(dir),
            path: `/organized/${dir}`,
            gofileLink
          })
        }
      }
    }

    return NextResponse.json({ videos })
  } catch (error) {
    console.error("Calendar API error:", error)
    return NextResponse.json({ error: "Failed to get videos" }, { status: 500 })
  }
}

// POST - Mark video as completed/uncompleted
export async function POST(request: NextRequest) {
  try {
    const username = await getUser()
    const body = await request.json()
    const { videoId, completed } = body

    if (!videoId) {
      return NextResponse.json({ error: "videoId required" }, { status: 400 })
    }

    const completedVideos = getCompletedVideos(username)

    if (completed) {
      if (!completedVideos.includes(videoId)) {
        completedVideos.push(videoId)
      }
    } else {
      const index = completedVideos.indexOf(videoId)
      if (index > -1) {
        completedVideos.splice(index, 1)
      }
    }

    saveCompletedVideos(username, completedVideos)

    return NextResponse.json({ success: true, videoId, completed })
  } catch (error) {
    console.error("Calendar POST error:", error)
    return NextResponse.json({ error: "Failed to update" }, { status: 500 })
  }
}

// DELETE - Delete a video folder
export async function DELETE(request: NextRequest) {
  try {
    const username = await getUser()
    const { searchParams } = new URL(request.url)
    const videoId = searchParams.get("videoId")

    if (!videoId) {
      return NextResponse.json({ error: "videoId required" }, { status: 400 })
    }

    const videoPath = path.join(getUserOrganizedDir(username), videoId)

    if (!fs.existsSync(videoPath)) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 })
    }

    // Delete all files in the folder
    const files = fs.readdirSync(videoPath)
    for (const file of files) {
      fs.unlinkSync(path.join(videoPath, file))
    }
    fs.rmdirSync(videoPath)

    // Remove from completed
    const completedVideos = getCompletedVideos(username)
    const index = completedVideos.indexOf(videoId)
    if (index > -1) {
      completedVideos.splice(index, 1)
      saveCompletedVideos(username, completedVideos)
    }

    return NextResponse.json({ success: true, message: "Video deleted" })
  } catch (error) {
    console.error("Delete error:", error)
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 })
  }
}
