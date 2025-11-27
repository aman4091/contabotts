import { cookies } from "next/headers"
import path from "path"

const DATA_DIR = process.env.DATA_DIR || "/root/tts/data"

export async function getCurrentUser(): Promise<string | null> {
  const cookieStore = await cookies()
  return cookieStore.get("user")?.value || null
}

export function getUserDataPath(username: string): string {
  return path.join(DATA_DIR, "users", username)
}

export function getSharedDataPath(): string {
  return DATA_DIR
}
