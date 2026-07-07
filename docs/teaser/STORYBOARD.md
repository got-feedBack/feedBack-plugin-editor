# feedBack Song Editor — Teaser Storyboard (v1.8)

**Format:** 16:9, 1920×1080, 30 fps · **Length:** ~64.5 s · **Audio:** music bed + on-screen
captions, no VO · **Hero:** Loop in 3D (editor #32) + real waveform (#33).

> **DMCA guardrail:** public material. Nothing on screen or in copy may mention/show
> "Rocksmith". Demo song is **Joe Satriani — "Motorcycle Driver"** (the GP8 Byron supplied),
> imported with its embedded backing track for a real chart + waveform + music.
> ⚠️ **Copyright:** that title/artist and the backing audio are a copyrighted commercial
> song — fine for an internal/preview cut, but for a *public* release swap to an own/cleared
> track (re-import a different GP, or replace the audio + retitle in Kdenlive).

## Beat sheet

| # | t (s) | Segment | Visual (asset) | Caption |
|---|-------|---------|----------------|---------|
| 0 | 0.0–5.0 | Cold open | Brand card | **feedBack** / "Song Editor" / "Author it. Audition it. Repeat." |
| 1 | 5.0–11.0 | Import | New… dialog (`08_new_dialog`) | "Drop a Guitar Pro tab." / "Import GP3–GP8, MIDI, MusicXML — or start blank." |
| 2 | 11.0–17.0 | Auto-sync | Loaded chart (`01_establish`) | "Auto-synced to the track." / "Now with a real min/max waveform." · badge **NEW · waveform** (#33) |
| 3 | 17.0–25.0 | Note authoring | Inspector (`06_inspector`) | "Shape every note." / "Bends · bend curves · chords · handshapes · teaching marks." |
| 4 | 25.0–32.5 | Tempo map | Tempo Map mode (`04_tempomap`) | "Bend time to the beat." / "EOF-style tempo map — drag a pole, BPM recalculates live." |
| 5 | 32.5–36.5 | Waveform detail | Zoomed chart (`03_zoom`) | "Sharp from full song to a single bin." |
| 6 | 36.5–41.5 | Drums | Add Drums dialog (`09_drums_dialog`) | "Program 18-piece drums." / "Import from Guitar Pro or MIDI." |
| 7 | 41.5–46.5 | Live MIDI | Record dialog (`10_record_dialog`) | "Record MIDI, live." / "Play your keys straight onto the chart." |
| 8 | 46.5–50.5 | Tones | Tones dialog (`11_tones_dialog`) | "Author tone slots." / "Base + A/B/C/D, named your way." |
| 9 | 50.5–59.5 | **HERO — Loop in 3D** | Region drag (`05_loop3d_region`) | badge **NEW · Loop in 3D** / "Pick a bar. Play it on the highway." / "…and land right back where you were editing." |
| 10 | 59.5–64.5 | Outro / CTA | Brand card | "feedBack · Song Editor" / "Author. Audition. Repeat." / "Patreon · Ko-fi · Discord" |

## Motion / grade
- Centered Ken-Burns zoom, alternating push-in / pull-out per segment (no pan — captions
  are baked into the frame, so a pan would crop the text).
- Fade from / to black at head/tail; hard cuts on segment boundaries (punchy teaser style).
  Dissolves can be added per-cut in Kdenlive.
- Lower-third dark scrim for caption legibility; neon accent rule + glow.
- Palette: bg `#0f172a`, accent `#38bdf8`, accent2 `#f472b6`, hero `#facc15`.

## Production
Captions are the single source of truth in `captions.json`. Pipeline:
`prep_sample.py` → core (worktree @ origin/main, editor symlinked) → `capture.mjs`
(Playwright stills/clips) → `make_assets.py` (Pillow caption-baked frames + cards) →
`build_mlt.py` (MLT project → `melt` render). `project.kdenlive` opens in Kdenlive for polish.

## Real footage in this cut (v18)
- Dense real chart + **full-resolution waveform** and **real music bed** (the GP8 embedded
  track) — the earlier "metronome + empty waveform" cut is fixed.
- Segment 6 shows the **real 18-piece drum-edit grid** (1826 hits), not the import dialog.
- Segment 3 prominently features the **right-hand inspector** (bends, bend-curve, teaching
  marks, technique checklist) on a real note.

## Known stand-ins (replace with live footage — see SHOTLIST.md)
- The hero shows the **editor side** of Loop in 3D (region + button lighting up). The full
  editor→highway→editor round-trip is a live shot (WebGL highway doesn't render headless).
- **Stem mixer** isn't in this cut (embedded audio = one stem). Record live on a
  separated-stem song to add a "mute drums / solo guitar" beat.
- MIDI / handshape / note-drag are still best shown live on a real song.
- **Brand font:** app uses Rubik/Inter (Google Fonts CDN); this cut uses local Roboto.
- **Music:** real but **copyrighted** (see DMCA note) — swap for a cleared track before any
  public posting.
