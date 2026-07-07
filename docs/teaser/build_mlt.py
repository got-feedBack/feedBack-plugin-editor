#!/usr/bin/env python3
"""Assemble the teaser as an MLT project (opens in Kdenlive) and render with melt.

Single video track: per-segment frames with an affine Ken-Burns push/pan and
black fades at head/tail; one audio track with the temp RS-free bed. Hard cuts on
the segment boundaries (punchy teaser style); dissolves can be added in Kdenlive.
"""
import json
import subprocess
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).parent
CAPS = json.loads((ROOT / "captions.json").read_text())
M = CAPS["meta"]
FPS = M["fps"]
W, H = M["width"], M["height"]
ASSETS = ROOT / "assets"
# Music bed: the real embedded backing track from the GP8 (RS-free of metronome).
# Start a few seconds in to skip any quiet intro and land on the riff.
AUDIO = next(iter(sorted(ROOT.glob("audio/*.mp3"))), ROOT / "audio" / "full.ogg")
AUDIO_IN_SEC = 12.0
PROJECT = ROOT / "project.mlt"
OUT = ROOT / "editor-teaser-v18.mp4"

# Ken-Burns: CENTERED zoom only (push-in / pull-out). Panning is avoided because
# captions are baked into the frame and a pan would crop the text. ~6% centered
# zoom keeps the lower-third caption safely inside frame at both ends.
Z = "-58 -32 2036 1145 1"   # 106%, centered
F = "0 0 1920 1080 1"       # 100%, full frame
KB = {
    "push": (F, Z),   # zoom in
    "pull": (Z, F),   # zoom out
}


def frames(sec):
    return int(round(sec * FPS))


def main():
    segs = CAPS["segments"]
    durs = [frames(s["dur"]) for s in segs]
    total = sum(durs)

    producers, ventries = [], []
    for i, (seg, nf) in enumerate(zip(segs, durs)):
        pid = f"v{i}"
        img = ASSETS / f"{seg['id']}.png"
        filt = []
        a, b = KB["push"] if i % 2 == 0 else KB["pull"]
        filt.append(
            f'<filter mlt_service="affine"><property name="transition.rect">'
            f'0={a};{nf - 1}={b}</property>'
            f'<property name="transition.fill">1</property>'
            f'<property name="transition.distort">0</property></filter>'
        )
        if i == 0:  # fade from black
            filt.append('<filter mlt_service="brightness"><property name="alpha">0=0;15=1</property></filter>')
        if i == len(segs) - 1:  # fade to black
            filt.append(f'<filter mlt_service="brightness"><property name="alpha">{nf - 18}=1;{nf - 1}=0</property></filter>')
        producers.append(
            f'<producer id="{pid}" in="0" out="{nf - 1}">'
            f'<property name="resource">{escape(str(img))}</property>'
            f'<property name="length">{nf}</property>'
            f'<property name="ttl">1</property>'
            f'<property name="mlt_service">pixbuf</property>'
            + "".join(filt) + "</producer>"
        )
        ventries.append(f'<entry producer="{pid}" in="0" out="{nf - 1}"/>')

    # audio bed: single slice of the real backing track from AUDIO_IN_SEC, faded
    a_in = int(AUDIO_IN_SEC * FPS)
    aentries = [f'<entry producer="aud" in="{a_in}" out="{a_in + total - 1}"/>']

    xml = f'''<?xml version="1.0" encoding="utf-8"?>
<mlt LC_NUMERIC="C" version="7.0" title="feedBack Song Editor teaser">
  <profile description="HD 1080p 30 fps" width="{W}" height="{H}" progressive="1"
    sample_aspect_num="1" sample_aspect_den="1" display_aspect_num="16" display_aspect_den="9"
    frame_rate_num="{FPS}" frame_rate_den="1" colorspace="709"/>
  <producer id="aud"><property name="resource">{escape(str(AUDIO))}</property></producer>
  {"".join(producers)}
  <playlist id="video0">
    {"".join(ventries)}
  </playlist>
  <playlist id="audio0">
    {"".join(aentries)}
    <filter mlt_service="volume"><property name="level">0=0;30=1;{total - 45}=1;{total - 1}=0</property></filter>
  </playlist>
  <tractor id="tractor0" in="0" out="{total - 1}">
    <track producer="video0"/>
    <track producer="audio0"/>
  </tractor>
</mlt>
'''
    PROJECT.write_text(xml)
    (ROOT / "project.kdenlive").write_text(xml)  # same MLT XML; opens in Kdenlive
    print(f"wrote {PROJECT}  ({total} frames = {total / FPS:.1f}s)")

    cmd = [
        "melt", str(PROJECT), "-consumer", f"avformat:{OUT}",
        "vcodec=libx264", "b=10M", "preset=medium", "pix_fmt=yuv420p",
        "acodec=aac", "ab=192k", "ar=48000",
        "movflags=+faststart", "real_time=-1",
    ]
    print("rendering:", " ".join(cmd))
    r = subprocess.run(cmd, capture_output=True, text=True)
    tail = (r.stdout + r.stderr).strip().splitlines()[-12:]
    print("\n".join(tail))
    print("exit", r.returncode, "->", OUT if OUT.exists() else "(no output)")


if __name__ == "__main__":
    main()
