import { randomUUID } from "crypto"
import {
  getSettings,
  getUnprocessedScriptsForShorts,
  getScriptContent,
  markScriptAsProcessedForShorts,
  listImages
} from "./file-storage"

const FILE_SERVER_URL = process.env.FILE_SERVER_URL || ""
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || ""
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ""

interface ShortScript {
  number: number
  content: string
}

// Call Gemini 2.5 Pro to generate 10 shorts from a script
async function generateShortsFromScript(
  script: string,
  shortsPrompt: string
): Promise<ShortScript[]> {
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro-preview-06-05:generateContent?key=${GEMINI_API_KEY}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 300000) // 5 min timeout

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: fullPrompt }]
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 65536
        }
      }),
      signal: controller.signal
    })

    clearTimeout(timeout)

    if (!res.ok) {
      const errorText = await res.text()
      console.error("Gemini API error:", res.status, errorText)
      return []
    }

    const data = await res.json()

    if (data.candidates?.[0]?.finishReason === "SAFETY") {
      console.error("Content blocked by safety filters")
      return []
    }

    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || ""

    // Parse the response to extract 10 shorts
    return parseShorts(responseText)
  } catch (error) {
    clearTimeout(timeout)
    console.error("Error calling Gemini:", error)
    return []
  }
}

// Parse Gemini response to extract numbered shorts
function parseShorts(responseText: string): ShortScript[] {
  const shorts: ShortScript[] = []

  // Try to find shorts with ---SHORT N--- format
  const shortPattern = /---SHORT\s*(\d+)---\s*([\s\S]*?)(?=---SHORT\s*\d+---|$)/gi
  let match

  while ((match = shortPattern.exec(responseText)) !== null) {
    const number = parseInt(match[1])
    const content = match[2].trim()

    if (number >= 1 && number <= 10 && content.length > 50) {
      shorts.push({ number, content })
    }
  }

  // If that didn't work, try numbered format (1. or 1) or **1.**)
  if (shorts.length < 10) {
    const numberedPattern = /(?:^|\n)\s*(?:\*\*)?(\d+)[\.\)]\s*(?:\*\*)?\s*([\s\S]*?)(?=(?:^|\n)\s*(?:\*\*)?\d+[\.\)]|$)/gm

    while ((match = numberedPattern.exec(responseText)) !== null) {
      const number = parseInt(match[1])
      const content = match[2].trim()

      if (number >= 1 && number <= 10 && content.length > 50) {
        // Check if we already have this number
        if (!shorts.find(s => s.number === number)) {
          shorts.push({ number, content })
        }
      }
    }
  }

  // Sort by number
  shorts.sort((a, b) => a.number - b.number)

  return shorts.slice(0, 10)
}

// Get a random image from shorts folder
function getRandomShortImage(): string | null {
  const images = listImages("shorts")
  if (images.length === 0) return null
  return images[Math.floor(Math.random() * images.length)]
}

// Create audio job for a short
async function createShortAudioJob(params: {
  jobId: string
  scriptText: string
  sourceVideo: string
  shortNumber: number
  username?: string
  referenceAudio?: string
}): Promise<boolean> {
  try {
    const response = await fetch(`${FILE_SERVER_URL}/queue/audio/jobs`, {
      method: "POST",
      headers: {
        "x-api-key": FILE_SERVER_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        job_id: params.jobId,
        script_text: params.scriptText,
        channel_code: "SHORTS",
        video_number: params.shortNumber,
        date: new Date().toISOString().split("T")[0],
        audio_counter: Date.now() % 1000000,
        organized_path: `/shorts/${params.sourceVideo}`,
        priority: 3, // Lower priority than regular videos
        username: params.username,
        reference_audio: params.referenceAudio,
        is_short: true,
        source_video: params.sourceVideo,
        short_number: params.shortNumber,
        image_folder: "shorts"
      })
    })

    return response.ok
  } catch (error) {
    console.error("Error creating short audio job:", error)
    return false
  }
}

// Main function to process shorts for a user
export async function processShortsForUser(username?: string): Promise<{
  processed: number
  shorts: number
  errors: string[]
}> {
  const result = {
    processed: 0,
    shorts: 0,
    errors: [] as string[]
  }

  // Get settings
  const settings = getSettings(username)
  const shortsPrompt = settings.prompts.shorts

  if (!shortsPrompt) {
    result.errors.push("No shorts prompt configured in settings")
    return result
  }

  if (!GEMINI_API_KEY) {
    result.errors.push("GEMINI_API_KEY not configured")
    return result
  }

  // Get unprocessed scripts (max 3 per day)
  const scriptsToProcess = getUnprocessedScriptsForShorts(username, 3)

  if (scriptsToProcess.length === 0) {
    console.log("No scripts to process for shorts")
    return result
  }

  console.log(`Processing ${scriptsToProcess.length} scripts for shorts...`)

  // Get default reference audio
  const referenceAudio = settings.defaultReferenceAudio

  for (const videoFolder of scriptsToProcess) {
    console.log(`\nProcessing ${videoFolder}...`)

    // Get script content
    const scriptContent = getScriptContent(videoFolder, username)

    if (!scriptContent) {
      result.errors.push(`No script found for ${videoFolder}`)
      continue
    }

    // Generate 10 shorts using Gemini 2.5 Pro
    console.log("Calling Gemini 2.5 Pro...")
    const shorts = await generateShortsFromScript(scriptContent, shortsPrompt)

    if (shorts.length === 0) {
      result.errors.push(`Failed to generate shorts for ${videoFolder}`)
      continue
    }

    console.log(`Generated ${shorts.length} shorts`)

    // Queue each short for audio generation
    for (const short of shorts) {
      const jobId = randomUUID()

      const success = await createShortAudioJob({
        jobId,
        scriptText: short.content,
        sourceVideo: videoFolder,
        shortNumber: short.number,
        username,
        referenceAudio
      })

      if (success) {
        result.shorts++
        console.log(`Queued short #${short.number} for ${videoFolder}`)
      } else {
        result.errors.push(`Failed to queue short #${short.number} for ${videoFolder}`)
      }

      // Small delay between queue operations
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    // Mark script as processed
    markScriptAsProcessedForShorts(videoFolder, username)
    result.processed++

    console.log(`Completed ${videoFolder}`)

    // Delay between scripts
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  return result
}

// Process shorts for all users
export async function processShortsForAllUsers(): Promise<void> {
  const fs = await import("fs")
  const path = await import("path")

  const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"
  const usersDir = path.join(DATA_DIR, "users")

  if (!fs.existsSync(usersDir)) {
    console.log("No users directory found")
    return
  }

  const users = fs.readdirSync(usersDir).filter(f => {
    return fs.statSync(path.join(usersDir, f)).isDirectory()
  })

  console.log(`\n========== SHORTS CRON START ==========`)
  console.log(`Found ${users.length} users: ${users.join(", ")}`)
  console.log(`Time: ${new Date().toISOString()}`)

  for (const username of users) {
    console.log(`\n--- Processing user: ${username} ---`)

    try {
      const result = await processShortsForUser(username)

      console.log(`\nResults for ${username}:`)
      console.log(`  Scripts processed: ${result.processed}`)
      console.log(`  Shorts queued: ${result.shorts}`)

      if (result.errors.length > 0) {
        console.log(`  Errors:`)
        result.errors.forEach(e => console.log(`    - ${e}`))
      }
    } catch (error) {
      console.error(`Error processing user ${username}:`, error)
    }
  }

  console.log(`\n========== SHORTS CRON END ==========\n`)
}
