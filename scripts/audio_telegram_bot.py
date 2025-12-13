#!/usr/bin/env python3
"""
Telegram Bot for Audio-Only Jobs
Monitors queue for audio_only jobs, sends script to Telegram, converts to video_only_waiting
"""

import os
import sys
import json
import time
import logging
import requests
import tempfile
from datetime import datetime

# Telegram Bot setup
BOT_TOKEN = "7865909076:AAElJmFN2awcf-4v_jJ53aJJEls1N0tZNSQ"
CHAT_ID = "-1002498893774"

# File server config
FILE_SERVER_URL = os.getenv("FILE_SERVER_URL", "http://localhost:8000")
FILE_SERVER_API_KEY = os.getenv("FILE_SERVER_API_KEY", "tts-secret-key-2024")

# Polling interval in seconds
POLL_INTERVAL = 10

# Track processed jobs to avoid duplicate sends
processed_jobs = set()

# Logging
logging.basicConfig(
    format='%(asctime)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)


def get_pending_jobs():
    """Fetch ALL pending jobs from file server (not just audio_only)"""
    try:
        response = requests.get(
            f"{FILE_SERVER_URL}/queue/audio/jobs",
            params={"status": "pending"},
            headers={"x-api-key": FILE_SERVER_API_KEY},
            timeout=30
        )
        if response.status_code == 200:
            jobs = response.json().get("jobs", [])
            # Filter: only jobs that haven't been sent to telegram yet
            return [j for j in jobs if not j.get("telegram_sent", False)]
        else:
            logger.error(f"Failed to fetch jobs: {response.status_code}")
            return []
    except Exception as e:
        logger.error(f"Error fetching jobs: {e}")
        return []


def mark_job_as_sent(job_id: str):
    """Mark job as sent to telegram (add a flag so we don't send again)"""
    try:
        response = requests.post(
            f"{FILE_SERVER_URL}/queue/audio/jobs/{job_id}/update",
            headers={
                "Content-Type": "application/json",
                "x-api-key": FILE_SERVER_API_KEY
            },
            json={
                "telegram_sent": True
            },
            timeout=30
        )
        if response.status_code == 200:
            logger.info(f"Job {job_id[:8]} marked as telegram_sent")
            return True
        else:
            logger.error(f"Failed to mark job {job_id[:8]}: {response.status_code}")
            return False
    except Exception as e:
        logger.error(f"Error marking job {job_id[:8]}: {e}")
        return False


def send_telegram_message(text: str):
    """Send text message to Telegram"""
    try:
        response = requests.post(
            f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
            json={
                "chat_id": CHAT_ID,
                "text": text,
                "parse_mode": "HTML"
            },
            timeout=30
        )
        return response.status_code == 200
    except Exception as e:
        logger.error(f"Error sending message: {e}")
        return False


def send_telegram_document(file_path: str, caption: str = ""):
    """Send document to Telegram"""
    try:
        with open(file_path, 'rb') as f:
            response = requests.post(
                f"https://api.telegram.org/bot{BOT_TOKEN}/sendDocument",
                data={
                    "chat_id": CHAT_ID,
                    "caption": caption,
                    "parse_mode": "HTML"
                },
                files={"document": f},
                timeout=60
            )
        return response.status_code == 200
    except Exception as e:
        logger.error(f"Error sending document: {e}")
        return False


def process_audio_only_job(job: dict):
    """Process a single audio_only job"""
    job_id = job.get("job_id", "")
    script_text = job.get("script_text", "")
    channel_code = job.get("channel_code", "VIDEO")
    video_number = job.get("video_number", 0)
    audio_counter = job.get("audio_counter", 0)

    if not script_text:
        logger.warning(f"Job {job_id[:8]} has no script text, skipping")
        return False

    logger.info(f"Processing audio_only job: #{audio_counter} - {channel_code} V{video_number}")

    # Create temp file with script
    with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8') as f:
        f.write(script_text)
        temp_file = f.name

    try:
        # Prepare caption
        caption = f"<b>Audio Only Job</b>\n\n"
        caption += f"<b>#{audio_counter}</b> | {channel_code} V{video_number}\n"
        caption += f"<b>Job ID:</b> <code>{job_id[:8]}</code>\n\n"
        caption += f"<i>Add audio link on queue page when ready</i>"

        # Send script file
        filename = f"script_{audio_counter}_{channel_code}_V{video_number}.txt"
        os.rename(temp_file, os.path.join(os.path.dirname(temp_file), filename))
        temp_file = os.path.join(os.path.dirname(temp_file), filename)

        if send_telegram_document(temp_file, caption):
            logger.info(f"Script sent to Telegram for job #{audio_counter}")

            # Mark as sent so we don't send again
            mark_job_as_sent(job_id)
            processed_jobs.add(job_id)
            return True
        else:
            logger.error(f"Failed to send script for job #{audio_counter}")
            return False
    finally:
        # Cleanup temp file
        if os.path.exists(temp_file):
            os.remove(temp_file)


def main_loop():
    """Main polling loop"""
    logger.info("=" * 50)
    logger.info("Audio Telegram Bot Started")
    logger.info(f"Polling interval: {POLL_INTERVAL}s")
    logger.info(f"File Server: {FILE_SERVER_URL}")
    logger.info(f"Chat ID: {CHAT_ID}")
    logger.info("=" * 50)

    # Send startup message
    send_telegram_message("Audio Telegram Bot started and monitoring queue...")

    while True:
        try:
            jobs = get_pending_jobs()

            for job in jobs:
                job_id = job.get("job_id", "")

                # Skip already processed jobs
                if job_id in processed_jobs:
                    continue

                # Process ALL jobs (send script to telegram)
                process_audio_only_job(job)

            # Clean up processed jobs set (keep last 1000)
            if len(processed_jobs) > 1000:
                # Convert to list, keep last 500
                processed_list = list(processed_jobs)
                processed_jobs.clear()
                processed_jobs.update(processed_list[-500:])

        except Exception as e:
            logger.error(f"Error in main loop: {e}")

        # Wait before next poll
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    try:
        main_loop()
    except KeyboardInterrupt:
        logger.info("Bot stopped by user")
        send_telegram_message("Audio Telegram Bot stopped")
        sys.exit(0)
