#!/usr/bin/env python3
"""
Video Generator Module - ULTRA SAFE GPU MODE + ORIGINAL STYLING
Creates videos from image + audio with burned-in ASS subtitles (Dynamic Box Style)
"""

import os
import subprocess
import whisper
import re
import asyncio
import json
import shutil
from pathlib import Path

# ============================================================================
# HELPER FUNCTIONS (ORIGINAL)
# ============================================================================

def hex_to_ass_color(hex_color, opacity=100):
    hex_color = hex_color.lstrip('#')
    r = int(hex_color[0:2], 16)
    g = int(hex_color[2:4], 16)
    b = int(hex_color[4:6], 16)
    alpha = int((100 - opacity) * 255 / 100)
    return f"&H{alpha:02X}{b:02X}{g:02X}{r:02X}"

def load_subtitle_settings():
    # Global settings file - same for all users
    settings_file = os.path.join(os.path.dirname(__file__), "data", "subtitle-settings.json")
    defaults = {
        "font": {"family": "Arial", "size": 48, "color": "#FFFFFF"},
        "background": {"color": "#000000", "opacity": 80, "cornerRadius": 20},
        "box": {"hPadding": 25, "vPadding": 15, "charWidth": 0.6},
        "position": {"alignment": 5, "marginV": 40, "marginL": 40, "marginR": 40}
    }
    try:
        if os.path.exists(settings_file):
            print(f"📝 Loading subtitle settings from: {settings_file}")
            with open(settings_file, 'r') as f:
                settings = json.load(f)
                for key in defaults:
                    if key not in settings: settings[key] = defaults[key]
                    else:
                        for subkey in defaults[key]:
                            if subkey not in settings[key]: settings[key][subkey] = defaults[key][subkey]
                return settings
    except: pass
    return defaults


# ============================================================================
# VIDEO GENERATOR CLASS
# ============================================================================

class VideoGenerator:
    def __init__(self):
        self.whisper_model = None
        self.gpu_encoder = self._detect_gpu_encoder()
        print(f"✅ VideoGenerator initialized (Default Encoder: {self.gpu_encoder})")

    def _detect_gpu_encoder(self):
        if os.getenv('FORCE_CPU_ENCODER', 'false').lower() == 'true':
            return 'libx264'
        try:
            result = subprocess.run(['ffmpeg', '-hide_banner', '-encoders'], capture_output=True, text=True, timeout=5)
            if 'h264_nvenc' in result.stdout:
                print("🚀 NVENC GPU Encoder detected")
                return 'h264_nvenc'
        except:
            pass
        return 'libx264'

    def load_whisper_model(self, model_size="base"):
        if not self.whisper_model:
            try:
                import torch
                device = "cuda" if torch.cuda.is_available() else "cpu"
                print(f"🔄 Loading Whisper ({model_size}) on {device.upper()}...")
                self.whisper_model = whisper.load_model(model_size, device=device)
            except Exception as e:
                print(f"⚠️ Whisper GPU failed, using CPU: {e}")
                self.whisper_model = whisper.load_model(model_size)
        return self.whisper_model

    def _get_duration(self, path):
        try:
            cmd = ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path]
            result = subprocess.run(cmd, capture_output=True, text=True)
            return float(result.stdout.strip())
        except: return 0

    # ============================================================================
    # 1. CREATE VIDEO FROM IMAGE + AUDIO (NEW GPU LOGIC)
    # ============================================================================
    
    def create_video_from_image_audio(self, image_path, audio_path, output_path, progress_callback=None):
        success = self._run_ffmpeg_create(image_path, audio_path, output_path, self.gpu_encoder, progress_callback)
        if not success and self.gpu_encoder == 'h264_nvenc':
            print("\n⚠️ GPU Encoding failed. Switching to CPU fallback...")
            self.gpu_encoder = 'libx264' 
            return self._run_ffmpeg_create(image_path, audio_path, output_path, 'libx264', progress_callback)
        return success

    def _run_ffmpeg_create(self, image_path, audio_path, output_path, encoder, progress_callback):
        try:
            print(f"🎬 Creating video using {encoder}...")
            duration = self._get_duration(audio_path)

            cmd = ['ffmpeg', '-y', '-loop', '1', '-i', image_path, '-i', audio_path]

            if encoder == 'h264_nvenc':
                cmd.extend([
                    '-c:v', 'h264_nvenc',
                    '-preset', 'fast',
                    '-b:v', '5M',
                    '-pix_fmt', 'yuv420p'
                ])
            else:
                cmd.extend([
                    '-c:v', 'libx264',
                    '-tune', 'stillimage',
                    '-pix_fmt', 'yuv420p'
                ])

            cmd.extend([
                '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p',
                '-c:a', 'aac', '-b:a', '192k',
                '-shortest',
                '-progress', 'pipe:1',
                output_path
            ])

            process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True, bufsize=1)
            last_reported = 0
            for line in process.stdout:
                if 'out_time_ms=' in line:
                    try:
                        time_ms = int(line.split('=')[1])
                        current = time_ms / 1000000
                        if duration > 0:
                            pct = min(100, (current/duration)*100)
                            if pct - last_reported >= 10:
                                print(f"   Enc: {pct:.0f}%", end='\r', flush=True)
                                last_reported = pct
                    except: pass
            
            process.wait()
            if process.returncode == 0:
                print(f"✅ Video created: {output_path}")
                return True
            else:
                print(f"❌ FFmpeg failed (Return Code: {process.returncode})")
                return False

        except Exception as e:
            print(f"❌ Error: {e}")
            return False

    # ============================================================================
    # 2. SUBTITLE GENERATION (RESTORED ORIGINAL LOGIC)
    # ============================================================================

    def generate_subtitles_whisper(self, audio_path, output_srt_path=None):
        try:
            print(f"📝 Transcribing audio...")
            if not self.whisper_model: self.load_whisper_model()
            
            result = self.whisper_model.transcribe(
                audio_path, 
                language="en", 
                verbose=False,
                word_timestamps=False
            )
            
            if not output_srt_path:
                output_srt_path = os.path.splitext(audio_path)[0] + ".srt"
                
            self._write_srt(result['segments'], output_srt_path)
            
            return output_srt_path
        except Exception as e:
            print(f"❌ Transcription error: {e}")
            return None

    def _write_srt(self, segments, output_path):
        """Write Whisper segments to SRT format with line wrapping"""
        with open(output_path, 'w', encoding='utf-8') as f:
            for i, segment in enumerate(segments, 1):
                f.write(f"{i}\n")
                start = self._fmt_time(segment['start'])
                end = self._fmt_time(segment['end'])
                f.write(f"{start} --> {end}\n")
                text = segment['text'].strip()
                wrapped_text = self._wrap_text(text, max_chars=50)
                f.write(f"{wrapped_text}\n\n")

    def _wrap_text(self, text, max_chars=50):
        words = text.split()
        lines = []
        current_line = []
        current_length = 0
        for word in words:
            word_length = len(word)
            if current_length + word_length + len(current_line) > max_chars:
                if current_line:
                    lines.append(' '.join(current_line))
                    current_line = [word]
                    current_length = word_length
                else:
                    lines.append(word)
            else:
                current_line.append(word)
                current_length += word_length
        if current_line: lines.append(' '.join(current_line))
        return '\n'.join(lines)

    def _fmt_time(self, seconds):
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = int(seconds % 60)
        ms = int((seconds % 1) * 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

    def _srt_time_to_ass(self, srt_time):
        time_part, ms_part = srt_time.split(',')
        h, m, s = time_part.split(':')
        h = int(h)
        centiseconds = int(ms_part) // 10
        return f"{h}:{m}:{s}.{centiseconds:02d}"

    def convert_srt_to_ass(self, srt_path, ass_style=None, output_ass_path=None):
        """RESTORED: Original Complex ASS Conversion with Box Drawing"""
        try:
            print(f"🎨 Converting SRT to ASS (Original Style)...")
            if not output_ass_path: output_ass_path = srt_path.replace('.srt', '.ass')

            sub_settings = load_subtitle_settings()
            
            if not ass_style:
                font = sub_settings["font"]
                bg = sub_settings["background"]
                pos = sub_settings["position"]
                fc = hex_to_ass_color(font["color"], 100)
                bc = hex_to_ass_color(bg["color"], bg["opacity"])
                ass_style = f'Style: Default,{font["family"]},{font["size"]},{fc},{fc},{bc},{bc},-1,0,0,0,100,100,0,0,1,0,0,{pos["alignment"]},{pos["marginL"]},{pos["marginR"]},{pos["marginV"]},1'

            with open(srt_path, 'r', encoding='utf-8') as f: srt_content = f.read()
            ass_content = self._create_ass_from_srt(srt_content, ass_style)
            
            with open(output_ass_path, 'w', encoding='utf-8') as f: f.write(ass_content)
            return output_ass_path
        except Exception as e:
            print(f"❌ ASS Error: {e}")
            import traceback
            traceback.print_exc()
            return None

    def _parse_ass_style(self, ass_style):
        sub_settings = load_subtitle_settings()
        params = {
            'fontsize': sub_settings["font"]["size"],
            'alignment': sub_settings["position"]["alignment"],
            'marginv': sub_settings["position"]["marginV"],
            'marginl': sub_settings["position"]["marginL"],
            'marginr': sub_settings["position"]["marginR"],
            'back_color': hex_to_ass_color(sub_settings["background"]["color"], sub_settings["background"]["opacity"])
        }
        try:
            parts = ass_style.split(',')
            if len(parts) >= 22:
                params['fontsize'] = int(parts[2])
                params['back_color'] = parts[6]
                params['alignment'] = int(parts[18])
                params['marginl'] = int(parts[19])
                params['marginr'] = int(parts[20])
                params['marginv'] = int(parts[21])
        except: pass
        return params

    def _calculate_box_dimensions(self, text, style_params):
        sub_settings = load_subtitle_settings()
        lines = text.split('\\N')
        line_count = len(lines)
        fontsize = style_params['fontsize']
        line_height = int(fontsize * 1.2)
        
        char_width = fontsize * sub_settings["box"]["charWidth"]
        max_line_length = max(len(line) for line in lines)
        text_width = int(max_line_length * char_width)
        text_height = int(line_count * line_height)
        
        box_width = text_width + (2 * sub_settings["box"]["hPadding"])
        box_height = text_height + (2 * sub_settings["box"]["vPadding"])
        
        res_x, res_y = 1920, 1080
        alignment = style_params['alignment']
        marginl, marginr, marginv = style_params['marginl'], style_params['marginr'], style_params['marginv']

        h_align = ((alignment - 1) % 3) + 1
        if h_align == 1: x1 = marginl
        elif h_align == 2: x1 = (res_x - box_width) // 2
        else: x1 = res_x - marginr - box_width

        v_align = (alignment - 1) // 3
        if v_align == 0: y1 = res_y - marginv - box_height
        elif v_align == 1: y1 = (res_y - box_height) // 2
        else: y1 = marginv

        return {
            'x1': x1, 'y1': y1, 'x2': x1 + box_width, 'y2': y1 + box_height,
            'corner_radius': sub_settings["background"]["cornerRadius"]
        }

    def _create_ass_from_srt(self, srt_content, ass_style):
        header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
"""
        if 'Style: Banner,' in ass_style: ass_style = ass_style.replace('Style: Banner,', 'Style: Default,')
        elif not ass_style.startswith('Style:'): ass_style = 'Style: Default,' + ass_style
        
        header += ass_style + '\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
        
        style_params = self._parse_ass_style(ass_style)
        ass_events = []
        
        for block in srt_content.strip().split('\n\n'):
            lines = block.strip().split('\n')
            if len(lines) < 3: continue
            if '-->' not in lines[1]: continue
            
            start, end = lines[1].split('-->')
            start = self._srt_time_to_ass(start.strip())
            end = self._srt_time_to_ass(end.strip())
            text = '\\N'.join(lines[2:])
            
            box = self._calculate_box_dimensions(text, style_params)
            back_color = style_params['back_color']
            
            if back_color.startswith('&H') and len(back_color) >= 10:
                box_color = f"&H{back_color[4:]}"
                box_alpha = f"&H{back_color[2:4]}"
            else:
                box_color, box_alpha = "&H000000", "&H80"

            r, x1, y1, x2, y2 = box['corner_radius'], box['x1'], box['y1'], box['x2'], box['y2']
            
            drawing_cmd = (
                f"m {x1+r} {y1} l {x2-r} {y1} b {x2} {y1} {x2} {y1} {x2} {y1+r} "
                f"l {x2} {y2-r} b {x2} {y2} {x2} {y2} {x2-r} {y2} "
                f"l {x1+r} {y2} b {x1} {y2} {x1} {y2} {x1} {y2-r} "
                f"l {x1} {y1+r} b {x1} {y1} {x1} {y1} {x1+r} {y1}"
            )
            
            ass_events.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{{\\p1\\an7\\pos(0,0)\\1c{box_color}\\1a{box_alpha}\\3a&HFF&\\bord0\\shad0}}{drawing_cmd}")
            
            text_x, text_y = (x1 + x2) // 2, (y1 + y2) // 2
            ass_events.append(f"Dialogue: 1,{start},{end},Default,,0,0,0,,{{\\an5\\pos({text_x},{text_y})\\bord0\\shad0\\3a&HFF&}}{text}")

        return header + '\n'.join(ass_events)

    # ============================================================================
    # 3. BURN SUBTITLES (NEW GPU LOGIC + SAFE COPY)
    # ============================================================================

    def burn_subtitles(self, video_path, ass_path, output_path, progress_callback=None):
        success = self._run_ffmpeg_burn(video_path, ass_path, output_path, self.gpu_encoder, progress_callback)
        if not success and self.gpu_encoder == 'h264_nvenc':
            print("\n⚠️ GPU Burn failed. Switching to CPU fallback...")
            self.gpu_encoder = 'libx264'
            return self._run_ffmpeg_burn(video_path, ass_path, output_path, 'libx264', progress_callback)
        return success

    def _run_ffmpeg_burn(self, video_path, ass_path, output_path, encoder, progress_callback):
        try:
            print(f"🔥 Burning using {encoder}...")
            
            video_dir = os.path.dirname(os.path.abspath(video_path))
            ass_name = os.path.basename(ass_path)
            dest_ass_path = os.path.join(video_dir, ass_name)
            
            # SAFE COPY
            try:
                if os.path.abspath(ass_path) != os.path.abspath(dest_ass_path):
                    shutil.copy2(ass_path, dest_ass_path)
            except shutil.SameFileError: pass
            except Exception as e: print(f"⚠️ Copy warning: {e}")
            
            cmd = ['ffmpeg', '-y', '-i', video_path]
            
            if encoder == 'h264_nvenc':
                cmd.extend([
                    '-vf', f"subtitles={ass_name}",
                    '-c:v', 'h264_nvenc',
                    '-preset', 'fast',
                    '-b:v', '5M',
                    '-pix_fmt', 'yuv420p'
                ])
            else:
                cmd.extend([
                    '-vf', f"subtitles={ass_name}",
                    '-c:v', 'libx264',
                    '-preset', 'medium',
                    '-crf', '23',
                    '-pix_fmt', 'yuv420p'
                ])
                
            cmd.extend(['-c:a', 'copy', '-progress', 'pipe:1', output_path])
            
            process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True, bufsize=1, cwd=video_dir)
            for line in process.stdout: pass 
            process.wait()
            return process.returncode == 0
            
        except Exception as e:
            print(f"❌ Burn Error: {e}")
            return False

    def create_video_with_subtitles(self, image_path, audio_path, output_path, ass_style=None, progress_callback=None, event_loop=None):
        try:
            print("🎬 Starting Pipeline...")
            temp_video = output_path.replace('.mp4', '_temp.mp4')
            srt_path = output_path.replace('.mp4', '.srt')
            ass_path = output_path.replace('.mp4', '.ass')
            
            if not self.create_video_from_image_audio(image_path, audio_path, temp_video, progress_callback): return None
            if not self.generate_subtitles_whisper(audio_path, srt_path): return None
            if not self.convert_srt_to_ass(srt_path, ass_style, ass_path): return None
            if not self.burn_subtitles(temp_video, ass_path, output_path, progress_callback): return None
                
            for f in [temp_video, srt_path, ass_path]:
                if os.path.exists(f): os.remove(f)
            return output_path
        except Exception as e:
            print(f"❌ Pipeline Error: {e}")
            return None