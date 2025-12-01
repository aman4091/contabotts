import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

export async function GET(
  request: NextRequest,
  { params }: { params: { slot: string } }
) {
  try {
    const { slot } = params
    const scriptPath = path.join(DATA_DIR, "organized", slot, "script.txt")

    if (!fs.existsSync(scriptPath)) {
      return new NextResponse("Script not found", { status: 404 })
    }

    const content = fs.readFileSync(scriptPath, "utf-8")
    return new NextResponse(content, {
      headers: { "Content-Type": "text/plain" }
    })
  } catch (error) {
    console.error("Error reading script:", error)
    return new NextResponse("Error reading script", { status: 500 })
  }
}
