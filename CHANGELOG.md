# Changelog

All notable changes to the Arrangement Editor plugin are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **Saving no longer strips `type` / `centOffset` / unknown keys from manifest
  arrangement entries.** The full-snapshot save path rebuilt every manifest
  arrangement entry from scratch (`{id, name, file, tuning, capo}`), silently
  dropping spec fields the editor doesn't author — `type` (§5.2), `centOffset`,
  and any future additive key — on every save, violating the format's
  unknown-key preservation rule (§1.2). Rebuilt entries now merge onto the
  existing entry for the same id, with editor-owned keys taking the fresh
  values. Tests: `tests/test_manifest_type_preserve.py`.

### Added
- **Infer-once arrangement `type` stamping.** On save, an arrangement entry with
  no `type` gets one inferred from its display name (keys-family → `piano`, bass
  names → `bass`, classic guitar roles → `guitar`) — conservative on purpose:
  vocals/drums/ambiguous names stay untyped, and an authored `type` is never
  clobbered. `type` is the queryable instrument facet the spec defines; display
  names stay free labels — groundwork for safe track renaming in the Parts view.

### Changed
- **Canvas repaints are coalesced to one per animation frame.** `draw()` was
  called imperatively from ~150 sites and each call repainted the whole
  canvas immediately — a single mousemove that touched several pieces of
  state paid several full repaints. `draw()` now marks the frame dirty and
  schedules one `drawNow()` on the next animation frame, so every existing
  call site batches for free; the once-per-frame playback tick (already
  inside its own rAF) paints synchronously via `drawNow()` to avoid a frame
  of cursor lag. Groundwork for the multi-part arrange view, which
  multiplies per-repaint cost. Tests: `tests/draw_coalesce.test.js`.
### Fixed
- **Screen re-injection no longer stacks global listeners or leaks
  playback.** The editor registered document/window-level listeners (two
  keydown handlers, input, mousemove/mouseup, resize) with no teardown — if
  the host re-injects the screen, every one of them stacked (double
  keystrokes per press, orphaned handlers, a still-playing audio source
  from the replaced screen). All global registrations now go through a
  tracked registry, and each boot calls the previous injection's teardown
  (published on `window.__editorScreenTeardown`) before registering its
  own: listeners removed, playback source stopped, rAF cancelled, both
  MutationObservers disconnected. Teardown-then-reboot rather than a skip
  guard, so behavior is correct whether or not the host ever re-injects.
  Canvas-level listeners die with the canvas node and stay untracked.
  Tests: `tests/boot_teardown.test.js`.

### Added
- **Drum edits are undoable.** Click-add, drag-move (time and lane), Delete,
  and the G/F/K ghost/flam/choke toggles now run through the editor's shared
  undo history via four new command classes (`AddDrumHitCmd`,
  `DeleteDrumHitsCmd`, `MoveDrumHitsCmd`, `ToggleDrumArticulationCmd`) — a
  mis-drag or stray Delete in the drum grid was previously unrecoverable, and
  Ctrl+Z in drum-edit mode silently undid the last **note** edit in the hidden
  guitar/keys arrangement instead. The commands hold hit references (never
  indices — the hits array is re-sorted after adds/moves and replaced by
  delete's filter), preserve the selection across resorts, and mark the drum
  tab dirty on both exec and rollback so a save after undo persists the
  reverted state. Tests: `tests/drum_undo.test.js`.

### Changed
- **Undo history is hardened for multi-arrangement editing.** Each command is
  tagged with the arrangement it was executed against; undo/redo now switches
  back to that arrangement first (updating the arrangement selector) instead
  of rolling index-based commands back into whichever arrangement happens to
  be active — which silently corrupted the wrong arrangement's notes. Song-level
  commands (drum tab) opt out of the switch. The undo stack is also capped at
  500 commands (oldest dropped first) so a marathon session can't grow memory
  without bound, and removing an arrangement now clears the history (the splice
  renumbers arrangements, so older commands would target the wrong one — same
  rationale as the save-time reset). Tests: `tests/drum_undo.test.js`.
- **Metronome click.** A new `Click` transport toggle schedules a soft pip on
  every beat-grid row during playback, with downbeats accented mainly by
  PITCH (~1000 vs ~800 Hz, only a small level delta) — the hearing-safe way
  to accent. Clicks ride the same lookahead scheduler and limited master bus
  as the guide claps (their own click gain, ≈ −12 dB under the reference), so
  they follow tempo changes in the beat grid exactly and cancel cleanly on
  seek/loop like every other guide voice. The editor previously had no
  metronome at all. Toggle persists as an editor preference. Tests:
  `tests/metronome_click.test.js`.
- **Guide claps — hear your chart while it plays.** A new `Claps` transport
  toggle (shortcut `C` in both the FeedBack and EOF profiles) ticks each
  charted event during playback — drum hits in the drum grid, the current
  arrangement's notes everywhere else — so authors can verify note placement
  by ear (the editor previously had no note sonification at all). Claps are
  scheduled by a `setInterval` lookahead loop off the transport's AudioContext
  anchor — not the rAF draw loop — so timing stays accurate under heavy canvas
  load; seeks and loop wraps cancel queued voices (no ghost claps); chord
  stacks dedupe to a single tick so simultaneous notes can't sum into a louder
  transient. Playback audio and claps now route through a shared master bus
  (per-source gains into a limiter), so the mix can never spike — the first
  slice of the DAW-workspace guide-playback engine. The toggle persists as an
  editor preference. Tests: `tests/guide_clap.test.js`.
- **Loop-edge keyboard nudge.** Click (or Tab to) a loop handle and use the
  arrow keys to nudge that edge by the region's natural step — Bar mode
  moves to the adjacent downbeat, Grid mode by one snap-subdivision step,
  Free mode by 10 ms (50 ms with Shift). No new global shortcuts: the
  handles are already focusable buttons, so the keys only act while a
  handle has focus. Nudges never wrap past the song edges or push an edge
  across its partner. Tests: `tests/loop_nudge.test.js`.
- **Loop snap modes — Bar / Grid / Free.** The loop region was bar-snapped
  only, and looping was disabled entirely on a chart with no downbeats — the
  exact starting state of a song that wasn't recorded to a click. The loop
  strip now has a three-way mode control: **Bar** (whole-downbeat spans, the
  unchanged default), **Grid** (edges snap to the current snap subdivision,
  honoring the snap on/off toggle), and **Free** (no snapping). **Shift-drag
  is a temporary Free** in any mode, resolved live so pressing/releasing
  Shift mid-drag flips snapping without restarting the gesture. With no bar
  grid yet, the strip stays enabled and forces Free ("Drag to set loop") so
  drifting-tempo songs can loop while their tempo map is authored. Regions
  remember their mode: tempo-map edits **relock** bar/grid loops to the new
  grid, while freely drawn loops never move; grid/free regions show a plain
  time range instead of a misleading "Bars X–Y" label. The mode preference
  persists as an editor preference. Tests: `tests/loop_snap_modes.test.js`.
- **Tap tempo (Shift+B in Tempo Map mode).** Select a sync point and tap
  Shift+B along with the recording; the median of the last 8 inter-tap
  intervals becomes a live BPM readout in the status bar, Enter applies it
  to the selected measure as one undoable command, Esc cancels, and pausing
  ~2 s starts a fresh run (a flubbed take is recoverable by just waiting a
  beat). Median — not mean — so one stumbled tap doesn't skew the estimate;
  implausible results (outside 20–400 BPM) are rejected rather than offered.
  This fulfills the previously-planned `tempoTapBpm` registry command in both
  shortcut profiles — the fastest way to rough in a tempo map for songs that
  weren't recorded to a click. Tests: `tests/tap_tempo.test.js`.
- **Metric modulation (M in Tempo Map mode / the sync inspector's
  "Modulate…" button).** Select a sync point and pick a pivot (quarter =
  dotted quarter ×2/3, dotted quarter = quarter ×3/2, quarter = eighth ×1/2,
  eighth = quarter ×2) or type any ratio (`3:2`, `2/3`, `0.75`): the new
  tempo applies from that measure **up to the next tempo change** — the
  uniform-run boundary is a natural pole, so a hand-authored tempo section
  downstream is never re-spaced. Interior beats re-space proportionally
  (swung/uneven sub-beats keep their fractional positions); everything after
  the run rigid-shifts; notes ride per the tempo-ride scope, exactly like a
  BPM edit; one undoable command. Results that would produce absurdly short
  measures are refused. Tests: `tests/tempo_modulate.test.js`.
- **Per-beat rubato drag in Tempo Map mode.** Sync-point poles retime whole
  measures — too coarse for a recording that accelerates or ritards *inside*
  a bar. Now grabbing an individual beat tick (any non-downbeat grid line)
  drags just that beat: its measure's downbeats stay fixed, the neighbouring
  sub-beats re-space proportionally on both sides (the accel/rit shape), and
  the drag clamps inside the measure with per-gap minimums so beats can
  squeeze but never collapse or reorder. Finalizes exactly like a pole drag —
  one undoable command; notes ride per the tempo-ride scope. Poles win the
  hit-test when both are in reach, so existing pole-drag muscle memory is
  unchanged. Tests: `tests/tempo_beat_drag.test.js`.

### Added
- **Onset detection strip (Shift+W / the new "Onsets" toolbar toggle).**
  Amber blocks over the waveform band mark where sharp attacks are detected
  in the recording — a visual hint of where notes/beats likely live while
  charting by eye. Detection runs client-side from the existing waveform RMS
  cache (no server round-trip): an onset fires where loudness rises sharply
  above the local baseline, gated by a noise floor and a ~50 ms refractory
  gap so one attack registers once; block brightness/height scale with
  attack strength. Works as an overlay with the waveform on, or as a pure
  "blocky" view with the waveform hidden (W off + Onsets on). Display only —
  the strip never places notes. The analysis is cached per audio load and
  recomputed on replace. Tests: `tests/onset_strip.test.js`.
- **Parts view — a stacked overview of every part (Shift+A / the "☰ Parts"
  toolbar button).** All parts render as named horizontal lanes over one
  shared timeline — every arrangement plus the drum tab — each with a
  header (name, instrument tag, event count), a compact silhouette
  (string-ribbon rows for guitar/bass, a pitch-mapped mini roll for keys,
  the 3-row cymbals/drums/kick collapse for drums), downbeat grid lines,
  and one playhead sweeping every lane during playback. The armed part is
  highlighted; **click a lane to arm it, double-click to open its focus
  editor** (arrangements open the note editor, the drums lane opens the
  drum grid). Navigational by design — technique editing stays in the
  focus editors. Mutually exclusive with drum-edit and Tempo Map modes,
  like they are with each other. Tests: `tests/parts_view.test.js`.
### Added
- **Section edits are undoable.** Adding (Shift+M or the beat-bar right-click
  menu), renaming, and deleting a section mutated `S.sections` directly with
  no undo — a stray Delete on a section was unrecoverable, and Ctrl+Z after
  adding one rolled back the last *note* edit instead. Add/rename/delete now
  run through the editor's undo history via three command classes
  (`AddSectionCmd`, `RemoveSectionCmd`, `RenameSectionCmd`) that hold the
  section by reference and restore `S.sections` exactly on undo/redo — a
  deleted section returns to its original position even when another section
  shares its start time. The section context menu's "near a section" lookup
  now shares one pure helper with the command tests. Tests:
  `tests/section_undo.test.js`.
### Added
- **Import GoPlayAlong projects (`.gp` + audio + a GoPlayAlong `.xml`).** A GoPlayAlong export is a `<track>` **sync sidecar** — it points at a Guitar Pro score and an audio file and stores the bar→audio sync points, but carries **no chart** — so feeding it to the arrangement importer failed with "not a recognised EOF arrangement XML". Now, in the New-dialog Content Import, drop the Guitar Pro tab + the audio + the GoPlayAlong `.xml` together: the `.xml` is content-sniffed and staged as a **GoPlayAlong sync source** (not mistaken for an EOF arrangement, and it prefills title/artist), and on Import the editor applies GoPlayAlong's **authored** per-bar sync instead of re-deriving it via onset detection. Under the hood: new `goplayalong.py` parser + `/api/plugins/editor/parse-goplayalong-sync` endpoint emit the same `sync_points` / `audio_offset` shape `autosync-gp` / `extract-gp-sync` return, which the existing `convert-gp` warp path consumes (`sync_applied: "warp"`). All GoPlayAlong UI logic is gated on a staged sidecar, so normal GP/EOF/audio imports are byte-for-byte unchanged. Tests: `tests/test_goplayalong.py` (10 cases vs a real export). Verified end-to-end against a real GoPlayAlong project ("Would?" — Alice in Chains): 73 sync points → the referenced `.gp` (87 bars, 7 tracks) → 73 warp anchors → a monotonic per-bar warp.
- **GP import with auto-sync now applies the full per-bar sync map (Songsterr-style), and the auto-sync audio can come from a YouTube URL.** Previously the auto-sync flow computed per-bar sync points but `convert-gp` applied only the scalar bar-1 offset, so recordings that drift from the tab's authored tempo went audibly out of sync over the song. Now: `convert-gp` accepts the `sync_points` payload back from the client and warps the whole converted chart (notes, sustains, beats, sections, handshapes, phrase levels, keys notation sidecars) onto the recording's timeline via core's new `lib.gp_autosync` warp helpers, responding with `sync_applied: "warp"`; it falls back to the scalar offset (`sync_applied: "offset"`) for GP3/4/5 files that use repeats/voltas/directions (their playback expansion can't be mapped from as-written sync points), when anchors degenerate, or when core lacks the new helpers. The create flow auto-runs the refine pass (onset phase sweep — requires the new core `refine_sync`, which this endpoint always imported but which never existed until now) right after the coarse DTW sync, and both refine calls send `gp_path` so refinement uses exact per-bar score times instead of a 4/4 approximation. The auto-sync section gains a YouTube URL input (reusing `/youtube-audio`) beside the file upload; the fetched audio becomes both the alignment target and the imported song audio.
- **Coarse triplet snap divisions — `1/3T` and `1/6T`.** The snap grid now offers
  quarter-note (`1/3T`) and eighth-note (`1/6T`) triplet resolutions alongside the
  existing binary and fine-triplet options, so triplet passages can be snapped
  without dropping all the way to `1/12T`. Triplet-family divisions are now labelled
  with a `T` suffix (`1/3T`, `1/6T`, `1/12T`, `1/24T`, `1/48T`, `1/96T`) to set them
  apart from the binary grid; the default snap stays `1/4`. (Ports the one division
  set #62 had over the merged snap options, without adopting its `{step}` engine.)
  Tests: `tests/snap_options.test.js`.

### Fixed
- **Editing a computed anchor no longer wipes the rest of the anchors.** The
  anchor lane shows the backend's computed/source anchors until you author your
  own, and the backend treats a non-empty `anchors_user` as the *complete*
  authored list (empty = recompute on save). Clicking, right-click-editing, or
  dragging one of those computed anchors — or adding your first anchor in empty
  lane space — previously promoted only that single anchor into `anchors_user`,
  so every **other** computed anchor was silently dropped on the next save (and
  vanished from the lane). Both authoring entry points now materialize the
  **whole** computed set on that first interaction, as one undoable step (Ctrl+Z
  returns to the recompute-on-save fallback), so only the anchor you actually
  edit changes. The anchor edit dialog also labels the value as the
  **hand-position fret (index finger)** and the width as **hand span**, so
  "fret" no longer reads as an arbitrary number. Tests:
  `tests/anchor_authoring.test.js` (full-set promotion on click + on add-new,
  undo-restores-fallback, idempotent-when-authored).
- **Create a song from audio alone — "New…" no longer forces a Guitar Pro / EOF
  file.** The create modal labelled its Guitar Pro and EOF XML inputs *optional*
  but hard-disabled the Create button unless one was picked, and its
  blank-chart options (initial arrangement + drum tab) were never wired up — so
  an audio-only feedpak could only be made through a second, separate "New
  Sloppak" dialog. The modal now leads with an explicit **Blank / Guitar Pro /
  EOF XML** mode picker (Blank is the default): Blank shows the initial-
  arrangement toggle (Lead / Rhythm / Bass) + a drum-tab option and enables
  Create on audio + title + artist, routing to the existing `create_sloppak`
  backend and opening the new feedpak straight in the editor; the GP and EOF
  modes keep their import flows. The "New" chooser's entries now open this one
  unified modal (in Blank / GP mode) instead of a parallel dialog, and the
  toolbar's **Build Song** button is renamed **Build feedpak**. Tests:
  `tests/create_gate.test.js` (per-mode Create-button enable logic). Keys /
  Drums-as-arrangement and extended tunings still need `create_sloppak` backend
  work (tracked separately); the now-unreferenced standalone New-Sloppak dialog
  can be removed in a follow-up.

### Changed
- **The audio lane now draws a real waveform.** It previously showed a
  symmetric magnitude band (absolute-peak per bucket, mirrored about the
  centre line), which hid the signal's actual shape and went blocky on zoom.
  It now renders the true signed **min→max peak envelope** with a brighter
  **RMS body** inside it (Audacity-style), built from a high-resolution
  per-bin min/max/RMS cache (~3 ms/bin) and aggregated per pixel column so the
  shape stays sharp at any zoom. Same lane, same seek behaviour — no layout or
  API change. Pure helper `_buildWaveformPeaks` covered by tests.
- **Point people at Tempo Map when an import drifts from the audio.** Auto-sync can only approximate a *human* performance between sync points, so an imported chart often starts aligned and then drifts (falls behind / gets ahead) — and the #1 confusion in the field is not realizing the **beatmap is editable at all**. The post-import status now names the fix in both cases: per-bar `warp` and the scalar `offset` fallback (GP3/4/5 repeats/jumps, degenerate anchors) each end with *"Drifting from the recording? Open 🎵 Tempo Map to drag the beat grid onto the audio."*, and the toolbar button's tooltip now reads "…fix a chart drifting from the audio — drag the beat grid, edit BPM & time signatures." No behavior change to the import itself; the Tempo Map editor (drag sync points, per-measure BPM + time signature, insert/delete, drum-vs-all ride scope) already existed. Tests: `tests/tempo_map_guidance.test.js` (`_syncAppliedMessagePure`).

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
