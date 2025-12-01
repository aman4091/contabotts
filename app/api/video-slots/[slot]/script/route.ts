import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

async function getUser() {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value || "default"
}

function getUserOrganizedDir(username: string) {
  return path.join(DATA_DIR, "users", username, "organized")
}

export async function GET(
  request: NextRequest,
  { params }: { params: { slot: string } }
) {
  try {
    const username = await getUser()
    const { slot } = await params
    const scriptPath = path.join(getUserOrganizedDir(username), slot, "script.txt")

    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json({ script: "" })
    }

    const content = fs.readFileSync(scriptPath, "utf-8")
    return NextResponse.json({ script: content })
  } catch (error) {
    console.error("Error reading script:", error)
    return NextResponse.json({ error: "Error reading script" }, { status: 500 })
  }
}
