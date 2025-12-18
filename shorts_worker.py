#!/usr/bin/env python3
"""
Shorts Worker (Windows PC)
Creates YouTube Shorts (1080x1920) from audio with AI images

Flow:
1. Claim Shorts Job (is_short=true with existing_audio_link)
2. Download Audio from existing_audio_link
3. Generate AI Image (Archangel Michael theme via Gemini + Nebius)
4. Create Video with Subtitles (1080x1920)
5. Upload to Gofile
6. Send Telegram notification
"""

import os
import sys
import time
import uuid
import json
import socket
import asyncio
import traceback
import subprocess
from datetime import datetime
from typing import Optional, Dict

import requests

# ============================================================================
# CONFIGURATION
# ============================================================================

FILE_SERVER_URL = os.getenv("FILE_SERVER_URL")
FILE_SERVER_API_KEY = os.getenv("FILE_SERVER_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
NEBIUS_API_KEY = os.getenv("NEBIUS_API_KEY")

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

# Worker Config
WORKER_ID = os.getenv("WORKER_ID", f"shorts_{socket.gethostname()}_{uuid.uuid4().hex[:8]}")
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "30"))

# Paths
TEMP_DIR = os.getenv("TEMP_DIR", os.path.join(os.path.expanduser("~"), "tts_shorts_temp"))
OUTPUT_DIR = os.getenv("OUTPUT_DIR", os.path.join(os.path.expanduser("~"), "tts_shorts_output"))
os.makedirs(TEMP_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Shorts Settings (Vertical 1080x1920)
SHORTS_W = 1080
SHORTS_H = 1920
SHORTS_FONT_SIZE = 70
SHORTS_TEXT_Y = 1150
SHORTS_MAX_CHARS = 22
SHORTS_MAX_LINES = 3
SHORTS_PADDING_X = 90
SHORTS_PADDING_Y = 90
SHORTS_CORNER_RADIUS = 40
SHORTS_BOX_OPACITY = "00"

# ============================================================================
# WHISPER MODEL (for subtitles)
# ============================================================================

print("Loading Whisper model for subtitles...")
whisper_model = None
try:
    import whisper
    whisper_model = whisper.load_model("base")
    print("Whisper model loaded successfully")
except Exception as e:
    print(f"Warning: Could not load Whisper: {e}")
    print("Subtitles will not be available")

# ============================================================================
# FILE SERVER QUEUE
# ============================================================================

class FileServerQueue:
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url.rstrip("/")
        self.headers = {"x-api-key": api_key, "Content-Type": "application/json"}
        self.file_headers = {"x-api-key": api_key}
        self.api_key = api_key

    def claim_shorts_job(self, worker_id: str) -> Optional[Dict]:
        """Claim a shorts-only job"""
        try:
            r = requests.post(f"{self.base_url}/queue/audio/claim-shorts",
                            json={"worker_id": worker_id}, headers=self.headers, timeout=30)
            return r.json().get("job") if r.status_code == 200 else None
        except: return None

    def complete_audio_job(self, job_id: str, worker_id: str, gofile_link: str = None) -> bool:
        try:
            r = requests.post(f"{self.base_url}/queue/audio/jobs/{job_id}/complete",
                            json={"worker_id": worker_id, "gofile_link": gofile_link},
                            headers=self.headers, timeout=30)
            return r.status_code == 200
        except: return False

    def fail_audio_job(self, job_id: str, worker_id: str, error_message: str) -> bool:
        try:
            r = requests.post(f"{self.base_url}/queue/audio/jobs/{job_id}/fail",
                            json={"worker_id": worker_id, "error_message": error_message},
                            headers=self.headers, timeout=30)
            return r.status_code == 200
        except: return False

    def send_heartbeat(self, worker_id: str, status: str = "online", current_job: str = None) -> bool:
        try:
            r = requests.post(f"{self.base_url}/workers/audio/heartbeat", json={
                "worker_id": worker_id, "status": status, "hostname": socket.gethostname(),
                "gpu_model": "Windows PC", "current_job": current_job
            }, headers=self.headers, timeout=10)
            return r.status_code == 200
        except: return False

    def increment_worker_stat(self, worker_id: str, stat: str) -> bool:
        try:
            requests.post(f"{self.base_url}/workers/audio/{worker_id}/increment",
                        params={"stat": stat}, headers=self.file_headers, timeout=10)
            return True
        except: return False

queue = FileServerQueue(FILE_SERVER_URL, FILE_SERVER_API_KEY)

# ============================================================================
# AI IMAGE GENERATION (Archangel Michael theme)
# ============================================================================

def get_gemini_model_from_settings() -> str:
    """Fetch Gemini model name from settings API"""
    try:
        # Use external IP to fetch settings from webapp
        webapp_url = FILE_SERVER_URL.replace(":8000", ":3000")
        api_url = f"{webapp_url}/api/settings"
        response = requests.get(api_url, timeout=5)
        if response.status_code == 200:
            data = response.json()
            model = data.get("ai", {}).get("model", "gemini-2.5-flash")
            print(f"Using Gemini model from settings: {model}")
            return model
    except Exception as e:
        print(f"Could not fetch settings, using default: {e}")
    return "gemini-2.5-flash"

ARCHANGEL_PROMPT = """Generate a SINGLE unique image prompt featuring Archangel Michael.

The prompt must:
1. Feature Archangel Michael as the main subject
2. Be suitable as a cinematic vertical video background (1080x1920)
3. NOT contain any text or letters
4. Be highly detailed and visually stunning

Vary these elements:
- Poses: standing, flying, fighting, meditating, protecting, descending
- Settings: heaven, clouds, mountains, cosmic space, battlefields
- Lighting: golden hour, divine rays, aurora, sunrise
- Armor: golden, silver, white, crystalline, radiant
- Wings: spread wide, glowing, ethereal

Output ONLY the image prompt in English, 50-100 words, nothing else.

Image prompt:"""


def get_archangel_prompt() -> Optional[str]:
    """Get Archangel Michael image prompt from Gemini"""
    if not GEMINI_API_KEY:
        print("GEMINI_API_KEY not set")
        return None

    # Get model from settings, fallback to defaults
    settings_model = get_gemini_model_from_settings()
    models = [settings_model, 'gemini-2.5-flash', 'gemini-2.0-flash-exp']
    # Remove duplicates
    models = list(dict.fromkeys(models))

    for model in models:
        try:
            print(f"Generating prompt with {model}...")
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GEMINI_API_KEY}"

            response = requests.post(url, json={
                "contents": [{"parts": [{"text": ARCHANGEL_PROMPT}]}],
                "generationConfig": {
                    "temperature": 0.9,
                    "maxOutputTokens": 500,
                    "thinkingConfig": {"thinkingBudget": 0}
                }
            }, timeout=60)

            if response.status_code == 200:
                data = response.json()
                if data.get("candidates", [{}])[0].get("finishReason") == "SAFETY":
                    continue
                text = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "").strip()
                if text:
                    print(f"Prompt: {text[:80]}...")
                    return text
        except Exception as e:
            print(f"{model} error: {e}")
            continue

    return None


def generate_ai_image(output_path: str) -> bool:
    """Generate AI image with Archangel Michael theme"""
    import base64

    if not NEBIUS_API_KEY:
        print("NEBIUS_API_KEY not set")
        return False

    prompt = get_archangel_prompt()
    if not prompt:
        print("Failed to get prompt from Gemini")
        return False

    print(f"Generating AI image (1080x1920)...")

    try:
        from openai import OpenAI

        client = OpenAI(
            base_url="https://api.tokenfactory.nebius.com/v1/",
            api_key=NEBIUS_API_KEY
        )

        for attempt in range(3):
            try:
                print(f"Attempt {attempt + 1}/3...")

                response = client.images.generate(
                    model="black-forest-labs/flux-dev",
                    response_format="b64_json",
                    extra_body={
                        "response_extension": "png",
                        "width": SHORTS_W,
                        "height": SHORTS_H,
                        "num_inference_steps": 28,
                        "negative_prompt": "",
                        "seed": -1
                    },
                    prompt=prompt
                )

                if response.data and len(response.data) > 0:
                    image_data = base64.b64decode(response.data[0].b64_json)

                    with open(output_path, 'wb') as f:
                        f.write(image_data)

                    # Convert to JPEG
                    try:
                        from PIL import Image
                        img = Image.open(output_path)
                        if img.mode == 'RGBA':
                            img = img.convert('RGB')
                        img.save(output_path, "JPEG", quality=95)
                    except ImportError:
                        pass

                    print(f"AI image saved: {output_path}")
                    return True

            except Exception as e:
                print(f"Attempt {attempt + 1} error: {e}")

            if attempt < 2:
                time.sleep(5)

        return False

    except ImportError:
        print("openai package not installed. Run: pip install openai")
        return False

# ============================================================================
# SUBTITLE GENERATION
# ============================================================================

def format_ass_time(seconds):
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int((seconds % 1) * 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def fix_transcription(text: str) -> str:
    """Fix common Whisper transcription errors"""
    import re
    corrections = [
        (r"\bour\s*chang?g?el\s*michael\b", "Archangel Michael"),
        (r"\bour\s*angel\s*michael\b", "Archangel Michael"),
        (r"\barch\s*angel\s*michael\b", "Archangel Michael"),
        (r"\bar\s*chang?el\s*michael\b", "Archangel Michael"),
        (r"\bour\s*chang?el\b", "Archangel"),
        (r"\bour\s*chang?el\s*gabriel\b", "Archangel Gabriel"),
        (r"\bour\s*chang?el\s*raphael\b", "Archangel Raphael"),
        (r"\bour\s*chang?g?els?\b", "Archangel"),
        (r"\bar\s*chang?g?els?\b", "Archangel"),
    ]
    fixed = text
    for pattern, replacement in corrections:
        fixed = re.sub(pattern, replacement, fixed, flags=re.IGNORECASE)
    return fixed


def generate_subtitles(audio_path: str) -> Optional[str]:
    """Generate ASS subtitles for Shorts (1080x1920)"""
    if whisper_model is None:
        print("Whisper not available, skipping subtitles")
        return None

    try:
        print("Transcribing audio...")
        initial_prompt = "Archangel Michael, Archangel Gabriel, God, Jesus Christ, Holy Spirit, angels, divine, blessed, amen."
        result = whisper_model.transcribe(audio_path, word_timestamps=True, initial_prompt=initial_prompt)
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

        # Collect words
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

        # Group into lines
        lines_with_timing = []
        curr_line_words = []
        curr_len = 0

        for w in all_words:
            word_text = w['word']
            if curr_len + len(word_text) > SHORTS_MAX_CHARS and curr_line_words:
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

        # Create subtitle events
        for i in range(0, len(lines_with_timing), SHORTS_MAX_LINES):
            chunk = lines_with_timing[i:i + SHORTS_MAX_LINES]
            if not chunk:
                continue

            chunk_start = chunk[0]['start']
            chunk_end = chunk[-1]['end']

            start = format_ass_time(chunk_start)
            end = format_ass_time(chunk_end)

            lines = [fix_transcription(line['text']) for line in chunk]
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

        print(f"Subtitles generated: {len(lines_with_timing)} lines")
        return ass_path
    except Exception as e:
        print(f"Subtitle error: {e}")
        traceback.print_exc()
        return None

# ============================================================================
# VIDEO RENDERING
# ============================================================================

def get_audio_duration(audio_path: str) -> float:
    try:
        result = subprocess.run([
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", audio_path
        ], capture_output=True, text=True)
        return float(result.stdout.strip())
    except:
        return 0


def render_video(image_path: str, audio_path: str, ass_path: str, output_path: str) -> bool:
    """Render Shorts video (1080x1920)"""
    try:
        print("Rendering Shorts Video...")

        total_duration = get_audio_duration(audio_path)
        print(f"Audio Duration: {total_duration:.1f}s")

        # Same escaping as unified_worker.py
        safe_ass = ass_path.replace("\\", "/").replace(":", "\\:")

        vf = f"scale={SHORTS_W}:{SHORTS_H}:force_original_aspect_ratio=increase,crop={SHORTS_W}:{SHORTS_H},format=yuv420p,subtitles='{safe_ass}'"

        # Try GPU first, fallback to CPU
        cmd_gpu = [
            "ffmpeg", "-y", "-loop", "1", "-i", image_path, "-i", audio_path,
            "-vf", vf,
            "-c:v", "h264_nvenc", "-preset", "p4", "-b:v", "5M",
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

        print("Trying GPU encoding...")
        result = subprocess.run(cmd_gpu, capture_output=True, text=True)
        if result.returncode == 0 and os.path.exists(output_path):
            print("Video rendered with GPU")
            return True

        print("GPU failed, using CPU...")
        result = subprocess.run(cmd_cpu, capture_output=True, text=True)
        if result.returncode == 0 and os.path.exists(output_path):
            print("Video rendered with CPU")
            return True

        print(f"FFmpeg error: {result.stderr[:500]}")
        return False

    except Exception as e:
        print(f"Render error: {e}")
        return False

# ============================================================================
# UTILS
# ============================================================================

async def download_audio(url: str, output_path: str) -> bool:
    """Download audio from URL"""
    try:
        import httpx
        print(f"Downloading audio...")

        async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
            response = await client.get(url, headers={"x-api-key": FILE_SERVER_API_KEY})

            if response.status_code != 200:
                print(f"Download failed: {response.status_code}")
                return False

            with open(output_path, "wb") as f:
                f.write(response.content)

            print(f"Downloaded {len(response.content)} bytes")
            return True
    except Exception as e:
        print(f"Download error: {e}")
        return False


async def upload_to_gofile(file_path: str, custom_filename: str = None) -> Optional[str]:
    try:
        import httpx
        async with httpx.AsyncClient(timeout=600.0) as client:
            srv = await client.get("https://api.gofile.io/servers")
            if srv.status_code != 200: return None
            data = srv.json()["data"]
            servers = data.get("servers", []) or data.get("serversAllZone", [])
            if not servers: return None
            server = servers[0]["name"]
            filename = custom_filename or os.path.basename(file_path)
            with open(file_path, 'rb') as f:
                up = await client.post(f"https://{server}.gofile.io/contents/uploadfile",
                                      files={'file': (filename, f)})
            if up.status_code == 200:
                return up.json()["data"]["downloadPage"]
            return None
    except Exception as e:
        print(f"Gofile error: {e}")
        return None

# ============================================================================
# JOB PROCESSOR
# ============================================================================

async def process_job(job: Dict) -> bool:
    """Process a Shorts job"""
    job_id = job["job_id"]
    existing_audio_link = job.get("existing_audio_link")

    if not existing_audio_link:
        print(f"Job {job_id[:8]} has no audio - skipping")
        return True

    short_number = job.get("short_number", job.get("video_number", 0))
    source_video = job.get("source_video", "SHORTS")

    print(f"\n{'='*50}")
    print(f"SHORTS JOB: {job_id[:8]} (#{short_number})")
    print(f"{'='*50}")

    queue.send_heartbeat(WORKER_ID, status="busy", current_job=job_id)

    local_audio = os.path.join(OUTPUT_DIR, f"audio_{job_id}.wav")
    local_image = os.path.join(OUTPUT_DIR, f"image_{job_id}.jpg")
    local_video = os.path.join(OUTPUT_DIR, f"video_{job_id}.mp4")

    try:
        # Step 1: Download Audio
        print("\n[1/4] Downloading Audio...")
        if not await download_audio(existing_audio_link, local_audio):
            raise Exception("Failed to download audio")

        # Step 2: Generate AI Image
        print("\n[2/4] Generating AI Image...")
        if not generate_ai_image(local_image):
            raise Exception("Failed to generate AI image")

        # Step 3: Generate Subtitles
        print("\n[3/4] Generating Subtitles...")
        ass_path = generate_subtitles(local_audio)
        if not ass_path:
            raise Exception("Failed to generate subtitles")

        # Step 4: Render Video
        print("\n[4/4] Rendering Video...")
        if not render_video(local_image, local_audio, ass_path, local_video):
            raise Exception("Failed to render video")

        # Upload to Gofile
        print("\nUploading to Gofile...")
        custom_filename = f"SHORT_{short_number}.mp4"
        video_link = await upload_to_gofile(local_video, custom_filename)
        if not video_link:
            raise Exception("Failed to upload video")

        print(f"Video uploaded: {video_link}")

        # Complete job
        queue.complete_audio_job(job_id, WORKER_ID, video_link)
        queue.increment_worker_stat(WORKER_ID, "jobs_completed")

        # Send Telegram
        send_telegram(
            f"📱 <b>Short Ready</b>\n"
            f"<b>Source:</b> {source_video}\n"
            f"<b>Number:</b> #{short_number}\n\n"
            f"<b>🔗 Video:</b> {video_link}",
            username=job.get("username")
        )

        print(f"\n{'='*50}")
        print(f"SHORT COMPLETE: #{short_number}")
        print(f"Video: {video_link}")
        print(f"{'='*50}")

        return True

    except Exception as e:
        print(f"Job Failed: {e}")
        traceback.print_exc()
        queue.fail_audio_job(job_id, WORKER_ID, str(e))
        return False
    finally:
        # Cleanup
        for f in [local_audio, local_image, local_video]:
            if f and os.path.exists(f):
                try: os.remove(f)
                except: pass
        if 'ass_path' in locals() and ass_path and os.path.exists(ass_path):
            try: os.remove(ass_path)
            except: pass

# ============================================================================
# MAIN LOOP
# ============================================================================

async def main():
    print(f"\n{'='*60}")
    print("  SHORTS WORKER STARTED (Windows PC)")
    print(f"{'='*60}")
    print(f"Worker ID: {WORKER_ID}")
    print(f"Poll Interval: {POLL_INTERVAL}s")
    print(f"Temp Dir: {TEMP_DIR}")
    print(f"Output Dir: {OUTPUT_DIR}")

    queue.send_heartbeat(WORKER_ID, status="online")

    while True:
        try:
            job = queue.claim_shorts_job(WORKER_ID)

            if job:
                await process_job(job)
            else:
                print(f"Waiting for shorts jobs... ({POLL_INTERVAL}s)")
                await asyncio.sleep(POLL_INTERVAL)

            queue.send_heartbeat(WORKER_ID, status="online")

        except KeyboardInterrupt:
            print("Stopped by user")
            break
        except Exception as e:
            print(f"Loop Error: {e}")
            traceback.print_exc()
            await asyncio.sleep(10)


if __name__ == "__main__":
    asyncio.run(main())
