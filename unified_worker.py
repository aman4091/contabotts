#!/usr/bin/env python3
"""
Video Worker (External Audio + Video)
Runs on Vast.ai - Downloads external audio and creates video

Flow:
1. Claim Job (must have existing_audio_link set by folder watcher)
2. Download Audio from existing_audio_link
3. Generate Video (using l.py) -> Upload to Gofile
4. Send Telegram notifications
5. Loop back

Note: Audio generation removed - all audio comes from external uploads via folder watcher
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
import shutil

# Import from l.py (same directory)
from l import LandscapeGenerator, get_random_overlay

# Import AI image generator
try:
    from ai_image_generator import generate_ai_image, generate_multiple_ai_images
    AI_IMAGE_AVAILABLE = True
    print("✅ AI Image Generator loaded (multi-image support)")
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
landscape_gen = None

try:
    # Load LandscapeGenerator from l.py (includes Whisper for subtitles)
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
SHORTS_MAX_LINES = 1  # Maximum lines per subtitle
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

async def upload_to_gofile(file_path: str, custom_filename: str = None) -> Optional[str]:
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
            # Use custom filename if provided
            filename = custom_filename or os.path.basename(file_path)
            with open(file_path, 'rb') as f:
                up = await client.post(f"https://{server}.gofile.io/contents/uploadfile", files={'file': (filename, f)})
            if up.status_code == 200:
                return up.json()["data"]["downloadPage"]
            return None
    except Exception as e:
        print(f"Gofile error: {e}")
        return None

async def upload_to_pixeldrain(file_path: str, custom_filename: str = None) -> Optional[str]:
    """Fallback upload to Pixeldrain"""
    try:
        import httpx
        async with httpx.AsyncClient(timeout=600.0) as client:
            with open(file_path, 'rb') as f:
                filename = custom_filename or os.path.basename(file_path)
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
            # Generate public download URL (no API key required)
            download_url = f"{FILE_SERVER_URL}/public/{remote_path}"
            print(f"✅ Uploaded to Contabo: {download_url}")
            return download_url
        return None
    except Exception as e:
        print(f"Contabo upload error: {e}")
        return None

async def upload_file(file_path: str, username: str = "default", video_number: int = 0, file_type: str = "video", channel_code: str = "") -> Optional[str]:
    """Upload file to Gofile, fallback to Pixeldrain, then Contabo"""
    # Create descriptive filename: V489_channel.mp4 or V489.mp4
    ext = os.path.splitext(file_path)[1] or ".mp4"
    if channel_code:
        custom_filename = f"V{video_number}_{channel_code}{ext}"
    else:
        custom_filename = f"V{video_number}{ext}"

    print(f"📤 Uploading to Gofile as {custom_filename}...")
    link = await upload_to_gofile(file_path, custom_filename)
    if link:
        return link
    print(f"⚠️ Gofile failed, trying Pixeldrain...")
    link = await upload_to_pixeldrain(file_path, custom_filename)
    if link:
        return link
    print(f"⚠️ Pixeldrain failed, trying Contabo...")
    link = await upload_to_contabo(file_path, username, video_number, file_type)
    if link:
        return link
    print(f"❌ All upload methods failed")
    return None

async def download_from_direct_url(url: str, output_path: str) -> bool:
    """Download audio file from direct HTTP URL"""
    try:
        import httpx
        print(f"📥 Downloading from direct URL...")

        async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
            response = await client.get(url, headers={"x-api-key": "tts-secret-key-2024"})

            if response.status_code != 200:
                print(f"❌ Failed to download: {response.status_code}")
                return False

            with open(output_path, "wb") as f:
                f.write(response.content)

            print(f"✅ Downloaded {len(response.content)} bytes")
            return True
    except Exception as e:
        print(f"❌ Direct download error: {e}")
        return False


async def download_audio_from_url(url: str, output_path: str) -> bool:
    """Download audio from URL - handles both GoFile and direct HTTP URLs"""
    if "gofile.io" in url:
        return await download_from_gofile(url, output_path)
    else:
        return await download_from_direct_url(url, output_path)


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
    """Process Audio + Video job"""
    job_id = job["job_id"]
    existing_audio_link = job.get("existing_audio_link")

    # Require audio link (set by folder watcher)
    if not existing_audio_link:
        print(f"\n⏸️ Job {job_id[:8]} has no audio - skipping")
        return True

    channel = job.get("channel_code", "VIDEO")
    org_path = job.get("organized_path", "")
    video_number = job.get("video_number", 0)

    print(f"\n🎯 Processing Job: {job_id[:8]} ({channel} #{video_number})")

    queue.send_heartbeat(WORKER_ID, status="busy", current_job=job_id)

    local_audio_out = os.path.join(OUTPUT_DIR, f"audio_{job_id}.wav")
    local_video_out = os.path.join(OUTPUT_DIR, f"video_{job_id}.mp4")
    local_image = None
    audio_gofile = None

    try:
        # ========== STEP 1: DOWNLOAD AUDIO ==========
        print("\n" + "="*50)
        print("🎧 STEP 1: Download Audio")
        print("="*50)

        print(f"📥 Downloading: {existing_audio_link[:60]}...")
        if await download_audio_from_url(existing_audio_link, local_audio_out):
            print(f"✅ Audio downloaded!")
            audio_gofile = existing_audio_link
        else:
            raise Exception(f"Failed to download audio from: {existing_audio_link}")

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
            # AI Image Generation: Multiple images based on audio duration
            if is_short:
                print("🤖 Using AI Image Generation (SHORTS 1080x1920)...")
            else:
                print("🤖 Using AI Multi-Image Generation...")

            # Get script text for AI image
            ai_script = job.get('script_text') or queue.get_script(org_path)

            if ai_script:
                # Use 1080x1920 for shorts, 1920x1080 for landscape
                img_width = 1080 if is_short else 1920
                img_height = 1920 if is_short else 1080

                # Calculate number of images based on audio duration
                audio_duration = landscape_gen.get_audio_duration(local_audio_out)
                duration_minutes = audio_duration / 60
                IMAGE_DISPLAY_DURATION = 12  # Each image shows for ~12 seconds

                # Generate unique images = minutes / 2 (e.g., 10 min = 5 images)
                num_unique_images = max(1, int(duration_minutes / 2))
                # Calculate total display slots
                total_slots = max(1, int(audio_duration / IMAGE_DISPLAY_DURATION))

                print(f"   📊 Duration: {duration_minutes:.1f} min -> {num_unique_images} unique AI images, {total_slots} display slots")

                # Generate multiple unique images
                unique_images = generate_multiple_ai_images(ai_script, TEMP_DIR, num_unique_images, width=img_width, height=img_height)

                if unique_images:
                    print(f"✅ Generated {len(unique_images)} AI images")
                    # Randomly shuffle images to fill all display slots
                    local_images = []
                    for _ in range(total_slots):
                        local_images.append(random.choice(unique_images))
                    print(f"   📷 {len(local_images)} images in slideshow (random shuffle)")
                else:
                    print("⚠️ AI multi-image failed, trying single image...")
                    local_image = os.path.join(TEMP_DIR, f"ai_image_{job_id}.jpg")
                    if generate_ai_image(ai_script, local_image, width=img_width, height=img_height):
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

        # Get random overlay (if available)
        overlay_path = get_random_overlay()

        if is_short:
            # Shorts: use inline functions (no overlay support yet)
            ass_path = generate_subtitles_shorts(local_audio_out)
            if not ass_path: raise Exception("Subtitle generation failed")
            if not render_video_shorts(local_images[0], local_audio_out, ass_path, local_video_out):
                raise Exception("Shorts render failed")
        else:
            # Landscape: use l.py's LandscapeGenerator
            # Generate subtitles using l.py
            ass_path = landscape_gen.generate_subtitles(local_audio_out)
            if not ass_path: raise Exception("Subtitle generation failed")

            # Render video using l.py (with overlay support)
            if len(local_images) > 1:
                # Multiple images: use dissolve transition
                print(f"   Using {len(local_images)} images with dissolve transitions")
                if not landscape_gen.render_with_fade(local_audio_out, local_images, ass_path, local_video_out, overlay_path=overlay_path):
                    raise Exception("Video render with fade failed")
            else:
                # Single image: use regular render
                if not landscape_gen.render(local_audio_out, local_images[0], ass_path, local_video_out, overlay_path=overlay_path):
                    raise Exception("Video render failed")

        # Cleanup ASS file
        if ass_path and os.path.exists(ass_path):
            os.remove(ass_path)

        username = job.get("username", "default")
        save_local = job.get("save_local", False)

        if save_local:
            # Save video locally instead of uploading to GoFile
            local_save_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "local_videos")
            os.makedirs(local_save_dir, exist_ok=True)
            local_save_path = os.path.join(local_save_dir, f"video_{video_number}_{job_id[:8]}.mp4")
            shutil.copy2(local_video_out, local_save_path)
            video_gofile = f"LOCAL:{local_save_path}"
            print(f"✅ Video saved locally: {local_save_path}")
        else:
            video_gofile = await upload_file(local_video_out, username, video_number, "video", channel)
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
        script = job.get('script_text') or queue.get_script(org_path)

        # Send completion telegram
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
            for f in [local_audio_out, local_video_out, local_image]:
                if f and os.path.exists(f): os.remove(f)
            # Also cleanup multiple custom images
            for img in local_images:
                if img and os.path.exists(img): os.remove(img)
        except: pass


# ============================================================================
# MAIN LOOP
# ============================================================================

async def main():
    print(f"🚀 VIDEO WORKER STARTED (External Audio + Video using l.py)")
    print(f"   Audio: Downloaded from existing_audio_link (no TTS generation)")
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
