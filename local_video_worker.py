#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Local Video Worker - NO SUPABASE VERSION
Runs on Contabo - Uses local file queue and VideoGenerator with Whisper

Flow:
1. Watch /data/video-queue/pending/ for jobs
2. Claim job (atomic file move)
3. Read audio/script from organized folder
4. Get random image from images folder
5. Generate video with VideoGenerator (Whisper subtitles)
6. Save to organized folder
7. Upload to Gofile
8. Move job to completed
"""

import os
import sys
import time
import json
import random
import asyncio
import platform
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Load .env file if exists
from dotenv import load_dotenv
env_path = os.path.join(os.path.dirname(__file__), '.env')
if os.path.exists(env_path):
    load_dotenv(env_path)
    print(f"✅ Loaded environment from: {env_path}")

# Force CPU encoder on Contabo (no GPU)
os.environ["FORCE_CPU_ENCODER"] = "true"

import requests
from video_generator import VideoGenerator


# ============================================================================
# TELEGRAM NOTIFICATIONS - User specific
# ============================================================================

def get_user_telegram_config(username: str) -> tuple:
    """Get Telegram bot token and chat ID for a specific user"""
    if not username:
        return os.getenv("BOT_TOKEN"), os.getenv("CHAT_ID")

    # Try user-specific env vars (e.g., AMAN_BOT_TOKEN, AMAN_CHAT_ID)
    user_upper = username.upper()
    bot_token = os.getenv(f"{user_upper}_BOT_TOKEN")
    chat_id = os.getenv(f"{user_upper}_CHAT_ID")

    if bot_token and chat_id:
        return bot_token, chat_id

    return os.getenv("BOT_TOKEN"), os.getenv("CHAT_ID")


def send_telegram(message: str, username: str = None):
    """Send Telegram notification to specific user"""
    bot_token, chat_id = get_user_telegram_config(username)

    if not bot_token or not chat_id:
        print(f"⚠️ No Telegram config for user: {username}")
        return

    try:
        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        requests.post(url, json={
            "chat_id": chat_id,
            "text": message,
            "parse_mode": "HTML"
        }, timeout=10)
        print(f"📱 Telegram sent to: {username or 'default'}")
    except Exception as e:
        print(f"Telegram error: {e}")


# ============================================================================
# LOCAL VIDEO QUEUE
# ============================================================================

class LocalVideoQueue:
    """Local file-based video job queue"""

    def __init__(self, base_path: str = None):
        data_dir = os.getenv("DATA_DIR", "/root/tts/data")
        self.base_path = Path(base_path or os.path.join(data_dir, "video-queue"))
        self.pending = self.base_path / "pending"
        self.processing = self.base_path / "processing"
        self.completed = self.base_path / "completed"
        self.failed = self.base_path / "failed"

        # Workers status folder
        self.workers_dir = Path(data_dir) / "workers" / "video"

        # Create folders if not exist
        for folder in [self.pending, self.processing, self.completed, self.failed, self.workers_dir]:
            folder.mkdir(parents=True, exist_ok=True)

    def claim_job(self, worker_id: str) -> Optional[Dict]:
        """
        Claim next pending job (atomic via file move)

        Returns job data or None if no jobs available
        """
        # Get pending jobs
        pending_files = list(self.pending.glob("*.json"))

        if not pending_files:
            return None

        # Read all jobs to sort by priority
        jobs_with_files = []
        for job_file in pending_files:
            try:
                with open(job_file) as f:
                    job_data = json.load(f)
                    jobs_with_files.append((job_file, job_data))
            except Exception as e:
                print(f"Error reading job file {job_file}: {e}")
                continue

        if not jobs_with_files:
            return None

        # Sort by priority (desc) then created_at (asc)
        jobs_with_files.sort(key=lambda x: (-x[1].get("priority", 0), x[1].get("created_at", "")))

        # Try to claim each job atomically
        for job_file, job_data in jobs_with_files:
            try:
                # Atomic move: pending -> processing
                new_name = f"{worker_id}_{job_file.name}"
                new_path = self.processing / new_name

                # os.rename is atomic on Linux (same filesystem)
                os.rename(str(job_file), str(new_path))

                # Update job with worker info
                job_data["worker_id"] = worker_id
                job_data["processing_started_at"] = datetime.now().isoformat()

                with open(new_path, "w") as f:
                    json.dump(job_data, f, indent=2)

                print(f"✅ Claimed job: {job_data.get('job_id', 'unknown')[:8]}")
                return job_data

            except FileNotFoundError:
                # Another worker claimed it, try next
                continue
            except Exception as e:
                print(f"Error claiming job: {e}")
                continue

        return None

    def complete_job(self, job_id: str, worker_id: str, gofile_link: str = None) -> bool:
        """Move job to completed folder"""
        try:
            job_file = self.processing / f"{worker_id}_{job_id}.json"

            if not job_file.exists():
                print(f"Job file not found: {job_file}")
                return False

            with open(job_file) as f:
                job_data = json.load(f)

            job_data["completed_at"] = datetime.now().isoformat()
            job_data["status"] = "completed"
            if gofile_link:
                job_data["gofile_link"] = gofile_link

            completed_file = self.completed / f"{job_id}.json"
            with open(completed_file, "w") as f:
                json.dump(job_data, f, indent=2)

            job_file.unlink()  # Delete processing file
            print(f"✅ Job completed: {job_id[:8]}")
            return True

        except Exception as e:
            print(f"Error completing job: {e}")
            return False

    def fail_job(self, job_id: str, worker_id: str, error_message: str) -> bool:
        """Move job to failed or back to pending for retry"""
        try:
            job_file = self.processing / f"{worker_id}_{job_id}.json"

            if not job_file.exists():
                print(f"Job file not found: {job_file}")
                return False

            with open(job_file) as f:
                job_data = json.load(f)

            job_data["retry_count"] = job_data.get("retry_count", 0) + 1
            job_data["error_message"] = error_message
            job_data["last_failed_at"] = datetime.now().isoformat()

            max_retries = 3

            if job_data["retry_count"] >= max_retries:
                # Move to failed
                job_data["status"] = "failed"
                dest_file = self.failed / f"{job_id}.json"
                print(f"❌ Job permanently failed after {max_retries} retries")
            else:
                # Back to pending for retry
                job_data["status"] = "pending"
                if "worker_id" in job_data:
                    del job_data["worker_id"]
                if "processing_started_at" in job_data:
                    del job_data["processing_started_at"]
                dest_file = self.pending / f"{job_id}.json"
                print(f"🔄 Job queued for retry ({job_data['retry_count']}/{max_retries})")

            with open(dest_file, "w") as f:
                json.dump(job_data, f, indent=2)

            job_file.unlink()
            return True

        except Exception as e:
            print(f"Error failing job: {e}")
            return False

    def get_stats(self) -> Dict:
        """Get queue statistics"""
        stats = {
            "pending": len(list(self.pending.glob("*.json"))),
            "processing": len(list(self.processing.glob("*.json"))),
            "completed": len(list(self.completed.glob("*.json"))),
            "failed": len(list(self.failed.glob("*.json")))
        }
        stats["total"] = sum(stats.values())
        return stats

    def update_worker_status(self, worker_id: str, status: str = "online",
                             current_job: str = None, gpu_model: str = None) -> bool:
        """Update worker status file"""
        try:
            worker_file = self.workers_dir / f"{worker_id}.json"

            if worker_file.exists():
                with open(worker_file) as f:
                    worker_data = json.load(f)
            else:
                worker_data = {
                    "worker_id": worker_id,
                    "jobs_completed": 0,
                    "jobs_failed": 0,
                    "created_at": datetime.now().isoformat()
                }

            worker_data["status"] = status
            worker_data["hostname"] = platform.node()
            worker_data["last_heartbeat"] = datetime.now().isoformat()
            if current_job is not None:
                worker_data["current_job"] = current_job
            if gpu_model:
                worker_data["gpu_model"] = gpu_model

            with open(worker_file, "w") as f:
                json.dump(worker_data, f, indent=2)

            return True
        except Exception as e:
            print(f"Error updating worker status: {e}")
            return False

    def increment_worker_stat(self, worker_id: str, stat: str) -> bool:
        """Increment worker stat (jobs_completed or jobs_failed)"""
        try:
            worker_file = self.workers_dir / f"{worker_id}.json"

            if not worker_file.exists():
                return False

            with open(worker_file) as f:
                worker_data = json.load(f)

            worker_data[stat] = worker_data.get(stat, 0) + 1

            with open(worker_file, "w") as f:
                json.dump(worker_data, f, indent=2)

            return True
        except:
            return False


# ============================================================================
# LOCAL VIDEO WORKER
# ============================================================================

class LocalVideoWorker:
    """Local video encoding worker with Whisper subtitles"""

    def __init__(self):
        """Initialize worker"""
        # Worker identification
        default_worker_id = f"contabo_{platform.node()}"
        self.worker_id = os.getenv("WORKER_ID", default_worker_id)
        self.hostname = platform.node()

        # GPU/CPU mode
        self.force_cpu = os.getenv("FORCE_CPU_ENCODER", "true").lower() in ("true", "1", "yes")
        self.gpu_model = "CPU Mode" if self.force_cpu else "GPU"

        # Initialize components
        print("🔄 Initializing worker components...", flush=True)
        self.queue = LocalVideoQueue()
        self.video_gen = VideoGenerator()

        # Data directory
        self.data_dir = os.getenv("DATA_DIR", "/root/tts/data")

        # Working directory for temp files
        self.work_dir = os.getenv("WORK_DIR", "/tmp/video_worker")
        os.makedirs(self.work_dir, exist_ok=True)

        # Configuration
        self.poll_interval = int(os.getenv("POLL_INTERVAL", "30"))

        print(f"✅ Worker ID: {self.worker_id}", flush=True)
        print(f"✅ Data directory: {self.data_dir}", flush=True)
        print(f"✅ Work directory: {self.work_dir}", flush=True)
        print(f"✅ CPU Mode: {self.force_cpu}", flush=True)

    def get_random_image(self, image_folder: str = "nature") -> Optional[str]:
        """Get random image from images folder"""
        images_dir = os.path.join(self.data_dir, "images", image_folder)

        if not os.path.exists(images_dir):
            print(f"❌ Images folder not found: {images_dir}")
            return None

        images = [
            f for f in os.listdir(images_dir)
            if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp'))
        ]

        if not images:
            print(f"❌ No images in folder: {images_dir}")
            return None

        selected = random.choice(images)
        return os.path.join(images_dir, selected)

    async def upload_to_gofile(self, file_path: str) -> Optional[str]:
        """Upload file to Gofile"""
        try:
            import httpx

            async with httpx.AsyncClient(timeout=600.0) as client:
                # Get server
                server_response = await client.get("https://api.gofile.io/servers")
                if server_response.status_code != 200:
                    return None

                servers = server_response.json().get("data", {}).get("servers", [])
                if not servers:
                    return None
                server = servers[0].get("name")

                # Upload
                with open(file_path, 'rb') as f:
                    files = {'file': f}
                    upload_response = await client.post(
                        f"https://{server}.gofile.io/contents/uploadfile",
                        files=files
                    )

                if upload_response.status_code == 200:
                    data = upload_response.json().get("data", {})
                    link = data.get("downloadPage")
                    print(f"✅ Gofile: {link}")
                    return link

            return None

        except Exception as e:
            print(f"❌ Gofile upload failed: {e}")
            return None

    async def process_job(self, job: Dict):
        """
        Process a video job

        Steps:
        1. Read audio from organized folder
        2. Get random image from images folder
        3. Generate video with VideoGenerator (Whisper subtitles)
        4. Save to organized folder
        5. Upload to Gofile
        6. Mark job complete
        """
        job_id = job['job_id']
        channel_code = job['channel_code']
        video_number = job['video_number']
        date = job['date']
        organized_path = job['organized_path']
        image_folder = job.get('image_folder', 'nature')

        try:
            print(f"\n{'='*60}", flush=True)
            print(f"🎬 Processing Job: {job_id[:8]}...", flush=True)
            print(f"   Channel: {channel_code}", flush=True)
            print(f"   Video: {video_number}", flush=True)
            print(f"   Date: {date}", flush=True)
            print(f"   Image Folder: {image_folder}", flush=True)
            print(f"{'='*60}\n", flush=True)

            # Update worker status
            self.queue.update_worker_status(self.worker_id, status="busy", current_job=job_id)

            # Build local paths
            # organized_path is like "/organized/2025-11-28/BI/video_1"
            local_organized = os.path.join(self.data_dir, organized_path.lstrip('/'))

            if not os.path.exists(local_organized):
                raise Exception(f"Organized folder not found: {local_organized}")

            # 1. Get audio path
            audio_path = os.path.join(local_organized, "audio.wav")
            if not os.path.exists(audio_path):
                # Try other formats
                for ext in [".mp3", ".m4a", ".flac"]:
                    alt_path = os.path.join(local_organized, f"audio{ext}")
                    if os.path.exists(alt_path):
                        audio_path = alt_path
                        break
                else:
                    raise Exception(f"Audio not found in: {local_organized}")

            print(f"📥 Audio: {audio_path}", flush=True)

            # 2. Get random image
            image_path = self.get_random_image(image_folder)
            if not image_path:
                raise Exception(f"No images in {image_folder} folder")

            print(f"🖼️ Image: {image_path}", flush=True)

            # 3. Generate video with VideoGenerator (Whisper subtitles)
            print(f"\n🎬 Generating video with Whisper subtitles...", flush=True)
            print(f"⏰ This may take a while (CPU mode)...", flush=True)

            video_output = os.path.join(local_organized, "video.mp4")

            # Get subtitle style from job or use default
            subtitle_style = job.get('subtitle_style')

            # Progress callback
            async def video_progress(msg):
                print(f"   {msg}", flush=True)

            # Get event loop
            loop = asyncio.get_event_loop()

            # Create video with subtitles (runs in thread)
            final_video = await asyncio.to_thread(
                self.video_gen.create_video_with_subtitles,
                image_path,
                audio_path,
                video_output,
                subtitle_style,
                video_progress,
                loop
            )

            if not final_video or not os.path.exists(final_video):
                raise Exception("Video generation failed")

            video_size_mb = os.path.getsize(final_video) / (1024 * 1024)
            print(f"✅ Video generated: {final_video} ({video_size_mb:.1f} MB)", flush=True)

            # 4. Upload to Gofile
            print(f"\n📤 Uploading to Gofile...", flush=True)
            gofile_link = await self.upload_to_gofile(final_video)

            # 5. Mark job complete
            self.queue.complete_job(job_id, self.worker_id, gofile_link)
            self.queue.increment_worker_stat(self.worker_id, "jobs_completed")

            # 6. Send notification to user
            job_username = job.get("username")
            send_telegram(
                f"🎬 <b>Video Complete</b>\n"
                f"Channel: {channel_code}\n"
                f"Video: {video_number}\n"
                f"Date: {date}\n"
                f"Size: {video_size_mb:.1f} MB\n"
                f"Gofile: {gofile_link or 'N/A'}",
                username=job_username
            )

            # 7. Delete used image
            try:
                if image_path and os.path.exists(image_path):
                    os.remove(image_path)
                    print(f"🗑️ Deleted image: {os.path.basename(image_path)}", flush=True)
            except Exception as del_err:
                print(f"⚠️ Could not delete image: {del_err}", flush=True)

            print(f"\n✅ Job {job_id[:8]} completed successfully!")
            print(f"{'='*60}\n", flush=True)

        except Exception as e:
            error_msg = str(e)
            print(f"\n❌ Job {job_id[:8]} failed: {error_msg}", flush=True)
            import traceback
            traceback.print_exc()

            # Mark job as failed
            self.queue.fail_job(job_id, self.worker_id, error_msg)
            self.queue.increment_worker_stat(self.worker_id, "jobs_failed")

            # Send failure notification to user
            job_username = job.get("username")
            send_telegram(
                f"❌ <b>Video Failed</b>\n"
                f"Channel: {channel_code}\n"
                f"Video: {video_number}\n"
                f"Error: {error_msg}",
                username=job_username
            )

        finally:
            # Update worker status
            self.queue.update_worker_status(self.worker_id, status="online", current_job=None)

    async def run(self):
        """Main worker loop"""
        print(f"\n{'='*60}", flush=True)
        print(f"🚀 Video Worker Starting (NO SUPABASE)", flush=True)
        print(f"{'='*60}", flush=True)
        print(f"   Worker ID: {self.worker_id}", flush=True)
        print(f"   Hostname: {self.hostname}", flush=True)
        print(f"   Mode: {self.gpu_model}", flush=True)
        print(f"   Poll interval: {self.poll_interval}s", flush=True)
        print(f"{'='*60}\n", flush=True)

        # Register worker
        self.queue.update_worker_status(
            self.worker_id,
            status="online",
            gpu_model=self.gpu_model
        )
        print(f"✅ Worker registered", flush=True)

        try:
            while True:
                # Check for pending jobs
                job = self.queue.claim_job(self.worker_id)

                if job:
                    await self.process_job(job)
                else:
                    stats = self.queue.get_stats()
                    print(f"⏳ No pending jobs (queue: {stats['pending']} pending, {stats['processing']} processing). Waiting {self.poll_interval}s...")
                    await asyncio.sleep(self.poll_interval)

        except KeyboardInterrupt:
            print(f"\n\n👋 Worker stopped by user")
            self.queue.update_worker_status(self.worker_id, status="offline")

        except Exception as e:
            print(f"\n❌ Worker error: {e}")
            import traceback
            traceback.print_exc()

            # Wait before restart
            print("⏳ Waiting 60 seconds before restart...")
            await asyncio.sleep(60)


# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    print("🔧 Starting video worker...", flush=True)
    try:
        worker = LocalVideoWorker()
        asyncio.run(worker.run())

    except KeyboardInterrupt:
        print("\n\n⚠️ Interrupted by user", flush=True)

    except Exception as e:
        print(f"\n\n❌ Fatal error: {e}", flush=True)
        import traceback
        traceback.print_exc()

    finally:
        print("\n✅ Worker shutdown complete", flush=True)
