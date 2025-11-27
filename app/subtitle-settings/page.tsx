"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface SubtitleSettings {
  font: {
    family: string
    size: number
    color: string
  }
  background: {
    color: string
    opacity: number
    cornerRadius: number
  }
  box: {
    hPadding: number
    vPadding: number
    charWidth: number
  }
  position: {
    alignment: number
    marginV: number
    marginL: number
    marginR: number
  }
}

const defaultSettings: SubtitleSettings = {
  font: { family: "Arial", size: 48, color: "#FFFFFF" },
  background: { color: "#000000", opacity: 80, cornerRadius: 20 },
  box: { hPadding: 25, vPadding: 15, charWidth: 0.6 },
  position: { alignment: 5, marginV: 40, marginL: 40, marginR: 40 }
}

const fontOptions = [
  "Arial", "Calibri", "Helvetica", "Verdana", "Tahoma",
  "Times New Roman", "Georgia", "Roboto", "Open Sans", "Montserrat"
]

export default function SubtitleSettingsPage() {
  const [settings, setSettings] = useState<SubtitleSettings>(defaultSettings)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")

  // Load settings on mount
  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const res = await fetch("/api/subtitle-settings")
      const data = await res.json()
      if (data.success && data.settings) {
        setSettings(data.settings)
      }
    } catch (error) {
      console.error("Error loading settings:", error)
    } finally {
      setLoading(false)
    }
  }

  const saveSettings = async () => {
    setSaving(true)
    setMessage("")
    try {
      const res = await fetch("/api/subtitle-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings)
      })
      const data = await res.json()
      if (data.success) {
        setMessage("Settings saved successfully!")
        setTimeout(() => setMessage(""), 3000)
      } else {
        setMessage("Failed to save settings")
      }
    } catch (error) {
      setMessage("Error saving settings")
    } finally {
      setSaving(false)
    }
  }

  const resetToDefaults = () => {
    setSettings(defaultSettings)
    setMessage("Reset to defaults (click Save to apply)")
  }

  const updateFont = (key: keyof SubtitleSettings["font"], value: string | number) => {
    setSettings(prev => ({ ...prev, font: { ...prev.font, [key]: value } }))
  }

  const updateBackground = (key: keyof SubtitleSettings["background"], value: string | number) => {
    setSettings(prev => ({ ...prev, background: { ...prev.background, [key]: value } }))
  }

  const updateBox = (key: keyof SubtitleSettings["box"], value: number) => {
    setSettings(prev => ({ ...prev, box: { ...prev.box, [key]: value } }))
  }

  const updatePosition = (key: keyof SubtitleSettings["position"], value: number) => {
    setSettings(prev => ({ ...prev, position: { ...prev.position, [key]: value } }))
  }

  if (loading) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center">Loading settings...</div>
      </div>
    )
  }

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-cyan-400">Subtitle Settings</h1>
        <p className="text-gray-400 mt-2">Customize how subtitles appear in generated videos</p>
      </div>

      <div className="grid gap-6">
        {/* Font Settings */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-cyan-400">Font Settings</CardTitle>
            <CardDescription>Configure text appearance</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="fontFamily">Font Family</Label>
                <Select value={settings.font.family} onValueChange={(v) => updateFont("family", v)}>
                  <SelectTrigger className="bg-gray-800 border-gray-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {fontOptions.map(font => (
                      <SelectItem key={font} value={font}>{font}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="fontSize">Font Size (px)</Label>
                <Input
                  id="fontSize"
                  type="number"
                  min="20"
                  max="100"
                  value={settings.font.size}
                  onChange={(e) => updateFont("size", parseInt(e.target.value) || 48)}
                  className="bg-gray-800 border-gray-700"
                />
              </div>
              <div>
                <Label htmlFor="fontColor">Text Color</Label>
                <div className="flex gap-2">
                  <Input
                    id="fontColor"
                    type="color"
                    value={settings.font.color}
                    onChange={(e) => updateFont("color", e.target.value)}
                    className="w-16 h-10 p-1 bg-gray-800 border-gray-700"
                  />
                  <Input
                    type="text"
                    value={settings.font.color}
                    onChange={(e) => updateFont("color", e.target.value)}
                    className="bg-gray-800 border-gray-700 flex-1"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Background Box Settings */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-cyan-400">Background Box Settings</CardTitle>
            <CardDescription>Configure the subtitle background box</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="bgColor">Box Color</Label>
                <div className="flex gap-2">
                  <Input
                    id="bgColor"
                    type="color"
                    value={settings.background.color}
                    onChange={(e) => updateBackground("color", e.target.value)}
                    className="w-16 h-10 p-1 bg-gray-800 border-gray-700"
                  />
                  <Input
                    type="text"
                    value={settings.background.color}
                    onChange={(e) => updateBackground("color", e.target.value)}
                    className="bg-gray-800 border-gray-700 flex-1"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="opacity">Opacity ({settings.background.opacity}%)</Label>
                <Input
                  id="opacity"
                  type="range"
                  min="0"
                  max="100"
                  value={settings.background.opacity}
                  onChange={(e) => updateBackground("opacity", parseInt(e.target.value))}
                  className="bg-gray-800"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>Transparent</span>
                  <span>Opaque</span>
                </div>
              </div>
              <div>
                <Label htmlFor="cornerRadius">Corner Radius (px)</Label>
                <Input
                  id="cornerRadius"
                  type="number"
                  min="0"
                  max="50"
                  value={settings.background.cornerRadius}
                  onChange={(e) => updateBackground("cornerRadius", parseInt(e.target.value) || 0)}
                  className="bg-gray-800 border-gray-700"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Box Size Settings */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-cyan-400">Box Size Settings</CardTitle>
            <CardDescription>Fine-tune box dimensions</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="hPadding">Horizontal Padding (px)</Label>
                <Input
                  id="hPadding"
                  type="number"
                  min="0"
                  max="50"
                  value={settings.box.hPadding}
                  onChange={(e) => updateBox("hPadding", parseInt(e.target.value) || 0)}
                  className="bg-gray-800 border-gray-700"
                />
              </div>
              <div>
                <Label htmlFor="vPadding">Vertical Padding (px)</Label>
                <Input
                  id="vPadding"
                  type="number"
                  min="0"
                  max="50"
                  value={settings.box.vPadding}
                  onChange={(e) => updateBox("vPadding", parseInt(e.target.value) || 0)}
                  className="bg-gray-800 border-gray-700"
                />
              </div>
              <div>
                <Label htmlFor="charWidth">Char Width ({settings.box.charWidth})</Label>
                <Input
                  id="charWidth"
                  type="range"
                  min="0.3"
                  max="0.7"
                  step="0.01"
                  value={settings.box.charWidth}
                  onChange={(e) => updateBox("charWidth", parseFloat(e.target.value))}
                  className="bg-gray-800"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>Narrower</span>
                  <span>Wider</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Position Settings */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-cyan-400">Position Settings</CardTitle>
            <CardDescription>Control subtitle placement</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Alignment</Label>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {[7, 8, 9, 4, 5, 6, 1, 2, 3].map((num) => (
                    <Button
                      key={num}
                      variant={settings.position.alignment === num ? "default" : "outline"}
                      className={`h-10 ${settings.position.alignment === num ? "bg-cyan-600" : "bg-gray-800"}`}
                      onClick={() => updatePosition("alignment", num)}
                    >
                      {num === 7 ? "TL" : num === 8 ? "T" : num === 9 ? "TR" :
                       num === 4 ? "L" : num === 5 ? "C" : num === 6 ? "R" :
                       num === 1 ? "BL" : num === 2 ? "B" : "BR"}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">TL=Top-Left, C=Center, B=Bottom, etc.</p>
              </div>
              <div className="grid gap-3">
                <div>
                  <Label htmlFor="marginV">Vertical Margin (px)</Label>
                  <Input
                    id="marginV"
                    type="number"
                    min="0"
                    max="200"
                    value={settings.position.marginV}
                    onChange={(e) => updatePosition("marginV", parseInt(e.target.value) || 0)}
                    className="bg-gray-800 border-gray-700"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="marginL">Left Margin</Label>
                    <Input
                      id="marginL"
                      type="number"
                      min="0"
                      max="200"
                      value={settings.position.marginL}
                      onChange={(e) => updatePosition("marginL", parseInt(e.target.value) || 0)}
                      className="bg-gray-800 border-gray-700"
                    />
                  </div>
                  <div>
                    <Label htmlFor="marginR">Right Margin</Label>
                    <Input
                      id="marginR"
                      type="number"
                      min="0"
                      max="200"
                      value={settings.position.marginR}
                      onChange={(e) => updatePosition("marginR", parseInt(e.target.value) || 0)}
                      className="bg-gray-800 border-gray-700"
                    />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Preview */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-cyan-400">Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative bg-gray-800 rounded-lg overflow-hidden" style={{ aspectRatio: "16/9" }}>
              <div
                className="absolute flex items-center justify-center"
                style={{
                  ...(settings.position.alignment <= 3 ? { bottom: settings.position.marginV } :
                      settings.position.alignment >= 7 ? { top: settings.position.marginV } :
                      { top: "50%", transform: "translateY(-50%)" }),
                  ...([1, 4, 7].includes(settings.position.alignment) ? { left: settings.position.marginL } :
                      [3, 6, 9].includes(settings.position.alignment) ? { right: settings.position.marginR } :
                      { left: "50%", transform: `translateX(-50%)${settings.position.alignment >= 4 && settings.position.alignment <= 6 ? " translateY(-50%)" : ""}` }),
                }}
              >
                <div
                  style={{
                    backgroundColor: settings.background.color,
                    opacity: settings.background.opacity / 100,
                    borderRadius: settings.background.cornerRadius,
                    padding: `${settings.box.vPadding}px ${settings.box.hPadding}px`,
                  }}
                >
                  <span
                    style={{
                      fontFamily: settings.font.family,
                      fontSize: `${settings.font.size / 3}px`,
                      color: settings.font.color,
                    }}
                  >
                    Sample Subtitle Text
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex gap-4 justify-end">
          <Button variant="outline" onClick={resetToDefaults} className="bg-gray-800">
            Reset to Defaults
          </Button>
          <Button onClick={saveSettings} disabled={saving} className="bg-cyan-600 hover:bg-cyan-700">
            {saving ? "Saving..." : "Save Settings"}
          </Button>
        </div>

        {message && (
          <div className={`text-center p-3 rounded ${message.includes("success") ? "bg-green-900 text-green-300" : "bg-red-900 text-red-300"}`}>
            {message}
          </div>
        )}
      </div>
    </div>
  )
}
