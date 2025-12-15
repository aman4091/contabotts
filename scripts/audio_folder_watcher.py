#!/usr/bin/env python3
"""
Audio Folder Watcher
Watches external-audio folder, matches audio by video_number in filename
Example: "script_475.wav" matches job with video_number=475
"""

import os
import sys
import json
import time
import re
import logging
import requests
import shutil
from pathlib import Path

# Config
WATCH_FOLDER = "/root/tts/data/external-audio"
FILE_SERVER_URL = "http://localhost:8000"
FILE_SERVER_EXTERNAL_URL = "http://38.242.144.132:8000"
FILE_SERVER_API_KEY = "tts-secret-key-2024"
POLL_INTERVAL = 5

# Track processed files
processed_files = set()

# Logging
logging.basicConfig(
    format='%(asctime)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)


def extract_number_from_filename(filename: str) -> int:
    """Extract video number from filename like 'script_51_VIDEO_V476_xxx.wav' or '476.mp3'"""
    name = Path(filename).stem

    # First try: Look for V followed by number (e.g., V476)
    v_match = re.search(r'V(\d+)', name)
    if v_match:
        return int(v_match.group(1))

    # Fallback: Just the number itself (e.g., 476.mp3)
    numbers = re.findall(r'\d+', name)
    if numbers:
        return int(numbers[0])

    return None


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


def find_job_by_video_number(jobs: list, video_number: int) -> dict:
    """Find job that matches the video_number"""
    for job in jobs:
        if job.get("video_number") == video_number:
            # Only match jobs that need audio (telegram_sent but no audio yet)
            if job.get("telegram_sent") and not job.get("existing_audio_link"):
                return job
    return None


def get_audio_files():
    """Get audio files from watch folder"""
    audio_extensions = {'.wav', '.mp3', '.m4a', '.ogg', '.flac'}
    files = []

    watch_path = Path(WATCH_FOLDER)
    if not watch_path.exists():
        return []

    for f in watch_path.iterdir():
        if f.is_file() and f.suffix.lower() in audio_extensions:
            if str(f) not in processed_files:
                files.append(f)

    return files


def update_job_with_audio(job_id: str, audio_url: str):
    """Update job with audio link"""
    try:
        response = requests.post(
            f"{FILE_SERVER_URL}/queue/audio/jobs/{job_id}/update",
            headers={
                "Content-Type": "application/json",
                "x-api-key": FILE_SERVER_API_KEY
            },
            json={"existing_audio_link": audio_url},
            timeout=30
        )
        return response.status_code == 200
    except Exception as e:
        logger.error(f"Error updating job: {e}")
        return False


def move_audio_to_ready(audio_file: Path, job: dict) -> str:
    """Move audio to ready folder with proper naming"""
    try:
        username = job.get("username", "default")
        video_number = job.get("video_number", 0)
        audio_counter = job.get("audio_counter", 0)

        ready_folder = Path(f"/root/tts/data/audio-ready/{username}")
        ready_folder.mkdir(parents=True, exist_ok=True)

        new_filename = f"{audio_counter}_video_{video_number}{audio_file.suffix}"
        ready_file = ready_folder / new_filename

        shutil.move(str(audio_file), str(ready_file))
        logger.info(f"Moved: {audio_file.name} -> {username}/{new_filename}")

        relative_path = f"audio-ready/{username}/{new_filename}"
        return f"{FILE_SERVER_EXTERNAL_URL}/files/{relative_path}"
    except Exception as e:
        logger.error(f"Error moving audio: {e}")
        return None


def main_loop():
    """Main watching loop - matches audio by video_number in filename"""
    logger.info("=" * 50)
    logger.info("Audio Folder Watcher Started")
    logger.info(f"Watching: {WATCH_FOLDER}")
    logger.info("Matching: audio filename number -> job video_number")
    logger.info("=" * 50)

    Path(WATCH_FOLDER).mkdir(parents=True, exist_ok=True)

    while True:
        try:
            audio_files = get_audio_files()

            if audio_files:
                jobs = get_pending_jobs()

                for audio_file in audio_files:
                    # Extract number from filename
                    video_number = extract_number_from_filename(audio_file.name)

                    if video_number is None:
                        logger.warning(f"No number in filename: {audio_file.name}")
                        continue

                    # Find matching job
                    job = find_job_by_video_number(jobs, video_number)

                    if job:
                        job_id = job.get("job_id", "")[:8]
                        audio_counter = job.get("audio_counter", 0)

                        logger.info(f">>> Match: {audio_file.name} -> V{video_number} (#{audio_counter})")

                        # Move and update
                        audio_url = move_audio_to_ready(audio_file, job)

                        if audio_url and update_job_with_audio(job.get("job_id"), audio_url):
                            logger.info(f"Job #{audio_counter} V{video_number} ready!")
                            processed_files.add(str(audio_file))
                        else:
                            logger.error(f"Failed to update job #{audio_counter}")
                    else:
                        # No matching job - ignore this file
                        logger.debug(f"No job for V{video_number}, ignoring: {audio_file.name}")

        except Exception as e:
            logger.error(f"Error in main loop: {e}")

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    try:
        main_loop()
    except KeyboardInterrupt:
        logger.info("Watcher stopped")
        sys.exit(0)
