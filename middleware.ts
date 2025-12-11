import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(request: NextRequest) {
  const user = request.cookies.get("user")?.value
  const { pathname } = request.nextUrl

  // Allow login page and API routes
  if (pathname === "/login" || pathname.startsWith("/api/auth")) {
    return NextResponse.next()
  }

  // Allow APIs for external workers (Vast.ai)
  if (pathname === "/api/subtitle-settings" || pathname === "/api/settings") {
    return NextResponse.next()
  }

  // Allow shorts cron API with secret key
  if (pathname === "/api/shorts/process") {
    const cronSecret = request.headers.get("x-cron-secret")
    if (cronSecret) {
      return NextResponse.next()
    }
  }

  // Allow delayed video processing cron API
  if (pathname === "/api/channels/process-delayed") {
    return NextResponse.next()
  }

  // Allow channel monitor cron API
  if (pathname === "/api/channels/monitor") {
    return NextResponse.next()
  }

  // Check if user is authenticated
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
}
