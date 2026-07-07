# Teaser — Live-Shot Checklist (Byron)

These 3–4 clips are best recorded by hand on a **real, separated-stem song from your
library** (smoother than headless, and they need a built core + the 3D highway). Record at
**1920×1080, 60 fps**, region-locked to the editor window. OBS (Display/Window Capture) or:

```
ffmpeg -f x11grab -framerate 60 -video_size 1920x1080 -i :0.0+X,Y -c:v libx264 \
       -preset fast -crf 18 -pix_fmt yuv420p shotN.mp4
```

> **DMCA:** before recording, confirm the song's on-screen title/artist/section names and
> any album art are **not** Rocksmith-branded. Use an own/neutral song.

Drop finished clips into `scratchpad/teaser/live/` and re-run `build_mlt.py` after wiring
them into `captions.json` (replace the `base` still with a `clip` for that segment).

## Shot 1 — Handshape paint (→ segment 3, note authoring)
- Load a song with chords. Drag a **handshape/arpeggio span** across a chord run on the
  shapes lane; grab a right edge and **resize** it. Show the chord label/inspector.
- ~5 s. Smooth single drag + one resize.

## Shot 2 — Note multi-drag with snap (→ segment 3)
- Marquee-select a group of notes; **drag** them along the waveform; let them **snap** to the
  1/4 grid. Show sustain tails moving.
- ~4 s.

## Shot 3 — HERO: Loop in 3D round-trip (→ segment 9) **[most important]**
- Build/open a saved song (button is disabled in create mode). Drag the bottom **`⇆ bars`**
  strip → blue region; the **▶ Loop in 3D** button lights blue.
- Click it → **3D highway** opens and loops just that bar range (notes scrolling).
- Exit the loop → editor returns to the **exact** scroll/zoom/cursor/selection.
- ~8–10 s. This is the climax — get one clean take of the full round-trip.
- Requires a core build that includes **#575** (`origin/main` has it; the capture worktree at
  `scratchpad/teaser/core-main` is already on it).

## Shot 4 (optional) — Stem mixer (→ segment 4 or new beat)
- Open a sloppak with **separated stems**. Click **🎚 Stems** → mixer panel slides in.
  **Mute drums**, **solo guitar** during playback; nudge a volume slider.
- ~5 s. Lets you add a real "mute, solo, isolate every stem" beat.

## Optional polish in Kdenlive (`project.kdenlive`)
- Swap the placeholder audio for a royalty-free track on the audio track.
- Swap Roboto titles for **Rubik** to match the app brand exactly.
- Add 8–12-frame dissolves on the hard cuts if you prefer crossfades.
- Drop the live clips over the corresponding still segments.
