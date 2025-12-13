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
FILE_SERVER_EXTERNAL_URL = "http://38.242.144.132:8000"  # For audio URLs (Vast.ai access)
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


def extract_number_from_filename(filename: str) -> int:
    """Extract job number from filename like '432.wav' or 'audio_432.mp3'"""
    import re
    # Find all numbers in filename
    numbers = re.findall(r'\d+', filename)
    if numbers:
        # Return the first number found
        return int(numbers[0])
    return None


def find_matching_job(audio_file: Path, jobs: list) -> dict:
    """Find job that matches the audio file by number in filename"""
    # Try to extract number from filename
    file_number = extract_number_from_filename(audio_file.stem)

    if file_number:
        # Look for job with matching audio_counter
        for job in jobs:
            if job.get("audio_counter") == file_number:
                return job

    # Fallback: return oldest job (first in list)
    return jobs[0] if jobs else None


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
    """Rename audio with job number and move to ready folder"""
    try:
        username = job.get("username", "default")
        video_number = job.get("video_number", 0)
        audio_counter = job.get("audio_counter", 0)

        # Create ready folder for processed audio files
        ready_folder = Path("/root/tts/data/audio-ready")
        ready_folder.mkdir(parents=True, exist_ok=True)

        # Rename with job number: e.g., "432_video_15.wav"
        new_filename = f"{audio_counter}_video_{video_number}{audio_file.suffix}"
        ready_file = ready_folder / new_filename

        # MOVE the file (not copy) - this removes it from watch folder
        shutil.move(str(audio_file), str(ready_file))
        logger.info(f"📁 Renamed & moved: {audio_file.name} -> {new_filename}")

        # Return the EXTERNAL file server URL (for Vast.ai worker access)
        relative_path = f"audio-ready/{new_filename}"
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

                # Log all pending jobs for debugging
                if jobs:
                    logger.info(f"=== Pending audio_only jobs ({len(jobs)}) ===")
                    for idx, j in enumerate(jobs):
                        logger.info(f"  {idx+1}. #{j.get('audio_counter')} - {j.get('job_id', '')[:8]} - created: {j.get('created_at', 'N/A')}")

                if jobs:
                    # Match oldest audio file with oldest job
                    audio_file = audio_files[0]
                    job = jobs[0]

                    job_id = job.get("job_id", "")[:8]
                    audio_counter = job.get("audio_counter", 0)

                    logger.info(f">>> Found audio: {audio_file.name}")
                    logger.info(f">>> Matching with job #{audio_counter} ({job_id})")

                    # Move audio to job folder and get URL
                    audio_url = move_audio_to_job_folder(audio_file, job)

                    if audio_url:
                        # File already moved by move_audio_to_job_folder, now update job
                        if update_job_with_audio(job.get("job_id"), audio_url):
                            logger.info(f"✅ Job #{audio_counter} ready for processing!")
                            logger.info(f"   Audio: {audio_url}")
                        else:
                            logger.error(f"❌ Failed to update job #{audio_counter}")
                    else:
                        logger.error(f"❌ Failed to move/rename audio file")
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
