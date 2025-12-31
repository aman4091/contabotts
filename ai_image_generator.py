#!/usr/bin/env python3
"""
AI Image Generator
Uses Gemini to generate scene prompts and Replicate API for FLUX.1-schnell image generation

Flow:
1. Script -> Gemini -> Scene image prompt (every 12 sec)
2. Image prompt -> Replicate API (FLUX.1-schnell) -> Generated image
"""

import os
import requests
import random
from typing import Optional, List

# Configure API
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
REPLICATE_API_TOKEN = os.getenv("REPLICATE_API_TOKEN")
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


def apply_vignette(image_path: str, strength: float = 0.4):
    """Apply vignette effect to image file"""
    import numpy as np
    from PIL import Image

    image = Image.open(image_path)
    img_array = np.array(image, dtype=np.float32)
    rows, cols = img_array.shape[:2]

    # Create vignette mask
    X = np.arange(0, cols)
    Y = np.arange(0, rows)
    X, Y = np.meshgrid(X, Y)

    center_x, center_y = cols / 2, rows / 2

    # Distance from center (normalized)
    dist = np.sqrt((X - center_x) ** 2 + (Y - center_y) ** 2)
    max_dist = np.sqrt(center_x ** 2 + center_y ** 2)
    dist = dist / max_dist

    # Vignette formula (smooth falloff)
    vignette = 1 - (dist ** 2) * strength
    vignette = np.clip(vignette, 0, 1)

    # Apply to all channels
    if len(img_array.shape) == 3:
        vignette = np.dstack([vignette] * img_array.shape[2])

    vignetted = img_array * vignette
    vignetted = np.clip(vignetted, 0, 255).astype(np.uint8)

    # Save back
    result = Image.fromarray(vignetted)
    result.save(image_path, "JPEG", quality=95, optimize=True)
    return True


def generate_image_with_flux(prompt: str, output_path: str, max_retries: int = 3, width: int = 1920, height: int = 1080) -> bool:
    """
    Generate image using Replicate API (FLUX.1-schnell)
    No GPU needed - runs on Replicate's servers
    """
    import time

    if not REPLICATE_API_TOKEN:
        print("❌ REPLICATE_API_TOKEN not set")
        return False

    # Replicate aspect ratios
    if width > height:
        aspect_ratio = "16:9"  # Landscape
    elif height > width:
        aspect_ratio = "9:16"  # Portrait/Shorts
    else:
        aspect_ratio = "1:1"  # Square

    print(f"🎨 Generating image via Replicate API ({aspect_ratio})...")
    print(f"   Prompt: {prompt[:80]}...")

    headers = {
        "Authorization": f"Bearer {REPLICATE_API_TOKEN}",
        "Content-Type": "application/json",
        "Prefer": "wait"  # Wait for result
    }

    for attempt in range(max_retries):
        try:
            print(f"   Attempt {attempt + 1}/{max_retries} - Calling Replicate API...")

            # Create prediction
            response = requests.post(
                "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",
                headers=headers,
                json={
                    "input": {
                        "prompt": prompt,
                        "aspect_ratio": aspect_ratio,
                        "num_outputs": 1,
                        "output_format": "jpg",
                        "output_quality": 95
                    }
                },
                timeout=120
            )

            if response.status_code in [200, 201]:
                data = response.json()

                # Check if completed
                if data.get("status") == "succeeded" and data.get("output"):
                    image_url = data["output"][0] if isinstance(data["output"], list) else data["output"]

                    # Download image
                    print(f"   Downloading image...")
                    img_response = requests.get(image_url, timeout=60)
                    if img_response.status_code == 200:
                        with open(output_path, "wb") as f:
                            f.write(img_response.content)

                        # Apply vignette effect
                        print(f"   Applying vignette effect...")
                        apply_vignette(output_path, strength=0.4)

                        print(f"✅ Image saved: {output_path}")
                        return True

                # If still processing, poll for result
                elif data.get("status") in ["starting", "processing"]:
                    prediction_url = data.get("urls", {}).get("get") or f"https://api.replicate.com/v1/predictions/{data['id']}"

                    for _ in range(60):  # Wait up to 60 seconds
                        time.sleep(1)
                        poll_response = requests.get(prediction_url, headers=headers, timeout=30)
                        if poll_response.status_code == 200:
                            poll_data = poll_response.json()
                            if poll_data.get("status") == "succeeded" and poll_data.get("output"):
                                image_url = poll_data["output"][0] if isinstance(poll_data["output"], list) else poll_data["output"]

                                img_response = requests.get(image_url, timeout=60)
                                if img_response.status_code == 200:
                                    with open(output_path, "wb") as f:
                                        f.write(img_response.content)

                                    apply_vignette(output_path, strength=0.4)
                                    print(f"✅ Image saved: {output_path}")
                                    return True
                            elif poll_data.get("status") == "failed":
                                print(f"   ⚠️ Prediction failed: {poll_data.get('error', 'Unknown error')}")
                                break

                print(f"   ⚠️ Unexpected response: {data.get('status', 'unknown')}")

            else:
                print(f"   ⚠️ API error {response.status_code}: {response.text[:200]}")

        except Exception as e:
            print(f"   ⚠️ Attempt {attempt + 1} error: {e}")

        if attempt < max_retries - 1:
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
    print(f"🤖 AI IMAGE GENERATION (Replicate API) - {'SHORTS 9:16' if is_shorts else '16:9'}")
    print("="*50)

    # Step 1: Analyze script and get image prompt using Gemini
    image_prompt = analyze_script_for_image(script_text)

    if not image_prompt:
        print("❌ Failed to generate image prompt")
        return False

    # Step 2: Generate image with Replicate API (FLUX.1-schnell)
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
    Generate multiple AI images - STREAMING pipeline!
    As soon as a prompt is ready, image generation starts in background.
    """
    from queue import Queue
    import threading

    print("\n" + "="*50)
    print(f"🤖 AI SCENE IMAGES (STREAMING PIPELINE) - {count} images")
    print("="*50)

    # Split script into chunks
    chunks = split_script_into_chunks(script_text, count)
    print(f"   📝 Split script into {len(chunks)} chunks")

    generated_paths = [None] * count
    fallback_prompt = "Divine heavenly scene with golden light rays, ethereal clouds, peaceful atmosphere, cinematic lighting, spiritual imagery, 8K quality"

    # Queue for passing prompts from generator to image creator
    prompt_queue = Queue()
    prompts_done = threading.Event()

    def prompt_generator():
        """Generate prompts and add to queue as they're ready"""
        for idx, chunk in enumerate(chunks):
            prompt = generate_scene_prompt_for_chunk(chunk, idx+1, count)
            if not prompt:
                prompt = fallback_prompt
            prompt_queue.put((idx, prompt))
            print(f"   🎬 [{idx+1}/{count}] Prompt ready")
        prompts_done.set()

    def image_generator():
        """Pull prompts from queue and generate images"""
        while True:
            try:
                # Wait for prompt with timeout
                idx, prompt = prompt_queue.get(timeout=2)
                output_path = os.path.join(output_dir, f"ai_image_{idx+1}.jpg")
                print(f"   📸 [{idx+1}/{count}] Image starting...")

                success = generate_image_with_flux(prompt, output_path, width=width, height=height, max_retries=2)
                if success:
                    generated_paths[idx] = output_path
                    print(f"   ✅ [{idx+1}/{count}] Image done!")
                else:
                    print(f"   ⚠️ [{idx+1}/{count}] Image failed")

                prompt_queue.task_done()
            except:
                # Queue empty and prompts done
                if prompts_done.is_set() and prompt_queue.empty():
                    break

    # Start prompt generator thread
    prompt_thread = threading.Thread(target=prompt_generator)
    prompt_thread.start()

    # Start multiple image generator threads (4 parallel)
    image_threads = []
    for _ in range(4):
        t = threading.Thread(target=image_generator)
        t.start()
        image_threads.append(t)

    # Wait for all to complete
    prompt_thread.join()
    prompt_queue.join()  # Wait for all images to finish

    # Signal image threads to stop
    for t in image_threads:
        t.join(timeout=5)

    # Filter out None values
    final_paths = [p for p in generated_paths if p is not None]

    print(f"\n✅ Generated {len(final_paths)}/{count} images")
    print("="*50 + "\n")

    return final_paths


def generate_scene_prompts_parallel(script_text: str, count: int) -> List[str]:
    """
    Generate scene prompts in PARALLEL for speed!
    Uses Gemini 2.5 Pro with DeepSeek fallback.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    if not GEMINI_API_KEY and not DEEPSEEK_API_KEY:
        print("❌ Neither GEMINI_API_KEY nor DEEPSEEK_API_KEY set")
        return []

    print(f"🧠 Generating {count} scene prompts (PARALLEL - Gemini 2.5 + DeepSeek fallback)...")

    # Split script into chunks
    chunks = split_script_into_chunks(script_text, count)
    print(f"   📝 Split script into {len(chunks)} chunks")

    prompts = [None] * len(chunks)  # Preserve order
    fallback = "Divine heavenly scene with golden light rays, ethereal clouds, peaceful atmosphere, cinematic lighting, spiritual imagery, 8K quality"

    def generate_single_prompt(args):
        idx, chunk = args
        result = generate_scene_prompt_for_chunk(chunk, idx+1, count)
        return idx, result if result else fallback

    # Parallel prompt generation (max 2 concurrent - Gemini rate limits)
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = {executor.submit(generate_single_prompt, (i, c)): i for i, c in enumerate(chunks)}

        for future in as_completed(futures):
            try:
                idx, prompt = future.result()
                prompts[idx] = prompt
                print(f"   🎬 [{idx+1}/{count}] ✓ {prompt[:40]}...")
            except Exception as e:
                prompts[futures[future]] = fallback
                print(f"   ⚠️ Error, using fallback")

    print(f"✅ Generated {len([p for p in prompts if p])} prompts")
    return prompts


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
    Generate a single scene prompt for a script chunk.
    Uses Gemini 2.5 Pro first, then falls back to DeepSeek.
    """
    prompt = CHUNK_SCENE_PROMPT.format(chunk=chunk_text[:1000])  # Limit chunk size

    # Try Gemini 3 Flash first (fast + cheap), fallback to 2.5 Flash
    if GEMINI_API_KEY:
        models_to_try = ['gemini-3-flash-preview', 'gemini-2.5-flash']

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
                elif response.status_code == 429:
                    print(f"      ⚠️ {model_name}: quota exceeded, trying DeepSeek...")
                    break  # Exit Gemini loop, try DeepSeek
                else:
                    try:
                        error_msg = response.json().get("error", {}).get("message", "")[:100]
                    except:
                        error_msg = response.text[:100]
                    print(f"      ⚠️ {model_name}: HTTP {response.status_code} - {error_msg}")

            except Exception as e:
                print(f"      ⚠️ {model_name}: {e}")
                continue

    # Fallback to DeepSeek
    if DEEPSEEK_API_KEY:
        try:
            response = requests.post(
                "https://api.deepseek.com/chat/completions",
                headers={
                    "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "deepseek-chat",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.8,
                    "max_tokens": 300
                },
                timeout=30
            )

            if response.status_code == 200:
                data = response.json()
                text = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
                if text and len(text) > 20:
                    print(f"      ✓ DeepSeek fallback success")
                    return text
            else:
                print(f"      ⚠️ DeepSeek: HTTP {response.status_code}")
        except Exception as e:
            print(f"      ⚠️ DeepSeek: {e}")

    return None


def generate_scene_prompts(script_text: str, count: int) -> List[str]:
    """
    Generate scene-based image prompts using Gemini 2.5 Pro (fallback: DeepSeek).
    Splits script into chunks and generates prompt for each chunk separately.
    """
    if not GEMINI_API_KEY and not DEEPSEEK_API_KEY:
        print("❌ Neither GEMINI_API_KEY nor DEEPSEEK_API_KEY set")
        return []

    print(f"🧠 Generating {count} scene prompts (chunk-based, Gemini 2.5 Pro + DeepSeek fallback)...")

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
