#!/usr/bin/env python3
"""
AI Image Generator
Uses Gemini to analyze script and Pollinations.ai to generate images

Flow:
1. Script -> Gemini -> Image generation prompt
2. Image prompt -> Pollinations.ai -> Generated image
"""

import os
import requests
from typing import Optional, List
from urllib.parse import quote

# Google Generative AI (for text generation)
try:
    import google.generativeai as genai
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False
    print("⚠️ google-generativeai not installed. Run: pip install google-generativeai")


# Configure API
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
FILE_SERVER_URL = os.getenv("FILE_SERVER_URL", "http://38.242.144.132:8000")

if GEMINI_API_KEY and GENAI_AVAILABLE:
    genai.configure(api_key=GEMINI_API_KEY)


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


def generate_image_with_nebius(prompt: str, output_path: str, max_retries: int = 3, width: int = 1920, height: int = 1080) -> bool:
    """
    Generate image using Nebius API (Flux model)

    Args:
        prompt: Image generation prompt
        output_path: Path to save the generated image
        max_retries: Number of retry attempts
        width: Image width (default 1920 for landscape)
        height: Image height (default 1080 for landscape)

    Returns:
        True if successful, False otherwise
    """
    import base64

    NEBIUS_API_KEY = os.getenv("NEBIUS_API_KEY")
    if not NEBIUS_API_KEY:
        print("❌ NEBIUS_API_KEY not set")
        return False

    print(f"🎨 Generating image with Nebius (Flux) - {width}x{height}...")
    print(f"   Prompt: {prompt[:80]}...")

    try:
        from openai import OpenAI

        client = OpenAI(
            base_url="https://api.tokenfactory.nebius.com/v1/",
            api_key=NEBIUS_API_KEY
        )

        for attempt in range(max_retries):
            try:
                print(f"   Attempt {attempt + 1}/{max_retries} - Generating with Flux...")

                response = client.images.generate(
                    model="black-forest-labs/flux-dev",
                    response_format="b64_json",
                    extra_body={
                        "response_extension": "png",
                        "width": width,
                        "height": height,
                        "num_inference_steps": 28,
                        "negative_prompt": "",
                        "seed": -1
                    },
                    prompt=prompt
                )

                if response.data and len(response.data) > 0:
                    # Decode base64 image
                    image_data = base64.b64decode(response.data[0].b64_json)

                    # Save the image
                    with open(output_path, 'wb') as f:
                        f.write(image_data)

                    # Convert to JPEG if needed
                    try:
                        from PIL import Image
                        img = Image.open(output_path)
                        if img.mode == 'RGBA':
                            img = img.convert('RGB')
                        img.save(output_path, "JPEG", quality=95)
                        print(f"✅ Image saved ({width}x{height}): {output_path}")
                    except ImportError:
                        print(f"✅ Image saved (PNG): {output_path}")

                    return True
                else:
                    print(f"   ⚠️ No image data in response")

            except Exception as e:
                print(f"   ⚠️ Attempt {attempt + 1} error: {e}")

            if attempt < max_retries - 1:
                import time
                print(f"   Retrying in 5 seconds...")
                time.sleep(5)

        print("   ❌ All attempts failed")
        return False

    except ImportError:
        print("❌ openai package not installed. Run: pip install openai")
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
    print(f"🤖 AI IMAGE GENERATION (Nebius Flux) - {'SHORTS 1080x1920' if is_shorts else '1920x1080'}")
    print("="*50)

    # Step 1: Analyze script and get image prompt using Gemini
    image_prompt = analyze_script_for_image(script_text)

    if not image_prompt:
        print("❌ Failed to generate image prompt")
        return False

    # Step 2: Generate image with Nebius (Flux model)
    success = generate_image_with_nebius(image_prompt, output_path, width=width, height=height)

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
    Generate multiple AI images with Archangel Michael theme

    Args:
        script_text: Script (not used, kept for compatibility)
        output_dir: Directory to save images
        count: Number of images to generate
        width: Image width
        height: Image height

    Returns:
        List of generated image paths
    """
    import time
    import random

    is_shorts = width == 1080 and height == 1920
    print("\n" + "="*50)
    print(f"🤖 ARCHANGEL MICHAEL IMAGES - {count} images ({'SHORTS' if is_shorts else 'LANDSCAPE'})")
    print("="*50)

    # Get Archangel Michael prompts from Gemini
    prompts = analyze_script_for_multiple_images("", count)

    if not prompts:
        print("❌ Failed to get prompts from Gemini")
        return []

    # Generate each image
    generated_paths = []
    for i, prompt in enumerate(prompts):
        output_path = os.path.join(output_dir, f"ai_image_{i+1}.jpg")
        print(f"\n📸 Generating image {i+1}/{count}...")
        print(f"   Prompt: {prompt[:60]}...")

        success = generate_image_with_nebius(prompt, output_path, width=width, height=height)

        if success:
            generated_paths.append(output_path)
        else:
            print(f"   ⚠️ Failed to generate image {i+1}")

        # Small delay between requests
        if i < len(prompts) - 1:
            time.sleep(2)

    print(f"\n✅ Generated {len(generated_paths)}/{count} images")
    print("="*50 + "\n")

    return generated_paths


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
