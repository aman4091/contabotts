#!/usr/bin/env python3
"""
Shorts Worker (Windows PC)
Creates YouTube Shorts (1080x1920) from audio with AI images

Flow:
1. Claim Shorts Job (is_short=true with existing_audio_link)
2. Download Audio from existing_audio_link
3. Generate AI Image (via FLUX.1-schnell from ai_image_generator)
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

# Import AI image generator (uses FLUX.1-schnell)
try:
    from ai_image_generator import generate_ai_image as flux_generate_image
    from ai_image_generator import generate_multiple_ai_images as flux_generate_multiple_images
    AI_IMAGE_AVAILABLE = True
    print("✅ AI Image Generator loaded (FLUX.1-schnell)")
except ImportError as e:
    AI_IMAGE_AVAILABLE = False
    print(f"⚠️ AI Image Generator not available: {e}")

# ============================================================================
# CONFIGURATION
# ============================================================================

FILE_SERVER_URL = os.getenv("FILE_SERVER_URL")
FILE_SERVER_API_KEY = os.getenv("FILE_SERVER_API_KEY")
FILE_SERVER_EXTERNAL_URL = os.getenv("FILE_SERVER_EXTERNAL_URL", FILE_SERVER_URL)  # Fallback to FILE_SERVER_URL
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

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
# AI IMAGE GENERATION (Using ai_image_generator.py with FLUX.1-schnell)
# ============================================================================

def fetch_shorts_folder_images(output_dir: str, count: int) -> list:
    """Fetch images from shorts folder on server, download them locally"""
    try:
        # Get list of images in shorts folder
        response = requests.get(
            f"{FILE_SERVER_URL}/images/shorts",
            headers={"x-api-key": FILE_SERVER_API_KEY},
            timeout=30
        )

        if response.status_code != 200:
            print(f"Failed to fetch shorts folder: {response.status_code}")
            return []

        available_images = response.json().get("images", [])
        if not available_images:
            print("No images in shorts folder")
            return []

        # Randomly select images (up to count)
        import random
        random.shuffle(available_images)
        images_to_use = available_images[:count]

        print(f"📂 Found {len(available_images)} images in shorts folder, using {len(images_to_use)}")

        # Download images locally
        local_paths = []
        for i, img_name in enumerate(images_to_use):
            try:
                img_url = f"{FILE_SERVER_URL}/files/images/shorts/{img_name}"
                local_path = os.path.join(output_dir, f"shorts_img_{i}.jpg")

                dl_response = requests.get(img_url, headers={"x-api-key": FILE_SERVER_API_KEY}, timeout=60)
                if dl_response.status_code == 200:
                    with open(local_path, 'wb') as f:
                        f.write(dl_response.content)
                    local_paths.append(local_path)
                    print(f"   Downloaded: {img_name}")
            except Exception as e:
                print(f"   Failed to download {img_name}: {e}")

        return local_paths
    except Exception as e:
        print(f"Error fetching shorts folder: {e}")
        return []


def generate_ai_image(output_path: str, script_text: str = "") -> bool:
    """Generate AI image using FLUX.1-schnell via ai_image_generator"""
    if not AI_IMAGE_AVAILABLE:
        print("❌ AI Image Generator not available")
        return False

    # Use default script if none provided
    if not script_text:
        script_text = "Archangel Michael, divine warrior, majestic presence, heavenly scene"

    return flux_generate_image(script_text, output_path, width=SHORTS_W, height=SHORTS_H)


def generate_multiple_ai_images(output_dir: str, count: int, script_text: str = "") -> list:
    """Generate multiple AI images using FLUX.1-schnell via ai_image_generator"""
    if not AI_IMAGE_AVAILABLE:
        print("❌ AI Image Generator not available")
        return []

    # Use default script if none provided
    if not script_text:
        script_text = "Archangel Michael, divine warrior, majestic presence, heavenly scene"

    return flux_generate_multiple_images(script_text, output_dir, count, width=SHORTS_W, height=SHORTS_H)

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


def render_video_concat(image_paths: list, audio_path: str, ass_path: str, output_path: str, segment_duration: int = 12, fade_duration: float = 1.0) -> bool:
    """Render Shorts video with multiple images using concat method (fade transitions)"""
    import tempfile
    import shutil

    try:
        num_images = len(image_paths)
        duration = get_audio_duration(audio_path)

        print(f"Rendering with CONCAT ({num_images} images, {segment_duration}s each)")
        print(f"Total duration: {duration:.1f}s")

        safe_ass = ass_path.replace("\\", "/").replace(":", "\\:")
        temp_dir = tempfile.mkdtemp(prefix="shorts_concat_")
        segment_files = []

        try:
            # Step 1: Create each segment with fade in/out
            for i, img_path in enumerate(image_paths):
                seg_file = os.path.join(temp_dir, f"seg_{i:03d}.mp4")
                seg_duration = segment_duration

                # Last segment might be shorter
                elapsed = i * segment_duration
                if elapsed + segment_duration > duration:
                    seg_duration = duration - elapsed
                    if seg_duration <= 0:
                        break

                # Fade filter
                fade_filter = f"fade=t=in:st=0:d={fade_duration},fade=t=out:st={seg_duration - fade_duration}:d={fade_duration}"
                vf = f"scale={SHORTS_W}:{SHORTS_H}:force_original_aspect_ratio=increase,crop={SHORTS_W}:{SHORTS_H},format=yuv420p,{fade_filter}"

                cmd = [
                    "ffmpeg", "-y", "-loop", "1", "-t", str(seg_duration), "-i", img_path,
                    "-vf", vf,
                    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
                    "-an", seg_file
                ]

                result = subprocess.run(cmd, capture_output=True)
                if result.returncode != 0:
                    print(f"Segment {i} failed")
                    continue

                segment_files.append(seg_file)
                print(f"Segment {i+1}/{num_images} done")

            print(f"Created {len(segment_files)} segments")

            if not segment_files:
                return False

            # Step 2: Create concat list
            concat_list = os.path.join(temp_dir, "concat.txt")
            with open(concat_list, 'w') as f:
                for seg_file in segment_files:
                    safe_seg = seg_file.replace("\\", "/")
                    f.write(f"file '{safe_seg}'\n")

            # Step 3: Concat segments
            print("Joining segments...")
            concat_output = os.path.join(temp_dir, "concat_video.mp4")
            cmd_concat = [
                "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_list,
                "-c", "copy", concat_output
            ]
            subprocess.run(cmd_concat, capture_output=True)

            # Step 4: Add audio and subtitles
            print("Adding audio and subtitles...")
            cmd_final = [
                "ffmpeg", "-y", "-i", concat_output, "-i", audio_path,
                "-vf", f"subtitles='{safe_ass}'",
                "-c:v", "libx264", "-preset", "fast", "-crf", "18",
                "-c:a", "aac", "-b:a", "192k",
                "-shortest", output_path
            ]

            result = subprocess.run(cmd_final, capture_output=True)

            if result.returncode == 0 and os.path.exists(output_path):
                print("Video rendered successfully!")
                return True
            else:
                print(f"Final render failed: {result.stderr.decode()[:300] if result.stderr else 'Unknown'}")
                return False

        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    except Exception as e:
        print(f"Render error: {e}")
        traceback.print_exc()
        return False


def render_video(image_path: str, audio_path: str, ass_path: str, output_path: str) -> bool:
    """Render Shorts video with single image (fallback)"""
    try:
        print("Rendering Shorts Video (single image)...")

        total_duration = get_audio_duration(audio_path)
        print(f"Audio Duration: {total_duration:.1f}s")

        safe_ass = ass_path.replace("\\", "/").replace(":", "\\:")
        vf = f"scale={SHORTS_W}:{SHORTS_H}:force_original_aspect_ratio=increase,crop={SHORTS_W}:{SHORTS_H},format=yuv420p,subtitles='{safe_ass}'"

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

async def upload_to_contabo(file_path: str, username: str, short_number: int) -> Optional[str]:
    """Upload file to Contabo file server as fallback"""
    try:
        ext = os.path.splitext(file_path)[1] or ".mp4"
        filename = f"SHORT_{short_number}{ext}"
        remote_path = f"shorts-output/{username}/{filename}"

        print(f"Uploading to Contabo: {remote_path}")

        with open(file_path, "rb") as f:
            resp = requests.post(
                f"{FILE_SERVER_URL}/files/{remote_path}",
                files={"file": (filename, f, "video/mp4")},
                headers={"x-api-key": FILE_SERVER_API_KEY},
                timeout=300
            )

        if resp.status_code == 200:
            download_url = f"{FILE_SERVER_EXTERNAL_URL}/files/{remote_path}"
            print(f"Contabo upload success: {download_url}")
            return download_url
        else:
            print(f"Contabo upload failed: {resp.status_code}")
            return None
    except Exception as e:
        print(f"Contabo upload error: {e}")
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
    script_text = job.get("script_text", "")  # Get script for AI image prompts

    print(f"\n{'='*50}")
    print(f"SHORTS JOB: {job_id[:8]} (#{short_number})")
    print(f"{'='*50}")

    queue.send_heartbeat(WORKER_ID, status="busy", current_job=job_id)

    local_audio = os.path.join(OUTPUT_DIR, f"audio_{job_id}.wav")
    local_video = os.path.join(OUTPUT_DIR, f"video_{job_id}.mp4")
    local_images = []  # Will hold multiple image paths

    try:
        # Step 1: Download Audio
        print("\n[1/4] Downloading Audio...")
        if not await download_audio(existing_audio_link, local_audio):
            raise Exception("Failed to download audio")

        # Get audio duration to calculate number of images
        audio_duration = get_audio_duration(local_audio)
        IMAGE_DISPLAY_DURATION = 12  # 12 seconds per image
        MAX_IMAGES = 15

        num_images = min(MAX_IMAGES, max(1, int(audio_duration / IMAGE_DISPLAY_DURATION) + 1))
        print(f"Audio: {audio_duration:.1f}s -> {num_images} images (12s each)")

        # Step 2: Get Images (shorts folder first, then AI)
        print(f"\n[2/4] Getting {num_images} Images...")

        # First try shorts folder
        local_images = fetch_shorts_folder_images(OUTPUT_DIR, num_images)
        folder_count = len(local_images)

        # If not enough images, fill with AI
        remaining = num_images - folder_count
        if remaining > 0:
            print(f"📷 Need {remaining} more images, generating AI images...")
            ai_images = generate_multiple_ai_images(OUTPUT_DIR, remaining, script_text)
            if ai_images:
                local_images.extend(ai_images)
                print(f"✅ Total: {folder_count} from folder + {len(ai_images)} AI = {len(local_images)} images")

        if not local_images:
            # Fallback to single AI image
            print("No images available, trying single AI image...")
            single_image = os.path.join(OUTPUT_DIR, f"image_{job_id}.jpg")
            if generate_ai_image(single_image, script_text):
                local_images = [single_image]
            else:
                raise Exception("Failed to get any images")

        # Step 3: Generate Subtitles
        print("\n[3/4] Generating Subtitles...")
        ass_path = generate_subtitles(local_audio)
        if not ass_path:
            raise Exception("Failed to generate subtitles")

        # Step 4: Render Video
        print("\n[4/4] Rendering Video...")
        if len(local_images) > 1:
            # Multiple images with fade transitions
            if not render_video_concat(local_images, local_audio, ass_path, local_video, segment_duration=IMAGE_DISPLAY_DURATION):
                raise Exception("Failed to render video")
        else:
            # Single image fallback
            if not render_video(local_images[0], local_audio, ass_path, local_video):
                raise Exception("Failed to render video")

        # Upload to Gofile (with Contabo fallback)
        print("\n[5/5] Uploading Video...")
        custom_filename = f"SHORT_{short_number}.mp4"
        video_link = await upload_to_gofile(local_video, custom_filename)

        if not video_link:
            print("Gofile failed, trying Contabo...")
            username = job.get("username", "default")
            video_link = await upload_to_contabo(local_video, username, short_number)

        if not video_link:
            # Both failed - show local path
            print(f"\n⚠️ All uploads failed! Video saved locally: {local_video}")
            video_link = f"LOCAL:{local_video}"

        print(f"Video: {video_link}")

        # Complete job
        queue.complete_audio_job(job_id, WORKER_ID, video_link)
        queue.increment_worker_stat(WORKER_ID, "jobs_completed")

        # Send Telegram
        send_telegram(
            f"📱 <b>Short Ready</b>\n"
            f"<b>Source:</b> {source_video}\n"
            f"<b>Number:</b> #{short_number}\n"
            f"<b>Images:</b> {len(local_images)}\n\n"
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
        for f in [local_audio, local_video]:
            if f and os.path.exists(f):
                try: os.remove(f)
                except: pass
        # Cleanup multiple images
        for img in local_images:
            if img and os.path.exists(img):
                try: os.remove(img)
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
