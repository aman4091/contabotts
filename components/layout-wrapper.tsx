"use client"

import { useState, useEffect, createContext, useContext, ReactNode } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  LayoutDashboard,
  FileAudio,
  Settings,
  Mic2,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  Subtitles,
  LogOut,
  User,
  Calendar,
  Zap
} from "lucide-react"
import { cn } from "@/lib/utils"

// Context for sidebar state
const SidebarContext = createContext<{
  collapsed: boolean
  setCollapsed: (value: boolean) => void
  mobileOpen: boolean
  setMobileOpen: (value: boolean) => void
  user: { username: string; name: string } | null
  logout: () => void
}>({
  collapsed: false,
  setCollapsed: () => {},
  mobileOpen: false,
  setMobileOpen: () => {},
  user: null,
  logout: () => {}
})

const navItems = [
  {
    title: "Process",
    href: "/",
    icon: LayoutDashboard,
    description: "Process transcripts"
  },
  {
    title: "Calendar",
    href: "/calendar",
    icon: Calendar,
    description: "Download by date"
  },
  {
    title: "Queue Manager",
    href: "/audio-files",
    icon: FileAudio,
    description: "View jobs"
  },
  {
    title: "Auto Processing",
    href: "/auto-processing",
    icon: Zap,
    description: "Auto daily jobs"
  },
  {
    title: "Subtitles",
    href: "/subtitle-settings",
    icon: Subtitles,
    description: "Customize subtitles"
  },
  {
    title: "Settings",
    href: "/settings",
    icon: Settings,
    description: "Configure app"
  }
]

function Sidebar() {
  const pathname = usePathname()
  const { collapsed, setCollapsed, mobileOpen, setMobileOpen, user, logout } = useContext(SidebarContext)

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile menu button */}
      <button
        className="lg:hidden fixed top-4 left-4 z-50 p-2.5 rounded-xl bg-card/90 backdrop-blur border border-white/10 shadow-lg"
        onClick={() => setMobileOpen(!mobileOpen)}
      >
        {mobileOpen ? (
          <X className="w-5 h-5 text-foreground" />
        ) : (
          <Menu className="w-5 h-5 text-foreground" />
        )}
      </button>

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 h-screen transition-all duration-300 ease-in-out",
          "bg-card/95 backdrop-blur-xl border-r border-white/10",
          // Desktop
          "lg:translate-x-0",
          collapsed ? "lg:w-[70px]" : "lg:w-[260px]",
          // Mobile
          "w-[280px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="flex items-center h-16 px-4 border-b border-white/10">
          {!collapsed ? (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-violet-500/25">
                <Mic2 className="w-6 h-6 text-white" />
              </div>
              <div>
                <span className="font-bold text-lg gradient-text">TTS Studio</span>
                <p className="text-xs text-muted-foreground">Audio Generator</p>
              </div>
            </div>
          ) : (
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center mx-auto shadow-lg shadow-violet-500/25">
              <Mic2 className="w-6 h-6 text-white" />
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="p-3 space-y-2 mt-2">
          <span className={cn(
            "text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider px-3",
            collapsed && "hidden"
          )}>
            Menu
          </span>
          {navItems.map((item) => {
            const isActive = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200",
                  "hover:bg-white/5 group relative",
                  isActive
                    ? "bg-gradient-to-r from-violet-500/20 to-cyan-500/10 border border-violet-500/30 shadow-lg shadow-violet-500/5"
                    : "border border-transparent hover:border-white/10"
                )}
              >
                <div className={cn(
                  "p-2 rounded-lg transition-colors",
                  isActive
                    ? "bg-gradient-to-br from-violet-500 to-cyan-500 shadow-lg shadow-violet-500/25"
                    : "bg-white/5 group-hover:bg-white/10"
                )}>
                  <item.icon
                    className={cn(
                      "w-5 h-5 transition-colors",
                      isActive
                        ? "text-white"
                        : "text-muted-foreground group-hover:text-foreground"
                    )}
                  />
                </div>
                {!collapsed && (
                  <div className="flex flex-col flex-1">
                    <span
                      className={cn(
                        "text-sm font-medium transition-colors",
                        isActive
                          ? "text-foreground"
                          : "text-muted-foreground group-hover:text-foreground"
                      )}
                    >
                      {item.title}
                    </span>
                    <span className="text-xs text-muted-foreground/60">
                      {item.description}
                    </span>
                  </div>
                )}
                {isActive && !collapsed && (
                  <div className="w-1 h-8 rounded-full bg-gradient-to-b from-violet-500 to-cyan-500" />
                )}

                {/* Tooltip for collapsed state */}
                {collapsed && (
                  <div className="absolute left-full ml-2 px-2 py-1 bg-card border border-white/10 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
                    <span className="text-sm font-medium">{item.title}</span>
                  </div>
                )}
              </Link>
            )
          })}
        </nav>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            "absolute -right-3 top-20 w-6 h-6 rounded-full",
            "bg-card border border-white/20 flex items-center justify-center",
            "hover:bg-violet-500/20 hover:border-violet-500/50 transition-all text-muted-foreground hover:text-foreground"
          )}
        >
          {collapsed ? (
            <ChevronRight className="w-3 h-3" />
          ) : (
            <ChevronLeft className="w-3 h-3" />
          )}
        </button>

        {/* User section at bottom */}
        <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-white/10">
          {!collapsed ? (
            <div className="space-y-2">
              {user && (
                <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-violet-500/10 border border-violet-500/20">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center">
                    <User className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1">
                    <span className="text-sm font-medium text-foreground">{user.name}</span>
                    <p className="text-xs text-muted-foreground">@{user.username}</p>
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
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-2">
              {user && (
                <>
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center">
                    <User className="w-4 h-4 text-white" />
                  </div>
                  <button
                    onClick={logout}
                    className="p-2 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
                    title="Logout"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  )
}

export function LayoutWrapper({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [user, setUser] = useState<{ username: string; name: string } | null>(null)
  const router = useRouter()

  useEffect(() => {
    // Fetch current user
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
    <SidebarContext.Provider value={{ collapsed, setCollapsed, mobileOpen, setMobileOpen, user, logout }}>
      <div className="min-h-screen flex">
        {/* Sidebar */}
        <Sidebar />

        {/* Main content */}
        <main className={cn(
          "flex-1 transition-all duration-300",
          // Desktop margin
          collapsed ? "lg:ml-[70px]" : "lg:ml-[260px]",
          // Mobile - no margin, add top padding for menu button
          "ml-0 pt-16 lg:pt-0"
        )}>
          <div className="max-w-7xl mx-auto py-6 px-4 lg:py-8 lg:px-8">
            {children}
          </div>
        </main>
      </div>
    </SidebarContext.Provider>
  )
}
