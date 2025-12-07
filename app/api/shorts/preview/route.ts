import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ""

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

function getSettings(username: string) {
  const settingsPath = path.join(DATA_DIR, "users", username, "settings.json")
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, "utf-8"))
    }
  } catch {}
  return { prompts: {} }
}

function getScriptContent(username: string, videoFolder: string): string | null {
  const scriptPath = path.join(DATA_DIR, "users", username, "organized", videoFolder, "script.txt")
  if (!fs.existsSync(scriptPath)) return null
  return fs.readFileSync(scriptPath, "utf-8")
}

async function generateShortsFromScript(script: string, shortsPrompt: string, model: string): Promise<{ number: number; content: string }[]> {
  const fullPrompt = `${shortsPrompt}

IMPORTANT: Output exactly 10 short scripts, numbered 1 to 10. Each short should be under 60 seconds when spoken.
Format each short like this:
---SHORT 1---
[script content]
---SHORT 2---
[script content]
... and so on until SHORT 10.

Here is the full script to convert:

${script}`

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 300000)

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 65536 }
      }),
      signal: controller.signal
    })

    clearTimeout(timeout)

    if (!res.ok) {
      console.error("Gemini API error:", res.status)
      return []
    }

    const data = await res.json()

    if (data.candidates?.[0]?.finishReason === "SAFETY") {
      console.error("Content blocked by safety filters")
      return []
    }

    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || ""
    return parseShorts(responseText)
  } catch (error) {
    clearTimeout(timeout)
    console.error("Gemini error:", error)
    return []
  }
}

function parseShorts(responseText: string): { number: number; content: string }[] {
  const shorts: { number: number; content: string }[] = []

  const shortPattern = /---SHORT\s*(\d+)---\s*([\s\S]*?)(?=---SHORT\s*\d+---|$)/gi
  let match

  while ((match = shortPattern.exec(responseText)) !== null) {
    const number = parseInt(match[1])
    const content = match[2].trim()
    if (number >= 1 && number <= 10 && content.length > 50) {
      shorts.push({ number, content })
    }
  }

  if (shorts.length < 10) {
    const numberedPattern = /(?:^|\n)\s*(?:\*\*)?(\d+)[\.\)]\s*(?:\*\*)?\s*([\s\S]*?)(?=(?:^|\n)\s*(?:\*\*)?\d+[\.\)]|$)/gm
    while ((match = numberedPattern.exec(responseText)) !== null) {
      const number = parseInt(match[1])
      const content = match[2].trim()
      if (number >= 1 && number <= 10 && content.length > 50 && !shorts.find(s => s.number === number)) {
        shorts.push({ number, content })
      }
    }
  }

  return shorts.sort((a, b) => a.number - b.number).slice(0, 10)
}

export async function POST(request: NextRequest) {
  try {
    const username = await getUser()
    if (!username) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const body = await request.json()
    const { videoFolder } = body

    if (!videoFolder) {
      return NextResponse.json({ error: "videoFolder is required" }, { status: 400 })
    }

    const settings = getSettings(username)
    const shortsPrompt = settings.prompts?.shorts

    if (!shortsPrompt) {
      return NextResponse.json({ error: "Shorts prompt not configured in Settings" }, { status: 400 })
    }

    const scriptContent = getScriptContent(username, videoFolder)
    if (!scriptContent) {
      return NextResponse.json({ error: `Script not found for ${videoFolder}` }, { status: 404 })
    }

    console.log(`Generating shorts preview for ${username}/${videoFolder}...`)

    // Always use Gemini 3 Pro for shorts (best quality)
    const model = "gemini-3-pro-preview"
    const shorts = await generateShortsFromScript(scriptContent, shortsPrompt, model)

    if (shorts.length === 0) {
      return NextResponse.json({ error: "Failed to generate shorts from Gemini" }, { status: 500 })
    }

    console.log(`Generated ${shorts.length} shorts for preview`)

    return NextResponse.json({
      success: true,
      shorts,
      videoFolder,
      totalGenerated: shorts.length
    })
  } catch (error) {
    console.error("Preview shorts error:", error)
    return NextResponse.json({ error: "Failed to generate shorts preview" }, { status: 500 })
  }
}
