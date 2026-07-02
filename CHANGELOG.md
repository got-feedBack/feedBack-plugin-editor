# Changelog

All notable changes to the Arrangement Editor plugin are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **The audio lane now draws a real waveform.** It previously showed a
  symmetric magnitude band (absolute-peak per bucket, mirrored about the
  centre line), which hid the signal's actual shape and went blocky on zoom.
  It now renders the true signed **min→max peak envelope** with a brighter
  **RMS body** inside it (Audacity-style), built from a high-resolution
  per-bin min/max/RMS cache (~3 ms/bin) and aggregated per pixel column so the
  shape stays sharp at any zoom. Same lane, same seek behaviour — no layout or
  API change. Pure helper `_buildWaveformPeaks` covered by tests.

### Added
- **Import a Guitar Pro guitar/bass track into the song you're editing —
  as a new arrangement, or to replace an existing one.** The editor could
  already Add Keys/Drums from a GP file and create a whole new song from GP,
  but there was no way to bring a GP **guitar or bass** track into an open
  session. A new **"+ Guitar/Bass"** toolbar button opens a modal: upload a GP
  file, pick a guitar/bass track (piano/drums/percussion/vocal tracks are
  filtered out), then choose a destination — **Add as a new arrangement** or
  **Replace** an existing same-instrument arrangement. Imported notes are
  aligned to the song's **current audio offset** (`_effectiveAudioOffset()`);
  the song's beats, sections, and audio are left untouched. Bass tracks are
  named so they render on E/A/D/G (4 lanes), not shifted. Replace is a single
  undo step and preserves the target arrangement's name, tones, and the
  song-level timeline. New backend endpoint `POST /api/plugins/editor/
  import-guitar-track` (reuses the shared `_arr_to_data` arrangement builder);
  frontend `ReplaceArrangementChartCmd` swaps the chart via snapshot/rollback.
  Pure helpers (`_isGuitarBassTrack`, `_guitarImportName`, `_swapChartFields` /
  `_restoreChartFields`) and the endpoint's dict shape are covered by tests.
- **"Loop in 3D" — preview selected bars on the 3D highway, then return to
  the exact edit position** (Editor ⇄ 3D Highway region round-trip). Drag
  across the bottom beat bar (measure strip) to select a bar range — it
  highlights across the chart — then click **▶ Loop in 3D** in the toolbar.
  The editor saves in place (so the highway streams your latest edits), hands
  the region to the player as an A–B loop, and starts playback looping just
  that section. The reverse direction adds an **✎ Edit region** button to the
  player's loop controls (both v2 and v3) that opens the editor scrolled to
  the active loop (or the section under the playhead); after a Loop-in-3D
  handoff an **↩ Editor** button returns you to where you were editing.
  Bar↔time uses real downbeat times from the beat grid (no BPM assumption);
  the handoff rides the existing core A/B loop API
  (`window.slopsmith.setLoop`/`getLoop`). New state `S.barSel`; new globals
  `editorLoopIn3D` / `_editorPendingView` / `_pendingHighwayLoop`. Pairs with
  core's song:ready loop applier and `editRegionInEditor` in `static/app.js`.
- **`.jsonc` arrangement support** (feedpak-spec §8, FEP #3 / PR #13). The
  editor now reads and writes `.jsonc` arrangement files (JSON with C-style
  `//` line and `/* */` block comments). The read path (which loads the
  existing arrangement to preserve `anchors`/`handshapes`/`phrases`/`tones`
  on save) strips comments via a string-aware regex mirroring the spec's
  reference validator. The write path preserves comments from the original
  file — including comments nested inside arrays/objects — by anchoring each
  comment to a structural identity and re-inserting it at the matching spot in
  the freshly serialized (`indent=2`) JSON:
  - Header / footer comments re-insert at the file head / tail.
  - A comment before a key (at any nesting depth) re-inserts on its own line
    before the key, indented to match.
  - A comment before an array element anchors to the element's *content
    signature* (the `t` value for objects that have one — the primary key for
    notes/beats/sections/anchors; else a compact sorted-JSON hash), so the
    comment follows the element across reorders / additions / removals of
    *other* elements. Editing the anchored element's `t` (or any field of a
    `t`-less element) changes its signature and the comment drifts or drops —
    the documented best-effort limit (a hand-author who nests a comment deep
    inside an array of notes owns the consequence of editing that note).
  - Trailing comments (before a closing `}`/`]`) re-insert one indent level
    deeper than the close bracket; empty containers rendered inline (`[]`/`{}`)
    are expanded so a `//` line comment doesn't eat the close bracket.
  `.json` arrangements are byte-identical to before (still compact
  `separators=(",", ":")`). Orphan cleanup now also removes `.jsonc`
  arrangement files after a remove. Tests: `tests/test_jsonc_save.py`.
- **Load-song search now matches the real song name and artist, not just
  the filename.** The "Load custom song" list previously showed raw
  filenames and only searched against them. Each entry now displays its
  song title (with artist) when the library has metadata for it, with the
  filename kept as a dim subtitle, and the search box matches song name,
  artist, **or** filename. Titles/artists come from the core library
  metadata cache (`meta_db`); songs not yet scanned fall back to
  filename-only display and remain pickable as before.
- **"Open in editor" on the v3 song-card menu.** Song cards in the v3 web
  UI have a three-dot menu (with core's "Edit metadata"); when this plugin
  is loaded it now also registers an **Open in editor** item that loads the
  song straight into the editor. Routed through the shared
  `ui.library-card-injection` registry (`window.slopsmith.libraryCardActions`),
  so it appears only when the editor is installed and only in v3 (the v2 UI
  has no such menu); the action calls the existing `window.editSong`.

### Changed
- **Sidebar label is now "Song Editor"** (was "Editor"). Pairs with the
  core change that promotes the editor to a first-class v3 sidebar entry
  (got-feedback/feedback#546) — `renderPromotedNav` shows this manifest
  `nav.label`, so the dedicated sidebar item reads "Song Editor".

### Fixed
- **GP8 piano/keys imports keep their accurate GP notation across edits and
  reopens — and can no longer bloat or mis-fill the shipped feedpak.** Importing
  a GP8 grand-staff keys track carries the GP-sourced per-stave/voice notation
  (companion to got-feedback/feedBack#692), but the first cut of that pass froze
  it at import time: editing notes then building rendered the *pre-edit* chart in
  Staff View / Keys Highway while the piano-roll showed the edits, and the first
  save after a reopen regenerated (and could delete) it via the less-accurate
  `notation_lift` heuristic. The GP payload is now stamped `source:"gp"` plus a
  **fingerprint of the notes it was derived from**, and the save/build path keeps
  it only while that fingerprint still matches the current notes — from the fresh
  import payload or, on a reopened pak, the existing `source:"gp"` sidecar on
  disk. Any note edit flips the fingerprint and falls through to the lift, so
  **edits always win** and an untouched reopen-save no longer clobbers the GP
  data. The payload is also **schema-validated before writing** (never vouch for
  a truncated/tampered sidecar); the `_gp_notation` blob is passed as an argument
  and never copied onto a manifest entry, so it **can't leak into `manifest.yaml`**
  (a keys arrangement renamed to a non-keys name previously serialized the whole
  multi-hundred-KB dict into the manifest); the sidecar filename now matches
  gp2notation exactly (`stem + ".notation.json"`), fixing a silent miss for track
  names with an interior dot (e.g. "Piano v1.2") that quietly reintroduced the
  wrong-hands lift; and a blind glob fallback that could persist **another
  track's** notation for a missing sidecar was removed (missing → lift, never the
  wrong part). Tests in `tests/test_notation_save.py`.
- **Add / rename section, and edit fret/bend/slide/anchor now work in
  the desktop app.** These actions used `window.prompt()`, which Electron
  does not implement — on the desktop app it returns `null` and logs a
  warning, so the actions silently no-opped while their no-prompt
  siblings (e.g. Delete Section) still worked. This made it look like
  "only delete works" on Windows/desktop (issue got-feedback/feedback#480).
  Replaced every `prompt()` call with a small in-app text-prompt modal
  (`_editorPromptText`, built on the existing `_installModalKeyboard`
  helper) that resolves to the entered string on OK/Enter or `null` on
  Cancel/Escape — same semantics as `prompt()`, so each call site's
  parsing/validation is unchanged. Works identically in the browser and
  Electron builds.

## [1.4.3] - 2026-05-28

### Added
- **Drum editor marquee select** — dragging over empty grid space now
  draws a rubber-band selection box and selects every drum hit inside
  it, matching the guitar/keys editor. A stationary click on empty space
  still adds a hit; shift-drag unions onto the current selection.

### Fixed
- **archive save** now writes edits to the arrangement you actually
  selected. `_load_archive` built its `xml_files` list (indexed on save by
  the dropdown's `arrangement_index`) from a raw `rglob` walk in
  filesystem order, but `lib.song.load_song` priority-sorts the
  arrangements it returns (Lead > Combo > Rhythm > Bass) — and that
  sorted list is what the dropdown shows. The two orders diverge on any
  multi-arrangement archive, so saving while "Rhythm" was selected could
  rewrite the Lead/Bass XML instead (edits silently vanished on
  reload), and a count mismatch raised `Save error: Invalid arrangement
  index` (issue #425). `xml_files` is now aligned to the arrangement
  order by pairing each loaded arrangement back to its source XML via a
  note/chord content signature, with a safe fall-back to filesystem
  order when the pairing is ambiguous (e.g. content-identical empty
  arrangements). This also fixes remove-arrangement and "+ Keys" append,
  which index the same list.
- **Sloppak save** now repopulates each phrase's per-difficulty
  `levels[].notes/chords/anchors` from the editor's flat lists.
  Previously `_save_sloppak` round-tripped phrases verbatim from the
  source archive, so the highway's mastery-filter consumer
  (`static/highway.js`, which reads notes from
  `phrases[].levels[idx].notes` whenever phrases are present)
  silently rendered the original archive chart — every added, edited,
  or deleted note was invisible on 2D/3D highways. Only arrangements
  with no source-side phrases (e.g. user-added bass on a sloppak that
  lacked one) were unaffected, because the highway falls back to the
  flat `notes` array when `phrases` is absent. This makes the mastery
  slider a no-op for editor-saved sloppaks (every level shows the
  same notes), which matches the editor's single-difficulty authoring
  model. Phrase windows are derived from each phrase's `start_time`
  and the next phrase's `start_time` (with the first/last extending
  to ±∞), not from the stored `end_time` — the tempo-edit path
  updates note times and phrase `start_time` but does not touch
  `end_time`, so trusting `end_time` would mis-bucket notes after a
  tempo remap. Notes outside any phrase's window (gaps in the source
  archive's coverage, or user additions before/after the original
  phrase range) land in the nearest first/last phrase.

## [1.4.2] - 2026-05-26

### Fixed
- **Build Song** no longer drops chords from arrangements that weren't
  the last one viewed. `editorBuild` ran `reconstructChords()` on every
  arrangement without flattening first; `reconstructChords()` rebuilds
  `arr.chords` purely from `arr.notes`, so any arrangement still in its
  non-flattened state had all its chords silently wiped. Most visible
  on a multi-track Guitar Pro import — e.g. a strummed-chord track
  built into a chord-less arrangement. The build now flattens each
  arrangement before reconstructing, matching the save path.

## [1.4.0] - 2026-05-23

### Added
- **Unified "New…" entry point** — the toolbar's *Create* button is
  now *New…* and opens a format-picker dialog asking "What are you
  making?" with two options: **Sloppak** (audio + chart, with drums +
  stems available from the start) and **archive** (the classic the chart
  custom song path, unchanged). Skips the three-step "create archive →
  save-as-sloppak → +drums" workflow that drummers were stuck with.
- **New-Sloppak modal** — drag-and-drop (or click-to-pick) an audio
  file (mp3 / wav / flac / m4a / ogg — re-encoded to .ogg on the
  server via ffmpeg), enter title / artist / album / year, choose an
  initial arrangement (Lead / Rhythm / Bass) and optionally
  pre-initialise an empty drum tab (on by default). The new
  `POST /api/plugins/editor/create_sloppak` route accepts the audio
  as multipart, builds a fresh .sloppak via the existing
  `_write_sloppak_pak` helper (which now optionally writes
  `drum_tab.json` + manifest entry), and returns the new filename;
  the editor opens it via the existing load path so the in-memory
  state initialises identically to a normal sloppak load.
- The legacy *Save as Sloppak* path remains for converting existing
  archive sessions.

## [1.3.0] - 2026-05-23

### Added
- **Drum vocab expanded to 18 pieces.** The drum editor's lane grid now
  shows the new `stack` (between Crash R and HH Open) and `bell` (after
  R.Bell) lanes from core's expanded PIECES dict. The existing
  `ride_bell` label is shortened to `R.Bell` to disambiguate from the
  new dedicated `bell` (bell cymbal) piece. Requires slopsmith core
  ≥ 0.2.9-alpha.4 for the new piece-ids.
- **Drum import — unmapped-notes warning + manual mapping.** When you
  import a GP or MIDI drum track containing percussion that doesn't map
  to one of the 18 slopsmith drum pieces (cowbell, tambourine, etc.),
  a dialog now lists the unmapped MIDI notes (with their GM names + hit
  counts) and lets you either drop them or pick a drum piece per row.
  Previously these notes were silently dropped on import. The
  `import-drums-tab` and `import-drums-midi` endpoints surface them via
  a new `unmapped: [{midi, count, times}]` field; the editor builds the
  warning + mapping UI client-side.

## [1.2.1] - 2026-05-22

### Fixed
- The sync **offset** now also shifts `drum_tab` hits. Previously an
  offset nudge moved the guitar notes, beat grid and sections but left
  the drum chart behind, so drums ended up out of sync. Shifted hits
  are clamped at 0 and rounded to 3 dp.

## [1.2.0] - 2026-05-22

### Added
- **Tempo Map editor** — an EOF-style mode for fitting the song-wide beat
  grid to the audio. A new **🎵 Tempo Map** toolbar button (works on both
  sloppak and archive) swaps the canvas to a tempo view: the waveform plus a
  draggable vertical "sync-point" pole at every measure downbeat, with each
  measure's BPM and time signature derived from sync-point spacing.
  - **Drag** a sync point to retime — only the two adjacent measures
    recompute their BPM; every other measure stays put.
  - **Insert / delete** sync points (right-click menu, or the Insert /
    Delete keys) to split or merge measures.
  - **Time signature** — `[` / `]` (or the right-click menu) change the
    selected measure's beats-per-measure; the interior grid re-subdivides.
  - **Notes ride the grid** with a user-selectable scope: a "Notes that
    ride the grid" toggle chooses **Drum tab only** (default — never
    disturbs a guitar/bass/keys chart) or **All instruments** (full
    retempo). The beat grid and section markers always move regardless.
    The choice persists in `localStorage`.
  - A dimmed reference layer shows the current arrangement's notes and the
    drum-tab hits at their absolute times, so the grid can be aligned to
    them and the waveform.
  - Every edit is a single undo step (Ctrl+Z / Ctrl+Y).
