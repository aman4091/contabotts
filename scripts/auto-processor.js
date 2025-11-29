#!/usr/bin/env node

/**
 * Auto Processor Script
 * Runs daily at midnight to process videos from monitored channels
 *
 * Flow:
 * 1. Load all users with auto-processing channels
 * 2. For each user's active channels:
 *    - Check if pool needs refresh (>7 days old)
 *    - Get unprocessed videos (top N by views)
 *    - Fetch transcript via Supadata
 *    - Generate script via Gemini
 *    - Add to audio queue with priority 1
 *    - Mark video as processed
 */

const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')

// Load environment from .env.local
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') })

const DATA_DIR = process.env.DATA_DIR || '/root/tts/data'
const FILE_SERVER_URL = process.env.FILE_SERVER_URL || ''
const FILE_SERVER_API_KEY = process.env.FILE_SERVER_API_KEY || ''
const SUPADATA_API_KEY = process.env.SUPADATA_API_KEY || ''
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || ''
const MAX_VIDEOS_PER_DAY = 4

// Logging
function log(message, ...args) {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] ${message}`, ...args)
}

function error(message, ...args) {
  const timestamp = new Date().toISOString()
  console.error(`[${timestamp}] ERROR: ${message}`, ...args)
}

// Date utilities
function getTomorrowDate() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return date.toISOString().split('T')[0]
}

function addDays(dateStr, days) {
  const date = new Date(dateStr)
  date.setDate(date.getDate() + days)
  return date.toISOString().split('T')[0]
}

// File helpers
function loadJSON(filePath) {
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    } catch {
      return null
    }
  }
  return null
}

function saveJSON(filePath, data) {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

// Get all users with auto-processing channels
function getUsers() {
  const usersDir = path.join(DATA_DIR, 'users')
  if (!fs.existsSync(usersDir)) return []

  return fs.readdirSync(usersDir)
    .filter(name => {
      const userPath = path.join(usersDir, name)
      return fs.statSync(userPath).isDirectory()
    })
}

// Load user's channels
function loadChannels(username) {
  const filePath = path.join(DATA_DIR, 'users', username, 'auto-processing', 'channels.json')
  const data = loadJSON(filePath)
  return data?.channels || []
}

function saveChannels(username, channels) {
  const filePath = path.join(DATA_DIR, 'users', username, 'auto-processing', 'channels.json')
  saveJSON(filePath, { channels })
}

// Load video pool
function loadVideoPool(username, channelId) {
  const filePath = path.join(DATA_DIR, 'users', username, 'auto-processing', 'videos', `${channelId}.json`)
  return loadJSON(filePath) || { videoPool: [], processedVideoIds: [], lastPoolRefreshAt: null }
}

function saveVideoPool(username, channelId, data) {
  const filePath = path.join(DATA_DIR, 'users', username, 'auto-processing', 'videos', `${channelId}.json`)
  saveJSON(filePath, data)
}

// Load settings
function getSettings() {
  const filePath = path.join(DATA_DIR, 'settings.json')
  return loadJSON(filePath) || { prompts: { youtube: '' }, ai: { model: 'gemini-2.0-flash-exp' } }
}

// Get next video number for slot
function getNextVideoNumber(date, channelCode) {
  const channelPath = path.join(DATA_DIR, 'organized', date, channelCode)
  if (!fs.existsSync(channelPath)) return 1

  const folders = fs.readdirSync(channelPath)
    .filter(f => f.startsWith('video_'))
    .map(f => parseInt(f.replace('video_', '')))
    .filter(n => !isNaN(n))

  if (folders.length === 0) return 1
  return Math.max(...folders) + 1
}

// Save to organized folder
function saveToOrganized(date, channelCode, videoNumber, transcript, script) {
  const folderPath = path.join(DATA_DIR, 'organized', date, channelCode, `video_${videoNumber}`)
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true })
  }
  fs.writeFileSync(path.join(folderPath, 'transcript.txt'), transcript)
  fs.writeFileSync(path.join(folderPath, 'script.txt'), script)
  return folderPath
}

// Fetch transcript from Supadata
async function fetchTranscript(videoId) {
  if (!SUPADATA_API_KEY) {
    error('SUPADATA_API_KEY not configured')
    return null
  }

  try {
    const res = await fetch(`https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}`, {
      headers: { 'x-api-key': SUPADATA_API_KEY }
    })

    if (!res.ok) {
      error(`Supadata error for ${videoId}: ${res.status}`)
      return null
    }

    const data = await res.json()

    if (data.content && Array.isArray(data.content)) {
      return data.content.map(segment => segment.text).join(' ')
    }
    if (typeof data.transcript === 'string') {
      return data.transcript
    }
    if (data.text) {
      return data.text
    }

    return null
  } catch (err) {
    error(`Error fetching transcript for ${videoId}:`, err.message)
    return null
  }
}

// Generate script with Gemini
async function generateScript(transcript, prompt, model = 'gemini-2.0-flash-exp') {
  if (!GEMINI_API_KEY) {
    error('GEMINI_API_KEY not configured')
    return null
  }

  try {
    const maxChunkSize = 7000
    const chunks = splitIntoChunks(transcript, maxChunkSize)
    const results = []

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const chunkPrompt = chunks.length > 1
        ? `${prompt}\n\n[Part ${i + 1} of ${chunks.length}]\n\n${chunk}`
        : `${prompt}\n\n${chunk}`

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: chunkPrompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 8192 }
        })
      })

      if (!res.ok) {
        error(`Gemini error: ${res.status}`)
        return null
      }

      const data = await res.json()
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text

      if (text) {
        results.push(text)
      } else {
        return null
      }

      // Delay between chunks
      if (i < chunks.length - 1) {
        await sleep(500)
      }
    }

    return results.join('\n\n')
  } catch (err) {
    error('Error generating script:', err.message)
    return null
  }
}

function splitIntoChunks(text, maxSize) {
  if (text.length <= maxSize) return [text]

  const chunks = []
  const sentences = text.split(/(?<=[.!?])\s+/)
  let currentChunk = ''

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > maxSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim())
      currentChunk = sentence
    } else {
      currentChunk += (currentChunk ? ' ' : '') + sentence
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim())
  }

  return chunks
}

// Add to audio queue
async function addToQueue(username, targetChannel, transcript, script) {
  try {
    // Find next available slot
    let date = getTomorrowDate()
    let videoNumber = getNextVideoNumber(date, targetChannel)
    let daysChecked = 0

    while (videoNumber > MAX_VIDEOS_PER_DAY && daysChecked < 30) {
      daysChecked++
      date = addDays(date, 1)
      videoNumber = getNextVideoNumber(date, targetChannel)
    }

    if (videoNumber > MAX_VIDEOS_PER_DAY) {
      error(`No available slots for ${targetChannel}`)
      return { success: false, error: 'No available slots' }
    }

    // Get audio counter
    const counterRes = await fetch(`${FILE_SERVER_URL}/counter/increment/audio`, {
      method: 'POST',
      headers: { 'x-api-key': FILE_SERVER_API_KEY }
    })
    const counterData = await counterRes.json()
    const audioCounter = counterData.value || Date.now() % 1000000

    // Save to organized folder
    const organizedPath = `/organized/${date}/${targetChannel}/video_${videoNumber}`
    saveToOrganized(date, targetChannel, videoNumber, transcript, script)

    // Create job with priority 1 (low)
    const jobId = randomUUID()
    const jobRes = await fetch(`${FILE_SERVER_URL}/queue/audio/jobs`, {
      method: 'POST',
      headers: {
        'x-api-key': FILE_SERVER_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        job_id: jobId,
        script_text: script,
        channel_code: targetChannel,
        video_number: videoNumber,
        date: date,
        audio_counter: audioCounter,
        organized_path: organizedPath,
        priority: 1, // LOW priority for auto-processing
        username: username
      })
    })

    if (!jobRes.ok) {
      error('Failed to create job')
      return { success: false, error: 'Failed to create job' }
    }

    log(`Queued: ${targetChannel} V${videoNumber} for ${date}`)
    return { success: true, date, videoNumber }
  } catch (err) {
    error('Error adding to queue:', err.message)
    return { success: false, error: err.message }
  }
}

// Refresh video pool from YouTube
async function refreshVideoPool(channelId, minDuration, maxDuration) {
  if (!YOUTUBE_API_KEY) {
    error('YOUTUBE_API_KEY not configured')
    return []
  }

  try {
    // Get uploads playlist ID
    const channelRes = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${YOUTUBE_API_KEY}`)
    const channelData = await channelRes.json()
    const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads

    if (!uploadsPlaylistId) return []

    // Fetch videos from playlist
    const videos = []
    let pageToken = ''

    while (videos.length < 1500) {
      const playlistUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=50&pageToken=${pageToken}&key=${YOUTUBE_API_KEY}`
      const res = await fetch(playlistUrl)
      const data = await res.json()

      if (!data.items) break

      for (const item of data.items) {
        videos.push({
          videoId: item.snippet.resourceId.videoId,
          title: item.snippet.title
        })
      }

      pageToken = data.nextPageToken || ''
      if (!pageToken) break
    }

    // Get video details
    const detailedVideos = []

    for (let i = 0; i < videos.length; i += 50) {
      const batch = videos.slice(i, i + 50)
      const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics,snippet&id=${batch.map(v => v.videoId).join(',')}&key=${YOUTUBE_API_KEY}`
      const res = await fetch(url)
      const data = await res.json()

      if (data.items) {
        for (const item of data.items) {
          const duration = parseDuration(item.contentDetails.duration)
          if (duration >= minDuration && duration <= maxDuration) {
            detailedVideos.push({
              videoId: item.id,
              title: item.snippet.title,
              duration,
              viewCount: parseInt(item.statistics.viewCount || '0'),
              publishedAt: item.snippet.publishedAt
            })
          }
        }
      }
    }

    // Sort by view count and take top 1000
    detailedVideos.sort((a, b) => b.viewCount - a.viewCount)
    return detailedVideos.slice(0, 1000)
  } catch (err) {
    error('Error refreshing video pool:', err.message)
    return []
  }
}

function parseDuration(iso8601) {
  const match = iso8601.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return 0

  const hours = parseInt(match[1] || '0')
  const minutes = parseInt(match[2] || '0')
  const seconds = parseInt(match[3] || '0')

  return hours * 3600 + minutes * 60 + seconds
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Process a single channel
async function processChannel(username, channel, settings) {
  log(`Processing: ${channel.sourceChannelName} -> ${channel.targetChannelCode}`)

  const result = {
    channelName: channel.sourceChannelName,
    queued: 0,
    errors: []
  }

  try {
    // Load video pool
    let poolData = loadVideoPool(username, channel.sourceChannelId)

    // Check if pool needs refresh (>7 days old)
    const lastRefresh = poolData.lastPoolRefreshAt ? new Date(poolData.lastPoolRefreshAt) : null
    const needsRefresh = !lastRefresh || (Date.now() - lastRefresh.getTime() > 7 * 24 * 60 * 60 * 1000)

    if (needsRefresh) {
      log(`Refreshing video pool for ${channel.sourceChannelName}...`)
      const newPool = await refreshVideoPool(channel.sourceChannelId, channel.minDuration, channel.maxDuration)
      if (newPool.length > 0) {
        poolData.videoPool = newPool
        poolData.lastPoolRefreshAt = new Date().toISOString()
        // Keep processedVideoIds intact
        saveVideoPool(username, channel.sourceChannelId, poolData)
        log(`Pool refreshed: ${newPool.length} videos`)
      }
    }

    // Get unprocessed videos
    const processedSet = new Set(poolData.processedVideoIds || [])
    const unprocessedVideos = (poolData.videoPool || [])
      .filter(v => !processedSet.has(v.videoId))
      .sort((a, b) => b.viewCount - a.viewCount)
      .slice(0, channel.dailyVideoCount)

    if (unprocessedVideos.length === 0) {
      log(`No unprocessed videos for ${channel.sourceChannelName}`)
      return result
    }

    log(`Processing ${unprocessedVideos.length} videos...`)

    // Process each video
    for (const video of unprocessedVideos) {
      try {
        log(`  Video: ${video.title.substring(0, 50)}...`)

        // 1. Fetch transcript
        const transcript = await fetchTranscript(video.videoId)
        if (!transcript) {
          result.errors.push(`No transcript: ${video.videoId}`)
          continue
        }

        // 2. Generate script
        const prompt = channel.customPrompt || settings.prompts?.youtube || ''
        const script = await generateScript(transcript, prompt, settings.ai?.model)
        if (!script) {
          result.errors.push(`Script failed: ${video.videoId}`)
          continue
        }

        // 3. Add to queue
        const queueResult = await addToQueue(username, channel.targetChannelCode, transcript, script)
        if (!queueResult.success) {
          result.errors.push(`Queue failed: ${video.videoId}`)
          continue
        }

        // 4. Mark as processed
        poolData.processedVideoIds.push(video.videoId)
        result.queued++

        // Delay between videos
        await sleep(1000)

      } catch (videoError) {
        result.errors.push(`Error: ${video.videoId} - ${videoError.message}`)
      }
    }

    // Save updated pool
    saveVideoPool(username, channel.sourceChannelId, poolData)

    // Update lastProcessedAt
    channel.lastProcessedAt = new Date().toISOString()

  } catch (err) {
    result.errors.push(`Channel error: ${err.message}`)
  }

  return result
}

// Main function
async function main() {
  log('=== Auto Processing Started ===')

  const users = getUsers()
  log(`Found ${users.length} users`)

  const settings = getSettings()
  let totalQueued = 0

  for (const username of users) {
    log(`\n--- User: ${username} ---`)

    const channels = loadChannels(username)
    const activeChannels = channels.filter(ch => ch.isActive)

    if (activeChannels.length === 0) {
      log('No active channels')
      continue
    }

    log(`Active channels: ${activeChannels.length}`)

    for (const channel of activeChannels) {
      const result = await processChannel(username, channel, settings)
      totalQueued += result.queued

      if (result.queued > 0) {
        log(`Queued ${result.queued} videos for ${channel.sourceChannelName}`)
      }
      if (result.errors.length > 0) {
        log(`Errors: ${result.errors.join(', ')}`)
      }
    }

    // Save updated channels (with lastProcessedAt)
    saveChannels(username, channels)
  }

  log(`\n=== Auto Processing Complete ===`)
  log(`Total videos queued: ${totalQueued}`)
}

// Run
main().catch(err => {
  error('Fatal error:', err)
  process.exit(1)
})
