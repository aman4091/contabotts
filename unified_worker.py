#!/usr/bin/env python3
"""
Unified Worker (Audio -> Video Sequential)
Runs on Vast.ai - Handles both Audio and Video jobs in a single loop

Flow:
1. Claim Audio Job
2. Generate Audio -> Upload to Contabo -> Create Video Job
3. IMMEDIATELY Claim Video Job (stops Audio polling)
4. Generate Video -> Upload to Contabo
5. Loop back to Audio
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

    # --- VIDEO METHODS ---
    def create_video_job(self, audio_job: Dict) -> bool:
        try:
            video_job = {
                "audio_job_id": audio_job["job_id"],
                "channel_code": audio_job["channel_code"],
                "video_number": audio_job["video_number"],
                "date": audio_job["date"],
                "organized_path": audio_job["organized_path"],
                "image_folder": "nature",
                "priority": 1,
                "username": audio_job.get("username")
            }
            r = requests.post(f"{self.base_url}/queue/video/jobs", json=video_job, headers=self.headers, timeout=30)
            if r.status_code == 200:
                print(f"✅ Video job created on server")
                return True
            return False
        except Exception as e:
            print(f"❌ Create video job error: {e}")
            return False

    def claim_video_job(self, worker_id: str) -> Optional[Dict]:
        try:
            r = requests.post(f"{self.base_url}/queue/video/claim", json={"worker_id": worker_id}, headers=self.headers, timeout=30)
            return r.json().get("job") if r.status_code == 200 else None
        except: return None

    def complete_video_job(self, job_id: str, worker_id: str, gofile_link: str = None) -> bool:
        try:
            r = requests.post(f"{self.base_url}/queue/video/jobs/{job_id}/complete", json={"worker_id": worker_id, "gofile_link": gofile_link}, headers=self.headers, timeout=30)
            return r.status_code == 200
        except: return False

    def fail_video_job(self, job_id: str, worker_id: str, error_message: str) -> bool:
        try:
            r = requests.post(f"{self.base_url}/queue/video/jobs/{job_id}/fail", json={"worker_id": worker_id, "error_message": error_message}, headers=self.headers, timeout=30)
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

    def get_reference_audio(self, channel_code: str, local_path: str) -> bool:
        return self.download_file(f"reference-audio/{channel_code}.wav", local_path)

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
# JOB PROCESSORS
# ============================================================================

async def process_audio_job(job: Dict) -> bool:
    """Standard Audio Job Process"""
    job_id = job["job_id"]
    channel = job["channel_code"]
    org_path = job["organized_path"]
    
    print(f"\n🎧 Processing AUDIO Job: {job_id[:8]}")
    queue.send_heartbeat(WORKER_ID, status="busy", current_job=job_id)

    # Local Paths
    local_script = os.path.join(TEMP_DIR, "script.txt")
    local_ref_audio = os.path.join(TEMP_DIR, f"{channel}_ref.wav")
    local_audio_out = os.path.join(OUTPUT_DIR, f"audio_{job_id}.wav")

    try:
        # 1. Get Script & Ref Audio
        script = queue.get_script(org_path)
        if not script: raise Exception("Script fetch failed")
        if not queue.get_reference_audio(channel, local_ref_audio): raise Exception("Ref audio failed")

        # 2. Generate Audio
        if not generate_audio_f5tts(script, local_ref_audio, local_audio_out): raise Exception("TTS failed")

        # 3. Upload to Contabo (STANDARD)
        print("📤 Uploading audio to Contabo...")
        if not queue.upload_file(local_audio_out, f"{org_path.lstrip('/')}/audio.wav"):
            raise Exception("Upload failed")

        # 4. Gofile & Complete
        gofile_link = await upload_to_gofile(local_audio_out)
        queue.complete_audio_job(job_id, WORKER_ID, gofile_link)
        queue.increment_worker_stat(WORKER_ID, "jobs_completed")
        
        # 5. Create Video Job
        queue.create_video_job(job)
        
        # Notify
        send_telegram(f"🎵 <b>Audio Complete</b>\n{channel} #{job['video_number']}\nGofile: {gofile_link}", username=job.get("username"))
        return True

    except Exception as e:
        print(f"❌ Audio Failed: {e}")
        queue.fail_audio_job(job_id, WORKER_ID, str(e))
        return False
    finally:
        # Don't delete local_audio_out yet! Video might use it (Optimization)
        try: os.remove(local_script)
        except: pass

async def process_video_job(job: Dict) -> bool:
    """Standard Video Job Process"""
    job_id = job["job_id"]
    channel = job["channel_code"]
    org_path = job["organized_path"]
    
    print(f"\n🎬 Processing VIDEO Job: {job_id[:8]}")
    queue.send_heartbeat(WORKER_ID, status="busy", current_job=job_id)
    
    local_audio = os.path.join(TEMP_DIR, "audio.wav")
    local_video_out = os.path.join(OUTPUT_DIR, f"video_{job_id}.mp4")

    try:
        # 1. Get Audio (Use standard download logic to be safe)
        print("📥 Checking Audio...")
        # Optimization: Check if we have it from previous step
        # But strictly following "Jaisa pehle chalta tha", we try download
        remote_audio = f"{org_path.lstrip('/')}/audio.wav"
        if not queue.download_file(remote_audio, local_audio):
             raise Exception("Audio download failed")
             
        # 2. Get Image
        image_folder = job.get('image_folder', 'nature')
        local_image = queue.get_random_image(image_folder)
        if not local_image: raise Exception("Image fetch failed")

        # 3. Generate Video
        print("🎥 Generating Video...")
        async def prog(msg): print(f"   {msg}")
        
        final_vid = await asyncio.to_thread(
            video_gen.create_video_with_subtitles,
            local_image, local_audio, local_video_out,
            job.get('subtitle_style'), prog, asyncio.get_event_loop()
        )
        
        if not final_vid: raise Exception("Video generation failed")

        # 4. Upload to Contabo
        print("📤 Uploading video to Contabo...")
        if not queue.upload_file(final_vid, f"{org_path.lstrip('/')}/video.mp4"):
             print("⚠️ Video upload failed")

        # 5. Gofile & Complete
        gofile = await upload_to_gofile(final_vid)
        queue.complete_video_job(job_id, WORKER_ID, gofile)
        
        # Notify
        send_telegram(f"🎬 <b>Video Complete</b>\n{channel} #{job['video_number']}\nGofile: {gofile}", username=job.get("username"))
        return True

    except Exception as e:
        print(f"❌ Video Failed: {e}")
        queue.fail_video_job(job_id, WORKER_ID, str(e))
        return False
    finally:
        try:
            for f in [local_audio, local_video_out, local_image]:
                if f and os.path.exists(f): os.remove(f)
        except: pass


# ============================================================================
# MAIN LOOP (SEQUENTIAL)
# ============================================================================

async def main():
    print(f"🚀 UNIFIED WORKER STARTED (Audio -> then Video)")
    print(f"Worker ID: {WORKER_ID}")
    
    # Register
    gpu = subprocess.run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"], capture_output=True, text=True).stdout.strip()
    queue.send_heartbeat(WORKER_ID, status="online", gpu_model=gpu)

    while True:
        try:
            # STEP 1: Look for AUDIO Job
            audio_job = queue.claim_audio_job(WORKER_ID)
            
            if audio_job:
                # Process Audio
                success = await process_audio_job(audio_job)
                
                if success:
                    # STEP 2: IMMEDIATELY Look for VIDEO Job (Don't check Audio queue again)
                    # We try to claim the job we just created (or any pending video job)
                    print("\n⚡ Switching to Video Queue immediately...")
                    video_job = queue.claim_video_job(WORKER_ID)
                    
                    if video_job:
                        await process_video_job(video_job)
                    else:
                        print("⚠️ No video job found (maybe delay in creation), skipping...")
            
            else:
                # If no audio job, check if there are pending video jobs left over?
                # Optional: Uncomment below if you want it to help clear video backlog
                # video_job = queue.claim_video_job(WORKER_ID)
                # if video_job: await process_video_job(video_job)
                
                print(f"⏳ Waiting for jobs... ({POLL_INTERVAL}s)")
                await asyncio.sleep(POLL_INTERVAL)
                
            queue.send_heartbeat(WORKER_ID, status="online")

        except KeyboardInterrupt:
            print("👋 Stopped"); break
        except Exception as e:
            print(f"Loop Error: {e}"); await asyncio.sleep(10)

if __name__ == "__main__":
    asyncio.run(main())

