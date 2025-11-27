#!/usr/bin/env python3
"""
Audio Worker for TTS Dashboard - NO SUPABASE VERSION
Runs on Vast.ai - Downloads from Contabo, generates audio, uploads back

Flow:
1. Poll Contabo File Server for pending audio jobs
2. Claim job (atomic via file move)
3. Download script from Contabo file server
4. Download reference audio from Contabo
5. Generate audio with F5-TTS
6. Upload audio to Contabo organized folder
7. Upload to Gofile for backup
8. Mark job complete via File Server
9. Create video job via File Server
"""

import os
import sys
import time
import uuid
import json
import socket
import asyncio
import traceback
import tempfile
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Tuple

import requests
import torch
import numpy as np
import soundfile as sf
from f5_tts.api import F5TTS

# ============================================================================
# CONFIGURATION
# ============================================================================

# Contabo File Server (ONLY dependency now - no Supabase!)
# These MUST be set in environment variables - no defaults for security
FILE_SERVER_URL = os.getenv("FILE_SERVER_URL")
FILE_SERVER_API_KEY = os.getenv("FILE_SERVER_API_KEY")

if not FILE_SERVER_URL or not FILE_SERVER_API_KEY:
    raise ValueError("FILE_SERVER_URL and FILE_SERVER_API_KEY must be set in environment")

# Telegram notifications (optional)
TELEGRAM_BOT_TOKEN = os.getenv("BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("CHAT_ID")

# Worker config
WORKER_ID = os.getenv("WORKER_ID", f"vastai_{socket.gethostname()}_{uuid.uuid4().hex[:8]}")
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "30"))  # seconds
HEARTBEAT_INTERVAL = int(os.getenv("HEARTBEAT_INTERVAL", "60"))  # seconds

# Audio generation config
TTS_MODEL = os.getenv("TTS_MODEL", "F5-TTS")
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "500"))  # characters per chunk

# Paths
TEMP_DIR = os.getenv("TEMP_DIR", "/tmp/tts_worker")
OUTPUT_DIR = os.getenv("OUTPUT_DIR", "/tmp/tts_output")

# Create temp directories
os.makedirs(TEMP_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Initialize F5-TTS model globally
print("🔄 Loading F5-TTS model...")
f5_model = None
try:
    f5_model = F5TTS()
    print("✅ F5-TTS model loaded")
except Exception as e:
    print(f"❌ Failed to load F5-TTS model: {e}")

# ============================================================================
# FILE SERVER QUEUE CLIENT
# ============================================================================

class FileServerQueue:
    """Client for Contabo file server queue operations"""

    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.headers = {"x-api-key": api_key, "Content-Type": "application/json"}
        self.file_headers = {"x-api-key": api_key}

    # ===================== QUEUE OPERATIONS =====================

    def claim_audio_job(self, worker_id: str) -> Optional[Dict]:
        """Claim next pending audio job (atomic)"""
        try:
            response = requests.post(
                f"{self.base_url}/queue/audio/claim",
                json={"worker_id": worker_id},
                headers=self.headers,
                timeout=30
            )

            if response.status_code == 200:
                data = response.json()
                return data.get("job")
            else:
                print(f"❌ Claim job failed: {response.status_code} - {response.text}")
                return None
        except Exception as e:
            print(f"❌ Claim job error: {e}")
            return None

    def complete_audio_job(self, job_id: str, worker_id: str, gofile_link: str = None) -> bool:
        """Mark audio job as completed"""
        try:
            response = requests.post(
                f"{self.base_url}/queue/audio/jobs/{job_id}/complete",
                json={"worker_id": worker_id, "gofile_link": gofile_link},
                headers=self.headers,
                timeout=30
            )
            return response.status_code == 200
        except Exception as e:
            print(f"❌ Complete job error: {e}")
            return False

    def fail_audio_job(self, job_id: str, worker_id: str, error_message: str) -> bool:
        """Mark audio job as failed"""
        try:
            response = requests.post(
                f"{self.base_url}/queue/audio/jobs/{job_id}/fail",
                json={"worker_id": worker_id, "error_message": error_message},
                headers=self.headers,
                timeout=30
            )
            return response.status_code == 200
        except Exception as e:
            print(f"❌ Fail job error: {e}")
            return False

    def create_video_job(self, audio_job: Dict) -> bool:
        """Create video job after audio is complete"""
        try:
            video_job = {
                "audio_job_id": audio_job["job_id"],
                "channel_code": audio_job["channel_code"],
                "video_number": audio_job["video_number"],
                "date": audio_job["date"],
                "organized_path": audio_job["organized_path"],
                "image_folder": "nature",
                "priority": 1
            }

            response = requests.post(
                f"{self.base_url}/queue/video/jobs",
                json=video_job,
                headers=self.headers,
                timeout=30
            )

            if response.status_code == 200:
                data = response.json()
                print(f"✅ Video job created: {data.get('job_id', 'unknown')}")
                return True
            else:
                print(f"❌ Create video job failed: {response.status_code} - {response.text}")
                return False
        except Exception as e:
            print(f"❌ Create video job error: {e}")
            return False

    def get_queue_stats(self) -> Dict:
        """Get audio queue statistics"""
        try:
            response = requests.get(
                f"{self.base_url}/queue/audio/stats",
                headers=self.file_headers,
                timeout=30
            )
            if response.status_code == 200:
                return response.json()
            return {}
        except:
            return {}

    # ===================== WORKER OPERATIONS =====================

    def send_heartbeat(self, worker_id: str, status: str = "online",
                       hostname: str = None, gpu_model: str = None,
                       current_job: str = None) -> bool:
        """Send worker heartbeat"""
        try:
            response = requests.post(
                f"{self.base_url}/workers/audio/heartbeat",
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
        """Increment worker stat (jobs_completed or jobs_failed)"""
        try:
            response = requests.post(
                f"{self.base_url}/workers/audio/{worker_id}/increment",
                params={"stat": stat},
                headers=self.file_headers,
                timeout=30
            )
            return response.status_code == 200
        except:
            return False

    # ===================== FILE OPERATIONS =====================

    def download_file(self, remote_path: str, local_path: str) -> bool:
        """Download file from Contabo"""
        try:
            url = f"{self.base_url}/files/{remote_path}"
            response = requests.get(url, headers=self.file_headers, stream=True, timeout=300)

            if response.status_code == 200:
                os.makedirs(os.path.dirname(local_path), exist_ok=True)
                with open(local_path, "wb") as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        f.write(chunk)
                print(f"✅ Downloaded: {remote_path}")
                return True
            else:
                print(f"❌ Download failed: {response.status_code} - {response.text}")
                return False
        except Exception as e:
            print(f"❌ Download error: {e}")
            return False

    def upload_file(self, local_path: str, remote_path: str) -> bool:
        """Upload file to Contabo"""
        try:
            url = f"{self.base_url}/files/{remote_path}"
            with open(local_path, "rb") as f:
                files = {"file": (os.path.basename(local_path), f)}
                response = requests.post(url, headers=self.file_headers, files=files, timeout=600)

            if response.status_code == 200:
                print(f"✅ Uploaded: {remote_path}")
                return True
            else:
                print(f"❌ Upload failed: {response.status_code} - {response.text}")
                return False
        except Exception as e:
            print(f"❌ Upload error: {e}")
            return False

    def get_script(self, organized_path: str) -> Optional[str]:
        """Get script content from organized folder"""
        try:
            url = f"{self.base_url}/files{organized_path}/script.txt"
            response = requests.get(url, headers=self.file_headers, timeout=60)

            if response.status_code == 200:
                return response.text
            else:
                print(f"❌ Get script failed: {response.status_code}")
                return None
        except Exception as e:
            print(f"❌ Get script error: {e}")
            return None

    def get_reference_audio(self, channel_code: str, local_path: str) -> bool:
        """Download reference audio for channel"""
        remote_path = f"reference-audio/{channel_code}.wav"
        return self.download_file(remote_path, local_path)


# Initialize queue client
queue = FileServerQueue(FILE_SERVER_URL, FILE_SERVER_API_KEY)

# ============================================================================
# GOFILE UPLOAD
# ============================================================================

def upload_to_gofile(file_path: str) -> Optional[str]:
    """Upload file to Gofile and return download link"""
    try:
        # Get best server
        server_response = requests.get("https://api.gofile.io/servers", timeout=30)
        server_data = server_response.json()

        if server_data["status"] != "ok":
            print("❌ Failed to get Gofile server")
            return None

        server = server_data["data"]["servers"][0]["name"]

        # Upload file
        with open(file_path, "rb") as f:
            response = requests.post(
                f"https://{server}.gofile.io/contents/uploadfile",
                files={"file": f},
                timeout=600
            )

        data = response.json()
        if data["status"] == "ok":
            download_link = data["data"]["downloadPage"]
            print(f"✅ Gofile upload: {download_link}")
            return download_link
        else:
            print(f"❌ Gofile upload failed: {data}")
            return None

    except Exception as e:
        print(f"❌ Gofile upload error: {e}")
        return None

# ============================================================================
# TELEGRAM NOTIFICATIONS
# ============================================================================

def send_telegram(message: str):
    """Send Telegram notification"""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return

    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        requests.post(url, json={
            "chat_id": TELEGRAM_CHAT_ID,
            "text": message,
            "parse_mode": "HTML"
        }, timeout=10)
    except Exception as e:
        print(f"Telegram error: {e}")

# ============================================================================
# TTS GENERATION (F5-TTS)
# ============================================================================

def generate_audio_f5tts(
    script_text: str,
    reference_audio_path: str,
    output_path: str,
    chunk_size: int = 500
) -> bool:
    """
    Generate audio using F5-TTS Python API

    Args:
        script_text: Text to convert to speech
        reference_audio_path: Path to reference audio
        output_path: Output WAV file path
        chunk_size: Characters per chunk

    Returns:
        True if successful
    """
    global f5_model

    try:
        print(f"🎙️ Generating audio with F5-TTS...")
        print(f"   Script length: {len(script_text)} chars")
        print(f"   Reference: {reference_audio_path}")

        if f5_model is None:
            print("❌ F5-TTS model not loaded!")
            return False

        # Split script into chunks
        chunks = split_into_chunks(script_text, chunk_size)
        print(f"   Chunks: {len(chunks)}")

        all_audio_data = []
        sample_rate = 24000

        for i, chunk in enumerate(chunks):
            print(f"   Processing chunk {i+1}/{len(chunks)}...")

            try:
                # Clear GPU cache
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()

                # Generate audio using Python API
                with torch.inference_mode():
                    result = f5_model.infer(
                        ref_file=reference_audio_path,
                        ref_text="",  # Auto-extract with Whisper
                        gen_text=chunk,
                        remove_silence=True,
                        cross_fade_duration=0.15,
                        speed=1.0,
                        nfe_step=32,
                        cfg_strength=1.5,
                        target_rms=0.1
                    )

                # Extract audio data
                if isinstance(result, tuple):
                    audio_data = result[0]
                    sample_rate = result[1] if len(result) > 1 else 24000
                else:
                    audio_data = result

                all_audio_data.append(audio_data)
                print(f"   ✅ Chunk {i+1} done ({len(audio_data)} samples)")

            except Exception as e:
                print(f"   ❌ Chunk {i+1} failed: {e}")
                continue

        if not all_audio_data:
            print("❌ No chunks generated")
            return False

        # Concatenate all audio
        final_audio = np.concatenate(all_audio_data)

        # Save to file
        sf.write(output_path, final_audio, sample_rate)

        if os.path.exists(output_path):
            file_size = os.path.getsize(output_path)
            print(f"✅ Audio generated: {output_path} ({file_size / 1024 / 1024:.2f} MB)")
            return True
        else:
            print("❌ Output file not found")
            return False

    except Exception as e:
        print(f"❌ TTS generation error: {e}")
        traceback.print_exc()
        return False


def split_into_chunks(text: str, max_size: int) -> list:
    """Split text into chunks at sentence boundaries"""
    if len(text) <= max_size:
        return [text]

    chunks = []
    sentences = text.replace("।", ".").split(".")
    current_chunk = ""

    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue

        if len(current_chunk) + len(sentence) + 1 > max_size and current_chunk:
            chunks.append(current_chunk.strip())
            current_chunk = sentence + "."
        else:
            current_chunk += sentence + ". "

    if current_chunk.strip():
        chunks.append(current_chunk.strip())

    return chunks

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def get_gpu_info() -> str:
    """Get GPU info"""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=10
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except:
        pass
    return "Unknown"

# ============================================================================
# MAIN PROCESS JOB
# ============================================================================

def process_job(job: Dict) -> bool:
    """Process a single audio job"""
    job_id = job["job_id"]
    channel_code = job["channel_code"]
    video_number = job["video_number"]
    organized_path = job["organized_path"]

    print(f"\n{'='*60}")
    print(f"🎙️ Processing job: {job_id[:8]}...")
    print(f"   Channel: {channel_code}")
    print(f"   Video: {video_number}")
    print(f"   Date: {job['date']}")
    print(f"   Counter: #{job.get('audio_counter', 'N/A')}")
    print(f"{'='*60}")

    try:
        # Set worker status to busy
        queue.send_heartbeat(WORKER_ID, status="busy", current_job=job_id)

        # 1. Get script from Contabo
        print("\n📥 Getting script...")
        script = queue.get_script(organized_path)
        if not script:
            raise Exception("Failed to get script from file server")
        print(f"   Script length: {len(script)} chars")

        # 2. Get reference audio
        print("\n📥 Getting reference audio...")
        ref_audio_path = os.path.join(TEMP_DIR, f"{channel_code}_ref.wav")
        if not queue.get_reference_audio(channel_code, ref_audio_path):
            raise Exception(f"Failed to get reference audio for {channel_code}")

        # 3. Generate audio
        print("\n🎵 Generating audio...")
        output_audio = os.path.join(OUTPUT_DIR, f"{job.get('audio_counter', 0)}_{channel_code}_v{video_number}.wav")

        if not generate_audio_f5tts(script, ref_audio_path, output_audio):
            raise Exception("Audio generation failed")

        # 4. Upload audio to Contabo
        print("\n📤 Uploading audio to Contabo...")
        remote_audio_path = f"{organized_path.lstrip('/')}/audio.wav"
        if not queue.upload_file(output_audio, remote_audio_path):
            raise Exception("Failed to upload audio to Contabo")

        # 5. Upload to Gofile
        print("\n📤 Uploading to Gofile...")
        gofile_link = upload_to_gofile(output_audio)

        # 6. Complete job via File Server
        queue.complete_audio_job(job_id, WORKER_ID, gofile_link)
        queue.increment_worker_stat(WORKER_ID, "jobs_completed")

        # 7. Create video job via File Server
        queue.create_video_job(job)

        # 8. Send notification
        send_telegram(
            f"🎵 <b>Audio Complete</b>\n"
            f"Channel: {channel_code}\n"
            f"Video: {video_number}\n"
            f"Counter: #{job.get('audio_counter', 'N/A')}\n"
            f"Gofile: {gofile_link or 'N/A'}"
        )

        # Cleanup
        try:
            os.remove(output_audio)
            os.remove(ref_audio_path)
        except:
            pass

        print(f"\n✅ Job completed successfully!")
        return True

    except Exception as e:
        error_msg = str(e)
        print(f"\n❌ Job failed: {error_msg}")
        traceback.print_exc()

        queue.fail_audio_job(job_id, WORKER_ID, error_msg)
        queue.increment_worker_stat(WORKER_ID, "jobs_failed")

        send_telegram(f"❌ <b>Audio Failed</b>\n{channel_code} v{video_number}\n{error_msg}")

        return False

    finally:
        # Set worker status back to online
        queue.send_heartbeat(WORKER_ID, status="online", current_job=None)

# ============================================================================
# MAIN LOOP
# ============================================================================

def main():
    """Main worker loop"""
    print(f"\n{'='*60}")
    print(f"🚀 TTS Audio Worker Starting (NO SUPABASE)")
    print(f"{'='*60}")
    print(f"Worker ID: {WORKER_ID}")
    print(f"File Server: {FILE_SERVER_URL}")
    print(f"Poll Interval: {POLL_INTERVAL}s")
    print(f"{'='*60}\n")

    # Get GPU info and register
    gpu_info = get_gpu_info()
    print(f"GPU: {gpu_info}")

    # Send initial heartbeat
    queue.send_heartbeat(
        WORKER_ID,
        status="online",
        hostname=socket.gethostname(),
        gpu_model=gpu_info
    )
    print(f"✅ Worker registered: {WORKER_ID}")

    last_heartbeat = time.time()

    while True:
        try:
            # Update heartbeat
            if time.time() - last_heartbeat > HEARTBEAT_INTERVAL:
                queue.send_heartbeat(WORKER_ID, status="online")
                last_heartbeat = time.time()

            # Check for jobs
            job = queue.claim_audio_job(WORKER_ID)

            if job:
                process_job(job)
            else:
                # Get queue stats for info
                stats = queue.get_queue_stats()
                pending = stats.get("pending", 0)
                processing = stats.get("processing", 0)
                print(f"⏳ No pending jobs (queue: {pending} pending, {processing} processing). Waiting {POLL_INTERVAL}s...")
                time.sleep(POLL_INTERVAL)

        except KeyboardInterrupt:
            print("\n\n👋 Shutting down...")
            queue.send_heartbeat(WORKER_ID, status="offline")
            break

        except Exception as e:
            print(f"❌ Main loop error: {e}")
            traceback.print_exc()
            time.sleep(10)


if __name__ == "__main__":
    main()
