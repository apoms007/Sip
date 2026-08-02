"""Generates the Mochi app icons for the web PWA and the Android launcher.

Mochi is an original kawaii cat drawn here procedurally; no third-party artwork
is used. Run with Pillow installed:  python icons/build_icons.py
"""
from PIL import Image, ImageDraw
import os

PINK_BG = (255, 214, 232, 255)
WHITE = (255, 255, 255, 255)
EAR_IN = (255, 197, 222, 255)
BOW = (255, 77, 126, 255)
BOW_DK = (217, 47, 94, 255)
EYE = (60, 45, 55, 255)
NOSE = (255, 194, 61, 255)
WHISK = (214, 176, 190, 255)


def draw_mochi(size, bg=True, inset=1.0):
    """Draw Mochi on a `size` square. `inset` shrinks the character, which the
    Android adaptive foreground needs so nothing is clipped by the mask."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if bg:
        d.rounded_rectangle([0, 0, size, size], radius=size * 0.234, fill=PINK_BG)

    # Character is authored in a 512 box, then scaled/centred.
    s = (size / 512.0) * inset
    off = (size - 512 * s) / 2.0

    def X(v):
        return off + v * s

    cx, cy = X(256), X(292)
    face_rx, face_ry = 170 * s, 142 * s

    ear_dx, ear_half, apex_y, base_y = 96 * s, 58 * s, X(60), X(196)
    for side in (-1, 1):
        d.polygon([(cx + side * ear_dx, apex_y),
                   (cx + side * (ear_dx - ear_half), base_y),
                   (cx + side * (ear_dx + ear_half), base_y)], fill=WHITE)
        d.polygon([(cx + side * ear_dx, apex_y + 40 * s),
                   (cx + side * (ear_dx - ear_half * 0.55), base_y - 6 * s),
                   (cx + side * (ear_dx + ear_half * 0.55), base_y - 6 * s)], fill=EAR_IN)

    d.ellipse([cx - face_rx, cy - face_ry, cx + face_rx, cy + face_ry], fill=WHITE)

    w = max(1, int(4 * s))
    for dy in (-16, 0, 16):
        wy = cy + dy * s
        d.line([(cx - 232 * s, wy - 4 * s), (cx - 120 * s, wy)], fill=WHISK, width=w)
        d.line([(cx + 232 * s, wy - 4 * s), (cx + 120 * s, wy)], fill=WHISK, width=w)

    eye_r = 9 * s
    for side in (-1, 1):
        ex = cx + side * 60 * s
        d.ellipse([ex - eye_r, cy - eye_r, ex + eye_r, cy + eye_r], fill=EYE)

    nw, nh, ny = 14 * s, 9 * s, cy + 26 * s
    d.ellipse([cx - nw, ny - nh, cx + nw, ny + nh], fill=NOSE)

    # Bow rides the outer edge of the left ear so the ear tip stays visible.
    bx, by = cx - ear_dx - 16 * s, apex_y + 52 * s
    bw, bh = 44 * s, 32 * s
    d.polygon([(bx, by), (bx - bw, by - bh), (bx - bw, by + bh)], fill=BOW)
    d.polygon([(bx, by), (bx + bw, by - bh), (bx + bw, by + bh)], fill=BOW)
    d.ellipse([bx - 12 * s, by - 12 * s, bx + 12 * s, by + 12 * s], fill=BOW_DK)

    return img


def round_mask(img):
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).ellipse([0, 0, img.size[0], img.size[1]], fill=255)
    out.paste(img, (0, 0), mask)
    return out


here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)

# --- web / PWA ---
for size, name in ((192, "icon-192.png"), (512, "icon-512.png"),
                   (180, "apple-touch-icon.png"), (32, "favicon-32.png")):
    draw_mochi(size).save(os.path.join(here, name))

# --- android launcher ---
android_res = os.path.join(root, "android", "app", "src", "main", "res")
if os.path.isdir(android_res):
    # Legacy square/round icons, plus the adaptive foreground (108dp canvas with
    # only the middle 72dp guaranteed visible, hence the inset).
    for folder, legacy, fg in (("mipmap-mdpi", 48, 108), ("mipmap-hdpi", 72, 162),
                               ("mipmap-xhdpi", 96, 216), ("mipmap-xxhdpi", 144, 324),
                               ("mipmap-xxxhdpi", 192, 432)):
        out = os.path.join(android_res, folder)
        os.makedirs(out, exist_ok=True)
        icon = draw_mochi(legacy)
        icon.save(os.path.join(out, "ic_launcher.png"))
        round_mask(icon).save(os.path.join(out, "ic_launcher_round.png"))
        draw_mochi(fg, bg=False, inset=0.62).save(os.path.join(out, "ic_launcher_foreground.png"))

    with open(os.path.join(android_res, "values", "ic_launcher_background.xml"), "w") as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
                '    <color name="ic_launcher_background">#FFD6E8</color>\n</resources>\n')
    print("android launcher icons written")

print("done")
