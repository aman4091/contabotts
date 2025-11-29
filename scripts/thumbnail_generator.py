#!/usr/bin/env python3
"""
Thumbnail Generator Script using Pillow
Usage: python3 thumbnail_generator.py --config config.json --output output.png
"""

import json
import sys
import os
import argparse
import random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# Default thumbnail size (YouTube standard)
WIDTH = 1280
HEIGHT = 720

def get_font(font_family: str, font_size: int):
    """Get font, falling back to default if not found"""
    font_paths = {
        "Impact": ["/usr/share/fonts/truetype/msttcorefonts/Impact.ttf", "/usr/share/fonts/truetype/impact.ttf"],
        "Arial Black": ["/usr/share/fonts/truetype/msttcorefonts/ariblk.ttf", "/usr/share/fonts/truetype/msttcorefonts/arialbd.ttf"],
        "Arial": ["/usr/share/fonts/truetype/msttcorefonts/arialbd.ttf", "/usr/share/fonts/truetype/msttcorefonts/Arial.ttf"],
        "Verdana": ["/usr/share/fonts/truetype/msttcorefonts/Verdana_Bold.ttf", "/usr/share/fonts/truetype/msttcorefonts/Verdana.ttf"],
        "Georgia": ["/usr/share/fonts/truetype/msttcorefonts/Georgia.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"],
    }

    print(f"Loading font: {font_family}, size: {font_size}", file=sys.stderr)

    # Try to find the requested font
    paths_to_try = font_paths.get(font_family, [])

    # Add fallback fonts
    paths_to_try.extend([
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ])

    for path in paths_to_try:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, font_size)
            except:
                continue

    # Fallback to default font
    return ImageFont.load_default()


def hex_to_rgb(hex_color: str) -> tuple:
    """Convert hex color to RGB tuple"""
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def get_random_image(folder_path: str) -> str:
    """Get a random image from the specified folder"""
    if not os.path.exists(folder_path):
        return None

    images = [f for f in os.listdir(folder_path)
              if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))]

    if not images:
        return None

    return os.path.join(folder_path, random.choice(images))


def wrap_text(text: str, font, max_width: int, draw) -> list:
    """Wrap text to fit within max_width"""
    words = text.split()
    lines = []
    current_line = []

    for word in words:
        test_line = ' '.join(current_line + [word])
        bbox = draw.textbbox((0, 0), test_line, font=font)
        width = bbox[2] - bbox[0]

        if width <= max_width:
            current_line.append(word)
        else:
            if current_line:
                lines.append(' '.join(current_line))
            current_line = [word]

    if current_line:
        lines.append(' '.join(current_line))

    return lines


def draw_text_with_effects(draw, text: str, position: tuple, font, config: dict):
    """Draw text with shadow and outline effects"""
    x, y = position
    text_color = hex_to_rgb(config.get('fontColor', '#FFFFFF'))

    # Draw shadow
    shadow = config.get('shadow', {})
    if shadow.get('enabled', False):
        shadow_color = hex_to_rgb(shadow.get('color', '#000000'))
        shadow_offset_x = shadow.get('offsetX', 3)
        shadow_offset_y = shadow.get('offsetY', 3)
        shadow_blur = shadow.get('blur', 6)

        # Create shadow layer
        shadow_layer = Image.new('RGBA', draw.im.size, (0, 0, 0, 0))
        shadow_draw = ImageDraw.Draw(shadow_layer)
        shadow_draw.text((x + shadow_offset_x, y + shadow_offset_y), text,
                        font=font, fill=(*shadow_color, 180))

        # Blur shadow
        if shadow_blur > 0:
            shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(radius=shadow_blur))

        # Composite shadow
        draw.bitmap((0, 0), shadow_layer, fill=None)

    # Draw outline
    outline = config.get('outline', {})
    if outline.get('enabled', False):
        outline_color = hex_to_rgb(outline.get('color', '#000000'))
        outline_width = outline.get('width', 3)

        # Draw outline by drawing text in multiple positions
        for dx in range(-outline_width, outline_width + 1):
            for dy in range(-outline_width, outline_width + 1):
                if dx != 0 or dy != 0:
                    draw.text((x + dx, y + dy), text, font=font, fill=outline_color)

    # Draw main text
    draw.text((x, y), text, font=font, fill=text_color)


def generate_thumbnail(config: dict, output_path: str):
    """Generate thumbnail based on configuration"""

    # Get background image
    bg_path = config.get('backgroundImage')
    bg_folder = config.get('backgroundImageFolder')

    if not bg_path and bg_folder:
        bg_path = get_random_image(bg_folder)

    if not bg_path or not os.path.exists(bg_path):
        # Create solid color background
        img = Image.new('RGB', (WIDTH, HEIGHT), (30, 30, 30))
    else:
        # Load and resize background
        img = Image.open(bg_path).convert('RGB')
        img = img.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)

    draw = ImageDraw.Draw(img)

    # Add overlay image if specified
    overlay_path = config.get('overlayImage')
    if overlay_path and os.path.exists(overlay_path):
        overlay = Image.open(overlay_path).convert('RGBA')

        overlay_pos = config.get('overlayPosition', {'x': 0, 'y': 0})
        overlay_size = config.get('overlaySize', {'width': 400, 'height': 400})

        # Resize overlay
        overlay = overlay.resize(
            (overlay_size['width'], overlay_size['height']),
            Image.Resampling.LANCZOS
        )

        # Paste overlay with transparency
        img.paste(overlay, (overlay_pos['x'], overlay_pos['y']), overlay)
        draw = ImageDraw.Draw(img)

    # Draw text
    title = config.get('title', '')
    if title:
        text_box = config.get('textBox', {})

        font_family = text_box.get('fontFamily', 'Impact')
        font_size = text_box.get('fontSize', 72)
        text_align = text_box.get('textAlign', 'center')

        padding = text_box.get('padding', {})
        pad_left = padding.get('left', 20)
        pad_right = padding.get('right', 20)
        pad_top = padding.get('top', 10)

        box_x = text_box.get('x', 50)
        box_y = text_box.get('y', 480)
        box_width = text_box.get('width', 1180)

        # Get font
        font = get_font(font_family, font_size)

        # Calculate available width for text
        available_width = box_width - pad_left - pad_right

        # Wrap text
        lines = wrap_text(title, font, available_width, draw)

        # Auto-reduce font size if text doesn't fit well
        while len(lines) > 3 and font_size > 24:
            font_size -= 4
            font = get_font(font_family, font_size)
            lines = wrap_text(title, font, available_width, draw)

        # Calculate line height
        sample_bbox = draw.textbbox((0, 0), "Ay", font=font)
        line_height = sample_bbox[3] - sample_bbox[1] + 10

        # Draw each line
        current_y = box_y + pad_top
        for line in lines:
            bbox = draw.textbbox((0, 0), line, font=font)
            text_width = bbox[2] - bbox[0]

            # Calculate x position based on alignment
            if text_align == 'center':
                text_x = box_x + pad_left + (available_width - text_width) // 2
            elif text_align == 'right':
                text_x = box_x + pad_left + available_width - text_width
            else:  # left
                text_x = box_x + pad_left

            draw_text_with_effects(draw, line, (text_x, current_y), font, text_box)
            current_y += line_height

    # Save output
    output_dir = os.path.dirname(output_path)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)

    img.save(output_path, 'PNG', quality=95)
    return output_path


def main():
    parser = argparse.ArgumentParser(description='Generate YouTube thumbnails')
    parser.add_argument('--config', required=True, help='JSON config file path')
    parser.add_argument('--output', required=True, help='Output PNG file path')
    parser.add_argument('--config-json', help='JSON config as string')

    args = parser.parse_args()

    # Load config
    if args.config_json:
        config = json.loads(args.config_json)
    else:
        with open(args.config, 'r') as f:
            config = json.load(f)

    # Generate thumbnail
    result = generate_thumbnail(config, args.output)
    print(json.dumps({'success': True, 'path': result}))


if __name__ == '__main__':
    main()
