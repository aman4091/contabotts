import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"
const GEMINI_API_KEY = process.env.GEMINI_API_KEY

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
  return { ai: { max_chunk_size: 7000 } }
}

function getPendingPath(username: string): string {
  return path.join(DATA_DIR, "users", username, "channel-automation", "pending-scripts.json")
}

function getPendingScripts(username: string): any[] {
  const filePath = getPendingPath(username)
  if (!fs.existsSync(filePath)) return []
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"))
  } catch {
    return []
  }
}

function savePendingScripts(username: string, scripts: any[]) {
  const filePath = getPendingPath(username)
  fs.writeFileSync(filePath, JSON.stringify(scripts, null, 2))
}

// POST - Reprocess a pending script with Gemini
export async function POST(request: NextRequest) {
  try {
    const username = await getUser()
    if (!username) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    if (!GEMINI_API_KEY) {
      return NextResponse.json({ error: "Gemini API key not configured" }, { status: 500 })
    }

    const body = await request.json()
    const { id } = body

    if (!id) {
      return NextResponse.json({ error: "Script ID required" }, { status: 400 })
    }

    const scripts = getPendingScripts(username)
    const scriptIndex = scripts.findIndex(s => s.id === id)

    if (scriptIndex === -1) {
      return NextResponse.json({ error: "Script not found" }, { status: 404 })
    }

    const pendingScript = scripts[scriptIndex]
    const settings = getSettings(username)
    const maxChunkSize = settings.ai?.max_chunk_size || 7000

    // Reprocess with Gemini
    const newScript = await processWithGemini(pendingScript.transcript, pendingScript.prompt, maxChunkSize)

    if (!newScript) {
      return NextResponse.json({ error: "Gemini processing failed" }, { status: 500 })
    }

    // Update the pending script
    scripts[scriptIndex].script = newScript
    scripts[scriptIndex].scriptChars = newScript.length
    savePendingScripts(username, scripts)

    return NextResponse.json({
      success: true,
      script: scripts[scriptIndex],
      message: "Script reprocessed successfully"
    })
  } catch (error) {
    console.error("Error reprocessing script:", error)
    return NextResponse.json({ error: "Failed to reprocess script" }, { status: 500 })
  }
}

async function processWithGemini(transcript: string, prompt: string, maxChunkSize: number): Promise<string | null> {
  const chunks = splitIntoChunks(transcript, maxChunkSize)
  const results: string[] = []

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const chunkPrompt = chunks.length > 1
      ? `${prompt}\n\n[Part ${i + 1} of ${chunks.length}]\n\n${chunk}`
      : `${prompt}\n\n${chunk}`

    const result = await callGemini(chunkPrompt)
    if (!result) return null

    results.push(result)

    if (i < chunks.length - 1) {
      await new Promise(r => setTimeout(r, 500))
    }
  }

  return results.join("\n\n")
}

function splitIntoChunks(text: string, maxSize: number): string[] {
  if (text.length <= maxSize) return [text]

  const chunks: string[] = []
  const sentences = text.split(/(?<=[।.!?])\s+/)
  let currentChunk = ""

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > maxSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim())
      currentChunk = sentence
    } else {
      currentChunk += (currentChunk ? " " : "") + sentence
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim())
  }

  return chunks
}

async function callGemini(prompt: string): Promise<string | null> {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 300000)

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 65536,
          thinkingConfig: { thinkingBudget: 0 }
        }
      }),
      signal: controller.signal
    })

    clearTimeout(timeout)

    if (!res.ok) return null

    const data = await res.json()

    if (data.candidates?.[0]?.finishReason === "SAFETY") return null
    if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
      return data.candidates[0].content.parts[0].text
    }

    return null
  } catch (error) {
    console.error("Gemini error:", error)
    return null
  }
}
