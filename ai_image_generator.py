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
from typing import Optional
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
    Analyze script using Gemini and generate an image prompt

    Args:
        script_text: The script to analyze
        max_chars: Maximum characters to send (truncate if longer)

    Returns:
        Image generation prompt or None if failed
    """
    if not GENAI_AVAILABLE:
        print("❌ google-generativeai not available")
        return None

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
            model = genai.GenerativeModel(model_name)

            response = model.generate_content(
                prompt,
                generation_config={
                    "temperature": 0.7,
                    "max_output_tokens": 500,
                },
                safety_settings={
                    "HARM_CATEGORY_HARASSMENT": "BLOCK_NONE",
                    "HARM_CATEGORY_HATE_SPEECH": "BLOCK_NONE",
                    "HARM_CATEGORY_SEXUALLY_EXPLICIT": "BLOCK_NONE",
                    "HARM_CATEGORY_DANGEROUS_CONTENT": "BLOCK_NONE",
                }
            )

            if response.candidates:
                candidate = response.candidates[0]

                # Check finish reason
                if candidate.finish_reason and candidate.finish_reason.name == "SAFETY":
                    print(f"   ⚠️ Blocked by safety, trying next model...")
                    continue

                # Check if content parts exist
                if candidate.content and candidate.content.parts:
                    image_prompt = candidate.content.parts[0].text.strip()
                    if image_prompt:
                        print(f"✅ Image prompt generated with {model_name}: {image_prompt[:100]}...")
                        return image_prompt

        except Exception as e:
            print(f"   ⚠️ {model_name} failed: {e}")
            continue

    print("❌ All models failed to generate image prompt")
    return None


def generate_image_with_pollinations(prompt: str, output_path: str, max_retries: int = 3) -> bool:
    """
    Generate image using Pollinations.ai (free, no API key required)

    Args:
        prompt: Image generation prompt
        output_path: Path to save the generated image
        max_retries: Number of retry attempts

    Returns:
        True if successful, False otherwise
    """
    print(f"🎨 Generating image with Pollinations.ai...")
    print(f"   Prompt: {prompt[:80]}...")

    # URL encode the prompt
    encoded_prompt = quote(prompt)

    # Pollinations.ai API - simple URL-based generation
    # Using 1920x1080 for landscape video background
    url = f"https://image.pollinations.ai/prompt/{encoded_prompt}?width=1920&height=1080&nologo=true"

    for attempt in range(max_retries):
        try:
            print(f"   Attempt {attempt + 1}/{max_retries} - Fetching from Pollinations.ai...")
            response = requests.get(url, timeout=180)  # 3 minute timeout

            if response.status_code == 200:
                # Check if we got an image
                content_type = response.headers.get('content-type', '')
                if 'image' in content_type:
                    # Save the image
                    with open(output_path, 'wb') as f:
                        f.write(response.content)

                    # Verify and resize if needed
                    try:
                        from PIL import Image
                        img = Image.open(output_path)
                        if img.size != (1920, 1080):
                            img_resized = img.resize((1920, 1080), Image.LANCZOS)
                            img_resized.save(output_path, "JPEG", quality=95)
                            print(f"✅ Image resized and saved (1920x1080): {output_path}")
                        else:
                            print(f"✅ Image saved (1920x1080): {output_path}")
                    except ImportError:
                        print(f"✅ Image saved (PIL not available for resize): {output_path}")

                    return True
                else:
                    print(f"   ⚠️ Unexpected content type: {content_type}")
            else:
                print(f"   ⚠️ HTTP error: {response.status_code}")

        except requests.Timeout:
            print(f"   ⚠️ Attempt {attempt + 1} timed out")
        except Exception as e:
            print(f"   ⚠️ Attempt {attempt + 1} error: {e}")

        if attempt < max_retries - 1:
            import time
            print(f"   Retrying in 5 seconds...")
            time.sleep(5)

    print("   ❌ All attempts failed")
    return False


def generate_ai_image(script_text: str, output_path: str) -> bool:
    """
    Main function: Analyze script and generate AI image

    Args:
        script_text: The script to analyze
        output_path: Path to save the generated image

    Returns:
        True if successful, False otherwise
    """
    print("\n" + "="*50)
    print("🤖 AI IMAGE GENERATION (Pollinations.ai)")
    print("="*50)

    # Step 1: Analyze script and get image prompt using Gemini
    image_prompt = analyze_script_for_image(script_text)

    if not image_prompt:
        print("❌ Failed to generate image prompt")
        return False

    # Step 2: Generate image with Pollinations.ai
    success = generate_image_with_pollinations(image_prompt, output_path)

    if success:
        print("✅ AI image generation complete!")
    else:
        print("❌ AI image generation failed")

    print("="*50 + "\n")

    return success


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
