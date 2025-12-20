#!/usr/bin/env python3
"""
Bulk Transcript Fetcher
Fetches transcripts for top 100 videos (by views) for each channel
Runs in background, saves transcripts like GS32 format
Uses DownSub API for transcript fetching
"""

import os
import sys
import json
import time
import logging
import requests
from pathlib import Path

# Config
DATA_DIR = Path("/root/tts/data/users/aman")
VIDEOS_DIR = DATA_DIR / "videos"
TRANSCRIPTS_DIR = DATA_DIR / "transcripts"
DOWNSUB_API_KEY = os.getenv("DOWNSUB_API_KEY", "")
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "5"))  # Fetch 5 at a time, then pause
DELAY_BETWEEN_FETCHES = 5  # seconds between each fetch
DELAY_BETWEEN_BATCHES = 60  # seconds between batches

# Logging
logging.basicConfig(
    format='%(asctime)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)


def load_env():
    """Load environment variables from .env.local"""
    global DOWNSUB_API_KEY
    env_file = Path("/root/tts/.env.local")
    if env_file.exists():
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    if key == "DOWNSUB_API_KEY":
                        DOWNSUB_API_KEY = value
                        break


def get_channels_with_videos():
    """Get all channels that have video metadata"""
    channels = []
    if not VIDEOS_DIR.exists():
        return channels

    for channel_dir in VIDEOS_DIR.iterdir():
        if channel_dir.is_dir():
            metadata_file = channel_dir / "metadata.json"
            if metadata_file.exists():
                try:
                    with open(metadata_file) as f:
                        data = json.load(f)
                    channels.append({
                        "code": data.get("channelCode", channel_dir.name),
                        "name": data.get("channelName", channel_dir.name),
                        "videos": data.get("videos", [])
                    })
                except Exception as e:
                    logger.error(f"Error reading {metadata_file}: {e}")

    return channels


def get_existing_transcripts(channel_code: str) -> set:
    """Get set of video IDs that already have transcripts"""
    transcript_dir = TRANSCRIPTS_DIR / channel_code
    existing = set()

    if not transcript_dir.exists():
        return existing

    for f in transcript_dir.glob("*.txt"):
        try:
            with open(f) as file:
                content = file.read()
                # Extract video ID from header
                for line in content.split('\n')[:5]:
                    if line.startswith("Video ID:"):
                        video_id = line.replace("Video ID:", "").strip()
                        existing.add(video_id)
                        break
        except:
            pass

    return existing


def get_next_index(channel_code: str) -> int:
    """Get the next available index for a channel"""
    transcript_dir = TRANSCRIPTS_DIR / channel_code
    if not transcript_dir.exists():
        return 1

    max_index = 0
    for f in transcript_dir.glob("*.txt"):
        try:
            index = int(f.stem)
            max_index = max(max_index, index)
        except:
            pass

    return max_index + 1


def fetch_transcript(video_id: str) -> str:
    """Fetch transcript from DownSub API"""
    if not DOWNSUB_API_KEY:
        logger.error("DOWNSUB_API_KEY not set")
        return None

    try:
        youtube_url = f"https://www.youtube.com/watch?v={video_id}"

        # Step 1: Get subtitle URLs from DownSub
        res = requests.post(
            "https://api.downsub.com/download",
            headers={
                "Authorization": f"Bearer {DOWNSUB_API_KEY}",
                "Content-Type": "application/json"
            },
            json={"url": youtube_url},
            timeout=60
        )

        if not res.ok:
            logger.warning(f"[DownSub] Error for {video_id}: {res.status_code}")
            return None

        data = res.json()

        if data.get("status") != "success" or not data.get("data", {}).get("subtitles"):
            logger.warning(f"[DownSub] No subtitles found for {video_id}")
            return None

        # Step 2: Find English or Hindi subtitle (prefer English)
        subtitles = data["data"]["subtitles"]
        target_subtitle = None

        for sub in subtitles:
            lang = sub.get("language", "").lower()
            if "english" in lang:
                target_subtitle = sub
                break

        if not target_subtitle:
            for sub in subtitles:
                lang = sub.get("language", "").lower()
                if "hindi" in lang:
                    target_subtitle = sub
                    break

        if not target_subtitle and subtitles:
            target_subtitle = subtitles[0]

        if not target_subtitle:
            logger.warning(f"[DownSub] No suitable subtitle found for {video_id}")
            return None

        # Step 3: Get txt format URL
        txt_url = None
        for fmt in target_subtitle.get("formats", []):
            if fmt.get("format") == "txt":
                txt_url = fmt.get("url")
                break

        if not txt_url:
            logger.warning(f"[DownSub] No txt format available for {video_id}")
            return None

        # Step 4: Fetch the actual transcript text
        txt_res = requests.get(txt_url, timeout=30)
        if not txt_res.ok:
            logger.warning(f"[DownSub] Failed to fetch txt for {video_id}: {txt_res.status_code}")
            return None

        transcript = txt_res.text.strip()
        logger.info(f"[DownSub] Got transcript for {video_id}: {len(transcript)} chars")
        return transcript

    except Exception as e:
        logger.error(f"[DownSub] Error fetching transcript for {video_id}: {e}")
        return None


def save_transcript(channel_code: str, index: int, title: str, video_id: str, transcript: str):
    """Save transcript to file"""
    transcript_dir = TRANSCRIPTS_DIR / channel_code
    transcript_dir.mkdir(parents=True, exist_ok=True)

    file_path = transcript_dir / f"{index}.txt"

    content = f"Title: {title}\nVideo ID: {video_id}\n\n{transcript}"

    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)

    logger.info(f"Saved: {channel_code}/{index}.txt - {title[:50]}...")


def process_channel(channel: dict, limit: int = 100):
    """Process a single channel - fetch transcripts for top videos by views"""
    code = channel["code"]
    name = channel["name"]
    videos = channel["videos"]

    # Skip GS32 - it already has transcripts
    if code == "GS32":
        logger.info(f"Skipping GS32 (already has transcripts)")
        return

    logger.info(f"Processing channel: {name} ({code})")

    # Sort by views (descending)
    videos_sorted = sorted(videos, key=lambda v: v.get("viewCount", 0), reverse=True)

    # Get existing transcripts
    existing = get_existing_transcripts(code)
    logger.info(f"  Existing transcripts: {len(existing)}")

    # Get videos that need transcripts
    to_fetch = []
    for video in videos_sorted[:limit]:
        if video.get("videoId") not in existing:
            to_fetch.append(video)

    if not to_fetch:
        logger.info(f"  All top {limit} videos already have transcripts")
        return

    logger.info(f"  Need to fetch: {len(to_fetch)} transcripts")

    # Get next index
    next_index = get_next_index(code)

    # Fetch transcripts in batches
    fetched = 0
    for i, video in enumerate(to_fetch):
        video_id = video.get("videoId")
        title = video.get("title", "")

        logger.info(f"  [{i+1}/{len(to_fetch)}] Fetching: {video_id}")

        transcript = fetch_transcript(video_id)

        if transcript:
            save_transcript(code, next_index, title, video_id, transcript)
            next_index += 1
            fetched += 1
        else:
            logger.warning(f"  Could not fetch transcript for {video_id}")

        # Rate limiting
        time.sleep(DELAY_BETWEEN_FETCHES)

        # Batch pause
        if (i + 1) % BATCH_SIZE == 0 and i + 1 < len(to_fetch):
            logger.info(f"  Batch complete, pausing {DELAY_BETWEEN_BATCHES}s...")
            time.sleep(DELAY_BETWEEN_BATCHES)

    logger.info(f"  Done! Fetched {fetched} transcripts for {code}")


def main():
    """Main function"""
    load_env()

    if not DOWNSUB_API_KEY:
        logger.error("DOWNSUB_API_KEY not found in environment or .env.local")
        sys.exit(1)

    logger.info("=" * 50)
    logger.info("Bulk Transcript Fetcher Started")
    logger.info(f"Data dir: {DATA_DIR}")
    logger.info("=" * 50)

    channels = get_channels_with_videos()
    logger.info(f"Found {len(channels)} channels with videos")

    for channel in channels:
        try:
            process_channel(channel, limit=100)
        except Exception as e:
            logger.error(f"Error processing {channel['code']}: {e}")

        # Pause between channels
        time.sleep(5)

    logger.info("=" * 50)
    logger.info("Bulk Transcript Fetcher Complete")
    logger.info("=" * 50)


if __name__ == "__main__":
    main()
