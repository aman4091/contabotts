import fs from 'fs'
import path from 'path'

const DATA_DIR = process.env.DATA_DIR || '/root/tts/data'

// Types
export interface SourceChannel {
  channel_code: string
  channel_name: string
  youtube_channel_url: string
  min_duration_seconds: number
  max_duration_seconds: number
  max_videos: number
  is_active: boolean
}

export interface TargetChannel {
  channel_code: string
  channel_name: string
  reference_audio: string
  is_active: boolean
}

export interface Settings {
  prompts: {
    youtube: string
    channel: string
  }
  ai: {
    provider: string
    model: string
    max_chunk_size: number
    temperature: number
  }
  audio: {
    chunk_size: number
    speed: number
    remove_silence: boolean
  }
  video: {
    default_image_folder: string
    subtitle_style: string
  }
}

export interface TranscriptFile {
  index: number
  title: string
  videoId: string
  charCount: number
  filename: string
}

// Helper functions
function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

// Source Channels
export function getSourceChannels(): SourceChannel[] {
  const filePath = path.join(DATA_DIR, 'source-channels.json')
  if (!fs.existsSync(filePath)) return []
  const content = fs.readFileSync(filePath, 'utf-8')
  return JSON.parse(content)
}

export function saveSourceChannels(channels: SourceChannel[]): void {
  const filePath = path.join(DATA_DIR, 'source-channels.json')
  fs.writeFileSync(filePath, JSON.stringify(channels, null, 2))
}

// Target Channels
export function getTargetChannels(): TargetChannel[] {
  const filePath = path.join(DATA_DIR, 'target-channels.json')
  if (!fs.existsSync(filePath)) return []
  const content = fs.readFileSync(filePath, 'utf-8')
  return JSON.parse(content)
}

export function saveTargetChannels(channels: TargetChannel[]): void {
  const filePath = path.join(DATA_DIR, 'target-channels.json')
  fs.writeFileSync(filePath, JSON.stringify(channels, null, 2))
}

// Settings
export function getSettings(): Settings {
  const filePath = path.join(DATA_DIR, 'settings.json')
  if (!fs.existsSync(filePath)) {
    return {
      prompts: { youtube: '', channel: '' },
      ai: { provider: 'gemini', model: 'gemini-2.0-flash', max_chunk_size: 7000, temperature: 0.7 },
      audio: { chunk_size: 500, speed: 1.0, remove_silence: true },
      video: { default_image_folder: 'nature', subtitle_style: '' }
    }
  }
  const content = fs.readFileSync(filePath, 'utf-8')
  return JSON.parse(content)
}

export function saveSettings(settings: Settings): void {
  const filePath = path.join(DATA_DIR, 'settings.json')
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2))
}

// Transcripts
export function getTranscriptsList(channelCode: string): TranscriptFile[] {
  const dirPath = path.join(DATA_DIR, 'transcripts', channelCode)
  if (!fs.existsSync(dirPath)) return []

  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.txt'))
  const transcripts: TranscriptFile[] = []

  for (const file of files) {
    const index = parseInt(file.replace('.txt', ''))
    if (isNaN(index)) continue

    const filePath = path.join(dirPath, file)
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')

    // Parse header
    let title = ''
    let videoId = ''
    for (const line of lines) {
      if (line.startsWith('Title:')) title = line.replace('Title:', '').trim()
      if (line.startsWith('Video ID:')) videoId = line.replace('Video ID:', '').trim()
    }

    transcripts.push({
      index,
      title,
      videoId,
      charCount: content.length,
      filename: file
    })
  }

  return transcripts.sort((a, b) => a.index - b.index)
}

export function getTranscript(channelCode: string, index: number): string | null {
  const filePath = path.join(DATA_DIR, 'transcripts', channelCode, `${index}.txt`)
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf-8')
}

export function saveTranscript(channelCode: string, index: number, title: string, videoId: string, transcript: string): void {
  const dirPath = path.join(DATA_DIR, 'transcripts', channelCode)
  ensureDir(dirPath)

  const content = `Title: ${title}\nVideo ID: ${videoId}\n\n${transcript}`
  const filePath = path.join(dirPath, `${index}.txt`)
  fs.writeFileSync(filePath, content)
}

export function skipTranscript(channelCode: string, index: number): boolean {
  const srcPath = path.join(DATA_DIR, 'transcripts', channelCode, `${index}.txt`)
  const destDir = path.join(DATA_DIR, 'skip', channelCode)
  const destPath = path.join(destDir, `${index}.txt`)

  if (!fs.existsSync(srcPath)) return false

  ensureDir(destDir)
  fs.renameSync(srcPath, destPath)
  return true
}

export function completeTranscript(channelCode: string, index: number): boolean {
  const srcPath = path.join(DATA_DIR, 'transcripts', channelCode, `${index}.txt`)
  const destDir = path.join(DATA_DIR, 'completed', channelCode)
  const destPath = path.join(destDir, `${index}.txt`)

  if (!fs.existsSync(srcPath)) return false

  ensureDir(destDir)
  fs.renameSync(srcPath, destPath)
  return true
}

// Organized folder
export function createOrganizedFolder(date: string, channelCode: string, videoNumber: number): string {
  const folderPath = path.join(DATA_DIR, 'organized', date, channelCode, `video_${videoNumber}`)
  ensureDir(folderPath)
  return folderPath
}

export function saveToOrganized(date: string, channelCode: string, videoNumber: number, transcript: string, script: string): string {
  const folderPath = createOrganizedFolder(date, channelCode, videoNumber)

  fs.writeFileSync(path.join(folderPath, 'transcript.txt'), transcript)
  fs.writeFileSync(path.join(folderPath, 'script.txt'), script)

  return folderPath
}

export function getNextVideoNumber(date: string, channelCode: string): number {
  const channelPath = path.join(DATA_DIR, 'organized', date, channelCode)
  if (!fs.existsSync(channelPath)) return 1

  const folders = fs.readdirSync(channelPath)
    .filter(f => f.startsWith('video_'))
    .map(f => parseInt(f.replace('video_', '')))
    .filter(n => !isNaN(n))

  if (folders.length === 0) return 1
  return Math.max(...folders) + 1
}

// Reference Audio
export function getReferenceAudioPath(filename: string): string {
  return path.join(DATA_DIR, 'reference-audio', filename)
}

export function referenceAudioExists(filename: string): boolean {
  return fs.existsSync(getReferenceAudioPath(filename))
}

// Images
export function getImagesPath(folder: string): string {
  return path.join(DATA_DIR, 'images', folder)
}

export function listImages(folder: string): string[] {
  const dirPath = getImagesPath(folder)
  if (!fs.existsSync(dirPath)) return []
  return fs.readdirSync(dirPath).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
}
