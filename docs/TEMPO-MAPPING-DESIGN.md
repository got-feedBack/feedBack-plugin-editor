# Tempo Mapping: Authoritative Musical Ruler

Status: accepted design direction, 2026-07-11.

## Product Rule

Map the musical ruler to the recording. Do not force the recording onto the
ruler during normal feedpak authoring. The consolidated playback ruler is the
authoritative musical coordinate system for notes, chords, sections, loops,
the metronome, snap, and position displays.

## Four Time Domains

1. **Source time** is the immutable position in the original audio buffer,
   represented internally with seconds/sample precision.
2. **Musical time** is bars, beats, and ticks derived from `S.beats` through
   `beatOf`/`timeOf`. Authored musical objects are beat-primary and follow the
   ruler when a fitted map changes.
3. **Reference time** is an optional seconds or SMPTE display of source time.
   It aids navigation and interchange but never reduces internal precision or
   replaces musical time.
4. **Playback time** is wall-clock audition time after a nondestructive speed
   transform. Slowing playback changes neither source time nor the tempo map.

In audio-present mode, moving a tempo anchor fits the ruler to fixed audio.
The samples do not move; beat-primary content follows its musical position. A
topology edit, such as adding a barline or changing meter, preserves object
seconds and re-lifts beat coordinates because it redefines the grid at fixed
observed events. In compose/no-audio mode, the musical grid determines time.

## Authoring Model

The primary action is **Mark barline**:

- Inside a mapped measure, create a boundary at an existing beat without
  moving observed times.
- After the mapped range, close the open measure at the playhead and create
  the next downbeat.
- Near an existing barline, select it rather than creating a duplicate.
- Future live marking must timestamp from the transport source clock, never
  from input-event wall-clock time alone.

Prefer **barline**, **downbeat**, **tempo anchor**, and **meter change** in the
UI. `sync point` may remain an internal/export term. The last confirmed
downbeat ends the mapped range; the remaining recording is **Unmapped**, not
one enormous final measure.

## Structural Markers And Generated Grid

The ruler distinguishes sparse musical intent from generated detail:

- A **tempo anchor** binds a musical position to source time.
- A **tempo change** starts a constant/local-tempo segment.
- A **tempo ramp** describes a gradual transition between anchors.
- A **meter change** starts a signature and optional grouping such as
  `7/8 (2+2+3)`.
- Barlines and beats are the resulting editable grid.
- Suggestions are uncommitted analysis proposals, visually distinct from
  confirmed markers and grid lines.

Tempo and meter are independent. A meter change does not imply a tempo change,
and tempo drift does not imply a new meter.

## Assisted Mapping

The normal workflow is seed, suggest, correct:

1. Mark two or more reliable downbeats.
2. Suggest the next short range, a selection, or the song tail.
3. Show proposed barlines with confidence; do not commit them silently.
4. Accept a range or correct the first wrong proposal.
5. Recalculate only the unconfirmed future from that correction.
6. Stop at low confidence, silence, phase breaks, or likely tempo/meter changes
   and request another anchor.

Manual anchors are authoritative. Onset detection may offer a visible soft
snap but must never silently move a mark. Long gaps must not silently infer a
measure count. Odd-meter and complex songs are mapped by bounded phrases with
explicit meter/grouping markers.

An audio source explicitly declared as a **metronome guide** is the deliberate
exception to bounded performance-onset marching. Its consolidated transients
are treated as authored beat pulses, so the mapper may propose the whole chart,
including click-track tempo changes. Missing detections are extrapolated from
the recent pulse interval and must carry lower confidence. The result remains a
proposal: **Accept Whole Fit** commits it as one undoable command, and individual
accept-through remains available. Merely naming a file “click” never enables
this policy; the user must opt in on the audio track.

## Pitch-Preserving Slow Playback

Audition speed is a transport transform applied after source-to-musical
mapping. At 50% speed, two seconds of wall time advance one second of source
time. Placement, seeking, drawing, and snapping convert playback time back to
source time before resolving musical position.

The metronome and synchronized previews use the same transform. The UI may
show `Map 120 BPM / Audition 60 BPM at 50%`. Changing speed never edits the
tempo map or dirties the feedpak. Rendered time stretching is a separate future
command.

## Ruler Presentation

The consolidated ruler owns bars, beats, playhead, loop, sections, tempo/meter
markers, suggestions, and mapped/unmapped state. An optional secondary ruler
shows `m:ss.mmm` or SMPTE. All lanes use the ruler's single x/time conversion.

- Confirmed anchors are solid; suggestions are visually distinct.
- Tempo/meter changes have sparse labeled markers.
- The tail after the last confirmed downbeat is labeled **Unmapped**.
- Locked anchors remain visibly distinct.
- Status text names the musical result and provides an undo path.
- Whole-song metronome fits distinguish detected and extrapolated proposals and
  never commit without an explicit accept.

## Delivery Slices

1. **Barline continuation:** `Mark barline` closes the terminal measure and
   extends the grid atomically.
2. **Ruler marker lane:** add tempo/meter markers and a secondary time display.
3. **Bounded suggestions:** add confidence, accept-through-here, correction,
   and forward regeneration.
4. **Complex mapping:** add ramps, meter patterns/groupings, live bar/beat
   marking, latency handling, and phrase-scoped analysis.
5. **Audition transport:** add pitch-preserving speed with source-clock
   placement invariants and synchronized scheduling.

## Non-Negotiable Tests

- Tempo-map flex keeps object beats fixed and reprojects seconds.
- Grid topology edits keep object seconds fixed and re-lift beats.
- Source audio is never stretched by tempo mapping.
