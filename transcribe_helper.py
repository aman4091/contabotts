#!/usr/bin/env python3
"""
Transcribe Helper - DownSub API Integration
=============================================
Handles YouTube transcript fetching via DownSub API with:
- Async and sync versions
- Proper error handling
- Language preference (English > Hindi > first available)
"""

import os
import time
import httpx
from typing import Optional, Tuple

class DownSubError(Exception):
    """Custom exception for DownSub API errors"""
    pass

def _headers(api_key: str) -> dict:
    """Generate headers for DownSub API requests"""
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

def _extract_video_id(video_url: str) -> Optional[str]:
    """Extract video ID from YouTube URL"""
    import re
    patterns = [
        r'(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})',
        r'^([a-zA-Z0-9_-]{11})$'
    ]
    for pattern in patterns:
        match = re.search(pattern, video_url)
        if match:
            return match.group(1)
    return None

def _find_best_subtitle(subtitles: list) -> Optional[dict]:
    """Find the best subtitle (prefer English > Hindi > first available)"""
    if not subtitles:
        return None

    # Try English first
    for sub in subtitles:
        lang = sub.get("language", "").lower()
        if "english" in lang:
            return sub

    # Try Hindi
    for sub in subtitles:
        lang = sub.get("language", "").lower()
        if "hindi" in lang:
            return sub

    # Fallback to first available
    return subtitles[0] if subtitles else None

def _get_txt_url(subtitle: dict) -> Optional[str]:
    """Get txt format URL from subtitle formats"""
    if not subtitle:
        return None
    for fmt in subtitle.get("formats", []):
        if fmt.get("format") == "txt":
            return fmt.get("url")
    return None

async def get_youtube_transcript(video_url: str, api_key: str) -> Tuple[Optional[str], bool]:
    """
    Get transcript from DownSub API.

    Returns:
        Tuple[Optional[str], bool]: (transcript_text, is_key_exhausted)
        - transcript_text: The transcript or None if failed
        - is_key_exhausted: True if API key quota exhausted (403 error)
    """
    if not api_key:
        print("❌ Missing DownSub API key")
        return None, False

    try:
        # Ensure we have a full YouTube URL
        video_id = _extract_video_id(video_url)
        if video_id:
            youtube_url = f"https://www.youtube.com/watch?v={video_id}"
        else:
            youtube_url = video_url

        print(f"[DownSub] Requesting transcript: {youtube_url[:50]}...")

        async with httpx.AsyncClient(timeout=120.0) as client:
            # Step 1: Get subtitle URLs from DownSub
            response = await client.post(
                "https://api.downsub.com/download",
                headers=_headers(api_key),
                json={"url": youtube_url}
            )

            print(f"[DownSub] Response status: {response.status_code}")

            # Handle different status codes
            if response.status_code == 401:
                print("❌ 401 Unauthorized - Invalid API key")
                return None, False

            elif response.status_code == 403:
                print("⚠️ 403 Forbidden - API key quota exhausted or access denied")
                return None, True  # Key exhausted!

            elif response.status_code == 429:
                print("⚠️ 429 Rate Limited - Too many requests")
                return None, True  # Treat as exhausted

            elif response.status_code >= 400:
                error_text = response.text[:200]
                print(f"❌ DownSub error {response.status_code}: {error_text}")
                return None, False

            elif response.status_code == 200:
                data = response.json()

                if data.get("status") != "success" or not data.get("data", {}).get("subtitles"):
                    print("❌ No subtitles found in response")
                    return None, False

                # Step 2: Find best subtitle
                subtitles = data["data"]["subtitles"]
                target_subtitle = _find_best_subtitle(subtitles)

                if not target_subtitle:
                    print("❌ No suitable subtitle found")
                    return None, False

                # Step 3: Get txt URL
                txt_url = _get_txt_url(target_subtitle)
                if not txt_url:
                    print("❌ No txt format available")
                    return None, False

                # Step 4: Fetch transcript text
                txt_response = await client.get(txt_url)
                if txt_response.status_code != 200:
                    print(f"❌ Failed to fetch txt: {txt_response.status_code}")
                    return None, False

                transcript = txt_response.text.strip()
                print(f"✅ Transcript received: {len(transcript)} characters")
                return transcript, False

            else:
                print(f"❌ Unexpected status code: {response.status_code}")
                return None, False

    except httpx.TimeoutException:
        print("❌ DownSub request timeout")
        return None, False
    except Exception as e:
        print(f"❌ DownSub error: {e}")
        return None, False

async def asyncio_sleep(seconds: float):
    """Async sleep wrapper"""
    import asyncio
    await asyncio.sleep(seconds)

# =============================================================================
# SYNC VERSION (for non-async contexts)
# =============================================================================

def get_youtube_transcript_sync(video_url: str, api_key: str) -> Tuple[Optional[str], bool]:
    """
    Synchronous version of get_youtube_transcript.
    Uses httpx sync client instead of async.

    Returns:
        Tuple[Optional[str], bool]: (transcript_text, is_key_exhausted)
    """
    if not api_key:
        print("❌ Missing DownSub API key")
        return None, False

    try:
        # Ensure we have a full YouTube URL
        video_id = _extract_video_id(video_url)
        if video_id:
            youtube_url = f"https://www.youtube.com/watch?v={video_id}"
        else:
            youtube_url = video_url

        print(f"[DownSub] Requesting transcript: {youtube_url[:50]}...")

        with httpx.Client(timeout=120.0) as client:
            # Step 1: Get subtitle URLs from DownSub
            response = client.post(
                "https://api.downsub.com/download",
                headers=_headers(api_key),
                json={"url": youtube_url}
            )

            print(f"[DownSub] Response status: {response.status_code}")

            if response.status_code == 401:
                print("❌ 401 Unauthorized - Invalid API key")
                return None, False

            elif response.status_code == 403:
                print("⚠️ 403 Forbidden - API key quota exhausted")
                return None, True  # Key exhausted!

            elif response.status_code == 429:
                print("⚠️ 429 Rate Limited")
                return None, True

            elif response.status_code >= 400:
                error_text = response.text[:200]
                print(f"❌ DownSub error {response.status_code}: {error_text}")
                return None, False

            elif response.status_code == 200:
                data = response.json()

                if data.get("status") != "success" or not data.get("data", {}).get("subtitles"):
                    print("❌ No subtitles found in response")
                    return None, False

                # Step 2: Find best subtitle
                subtitles = data["data"]["subtitles"]
                target_subtitle = _find_best_subtitle(subtitles)

                if not target_subtitle:
                    print("❌ No suitable subtitle found")
                    return None, False

                # Step 3: Get txt URL
                txt_url = _get_txt_url(target_subtitle)
                if not txt_url:
                    print("❌ No txt format available")
                    return None, False

                # Step 4: Fetch transcript text
                txt_response = client.get(txt_url)
                if txt_response.status_code != 200:
                    print(f"❌ Failed to fetch txt: {txt_response.status_code}")
                    return None, False

                transcript = txt_response.text.strip()
                print(f"✅ Transcript received: {len(transcript)} characters")
                return transcript, False

            else:
                print(f"❌ Unexpected status code: {response.status_code}")
                return None, False

    except httpx.TimeoutException:
        print("❌ DownSub request timeout")
        return None, False
    except Exception as e:
        print(f"❌ DownSub error: {e}")
        return None, False
