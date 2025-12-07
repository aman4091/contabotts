import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { randomUUID } from "crypto"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

function getPendingPath(username: string): string {
  return path.join(DATA_DIR, "users", username, "channel-automation", "pending-scripts.json")
}

export interface PendingScript {
  id: string
  videoId: string
  title: string
  channelId: string
  channelName: string
  transcript: string
  script: string
  transcriptChars: number
  scriptChars: number
  createdAt: string
  source: "auto_create" | "live_monitoring"
  prompt: string  // The prompt used
}

function getPendingScripts(username: string): PendingScript[] {
  const filePath = getPendingPath(username)
  if (!fs.existsSync(filePath)) return []
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"))
  } catch {
    return []
  }
}

function savePendingScripts(username: string, scripts: PendingScript[]) {
  const filePath = getPendingPath(username)
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(filePath, JSON.stringify(scripts, null, 2))
}

// GET - List pending scripts
export async function GET() {
  try {
    const username = await getUser()
    if (!username) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const scripts = getPendingScripts(username)
    return NextResponse.json({ scripts })
  } catch (error) {
    console.error("Error getting pending scripts:", error)
    return NextResponse.json({ error: "Failed to get pending scripts" }, { status: 500 })
  }
}

// POST - Add new pending script
export async function POST(request: NextRequest) {
  try {
    const username = await getUser()
    if (!username) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const body = await request.json()
    const { videoId, title, channelId, channelName, transcript, script, source, prompt } = body

    if (!videoId || !transcript || !script) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const scripts = getPendingScripts(username)

    // Check if already pending
    if (scripts.find(s => s.videoId === videoId)) {
      return NextResponse.json({ error: "Script already pending" }, { status: 400 })
    }

    const newScript: PendingScript = {
      id: randomUUID(),
      videoId,
      title: title || "Untitled",
      channelId: channelId || "",
      channelName: channelName || "Unknown",
      transcript,
      script,
      transcriptChars: transcript.length,
      scriptChars: script.length,
      createdAt: new Date().toISOString(),
      source: source || "auto_create",
      prompt: prompt || ""
    }

    scripts.push(newScript)
    savePendingScripts(username, scripts)

    return NextResponse.json({ success: true, script: newScript })
  } catch (error) {
    console.error("Error adding pending script:", error)
    return NextResponse.json({ error: "Failed to add pending script" }, { status: 500 })
  }
}

// DELETE - Remove pending script
export async function DELETE(request: NextRequest) {
  try {
    const username = await getUser()
    if (!username) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json({ error: "Script ID required" }, { status: 400 })
    }

    let scripts = getPendingScripts(username)
    scripts = scripts.filter(s => s.id !== id)
    savePendingScripts(username, scripts)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting pending script:", error)
    return NextResponse.json({ error: "Failed to delete pending script" }, { status: 500 })
  }
}

// PATCH - Update script content (for reprocessing)
export async function PATCH(request: NextRequest) {
  try {
    const username = await getUser()
    if (!username) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const body = await request.json()
    const { id, script } = body

    if (!id || !script) {
      return NextResponse.json({ error: "ID and script required" }, { status: 400 })
    }

    const scripts = getPendingScripts(username)
    const index = scripts.findIndex(s => s.id === id)

    if (index === -1) {
      return NextResponse.json({ error: "Script not found" }, { status: 404 })
    }

    scripts[index].script = script
    scripts[index].scriptChars = script.length
    savePendingScripts(username, scripts)

    return NextResponse.json({ success: true, script: scripts[index] })
  } catch (error) {
    console.error("Error updating pending script:", error)
    return NextResponse.json({ error: "Failed to update pending script" }, { status: 500 })
  }
}
