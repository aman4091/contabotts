"use client"

import { useState, useEffect, createContext, useContext, ReactNode } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  FileAudio,
  Settings,
  Menu,
  X,
  Subtitles,
  LogOut,
  User,
  Calendar,
  Youtube,
  Mic2,
  ImageIcon,
  History
} from "lucide-react"
import { cn } from "@/lib/utils"

// Context for layout state
const LayoutContext = createContext<{
  mobileOpen: boolean
  setMobileOpen: (value: boolean) => void
  user: { username: string; name: string } | null
  logout: () => void
}>({
  mobileOpen: false,
  setMobileOpen: () => {},
  user: null,
  logout: () => {}
})

const navItems = [
  { title: "Videos", href: "/", icon: Youtube },
  { title: "History", href: "/history", icon: History },
  { title: "Calendar", href: "/calendar", icon: Calendar },
  { title: "Thumbnails", href: "/titles-thumbnails", icon: ImageIcon },
  { title: "Queue", href: "/audio-files", icon: FileAudio },
  { title: "Subtitles", href: "/subtitle-settings", icon: Subtitles },
  { title: "Settings", href: "/settings", icon: Settings }
]

function TopNavbar() {
  const pathname = usePathname()
  const { mobileOpen, setMobileOpen, user, logout } = useContext(LayoutContext)

  return (
    <>
      {/* Top Navigation Bar */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between h-14">
            {/* Logo */}
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-violet-500/25">
                <Mic2 className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-lg gradient-text hidden sm:block">TTS Studio</span>
            </div>

            {/* Desktop Navigation */}
            <nav className="hidden lg:flex items-center gap-1">
              {navItems.map((item) => {
                const isActive = pathname === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all",
                      isActive
                        ? "bg-gradient-to-r from-violet-500/20 to-cyan-500/20 text-white border border-violet-500/30"
                        : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                    )}
                  >
                    <item.icon className="w-4 h-4" />
                    {item.title}
                  </Link>
                )
              })}
            </nav>

            {/* Right side - User & Mobile menu */}
            <div className="flex items-center gap-2">
              {/* User info - desktop */}
              {user && (
                <div className="hidden md:flex items-center gap-2">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20">
                    <User className="w-4 h-4 text-violet-400" />
                    <span className="text-sm font-medium">{user.name}</span>
                  </div>
                  <button
                    onClick={logout}
                    className="p-2 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
                    title="Logout"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Mobile menu button */}
              <button
                className="lg:hidden p-2 rounded-lg bg-white/5 border border-white/10"
                onClick={() => setMobileOpen(!mobileOpen)}
              >
                {mobileOpen ? (
                  <X className="w-5 h-5" />
                ) : (
                  <Menu className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Menu Dropdown */}
      {mobileOpen && (
        <>
          {/* Overlay */}
          <div
            className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40 pt-14"
            onClick={() => setMobileOpen(false)}
          />

          {/* Mobile Menu */}
          <div className="lg:hidden fixed top-14 left-0 right-0 z-50 bg-card/98 backdrop-blur-xl border-b border-white/10 shadow-xl">
            <nav className="p-3 space-y-1">
              {navItems.map((item) => {
                const isActive = pathname === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 rounded-xl text-base font-medium transition-all",
                      isActive
                        ? "bg-gradient-to-r from-violet-500/20 to-cyan-500/20 text-white border border-violet-500/30"
                        : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                    )}
                  >
                    <item.icon className="w-5 h-5" />
                    {item.title}
                  </Link>
                )
              })}

              {/* User section in mobile */}
              {user && (
                <div className="mt-3 pt-3 border-t border-white/10">
                  <div className="flex items-center justify-between px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center">
                        <User className="w-4 h-4 text-white" />
                      </div>
                      <div>
                        <span className="text-sm font-medium">{user.name}</span>
                        <p className="text-xs text-muted-foreground">@{user.username}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        logout()
                        setMobileOpen(false)
                      }}
                      className="px-3 py-2 rounded-lg bg-red-500/20 text-red-400 text-sm font-medium"
                    >
                      Logout
                    </button>
                  </div>
                </div>
              )}
            </nav>
          </div>
        </>
      )}
    </>
  )
}

export function LayoutWrapper({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [user, setUser] = useState<{ username: string; name: string } | null>(null)
  const router = useRouter()

  useEffect(() => {
    fetch("/api/auth/me")
      .then(res => res.json())
      .then(data => {
        if (data.user) {
          setUser(data.user)
        }
      })
      .catch(() => {})
  }, [])

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" })
      router.push("/login")
      router.refresh()
    } catch (error) {
      console.error("Logout error:", error)
    }
  }

  return (
    <LayoutContext.Provider value={{ mobileOpen, setMobileOpen, user, logout }}>
      <div className="min-h-screen">
        {/* Top Navbar */}
        <TopNavbar />

        {/* Main content - with top padding for navbar */}
        <main className="pt-14">
          <div className="max-w-7xl mx-auto py-6 px-4 lg:py-8 lg:px-6">
            {children}
          </div>
        </main>
      </div>
    </LayoutContext.Provider>
  )
}
