import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import fs from "fs"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

export async function POST(request: NextRequest) {
  try {
    const { username, pin } = await request.json()

    if (!username || !pin) {
      return NextResponse.json({ error: "Username and PIN required" }, { status: 400 })
    }

    // Load users
    const usersPath = path.join(DATA_DIR, "users.json")
    if (!fs.existsSync(usersPath)) {
      return NextResponse.json({ error: "Users not configured" }, { status: 500 })
    }

    const users = JSON.parse(fs.readFileSync(usersPath, "utf-8"))
    const user = users[username.toLowerCase()]

    if (!user || user.pin !== pin) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
    }

    // Set auth cookie
    const cookieStore = await cookies()
    cookieStore.set("user", username.toLowerCase(), {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30 // 30 days
    })

    return NextResponse.json({
      success: true,
      user: {
        username: username.toLowerCase(),
        name: user.name
      }
    })
  } catch (error) {
    console.error("Login error:", error)
    return NextResponse.json({ error: "Login failed" }, { status: 500 })
  }
}
