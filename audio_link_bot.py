#!/usr/bin/env python3
"""
Audio Link Bot - Runs on Vast.ai
Monitors Telegram chat for FinalWorkingBot audio links

Flow:
1. Poll Contabo for pending "finalbot" jobs
2. Send script to Telegram chat (for FinalWorkingBot to process)
3. Wait for FinalWorkingBot response (first Gofile link)
4. Update Contabo with audio link
5. Contabo creates video job
"""

import os
import re
import asyncio
import requests
from datetime import datetime
from telegram import Update, Bot
from telegram.ext import Application, MessageHandler, filters, ContextTypes

# ============================================================================
# CONFIGURATION (Update in p.py or environment)
# ============================================================================

BOT_TOKEN = os.getenv("AUDIO_LINK_BOT_TOKEN", "")
CHAT_ID = os.getenv("AUDIO_LINK_CHAT_ID", "")  # Chat where both bots are
FILE_SERVER_URL = os.getenv("FILE_SERVER_URL", "")
FILE_SERVER_API_KEY = os.getenv("FILE_SERVER_API_KEY", "")

POLL_INTERVAL = 30  # seconds

# ============================================================================
# STATE TRACKING
# ============================================================================

class JobTracker:
    """Track pending jobs waiting for audio links"""
    def __init__(self):
        self.pending_jobs = {}  # job_id -> job_data
        self.current_job = None  # Currently waiting for response

    def add_job(self, job_id: str, job_data: dict):
        self.pending_jobs[job_id] = job_data

    def set_current(self, job_id: str):
        self.current_job = job_id

    def get_current(self):
        if self.current_job and self.current_job in self.pending_jobs:
            return self.current_job, self.pending_jobs[self.current_job]
        return None, None

    def complete_current(self, audio_url: str):
        if self.current_job:
            job_data = self.pending_jobs.pop(self.current_job, None)
            completed_job = self.current_job
            self.current_job = None
            return completed_job, job_data
        return None, None

tracker = JobTracker()

# ============================================================================
# CONTABO API
# ============================================================================

def get_pending_finalbot_jobs():
    """Get pending jobs that need FinalWorkingBot processing"""
    try:
        r = requests.get(
            f"{FILE_SERVER_URL}/finalbot/pending",
            headers={"x-api-key": FILE_SERVER_API_KEY},
            timeout=30
        )
        if r.status_code == 200:
            return r.json().get("jobs", [])
        return []
    except Exception as e:
        print(f"Error fetching jobs: {e}")
        return []

def claim_finalbot_job(job_id: str):
    """Claim a finalbot job"""
    try:
        r = requests.post(
            f"{FILE_SERVER_URL}/finalbot/claim/{job_id}",
            headers={"x-api-key": FILE_SERVER_API_KEY},
            timeout=30
        )
        return r.status_code == 200
    except:
        return False

def update_finalbot_job(job_id: str, audio_url: str):
    """Update job with audio URL - this triggers video job creation"""
    try:
        r = requests.post(
            f"{FILE_SERVER_URL}/finalbot/complete/{job_id}",
            headers={"x-api-key": FILE_SERVER_API_KEY, "Content-Type": "application/json"},
            json={"audio_url": audio_url},
            timeout=30
        )
        return r.status_code == 200
    except Exception as e:
        print(f"Error updating job: {e}")
        return False

# ============================================================================
# GOFILE LINK DETECTION
# ============================================================================

GOFILE_PATTERN = re.compile(r'https?://gofile\.io/d/[a-zA-Z0-9]+')

def extract_gofile_link(text: str) -> str:
    """Extract first Gofile link from text"""
    match = GOFILE_PATTERN.search(text)
    return match.group(0) if match else None

# ============================================================================
# TELEGRAM HANDLERS
# ============================================================================

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle incoming messages - look for Gofile links from FinalWorkingBot"""
    if not update.message or not update.message.text:
        return

    # Only process messages from the target chat
    if str(update.effective_chat.id) != str(CHAT_ID):
        return

    # Check if we're waiting for a response
    job_id, job_data = tracker.get_current()
    if not job_id:
        return  # Not waiting for any job

    # Look for Gofile link
    text = update.message.text
    gofile_link = extract_gofile_link(text)

    if gofile_link:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] Got Gofile link: {gofile_link}")
        print(f"   For job: {job_id[:8]}... ({job_data.get('channel_code')} #{job_data.get('video_number')})")

        # Complete the job
        completed_job, completed_data = tracker.complete_current(gofile_link)

        if completed_job:
            # Update Contabo
            if update_finalbot_job(completed_job, gofile_link):
                print(f"   Video job will be created on Contabo")
            else:
                print(f"   Failed to update Contabo!")

# ============================================================================
# JOB PROCESSOR
# ============================================================================

async def process_pending_jobs(bot: Bot):
    """Check for pending jobs and send scripts to chat"""
    # Get pending jobs from Contabo
    jobs = get_pending_finalbot_jobs()

    for job in jobs:
        job_id = job.get("job_id")
        if not job_id or job_id in tracker.pending_jobs:
            continue

        # Claim the job
        if not claim_finalbot_job(job_id):
            continue

        print(f"\n[{datetime.now().strftime('%H:%M:%S')}] New FinalBot job: {job_id[:8]}...")
        print(f"   Channel: {job.get('channel_code')} | Video: #{job.get('video_number')} | Date: {job.get('date')}")

        # Add to tracker
        tracker.add_job(job_id, job)
        tracker.set_current(job_id)

        # Send script to chat
        script = job.get("script_text", "")
        if script:
            try:
                # Send script (FinalWorkingBot will pick it up)
                await bot.send_message(
                    chat_id=CHAT_ID,
                    text=script
                )
                print(f"   Script sent to chat ({len(script)} chars)")
                print(f"   Waiting for FinalWorkingBot response...")
            except Exception as e:
                print(f"   Failed to send script: {e}")
                tracker.complete_current(None)  # Remove from tracking

        # Process one job at a time
        break

async def job_poller(bot: Bot):
    """Background task to poll for jobs"""
    print(f"Job poller started (interval: {POLL_INTERVAL}s)")

    while True:
        try:
            # Only check for new jobs if not currently waiting
            if tracker.current_job is None:
                await process_pending_jobs(bot)

            await asyncio.sleep(POLL_INTERVAL)

        except Exception as e:
            print(f"Poller error: {e}")
            await asyncio.sleep(10)

# ============================================================================
# MAIN
# ============================================================================

async def main():
    print("=" * 60)
    print("AUDIO LINK BOT - FinalWorkingBot Monitor")
    print("=" * 60)

    if not BOT_TOKEN:
        print("ERROR: AUDIO_LINK_BOT_TOKEN not set!")
        return
    if not CHAT_ID:
        print("ERROR: AUDIO_LINK_CHAT_ID not set!")
        return
    if not FILE_SERVER_URL:
        print("ERROR: FILE_SERVER_URL not set!")
        return

    print(f"Chat ID: {CHAT_ID}")
    print(f"File Server: {FILE_SERVER_URL}")
    print("=" * 60)

    # Create application
    app = Application.builder().token(BOT_TOKEN).build()

    # Add message handler
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    # Start polling for jobs in background
    asyncio.create_task(job_poller(app.bot))

    # Start the bot
    print("Bot started. Listening for messages...")
    await app.initialize()
    await app.start()
    await app.updater.start_polling(drop_pending_updates=True)

    # Keep running
    try:
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping bot...")
    finally:
        await app.updater.stop()
        await app.stop()
        await app.shutdown()

if __name__ == "__main__":
    asyncio.run(main())
