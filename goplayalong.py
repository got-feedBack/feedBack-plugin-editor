"""GoPlayAlong project parser.

GoPlayAlong (https://goplayalong.com) exports a small XML "sync sidecar" next to
a Guitar Pro score + an audio file. Unlike an EOF/RS arrangement XML (which
carries the actual notes), a GoPlayAlong ``<track>`` file carries **no chart** —
it points at a ``.gp`` score and an audio file and stores the sync points that
align the score's bars to the audio. That's why feeding one to the EOF importer
fails ("not a recognised EOF arrangement XML"): it's a different format.

This module turns that XML into the same bar→audio-time sync model the editor
already applies to Guitar Pro imports (see ``lib.gp8_audio_sync`` /
``convert-gp``), so a GoPlayAlong project (``.gp`` + audio + this XML) can be
imported with its authored sync instead of re-deriving it via onset detection.

Shape of the file::

    <track id="1" title="Would?" artist="Alice in Chains">
      <scoreUrl>1. Would.gp</scoreUrl>
      <audioUrl>1. Would.mp3</audioUrl>
      <sync>N#audioMs;bar;beat;msPerBeat#audioMs;bar;beat;msPerBeat#...</sync>
    </track>

The ``<sync>`` payload is ``#``-separated: the first token is the sync-point
**count**, each remaining token is ``audioMs;bar;beat;msPerBeat`` where
``audioMs`` is the position in the audio (milliseconds), ``bar`` is the 1-indexed
score measure, ``beat`` is the beat offset within the bar (0 = downbeat), and
``msPerBeat`` is the local tempo in milliseconds per quarter note.

Pure stdlib — no dependency on the core ``lib`` package — so it unit-tests
standalone. ``routes.py`` maps :class:`GoPlayAlongProject` onto the editor's
existing ``sync_points`` response shape.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

# Prefer defusedxml (hardened against entity-expansion / external-entity attacks
# on untrusted uploads); fall back to the stdlib parser when it isn't installed.
try:  # pragma: no cover - import wiring
    from defusedxml import ElementTree as _ET
except Exception:  # pragma: no cover - import wiring
    import xml.etree.ElementTree as _ET


@dataclass
class GpaSyncPoint:
    """One bar→audio anchor. ``modified_bpm`` is the local tempo derived from the
    file's ``msPerBeat`` (``60000 / msPerBeat``)."""
    bar: int
    time_secs: float
    modified_bpm: float
    beat: float = 0.0


@dataclass
class GoPlayAlongProject:
    title: str = ""
    artist: str = ""
    score_url: str = ""          # referenced .gp filename (as authored in the XML)
    audio_url: str = ""          # referenced audio filename
    audio_offset: float = 0.0    # seconds of audio before score bar 1 (extrapolated)
    sync_points: list[GpaSyncPoint] = field(default_factory=list)
    declared_count: int = 0      # the count token the file declared (for validation)


def _local_name(tag: str) -> str:
    """Strip any XML namespace so ``{ns}track`` compares as ``track``."""
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def is_goplayalong_xml(text: str | bytes) -> bool:
    """True when ``text`` is a GoPlayAlong ``<track>`` sync file.

    Cheap + tolerant: parses the root and checks it's a ``track`` element that
    carries a ``<sync>`` child (or a ``<scoreUrl>``). Returns False (never
    raises) for EOF ``<song>`` arrangements, MusicXML, and anything unparseable —
    so callers can use it as a routing gate before the EOF importer.
    """
    try:
        root = _ET.fromstring(text.encode("utf-8") if isinstance(text, str) else text)
    except Exception:
        return False
    if _local_name(root.tag) != "track":
        return False
    children = {_local_name(c.tag) for c in root}
    return "sync" in children or "scoreUrl" in children


def _parse_sync_payload(payload: str) -> tuple[int, list[GpaSyncPoint]]:
    """Parse the ``<sync>`` text into (declared_count, sync_points).

    Tolerant of trailing/empty segments and malformed individual points (a bad
    point is skipped, not fatal) so a single stray ``#`` can't sink the import.
    """
    parts = [p for p in payload.strip().split("#") if p != ""]
    if not parts:
        return 0, []

    declared = 0
    first = parts[0]
    # The leading token is the point count *iff* it's a bare integer (no ';').
    # If the file omitted it (or it's actually a point), fall through and treat
    # every token as a point.
    if ";" not in first:
        try:
            declared = int(first.strip())
            parts = parts[1:]
        except ValueError:
            declared = 0

    points: list[GpaSyncPoint] = []
    for seg in parts:
        fields = seg.split(";")
        if len(fields) < 2:
            continue
        try:
            audio_ms = float(fields[0])
            bar_f = float(fields[1])
            beat = float(fields[2]) if len(fields) > 2 and fields[2] != "" else 0.0
            ms_per_beat = float(fields[3]) if len(fields) > 3 and fields[3] != "" else 0.0
        except (ValueError, IndexError, OverflowError):
            continue
        # Reject non-finite values (inf / -inf / nan): they can't be a real sync
        # point, int(inf) raises OverflowError, and an inf time_secs would
        # serialize to non-JSON-compliant `Infinity` and 500 the endpoint at
        # response render. Skip the point rather than fail the whole import.
        if not (math.isfinite(audio_ms) and math.isfinite(bar_f)
                and math.isfinite(beat) and math.isfinite(ms_per_beat)):
            continue
        bar = int(bar_f)
        bpm = (60000.0 / ms_per_beat) if ms_per_beat > 0 else 0.0
        points.append(GpaSyncPoint(bar=bar, time_secs=audio_ms / 1000.0,
                                   modified_bpm=round(bpm, 4), beat=beat))
    # Keep chronological order regardless of file ordering.
    points.sort(key=lambda sp: (sp.time_secs, sp.bar))
    return declared, points


def _extrapolate_bar1_offset(points: list[GpaSyncPoint]) -> float:
    """Audio time (seconds) of score bar 1, extrapolated from the first two
    sync points' per-bar slope. Returns the first point's own time when there's
    only one point, or 0.0 when there are none. This is the coarse
    ``audio_offset`` (seconds of audio before bar 1); the sync points remain the
    authoritative fine mapping.
    """
    if not points:
        return 0.0
    if len(points) == 1:
        return points[0].time_secs
    a, b = points[0], points[1]
    if b.bar == a.bar:
        return a.time_secs
    slope = (b.time_secs - a.time_secs) / (b.bar - a.bar)  # seconds per bar
    return a.time_secs - (a.bar - 1) * slope


def parse_goplayalong(text: str | bytes) -> GoPlayAlongProject:
    """Parse a GoPlayAlong ``<track>`` XML into a :class:`GoPlayAlongProject`.

    Raises ``ValueError`` if the root isn't a GoPlayAlong ``track`` element or it
    carries no usable sync points.
    """
    try:
        root = _ET.fromstring(text.encode("utf-8") if isinstance(text, str) else text)
    except Exception as e:  # noqa: BLE001 - surface a clean message to the caller
        raise ValueError(f"Not valid XML: {e}") from e

    if _local_name(root.tag) != "track":
        raise ValueError(
            "Not a GoPlayAlong file (expected a <track> root with <sync> data)."
        )

    proj = GoPlayAlongProject(
        title=(root.get("title") or "").strip(),
        artist=(root.get("artist") or "").strip(),
    )
    for child in root:
        name = _local_name(child.tag)
        val = (child.text or "").strip()
        if name == "scoreUrl":
            proj.score_url = val
        elif name == "audioUrl":
            proj.audio_url = val
        elif name == "sync":
            proj.declared_count, proj.sync_points = _parse_sync_payload(val)

    if not proj.sync_points:
        raise ValueError("GoPlayAlong file carried no usable <sync> points.")

    proj.audio_offset = round(_extrapolate_bar1_offset(proj.sync_points), 4)
    return proj
