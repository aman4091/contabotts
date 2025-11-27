import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

export async function GET() {
  try {
    const cookieStore = await cookies()
    const username = cookieStore.get("user")?.value

    if (!username) {
      return NextResponse.json({ user: null })
    }

    // Load users to get display name
    const usersPath = path.join(DATA_DIR, "users.json")
    if (fs.existsSync(usersPath)) {
      const users = JSON.parse(fs.readFileSync(usersPath, "utf-8"))
      const user = users[username]
      if (user) {
        return NextResponse.json({
          user: {
            username,
            name: user.name
          }
        })
      }
    }

    return NextResponse.json({ user: null })
  } catch (error) {
    return NextResponse.json({ user: null })
  }
}
