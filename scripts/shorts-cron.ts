#!/usr/bin/env npx ts-node

/**
 * Shorts Cron Job
 *
 * This script runs daily to automatically generate shorts from processed scripts.
 * - Max 3 scripts per user per day
 * - 10 shorts per script = 30 shorts max per user per day
 *
 * Run manually: npx ts-node scripts/shorts-cron.ts
 * Or with PM2: pm2 start scripts/shorts-cron.ts --cron "0 6 * * *"
 */

import * as dotenv from "dotenv"
import * as path from "path"

// Load environment variables
dotenv.config({ path: path.join(__dirname, "../.env.local") })
dotenv.config({ path: path.join(__dirname, "../.env") })

import { processShortsForAllUsers } from "../lib/shorts-worker"

async function main() {
  console.log("Starting shorts cron job...")
  console.log(`Time: ${new Date().toISOString()}`)

  try {
    await processShortsForAllUsers()
    console.log("Shorts cron job completed successfully")
    process.exit(0)
  } catch (error) {
    console.error("Shorts cron job failed:", error)
    process.exit(1)
  }
}

main()
