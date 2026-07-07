#!/usr/bin/env python3
"""Neutralize the diagnostic sloppak into a DMCA-safe demo song for the teaser.

- Rebrand title/artist/album (no 'Slopsmith'/'Rocksmith' branding on screen).
- Keep the non-copyrighted click-track backing + note data as-is.
- Repack into the teaser library dir.
"""
import io
import zipfile
from pathlib import Path

SRC = Path("/home/byron/Repositories/feedback/docs/diagnostics/slopsmith-diagnostic-basic-guitar.sloppak")
LIB = Path(__file__).parent / "library"
LIB.mkdir(parents=True, exist_ok=True)
OUT = LIB / "neon-ascent.sloppak"

NEUTRAL_MANIFEST = """title: Neon Ascent
artist: feedBack Demo
album: Editor Showcase
year: 2026
duration: 55.0
arrangements:
  -
    id: lead
    name: Lead Guitar
    file: arrangements/lead.json
    tuning:
      - 0
      - 0
      - 0
      - 0
      - 0
      - 0
    capo: 0
stems:
  -
    id: full
    file: stems/full.ogg
    default: true
"""

DEMO_README = (
    "# Neon Ascent (feedBack editor demo)\n\n"
    "Non-copyrighted click-track backing used purely to demo the Song Editor.\n"
)

with zipfile.ZipFile(SRC) as zin:
    members = {n: zin.read(n) for n in zin.namelist()}

# Rewrite branded text members; keep audio + note data verbatim.
members["manifest.yaml"] = NEUTRAL_MANIFEST.encode("utf-8")
if "DIAGNOSTIC.md" in members:
    del members["DIAGNOSTIC.md"]
members["README.md"] = DEMO_README.encode("utf-8")

# Rename arrangement display name only (notes untouched).
lead = members.get("arrangements/lead.json", b"")
if lead:
    txt = lead.decode("utf-8")
    txt = txt.replace('"name":"Diagnostic Guitar"', '"name":"Lead Guitar"', 1)
    members["arrangements/lead.json"] = txt.encode("utf-8")

buf = io.BytesIO()
with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zout:
    for name, data in members.items():
        zout.writestr(name, data)
OUT.write_bytes(buf.getvalue())

# DMCA sanity scan over the repacked text members.
bad = []
for name, data in members.items():
    if name.endswith((".ogg",)):
        continue
    low = data.decode("utf-8", "ignore").lower()
    for term in ("rocksmith", "slopsmith"):
        if term in low:
            bad.append((name, term))

print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")
print("members:", sorted(members))
print("DMCA scan:", "CLEAN" if not bad else f"LEAKS {bad}")
