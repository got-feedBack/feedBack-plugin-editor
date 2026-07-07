#!/usr/bin/env python3
"""Build per-segment 1920x1080 frames for the teaser: brand cards + caption-baked
stills. Captions use local Roboto (app brand font Rubik is CDN-only); swap later.
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).parent
CAPS = json.loads((ROOT / "captions.json").read_text())
SRC = ROOT / "captures"
OUT = ROOT / "assets"
OUT.mkdir(exist_ok=True)

M = CAPS["meta"]
W, H = M["width"], M["height"]
P = M["palette"]
FONT = "/usr/share/fonts/TTF/"
F_BLACK = lambda s: ImageFont.truetype(FONT + "Roboto-Black.ttf", s)
F_BOLD = lambda s: ImageFont.truetype(FONT + "Roboto-Bold.ttf", s)
F_MED = lambda s: ImageFont.truetype(FONT + "Roboto-Medium.ttf", s)

DB_BLUE = "#6699ff"               # sampled from the logo glyph
LOGO = Image.open(ROOT / "logo.webp").convert("RGBA")
# Brand wordmark: "Fee" + "[dB]" (logo blue) + "ack"
WORDMARK = [("Fee", "text"), ("[dB]", "db"), ("ack", "text")]


def hx(c):
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def vgrad(w, h, top_a, bot_a, color):
    """Vertical alpha gradient strip (top_a→bot_a) of solid color."""
    g = Image.new("L", (1, h))
    for y in range(h):
        g.putpixel((0, y), int(top_a + (bot_a - top_a) * y / max(1, h - 1)))
    a = g.resize((w, h))
    img = Image.new("RGBA", (w, h), color + (0,))
    img.putalpha(a)
    return img


def glow_text(base, xy, text, font, fill, anchor="la", glow=None, gr=8):
    if glow:
        layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        d.text(xy, text, font=font, fill=glow + (220,), anchor=anchor)
        layer = layer.filter(ImageFilter.GaussianBlur(gr))
        base.alpha_composite(layer)
    ImageDraw.Draw(base).text(xy, text, font=font, fill=fill, anchor=anchor)


def badge(base, xy, text, font, bg, fg):
    d = ImageDraw.Draw(base)
    tw = d.textlength(text, font=font)
    asc, desc = font.getmetrics()
    th = asc + desc
    px, py = 22, 12
    x, y = xy
    d.rounded_rectangle([x, y, x + tw + px * 2, y + th + py * 2], radius=(th + py * 2) // 2, fill=bg + (255,))
    d.text((x + px, y + py - 2), text, font=font, fill=fg, anchor="la")
    return th + py * 2


def mask_tuner(img):
    """Hide the floating Tuner plugin pill in the bottom-right of editor stills."""
    ImageDraw.Draw(img).rectangle([1806, 1012, W, H], fill=hx("#0b1220"))


def lower_third(img, seg):
    scrim = vgrad(W, 470, 0, 232, hx(P["bg"]))
    img.alpha_composite(scrim, (0, H - 470))
    # accent rule
    x0, y = 110, H - 300
    if seg.get("badge"):
        bh = badge(img, (x0, y - 78), seg["badge"], F_BOLD(30), hx(P["hero"]) if "Loop" in seg["badge"] else hx(P["accent"]), hx(P["bg"]))
    ImageDraw.Draw(img).rectangle([x0, y, x0 + 96, y + 7], fill=hx(P["accent"]))
    glow_text(img, (x0, y + 26), seg["title"], F_BLACK(74), hx(P["text"]), glow=hx(P["accent"]), gr=10)
    if seg.get("sub"):
        ImageDraw.Draw(img).text((x0, y + 120), seg["sub"], font=F_MED(38), fill=hx(P["muted"]), anchor="la")


def neon_bg():
    img = Image.new("RGBA", (W, H), hx(P["bg"]) + (255,))
    # radial-ish glow blobs
    for (cx, cy, col, r) in [(560, 360, P["accent"], 520), (1400, 760, P["accent2"], 560)]:
        blob = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(blob).ellipse([cx - r, cy - r, cx + r, cy + r], fill=hx(col) + (60,))
        img.alpha_composite(blob.filter(ImageFilter.GaussianBlur(140)))
    return img


def _color(key):
    return hx(DB_BLUE) if key == "db" else hx(P[key])


def brand_lockup(img, cx, cy, wm_size, logo_h):
    """Horizontal logo + 'Fee[dB]ack' wordmark, centered as a group on (cx, cy)."""
    f = F_BLACK(wm_size)
    d = ImageDraw.Draw(img)
    widths = [d.textlength(t, font=f) for t, _ in WORDMARK]
    wm_w = sum(widths)
    logo_w = max(1, round(LOGO.width * logo_h / LOGO.height))
    gap = round(logo_h * 0.16)
    x0 = round(cx - (logo_w + gap + wm_w) / 2)
    # logo, vertically centered on cy
    img.alpha_composite(LOGO.resize((logo_w, logo_h)), (x0, round(cy - logo_h / 2)))
    # wordmark
    wx = x0 + logo_w + gap
    asc, desc = f.getmetrics()
    wy = round(cy - (asc + desc) / 2)
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    dg = ImageDraw.Draw(glow)
    gx = wx
    for (t, _), w in zip(WORDMARK, widths):
        dg.text((gx, wy), t, font=f, fill=hx(P["accent"]) + (150,)); gx += w
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(13)))
    tx = wx
    for (t, key), w in zip(WORDMARK, widths):
        d.text((tx, wy), t, font=f, fill=_color(key)); tx += w


def card(seg, kind):
    img = neon_bg()
    d = ImageDraw.Draw(img)
    cx = W // 2
    if kind == "intro":
        brand_lockup(img, cx, 332, 104, 196)
        glow_text(img, (cx, 472), seg["title"], F_BLACK(104), hx(P["text"]), anchor="ma", glow=hx(P["accent2"]), gr=14)
        d.text((cx, 636), seg["sub"], font=F_MED(42), fill=hx(P["muted"]), anchor="ma")
    else:
        brand_lockup(img, cx, 300, 80, 150)
        glow_text(img, (cx, 430), seg["title"], F_BLACK(86), hx(P["text"]), anchor="ma", glow=hx(P["accent2"]), gr=12)
        d.text((cx, 548), "Song Editor", font=F_MED(38), fill=hx(P["muted"]), anchor="ma")
        d.text((cx, 614), seg["sub"], font=F_BOLD(38), fill=hx(P["hero"]), anchor="ma")
    return img


def main():
    for seg in CAPS["segments"]:
        if seg.get("card"):
            img = card(seg, seg["card"])
        else:
            base = Image.open(SRC / seg["base"]).convert("RGBA")
            if base.size != (W, H):
                base = base.resize((W, H))
            mask_tuner(base)
            img = base
            lower_third(img, seg)
        img.convert("RGB").save(OUT / f"{seg['id']}.png")
        print("  frame", seg["id"])
    print(f"wrote {len(CAPS['segments'])} frames → {OUT}")


if __name__ == "__main__":
    main()
