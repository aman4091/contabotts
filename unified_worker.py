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

# Import AI image generator
try:
    from ai_image_generator import generate_ai_image
    AI_IMAGE_AVAILABLE = True
    print("✅ AI Image Generator loaded")
except ImportError as e:
    AI_IMAGE_AVAILABLE = False
    print(f"⚠️ AI Image Generator not available: {e}")

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
SHORTS_MAX_LINES = 2  # Maximum lines per subtitle
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
            data = srv.json()["data"]
            # Try servers first, fallback to serversAllZone
            servers = data.get("servers", [])
            if not servers:
                servers = data.get("serversAllZone", [])
            if not servers:
                print("Gofile: No servers available")
                return None
            server = servers[0]["name"]
            with open(file_path, 'rb') as f:
                up = await client.post(f"https://{server}.gofile.io/contents/uploadfile", files={'file': f})
            if up.status_code == 200:
                return up.json()["data"]["downloadPage"]
            return None
    except Exception as e:
        print(f"Gofile error: {e}")
        return None

async def upload_to_pixeldrain(file_path: str) -> Optional[str]:
    """Fallback upload to Pixeldrain"""
    try:
        import httpx
        async with httpx.AsyncClient(timeout=600.0) as client:
            with open(file_path, 'rb') as f:
                filename = os.path.basename(file_path)
                up = await client.post(
                    "https://pixeldrain.com/api/file",
                    files={'file': (filename, f)}
                )
            if up.status_code == 201:
                file_id = up.json()["id"]
                return f"https://pixeldrain.com/u/{file_id}"
            return None
    except Exception as e:
        print(f"Pixeldrain error: {e}")
        return None

async def upload_to_contabo(file_path: str, username: str, video_number: int, file_type: str = "video") -> Optional[str]:
    """Upload file to Contabo file server and return download URL"""
    try:
        ext = os.path.splitext(file_path)[1] or (".mp4" if file_type == "video" else ".wav")
        remote_path = f"users/{username}/organized/video_{video_number}/{file_type}{ext}"

        if queue.upload_file(file_path, remote_path):
            # Generate download URL
            download_url = f"{FILE_SERVER_URL}/files/{remote_path}"
            print(f"✅ Uploaded to Contabo: {download_url}")
            return download_url
        return None
    except Exception as e:
        print(f"Contabo upload error: {e}")
        return None

async def upload_file(file_path: str, username: str = "default", video_number: int = 0, file_type: str = "video") -> Optional[str]:
    """Upload file to Gofile, fallback to Pixeldrain, then Contabo"""
    print(f"📤 Uploading to Gofile...")
    link = await upload_to_gofile(file_path)
    if link:
        return link
    print(f"⚠️ Gofile failed, trying Pixeldrain...")
    link = await upload_to_pixeldrain(file_path)
    if link:
        return link
    print(f"⚠️ Pixeldrain failed, trying Contabo...")
    link = await upload_to_contabo(file_path, username, video_number, file_type)
    if link:
        return link
    print(f"❌ All upload methods failed")
    return None

async def download_from_gofile(gofile_link: str, output_path: str) -> bool:
    """Download audio file from Gofile link"""
    try:
        import httpx
        import re

        # Extract content ID from link (e.g., https://gofile.io/d/xxxxx -> xxxxx)
        match = re.search(r'gofile\.io/d/([a-zA-Z0-9]+)', gofile_link)
        if not match:
            print(f"❌ Invalid Gofile link format: {gofile_link}")
            return False

        content_id = match.group(1)
        print(f"📥 Downloading from Gofile: {content_id}")

        async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
            # Step 1: Create guest account to get token
            print("   Creating guest account...")
            acc_res = await client.post("https://api.gofile.io/accounts")
            if acc_res.status_code != 200:
                print(f"❌ Failed to create guest account: {acc_res.status_code}")
                return False

            acc_data = acc_res.json()
            if acc_data.get("status") != "ok":
                print(f"❌ Guest account error: {acc_data}")
                return False

            token = acc_data.get("data", {}).get("token")
            if not token:
                print("❌ No token received")
                return False

            print(f"   Got token: {token[:10]}...")

            # Step 2: Get content info with token
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }

            info_url = f"https://api.gofile.io/contents/{content_id}?wt=4fd6sg89d7s6"
            info_res = await client.get(info_url, headers=headers)

            if info_res.status_code != 200:
                print(f"❌ Failed to get Gofile info: {info_res.status_code}")
                print(f"   Response: {info_res.text[:200]}")
                return False

            data = info_res.json()
            if data.get("status") != "ok":
                print(f"❌ Gofile API error: {data}")
                return False

            # Find the audio file
            contents = data.get("data", {}).get("children", {})
            audio_file = None

            for file_id, file_info in contents.items():
                name = file_info.get("name", "").lower()
                if name.endswith((".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg")):
                    audio_file = file_info
                    break

            if not audio_file:
                # If no audio found, just get the first file
                if contents:
                    audio_file = list(contents.values())[0]
                else:
                    print("❌ No files found in Gofile")
                    return False

            download_url = audio_file.get("link")
            if not download_url:
                print("❌ No download link found")
                return False

            print(f"   Downloading: {audio_file.get('name')}")

            # Step 3: Download the file with token cookie
            response = await client.get(download_url, headers={
                "Cookie": f"accountToken={token}"
            })

            if response.status_code == 200:
                with open(output_path, 'wb') as f:
                    f.write(response.content)
                print(f"✅ Downloaded to: {output_path}")
                return True
            else:
                print(f"❌ Download failed: {response.status_code}")
                return False

    except Exception as e:
        print(f"❌ Gofile download error: {e}")
        traceback.print_exc()
        return False

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

def fix_transcription_shorts(text: str) -> str:
    """Fix common Whisper transcription errors for Shorts"""
    import re
    corrections = [
        # Archangel Michael variations
        (r"\bour\s*chang?g?el\s*michael\b", "Archangel Michael"),
        (r"\bour\s*angel\s*michael\b", "Archangel Michael"),
        (r"\barch\s*angel\s*michael\b", "Archangel Michael"),
        (r"\bar\s*chang?el\s*michael\b", "Archangel Michael"),
        (r"\bour\s*chang?el\b", "Archangel"),
        # Archangel Gabriel
        (r"\bour\s*chang?el\s*gabriel\b", "Archangel Gabriel"),
        (r"\barch\s*angel\s*gabriel\b", "Archangel Gabriel"),
        # Archangel Raphael
        (r"\bour\s*chang?el\s*raphael\b", "Archangel Raphael"),
        (r"\barch\s*angel\s*raphael\b", "Archangel Raphael"),
        # Generic archangel fix
        (r"\bour\s*chang?g?els?\b", "Archangel"),
        (r"\bar\s*chang?g?els?\b", "Archangel"),
    ]
    fixed = text
    for pattern, replacement in corrections:
        fixed = re.sub(pattern, replacement, fixed, flags=re.IGNORECASE)
    return fixed

def generate_subtitles_shorts(audio_path: str) -> Optional[str]:
    """Generate ASS subtitles for Shorts (1080x1920) with word-level timing"""
    try:
        print(f"📝 Transcribing audio for Shorts with word timestamps...")
        if landscape_gen is None or landscape_gen.model is None: return None

        # Prompt to help Whisper recognize religious/spiritual terms correctly
        initial_prompt = "Archangel Michael, Archangel Gabriel, Archangel Raphael, God, Jesus Christ, Holy Spirit, angels, divine, blessed, amen."
        result = landscape_gen.model.transcribe(audio_path, word_timestamps=True, initial_prompt=initial_prompt)
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

        # Collect all words with timestamps
        all_words = []
        for segment in result['segments']:
            if 'words' in segment:
                for word_info in segment['words']:
                    word_text = word_info.get('word', '').strip()
                    if word_text:
                        all_words.append({
                            'word': word_text,
                            'start': word_info.get('start', 0),
                            'end': word_info.get('end', 0)
                        })

        # Group words into lines (max SHORTS_MAX_CHARS per line)
        lines_with_timing = []
        curr_line_words = []
        curr_len = 0

        for w in all_words:
            word_text = w['word']
            if curr_len + len(word_text) > SHORTS_MAX_CHARS and curr_line_words:
                # Save current line
                lines_with_timing.append({
                    'text': ' '.join([x['word'] for x in curr_line_words]),
                    'start': curr_line_words[0]['start'],
                    'end': curr_line_words[-1]['end']
                })
                curr_line_words = [w]
                curr_len = len(word_text)
            else:
                curr_line_words.append(w)
                curr_len += len(word_text) + 1

        if curr_line_words:
            lines_with_timing.append({
                'text': ' '.join([x['word'] for x in curr_line_words]),
                'start': curr_line_words[0]['start'],
                'end': curr_line_words[-1]['end']
            })

        # Group lines into chunks of SHORTS_MAX_LINES (2 lines each)
        for i in range(0, len(lines_with_timing), SHORTS_MAX_LINES):
            chunk = lines_with_timing[i:i + SHORTS_MAX_LINES]
            if not chunk:
                continue

            # Get timing from first word of first line to last word of last line
            chunk_start = chunk[0]['start']
            chunk_end = chunk[-1]['end']

            start = format_ass_time(chunk_start)
            end = format_ass_time(chunk_end)

            # Fix transcription and join lines
            lines = [fix_transcription_shorts(line['text']) for line in chunk]
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

        print(f"✅ Shorts subtitles generated: {len(lines_with_timing)} lines in {(len(lines_with_timing) + 1) // 2} chunks")
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
    is_video_only = job.get("videoOnly", False)
    is_audio_only = job.get("audio_only", False)

    # For videoOnly jobs, we don't need channel/org_path
    channel = job.get("channel_code", "MANUAL")
    org_path = job.get("organized_path", "")
    ref_audio_file = job.get("reference_audio") or f"{channel}.wav"
    video_number = job.get("video_number", 0)

    if is_video_only:
        print(f"\n🎯 Processing Video-Only Job: {job_id[:8]}")
        print(f"   Audio Link: {job.get('audioLink', 'N/A')[:50]}...")
    elif is_audio_only:
        print(f"\n🎯 Processing Audio-Only Job: {job_id[:8]} ({channel} #{video_number})")
        print(f"   Reference Audio: {ref_audio_file}")
        print(f"   ⚠️ Video generation will be skipped")
    else:
        print(f"\n🎯 Processing Job: {job_id[:8]} ({channel} #{video_number})")
        print(f"   Reference Audio: {ref_audio_file}")

    queue.send_heartbeat(WORKER_ID, status="busy", current_job=job_id)

    local_ref_audio = os.path.join(TEMP_DIR, f"{channel}_ref.wav")
    local_audio_out = os.path.join(OUTPUT_DIR, f"audio_{job_id}.wav")
    local_video_out = os.path.join(OUTPUT_DIR, f"video_{job_id}.mp4")
    local_image = None
    audio_gofile = None

    try:
        # ========== STEP 1: AUDIO (Generate or Download) ==========
        print("\n" + "="*50)

        if is_video_only:
            # VIDEO-ONLY MODE: Download audio from Gofile
            print("📥 STEP 1: Download Audio from Gofile")
            print("="*50)

            audio_link = job.get("audioLink")
            if not audio_link:
                raise Exception("No audioLink provided for videoOnly job")

            if not await download_from_gofile(audio_link, local_audio_out):
                raise Exception("Failed to download audio from Gofile")

            audio_gofile = audio_link  # Use original link for reference
            print(f"✅ Audio downloaded successfully")

        else:
            # NORMAL MODE: Generate TTS audio (or reuse existing)
            print("🎧 STEP 1: Audio Generation")
            print("="*50)

            username = job.get("username", "default")
            audio_remote_path = f"users/{username}/organized/video_{video_number}/audio.wav"
            script = job.get('script_text') or queue.get_script(org_path)
            audio_reused = False

            # Check if existing_audio_link is provided (user uploaded audio separately)
            existing_audio_link = job.get('existing_audio_link')
            if existing_audio_link:
                print(f"📥 Using existing audio from GoFile: {existing_audio_link[:50]}...")
                if await download_from_gofile(existing_audio_link, local_audio_out):
                    print(f"✅ Audio downloaded from existing link!")
                    audio_gofile = existing_audio_link
                    audio_reused = True
                else:
                    print(f"⚠️ Failed to download from existing link, will generate new audio")

            # Check if audio already exists on Contabo (retry scenario)
            if not audio_reused:
                print("   Checking if audio already exists on Contabo...")
                if queue.download_file(audio_remote_path, local_audio_out):
                    print(f"✅ Found existing audio on Contabo - reusing!")
                    audio_gofile = f"{FILE_SERVER_URL}/files/{audio_remote_path}"
                    audio_reused = True

            if not audio_reused:
                # Generate new audio
                print("   No existing audio found, generating new...")
                if not script: raise Exception("Script fetch failed")
                if not queue.get_reference_audio(ref_audio_file, local_ref_audio): raise Exception(f"Ref audio failed: {ref_audio_file}")

                if not generate_audio_f5tts(script, local_ref_audio, local_audio_out):
                    raise Exception("TTS failed")

                # Upload audio (will try Gofile, Pixeldrain, then Contabo)
                audio_gofile = await upload_file(local_audio_out, username, video_number, "audio")
                if not audio_gofile:
                    raise Exception("Audio upload failed")

                print(f"✅ Audio uploaded: {audio_gofile}")

                # Also upload to Contabo as backup (if not already there from fallback)
                if "gofile.io" in audio_gofile or "pixeldrain.com" in audio_gofile:
                    print("📤 Uploading audio backup to Contabo...")
                    if queue.upload_file(local_audio_out, audio_remote_path):
                        print(f"✅ Audio backup uploaded to Contabo")
                    else:
                        print("⚠️ Contabo audio backup failed (non-critical)")

            # Only send audio notification if not reusing (avoid duplicate notifications on retry)
            if not audio_reused and script:
                script_filename = f"{channel}_V{video_number}_{job.get('date', 'unknown')}_script.txt"
                send_telegram_document(
                    script_text=script,
                    caption=f"🎵 <b>Audio Complete</b>\n"
                            f"<b>Channel:</b> {channel} | <b>Video:</b> #{video_number}\n"
                            f"<b>Date:</b> {job.get('date', 'N/A')}\n\n"
                            f"<b>🔗 Audio:</b> {audio_gofile}",
                    filename=script_filename,
                    username=job.get("username")
                )

        # ========== AUDIO ONLY: Skip Video Generation ==========
        if is_audio_only:
            print("\n" + "="*50)
            print("🎧 AUDIO ONLY MODE: Skipping video generation")
            print("="*50)

            queue.complete_audio_job(job_id, WORKER_ID, audio_gofile)
            queue.increment_worker_stat(WORKER_ID, "jobs_completed")

            print("\n" + "="*50)
            print(f"✅ JOB COMPLETE (AUDIO ONLY): {job_id[:8]}")
            print(f"   Audio: {audio_gofile}")
            print("="*50)

            return True

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

        # Check for custom images (multiple images with fade transition)
        custom_images = job.get('custom_images', [])
        local_images = []  # List for multiple images
        server_image_path = None  # Track if we need to delete server image

        if custom_images and len(custom_images) > 0 and not is_short:
            # Download custom images from file server
            print(f"🖼️ Using {len(custom_images)} custom images (fade transition)...")

            for i, img_path in enumerate(custom_images):
                try:
                    # Download from file server
                    img_url = f"{FILE_SERVER_URL}/files/{img_path}"
                    local_img_path = os.path.join(TEMP_DIR, f"custom_img_{job_id}_{i}.jpg")

                    response = requests.get(img_url, headers={"x-api-key": FILE_SERVER_API_KEY})
                    if response.status_code == 200:
                        with open(local_img_path, 'wb') as f:
                            f.write(response.content)
                        local_images.append(local_img_path)
                        print(f"   Downloaded image {i+1}: {os.path.basename(img_path)}")
                    else:
                        print(f"   ⚠️ Failed to download image {i+1}")
                except Exception as e:
                    print(f"   ⚠️ Error downloading image {i+1}: {e}")

            if len(local_images) == 0:
                print("⚠️ No custom images downloaded, falling back to random image")
                local_image, server_image_path = queue.get_random_image(image_folder)
                local_images = [local_image] if local_image else []
        elif job.get('use_ai_image', False) and AI_IMAGE_AVAILABLE:
            # AI Image Generation: Analyze script and generate image
            if is_short:
                print("🤖 Using AI Image Generation (SHORTS 1080x1920)...")
            else:
                print("🤖 Using AI Image Generation...")

            # Get script text for analysis
            ai_script = None
            if is_video_only:
                # For video-only, we don't have script - use fallback
                ai_script = job.get('videoTitle', 'A beautiful cinematic scene')
            else:
                ai_script = job.get('script_text') or queue.get_script(org_path)

            if ai_script:
                local_image = os.path.join(TEMP_DIR, f"ai_image_{job_id}.jpg")
                # Use 1080x1920 for shorts, 1920x1080 for landscape
                img_width = 1080 if is_short else 1920
                img_height = 1920 if is_short else 1080
                if generate_ai_image(ai_script, local_image, width=img_width, height=img_height):
                    print(f"✅ AI image generated ({img_width}x{img_height}): {local_image}")
                    local_images = [local_image]
                else:
                    print("⚠️ AI image failed, falling back to random image")
                    local_image, server_image_path = queue.get_random_image(image_folder)
                    local_images = [local_image] if local_image else []
            else:
                print("⚠️ No script for AI image, falling back to random image")
                local_image, server_image_path = queue.get_random_image(image_folder)
                local_images = [local_image] if local_image else []
        else:
            # Use random image from folder (original behavior)
            local_image, server_image_path = queue.get_random_image(image_folder)
            local_images = [local_image] if local_image else []

        if not local_images or len(local_images) == 0:
            raise Exception(f"Image fetch failed from {image_folder}")

        print("🎥 Generating Video with subtitles...")

        if is_short:
            # Shorts: use inline functions
            ass_path = generate_subtitles_shorts(local_audio_out)
            if not ass_path: raise Exception("Subtitle generation failed")
            if not render_video_shorts(local_images[0], local_audio_out, ass_path, local_video_out):
                raise Exception("Shorts render failed")
        else:
            # Landscape: use l.py's LandscapeGenerator
            # First enhance audio (from l.py) - if enabled
            if job.get('enhance_audio', True):
                mastered_audio = enhance_audio(local_audio_out)
            else:
                print("   Skipping audio enhancement (disabled)")
                mastered_audio = local_audio_out

            # Generate subtitles using l.py
            ass_path = landscape_gen.generate_subtitles(mastered_audio)
            if not ass_path: raise Exception("Subtitle generation failed")

            # Render video using l.py
            if len(local_images) > 1:
                # Multiple images: use fade transition
                print(f"   Using {len(local_images)} images with fade transitions")
                if not landscape_gen.render_with_fade(mastered_audio, local_images, ass_path, local_video_out):
                    raise Exception("Video render with fade failed")
            else:
                # Single image: use regular render
                if not landscape_gen.render(mastered_audio, local_images[0], ass_path, local_video_out):
                    raise Exception("Video render failed")

            # Cleanup mastered audio if different
            if mastered_audio != local_audio_out and os.path.exists(mastered_audio):
                os.remove(mastered_audio)

        # Cleanup ASS file
        if ass_path and os.path.exists(ass_path):
            os.remove(ass_path)

        username = job.get("username", "default")
        video_gofile = await upload_file(local_video_out, username, video_number, "video")
        if not video_gofile:
            raise Exception("Video upload failed")

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

        if is_video_only:
            # For videoOnly jobs, send simple telegram message
            send_telegram(
                f"{video_type} <b>Complete (Manual Audio)</b>\n"
                f"<b>Title:</b> {job.get('videoTitle', 'Unknown')}\n\n"
                f"<b>🔗 Video:</b> {video_gofile}",
                username=job.get("username")
            )
        else:
            # Normal job - send with script document
            script_filename = f"{channel}_V{video_number}_{job.get('date', 'unknown')}_script.txt"
            if script:
                send_telegram_document(
                    script_text=script,
                    caption=f"{video_type} <b>Complete</b>\n"
                            f"<b>Channel:</b> {channel} | <b>Video:</b> #{video_number}\n"
                            f"<b>Date:</b> {job.get('date', 'N/A')}\n\n"
                            f"<b>🔗 Video:</b> {video_gofile}",
                    filename=script_filename,
                    username=job.get("username")
                )
            else:
                send_telegram(
                    f"{video_type} <b>Complete</b>\n"
                    f"<b>Channel:</b> {channel} | <b>Video:</b> #{video_number}\n"
                    f"<b>Date:</b> {job.get('date', 'N/A')}\n\n"
                    f"<b>🔗 Video:</b> {video_gofile}",
                    username=job.get("username")
                )

        print("\n" + "="*50)
        print(f"✅ JOB COMPLETE: {job_id[:8]} {'(SHORT)' if is_short else ''} {'(VIDEO-ONLY)' if is_video_only else ''}")
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
            # Also cleanup multiple custom images
            for img in local_images:
                if img and os.path.exists(img): os.remove(img)
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
