#!/usr/bin/env python3
"""
Unified Worker (Audio + Video in Single Job)
Runs on Vast.ai - Generates Audio then Video in one go

Flow:
1. Claim Audio Job
2. Generate Audio -> Upload to Gofile
3. Generate Video (using local audio) -> Upload to Gofile
4. Send Telegram notifications
5. Loop back
"""

import os
import sys
import time
import uuid
import json
import socket
import asyncio
import traceback
import random
import subprocess
from datetime import datetime
from typing import Optional, Dict

import requests
import torch
import numpy as np
import soundfile as sf
from f5_tts.api import F5TTS

# Import Video Generator (Make sure video_generator.py is in same folder)
from video_generator import VideoGenerator

# ============================================================================
# CONFIGURATION
# ============================================================================

FILE_SERVER_URL = os.getenv("FILE_SERVER_URL")
FILE_SERVER_API_KEY = os.getenv("FILE_SERVER_API_KEY")

if not FILE_SERVER_URL or not FILE_SERVER_API_KEY:
    raise ValueError("FILE_SERVER_URL and FILE_SERVER_API_KEY must be set")

# Telegram Config
def get_user_telegram_config(username: str) -> tuple:
    if not username: return os.getenv("BOT_TOKEN"), os.getenv("CHAT_ID")
    user_upper = username.upper()
    return (os.getenv(f"{user_upper}_BOT_TOKEN"), os.getenv(f"{user_upper}_CHAT_ID")) or (os.getenv("BOT_TOKEN"), os.getenv("CHAT_ID"))

def send_telegram(message: str, username: str = None):
    bot_token, chat_id = get_user_telegram_config(username)
    if not bot_token or not chat_id: return
    try:
        requests.post(f"https://api.telegram.org/bot{bot_token}/sendMessage", json={
            "chat_id": chat_id, "text": message, "parse_mode": "HTML"
        }, timeout=10)
    except: pass

def send_telegram_document(script_text: str, caption: str, filename: str, username: str = None):
    """Send script as .txt file attachment"""
    bot_token, chat_id = get_user_telegram_config(username)
    if not bot_token or not chat_id: return
    try:
        # Create temp file
        temp_file = os.path.join(TEMP_DIR, filename)
        with open(temp_file, 'w', encoding='utf-8') as f:
            f.write(script_text)

        # Send document
        with open(temp_file, 'rb') as f:
            requests.post(
                f"https://api.telegram.org/bot{bot_token}/sendDocument",
                data={"chat_id": chat_id, "caption": caption, "parse_mode": "HTML"},
                files={"document": (filename, f, "text/plain")},
                timeout=30
            )

        # Cleanup
        if os.path.exists(temp_file):
            os.remove(temp_file)
    except Exception as e:
        print(f"Telegram document error: {e}")

# Worker Config
WORKER_ID = os.getenv("WORKER_ID", f"unified_{socket.gethostname()}_{uuid.uuid4().hex[:8]}")
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "30"))

# Paths
TEMP_DIR = os.getenv("TEMP_DIR", "/tmp/tts_worker")
OUTPUT_DIR = os.getenv("OUTPUT_DIR", "/tmp/tts_output")
os.makedirs(TEMP_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Load Models Globally
print("🔄 Loading Models...")
f5_model = None
video_gen = None

try:
    f5_model = F5TTS()
    print("✅ F5-TTS model loaded")
    video_gen = VideoGenerator()
    print("✅ VideoGenerator loaded")
except Exception as e:
    print(f"❌ Failed to load models: {e}")
    sys.exit(1)

# ============================================================================
# FILE SERVER QUEUE (Merged Audio + Video)
# ============================================================================

class FileServerQueue:
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url.rstrip("/")
        self.headers = {"x-api-key": api_key, "Content-Type": "application/json"}
        self.file_headers = {"x-api-key": api_key}
        self.api_key = api_key

    # --- AUDIO METHODS ---
    def claim_audio_job(self, worker_id: str) -> Optional[Dict]:
        try:
            r = requests.post(f"{self.base_url}/queue/audio/claim", json={"worker_id": worker_id}, headers=self.headers, timeout=30)
            return r.json().get("job") if r.status_code == 200 else None
        except: return None

    def complete_audio_job(self, job_id: str, worker_id: str, gofile_link: str = None) -> bool:
        try:
            r = requests.post(f"{self.base_url}/queue/audio/jobs/{job_id}/complete", json={"worker_id": worker_id, "gofile_link": gofile_link}, headers=self.headers, timeout=30)
            return r.status_code == 200
        except: return False

    def fail_audio_job(self, job_id: str, worker_id: str, error_message: str) -> bool:
        try:
            r = requests.post(f"{self.base_url}/queue/audio/jobs/{job_id}/fail", json={"worker_id": worker_id, "error_message": error_message}, headers=self.headers, timeout=30)
            return r.status_code == 200
        except: return False

    # --- COMMON FILE OPS ---
    def download_file(self, remote_path: str, local_path: str) -> bool:
        try:
            r = requests.get(f"{self.base_url}/files/{remote_path}", headers=self.file_headers, stream=True, timeout=300)
            if r.status_code == 200:
                os.makedirs(os.path.dirname(local_path), exist_ok=True)
                with open(local_path, "wb") as f:
                    for chunk in r.iter_content(chunk_size=8192): f.write(chunk)
                return True
            return False
        except: return False

    def upload_file(self, local_path: str, remote_path: str) -> bool:
        try:
            with open(local_path, "rb") as f:
                r = requests.post(f"{self.base_url}/files/{remote_path}", headers=self.file_headers, files={"file": (os.path.basename(local_path), f)}, timeout=600)
            return r.status_code == 200
        except: return False

    def get_script(self, organized_path: str) -> Optional[str]:
        try:
            r = requests.get(f"{self.base_url}/files{organized_path}/script.txt", headers=self.file_headers, timeout=60)
            return r.text if r.status_code == 200 else None
        except: return None

    def get_reference_audio(self, reference_audio: str, local_path: str) -> bool:
        """Download reference audio by filename"""
        # Download the exact file specified
        if self.download_file(f"reference-audio/{reference_audio}", local_path):
            return True
        # Fallback: try without extension variations
        base_name = reference_audio.rsplit('.', 1)[0] if '.' in reference_audio else reference_audio
        if self.download_file(f"reference-audio/{base_name}.wav", local_path):
            return True
        if self.download_file(f"reference-audio/{base_name}.mp3", local_path):
            return True
        return False

    def get_random_image(self, image_folder: str = "nature") -> Optional[str]:
        try:
            r = requests.get(f"{self.base_url}/images/{image_folder}", headers={"x-api-key": self.api_key}, timeout=30)
            if r.status_code != 200: return None
            images = r.json().get("images", [])
            if not images: return None
            
            selected = random.choice(images)
            local_image = os.path.join(TEMP_DIR, "temp_image.jpg")
            if self.download_file(f"images/{image_folder}/{selected}", local_image):
                return local_image
            return None
        except: return None

    # --- HEARTBEAT ---
    def send_heartbeat(self, worker_id: str, status: str = "online", gpu_model: str = None, current_job: str = None) -> bool:
        try:
            # Identifies as Unified Worker
            r = requests.post(f"{self.base_url}/workers/audio/heartbeat", json={
                "worker_id": worker_id, "status": status, "hostname": socket.gethostname(), "gpu_model": gpu_model, "current_job": current_job
            }, headers=self.headers, timeout=10)
            return r.status_code == 200
        except: return False

    def increment_worker_stat(self, worker_id: str, stat: str) -> bool:
        try:
            requests.post(f"{self.base_url}/workers/audio/{worker_id}/increment", params={"stat": stat}, headers=self.file_headers, timeout=10)
            return True
        except: return False

queue = FileServerQueue(FILE_SERVER_URL, FILE_SERVER_API_KEY)

# ============================================================================
# UTILS
# ============================================================================

async def upload_to_gofile(file_path: str) -> Optional[str]:
    try:
        import httpx
        async with httpx.AsyncClient(timeout=600.0) as client:
            srv = await client.get("https://api.gofile.io/servers")
            if srv.status_code != 200: return None
            server = srv.json()["data"]["servers"][0]["name"]
            with open(file_path, 'rb') as f:
                up = await client.post(f"https://{server}.gofile.io/contents/uploadfile", files={'file': f})
            return up.json()["data"]["downloadPage"] if up.status_code == 200 else None
    except Exception as e:
        print(f"Gofile error: {e}")
        return None

def generate_audio_f5tts(script_text: str, ref_audio: str, out_path: str, chunk_size=500) -> bool:
    try:
        print(f"🎙️ Generating Audio (Len: {len(script_text)})...")
        if f5_model is None: return False
        
        chunks = []
        curr = ""
        for s in script_text.replace("।", ".").split("."):
            if len(curr) + len(s) > chunk_size: chunks.append(curr); curr = s + "."
            else: curr += s + ". "
        if curr: chunks.append(curr)

        all_audio = []
        rate = 24000
        for i, chk in enumerate(chunks):
            print(f"   Chunk {i+1}/{len(chunks)}...")
            if torch.cuda.is_available(): torch.cuda.empty_cache()
            with torch.inference_mode():
                res = f5_model.infer(ref_file=ref_audio, ref_text="", gen_text=chk, remove_silence=True, speed=1.0)
            audio_data = res[0] if isinstance(res, tuple) else res
            all_audio.append(audio_data)
        
        if not all_audio: return False
        sf.write(out_path, np.concatenate(all_audio), rate)
        return os.path.exists(out_path)
    except Exception as e:
        print(f"❌ TTS Error: {e}")
        traceback.print_exc()
        return False

# ============================================================================
# JOB PROCESSOR (Audio + Video Combined)
# ============================================================================

async def process_job(job: Dict) -> bool:
    """Process Audio + Video in single job - all local, upload to Gofile"""
    job_id = job["job_id"]
    channel = job["channel_code"]
    org_path = job["organized_path"]
    # Get reference_audio from job, fallback to channel_code.wav
    ref_audio_file = job.get("reference_audio") or f"{channel}.wav"

    print(f"\n🎯 Processing Job: {job_id[:8]} ({channel} #{job['video_number']})")
    print(f"   Reference Audio: {ref_audio_file}")
    queue.send_heartbeat(WORKER_ID, status="busy", current_job=job_id)

    # Local Paths
    local_ref_audio = os.path.join(TEMP_DIR, f"{channel}_ref.wav")
    local_audio_out = os.path.join(OUTPUT_DIR, f"audio_{job_id}.wav")
    local_video_out = os.path.join(OUTPUT_DIR, f"video_{job_id}.mp4")
    local_image = None

    try:
        # ========== STEP 1: AUDIO GENERATION ==========
        print("\n" + "="*50)
        print("🎧 STEP 1: Audio Generation")
        print("="*50)

        # Get Script & Ref Audio (use script_text from job first, fallback to file)
        script = job.get('script_text') or queue.get_script(org_path)
        if not script: raise Exception("Script fetch failed")
        if not queue.get_reference_audio(ref_audio_file, local_ref_audio): raise Exception(f"Ref audio failed: {ref_audio_file}")

        # Generate Audio
        if not generate_audio_f5tts(script, local_ref_audio, local_audio_out):
            raise Exception("TTS failed")

        # Upload Audio to Gofile
        print("📤 Uploading audio to Gofile...")
        audio_gofile = await upload_to_gofile(local_audio_out)
        if not audio_gofile:
            raise Exception("Audio Gofile upload failed")

        print(f"✅ Audio uploaded: {audio_gofile}")

        # Send Audio Notification with script as .txt file
        script_filename = f"{channel}_V{job['video_number']}_{job.get('date', 'unknown')}_script.txt"
        send_telegram_document(
            script_text=script,
            caption=f"🎵 <b>Audio Complete</b>\n"
                    f"<b>Channel:</b> {channel} | <b>Video:</b> #{job['video_number']}\n"
                    f"<b>Date:</b> {job.get('date', 'N/A')}\n\n"
                    f"<b>🔗 Audio:</b> {audio_gofile}",
            filename=script_filename,
            username=job.get("username")
        )

        # ========== STEP 2: VIDEO GENERATION ==========
        print("\n" + "="*50)
        print("🎬 STEP 2: Video Generation")
        print("="*50)

        # Get Image
        image_folder = job.get('image_folder', 'nature')
        local_image = queue.get_random_image(image_folder)
        if not local_image: raise Exception("Image fetch failed")

        # Generate Video (using local audio directly - no download needed!)
        print("🎥 Generating Video with subtitles...")
        async def prog(msg): print(f"   {msg}")

        final_vid = await asyncio.to_thread(
            video_gen.create_video_with_subtitles,
            local_image, local_audio_out, local_video_out,  # Using local audio!
            job.get('subtitle_style'), prog, asyncio.get_event_loop()
        )

        if not final_vid: raise Exception("Video generation failed")

        # Upload Video to Gofile
        print("📤 Uploading video to Gofile...")
        video_gofile = await upload_to_gofile(final_vid)
        if not video_gofile:
            raise Exception("Video Gofile upload failed")

        print(f"✅ Video uploaded: {video_gofile}")

        # ========== STEP 3: COMPLETE JOB ==========
        # Complete with video gofile link (primary output)
        queue.complete_audio_job(job_id, WORKER_ID, video_gofile)
        queue.increment_worker_stat(WORKER_ID, "jobs_completed")

        # Send Video Notification with script as .txt file
        send_telegram_document(
            script_text=script,
            caption=f"🎬 <b>Video Complete</b>\n"
                    f"<b>Channel:</b> {channel} | <b>Video:</b> #{job['video_number']}\n"
                    f"<b>Date:</b> {job.get('date', 'N/A')}\n\n"
                    f"<b>🔗 Video:</b> {video_gofile}",
            filename=script_filename,
            username=job.get("username")
        )

        print("\n" + "="*50)
        print(f"✅ JOB COMPLETE: {job_id[:8]}")
        print(f"   Audio: {audio_gofile}")
        print(f"   Video: {video_gofile}")
        print("="*50)

        return True

    except Exception as e:
        print(f"❌ Job Failed: {e}")
        traceback.print_exc()
        queue.fail_audio_job(job_id, WORKER_ID, str(e))
        return False
    finally:
        # Cleanup all temp files
        try:
            for f in [local_audio_out, local_video_out, local_image, local_ref_audio]:
                if f and os.path.exists(f): os.remove(f)
        except: pass


# ============================================================================
# MAIN LOOP (SIMPLIFIED - Audio + Video in one go)
# ============================================================================

async def main():
    print(f"🚀 UNIFIED WORKER STARTED (Audio + Video Combined)")
    print(f"Worker ID: {WORKER_ID}")
    print(f"Poll Interval: {POLL_INTERVAL}s")

    # Register with GPU info
    gpu = subprocess.run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"], capture_output=True, text=True).stdout.strip()
    queue.send_heartbeat(WORKER_ID, status="online", gpu_model=gpu)
    print(f"GPU: {gpu}")

    while True:
        try:
            # Look for Audio Job (which now includes video generation)
            job = queue.claim_audio_job(WORKER_ID)

            if job:
                # Process Audio + Video in one go
                await process_job(job)
            else:
                print(f"⏳ Waiting for jobs... ({POLL_INTERVAL}s)")
                await asyncio.sleep(POLL_INTERVAL)

            queue.send_heartbeat(WORKER_ID, status="online")

        except KeyboardInterrupt:
            print("👋 Stopped")
            break
        except Exception as e:
            print(f"Loop Error: {e}")
            traceback.print_exc()
            await asyncio.sleep(10)

if __name__ == "__main__":
    asyncio.run(main())

