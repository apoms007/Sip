"""Generates Mochi mascot app icons (original kawaii cat design, not Sanrio artwork)."""
from PIL import Image, ImageDraw
import os

def draw_mochi(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size / 512.0
    def X(v): return v * s

    d.rounded_rectangle([0, 0, size, size], radius=X(120), fill=(255, 214, 232, 255))

    cx, cy = X(256), X(300)
    face_rx, face_ry = X(175), X(145)

    # ears: symmetric via +/- offset from center, apex above face, base overlapping face top
    ear_dx, ear_half, apex_y, base_y = X(95), X(58), X(55), X(190)
    for side in (-1, 1):
        apex = (cx + side * ear_dx, apex_y)
        base_a = (cx + side * (ear_dx - ear_half), base_y)
        base_b = (cx + side * (ear_dx + ear_half), base_y)
        d.polygon([apex, base_a, base_b], fill=(255, 255, 255, 255))
        inner_apex = (cx + side * ear_dx, apex_y + X(38))
        inner_a = (cx + side * (ear_dx - ear_half * 0.55), base_y - X(6))
        inner_b = (cx + side * (ear_dx + ear_half * 0.55), base_y - X(6))
        d.polygon([inner_apex, inner_a, inner_b], fill=(255, 197, 222, 255))

    # face
    d.ellipse([cx - face_rx, cy - face_ry, cx + face_rx, cy + face_ry], fill=(255, 255, 255, 255))

    # whiskers
    for dy in (-16, 0, 16):
        wy = cy + X(dy)
        d.line([(cx - X(230), wy - X(4)), (cx - X(120), wy)], fill=(214, 176, 190, 255), width=max(1, int(X(4))))
        d.line([(cx + X(230), wy - X(4)), (cx + X(120), wy)], fill=(214, 176, 190, 255), width=max(1, int(X(4))))

    # eyes
    eye_r = X(9)
    for side in (-1, 1):
        ex = cx + side * X(60)
        d.ellipse([ex - eye_r, cy - eye_r, ex + eye_r, cy + eye_r], fill=(60, 45, 55, 255))

    # nose
    nw, nh = X(14), X(9)
    ny = cy + X(24)
    d.ellipse([cx - nw, ny - nh, cx + nw, ny + nh], fill=(255, 196, 84, 255))

    # bow on left ear (viewer's left)
    bx, by = cx - ear_dx, apex_y + X(30)
    bow_w, bow_h = X(42), X(30)
    d.polygon([(bx, by), (bx - bow_w, by - bow_h), (bx - bow_w, by + bow_h)], fill=(255, 111, 145, 255))
    d.polygon([(bx, by), (bx + bow_w, by - bow_h), (bx + bow_w, by + bow_h)], fill=(255, 111, 145, 255))
    d.ellipse([bx - X(11), by - X(11), bx + X(11), by + X(11)], fill=(230, 80, 110, 255))

    return img

out_dir = os.path.dirname(__file__)
for size in (192, 512, 180, 32):
    img = draw_mochi(size)
    name = {192: "icon-192.png", 512: "icon-512.png", 180: "apple-touch-icon.png", 32: "favicon-32.png"}[size]
    img.save(os.path.join(out_dir, name))
print("done")
