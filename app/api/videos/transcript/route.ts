import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

const KEYS_FILE = path.join(process.cwd(), "data", "supadata_keys.json")
const LIMIT_PER_KEY = 98
const MIN_REQUEST_INTERVAL = 1000 // 1 second between requests

interface KeyData {
  key: string
  used: number
  exhausted: boolean
}

interface KeysConfig {
  keys: KeyData[]
  limit_per_key: number
  last_request_time: number
}

function loadKeys(): KeysConfig {
  try {
    const data = fs.readFileSync(KEYS_FILE, "utf-8")
    return JSON.parse(data)
  } catch {
    return { keys: [], limit_per_key: LIMIT_PER_KEY, last_request_time: 0 }
  }
}

function saveKeys(config: KeysConfig) {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(config, null, 2))
}

function getAvailableKey(): { key: string; index: number } | null {
  const config = loadKeys()

  for (let i = 0; i < config.keys.length; i++) {
    const keyData = config.keys[i]
    if (!keyData.exhausted && keyData.used < LIMIT_PER_KEY) {
      return { key: keyData.key, index: i }
    }
  }

  return null
}

function markKeyUsed(index: number) {
  const config = loadKeys()
  config.keys[index].used++

  // Mark as exhausted if limit reached
  if (config.keys[index].used >= LIMIT_PER_KEY) {
    config.keys[index].exhausted = true
    console.log(`🔑 Key ${index + 1} exhausted (${config.keys[index].used}/${LIMIT_PER_KEY})`)
  }

  config.last_request_time = Date.now()
  saveKeys(config)
}

async function waitForRateLimit() {
  const config = loadKeys()
  const elapsed = Date.now() - config.last_request_time

  if (elapsed < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - elapsed
    console.log(`⏳ Rate limit: waiting ${waitTime}ms`)
    await new Promise(resolve => setTimeout(resolve, waitTime))
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const videoId = searchParams.get("videoId")

    if (!videoId) {
      return NextResponse.json({ error: "videoId required" }, { status: 400 })
    }

    const keyInfo = getAvailableKey()
    if (!keyInfo) {
      return NextResponse.json({ error: "All API keys exhausted" }, { status: 503 })
    }

    // Rate limiting - wait if needed
    await waitForRateLimit()

    const transcript = await fetchTranscript(videoId, keyInfo.key)

    // Mark key as used after request
    markKeyUsed(keyInfo.index)

    if (!transcript) {
      return NextResponse.json({ error: "Could not fetch transcript" }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      videoId,
      transcript,
      charCount: transcript.length
    })
  } catch (error) {
    console.error("Error fetching transcript:", error)
    return NextResponse.json({ error: "Failed to fetch transcript" }, { status: 500 })
  }
}

async function fetchTranscript(videoId: string, apiKey: string): Promise<string | null> {
  try {
    const url = `https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}`

    const res = await fetch(url, {
      headers: {
        "x-api-key": apiKey
      },
      cache: 'no-store'
    })

    if (!res.ok) {
      const text = await res.text()
      console.error(`Supadata error for ${videoId}: ${res.status} - ${text}`)
      return null
    }

    const data = await res.json()

    // Supadata returns transcript in segments, combine them
    if (data.content && Array.isArray(data.content)) {
      return data.content.map((segment: any) => segment.text).join(" ")
    }

    if (typeof data.transcript === "string") {
      return data.transcript
    }

    if (data.text) {
      return data.text
    }

    return null
  } catch (error) {
    console.error(`Error fetching transcript for ${videoId}:`, error)
    return null
  }
}
