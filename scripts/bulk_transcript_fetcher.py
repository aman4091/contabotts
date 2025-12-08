#!/usr/bin/env python3
"""
Bulk Transcript Fetcher using Apify
Downloads 50 transcripts per run
Run via cron every 30 minutes
"""

import os
import json
import time
from datetime import datetime
from dotenv import load_dotenv
from apify_client import ApifyClient

# Load environment variables
load_dotenv("/root/tts/.env.local")

# Configuration
DATA_DIR = "/root/tts/data"
BATCH_SIZE = int(os.environ.get('BATCH_SIZE', 50))
APIFY_API_KEY = os.environ.get('APIFY_API_KEY', '')
APIFY_ACTOR_ID = "fWIyRKfnKlxB1r5CX"  # insight_api_labs/youtube-transcript

def get_all_video_ids():
    """Get all video IDs from all users' metadata files"""
    video_ids = []
    users_dir = os.path.join(DATA_DIR, "users")

    if not os.path.exists(users_dir):
        return video_ids

    for username in os.listdir(users_dir):
        videos_dir = os.path.join(users_dir, username, "videos")
        if not os.path.exists(videos_dir):
            continue

        for channel_code in os.listdir(videos_dir):
            metadata_path = os.path.join(videos_dir, channel_code, "metadata.json")
            if not os.path.exists(metadata_path):
                continue

            try:
                with open(metadata_path, 'r') as f:
                    metadata = json.load(f)

                for video in metadata.get('videos', []):
                    video_ids.append({
                        'videoId': video['videoId'],
                        'title': video.get('title', ''),
                        'username': username,
                        'channelCode': channel_code
                    })
            except Exception as e:
                print(f"Error reading {metadata_path}: {e}")

    return video_ids

def get_transcript_path(username, channel_code, video_id):
    """Get path where transcript should be stored"""
    transcript_dir = os.path.join(DATA_DIR, "users", username, "transcripts", channel_code)
    os.makedirs(transcript_dir, exist_ok=True)
    return os.path.join(transcript_dir, f"{video_id}.txt")

def transcript_exists(username, channel_code, video_id):
    """Check if transcript already downloaded"""
    path = get_transcript_path(username, channel_code, video_id)
    return os.path.exists(path) and os.path.getsize(path) > 100

def fetch_transcripts_batch(video_urls):
    """Fetch transcripts using Apify actor - batch mode"""
    try:
        client = ApifyClient(APIFY_API_KEY)

        # Prepare input for actor
        run_input = {
            "video_urls": [{"url": url} for url in video_urls]
        }

        print(f"  Calling Apify actor with {len(video_urls)} videos...")
        run = client.actor(APIFY_ACTOR_ID).call(run_input=run_input)

        # Fetch results
        results = {}
        for item in client.dataset(run["defaultDatasetId"]).iterate_items():
            video_id = item.get('video_id') or item.get('videoId')
            # Try to extract video ID from URL if not directly available
            if not video_id and item.get('url'):
                url = item.get('url')
                if 'v=' in url:
                    video_id = url.split('v=')[1].split('&')[0]

            transcript = item.get('transcript', '')
            if video_id and transcript and len(transcript) > 50:
                results[video_id] = transcript

        return results

    except Exception as e:
        print(f"  Apify error: {e}")
        return {}

def save_progress(processed_count, total_count, success=0, failed=0, status="idle", current_video="", error=""):
    """Save progress to file"""
    progress_file = os.path.join(DATA_DIR, "transcript_progress.json")

    # Load existing data
    existing = {}
    if os.path.exists(progress_file):
        try:
            with open(progress_file, 'r') as f:
                existing = json.load(f)
        except:
            pass

    with open(progress_file, 'w') as f:
        json.dump({
            'processed': processed_count,
            'total': total_count,
            'success': success,
            'failed': failed,
            'status': status,
            'current_video': current_video,
            'error': error,
            'last_run': datetime.now().isoformat(),
            'history': (existing.get('history', []) + [{
                'time': datetime.now().isoformat(),
                'success': success,
                'failed': failed
            }])[-20:]  # Keep last 20 runs
        }, f, indent=2)

def main():
    print(f"\n{'='*50}")
    print(f"Bulk Transcript Fetcher (Apify) - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*50}\n")

    if not APIFY_API_KEY:
        print("ERROR: APIFY_API_KEY not set in .env.local")
        save_progress(0, 0, status="error", error="APIFY_API_KEY not set")
        return

    try:
        # Get all video IDs
        all_videos = get_all_video_ids()
        print(f"Total videos in metadata: {len(all_videos)}")

        # Filter out already downloaded
        pending_videos = [
            v for v in all_videos
            if not transcript_exists(v['username'], v['channelCode'], v['videoId'])
        ]
        print(f"Pending transcripts: {len(pending_videos)}")

        if not pending_videos:
            print("All transcripts already downloaded!")
            save_progress(len(all_videos), len(all_videos), status="completed")
            return

        # Process batch
        batch = pending_videos[:BATCH_SIZE]
        print(f"\nProcessing batch of {len(batch)} videos...\n")

        # Mark as running
        save_progress(
            len(all_videos) - len(pending_videos),
            len(all_videos),
            status="running",
            current_video=f"Starting batch of {len(batch)}"
        )

        # Build video URLs and mapping
        video_urls = []
        video_map = {}  # video_id -> video info
        for video in batch:
            video_id = video['videoId']
            url = f"https://www.youtube.com/watch?v={video_id}"
            video_urls.append(url)
            video_map[video_id] = video

        # Fetch all transcripts in one Apify call
        print("Fetching transcripts via Apify...")
        transcripts = fetch_transcripts_batch(video_urls)
        print(f"  Got {len(transcripts)} transcripts from Apify\n")

        success_count = 0
        fail_count = 0

        # Process results
        for i, video in enumerate(batch, 1):
            video_id = video['videoId']
            username = video['username']
            channel_code = video['channelCode']
            title = video['title'][:50] + '...' if len(video['title']) > 50 else video['title']

            print(f"[{i}/{len(batch)}] {video_id} - {title}")

            transcript = transcripts.get(video_id)

            if transcript:
                # Save transcript
                transcript_path = get_transcript_path(username, channel_code, video_id)
                with open(transcript_path, 'w', encoding='utf-8') as f:
                    f.write(transcript)

                print(f"  ✓ Saved ({len(transcript)} chars)")
                success_count += 1
            else:
                # Save empty marker to skip next time
                transcript_path = get_transcript_path(username, channel_code, video_id)
                with open(transcript_path, 'w', encoding='utf-8') as f:
                    f.write("[NO TRANSCRIPT AVAILABLE]")

                print(f"  ✗ No transcript available")
                fail_count += 1

        # Summary
        total_done = len(all_videos) - len(pending_videos) + success_count + fail_count
        remaining = len(pending_videos) - len(batch)

        print(f"\n{'='*50}")
        print(f"Batch complete!")
        print(f"  Success: {success_count}")
        print(f"  Failed: {fail_count}")
        print(f"  Total progress: {total_done}/{len(all_videos)}")
        print(f"  Remaining: {remaining}")
        print(f"{'='*50}\n")

        # Save final progress
        save_progress(
            total_done,
            len(all_videos),
            success=success_count,
            failed=fail_count,
            status="completed" if remaining == 0 else "idle"
        )

    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        save_progress(0, 0, status="error", error=str(e))

if __name__ == "__main__":
    main()
