# Arrangement Editor — Plugin Constitution

The editor is the largest plugin in the Slopsmith ecosystem (~5500 lines, 17 backend routes). It's a DAW-style timeline note editor for CDLC arrangements with import paths from Guitar Pro, MIDI, and existing PSARC/sloppak files, plus a CDLC build pipeline.

## Core Principles

### I. Session-Scoped Server State, Browser-Side Edits
The backend manages a `_sessions` dict keyed by session id; each session owns the unpacked working directory + extracted audio + art. The frontend (`screen.js`) holds the canonical edit state in `S` and ships diffs / full snapshots to the server on save/build. Closing the tab abandons the session but does not corrupt the source PSARC.

### II. Deterministic Import → Edit → Build Pipeline
Every supported source format (PSARC, sloppak, GP3-7, MIDI) routes through a dedicated `/api/plugins/editor/import-*` endpoint that normalises into the same internal song model. The build step (`/build`) is the only path that mutates the user's DLC dir — saves go to the session working dir.

### III. Storage Path Probes the Environment
The plugin needs a writable place to stage extracted audio/art that's also web-served. It probes `slopsmith/static/` for writability + an `app.js` sentinel; if both check out it uses `/static/...` (Docker web). Otherwise it falls back to a per-user `config_dir/editor_cache` mounted at `/api/plugins/editor/cache/...` (desktop bundles, read-only app package). Read-back accepts BOTH URL prefixes so old session URLs survive upgrades.

### IV. Undo / Redo Is The Edit Contract
Every mutating action in `screen.js` MUST go through `S.history` (push pre-state, then mutate). Ctrl-Z / Ctrl-Y are first-class and the toolbar Undo/Redo buttons reflect history state. No silent edits, no out-of-band mutations.

### V. Snap-Aware Time Editing
Time-based edits (drag, paste, beat-sync, offset nudge) honour the active snap value (`SNAP_VALUES = [1, 0.5, 0.25, 0.125, 0.0625, 0]` = 1/1 to 1/16, off). The user-visible BPM and offset fields drive a single canonical time mapping; rescaling tempo MUST rescale all notes and beats.

### VI. Keys vs Guitar Mode Are Different Charts
Arrangements named matching `KEYS_PATTERN = /^(keys|piano|keyboard|synth)/i` open in piano-roll mode (`PIANO_LANE_H` semitones, MIDI range tracker). All other arrangements open as 6-string guitar charts. Switching the arrangement dropdown rebuilds the chart in place; no data loss.

## Inherits from Slopsmith Core Constitution

- **Vanilla JS, no framework.** `screen.js` is one IIFE.
- **Plugin isolation**: backend `setup(app, context)` consumes `config_dir` + `get_dlc_dir`, then dynamically imports `lib.song`, `lib.psarc`, `lib.patcher`, `lib.audio`, `lib.sloppak` from Slopsmith core.
- **Manifest-driven loading**: `plugin.json` declares `nav.screen = "editor"`, `screen.html`, `screen.js`, `routes.py`.
- **YouTube audio import** delegates to `yt-dlp` via subprocess — already present in core's runtime image.
- **Build pipeline** uses core's `lib.patcher.pack_psarc` + `lib.sloppak` so output PSARCs are byte-compatible with the rest of the ecosystem.
- **Single-user, single-host.** No collaborative editing.

**Version**: 1.0.2 | **Ratified**: 2026-05-09 | **Last Amended**: 2026-05-09
