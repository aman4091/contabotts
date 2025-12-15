#!/usr/bin/env python3
"""
Telegram Bot for Audio Queue
Sends scripts to Telegram - ONLY scripts, no other messages
"""

import os
import sys
import time
import logging
import requests
import tempfile

# Telegram Bot setup
BOT_TOKEN = "7865909076:AAElJmFN2awcf-4v_jJ53aJJEls1N0tZNSQ"
CHAT_ID = "-1002498893774"

# File server config
FILE_SERVER_URL = os.getenv("FILE_SERVER_URL", "http://localhost:8000")
FILE_SERVER_API_KEY = os.getenv("FILE_SERVER_API_KEY", "tts-secret-key-2024")

# Polling interval
POLL_INTERVAL = 10

# Track processed jobs
processed_jobs = set()

# Logging
logging.basicConfig(
    format='%(asctime)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)


def get_pending_jobs():
    """Get all pending jobs from file server"""
    try:
        response = requests.get(
            f"{FILE_SERVER_URL}/queue/audio/jobs",
            params={"status": "pending"},
            headers={"x-api-key": FILE_SERVER_API_KEY},
            timeout=30
        )
        if response.status_code == 200:
            return response.json().get("jobs", [])
        return []
    except Exception as e:
        logger.error(f"Error fetching jobs: {e}")
        return []


def get_unsent_jobs(jobs: list) -> list:
    """Get jobs that haven't been sent to Telegram yet, sorted by created_at"""
    unsent = [j for j in jobs if not j.get("telegram_sent", False)]
    unsent.sort(key=lambda x: x.get("created_at", ""))
    return unsent


def mark_job_as_sent(job_id: str):
    """Mark job as sent to telegram"""
    try:
        response = requests.post(
            f"{FILE_SERVER_URL}/queue/audio/jobs/{job_id}/update",
            headers={
                "Content-Type": "application/json",
                "x-api-key": FILE_SERVER_API_KEY
            },
            json={"telegram_sent": True},
            timeout=30
        )
        return response.status_code == 200
    except Exception as e:
        logger.error(f"Error marking job: {e}")
        return False


def send_script_document(file_path: str, caption: str):
    """Send script file to Telegram"""
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


def send_script_to_telegram(job: dict):
    """Send job script to Telegram"""
    job_id = job.get("job_id", "")
    script_text = job.get("script_text", "")
    channel_code = job.get("channel_code", "VIDEO")
    video_number = job.get("video_number", 0)
    audio_counter = job.get("audio_counter", 0)

    if not script_text:
        logger.warning(f"Job {job_id[:8]} has no script, skipping")
        return False

    logger.info(f"Sending: #{audio_counter} - {channel_code} V{video_number}")

    # Create temp file
    with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8') as f:
        f.write(script_text)
        temp_file = f.name

    try:
        # Rename to proper filename with video_number
        filename = f"script_{video_number}.txt"
        new_path = os.path.join(os.path.dirname(temp_file), filename)
        os.rename(temp_file, new_path)
        temp_file = new_path

        # Caption with job info
        caption = f"<b>#{audio_counter}</b> | {channel_code} V{video_number}"

        if send_script_document(temp_file, caption):
            logger.info(f"Sent script #{audio_counter} V{video_number}")
            mark_job_as_sent(job_id)
            processed_jobs.add(job_id)
            return True
        else:
            logger.error(f"Failed to send script #{audio_counter}")
            return False
    finally:
        if os.path.exists(temp_file):
            os.remove(temp_file)


def main_loop():
    """Main loop - sends ALL unsent scripts"""
    logger.info("=" * 50)
    logger.info("Audio Telegram Bot Started")
    logger.info(f"Poll interval: {POLL_INTERVAL}s")
    logger.info("=" * 50)

    # NO startup message to Telegram!

    while True:
        try:
            jobs = get_pending_jobs()

            if jobs:
                unsent = get_unsent_jobs(jobs)

                for job in unsent:
                    job_id = job.get("job_id", "")
                    if job_id not in processed_jobs:
                        send_script_to_telegram(job)
                        time.sleep(1)

            # Cleanup
            if len(processed_jobs) > 1000:
                processed_list = list(processed_jobs)
                processed_jobs.clear()
                processed_jobs.update(processed_list[-500:])

        except Exception as e:
            logger.error(f"Error in main loop: {e}")

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    try:
        main_loop()
    except KeyboardInterrupt:
        logger.info("Bot stopped")
        sys.exit(0)
