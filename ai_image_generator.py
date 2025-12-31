#!/usr/bin/env python3
"""
AI Image Generator
Uses Gemini to generate scene prompts and FLUX.1-schnell for image generation

Flow:
1. Script -> Gemini -> Scene image prompt (every 12 sec)
2. Image prompt -> FLUX.1-schnell (local GPU) -> Generated image
"""

import os
import requests
import random
from typing import Optional, List

# FLUX model (loaded lazily)
FLUX_PIPE = None
FLUX_AVAILABLE = False

def load_flux_model():
    """Load FLUX.1-schnell model lazily (same as vast_ai_image_generator.py)"""
    global FLUX_PIPE, FLUX_AVAILABLE
    if FLUX_PIPE is not None:
        return FLUX_PIPE

    try:
        import torch
        from diffusers import FluxPipeline
        from huggingface_hub import login

        print("🔄 Loading FLUX.1-schnell model...")

        # HF Token from environment
        HF_TOKEN = os.getenv("HF_TOKEN")
        if HF_TOKEN:
            login(token=HF_TOKEN)
            print("   ✓ HuggingFace authenticated")

        # Load FLUX.1-schnell (same as vast_ai_image_generator.py)
        FLUX_PIPE = FluxPipeline.from_pretrained(
            "black-forest-labs/FLUX.1-schnell",
            torch_dtype=torch.bfloat16
        )

        # Memory optimization for 24GB VRAM (exact same as vast_ai_image_generator.py)
        print("   ✓ Enabling memory optimizations...")
        FLUX_PIPE.enable_model_cpu_offload()
        FLUX_PIPE.enable_attention_slicing()
        FLUX_PIPE.enable_vae_slicing()
        FLUX_PIPE.vae.enable_tiling()

        FLUX_AVAILABLE = True
        print("✅ FLUX.1-schnell loaded successfully!")
        return FLUX_PIPE
    except Exception as e:
        print(f"❌ Failed to load FLUX: {e}")
        FLUX_AVAILABLE = False
        return None


# Configure API
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
FILE_SERVER_URL = os.getenv("FILE_SERVER_URL", "http://38.242.144.132:8000")


def get_gemini_model_from_settings() -> str:
    """Fetch Gemini model name from settings API"""
    try:
        webapp_url = FILE_SERVER_URL.replace(":8000", ":3000")
        api_url = f"{webapp_url}/api/settings"
        response = requests.get(api_url, timeout=5)
        if response.status_code == 200:
            data = response.json()
            model = data.get("ai", {}).get("model", "gemini-2.0-flash-exp")
            print(f"📝 Using Gemini model from settings: {model}")
            return model
    except Exception as e:
        print(f"⚠️ Could not fetch settings, using default model: {e}")
    return "gemini-2.0-flash-exp"


# Image Analysis Prompt for Gemini
IMAGE_ANALYSIS_PROMPT = """Analyze the following script/text and generate a SINGLE image generation prompt.

The image should:
1. Capture the main theme/mood of the content
2. Be suitable as a background for a video with subtitles
3. Be visually appealing, cinematic, and high quality
4. NOT contain any text, words, or letters

Output ONLY the image prompt in English, nothing else. Keep it under 200 words.
Focus on: atmosphere, lighting, colors, setting, artistic style.

Script:
{script}

Image prompt:"""


def analyze_script_for_image(script_text: str, max_chars: int = 3000) -> Optional[str]:
    """
    Analyze script using Gemini REST API and generate an image prompt

    Args:
        script_text: The script to analyze
        max_chars: Maximum characters to send (truncate if longer)

    Returns:
        Image generation prompt or None if failed
    """
    if not GEMINI_API_KEY:
        print("❌ GEMINI_API_KEY not set")
        return None

    # Get model from settings, with fallbacks
    settings_model = get_gemini_model_from_settings()
    models_to_try = [settings_model, 'gemini-2.0-flash-exp', 'gemini-1.5-flash']
    # Remove duplicates while preserving order
    models_to_try = list(dict.fromkeys(models_to_try))

    # Truncate script if too long
    truncated_script = script_text[:max_chars] if len(script_text) > max_chars else script_text
    prompt = IMAGE_ANALYSIS_PROMPT.format(script=truncated_script)

    for model_name in models_to_try:
        try:
            print(f"🧠 Trying {model_name}...")

            # Use REST API directly (same as main page)
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={GEMINI_API_KEY}"

            response = requests.post(url, json={
                "contents": [{
                    "parts": [{
                        "text": prompt
                    }]
                }],
                "generationConfig": {
                    "temperature": 0.7,
                    "maxOutputTokens": 500,
                    "thinkingConfig": {
                        "thinkingBudget": 0  # Disable thinking for Gemini 2.5 Flash
                    }
                }
            }, timeout=60)

            if response.status_code == 200:
                data = response.json()

                # Check for blocked content
                if data.get("candidates", [{}])[0].get("finishReason") == "SAFETY":
                    print(f"   ⚠️ Blocked by safety, trying next model...")
                    continue

                # Get text from response
                text = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "").strip()
                if text:
                    print(f"✅ Image prompt generated with {model_name}: {text[:100]}...")
                    return text
                else:
                    print(f"   ⚠️ Empty response from {model_name}")
            else:
                print(f"   ⚠️ {model_name} HTTP {response.status_code}: {response.text[:100]}")

        except Exception as e:
            print(f"   ⚠️ {model_name} failed: {e}")
            continue

    print("❌ All models failed to generate image prompt")
    return None


def generate_image_with_flux(prompt: str, output_path: str, max_retries: int = 3, width: int = 1920, height: int = 1080) -> bool:
    """
    Generate image using vast_ai_image_generator.py as subprocess (guaranteed to work)
    """
    import subprocess
    import json

    print(f"🎨 Generating image via subprocess - {width}x{height}...")
    print(f"   Prompt: {prompt[:80]}...")

    # Escape prompt for Python string
    escaped_prompt = prompt.replace('\\', '\\\\').replace('"', '\\"').replace('\n', ' ')
    hf_token = os.getenv("HF_TOKEN", "")

    # Create a temp script that generates one image
    script_content = '''
import sys
sys.path.insert(0, "/workspace")
import torch
import random
from diffusers import FluxPipeline
from huggingface_hub import login

# HF Token
HF_TOKEN = "''' + hf_token + '''"
if HF_TOKEN:
    login(token=HF_TOKEN)

print("Loading FLUX.1-schnell...")
pipe = FluxPipeline.from_pretrained(
    "black-forest-labs/FLUX.1-schnell",
    torch_dtype=torch.bfloat16
)
pipe.enable_model_cpu_offload()
pipe.enable_attention_slicing()
pipe.enable_vae_slicing()
pipe.vae.enable_tiling()
print("Model loaded!")

seed = random.randint(0, 2**32 - 1)
generator = torch.Generator("cuda").manual_seed(seed)

prompt = "''' + escaped_prompt + '''"

image = pipe(
    prompt=prompt,
    num_inference_steps=4,
    guidance_scale=0.0,
    height=''' + str(height) + ''',
    width=''' + str(width) + ''',
    generator=generator
).images[0]

image.save("''' + output_path + '''", "JPEG", quality=95, optimize=True)
print("Image saved!")
'''

    # Write temp script
    script_path = "/tmp/flux_gen_temp.py"
    with open(script_path, "w") as f:
        f.write(script_content)

    for attempt in range(max_retries):
        try:
            print(f"   Attempt {attempt + 1}/{max_retries} - Running subprocess...")

            result = subprocess.run(
                ["python3", script_path],
                capture_output=True,
                text=True,
                timeout=300
            )

            if result.returncode == 0 and os.path.exists(output_path):
                print(f"✅ Image saved: {output_path}")
                return True
            else:
                # Show both stdout and stderr for debugging
                if result.stdout:
                    print(f"   stdout: {result.stdout[-500:]}")
                if result.stderr:
                    print(f"   stderr: {result.stderr[-500:]}")
                print(f"   ⚠️ Subprocess failed (code {result.returncode})")

        except subprocess.TimeoutExpired:
            print(f"   ⚠️ Timeout after 5 minutes")
        except Exception as e:
            print(f"   ⚠️ Error: {e}")

        if attempt < max_retries - 1:
            import time
            print(f"   Retrying in 3 seconds...")
            time.sleep(3)

    print("   ❌ All attempts failed")
    return False


def generate_ai_image(script_text: str, output_path: str, width: int = 1920, height: int = 1080) -> bool:
    """
    Main function: Analyze script and generate AI image

    Args:
        script_text: The script to analyze
        output_path: Path to save the generated image
        width: Image width (default 1920 for landscape, use 1080 for shorts)
        height: Image height (default 1080 for landscape, use 1920 for shorts)

    Returns:
        True if successful, False otherwise
    """
    is_shorts = width == 1080 and height == 1920
    print("\n" + "="*50)
    print(f"🤖 AI IMAGE GENERATION (FLUX.1-schnell) - {'SHORTS 1080x1920' if is_shorts else '1920x1080'}")
    print("="*50)

    # Step 1: Analyze script and get image prompt using Gemini
    image_prompt = analyze_script_for_image(script_text)

    if not image_prompt:
        print("❌ Failed to generate image prompt")
        return False

    # Step 2: Generate image with FLUX.1-schnell (local GPU)
    success = generate_image_with_flux(image_prompt, output_path, width=width, height=height)

    if success:
        print("✅ AI image generation complete!")
    else:
        print("❌ AI image generation failed")

    print("="*50 + "\n")

    return success


# Archangel Michael prompt for Gemini
ARCHANGEL_PROMPT = """Generate {count} DIFFERENT and UNIQUE image prompts featuring Archangel Michael.

Each prompt must:
1. Feature Archangel Michael as the main subject
2. Have DIFFERENT poses, settings, lighting, and moods
3. Be suitable as a cinematic video background
4. NOT contain any text or letters
5. Be highly detailed and visually stunning

Vary these elements across prompts:
- Poses: standing, flying, fighting, meditating, protecting, descending, ascending
- Settings: heaven, clouds, mountains, ancient temples, cosmic space, battlefields, gardens
- Lighting: golden hour, moonlight, divine rays, aurora, sunrise, dramatic shadows
- Armor: golden, silver, white, crystalline, ancient, radiant
- Wings: spread wide, folded, glowing, feathered, ethereal
- Mood: powerful, peaceful, fierce, serene, majestic, mysterious

Output EXACTLY {count} prompts, one per line, numbered 1-{count}.
Each prompt should be 50-100 words.

Image prompts:"""


def analyze_script_for_multiple_images(script_text: str, count: int, max_chars: int = 3000) -> List[str]:
    """
    Generate multiple Archangel Michael image prompts using Gemini

    Args:
        script_text: Not used (kept for compatibility)
        count: Number of image prompts to generate
        max_chars: Not used

    Returns:
        List of image prompts or empty list if failed
    """
    if not GEMINI_API_KEY:
        print("❌ GEMINI_API_KEY not set")
        return []

    settings_model = get_gemini_model_from_settings()
    models_to_try = [settings_model, 'gemini-2.0-flash-exp', 'gemini-1.5-flash']
    models_to_try = list(dict.fromkeys(models_to_try))

    # Use Archangel Michael prompt instead of script analysis
    prompt = ARCHANGEL_PROMPT.format(count=count)

    for model_name in models_to_try:
        try:
            print(f"🧠 Generating {count} Archangel Michael prompts with {model_name}...")

            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={GEMINI_API_KEY}"

            response = requests.post(url, json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.9,  # Higher for more variety
                    "maxOutputTokens": 2000,
                    "thinkingConfig": {"thinkingBudget": 0}
                }
            }, timeout=90)

            if response.status_code == 200:
                data = response.json()

                if data.get("candidates", [{}])[0].get("finishReason") == "SAFETY":
                    print(f"   ⚠️ Blocked by safety, trying next model...")
                    continue

                text = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "").strip()
                if text:
                    # Parse numbered prompts
                    prompts = []
                    lines = text.split('\n')
                    for line in lines:
                        line = line.strip()
                        # Remove numbering like "1.", "1)", "1:"
                        if line and line[0].isdigit():
                            # Find where the actual prompt starts
                            for i, char in enumerate(line):
                                if char in '.):' and i < 3:
                                    line = line[i+1:].strip()
                                    break
                        if line and len(line) > 20:  # Valid prompt
                            prompts.append(line)

                    if len(prompts) >= count:
                        print(f"✅ Generated {len(prompts)} image prompts")
                        return prompts[:count]
                    elif prompts:
                        print(f"⚠️ Got {len(prompts)} prompts, needed {count}. Using what we have.")
                        # Repeat prompts if needed
                        while len(prompts) < count:
                            prompts.append(prompts[len(prompts) % len(prompts)])
                        return prompts

            print(f"   ⚠️ {model_name} failed")

        except Exception as e:
            print(f"   ⚠️ {model_name} error: {e}")
            continue

    print("❌ All models failed")
    return []


def generate_multiple_ai_images(script_text: str, output_dir: str, count: int,
                                 width: int = 1920, height: int = 1080) -> List[str]:
    """
    Generate multiple AI images - uses Gemini 2.5 Pro for scene prompts, FLUX for generation.
    Each image gets a unique scene prompt based on the script content.

    Args:
        script_text: Script to analyze for scene prompts
        output_dir: Directory to save images
        count: Number of images to generate
        width: Image width
        height: Image height

    Returns:
        List of generated image paths
    """
    import time

    is_shorts = width == 1080 and height == 1920
    print("\n" + "="*50)
    print(f"🤖 AI SCENE IMAGES (FLUX.1-schnell) - {count} images ({'SHORTS' if is_shorts else 'LANDSCAPE'})")
    print("="*50)

    # Generate scene prompts using Gemini 2.5 Pro
    prompts = generate_scene_prompts(script_text, count)

    if not prompts:
        print("❌ Failed to get scene prompts from Gemini")
        return []

    # Generate each image with FLUX
    generated_paths = []
    for i, prompt in enumerate(prompts):
        output_path = os.path.join(output_dir, f"ai_image_{i+1}.jpg")
        print(f"\n📸 Generating scene {i+1}/{count}...")
        print(f"   Prompt: {prompt[:60]}...")

        success = generate_image_with_flux(prompt, output_path, width=width, height=height)

        if success:
            generated_paths.append(output_path)
        else:
            print(f"   ⚠️ Failed to generate image {i+1}")

        # Small delay between generations (GPU memory)
        if i < len(prompts) - 1:
            time.sleep(1)

    print(f"\n✅ Generated {len(generated_paths)}/{count} images")
    print("="*50 + "\n")

    return generated_paths


# ============================================================================
# SCENE PROMPT GENERATION (Gemini 3 Pro - Chunk-based)
# ============================================================================

CHUNK_SCENE_PROMPT = """Analyze this script segment and generate ONE vivid visual scene description.

Script segment:
{chunk}

Create a cinematic image prompt that:
1. Captures the emotion and theme of these sentences
2. Is suitable as a video background (no text, no letters)
3. Includes: setting, lighting, atmosphere, colors, artistic style
4. Is 50-80 words
5. If spiritual/religious content: include divine elements, heavenly imagery

Output ONLY the image prompt, nothing else.

Image prompt:"""


def split_script_into_chunks(script_text: str, num_chunks: int) -> List[str]:
    """
    Split script into equal chunks for scene generation.
    Each chunk represents ~12 seconds of video content.
    """
    # Clean and split into sentences
    import re
    sentences = re.split(r'(?<=[।.!?])\s+', script_text.strip())
    sentences = [s.strip() for s in sentences if s.strip()]

    if not sentences:
        return [script_text] * num_chunks

    # Distribute sentences across chunks
    chunks = []
    sentences_per_chunk = max(1, len(sentences) // num_chunks)

    for i in range(num_chunks):
        start_idx = i * sentences_per_chunk
        if i == num_chunks - 1:
            # Last chunk gets remaining sentences
            chunk_sentences = sentences[start_idx:]
        else:
            chunk_sentences = sentences[start_idx:start_idx + sentences_per_chunk]

        if chunk_sentences:
            chunks.append(' '.join(chunk_sentences))
        else:
            # If no sentences left, repeat last chunk
            chunks.append(chunks[-1] if chunks else script_text[:500])

    return chunks


def generate_scene_prompt_for_chunk(chunk_text: str, chunk_num: int, total_chunks: int) -> Optional[str]:
    """
    Generate a single scene prompt for a script chunk using Gemini 3 Pro.
    """
    if not GEMINI_API_KEY:
        print("      ❌ GEMINI_API_KEY not set")
        return None

    # Use Gemini 3 Pro (latest and best), fallback to 2.5
    models_to_try = ['gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro']

    prompt = CHUNK_SCENE_PROMPT.format(chunk=chunk_text[:1000])  # Limit chunk size

    for model_name in models_to_try:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={GEMINI_API_KEY}"

            response = requests.post(url, json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.8,
                    "maxOutputTokens": 300
                }
            }, timeout=30)

            if response.status_code == 200:
                data = response.json()

                if data.get("candidates", [{}])[0].get("finishReason") == "SAFETY":
                    print(f"      ⚠️ {model_name}: blocked by safety")
                    continue

                text = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "").strip()
                if text and len(text) > 20:
                    return text
            else:
                try:
                    error_msg = response.json().get("error", {}).get("message", "")[:100]
                except:
                    error_msg = response.text[:100]
                print(f"      ⚠️ {model_name}: HTTP {response.status_code} - {error_msg}")

        except Exception as e:
            print(f"      ⚠️ {model_name}: {e}")
            continue

    return None


def generate_scene_prompts(script_text: str, count: int) -> List[str]:
    """
    Generate scene-based image prompts using Gemini 2.5 Pro.
    Splits script into chunks and generates prompt for each chunk separately.
    """
    if not GEMINI_API_KEY:
        print("❌ GEMINI_API_KEY not set")
        return []

    print(f"🧠 Generating {count} scene prompts (chunk-based, Gemini 3 Pro)...")

    # Split script into chunks
    chunks = split_script_into_chunks(script_text, count)
    print(f"   📝 Split script into {len(chunks)} chunks")

    prompts = []
    for i, chunk in enumerate(chunks):
        print(f"   🎬 Scene {i+1}/{count}: analyzing chunk...")

        scene_prompt = generate_scene_prompt_for_chunk(chunk, i+1, count)

        if scene_prompt:
            prompts.append(scene_prompt)
            print(f"      ✓ {scene_prompt[:50]}...")
        else:
            # Fallback: use a generic spiritual scene
            fallback = "Divine heavenly scene with golden light rays, ethereal clouds, peaceful atmosphere, cinematic lighting, spiritual imagery, 8K quality"
            prompts.append(fallback)
            print(f"      ⚠️ Using fallback prompt")

    print(f"✅ Generated {len(prompts)} scene prompts")
    return prompts


# For testing
if __name__ == "__main__":
    test_script = """
    The universe is vast and mysterious. Stars are born in nebulae,
    living for billions of years before dying in spectacular supernovas.
    Black holes lurk at the center of galaxies, their gravity so intense
    that even light cannot escape. We are made of stardust, connected
    to the cosmos in ways we are only beginning to understand.
    """

    output = "/tmp/test_ai_image.jpg"

    if generate_ai_image(test_script, output):
        print(f"Test image saved to: {output}")
    else:
        print("Test failed")
