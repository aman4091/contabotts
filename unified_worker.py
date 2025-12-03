#!/usr/bin/env python3
"""
Unified Worker (Audio + Video in Single Job)
Runs on Vast.ai - Generates Audio then Video in one go

Flow:
1. Claim Audio Job
2. Generate Audio -> Upload to Gofile
3. Generate Video (using l.py) -> Upload to Gofile
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

# Import from l.py (same directory)
from l import LandscapeGenerator, enhance_audio

# ============================================================================
# CONFIGURATION
# ============================================================================

FILE_SERVER_URL = os.getenv("FILE_SERVER_URL")
FILE_SERVER_API_KEY = os.getenv("FILE_SERVER_API_KEY")

if not FILE_SERVER_URL or not FILE_SERVER_API_KEY:
    raise ValueError("FILE_SERVER_URL and FILE_SERVER_API_KEY must be set")

# Telegram Config
def get_user_telegram_config(username: str) -> tuple:
    if not username:
        return os.getenv("BOT_TOKEN"), os.getenv("CHAT_ID")
    user_upper = username.upper()
    user_token = os.getenv(f"{user_upper}_BOT_TOKEN")
    user_chat = os.getenv(f"{user_upper}_CHAT_ID")
    if user_token and user_chat:
        return user_token, user_chat
    return os.getenv("BOT_TOKEN"), os.getenv("CHAT_ID")

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
        temp_file = os.path.join(TEMP_DIR, filename)
        with open(temp_file, 'w', encoding='utf-8') as f:
            f.write(script_text)

        with open(temp_file, 'rb') as f:
            requests.post(
                f"https://api.telegram.org/bot{bot_token}/sendDocument",
                data={"chat_id": chat_id, "caption": caption, "parse_mode": "HTML"},
                files={"document": (filename, f, "text/plain")},
                timeout=30
            )

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
landscape_gen = None

try:
    f5_model = F5TTS()
    print("✅ F5-TTS model loaded")

    # Load LandscapeGenerator from l.py (includes Whisper)
    landscape_gen = LandscapeGenerator()
    print("✅ LandscapeGenerator loaded (with Whisper)")
except Exception as e:
    print(f"❌ Failed to load models: {e}")
    sys.exit(1)

# Shorts Settings (Vertical 1080x1920) - from s.py
SHORTS_W = 1080
SHORTS_H = 1920
SHORTS_FONT_SIZE = 70
SHORTS_TEXT_Y = 1150
SHORTS_MAX_CHARS = 22
SHORTS_PADDING_X = 90
SHORTS_PADDING_Y = 90
SHORTS_CORNER_RADIUS = 40
SHORTS_BOX_OPACITY = "00"

# ============================================================================
# FILE SERVER QUEUE
# ============================================================================

class FileServerQueue:
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url.rstrip("/")
        self.headers = {"x-api-key": api_key, "Content-Type": "application/json"}
        self.file_headers = {"x-api-key": api_key}
        self.api_key = api_key

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
        if self.download_file(f"reference-audio/{reference_audio}", local_path):
            return True
        base_name = reference_audio.rsplit('.', 1)[0] if '.' in reference_audio else reference_audio
        if self.download_file(f"reference-audio/{base_name}.wav", local_path):
            return True
        if self.download_file(f"reference-audio/{base_name}.mp3", local_path):
            return True
        return False

    def get_random_image(self, image_folder: str = "nature") -> tuple:
        try:
            r = requests.get(f"{self.base_url}/images/{image_folder}", headers={"x-api-key": self.api_key}, timeout=30)
            if r.status_code != 200: return None, None
            images = r.json().get("images", [])
            if not images: return None, None

            selected = random.choice(images)
            server_path = f"images/{image_folder}/{selected}"
            local_image = os.path.join(TEMP_DIR, "temp_image.jpg")
            if self.download_file(server_path, local_image):
                return local_image, server_path
            return None, None
        except: return None, None

    def delete_file(self, remote_path: str) -> bool:
        try:
            r = requests.delete(f"{self.base_url}/files/{remote_path}", headers=self.file_headers, timeout=30)
            return r.status_code == 200
        except: return False

    def send_heartbeat(self, worker_id: str, status: str = "online", gpu_model: str = None, current_job: str = None) -> bool:
        try:
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

        total_chunks = len(chunks)
        print(f"   Total Chunks: {total_chunks}")

        all_audio = []
        rate = 24000
        for i, chk in enumerate(chunks):
            percent = int(((i + 1) / total_chunks) * 100)
            print(f"\r   🎙️ Audio Progress: {percent}% (Chunk {i+1}/{total_chunks})", end="", flush=True)

            if torch.cuda.is_available(): torch.cuda.empty_cache()
            with torch.inference_mode():
                res = f5_model.infer(
                    ref_file=ref_audio,
                    ref_text="",
                    gen_text=chk,
                    remove_silence=True,
                    speed=0.8,             # Slower, natural pace
                    nfe_step=64,           # Premium quality (default 32)
                    cfg_strength=2.0,      # Classifier-free guidance
                    sway_sampling_coef=-1.0  # Sway sampling enabled
                )
            audio_data = res[0] if isinstance(res, tuple) else res
            all_audio.append(audio_data)

        print(f"\r   🎙️ Audio Progress: 100%                    ")

        if not all_audio: return False
        sf.write(out_path, np.concatenate(all_audio), rate)
        return os.path.exists(out_path)
    except Exception as e:
        print(f"\n❌ TTS Error: {e}")
        traceback.print_exc()
        return False

# ============================================================================
# SHORTS VIDEO GENERATION (kept inline for shorts)
# ============================================================================

def format_ass_time(seconds):
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int((seconds % 1) * 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"

def generate_subtitles_shorts(audio_path: str) -> Optional[str]:
    """Generate ASS subtitles for Shorts (1080x1920) - EXACT s.py style"""
    try:
        print(f"📝 Transcribing audio for Shorts...")
        if landscape_gen is None or landscape_gen.model is None: return None

        result = landscape_gen.model.transcribe(audio_path, word_timestamps=False)
        ass_path = os.path.splitext(audio_path)[0] + "_shorts.ass"

        header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {SHORTS_W}
PlayResY: {SHORTS_H}

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Default,Arial,{SHORTS_FONT_SIZE},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,1,0,5,20,20,20,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
        events = []

        for segment in result['segments']:
            start = format_ass_time(segment['start'])
            end = format_ass_time(segment['end'])
            text = segment['text'].strip()

            words = text.split()
            lines = []
            curr = []
            curr_len = 0
            for w in words:
                if curr_len + len(w) > SHORTS_MAX_CHARS:
                    if curr:
                        lines.append(" ".join(curr))
                    curr = [w]
                    curr_len = len(w)
                else:
                    curr.append(w)
                    curr_len += len(w) + 1
            if curr:
                lines.append(" ".join(curr))

            final_text = "\\N".join(lines)

            cx = SHORTS_W // 2
            cy = SHORTS_TEXT_Y

            longest_line = max(len(l) for l in lines) if lines else 1
            char_width = SHORTS_FONT_SIZE * 0.5
            text_w = longest_line * char_width
            text_h = len(lines) * (SHORTS_FONT_SIZE * 1.2)

            box_w = text_w + SHORTS_PADDING_X
            box_h = text_h + SHORTS_PADDING_Y

            x1 = int(cx - (box_w / 2))
            x2 = int(cx + (box_w / 2))
            y1 = int(cy - (box_h / 2))
            y2 = int(cy + (box_h / 2))
            r = SHORTS_CORNER_RADIUS

            draw = (
                f"m {x1+r} {y1} l {x2-r} {y1} "
                f"b {x2} {y1} {x2} {y1} {x2} {y1+r} "
                f"l {x2} {y2-r} "
                f"b {x2} {y2} {x2} {y2} {x2-r} {y2} "
                f"l {x1+r} {y2} "
                f"b {x1} {y2} {x1} {y2} {x1} {y2-r} "
                f"l {x1} {y1+r} "
                f"b {x1} {y1} {x1} {y1} {x1+r} {y1}"
            )

            events.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{{\\p1\\an7\\pos(0,0)\\1c&H000000&\\1a&H{SHORTS_BOX_OPACITY}&\\bord0\\shad0}}{draw}{{\\p0}}")
            events.append(f"Dialogue: 1,{start},{end},Default,,0,0,0,,{{\\pos({cx},{cy})\\an5}}{final_text}")

        with open(ass_path, "w", encoding="utf-8") as f:
            f.write(header + "\n".join(events))

        print(f"✅ Shorts subtitles generated: {len(result['segments'])} segments")
        return ass_path
    except Exception as e:
        print(f"❌ Shorts Subtitle Error: {e}")
        traceback.print_exc()
        return None

def get_audio_duration(audio_path: str) -> float:
    try:
        result = subprocess.run([
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", audio_path
        ], capture_output=True, text=True)
        return float(result.stdout.strip())
    except:
        return 0

def run_ffmpeg_with_progress(cmd: list, total_duration: float) -> bool:
    try:
        cmd_with_progress = cmd[:-1] + ["-progress", "pipe:1", cmd[-1]]

        process = subprocess.Popen(
            cmd_with_progress,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True
        )

        last_percent = -1

        while True:
            line = process.stdout.readline()
            if not line and process.poll() is not None:
                break

            if line.startswith("out_time_ms="):
                try:
                    time_ms = int(line.split("=")[1].strip())
                    time_sec = time_ms / 1000000
                    if total_duration > 0:
                        percent = int((time_sec / total_duration) * 100)
                        percent = min(percent, 100)
                        if percent != last_percent:
                            print(f"\r   🎬 Video Progress: {percent}%", end="", flush=True)
                            last_percent = percent
                except:
                    pass

        print(f"\r   🎬 Video Progress: 100%")
        return process.returncode == 0
    except Exception as e:
        print(f"\n❌ FFmpeg Error: {e}")
        return False

def render_video_shorts(image_path: str, audio_path: str, ass_path: str, output_path: str) -> bool:
    """Render Shorts video (1080x1920) with subtitles"""
    try:
        print("🎬 Rendering Shorts Video (1080x1920)...")

        total_duration = get_audio_duration(audio_path)
        print(f"   Audio Duration: {total_duration:.1f}s")

        safe_ass = ass_path.replace("\\", "/").replace(":", "\\:")
        vf = f"scale={SHORTS_W}:{SHORTS_H}:force_original_aspect_ratio=increase,crop={SHORTS_W}:{SHORTS_H},format=yuv420p,subtitles='{safe_ass}'"

        cmd_gpu = [
            "ffmpeg", "-y", "-loop", "1", "-i", image_path, "-i", audio_path,
            "-vf", vf,
            "-c:v", "h264_nvenc",
            "-preset", "p4",
            "-b:v", "5M",
            "-c:a", "aac", "-b:a", "192k",
            "-shortest", output_path
        ]

        cmd_cpu = [
            "ffmpeg", "-y", "-loop", "1", "-i", image_path, "-i", audio_path,
            "-vf", vf,
            "-c:v", "libx264", "-preset", "medium", "-crf", "23",
            "-c:a", "aac", "-b:a", "192k",
            "-shortest", output_path
        ]

        print("   Attempting NVENC (GPU) for Shorts...")
        if run_ffmpeg_with_progress(cmd_gpu, total_duration):
            return os.path.exists(output_path)

        print("\n⚠️ GPU Failed. Switching to CPU...")
        if run_ffmpeg_with_progress(cmd_cpu, total_duration):
            return os.path.exists(output_path)

        print("❌ FFmpeg Failed")
        return False
    except Exception as e:
        print(f"❌ Shorts Render Error: {e}")
        traceback.print_exc()
        return False

# ============================================================================
# JOB PROCESSOR
# ============================================================================

async def process_job(job: Dict) -> bool:
    """Process Audio + Video in single job"""
    job_id = job["job_id"]
    channel = job["channel_code"]
    org_path = job["organized_path"]
    ref_audio_file = job.get("reference_audio") or f"{channel}.wav"

    print(f"\n🎯 Processing Job: {job_id[:8]} ({channel} #{job['video_number']})")
    print(f"   Reference Audio: {ref_audio_file}")
    queue.send_heartbeat(WORKER_ID, status="busy", current_job=job_id)

    local_ref_audio = os.path.join(TEMP_DIR, f"{channel}_ref.wav")
    local_audio_out = os.path.join(OUTPUT_DIR, f"audio_{job_id}.wav")
    local_video_out = os.path.join(OUTPUT_DIR, f"video_{job_id}.mp4")
    local_image = None

    try:
        # ========== STEP 1: AUDIO GENERATION ==========
        print("\n" + "="*50)
        print("🎧 STEP 1: Audio Generation")
        print("="*50)

        script = job.get('script_text') or queue.get_script(org_path)
        if not script: raise Exception("Script fetch failed")
        if not queue.get_reference_audio(ref_audio_file, local_ref_audio): raise Exception(f"Ref audio failed: {ref_audio_file}")

        if not generate_audio_f5tts(script, local_ref_audio, local_audio_out):
            raise Exception("TTS failed")

        print("📤 Uploading audio to Gofile...")
        audio_gofile = await upload_to_gofile(local_audio_out)
        if not audio_gofile:
            raise Exception("Audio Gofile upload failed")

        print(f"✅ Audio uploaded to Gofile: {audio_gofile}")

        print("📤 Uploading audio to Contabo...")
        username = job.get("username", "default")
        audio_remote_path = f"users/{username}/organized/video_{job['video_number']}/audio.wav"
        if queue.upload_file(local_audio_out, audio_remote_path):
            print(f"✅ Audio uploaded to Contabo: {audio_remote_path}")
        else:
            print("⚠️ Contabo audio upload failed (non-critical)")

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
        is_short = job.get('is_short', False)
        if is_short:
            print("🎬 STEP 2: SHORTS Video Generation (1080x1920)")
        else:
            print("🎬 STEP 2: Video Generation (1920x1080) using l.py")
        print("="*50)

        if is_short:
            image_folder = 'shorts'
        else:
            image_folder = job.get('image_folder', 'nature')

        local_image, server_image_path = queue.get_random_image(image_folder)
        if not local_image: raise Exception(f"Image fetch failed from {image_folder}")

        print("🎥 Generating Video with subtitles...")

        if is_short:
            # Shorts: use inline functions
            ass_path = generate_subtitles_shorts(local_audio_out)
            if not ass_path: raise Exception("Subtitle generation failed")
            if not render_video_shorts(local_image, local_audio_out, ass_path, local_video_out):
                raise Exception("Shorts render failed")
        else:
            # Landscape: use l.py's LandscapeGenerator
            # First enhance audio (from l.py)
            mastered_audio = enhance_audio(local_audio_out)

            # Generate subtitles using l.py
            ass_path = landscape_gen.generate_subtitles(mastered_audio)
            if not ass_path: raise Exception("Subtitle generation failed")

            # Render video using l.py
            if not landscape_gen.render(mastered_audio, local_image, ass_path, local_video_out):
                raise Exception("Video render failed")

            # Cleanup mastered audio if different
            if mastered_audio != local_audio_out and os.path.exists(mastered_audio):
                os.remove(mastered_audio)

        # Cleanup ASS file
        if ass_path and os.path.exists(ass_path):
            os.remove(ass_path)

        print("📤 Uploading video to Gofile...")
        video_gofile = await upload_to_gofile(local_video_out)
        if not video_gofile:
            raise Exception("Video Gofile upload failed")

        print(f"✅ Video uploaded: {video_gofile}")

        if server_image_path:
            if queue.delete_file(server_image_path):
                print(f"🗑️ Image deleted from server: {server_image_path}")
            else:
                print(f"⚠️ Failed to delete image: {server_image_path}")

        # ========== STEP 3: COMPLETE JOB ==========
        queue.complete_audio_job(job_id, WORKER_ID, video_gofile)
        queue.increment_worker_stat(WORKER_ID, "jobs_completed")

        video_type = "📱 Shorts" if is_short else "🎬 Video"
        send_telegram_document(
            script_text=script,
            caption=f"{video_type} <b>Complete</b>\n"
                    f"<b>Channel:</b> {channel} | <b>Video:</b> #{job['video_number']}\n"
                    f"<b>Date:</b> {job.get('date', 'N/A')}\n\n"
                    f"<b>🔗 Video:</b> {video_gofile}",
            filename=script_filename,
            username=job.get("username")
        )

        print("\n" + "="*50)
        print(f"✅ JOB COMPLETE: {job_id[:8]} {'(SHORT)' if is_short else ''}")
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
        try:
            for f in [local_audio_out, local_video_out, local_image, local_ref_audio]:
                if f and os.path.exists(f): os.remove(f)
        except: pass


# ============================================================================
# MAIN LOOP
# ============================================================================

async def main():
    print(f"🚀 UNIFIED WORKER STARTED (Audio + Video using l.py)")
    print(f"Worker ID: {WORKER_ID}")
    print(f"Poll Interval: {POLL_INTERVAL}s")

    gpu = subprocess.run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"], capture_output=True, text=True).stdout.strip()
    queue.send_heartbeat(WORKER_ID, status="online", gpu_model=gpu)
    print(f"GPU: {gpu}")

    while True:
        try:
            job = queue.claim_audio_job(WORKER_ID)

            if job:
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
