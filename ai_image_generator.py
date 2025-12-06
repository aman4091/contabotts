#!/usr/bin/env python3
"""
AI Image Generator
Uses Gemini 3 Pro Preview to analyze script and Imagen 3.0 to generate images

Flow:
1. Script -> Gemini 3 Pro Preview -> Image generation prompt
2. Image prompt -> Imagen 3.0 -> Generated image
"""

import os
import base64
import traceback
from typing import Optional

# Google Generative AI
try:
    import google.generativeai as genai
    from google.generativeai import types
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False
    print("⚠️ google-generativeai not installed. Run: pip install google-generativeai")


# Configure API
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if GEMINI_API_KEY and GENAI_AVAILABLE:
    genai.configure(api_key=GEMINI_API_KEY)


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
    Analyze script using Gemini 3 Pro Preview and generate an image prompt

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

    # Models to try in order
    models_to_try = ['gemini-3-pro-preview', 'gemini-2.0-flash-exp', 'gemini-1.5-flash']

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

            # Debug: print response info
            print(f"   Response candidates: {len(response.candidates) if response.candidates else 0}")

            if response.candidates:
                candidate = response.candidates[0]
                print(f"   Finish reason: {candidate.finish_reason}")

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
                    else:
                        print(f"   ⚠️ Empty text, trying next model...")
                else:
                    print(f"   ⚠️ No content parts, trying next model...")
            else:
                print(f"   ⚠️ No candidates, trying next model...")

        except Exception as e:
            print(f"   ⚠️ {model_name} failed: {e}")
            continue

    print("❌ All models failed to generate image prompt")
    return None


def generate_image_with_imagen(prompt: str, output_path: str) -> bool:
    """
    Generate image using Imagen 3.0

    Args:
        prompt: Image generation prompt
        output_path: Path to save the generated image

    Returns:
        True if successful, False otherwise
    """
    if not GENAI_AVAILABLE:
        print("❌ google-generativeai not available")
        return False

    if not GEMINI_API_KEY:
        print("❌ GEMINI_API_KEY not set")
        return False

    try:
        print(f"🎨 Generating image with Imagen 3.0...")
        print(f"   Prompt: {prompt[:80]}...")

        # Use Imagen 3.0 model
        imagen = genai.ImageGenerationModel("imagen-3.0-generate-001")

        result = imagen.generate_images(
            prompt=prompt,
            number_of_images=1,
            aspect_ratio="16:9",  # Landscape for video background
            safety_filter_level="block_only_high",
            person_generation="allow_adult",
        )

        if not result.images:
            print("❌ No images generated")
            return False

        # Save the first image
        image = result.images[0]

        # Get image data and save
        image_bytes = image._pil_image
        if image_bytes:
            image_bytes.save(output_path, "JPEG", quality=95)
            print(f"✅ Image saved to: {output_path}")
            return True

        # Alternative: save from base64 if available
        if hasattr(image, '_image_bytes') and image._image_bytes:
            with open(output_path, 'wb') as f:
                f.write(image._image_bytes)
            print(f"✅ Image saved to: {output_path}")
            return True

        print("❌ Could not extract image data")
        return False

    except Exception as e:
        print(f"❌ Image generation error: {e}")
        traceback.print_exc()
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
    print("🤖 AI IMAGE GENERATION")
    print("="*50)

    # Step 1: Analyze script and get image prompt
    image_prompt = analyze_script_for_image(script_text)

    if not image_prompt:
        print("❌ Failed to generate image prompt")
        return False

    # Step 2: Generate image with Imagen 3.0
    success = generate_image_with_imagen(image_prompt, output_path)

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
