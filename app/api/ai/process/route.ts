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
    const { transcript, prompt: customPrompt } = body

    if (!transcript) {
      return NextResponse.json({ error: "Transcript required" }, { status: 400 })
    }

    const username = await getUser()
    const settings = getSettings(username)
    const prompt = customPrompt || settings.prompts.youtube
    const maxChunkSize = settings.ai.max_chunk_size || 7000
    const provider = settings.ai.provider || "gemini"

    // Check API keys based on provider
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY
    const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY

    if (provider === "gemini" && !GEMINI_API_KEY) {
      return NextResponse.json({ error: "Gemini API key not configured" }, { status: 500 })
    }
    if (provider === "deepseek" && !DEEPSEEK_API_KEY) {
      return NextResponse.json({ error: "DeepSeek API key not configured" }, { status: 500 })
    }

    // Split transcript into chunks if too large
    const chunks = splitIntoChunks(transcript, maxChunkSize)
    const results: string[] = []

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const chunkPrompt = chunks.length > 1
        ? `${prompt}\n\n[Part ${i + 1} of ${chunks.length}]\n\n${chunk}`
        : `${prompt}\n\n${chunk}`

      let result: string | null = null
      if (provider === "deepseek") {
        result = await callDeepSeek(chunkPrompt, settings.ai.model || "deepseek-chat", DEEPSEEK_API_KEY!)
      } else {
        result = await callGemini(chunkPrompt, settings.ai.model || "gemini-2.5-flash", GEMINI_API_KEY!)
      }

      if (result) {
        results.push(result)
      } else {
        return NextResponse.json({ error: `Failed to process chunk ${i + 1}` }, { status: 500 })
      }

      // Small delay between chunks to avoid rate limiting
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }

    const finalResult = results.join("\n\n")

    return NextResponse.json({
      success: true,
      result: finalResult,
      chunks: chunks.length,
      provider
    })
  } catch (error) {
    console.error("Error processing with AI:", error)
    return NextResponse.json({ error: "AI processing failed" }, { status: 500 })
  }
}

function splitIntoChunks(text: string, maxSize: number): string[] {
  if (text.length <= maxSize) {
    return [text]
  }

  const chunks: string[] = []
  const sentences = text.split(/(?<=[.!?])\s+/)
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

async function callGemini(prompt: string, model: string = "gemini-2.5-flash", apiKey: string): Promise<string | null> {
  try {
    // Use v1beta for all models
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 300000) // 5 min timeout

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
          temperature: 0.7,
          maxOutputTokens: 65536 // Increased for larger outputs
        }
      }),
      signal: controller.signal
    })

    clearTimeout(timeout)

    if (!res.ok) {
      const errorText = await res.text()
      console.error("Gemini API error:", res.status, errorText)
      return null
    }

    const data = await res.json()

    // Check for blocked content
    if (data.candidates?.[0]?.finishReason === "SAFETY") {
      console.error("Content blocked by safety filters")
      return null
    }

    if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
      return data.candidates[0].content.parts[0].text
    }

    console.error("No text in response:", JSON.stringify(data).slice(0, 500))
    return null
  } catch (error) {
    console.error("Error calling Gemini:", error)
    return null
  }
}

async function callDeepSeek(prompt: string, model: string = "deepseek-chat", apiKey: string): Promise<string | null> {
  try {
    const url = "https://api.deepseek.com/chat/completions"

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 300000) // 5 min timeout

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 8192
      }),
      signal: controller.signal
    })

    clearTimeout(timeout)

    if (!res.ok) {
      const errorText = await res.text()
      console.error("DeepSeek API error:", res.status, errorText)
      return null
    }

    const data = await res.json()

    if (data.choices?.[0]?.message?.content) {
      return data.choices[0].message.content
    }

    console.error("No text in DeepSeek response:", JSON.stringify(data).slice(0, 500))
    return null
  } catch (error) {
    console.error("Error calling DeepSeek:", error)
    return null
  }
}
