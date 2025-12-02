#!/usr/bin/env node

/**
 * Shorts Cron Runner
 *
 * This calls the API endpoint to trigger shorts processing.
 * Easier to run with PM2 than TypeScript directly.
 *
 * Setup:
 *   pm2 start scripts/run-shorts-cron.js --cron "0 6 * * *" --no-autorestart
 *
 * This will run every day at 6 AM.
 *
 * Manual run:
 *   node scripts/run-shorts-cron.js
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env.local") })

const http = require("http")
const https = require("https")

const API_URL = process.env.SHORTS_CRON_URL || "http://localhost:3000/api/shorts/process"
const API_SECRET = process.env.SHORTS_CRON_SECRET || "shorts-auto-cron-2024"

async function triggerShortsCron() {
  console.log("========================================")
  console.log("SHORTS CRON JOB STARTED")
  console.log(`Time: ${new Date().toISOString()}`)
  console.log("========================================")

  try {
    const url = new URL(API_URL)
    const isHttps = url.protocol === "https:"
    const client = isHttps ? https : http

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": API_SECRET
      }
    }

    const req = client.request(options, (res) => {
      let data = ""
      res.on("data", (chunk) => { data += chunk })
      res.on("end", () => {
        console.log(`Response status: ${res.statusCode}`)
        try {
          const json = JSON.parse(data)
          console.log("Response:", JSON.stringify(json, null, 2))
        } catch {
          console.log("Response:", data)
        }
        console.log("========================================")
        console.log("SHORTS CRON JOB COMPLETED")
        console.log("========================================")
      })
    })

    req.on("error", (error) => {
      console.error("Request error:", error.message)
    })

    req.end()
  } catch (error) {
    console.error("Error:", error)
  }
}

triggerShortsCron()
