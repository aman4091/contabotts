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
    return {
        "font": {"family": "Arial", "size": FONT_SIZE, "color": "#FFFFFF"},
        "background": {"color": "#000000", "opacity": 100, "cornerRadius": 40},
        "box": {"hPadding": 15, "vPadding": 10, "charWidth": 0.6},
        "position": {"alignment": 5, "marginV": 40, "marginL": 40, "marginR": 40}
    }

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

    def generate_subtitles(self, audio_path):
        print(f"📝 Transcribing: {os.path.basename(audio_path)}...")
        result = self.model.transcribe(audio_path, word_timestamps=False)
        
        ass_path = os.path.splitext(audio_path)[0] + ".ass"
        
        header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {TARGET_W}
PlayResY: {TARGET_H}

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Default,Arial,{FONT_SIZE},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,1,0,2,20,20,50,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
        events = []
        
        for segment in result['segments']:
            start = self.format_time(segment['start'])
            end = self.format_time(segment['end'])
            text = segment['text'].strip()

            # --- WRAP LOGIC ---
            max_chars = 35 
            words = text.split()
            lines = []; curr = []
            for w in words:
                if len(" ".join(curr + [w])) <= max_chars: curr.append(w)
                else: lines.append(" ".join(curr)); curr = [w]
            lines.append(" ".join(curr))
            final_text = "\\N".join(lines)
            
            # --- BOX CALCULATION ---
            char_width = FONT_SIZE * 0.55
            longest_line = max(len(l) for l in lines)
            text_w = longest_line * char_width
            text_h = len(lines) * (FONT_SIZE * 1.4)
            
            # Tight Padding for 1080p
            padding_x = 40
            padding_y = 60 # Enough for 1080p ascenders
            
            box_w = text_w + padding_x
            box_h = text_h + padding_y
            
            # Center Position
            cx, cy = 960, TEXT_Y_POS
            
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
            
            # Smart Radius
            r = 40
            if r > (box_w // 2): r = int(box_w // 2)
            
            # Draw Box
            draw = (f"m {x1+r} {y1} l {x2-r} {y1} b {x2} {y1} {x2} {y1} {x2} {y1+r} "
                    f"l {x2} {y2-r} b {x2} {y2} {x2} {y2} {x2-r} {y2} "
                    f"l {x1+r} {y2} b {x1} {y2} {x1} {y2} {x1} {y2-r} "
                    f"l {x1} {y1+r} b {x1} {y1} {x1} {y1} {x1+r} {y1}")
            
            events.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{{\\p1\\an7\\pos(0,0)\\1c&H000000&\\1a&H{BOX_OPACITY}&\\bord0\\shad0}}{draw}{{\\p0}}")
            events.append(f"Dialogue: 1,{start},{end},Default,,0,0,0,,{{\\pos({cx},{cy})\\an5}}{final_text}")

        with open(ass_path, "w", encoding="utf-8") as f:
            f.write(header + "\n".join(events))
        return ass_path

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