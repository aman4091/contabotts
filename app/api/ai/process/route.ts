import { NextRequest, NextResponse } from "next/server"
import { getSettings } from "@/lib/file-storage"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { transcript, prompt: customPrompt } = body

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY
    if (!GEMINI_API_KEY) {
      return NextResponse.json({ error: "Gemini API key not configured" }, { status: 500 })
    }

    if (!transcript) {
      return NextResponse.json({ error: "Transcript required" }, { status: 400 })
    }

    const settings = getSettings()
    const prompt = customPrompt || settings.prompts.youtube
    const maxChunkSize = settings.ai.max_chunk_size || 7000

    // Split transcript into chunks if too large
    const chunks = splitIntoChunks(transcript, maxChunkSize)
    const results: string[] = []

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const chunkPrompt = chunks.length > 1
        ? `${prompt}\n\n[Part ${i + 1} of ${chunks.length}]\n\n${chunk}`
        : `${prompt}\n\n${chunk}`

      const result = await callGemini(chunkPrompt, settings.ai.model, GEMINI_API_KEY)
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
      chunks: chunks.length
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

async function callGemini(prompt: string, model: string = "gemini-2.0-flash-exp", apiKey: string): Promise<string | null> {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

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
          maxOutputTokens: 8192
        }
      })
    })

    if (!res.ok) {
      const errorText = await res.text()
      console.error("Gemini API error:", errorText)
      return null
    }

    const data = await res.json()

    if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
      return data.candidates[0].content.parts[0].text
    }

    return null
  } catch (error) {
    console.error("Error calling Gemini:", error)
    return null
  }
}
