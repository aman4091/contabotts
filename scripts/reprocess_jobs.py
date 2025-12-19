#!/usr/bin/env python3
"""
Reprocess completed jobs by creating new pending jobs with same scripts
"""

import os
import json
import requests
import time
import uuid
from datetime import datetime

FILE_SERVER_URL = 'http://localhost:8000'
FILE_SERVER_API_KEY = 'tts-secret-key-2024'

headers = {
    'Content-Type': 'application/json',
    'x-api-key': FILE_SERVER_API_KEY
}


def get_completed_jobs(start_vn: int, end_vn: int) -> list:
    """Get completed jobs in video_number range"""
    completed_dir = '/root/tts/data/audio-queue/completed'
    jobs = []

    for f in os.listdir(completed_dir):
        if f.endswith('.json'):
            try:
                with open(os.path.join(completed_dir, f)) as fp:
                    data = json.load(fp)
                    vn = data.get('video_number')
                    if vn and start_vn <= int(vn) <= end_vn:
                        jobs.append(data)
            except Exception as e:
                print(f"Error reading {f}: {e}")

    jobs.sort(key=lambda x: x.get('video_number', 0))
    return jobs


def create_new_job(old_job: dict) -> dict:
    """Create new job from old job, preserving important fields"""
    new_job = {
        'job_id': str(uuid.uuid4()),
        'script_text': old_job.get('script_text', ''),
        'channel_code': old_job.get('channel_code', 'VIDEO'),
        'video_number': old_job.get('video_number', 0),
        'date': datetime.now().strftime('%Y-%m-%d'),
        'audio_counter': old_job.get('audio_counter', 0),
        'priority': 100,
        'username': old_job.get('username', 'aman'),
        'reference_audio': old_job.get('reference_audio', 'cho.mp3'),
        'use_ai_image': True,  # Enable new multi-image AI feature
        'retry_count': 0,
        'telegram_sent': False,
        'organized_path': old_job.get('organized_path', ''),
    }
    return new_job


def submit_job(job: dict) -> bool:
    """Submit job to file server"""
    try:
        response = requests.post(
            f"{FILE_SERVER_URL}/queue/audio/jobs",
            headers=headers,
            json=job,
            timeout=30
        )
        return response.status_code == 200
    except Exception as e:
        print(f"Error submitting job: {e}")
        return False


def main():
    import sys

    # Get range from command line args
    if len(sys.argv) >= 3:
        start_vn = int(sys.argv[1])
        end_vn = int(sys.argv[2])
    else:
        start_vn = 520
        end_vn = 600

    delay = int(sys.argv[3]) if len(sys.argv) >= 4 else 60  # Default 60 second delay

    print(f"=" * 50)
    print(f"Reprocessing jobs V{start_vn} to V{end_vn}")
    print(f"Delay between jobs: {delay} seconds")
    print(f"=" * 50)

    # Get completed jobs
    jobs = get_completed_jobs(start_vn, end_vn)
    print(f"Found {len(jobs)} completed jobs to reprocess")

    if not jobs:
        print("No jobs found!")
        return

    # Confirm
    print(f"\nFirst job: V{jobs[0].get('video_number')}")
    print(f"Last job: V{jobs[-1].get('video_number')}")
    print(f"\nStarting reprocess in 5 seconds...")
    time.sleep(5)

    # Process each job
    success_count = 0
    for i, old_job in enumerate(jobs):
        vn = old_job.get('video_number', 0)
        print(f"\n[{i+1}/{len(jobs)}] Reprocessing V{vn}...")

        # Create new job
        new_job = create_new_job(old_job)

        # Submit to queue
        if submit_job(new_job):
            print(f"   ✅ Job created: {new_job['job_id'][:8]}...")
            success_count += 1
        else:
            print(f"   ❌ Failed to create job")

        # Delay between jobs (telegram bot will pick them up)
        if i < len(jobs) - 1:
            print(f"   Waiting {delay}s before next job...")
            time.sleep(delay)

    print(f"\n" + "=" * 50)
    print(f"Done! {success_count}/{len(jobs)} jobs reprocessed")
    print(f"=" * 50)


if __name__ == "__main__":
    main()
