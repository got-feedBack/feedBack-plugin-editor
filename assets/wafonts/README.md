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

(none yet — the FTO/size call for committing preset renders is a follow-up;
the guide uses the org/CDN sources until then)
