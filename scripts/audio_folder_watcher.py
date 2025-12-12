#!/usr/bin/env python3
"""
Audio Folder Watcher
Watches external-audio folder, matches with oldest audio_only job, triggers processing
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
FILE_SERVER_URL = "http://localhost:8000"  # For API calls
FILE_SERVER_EXTERNAL_URL = "http://69.62.157.161:8000"  # For audio URLs (Vast.ai access)
FILE_SERVER_API_KEY = "tts-secret-key-2024"
POLL_INTERVAL = 5  # Check every 5 seconds

# Logging
logging.basicConfig(
    format='%(asctime)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)


def get_pending_audio_only_jobs():
    """Get audio_only jobs that are waiting for audio (telegram_sent=true, no existing_audio_link)"""
    try:
        response = requests.get(
            f"{FILE_SERVER_URL}/queue/audio/jobs",
            params={"status": "pending"},
            headers={"x-api-key": FILE_SERVER_API_KEY},
            timeout=30
        )
        if response.status_code == 200:
            jobs = response.json().get("jobs", [])
            # Filter: audio_only=true, telegram_sent=true, no existing_audio_link
            audio_only_jobs = [
                j for j in jobs
                if j.get("audio_only") and j.get("telegram_sent") and not j.get("existing_audio_link")
            ]
            # Sort by created_at (oldest first)
            audio_only_jobs.sort(key=lambda x: x.get("created_at", ""))
            return audio_only_jobs
        return []
    except Exception as e:
        logger.error(f"Error fetching jobs: {e}")
        return []


def get_audio_files():
    """Get audio files from watch folder"""
    audio_extensions = {'.wav', '.mp3', '.m4a', '.ogg', '.flac'}
    files = []

    watch_path = Path(WATCH_FOLDER)
    if not watch_path.exists():
        return []

    for f in watch_path.iterdir():
        if f.is_file() and f.suffix.lower() in audio_extensions:
            files.append(f)

    # Sort by modification time (oldest first)
    files.sort(key=lambda x: x.stat().st_mtime)
    return files


def update_job_with_audio(job_id: str, audio_url: str, image_folder: str = "nature"):
    """Update job with audio link"""
    try:
        response = requests.post(
            f"{FILE_SERVER_URL}/queue/audio/jobs/{job_id}/update",
            headers={
                "Content-Type": "application/json",
                "x-api-key": FILE_SERVER_API_KEY
            },
            json={
                "existing_audio_link": audio_url,
                "image_folder": image_folder
            },
            timeout=30
        )
        return response.status_code == 200
    except Exception as e:
        logger.error(f"Error updating job: {e}")
        return False


def move_audio_to_job_folder(audio_file: Path, job: dict):
    """Move audio file to job's organized folder and return the URL"""
    try:
        username = job.get("username", "default")
        video_number = job.get("video_number", 0)

        # Destination path
        dest_folder = Path(f"/root/tts/data/users/{username}/organized/video_{video_number}")
        dest_folder.mkdir(parents=True, exist_ok=True)

        # Keep original extension or convert name
        dest_file = dest_folder / f"external_audio{audio_file.suffix}"

        # Copy file (not move, so we can delete after confirmation)
        shutil.copy2(audio_file, dest_file)

        # Return the EXTERNAL file server URL (for Vast.ai worker access)
        relative_path = f"users/{username}/organized/video_{video_number}/external_audio{audio_file.suffix}"
        return f"{FILE_SERVER_EXTERNAL_URL}/files/{relative_path}"
    except Exception as e:
        logger.error(f"Error moving audio: {e}")
        return None


def delete_audio_file(audio_file: Path):
    """Delete audio file after processing"""
    try:
        audio_file.unlink()
        logger.info(f"Deleted: {audio_file.name}")
    except Exception as e:
        logger.error(f"Error deleting file: {e}")


def main_loop():
    """Main watching loop"""
    logger.info("=" * 50)
    logger.info("Audio Folder Watcher Started")
    logger.info(f"Watching: {WATCH_FOLDER}")
    logger.info(f"Poll interval: {POLL_INTERVAL}s")
    logger.info("=" * 50)

    # Ensure watch folder exists
    Path(WATCH_FOLDER).mkdir(parents=True, exist_ok=True)

    while True:
        try:
            # Get audio files
            audio_files = get_audio_files()

            if audio_files:
                # Get pending audio_only jobs
                jobs = get_pending_audio_only_jobs()

                if jobs:
                    # Match oldest audio file with oldest job
                    audio_file = audio_files[0]
                    job = jobs[0]

                    job_id = job.get("job_id", "")[:8]
                    audio_counter = job.get("audio_counter", 0)

                    logger.info(f"Found audio: {audio_file.name}")
                    logger.info(f"Matching with job #{audio_counter} ({job_id})")

                    # Move audio to job folder and get URL
                    audio_url = move_audio_to_job_folder(audio_file, job)

                    if audio_url:
                        # Update job with audio link
                        if update_job_with_audio(job.get("job_id"), audio_url):
                            logger.info(f"Job #{audio_counter} updated with audio!")
                            logger.info(f"Audio URL: {audio_url}")

                            # Delete original file
                            delete_audio_file(audio_file)
                        else:
                            logger.error(f"Failed to update job #{audio_counter}")
                    else:
                        logger.error(f"Failed to move audio file")
                else:
                    logger.debug("Audio files found but no matching jobs waiting")

        except Exception as e:
            logger.error(f"Error in main loop: {e}")

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    try:
        main_loop()
    except KeyboardInterrupt:
        logger.info("Watcher stopped by user")
        sys.exit(0)
