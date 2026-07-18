# Changelog

All notable changes to the Arrangement Editor plugin are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Docs refresh — the guide walks the whole journey.** The User Guide
  (Help ▸ User Guide) opens with a six-step journey map, and §1 now showcases
  every way to start a feedpak (audio formats + YouTube, GP/MIDI/XML,
  MusicXML keys, stems, blank + arrangement chips, GoPlayAlong) through to a
  pre-flight-checklisted §9 Save & Build. Fresh screenshots captured from
  current main (start landing, the create dialog with a real audio+chart
  import staged, the synced workspace, note editing); the `T` shortcut row
  corrected to the tool palette (`T,T` = Tempo Map). README rewritten as the
  repo landing page: hero shot, User Guide link up top, and a feature list
  matching what shipped (track sessions + mixer console, click tools, keys
  hands, canvas appearance, stems).

### Added
- **New Track — one front door for adding tracks, including from scratch.**
  Testers couldn't add an instrument track without importing a GP file (the
  only blank start was buried inside the Add-Keys modal). The three toolbar
  buttons (+ Drums / + Keys / + Guitar-Bass) consolidate into a single
  **＋ Track** entry — toolbar, a **＋** atop the Tracks column, and
  **Track ▸ New Track…** — opening one DAW-style dialog: pick **Audio** (files
  become studio tracks via the stem manager) or **MIDI / Transcription**
  (Lead / Rhythm / Bass / Keys / Drums), started **empty** or imported **from
  a file** (the old per-kind modals live on as the file flows). New blank
  starts: fretted arrangements (Lead/Rhythm 6-string, Bass 4-string, named
  uniquely, registered with the session, adopted as the active part) and an
  empty Drums tab (the create-flow shape; refuses a second drum tab). The
  User Guide's Tracks section documents the flow.
- **Map-health worklist: H / Shift+H walk the drifting bars.** In Tempo Map
  mode, H jumps to the next amber/red bar from the playhead (Shift+H goes
  back), wrapping at the ends — each landing arrives the same way the grid
  pill does: Tempo Map open, the bar scrolled into view, Suggest anchored on
  its downbeat. Fix a bar, press H, land on the next: map refinement becomes
  a triage loop instead of a full-song scrub.
- **GM roll — a piano-roll layout for the drum editor.** Tester ask ("no
  piano roll for drum MIDI"): the Rows toggle gains a third mode after
  Full and Compact. GM roll lays one row per piece on its General-MIDI
  percussion note, pitch-descending top→bottom like a piano roll (57
  Crash R at the top, 36 Kick near the bottom; the no-GM stack sinks
  last), each label prefixed with its GM note number — the layout a
  drummer coming from a DAW already knows. Same grid, same piece-ids,
  same editing and colors in every mode (the view-modality one-data-path
  rule): only row order and labels change. The preference persists like
  the other density modes. It is also the dropdown's **Piano roll** entry for
  drum tracks (below), so drums advertise their layouts in the same place
  fretted tracks do.
- **Drums reach view parity: Drum grid · Piano roll · Notation.** With the
  GM roll and the view dropdown both in place, the drum editor's dropdown
  now lists all three layouts — `Piano roll` selects GM-roll density, so the
  drum piano roll is discoverable where users look for views instead of only
  behind the Rows button. Full/Compact stay on Rows (they're densities of the
  kit-ordered grid; GM roll is the pitch axis), and returning to `Drum grid`
  restores the density you came from rather than resetting to Full. Both
  controls route through one setter, so they can't drift apart. Drums now
  match fretted tracks' vocabulary: instrument geometry → pitch-ordered →
  engraved.
- **Tab and Notation join the view switcher — now a dropdown.** The live
  engraved score existed but was reachable only through the view-cycle
  shortcut and the View menu — the top-right switcher showed just
  String | Piano roll and didn't even update while the lens was on. It's
  now a per-track **view dropdown**: String view · Piano roll · Tab ·
  Notation · **Notation + Tab** (every staff profile an explicit option,
  so the selected value always tells the truth, lens included). The
  engraved options vanish for drum tracks (which have no tab), keys stay
  piano-locked, and returning to String/Piano roll drops the lens
  cleanly. The User Guide's view list documents all five.
- **Drum-editor parity: Notation for drums.** In the drum editor the same
  dropdown offers **Drum grid / Notation** — the live lens engraves the
  drum tab on a percussion staff (alphaTex `\instrument "percussion"`,
  articulation ids per piece; kick-and-hat chords group, hits on pieces
  with no notation symbol are skipped and counted, never silently
  dropped). Clicking an engraved beat selects its hits in the drum grid
  and seeks. The drum-editor mode stays on underneath the lens, so
  switching back to Drum grid restores it with all its state.
- **The master mix can be muted (and soloed, and faded) from the Tracks
  pane.** The master row used to carry no inline strip — its controls lived
  only in the mixer drawer. The pane now mirrors the drawer: same M/S/fader,
  same canonical mix state, and the master keeps its output-bus semantics
  (its own mute silences it; another track's solo never does).
- **The master mix is a channel strip in the mixer.** Every audio source now has
  a vertical strip in the mixer drawer — the master mix leads the audio band
  (matching the DAW console), followed by the stems, then the MIDI parts and the
  SOURCE/GUIDE/CLICK/MASTER buses. Its fader, mute, and solo are real: the active
  source's reference playback now routes through its own per-source gain before
  the SOURCE submix, so riding the master strip actually changes its level. The
  Tracks pane also exposes the same master fader, mute, and solo controls
  inline, so the pane and mixer drawer share one canonical mix state.
- **Click a track to chart against it.** Selecting an audio track (the master
  mix or any stem) in the Tracks column now makes it the **active source**:
  the main waveform shows that track and the onset tools (Suggest, snapping)
  analyze it — so you can line the grid up against an isolated stem. Playback
  is unaffected: every source keeps playing together; only what you *see* and
  *analyze* follows the click.

### Fixed
- **A Guitar Pro import whose first track is empty no longer loses the beat
  grid.** The create flow read the song timeline (beats/sections/length)
  blindly from the first converted track's XML — and a lyrics-only GP vocal
  track converts to an empty XML, so charts with a vocal track listed first
  imported grid-less: notes present but no beats, with the entire Tempo Map
  surface silently hidden (its button gates on a ≥2-beat grid). The timeline
  is now read from the first track that actually carries a grid.
- **Horizontal scrolling works before the first Play in MIDI-only sessions.**
  A session with no decoded audio only learned its length inside
  `startPlayback()`, so until the user pressed Play once the scroll clamp saw
  a 0-length song and pinned the view to the start — wheel, middle-drag pan,
  and the minimap all refused to scroll left/right, then mysteriously cured
  themselves after the first Play. The clamp now falls back to the same rule
  playback uses: the grid / authored content bounds the song. Audio-bounded
  sessions keep their exact old clamp.
- **Deleting the drum transcription is undoable — and no longer wipes the
  whole undo stack.** The Tracks column's drum delete used to blank the drum
  tab in place and reset undo history entirely, so one confirm click could
  strand an hour of edits with nothing to undo. It is now a single history
  command: Ctrl+Z brings the drums back (same tab object, mixer strip,
  stem pairing, and tree placement included), and every earlier edit keeps
  its undo.
- **A deleted drum transcription stays deleted after Save.** The save body
  only shipped `drum_tab` when it was non-null, so a delete never reached
  the backend's explicit-removal path — the pack kept its `drum_tab.json`
  and the drums resurrected on the next load. A dirty null now ships as the
  removal wire.
- **Saving a from-scratch song now works — Save builds it.** A create-mode
  session (New… → GP/MIDI import or blank draft) used to dead-end on Save with
  "Only sloppak-format sessions can be saved" (or the baffling "drum_tab can
  only be saved to sloppak-format songs" when the import brought drums): the
  `/save` route only writes over an existing library pack, and a new song has
  none yet. Save (Ctrl+S), Save As, and the close-guard's "Save" now route a
  create-mode session through the build — the pack lands in the library as
  `<Title>_<Artist>.feedpak` (repeat saves overwrite in place), the build
  clears the unsaved-changes flag, and `/build` records the filename on the
  session so Save As can export a copy to the picked file. The backend `/save`
  rejection is now an actionable message pointing at Build for older clients.
- **A failed Save As no longer strands a 0-byte `.feedpak`.** The native
  picker creates the file the moment the destination is confirmed, so a save
  that then failed left an empty husk where the user expected their song. The
  husk is now removed after a failed save — only when the file is genuinely
  empty, so overwriting an existing pack never risks its bytes.
- **Save As suggests the real name for a new song.** A create-mode session has
  no filename yet; the picker used to suggest `song.feedpak`. It now derives
  `<Title>_<Artist>.feedpak` — the same name the build writes.
- **Audio stem lanes now draw their waveforms.** The per-stem waveform builder
  was handed the decoded `AudioBuffer` instead of its channel `Float32Array`, so
  every sample read `undefined` and the peaks collapsed to ±Infinity — the lane
  painted off-canvas and looked empty. It now reads `getChannelData(0)` at the
  master's ~3 ms/bin resolution, so each stem lane shows its shape like the mix.
- **Parity pass against the DAW track-session design.** The backend now sends
  `audio_sources` with the master's pack-authored name (from the manifest
  `full` mix) and per-stem display names, and the stem cache filename carries
  a per-source index so two stem ids that sanitize alike can't overwrite each
  other's audio. Deleting a transcription track from the Tracks context menu
  now finishes its cleanup (its `editorRemoveArrangement` reports success
  again); clicking an audio LANE on the canvas focuses that source like its
  header row does; cycling the tempo guide respects the 🔒 lock and resets a
  new guide to plain audio analysis; the header-strip fader regained its
  +6 dB range; a removed audio track drops its stale mixer state.
- **Tempo guide + Tracks column reliability.** The Master row and the tempo
  guide could vanish (guide read "No guide") because audio sources were
  derived from `S.audioUrl`, which active-source switching reassigns to a
  focused stem and which isn't set yet at load — the master now rides the
  stable `S.masterAudioUrl`. The master track defaults to the **song name**
  (not the generic "Master Mix"), and the guide label follows a track's
  inline rename. The mixer channel strips now **reorder to match a drag in
  the Tracks column** (and rename with it).

- **Keys hand authoring** (the hand arc, Step B). The per-note `hand` field is
  now editable and visible:
  - **Note ▸ Hand (keys)**: Left / Right / Clear on the selection — one undo
    step.
  - **Track ▸ Assign hands by split… (keys)**: a STAMPING generator (never a
    live layer): pick a split note (default C4; note names or MIDI numbers),
    and every targeted note gets `lh` below it / `rh` at-or-above in ONE
    undoable command (new `SetTechScalarPerNoteCmd`). Selection scopes the
    stamp; per-note edits win from then on.
  - **Hand shading on the piano roll** (View ▸, default on): LH notes draw
    warm, RH cool; unassigned notes keep their octave color so "no call made"
    never reads as an assignment.
  - **A hand edit now refreshes the saved notation's hand split**: `hand`
    joins the notation fingerprint (the one technique that does), so a
    preserved authored sidecar can't freeze old hands over an edited chart —
    the relift honors per-note hands (core `split_hands`, PR #992). One-time
    effect: previously stamped payloads re-fingerprint on their next save and
    take the measure-granular merge (unedited bars keep their authored
    hands).

- **MusicXML keys imports keep their authored grand-staff hand splits** (the
  keys LH/RH hand arc, slice A). The import no longer deletes the authored
  notation payload: it is offset-shifted alongside the notes, stamped
  `source:"musicxml"` + a note-fingerprint at add-arrangement time, carried on
  the arrangement, and preferred over the heuristic `notation_lift` on save —
  exactly the existing GP-sidecar rail, whose source check now accepts both
  authored sources (provenance is preserved on re-stamp, never rewritten to
  `"gp"`). Requires the musicxml_import plugin's new `parse-arrangement`
  endpoint (its PR #8); without it the MusicXML path stays "plugin not
  installed" as before.
- **Per-note `hand` field for keys arrangements** (`techniques.hand`,
  `'lh'`/`'rh'`, absent = unassigned): registered in `_NOTE_TECH_FIELDS`
  (string-valued — never in the bool set; absent default `None`), emitted on
  the save wire under the spelled-out key `hand` (`rh` is taken by
  right_hand), strictly validated to the enum, folded into the arrangement
  content signature, and it survives `reconstructChords` because it rides
  `techniques`. MusicXML imports arrive with it pre-filled from staff
  provenance (staff 1→`rh`, 2→`lh`; other staves stay unassigned). Known
  tracked follow-ups: core's sloppak loader must learn the field for
  reload round-trips (core PR), and `split_hands` doesn't yet respect per-note
  overrides — this lands with the hand-aware lift slice. (A hand EDIT now
  invalidates a preserved authored notation sidecar: `hand` joins the
  notation fingerprint, per the hand authoring change above.)

- **View ▸ Canvas appearance… — customizable grid & canvas** (community ask:
  beat grid lines were invisible on some screens; the request was Live-style
  customization, not just a brighter constant). Four live sliders — **Grid
  lines** (strength of beat/measure lines and lane separators, 25–400%),
  **Brightness**, **Color intensity**, and **Hue** — applied to the canvas's
  STRUCTURAL palette only: string colors, drum piece colors, note,
  selection, and playhead colors never restyle. Settings are a global editor
  preference (`editorCanvasAppearance`); adjusted colors are cached per
  settings generation so draw cost is a map lookup. New `src/canvas-appearance.js`
  palette module; lanes/grid/gutters (draw.js), drum lanes, and the parts
  overview now read from it.
- **Brighter default grid** — beat lines were `#16162c` at 0.5 px (the
  invisible-grid report); the defaults are now `#20203e` at 1 px for beats and
  `#32325c` for measures, with the slider scaling from there.

- **Click tools — the Logic-style pointer-tool system.** Press **T** to open a
  tool palette at the cursor (like Logic's Tool menu); the next key picks the
  left-click tool: **Pointer** (V, today's behavior), **Pencil** (B — Live
  Draw Mode semantics: click empty canvas adds a snap-quantized note with no
  dialog, click a note deletes it; also exactly EOF's right-click edit),
  **Eraser** (E), **Marquee** (M — rubber-band even starting on a note),
  **Mute** (U), **Scissors** (C — split a sustained note at the click).
  Shift/Ctrl-click always reverts to pointer semantics, so selection stays one
  modifier away in every tool. Palette keys are live only while it's open —
  no global-bind collisions.
  - **Per-profile T semantics**: FeedBack/Cableton — **T,T = Tempo Map** (the
    old plain-T habit survives as a double-tap; in tempo-map mode a single T
    still leaves). Logical — **T,T = Pointer** (Logic-exact), and **plain G
    enters Tempo Map** (Logic's G = global tracks; that profile's snap toggle
    stays in the Grid toolbar/menu). Legacy (EOF) — **zero key changes**
    (plain T stays Tap); the palette lives in View ▸ and the command palette.
  - **Cableton: plain B toggles the Pencil** — Live's Draw Mode key (that
    profile's bend edit stays in the inspector/menu).
  - **Right-click feature parity**: the shortcut-panel right-click setting
    extends from context-menus / EOF-edit to any tool (`Pencil` / `Eraser` /
    `Marquee` / `Mute` / `Scissors`) — the same executor as the left button,
    so a tool can never mean different things on different buttons.
- **Split notes at playhead** (Edit ▸, command palette): splits every selected
  note spanning the playhead — or all spanning notes with no selection — via
  the new undoable `SplitNotesCmd`. Technique distribution is music-aware:
  the bend family stays with the first half (onset-relative), slide targets
  and link-next move to the second (end-of-note verbs), whole-note marks
  (palm mute, accents, the keys hand) copy to both. The Scissors tool is the
  click form of the same command.

### Changed

- **The mixer is now a proper DAW console.** The docked side panel is
  replaced by a bottom **drawer of vertical channel strips** — one per
  audio stem and transcription part — each with a **live level meter**
  (peak/clip readout on a dB scale) beside a vertical fader, over the
  **SOURCE / GUIDE / CLICK** utility buses and a dedicated **MASTER**
  output strip. **Every fader — channel strips, the utility buses, and the
  master — carries +10 dB of headroom** (0–100 is linear to unity, 100–110
  adds up to +10 dB on the same curve everywhere), so a quiet stem or bus
  can be pushed up and no fader has an inert zone; every fader reads its
  level in dB. The strip matching the selected track
  lights up. The recording joins the master bus post-limiter, so it's
  metered and master-trimmed but never colored. (The vestigial edit-blip
  toggle is gone.)

### Fixed

- **An unsaved project no longer inherits another new project's barline
  locks.** Beat-locks for a song with no filename yet were all stored under
  one shared key, so locks set while charting one new import reappeared on
  the next — now an unsaved project persists no locks and starts clean.

### Added

- **Studio stems now play.** Multitrack stems sound *alongside* the master
  recording, sample-aligned through seeks, loops, and audio-shift, each
  with its own mute / solo / volume on its Tracks-column row (and in the
  mixer panel). It's one mixer: a stem and a synth part obey the same solo
  rule — soloing one silences the others, while the master recording always
  stays audible. **Solo my source track** now works: it isolates the stem
  the current part was charted against. Each stem's lane draws its own
  waveform. (Known limits: while audition speed is slowed below 100%, stems
  stay silent — they resume at full speed; and the transport ends with the
  master recording, so a stem that runs longer than the master — or is pushed
  past the master's end by a positive offset — is cut off there.)

- **The Tracks area — a DAW-style track column.** The persistent track tree
  is now a surface you can see and arrange: a resizable header column beside
  the timeline lists every track (the master mix, studio stems, and each
  transcription part), with the canvas drawing a matching lane for each row —
  the two always line up. Reorder tracks and group them into folders by
  drag, rename inline, resize a lane's height, and pair a transcription with
  its studio stem right from its row. Mute/solo/volume on a transcription
  ride the same mixer state as the mixer panel. Double-click a track to open
  it in its native editor; a stem's row-menu can lock it as the metronome
  guide. Removing an audio track is non-destructive — the media stays in the
  pack. The area is the workspace's landing surface for any loaded song.

- **Bulk barline locks + friendlier Tempo Map selection.** Lock or unlock a
  whole selection in one go: the tempo toolbar's new lock button (and the
  `S` key, and the right-click menu) names exactly what it will do — "Lock
  12 barlines" — applies one uniform state to the group (lock all unless
  every one is already locked), and lands as ONE undoable edit that never
  creates a false Save prompt (locks stay an editor preference). Selection
  got friendlier too: **Ctrl/Cmd-click** toggles individual barlines, the
  marquee focuses where your drag ended, selections are uncapped, and the
  marker lane is split — direct edits (pole grabs, sub-beat rubato) live in
  the top handle band while the tall lane body below belongs to marquee
  selection, with the thin full-height barline itself still precisely
  draggable anywhere.

- **Metronome guide + whole-song tempo fits.** A click or reference stem can
  be locked as the session's **tempo guide** (the ♩ button in the Audio
  tracks manager): assisted mapping (`G`) then analyzes that track instead
  of the main mix, treating each click as one beat — so tempo changes in
  the click are followed directly, and the guide role persists with the
  song. `G` on ordinary audio now proposes all the way to the final
  authored barline too: the onset-supported prefix keeps its measured
  confidence, and everything past a confidence break continues as visibly
  low-confidence, editable estimates that are never committed on their own.
  A new **Accept Whole Fit** button (and command) takes the entire proposal
  — including the open final measure, whose interior beats now ride the
  accepted tempo instead of staying on the old grid — as ONE undoable edit.
  The fit's anchor is always the focused barline, locked or not; a stale
  multi-selection no longer resets analysis toward the beginning or caps
  the march. In the click-track engine, a locked barline keeps its authored
  time without disturbing the pulse walk, so one stale lock can't
  phase-shift every later suggestion.

- **Tracks are now first-class, persistent objects.** A song's tracks — the
  master recording, studio stems, and every transcription part, optionally
  grouped into folders — form one ordered tree the editor remembers across
  save and reopen (the `editor_track_session` manifest extension key).
  The tree layers over the canonical song data: it references arrangements
  and stems by the same keys the stem pairings already use, so nothing is
  stored twice — pairing stays in `editor_stem_links`, per-track mix stays
  session state. Removing an audio track is non-destructive (the media
  stays in the pack; the track can be restored), and the tree records
  which audio source is the session's tempo reference. This slice is the
  data-model and persistence foundation for the unified Tracks surface
  described above.
### Fixed

- **Undo after adding a phrase now undoes the phrase — not your previous edit.**
  Adding a phrase (Shift+P) was the one structural add that bypassed the undo
  history, so pressing Ctrl+Z afterward silently rolled back whatever you did
  *before* the phrase (a note move, a fret change) and left the phrase in place.
  A phrase add is now its own undoable step like every other add, so undo/redo
  stays truthful.

### Changed

- **Escape now clears the selection.** In note and drum editing, Escape drops
  the current note/drum selection — the standard DAW gesture, previously inert
  outside tempo-map mode. It stays layered under every existing Escape owner
  (open dialogs, the read-only preview/guide lenses, and tempo-map's own
  Escape handling all still win first), and it changes no data, so it never
  touches undo.
- **Sustain shorten/lengthen has keys in the default profile.** `[` and `]`
  now shorten and lengthen the selected note's sustain by one grid step in the
  FeedBack profile — the commands existed but were only bound in the Legacy
  (EOF) profile, so default-profile users had no keyboard way to edit note
  length. In tempo-map mode the bracket keys stay the beat-count controls.
- **Clicking one note of a chord now selects one note (in the DAW profiles).**
  Clicking a chord in a guitar/bass part used to grab the whole strum, which is
  surprising in a piano-roll-style editor. Selection is now profile-driven, like
  the right-click behaviour: **FeedBack / Logical / Cableton select the single
  note** under the cursor; **Legacy (EOF) keeps the whole-strum unit** (EOF
  treats the position as atomic). **Alt-click always does the opposite** — grab
  one note or the whole chord either way — and sustain-resize follows the same
  rule so a click and an edge-drag never disagree. A **Chord click** toggle in
  the shortcut panel pins it regardless of profile. Piano-roll parts are
  unchanged: same-time notes there are independent voices and always select one.

- **Assisted tempo mapping trusts a bridged gap once the far side confirms.**
  When Suggest marches across a sustained or held bar (no attack to snap to),
  it keeps going on prediction but marks those bars very low confidence — and
  used to leave them there even after the next bar snapped cleanly, proving
  the marched path was right. Bars bridged BETWEEN two confirmed hits now get
  their confidence raised retroactively (still discounted, never outranking a
  real hit), so the ghost markers over a held chord read as "probably right"
  instead of "guessing". A trailing march that never re-confirms keeps the
  floor and is still dropped, exactly as before; a barline you locked confirms
  at full trust.
- **Slides and ties now reach the note they belong to.** A pitched slide's
  diagonal used to stop at the edge of its own note; when the next note on
  that string is where the slide actually lands, the line now runs all the
  way to it — you can see the gesture arrive. Likewise a tie (link-next) now
  draws a legato arc from the note's tail to the linked note's head instead
  of a small hook, so the two notes visibly belong to one gesture. When no
  landing is charted (or notes overlap), the old compact glyphs remain —
  the editor never draws a connection the music doesn't have.
### Added

- **New Song now uses one DAW-style track roster.** The separate “What are you
  arranging?” palette is gone. Add audio, Guitar Pro, MIDI, or XML from one
  **Add File** control and every imported track appears in one table. Multiple
  audio files upload and persist as separate stems instead of silently keeping
  only the first; one exclusive **Guide** selector chooses the audio
  source used for tempo mapping. Guitar Pro and MIDI child tracks are selected
  in the same table instead of a second picker.

- **A MIDI file is a project now.** Dropping a `.mid`/`.midi` into New Song
  used to dead-end: the file was noted, then forgotten, and Create stayed
  disabled. Now a staged MIDI alone enables Create (the title pre-fills from
  the filename), and Create opens straight into the track picker with the
  file already parsed — no re-picking. And the picker **actually unpacks
  multitrack MIDI**: every track you check imports as its own chart track,
  named after the MIDI track ("Keys — Bass, Baby."), instead of silently
  importing only the first. The MIDI's own tempo map is offered as the
  project grid as before, and the temporary placeholder track the create
  needs is cleaned up automatically once your real tracks land.
- **Import a Guitar Pro or MIDI file, press play, hear music.** Transcription
  tracks now sound out of the box, including alongside recordings and stems:
  **every track plays its instrument** (band mode defaults on), and the guide
  voice is always a real instrument — the old "clap"
- **Bring in a whole studio session — File › Audio tracks…** Import any
  number of audio tracks (wav / ogg / opus / mp3 / flac — a real session's
  multitrack, not just separated stems), then rename them, reorder them,
  delete them, and **pair each with the chart track that transcribes it**.
  Pairings are saved with the song and survive track reordering. A new
  **Solo my source track** command isolates the current track's paired
  audio while you chart against it (audible once the stem-mixer strips
  land; the pairing itself works today). Imported tracks are packed into
  the feedpak on Save (or Build for a fresh Guitar Pro/MIDI import) and
  show up as stems everywhere stems already work.

- **Drums sound like a drum kit now.** Every drum piece in the chart plays
  its real sound — kick, snares (and cross-stick), open/closed/pedal hats,
  all four toms, crashes, splash, china, ride and bell, cowbell — instead of
  a click. Works everywhere drums play: in **All tracks** band playback and
  inside the drum grid itself. Two hits on the same instant (kick + snare)
  both sound, hit velocity carries, and the kit ships inside the plugin
  (~900 KB, FluidR3) so it needs no internet. A piece whose sound is still
  loading ticks for a moment instead of going silent.

- **Import a Guitar Pro or MIDI file, press play, hear music.** Chart-only
  sessions (no recording) now sound out of the box: the guide is ON by
  default there, **every track plays its instrument** (band mode defaults on
  too), and the guide voice is always a real instrument — the old "clap"
  tick is gone as a choice and survives only as a split-second stand-in
  while a sound loads. The default instrument sounds (grand piano, clean
  electric guitar, fingered bass — FluidR3, MIT) now **ship inside the
  plugin** (~2 MB), so the first play needs no internet. Like a DAW, tracks
  stay live until muted/soloed or disabled explicitly, and those choices are
  remembered.

- **Play all tracks — the chart plays as a band, mixed by the Mixer.** The
  new **All tracks** toggle in the Mixer header (also in the Transport menu
  and the command palette) makes EVERY track voice its instrument at once —
  lead and rhythm as guitars, bass as bass, the drum grid clapping along —
  instead of only the current track's guide voice. The Tracks strips become
  a real mixer over the band: per-track volume, mute and solo ramp live
  gain nodes (~20 ms, never a pop, never a restart), with the usual DAW
  rule — mute wins, any solo isolates. The recording is untouched (its
  fader is separate, as always), instruments still fall back to a clap
  while their sound loads, and the transport now reaches every track's last
  note — a bass outro past the lead's final chord no longer cuts off. The
  choice persists as an editor preference.
- **Tempo ramps — a ritardando is ONE thing now.** Select a run of barlines
  in the Tempo Map, right-click ▸ **Ramp the range (accel/rit)…**, give it
  "start → end" BPM, and the whole gesture becomes one authored object: the
  bars re-space smoothly along a curve (a rit eases out, the natural
  release), notes ride, locked barlines hold their exact times, and one
  undo restores everything. The marker lane shows a single `rit. 140→120`
  chip instead of a spray of per-bar tempo chips. **Fit ramp to the
  recording** goes one better: it reads the onset drift across your
  selection and proposes the ramp that flattens it — the drifting-red bar
  in Map Health resolves to authored-green instead of nagging forever.
- **Tempo List (Tempo/Grid menu)** — every authored mark as text: one row
  per ramp / meter grouping / hold / feel with its bar, value, and source
  (human-confirmed vs detected vs imported). Click a row to jump to its
  bar. The chips are paint; this is the ledger.

- **Half-time / double-time is a FEEL now, not a fake tempo change.** A
  half-time chorus or double-time bridge never meant the band changed tempo
  — the *pulse tier* changed. Right-click a barline: **Half-time feel /
  Double-time feel from here** (and **Straight time from here** to end it).
  The tempo and every barline stay exactly put; instead, the metronome
  accents the *felt* pulse, Map Health expects onsets on felt beats only (a
  genuinely sparser half-time section reads green, not "missing onsets"
  grey), and the marker lane shows a green feel chip. When **Scan** detects
  the recording pulsing at twice/half your grid, the confirm bar now offers
  **the feel marker as the default** ("Half-time feel") with "Actually ½/2×
  tempo" as the explicit grid-rescue override — reading a density change as
  an octave tempo jump was a top mapping failure mode.

- **Meter groupings now teach the feel.** An authored grouping (`7/8` as
  `2+2+3`) reaches its three consumers: the **metronome accents** each
  grouping-cell start (strong-weak-strong-weak-strong-weak-weak — you hear
  where the riff resets), the **ruler** keeps the felt pulse visible (bright
  ticks on the accents at every zoom, and at far zoom the few sub-bar ticks
  are spent on the accents instead of vanishing), and **tempo suggestions
  corroborate on the felt pulse** — a candidate barline whose onsets land on
  the `2+2+3` accents now out-scores one that merely matches an even seven.
  Ungrouped bars behave exactly as before.

- **Hold / fermata bars and meter groupings — the chart can finally say what
  the band meant.** Right-click a barline in the Tempo Map: **"Hold /
  fermata this bar"** marks a bar the band holds out (a big rock ending, a
  pause before the last chorus). A held bar stops reading as a bogus tempo
  collapse: it's excluded from tempo statistics, the marker lane shows one
  amber **hold** chip instead of two spurious BPM chips, and tempo
  suggestions carry straight across it instead of chasing onsets inside the
  pause. **"Meter grouping…"** records how a compound bar is *felt* — `7/8`
  as `2+2+3` vs `3+2+2` — and the marker lane says so. Both are real edits
  (one undo step each), survive save → reopen (stored in the pack, invisible
  to apps that don't know them), follow their bar when barlines are inserted
  or deleted, and carry **provenance** — hand-set marks are recorded as
  human-confirmed, the foundation for keeping your verified work through
  future automatic re-fits.
- **Cut, and real Copy/Paste commands.** Copy and paste existed but were
  hidden hardwired keys — invisible in the Edit menu, the shortcut panel, and
  anywhere else you'd look, with no Cut at all. All three are first-class
  commands now: **Edit ▸ Copy / Cut / Paste** (Ctrl+C / Ctrl+X / Ctrl+V; the
  EOF profile keeps its Ctrl+X mute binding, so Cut is Shift+Del there).
  Paste lands the phrase's first note at the playhead — snapped to your grid
  like any other placement — keeps the internal timing intact, selects the
  pasted notes, and is one undo. Pasting across tracks now behaves: notes on
  strings the target track doesn't have are skipped and counted instead of
  written invisibly, and keys ↔ fretted pasting is refused (the note shapes
  don't translate). Undoing a cut restores the notes but keeps the clipboard,
  like every text editor.

### Fixed

- **Pasted bend curves are no longer linked to the original.** Copying a bent
  note shared the bend-curve data between the original and every paste —
  editing any one of them silently edited them all. Copies are fully
  independent now.
  choice persists as an editor preference. Band channels no longer depend on
  the legacy guide toggle; their own M/S/faders control their audible state.

- **The note-entry caret now previews the note you're about to type.** In String
  view with nothing selected, the dashed cell that marks the entry point earns
  its note shape: it's sized to the current note value (the snap step, so the box
  is exactly the footprint a typed note will fill), sits on the caret's string
  lane, and ghosts the fret it will carry — the caret shows *which* note lands
  and *how long*, not just *where*. Typed notes are placed at that same length so
  consecutive entries tile the grid instead of stacking as zero-length notes. The
  preview is a persisted view pref: **Tempo/Grid ▸ Snap ▸ Note-entry preview** toggles
  it off (and back on) for mouse-first charters who find the cell distracting.
- **Clicking the ruler snaps the playhead to the grid, Logic-style.** A scrub
  click on the timeline ruler now lands the playhead on the nearest beat /
  subdivision when snap is on (so the entry caret sits on a real note position),
  instead of seeking to the raw pixel time. Hold **Alt** while clicking for a
  free, un-snapped scrub.
- **Song Fit ▸ Re-sync from this bar on…** The drift rescue, right where you'd
  look for it. The classic trap: you set a constant tempo from a tab, but the
  band actually plays a hair slower — the chart lines up perfectly at the
  start and drifts further off the deeper you get. Now park the playhead
  where things stop matching, open **Song Fit**, pick **Re-sync from this bar
  on…**, and the editor jumps into the Tempo Map and immediately shows its
  suggested barline corrections from that bar forward as ghost markers — you
  click to accept as far as it looks right. Nothing commits until you accept,
  Esc dismisses, and as always the audio never moves: barlines re-fit to the
  recording and your notes ride along.
- **Tab view — live engraved tablature of the track you're editing.** The
  view cycle gains a third stop (String view → Piano roll → **Tab**, also in
  the View menu): the timeline becomes real engraved tab of the CURRENT
  chart, re-drawn as you edit — no saving first, no other plugin installed,
  unlike the read-only preview window (which stays, for proofreading what's
  actually on disk). **Click any beat in the tab to select those notes** and
  move the playhead there, then edit in String view or the roll as usual —
  the score keeps up. Quantization is honest about its v1 limits: positions
  engrave on a 16th grid against your tempo map (variable tempo included),
  durations read from the spacing between notes, and anything outside the
  barline span is counted in the status rather than silently dropped.
  Fretted tracks only for now; standard notation is the follow-up.
- **Standard notation in the score view — View ▸ Score staff.** Pick what
  the live score engraves: **tablature only** (the default), **standard
  notation only**, or **both staves together**. Clicking a beat selects its
  notes on every staff choice, the pick is remembered per browser, and
  choosing a staff while the score view is off switches you into it.

### Fixed

- **Select All stays inside the editor.** `Ctrl+A` / `Cmd+A` now selects the
  active chart objects without letting Chromium highlight the entire editor UI.
  Read-only Parts view and active MIDI recording also suppress page selection,
  while text inputs and inline rename fields keep their native Select All.
- **"Shift Audio…" now survives saving and reopening.** The recording-vs-chart
  shift was sent with every save but the backend silently dropped it, so a
  carefully aligned song came back misaligned on the next open — reading as
  lost work. The shift is now persisted into the pack (a manifest extension
  key, invisible to and ignored by anything that doesn't know it) and restored
  on load, through plain saves, Save As, and first builds alike. Sliding the
  shift back to zero removes it from the pack again, so unshifted songs stay
  byte-identical to before.
- **Inspector technique edits are undoable now.** Toggling a technique flag
- **Resnap selection now works with Snap toggled off — and snaps both edges.**
  "Resnap selection to grid" (Edit menu / its shortcut) honoured the live Snap
  toggle, so with snapping off it silently moved nothing — which read as the
  feature not existing at all ("I miss a way to snap the selected notes to the
  grid"). An explicit quantize now always snaps, using whatever **subdivision
  you have selected** — the same guidelines the grid draws, like the piano-roll
  grid in a DAW. And it snaps **both edges**: note starts quantise to the
  nearest guideline, and a sustained note's end edge follows — never collapsing
  onto its start (it keeps at least one subdivision), while zero-length chips
  are never inflated. One undoable step, and the status line now always tells
  you what happened, including "already on the grid."
- **Inspector technique edits are undoable now.** Toggling a technique flag
  (Palm Mute, Hammer-On, Tap, …) or setting a bend/slide value from the
  inspector panel used to mutate the note in place with no undo — so Ctrl+Z
  couldn't take it back, even though the same toggle from the keyboard could.
  Both paths now commit through the editor's undo history (the flags via the
  same command the keyboard toggles use; bend/slide via a new command that also
  carries any authored bend curve through the edit), so a technique tweak is one
  Ctrl+Z like a fret or time change. They still refuse on a read-only piano roll.
- **Author credits now match the feedpak spec.** The manifest `authors:` array
  was written as plain strings; the spec (§5.4) requires objects with a `name`
  (plus optional `role`), so string credits failed schema validation and the
  host's in-player credits overlay silently skipped them. Built packs now
  carry `{name, role: "charter"}` objects.
- **The playhead now sits on what you *hear*, not what's scheduled.** The moving
  playhead was drawn from the audio clock's *scheduled* time, which runs ahead of
  the sound actually leaving your speakers by the output latency — a few
  milliseconds on wired output, but **100–300 ms on Bluetooth headphones**, where
  the line visibly led the music. The playhead is now drawn at the
  latency-compensated position, so it lines up with what you hear at every speed
  (the reference, the metronome and the guide claps all share that latency, so
  one correction re-aligns the line to all of them). It's a **display-only**
  adjustment: note placement, snapping and edits still resolve from the exact
  transport position, and a stopped/scrubbing playhead still sits precisely on the
  waveform.

### Added

- **Scan for tempo zones — now with a confirm bar you can adjust.** **Tempo/Grid
  ▸ Scan for tempo zones…** reads the recording, finds the handful of *tempo
  intents* it plays — e.g. "3 tempo zones: 120 bpm · 140 bpm · rit 140→90" — and
  paints them as colored bands on the Tempo Map timeline with a confirm bar
  docked above. Before anything commits you can **drag a zone boundary** onto
  the real change (both neighbours keep a minimum span), **split** the selected
  zone at the playhead, **merge** it with the next (the join is described by its
  own endpoints — a real rit never flattens into a lie), cycle its **kind**
  (steady / ramp / unmapped — an unmapped zone lays no barlines), or **type its
  BPM**. A zone whose pulse read as shaky is marked with a "?" so you know where
  to look. Esc dismisses the whole proposal untouched; nothing changes until you
  confirm. Under the hood the pulse is located by autocorrelating the detected
  onsets with an octave guard + tempo prior (so it doesn't read double-time or
  half-time).
- **Confirm & refine — the zones become a grid snapped to the recording.** The
  confirm bar's main action seeds a barline grid from your adjusted zones (each
  zone's downbeat phase seeded from the kick/bass onsets), then runs the
  assisted barline fit **inside each zone** — bounded at the zone's edges, with
  the zone's tempo holding the fit on course so it can never run away chasing a
  fill the way a whole-song march can. The result lands as **one undoable
  step**: notes keep their exact timing against the recording, and a single
  Ctrl+Z restores the previous grid. **Single tempo instead** is the escape
  hatch when a steady song over-segments — one uniform grid at the zones'
  duration-weighted tempo.
- **Heal uneven beat spacing.** Hand re-syncs and old imports can leave a
  measure's *interior* beats in a pathological shape — sub-beats piled a few
  milliseconds apart next to a seconds-wide hole — which garbles the metronome,
  snapping, and every per-beat view, even though the barlines themselves are
  right. A new **Tempo/Grid ▸ Heal uneven beat spacing** action finds those
  measures (any beat gap under 30% or over 300% of the measure's even spacing)
  and re-spaces their interior beats evenly between the barlines. **Barlines
  never move** — they're your authored truth; the beats between them are
  bookkeeping — and **notes keep their exact timing** against the recording.
  One undoable step, and it **names the measures it healed** so a bar you meant
  to be wildly uneven (a held grand pause reads the same as a corrupt gap) is
  one Ctrl+Z away; if the grid is healthy it says so and touches nothing.
- **Command palette (Ctrl+K).** Press **Ctrl+K** (or View ▸ Command palette)
- **Command palette (Ctrl+K).** Press **Ctrl+K** (or Help ▸ Command palette)
  and just type what you want to do — every editor command and menu action is
  searchable in one place, each shown with its live keyboard shortcut for your
  active profile. Arrow keys select, Enter runs, Esc closes. If you've ever
  known the editor *probably* has something but couldn't find which menu it
  lives in, this is the answer: type "snap", "tempo", "export", "guide" and
  the matching commands surface instantly, fuzzy matching included.
- **Two new shortcut profiles: Logical and Cableton.** If your hands already
  know a DAW, the editor can meet them there. **Logical** (Logic-style) puts
  the metronome on **K**, quantize on **Q**, steps the playhead by beat with
  **`,` / `.`**, loops the selection with **C**, creates a section with
  **Alt+'** (the marker key). **Cableton** (Ableton-style) quantizes with
  **Ctrl+U**, narrows/widens the grid with **Ctrl+1 / Ctrl+2**, toggles snap
  with **Ctrl+4**, clicks with **O**, follows playback with **Ctrl+Shift+F**,
  and loops the selection with **Ctrl+L**. Everything a profile doesn't remap
  keeps its FeedBack key, so editor-specific commands (techniques, tempo
  mapping, string moves) work identically everywhere — and where a DAW key
  displaces a FeedBack one, the displaced command *relocates* (Logical: pick
  direction moves to **Shift+K**, guide claps to **Ctrl+Shift+C**; Cableton:
  pop moves to **Ctrl+Shift+P**, select-matching to **Ctrl+Shift+L**) and the
  shortcut panel shows its new key — no command ever loses its keyboard, and
  no chord is ever double-bound. Logic's Repeat (**Cmd/Ctrl+R**) is
  deliberately *not* bound: the desktop app's own Reload accelerator owns that
  chord and would reload the editor out from under you; duplicate stays on
  **Ctrl+D** in every profile. The old EOF profile is still here as **Legacy
  (EOF)**. Switch in Help ▸ Shortcut profile, the Shortcuts panel, or the
  toolbar select; the shortcut panel always shows the keys for whichever
  profile is live.
- **Loop toggle and Song Fit are real commands now.** "Toggle loop playback
  for the selected region" and "Song Fit" joined the command registry, so both
  are reachable from anywhere commands are listed, Song Fit gained a menu home
  (**Tempo/Grid ▸ Song Fit**), and profiles can bind keys to them (Logical's C
  and Cableton's Ctrl+L drive the loop toggle).
- **Scan for tempo zones (preview).** A new **Tempo/Grid ▸ Scan for tempo zones**
  action reads the recording and reports the handful of *tempo intents* it finds
  — e.g. "3 tempo zones detected: 120 bpm · 140 bpm · rit 140→90". It's the first
  step of segment-first mapping: instead of guessing one tempo for the whole song
  or laying a shaky barline on every beat, it proposes a few constant/ramp zones
  the way a musician would describe the arrangement. This preview only *reports*
  what it finds — turning the zones into a grid (Confirm & Apply) is coming next.
  Under the hood it locates the pulse by autocorrelating the detected onsets with
  an octave guard + tempo prior (so it doesn't read double-time or half-time),
  and it gets sharper once the banded onset detection lands.
- **Scan now catches a grid running at double or half the real tempo.**
  Drum-heavy songs are routinely charted at exactly twice or half the real
  pulse (double-kick reads fast, half-time backbeats read slow) — and once
  that happens, no amount of per-bar fixing can repair it. When Scan's
  detected zones sit at about 2× or ½ your grid's tempo, the confirm bar now
  shows a one-click **Double grid tempo** / **Halve grid tempo** rescue:
  barlines merge or split onto the real pulse while the audio and every note
  stay exactly where they are. One undoable step; ordinary drift never
  triggers it (the check is deliberately tight), and after the fix Scan can
  be run again to confirm the zones agree.
- **Apply a rough map from the detected tempo zones.** After Scan shows the
  zones, **Tempo/Grid ▸ Apply rough map** turns them into an actual beat grid —
  a barline grid at each zone's tempo, with its downbeat phase seeded from the
  onsets so bar 1 has a fighting chance of not landing on the backbeat (it gets
  properly reliable once the banded onset detection lands). Your notes keep their
  exact timing against the recording (they ride the audio), and it's a single
  **Undo** away, so it's safe to try. (This is the quick no-questions path; the
  Scan confirm bar's **Confirm & refine** is the reviewed one — it also snaps
  each zone's barlines to the recording.)
- **Map Health — see where the grid drifts from the recording.** A new **Map
  Health** toggle (Tempo/Grid menu) paints a thin colour strip under the ruler,
  one span per bar, showing how well the beat grid agrees with the notes the
  recording actually plays: **green** where they line up, **amber** where the
  grid is drifting, **red** where it clearly disagrees with the audio — and,
  crucially, **grey where there's nothing to judge** (a silent, held or pedaled
  bar is never marked wrong). Drift is measured as a *fraction of the beat*, so a
  little slack at a slow tempo reads calm while the same slack on fast notes reads
  hot, and a bar's colour is the *median* of its beats so one expressive off-beat
  note can't flag an otherwise-solid bar. It's a review lens only — it never
  changes the chart, and it's off by default. Wherever you chart, you can see at a
  glance whether the automatic tempo map can be trusted. **Click a drifting
  (amber/red) bar** in the strip and it takes you straight to the fix — Tempo
  Map opens, the bar scrolls into view, and Suggest is anchored on it so pressing
  **G** proposes a barline fit to the recording from that bar on. (Green and grey
  bars aren't actionable, so clicking them just scrubs as usual.)
  glance whether the automatic tempo map can be trusted.
- **Grid-health readout in the transport display.** While Map Health is on
  (the same Tempo/Grid toggle), the transport LCD gains a small **Grid** cell
  showing what percent of the song's judgeable bars agree with the recording —
  green when everything lines up, amber or red when bars are drifting, and a
  neutral dash when there's nothing to judge yet (it never fakes a 100%).
  Bars with nothing to measure — silent or sustained — don't count for or
  against the score, same as the strip. **Click the percent** and the editor
  jumps straight to the worst drifting bar with the fix armed, exactly like
  clicking that bar in the strip — handy when the strip itself is scrolled out
  of view. Turn Map Health off and the cell tucks itself away; the transport's
  Customize row can also hide it independently.
- **Audition speed — slow the recording down for practice, pitch preserved.** A
  new speed control in the transport bar (**100% / 75% / 50%**) plays the
  reference slower without dropping its pitch, so you can hear a fast run or a
  bend clearly and chart against it. It's **playback only** — the chart, the
  tempo map, the exported audio and the saved file never change — and one click
  back to 100%. It resets to full speed when you load another song. Under the
  hood the sample-accurate engine is untouched at 100%; only when slowed does the
  reference ride a pitch-preserving path, kept in lock-step with the transport
  clock. (Slow-only, ≤100% — this is a practice slow-downer, not a varispeed; the
  recording itself is never stretched or warped.)
- **Audition trainer — loop a passage and let the speed climb.** A new **Step↑**
  toggle in the transport bar turns the loop + audition speed into a real
  practice trainer: select a bar range, turn Loop on, arm the trainer, and it
  plays the passage slowed — then **steps the speed up** (50% → 75% → 100%)
  after every three completed passes, telling you where you are ("Trainer: pass
  2/3 at 75%"). Reaching full speed disarms it with due congratulations. If you
  have a **count-in** armed, the pre-roll clicks precede *every* pass at the
  slowed tempo, so your hands are ready when the loop comes around. While
  slowed, the **metronome subdivides finer** — 8ths at 75%, 16ths at 50% — and
  the click stays **locked to the grid** at every speed: you hear your
  micro-timing against the intended pulse, never against a wobbling click.
- **Playability lint now catches finger conflicts.** Once notes carry fret-hand
  fingers (from Suggest Fingers, or by hand), the advisory lint flags a chord
  that asks **one finger to hold two different frets at the same time** — a shape
  no hand can play. The **thumb** (`T`) counts as a fretting digit and obeys the
  same physics. A **barre** (the same finger across strings at the *same* fret)
  is fine and never flagged — as is a **thumb-over** grip. Like every lint rule
  it only names the problem — a yellow underline, a count on the chip, and a
  popover row that seeks and selects the notes — never blocking or auto-fixing.
  Pairs with the auto-fingering and coherent-grip chord resolve.
- **Export a track to Guitar Pro (.gp5).** A new **File ▸ Export ▸ Guitar Pro
  (.gp5)** item downloads the current fretted track as a `.gp5` file you can open
  in Guitar Pro (or any tab tool that reads GP5) — real interop *out* of the
  editor for the first time. It converts the saved pack through the Tab View
  plugin, the same conversion the read-only Tab preview already engraves, and
  hands you the bytes as a download named after the song and track. Because the
  converter reads what's on disk, exporting mid-edit offers the usual Save /
  Don't Save / Cancel prompt first — the file you take away is never silently a
  stale pack. Fretted tracks only (keys/drums have no tab); if the Tab View
  plugin isn't installed or the song isn't saved yet, the status line says so.
- **Techniques now show in the Piano-roll view.** Switching from String view to
  the roll used to hide every technique — bends, slides, mutes, hammer-ons and
  the rest were all invisible on roll notes. They're drawn now: a slide gets its
  diagonal and a tie its legato hook (the two overlays that fit a thin lane),
  and everything else reads as a compact badge string right-aligned on the note
  (`H`, `PM`, `/7`, `x`, plus roll-only `b2`/`v` glyphs for bend and vibrato,
  which are too tall to draw as curves in a 4–14px lane). On lanes too short for
  text, a small corner dot still marks that a note carries techniques, so none
  are ever fully invisible. String view and the roll now build their shared
  badges from one source, so the two views can't drift apart.
- **Chart provenance.** Built packs carry an `origin: {tool: "feedback-editor",
  version}` extension key (ignored-but-preserved per feedpak §4), so
  editor-built charts stay distinguishable from bundled/imported packs —
  groundwork for career mode's trusted-chart policy. Nothing consumes it yet.

### Changed

- **Dragging notes is now magnetic, not locked.** With snapping on, a dragged
  note (or a sustained note's end edge) **sticks** to the nearest grid
  guideline while you're close to it — and if you keep pulling past the snap
  point, it **releases** and follows your pointer exactly, so small off-grid
  adjustments no longer need a modifier key. The magnet is a small
  screen-space radius, which makes it zoom-aware the way a DAW piano roll is:
  zoom in and the magnet covers less time, giving you finer control for free —
  and however dense the grid gets, the middle of every gap between guidelines
  stays free, so pulling past a snap point always releases instead of stepping
  you into the next one. Alt-drag still means fully free from the first pixel,
  clicks still place notes on the grid, and the explicit "Resnap selection"
  remains a full quantize.
- **Onset detection now hears frequency, not just loudness.** The little amber
  attack markers (the onset strip, and what note-drags snap to) used to come from
  a broadband "the recording got louder" test, which went blind on the events
  that matter most for charting: a new note inside a sustained or pedaled chord
  (no jump in total loudness), a low bass note whose attack has no pitch, and it
  couldn't tell a kick from a snare from a hi-hat. Detection is now **banded
  spectral flux** — it looks for energy *arriving* in three frequency bands (low
  ≲150 Hz for kick/bass, mid for snare, high for cymbals/hats), so each of those
  registers even when another is louder, and each attack is placed to a couple of
  milliseconds by sub-frame interpolation. It's pure in-app analysis (no server,
  no new dependencies), computed once per song and cached; the old detector stays
  as an automatic fallback. The analysis runs **in the background** (in small
  chunks between frames) and the old detector's result shows instantly meanwhile,
  so turning the onset strip on never stutters even on a long recording. Every
  attack now also carries its per-band strength, which the upcoming automatic
  tempo-mapping uses to find the beat.
- **Resolving positions now shapes chords as one coherent grip.** When you run
  "Resolve positions" over an anchor window, simultaneous notes (a chord) used
  to be placed one at a time, each grabbing its own lowest free fret — which
  could spread a chord across the neck into a stretch no hand can play (and that
  the playability lint then flags). The resolver now places a chord's notes
  **together**, choosing the tightest fret-hand shape (smallest fret span,
  distinct strings, open strings free) that fits the hand, pulled toward the
  anchor / previous note. A cluster with no playable grip falls back to the old
  per-note behaviour, so nothing that resolved before stops resolving.
- **Chord grips may now use open strings — each one flagged for your review.**
  When a chord note could be played open **or** fretted, the grip resolver used
  to refuse the whole chord rather than choose for you. It now takes the open
  when that makes the tightest hand shape — opens are how real chord voicings
  use the neck — but the choice is never confirmed behind your back: the status
  line counts the flagged opens ("2 open voicings to review"), the confirm sweep
  walks you to each one, and **Accept all deliberately skips them** (exactly
  like refused notes), so an open the machine picked only becomes part of your
  chart after you've looked at it. A lone note that could go either way is still
  refused outright — outside a chord shape there's nothing to justify the
  machine deciding.
- **Flattening a variable tempo map now names both directions** instead of a
  bare confirm. Typing a BPM for a song with multiple tempos opens a small in-app
  dialog: **Conform notes to the new tempo** (notes keep their bar:beat positions
  and move with the grid — the usual choice) or **Rebuild the grid only** (notes
  keep their exact seconds; for when they already sit on the recording). "Conform"
  is the previously-missing path — it flattens in the `TempoMapCmd` direction, so
  every part rides to the new constant tempo (no hand-scaled seconds); "Rebuild"
  is the existing `TempoGridCmd` flatten. Both anchor at bar 1 and are undoable
  ("Undo restores the map").
- **Assisted tempo mapping (Suggest ▸ G) reads music more musically.** The
  onset-fit engine was hardened so it stops guessing where a human would:
  - the snap window is now a fraction of the **beat**, not the bar, so a
    syncopation half a beat off the downbeat is no longer grabbed as the barline
    (the old ±12%-of-the-bar window was ±0.48 beat in 4/4 and far wider in long
    bars);
  - a candidate downbeat is scored by **one-bar comb corroboration** — the onset
    support of the whole bar's pulse, not a single hit — and confidence is a
    **product** of that corroboration, run continuity, and tempo consistency, so
    a bare or off-tempo bar reads as less certain;
  - the drift tracker is a **median of recent bars** (tap-tempo style) and a
    single correction bigger than 25% of a bar **stops** instead of snapping the
    whole grid onto one bad onset;
  - the march now **names why it stopped** in the HUD — *silence*, a
    *half/double-time* phase ambiguity, a *sudden tempo change*, or an
    *out-of-range tempo* (outside 40–300 BPM) — and a sustained/held bar (onsets
    present but off the downbeat) keeps marching where a truly silent bar stops.
  Suggestions remain proposal-only (ghost poles); nothing commits without an
  accept. `_suggestFitPure`'s signature is unchanged.
- **The first Save of a session now opens the file explorer** (the same native
  picker as Save As), so you choose where the `.feedpak` lands instead of it
  going somewhere implicit. Once you've picked a location, later saves (Ctrl+S /
  the Save button) write straight to it — no re-prompt. Where the File System
  Access API isn't available, Save falls back to the plain library save as
  before (never a download loop). Programmatic saves (the Loop-in-3D handoff,
  the host save hook, build) are unaffected — only the user's Save routes
  through the picker. Sessions that can't complete the picker flow — create
  mode (no library file to export yet; use Build) and authoring-directory
  sloppaks (no packed file for the export route to serve) — keep the plain
  library save instead of prompting for a destination that would then fail.
- **Tempo Map legibility pass.** The bottom HUD strip now carries a **colour
  legend** (mapped · selected · locked · suggested · unmapped) using the exact
  pole colours, so the grid's vocabulary is self-explanatory; it only draws when
  it clears the guidance text, never overlapping it. The **Unmapped tail** — the
  recording past the last confirmed downbeat, which carries no fitted tempo — is
  now drawn as a hatched wash with an "Unmapped" label in the grid. **Lock copy
  corrected**: the old "global tempo re-fits will hold this beat" implied you had
  to lock a barline to keep an edit — you don't. It now reads "Lock: hold this
  barline's time through automatic re-fits (Fit tempo, Suggest, Modulate). Your
  manual edits are always kept — locking is not needed to save them." across the
  right-click item (tooltip) and the S-key status. Finally, user-facing "sync
  point" wording is retired in favour of **"barline"** (inspector hints, delete
  titles, lock/status messages); "sync point" stays only as internal/export
  vocabulary.

- **"Parts" renamed to "Tracks" throughout the UI.** The multi-track surface is
  now called **Tracks**, matching how DAWs and tab editors (Guitar Pro,
  TuxGuitar, Songsterr) name it. Renamed the toolbar group + its View-menu
  toggle, the **Track** menu (was Part) and the Add-menu header, the transport
  **Tracks** overview pill, the mixer panel header + its empty/fallback strip
  names ("Track 1"…), the rename dialog ("Rename Track"), and every user-facing
  tooltip / status message ("Reordering tracks…", "Keys tracks always use the
  piano roll", etc.). Purely user-facing copy — the internal `part`/`arr` model,
  command ids (`renamePart`, `movePart*`, `togglePartsView`), and toolbar id
  (`parts`) are unchanged, so shortcuts, saves, and pack data are unaffected.

### Fixed

- **Whole-song tempo edits silently corrupted multi-part songs.** Sync tempo,
  the BPM box's constant-tempo rescale, and the audio Offset nudge each mutated
  the timeline directly — with **no undo** — and moved only the *current*
  arrangement's plain notes (plus the global beat grid and sections). Every
  *other* arrangement, and all chords / anchors / handshapes / phrases (and, for
  the partial paths, the drum tab) were left behind, so a second part or a drum
  chart drifted out of phase and the change couldn't be undone. All three now
  route through one command (`TempoMapCmd` / `TempoOffsetCmd`) whose beat-primary
  lift→reproject is total — every timed object in every part rides the grid — and
  fully undoable. Sync and rescale now pivot the scale at the first downbeat (or
  the focused barline) instead of `t=0`, so a song with a pickup / lead-in no
  longer skews. The applied audio offset moved from a hidden DOM attribute onto
  command-owned state (`S.appliedOffset`) so undo restores it, and the Sync
  dialog's duplicate offset field was removed (use the undoable toolbar Offset).
  New `tests/tempo_op_commands.test.mjs` deep-diffs a two-arrangement song with
  chords + drums to prove every part moves and undo restores the exact seconds.

- **The editor timeline rendered blank — chart and waveform invisible after
  any load or import.** Two closing `</div>`s were lost at the canvas-wrap
  overlay seam when the sweep bar and the drum-pad strip landed, so the main
  `#editor-canvas` ended up nested inside the *hidden* drum-pad strip: the
  canvas laid out at 0×0 (its whole subtree is `display:none`) while the
  status bar happily reported the load and every JS suite stayed green.
  Restored the two closers, and added `tests/screen_markup.test.mjs` — a
  dependency-free tag-stack walk that fails the suite if screen.html ever
  unbalances again or the canvas stops being a direct child of the wrap
  (this seam collides on every chrome PR; now it's guarded).

### Added

- **Dragged barlines snap to the beat (Snap = Onset).** In Tempo Map mode, with
  the snap target set to **Onset**, dragging a barline now gently pulls to the
  nearest detected audio attack within a few pixels — so downbeats land on real
  hits instead of by eye. It's the manual companion to Suggest (G): the pull is
  light (a few px, capped at 50ms, so it never fights a deliberate drag) and
  never crosses a neighbouring barline. **Locked barlines never snap**, and with
  Snap = Grid the drag stays a plain continuous move. A status line confirms
  when a barline lands on an attack.
- **Shift Audio — slide the recording in time, keeping the chart fixed.** A
  **Shift Audio…** button (next to Replace Audio) slides the whole recording
  earlier or later against the chart — the inverse of the chart-side Offset. Use
  it when a recording starts late, has leading silence, or you swapped it via
  Replace Audio and it no longer lines up with the chart you already built:
  move the *audio* instead of re-timing every note. It's **non-destructive**
  (the samples are never stretched — playback just reads the buffer from a
  shifted position) and **undoable**; the waveform and onset strip slide with it
  so what you see matches what you hear, and onset snap / Suggest / Sync follow
  the shifted audio. One shift applies to the whole audio group, so stems (when
  they arrive in the editor) will move together. *(Persisting the shift into the
  built pack is a follow-up — the value is wired onto the save/load path and
  honored on load, pending the pack field.)*
- **Suggest fret-hand fingers.** **Note ▸ Suggest fret-hand fingers** now
  proposes a fingering (1–4, or none for open strings) for every fretted note —
  from each note's fret relative to the hand anchor covering its time: the index
  finger sits at the anchor fret, one finger per fret across the four-fret span.
  It fingers the selection when you have one, otherwise the whole track, in a
  single undoable step. Notes that don't sit in a reachable hand position are
  left untouched (a different anchor owns them), and open strings are marked as
  no-finger. All the plumbing already existed — the `fret_finger` teaching mark,
  its Guitar-Pro/XML round-trip, and the fretboard strip that *shows* fingers —
  but until now nothing ever *proposed* one; this closes that gap.
- **Techniques are drawn on the chart, not just lettered.** Bends now render as
  the actual **bend curve** (from the authored `bend_values` shape, or a
  synthesized rise when only the amount is set) — an amber curve rising over the
  note with an arrowhead — instead of a bare `b`. **Slides** draw a diagonal line
  sloping toward the target (up or down), **vibrato** draws a small squiggle, and
  a **tie** (link-to-next) draws a legato hook off the note's trailing edge. The
  data always existed; now the chart *shows* it, so a fretted part reads much more
  like real tab. The remaining techniques (H/P, mutes, harmonics, tap/slap, etc.)
  keep their compact letter badges.
- **Place notes from the keyboard — no mouse needed.** With nothing selected in
  String view, an **entry caret** appears (a dashed cell at the playhead on the
  current string); **↑/↓** move it between strings and typing a **fret digit
  (0-9)** places a note there, then advances the caret one step so you can type a
  run. It reuses the normal add path, so it's undoable and identical to a
  mouse-placed note. When a note *is* selected the same keys keep their existing
  meaning — a digit sets the selected note's fret, ↑/↓ move its string — so
  nothing changes for editing; the keyboard-entry behaviour only kicks in when
  the selection is empty.
- **Nudge notes in time with ←/→.** Selected notes now move one snap step
  earlier/later with the **Left/Right** arrows — one grouped, undoable move —
  instead of needing a mouse drag for the most-repeated timing tweak (the group
  is clamped so the earliest note can't cross the start). With **nothing
  selected**, ←/→ move the playhead a step instead, which also positions the
  keyboard-entry caret. (Alt+←/→ still jump note-to-note.)
- **Song Fit — one place to line the chart up with the recording.** A **Song
  Fit…** button in the Tempo Map inspector opens a small menu with the three
  ways to fit a chart to audio, each labelled with what it does to your notes:
  **Shift everything…** (nudge the whole chart earlier/later — keeps the ±10ms
  arrows), **Fit tempo to recording…** (auto-match the tempo), and **Set
  constant tempo…** (flatten to one steady BPM, choosing whether notes ride or
  hold). The audio never moves in any of them. Everything routes through the
  existing undoable verbs, and the individual **Offset / Sync / BPM** controls
  are unchanged — Song Fit is just a friendlier front door. (The flatten flow
  was factored into a shared helper so "Set constant tempo" also works from
  inside Tempo Map mode, where the inline BPM box doesn't offer it.)
- **"Bar 1 here" — re-anchor the whole song to the playhead.** In Tempo Map
  mode, an inspector button and a right-click item on the bar-1 pole shift the
  grid, every part's notes, and the sections so bar 1's downbeat lands at the
  playhead — the recording never moves. It rides the undoable offset command, so
  Ctrl+Z restores the previous placement exactly. The space before bar 1 now
  draws as a labelled **Lead-in** region (a hatched wash mirroring the Unmapped
  tail), and the pickup right-click item is relabelled "(partial first bar — for
  music that starts before beat 1)" so the two are easy to tell apart. On import,
  when the grid puts bar 1 at 0:00 but the recording clearly starts later, the
  status line **suggests** opening Tempo Map and using "Bar 1 here" — it never
  auto-shifts.
- **User Guide** — a task-oriented, end-user guide to charting in the editor
  (start a project, the workspace, play/navigate, edit notes & techniques,
  parts, tempo mapping, drums, structure, save/build, shortcut essentials).
  It lives in the repo as `docs/USER-GUIDE.md` and opens in-app from
  **Help ▸ User Guide** as a read-only modal (Esc or click-outside to close;
  keys shown for the default FeedBack profile). Both are illustrated with
  captioned screenshots (workspace, New… dialog, timeline, Tempo Map mode,
  drum import) under `assets/guide/`. The in-app copy mirrors the doc; a
  `menu_model` test pins the menu item and its dispatch.
- **Undo to last checkpoint** (`Ctrl+Alt+Z`, Edit ▸ Undo to last checkpoint).
  Checkpoints are coarse rewind points stamped automatically at milestones —
  entering Tempo Map, accepting a suggested fit, locking/unlocking a barline —
  so a single keystroke can undo a whole tempo-mapping session at once instead
  of tapping Ctrl+Z through every step. The status line names what it unwound
  to. Degrades gracefully: with no checkpoint in range it undoes one step (and
  says so), a checkpoint dropped by the undo cap or a session reset just falls
  back to that, and a refused undo can never spin.

- **Chrome theme modes — Dark / Medium / Light.** The dark-blue workspace was
  hard to read in bright rooms, so the editor's chrome (menu bar, toolbars,
  transport bar, panels, buttons, popovers) now themes through CSS variables
  with three presets: the original **Dark**, a dim mid-tone **Medium**, and a
  bright **Light**. View ▸ *Theme: Dark → Medium → Light* cycles them and the
  choice persists (`localStorage`). Scope is deliberate: the timeline **canvas
  stays dark** in every theme (waveform/note contrast is tuned for it) and the
  LCD transport display stays dark (it reads as a hardware readout), while the
  category buttons keep their semantic colors. `window.editorSetTheme(name)` /
  `editorCycleTheme()` drive it.
- **Entry tours** (workspace-shell C3). Two short (≤4-step), task-based first-run
  tours, seeded by how you entered the editor: **Compose** (create-from-scratch)
  walks place → snap → play → loop; **Transcribe** (import) leads with the
  reframe *"the recording never moves — you line the GRID up to it,"* taught by
  doing — turn on Onsets, put the first barline on the first attack, tap tempo,
  switch snap to Onset. Steps advance when you actually do the task (or via the
  card's Next). Non-modal, skippable, and resumable from **Help ▸ Editor tour**;
  Transcribe's "I'll align later" drops you into the Compose tour. Tour state is
  editor-pref, and a tour fires at most once per lane on its own.
- **Onboarding signposts + first-win cues** (workspace-shell C2). Two quiet,
  un-gamified helpers, both editor-pref (never the pack): **signposts** are
  suggest-only hints triggered by what you're *doing* — e.g. resnapping notes
  repeatedly surfaces "the beat grid may be off — line it up with the Tempo
  tools (T), or Ctrl+K" — that only ever point at the menu/shortcut, never move
  a surface, fire once per capability, and are permanently dismissible when
  browser storage is available (session-only in private/storage-blocked mode;
  capped at ≤3). **First-win cues** are calm, one-time visual acknowledgements of a
  *correctness* milestone — locking a barline to the recording, and a section
  first gaining content — with no sound, score, or token. The section
  completeness shading stays presence-only (a span with content vs. not), never
  a density target and never scolding an intentionally-empty region.
- **Tempo & meter markers on the ruler.** Sparse labeled chips now show where the
  tempo changes (e.g. `90 BPM`) and where the meter changes (e.g. `3/4`) through
  the song, so a variable tempo map is legible at a glance. They're **derived
  purely from the beat grid** — zero new storage, memoized on the edit
  generation — so they can never drift from the actual tempo/meter. (Authored
  markers that the grid can't express — tempo ramps, meter groupings like
  `7/8 (2+2+3)`, fermata holds, and per-marker provenance — are scoped in
  feedpak-spec#51 and come later.)
- **Select and delete multiple barlines at once** in Tempo Map mode. Shift-click
  a second barline to select the contiguous range, drag a box on empty grid to
  rubber-band-select, or Ctrl+A to select every barline; the selection washes
  amber. Delete (or right-click ▸ "Delete N barlines") demotes them all in one
  undoable step — the first and last barline are always kept (they bound the
  map). Escape clears the selection. The single focused barline (BPM / tap /
  lock / modulate / suggest) is unchanged; the multi-selection is separate and
  is dropped on any grid-topology change.
- **Chrome theme modes — Dark / Medium / Light.** The dark-blue workspace was
  hard to read in bright rooms, so the editor's chrome (menu bar, toolbars,
  transport bar, panels, buttons, popovers) now themes through CSS variables
  with three presets: the original **Dark**, a dim mid-tone **Medium**, and a
  bright **Light**. View ▸ *Theme: Dark → Medium → Light* cycles them and the
  choice persists (`localStorage`). Scope is deliberate: the timeline **canvas
  stays dark** in every theme (waveform/note contrast is tuned for it) and the
  LCD transport display stays dark (it reads as a hardware readout), while the
  category buttons keep their semantic colors. `window.editorSetTheme(name)` /
  `editorCycleTheme()` drive it.

- **Drag a whole barline selection at once** in Tempo Map mode. Grab any pole in
  a multi-selection and the entire group slides together by one offset — the
  spans *between* selected barlines shift rigidly (their tempo is preserved),
  while the spans at the selection's edges re-space against the fixed barline
  just outside it, exactly like a single pole drag. The group stops as soon as
  any member would collide with a fixed neighbour, so it can never reorder the
  grid, and notes ride the move. **Locked barlines are excluded** — they stay
  put and act as fixed anchors the group re-spaces around (the status says how
  many stayed), since a lock's whole job is to defend a hand-verified time. One
  undoable step (Move N barlines together).

- **Pitched GM guide voices** (DAW workspace 1.2/1.5). The guide can now play
  the charted notes as a real General-MIDI instrument instead of the clap:
  Transport ▸ Guide voice ▸ Instrument (GM), with a per-part-kind instrument
  picker (guitar / bass / keys — curated FluidR3_GM programs; drums keep their
  clap). Pitches come from the roll's own converter — keys packing for keys
  parts, capo-aware sounding pitch for fretted — so the guide can never
  disagree with what the roll shows; chords ring as chords (up to four
  distinct pitches, each with its own sustain). The clap remains the default
  and the permanent fallback: while a preset is loading (or unavailable) the
  guide claps, never goes silent. Assets lazy-load through a three-rung
  source chain — plugin-vendored (`/api/plugins/editor/wafont/`, whitelist
  route; nothing vendored yet, see `assets/wafonts/README.md` for the
  FluidR3-only provenance contract), an org-hosted base URL (editor-pref),
  and the upstream WebAudioFont CDN the ecosystem already uses. All voices
  sum through the existing guide bus, so the mixer fader and limiter apply
  unchanged.

- **Entry-seeded workspace presets + per-song surface memory** (workspace-shell
  C1). A new song's starting toolbar preset now follows the entry lane —
  create-from-scratch opens the light **Compose** surface, a Guitar Pro / XML
  project import opens **Transcribe** (aligning the grid to the source is the
  first task); intent decides, never audio-presence, and a seed never changes
  your saved default. The workspace is remembered **per song** (editor-side,
  keyed by filename — never in the pack): opening a song lands your toolbars
  exactly where you left them for it, songs without a memory follow your last
  manually-chosen surface, and building a create-mode session hands the surface
  you shaped to the built file (the archive→sloppak save-as carries it across
  the rename too). "Reset layout" is now the full workspace rescue: it returns
  the current preset's pure default and clears the song's memory so the song
  follows your default again.

- **Assisted tempo mapping — suggest a barline fit from the recording**
  (`docs/TEMPO-MAPPING-DESIGN.md` "Assisted Mapping", first slice). In Tempo
  Map mode, **G** (also `Tempo/Grid ▸ Suggest barline fit`) proposes corrected
  times for every downbeat ahead of the anchor (the selected barline, or bar
  1): each bar is predicted from the grid's own spacing with a drift-tracking
  stretch, snapped to the strongest nearby onset, and shown as a **dashed
  ghost pole** whose opacity is its confidence — proposal-only, never
  committed silently. Click a ghost's hollow handle to **accept through that
  barline**: one undoable tempo re-fit (notes ride, beat positions preserved),
  and the suggestions ahead regenerate from the newly confirmed anchor —
  the seed → suggest → correct loop. Locked barlines are pinned at their own
  times and re-anchor the march; where the onsets stop corroborating
  (silence, phase break, tempo change) the run **stops and asks for the next
  human anchor** instead of guessing onward, and the trailing guesses are
  dropped. Esc dismisses; proposals are generation-keyed, so any edit
  invalidates them before it can race a click.
- **Mixer panel** (workspace-shell B6). The floating audio-mixer popover
  (and the never-implemented stem-mixer stub it superseded) consolidate
  into one first-class **docked Mixer panel** beside the canvas (the
  inspector idiom): one channel strip per part — volume, **M**ute,
  **S**olo — over the recording / guide / click bus faders and the edit
  blip, reachable from `View ▸ Panels ▸ Mixer`, the toolbar `Mix` button,
  the transport's left util group, and `Shift+C` (all four route through
  one toggle). The strips own the canonical per-part mix state
  (`S.partMix` — the same state the Parts-gutter M/S/A and per-part
  instrument voices will read when they arrive): today the only per-part
  sound is the guide voice, so mute/solo/volume gate and scale the claps
  for the part being edited, under the DAW rule (mute wins; any solo
  isolates). Part solo **never** touches the recording — the reference is
  a bus on its own transparent gain path (D5). Bus levels stay on the
  existing `editorMix*` prefs; panel open state is an editor pref
  (`editorMixerPanel`, never the pack); part mute/solo is session state
  and resets with the loaded song. Audio consults the state through an
  inert-default `host.partClapState` hook, so nothing changes until the
  panel says so.
- **Foolproof editor job transitions + Save As.** Opening another feedpak
  or starting New now offers Save / Don't Save / Cancel when the current
  job is dirty; a failed save blocks the transition. Active MIDI takes are
  finalized first, then playback, scheduled voices, pending audio/load
  requests, drags and the outgoing backend session are stopped before the
  replacement job is installed. File -> Save As opens the native system
  picker where available (download fallback) and mirrors later saves to
  that chosen external copy for the rest of the session.
- **Authoritative musical-ruler tempo mapping.** Tempo Map's primary action is
  now **Mark barline**: inside the mapped range it preserves the existing split
  behavior, while a mark beyond the final beat closes the open measure at the
  playhead, preserves authored trailing/rubato beats, and synthesizes inherited
  interior beats only for a terminal-only tail. The operation is one undoable
  topology edit, so source/object seconds remain fixed while musical positions
  re-lift. The consolidated ruler shades and labels audio after the final
  confirmed downbeat as **Unmapped** instead of implying one enormous last bar.
  The accepted timing/marker/autofill/audition contract is documented in
  `docs/TEMPO-MAPPING-DESIGN.md`.

- **Handshape-template lighting on the fretboard strip** (the P7 follow-up
  the strip deferred). When the selection sits inside an authored handshape
  span, the covered chord template's shape renders as ghost dots under the
  candidate lights — hollow squares in the framing color (chord sky /
  arpeggio violet), finger digits when the template carries them (thumb
  included), the template's name top-right — the "hold this shape" context
  behind the per-note candidates. Nested spans resolve to the innermost;
  the fret window widens to keep a shape up the neck on screen. Advisory
  display only: ghosts aren't hit-testable and never dispatch.
- **Enharmonic note spelling follows the song key** (4.16a follow-up). With
  a flat key set (F, Bb, Eb, Ab, Db majors and their relative modes — the
  relative major's signature decides), the piano-roll note labels, the
  add-note pitch readout, the roll placement messages, the fretboard
  strip's open-string labels, and the chord-readout root spell flats
  (Bb4, never A#4); sharp keys and no-key keep today's sharp names.
  "Detect" now announces the found key in its own spelling (Eb minor,
  never D# minor). The key picker's tonic list stays sharp-named (stable
  ids), and F#/Gb spells sharp to match it. Pure preference table in
  `theory.js`; `midiToNote` gains an optional names argument and defaults
  to the historical sharp table.
- **Count-in on the transport bar** — the LCD cell + mode toggle the
  transport slice deferred until count-in existed. A `Count` LCD cell
  (Off / 1 / 2 / 4 bars, charrette position between Key and Sel) writes
  through to the same `editorSetCountIn` control as the toolbar select
  and mirrors it on every tick; a `Count` toggle in the modes group
  arms/disarms the pre-roll — disarming remembers the bar count and
  re-arming restores it (1 bar when there's no memory). The cell is
  default-visible, including under a Customize pref blob saved before
  the cell existed. The "last non-zero count" memory the toggle restores
  is recorded in `editorSetCountIn` itself, so setting the count via the
  toolbar select (not just the LCD cell or toggle) updates it too.
- **Toggleable toolbars + density presets** (workspace-shell B5). The flat
  toolbar row's divider-groups are now eight named toolbars (File · Parts ·
  Edit · Transport · Grid · Tempo · Harmony · Overlays), each individually
  toggleable from `View ▸ Toolbars`, a right-click on the toolbar row, or
  the task-based density presets **Compose** (File+Edit+Grid), **Transcribe**
  (adds Tempo+Overlays) and **Everything** — plus "Reset layout" to return
  to the active preset's default. Hiding a toolbar is a pure CSS class flip
  on a layout-inert `display:contents` wrapper (zero canvas cost, zero
  re-plumbing; the row renders pixel-identical when everything is shown,
  which is also the first-run default). Layout persists as an editor pref
  (`editorToolbars`, never the pack) and never auto-reverts; the key/scale
  controls' existing auto-show survives as a sticky content-action reveal
  of the Harmony toolbar that never overrides an explicit hide. The
  Structure toolbar joins when it has buttons (section/phrase ops live in
  the menu bar under Add ▸ Markers for now).

- **One consolidated ruler + whole-song minimap** (workspace-shell B3).
  The three time-surfaces — the floating loop-strip overlay, the waveform
  band's seek role, and the bottom beat bar — consolidate into a timeline
  header at the canvas top (the charrette layout: transport → ruler →
  waveform → lanes): a **minimap** (sections, loop, viewport window,
  playhead; click/drag pans the whole song) over the **authoritative
  ruler** owning bars + beats + sections + loop + playhead. The ruler's
  upper half paints/resizes the loop (mode-aware — Bar/Grid/Free per the
  loop-snap pref, Shift = free, edge grips drag); its lower half scrubs
  the playhead; measure numbers skip in powers of two instead of
  colliding, and sub-beat ticks appear as zoom allows. Section names
  moved from the lane area onto the ruler (the dashed boundary lines
  stay in the chart). Loop snap mode + Clear loop now live under
  `Transport ▸ Loop`; `Alt+←/→` nudges the loop start (`Alt+Shift`: the
  end; add `Ctrl` for the coarse ±50 ms free step), replacing the old
  strip handles' arrow keys. Loop state is still
  `S.barSel` end-to-end — same commands, same beat-anchoring, same
  Loop-in-3D handoff; only the surface moved. Everything below the
  header shifts down by its fixed 40px (`TIMELINE_TOP`); the waveform
  band keeps click-to-seek as a convenience.

- **Count-in.** A `Count: off / 1 / 2 / 4 bars` select next to the
  metronome: playback (and, because the recorder rides the same transport
  clock, MIDI recording) starts after N bars of metronome clicks **in the
  meter and tempo at the cursor** — a 3/4 section counts three 100-BPM
  beats, not four 120-BPM ones. Implementation is one anchor shift: the
  transport's wall anchor pins into the future by the pre-roll, so the
  audio source, guide/click scheduler, and record clock all follow with no
  extra plumbing; the cursor holds at the start position during the
  pre-roll. Loop wraps and mid-play seeks stay immediate. With no tempo
  map yet, the count falls back to a 4/4 bar at 120 so a play gesture
  never fails. Editor pref, never the pack. This is the feature the B2
  transport bar's Count-in LCD cell and the charrette's Count toggle were
  deferred behind — both can now follow.
  The clicks are scheduled AFTER the transport anchor's voice-reset, so the
  reset can't cancel them before they sound; the record clock clamps at the
  start position during the pre-roll so a note fumbled over the count never
  lands at a pre-region time. `_countInPlanPure` in `src/transport.js` +
  `tests/count_in.test.mjs` (5) + `tests/count_in_wiring.test.mjs` (3, the
  survive-the-reset wiring).
- **Pickup bars + onset-based tempo detection (workspace-shell D3).** Two
  halves of the "bar 1 beat 1 doesn't align with the first audible note"
  problem:
  - **Set pickup (anacrusis):** right-click the first measure's sync point
    in Tempo Map mode (also a registry command) → the grid RE-BARS so the
    first N beats form a partial pickup bar and every bar boundary shifts
    earlier accordingly — each bar keeps its own length, so varying meters
    survive. Numbering-only: **no beat time moves** (the offset-vs-flex
    distinction holds by construction), one undoable grid command. With a
    partial first bar, measure displays shift so the pickup reads as
    **bar 0** and the first full bar as bar 1 (derived from the grid — no
    stored flag, nothing on the wire). Notes before beat 0 were already
    representable (the converter extrapolates); now pinned by test.
  - **Detect tempo from the onset strip:** the Sync dialog now reads tempo
    from the already-computed onset strip when one exists — consecutive
    inter-onset intervals, strength-weighted, octave-folded into 60–220 —
    and unlike the waveform autocorrelation it also proposes the **downbeat
    phase** and a **confidence** score, shown in the dialog. Diffuse votes
    (rubato, swing feel) fall back to the existing autocorrelation and say
    so, rather than pretending.
  `tests/pickup_detect.test.mjs` (7).
- **Resolve positions in an anchor's window + the confirm sweep
  (view-modality P8 / VA.7).** The anchor lane's context menu gains
  "Resolve positions in this window…": it runs the suggest-position
  resolver over every unresolved (suggested) note between that anchor and
  the next, writing the repicks as ONE undoable command — notes stay
  suggested (the machine picked; the charter confirms), refusals keep
  their position and are counted in the status line, never guessed, and
  earlier repicks claim their strings for later ones exactly like the
  roll writer. Then a **sweep bar** walks the window note-by-note: Enter
  accepts (each accept its own cheap undo through the existing accept
  command), ←/→ move, **A** accepts all remaining, Esc closes; the sweep
  seeks and selects as it walks and follows refs, so an undo mid-sweep
  can't derail it. **A** confirms only notes the resolver actually placed —
  refused notes keep their suggested mark and stay counted in the honest
  "positions unresolved" gap (they were never re-fingered). The anchor lane
  itself (both views, drag/edit/delete) already shipped — this is the
  missing bulk-authoring verb on top of it.
  `src/anchor-resolve.js` + `tests/anchor_resolve.test.mjs` (10).
- **Fretted playability lint (view-modality P9 / VA.8) — advisory only.**
  A pure lint pass over the active fretted part, recomputed only when an
  edit changes it (never per frame): **stretch** (simultaneous fretted
  notes spanning more than the active anchor window, +1 fret tolerance;
  open strings never count), **string overlap** (two notes on one string
  overlapping in time, sustain-aware), **open-string bend** (needs a
  bender — worth a look) with an out-of-range-fret **data-bug catcher**,
  and **legato jump** (an HO/PO arrival or pitched-slide reach spanning
  more than the anchor window). Flagged notes wear an amber underline in
  both String view and the roll; a count chip appears by the note-count
  readout; its popover lists every issue and clicking one seeks and
  selects the notes. Never blocks, never auto-fixes (the drum limb-lint
  posture): guitar has real outliers, so the lint names the physical
  question and the author decides. Thresholds are named constants,
  tuning invited. Note: the planned "open-string pitch vs tuning" check
  has no independent pitch field to cross-check (pitch is always derived
  from string+fret), so it ships as the open-bend + bad-fret pair.
  `src/playability-lint.js` + `tests/playability_lint.test.mjs` (9).
- **Drum companion strip: a VSTi-style kit view + a sampler pad view.**
  The drum editor's counterpart to the fretboard strip, in the SAME
  companion slot, with two switchable views (Kit ⇄ Pads, persisted pref):
  a **drawn kit graphic** with VSTi-style hit zones (snare head vs rim,
  ride bow vs bell, the open/closed hat pair with its pedal, cowbell on
  the kick mount) and a **sampler-style pad grid** (three banks of six).
  Both are a **visual cue** (selected hits light
  their pads), an **input surface** (click a pad to add that piece at the
  snapped cursor, through the normal undo-able add command), and a **MIDI
  mapping tool**: arm *Listen* and note-ons from an e-kit flash their pads
  live, mapped through **General MIDI percussion to start** (the import
  default; unmapped GM notes — claps, tambourine — flash nothing rather
  than the wrong pad). Each pad's tooltip documents its GM note numbers.
  The monitor rides the record path's refcounted device session via a new
  tap API in `src/midi-record.js` (never a second device path); on hosts
  without the MIDI-input domain it listens whenever the Record modal has a
  device connected. Shown in drum edit mode; the `Pads` toggle persists as
  an editor pref, never in the pack. Per-kit custom maps are a follow-up.
  Screen teardown drops the monitor tap + our device-session ref (only when
  we armed it — never yanks the Record modal's session) and cancels pending
  pad flashes, so a re-injection can't leak a MIDI session or stack handlers.
  `src/drum-pad-strip.js` + `tests/drum_pad_strip.test.mjs` (6).
- **Fretboard companion strip (view-modality P7 / VA.6 ★).** A docked,
  toggleable mini-fretboard at the bottom of the timeline for the active
  fretted part — tuning, string count and capo drawn from the arrangement,
  the capo as a visual nut-bar. Selecting notes lights **every playable
  same-pitch position** (the suggest-position resolver's enumeration):
  bright inside the active anchor window, dim outside, open-string
  candidates drawn square at the effective nut, each with a stretch-cost
  digit (fret travel vs the previous note's hand position); the note's own
  position renders filled, carrying its finger mark. **Click a candidate to
  assign it** — the same pitch-preserving command path as position cycling,
  so it passes the roll's edit lock and confirms (clears) a suggested mark,
  with undo restoring both. **Right-click cycles the fret-hand finger**
  teaching mark (1-4 · T · none). The render/hit-test idiom is ported from
  Virtuoso's Live fretboard strip; the editor owns all candidate and
  annotation logic. A canvas sidecar — repaints only on selection/edit
  changes, never per frame; hidden on keys parts, drum mode, the parts
  overview and Tempo Map mode. Toggle: the `Fret` toolbar button
  (editor pref, never the pack). Deferred: chord-selection handshape-
  template lighting (the anchor-window box ships now).
  `src/fretboard-strip.js` + `tests/fretboard_strip.test.mjs` (11).
- **Swing quantization on the snap grid (workspace-shell D2).** A Swing
  select next to Snap (Straight · 54% · 58% · 62%) displaces the OFF
  subdivision of each pair toward the next beat — as a **beat-domain phase
  offset fed through the `beatOf`/`timeOf` converter**, never a seconds
  nudge, so a swung note keeps its groove ratio through a tempo flex exactly
  like a straight one. 50% is bit-identical to the straight grid; triplet
  grids (1/3T, 1/6T, 1/12T…) are already swung by construction and ignore
  the setting, as do odd grids. Snap placement only: playback, existing
  notes, and the drawn grid are unchanged, and out-of-band values (a corrupt
  pref) fall back to straight rather than flinging notes. Editor pref
  (localStorage), never written to the pack.
  `_swingQuantizeBeatPure` in `src/snap.js` + `tests/swing_snap.test.mjs` (8).
- **The menu bar (workspace-shell B4).** Nine menus — File · Edit · Add ·
  Note · Part · View · Transport · **Tempo/Grid** · Help — re-homing the
  existing command registry, organized by musical object (Tempo/Grid is the
  time-model pillar's own top-level home). A re-presentation, not a re-plumb:
  registry items dispatch through the same switch the keyboard uses, and the
  pre-registry file/panel actions call their existing entry points. Menu
  accelerators **follow the active shortcut profile** (FeedBack ⇄ EOF Legacy —
  dropdowns render at open time, so a swap relabels everything); planned
  commands render greyed with a "soon" tag and never dispatch; sync-point
  items grey outside Tempo Map mode; Sync-to-audio hides without a recording.
  Click-open with arrow-key navigation and Enter/Escape (no Alt-mnemonics —
  browsers own those). The document-level click-away listener rides the
  teardown registry, so a re-injected screen can't stack copies.
  `src/menu-bar.js` + `tests/menu_model.test.mjs` (10).
- **Transport control bar + dual-domain LCD (workspace-shell B2).** One
  always-present bar directly above the timeline: go-to-start · rewind-a-bar ·
  stop · play/pause · forward-a-bar · record, plus an LCD that shows
  **Position (bars:beats:ticks) and Time (m:ss.mmm) together** — both computed
  through the `beatOf`/`timeOf` tempo-map converter, with a `▸` toggle for
  which is primary — and Tempo · Meter · Key · Sel · a mode badge. The LCD
  skin ports Virtuoso's recessed-panel grammar (`.editor-lcd-*`); the commit
  wiring is the editor's own: Position/Time edits seek, the Key selects write
  through to the Key controls, and the **Tempo cell is an input only in free
  (no-audio) mode** — with a recording the grid is fitted to the audio, so
  Tempo becomes a derived readout wearing the AUDIO badge and BPM editing
  stays with the Tempo Map/Sync tools. Left/right utility groups (Parts ·
  Mix · Follow / Click · Clap · A/B · Snap) mirror the existing toolbar
  commands; `▾` or right-click opens Customize Control Bar (show/hide groups
  and cells, persisted as an editor pref, never in the pack). Typing in an
  LCD cell never reaches the canvas shortcut layer; Enter applies, Escape
  reverts. LCD refreshes ride the transport tick, skip-if-unchanged — zero
  per-frame draw cost. No master-mute (mute/solo stay per-track, §2.6); no
  Count-in cell yet (the editor has no count-in feature to write through to).
  `src/transport-bar.js` + `tests/transport_lcd.test.mjs` (12).
- **Full-bleed on the v3 shell (workspace-shell B1).** The manifest now declares
  `"fullscreen": true`, so navigating to the editor hides the v3 topbar,
  collapses the sidebar to the icon rail, and pins the screen to the whole
  content area — a DAW-style surface needs the viewport, not a scrolling page
  under the navbar (the "cut off at the bottom" report). The screen root gains
  an `editor-root` hook and one `html.fb-immersive`-scoped rule in
  `assets/v3-theme.css` drops the now-meaningless `pt-16` navbar allowance and
  sizes the root to the pinned slot. The v2/legacy layout keeps `pt-16` /
  `h-screen` and is untouched (the class only ever appears on the v3 shell).
  Zero core changes — the host capability landed with the v3 shell and Virtuoso
  already exercises it. `tests/fullbleed.test.mjs` pins all three legs of the
  manifest/HTML/CSS contract.

### Fixed

- Loading a new feedpak while the old recording was playing no longer
  leaves the old AudioBufferSource sounding under the new song. Audio-less
  packs also clear the previous decoded buffer, and overlapping load/audio
  requests cannot install stale results out of order. The same teardown now
  also runs when a Guitar Pro / EOF **import** replaces the job (it took a
  different code path than Open feedpak), so an audio-less import can no
  longer inherit the previous recording, and the outgoing backend session is
  disposed instead of leaked.
- The session-transition confirm prompt's Escape listener now rides the
  screen teardown registry, and dismissing it resolves the pending prompt —
  a re-injected editor screen can no longer strand an in-flight transition.
- Choosing the "New" format picker on a dirty job no longer double-prompts to
  save (the picker already guarded the transition; the format buttons stopped
  re-guarding).
- **The screen teardown left the guide/metronome timer running.** The audio
  extraction (below) surfaced it: the old inline teardown cancelled the audio
  source and the rAF frame but not the `setInterval` that schedules guide claps,
  and that timer is module-scope, so it kept firing after a re-injected editor
  screen replaced the old one. `teardownAudio()` now stops it. Latent since the
  timer was introduced; found by Codex on review.

### Changed

- **The loop region, bar selection and scroll viewport moved to `src/loop.js`
  (R2, step 28).** 528 lines: the A/B loop strip and its drag/nudge/keyboard
  handling, bar-range selection, the scroll-bounds math, and `snapTime` — the one
  place a raw time becomes a snapped one, which every timeline placement goes
  through. `src/main.js` is down to 7,183 — **66%** below where it started.
  Three main.js symbols arrive as host hooks (seek, snap step, Loop-in-3D
  refresh); the loop-region and scroll functions and `snapTime` are themselves
  host hooks now resolving here. Also removes a leftover dead `_guideTimerSync`
  import in main.js from the audio step.


- **The audio subsystem now lives in `src/audio.js` (R2, step 27).** 1,039 lines:
  the playback engine, the waveform, the onset strip, follow-scroll, and the
  WebAudio graph, plus the guide claps, the metronome, the A/B reference loop,
  the per-bus mixer and the edit blip. `src/main.js` is down to 7,715 — **64%**
  below where this refactor started.
  It owns the rAF loop (`rafId`) and exports `teardownAudio()`. Five main.js
  symbols arrive as host hooks (`draw`/`drawNow`, the scroll-bounds math, the A/B
  loop-region selection). The eight `window.editor*` toolbar handlers are exported
  and re-attached; the import-time button seeding became `initAudio()`.


- **The canvas context menu now lives in `src/context-menu.js` (R2, step 25).**
  362 lines: the right-click menu and the prompt dialogs it opens (fret, bend,
  slide). `src/main.js` is down to 8,786.
  **Zero new host hooks.** Its three main.js dependencies were already there, and
  it *owns* `promptBend` and `hideContextMenu` — both already host hooks that the
  inspector and several modes call. They now resolve to the exports here instead
  of definitions in `main.js`. `main.js` keeps the canvas `contextmenu` event
  that decides when to open the menu.


- **The inspector panel now lives in `src/inspector.js` (R2, step 24).** 639
  lines: note attributes on one face, chord name/voicing/fingering/function on
  the other. `src/main.js` is down to 9,144.
  Most of its edits commit through a command and are undoable; the technique
  toggles and boolean flags still mutate in place, which is a deliberate scope
  limit from PR3b and unchanged here. All of them honour the read-only-roll lock.
  Its 19 `window.editor*` handlers — the ones the panel's own `innerHTML` calls
  by name — are exported plain functions that `main.js` re-attaches. `main.js`
  keeps the bend-curve dialog and the canvas-resize scheduler.


- **The MIDI keyboard recorder now lives in `src/midi-record.js` (R2, step 23),
  and the transport clock in `src/transport.js`.** `src/main.js` is down to
  9,779 — under ten thousand for the first time.
  It needed **no new host hooks**. Two of its dependencies were not hooks waiting
  to happen: `_transportChartTimePure` is pure time math and is now the whole of
  `transport.js` (the one formula the playback tick, the guide scheduler and the
  recorder must agree on), and `_uniqueKeysName` names a Keys arrangement, so it
  went to `keys.js`. Everything else it wanted was already on `host`.
  `_recState` is exported as a live `export let`. Every writer is inside the
  recorder, so the rest of the editor reads it and cannot reassign it — which is
  exactly the guarantee an import binding gives for free.


### Fixed

- **From-scratch song creation now behaves the way the button, the markup and the
  server all say it should.** Typing a title enabled Create; clicking it answered
  "Artist is required." Supplying an artist then demanded audio, which made the
  advertised draft-now-audio-later flow impossible. The roster chips ("What are
  you arranging?") were ignored — every draft came out as a lone Lead arrangement
  — and the eight extended-metadata fields the modal collects (album artist,
  track, disc, genres, language, ISRC, MBID, authors) were never sent.
  Root cause: `main.js` defined `_editorDoBlankCreate` twice, and the second
  definition silently won (see below). The client had been sending the server's
  documented **back-compat** payload (`initial_arrangement` + `init_drum_tab`)
  rather than the roster it asks for.
  `_createGateOpen` (unit-tested), `screen.html` (only Title is marked required),
  `editorDoCreate`'s own comment, and `create_sloppak` ("Artist is OPTIONAL for a
  draft", "Draft-now, audio-later: audio is OPTIONAL") all already agreed. Only
  the handler disagreed.

- **`_editorDoBlankCreate` was defined twice, and the wrong one was running.**
  `main.js` carried two definitions of it. Inside the file's IIFE that is legal
  — function declarations hoist, and the last one in source order silently wins
  — so the version added by the Create-New redesign (#45) never executed. The
  one that has actually been running came from the earlier "restore audio-only
  project creation" fix, and it requires an artist and audio, where the redesign
  intended audio to be optional for a draft-now project and validated the roster
  instead. The collision only surfaced because `src/create.js` is a module,
  where a duplicate declaration is a SyntaxError.
  The refactor that surfaced it removed the dead definition and kept the one that
  was executing, so that change was behaviour-preserving. The entry above is the
  follow-up that restores the intended behaviour.

### Changed

- **The song-creation flow now lives in `src/create.js` (R2, step 22).** 2,380
  lines: the format picker, the create modal, the roster, the MusicBrainz match,
  the album-art picker, and the `createState` object they all read. `main.js` is
  down to 10,380 — a **51% reduction** from the 21,176 lines this refactor
  started at (i.e. 49% of the original), and 81% of what it was one step ago.
  It keeps the load/audio pipeline and the transport readouts, which arrive as
  host hooks, and the entry landing, which is screen-entry UI that happens to
  open two of these dialogs. The 22 `window.editor*` handlers the HTML calls are
  exported as plain functions and re-attached by `main.js`.
  The module's one import-time side effect — a global `input` listener — became
  an exported `initCreate()` that `init()` calls. A module must not do work when
  it is loaded, or its tests cannot import it without a DOM.


### Changed

- **The modal primitives moved into `src/ui.js` (R2, step 21).** The focus trap
  (`_installModalKeyboard`), the in-app text prompt (`_editorPromptText`) and the
  HTML escaper (`_editorEscHtml`) are what every dialog in the editor is built
  on, and they were sitting inside the "New…" entry-point section because that is
  where the first one happened to be needed. They belong beside `setStatus`, for
  the same reason it lives there.
  `ui.js` imports nothing, which is what lets any module use it without thinking
  about cycles — so `annotation-lanes.js` now imports `_editorPromptText`
  directly, and **the `host.editorPromptText` hook is deleted**. A hook is a
  workaround for a symbol that cannot leave `main.js`; when one can, the hook
  should go with it.


- **The drum editor's mouse handlers and toolbar buttons follow the model into
  `src/drum.js` (R2, step 20).** 444 lines that step 15 left behind in
  `main.js` — not on purpose, but because they sit under the Tempo Map section
  banner and had none of their own. `main.js` is down to 12,908.
  `drum.js` needed `_refreshTempoMapButton`, which lives in `tempo.js` — and
  `tempo.js` already imports `drum.js`. It crosses through `host` instead, so
  the graph stays acyclic.


- **The Tempo Map editor now lives in `src/tempo.js` (R2, step 19).** 1,720
  lines: the measure model, the draw pass, the mouse handlers, the sync
  inspector, tap-tempo, beat-lock respacing, and its two undo commands
  (`TempoGridCmd`, `TempoMapCmd`). `src/main.js` is down to 13,347 — a **37%**
  reduction from the 21,176 it started at.
  `main.js` keeps `_finalizeActiveDrag`: it dispatches whatever canvas drag is in
  flight (tempo, drum, handshape, pan) before a mode switch, so it belongs to
  none of them and reaches back as `host.finalizeActiveDrag()`.
  Fifteen `main.js` symbols travel the other way — the transport, the A/B loop
  strip, the toolbar readouts. `_recState` is a reassigned scalar rather than a
  function, so it crosses as the predicate `host.isRecording()`.
  Fifteen suites stopped slicing `@pure:` blocks and command classes out of
  `main.js`; ten of them were CJS and are now `.mjs`.


- **The note command classes now live in `src/commands.js` (R2, step 18).** All
  18 of them, plus the helpers that construct and execute them — `src/main.js`
  is down to 15,042. They are the classes `history.js` has been duck-typing all
  along: `exec()`, `rollback()`, and the three flags the read-only-roll lock
  reads.
  `commands.js` is **DOM-free**, and that is a deliberate boundary rather than a
  happy accident. `setStatus` now no-ops when there is no `document`, so the
  module can be *run* under node and not merely imported; the guard lives in
  `src/ui.js` rather than at its ~180 call sites. Two functions that would have broken it moved back to
  `main.js`: the ambiguous-pitch popover (`_rollConfirmPosition`) and
  `_resizeForLaneChange`, which schedules a `requestAnimationFrame`. Both arrive
  as host hooks. It is what lets the eight suites below import the real classes
  under node with no `document` at all.
  Eight suites stopped brace-matching classes out of `main.js` and import them.
  Converting `strings_modal` exposed a fixture that only made sense under a stub:
  its 4-string `'Banjo'` ran against an injected `arr => arr.tuning.length`, and
  the real `_stringCountFor` reads a 4-length tuning on a non-bass part as a
  padded guitar (6). It is a `'Bass'` now.


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
  before repainting. The per-module hook setters (since consolidated into
  `setHostHooks()`) were handed the bare identifier, so they froze the ORIGINAL
  function at wiring time and every
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
  `_editorPromptText` — and arrive through the shared `host` object. `snapTime` stays
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
  the shared `host` object (see step 17). The
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
  they arrive through the shared `host` object (see step 17). The three duplicated
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
