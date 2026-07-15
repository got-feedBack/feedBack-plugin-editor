# Song Editor — User Guide

The **Song Editor** turns a recording into a playable feedBack chart. You line a
grid up to the music, place the notes, mark the tempo and sections, and build a
`.feedpak` the rest of the app can practice against.

This guide is the same content you get in-app from **Help ▸ User Guide**. It
covers the FeedBack shortcut profile (the default). Three other profiles remap
some keys to match muscle memory you may already have: **Logical**
(Logic-style — K clicks the metronome, Q quantizes, `,`/`.` step by beat, C
loops the selection), **Cableton** (Ableton-style — Ctrl+U quantizes, Ctrl+1/2
narrow/widen the grid, Ctrl+4 toggles snap, Ctrl+L loops), and **Legacy
(EOF)**. Anything a profile doesn't remap keeps its FeedBack key. Switch
profiles in **Help ▸ Shortcut profile** or the shortcut panel (`?`).

![The Song Editor loaded with a song: the menu bar and toolbars up top, the timeline (waveform and colored note blocks per string) in the middle, the transport and inspector around it.](../assets/guide/workspace.png)

---

## 1. Start a project

You begin one of two ways:

- **From a recording** — open the editor, load an audio file, and you get an
  empty timeline over the waveform. Set the tempo grid (Section 6) and start
  placing notes.
- **From an import** — bring in an existing chart and edit it. The editor reads
  **Guitar Pro** (GP3–GP8), **MIDI** (with its tempo map), community
  **arrangement XML**, **GoPlayAlong** sync sidecars, and existing
  **`.feedpak`** / archive files. Every format normalizes into the same internal
  model, so editing works the same regardless of where a chart came from.

![The Create New Arrangement dialog: choose which tracks to arrange, import a chart or audio (or paste a YouTube URL), and fill in the song details.](../assets/guide/import.png)

Import lives under the **File** menu (Import ▸ …). MIDI and XML/GP imports keep
their note data; a GoPlayAlong sidecar brings bar→time sync points only (no
notes) — useful for lining a grid up fast.

> **Autosave is not a thing.** Nothing touches your library until you **Build**
> (Section 10). Save early with `Ctrl+S`.

---

## 2. The workspace

- **Menu bar** (top) — every command, grouped by what it acts on (File, Edit,
  Add, Note, Track, View, Transport, Tempo/Grid, Help). Menus follow
  your shortcut profile and grey out commands that don't apply right now.
- **Toolbars** — quick toggles for the transport, snap, views, and the BPM /
  Offset boxes. Toolbars are collapsible; density presets live in **View**.
- **Timeline canvas** (center) — the waveform, the beat grid, and your notes.
  Zoom and scroll here; this is where you click to edit.
- **Transport bar** (bottom) — play/stop, the playhead clock, loop, count-in,
  metronome, and follow-playhead.
- **Inspector** (side) — details for whatever is selected: a note's fret and
  techniques, a barline's BPM, a section's name.
- **Companion strips** — a **fretboard strip** for fretted tracks (shows
  candidate positions from the position resolver — click one to assign) and a
  **drum pad strip** for drum tracks.
- **Mixer** (`Shift+C`) — per-track volume / mute / solo. Audio and transcription
  tracks are live together by default; mute or solo the channels you want to hear.

Press **`?`** at any time for the searchable shortcut panel, or **`Ctrl+K`** for
the command palette.

---

## 3. Play and navigate

- **Space** plays/stops from the playhead.
- **Follow playhead** (`Shift+L`) keeps the view scrolling with playback.
- **Loop A/B** (`Alt+B`) compares the recording against your guide so you can
  hear whether the chart matches the take.
- **Count-in** adds a bar of clicks before playback so you can catch the entry.
- **Guide claps** (`C`) tick the charted notes; the **metronome** ticks the
  beat. Use them to hear whether notes land where the grid says.
- **Move around**: `Page Up`/`Page Down` jump beat to beat; `Alt+←`/`Alt+→` jump
  note to note; `Ctrl+Page Up/Down` jump grid lines. Set numbered **bookmarks**
  with `Shift+Alt+1…9` and jump to them with `Alt+1…9`.

---

## 4. Edit notes

![The timeline: colored note blocks laid out per string (e·B·G·D·A·E), the number on each block its fret, with the anchors and handshape lanes along the bottom.](../assets/guide/notes.png)

Select a note by clicking it; drag a box to select several. Then:

- **Fret** — press `F` to edit, or type `0`–`9` (`Shift+0` for 10, `Ctrl++` /
  `Ctrl+-` to nudge).
- **String** — `↑` / `↓` move the selection between strings. `Shift+↑` / `Shift+↓`
  move it while **keeping the pitch** (in the piano roll these cycle the fretting
  position for the same note).
- **Timing** — drag a note along the timeline. With **snap** on (`G` to toggle,
  `,` / `.` to change resolution) notes land on the grid; switch snap to target
  **audio onsets** instead of grid lines when you're matching a loose take.
- **Sustain** — drag a note's tail to shorten / lengthen (or **Note ▸**
  Shorten / Lengthen sustain; `[` / `]` in the EOF profile).
- **Duplicate** the selection to the next position with `Ctrl+D`; **select all
  notes** with `Ctrl+A` (`Cmd+A` on macOS); **select all matching** string/fret
  with `Ctrl+L`; **resnap** to the grid with `Shift+R`. Select All remains a
  normal text command while editing a name or typing in a field.

### Techniques

Toggle techniques on the selected note(s) — the essentials:

| Key | Technique | Key | Technique |
|---|---|---|---|
| `H` | Hammer-on | `P` | Pull-off |
| `B` | Bend | `S` | Slide (pitched) |
| `M` | Palm mute | `V` | Vibrato |
| `N` | Natural harmonic | `Shift+N` | Pinch harmonic |
| `A` | Accent | `K` | Cycle pick direction |
| `X` | Mute (open) | `Shift+X` | Mute (retain fret) |

Slap/pop (`Shift+O` / `O`), tap (`Y`), tremolo, link-next and more are under
**Note ▸ Techniques** with their keys shown.

> The editor's **playability lint** flags fingerings that are physically awkward
> and the **drum limb lint** flags hits a human couldn't play — both *advise*,
> they never block or auto-change your chart.

---

## 5. Tracks (arrangements)

A song can hold several **tracks** — lead, rhythm, bass, keys, drums. Each track
gets the view that fits it automatically:

- **String view** — lanes per string, for guitar/bass.
- **Piano roll** — for keys tracks (and available for fretted tracks as a
  read-only reference, with resolver-assisted authoring).
- **Drum grid** — piece lanes, for drum tracks.

Switch tracks from the track selector. **Tracks overview** (`Shift+A`) stacks every
track for a bird's-eye look. Rename / reorder tracks from the **Track** menu.
Add a track by importing into it (e.g. Import MIDI as a keys track).

---

## 6. Tempo mapping — line the grid up to the music

This is the heart of charting. The grid is **beat-primary**: a note remembers
its bar-and-beat, and its clock time is derived from where the barlines sit. Move
the barlines and every note rides along. The **ruler is authoritative** — you
fit bars and beats to the fixed recording, never the other way around.

![Tempo Map mode: vertical barline poles across the timeline, each labeled with its measure and BPM, over the waveform.](../assets/guide/tempomap.png)

Three ways to set the tempo, from coarse to fine:

1. **Sync tempo to audio** (Tempo/Grid menu) — detects the recording's BPM and scales
   the whole grid to match in one step. A good first pass on a steady take.
2. **Set a constant BPM** — type into the BPM box for a song at one tempo.
3. **Tempo Map mode** (`T`) — the precise tool. The bottom strip shows every
   **barline**; drag one onto its downbeat in the waveform and the surrounding
   bars re-space to fit. In this mode:
   - **`G` — Suggest fit**: from the selected barline, the editor proposes the
     next downbeats from the audio's onsets. Click a ghost handle to accept
     through it.
   - **`Shift+B` — Tap tempo**: tap along and the selected barline takes your
     tempo.
   - **`B` — Set BPM** for the selected barline; **`M` — metric modulation**
     (e.g. half-time / double-time) at a barline.
   - **`I` — mark a barline** at the cursor; **`Del` — delete** the selected one.
   - **`Shift+T` — time signature**; **`N` / `[` / `]` / `D`** adjust the
     selected measure's beat count and unit.
   - **Beat-lock**: lock a barline you've hand-verified so later automatic
     re-fits (Sync, Suggest, modulation) leave its time alone. Your manual edits
     are always kept — locking just protects a bar from the *next* auto-fit.

### Offset (audio alignment)

The **Offset** box shifts the *whole* chart in time against the recording — use
it when the notes are right relative to each other but the whole chart sits a
few milliseconds early or late. It moves every track together and is undoable.

> Sync, BPM-rescale, and Offset all move **every track at once** and can be
> **undone** — experiment freely.

---

## 7. Drums

![The Add Drum Arrangement dialog, offering to import a Guitar Pro or MIDI drum track.](../assets/guide/drums.png)

Drum tracks use a **piece-lane grid**: rows are kit pieces (kick, snare, hats…),
columns are grid positions. Click to place a hit; the **drum pad strip** maps a
MIDI e-kit or your keyboard for monitoring. Row **density** (Full / Compact) is
in the **Track** menu. The **drum limb lint** flags hits that would need three
hands — advisory only.

---

## 8. Structure — sections, phrases, anchors, handshapes, tones

Mark up the song so practice tools and the highway know what's happening:

- **Sections** (`Shift+M`) — Verse / Chorus / Solo boundaries.
- **Phrases** (`Shift+P`) — finer practice spans.
- **Anchors** (`Shift+F`) — hand-position anchors for fretted tracks; the
  fretboard strip and position resolver use them.
- **Handshapes** (`Ctrl+H`) — chord shapes from the current selection.
- **Tone changes** (`Ctrl+Shift+T`) — mark where the amp/tone should switch.

These live in the **Add** menu (Markers) and show in the inspector when selected.

---

## 9. Save and build

- **`Ctrl+S`** saves your working session.
- **Build** assembles the finished **`.feedpak`** through the host's core
  libraries and writes it to your library — this is the only step that changes
  what the rest of the app sees. Build once the grid fits, the notes are placed,
  and playback (guide claps against the recording) sounds right.

**Undo/redo is the safety net.** Every edit — including tempo moves, offset, and
imports — is undoable (`Ctrl+Z` / `Ctrl+Y`). If something looks wrong, undo it.

---

## 10. Shortcut essentials

The full, profile-aware list is in the in-app shortcut panel (**`?`**). The ones
you'll reach for constantly (FeedBack profile):

| Key | Action | Key | Action |
|---|---|---|---|
| `Space` | Play / stop | `Ctrl+S` | Save |
| `?` | Shortcut panel | `Ctrl+K` | Command palette |
| `G` | Toggle snap | `,` / `.` | Snap resolution down / up |
| `F` | Edit fret | `0`–`9` | Set fret |
| `↑` / `↓` | Move string | `Shift+↑`/`↓` | Move, keep pitch |
| `Shift+R` | Resnap selection to grid | `Ctrl+D` | Duplicate selection |
| `T` | Tempo Map mode | `W` | Show/hide waveform |
| `Alt+B` | Loop A/B (audio ↔ guide) | `Shift+L` | Follow playhead |
| `Shift+M` | Add section | `Shift+F` | Set anchor |

---

### Getting help

- **`?`** — shortcut panel (searchable, follows your profile).
- **`Ctrl+K`** — command palette (run anything by name).
- **Help ▸ User Guide** — this document, in-app.

Happy charting.
