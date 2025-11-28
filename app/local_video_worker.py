#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Local Video Worker - VAST.AI GPU VERSION
Runs on Vast.ai - Uses local file queue and GPU-accelerated VideoGenerator with Whisper

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

# GPU Mode enabled for Vast.ai
# Note: FORCE_CPU_ENCODER removed - using GPU acceleration

import requests
from video_generator import VideoGenerator

# ============================================================================
# CONFIGURATION - File Server Connection
# ============================================================================

FILE_SERVER_URL = os.getenv("FILE_SERVER_URL")
FILE_SERVER_API_KEY = os.getenv("FILE_SERVER_API_KEY")

if not FILE_SERVER_URL or not FILE_SERVER_API_KEY:
    raise ValueError("FILE_SERVER_URL and FILE_SERVER_API_KEY must be set in environment")

print(f"✅ File Server: {FILE_SERVER_URL}")

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
# FILE SERVER QUEUE CLIENT (HTTP API)
# ============================================================================

class FileServerQueue:
    """Client for Contabo file server video queue operations via HTTP API"""

    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.headers = {"x-api-key": api_key, "Content-Type": "application/json"}
        self.file_headers = {"x-api-key": api_key}

    def claim_job(self, worker_id: str) -> Optional[Dict]:
        """Claim next pending video job via HTTP API"""
        try:
            response = requests.post(
                f"{self.base_url}/queue/video/claim",
                json={"worker_id": worker_id},
                headers=self.headers,
                timeout=30
            )

            if response.status_code == 200:
                data = response.json()
                job = data.get("job")
                if job:
                    print(f"✅ Claimed job: {job.get('job_id', 'unknown')[:8]}")
                return job
            else:
                return None
        except Exception as e:
            print(f"❌ Claim job error: {e}")
            return None

    def complete_job(self, job_id: str, worker_id: str, gofile_link: str = None) -> bool:
        """Mark video job as completed via HTTP API"""
        try:
            response = requests.post(
                f"{self.base_url}/queue/video/jobs/{job_id}/complete",
                json={"worker_id": worker_id, "gofile_link": gofile_link},
                headers=self.headers,
                timeout=30
            )
            success = response.status_code == 200
            if success:
                print(f"✅ Job completed: {job_id[:8]}")
            return success
        except Exception as e:
            print(f"❌ Complete job error: {e}")
            return False

    def fail_job(self, job_id: str, worker_id: str, error_message: str) -> bool:
        """Mark video job as failed via HTTP API"""
        try:
            response = requests.post(
                f"{self.base_url}/queue/video/jobs/{job_id}/fail",
                json={"worker_id": worker_id, "error_message": error_message},
                headers=self.headers,
                timeout=30
            )
            return response.status_code == 200
        except Exception as e:
            print(f"❌ Fail job error: {e}")
            return False

    def get_stats(self) -> Dict:
        """Get video queue statistics via HTTP API"""
        try:
            response = requests.get(
                f"{self.base_url}/queue/video/stats",
                headers=self.file_headers,
                timeout=30
            )
            if response.status_code == 200:
                return response.json()
            return {}
        except:
            return {}

    def send_heartbeat(self, worker_id: str, status: str = "online",
                       hostname: str = None, gpu_model: str = None,
                       current_job: str = None) -> bool:
        """Send worker heartbeat via HTTP API"""
        try:
            response = requests.post(
                f"{self.base_url}/workers/video/heartbeat",
                json={
                    "worker_id": worker_id,
                    "status": status,
                    "hostname": hostname,
                    "gpu_model": gpu_model,
                    "current_job": current_job
                },
                headers=self.headers,
                timeout=30
            )
            return response.status_code == 200
        except Exception as e:
            print(f"❌ Heartbeat error: {e}")
            return False

    def increment_worker_stat(self, worker_id: str, stat: str) -> bool:
        """Increment worker stat via HTTP API"""
        try:
            response = requests.post(
                f"{self.base_url}/workers/video/{worker_id}/increment",
                params={"stat": stat},
                headers=self.file_headers,
                timeout=30
            )
            return response.status_code == 200
        except:
            return False

    def download_file(self, remote_path: str, local_path: str) -> bool:
        """Download file from Contabo file server"""
        try:
            url = f"{self.base_url}/files/{remote_path}"
            response = requests.get(url, headers=self.file_headers, stream=True, timeout=300)

            if response.status_code == 200:
                os.makedirs(os.path.dirname(local_path), exist_ok=True)
                with open(local_path, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        f.write(chunk)
                return True
            return False
        except Exception as e:
            print(f"❌ Download error: {e}")
            return False

    def upload_file(self, local_path: str, remote_path: str) -> bool:
        """Upload file to Contabo file server"""
        try:
            url = f"{self.base_url}/files/{remote_path}"
            with open(local_path, 'rb') as f:
                response = requests.post(
                    url,
                    files={'file': f},
                    headers=self.file_headers,
                    timeout=600
                )
            return response.status_code == 200
        except Exception as e:
            print(f"❌ Upload error: {e}")
            return False

    # Compatibility methods for existing code
    def update_worker_status(self, worker_id: str, status: str = "online",
                             current_job: str = None, gpu_model: str = None) -> bool:
        """Alias for send_heartbeat (compatibility)"""
        return self.send_heartbeat(worker_id, status, platform.node(), gpu_model, current_job)


# ============================================================================
# LOCAL VIDEO WORKER
# ============================================================================

class LocalVideoWorker:
    """Local video encoding worker with Whisper subtitles"""

    def __init__(self):
        """Initialize worker"""
        # Worker identification
        default_worker_id = f"vastai_{platform.node()}"
        self.worker_id = os.getenv("WORKER_ID", default_worker_id)
        self.hostname = platform.node()

        # GPU Mode enabled for Vast.ai
        self.force_cpu = False
        self.gpu_model = "NVIDIA GPU (NVENC)"

        # Initialize components
        print("🔄 Initializing worker components...", flush=True)
        self.queue = FileServerQueue(FILE_SERVER_URL, FILE_SERVER_API_KEY)
        self.video_gen = VideoGenerator()  # Now uses GPU-optimized encoding

        # Data directory (Vast.ai temp storage)
        self.data_dir = os.getenv("DATA_DIR", "/tmp/video_data")

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
        """Get random image from file server"""
        try:
            # Get list of images from file server
            response = requests.get(
                f"{FILE_SERVER_URL}/images/{image_folder}",
                headers={"x-api-key": FILE_SERVER_API_KEY},
                timeout=30
            )

            if response.status_code != 200:
                print(f"❌ Failed to get image list: {response.status_code}")
                return None

            images = response.json().get("images", [])
            if not images:
                print(f"❌ No images in folder: {image_folder}")
                return None

            # Pick random image
            selected = random.choice(images)
            print(f"📷 Selected image: {selected}")

            # Download image to temp folder
            local_image = os.path.join(self.work_dir, "temp_image.jpg")
            remote_path = f"images/{image_folder}/{selected}"

            if self.queue.download_file(remote_path, local_image):
                return local_image
            else:
                print(f"❌ Failed to download image: {selected}")
                return None

        except Exception as e:
            print(f"❌ Get random image error: {e}")
            return None

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

            # 1. Download audio from Contabo file server
            # organized_path is like "organized/2025-11-28/BI/video_1"
            remote_audio = f"{organized_path.lstrip('/')}/audio.wav"
            local_audio = os.path.join(self.work_dir, "audio.wav")

            print(f"📥 Downloading audio from: {remote_audio}", flush=True)
            if not self.queue.download_file(remote_audio, local_audio):
                raise Exception(f"Failed to download audio from: {remote_audio}")

            print(f"✅ Audio downloaded: {local_audio}", flush=True)

            # 2. Get random image from file server
            image_path = self.get_random_image(image_folder)
            if not image_path:
                raise Exception(f"No images in {image_folder} folder")

            print(f"✅ Image: {image_path}", flush=True)

            # 3. Generate video with VideoGenerator (Whisper subtitles + GPU)
            print(f"\n🎬 Generating video with Whisper subtitles (GPU NVENC)...", flush=True)
            print(f"⏰ Using GPU acceleration...", flush=True)

            video_output = os.path.join(self.work_dir, "video.mp4")

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
                local_audio,
                video_output,
                subtitle_style,
                video_progress,
                loop
            )

            if not final_video or not os.path.exists(final_video):
                raise Exception("Video generation failed")

            video_size_mb = os.path.getsize(final_video) / (1024 * 1024)
            print(f"✅ Video generated: {final_video} ({video_size_mb:.1f} MB)", flush=True)

            # 4. Upload video back to Contabo file server
            print(f"\n📤 Uploading video to Contabo...", flush=True)
            remote_video = f"{organized_path.lstrip('/')}/video.mp4"
            if not self.queue.upload_file(final_video, remote_video):
                print(f"⚠️ Failed to upload video to Contabo: {remote_video}")

            # 5. Upload to Gofile for backup
            print(f"\n📤 Uploading to Gofile...", flush=True)
            gofile_link = await self.upload_to_gofile(final_video)

            # 6. Mark job complete
            self.queue.complete_job(job_id, self.worker_id, gofile_link)
            self.queue.increment_worker_stat(self.worker_id, "jobs_completed")

            # 7. Send notification to user
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

            # 8. Cleanup temp files
            try:
                for temp_file in [image_path, local_audio, final_video]:
                    if temp_file and os.path.exists(temp_file):
                        os.remove(temp_file)
                        print(f"🗑️ Deleted temp file: {os.path.basename(temp_file)}", flush=True)
            except Exception as del_err:
                print(f"⚠️ Could not delete temp files: {del_err}", flush=True)

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
        print(f"🚀 Video Worker Starting (VAST.AI GPU)", flush=True)
        print(f"{'='*60}", flush=True)
        print(f"   Worker ID: {self.worker_id}", flush=True)
        print(f"   Hostname: {self.hostname}", flush=True)
        print(f"   Mode: {self.gpu_model}", flush=True)
        print(f"   File Server: {FILE_SERVER_URL}", flush=True)
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
