# Changelog

All notable changes to the Arrangement Editor plugin are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **The per-module hook objects collapse into one `src/host.js` (R2, step 17).**
  `history.js`, `drum.js` and `annotation-lanes.js` each grew their own
  `setXHooks()` for the same reason — they need a few `main.js` symbols that
  cannot be imported back without a cycle. By the fourth module the same four
  callbacks (`draw`, `hideContextMenu`, `snapTime`, `editorPromptText`) were
  being threaded through three separate hook objects. They now read a single
  shared `host` object, wired once by `main.js`. A new module needs no new
  plumbing: import `host`, call `host.draw()`.
  No behaviour change. The `draw` thunk stays — it is what keeps the hook
  pointed at the live binding rather than the pre-wrapper function — and
  `host.js`'s header now carries that warning where the next person will read it.

### Fixed

- **Hook callbacks captured the pre-wrapper `draw`.** `draw` is reassigned near
  the bottom of `main.js` to a wrapper that refreshes seven toolbar buttons
  before repainting. `setHistoryHooks()` and `setDrumHooks()` were handed the
  bare identifier, so they froze the ORIGINAL function at wiring time and every
  undo, redo and drum-density toggle skipped those refreshes. The canvas still
  repainted, which is why nothing looked obviously wrong — the visible symptom
  was the drum-density button keeping its old "Rows: Full" label after the grid
  had already collapsed to Compact. All three hook sites now take a thunk that
  resolves the live binding at call time. Introduced by the `history.js` and
  `drum.js` extractions; found by Codex on review of the next one.

### Changed

- **The annotation lanes now live in `src/annotation-lanes.js` (R2, step 16).**
  1,678 lines — the tone lane, the anchor lane and the handshape lane, which
  were a contiguous tail of the `main.js` IIFE. `main.js` is down to 16,078.
  They travel together because they lean on each other: the handshape lane
  positions itself off `_anchorLaneTopY`, and both it and the anchor lane share
  `_currentAnchorArr`. `main.js` keeps the canvas event routing and forwards to
  the `on*LaneMouse*` handlers.
  Four of its symbols travel back — `draw`, `hideContextMenu`, `snapTime`,
  `_editorPromptText` — and arrive through `setLaneHooks()`. `snapTime` stays
  behind because its onset-snap path reaches the onset cache; `_editorPromptText`
  stays because it owns a modal and the shared `_editorPromptCancel` handle.
  `TONE_LANE_H` moved to `geometry.js`, joining `ANCHOR_LANE_H` and `HS_LANE_H`.
  The tones modal's three `window.*` handlers became exported functions that
  `main.js` re-attaches — a top-level `window.x =` throws when the module is
  imported under node.


- **The drum editor now lives in `src/drum.js` (R2, step 15).** 714 lines out of
  `src/main.js`, which is down to 17,757 — the largest single lift of the split
  so far. It carries the lane/density model, the limb-lint memo, the drum
  geometry and hit-test, `_drumEditorDraw`, and the `@pure:drum-cmds` undo
  commands. `main.js` keeps what genuinely belongs to it: the mouse/drag handlers
  that construct those commands, the toolbar buttons, the GM-percussion name
  table, and the MIDI-tempo import flow — which is about tempo, not drums, and
  was only sharing the section banner.
  Three symbols travel back the other way (`draw`, `drawWaveform`,
  `updateArrangementSelector`) and would close a cycle, so they arrive through
  `setDrumHooks()`, matching `setHistoryHooks()` and `setCanvas()`. The
  `typeof S` / `typeof editGen` guards in `_drumLimbConflicts` existed only to
  keep the block eval-able in a test sandbox; real imports make them dead.
  All four drum suites now import the real module rather than regex-slicing it,
  and `drum_limb_lint`'s two source-locks on the memo key became one behavioural
  assertion: bump `editGen`, the memo must recompute.


- **`EditHistory` now lives in `src/history.js` (R2, step 14).** 121 lines out of
  `src/main.js`, which is down to 18,471. The 47 command classes stay put — they
  are interleaved with the feature code that constructs them and each reaches
  deep into it; only the stack lifts cleanly. Commands were always duck-typed
  (`exec`, `rollback`, and the three opt-out flags), so nothing about them had to
  change.
  `history.js` imports `S`/`bumpEditGen` from `state.js` and the view predicates
  from `keys.js`. Its remaining three main.js symbols — `_historyEnsureArr`,
  `draw`, `updateStatus` — cannot be imported back without closing a cycle, so
  they arrive through `setHistoryHooks()`, the same shape as `canvas.js`'s
  `setCanvas()` and `geometry.js`'s `setLaneMetrics()`. The three duplicated
  read-only-roll checks in `exec`/`doUndo`/`doRedo` collapse into one `_locked()`.
  Thirteen suites used to slice the class out of `main.js` and hand it a
  fabricated `S`, with `_rollReadOnly` stubbed to a boolean. They now import the
  real class, seed the real `S`, and drive the real lock through real view state
  (`tests/_history_env.mjs`). That turned up a stubbed lie: a keys-DATA part in
  the roll had been forced read-only in `roll_position_cycle`, when a keys part
  is never read-only. Six of them were CJS and are now `.mjs`.

### Fixed

- **Opening a song from the library card or the 3D highway left an invisible
  wall over the canvas.** `window.editSong` calls `showScreen('plugin-editor')`
  and `loadCDLC(filename)` in the same tick. The screen activation arms the
  entry landing on a `setTimeout(…, 80)`, which asks *"is anything loaded?"*
  only when it fires — so any load still fetching at that moment loses the race,
  and nothing ever took the landing down again (its own buttons were the only
  `remove()` call sites). A large feedpak therefore finished loading underneath
  a `fixed inset-0 z-50` overlay.
  That would be merely ugly if the overlay were inert. It is not: `mousedown` is
  bound to the canvas while `mousemove` is bound to `document`, so the overlay
  swallowed every click while the cursor still updated — a note's right edge
  would show `ew-resize` and then refuse to grab. Now a load in flight suppresses
  the landing, and starting one dismisses a landing already up.

- **Sustain edge-drag was unusable in the piano roll.** `hitNote` branches on
  `isKeysMode()` and resolves a note to its sounding-pitch row via `midiToY`;
  `hitNoteEdge` did not — it always computed `y` from `strToY(n.string)`, the
  fretted lane band. So the resize grab zone sat on the wrong rows in the roll,
  even though the call site documents that edge-drag resize *"applies directly
  even in the read-only fretted roll (V4)"* — a duration edit is pitch-preserving
  and passes the roll's edit lock. The cursor hint was gated on the same stale
  band, so `ew-resize` never appeared there either.
  Both now go through one shared `_noteRect`, and the cursor band uses
  `_beatBarTopY()`, which is correct in both views. Two functions computing the
  same rectangle two different ways is why they drifted.
  Found by CodeRabbit while `src/hit-test.js` was being extracted (#160).

### Added

- **ESLint on the `src/` module graph (#158).** The module playbook's per-repo
  lint, added because of two bugs during the R2 split that `node --test` (86/86
  green) missed: `MIN_NOTE_W`/`NOTE_PAD` used after they moved to `geometry.js`
  without an import — loud, and the headless harnesses did catch that one — and,
  silently, `typeof _coverageEditGen === 'number' ? _coverageEditGen : 0`
  surviving the counter's move, so two memos keyed on a constant `0` and never
  invalidated. Nothing caught the second.
  `no-undef` with **`typeof: true`** catches both. That option is off by default:
  plain `no-undef` deliberately ignores `typeof x`, which is exactly the second
  bug's shape.
  The 32 pre-existing violations were the editor's own `window.editorX = …`
  functions being called bare, relying on window properties being implicit
  globals. They are now called as `window.editorX(…)`. `showScreen` and
  `alphaTab` really are host-provided and are declared as globals.
  `no-unused-vars` runs as a **warning** (10 today): a few declarations are
  reachable only from tests that slice them out of the source text, so erroring
  would mean deleting code the suite covers. It ratchets down as those tests move
  to real imports.
  ESLint runs via `npx` in its own CI job, so the repo keeps **zero
  `node_modules`** — `feedback-desktop`'s `copy_plugin()` does `cp -R "$src/."`
  and strips only `.git`, so a devDependency here would ship into the packaged app.

### Changed

- **ES-module migration, step 13 — suggested-mark persistence and the roll lock
  notice (R2).** `main.js` 18,671 → 18,565. The suggested-position mark
  persistence (`_suggestedCount`, `_saveSuggestedMarks`, `_restoreSuggestedMarks`
  and the `@pure:suggest-marks-persist` pures) joins the `WeakSet` it reads in
  `src/notes.js`; `_rollLockNotice` joins `_rollReadOnly` in `src/keys.js`, which
  now imports `setStatus`.
  `suggest_position_persist` loses its sandbox entirely — everything it tests is
  an import — and `suggest_position_wiring`'s env now shares the real `S` with
  `_suggestedCount` rather than fabricating its own.
  Also removes a comment left truncated mid-sentence in `main.js` when the
  `WeakSet` moved out in step 9b; its rationale lives in `notes.js` now.
  This shrinks `EditHistory`'s coupling to `main.js` from four symbols to three
  (`_historyEnsureArr`, `draw`, `updateStatus`) ahead of extracting it.

- **ES-module migration, step 12 — fretboard position math (R2).**
  `src/position.js` (`main.js` 18,802 → 18,671): `_absolutePitch`, the
  `@pure:position-cycle` pures (same-pitch candidate enumeration and stepping)
  and the `@pure:suggest-position` pures (enumerate → pick, given the anchor, the
  previous note and which strings already ring). Pure arithmetic over open-string
  pitches, tuning and capo — it imports **nothing**, another root of the graph.
  `_absolutePitch` deliberately omits the capo (it only ever compares two pitches
  on one arrangement, where the capo cancels); `_soundingPitchPure` in
  `src/lanes.js` adds it exactly once. Composing the two therefore cannot
  double-count, and the module header now says so where both live.
  Five suites retargeted. `suggest_position` drops its sandbox entirely, and
  **`fret_key_highlight` is now fully real-import** — it was the first suite this
  refactor touched, back when it still regex-sliced two `@pure:` blocks and
  brace-extracted a third function.

- **ES-module migration, step 11 — the tempo-grid converter (R2).** `src/beats.js`:
  `beatOf` / `timeOf`, the one musical-beat ⇄ seconds mapping (charrette §1.1).
  Pure — it takes the grid as an argument and touches nothing else, so it imports
  nothing. 38 call sites, none of which changed; `main.js`'s only added line is the
  import.
  `@pure:beat-converter` was the second-most-sliced block in the suite: **six**
  suites concatenated it into sandboxes. All six now take the real functions —
  `beat_converter` and `beat_lock` import them outright, and `beat_primary`,
  `compose_transport`, `loop_beats` and `loop_undo_mode` inject them into the
  sandboxes they still need for `TempoMapCmd`/`TempoGridCmd` and the loop helpers
  that remain in `main.js`.

- **ES-module migration, step 10 — hit testing, shortcuts, and the status line
  (R2).** Three modules, `main.js` 19,339 → 18,852.
  `src/hit-test.js` — `hitNote` / `hitNoteEdge`, the pointer→note resolution and
  the sustain-resize grab zone. It had **zero** dependencies left in `main.js`
  once the earlier tiers landed. `src/shortcuts.js` — the two shortcut profiles
  (FeedBack native / EOF legacy), their key→command maps, the right-click
  behaviour that rides on the profile, localStorage persistence and the
  shortcut-panel renderer. `src/ui.js` — `setStatus`, four lines and ~180 call
  sites; it exists so `shortcuts.js` needn't drag the whole of `main.js` behind it.
  `editorShortcutProfile` and `editorRightClickBehavior` are live `export let`
  bindings: reassigned, but every writer moved with them, so `main.js`'s read
  sites are untouched. The two `window.editorSet*` handlers become plain exported
  functions, with `main.js` keeping the `window.*` surface `screen.html` calls
  (§V) — which also keeps `shortcuts.js` importable under node.
  `eof_shortcuts` becomes a pure real-import suite and `bookmarks` a hybrid.

- **ES-module migration, step 9b — the painters (R2).** `src/draw.js` (`main.js`
  19,963 → 19,340): the lane and grid backgrounds, beat bar, section-coverage
  strip, the fretted and piano-roll note painters, cursor and marquee, plus the
  song-key highlight state they consult and `canvasH`. `drawNow()` — the per-frame
  orchestrator — stays in `main.js` and calls in, so the edge is one-way and no
  injected seam was needed. `drawWaveform` stays too: it paints the onset-strip
  and bookmark overlays, which live in `main.js`.
  The suggested-position mark `WeakSet` moves to `notes.js` (it is note metadata),
  and the note-body constants `MIN_NOTE_W`/`NOTE_PAD` join `geometry.js`.
  **`_coverageEditGen` is now `editGen` in `state.js`.** It was never a drawing
  concern: three memos key on it — the coverage strip, the chord-at-cursor readout
  and the drum-limb lint — because an in-place note-time move keeps the notes
  array's identity *and* length, so a cheap cache key cannot see the change.
  `EditHistory._afterEdit()` calls the exported `bumpEditGen()`, since a counter
  cannot be written across a module boundary.
  Five more suites leave the slicer path (`section_coverage`,
  `suggest_position_persist`, and the three suggest-mark sandboxes now inject the
  real `WeakSet`); `key_highlight_hoist` keeps its source-shape assertions and
  reads `src/draw.js`.

- **ES-module migration, step 9a — the render surface (R2).** `src/canvas.js`:
  the `<canvas>` element, its 2D context, and `DPR`. `canvas` and `ctx` are live
  `export let` bindings whose sole writer, `setCanvas`, moved with them — so the
  ~410 read sites across `main.js` are untouched and none of them can assign one.
  `init()` becomes `if (!setCanvas(document.getElementById('editor-canvas'))) return;`.
  This also fixes a latent staleness: the old code re-read the element on every
  `init()` but only ever built `ctx` once, so a host that replaced the canvas node
  would have left `ctx` pointing at the old element's context. `DPR` is guarded
  with a `typeof window` check so `canvas.js`, and everything downstream of it,
  stays importable under node.

- **ES-module migration, step 8b — the keys / piano-roll model (R2).**
  `src/keys.js` (`main.js` 20,127 → 19,963, under 20k): which view a part opens in
  (`viewFor`, `isKeysMode`, `isKeysArr`, `_rollReadOnly`) and the persisted
  per-part preference behind it, plus the roll's own MIDI⇄y geometry
  (`midiToY`/`yToMidi`, `pianoLaneCount`, `noteToMidi` and friends, `midiToFreq`,
  `PIANO_OCTAVE_COLORS`, `KEYS_PATTERN`) and the sounding-pitch context that lets a
  fretted part render read-only in the roll (`_rollPitchCtx`, `_rollMidiForNote`).
  `_rollLockNotice` stays behind — it calls `setStatus`.
  `PIANO_LANE_H` and `pianoRange` follow the step-5 rule rather than step-4's: they
  are reassigned, but their sole writer `updatePianoRange` moved with them, so they
  are live `export let` bindings — no container, no rename, and importers get a
  `TypeError` if they try to write.
  Four more suites leave the slicer path. `view_switcher` is the notable one: it
  used to re-evaluate `_viewPrefs`/`viewFor`/`isKeysArr`/`updatePianoRange` from
  source inside a sandbox with a fabricated `S` and a stub `localStorage`. It now
  drives the real module against the real `S`, installs the stub on `globalThis`,
  and reads `pianoRange` back through the namespace — which is what proves the live
  binding updates for importers.

- **ES-module migration, step 8a — the open-string pitch model (R2).** The
  string→pitch half of the lane model joins `src/lanes.js`: `_GUITAR_OPEN_MIDI` /
  `_BASS_OPEN_MIDI` (module-private), `_openMidiForArr`, and the
  `@pure:fret-pitch` helper `_soundingPitchPure`. They belong with the code that
  already knows bass-vs-guitar and string counts, and `main.js`'s only change is
  two more names on its `lanes.js` import.
  `@pure:fret-pitch` was the most-sliced block in the suite. All five consumers
  now take the real function: `fret_key_highlight` (down to one brace-extract),
  `suggest_position`, `roll_position_cycle`, `suggest_position_move` and
  `view_switcher` — the last four inject it into their sandboxes rather than
  concatenating its source. New cases in `tests/lanes.test.mjs` cover
  `_openMidiForArr`, which had no test at all: extended low strings a perfect
  fourth apart, the 6-string bass appending a high C instead of extending
  downward, and capo-added-exactly-once.

### Fixed

- **Chord-template save path (#152).** Three pre-existing data-integrity bugs,
  surfaced by CodeRabbit while extracting `src/chords.js` and each verified by
  running the real module.
  - `relinkChordTemplate` stored `frets.slice()` verbatim, so a preserved
    template arriving 6-wide stayed 6-wide on a 7/8-string chart (reachable via
    `buildHandshapeChordIdMap`'s preserve-append, which hands it a template
    straight off the wire), and a non-finite fret slot rode through untouched.
    It now stores the width-normalized row — the same fold `_fretKeyForL`
    already applied for the lookup key, and the same padding `fingers` always
    got. One fold, one source of truth.
  - `arp: !!(old && old.arp)` turned the **string** `"false"` into `true`.
    `_safeWireBool` — which lives in that same module for exactly this reason —
    is now used, so a hand-edited or legacy sloppak carrying `arp: "false"`
    can't switch arpeggio on across a load→save round-trip.
  - A chord reduced to a single note left `_fromChord` and `_chordId` on the
    survivor. They're cleared alongside `_fn`. (None of the three could reach
    disk — the backend's `_note()` whitelists the keys it writes — but `_fn` is
    read back by `_groupFn`, so a stale one would be adopted by majority vote if
    that note were later dragged into a chord. The comment there claimed the
    delete was about the wire; it isn't.)

  Not a bug, checked and closed out: `time: cn.time || ch.time` in
  `_flattenArrChords` does not drop first-beat notes. Chord-member `time` is
  absolute, so a chord on beat one has `cn.time === ch.time === 0`.

### Changed

- **ES-module migration, step 7 — chord templates & handshapes (R2).**
  `src/chords.js` (`main.js` 20,601 → 20,160): the chord load/save round-trip —
  `flattenChords`/`_flattenArrChords`, the whole `@pure:chord-relink` helper set
  (`relinkChordTemplate`, `_buildPreservedTemplates`, `buildHandshapeChordIdMap`,
  `dropOrphanedHandshapes`, `remapHandshapeChordIds`, the sanitizers and
  `_groupFn`), `reconstructChords`, the handshape wire-coercion helpers, and the
  handshape dirty-count trio (`_ensureHandshapes`, `_bumpHandshapesDirty`,
  `_handshapesAreDirty`, lifted out of the Handshape-lane section). Reads `S` and
  `lanes()`; no DOM. `main.js`'s whole diff is deletions plus the import block.
  The three tests that had blocked this move are reworked. `chord_relink` becomes
  a plain real-import suite; `handshape_authoring` becomes a hybrid (imports the
  chord-template helpers, still slices `_handshapeSpanFrets`, which stays in
  `main.js`). `suggest_position_wiring` — the one that mattered — used to feed
  `reconstructChords` a **fabricated `S` and a `lanes: () => 6` stub**. It now
  drives the real `S` from `state.js` and the real `lanes()`, and asserts
  `lanes() === 6` for its fixture rather than asserting it by fiat.
- **ES-module migration, step 6 — the note/chord pure tier (R2).** `src/notes.js`
  (`main.js` 20,763 → 20,601): the active-arrangement accessors `notes()`/`chords()`
  (204 and 35 call sites, none of which changed), plus the pure arithmetic over
  them — chord-aware sustain resizing, bend-curve authoring (`bendPresetCurve`,
  `sanitizeBendCurve`, `rescaleBendCurveToPeak`, `BEND_INTENTS`) and the
  teaching-mark options (`FRET_FINGER_OPTIONS`, `nextUnusedStrumGroup`). Reads `S`;
  no DOM, no undo history.
  Four more suites stop slicing `@pure:` blocks out of source: `chord_resize`,
  `bend_shape` and `teaching_marks` become plain real-import tests, and
  `roll_edge_resize` becomes a hybrid — it still slices the `edit-history` block
  and the `ResizeSustainCmd`/`ResizeSustainGroupCmd` classes that remain in
  `main.js`, but takes the resize arithmetic from the module. New
  `tests/notes.test.mjs` pins the accessors' empty-arrangement guard and that they
  return the live array rather than a copy.
  `@pure:chord-relink`, `reconstructChords`, `flattenChords` and the handshape
  normalizers stay in `main.js` for now: they are entangled with `S.history`, and
  three sandbox tests drive them against a fabricated `S` that a real import would
  bypass. That rework is its own step.
- **ES-module migration, step 5 — canvas geometry (R2).** `src/geometry.js`
  (`main.js` 20,799 → 20,764): the time⇄x and string⇄y mappings every draw and
  hit-test path goes through (`timeToX`/`xToTime`, `laneToY`/`yToLane`,
  `strToY`/`yToStr`), the lane metrics they read (`WAVEFORM_H`, `LANE_H`,
  `BEAT_H`, `LABEL_W`, `ANCHOR_LANE_H`, `HS_LANE_H`), and the scroll-bound
  arithmetic. Reads `S` and the lane model; no DOM.
  **No renames, unlike step 4's `LC`.** The three lane metrics are reassigned on
  every resize, but their only writer — the lane-sizing arithmetic inside
  `resizeCanvas()` — moves with them as `setLaneMetrics(canvasHeightPx)`. ES import
  bindings are *live* and read-only, so `main.js`'s ~100 read sites keep reading
  the current value verbatim and none of them can write it. A container was needed
  for `LC` only because its writers (`draw()`, `onMouseMove()`) must stay behind.
  `tests/scroll_bounds.test.mjs` — the last `@pure`-block slicer among the
  coordinate helpers — now imports the real module. New `tests/geometry.test.mjs`
  pins the mappings (inversion, clamping, gutter offset) and the live-binding
  contract itself: `setLaneMetrics` updates what importers see, importers get a
  `TypeError` if they assign, and `laneToY` tracks a resize rather than capturing
  boot-time metrics.
- **ES-module migration, step 4 — the string/lane model (R2).** `src/lanes.js`
  (21,036 → 20,800 lines in `main.js`): how many strings the active arrangement
  has (`_stringCountFor`, `lanes`, `_seedExtendedStringsFromTuning`),
  what they're called (`laneLabels`), how a string index maps to a display lane
  (`strToLane`/`laneToStr`), and what colour it paints (`colorForLane` +
  `STRING_LABEL_COLORS`, now module-private). Reads `S`; no DOM.
  **First reassigned-scalar lift in the editor:** the per-frame lane cache was
  three module-scope `let`s (`_lanesCacheActive` / `_lanesCacheValue` /
  `_laneLabelsCacheValue`) that `draw()` and `onMouseMove()` both write. ES import
  bindings are read-only, so they move onto one exported container `LC`
  (`.active` / `.value` / `.labels`) — the shape the stems pilot used for its
  `SH`/`ST` lifts. Purely mechanical: `main.js`'s only additions are the import
  block and that rename.
  Two more suites drop their brace-counting source extractors and import the real
  functions: `bass_string_count.test.mjs` (which had been re-declaring its own
  `const MAX_LANES = 8`) and `strings_modal.test.mjs` (which now injects the real
  `_stringCountFor` into its sandbox instead of concatenating its source text).
  New `tests/lanes.test.mjs` drives `lanes.js` against the real `S` — extended-range
  label rows, the string⇄lane involution, label-keyed colour, and the `LC` cache
  contract that `draw()`/`onMouseMove` depend on.
- **ES-module migration, step 3 — the state lift (R2).** The canonical edit-state
  object `S` moves verbatim from `src/main.js` into `src/state.js` (21,036 →
  20,945 lines); `main.js` gains exactly one line, `import { S } from './state.js'`.
  No call site changes across its 1,831 `S.` references: the editor already kept all
  edit state on a single `S` object (constitution §I), and `S` is never reassigned —
  only its properties are — so a read-only import binding is exactly right. This is
  the keystone every later extraction needs, since almost every remaining cluster
  reads `S`. The `S.snapIdx` default is now pinned by an assertion in
  `tests/snap_options.test.mjs` (`SNAP_OPTIONS[S.snapIdx].label === '1/4'`) rather
  than by a comment — inserting a snap option ahead of `1/4` without bumping the
  default now fails the suite.
- **ES-module migration, step 2 — the first pure extractions (R2).** Two leaf
  modules split out of `src/main.js` (21,176 → 21,036 lines), bodies moved
  verbatim: `src/snap.js` (the snap-resolution table + subdivision arithmetic)
  and `src/theory.js` (pitch-class names, `SCALE_INTERVALS` membership,
  Krumhansl–Schmuckler key detection, scale-degree labels/colours). Both are
  pure — no DOM, no editor state — and neither imports anything.
  Their six test suites stop regex-slicing `@pure:` blocks out of source text
  and **import the real modules** instead (`*.test.js` → `*.test.mjs`); the
  `@pure:snap-options` / `scale` / `key-detect` / `scale-degree` markers are
  retired with them. `tests/fret_key_highlight.test.mjs` and
  `tests/chord_at_cursor.test.mjs` are hybrids — they still slice the
  `@pure:fret-pitch` / `@pure:chord-id` blocks that remain in `main.js`, but
  compose them against the real `src/theory.js`.
  A root `package.json` (`npm test` → `node --test`) makes the org's reusable
  CI run `.mjs` suites, which its bare `tests/*.test.js` glob would otherwise
  skip silently; `src/package.json` (`"type": "module"`) scopes ESM to `src/`
  so the 76 remaining CommonJS test files keep working unchanged.
- **ES-module migration, step 1 — the bootstrap flip (R2).** `screen.js` is now a
  one-line `import './src/main.js'`; the IIFE body moved verbatim to `src/main.js`
  (`git mv`, sha256-identical). `plugin.json` declares `"scriptType": "module"` +
  `"minHost": "0.3.0-alpha.1"`. No `document.currentScript`/worklet/relative-asset
  URLs (all `/static` + `/api/plugins/editor/...` absolute), and the ~190 inline
  `window.*` handlers keep working in module scope. The 82 JS tests now read
  `src/main.js`. **Re-init caveat (R2's key risk):** the editor is written for
  re-injection (`window.__editorScreenTeardown` + per-injection `init()` guard); a
  module loads once, so that teardown path no longer fires on re-entry — the
  leave/re-enter behaviour is validated on-device, and a `screen:changed`-based
  re-init hook will be added iff needed.

### Added
- **Beat-lock — pin a hand-verified sync point.** Lock a Tempo-Map sync point
  (press **S**, or right-click the pole → **Lock sync point**) and its time
  becomes **immune to global tempo re-fits** — detect-tempo / sync-to-audio,
  metric modulation, and measure BPM re-space now hold every locked anchor and
  **interpolate the grid around it** (each run between fixed points is
  affine-remapped, so the song ends still carry the tempo change and no beat is
  ever pushed before the start). Locked poles render **emerald** on the beat
  bar. This is the guard that makes the beat-primary model safe for placing
  notes by ear before the grid is trusted: a nailed passage can't be walked off
  by a later global tempo op. A re-fit that would push a locked anchor out of
  order **releases that one anchor** (it rides the interpolation) so the grid
  stays **strictly monotonic** — never a backwards beat that would corrupt the
  `beatOf`/`timeOf` lookup. Sync-to-audio **reprojects notes from their beats**
  so they stay on a locked grid instead of drifting near the anchor. Locks are
  a **per-filename editor preference** (localStorage `editorBeatLocks:<filename>`),
  restored on load — **never written to the pack**. Tests:
  `tests/beat_lock.test.js`.
### Fixed
- **Vertically re-pitching a chord in the roll can't double-book a string.**
  `_rollDragPitchMove` resolved each dragged member independently against the
  strings *not* in the drag set, so two members could land on the **same**
  string at the same time — at save `reconstructChords` does
  `frets[string] = fret` and silently dropped one member. Members are now
  resolved **sequentially** in ascending target pitch (ties keep drag order):
  each resolved member's chosen string joins the occupancy the later members
  see. A member the resolver refuses still HOLDS and contributes no occupancy.
  Test: `tests/suggest_position_move.test.js`.
- **Suggested-position marks now survive save + reload.** Marks lived only in a
  module `WeakSet` keyed by note-object identity, so a save's
  flatten/`reconstructChords` rebuild and a reload dropped every mark — the
  machine's unreviewed guesses rendered as CONFIRMED and "positions
  unresolved: N" reset to 0. Marks now persist to `localStorage`
  (`editorSuggested:<filename>:<arrIdx>`, stable `{time,string,fret}` identity,
  never in the pack — mirrors beat-lock) and re-attach onto the rebuilt note
  objects on load, on arrangement switch, and post-save reflatten. Keyed per
  arrangement so marks don't bleed across parts; flushed before an arrangement
  switch so an accepted mark isn't resurrected; and Save-As migrates the keys to
  the new filename so the new file's guesses stay honest.
  Test: `tests/suggest_position_persist.test.js`.
- **Mass-moving notes no longer "loses" most of the selection — the group
  moves rigidly.** Dragging a multi-note selection snapped each note's
  absolute time independently, so with snap on (the default) only the notes
  already near a grid line crossed it — the rest snapped back and appeared
  not to move, and the selection's internal timing was silently destroyed
  (tester: "only a few of selected notes get moved"). The drag now snaps the
  grabbed note's target **once** (`_groupTimeDeltaPure`) and applies that
  single delta to the whole selection, clamped so the earliest note can't
  cross `t=0` — rigid, with spacing preserved. Also adds DAW-style grid
  unlock: **hold Alt while dragging to move free of the grid** (vertical
  stays semitone/string-quantized). Tests: `tests/group_move_snap.test.js`.
### Fixed
- **Compose transport: final guide clap plays, and A/B never mutes claps
  without a recording.** The content-bound compose length now pads a small
  tail past the last authored onset so its guide clap rings out instead of
  being cut by `stopPlayback()` (explicit lengths stay exact). And A/B compare
  is treated as inactive with no reference buffer, so compose-mode loops keep
  every clap rather than gating half of each pass to silence.
- **`_ensureAudioCtx` no longer throws when Web Audio is unavailable.** It
  detects a missing `AudioContext`/`webkitAudioContext` first and returns
  `null`, leaving `S.audioCtx` unset so `startPlayback`/`loadAudio` hit their
  `!S.audioCtx` guards instead of a `new undefined()` TypeError.

### Changed
- **Loop edges follow the grid by beat (bar/grid loops).** A bar or grid loop's
  edges are now anchored to **beat coordinates** — like `note.beat` — with their
  seconds as a derived cache, so a tempo edit keeps the loop on the same bars
  instead of re-snapping it, and undoing a tempo edit restores the loop's
  position **exactly**. A tempo *flex* keeps the loop's beats and re-derives its
  seconds (`_loopReprojectFromBeats`); a grid *re-index* (insert/delete
  sync-point, time-sig) keeps the loop's seconds and re-lifts its beats
  (`_loopReliftBeats`) — the same lift/reproject rule notes follow. **Free loops
  are unchanged** (absolute seconds; a grid edit never moves them). Because both
  operations are exact inverses, this deletes the lossy `_loopRelockAfterGrid­Change`
  re-snap and the `TempoMapCmd`/`TempoGridCmd` `beforeBarSel` undo-snapshots that
  only existed to work around it. Loop-in-3D still bakes to seconds (core
  `setLoop` unchanged). Tests: `tests/loop_beats.test.js`, `tests/loop_undo_mode.test.js`.
- **Beat-primary note model.** A note's musical **beat** (a float) is now the
  runtime truth and its **seconds** are a derived cache regenerated by
  `timeOf(beat)` whenever the grid changes. On load every timed object (notes,
  chords + chord notes, anchors, hand-shapes, phrases, sections, drum hits)
  lifts a `beat` from its seconds (`_liftAllBeats`); a tempo flex reprojects
  **every** part from its beat (`_reprojectAll`), and the save body strips the
  beat cache so the wire stays seconds-only (`_stripBeatsFromSaveBody`) — no
  spec change. A snapped note keeps its exact subdivision, an off-grid note its
  fractional beat, and both follow the beat on a flex, so a tempo edit can no
  longer silently corrupt note timing. This retires the whole `tempoRideScope`
  machinery (the drum/all/per-part "which notes ride the grid" picker, its
  Ctrl+T toggle, and the `_applyTempoRemap`/`_captureScopedTimes` remap walk):
  under total reprojection there is no ride choice left to get wrong. Gated by a
  golden test proving lift+reproject reproduces the old all-parts remap to 3 dp
  before any legacy code was deleted. Tests: `tests/beat_primary.test.js`.
- **Exact tempo-flex undo.** Undoing a tempo flex now restores each note's
  original seconds verbatim instead of reprojecting them through `_r3`, so a
  sub-millisecond note placement (e.g. `1.23456 s`) survives edit→undo→save
  instead of quantizing to `1.235 s`. Tests: `tests/beat_primary.test.js`.
- **Typing a BPM on a variable tempo map offers to flatten it.** When a
  song carries a variable tempo map (multiple per-measure tempos — e.g. a
  bad import), the BPM field previously just refused with "Use Tempo Map to
  edit songs with multiple tempo events." It now offers to **flatten the
  whole map to that one constant BPM** (`_tempoFlattenToBpmPure`): the beat
  grid is rebuilt at an exact `60/bpm` spacing (measure/time-signature
  metadata and the first beat's start time preserved), notes keep their
  times so they stay aligned to any audio, and the whole change is one
  undoable `TempoGridCmd`. Fixes the tester report that there was "no way to
  remove all the BPM sync points without deleting measures." Exact (unrounded)
  spacing so the result reads as perfectly constant to the variable-tempo
  detector. Tests: `tests/tempo_flatten.test.js`.
- **One tempo-map converter: `beatOf` / `timeOf`.** The musical-beat ⇄
  seconds math that the flex remapper (`_makeTimeRemap`) and `snapTime`
  each computed inline is now a single extracted `@pure:beat-converter`
  pair — `beatOf(beats, t)` (seconds → fractional beat) and
  `timeOf(beats, β)` (the inverse), exact inverses within a grid gap,
  extrapolating along the first/last gap's local tempo outside the grid,
  and the identity when the grid has fewer than two beats. `_makeTimeRemap`
  now routes interior times through the converter (it *is*
  `timeOf(new, beatOf(old, t))` within the grid) while preserving its
  legacy constant-shift on the tails, and `snapTime` snaps in the beat
  domain (`timeOf(round(beatOf(t)·subs)/subs)`). A pure refactor with **no
  behaviour change** — the shared, tested converter is the foundation the
  beat-primary note model and the Logic-style ruler/LCD read from next.
  Tests: `tests/beat_converter.test.js`.

### Added
- **Suggest-position: author fretted parts directly in the piano roll.**
  A fretted part shown in the piano roll was read-only (adding a note would
  force a silent string/fret guess). Now double-clicking — or an EOF-style
  right-click — in the roll adds by **sounding pitch**: a resolver
  (`_suggestPositionPure`) picks the string/fret (biased to the current
  fret-hand anchor window, then least hand-travel, then lowest fret) and
  writes it **marked "suggested"** (dimmed + dashed until you confirm), or
  opens a confirm popover when the choice is genuinely ambiguous
  (open-vs-fretted, out of the hand window, every string occupied). Dragging
  a fretted note vertically **re-pitches** it through the same resolver,
  holding position when a technique locks the fret or the pitch can't be
  reached. New notes land at the grid length (`_defaultAddSustain`), so you
  can drag-resize the edge instead of typing a duration. A status nudge shows
  how many positions are still unconfirmed; **✓ Accept position** clears the
  mark (undo re-marks). "Suggested" is a module `WeakSet`, never a note field
  — so nothing leaks to the wire (proven end-to-end through
  `reconstructChords`). Tests: `tests/suggest_position.test.js`,
  `tests/suggest_position_wiring.test.js`, `tests/suggest_position_move.test.js`.
- **Play, click, and guide with no recording (compose-mode transport).** The
  transport used to dead-end without a loaded recording — `startPlayback()`
  returned immediately, so a from-scratch song had no clock, metronome, or
  guide claps. Now compose mode runs a **buffer-less transport**: the playhead
  advances off the AudioContext clock with no audio source, the **grid** (not an
  audio buffer) bounds the song — its length is the time of the last beat via
  the A1 converter, extended if authored content runs past the last bar, or an
  explicit length — and the already-grid-based metronome/guide scheduler becomes
  the only sound, firing off the beat map with no audio present. Audio-present
  playback is unchanged; the two share one clock. Internally the clock-advance
  formula (`playStartTime + ctxNow − playStartWall`), previously copy-pasted at
  four call sites, is now one pure `_transportChartTimePure`. Tests:
  `tests/compose_transport.test.js`.
- **Edge-drag note-duration resize works in the read-only fretted roll.**
  A fretted part shown in the piano roll is edit-locked (no silent
  string/fret writes until suggest-position lands), but a *duration* edit
  never changes what a note sounds like — only how long it rings — so it
  now applies directly, like the position-cycle's `pitchPreserving`
  carve-out. Grabbing a note's right edge is re-enabled in the read-only
  roll, and `ResizeSustainCmd` / `ResizeSustainGroupCmd` carry
  `pitchPreserving = true` so they pass the edit lock and round-trip
  through undo/redo. Lets you tighten an imported fretted note's duration
  without switching to String view; the lock still blocks every
  pitch/position write. A group edge-drag now applies the drag delta to
  each chord member's *own* original ring-out (`sustain_i =
  clamp(origSustain_i + delta)`) instead of flattening every member to one
  value — so an imported chord whose members had different durations (e.g.
  bass 1.0, top 0.5) keeps its relative shape, and each member clamps
  independently at its own next same-string onset (one member can stop at
  its collision limit while the others keep extending).
  Tests: `tests/roll_edge_resize.test.js`, `tests/chord_resize.test.js`.
- **Snap to audio onset.** A second snap target alongside the subdivision grid:
  a **Grid / Onset** toggle by the Snap controls (and the `toggleSnapMode`
  command) switches placement between the tempo-map subdivisions and the
  nearest detected transient in the recording. This is the bridge between
  musical time and audio-attack time for by-ear transcription — grid time and
  the actual attack routinely differ by tens of milliseconds. It reuses the
  onset detector that already draws the display-only onset strip (no warp, just
  snap to the onset time), snaps onto a transient only within a ~70 ms window,
  and **falls back to grid snap** when no attack is near or none is computed —
  so placement stays sensible everywhere. Because every add/drag routes through
  `snapTime`, the mode applies to all note, drum, anchor and section placement
  at once. The choice is an editor pref (persisted locally), never written to
  the pack. Tests: `tests/onset_snap.test.js` (the `@pure:onset-snap`
  nearest-onset helper + the grid-vs-onset routing).
- **Detect key from the notes.** A new **Detect** button in the key controls
  guesses the current part's key from its pitch-class content (the
  Krumhansl–Schmuckler algorithm — Pearson correlation against the standard
  major/minor key profiles) and sets it, turning the in-key highlight on so the
  result is visible. Duration-weighted (a held note counts more than a passing
  one, with a small floor so staccato still registers) and capo/tuning-aware for
  fretted parts. It's a **suggestion, not authoritative** — the tonic/scale
  pickers stay editable — and it says nothing when a part has no notes or no
  tonal centre. Tests: `tests/key_detect.test.mjs`.
- **Scale-degree overlay on fretted notes.** With the in-key highlight on, each
  note in String view now shows a small scale-degree label in its top-right
  corner (`1`, `♭3`, `5`, `♭7`, …) relative to the current key, coloured by
  role so the **1/3/5/7 harmonic skeleton pops** (root gold, thirds sky, fifth
  green, sevenths violet) and passing tones read neutral. Out-of-key notes
  still show their chromatic degree, dimmed — so a fretted line reads as scale
  degrees at a glance. Capo- and tuning-aware (uses the same sounding pitch as
  the in-key shading); shown only while the highlight is active, and never for
  a note whose pitch can't be resolved. Display-only — it never edits the chart
  or the authored `sd` teaching mark. Tests: `tests/scale_degree.test.mjs`.
- **Chord-at-cursor readout.** A small chord name now appears next to the
  measure display, naming the notes sounding at the playhead — `C`, `Am`,
  `Gmaj7`, `D#6`, `Csus4`, `E5` (power chord), and so on. Fretted parts resolve
  to sounding pitch (capo- and tuning-aware), keys parts use their packed
  pitch; octave doublings collapse to one chord. It requires an **exact** match
  from a common triad/seventh/sus/power-chord vocabulary, so it only shows a
  name when it's certain (`—` when notes sound but form no named chord, blank
  when nothing sounds), and the **bass note breaks genuine ties** (a Cm7 voiced
  over E♭ reads as D#6). Purely a read-only readout — it never edits anything.
  Tests: `tests/chord_at_cursor.test.mjs`.
- **Drum editor: advisory playability lint.** The drum grid now flags
  physically impossible simultaneities with a small amber warning triangle on
  the offending hits plus a count in the editor HUD. Two rules, evaluated per
  near-simultaneous cluster: **3+ stick-struck pieces at one instant** (a
  drummer has two hands — feet, i.e. kick and hi-hat pedal, don't count toward
  the limit) and a **contradictory hi-hat state** (open hat together with a
  closed hat or a foot chick — the foot can't be up and down at once).
  Strictly **advisory** — it never blocks, never auto-fixes, and never mutates
  a hit; a fast roll or a flam pair stays clear because only hits within ~12 ms
  cluster. Computed once per draw over the already-sorted hits, drum-editor
  mode only. Tests: `tests/drum_limb_lint.test.js`.
- **The piano roll's left axis is now a real keyboard.** In keys/piano view
  the note-label column is drawn as an actual keyboard laid on its side —
  white/black keys shaded like the real thing (black keys inset from the front
  edge so the white tails read between them), C rows labelled with their octave,
  and separators only where two white keys meet (E–F, B–C). **Click a key to
  hear its pitch**: a gentle, hearing-safe audition voice (soft attack, low
  peak, routed through the master limiter, ~⅓-second decay) plays the row's
  equal-tempered pitch. Left-click only, so right-click still opens the context
  menu; it never adds or selects a note, and it's silent until the audio
  context is running (autoplay-gated). String view is unchanged. Tests:
  `tests/keyboard_gutter.test.js`.
- **Piano roll: cycle a fretted note through its same-pitch positions
  (Shift+↑/↓).** A fretted part shown in the piano roll is read-only — the
  roll's Y axis is pitch, so the string axis that Shift+↑/↓ walks in String
  view doesn't exist there. Rather than leave those keys dead, they now
  cycle the selected note(s) through every `{string, fret}` that sounds the
  **same pitch** on this arrangement's tuning (integer frets 0–24, ordered
  low string → high, wrapping). It only ever changes WHERE a pitch is
  played, never the pitch, so it runs through the existing `MoveToStringCmd`
  (one undo step, full round-trip) and is the one deliberate carve-out from
  the read-only-roll lock — flagged `pitchPreserving`, everything else stays
  locked until suggest-position editing lands. Multi-select cycles each note
  independently and skips notes with only one position; a corrupt or
  out-of-range position refuses rather than guessing. Fretted notes in the
  roll now render in their **string's lane color** with an `s·f` position
  chip (instead of the octave color + note name, both redundant with the Y
  axis), so a cycle step is visible as a color flip at a fixed height.
  Tuning-aware: Drop-D, capo (cancels — chart frets are capo-relative on
  both sides), and re-entrant tunings all enumerate correctly. Tests:
  `tests/roll_position_cycle.test.js`.
- **MIDI import can adopt the file's own tempo map.** Importing a `.mid` as
  keys or drums used to bake note times but throw the file's tempo and
  time-signature grid away — every import landed with an implied 4/4 and no
  bars. Now the keys/drums MIDI import reads the SMF's real grid (via core's
  `convert_midi_tempo_map`, feedback #796) and, when it carries one, offers a
  **Use MIDI tempo map / Keep project timing** choice. The default is honest,
  never silent: **Use** when the project has no bars yet, **Keep** when a
  timeline already exists (so an audio-aligned grid is never stomped). Applying
  runs through the existing `TempoGridCmd` — one undoable step that re-locks the
  loop onto the new grid — and imported notes stay accurate either way. Degrades
  cleanly: a gridless MIDI, a GP import, or an older host without the core
  function simply shows no prompt. On a drum import the timing choice is offered
  before the unmapped-notes triage so the two dialogs never stack. As part of
  this, `TempoGridCmd` is now correctly **song-scoped** (like the drum commands),
  so a grid edit is no longer blocked when a fretted part happens to be shown
  read-only in the piano roll. Tests: `tests/midi_tempo_import.test.js`,
  `tests/test_midi_tempo_import.py`.
- **Parts can be renamed (undoable).** A ✏ button next to the arrangement
  selector (registry command `renamePart`) renames the current part
  through a new `RenameArrangementCmd` — full undo/redo, selector text
  follows, and the stable manifest `id` never changes, so view prefs and
  the manifest merge survive. Unblocked by the merge-not-rebuild save:
  a rename no longer strips the entry's `type`/unknown keys. One honest
  hard limit: the NAME still drives kind inference (keys → piano roll +
  notation, `bass` → 4-lane layout, `drums` → drum routing), so a rename
  that would change the inferred instrument is refused with an
  explanation — silently re-laning a 6-string chart as a bass would
  strand notes on invisible strings. Duplicate names (case-insensitive)
  are refused per the pack name discipline. Tests:
  `tests/rename_part.test.js`.
- **Drum grid row density: Full / Compact.** A new toggle on the drum
  editor (and registry command `toggleDrumDensity`) collapses the 18
  per-piece rows into the community 7-row family shape — crash / hi-hat /
  ride / toms / floor toms / snare / kick, mirroring core's `PRESET_RB4`
  family boundaries — so the backbeat reads at a glance on small screens.
  Strictly a render/selection grouping: hits keep their real piece-ids and
  per-piece colors (a compact row shows its members distinctly), every
  piece stays on exactly one row (collapsing can never hide data), adding
  in a compact row writes the family's canonical piece, a time-only drag
  keeps the hit's original piece, and crossing rows assigns the target
  family's canonical. Full mode is byte-for-byte today's grid. Editor
  pref, never pack data. Tests: `tests/drum_density.test.js`.
- **Read-only Tab preview of the current part.** A new **Tab…** toolbar
  button (registry command `showTabPreview`) opens a modal that renders
  the active fretted part as engraved tab, reusing the Tab View plugin's
  arrangement→GP conversion endpoint and the same pinned alphaTab CDN
  render idiom (player disabled — no soundfont download; the engraving
  lays out once per load, never per frame, and tears down on close).
  Honest about its source: the endpoint reads the **saved** pack, so the
  modal says "as last saved" and offers Refresh; unsaved edits need a
  Save first. Degrades cleanly — a missing Tab View plugin, an old host,
  keys parts (their packing has no tab), and unsaved sessions each get a
  specific message instead of a blank panel. Strictly read-only: the
  String view stays the fretted editor; this is a proofreading lens.
  Tests: `tests/tab_preview.test.js`.
- **Loop A/B compare — the ear-training loop.** A new **A/B** transport
  toggle (Alt+B, both profiles) alternates each loop pass between the
  RECORDING (reference audible, claps off) and the GUIDE (reference muted
  through the mixer's transparent gain, claps on — even if the claps pref
  is off), so a charter hears what they charted against what the artist
  played, one pass apart. Every (re)start begins on the recording pass;
  phase flips ride the loop wrap with the mixer's ~20 ms ramp (never a
  pop); stopping mid-guide-pass always restores the reference to its
  fader level; clearing the loop region disarms A/B; session-only state
  that resets on song load — a persisted mute would read as a playback
  bug later. Arming A/B with a region set but looping off also arms the
  loop. Tests: `tests/loop_ab.test.js`.
### Changed
- **Live MIDI record now uses the host's `midi-input` capability domain.**
  The record path called private `navigator.requestMIDIAccess` while the
  rest of the org converged on `window.feedBack.midiInput` (one permission
  prompt, one shared source list, refcounted device sessions, PII-redacted
  diagnostics) — a flagged compat drift, now closed. The domain is
  preferred whenever the host ships it; older hosts fall back to the
  private Web-MIDI path unchanged, and both deliver raw bytes into ONE
  routing function so capture behavior is byte-identical. The domain
  session pre-opens when the record modal opens (and on device change) so
  the Start click stays synchronous — the user-gesture constraint that
  keeps the transport anchor honest — and the shared session is
  ref-released on modal close, never yanked from other consumers. Tests:
  `tests/midi_domain.test.js` (backend selection, picker normalization,
  and on/off/velocity-0/channel-filter/sustain-pedal routing equivalence).
### Added
- **Per-part view switcher: any fretted part can open in the piano roll
  (read-first).** The editing view was derived from the arrangement NAME —
  keys parts got the roll, everything else the lanes, no choice. A new
  String · Piano roll switcher makes it a per-part preference (editor
  localStorage keyed by song + stable part id — reorder/rename safe; never
  pack data; keys parts stay piano-locked since their wire packing has no
  string semantics to show). A fretted part in the roll renders at
  **sounding pitch** (open string + tuning + capo + fret) with the same
  mapping across draw, hit-testing, marquee select, and the viewport
  auto-fit, and the in-key row shading applies automatically. Fretted
  parts in the roll are **read-only for now** (a visible notice says so):
  every command entry point is gated centrally in the undo history plus
  the live-mutating drag paths, because adding or moving by pitch would
  force a silent string/fret guess — editing arrives with the
  suggest-position resolver. Under the hood the historical `isKeysMode()`
  split into a piano-SURFACE predicate and a keys-DATA predicate
  (`isKeysArr`), and data-semantics sites (string moves, chord-sibling
  grouping, anchors) were re-pointed — a fretted part in the roll still
  groups its chords and keeps its string-move machinery. Registry command
  `cycleViewMode`. Tests: `tests/view_switcher.test.js`.
- **The in-key highlight now covers the fretted lanes.** The song key/scale
  picker's highlight applied only to the piano roll; guitar/bass notes now
  dim when out of key too, resolving each note to its **sounding pitch =
  open string + tuning offset + capo + fret** via the new
  `_soundingPitchPure` helper. The capo is added exactly **once** — chart
  frets are capo-relative, matching core's single source of the formula
  (`lib/song.py pitch_from_base`, shared by the tuner and the highway's
  scale-degree derivation) — and `_absolutePitch` (string-moves) still
  deliberately omits it, now documented as a pair so composing the two
  can never double-count. Out-of-key notes dim (never redden —
  chromaticism isn't an error) and unresolvable pitches stay fully lit;
  the Key controls now show for any pitched arrangement, not just keys.
  Tests: `tests/fret_key_highlight.test.mjs` (including the capo-flips-
  membership case an uncapoed resolver gets wrong).
- **Parts can be reordered.** New ‹ / › buttons next to the arrangement
  selector (registry commands `movePartEarlier` / `movePartLater`) move
  the current part one slot at a time; each end disables its direction so
  the affordance always tells the truth. The order persists — sloppak
  saves ship the client arrangement array as the full snapshot and the
  manifest merge keys entries by id. Reordering renumbers arrangement
  indices, so the undo history resets (the same rationale as
  remove-arrangement — which is also why a move isn't undoable: move it
  back). Blocked mid-recording (a take pins its arrangement index).
  Tests: `tests/reorder_part.test.js`.

### Fixed
- **Saving no longer strips `type` / `centOffset` / unknown keys from manifest
  arrangement entries.** The full-snapshot save path rebuilt every manifest
  arrangement entry from scratch (`{id, name, file, tuning, capo}`), silently
  dropping spec fields the editor doesn't author — `type` (§5.2), `centOffset`,
  and any future additive key — on every save, violating the format's
  unknown-key preservation rule (§1.2). Rebuilt entries now merge onto the
  existing entry for the same id, with editor-owned keys taking the fresh
  values. Tests: `tests/test_manifest_type_preserve.py`.
- **Editing one keys note no longer discards GP notation for the whole
  arrangement.** GP-sourced notation (exact per-stave hand assignments,
  dynamics, pedal events, fingering, grace notes) was kept only while a
  fingerprint of ALL notes matched — so a single piano-roll edit invalidated
  the entire sidecar and the save fell back to the heuristic lift, silently
  re-guessing the hand split and dropping every GP-only attribute in every
  measure. The save now performs a **measure-granular merge**: measures whose
  `(time, midi)` note content still matches the current wire keep their GP
  measure objects verbatim; only edited measures take the freshly lifted
  measure. The merged payload is schema-validated and re-stamped; any grid
  misalignment — or a merge that preserves zero measures (e.g. a
  transpose-all) — falls back to the full lift (the old behavior), so a
  100%-heuristic relift is never stamped as GP-sourced. Tests:
  `tests/test_notation_preserve_merge.py`, `tests/test_notation_save.py`.
- **The `.bak` safety copy now rolls with every save.** It was written only once
  (the first time a pack was overwritten), so a user editing a pack over weeks
  kept a first-ever-save recovery point that grew staler with every save. Both
  overwrite sites (the editor save and the build/save-as path) now refresh the
  `.bak` to the current on-disk pack before overwriting, so the backup is always
  the previous save, one step back. Best-effort: a failed backup copy never
  blocks the save. Tests: `tests/test_rolling_backup.py`.

### Added
- **Infer-once arrangement `type` stamping.** On save, an arrangement entry with
  no `type` gets one inferred from its display name (keys-family → `piano`, bass
  names → `bass`, classic guitar roles → `guitar`) — conservative on purpose:
  vocals/drums/ambiguous names stay untyped, and an authored `type` is never
  clobbered. `type` is the queryable instrument facet the spec defines; display
  names stay free labels — groundwork for safe track renaming in the Parts view.

### Changed
- **Tempo-ride scope is now a per-part checklist.** The Tempo Map's binary
  "Drum tab / All instruments" ride toggle gains a third **Per part…** mode:
  a checklist with one row per arrangement plus the drum tab itself, so a
  hand-verified part can sit out a grid re-warp while everything else rides
  (the prerequisite for multitrack import, where the binary switch becomes
  corrupting). Presets behave exactly as before and still persist; the
  checklist is session-only (its indices are song-shaped) and resets to the
  conservative drum-only preset on song load. Ctrl+T still cycles the two
  presets. Under the hood `TempoMapCmd` now freezes the full ride set —
  drum flag + exact arrangement objects — at construction, so flipping the
  checklist between an edit and its undo can never desync capture / remap /
  restore; sections continue to ride in every scope, and archive saves are
  still limited to the active arrangement. Tests:
  `tests/tempo_ride_parts.test.js`.
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
- **Audio mixer popover with recording / guide / click faders, first-play
  fade, and an edit-preview blip.** A new **Mix** toolbar button (Shift+C,
  both shortcut profiles) opens a small popover with three level faders:
  the reference recording (a new transparent gain node — still never routed
  through the guide limiter), guide claps, and the metronome click (both
  already behind the limiter). Levels persist as editor prefs, apply with a
  ~20 ms `setTargetAtTime` ramp (never a stepped jump mid-audio), and the
  defaults preserve the shipped balance exactly. Hearing safety: the first
  play of each loaded recording fades it in from ~30% over 0.35 s, so an
  unexpectedly hot recording is reached, never jumped to — the guard re-arms
  on every new load (`loadCDLC`, create/import, and replace-audio all funnel
  through `loadAudio()`), not just the session's first song. The popover also
  hosts the new **edit blip** (on by default, toggleable): a soft 1320 Hz
  tick — pitched apart from the 1750 Hz guide clap — confirms note **adds
  and pitch changes** (fret set/adjust, string moves, pitch-changing drags)
  summed straight into the shared limiter (so muting guide claps never also
  silences the edit cue); time-only moves and marquee selects stay
  silent, group edits rate-limit to one cue, and the blip never fires when
  the audio context isn't running. Tests: `tests/audio_mixer.test.js`.
- **Numbered bookmarks (Alt+1–9).** Nine per-song time markers for hopping
  between working spots in a long chart: **Shift+Alt+1–9** sets/clears a
  bookmark at the cursor (setting one at its own spot clears it), **Alt+1–9**
  jumps to it, and numbered green flags render over the waveform band.
  Matching is on the physical key (`e.code`) so the shifted digit row works
  on any layout; plain digits still set frets. Bookmarks are editor
  authoring state — one localStorage entry per song, never pack data.
  Tests: `tests/bookmarks.test.js`.
- **Follow-playhead is toggleable (Shift+L).** The playback auto-scroll
  (view jumps once the cursor crosses 80% of the window) was unconditional;
  it is now a registry command in both shortcut profiles, default ON, so an
  author can pin the view on one passage and edit while the song plays on.
  Editor pref only. Tests: `tests/follow_toggle.test.js`.
- **Drum velocity is authorable.** Velocity always rendered (brightness/
  height) and imported from MIDI, but authoring wrote a hardcoded `v:100`
  with no way to change it. Now: **Alt+vertical-drag** on selected hits
  edits velocity live (piano-roll idiom — up is louder, 1 step/px, one undo
  step per drag), **Shift+↑/↓** nudges the selection ±10, and **A / N**
  quick-set accent (115) / normal (100), all through a new undoable
  `SetDrumVelocityCmd` that restores authored dynamics verbatim on undo (a
  hit that had no explicit `v` gets the field deleted again, not set to
  100). The **G ghost toggle now pulls a normal-strength hit down to the
  ghost velocity (35)** — a ghost is a quiet hit by definition (import
  derives `g` from `v < 40`), so ghosting a `v:100` hit no longer authors a
  contradiction; already-quiet hits keep their authored dynamics,
  un-ghosting leaves velocity untouched, and undo restores the exact
  flag+velocity pair. The unmapped-notes import dialog also stops
  flattening dynamics: hand-mapped notes carry their source velocities
  through when the server captured them (`velocities` index-aligned with
  `times`; older cores simply omit it) instead of pushing `v:100`.
  Tests: `tests/drum_velocity.test.js`.
- **The Strings modal is tuning-aware: per-string tuning entry + explicit
  add/remove ends.** Each string row gains a **direct offset input**
  (semitones from the lane's standard pitch, ±36, undoable via the new
  `SetStringTuningCmd` which captures its target arrangement so undo
  survives an arrangement switch), so drop tunings, open tunings, and
  **re-entrant/octave setups** are typable without changing the string
  count. Add/remove is now surfaced as separate low/high buttons, but each
  is enabled **only at the end the instrument's extended-range model
  supports** (guitar grows low B→F#; bass grows low B then high C) — adding
  or removing at the unsupported end silently re-snapped the string count
  and re-labelled every note, so those combinations are refused in both the
  UI and the handlers. Removal still refuses any end string that carries
  notes. Tests: `tests/strings_modal.test.js`.
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
- **Song key/scale + in-key highlight for the piano roll.** A Key control
  (tonic + scale/mode) and an **In-key** toggle appear in the toolbar when a
  keys arrangement is active. With the highlight on, out-of-key rows get a
  neutral desaturating wash and out-of-key notes are dimmed in the piano roll
  — so you can see at a glance what sits inside the key while transcribing,
  with nothing hidden or flagged as wrong (no red; chromatic notes stay fully
  visible and editable). Thirteen scales/modes ship: major, the seven diatonic
  modes, harmonic/melodic minor, major/minor pentatonic, blues, and chromatic
  (which shades nothing, for atonal passages). The key is a per-song editor
  preference (localStorage, never the feedpak) and the highlight a global one;
  both are view aids, not chart data. Groundwork for reading authored key
  regions (keys.json) in a later pass. Tests: `tests/scale_membership.test.mjs`.
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
- **Duplicate selection (Ctrl+D).** Copies the selected notes to the next
  position — one selection-length later, so a chord or single note moves one
  grid step and a multi-note phrase moves by its own span — and leaves the
  copies selected, so repeating Ctrl+D tiles a riff forward. Interior timing
  is preserved (the whole selection shifts by one offset, never re-quantized),
  so a swung or syncopated phrase duplicates with its feel intact. Runs as one
  undoable command; gated to note-edit mode (skipped in drum-edit / Tempo Map
  and while typing in a field), and preventDefault keeps the browser's bookmark
  shortcut from firing. Joins the command registry (findable in the shortcut
  panel + command palette). Tests: `tests/duplicate_selection.test.js`.
### Added
- **Edit a note's start time from the inspector.** The selection inspector now
  has a **Time (s)** field alongside Sustain, so you can type a precise onset
  to align a note to the recording (down to the millisecond) instead of only
  dragging. Applies to every selected note as one undoable command.

### Fixed
- **Inspector sustain edits are undoable.** Setting Sustain from the inspector
  mutated the notes in place with no undo entry — a mistyped value couldn't be
  taken back with Ctrl+Z. Both inspector numeric edits (Sustain and the new
  Time) now route through the editor's undo history (`ResizeSustainGroupCmd` /
  `MoveNoteCmd`). Tests: `tests/inspector_time.test.js`.
### Added
- **Section completeness strip.** A thin band along the top of the lane area
  tints each section by whether the active arrangement has any notes in it —
  an at-a-glance "where is this chart still empty" while working through a
  long song. Ambient and neutral by design: a gentle blue where there's
  content, a faint wash where there isn't — no percentage, no red, nothing
  to click. Drawn under the existing section lines/labels. Tests:
  `tests/section_coverage.test.js`.
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
  Tests: `tests/snap_options.test.mjs`.

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
