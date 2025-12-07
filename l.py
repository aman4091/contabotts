#!/usr/bin/env python3
"""
Landscape Video Worker - 1080p PRO (Fast Render + High Bitrate)
Resolution: 1920x1080
Bitrate: 12 Mbps
Speed: Optimized (P5 Preset)
"""

import os
import sys
import time
import random
import shutil
import subprocess
import glob
import json

# ================= CONFIGURATION =================
BASE_DIR = os.getcwd()
AUDIO_DIR = os.path.join(BASE_DIR, "input_audio")
IMAGE_DIR = os.path.join(BASE_DIR, "input_images")
OUTPUT_DIR = os.path.join(BASE_DIR, "output_videos")

# --- 1080p PRO SETTINGS ---
TARGET_W = 1920
TARGET_H = 1080

FONT_SIZE = 80       # Perfect for 1080p
BOX_OPACITY = "00"   # Solid Black
TEXT_Y_POS = 540     # Dead Center
# =================================================

def run_command(cmd):
    try:
        subprocess.run(cmd, shell=True, check=True)
        return True
    except: return False

def setup_environment():
    print("🛠️  Checking Environment...")
    for d in [AUDIO_DIR, IMAGE_DIR, OUTPUT_DIR]: os.makedirs(d, exist_ok=True)
    try: subprocess.run(["ffmpeg", "-version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except: 
        print("⚠️ Auto-installing FFmpeg..."); run_command("conda install -y -c nvidia/label/cuda-11.8.0 ffmpeg")
    try: import whisper; import torch
    except: print("⚠️ Installing Libs..."); run_command("pip install openai-whisper torch numpy soundfile")

# =================================================
# AUDIO ENHANCER (STUDIO QUALITY)
# =================================================

def enhance_audio(input_path):
    print("🎚️  Mastering Audio...")
    output_path = input_path.replace(".wav", "_mastered.wav").replace(".mp3", "_mastered.wav")
    
    # Radio Voice Effect: Bass Boost + Compression + Normalization
    af = (
        "highpass=f=80,"
        "compand=attacks=0:points=-80/-900|-45/-15|-27/-9|0/-7|20/-7:gain=5,"
        "equalizer=f=100:width_type=h:width=100:g=5,"
        "loudnorm=I=-14:TP=-1.5:LRA=11"
    )
    
    cmd = ["ffmpeg", "-y", "-i", input_path, "-af", af, "-ar", "48000", output_path]
    try:
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        return output_path
    except:
        return input_path

# =================================================
# HELPER FUNCTIONS
# =================================================

def hex_to_ass_color(hex_color, opacity=100):
    hex_color = hex_color.lstrip('#')
    r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
    alpha = int((100 - opacity) * 255 / 100)
    return f"&H{alpha:02X}{b:02X}{g:02X}{r:02X}"

def load_subtitle_settings():
    """Load subtitle settings from API (remote) or local file as fallback"""
    import requests

    defaults = {
        "font": {"family": "Arial", "size": 80, "color": "#FFFFFF"},
        "background": {"color": "#000000", "opacity": 100, "cornerRadius": 40},
        "box": {"hPadding": 15, "vPadding": 10, "charWidth": 0.6},
        "position": {"alignment": 5, "marginV": 40, "marginL": 40, "marginR": 40}
    }

    # Try fetching from API first (works on Vast.ai)
    try:
        file_server_url = os.getenv("FILE_SERVER_URL", "http://38.242.144.132:8000")
        # Webapp runs on port 3000, derive from file server URL
        webapp_url = file_server_url.replace(":8000", ":3000")
        api_url = f"{webapp_url}/api/subtitle-settings"

        print(f"📝 Fetching subtitle settings from: {api_url}")
        response = requests.get(api_url, timeout=5)
        if response.status_code == 200:
            data = response.json()
            if data.get("success") and data.get("settings"):
                settings = data["settings"]
                # Merge with defaults
                for key in defaults:
                    if key not in settings:
                        settings[key] = defaults[key]
                    else:
                        for subkey in defaults[key]:
                            if subkey not in settings[key]:
                                settings[key][subkey] = defaults[key][subkey]
                print(f"✅ Loaded settings: Font={settings['font']['family']} @ {settings['font']['size']}px")
                return settings
    except Exception as e:
        print(f"⚠️ API fetch failed: {e}")

    # Fallback to local file
    try:
        settings_file = os.path.join(os.path.dirname(__file__), "data", "subtitle-settings.json")
        if os.path.exists(settings_file):
            print(f"📝 Fallback: Loading from local file: {settings_file}")
            with open(settings_file, 'r') as f:
                settings = json.load(f)
                for key in defaults:
                    if key not in settings:
                        settings[key] = defaults[key]
                    else:
                        for subkey in defaults[key]:
                            if subkey not in settings[key]:
                                settings[key][subkey] = defaults[key][subkey]
                return settings
    except Exception as e:
        print(f"⚠️ Local file load failed: {e}")

    print("⚠️ Using default subtitle settings")
    return defaults

# =================================================
# VIDEO GENERATOR CLASS
# =================================================

class LandscapeGenerator:
    def __init__(self):
        try:
            import whisper
            import torch
            device = "cuda" if torch.cuda.is_available() else "cpu"
            print(f"🔄 Loading Whisper on {device.upper()}...")
            self.model = whisper.load_model("base", device=device)
        except:
            print("❌ Whisper Load Failed"); sys.exit(1)

    def format_time(self, seconds):
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = int(seconds % 60)
        cs = int((seconds % 1) * 100)
        return f"{h}:{m:02d}:{s:02d}.{cs:02d}"

    def fix_transcription(self, text):
        """Fix common Whisper transcription errors"""
        import re

        # Dictionary of corrections (case-insensitive patterns -> correct text)
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

    def generate_subtitles(self, audio_path):
        print(f"📝 Transcribing: {os.path.basename(audio_path)}...")
        # Prompt to help Whisper recognize religious/spiritual terms correctly
        initial_prompt = "Archangel Michael, Archangel Gabriel, Archangel Raphael, God, Jesus Christ, Holy Spirit, angels, divine, blessed, amen."
        result = self.model.transcribe(audio_path, word_timestamps=False, initial_prompt=initial_prompt)

        ass_path = os.path.splitext(audio_path)[0] + ".ass"

        # Load settings from JSON file
        settings = load_subtitle_settings()
        font = settings["font"]
        bg = settings["background"]
        box = settings["box"]
        pos = settings["position"]

        font_size = font["size"]
        font_family = font["family"]
        font_color = hex_to_ass_color(font["color"], 100)
        bg_color = hex_to_ass_color(bg["color"], bg["opacity"])
        corner_radius = bg["cornerRadius"]

        # Calculate Y position based on alignment
        alignment = pos["alignment"]
        margin_v = pos["marginV"]
        if alignment in [1, 2, 3]:  # Bottom
            text_y_pos = TARGET_H - margin_v - 50
        elif alignment in [7, 8, 9]:  # Top
            text_y_pos = margin_v + 50
        else:  # Middle (4, 5, 6)
            text_y_pos = TARGET_H // 2

        header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {TARGET_W}
PlayResY: {TARGET_H}

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Default,{font_family},{font_size},{font_color},{font_color},&H00000000,{bg_color},-1,0,0,0,100,100,0,0,1,1,0,{alignment},{pos["marginL"]},{pos["marginR"]},{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
        events = []

        for segment in result['segments']:
            start = self.format_time(segment['start'])
            end = self.format_time(segment['end'])
            text = segment['text'].strip()

            # Fix transcription errors (e.g., "our changel" -> "Archangel")
            text = self.fix_transcription(text)

            # --- WRAP LOGIC ---
            max_chars = 50  # Increased for fewer lines
            words = text.split()
            lines = []; curr = []
            for w in words:
                if len(" ".join(curr + [w])) <= max_chars: curr.append(w)
                else: lines.append(" ".join(curr)); curr = [w]
            lines.append(" ".join(curr))
            final_text = "\\N".join(lines)

            # --- BOX CALCULATION (using settings) ---
            char_width = font_size * box["charWidth"]
            longest_line = max(len(l) for l in lines)
            text_w = longest_line * char_width
            text_h = len(lines) * (font_size * 1.4)

            # Padding from settings
            padding_x = box["hPadding"] * 2
            padding_y = box["vPadding"] * 2 + 20  # Extra for ascenders

            box_w = text_w + padding_x
            box_h = text_h + padding_y

            # Center Position (X based on alignment)
            if alignment in [1, 4, 7]:  # Left
                cx = pos["marginL"] + int(box_w / 2)
            elif alignment in [3, 6, 9]:  # Right
                cx = TARGET_W - pos["marginR"] - int(box_w / 2)
            else:  # Center
                cx = TARGET_W // 2
            cy = text_y_pos

            x1 = int(cx - (box_w / 2))
            x2 = int(cx + (box_w / 2))

            # Safety Check
            if x2 > TARGET_W - 20:
                diff = x2 - (TARGET_W - 20)
                x1 -= diff; x2 -= diff; cx -= diff
            if x1 < 20:
                diff = 20 - x1
                x1 += diff; x2 += diff; cx += diff

            y1 = int(cy - (box_h / 2))
            y2 = int(cy + (box_h / 2))

            # Smart Radius from settings
            r = corner_radius
            if r > (box_w // 2): r = int(box_w // 2)
            
            # Draw Box
            draw = (f"m {x1+r} {y1} l {x2-r} {y1} b {x2} {y1} {x2} {y1} {x2} {y1+r} "
                    f"l {x2} {y2-r} b {x2} {y2} {x2} {y2} {x2-r} {y2} "
                    f"l {x1+r} {y2} b {x1} {y2} {x1} {y2} {x1} {y2-r} "
                    f"l {x1} {y1+r} b {x1} {y1} {x1} {y1} {x1+r} {y1}")
            
            # Extract color and alpha from bg settings
            bg_hex = bg["color"].lstrip('#')
            bg_r, bg_g, bg_b = int(bg_hex[0:2], 16), int(bg_hex[2:4], 16), int(bg_hex[4:6], 16)
            box_color = f"&H{bg_b:02X}{bg_g:02X}{bg_r:02X}&"
            box_alpha = f"&H{int((100 - bg['opacity']) * 255 / 100):02X}&"
            events.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{{\\p1\\an7\\pos(0,0)\\1c{box_color}\\1a{box_alpha}\\bord0\\shad0}}{draw}{{\\p0}}")
            events.append(f"Dialogue: 1,{start},{end},Default,,0,0,0,,{{\\pos({cx},{cy})\\an5}}{final_text}")

        with open(ass_path, "w", encoding="utf-8") as f:
            f.write(header + "\n".join(events))
        return ass_path

    def get_audio_duration(self, audio_path):
        """Get duration of audio file in seconds"""
        try:
            result = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", audio_path],
                capture_output=True, text=True
            )
            return float(result.stdout.strip())
        except:
            return 60  # Default fallback

    def render(self, audio_path, image_path, ass_path, output_path):
        print("🎬 Rendering 1080p PRO (12 Mbps)...")
        safe_ass = ass_path.replace("\\", "/").replace(":", "\\:")

        vf = f"scale={TARGET_W}:{TARGET_H}:force_original_aspect_ratio=decrease,pad={TARGET_W}:{TARGET_H}:(ow-iw)/2:(oh-ih)/2,format=yuv420p,subtitles='{safe_ass}'"

        inputs = ["ffmpeg", "-y", "-loop", "1", "-i", image_path, "-i", audio_path]

        # --- 1080p FAST & CRISP SETTINGS ---
        cmd_gpu = inputs + [
            "-vf", vf,
            "-c:v", "h264_nvenc",
            "-preset", "p5",        # P5 = High Quality (Faster than P7)
            "-tune", "hq",
            "-rc", "cbr",
            "-b:v", "12M",          # 12 Mbps
            "-maxrate", "12M",
            "-bufsize", "24M",
            "-c:a", "aac", "-b:a", "192k",
            "-shortest", output_path
        ]

        cmd_cpu = inputs + [
            "-vf", vf,
            "-c:v", "libx264", "-preset", "faster", "-crf", "18",
            "-c:a", "aac", "-b:a", "192k",
            "-shortest", output_path
        ]

        print("   Attempting NVENC (1080p P5)...")
        try:
            subprocess.run(cmd_gpu, check=True)
            return True
        except:
            print("⚠️ GPU Failed. Switching to CPU...")
            try:
                subprocess.run(cmd_cpu, check=True)
                return True
            except Exception as e: print(f"❌ Failed: {e}"); return False

    def render_with_fade(self, audio_path, image_paths, ass_path, output_path, fade_duration=1.0):
        """
        Render video with multiple images that fade transition between each other.

        Args:
            audio_path: Path to audio file
            image_paths: List of image paths (will cycle through them)
            ass_path: Path to ASS subtitle file
            output_path: Output video path
            fade_duration: Duration of fade transition in seconds
        """
        if len(image_paths) == 0:
            print("❌ No images provided")
            return False

        if len(image_paths) == 1:
            # Single image, use regular render
            return self.render(audio_path, image_paths[0], ass_path, output_path)

        print(f"🎬 Rendering with {len(image_paths)} images (fade transitions)...")

        # Get audio duration
        duration = self.get_audio_duration(audio_path)
        print(f"   Audio duration: {duration:.2f}s")

        # Calculate segment duration for each image
        num_images = len(image_paths)
        segment_duration = duration / num_images
        print(f"   Each image: {segment_duration:.2f}s")

        safe_ass = ass_path.replace("\\", "/").replace(":", "\\:")

        # Build FFmpeg complex filter for crossfade
        inputs = ["ffmpeg", "-y"]

        # Add all images as inputs (looped)
        for i, img_path in enumerate(image_paths):
            inputs.extend(["-loop", "1", "-t", str(segment_duration + fade_duration), "-i", img_path])

        # Add audio input
        inputs.extend(["-i", audio_path])

        # Build xfade filter chain
        filter_parts = []
        current_label = "[0:v]"

        # Scale all inputs first
        for i in range(num_images):
            filter_parts.append(f"[{i}:v]scale={TARGET_W}:{TARGET_H}:force_original_aspect_ratio=decrease,pad={TARGET_W}:{TARGET_H}:(ow-iw)/2:(oh-ih)/2,setsar=1[v{i}]")

        # Chain xfade transitions
        current_input = "[v0]"
        for i in range(1, num_images):
            offset = (segment_duration * i) - fade_duration
            if offset < 0:
                offset = 0
            output_label = f"[xf{i}]" if i < num_images - 1 else "[vfade]"
            filter_parts.append(f"{current_input}[v{i}]xfade=transition=fade:duration={fade_duration}:offset={offset:.2f}{output_label}")
            current_input = f"[xf{i}]" if i < num_images - 1 else "[vfade]"

        # Add subtitles to final video
        filter_parts.append(f"[vfade]format=yuv420p,subtitles='{safe_ass}'[vout]")

        filter_complex = ";".join(filter_parts)

        # GPU command
        cmd_gpu = inputs + [
            "-filter_complex", filter_complex,
            "-map", "[vout]",
            "-map", f"{num_images}:a",
            "-c:v", "h264_nvenc",
            "-preset", "p5",
            "-tune", "hq",
            "-rc", "cbr",
            "-b:v", "12M",
            "-maxrate", "12M",
            "-bufsize", "24M",
            "-c:a", "aac", "-b:a", "192k",
            "-shortest",
            output_path
        ]

        # CPU fallback command
        cmd_cpu = inputs + [
            "-filter_complex", filter_complex,
            "-map", "[vout]",
            "-map", f"{num_images}:a",
            "-c:v", "libx264", "-preset", "faster", "-crf", "18",
            "-c:a", "aac", "-b:a", "192k",
            "-shortest",
            output_path
        ]

        print("   Attempting NVENC with fade transitions...")
        try:
            subprocess.run(cmd_gpu, check=True)
            return True
        except Exception as e:
            print(f"⚠️ GPU Failed ({e}). Switching to CPU...")
            try:
                subprocess.run(cmd_cpu, check=True)
                return True
            except Exception as e2:
                print(f"❌ Failed: {e2}")
                return False

def main():
    setup_environment()
    gen = LandscapeGenerator()
    print("\n🚀 Landscape Worker (1080p Fast & Crisp) Started!")
    print(f"📁 Watching: {AUDIO_DIR}")

    while True:
        try:
            audios = glob.glob(os.path.join(AUDIO_DIR, "*.wav")) + glob.glob(os.path.join(AUDIO_DIR, "*.mp3"))
            if not audios:
                print("⏳ Waiting...", end='\r'); time.sleep(5); continue
            
            curr_audio = audios[0]
            name = os.path.splitext(os.path.basename(curr_audio))[0]
            print(f"\n🔹 Processing: {name}")
            
            # --- AUDIO MASTERING ---
            mastered_audio = enhance_audio(curr_audio)
            
            imgs = glob.glob(os.path.join(IMAGE_DIR, "*.jpg")) + glob.glob(os.path.join(IMAGE_DIR, "*.png"))
            if not imgs: print("❌ No Images!"); time.sleep(10); continue
            
            curr_img = random.choice(imgs)
            ass = gen.generate_subtitles(mastered_audio)
            out = os.path.join(OUTPUT_DIR, f"{name}.mp4")
            
            if gen.render(mastered_audio, curr_img, ass, out):
                print(f"✅ Saved: {out}")
                os.remove(curr_audio)
                if mastered_audio != curr_audio: os.remove(mastered_audio)
                os.remove(curr_img)
                if os.path.exists(ass): os.remove(ass)
            else:
                print("❌ Failed"); shutil.move(curr_audio, curr_audio + ".failed")

        except KeyboardInterrupt: break
        except Exception as e: print(f"Error: {e}"); time.sleep(5)

if __name__ == "__main__":
    main()