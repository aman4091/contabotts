#!/usr/bin/env python3
"""
Audio Link Watcher
Watches for text files containing PixelDrain links
Example: "V715.txt" contains "https://pixeldrain.com/api/file/xxxxx?download"
Matches job by video_number in filename and updates with the link
"""

import os
import sys
import json
import time
import re
import logging
import requests
from pathlib import Path

# Config
WATCH_FOLDER = "/root/tts/data/external-audio"
FILE_SERVER_URL = "http://localhost:8000"
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


def get_link_files():
    """Get text files containing PixelDrain links from watch folder"""
    files = []

    watch_path = Path(WATCH_FOLDER)
    if not watch_path.exists():
        return []

    for f in watch_path.iterdir():
        if f.is_file() and f.suffix.lower() == '.txt':
            if str(f) not in processed_files:
                files.append(f)

    return files


def read_pixeldrain_link(txt_file: Path) -> str:
    """Read PixelDrain link from text file"""
    try:
        content = txt_file.read_text().strip()
        # Check if it's a valid PixelDrain link or any HTTP link
        if content.startswith("http"):
            return content
        return None
    except Exception as e:
        logger.error(f"Error reading {txt_file.name}: {e}")
        return None


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


def archive_link_file(txt_file: Path, job: dict):
    """Move processed text file to archive folder"""
    try:
        username = job.get("username", "default")
        video_number = job.get("video_number", 0)

        archive_folder = Path(f"/root/tts/data/external-audio/processed")
        archive_folder.mkdir(parents=True, exist_ok=True)

        new_filename = f"V{video_number}_{txt_file.name}"
        archive_file = archive_folder / new_filename

        txt_file.rename(archive_file)
        logger.info(f"Archived: {txt_file.name} -> processed/{new_filename}")
    except Exception as e:
        logger.error(f"Error archiving file: {e}")


def main_loop():
    """Main watching loop - reads PixelDrain links from text files"""
    logger.info("=" * 50)
    logger.info("Audio Link Watcher Started")
    logger.info(f"Watching: {WATCH_FOLDER}")
    logger.info("Looking for: .txt files with PixelDrain links")
    logger.info("Naming: V715.txt or script_V715.txt")
    logger.info("=" * 50)

    Path(WATCH_FOLDER).mkdir(parents=True, exist_ok=True)

    while True:
        try:
            link_files = get_link_files()

            if link_files:
                jobs = get_pending_jobs()

                for txt_file in link_files:
                    # Extract number from filename
                    video_number = extract_number_from_filename(txt_file.name)

                    if video_number is None:
                        logger.warning(f"No number in filename: {txt_file.name}")
                        continue

                    # Read PixelDrain link from file
                    pixeldrain_link = read_pixeldrain_link(txt_file)
                    if not pixeldrain_link:
                        logger.warning(f"No valid link in: {txt_file.name}")
                        continue

                    # Find matching job
                    job = find_job_by_video_number(jobs, video_number)

                    if job:
                        job_id = job.get("job_id", "")[:8]
                        audio_counter = job.get("audio_counter", 0)

                        logger.info(f">>> Match: {txt_file.name} -> V{video_number} (#{audio_counter})")
                        logger.info(f"    Link: {pixeldrain_link[:50]}...")

                        # Update job with PixelDrain link
                        if update_job_with_audio(job.get("job_id"), pixeldrain_link):
                            logger.info(f"Job #{audio_counter} V{video_number} updated with PixelDrain link!")
                            processed_files.add(str(txt_file))
                            archive_link_file(txt_file, job)
                        else:
                            logger.error(f"Failed to update job #{audio_counter}")
                    else:
                        # No matching job - ignore this file
                        logger.debug(f"No job for V{video_number}, ignoring: {txt_file.name}")

        except Exception as e:
            logger.error(f"Error in main loop: {e}")

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    try:
        main_loop()
    except KeyboardInterrupt:
        logger.info("Watcher stopped")
        sys.exit(0)
