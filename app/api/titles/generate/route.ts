import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { getSettings } from "@/lib/file-storage"

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { script, prompt: customPrompt } = body

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY
    if (!GEMINI_API_KEY) {
      return NextResponse.json({ error: "Gemini API key not configured" }, { status: 500 })
    }

    if (!script) {
      return NextResponse.json({ error: "Script required" }, { status: 400 })
    }

    const username = await getUser()
    const settings = getSettings(username)

    // Use custom prompt, or title prompt from settings, or default
    const defaultPrompt = `Generate exactly 20 unique, viral YouTube video titles for the following script.

Requirements:
- Each title should be catchy and attention-grabbing
- Titles should be optimized for clicks (curiosity gap, emotional triggers)
- Keep titles under 70 characters
- Use power words and emotional language
- Make titles relevant to the script content
- Number each title from 1 to 20

Format your response as a numbered list:
1. Title one
2. Title two
... and so on

Script:
`

    const prompt = customPrompt || settings.prompts?.title || defaultPrompt
    const fullPrompt = `${prompt}\n\n${script.slice(0, 5000)}` // Limit script to 5000 chars for title gen

    const titles = await generateTitles(fullPrompt, settings.ai.model, GEMINI_API_KEY)

    if (!titles || titles.length === 0) {
      return NextResponse.json({ error: "Failed to generate titles" }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      titles
    })
  } catch (error) {
    console.error("Error generating titles:", error)
    return NextResponse.json({ error: "Title generation failed" }, { status: 500 })
  }
}

async function generateTitles(prompt: string, model: string = "gemini-2.0-flash", apiKey: string): Promise<string[]> {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60000) // 1 min timeout for titles

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.9, // Higher temperature for more creative titles
          maxOutputTokens: 2048
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

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) {
      console.error("No text in response")
      return []
    }

    // Parse titles from response
    const titles = parseTitles(text)
    return titles
  } catch (error) {
    console.error("Error calling Gemini:", error)
    return []
  }
}

function parseTitles(text: string): string[] {
  const lines = text.split('\n')
  const titles: string[] = []

  for (const line of lines) {
    // Match numbered lines like "1. Title" or "1) Title" or "1: Title"
    const match = line.match(/^\d+[\.\)\:\-]\s*(.+)/)
    if (match && match[1]) {
      const title = match[1].trim()
      // Clean up the title (remove quotes if wrapped)
      const cleanTitle = title.replace(/^["']|["']$/g, '').trim()
      if (cleanTitle.length > 5 && cleanTitle.length < 150) {
        titles.push(cleanTitle)
      }
    }
  }

  // If we couldn't parse numbered list, try splitting by newlines
  if (titles.length < 5) {
    const fallbackTitles = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 10 && line.length < 150)
      .filter(line => !line.startsWith('#') && !line.toLowerCase().includes('title'))
      .slice(0, 20)

    if (fallbackTitles.length > titles.length) {
      return fallbackTitles
    }
  }

  return titles.slice(0, 20)
}
