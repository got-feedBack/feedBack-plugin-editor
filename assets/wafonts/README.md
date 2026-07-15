# GM guide-voice assets (`/api/plugins/editor/wafont/`)

This directory holds the WebAudioFont assets the pitched GM guide
(`src/gm-guide.js`, DAW workspace 1.2/1.5) can serve **plugin-locally** — the
first rung of its source chain (plugin → org-hosted base URL → upstream CDN).
Nothing here is required for the feature to work: while this directory is
empty, the `/wafont` route 404s and the frontend falls through to the next
source automatically.

## What may be vendored here

Only these files, matching the route's whitelist (`_safe_wafont_name` in
`routes.py`):

- `WebAudioFontPlayer.js` — the WebAudioFont player (surikov/webaudiofont,
  MIT).
- `NNNN_FluidR3_GM_sf2_file.js` — melodic GM preset renders of
  **FluidR3_GM** by Frank Wen (MIT; the license document is referenced by the
  webaudiofontdata README and hosted in the MuseScore project repository).
- `128NN_N_FluidR3_GM_sf2_file.js` — FluidR3_GM percussion one-shots.

## Provenance contract (do not weaken)

- **FluidR3_GM renders only.** Other webaudiofontdata variants (JCLive,
  Aspirin, Chaos, GeneralUserGS renders, …) are NOT cleared for vendoring:
  the upstream repository declares MIT but does not document those sound
  sets' source data. This mirrors the org's Virtuoso plugin, which removed
  its JCLive files for exactly this reason and standardized on FluidR3_GM
  (see `feedback-plugin-virtuoso/static/wafonts/README.md`).
- Every file added here must be listed in this README with its source and
  license, and the whole plugin directory ships inside the packaged desktop
  app — so treat additions as a release-size decision, not just a repo one.
- No audio from commercial games or sample libraries, ever.

## Currently vendored

All from surikov/webaudiofont + webaudiofontdata (MIT), FluidR3_GM by Frank
Wen (MIT) — fetched 2026-07-14 from `surikov.github.io`:

- `WebAudioFontPlayer.js` (~122 KB) — the WebAudioFont player.
- `0000_FluidR3_GM_sf2_file.js` (~1.2 MB) — Grand piano, the keys default.
- `0270_FluidR3_GM_sf2_file.js` (~250 KB) — Clean electric, the guitar default.
- `0330_FluidR3_GM_sf2_file.js` (~440 KB) — Fingered, the bass default.

- `128{36,37,38,41,42,44,45,46,47,49,50,51,52,53,55,56,57}_0_FluidR3_GM_sf2_file.js`
  (~900 KB together) — the FluidR3_GM percussion one-shots behind every
  chartable drum piece (kick, snares, hats, toms, cymbals, cowbell — the
  `DRUM_PIECE_GM_NOTE` table in `src/gm-guide.js`).

These are the per-kind DEFAULT presets plus the drum kit (~2.9 MB total —
the release-size call): a chart sounds out of the box with zero network.
The non-default curated melodic choices still stream from the org/CDN rungs
on first use.
