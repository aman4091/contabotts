#!/usr/bin/env python3
"""
Audio Folder Watcher
Watches external-audio folder, matches with ACTIVE job from telegram bot
"""

import os
import sys
import json
import time
import logging
import requests
import shutil
from pathlib import Path
from datetime import datetime

# Config
WATCH_FOLDER = "/root/tts/data/external-audio"
ACTIVE_JOB_FILE = Path("/root/tts/data/active_job.json")
FILE_SERVER_URL = "http://localhost:8000"  # For API calls
FILE_SERVER_EXTERNAL_URL = "http://38.242.144.132:8000"  # For audio URLs (Vast.ai access)
FILE_SERVER_API_KEY = "tts-secret-key-2024"
POLL_INTERVAL = 5  # Check every 5 seconds

# Track processed files to avoid reprocessing
processed_files = set()

# Logging
logging.basicConfig(
    format='%(asctime)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)


def get_active_job():
    """Get the active job from active_job.json (set by telegram bot)"""
    try:
        if not ACTIVE_JOB_FILE.exists():
            return None

        with open(ACTIVE_JOB_FILE) as f:
            active_data = json.load(f)

        # active_job.json has all info we need
        if active_data.get("job_id"):
            return active_data
        return None
    except Exception as e:
        logger.error(f"Error getting active job: {e}")
        return None


def clear_active_job():
    """Clear the active job file after matching"""
    try:
        if ACTIVE_JOB_FILE.exists():
            ACTIVE_JOB_FILE.unlink()
            logger.info("📌 Active job cleared")
    except Exception as e:
        logger.error(f"Error clearing active job: {e}")


def get_audio_files():
    """Get audio files from watch folder"""
    audio_extensions = {'.wav', '.mp3', '.m4a', '.ogg', '.flac'}
    files = []

    watch_path = Path(WATCH_FOLDER)
    if not watch_path.exists():
        return []

    for f in watch_path.iterdir():
        if f.is_file() and f.suffix.lower() in audio_extensions:
            # Skip already processed files
            if str(f) in processed_files:
                continue
            files.append(f)

    # Sort by modification time (oldest first)
    files.sort(key=lambda x: x.stat().st_mtime)
    return files


def update_job_with_audio(job_id: str, audio_url: str):
    """Update job with audio link (use_ai_image is set when job is created via popup)"""
    try:
        response = requests.post(
            f"{FILE_SERVER_URL}/queue/audio/jobs/{job_id}/update",
            headers={
                "Content-Type": "application/json",
                "x-api-key": FILE_SERVER_API_KEY
            },
            json={
                "existing_audio_link": audio_url
            },
            timeout=30
        )
        return response.status_code == 200
    except Exception as e:
        logger.error(f"Error updating job: {e}")
        return False


def move_audio_to_job_folder(audio_file: Path, job: dict):
    """Rename audio with job number and move to user-specific folder"""
    try:
        username = job.get("username", "default")
        video_number = job.get("video_number", 0)
        audio_counter = job.get("audio_counter", 0)

        # Create user-specific ready folder: /audio-ready/{username}/
        ready_folder = Path(f"/root/tts/data/audio-ready/{username}")
        ready_folder.mkdir(parents=True, exist_ok=True)

        # Rename with job number: e.g., "432_video_15.wav"
        new_filename = f"{audio_counter}_video_{video_number}{audio_file.suffix}"
        ready_file = ready_folder / new_filename

        # MOVE the file (not copy) - this removes it from watch folder
        shutil.move(str(audio_file), str(ready_file))
        logger.info(f"📁 Moved: {audio_file.name} -> {username}/{new_filename}")

        # Return the EXTERNAL file server URL (for Vast.ai worker access)
        relative_path = f"audio-ready/{username}/{new_filename}"
        return f"{FILE_SERVER_EXTERNAL_URL}/files/{relative_path}"
    except Exception as e:
        logger.error(f"Error moving audio: {e}")
        return None


def delete_audio_file(audio_file: Path):
    """Delete audio file after processing - MUST succeed to prevent reuse"""
    try:
        audio_file.unlink()
        logger.info(f"Deleted: {audio_file.name}")
        return True
    except Exception as e:
        logger.error(f"Error deleting file: {e}")
        # If delete fails, move to a "processed" folder to prevent reuse
        try:
            processed_folder = Path(WATCH_FOLDER) / "processed"
            processed_folder.mkdir(exist_ok=True)
            new_path = processed_folder / f"done_{audio_file.name}"
            audio_file.rename(new_path)
            logger.info(f"Moved to processed: {new_path}")
            return True
        except Exception as e2:
            logger.error(f"CRITICAL: Could not delete or move file: {e2}")
            return False


def main_loop():
    """Main watching loop"""
    logger.info("=" * 50)
    logger.info("Audio Folder Watcher Started")
    logger.info(f"Watching: {WATCH_FOLDER}")
    logger.info(f"Active job file: {ACTIVE_JOB_FILE}")
    logger.info(f"Poll interval: {POLL_INTERVAL}s")
    logger.info("=" * 50)

    # Ensure watch folder exists
    Path(WATCH_FOLDER).mkdir(parents=True, exist_ok=True)

    while True:
        try:
            # Get audio files
            audio_files = get_audio_files()

            if audio_files:
                # Get the ACTIVE job (from telegram bot)
                job = get_active_job()

                if job:
                    audio_file = audio_files[0]
                    job_id = job.get("job_id", "")[:8]
                    audio_counter = job.get("audio_counter", 0)
                    video_number = job.get("video_number", 0)

                    logger.info(f">>> Audio: {audio_file.name}")
                    logger.info(f">>> Active job: #{audio_counter} V{video_number} ({job_id})")

                    # Move audio to job folder and get URL
                    audio_url = move_audio_to_job_folder(audio_file, job)

                    if audio_url:
                        # Update job with audio link
                        if update_job_with_audio(job.get("job_id"), audio_url):
                            logger.info(f"✅ Job #{audio_counter} ready!")
                            # Clear active job so telegram sends next script
                            clear_active_job()
                            processed_files.add(str(audio_file))
                        else:
                            logger.error(f"❌ Failed to update job #{audio_counter}")
                    else:
                        logger.error(f"❌ Failed to move audio file")
                else:
                    logger.debug("Audio found but no active job")

        except Exception as e:
            logger.error(f"Error in main loop: {e}")

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    try:
        main_loop()
    except KeyboardInterrupt:
        logger.info("Watcher stopped by user")
        sys.exit(0)
