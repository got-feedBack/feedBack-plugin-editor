"""Arrangement Editor plugin — backend routes."""

import asyncio
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import time
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
from xml.dom import minidom

import base64

from fastapi import UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse

import yaml


# Matches a plausible 4-digit album year inside free-form text — used to
# sanitize <albumYear> when it has been polluted by copyright strings from
# GP imports (the converter parses albumYear as Int32 and rejects anything else).
_YEAR_RE = re.compile(r"\b(1[89]\d{2}|20\d{2})\b")

# Sentinel object used to distinguish "drum_tab key absent from JSON body"
# from an explicit None (removal) or a dict (new payload).  Using an object
# rather than a string avoids a spoofing vector where a client sends the
# sentinel string value and accidentally (or maliciously) trips the no-op path.
_DRUM_TAB_ABSENT = object()

# Generic "field absent from request" sentinel used by the save endpoint
# to distinguish "client didn't send this field" from "client explicitly
# sent an empty list / null". The empty-list case is meaningful for
# `anchors_user` (empty → fall back to `_compute_anchors`) and for
# `handshapes` (empty → no handshapes), so collapsing the two via
# `dict.get(...) or []` would silently disable both behaviours.
_FIELD_ABSENT = object()

_sessions = None

# Authorable note technique fields, in a fixed order. The Note dataclass
# attribute name and the wire/JSON key are identical, so this single tuple
# drives both `_tech_dict` (the save/wire surface) and the arrangement
# content signature (`_align_xml_files_to_arrangements`) — keeping the two
# in lockstep so a newly-added technique can't silently drop out of either.
_NOTE_TECH_FIELDS = (
    "bend", "bend_intent", "slide_to", "slide_unpitch_to", "hammer_on",
    "pull_off", "harmonic", "harmonic_pinch", "palm_mute", "mute", "vibrato",
    "tremolo", "accent", "tap", "link_next", "fret_hand_mute",
    "pluck", "slap", "right_hand", "pick_direction", "ignore",
    # Teaching marks (§6.2.2) — display only, never grading.
    "fret_finger", "strum_group", "scale_degree",
)
# `bend_values` (the §6.2.1 bend curve) is deliberately NOT in the tuple above:
# it's a list, and the tuple feeds hashable content-signature tuples
# (`_obj_note_sig` / `_dict_note_sig`). It's handled explicitly in `_tech_dict`
# (load) and `_arr_dict_to_wire` (save) instead.


# Techniques the save path (`_arr_dict_to_wire`) coerces with `_safe_bool`.
# Their "absent attr" fallback MUST be False, never the -1 int sentinel:
# `_safe_bool(-1)` is True, so a blanket `getattr(n, f, -1)` would silently
# switch on every missing boolean technique on an import → save round trip.
_NOTE_TECH_BOOL_FIELDS = frozenset({
    "hammer_on", "pull_off", "harmonic", "harmonic_pinch", "palm_mute",
    "mute", "vibrato", "tremolo", "accent", "tap", "link_next",
    "fret_hand_mute", "pluck", "slap", "ignore",
})


def _parse_sync_points_payload(raw):
    """Validate a client sync_points payload (the JSON shape autosync-gp
    returns). Returns (points, error): `points` is a list of coerced
    dicts with keys bar/time_secs/modified_bpm/original_bpm, `error` is
    a message for a 400 response. Exactly one of the two is None.
    """
    if not isinstance(raw, list):
        return None, "sync_points must be a list"
    # Bound the list: a real song has at most a few hundred bars, so a
    # larger payload is malformed/abusive — reject before doing the work.
    if len(raw) > 2000:
        return None, "too many sync_points (max 2000)"
    # Tuple, not set: the members render in a stable order inside the 400
    # error message (a set's repr order is non-deterministic across runs).
    required_keys = ("bar", "time_secs", "modified_bpm", "original_bpm")
    points = []
    for i, sp in enumerate(raw):
        if not isinstance(sp, dict) or not all(k in sp for k in required_keys):
            return None, f"sync_points[{i}] missing required keys: {required_keys}"
        try:
            bar = int(sp["bar"])
            tsec = float(sp["time_secs"])
            mbpm = float(sp["modified_bpm"])
            obpm = float(sp["original_bpm"])
        except (TypeError, ValueError):
            return None, f"sync_points[{i}] contains non-numeric values"
        # Reject NaN/Inf (float() accepts "nan"/"inf") and out-of-range
        # values before they reach the sync math.
        if (not all(math.isfinite(v) for v in (tsec, mbpm, obpm))
                or bar < 0 or tsec < 0 or mbpm <= 0 or obpm <= 0):
            return None, f"sync_points[{i}] has out-of-range values"
        points.append({"bar": bar, "time_secs": tsec,
                       "modified_bpm": mbpm, "original_bpm": obpm})
    return points, None


def _note_tech_default(field):
    """The value a technique field takes when a parser/core object omits it.

    Field-appropriate, not a blanket -1, so an older/partial note round-trips
    cleanly through the save path: booleans → False (`_safe_bool(-1)` is True),
    `bend` → None (else `_safe_float` yields a spurious -1.0 bend), `bend_intent`
    → 0 (else the truthy -1 emits a schema-invalid `bt`); the remaining ints
    (`slide_to`, `right_hand`, teaching marks, …) keep the -1 "none" sentinel.
    """
    if field in _NOTE_TECH_BOOL_FIELDS:
        return False
    if field == "bend":
        return None
    if field == "bend_intent":
        return 0
    return -1


def _note_tech_dict(n) -> dict:
    """Return the editor technique dict for a parsed note-like object.

    Missing optional attrs fall back via `_note_tech_default` (field-typed),
    not a blanket -1 — see that helper for why -1 corrupts booleans/bend on the
    save round trip.
    """
    d = {f: getattr(n, f, _note_tech_default(f)) for f in _NOTE_TECH_FIELDS}
    d["bend_values"] = getattr(n, "bend_values", None)
    return d

# ── JSONC support (feedpak-spec §8) ──────────────────────────────────────────
# A .jsonc file is JSON with C-style // line and /* */ block comments. The spec
# requires a Reader to strip comments before parsing and a Writer to preserve
# them when editing a .jsonc file. The editor reads existing arrangements to
# preserve anchors/handshapes/phrases/tones on save, and re-writes the
# arrangement file — so both sides need JSONC handling for .jsonc arrangements.

# String-aware comment stripper: matches JSON string literals (kept), // line
# comments, and /* block comments */ (stripped). Mirrors the reference
# implementation in feedpak-spec/tools/validate.py.
_JSONC_STRIP_RE = re.compile(
    r'"(?:[^"\\]|\\.)*"|'   # string literal — keep
    r'//.*|'                 # // line comment — strip
    r'/\*[\s\S]*?\*/',       # /* block comment */ — strip
)


def _parse_jsonc(text: str):
    """Parse JSONC, stripping comments before json.loads. String contents
    are preserved (comment-like text inside a string is never stripped)."""
    stripped = _JSONC_STRIP_RE.sub(
        lambda m: m.group(0) if m.group(0).startswith('"') else '',
        text,
    )
    return json.loads(stripped)


def _load_arrangement_json(path) -> dict:
    """Read and parse an arrangement JSON/JSONC file. ``.jsonc`` files are
    stripped of comments via :func:`_parse_jsonc`; plain ``.json`` goes through
    ``json.loads``. UTF-8, matching every other reader in this plugin."""
    raw = path.read_text(encoding="utf-8")
    if path.name.lower().endswith(".jsonc"):
        return _parse_jsonc(raw)
    return json.loads(raw)


def _timeline_round_time(value) -> float:
    try:
        return round(float(value), 3)
    except (TypeError, ValueError):
        return 0.0


def _timeline_denominator(value) -> int:
    try:
        den = int(value)
    except (TypeError, ValueError):
        return 4
    return den if den in {1, 2, 4, 8, 16, 32, 64} else 4


def _timeline_downbeat_indices(beats: list) -> list[int]:
    return [
        i for i, b in enumerate(beats or [])
        if isinstance(b, dict) and int(b.get("measure", -1) or -1) > 0
    ]


def _timeline_measure_beat_count(beats: list, downbeats: list[int], pos: int) -> int:
    idx = downbeats[pos]
    if pos + 1 < len(downbeats):
        return max(1, downbeats[pos + 1] - idx)
    return max(1, len(beats or []) - idx)


def _build_song_timeline(beats: list, sections: list) -> dict | None:
    """Build the feedpak song_timeline.json payload from editor beat state."""
    clean_beats = []
    for b in beats or []:
        if not isinstance(b, dict):
            continue
        clean_beats.append({
            "time": _timeline_round_time(b.get("time", 0)),
            "measure": int(b.get("measure", -1) or -1),
        })

    clean_sections = []
    for s in sections or []:
        if not isinstance(s, dict):
            continue
        clean_sections.append({
            "name": str(s.get("name", "")),
            "number": int(s.get("number", 0) or 0),
            "time": _timeline_round_time(s.get("time", s.get("start_time", 0))),
        })

    payload = {"version": 1}
    if clean_beats:
        payload["beats"] = clean_beats
    if clean_sections:
        payload["sections"] = clean_sections

    downbeats = _timeline_downbeat_indices(beats or [])
    time_signatures = []
    tempos = []
    last_ts = None
    last_bpm = None
    for pos, idx in enumerate(downbeats):
        b = beats[idx]
        t = _timeline_round_time(b.get("time", 0))
        numerator = _timeline_measure_beat_count(beats, downbeats, pos)
        den = _timeline_denominator(b.get("den", 4))
        ts = [numerator, den]
        if numerator > 1 and ts != last_ts:
            time_signatures.append({"time": t, "ts": ts})
            last_ts = ts
        if pos + 1 < len(downbeats):
            n = beats[downbeats[pos + 1]]
            span = _timeline_round_time(n.get("time", 0)) - t
            if span > 0:
                bpm = round((numerator * 60.0) / span, 3)
                if last_bpm is None or abs(bpm - last_bpm) > 0.001:
                    tempos.append({"time": t, "bpm": bpm})
                    last_bpm = bpm
    if time_signatures:
        payload["time_signatures"] = time_signatures
    if tempos:
        payload["tempos"] = tempos

    return payload if len(payload) > 1 else None


def _apply_timeline_signatures_to_beats(beats: list, time_signatures: list) -> list:
    """Attach denominator hints from song_timeline events to downbeat rows."""
    if not beats or not isinstance(time_signatures, list):
        return beats
    out = [dict(b) if isinstance(b, dict) else b for b in beats]
    downbeats = [
        (i, _timeline_round_time(b.get("time", 0)))
        for i, b in enumerate(out)
        if isinstance(b, dict) and int(b.get("measure", -1) or -1) > 0
    ]
    for ev in time_signatures:
        if not isinstance(ev, dict):
            continue
        ts = ev.get("ts")
        if not isinstance(ts, list) or len(ts) < 2:
            continue
        den = _timeline_denominator(ts[1])
        t = _timeline_round_time(ev.get("time", 0))
        match = min(downbeats, key=lambda pair: abs(pair[1] - t), default=None)
        if match and abs(match[1] - t) <= 0.001:
            out[match[0]]["den"] = den
    return out


def _load_song_timeline(source_dir: Path, manifest: dict) -> dict | None:
    rel = (manifest or {}).get("song_timeline")
    if not rel or not isinstance(rel, str):
        return None
    source_resolved = source_dir.resolve()
    timeline_path = (source_resolved / rel).resolve()
    try:
        timeline_path.relative_to(source_resolved)
    except ValueError:
        return None
    if not timeline_path.exists() or not timeline_path.is_file():
        return None
    try:
        raw = json.loads(timeline_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(raw, dict):
        return None
    beats = raw.get("beats")
    sections = raw.get("sections")
    signatures = raw.get("time_signatures")
    result = {}
    if isinstance(beats, list):
        result["beats"] = _apply_timeline_signatures_to_beats([
            {
                "time": _timeline_round_time(b.get("time", 0)),
                "measure": int(b.get("measure", -1) or -1),
            }
            for b in beats if isinstance(b, dict)
        ], signatures if isinstance(signatures, list) else [])
    if isinstance(sections, list):
        result["sections"] = [
            {
                "name": str(s.get("name", "")),
                "number": int(s.get("number", 0) or 0),
                "start_time": _timeline_round_time(s.get("time", s.get("start_time", 0))),
            }
            for s in sections if isinstance(s, dict)
        ]
    return result or None


def _read_existing_song_timeline_payload(source_dir: Path, manifest: dict) -> dict:
    rel = (manifest or {}).get("song_timeline") or "song_timeline.json"
    if not isinstance(rel, str):
        rel = "song_timeline.json"
    source_resolved = source_dir.resolve()
    timeline_path = (source_resolved / rel).resolve()
    try:
        timeline_path.relative_to(source_resolved)
    except ValueError:
        return {}
    if not timeline_path.exists() or not timeline_path.is_file():
        return {}
    try:
        existing = json.loads(timeline_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return existing if isinstance(existing, dict) else {}


# Keys the editor authoritatively owns in song_timeline.json — everything else
# (metric modulations, author annotations, future keys) is preserved verbatim.
_OWNED_TIMELINE_KEYS = ("version", "tempos", "time_signatures", "beats", "sections")


def _merge_song_timeline_payload(existing: dict, generated: dict) -> dict:
    merged = dict(existing or {})
    for key in _OWNED_TIMELINE_KEYS:
        if key in generated:
            merged[key] = generated[key]
        else:
            merged.pop(key, None)
    return merged


def _write_song_timeline_sidecar(source_dir: Path, manifest: dict,
                                 beats: list, sections: list) -> None:
    payload = _build_song_timeline(beats, sections)
    timeline_path = (source_dir / "song_timeline.json").resolve()
    try:
        timeline_path.relative_to(source_dir.resolve())
    except ValueError:
        raise RuntimeError("song_timeline path escapes sandbox")
    if payload is None:
        # Empty grid: the editor owns no timeline. Preserve any hand-authored
        # unknown keys (the whole point of this feature) rather than unlinking
        # them — only drop the sidecar when nothing survives the owned-key strip.
        existing = _read_existing_song_timeline_payload(source_dir, manifest)
        leftover = {k: v for k, v in existing.items()
                    if k not in _OWNED_TIMELINE_KEYS}
        if leftover:
            timeline_path.write_text(
                json.dumps(leftover, separators=(",", ":")),
                encoding="utf-8",
            )
            manifest["song_timeline"] = "song_timeline.json"
            return
        try:
            timeline_path.unlink(missing_ok=True)
        except OSError:
            pass
        manifest.pop("song_timeline", None)
        return
    payload = _merge_song_timeline_payload(
        _read_existing_song_timeline_payload(source_dir, manifest),
        payload,
    )
    timeline_path.write_text(
        json.dumps(payload, separators=(",", ":")),
        encoding="utf-8",
    )
    manifest["song_timeline"] = "song_timeline.json"


# ── JSONC comment-preservation scanners ──────────────────────────────────────
#
# The editor re-saves arrangements by replacing note content, so preserving
# comments means anchoring each comment to a stable structural identity and
# re-inserting it at the matching spot in the freshly serialized JSON. This is
# best-effort by design (a hand-author who nests a comment deep inside an array
# of notes owns the consequence of editing that note).
#
# Anchoring strategy (phase 2 — full nesting):
#   - Header comments (before the root ``{``) / footer comments (after ``}``)
#     re-insert at the file head / tail.
#   - A comment before a key in an object anchors to ``(*path, 'before-key',
#     key)``. Re-inserts on its own line before the key, indented to match.
#   - A comment before an array element anchors to ``(*path, 'before-elem',
#     sig)`` where ``sig`` is a content signature of the element: objects with a
#     numeric ``t`` key anchor by ``t=<value>`` (the primary key for
#     notes/beats/sections/anchors/etc.); other objects anchor by a compact
#     sorted-JSON hash; scalars/strings anchor by their JSON rendering. Because
#     the anchor is the element's *content identity* (not its index), the
#     comment follows the element across reorders / additions / removals of
#     *other* elements. If the anchored element itself is edited (its ``t``
#     changes) or removed, the comment drifts or drops — the documented
#     best-effort limit.
#   - A trailing comment (before a closing ``}``/`]``) anchors to
#     ``(*path, 'trailing')``. Re-inserts before the close, indented to match.
#   - A comment between ``:`` and a value (rare) anchors to ``(*path,
#     'before-value', key)`` and re-inserts inline after ``:``.
#
# Path components for array-element levels are element *signatures* (not
# indices), so a comment nested inside an array element (e.g. a before-key
# comment on a note object inside ``notes[]``) re-anchors correctly even when
# notes are added/removed before it.

def _jsonc_skip_ws_comments(text: str, pos: int, n: int) -> tuple[int, list[str]]:
    """Skip whitespace and comments from ``pos``. Returns (new_pos, comments)."""
    comments: list[str] = []
    while pos < n:
        ch = text[pos]
        if ch in " \t\r\n":
            pos += 1
            continue
        if ch == "/" and pos + 1 < n and text[pos + 1] == "/":
            end = text.find("\n", pos)
            end = n if end == -1 else end
            comments.append(text[pos:end])
            pos = end
            continue
        if ch == "/" and pos + 1 < n and text[pos + 1] == "*":
            end = text.find("*/", pos + 2)
            end = n if end == -1 else end + 2
            comments.append(text[pos:end])
            pos = end
            continue
        break
    return pos, comments


def _jsonc_read_string(text: str, pos: int, n: int) -> tuple[str, int]:
    """``pos`` is at the opening ``"``. Returns (decoded_value, end_pos) where
    end_pos is one past the closing ``"``. Decodes JSON string escapes."""
    out: list[str] = []
    i = pos + 1
    while i < n:
        ch = text[i]
        if ch == "\\":
            if i + 1 < n:
                esc = text[i + 1]
                simple = {"n": "\n", "t": "\t", "r": "\r", "b": "\b",
                          "f": "\f", '"': '"', "\\": "\\", "/": "/"}
                if esc in simple:
                    out.append(simple[esc])
                    i += 2
                    continue
                if esc == "u":
                    hex4 = text[i + 2:i + 6]
                    try:
                        out.append(chr(int(hex4, 16)))
                    except (ValueError, IndexError):
                        out.append("?")
                    i += 6
                    continue
                out.append(esc)
                i += 2
                continue
            i += 1
            continue
        if ch == '"':
            return "".join(out), i + 1
        out.append(ch)
        i += 1
    return "".join(out), n


def _jsonc_read_scalar(text: str, pos: int, n: int) -> tuple[str, int]:
    """``pos`` is at the start of a scalar (number/true/false/null). Returns
    (raw_text, end_pos) where end_pos is one past the scalar."""
    i = pos
    while i < n:
        ch = text[i]
        if ch in ",]} \t\r\n":
            break
        i += 1
    return text[pos:i], i


def _jsonc_find_matching(text: str, pos: int, n: int) -> int:
    """``pos`` is at ``{`` or ``[``. Returns the index of the matching ``}``/``]``,
    accounting for strings, nested brackets, and comments. Returns ``n`` if
    unmatched."""
    open_ch = text[pos]
    close_ch = "}" if open_ch == "{" else "]"
    depth = 0
    i = pos
    while i < n:
        ch = text[i]
        if ch == '"':
            _, i = _jsonc_read_string(text, i, n)
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "/":
            end = text.find("\n", i)
            i = n if end == -1 else end
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "*":
            end = text.find("*/", i + 2)
            i = n if end == -1 else end + 2
            continue
        if ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return n


def _jsonc_elem_signature(elem) -> str:
    """Stable content signature for an array element, used to anchor comments.

    Objects with a numeric ``t`` key anchor by ``t=<json value>`` (the primary
    key for notes/beats/sections/anchors — stable across edits to the element's
    *other* fields). Other objects anchor by their compact sorted-JSON hash.
    Scalars/strings anchor by their JSON rendering.
    """
    if isinstance(elem, dict):
        t = elem.get("t")
        if isinstance(t, (int, float)) and not isinstance(t, bool):
            return f"t={json.dumps(t)}"
        return json.dumps(elem, sort_keys=True, separators=(",", ":"))
    return json.dumps(elem, separators=(",", ":"))


def _jsonc_extract_comments(text: str) -> dict:
    """Extract comments from a JSONC text, anchored to structural positions.

    Returns ``dict[anchor_tuple, list[comment_str]]``. Each comment includes its
    ``//`` or ``/* */`` delimiters. Anchor tuples:
      ``('header',)`` / ``('footer',)``
      ``(*path, 'before-key', key)``
      ``(*path, 'before-value', key)``
      ``(*path, 'before-elem', sig)``
      ``(*path, 'trailing')``
    where ``path`` is a tuple of ancestor keys (strings) and array-element
    signatures (strings), so nested anchors survive reorders.
    """
    attachments: dict = {}
    n = len(text)
    pos, header = _jsonc_skip_ws_comments(text, 0, n)
    if header:
        attachments[("header",)] = header
    if pos >= n:
        return attachments
    open_ch = text[pos]
    if open_ch not in "{[":
        return attachments
    end = _jsonc_find_matching(text, pos, n)
    root_text = text[pos:end + 1]
    if open_ch == "{":
        _jsonc_process_obj(root_text, (), attachments, [])
    else:
        _jsonc_process_arr(root_text, (), attachments, [])
    _, footer = _jsonc_skip_ws_comments(text, end + 1, n)
    if footer:
        attachments[("footer",)] = footer
    return attachments


def _jsonc_process_obj(text: str, path: tuple, attachments: dict,
                       pending_initial: list[str]) -> None:
    """Process a full object (including ``{`` and ``}``) at ``path``."""
    n = len(text)
    i = 1  # past '{'
    pending = list(pending_initial)
    while i < n:
        i, comments = _jsonc_skip_ws_comments(text, i, n)
        pending += comments
        if i >= n:
            break
        ch = text[i]
        if ch == "}":
            if pending:
                attachments[(*path, "trailing")] = pending
                pending = []
            break
        if ch == ",":
            i += 1
            continue
        if ch == '"':
            key, i = _jsonc_read_string(text, i, n)
            if pending:
                attachments[(*path, "before-key", key)] = pending
                pending = []
            # Comments between the key and ':' / between ':' and the value
            # attach as before-value (re-inserted inline after ':').
            i, c1 = _jsonc_skip_ws_comments(text, i, n)
            before_value = list(c1)
            if i < n and text[i] == ":":
                i += 1
            i, c2 = _jsonc_skip_ws_comments(text, i, n)
            before_value += c2
            if before_value:
                attachments[(*path, "before-value", key)] = before_value
            if i >= n:
                break
            vch = text[i]
            if vch == "{":
                end = _jsonc_find_matching(text, i, n)
                _jsonc_process_obj(text[i:end + 1], path + (key,), attachments, [])
                i = end + 1
            elif vch == "[":
                end = _jsonc_find_matching(text, i, n)
                _jsonc_process_arr(text[i:end + 1], path + (key,), attachments, [])
                i = end + 1
            elif vch == '"':
                _, i = _jsonc_read_string(text, i, n)
            else:
                _, i = _jsonc_read_scalar(text, i, n)
            continue
        break


def _jsonc_process_arr(text: str, path: tuple, attachments: dict,
                       pending_initial: list[str]) -> None:
    """Process a full array (including ``[`` and ``]``) at ``path``."""
    n = len(text)
    i = 1  # past '['
    pending = list(pending_initial)
    while i < n:
        i, comments = _jsonc_skip_ws_comments(text, i, n)
        pending += comments
        if i >= n:
            break
        ch = text[i]
        if ch == "]":
            if pending:
                attachments[(*path, "trailing")] = pending
                pending = []
            break
        if ch == ",":
            i += 1
            continue
        elem_start = i
        if ch == "{" or ch == "[":
            end = _jsonc_find_matching(text, i, n)
            elem_raw = text[i:end + 1]
            i = end + 1
        elif ch == '"':
            _, i = _jsonc_read_string(text, i, n)
            elem_raw = text[elem_start:i]
        else:
            _, i = _jsonc_read_scalar(text, i, n)
            elem_raw = text[elem_start:i]
        try:
            elem_val = _parse_jsonc(elem_raw)
        except Exception:
            elem_val = None
        sig = _jsonc_elem_signature(elem_val)
        if pending:
            attachments[(*path, "before-elem", sig)] = pending
            pending = []
        if ch == "{":
            _jsonc_process_obj(elem_raw, path + (sig,), attachments, [])
        elif ch == "[":
            _jsonc_process_arr(elem_raw, path + (sig,), attachments, [])
        continue


def _jsonc_collect_obj(text: str, open_off: int, path: tuple,
                       attachments: dict, insertions: list) -> int:
    """Walk a clean-JSON object (no comments) at absolute offset ``open_off`` and
    record comment insertions for any anchors present in ``attachments``.
    Returns the offset one past the closing ``}``."""
    n = len(text)
    i = open_off + 1
    while i < n:
        i, _ = _jsonc_skip_ws_comments(text, i, n)
        if i >= n:
            break
        ch = text[i]
        if ch == "}":
            cmts = attachments.get((*path, "trailing"))
            if cmts:
                insertions.append(("trailing", i, cmts))
            return i + 1
        if ch == ",":
            i += 1
            continue
        if ch == '"':
            key_off = i
            key, i = _jsonc_read_string(text, i, n)
            i, _ = _jsonc_skip_ws_comments(text, i, n)
            if i < n and text[i] == ":":
                i += 1
            i, _ = _jsonc_skip_ws_comments(text, i, n)
            cmts = attachments.get((*path, "before-key", key))
            if cmts:
                insertions.append(("line_before", key_off, cmts))
            cmts2 = attachments.get((*path, "before-value", key))
            if cmts2:
                insertions.append(("inline_before", i, cmts2))
            if i >= n:
                break
            vch = text[i]
            if vch == "{":
                i = _jsonc_collect_obj(text, i, path + (key,), attachments, insertions)
            elif vch == "[":
                i = _jsonc_collect_arr(text, i, path + (key,), attachments, insertions)
            elif vch == '"':
                _, i = _jsonc_read_string(text, i, n)
            else:
                _, i = _jsonc_read_scalar(text, i, n)
            continue
        break
    return i


def _jsonc_collect_arr(text: str, open_off: int, path: tuple,
                       attachments: dict, insertions: list) -> int:
    """Walk a clean-JSON array (no comments) at absolute offset ``open_off`` and
    record comment insertions for any anchors present in ``attachments``.
    Returns the offset one past the closing ``]``."""
    n = len(text)
    i = open_off + 1
    while i < n:
        i, _ = _jsonc_skip_ws_comments(text, i, n)
        if i >= n:
            break
        ch = text[i]
        if ch == "]":
            cmts = attachments.get((*path, "trailing"))
            if cmts:
                insertions.append(("trailing", i, cmts))
            return i + 1
        if ch == ",":
            i += 1
            continue
        elem_off = i
        if ch == "{" or ch == "[":
            end = _jsonc_find_matching(text, i, n)
            elem_raw = text[i:end + 1]
            i_after = end + 1
        elif ch == '"':
            _, i_after = _jsonc_read_string(text, i, n)
            elem_raw = text[i:i_after]
        else:
            _, i_after = _jsonc_read_scalar(text, i, n)
            elem_raw = text[i:i_after]
        sig = _jsonc_elem_signature(json.loads(elem_raw))
        cmts = attachments.get((*path, "before-elem", sig))
        if cmts:
            insertions.append(("line_before", elem_off, cmts))
        if ch == "{":
            _jsonc_collect_obj(text, i, path + (sig,), attachments, insertions)
        elif ch == "[":
            _jsonc_collect_arr(text, i, path + (sig,), attachments, insertions)
        i = i_after
        continue
    return i


def _jsonc_save_text(original_text: str, wire) -> str:
    """Produce the ``.jsonc`` text to write for ``wire``, re-inserting comments
    from ``original_text`` — but NEVER returning text that fails to round-trip
    back to ``wire``. Comment preservation is best-effort; if it throws or yields
    text that no longer parses to this exact arrangement (a stray comment can eat
    a token), fall back to the plain comment-less pretty JSON. A dropped comment
    is acceptable; an unreadable / wrong arrangement on disk is not."""
    pretty = json.dumps(wire, indent=2)
    try:
        candidate = _preserve_jsonc_comments(original_text, pretty)
        if _parse_jsonc(candidate) == wire:
            return candidate
    except Exception:
        pass
    return pretty


def _jsonc_inline_comment(c: str) -> str:
    """Render a comment for INLINE placement (mid-line, with content following on
    the same line). A ``//`` line comment would swallow the rest of the line —
    including the following ``,`` / ``}`` / ``]`` — so emit it as a CLOSED
    ``/* … */`` block comment instead (the previous code dropped the closing
    ``*/``, producing an unterminated comment that ate the rest of the file).
    Existing ``/* … */`` block comments are returned unchanged."""
    s = c.strip()
    if s.startswith("//"):
        return "/* " + s[2:].strip() + " */"
    return s


def _preserve_jsonc_comments(original_text: str, new_json_str: str) -> str:
    """Re-insert comments from ``original_text`` into ``new_json_str`` (a freshly
    ``json.dumps(..., indent=2)``-ed object), preserving nested comments on a
    best-effort basis.

    Each comment is anchored to a structural identity in the original (header,
    footer, before-key, before-value, before-elem, trailing) and re-inserted at
    the matching spot in the new JSON. Comments whose anchor (key / element
    signature) no longer exists in the new JSON are dropped. Comments anchored
    to an array element whose ``t`` was edited will drift or drop — the
    documented best-effort limit (a hand-author who nests a comment inside an
    array of notes owns the consequence of editing that note).
    """
    attachments = _jsonc_extract_comments(original_text)
    if not attachments:
        return new_json_str
    insertions: list = []
    n = len(new_json_str)
    i, _ = _jsonc_skip_ws_comments(new_json_str, 0, n)
    if i < n and new_json_str[i] == "{":
        _jsonc_collect_obj(new_json_str, i, (), attachments, insertions)
    elif i < n and new_json_str[i] == "[":
        _jsonc_collect_arr(new_json_str, i, (), attachments, insertions)
    header = attachments.get(("header",))
    if header:
        insertions.append(("line_before", 0, header))
    footer = attachments.get(("footer",))
    if footer:
        insertions.append(("footer", n, footer))
    if not insertions:
        return new_json_str
    # Apply in descending offset order so earlier splice points stay valid.
    insertions.sort(key=lambda r: r[1], reverse=True)
    out = new_json_str
    for mode, off, cmts in insertions:
        if mode == "footer":
            out = out[:off] + "\n" + "".join(c + "\n" for c in cmts) + out[off:]
        elif mode == "trailing":
            # A trailing comment goes one indent level deeper than the close
            # bracket (matching the element/key indent, as a hand-author
            # writes it). Empty containers rendered inline ([]/{}) are expanded
            # so a // line comment doesn't eat the close bracket.
            line_start = out.rfind("\n", 0, off) + 1
            before = out[line_start:off]
            if before.strip() == "":
                inner = before + "  "
                piece = "".join(inner + c + "\n" for c in cmts)
                out = out[:line_start] + piece + out[line_start:]
            elif off > 0 and out[off - 1] in "[{":
                ws = 0
                while ws < len(before) and before[ws] in " \t":
                    ws += 1
                bracket_indent = before[:ws]
                inner_indent = bracket_indent + "  "
                piece = "\n" + "".join(inner_indent + c + "\n" for c in cmts) + bracket_indent
                out = out[:off] + piece + out[off:]
            else:
                piece = " " + " ".join(_jsonc_inline_comment(c) for c in cmts) + " "
                out = out[:off] + piece + out[off:]
        elif mode == "line_before":
            # Insert before the line containing ``off`` — but only when ``off``
            # is at the start of its line (the expanded-container case, e.g. a
            # key / element / close bracket on its own line). When ``off`` is
            # inline (an empty ``[]``/``{}`` rendered inline by json.dumps),
            # inserting at line_start would grab the whole line prefix and
            # corrupt it — and a ``//`` line comment placed inline before the
            # close bracket would eat the bracket (``[ // c ]`` strips to
            # ``[ ``). Defer to the ``trailing``/inline handling instead.
            line_start = out.rfind("\n", 0, off) + 1
            before = out[line_start:off]
            if before.strip() == "":
                piece = "".join(before + c + "\n" for c in cmts)
                out = out[:line_start] + piece + out[line_start:]
            else:
                piece = " " + " ".join(_jsonc_inline_comment(c) for c in cmts) + " "
                out = out[:off] + piece + out[off:]
        elif mode == "inline_before":
            piece = " ".join(cmts) + " "
            out = out[:off] + piece + out[off:]
    return out


def _wem_bytes_to_preferred_audio(content: bytes):
    """Decode WEM bytes with vgmstream and encode to a preferred playback format.

    Wwise ``.wem`` can't be read by browsers or ffmpeg directly. Returns
    ``(Path, None)`` on success — the caller copies the file out and removes its
    parent temp dir — or ``(None, error)``. Preference order: ogg > flac > mp3
    (then the raw vgmstream WAV if no ffmpeg is present at all).
    """
    from lib.audio import (
        _vgmstream_cmd, _decode_wem_to_wav, _ffmpeg_cmd, _ffmpeg_wav_to_ogg,
    )
    vg = _vgmstream_cmd()
    if not vg:
        return None, "vgmstream-cli not available to decode WEM"
    work = Path(tempfile.mkdtemp(prefix="slopsmith_wem_"))
    # On SUCCESS the returned Path lives in `work` and the caller removes `work`
    # after copying it out. On ANY failure (decode error, exception writing/
    # encoding) we own cleanup here so a temp dir is never leaked.
    try:
        wem = work / "in.wem"
        wem.write_bytes(content)
        wav = work / "out.wav"
        ok, detail = _decode_wem_to_wav(vg, str(wem), str(wav))
        if not ok or not wav.exists():
            shutil.rmtree(work, ignore_errors=True)
            return None, f"WEM decode failed: {detail}"
        ff = _ffmpeg_cmd()
        if ff:
            ogg = work / "out.ogg"                       # 1) ogg (preferred)
            r = _ffmpeg_wav_to_ogg(ff, wav, ogg)
            if r.returncode == 0 and ogg.exists() and ogg.stat().st_size > 100:
                return ogg, None
            for suffix, args in ((".flac", ["-c:a", "flac"]),          # 2) flac
                                 (".mp3", ["-c:a", "libmp3lame", "-b:a", "320k"])):  # 3) mp3
                out = work / ("out" + suffix)
                try:
                    rr = subprocess.run([ff, "-y", "-i", str(wav), *args, str(out)],
                                        capture_output=True, timeout=180)
                except (OSError, subprocess.TimeoutExpired):
                    continue
                if rr.returncode == 0 and out.exists() and out.stat().st_size > 100:
                    return out, None
        return wav, None  # no ffmpeg / all encodes failed → keep the WAV
    except Exception as e:
        shutil.rmtree(work, ignore_errors=True)
        return None, f"WEM decode error: {e}"


def _apply_chart_offset(song, delta: float) -> None:
    """Resolve a chart-level ``<offset>`` into ``song``'s absolute times in place.

    Subtracts ``delta`` seconds from every absolute time so the chart becomes
    audio-absolute — the same alignment the player produces when it reads the
    loose-folder ``<offset>`` and applies ``chartTime = audioTime + offset``.
    Bend curve points are onset-relative (``t`` = seconds-from-onset), so
    shifting each note's ``time`` carries them; only absolute fields are touched.
    """
    if not delta:
        return

    def _n(n):
        n.time = round(n.time - delta, 6)

    def _c(c):
        c.time = round(c.time - delta, 6)
        for cn in (c.notes or []):
            # Shift any chord note that carries a numeric absolute time — incl.
            # exactly 0.0 (a note at the chart origin). The old `if cn.time:`
            # skipped 0.0, leaving such a note un-shifted while its chord moved.
            if cn.time is not None:
                cn.time = round(cn.time - delta, 6)

    def _a(a):
        a.time = round(a.time - delta, 6)

    def _h(h):
        h.start_time = round(h.start_time - delta, 6)
        h.end_time = round(h.end_time - delta, 6)

    def _tones(t):
        # `tones` is an opaque {base, changes, definitions} dict; its tone
        # changes carry an absolute time (`t`, or `time` depending on source)
        # that the editor re-emits as `<tone time=...>`, so it must move with
        # everything else. Guard each field — the structure isn't guaranteed.
        if not isinstance(t, dict):
            return
        for ch in t.get("changes") or []:
            if not isinstance(ch, dict):
                continue
            for k in ("t", "time"):
                if isinstance(ch.get(k), (int, float)) and not isinstance(ch.get(k), bool):
                    ch[k] = round(ch[k] - delta, 6)

    for arr in song.arrangements:
        for n in arr.notes:
            _n(n)
        for c in arr.chords:
            _c(c)
        for a in arr.anchors:
            _a(a)
        for h in arr.hand_shapes:
            _h(h)
        _tones(getattr(arr, "tones", None))
        for ph in (arr.phrases or []):
            ph.start_time = round(ph.start_time - delta, 6)
            ph.end_time = round(ph.end_time - delta, 6)
            for lv in ph.levels:
                for n in lv.notes:
                    _n(n)
                for c in lv.chords:
                    _c(c)
                for a in lv.anchors:
                    _a(a)
                for h in lv.hand_shapes:
                    _h(h)

    for b in song.beats:
        b.time = round(b.time - delta, 6)
    for s in song.sections:
        s.start_time = round(s.start_time - delta, 6)
    song.offset = 0.0


def _arrangement_xml_candidates(tmp_dir):
    """Return the source XMLs that represent playable arrangements.

    Same membership filter `lib.song.load_song` applies: a `<song>` root
    whose `<arrangement>` is not vocals / showlights. Returned in raw rglob
    (filesystem) order — callers that need dropdown order must pair via
    `_align_xml_files_to_arrangements`.
    """
    candidates = []
    for xf in Path(tmp_dir).rglob("*.xml"):
        try:
            root = ET.parse(xf).getroot()
        except Exception:
            continue
        if root.tag != "song":
            continue
        el = root.find("arrangement")
        if el is None or not el.text:
            continue
        if el.text.lower().strip() in ("vocals", "showlights", "jvocals"):
            continue
        candidates.append(str(xf))
    return candidates


def _note_chord_signature(notes, chords):
    """Order-independent content fingerprint for one arrangement.

    `notes` and `chords` are iterables of hashable per-element tuples (see
    `_obj_*_sig` / `_dict_*_sig` in `_align_xml_files_to_arrangements`).
    Two arrangements built from the same content produce the same signature
    regardless of XML element order or list ordering, so it can pair
    `result["arrangements"][i]` (built by `_song_to_dict`) back to the XML
    `lib.song.parse_arrangement` read it from. The element tuples carry note
    position + sustain + every authorable technique and full chord voicing,
    so two arrangements only collide when they are genuinely identical in
    chart content. Sorted by `repr` so mixed technique value types
    (None / bool / int / str) never raise on comparison.
    """
    notes = tuple(sorted(notes, key=repr))
    chords = tuple(sorted(chords, key=repr))
    return (len(notes), len(chords), notes, chords)


def _align_xml_files_to_arrangements(tmp_dir, result):
    """Order arrangement XMLs to match `result["arrangements"]`.

    The editor's `arrangement_index` indexes the dropdown, which mirrors
    `result["arrangements"]` (== `song.arrangements`, priority-sorted by
    `load_song`). The save path then writes `xml_files[arrangement_index]`,
    so `xml_files` MUST be in that same order — a raw rglob walk is in
    filesystem order and silently misroutes saves (issue #425).

    Pairs each arrangement to its source XML by note/chord content signature
    (naming-agnostic, so it doesn't duplicate load_song's display-name
    heuristics). Bails out to raw rglob order whenever the pairing can't be
    made unambiguously 1:1 — a parse failure, a count mismatch, OR any two
    candidates sharing a signature (e.g. content-identical empty
    arrangements). In those cases there's no content-based way to tell the
    arrangements apart, so guessing could misroute a save; filesystem order
    is no worse than the pre-fix behaviour. A clean pairing (the normal
    multi-arrangement case) is exact.
    """
    from lib.song import parse_arrangement

    candidates = _arrangement_xml_candidates(tmp_dir)
    arrangements = result.get("arrangements", []) or []

    # --- per-element fingerprints, one pair of builders per source shape ---
    # Objects (lib.song.parse_arrangement) and dicts (_song_to_dict output)
    # must yield IDENTICAL tuples for the same note/chord, so both fold in
    # position, sustain and every `_NOTE_TECH_FIELDS` technique; chords also
    # carry chord_id, high_density and full voicing (each constituent note
    # fingerprinted minus its time, which equals the chord time).
    def _obj_note_sig(n):
        return (
            round(n.time, 3), n.string, n.fret, round(n.sustain or 0.0, 3),
            # Default -1 so the signature stays stable against a core build that
            # predates a field (e.g. the teaching marks before #534 lands) —
            # parse_arrangement notes from older core simply lack the attribute.
            tuple(getattr(n, f, -1) for f in _NOTE_TECH_FIELDS),
        )

    def _obj_chord_sig(c):
        return (
            round(c.time, 3), c.chord_id, getattr(c, "high_density", None),
            tuple(sorted((_obj_note_sig(cn)[1:] for cn in (c.notes or [])),
                         key=repr)),
        )

    def _dict_note_sig(n):
        tech = n.get("techniques") or {}
        return (
            round(float(n.get("time", 0)), 3), n.get("string"), n.get("fret"),
            round(float(n.get("sustain", 0) or 0.0), 3),
            tuple(tech.get(f) for f in _NOTE_TECH_FIELDS),
        )

    def _dict_chord_sig(c):
        return (
            round(float(c.get("time", 0)), 3), c.get("chord_id"),
            c.get("high_density"),
            tuple(sorted((_dict_note_sig(cn)[1:] for cn in (c.get("notes") or [])),
                         key=repr)),
        )

    def _parsed_sig(arr):
        return _note_chord_signature(
            (_obj_note_sig(n) for n in (arr.notes or [])),
            (_obj_chord_sig(c) for c in (arr.chords or [])),
        )

    def _dict_sig(arr):
        return _note_chord_signature(
            (_dict_note_sig(n) for n in (arr.get("notes") or [])),
            (_dict_chord_sig(c) for c in (arr.get("chords") or [])),
        )

    sig_to_xml = {}
    for xf in candidates:
        try:
            arr = parse_arrangement(xf)
        except Exception:
            return candidates  # can't fingerprint every XML — don't guess
        sig = _parsed_sig(arr)
        if sig in sig_to_xml:
            return candidates  # duplicate signature — pairing is ambiguous
        sig_to_xml[sig] = xf

    if len(sig_to_xml) != len(arrangements):
        return candidates  # count mismatch — fall back to filesystem order

    # Pop as we go so the mapping is a strict bijection: if two arrangements
    # resolved to the same XML (a result-side duplicate signature), the
    # second lookup misses and we bail rather than bind one XML twice.
    remaining = dict(sig_to_xml)
    aligned = []
    for arr in arrangements:
        sig = _dict_sig(arr)
        if sig not in remaining:
            return candidates  # unmatched / already-claimed — bail out
        aligned.append(remaining.pop(sig))
    return aligned


def _mix_stems_for_editor(stem_paths: list, dest) -> bool:
    """Mix multiple per-instrument stems into one Ogg file for editor
    playback. A stem-split sloppak has no `full` mix on disk, so without
    this the editor would play only the first stem (a lone instrument).

    Re-encodes on every call (no mtime cache): the `full` / single-stem
    branches re-copy each load too, and an mtime cache could serve a
    stale mix if a sloppak is replaced in place with stems carrying
    older timestamps. Returns True when `dest` holds a usable mix.
    """
    if len(stem_paths) < 2:
        return False

    ffmpeg = None
    try:
        from lib.audio import _ffmpeg_cmd
        ffmpeg = _ffmpeg_cmd()
    except Exception:
        ffmpeg = None
    if not ffmpeg:
        ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return False

    inputs = []
    for p in stem_paths:
        inputs += ["-i", str(p)]
    # normalize=0: sum the stems without amix's default ÷N attenuation —
    # demucs stems sum back to ~the original mix level.
    base = [ffmpeg, "-y", *inputs,
            "-filter_complex", f"amix=inputs={len(stem_paths)}:normalize=0"]
    # Encode to a UNIQUE temp file, then atomically rename onto `dest`.
    # Unique (mkstemp) so two concurrent loads of the same audio_id don't
    # race on one temp path; the `dest.suffix` (.ogg) is kept so ffmpeg
    # still infers the Ogg muxer from the extension.
    fd, tmp_name = tempfile.mkstemp(
        dir=str(dest.parent), prefix="editor_audio_mix_", suffix=dest.suffix)
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        # Prefer libvorbis; fall back to the built-in encoder if the
        # ffmpeg build lacks it (mirrors lib.audio._ffmpeg_wav_to_ogg).
        for enc in (["-c:a", "libvorbis", "-q:a", "5"],
                    ["-c:a", "vorbis", "-strict", "experimental", "-q:a", "5"]):
            try:
                r = subprocess.run(base + enc + [str(tmp)],
                                   capture_output=True, timeout=180)
                if r.returncode == 0 and tmp.exists() and tmp.stat().st_size > 0:
                    tmp.replace(dest)
                    return True
            except (subprocess.SubprocessError, OSError):
                pass
        return False
    finally:
        # Drop the temp file unless a successful encode already renamed
        # it onto `dest`.
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


# ── XML / wire helpers ─────────────────────────────────────────────────────
# Module-level so tests can import them directly. They're pure (only read
# their params + module-level constants like _YEAR_RE / ET / minidom), so
# nothing forces them to live inside setup().


def _tones_from_old_root(old_root):
    """Extract `{base, changes, definitions}` from an existing arrangement XML.

    `definitions` always comes through as `[]` here — gear chains live in
    the archive manifest, not the XML. The editor authors names only, so
    the archive manifest's existing tone definitions stay untouched by the
    save pipeline anyway. Returns None when the source has no tones.
    """
    if old_root is None:
        return None
    base_el = old_root.find("tonebase")
    base = base_el.text.strip() if base_el is not None and base_el.text else ""
    changes = []
    tones_el = old_root.find("tones")
    if tones_el is not None:
        for t in tones_el.findall("tone"):
            try:
                time_v = float(t.get("time", "0"))
            except (TypeError, ValueError):
                continue
            name = t.get("name", "")
            if not name:
                continue
            changes.append({"t": time_v, "name": name})
    if not base and not changes:
        return None
    return {"base": base, "changes": changes, "definitions": []}


def _handshapes_from_old_root(old_root):
    """Extract handshapes from the first `<level>` of an existing XML."""
    if old_root is None:
        return []
    level = old_root.find(".//levels/level")
    if level is None:
        return []
    container = level.find("handShapes")
    if container is None:
        return []
    out = []
    for h in container.findall("handShape"):
        try:
            out.append({
                "chord_id": int(h.get("chordId", -1)),
                "start_time": float(h.get("startTime", 0)),
                "end_time": float(h.get("endTime", 0)),
                "arp": h.get("arpeggio") in ("1", "true", "True"),
            })
        except (TypeError, ValueError):
            continue
    return out


def _safe_int(v, default=-1):
    """Best-effort int coercion; returns `default` for bad / non-numeric input."""
    if v is None:
        return default
    if isinstance(v, bool):  # bool is a subclass of int — refuse silently
        return default
    try:
        return int(v)
    except (ValueError, TypeError):
        try:
            return int(float(v))
        except (ValueError, TypeError):
            return default


def _fret_finger_attr(techs):
    """fret-hand finger (§6.2.2) for the chart-XML `fretFinger` attribute,
    collapsed to -1 (unset) when out of the spec's 0–4 range — so a malformed
    or hand-edited value can't round-trip an invalid finger into core."""
    v = _safe_int(techs.get("fret_finger"), -1)
    return v if 0 <= v <= 4 else -1


def _chord_fn_wire(fn):
    """Validate a chord-instance harmony function (§6.3.1) for the wire.

    Returns a clean ``{"rn", "q", "deg"}`` dict only when ``fn`` is an object
    with a non-empty ``rn`` string, a non-empty ``q`` string, and an int ``deg``
    in 0..11 — else ``None``. The spec requires all three keys when ``fn`` is
    present, so a partial / out-of-range fn (the inspector may hold one mid-edit)
    is emitted as *omitted* rather than a schema-invalid object. Mirrors core's
    `_validate_fn` and the teaching-marks range-guard. Display only — never grading."""
    if not isinstance(fn, dict):
        return None
    rn = fn.get("rn")
    q = fn.get("q")
    deg = fn.get("deg")
    if not isinstance(rn, str) or not rn.strip():
        return None
    if not isinstance(q, str) or not q.strip():
        return None
    # bool is an int subclass — reject so deg=True can't pass as 1.
    if not isinstance(deg, int) or isinstance(deg, bool) or not (0 <= deg <= 11):
        return None
    return {"rn": rn.strip(), "q": q.strip(), "deg": deg}


# §6.6 CAGED shape enum — the only values accepted onto the wire.
_CAGED_SHAPES = ("C", "A", "G", "E", "D")


def _caged_wire(caged):
    """Validate a template CAGED shape (§6.6) for the wire: returns the trimmed
    enum letter ("C"/"A"/"G"/"E"/"D"), else "" (omitted). Mirrors core's
    `_sanitize_caged`. Display only — never grading."""
    c = caged.strip() if isinstance(caged, str) else ""
    return c if c in _CAGED_SHAPES else ""


def _guide_tones_wire(tones):
    """Validate template guide tones (§6.6) for the wire: returns the int entries
    in 0..11, dropping non-ints (bool rejected) and out-of-range values so a
    malformed value never reaches the wire. Mirrors core's `_sanitize_guide_tones`.
    Display only — never grading."""
    if not isinstance(tones, list):
        return []
    return [v for v in tones
            if isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 11]


def _extended_manifest_meta(src) -> dict:
    """Normalize the spec-complete optional manifest fields (album_artist, track,
    disc, genres, isrc, mbid, language, authors) from a create/import request
    into the shapes `_write_sloppak_pak` expects — so a Guitar Pro / EOF import
    persists the same metadata the blank-create path does (these fields are shown
    for every create flow but were previously written only for blank projects).
    Lenient: a malformed field is skipped, not an error (secondary to the import).
    """
    if not isinstance(src, dict):
        return {}
    out: dict = {}

    def _s(name):
        v = src.get(name)
        return v.strip() if isinstance(v, str) else ""

    for _k in ("album_artist", "language"):
        if _s(_k):
            out[_k] = _s(_k)
    if _s("mbid"):
        out["mbid"] = _s("mbid").lower()
    if _s("isrc"):
        out["isrc"] = re.sub(r"[\s-]", "", _s("isrc")).upper()
    for _k in ("track", "disc"):
        v = src.get(_k)
        if isinstance(v, bool):
            continue
        if isinstance(v, int):
            out[_k] = v
        elif isinstance(v, str) and v.strip().lstrip("-").isdigit():
            out[_k] = int(v.strip())

    def _list(name):
        v = src.get(name)
        if isinstance(v, str):
            v = re.split(r"[,\n]", v)
        items, seen = [], set()
        if isinstance(v, list):
            for it in v:
                s = str(it).strip() if it is not None else ""
                if s and s not in seen:
                    seen.add(s)
                    items.append(s)
        return items

    for _k in ("genres", "authors"):
        vals = _list(_k)
        if vals:
            out[_k] = vals
    return out


def _safe_float(v, default=0.0):
    """Best-effort float coercion; returns `default` for bad input."""
    if v is None:
        return default
    if isinstance(v, bool):
        return default
    try:
        return float(v)
    except (ValueError, TypeError):
        return default


def _safe_bool(v, default=False):
    """Coerce a wire-style boolean to a real bool.

    Accepts native `True`/`False`, integer 0/1, and the common string
    spellings (`"true"`/`"false"`, `"1"`/`"0"`, `"yes"`/`"no"`). Python's
    built-in `bool("false")` is `True` because the string is non-empty
    — guard against that pitfall when the value originates from a wire
    payload or a hand-edited sloppak.
    """
    if isinstance(v, bool):
        return v
    if v is None:
        return default
    if isinstance(v, (int, float)):
        return bool(v)
    if isinstance(v, str):
        s = v.strip().lower()
        if s in ("true", "1", "yes"):
            return True
        if s in ("false", "0", "no", ""):
            return False
    return default


def _safe_bend_curve(raw):
    """Sanitize an editor bend curve ([{t, v}], §6.2.1) for the wire: drop
    non-dict / non-finite entries, round (t to 3, v to 1, matching `bn`), and
    sort by `t`. Returns None for non-list / empty / all-invalid input so an
    absent curve round-trips as *omitted*, never []."""
    if not isinstance(raw, list):
        return None
    out = []
    for p in raw:
        if not isinstance(p, dict):
            continue
        t, v = p.get("t"), p.get("v")
        if (not isinstance(t, (int, float)) or isinstance(t, bool)
                or not math.isfinite(t)):
            continue
        if (not isinstance(v, (int, float)) or isinstance(v, bool)
                or not math.isfinite(v)):
            continue
        out.append({"t": round(float(t), 3), "v": round(float(v), 1)})
    if not out:
        return None
    out.sort(key=lambda e: e["t"])
    return out


def _valid_anchor_dicts(seq):
    """Coerce a candidate anchors list into clean {time, fret, width} dicts.

    Drops non-list input, non-dict entries, entries missing required
    keys, and entries with non-finite or negative `time` (can't legally
    appear in arrangement XML). `fret` is clamped to >= 1 to match
    `_compute_anchors`; `width` is clamped to >= 1 so a malformed
    `width=0` can't produce a zero-width anchor. The returned list is
    time-sorted so downstream consumers see the same ordering whether
    anchors came from the client or from `_compute_anchors`.
    """
    out = []
    if not isinstance(seq, list):
        return out
    for a in seq:
        if not isinstance(a, dict) or "time" not in a or "fret" not in a:
            continue
        try:
            t = float(a["time"])
        except (TypeError, ValueError):
            continue
        if not math.isfinite(t) or t < 0:
            continue
        try:
            fret = int(a["fret"])
            width = int(a.get("width", 4))
        except (TypeError, ValueError):
            continue
        out.append({
            "time": t,
            "fret": max(1, fret),
            "width": max(1, width),
        })
    out.sort(key=lambda a: a["time"])
    return out


def _valid_handshape_dicts(seq):
    """Coerce a candidate handshapes list into clean dicts; drop bad entries.

    A handshape with a missing / negative `chord_id` is dropped rather
    than kept with the `-1` sentinel — arrangement XML treats `chordId`
    as a non-negative (zero-based) index into `<chordTemplates>`, so
    emitting `chordId="-1"` would write a malformed handshape into the
    output. Same idea for `start_time` / `end_time`: non-finite or
    negative values can't appear in arrangement XML, and `end_time <
    start_time` is structurally invalid (the highway uses the range
    for chord-shape lifetime). The `arp` flag goes through
    `_safe_bool` so a wire-style `"false"` / `"0"` doesn't silently
    become `True` via Python's string truthiness.
    """
    out = []
    if not isinstance(seq, list):
        return out
    for h in seq:
        if not isinstance(h, dict):
            continue
        cid = _safe_int(h.get("chord_id"), -1)
        if cid < 0:
            continue
        try:
            start_t = float(h.get("start_time", 0))
            end_t = float(h.get("end_time", 0))
        except (TypeError, ValueError):
            continue
        if not (math.isfinite(start_t) and math.isfinite(end_t)):
            continue
        if start_t < 0 or end_t < 0 or end_t < start_t:
            continue
        out.append({
            "chord_id": cid,
            "start_time": start_t,
            "end_time": end_t,
            "arp": _safe_bool(h.get("arp", h.get("arpeggio", False))),
        })
    return out


def _compute_anchors(notes, chords):
    """Auto-generate anchors from note fret positions."""
    all_fretted = []
    for n in notes:
        if n["fret"] > 0:
            all_fretted.append((n["time"], n["fret"]))
    for ch in chords:
        for cn in ch.get("notes", []):
            if cn["fret"] > 0:
                all_fretted.append((cn["time"], cn["fret"]))

    all_fretted.sort(key=lambda x: x[0])

    if not all_fretted:
        return [{"time": 0.0, "fret": 1, "width": 4}]

    anchors = [{
        "time": 0.0,
        "fret": max(1, all_fretted[0][1] - 1),
        "width": 4,
    }]

    for t, fret in all_fretted:
        a = anchors[-1]
        if fret < a["fret"] or fret > a["fret"] + a["width"]:
            new_fret = max(1, fret - 1)
            if new_fret != a["fret"]:
                anchors.append({"time": t, "fret": new_fret, "width": 4})

    return anchors


def _arr_dict_to_wire(
    name, tuning, capo, notes, chords, chord_templates,
    *, tones=None, handshapes=None, anchors_user=None,
):
    """Convert editor's long-named arrangement dict into sloppak wire format.

    Editor uses {time, string, fret, sustain, techniques: {bend, slide_to,
    ...}}; the wire format uses {t, s, f, sus, sl, bn, ho, ...}.

    `tones` (opaque {base, changes, definitions}) round-trips verbatim
    through the sloppak loader. `handshapes` / `anchors_user` (when
    provided) replace the empty defaults the wire emits, so the editor's
    authored values survive save → reload.
    """
    def _note(n):
        tech = n.get("techniques", {}) or {}
        out = {
            "t": round(float(n.get("time", 0)), 3),
            "s": int(n.get("string", 0)),
            "f": int(n.get("fret", 0)),
            "sus": round(float(n.get("sustain", 0)), 3),
            "sl": _safe_int(tech.get("slide_to"), -1),
            "slu": _safe_int(tech.get("slide_unpitch_to"), -1),
            "bn": round(_safe_float(tech.get("bend"), 0.0), 1),
            # `_safe_bool` so wire-style strings like "false" / "0" can't
            # silently flip a technique on via Python's string truthiness.
            "ho": _safe_bool(tech.get("hammer_on")),
            "po": _safe_bool(tech.get("pull_off")),
            "hm": _safe_bool(tech.get("harmonic")),
            "hp": _safe_bool(tech.get("harmonic_pinch")),
            "pm": _safe_bool(tech.get("palm_mute")),
            "mt": _safe_bool(tech.get("mute")),
            "tr": _safe_bool(tech.get("tremolo")),
            "ac": _safe_bool(tech.get("accent")),
            "tp": _safe_bool(tech.get("tap")),
            "ln": _safe_bool(tech.get("link_next")),
            "vb": _safe_bool(tech.get("vibrato")),
            "fhm": _safe_bool(tech.get("fret_hand_mute")),
            "plk": _safe_bool(tech.get("pluck")),
            "slp": _safe_bool(tech.get("slap")),
            "rh": _safe_int(tech.get("right_hand"), -1),
            "pkd": _safe_int(tech.get("pick_direction"), -1),
            "ig": _safe_bool(tech.get("ignore")),
        }
        # Bend shape (§6.2.1) — default-omitted, matching core's note_to_wire:
        # `bt` only when non-zero, `bnv` only when a curve is present.
        _bt = _safe_int(tech.get("bend_intent"), 0)
        if _bt:
            out["bt"] = _bt
        _bnv = _safe_bend_curve(tech.get("bend_values"))
        if _bnv:
            out["bnv"] = _bnv
        # Teaching marks (§6.2.2) — default-omitted, matching core's note_to_wire.
        # Display only; never used for grading. Range-guarded server-side so a
        # malformed/out-of-range client value (the inspector clamps, but loaded
        # or hand-edited data may not) is treated as unset rather than emitted as
        # a schema-invalid `fg`/`ch`/`sd` (spec §6.2.2: fg 0–4, sd 0–11, ch ≥ 0).
        _fg = _safe_int(tech.get("fret_finger"), -1)
        if 0 <= _fg <= 4:
            out["fg"] = _fg
        _ch = _safe_int(tech.get("strum_group"), -1)
        if _ch >= 0:
            out["ch"] = _ch
        _sd = _safe_int(tech.get("scale_degree"), -1)
        if 0 <= _sd <= 11:
            out["sd"] = _sd
        return out

    def _note_in_chord(n):
        d = _note(n)
        d.pop("t", None)
        return d

    wire = {
        "name": name,
        "tuning": list(tuning),
        "capo": int(capo),
        "notes": [_note(n) for n in notes],
        "chords": [
            {
                "t": round(float(c.get("time", 0)), 3),
                "id": int(c.get("chord_id", -1)),
                "hd": _safe_bool(c.get("high_density")),
                "notes": [_note_in_chord(cn) for cn in c.get("notes", [])],
                # Harmony function (§6.3.1) — default-omitted, range-guarded so a
                # partial / out-of-range fn never rides the wire (matches core).
                **({"fn": _cfn} if (_cfn := _chord_fn_wire(c.get("fn"))) else {}),
            }
            for c in chords
        ],
        # Mirror `_build_arrangement_xml`'s semantic: when authored anchors
        # validate to a non-empty list, persist them; otherwise fall back
        # to `_compute_anchors` so the saved sloppak never ends up with
        # zero anchors (the highway needs them for fret-hand positioning).
        "anchors": [
            {
                "time": round(a["time"], 3),
                "fret": a["fret"],
                "width": a["width"],
            }
            for a in (
                _valid_anchor_dicts(anchors_user)
                or _compute_anchors(notes, chords)
            )
        ],
        # Drop handshapes whose `chord_id` points past the available
        # chord templates — mirrors the XML writer's bound and keeps
        # the sloppak side from persisting an invalid index.
        "handshapes": [
            {
                "chord_id": h["chord_id"],
                "start_time": round(h["start_time"], 3),
                "end_time": round(h["end_time"], 3),
                "arp": h["arp"],
            }
            for h in _valid_handshape_dicts(handshapes)
            if h["chord_id"] < len(chord_templates)
        ],
        "templates": [
            {
                "name": ct.get("name", ""),
                "displayName": ct.get("displayName", ct.get("name", "")),
                "arp": bool(ct.get("arp", False)),
                "fingers": list(ct.get("fingers", [-1]*6)),
                "frets": list(ct.get("frets", [-1]*6)),
                # Voicing (§6.6) — default-omitted, only when a non-empty string.
                **({"voicing": _v.strip()}
                   if isinstance((_v := ct.get("voicing")), str) and _v.strip() else {}),
                # CAGED shape (§6.6) — default-omitted, only when a valid enum letter.
                **({"caged": _c} if (_c := _caged_wire(ct.get("caged"))) else {}),
                # Guide tones (§6.6) — default-omitted; only the int entries in 0..11
                # (bool rejected), never an out-of-range value.
                **({"guideTones": _gt}
                   if (_gt := _guide_tones_wire(ct.get("guideTones"))) else {}),
            }
            for ct in chord_templates
        ],
    }
    if tones:
        wire["tones"] = tones
    return wire


# Keys-family arrangement names (piano/keyboard/synth) get a notation sidecar in
# addition to the legacy guitar-wire arrangement, so the notation renderers
# (Keys Highway 3D, Staff View) can read editor-authored piano parts instead of
# only the 2D piano plugin. The measure/duration/hand-split inference is the
# shared core in slopsmith `lib/notation_lift.py` (factored out of the one-time
# scripts/lift_keys_notation.py lifter), reached here the same way the rest of
# this module reaches core helpers — `lib/` is on the host app's import path.
_KEYS_NAME_RE = re.compile(r"\b(keys|piano|keyboard|synth)\b", re.IGNORECASE)
_NOTATION_SAFE_ID_RE = re.compile(r"[A-Za-z0-9_-]+")


def _notes_fingerprint(notes, chords) -> str:
    """Stable fingerprint of an arrangement's note identities (pitch, position,
    timing, duration) — the parts GP-sourced notation reflects. Deliberately
    ignores guitar techniques (irrelevant to keys/staff notation). Accepts both
    the editor note shape ({time, string, fret, sustain}) and the wire shape
    ({t, s, f, sus}) so the same value can be computed at GP-import time (from
    the editor arrangement) and at save time (from the built wire); the two
    agree exactly when the notes are unedited. This is the invalidation key:
    GP notation is kept only while it matches, so any note edit falls through
    to the notation_lift re-derivation (edits win)."""
    import hashlib

    def _tup(n):
        return (
            round(float(n.get("t", n.get("time", 0)) or 0), 3),
            int(n.get("s", n.get("string", 0)) or 0),
            int(n.get("f", n.get("fret", 0)) or 0),
            round(float(n.get("sus", n.get("sustain", 0)) or 0), 3),
        )

    note_tuples = sorted(_tup(n) for n in (notes or []))
    chord_tuples = sorted(
        (
            round(float(c.get("t", c.get("time", 0)) or 0), 3),
            tuple(sorted(_tup(cn) for cn in (c.get("notes") or []))),
        )
        for c in (chords or [])
    )
    blob = json.dumps([note_tuples, chord_tuples], separators=(",", ":"))
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()


def _read_gp_sidecar(nt_path):
    """Return a previously-written GP-sourced (``source == "gp"``) notation
    payload from disk, else ``None``. Used on reopen: an existing GP sidecar in
    the pak's working dir is honored (subject to the fingerprint check) so a
    save that didn't touch the notes doesn't clobber it with a fresh, less
    accurate ``notation_lift`` pass."""
    try:
        data = json.loads(Path(nt_path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) and data.get("source") == "gp" else None


def _validate_notation(payload):
    """(ok, reason) via the core notation schema. Conservative: if the core
    validator can't be imported, treat as invalid so we never write an
    unvouched sidecar (the caller falls back to the self-validating lift)."""
    try:
        from lib import notation as _notation_mod
    except ImportError:
        try:
            import notation as _notation_mod  # lib/ flat on path (tests / some hosts)
        except ImportError:
            return False, "core notation validator unavailable"
    validate = getattr(_notation_mod, "validate_notation", None)
    if not callable(validate):
        return False, "core notation validator unavailable"
    try:
        return validate(payload)
    except Exception as e:  # a validator crash must not abort the save
        return False, f"validator error: {e}"


def _gp_notation_sidecar_path(xml_path):
    """``{xml_stem}.notation.json`` next to ``xml_path`` — matching gp2notation's
    writer exactly. The writer uses ``p.with_name(p.stem + ".notation.json")``,
    NOT ``p.with_suffix("").with_suffix(".notation.json")`` — the latter mangles
    a track name with an interior dot (e.g. ``Piano v1.2`` →
    ``Piano v1.notation.json``), silently missing the sidecar and dropping the
    GP notation. Uses the core lib's own contract when importable, else the
    identical local derivation."""
    p = Path(xml_path)
    try:
        from gp2notation import notation_sidecar_path
        return Path(notation_sidecar_path(str(p)))
    except Exception:
        return p.with_name(p.stem + ".notation.json")


def _warp_notation_sidecar(xml_path, warp) -> None:
    """Retime a GP notation sidecar (``<stem>.notation.json``) in place with
    the given time-mapping callable.

    convert_file writes sidecar times on the conversion timeline; when the
    per-bar sync warp retimes the arrangement, the sidecar must follow or
    the keys notation view desyncs from the notes. Absolute times live in
    ``measures[].t`` and each voice beat's ``t`` (``dur`` is notational, not
    seconds). Missing/malformed sidecars are left untouched.
    """
    sidecar = _gp_notation_sidecar_path(xml_path)
    if not sidecar.exists():
        return
    try:
        payload = json.loads(sidecar.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    if not isinstance(payload, dict) or not isinstance(payload.get("measures"), list):
        return
    for measure in payload["measures"]:
        if not isinstance(measure, dict):
            continue
        if isinstance(measure.get("t"), (int, float)):
            measure["t"] = round(warp(float(measure["t"])), 3)
        staves = measure.get("staves")
        if not isinstance(staves, dict):
            continue
        for staff in staves.values():
            if not isinstance(staff, dict):
                continue
            for voice in staff.get("voices") or []:
                if not isinstance(voice, dict):
                    continue
                for beat in voice.get("beats") or []:
                    if isinstance(beat, dict) and isinstance(beat.get("t"), (int, float)):
                        beat["t"] = round(warp(float(beat["t"])), 3)
    try:
        sidecar.write_text(json.dumps(payload), encoding="utf-8")
    except OSError:
        import logging as _elog
        _elog.getLogger("slopsmith.plugin.editor").warning(
            "could not rewrite warped notation sidecar %s", sidecar)


def _attach_gp_notation(arr, xml_path):
    """Attach the GP-emitted notation sidecar for ``xml_path`` to ``arr`` as
    ``_gp_notation``, stamped ``source:"gp"`` plus a fingerprint of ``arr``'s
    notes. The stamp is what lets the save/build path keep the GP notation only
    while the notes are unedited (see ``_write_keys_notation_sidecar``). Matches
    strictly by stem: a missing sidecar is left missing (the save falls back to
    ``notation_lift``) — never back-filled from an unrelated track's sidecar,
    which would persist the wrong part's notation."""
    sidecar = _gp_notation_sidecar_path(xml_path)
    if not sidecar.exists():
        return
    try:
        payload = json.loads(sidecar.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    if not isinstance(payload, dict):
        return
    payload["source"] = "gp"
    payload["source_notes_fp"] = _notes_fingerprint(
        arr.get("notes"), arr.get("chords"))
    arr["_gp_notation"] = payload


def _write_keys_notation_sidecar(source_dir, entry, wire, beats, *, ts=(4, 4),
                                 gp_notation=None):
    """Derive ``notation_<id>.json`` for one keys arrangement and add the
    per-arrangement ``notation:`` key to ``entry`` (mutated in place) so the
    manifest dump picks it up (sloppak-spec §5.3).

    Dual-write: the caller writes the legacy wire arrangement separately and
    leaves it intact — this only adds the notation sidecar, with notation as the
    source of truth for the notation renderers. Returns the sidecar filename on
    success, else ``None`` (non-keys name, unsafe id, core lib unavailable, or
    nothing to lift — e.g. no notes / no song downbeats), in which case the
    arrangement is saved as legacy wire only.
    """
    import logging as _logging
    _log = _logging.getLogger("slopsmith.plugin.editor")

    name = str(entry.get("name") or "")
    aid = entry.get("id")
    if not _KEYS_NAME_RE.search(name):
        return None
    if not (isinstance(aid, str) and _NOTATION_SAFE_ID_RE.fullmatch(aid)):
        return None

    src = Path(source_dir).resolve()
    nt_name = f"notation_{aid}.json"
    nt_path = (src / nt_name).resolve()
    try:
        # Constrain the write to source_dir (the id is already regex-guarded,
        # but resolve-and-check defends against any surprise).
        nt_path.relative_to(src)
    except ValueError:
        return None

    def _drop_stale():
        # This is a keys arrangement we own, but we couldn't (re)generate
        # notation this save. A pre-existing `notation:` key + sidecar (from an
        # earlier save) would otherwise strand the notation renderers on stale
        # data that no longer matches the just-written legacy wire — so clear
        # both. No-op when there was nothing stale.
        had_key = entry.pop("notation", None) is not None
        if had_key or nt_path.exists():
            nt_path.unlink(missing_ok=True)
            _log.info("keys arrangement %r: cleared stale notation sidecar", aid)

    # Prefer GP-sourced notation — it carries exact per-stave/voice hand
    # assignments that notation_lift can only heuristically re-derive — but
    # only while it still matches the current notes. The candidate is either
    # the payload forwarded from a fresh GP import (`gp_notation`) or, on a
    # reopened pak, the existing `source:"gp"` sidecar on disk. It is honored
    # only when its stored note-fingerprint equals the arrangement's current
    # notes: any edit since import/load flips the fingerprint and we fall
    # through to the lift so the user's edits win (never a frozen import-time
    # payload rendered over edited notes, and never clobbered on an untouched
    # reopen-save). The payload is schema-validated first — we never stamp a
    # server-vouched `notation:` for a truncated/tampered client payload — and
    # re-stamped so provenance + fingerprint persist for the next save.
    gp_candidate = gp_notation if isinstance(gp_notation, dict) \
        else _read_gp_sidecar(nt_path)
    if isinstance(gp_candidate, dict) and gp_candidate.get("source") == "gp":
        fp_now = _notes_fingerprint(wire.get("notes"), wire.get("chords"))
        if gp_candidate.get("source_notes_fp") == fp_now:
            payload = dict(gp_candidate)
            payload["source"] = "gp"
            payload["source_notes_fp"] = fp_now
            ok, reason = _validate_notation(payload)
            if ok:
                try:
                    nt_path.write_text(
                        json.dumps(payload, separators=(",", ":")),
                        encoding="utf-8")
                    entry["notation"] = nt_name
                    _log.info(
                        "keys arrangement %r: kept GP-sourced notation sidecar", aid)
                    return nt_name
                except OSError:
                    _log.warning("keys arrangement %r: failed to write GP "
                                 "notation, falling back to lift", aid)
            else:
                _log.warning("keys arrangement %r: GP notation failed validation "
                             "(%s), falling back to lift", aid, reason)

    try:
        import notation_lift  # core slopsmith lib (on the host app's path)
    except ImportError:
        _log.warning(
            "core notation lib unavailable — keys arrangement %r saved as "
            "legacy wire only", aid)
        _drop_stale()
        return None

    try:
        wire_notes = notation_lift.decode_wire_notes(wire or {})
        payload = notation_lift.build_notation(
            wire_notes, beats or [], ts=ts, instrument="piano")
    except (ValueError, AttributeError, TypeError):
        # build_notation validates its own output and raises ValueError on an
        # invalid payload — never persist something the loader would drop. The
        # AttributeError/TypeError guard covers a future notation_lift signature
        # drift: a helper hiccup must degrade to legacy-wire-only, never abort
        # the user's whole save.
        _log.exception(
            "notation build failed for keys arrangement %r — legacy wire only",
            aid)
        _drop_stale()
        return None
    if payload is None:
        _log.info(
            "keys arrangement %r: no notes or no downbeats — legacy wire only",
            aid)
        _drop_stale()
        return None

    nt_path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    entry["notation"] = nt_name
    return nt_name


def _populate_notation_notes(arrangements, notation_by_id):
    """Round-trip load: populate a notation-only arrangement's note list from
    its notation so the piano-roll shows it.

    A notation-only arrangement (a manifest `notation:` entry with no legacy
    wire `file:` — e.g. a MusicXML import) loads with an empty note list. For
    each such arrangement (matched by id, and only when it carries no wire notes
    — a dual-written arrangement keeps its authored wire, whose notation was
    derived from it), convert the notation back to editor notes via the shared
    core `notation.notation_to_notes` flattener. Mutates ``arrangements`` in
    place; a no-op when there's no notation or core lib is unavailable.

    Note: on save the editor re-derives notation via the heuristic, so a
    notation→wire→notation cycle can drift on hand assignment / written
    durations (tracked round-trip-fidelity follow-up).
    """
    if not notation_by_id:
        return
    try:
        from lib import notation as _notation_mod
    except ImportError:
        return
    # Older core may not carry the flattener — degrade to empty (no crash).
    _flatten = getattr(_notation_mod, "notation_to_notes", None)
    if not callable(_flatten):
        return
    for arr_data in arrangements or []:
        nt = notation_by_id.get(arr_data.get("id"))
        # Only a genuinely notation-only arrangement (no authored wire content at
        # all) gets populated from notation. A dual-written arrangement keeps its
        # wire authoritative — including a chord-only one (notes empty but chords
        # present), which must NOT have notation notes injected.
        if not nt or arr_data.get("notes") or arr_data.get("chords"):
            continue
        arr_data["notes"] = [
            {
                "time": n["t"],
                "string": n["midi"] // 24,
                "fret": n["midi"] % 24,
                "sustain": n["sus"],
                "techniques": {},
            }
            for n in _flatten(nt)
        ]


def _repopulate_phrase_levels(phrases, notes, chords, anchors):
    """Re-slice each phrase level's notes/chords/anchors from the flat
    editor lists.

    The editor authors a single flat note/chord/anchor list per
    arrangement; the multi-level `phrases[].levels[]` structure comes
    from the source archive and the editor UI does not re-author it. If
    we round-trip those levels verbatim on save, the highway's
    mastery-filter consumer (`static/highway.js`) reads stale per-level
    notes and silently renders the original chart — additions, edits,
    and deletions all vanish.

    Repopulating every level with the same flat-list slice for the
    phrase's time window makes the mastery slider a no-op (each
    level renders the same notes) but keeps the rest of the chart
    correct. Handshapes round-trip verbatim — the editor doesn't
    expose them and they're tied to chord templates that don't shift
    on per-note edits.

    Phrase boundaries are derived from each phrase's `start_time`
    and the *next* phrase's `start_time` (with the first phrase's
    window extending back to -inf and the last forward to +inf).
    Trusting the stored `end_time` instead would mis-bucket notes
    after a tempo remap — the editor's tempo-edit path updates note
    times and phrase `start_time` but does not touch `end_time`, so
    `end_time` can drift out of sync with both the notes and the
    next phrase's start. Anchors and notes outside any phrase's
    window (gaps in the source archive's phrase coverage, or user
    additions past the song's original phrase data) still need to
    surface on the highway, so the first/last phrases swallow the
    -inf / +inf tails.
    """
    out = []
    n_phrases = len(phrases)
    starts = [_safe_float(p.get("start_time"), 0.0) for p in phrases]
    for i, p in enumerate(phrases):
        # First phrase extends back to -inf, last forward to +inf —
        # see docstring on gap/tail handling.
        t0 = float("-inf") if i == 0 else starts[i]
        t1 = float("inf") if i == n_phrases - 1 else starts[i + 1]
        pn = [x for x in notes if t0 <= _safe_float(x.get("t"), 0.0) < t1]
        pc = [x for x in chords if t0 <= _safe_float(x.get("t"), 0.0) < t1]
        pa = [x for x in anchors if t0 <= _safe_float(x.get("time"), 0.0) < t1]
        new_levels = []
        for lv in p.get("levels", []):
            new_lv = dict(lv)
            new_lv["notes"] = list(pn)
            new_lv["chords"] = list(pc)
            new_lv["anchors"] = list(pa)
            new_levels.append(new_lv)
        new_p = dict(p)
        new_p["levels"] = new_levels
        out.append(new_p)
    return out


def _note_attrs_xml(n, *, include_time=True):
    """Build the attribute dict for a single <note>/<chordNote>.

    Shared between top-level <note> and <chordNote> emission so a chord
    member override (e.g. one bent member of a chord) carries identical
    technique surface to a standalone note.
    """
    techs = n.get("techniques", {}) or {}
    attrs = {}
    if include_time:
        attrs["time"] = f"{n['time']:.3f}"
    # Use `_safe_bool` so a payload that hand-spells boolean techniques
    # as "0"/"false" doesn't get coerced to True via Python's string
    # truthiness and emit an incorrect "1" attribute.
    def _flag(key):
        return "1" if _safe_bool(techs.get(key)) else "0"
    attrs.update({
        "string": str(n["string"]),
        "fret": str(n["fret"]),
        "sustain": f"{n.get('sustain', 0.0):.3f}",
        "bend": f"{_safe_float(techs.get('bend'), 0.0):.1f}",
        "hammerOn": _flag("hammer_on"),
        "pullOff": _flag("pull_off"),
        "slideTo": str(_safe_int(techs.get("slide_to"), -1)),
        "slideUnpitchTo": str(_safe_int(techs.get("slide_unpitch_to"), -1)),
        "harmonic": _flag("harmonic"),
        "harmonicPinch": _flag("harmonic_pinch"),
        "palmMute": _flag("palm_mute"),
        "mute": _flag("mute"),
        "vibrato": _flag("vibrato"),
        "tremolo": _flag("tremolo"),
        "accent": _flag("accent"),
        "linkNext": _flag("link_next"),
        "tap": _flag("tap"),
        "fretHandMute": _flag("fret_hand_mute"),
        "pluck": _flag("pluck"),
        "slap": _flag("slap"),
        "rightHand": str(_safe_int(techs.get("right_hand"), -1)),
        "pickDirection": str(_safe_int(techs.get("pick_direction"), -1)),
        # Teaching mark (§6.2.2): fret-hand finger. core's _parse_note reads
        # `fretFinger` back; strum_group/scale_degree have no chart-XML attribute
        # (they round-trip through the sloppak wire instead). Display only.
        # Out-of-range values collapse to -1 (unset), matching the wire guard.
        "fretFinger": str(_fret_finger_attr(techs)),
        "ignore": _flag("ignore"),
    })
    return attrs


# Maps editor metadata keys → the archive manifest Attribute keys. The
# library scanner reads title/artist/album/year from these manifest JSON
# Attributes (NOT the arrangement XML), so a archive save MUST update them or the
# edit silently reverts on the next library rescan.
_ARCHIVE_MANIFEST_ATTRS = {
    "title": "SongName",
    "artist": "ArtistName",
    "album": "AlbumName",
}


def _patch_archive_manifest_metadata(session_dir, metadata) -> int:
    """Write edited title/artist/album/year into every manifest JSON of an
    unpacked archive tree (``manifests/**/*.json`` plus the aggregate ``*.hsan``).

    Returns the number of manifest files changed. Only keys present (non-None)
    in ``metadata`` are overwritten, mirroring the sloppak save path so a no-UI
    save can't blank out fields it didn't touch.
    """
    if not metadata:
        return 0
    session_dir = Path(session_dir)
    targets = list(session_dir.rglob("manifests/**/*.json"))
    targets += list(session_dir.rglob("*.hsan"))
    changed = 0
    for mf in targets:
        try:
            jdata = json.loads(mf.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        entries = jdata.get("Entries")
        if not isinstance(entries, dict):
            continue
        dirty = False
        for entry in entries.values():
            attrs = entry.get("Attributes") if isinstance(entry, dict) else None
            if not isinstance(attrs, dict):
                continue
            for key, attr in _ARCHIVE_MANIFEST_ATTRS.items():
                if metadata.get(key) is not None:
                    attrs[attr] = str(metadata[key])
                    dirty = True
            if metadata.get("year") is not None:
                try:
                    attrs["SongYear"] = int(metadata["year"])
                    dirty = True
                except (TypeError, ValueError):
                    pass
        if dirty:
            mf.write_text(json.dumps(jdata, indent=2), encoding="utf-8")
            changed += 1
    return changed


def _build_arrangement_xml(
    old_root, notes, chords, chord_templates, beats, sections, metadata,
    force_max_strings=None,
    *, tones=None, handshapes=None, anchors_user=None,
):
    """Build a arrangement XML from editor data.

    `force_max_strings` caps the emitted `<tuning>` width so a archive
    truncate save can't carry over `string6+` slots that may have been
    written by a prior extended-range save.

    `tones` (shape `{base, changes, definitions}` — definitions opaque,
    base + changes authored) writes `<tonebase>` and `<tones>` after
    `<capo>`. `handshapes` replaces the empty default. `anchors_user`,
    when non-empty, overrides the `_compute_anchors` auto-generation.
    """
    root = ET.Element("song", version="7")

    _META_ALIASES = {
        "title": ("title",),
        "artistName": ("artistName", "artist"),
        "albumName": ("albumName", "album"),
        "albumYear": ("albumYear", "year"),
        "arrangement": ("arrangement",),
        "offset": ("offset",),
        "songLength": ("songLength",),
        "startBeat": ("startBeat",),
        "averageTempo": ("averageTempo",),
    }

    def _text(tag, fallback=""):
        for k in _META_ALIASES.get(tag, (tag,)):
            if k in metadata and metadata[k] not in (None, ""):
                return str(metadata[k])
        el = old_root.find(tag) if old_root is not None else None
        return el.text if el is not None and el.text else fallback

    def _year_text():
        raw = _text("albumYear", "")
        m = _YEAR_RE.search(raw) if raw else None
        return m.group(1) if m else ""

    ET.SubElement(root, "title").text = _text("title", "Untitled")
    ET.SubElement(root, "arrangement").text = _text("arrangement", "Lead")
    ET.SubElement(root, "offset").text = _text("offset", "0.000")
    ET.SubElement(root, "songLength").text = _text("songLength", "0.000")
    ET.SubElement(root, "startBeat").text = _text("startBeat", "0.000")
    ET.SubElement(root, "averageTempo").text = _text("averageTempo", "120")
    ET.SubElement(root, "artistName").text = _text("artistName", "Unknown")
    ET.SubElement(root, "albumName").text = _text("albumName", "")
    ET.SubElement(root, "albumYear").text = _year_text()

    old_tuning = old_root.find("tuning") if old_root is not None else None
    tuning_el = ET.SubElement(root, "tuning")
    max_i = 5
    if old_tuning is not None:
        i = 6
        while old_tuning.get(f"string{i}") is not None:
            max_i = i
            i += 1
    if force_max_strings is not None:
        max_i = max(5, min(max_i, force_max_strings - 1))
    for i in range(max_i + 1):
        val = "0"
        if old_tuning is not None:
            val = old_tuning.get(f"string{i}", "0")
        tuning_el.set(f"string{i}", val)

    old_capo = old_root.find("capo") if old_root is not None else None
    ET.SubElement(root, "capo").text = (
        old_capo.text if old_capo is not None and old_capo.text else "0"
    )

    # Tones — emit `<tonebase>` and `<tones>` only when there's
    # authored data. Other parts of the XML (note attrs, handshapes,
    # anchors) already differ from the pre-PR writer because the new
    # techniques are always emitted; this block stays absent in the
    # no-tones case so a non-tones arrangement doesn't suddenly grow
    # an empty `<tones count="0"/>` it never had before.
    tones_obj = tones or {}
    base_name = ""
    changes = []
    if isinstance(tones_obj, dict):
        raw_base = tones_obj.get("base")
        if isinstance(raw_base, str):
            base_name = raw_base.strip()
        raw_changes = tones_obj.get("changes") or []
        for c in raw_changes:
            if not isinstance(c, dict):
                continue
            try:
                t = float(c.get("t", c.get("time", 0)))
            except (TypeError, ValueError):
                continue
            # the chart tone times are non-negative real numbers; drop
            # negatives / NaN / ±inf so the writer never emits an
            # invalid `<tone time="..."/>` that would break downstream
            # note-chart compilers.
            if not math.isfinite(t) or t < 0:
                continue
            name = c.get("name", "")
            if not isinstance(name, str) or not name:
                continue
            changes.append((t, name))
    if base_name or changes:
        # `<tonebase>` defaults to "Clean" when the payload doesn't
        # name one — use the same effective value for the slot-id skip
        # check, otherwise a `change.name == "Clean"` would slip past
        # the comparison against the (empty) raw `base_name` and get
        # assigned a non-base slot id.
        effective_base = base_name or "Clean"
        ET.SubElement(root, "tonebase").text = effective_base
        changes.sort(key=lambda c: c[0])
        slot_ids = {}
        for _, name in changes:
            if name == effective_base:
                continue
            if name not in slot_ids:
                slot_ids[name] = len(slot_ids)
        tones_el = ET.SubElement(root, "tones", count=str(len(changes)))
        for t, name in changes:
            attrs = {"time": f"{t:.3f}", "name": name}
            if name in slot_ids:
                attrs["id"] = str(slot_ids[name])
            ET.SubElement(tones_el, "tone", **attrs)

    ebeats_el = ET.SubElement(root, "ebeats", count=str(len(beats)))
    for b in beats:
        ET.SubElement(
            ebeats_el, "ebeat",
            time=f"{b['time']:.3f}", measure=str(b["measure"]),
        )

    if not sections:
        sections = [{"name": "default", "number": 1, "start_time": 0.0}]
    sections_el = ET.SubElement(root, "sections", count=str(len(sections)))
    for s in sections:
        ET.SubElement(
            sections_el, "section",
            name=s["name"], number=str(s["number"]),
            startTime=f"{s['start_time']:.3f}",
        )

    phrases_el = ET.SubElement(root, "phrases", count=str(len(sections)))
    for s in sections:
        ET.SubElement(
            phrases_el, "phrase",
            disparity="0", ignore="0", maxDifficulty="0",
            name=s["name"], solo="0",
        )

    phrase_iters = ET.SubElement(
        root, "phraseIterations", count=str(len(sections))
    )
    for i, s in enumerate(sections):
        ET.SubElement(
            phrase_iters, "phraseIteration",
            time=f"{s['start_time']:.3f}", phraseId=str(i),
        )

    ct_el = ET.SubElement(
        root, "chordTemplates", count=str(len(chord_templates))
    )
    _CT_HARD_CAP = force_max_strings if force_max_strings is not None else 8
    ct_width = max(
        6,
        max((len(ct.get("frets", [])) for ct in chord_templates), default=6),
        max((len(ct.get("fingers", [])) for ct in chord_templates), default=6),
    )
    ct_width = min(ct_width, _CT_HARD_CAP)
    for ct in chord_templates:
        attrs = {"chordName": ct.get("name", "")}
        # displayName round-trips on the chordTemplate; template-level `arp` is
        # wire-only (no standard chordTemplate XML attr — arpeggio lives on
        # <handShape>), so it's reconstructed from handshapes, not emitted here.
        attrs["displayName"] = ct.get("displayName", ct.get("name", ""))
        frets = ct.get("frets", [-1] * ct_width)
        fingers = ct.get("fingers", [-1] * ct_width)
        for i in range(ct_width):
            attrs[f"fret{i}"] = str(frets[i] if i < len(frets) else -1)
            attrs[f"finger{i}"] = str(fingers[i] if i < len(fingers) else -1)
        ET.SubElement(ct_el, "chordTemplate", **attrs)

    levels_el = ET.SubElement(root, "levels", count="1")
    level = ET.SubElement(levels_el, "level", difficulty="0")

    notes_el = ET.SubElement(level, "notes", count=str(len(notes)))
    for n in notes:
        ET.SubElement(notes_el, "note", **_note_attrs_xml(n))

    chords_el = ET.SubElement(level, "chords", count=str(len(chords)))
    for ch in chords:
        chord_el = ET.SubElement(
            chords_el, "chord",
            time=f"{ch['time']:.3f}",
            chordId=str(ch.get("chord_id", 0)),
            highDensity="1" if _safe_bool(ch.get("high_density")) else "0",
            strum="down",
        )
        for cn in ch.get("notes", []):
            ET.SubElement(chord_el, "chordNote", **_note_attrs_xml(cn))

    # Defensively coerce malformed client payloads (`anchors_user:
    # "foo"`, or a list containing non-dict / missing-key entries) —
    # `_valid_anchor_dicts` / `_valid_handshape_dicts` drop bad entries
    # silently rather than 500ing the save.
    safe_anchors_user = _valid_anchor_dicts(anchors_user)
    if safe_anchors_user:
        anchors = safe_anchors_user
    else:
        anchors = _compute_anchors(notes, chords)
    anchors_el = ET.SubElement(level, "anchors", count=str(len(anchors)))
    for a in anchors:
        ET.SubElement(
            anchors_el, "anchor",
            time=f"{float(a['time']):.3f}",
            fret=str(int(a["fret"])),
            width=str(int(a.get("width", 4))),
        )

    # Constrain `chord_id` to the actual `<chordTemplates>` range —
    # `_valid_handshape_dicts` only enforces `>= 0`, but emitting a
    # handshape that points past the end of the templates list would
    # produce invalid arrangement XML.
    max_chord_id = len(chord_templates) - 1
    hs_list = [
        h for h in _valid_handshape_dicts(handshapes)
        if h["chord_id"] <= max_chord_id
    ]
    hs_el = ET.SubElement(level, "handShapes", count=str(len(hs_list)))
    for h in hs_list:
        attrs = {
            "chordId": str(int(h["chord_id"])),
            "startTime": f"{float(h['start_time']):.3f}",
            "endTime": f"{float(h['end_time']):.3f}",
        }
        if h["arp"]:
            attrs["arpeggio"] = "1"
        ET.SubElement(hs_el, "handShape", **attrs)

    xml_str = ET.tostring(root, encoding="unicode")
    dom = minidom.parseString(xml_str)
    return dom.toprettyxml(indent="  ", encoding=None)


def _arr_to_data(arr, name):
    """Turn a parsed `lib.song` arrangement into the editor's arrangement dict.

    Shared by the GP keys import (`import-keys`) and the GP guitar/bass import
    (`import-guitar-track`) so both round-trip a converted arrangement into the
    same wire shape the frontend appends to `S.arrangements`. Pure — reads only
    the passed arrangement's attributes, so it's unit-testable with a fake arr.
    """
    arr_data = {
        "name": name,
        "tuning": arr.tuning,
        "capo": arr.capo,
        "notes": [],
        "chords": [],
        "chord_templates": [],
        "handshapes": [],
    }

    anchors_payload = [
        {
            "time": round(a.time, 3),
            "fret": a.fret,
            "width": a.width,
        }
        for a in (getattr(arr, "anchors", None) or [])
    ]
    arr_data["anchors"] = list(anchors_payload)
    arr_data["anchors_user"] = list(anchors_payload)

    for h in (getattr(arr, "hand_shapes", None) or []):
        arr_data["handshapes"].append({
            "chord_id": h.chord_id,
            "start_time": round(h.start_time, 3),
            "end_time": round(h.end_time, 3),
            "arp": bool(getattr(h, "arpeggio", False)),
        })

    for n in arr.notes:
        arr_data["notes"].append({
            "time": round(n.time, 3),
            "string": n.string,
            "fret": n.fret,
            "sustain": round(n.sustain, 3),
            "techniques": _note_tech_dict(n),
        })

    for ch in arr.chords:
        chord_data = {
            "time": round(ch.time, 3),
            "chord_id": ch.chord_id,
            "high_density": ch.high_density,
            "fn": getattr(ch, "fn", None),
            "notes": [],
        }
        for cn in ch.notes:
            chord_data["notes"].append({
                "time": round(cn.time, 3),
                "string": cn.string,
                "fret": cn.fret,
                "sustain": round(cn.sustain, 3),
                "techniques": _note_tech_dict(cn),
            })
        arr_data["chords"].append(chord_data)

    for ct in arr.chord_templates:
        arr_data["chord_templates"].append({
            "name": ct.name,
            "displayName": getattr(ct, "display_name", "") or ct.name,
            "arp": bool(getattr(ct, "arpeggio", False)),
            "frets": ct.frets,
            "fingers": ct.fingers,
            "voicing": getattr(ct, "voicing", "") or "",
            "caged": _caged_wire(getattr(ct, "caged", "")),
            "guideTones": _guide_tones_wire(getattr(ct, "guide_tones", [])),
        })

    return arr_data


def setup(app, context):
    config_dir = context["config_dir"]
    get_dlc_dir = context["get_dlc_dir"]
    # Shared metadata cache (title/artist/…), populated by the core library
    # scan. Used to enrich the load-song list so the user can search by song
    # name / artist, not just raw filename. Optional — degrade to filename-only
    # if a host ever omits it.
    meta_db = context.get("meta_db")

    from lib.song import load_song, phrase_to_wire
    from lib import sloppak as sloppak_mod

    # The editor needs to write extracted audio / art into a directory it
    # can also serve from. On the web Docker image `slopsmith/static/` is
    # writable, so historically the plugin reused that path and surfaced
    # the files at the slopsmith core's `/static/...` mount. On desktop
    # bundles (AppImage / .app / NSIS install) `slopsmith/static/` lives
    # inside the read-only application package, so writes blow up with
    # `OSError: [Errno 30] Read-only file system`.
    #
    # Probe the legacy location at startup. If it's writable we keep the
    # old behaviour; if not we fall back to a per-user cache dir under
    # `config_dir` and serve those files via a dedicated plugin route.
    # Read-back logic accepts BOTH URL prefixes so a song frontend hands
    # back an old `/static/...` audio_url across upgrades still resolves.
    LEGACY_STATIC_DIR = Path(__file__).resolve().parent.parent.parent / "static"
    LEGACY_STATIC_URL = "/static"
    CACHE_URL = "/api/plugins/editor/cache"

    def _legacy_static_writable() -> bool:
        # Writability alone isn't enough — when this plugin is installed
        # into the user plugins dir (e.g. `~/.config/slopsmith-desktop/
        # plugins/editor/`), `parent.parent.parent / static` resolves to
        # a writable dir under the user config that Slopsmith does NOT
        # mount as `/static`. Writing audio there would 404 on fetch.
        # Require a sentinel file that Slopsmith always ships in its
        # real static root (`app.js`) so we only short-circuit to legacy
        # mode when this is genuinely the served mount.
        if not (LEGACY_STATIC_DIR / "app.js").exists():
            return False
        try:
            probe = LEGACY_STATIC_DIR / ".editor_write_probe"
            probe.touch()
            probe.unlink()
            return True
        except (OSError, PermissionError):
            return False

    if _legacy_static_writable():
        STORAGE_DIR = LEGACY_STATIC_DIR
        STORAGE_URL = LEGACY_STATIC_URL
    else:
        STORAGE_DIR = Path(config_dir) / "editor_cache"
        STORAGE_DIR.mkdir(parents=True, exist_ok=True)
        STORAGE_URL = CACHE_URL

    # Sloppak unpack cache — must NOT live under STORAGE_DIR when STORAGE_URL
    # is /static, because that directory is mounted as the public web root
    # and anything under it is downloadable by URL. Stems / manifests /
    # covers of every loaded sloppak would leak. Use the shared private
    # cache the server exposes via the plugin context (lives under
    # CONFIG_DIR), with a fall-back for any older harness that doesn't
    # surface the helper.
    _get_sloppak_cache = context.get("get_sloppak_cache_dir")
    if callable(_get_sloppak_cache):
        SLOPPAK_CACHE = Path(_get_sloppak_cache())
    else:
        SLOPPAK_CACHE = config_dir / "sloppak_cache"

    # Convenience for code that needs to resolve an audio_url back to a
    # filesystem path — accepts the legacy /static/* form so a frontend
    # session that captured an old URL still works after an upgrade.
    def _resolve_storage_url(url: str) -> Path | None:
        if not url:
            return None
        for prefix, base in (
            (LEGACY_STATIC_URL + "/", LEGACY_STATIC_DIR),
            (CACHE_URL + "/",         STORAGE_DIR if STORAGE_URL == CACHE_URL else None),
        ):
            if base is None:
                continue
            if url.startswith(prefix):
                rel = url[len(prefix):]
                # Path-traversal guard: resolved path must stay inside base.
                candidate = (base / rel).resolve()
                try:
                    candidate.relative_to(base.resolve())
                except ValueError:
                    return None
                return candidate
        return None

    def _safe_storage_asset(p) -> str:
        """A client-supplied asset path (cover art / preview clip) is honoured
        only when it resolves to an existing file INSIDE STORAGE_DIR — so a
        crafted absolute path can't make the build copy arbitrary local files
        into the sloppak. Mirrors the existing art_path guard on the save route."""
        if not p or not isinstance(p, str):
            return ""
        try:
            resolved = Path(p).resolve()
            resolved.relative_to(STORAGE_DIR.resolve())
        except (ValueError, OSError):
            return ""
        return str(resolved) if resolved.exists() else ""

    # Active editing sessions: session_id -> {dir, audio_file, filename, song_data}
    sessions = {}

    global _sessions
    _sessions = sessions

    # Cache compat probes for the slopsmith core converter signatures —
    # each function is stable for the process lifetime, so the
    # inspect.signature call only needs to run once per converter.
    _unmapped_support: dict = {}

    def _supports_unmapped(fn) -> bool:
        cached = _unmapped_support.get(fn)
        if cached is not None:
            return cached
        try:
            import inspect
            ok = "out_unmapped" in inspect.signature(fn).parameters
        except (TypeError, ValueError):
            ok = False
        _unmapped_support[fn] = ok
        return ok

    def _safe_unmapped_entry(midi, rec) -> dict:
        """Coerce one out_unmapped entry to {midi, count, times} safely.

        The converter (in slopsmith core) controls this shape today, but
        any non-int count or non-list times in a future shape change
        shouldn't 500 the import on response shaping. midi/count default
        to 0; times to []. Non-finite / non-numeric / negative time
        entries are dropped (the frontend would skip them anyway).
        """
        try:
            midi_int = int(midi)
        except (TypeError, ValueError):
            midi_int = 0
        if not isinstance(rec, dict):
            return {"midi": midi_int, "count": 0, "times": []}
        try:
            count = max(0, int(rec.get("count", 0)))
        except (TypeError, ValueError):
            count = 0
        raw_times = rec.get("times")
        times: list = []
        if isinstance(raw_times, (list, tuple)):
            import math as _m
            for t in raw_times:
                try:
                    tf = float(t)
                except (TypeError, ValueError):
                    continue
                if _m.isfinite(tf) and tf >= 0:
                    times.append(tf)
        return {"midi": midi_int, "count": count, "times": times}

    def _arrangement_id(name: str, used: set) -> str:
        """Map an arrangement name to a stable filesystem-safe id, avoiding
        collisions (suffix counter starts at 2: bass, bass2, bass3, ...)."""
        base = re.sub(r"[^a-z0-9_]", "", (name or "arr").lower().replace(" ", "_")) or "arr"
        aid = base
        i = 2
        while aid in used:
            aid = f"{base}{i}"
            i += 1
        used.add(aid)
        return aid

    def _normalize_tuning_to_count(tuning, real_count: int) -> list:
        """Slice/pad a tuning list to exactly `real_count` entries.

        Trailing zeros (RS-XML schema padding) are dropped first.
        Callers should pass a `real_count` that already accounts for
        any genuine extended-range offsets (via
        `_arrangement_string_count`), so the final hard slice only
        ever trims zeros — if a non-zero high-index offset survives
        that, it really is being truncated (treat as a caller bug
        rather than silently preserving and breaking the length
        contract).
        """
        out = list(tuning) if isinstance(tuning, list) else []
        if len(out) > real_count:
            # Drop trailing zeros until we hit `real_count` or a non-zero.
            while len(out) > real_count and out[-1] == 0:
                out.pop()
            if len(out) > real_count:
                out = out[:real_count]
        while len(out) < real_count:
            out.append(0)
        return out

    def _safe_string_index(v) -> int | None:
        """Coerce a note's `string` field to int. Returns None for
        non-numeric / null values rather than raising — older client
        payloads or corrupted manifests can ship `string: null` or
        unexpected types, and we'd rather skip those entries than
        500 the entire save/build."""
        try:
            return int(v)
        except (TypeError, ValueError):
            return None

    def _arrangement_string_count(arr) -> int:
        """Mirror of screen.js `_stringCountFor` — composes the same
        signals so backend writes a tuning slice that round-trips the
        editor's in-memory string count."""
        is_bass = "bass" in (arr.get("name", "") or "").lower()
        baseline = 4 if is_bass else 6
        try:
            ext = int(arr.get("_extendedStrings", 0) or 0)
        except (TypeError, ValueError):
            ext = 0
        n = baseline + max(0, ext)
        tuning = arr.get("tuning")
        if isinstance(tuning, list) and len(tuning) != 6:
            n = max(n, len(tuning))
        # Chord-template signal — count the highest *used* fret slot
        # (last non(-1) index) so RS-XML's unconditional length-6
        # frets array doesn't inflate the count for normal 4-string
        # bass arrangements.
        for ct in arr.get("chord_templates", []) or []:
            frets = ct.get("frets")
            if isinstance(frets, list):
                for i in range(len(frets) - 1, -1, -1):
                    if frets[i] != -1:
                        if i + 1 > n:
                            n = i + 1
                        break
        for note in arr.get("notes", []) or []:
            s = _safe_string_index(note.get("string", 0))
            if s is not None and s + 1 > n:
                n = s + 1
        for ch in arr.get("chords", []) or []:
            for cn in ch.get("notes", []) or []:
                s = _safe_string_index(cn.get("string", 0))
                if s is not None and s + 1 > n:
                    n = s + 1
        return max(4, min(8, n))

    def _is_extended_range(arr) -> bool:
        """True if `arr` has more strings than stock-RS archive supports.

        Delegates to `_arrangement_string_count` so all the same
        signals (explicit `_extendedStrings` counter, tuning length,
        chord-template highest-used-fret, max note string index) are
        composed in one place. The earlier inline version missed
        cases like a 5-string bass with tuning.length==5 — that
        unambiguous extended-range signal wasn't covered by the
        `len > 6` check.
        """
        is_bass = "bass" in (arr.get("name", "") or "").lower()
        role_limit = 4 if is_bass else 6
        return _arrangement_string_count(arr) > role_limit

    def _validate_editor_upload_path(path_str: str, prefix: str) -> Path | None:
        """Resolve a client-supplied upload path and constrain it to the
        editor's tempfile.mkdtemp(prefix=...) sandbox. Returns the resolved
        path on success, or None if the path escapes the sandbox or doesn't
        exist. Defends against import-keys / import-drums / import-keys-midi
        being pointed at arbitrary readable files via the request body.
        """
        if not path_str:
            return None
        try:
            resolved = Path(path_str).resolve()
        except Exception:
            return None
        if not resolved.exists():
            return None
        tmp_root = Path(tempfile.gettempdir()).resolve()
        try:
            rel = resolved.relative_to(tmp_root)
        except ValueError:
            return None
        # First component should be the mkdtemp dir whose name starts
        # with our prefix (e.g. slopsmith_gp_XXXX).
        if not rel.parts or not rel.parts[0].startswith(prefix):
            return None
        return resolved

    # ── Cache file server (only meaningful when STORAGE_URL == CACHE_URL,
    #    but registered unconditionally — the route 404s if a request
    #    targets the cache on a build that's still using LEGACY_STATIC_DIR).
    @app.get(CACHE_URL + "/{name:path}")
    def get_cached_file(name: str):
        if STORAGE_URL != CACHE_URL:
            return JSONResponse({"error": "cache disabled (legacy static dir is writable)"}, status_code=404)
        candidate = (STORAGE_DIR / name).resolve()
        try:
            candidate.relative_to(STORAGE_DIR.resolve())
        except ValueError:
            return JSONResponse({"error": "invalid path"}, status_code=400)
        if not candidate.exists() or not candidate.is_file():
            return JSONResponse({"error": "not found"}, status_code=404)
        return FileResponse(candidate)

    # ── List available custom song files ────────────────────────────────────────

    @app.get("/api/plugins/editor/songs")
    async def list_songs():
        dlc_dir = get_dlc_dir()
        if not dlc_dir or not dlc_dir.exists():
            return []
        files = []
        seen: set = set()

        def _name_meta(full: Path) -> tuple:
            # Look up cached title/artist from the shared library cache so the
            # frontend can search/show real song names. Keyed on the dlc-relative
            # POSIX path — exactly how the core scanner stores it (lib/scan_worker
            # ._relpath uses .as_posix()), so a Windows backslash relpath won't
            # silently miss. Returns ("", "") when there's no fresh cache row
            # (unscanned song, stale stat, or no meta_db) — the row then falls
            # back to filename-only display, never an error.
            if not meta_db:
                return "", ""
            try:
                key = full.relative_to(dlc_dir).as_posix()
                st = full.stat()
                cached = meta_db.get(key, st.st_mtime, st.st_size)
            except Exception:
                return "", ""
            if not cached:
                return "", ""
            return (cached.get("title") or ""), (cached.get("artist") or "")

        # Single os.walk pass so large libraries are traversed only once.
        # A song package has two valid forms: zip file and authoring
        # directory, across both `.feedpak` (current) and `.sloppak` (legacy)
        # suffixes. Suffixes are lowercased so a `.FEEDPAK`/`.SLOPPAK` from an
        # older backend is still recognised. Both map to the `sloppak` format
        # tag — same on-disk format.
        _FORMATS = {".feedpak": "sloppak", ".sloppak": "sloppak"}
        for dirpath, dirnames, filenames in os.walk(dlc_dir):
            dirnames.sort()
            for name in filenames:
                ext = os.path.splitext(name)[1].lower()
                fmt = _FORMATS.get(ext)
                if fmt is None:
                    continue
                full = Path(dirpath) / name
                rel = str(full.relative_to(dlc_dir))
                if rel not in seen:
                    seen.add(rel)
                    title, artist = _name_meta(full)
                    files.append({"filename": rel, "format": fmt,
                                  "title": title, "artist": artist})
            # Collect authoring-form package dirs (.feedpak/ or .sloppak/) and
            # prune them from dirnames so os.walk won't descend into them.
            to_prune = []
            for name in dirnames:
                ext = os.path.splitext(name)[1].lower()
                if ext in (".feedpak", ".sloppak"):
                    full = Path(dirpath) / name
                    rel = str(full.relative_to(dlc_dir))
                    if rel not in seen:
                        seen.add(rel)
                        title, artist = _name_meta(full)
                        files.append({"filename": rel, "format": "sloppak",
                                      "title": title, "artist": artist})
                    to_prune.append(name)
            for name in to_prune:
                dirnames.remove(name)
        files.sort(key=lambda x: x["filename"])
        return files

    @app.post("/api/plugins/editor/browse")
    async def browse_dlc(data: dict):
        """List ONE directory level inside the DLC/song-library folder so the
        Load dialog can act as a file browser rooted at the library. `path` is a
        DLC-relative POSIX subpath ("" = the library root). Returns the absolute
        root (for display), the current relative path + its parent, the
        subfolders, and the loadable feedpak/sloppak files at this level."""
        dlc_dir = get_dlc_dir()
        if not dlc_dir or not dlc_dir.exists():
            return JSONResponse({"error": "DLC folder not configured"}, 400)
        root = dlc_dir.resolve()
        rel = str((data or {}).get("path") or "").strip().replace("\\", "/").strip("/")
        target = (root / rel).resolve() if rel else root
        # Containment — never list outside the library.
        try:
            target.relative_to(root)
        except ValueError:
            return JSONResponse({"error": "forbidden"}, 403)
        if not target.is_dir():
            target, rel = root, ""
        _FORMATS = {".feedpak": "sloppak", ".sloppak": "sloppak"}
        dirs: list = []
        files: list = []
        try:
            entries = sorted(target.iterdir(), key=lambda p: p.name.lower())
        except OSError:
            entries = []
        for entry in entries:
            ext = entry.suffix.lower()
            try:
                erel = entry.relative_to(root).as_posix()
            except ValueError:
                continue
            if entry.is_dir():
                if ext in (".feedpak", ".sloppak"):
                    # Authoring-form package dir — a loadable "file", not a folder.
                    files.append({"filename": erel, "name": entry.name, "format": "sloppak"})
                else:
                    dirs.append({"name": entry.name, "path": erel})
            elif entry.is_file() and ext in _FORMATS:
                files.append({"filename": erel, "name": entry.name, "format": _FORMATS[ext]})
        parent = None
        if rel:
            p = Path(rel).parent.as_posix()
            parent = "" if p == "." else p
        return {"root": str(root), "cwd": rel, "parent": parent,
                "dirs": dirs, "files": files}

    # ── Load a custom song for editing ──────────────────────────────────────────

    @app.post("/api/plugins/editor/load")
    async def load_song(data: dict):
        filename = data.get("filename", "")
        if not filename:
            return JSONResponse({"error": "No filename"}, 400)

        dlc_dir = get_dlc_dir()
        if not dlc_dir:
            return JSONResponse({"error": "DLC folder not configured"}, 400)
        filepath = (dlc_dir / filename).resolve()
        # Constrain client-supplied filename to dlc_dir — defends against
        # `../` traversal and absolute paths now that filename can include
        # subdirectories.
        try:
            filepath.relative_to(dlc_dir.resolve())
        except ValueError:
            return JSONResponse({"error": "Invalid filename"}, 400)
        # external `.archive` loading has been removed. The editor only opens
        # native `.feedpak`/`.sloppak` authoring/distribution containers now.
        if filepath.suffix.lower() not in (".feedpak", ".sloppak"):
            return JSONResponse({"error": "Unsupported file type"}, 400)
        if not filepath.exists():
            return JSONResponse({"error": "File not found"}, 404)

        is_sloppak = True

        def _load_sloppak():
            SLOPPAK_CACHE.mkdir(parents=True, exist_ok=True)
            loaded = sloppak_mod.load_song(filename, dlc_dir, SLOPPAK_CACHE)
            song = loaded.song
            # Distinguish authoring (directory) form from distribution (zip)
            # form so save knows whether to re-zip. With dir-form, source_dir
            # *is* the original sloppak dir; rewriting the manifest +
            # arrangement files in place is the whole save.
            sloppak_form = "dir" if filepath.is_dir() else "zip"

            # Build a per-arrangement id list from the manifest so we can map
            # edits back to the correct JSON file on save.
            arrangement_ids = []
            for entry in (loaded.manifest.get("arrangements", []) or []):
                arrangement_ids.append(entry.get("id", ""))

            # Pick the audio for editor playback. A freshly-converted
            # sloppak has one `full` stem — use it directly. A stem-split
            # sloppak has no `full` (Demucs removes full.ogg), only
            # per-instrument stems; those must be MIXED back together,
            # otherwise the editor would play just one instrument.
            audio_url = None
            audio_file = None

            def _safe_stem_path(stem_entry: dict) -> "Path | None":
                """Resolve stem file path and reject traversal outside source_dir."""
                rel = stem_entry.get("file", "")
                if not rel:
                    return None
                source_resolved = loaded.source_dir.resolve()
                candidate = (loaded.source_dir / rel).resolve()
                try:
                    candidate.relative_to(source_resolved)
                except ValueError:
                    return None
                return candidate if candidate.exists() else None

            # Same basename-collision class as session_id: nested paths
            # like `foo/bar.archive` and `baz/bar.sloppak` both reduce to
            # stem "bar". Use a sanitised full path so two browser tabs
            # loading distinct songs don't overwrite each other's
            # `editor_audio_*` file under STATIC_DIR.
            audio_id = filename.replace("/", "__").replace("\\", "__").replace(" ", "_")

            # Remove any editor_audio_<id>.* left by a prior load before
            # writing this one — otherwise a stale file under a different
            # extension (e.g. a mix `.ogg` when this load resolves a
            # non-ogg `full` stem) could be served from a cached URL.
            # Explicit extensions, not a glob: `audio_id` may contain
            # glob metacharacters.
            for _stale_ext in (".ogg", ".wav", ".mp3", ".m4a", ".flac",
                               ".opus", ".aac"):
                try:
                    (STORAGE_DIR / f"editor_audio_{audio_id}{_stale_ext}").unlink(
                        missing_ok=True)
                except OSError:
                    pass

            full_stem = next((s for s in loaded.stems if s.get("id") == "full"), None)
            full_path = _safe_stem_path(full_stem) if full_stem else None
            if full_path and full_path.exists():
                ext = full_path.suffix
                dest = STORAGE_DIR / f"editor_audio_{audio_id}{ext}"
                shutil.copy2(full_path, dest)
                audio_url = f"{STORAGE_URL}/editor_audio_{audio_id}{ext}"
                audio_file = str(full_path)
            else:
                # No usable `full` stem — either it's absent, or the
                # manifest entry points at a missing/invalid file. Either
                # way, fall back to mixing the per-instrument stems.
                stem_paths = [p for p in (_safe_stem_path(s) for s in loaded.stems)
                              if p is not None]
                if len(stem_paths) == 1:
                    sp = stem_paths[0]
                    ext = sp.suffix
                    dest = STORAGE_DIR / f"editor_audio_{audio_id}{ext}"
                    shutil.copy2(sp, dest)
                    audio_url = f"{STORAGE_URL}/editor_audio_{audio_id}{ext}"
                    audio_file = str(sp)
                elif len(stem_paths) > 1:
                    dest = STORAGE_DIR / f"editor_audio_{audio_id}.ogg"
                    if _mix_stems_for_editor(stem_paths, dest):
                        audio_url = f"{STORAGE_URL}/editor_audio_{audio_id}.ogg"
                        audio_file = str(dest)
                    else:
                        # ffmpeg missing or the mix failed — fall back to a
                        # single stem so the editor still has playable audio
                        # (the pre-fix behavior). One instrument beats none.
                        # The upfront sweep already cleared any stale mix.
                        sp = stem_paths[0]
                        ext = sp.suffix
                        fdest = STORAGE_DIR / f"editor_audio_{audio_id}{ext}"
                        shutil.copy2(sp, fdest)
                        audio_url = f"{STORAGE_URL}/editor_audio_{audio_id}{ext}"
                        audio_file = str(sp)

            # Expose the individual per-instrument stems (in addition to the
            # combined audio_url used for the waveform) so the editor's stem
            # mixer can load and balance them live. Only for genuine
            # multi-stem sloppaks — a single-`full` sloppak has nothing to mix.
            _stem_urls = []
            for _s in loaded.stems:
                _sid = (_s.get("id") or "").strip()
                if not _sid or _sid == "full":
                    continue
                _sp = _safe_stem_path(_s)
                if _sp is None or not _sp.exists():
                    continue
                _sext = _sp.suffix or ".ogg"
                _safe_sid = re.sub(r"[^a-zA-Z0-9_-]", "_", _sid)
                _sdest = STORAGE_DIR / f"editor_stem_{audio_id}_{_safe_sid}{_sext}"
                try:
                    shutil.copy2(_sp, _sdest)
                except OSError:
                    continue
                _stem_urls.append({
                    "id": _sid,
                    "url": f"{STORAGE_URL}/editor_stem_{audio_id}_{_safe_sid}{_sext}",
                })

            result = _song_to_dict(song, audio_url)
            result["format"] = "sloppak"
            timeline = _load_song_timeline(loaded.source_dir, loaded.manifest)
            if timeline:
                if "beats" in timeline:
                    result["beats"] = timeline["beats"]
                if "sections" in timeline:
                    result["sections"] = timeline["sections"]
            if len(_stem_urls) >= 2:
                result["stems"] = _stem_urls
            # `lib/sloppak.load_song()` doesn't restore song.offset (the
            # sloppak format doesn't carry an explicit offset field today),
            # so song.offset is 0 here. If the manifest happens to surface
            # one (e.g. a forward-compat extension that mirrors archive's
            # song-level <offset>), pick it up so the audio_offset that
            # gets fed to the +Keys/+Drums converters matches the chart.
            try:
                manifest_offset = float(loaded.manifest.get("offset", 0) or 0)
            except (TypeError, ValueError):
                manifest_offset = 0.0
            if manifest_offset:
                result["offset"] = manifest_offset
            # Surface the parsed drum_tab (if any) so the editor frontend can
            # show a "drums present" indicator and the +Drums modal can offer
            # Replace vs Cancel rather than silently overwriting. getattr
            # guard: an older Slopsmith core whose LoadedSloppak predates
            # the drum_tab field would otherwise raise AttributeError and
            # 500 the whole load.
            _loaded_drum_tab = getattr(loaded, "drum_tab", None)
            if _loaded_drum_tab is not None:
                result["drum_tab"] = _loaded_drum_tab
            # Carry the manifest-derived arrangement id list onto each
            # arrangement so the frontend can round-trip it back to us.
            # Use a single `used_ids` set when generating fallback ids so two
            # nameless arrangements don't both end up as "arr".
            used_ids: set = {aid for aid in arrangement_ids if aid}
            for i, arr_data in enumerate(result.get("arrangements", [])):
                aid = arrangement_ids[i] if i < len(arrangement_ids) else ""
                if not aid:
                    aid = _arrangement_id(arr_data["name"], used_ids)
                arr_data["id"] = aid

            # Round-trip load: populate the piano-roll from notation for any
            # notation-only arrangement (see _populate_notation_notes).
            _populate_notation_notes(
                result.get("arrangements", []),
                getattr(loaded, "notation_by_id", None),
            )

            # Round-trip-preserve the arrangement-level arrays the editor UI
            # doesn't expose: anchors, handshapes, phrases. The save path
            # passes them straight through so the next save doesn't drop them.
            for i, arr in enumerate(song.arrangements):
                arr_data = result["arrangements"][i]
                arr_data["anchors"] = [
                    {"time": a.time, "fret": a.fret, "width": a.width}
                    for a in (arr.anchors or [])
                ]
                # Preserve `arp` alongside the legacy fields — `_song_to_dict`
                # already emitted handshapes with `arp`, so dropping it here
                # would silently lose arpeggio metadata on sloppak round-trip.
                arr_data["handshapes"] = [
                    {
                        "chord_id": h.chord_id,
                        "start_time": h.start_time,
                        "end_time": h.end_time,
                        "arp": h.arpeggio,
                    }
                    for h in (arr.hand_shapes or [])
                ]
                if arr.phrases:
                    arr_data["phrases"] = [phrase_to_wire(p) for p in arr.phrases]

            return (
                result,
                str(loaded.source_dir),  # working dir = the unpacked sloppak cache
                audio_file,
                None,                    # no xml_files for sloppak
                {
                    "manifest": loaded.manifest,
                    "arrangement_ids": arrangement_ids,
                    "form": sloppak_form,
                    "original_path": str(filepath),
                },
            )

        try:
            result, session_dir, audio_file, xml_files, sloppak_state = (
                await asyncio.get_event_loop().run_in_executor(None, _load_sloppak)
            )
        except Exception as e:
            import traceback
            traceback.print_exc()
            return JSONResponse({"error": str(e)}, 500)

        # Session id has to disambiguate the full relative path, not just
        # the basename — the picker now emits paths like `foo/bar.archive`
        # and `baz/bar.sloppak` that share the same stem, and a basename-
        # keyed session would have two browser tabs collide on `bar`,
        # corrupting the second's saves into the first's working dir.
        # Sanitise path separators / spaces into a stable id (matches the
        # `lib.sloppak._safe_id` convention) and append the suffix so a
        # `.archive` and `.sloppak` of the same name still get distinct ids.
        sanitised = filename.replace("/", "__").replace("\\", "__").replace(" ", "_")
        session_id = sanitised
        # Clean up previous archive session for same file (sloppak sessions
        # use the cache dir directly — never delete it on session swap).
        if session_id in sessions:
            old = sessions[session_id]
            if old.get("format") == "archive":
                shutil.rmtree(old["dir"], ignore_errors=True)

        sessions[session_id] = {
            "dir": session_dir,
            "audio_file": audio_file,
            "filename": filename,
            "xml_files": xml_files,
            "format": "sloppak" if is_sloppak else "archive",
            "sloppak_state": sloppak_state,
            # Stash song-level metadata so save_as_sloppak can carry
            # album/year through to the generated manifest even though
            # the frontend's currentSong state only tracks title/artist.
            "metadata": {
                "title": result.get("title", ""),
                "artist": result.get("artist", ""),
                "album": result.get("album", ""),
                "year": result.get("year", ""),
            },
            "last_touched": time.time(),
        }
        result["session_id"] = session_id
        return result

    # ── Save edited arrangement back to archive ────────────────────────────

    @app.post("/api/plugins/editor/save")
    async def save_song(data: dict):
        session_id = data.get("session_id", "")
        session = sessions.get(session_id)
        if not session:
            return JSONResponse({"error": "No active session"}, 400)
        session["last_touched"] = time.time()

        raw_arr_idx = data.get("arrangement_index")
        if raw_arr_idx is None:
            arrangement_index = 0
        else:
            try:
                arrangement_index = int(raw_arr_idx)
            except (TypeError, ValueError):
                return JSONResponse({"error": "arrangement_index must be an integer"}, 400)
        if arrangement_index < 0:
            return JSONResponse({"error": "arrangement_index must be non-negative"}, 400)
        notes = data.get("notes", [])
        chords = data.get("chords", [])
        chord_templates = data.get("chord_templates", [])
        beats = data.get("beats", [])
        sections = data.get("sections", [])
        # New arrangement extras — surfaced from the frontend on save. When
        # `arrangements` (full snapshot) is provided we re-read these from
        # each entry inside the sloppak builder; the single-arrangement
        # archive save path takes them straight off the request body.
        # Use the sentinel to distinguish "absent" from "explicitly empty"
        # — an empty `anchors_user: []` is meaningful (means "fall back to
        # `_compute_anchors`"), and an empty `handshapes: []` is meaningful
        # too (means "no handshapes"). Collapsing absent vs empty would
        # prevent a client from ever clearing the previously-authored
        # value back to the auto-computed default.
        tones = data.get("tones", _FIELD_ABSENT)
        handshapes = data.get("handshapes", _FIELD_ABSENT)
        anchors_user = data.get("anchors_user", _FIELD_ABSENT)
        # Merge session metadata (album/year captured at archive load
        # time) with anything the frontend sent. `_buildSaveBody` ships
        # `{title, artist}` on every save path; this merge keeps the
        # archive-only fields (album, year) that the frontend never
        # round-trips, so they survive a save through this endpoint.
        metadata = dict(session.get("metadata") or {})
        metadata.update(data.get("metadata") or {})

        # Sloppak save can be a full snapshot of all arrangements (needed when
        # arrangements were added). If arrangements isn't provided, save_song
        # only updates the single arrangement at arrangement_index.
        all_arrangements = data.get("arrangements")

        # Drum-tab payload: when the +Drums modal added a drum_tab.json on top
        # of the song, the frontend ships the dict here. The three values
        # have distinct meanings:
        #   - dict  → persist alongside the manifest under `drum_tab.json`
        #             and set `manifest['drum_tab'] = 'drum_tab.json'`.
        #   - key absent → _DRUM_TAB_ABSENT sentinel → no change;
        #             existing drum_tab passes through via the manifest,
        #             untouched. This is what the editor frontend sends
        #             unless the user imported/edited a drum tab this session.
        #   - None  → explicit removal — unlinks drum_tab.json and clears the
        #             manifest key. Supported by the API for completeness;
        #             the current editor UI has no remove-drums control.
        drum_tab_payload = data.get("drum_tab", _DRUM_TAB_ABSENT)
        if drum_tab_payload is not _DRUM_TAB_ABSENT and not isinstance(
            drum_tab_payload, (dict, type(None))
        ):
            return JSONResponse(
                {"error": "drum_tab must be a JSON object or null"},
                status_code=400,
            )
        # drum_tab.json is a sloppak-format artifact. Reject a drum_tab on a
        # non-sloppak session rather than silently dropping it, so the client
        # doesn't get a 200 and assume the drum tab persisted.
        if (
            drum_tab_payload is not _DRUM_TAB_ABSENT
            and session.get("format") != "sloppak"
        ):
            return JSONResponse(
                {"error": "drum_tab can only be saved to sloppak-format songs"},
                status_code=400,
            )
        # Schema-validate a dict payload at the request boundary, using the
        # SAME validator the sloppak loader applies on the next song load.
        # Without this a structurally-invalid drum_tab (bad version type,
        # non-list hits, etc.) could be written to disk and silently dropped
        # by the loader, leaving a manifest `drum_tab:` key pointing at an
        # unloadable file. Per-hit junk is still cleaned by the dedup pass in
        # _save_sloppak; this catches the top-level schema.
        if isinstance(drum_tab_payload, dict):
            from lib.drums import validate_drum_tab as _validate_drum_tab
            _dt_ok, _dt_reason = _validate_drum_tab(drum_tab_payload)
            if not _dt_ok:
                return JSONResponse(
                    {"error": f"invalid drum_tab: {_dt_reason}"},
                    status_code=400,
                )

        # archive export (and its extended-range truncation path) has been
        # removed — sloppak preserves extended range natively, so no
        # string-peeling is needed on save.

        def _save_sloppak():
            sloppak_state = session.get("sloppak_state") or {}
            manifest = dict(sloppak_state.get("manifest") or {})
            sloppak_form = sloppak_state.get("form") or "zip"
            source_dir = Path(session["dir"]).resolve()
            dlc_dir = get_dlc_dir()
            if not dlc_dir:
                raise RuntimeError("DLC folder not configured")
            filename = session["filename"]
            output_path = (dlc_dir / filename).resolve()

            # Build the wire JSON for one arrangement. Anchors / handshapes /
            # tones come through the kwargs; phrases stay opaque passthrough
            # (the editor UI still doesn't author phrase tiers).
            def _build_wire(arr_dict, is_first):
                # Anchors: prefer the authored `anchors_user` key when
                # it's present (even if explicitly empty — empty means
                # "force `_compute_anchors`"); otherwise fall back to
                # the legacy `anchors` passthrough that older sloppaks
                # carry.
                # Handshapes: prefer the explicit `handshapes` key
                # (empty list means "no handshapes"). When absent we
                # default to `[]` — the single-arrangement save path's
                # `edited_dict` always populates `handshapes` from the
                # `_preserved` on-disk passthrough before reaching this
                # builder, and full-snapshot saves ship `handshapes`
                # for every arrangement, so the absent branch only
                # fires for legacy clients that pre-date handshape
                # awareness.
                if "anchors_user" in arr_dict:
                    authored_anchors = arr_dict["anchors_user"] or []
                else:
                    authored_anchors = arr_dict.get("anchors") or []
                if "handshapes" in arr_dict:
                    authored_handshapes = arr_dict["handshapes"] or []
                else:
                    authored_handshapes = []
                wire = _arr_dict_to_wire(
                    arr_dict.get("name", "arr"),
                    arr_dict.get("tuning", [0]*6),
                    int(arr_dict.get("capo", 0)),
                    arr_dict.get("notes", []),
                    arr_dict.get("chords", []),
                    arr_dict.get("chord_templates", []),
                    tones=arr_dict.get("tones"),
                    handshapes=authored_handshapes,
                    anchors_user=authored_anchors,
                )
                ph = arr_dict.get("phrases")
                if ph:
                    wire["phrases"] = _repopulate_phrase_levels(
                        ph, wire["notes"], wire["chords"], wire["anchors"],
                    )
                if is_first:
                    wire["beats"] = [
                        {"time": round(float(b.get("time", 0)), 3),
                         "measure": int(b.get("measure", -1))}
                        for b in beats
                    ]
                    wire["sections"] = [
                        {"name": s.get("name", ""),
                         "number": int(s.get("number", 0)),
                         "time": round(float(s.get("start_time", 0)), 3)}
                        for s in sections
                    ]
                return wire

            # Determine the arrangement set to write. If `arrangements` was
            # provided, it's the authoritative full snapshot (handles adds,
            # removes, reorders). Otherwise we update only the single
            # arrangement at arrangement_index from notes/chords/templates.
            old_entries = list(manifest.get("arrangements", []) or [])

            if all_arrangements is None:
                if arrangement_index >= len(old_entries):
                    raise RuntimeError("Invalid arrangement index")
                # Build a synthetic edited dict using the old entry's
                # tuning/capo since the legacy save body doesn't carry them.
                old_entry = old_entries[arrangement_index]
                # Load anchors/handshapes/phrases from the existing arrangement
                # JSON on disk so they are preserved verbatim — the editor UI
                # doesn't expose them, so the save body never includes them.
                _preserved: dict = {}
                _old_rel = old_entry.get("file")
                if _old_rel:
                    _old_path = (source_dir / _old_rel).resolve()
                    # Constrain reads to source_dir/arrangements — defends against
                    # `..` traversal in a malformed or untrusted manifest.yaml.
                    _arr_dir_resolved = (source_dir / "arrangements").resolve()
                    _old_path_ok = False
                    try:
                        # Called only for the side-effect: raises ValueError
                        # if _old_path escapes _arr_dir_resolved (path traversal).
                        _old_path.relative_to(_arr_dir_resolved)
                        _old_path_ok = True
                    except ValueError:
                        pass
                    if _old_path_ok:
                        try:
                            _existing = _load_arrangement_json(_old_path)
                            for _k in ("anchors", "handshapes", "phrases", "tones"):
                                if _k in _existing:
                                    _preserved[_k] = _existing[_k]
                        except (OSError, json.JSONDecodeError):
                            pass
                # Newly-authored fields override the on-disk passthrough.
                # Distinguish "client didn't ship the field" (preserve the
                # value from disk) from "client shipped the field
                # explicitly empty" (honour the empty — means "clear
                # handshapes" / "force auto-anchors" / "clear tones").
                edited_anchors_user = (
                    _preserved.get("anchors", [])
                    if anchors_user is _FIELD_ABSENT
                    else anchors_user
                )
                edited_handshapes = (
                    _preserved.get("handshapes", [])
                    if handshapes is _FIELD_ABSENT
                    else handshapes
                )
                edited_tones = (
                    _preserved.get("tones")
                    if tones is _FIELD_ABSENT
                    else tones
                )
                edited_dict = {
                    "name": old_entry.get("name", ""),
                    "tuning": old_entry.get("tuning", [0]*6),
                    "capo": int(old_entry.get("capo", 0)),
                    "notes": notes,
                    "chords": chords,
                    "chord_templates": chord_templates,
                    "anchors": _preserved.get("anchors", []),
                    "anchors_user": edited_anchors_user,
                    "handshapes": edited_handshapes,
                    "phrases": _preserved.get("phrases"),
                    "tones": edited_tones,
                }
                merged_arrangements = []
                for i, entry in enumerate(old_entries):
                    wire = _build_wire(edited_dict, i == 0) if i == arrangement_index else None
                    merged_arrangements.append({"entry": entry, "wire": wire})
            else:
                # Full snapshot path — used when arrangements were added/
                # removed or for safety on every save.
                used_ids: set = set()
                merged_arrangements = []
                for i, ad in enumerate(all_arrangements):
                    raw_id = ad.get("id") or ""
                    if raw_id and raw_id not in used_ids:
                        aid = raw_id
                    else:
                        aid = _arrangement_id(ad.get("name", "arr"), used_ids)
                    used_ids.add(aid)
                    wire = _build_wire(ad, i == 0)
                    _entry = {
                        "id": aid,
                        "name": ad.get("name", "arr"),
                        "file": f"arrangements/{aid}.json",
                        "tuning": list(ad.get("tuning", [0]*6)),
                        "capo": int(ad.get("capo", 0)),
                    }
                    # Carry any GP-import notation alongside the entry (NOT on
                    # it — keeping it off the manifest entry means it can never
                    # leak into manifest.yaml); the sidecar writer consumes it.
                    merged_arrangements.append({
                        "entry": _entry, "wire": wire,
                        "gp_notation": ad.get("_gp_notation"),
                    })

            # Write/update arrangement JSON files inside source_dir/arrangements
            arr_dir = (source_dir / "arrangements").resolve()
            arr_dir.mkdir(parents=True, exist_ok=True)
            new_manifest_arrangements = []
            kept_paths: set[Path] = set()
            for item in merged_arrangements:
                entry = item["entry"]
                wire = item["wire"]
                if wire is not None:
                    rel = entry.get("file") or f"arrangements/{entry.get('id', 'arr')}.json"
                    arr_path = (source_dir / rel).resolve()
                    # Constrain writes to the arrangements/ subdir — defends
                    # against `..` traversal in a malformed/buggy snapshot.
                    try:
                        arr_path.relative_to(arr_dir)
                    except ValueError:
                        raise RuntimeError(f"Arrangement path escapes sandbox: {rel}")
                    arr_path.parent.mkdir(parents=True, exist_ok=True)
                    if arr_path.name.lower().endswith(".jsonc"):
                        # .jsonc arrangement: preserve comments from the existing
                        # file (feedpak-spec §8 Writer SHOULD), serialized pretty
                        # (indent=2) so comments re-insert at line boundaries.
                        original = ""
                        if arr_path.exists():
                            try:
                                original = arr_path.read_text(encoding="utf-8")
                            except OSError:
                                original = ""
                        arr_path.write_text(
                            _jsonc_save_text(original, wire), encoding="utf-8"
                        )
                    else:
                        arr_path.write_text(
                            json.dumps(wire, separators=(",", ":")),
                            encoding="utf-8",
                        )
                    entry = dict(entry)
                    entry["file"] = rel
                    # Dual-write: for keys-family arrangements also emit a
                    # notation_<id>.json sidecar and stamp the manifest
                    # `notation:` key on this entry (no-op for non-keys names or
                    # when there's nothing to lift). The legacy wire arrangement
                    # written just above stays intact for the 2D piano plugin.
                    _write_keys_notation_sidecar(
                        source_dir, entry, wire, beats,
                        gp_notation=item.get("gp_notation"))
                rel_kept = entry.get("file")
                if rel_kept:
                    kept_paths.add((source_dir / rel_kept).resolve())
                new_manifest_arrangements.append(entry)
            manifest["arrangements"] = new_manifest_arrangements

            # Drop orphaned arrangement JSONs (e.g. after a remove). Include
            # .jsonc so a removed .jsonc arrangement doesn't linger on disk.
            for f in (*arr_dir.glob("*.json"), *arr_dir.glob("*.jsonc")):
                if f.resolve() not in kept_paths:
                    try:
                        f.unlink()
                    except OSError:
                        pass

            # Drum-tab persist: write/update/remove drum_tab.json alongside the
            # manifest per sloppak-spec §5.3.
            #   missing key  → _DRUM_TAB_ABSENT sentinel → no-op (leave as-is)
            #   explicit null → None               → remove drum_tab.json
            #   dict          →                    → write/replace the file
            # Non-dict/non-null payloads are rejected with a 400 early in
            # save_song before this closure is reached.
            if drum_tab_payload is not _DRUM_TAB_ABSENT:
                drum_tab_path = (source_dir / "drum_tab.json").resolve()
                # Constrain writes to source_dir — defends against a malformed
                # session that escaped its sandbox.
                try:
                    drum_tab_path.relative_to(source_dir)
                except ValueError:
                    raise RuntimeError("drum_tab path escapes sandbox")
                if isinstance(drum_tab_payload, dict):
                    # Defensive dedup: drop near-equal (t, p) duplicates before
                    # writing. Local testing showed earlier corruption could
                    # quietly survive load→edit→save round-trips, with each
                    # save persisting the same junk forever. Server-side
                    # dedup breaks that cycle so the next save heals the
                    # file even if the client somehow held duplicates.
                    _hits_raw = drum_tab_payload.get("hits", [])
                    if not isinstance(_hits_raw, list):
                        import logging as _log_hits
                        _log_hits.getLogger("slopsmith.plugin.editor").warning(
                            "drum_tab.hits is not a list (got %s) — treating as empty",
                            type(_hits_raw).__name__,
                        )
                        _hits_raw = []
                    import math as _math
                    _hits_in: list = _hits_raw or []
                    _seen: set = set()
                    _deduped: list[dict] = []
                    _malformed_count: int = 0
                    _dup_count: int = 0
                    for _h in _hits_in:
                        if not isinstance(_h, dict):
                            _malformed_count += 1
                            continue
                        # Require a valid non-negative finite numeric t and a
                        # non-empty piece id — hits missing either field are
                        # malformed and would fail schema validation on next load.
                        try:
                            _t = float(_h.get("t"))  # type: ignore[arg-type]
                            _p = str(_h.get("p") or "")
                        except (TypeError, ValueError):
                            _malformed_count += 1
                            continue
                        if not _math.isfinite(_t) or _t < 0:
                            _malformed_count += 1
                            continue
                        if not _p:
                            _malformed_count += 1
                            continue
                        _t_rounded = round(_t, 3)
                        _key = (_t_rounded, _p)
                        if _key in _seen:
                            _dup_count += 1
                            continue
                        _seen.add(_key)
                        # Build a sanitized hit: coerce both t and p so
                        # drum_tab.json always stores a numeric timestamp and a
                        # string piece-id regardless of what the client sent.
                        _clean_h = dict(_h)
                        _clean_h["t"] = _t_rounded
                        _clean_h["p"] = _p
                        _deduped.append(_clean_h)
                    import logging as _logging
                    _dtlog = _logging.getLogger("slopsmith.plugin.editor")
                    if _malformed_count:
                        _dtlog.warning(
                            "drum_tab: dropped %d malformed hits during save",
                            _malformed_count,
                        )
                    if _dup_count:
                        _dtlog.warning(
                            "drum_tab: dropped %d duplicate (t, piece) hits during save",
                            _dup_count,
                        )
                    # Sort by t so drum_tab.json is always time-ordered;
                    # the frontend binary-search and drag-snap code depends
                    # on this invariant.
                    _deduped.sort(key=lambda _h2: _h2["t"])
                    # Write a shallow copy so we don't mutate the body dict
                    # parsed by FastAPI. Reassigning `drum_tab_payload` would
                    # make the whole closure treat the name as local and
                    # break the earlier `drum_tab_payload is not _DRUM_TAB_ABSENT`
                    # read (UnboundLocalError).
                    _persisted = dict(drum_tab_payload)
                    _persisted["hits"] = _deduped
                    drum_tab_path.write_text(
                        json.dumps(_persisted, separators=(",", ":")),
                        encoding="utf-8",
                    )
                    manifest["drum_tab"] = "drum_tab.json"
                else:
                    drum_tab_path.unlink(missing_ok=True)
                    manifest.pop("drum_tab", None)

            # Apply edited top-level metadata (title/artist/album/year only —
            # don't let the editor overwrite stems/lyrics/cover paths).
            if metadata:
                for k in ("title", "artist", "album"):
                    if metadata.get(k) is not None:
                        manifest[k] = metadata[k]
                if metadata.get("year") is not None:
                    try:
                        manifest["year"] = int(metadata["year"])
                    except (TypeError, ValueError):
                        pass

            _write_song_timeline_sidecar(source_dir, manifest, beats, sections)

            # Write manifest.yaml back into the source dir
            (source_dir / "manifest.yaml").write_text(
                yaml.safe_dump(manifest, sort_keys=False, allow_unicode=True),
                encoding="utf-8",
            )

            # Propagate the freshly-written manifest back into the in-memory
            # session. Without this, a later save in the same session that
            # omits `drum_tab` (the no-op path) would re-serialise the STALE
            # cached manifest — silently dropping the `drum_tab:` key and
            # un-linking drum_tab.json. Keeping the session manifest in sync
            # with disk makes every subsequent save start from current state.
            if isinstance(session.get("sloppak_state"), dict):
                session["sloppak_state"]["manifest"] = manifest

            # Directory-form sloppak: source_dir IS the sloppak — we've already
            # rewritten everything in place. Don't try to zip on top of it.
            if sloppak_form == "dir":
                return str(output_path)

            # Zip-form: back up the original and re-zip the source dir.
            if output_path.exists() and output_path.is_file():
                backup = dlc_dir / (filename + ".bak")
                if not backup.exists():
                    shutil.copy2(output_path, backup)

            output_path.parent.mkdir(parents=True, exist_ok=True)
            tmp_zip = output_path.with_suffix(output_path.suffix + ".tmp")
            with zipfile.ZipFile(str(tmp_zip), "w", zipfile.ZIP_DEFLATED) as zf:
                for f in source_dir.rglob("*"):
                    if f.is_file():
                        zf.write(f, f.relative_to(source_dir).as_posix())
            tmp_zip.replace(output_path)
            return str(output_path)

        # The editor only writes native `.sloppak` containers now —
        # external `.archive` export has been removed.
        if session.get("format") != "sloppak":
            return JSONResponse(
                {"error": "Only sloppak-format sessions can be saved"}, 400
            )
        try:
            output = await asyncio.get_event_loop().run_in_executor(None, _save_sloppak)
        except Exception as e:
            import traceback
            traceback.print_exc()
            return JSONResponse({"error": str(e)}, 500)

        return {"success": True, "path": output}

    # ── Save edited archive as Sloppak ──────────────────────────────────────
    #
    # When the user added extra strings (7/8-string guitar or 5/6-string
    # bass) to a archive-sourced edit, the regular archive save path can't
    # carry the extra strings — stock the chart's note-chart binary is hard-locked
    # to 6/4. This endpoint writes a new `.sloppak` next to the original
    # archive and updates the session so subsequent saves go through the
    # native sloppak path. The archive stays on disk untouched.

    @app.post("/api/plugins/editor/save_as_sloppak")
    async def save_as_sloppak(data: dict):
        session_id = data.get("session_id", "")
        session = sessions.get(session_id)
        if not session:
            return JSONResponse({"error": "No active session"}, 400)
        if session.get("format") != "archive":
            return JSONResponse(
                {"error": "save_as_sloppak only applies to archive-sourced sessions"},
                400,
            )
        session["last_touched"] = time.time()

        arrangements_data = data.get("arrangements") or []
        if not arrangements_data:
            return JSONResponse({"error": "arrangements required"}, 400)
        beats = data.get("beats", [])
        sections = data.get("sections", [])
        # Merge session metadata (loaded from the source archive: album,
        # year, etc.) with anything the frontend sent (title/artist that
        # the user may have edited mid-session). The frontend currently
        # only ships `{title, artist}`, so without this merge `album` and
        # `year` would be silently dropped when packaging the .sloppak.
        meta = dict(session.get("metadata") or {})
        meta.update(data.get("metadata") or {})

        audio_file = session.get("audio_file") or ""
        if not audio_file or not Path(audio_file).exists():
            return JSONResponse({"error": "session has no audio file"}, 400)

        dlc_dir = get_dlc_dir()
        if not dlc_dir:
            return JSONResponse({"error": "DLC folder not configured"}, 500)

        source_filename = session["filename"]
        source_path = (dlc_dir / source_filename).resolve()
        try:
            source_path.relative_to(dlc_dir.resolve())
        except ValueError:
            return JSONResponse({"error": "forbidden"}, 403)

        # Output sits next to the source archive, sharing its stem so the
        # library shows both `MySong_p.archive` and `MySong_p.feedpak`.
        # Keep any subdirectory prefix from `filename` (the picker
        # supports nested layouts like `Artist/Song_p.archive`); using
        # just the bare stem here would put the feedpak in the right
        # place on disk but `resolve_source_dir(new_filename, ...)`
        # downstream would later look for it at the DLC root.
        source_relpath = Path(source_filename)
        new_filename = str(source_relpath.with_suffix(".feedpak").as_posix())
        output_path = source_path.with_suffix(".feedpak")
        # Refuse to write the zip on top of an authoring-form package
        # directory at the same path — the picker supports `.feedpak/`
        # directories, and `_write_sloppak_pak` would fail trying to
        # replace it. Better a clear 409 than a half-written conflict.
        if output_path.exists() and output_path.is_dir():
            return JSONResponse(
                {"error": (
                    f"A feedpak directory already exists at "
                    f"{new_filename}. Remove or rename it before "
                    "converting the archive."
                )},
                409,
            )

        def _do_save():
            return _write_sloppak_pak(
                audio_file=audio_file,
                art_path="",  # archive sessions don't extract cover to disk yet
                arrangements_data=arrangements_data,
                beats=beats,
                sections=sections,
                meta=meta,
                output_path=output_path,
            )

        def _do_save_and_repoint():
            written = _do_save()
            # Re-extract the just-written sloppak into a fresh working
            # directory so the next /save call has a real sloppak source
            # tree (`source_dir/arrangements/*.json`, `manifest.yaml`,
            # stems) to edit. Without this, `_save_sloppak` would run
            # against the archive unpacked dir with no manifest and emit a
            # broken .sloppak on the user's next click of Save.
            new_source_dir = sloppak_mod.resolve_source_dir(
                new_filename, dlc_dir, SLOPPAK_CACHE,
            )
            new_manifest = sloppak_mod.load_manifest(Path(written))
            return written, new_source_dir, new_manifest

        try:
            written, new_source_dir, new_manifest = (
                await asyncio.get_event_loop().run_in_executor(None, _do_save_and_repoint)
            )
        except Exception as e:
            import traceback
            traceback.print_exc()
            return JSONResponse({"error": str(e)}, 500)

        # Switch session into sloppak mode pointing at the new sloppak's
        # unpacked cache dir. The old archive working dir is unreachable
        # from the session dict after we repoint `session["dir"]`, so
        # delete it now — without this, every archive→Sloppak conversion
        # leaks a temp directory full of unpacked note-chart/WEM/DDS bytes.
        old_source_dir = session.get("dir")
        session["filename"] = new_filename
        session["format"] = "sloppak"
        session["dir"] = str(new_source_dir)
        session["sloppak_state"] = {"manifest": new_manifest, "form": "zip"}
        if old_source_dir and old_source_dir != str(new_source_dir):
            shutil.rmtree(old_source_dir, ignore_errors=True)

        return {
            "success": True,
            "path": written,
            "filename": new_filename,
            "format": "sloppak",
        }

    # ── Create new Sloppak from scratch ───────────────────────────────
    #
    # Drummer-driven flow: instead of "create new custom song (archive) →
    # save-as-sloppak → +drums", let the user pick "New Sloppak" up
    # front and land in sloppak mode immediately with drum_tab + stems
    # available. Accepts the audio file as a multipart upload, builds a
    # minimal one-arrangement sloppak via `_write_sloppak_pak`, and
    # returns the new filename — the frontend then calls /load_song to
    # open it in the editor.

    @app.post("/api/plugins/editor/create_sloppak")
    async def create_sloppak(
        audio: UploadFile | None = File(None),
        metadata: str = Form(...),
    ):
        try:
            meta_in = json.loads(metadata)
        except json.JSONDecodeError:
            return JSONResponse({"error": "invalid metadata JSON"}, 400)
        if not isinstance(meta_in, dict):
            return JSONResponse({"error": "metadata must be a JSON object"}, 400)

        # Audio can arrive two ways: a direct multipart upload, OR a
        # pre-uploaded `audio_url` (the unified create modal pre-uploads
        # file/YouTube audio to a storage URL before calling us — that's
        # how YouTube source works for a blank sloppak). Exactly one is
        # required.
        audio_url = meta_in.get("audio_url")
        if audio_url is not None and not isinstance(audio_url, str):
            return JSONResponse({"error": "audio_url must be a string"}, 400)
        audio_url = (audio_url or "").strip()
        # Draft-now, audio-later: audio is OPTIONAL. With neither an upload nor a
        # pre-uploaded audio_url we still create a work-in-progress pack (empty
        # `stems: []`); the author supplies real audio later via Replace Audio.
        has_audio = audio is not None or bool(audio_url)

        # Optional album art, passed as a storage path returned by
        # /upload-art. Validate containment under STORAGE_DIR before
        # handing it to _write_sloppak_pak (which copies it into the
        # sloppak) so a crafted path can't exfiltrate arbitrary files.
        art_path_in = meta_in.get("art_path")
        if art_path_in is not None and not isinstance(art_path_in, str):
            return JSONResponse({"error": "art_path must be a string"}, 400)
        art_path = ""
        if art_path_in:
            try:
                resolved_art = Path(art_path_in).resolve()
                resolved_art.relative_to(STORAGE_DIR.resolve())
            except (ValueError, OSError):
                return JSONResponse({"error": "invalid art_path"}, 400)
            if resolved_art.exists():
                art_path = str(resolved_art)

        # Type-guard before .strip(): a malformed payload like
        # {"title": 123} would otherwise AttributeError → 500. Treat as
        # a normal bad-request (400) so the strict-validation behavior
        # is consistent across all fields.
        def _str_field(name: str, default: str = "") -> str | None:
            raw = meta_in.get(name, default)
            if raw is None:
                raw = default
            if not isinstance(raw, str):
                return None
            return raw.strip()

        title = _str_field("title")
        if title is None:
            return JSONResponse({"error": "title must be a string"}, 400)
        artist = _str_field("artist")
        if artist is None:
            return JSONResponse({"error": "artist must be a string"}, 400)
        if not title:
            return JSONResponse({"error": "title required"}, 400)
        # Artist is OPTIONAL for a draft — only the title is required to create a
        # work-in-progress pack. `artist` may be "" here (written through as-is).

        # Optional "Authored by" credit(s) -> manifest `authors:` (feedpak is an
        # open format; credit whoever makes the file, don't gate on it). Accept a
        # single string (the modal's one text field; users comma/newline-separate
        # names) OR a list. Normalize to a de-duped list of trimmed strings.
        authors_in = meta_in.get("authors")
        if isinstance(authors_in, str):
            authors_in = re.split(r"[,\n]", authors_in)
        authors: list[str] = []
        if isinstance(authors_in, list):
            _seen_auth: set[str] = set()
            for _a in authors_in:
                if isinstance(_a, str) and _a.strip() and _a.strip() not in _seen_auth:
                    _seen_auth.add(_a.strip())
                    authors.append(_a.strip())
        elif authors_in is not None:
            return JSONResponse(
                {"error": "authors must be a string or a list of strings"}, 400,
            )

        def _is_int(v) -> bool:
            # bool is a subclass of int in Python; treat True/False as invalid
            # so a `True → 1` doesn't slip past int fields (track/disc).
            return isinstance(v, int) and not isinstance(v, bool)

        # Roster of arrangements to seed ("What are you arranging?"). The modal
        # sends `arrangements`: the list of canonical role names the user dragged
        # in. Back-compat: a single `initial_arrangement` string is still
        # accepted. Roles map to editor modes by NAME — Lead/Rhythm/Bass →
        # fretted, Keys → piano-roll (type:piano), Drums → drum_tab. Vocals is
        # NOT an arrangement (feedpak models it as side-files); it seeds an empty
        # lyrics track and needs at least one instrument alongside it, since the
        # spec requires a non-empty arrangements list. String counts are NOT
        # chosen here — fretted roles get a default standard tuning (Bass 4,
        # guitar 6) and the editor extends the range (up to 9-string guitar /
        # 6-string bass) after creation.
        _FRETTED = ("Lead", "Rhythm", "Bass")
        _INSTRUMENTS = _FRETTED + ("Keys", "Drums")
        _ALL_ROLES = _INSTRUMENTS + ("Vocals",)
        _ROLE_ALIASES = {
            "Lead Guitar": "Lead", "Rhythm Guitar": "Rhythm",
            "Bass Guitar": "Bass", "Piano": "Keys", "Keyboard": "Keys",
            "Vocal": "Vocals", "Voice": "Vocals",
        }

        roster_in = meta_in.get("arrangements")
        if roster_in is None:
            # Legacy shape: `initial_arrangement` (single role) + `init_drum_tab`
            # (bool, default True). Translate both into the roster so an older
            # client still gets its requested drum tab — in the new model a
            # "Drums" role IS the drum tab (see init_drums below).
            single = _str_field("initial_arrangement", "Lead") or "Lead"
            roster_in = [single]
            legacy_drums = meta_in.get("init_drum_tab", True)
            if not isinstance(legacy_drums, bool):
                return JSONResponse({"error": "init_drum_tab must be a boolean"}, 400)
            if legacy_drums:
                roster_in.append("Drums")
        if not isinstance(roster_in, list) or not roster_in:
            return JSONResponse(
                {"error": "arrangements must be a non-empty list of roles"}, 400,
            )
        roster: list[str] = []
        for _r in roster_in:
            if not isinstance(_r, str):
                return JSONResponse(
                    {"error": "each arrangement role must be a string"}, 400,
                )
            _r = _ROLE_ALIASES.get(_r.strip(), _r.strip())
            if _r not in _ALL_ROLES:
                return JSONResponse(
                    {"error": (
                        f"unknown arrangement role '{_r}' — expected one of "
                        f"{', '.join(_ALL_ROLES)}"
                    )},
                    400,
                )
            if _r not in roster:
                roster.append(_r)
        want_vocals = "Vocals" in roster
        instrument_roster = [r for r in roster if r in _INSTRUMENTS]
        if not instrument_roster:
            return JSONResponse(
                {"error": (
                    "select at least one instrument to chart "
                    "(Lead, Rhythm, Bass, Keys, or Drums)"
                )},
                400,
            )
        # A Drums arrangement IS its drum tab — seed one iff Drums is selected.
        init_drums = "Drums" in instrument_roster

        dlc_dir = get_dlc_dir()
        if not dlc_dir:
            return JSONResponse({"error": "DLC folder not configured"}, 500)

        # Cap each side at 64 UTF-8 bytes so a long title/artist can't
        # push the final filename past the typical 255-byte filesystem
        # limit. Truncating by code-point count would still blow the
        # limit on emoji / CJK input (each char is 3-4 bytes).
        _MAX_FILENAME_PART_BYTES = 64

        def _truncate_utf8(s: str, max_bytes: int) -> str:
            b = s.encode("utf-8")[:max_bytes]
            return b.decode("utf-8", "ignore")

        safe_t = _truncate_utf8(
            re.sub(r'[<>:"/\\|?*]', "_", title), _MAX_FILENAME_PART_BYTES,
        ).rstrip(". ")
        safe_a = _truncate_utf8(
            re.sub(r'[<>:"/\\|?*]', "_", artist), _MAX_FILENAME_PART_BYTES,
        ).rstrip(". ")
        if not safe_t:
            return JSONResponse(
                {"error": "title must contain non-blank characters"},
                400,
            )
        # Artist may be blank on a draft (or sanitise to empty) — fall back to a
        # title-only filename rather than an ugly trailing-underscore name.
        new_filename = f"{safe_t}_{safe_a}.feedpak" if safe_a else f"{safe_t}.feedpak"
        output_path = (dlc_dir / new_filename).resolve()
        # Containment check — the sanitiser above strips path separators,
        # but defend against a `.. .. ..` -style title that somehow
        # escapes the regex.
        try:
            output_path.relative_to(dlc_dir.resolve())
        except ValueError:
            return JSONResponse({"error": "forbidden"}, 403)
        if output_path.exists():
            # Distinguish file collision from authoring-form dir
            # collision (`save_as_sloppak` returns the same 409 with a
            # similarly-worded directory-specific message). A clearer
            # error tells the user what they actually need to clean up.
            if output_path.is_dir():
                return JSONResponse(
                    {"error": (
                        f"A sloppak directory already exists at "
                        f"{new_filename}. Remove or rename it before "
                        "creating a new sloppak with this title/artist."
                    )},
                    409,
                )
            return JSONResponse(
                {"error": (
                    f"A file named {new_filename} already exists in the DLC "
                    "folder. Pick a different title/artist or remove the "
                    "existing file."
                )},
                409,
            )

        # Save the upload + re-encode to .ogg so the sloppak stem matches
        # the format the rest of the editor expects (load path decodes
        # everything to ogg anyway). Wrapped in try/finally so any
        # exception (audio.read OOM, copy2 disk-full, ffmpeg crash,
        # write failure) cleans up the temp dir instead of leaking it.
        upload_dir = Path(tempfile.mkdtemp(prefix="slopsmith_create_sloppak_"))
        try:
            # Whitelist the extension before interpolating it into the
            # temp path. `Path.suffix` returns just the final ".ext"
            # fragment (no separators), so a hostile filename like
            # "../../evil.mp3" already resolves to ".mp3" here — but
            # defence-in-depth: any non-known extension drops to
            # ".bin" and lets ffmpeg's content-sniff decide the format.
            _KNOWN_AUDIO_EXTS = {
                ".mp3", ".wav", ".flac", ".m4a", ".ogg", ".opus",
                ".aac", ".aiff", ".wma",
            }
            # Stays None when no audio is supplied (draft-now): the encode block
            # below is guarded on it and `ogg_path` stays None.
            in_ext = None
            if audio is not None:
                _raw_ext = Path(audio.filename or "audio").suffix.lower()
                in_ext = _raw_ext if _raw_ext in _KNOWN_AUDIO_EXTS else ".bin"
                in_path = upload_dir / f"upload{in_ext}"
                # Stream the upload to disk in chunks instead of slurping
                # the whole file into memory — a large audio (multi-
                # hundred-MB FLAC, an hour-long jam) would otherwise risk
                # an OOM here.
                with in_path.open("wb") as dst:
                    while True:
                        chunk = await audio.read(64 * 1024)
                        if not chunk:
                            break
                        dst.write(chunk)
            elif audio_url:
                # Pre-uploaded audio: resolve the storage URL to a local
                # file (validates containment) and copy it into the temp
                # dir so the re-encode path below is identical to the
                # direct-upload case.
                resolved_audio = _resolve_storage_url(audio_url)
                if not resolved_audio or not Path(resolved_audio).exists():
                    return JSONResponse(
                        {"error": "audio_url did not resolve to a file"}, 400,
                    )
                _raw_ext = Path(resolved_audio).suffix.lower()
                in_ext = _raw_ext if _raw_ext in _KNOWN_AUDIO_EXTS else ".bin"
                in_path = upload_dir / f"upload{in_ext}"
                shutil.copy2(resolved_audio, in_path)

            # None → no audio supplied: skip encode, leave ogg_path None so the
            # write emits an empty `stems: []` draft.
            ogg_path = None
            if in_ext is not None:
                ogg_path = upload_dir / "audio.ogg"
                if in_ext == ".ogg":
                    # Rename instead of copy — both paths live in the same
                    # upload_dir (deleted at the end), so duplicating the
                    # bytes just doubles peak temp disk for nothing.
                    in_path.rename(ogg_path)
                    # Same min-size sanity check the re-encode branch
                    # enforces — a 0-byte / truncated .ogg would otherwise
                    # produce a sloppak that fails on first open.
                    if (not ogg_path.exists()
                            or ogg_path.stat().st_size < 100):
                        return JSONResponse(
                            {"error": "uploaded .ogg is empty or too small to play"},
                            400,
                        )
                else:
                    from lib.audio import _ffmpeg_cmd, _ffmpeg_wav_to_ogg
                    ffmpeg = _ffmpeg_cmd()
                    if not ffmpeg:
                        return JSONResponse(
                            {"error": "ffmpeg not available — can't re-encode audio"},
                            500,
                        )
                    try:
                        r = await asyncio.get_event_loop().run_in_executor(
                            None, _ffmpeg_wav_to_ogg, ffmpeg, in_path, ogg_path,
                        )
                    except Exception:
                        # str(e) on subprocess / OSError commonly embeds the
                        # ffmpeg cmd line and absolute paths — log it
                        # server-side and return a generic message.
                        import logging as _log
                        _log.getLogger("slopsmith.plugin.editor").exception(
                            "create_sloppak: ffmpeg re-encode raised",
                        )
                        return JSONResponse(
                            {"error": "audio re-encode failed — see server logs"},
                            400,
                        )
                    if (r.returncode != 0 or not ogg_path.exists()
                            or ogg_path.stat().st_size < 100):
                        return JSONResponse(
                            {"error": "ffmpeg failed to decode the uploaded audio"},
                            400,
                        )

            # Build one in-memory arrangement per instrument role in the roster.
            # Fretted roles carry a default standard tuning (Bass 4 strings,
            # guitar 6 — the editor extends the count after creation); Keys
            # carries the spec `type: piano`; Drums opens the drum lane by name.
            # Each opens in the right editor mode by NAME (KEYS_PATTERN / ^drums).
            def _default_tuning(role: str) -> list:
                if role in _FRETTED:
                    return [0] * (4 if role == "Bass" else 6)
                return []
            arrangements_data = []
            for _role in instrument_roster:
                _arr = {
                    "name": _role,
                    "tuning": _default_tuning(_role),
                    "capo": 0,
                    "notes": [],
                    "chords": [],
                    "chord_templates": [],
                }
                if _role == "Keys":
                    _arr["type"] = "piano"
                arrangements_data.append(_arr)
            # Seed a minimal one-measure 4/4 @ 120 BPM grid (downbeat +
            # three sub-beats + next downbeat = 5 beats). The Tempo Map
            # editor bails when beats.length < 2 ("No beat grid…"), so
            # a single downbeat would lock the user out of the very UI
            # they'd use to fix the grid. The user runs Sync or drags
            # poles in Tempo Map mode to fit this to the audio.
            beats = [
                {"time": 0.0, "measure": 1},
                {"time": 0.5, "measure": -1},
                {"time": 1.0, "measure": -1},
                {"time": 1.5, "measure": -1},
                {"time": 2.0, "measure": 2},
            ]
            sections: list = []
            # Same type-guard rule as title/artist/initial_arrangement —
            # writing a non-string/non-scalar into manifest.yaml would
            # produce a malformed sloppak or break loaders that assume
            # these fields are scalars. Reject as a 400 (not 500) when
            # the payload is the wrong shape.
            album_raw = meta_in.get("album", "")
            if album_raw is None:
                album_raw = ""
            if not isinstance(album_raw, str):
                return JSONResponse(
                    {"error": "album must be a string"}, 400,
                )
            year_raw = meta_in.get("year", "")
            if year_raw is None:
                year_raw = ""
            # Accept int or string (the create modal sends a number;
            # the underlying _write_sloppak_pak str()s it either way).
            # Reject bool explicitly — isinstance(True, int) is True
            # in Python and we don't want True → "True" in the manifest.
            if (isinstance(year_raw, bool)
                    or not isinstance(year_raw, (int, str))):
                return JSONResponse(
                    {"error": "year must be a number or string"}, 400,
                )
            # ── Spec-complete manifest metadata (feedpak §5.1) ──
            # Every field is OPTIONAL and written through only when present.
            def _opt_str(name):
                v = meta_in.get(name)
                if v is None:
                    return ""
                if not isinstance(v, str):
                    raise ValueError(f"{name} must be a string")
                return v.strip()

            def _opt_int(name):
                v = meta_in.get(name)
                if v in (None, ""):
                    return None
                if isinstance(v, str) and v.strip().lstrip("-").isdigit():
                    return int(v.strip())
                if _is_int(v):
                    return v
                raise ValueError(f"{name} must be an integer")

            try:
                album_artist = _opt_str("album_artist")
                language = _opt_str("language")
                mbid = _opt_str("mbid").lower()
                # ISRC: the bare 12-char code — strip the display hyphens/spaces
                # and upper-case (feedpak §5.1). Not hard-rejected on length so a
                # partial draft entry is tolerated.
                isrc = re.sub(r"[\s-]", "", _opt_str("isrc")).upper()
                track_no = _opt_int("track")
                disc_no = _opt_int("disc")
            except ValueError as _e:
                return JSONResponse({"error": str(_e)}, 400)

            # genres: accept a list OR a comma/newline string; normalise to a
            # de-duped list of trimmed strings (most-specific first).
            genres_in = meta_in.get("genres")
            if isinstance(genres_in, str):
                genres_in = re.split(r"[,\n]", genres_in)
            genres: list[str] = []
            if isinstance(genres_in, list):
                _seen_g: set[str] = set()
                for _g in genres_in:
                    if isinstance(_g, str) and _g.strip() and _g.strip() not in _seen_g:
                        _seen_g.add(_g.strip())
                        genres.append(_g.strip())
            elif genres_in is not None:
                return JSONResponse(
                    {"error": "genres must be a string or a list of strings"}, 400,
                )

            meta_out = {
                "title": title,
                "artist": artist,
                "album": album_raw,
                "year": year_raw,
            }
            if authors:
                meta_out["authors"] = authors
            if album_artist:
                meta_out["album_artist"] = album_artist
            if track_no is not None:
                meta_out["track"] = track_no
            if disc_no is not None:
                meta_out["disc"] = disc_no
            if genres:
                meta_out["genres"] = genres
            if mbid:
                meta_out["mbid"] = mbid
            if isrc:
                meta_out["isrc"] = isrc
            if language:
                meta_out["language"] = language

            drum_tab: dict | None = None
            if init_drums:
                from lib import drums as drums_mod
                drum_tab = {
                    "version": getattr(drums_mod, "SCHEMA_VERSION", 1),
                    "name": "Drums",
                    "kit": [],
                    "hits": [],
                }

            # Vocals in the roster seeds an EMPTY lyrics track (feedpak models
            # vocals as side-files, not an arrangement). An empty list is a valid
            # lyrics.json — the author fills syllables in later.
            lyrics_seed: list | None = [] if want_vocals else None

            # Probe the actual audio duration so the sloppak's
            # manifest.duration reflects the song, not the 2-second
            # placeholder beat grid. Best-effort: if the probe fails
            # we fall through to the (incorrect) beats-derived default
            # rather than refusing the whole create.
            audio_duration: float | None = None
            try:
                from lib.audio import _bundled_or_path
                ffprobe = _bundled_or_path("ffprobe") or shutil.which("ffprobe")
            except Exception:
                ffprobe = shutil.which("ffprobe")
            if ffprobe and ogg_path is not None:
                try:
                    pr = await asyncio.get_event_loop().run_in_executor(
                        None,
                        lambda: subprocess.run(
                            [ffprobe, "-v", "error",
                             "-show_entries", "format=duration",
                             "-of", "csv=p=0", str(ogg_path)],
                            capture_output=True, timeout=15,
                        ),
                    )
                    if pr.returncode == 0:
                        try:
                            audio_duration = float(pr.stdout.strip())
                        except (TypeError, ValueError):
                            audio_duration = None
                except Exception:
                    audio_duration = None

            def _do_write():
                # Auto-generate the hover-to-listen preview from the master audio
                # (no manual upload) — best-effort; absent for audio-less drafts.
                preview_clip = ""
                if ogg_path is not None:
                    _pv = _make_preview_clip(Path(ogg_path), upload_dir)
                    if _pv:
                        preview_clip = str(_pv)
                return _write_sloppak_pak(
                    audio_file=(str(ogg_path) if ogg_path is not None else ""),
                    art_path=art_path,
                    arrangements_data=arrangements_data,
                    beats=beats,
                    sections=sections,
                    meta=meta_out,
                    output_path=output_path,
                    drum_tab=drum_tab,
                    lyrics=lyrics_seed,
                    preview_path=preview_clip,
                    fail_if_exists=True,
                    duration_override=audio_duration,
                )

            try:
                await asyncio.get_event_loop().run_in_executor(
                    None, _do_write,
                )
            except FileExistsError as e:
                # Lost the TOCTOU race; surface as 409.
                return JSONResponse({"error": str(e)}, 409)
            except IsADirectoryError:
                # Authoring-form `*.sloppak/` directory at the target —
                # _write_sloppak_pak refuses to clobber. Match the
                # build endpoint's 409 (not 500). str(e) would embed
                # the absolute output_path, so build the message from
                # the basename instead to avoid leaking the DLC dir.
                return JSONResponse(
                    {"error": (
                        f"A sloppak directory already exists at "
                        f"{new_filename}. Remove or rename it before "
                        "creating a new sloppak with this title/artist."
                    )},
                    409,
                )
            except Exception:
                # Log the full traceback server-side so an operator can
                # diagnose the failure, but DON'T return str(e) to the
                # client — many filesystem / zip / shutil exceptions
                # embed absolute paths (DLC dir, temp dir, …) and would
                # leak local layout via the error response.
                import logging as _log
                _log.getLogger("slopsmith.plugin.editor").exception(
                    "create_sloppak: write failed for %s", new_filename,
                )
                return JSONResponse(
                    {"error": "failed to write the sloppak — see server logs"},
                    500,
                )

            # Don't leak the absolute disk path back to the client; the
            # frontend only needs `filename` to call loadCDLC.
            return {"success": True, "filename": new_filename}
        finally:
            shutil.rmtree(upload_dir, ignore_errors=True)

    # ── Upload album art ───────────────────────────────────────────────

    @app.post("/api/plugins/editor/upload-art")
    async def upload_art(file: UploadFile = File(...)):
        art_id = Path(file.filename).stem.replace(" ", "_")
        ext = Path(file.filename).suffix or ".png"
        dest = STORAGE_DIR / f"editor_art_{art_id}{ext}"
        content = await file.read()
        dest.write_bytes(content)
        return {"art_path": str(dest)}

    # ── Cover Art Archive — album-art picker from a MusicBrainz release ─────
    # Cover art lives in the Cover Art Archive (CAA), keyed by RELEASE MBID —
    # which the create modal's MusicBrainz "Match" already carries (a candidate's
    # `release_id`). Fetched server-side (dodges browser CORS + gives us the
    # bytes to bake into the pack) and cached under STORAGE_DIR.
    _CAA_ID_RE = re.compile(r"^[0-9a-fA-F-]{1,64}$")
    _CAA_MAX_BYTES = 10 * 1024 * 1024
    _CAA_UA = "feedBack-editor/1.0 ( https://github.com/got-feedback/feedBack )"

    _CAA_SECONDARY_SKIP = {"live", "compilation", "remix", "dj-mix",
                           "mixtape/street", "demo", "interview", "audiobook",
                           "spokenword"}

    def _caa_fetch_front(cover_id: str, size: int = 500, kind: str = "release"):
        """Front cover (size px) for a MusicBrainz `kind` ('release' or
        'release-group') from coverartarchive.org, or None when there's no art /
        on any error. `cover_id` is regex-validated by callers before the URL."""
        import urllib.request
        url = f"https://coverartarchive.org/{kind}/{cover_id}/front-{size}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": _CAA_UA})
            with urllib.request.urlopen(req, timeout=10) as resp:
                if getattr(resp, "status", 200) != 200:
                    return None
                data = resp.read(_CAA_MAX_BYTES + 1)
        except Exception:
            return None
        if not data or len(data) > _CAA_MAX_BYTES or len(data) < 100:
            return None
        return data

    async def _caa_cached(cover_id: str, kind: str = "release"):
        """Cached cover file (fetch + cache on first use), or None when no art."""
        tag = "rg_" if kind == "release-group" else ""
        dest = STORAGE_DIR / f"caa_{tag}{cover_id}.jpg"
        if dest.exists() and dest.stat().st_size > 100:
            return dest
        data = await asyncio.get_event_loop().run_in_executor(
            None, _caa_fetch_front, cover_id, 500, kind)
        if data is None:
            return None
        dest.write_bytes(data)
        return dest

    @app.get("/api/plugins/editor/caa-cover/{cover_id}")
    async def caa_cover(cover_id: str, group: int = 0):
        """Serve the CAA front cover for a release (or release-group when
        ?group=1), cached. 404 when there's no art — the picker hides the tile.
        Same-origin so it loads under the app's CSP without an external host."""
        if not _CAA_ID_RE.match(cover_id or ""):
            return JSONResponse({"error": "invalid id"}, 400)
        dest = await _caa_cached(cover_id, "release-group" if group else "release")
        if dest is None:
            return JSONResponse({"error": "no cover art"}, 404)
        return FileResponse(dest, media_type="image/jpeg")

    @app.post("/api/plugins/editor/use-caa-cover")
    async def use_caa_cover(data: dict):
        """Pick a CAA cover as the pack's album art: fetch/cache it and return an
        art_path under STORAGE_DIR that create_sloppak bakes in like an upload."""
        cover_id = str((data or {}).get("release_id") or "")
        kind = "release-group" if (data or {}).get("group") else "release"
        if not _CAA_ID_RE.match(cover_id):
            return JSONResponse({"error": "invalid id"}, 400)
        dest = await _caa_cached(cover_id, kind)
        if dest is None:
            return JSONResponse({"error": "no cover art"}, 404)
        return {"art_path": str(dest)}

    # Album-centric cover search. MusicBrainz RELEASE-GROUPS carry reliable Album
    # vs Live/Compilation typing (unlike recording releases), so searching them by
    # artist + album/title and preferring the studio album surfaces the CANONICAL
    # cover first — the fix for "art search shows random comp covers". Works
    # art-first for title-tracks; for other songs, fill the Album (or run Match).
    def _mb_release_group_covers(artist: str, query: str) -> list:
        """Release-group search → [{id, title, year, studio}] studio-albums first."""
        import urllib.request
        import urllib.parse

        def _phrase(s):
            return s.replace("\\", "\\\\").replace('"', '\\"')

        parts = []
        if query:
            parts.append('releasegroup:"%s"' % _phrase(query))
        if artist:
            parts.append('artist:"%s"' % _phrase(artist))
        if not parts:
            return []
        url = ("https://musicbrainz.org/ws/2/release-group?"
               + urllib.parse.urlencode(
                   {"query": " AND ".join(parts), "fmt": "json", "limit": 15}))
        try:
            req = urllib.request.Request(url, headers={"User-Agent": _CAA_UA})
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = json.loads(resp.read().decode("utf-8", "replace"))
        except Exception:
            return []
        out = []
        for rg in (body.get("release-groups") or []):
            if not isinstance(rg, dict) or not rg.get("id"):
                continue
            secs = {str(s).lower() for s in (rg.get("secondary-types") or [])}
            studio = (str(rg.get("primary-type", "")).lower() == "album"
                      and not (secs & _CAA_SECONDARY_SKIP))
            out.append({
                "id": str(rg["id"]),
                "title": str(rg.get("title", "") or ""),
                "year": str(rg.get("first-release-date", "") or "")[:4],
                "studio": studio,
            })
        out.sort(key=lambda g: (0 if g["studio"] else 1, g["year"] or "9999"))
        return out

    @app.get("/api/plugins/editor/cover-search")
    async def cover_search(artist: str = "", query: str = ""):
        """Album-centric cover candidates (release-groups) for the art picker.
        `query` is the ALBUM (best) or the song title. Studio album first."""
        if not (artist.strip() or query.strip()):
            return {"covers": []}
        covers = await asyncio.get_event_loop().run_in_executor(
            None, _mb_release_group_covers, artist.strip(), query.strip())
        return {"covers": covers}

    # ── Upload hover-preview clip ──────────────────────────────────────
    @app.post("/api/plugins/editor/upload-preview")
    async def upload_preview(file: UploadFile = File(...)):
        pid = re.sub(r"[^A-Za-z0-9_-]", "_", Path(file.filename or "").stem) or "preview"
        ext = (Path(file.filename or "").suffix or ".ogg").lower()
        content = await file.read()
        # A .wem preview would bake in unplayable — decode it (ogg > flac > mp3),
        # same as the audio uploads.
        if ext == ".wem":
            out_path, err = await asyncio.get_event_loop().run_in_executor(
                None, _wem_bytes_to_preferred_audio, content)
            if out_path is None:
                return JSONResponse({"error": err or "WEM decode failed"}, 400)
            dest = STORAGE_DIR / f"editor_preview_{pid}{out_path.suffix.lower()}"
            shutil.copy2(out_path, dest)
            shutil.rmtree(out_path.parent, ignore_errors=True)
            return {"preview_path": str(dest)}
        dest = STORAGE_DIR / f"editor_preview_{pid}{ext}"
        dest.write_bytes(content)
        return {"preview_path": str(dest)}

    # ── Upload audio file ──────────────────────────────────────────────

    @app.post("/api/plugins/editor/upload-audio")
    async def upload_audio(file: UploadFile = File(...)):
        audio_id = re.sub(r"[^A-Za-z0-9_-]", "_", Path(file.filename or "").stem) or "audio"
        ext = (Path(file.filename or "").suffix or ".mp3").lower()
        content = await file.read()

        # Wwise .wem can't be read by browsers or ffmpeg directly — decode it
        # (vgmstream → ogg > flac > mp3) before storing.
        if ext == ".wem":
            out_path, err = await asyncio.get_event_loop().run_in_executor(
                None, _wem_bytes_to_preferred_audio, content)
            if out_path is None:
                return JSONResponse({"error": err or "WEM decode failed"}, 400)
            dest = STORAGE_DIR / f"editor_audio_{audio_id}{out_path.suffix.lower()}"
            shutil.copy2(out_path, dest)
            shutil.rmtree(out_path.parent, ignore_errors=True)
            _dur = await asyncio.get_event_loop().run_in_executor(
                None, _probe_audio_duration, dest)
            return {"audio_url": f"{STORAGE_URL}/{dest.name}", "duration": _dur}

        dest = STORAGE_DIR / f"editor_audio_{audio_id}{ext}"
        dest.write_bytes(content)
        # Duration lets the create modal's MusicBrainz "Match" rank candidates by
        # how close their length is to this master audio (the studio-vs-live tell).
        _dur = await asyncio.get_event_loop().run_in_executor(
            None, _probe_audio_duration, dest)
        return {"audio_url": f"{STORAGE_URL}/editor_audio_{audio_id}{ext}", "duration": _dur}

    # ── Download audio from YouTube ──────────────────────────────────

    @app.post("/api/plugins/editor/youtube-audio")
    async def youtube_audio(data: dict):
        url = data.get("url", "").strip()
        if not url:
            return JSONResponse({"error": "No URL provided"}, 400)

        def _download():
            tmp = tempfile.mkdtemp(prefix="slopsmith_yt_")
            out_template = os.path.join(tmp, "audio.%(ext)s")
            try:
                import yt_dlp
                opts = {
                    "format": "bestaudio/best",
                    "outtmpl": out_template,
                    "postprocessors": [{
                        "key": "FFmpegExtractAudio",
                        "preferredcodec": "mp3",
                        "preferredquality": "192",
                    }],
                    "quiet": True,
                    "no_warnings": True,
                }
                with yt_dlp.YoutubeDL(opts) as ydl:
                    info = ydl.extract_info(url, download=True)
                    title = info.get("title", "audio")

                # Find the output file
                for f in Path(tmp).iterdir():
                    if f.suffix in (".mp3", ".m4a", ".ogg", ".wav"):
                        audio_id = re.sub(r"[^a-zA-Z0-9_-]", "_", title)[:60]
                        ext = f.suffix
                        dest = STORAGE_DIR / f"editor_audio_{audio_id}{ext}"
                        shutil.copy2(f, dest)
                        shutil.rmtree(tmp, ignore_errors=True)
                        return {
                            "audio_url": f"{STORAGE_URL}/editor_audio_{audio_id}{ext}",
                            "title": title,
                        }

                shutil.rmtree(tmp, ignore_errors=True)
                raise RuntimeError("No audio file produced")
            except Exception as e:
                shutil.rmtree(tmp, ignore_errors=True)
                raise

        try:
            result = await asyncio.get_event_loop().run_in_executor(
                None, _download
            )
            return result
        except Exception as e:
            return JSONResponse({"error": str(e)}, 500)

    # ── Replace audio on a loaded session ────────────────────────────

    @app.post("/api/plugins/editor/replace-audio")
    async def replace_audio(data: dict):
        """Swap the audio track for a loaded session.

        Behavior by session kind:

        - **dir-form sloppak**: copies the new audio into
          ``<source_dir>/stems/`` and rewrites ``manifest.yaml`` to a single
          ``"full"`` stem. ``source_dir`` IS the on-disk sloppak, so the
          change persists immediately (``persisted=True``, ``next_step="none"``).
          The wholesale stems-replacement is intentional — for multi-stem
          projects (guitar/bass/drums splits), merely swapping the "full"
          entry would leave other entries pointing at the now-stale mix.

        - **zip-form sloppak**: same writes, but ``source_dir`` is the
          unpack cache, so the on-disk ``.sloppak`` archive isn't touched
          until the user hits Save (which re-zips). Returned as
          ``persisted=False, next_step="save"`` so the UI can prompt.

        - **create-mode (fresh GP import)**: only ``session["audio_file"]``
          is updated. The next Build Song will produce a ``.archive``
          referencing the new audio. ``persisted=False, next_step="build"``.

        - **loaded archive**: only ``session["audio_file"]`` is updated; the
          editor uses the new audio for playback, but there is no
          in-editor flow that repacks WEMs into the original ``.archive``.
          ``persisted=False, next_step="rebuild"`` — the UI surfaces this
          as playback-only.
        """
        session_id = data.get("session_id", "")
        audio_url = (data.get("audio_url") or "").strip()
        session = sessions.get(session_id)
        if not session:
            return JSONResponse({"error": "session not found"}, 404)
        src = _resolve_storage_url(audio_url)
        if src is None or not src.exists():
            return JSONResponse({"error": "invalid audio_url"}, 400)

        session["last_touched"] = time.time()
        session["audio_file"] = str(src)
        persisted = False
        # next_step tells the client which UI hint to show when not persisted.
        # "none"    — already on disk
        # "save"    — zip-form sloppak: cache updated, Save will re-zip
        # "build"   — create-mode: Build Song will produce a .archive with the new audio
        # "rebuild" — loaded archive: no in-editor persist path (would need WEM repack)
        next_step = "rebuild"
        if session.get("create_mode"):
            next_step = "build"

        if session.get("format") == "sloppak" and session.get("sloppak_state"):
            sloppak_form = session["sloppak_state"].get("form") or "zip"
            try:
                source_dir = Path(session["dir"]).resolve()
                stems_dir = source_dir / "stems"
                stems_dir.mkdir(parents=True, exist_ok=True)
                safe_stem = re.sub(r"[^a-zA-Z0-9_-]", "_", src.stem)[:60] or "full"
                dest = (stems_dir / f"{safe_stem}{src.suffix}").resolve()
                # Path traversal guard — mirrors _safe_stem_path.
                try:
                    dest.relative_to(source_dir)
                except ValueError:
                    return JSONResponse({"error": "stem path escapes session dir"}, 400)
                shutil.copy2(src, dest)

                manifest = dict(session["sloppak_state"].get("manifest") or {})
                rel = f"stems/{dest.name}"
                manifest["stems"] = [{"id": "full", "file": rel}]
                # Regenerate the auto preview from the new master audio so a draft
                # that had no audio at create (and thus no preview) gets one now.
                _pv = _make_preview_clip(dest, source_dir)
                if _pv and _pv.exists():
                    manifest["preview"] = _pv.name
                (source_dir / "manifest.yaml").write_text(
                    yaml.safe_dump(manifest, sort_keys=False, allow_unicode=True),
                    encoding="utf-8",
                )
                session["sloppak_state"]["manifest"] = manifest
                # Only dir-form sloppaks are persisted: zip-form's source_dir is
                # the unpack cache, so the on-disk .sloppak archive isn't touched
                # until the user hits Save (which re-zips). Be honest about that
                # to the UI so the user knows whether further action is needed.
                if sloppak_form == "dir":
                    persisted = True
                    next_step = "none"
                else:
                    next_step = "save"
            except Exception as e:
                print(f"[Editor] replace-audio sloppak persist failed: {e}")
                return JSONResponse({"error": f"persist failed: {e}"}, 500)

        return {"audio_url": audio_url, "persisted": persisted, "next_step": next_step}

    # ── Import Guitar Pro file ───────────────────────────────────────

    @app.post("/api/plugins/editor/import-gp")
    async def import_gp(file: UploadFile = File(...)):
        """Upload a GP file and return track listing."""
        from lib.gp2rs import list_tracks

        # `file.filename` is attacker-controlled; using it raw in the temp
        # path let `../` escape the mkdtemp sandbox (arbitrary file write).
        # Validate the extension against a whitelist (the browser accept
        # filter is advisory only) and write to a fixed base name — same
        # pattern as import_midi below / create_sloppak above.
        _KNOWN_GP_EXTS = {".gp", ".gp3", ".gp4", ".gp5", ".gpx"}
        in_ext = Path(file.filename or "").suffix.lower()
        if in_ext not in _KNOWN_GP_EXTS:
            return JSONResponse(
                {"error": "Only .gp/.gp3/.gp4/.gp5/.gpx files are accepted"}, 400)
        tmp = tempfile.mkdtemp(prefix="slopsmith_gp_")
        gp_path = os.path.join(tmp, "import" + in_ext)
        content = await file.read()
        Path(gp_path).write_bytes(content)

        def _list():
            return list_tracks(gp_path)

        try:
            tracks = await asyncio.get_event_loop().run_in_executor(
                None, _list
            )
        except Exception as e:
            shutil.rmtree(tmp, ignore_errors=True)
            return JSONResponse({"error": f"Failed to parse GP file: {e}"}, 500)

        # Detect GP8 embedded audio so frontend can show sync options. This
        # parses the GP file and can be CPU-heavy, so run it off the event loop
        # (like list_tracks above) to avoid stalling concurrent requests.
        def _detect_embedded():
            try:
                from lib.gp8_audio_sync import has_embedded_audio, extract_sync
                if has_embedded_audio(gp_path):
                    _sync = extract_sync(gp_path)
                    return True, (len(_sync.sync_points) if _sync else 0)
            except ImportError:
                pass  # gp8_audio_sync not present — detection is optional
            except Exception as _dexc:
                import logging as _elog
                _elog.getLogger("slopsmith.plugin.editor").debug(
                    "GP8 embedded-audio detection failed for %s: %s", gp_path, _dexc
                )
            return False, 0

        has_audio, sync_count = await asyncio.get_event_loop().run_in_executor(
            None, _detect_embedded
        )

        # Song metadata for non-destructive autofill of the create modal's
        # Title / Artist / Album fields (convert-gp reads those same fields, so
        # this just saves retyping). Best-effort — a parse failure returns blanks
        # and the modal simply falls back to the filename-derived title.
        def _gp_song_meta():
            try:
                import guitarpro
                song = guitarpro.parse(gp_path)
                return {
                    "title": (getattr(song, "title", "") or "").strip(),
                    "artist": (getattr(song, "artist", "") or "").strip(),
                    "album": (getattr(song, "album", "") or "").strip(),
                }
            except Exception:
                return {"title": "", "artist": "", "album": ""}

        song_meta = await asyncio.get_event_loop().run_in_executor(
            None, _gp_song_meta
        )

        return {"gp_path": gp_path, "tracks": tracks,
                "has_embedded_audio": has_audio,
                "sync_point_count": sync_count,
                "song": song_meta}



    # ── Auto-sync GP file to uploaded audio ─────────────────────────
    @app.post("/api/plugins/editor/autosync-gp")
    async def autosync_gp(data: dict):
        """Auto-sync a GP file to a user-supplied audio file.

        Runs lib.gp_autosync.auto_sync() (two-stage DTW + onset phase sweep)
        and returns audio_offset and sync_points for use in convert-gp.
        Falls back with a clear 503 if librosa is not installed.
        """
        gp_path_raw = (data or {}).get("gp_path", "")
        audio_url = (data or {}).get("audio_url", "")

        validated = _validate_editor_upload_path(gp_path_raw, "slopsmith_gp_")
        if not validated:
            return JSONResponse({"error": "GP file not found"}, 400)
        if not isinstance(audio_url, str) or not audio_url.strip():
            return JSONResponse({"error": "audio_url required"}, 400)

        audio_path = _resolve_storage_url(audio_url)
        if not audio_path or not audio_path.exists():
            return JSONResponse({"error": "Audio file not found"}, 400)

        try:
            from lib.gp_autosync import auto_sync, is_available
        except ImportError:
            return JSONResponse(
                {"error": "Auto-sync requires librosa "
                          "(install the lyrics-karaoke plugin or: pip install librosa)"},
                503,
            )

        if not is_available():
            return JSONResponse(
                {"error": "librosa not available — install it to use auto-sync"}, 503)

        def _run():
            return auto_sync(str(validated), str(audio_path))

        try:
            sync = await asyncio.get_running_loop().run_in_executor(None, _run)
            return {
                "ok": True,
                "audio_offset": sync.audio_offset,
                "sync_point_count": len(sync.sync_points),
                "sync_points": [
                    {
                        "bar": sp.bar,
                        "time_secs": round(sp.time_secs, 3),
                        "modified_bpm": round(sp.modified_tempo, 2),
                        "original_bpm": round(sp.original_tempo, 2),
                    }
                    for sp in sync.sync_points
                ],
            }
        except Exception:
            import logging as _elog
            _elog.getLogger("slopsmith.plugin.editor").exception("autosync-gp failed")
            return JSONResponse({"error": "Auto-sync failed. See server logs for details."}, 500)

    # ── Refine sync points to ~5ms accuracy ──────────────────────────
    @app.post("/api/plugins/editor/refine-sync")
    async def refine_sync_ep(data: dict):
        """Refine coarse auto-sync points to ~5ms per-bar accuracy.

        Takes the sync data returned by autosync-gp, runs a phase sweep
        on every sync point at the requested bars_per_point interval.
        Returns updated audio_offset and refined sync_points.
        """
        audio_url = (data or {}).get("audio_url", "")
        sync_points_raw = (data or {}).get("sync_points", [])
        try:
            audio_offset = float((data or {}).get("audio_offset", 0.0))
        except (TypeError, ValueError):
            return JSONResponse({"error": "audio_offset must be a number"}, 400)
        if not math.isfinite(audio_offset):
            return JSONResponse({"error": "audio_offset must be finite"}, 400)
        try:
            bars_per_point = max(1, min(int((data or {}).get("bars_per_point", 8)), 64))
        except (TypeError, ValueError):
            return JSONResponse({"error": "bars_per_point must be an integer (1–64)"}, 400)

        if not isinstance(audio_url, str) or not audio_url.strip():
            return JSONResponse({"error": "audio_url required"}, 400)

        audio_path = _resolve_storage_url(audio_url)
        if not audio_path or not audio_path.exists():
            return JSONResponse({"error": "Audio file not found"}, 400)

        try:
            from lib.gp_autosync import refine_sync, is_available
            from lib.gp8_audio_sync import GpSyncData, SyncPoint
        except ImportError:
            return JSONResponse(
                {"error": "refine_sync requires librosa (pip install librosa)"}, 503)

        if not is_available():
            return JSONResponse({"error": "librosa not available"}, 503)

        _points, _perr = _parse_sync_points_payload(sync_points_raw)
        if _perr:
            return JSONResponse({"error": _perr}, 400)

        # Optional GP file: refine_sync uses it for exact per-bar score
        # times (odd meters, mid-song tempo changes); without it the server
        # falls back to a 4/4 model built from the points' authored tempos.
        # A gp_path that was SENT but fails validation is a hard 400 (same
        # contract as convert-gp) — silently refining on the 4/4 model would
        # return 200 with degraded points and no client-visible signal.
        _gp_path = None
        _gp_raw = (data or {}).get("gp_path", "")
        if _gp_raw:
            _gp_validated = _validate_editor_upload_path(_gp_raw, "slopsmith_gp_")
            if not _gp_validated:
                return JSONResponse({"error": "GP file not found"}, 400)
            _gp_path = str(_gp_validated)

        sync = GpSyncData(
            audio_offset=audio_offset,
            audio_asset_id='',
            sync_points=[
                SyncPoint(
                    bar=sp["bar"],
                    time_secs=sp["time_secs"],
                    modified_tempo=sp["modified_bpm"],
                    original_tempo=sp["original_bpm"],
                )
                for sp in _points
            ],
        )

        def _run():
            return refine_sync(sync, str(audio_path),
                               bars_per_point=bars_per_point,
                               gp_path=_gp_path)

        try:
            refined = await asyncio.get_running_loop().run_in_executor(None, _run)
            return {
                "ok": True,
                "audio_offset": refined.audio_offset,
                "sync_point_count": len(refined.sync_points),
                "sync_points": [
                    {
                        "bar": sp.bar,
                        "time_secs": round(sp.time_secs, 3),
                        "modified_bpm": round(sp.modified_tempo, 2),
                        "original_bpm": round(sp.original_tempo, 2),
                    }
                    for sp in refined.sync_points
                ],
            }
        except Exception:
            import logging as _elog
            _elog.getLogger("slopsmith.plugin.editor").exception("refine-sync failed")
            return JSONResponse({"error": "Refine failed. See server logs for details."}, 500)

    # ── MIDI import: list tracks ─────────────────────────────────────

    @app.post("/api/plugins/editor/import-midi")
    async def import_midi(file: UploadFile = File(...)):
        """Upload a MIDI file and return track listing."""
        from lib.midi_import import list_midi_tracks

        # Validate extension — the browser accept filter is advisory only.
        orig_suffix = Path(file.filename or "").suffix.lower()
        if orig_suffix not in (".mid", ".midi"):
            return JSONResponse(
                {"error": "Only .mid/.midi files are accepted"}, 400
            )

        # Opportunistic TTL cleanup: remove any slopsmith_midi_* sandbox dirs
        # older than 30 minutes so unclaimed uploads (cancelled modals, etc.)
        # don't accumulate indefinitely on the server.
        _ttl_secs = 30 * 60
        tmp_root = Path(tempfile.gettempdir())
        for _stale in tmp_root.glob("slopsmith_midi_*"):
            try:
                if _stale.is_dir():
                    age = time.time() - _stale.stat().st_mtime
                    if age > _ttl_secs:
                        shutil.rmtree(_stale, ignore_errors=True)
            except OSError:
                pass

        suffix = orig_suffix or ".mid"
        tmp = tempfile.mkdtemp(prefix="slopsmith_midi_")
        midi_path = os.path.join(tmp, "upload" + suffix)
        content = await file.read()
        Path(midi_path).write_bytes(content)

        def _list():
            return list_midi_tracks(midi_path)

        try:
            tracks = await asyncio.get_event_loop().run_in_executor(None, _list)
        except Exception as e:
            shutil.rmtree(tmp, ignore_errors=True)
            return JSONResponse({"error": f"Failed to parse MIDI file: {e}"}, 500)

        return {"midi_path": midi_path, "tracks": tracks}

    # ── MIDI import: convert a track to a Keys arrangement ────────────

    @app.post("/api/plugins/editor/import-keys-midi")
    async def import_keys_midi(data: dict):
        """Convert a MIDI track into a Keys arrangement (editor-ready dict)."""
        from lib.midi_import import convert_midi_track_to_keys_wire

        midi_path_raw = data.get("midi_path", "")
        track_index = data.get("track_index")
        try:
            audio_offset = float(data.get("audio_offset", 0.0))
        except (TypeError, ValueError):
            return JSONResponse({"error": "audio_offset must be a number"}, 400)
        # Optional: when the picker entry came from a format-0 channel
        # split, this isolates the chosen channel out of the merged track.
        channel_filter_raw = data.get("channel_filter")
        channel_filter: int | None
        if channel_filter_raw is None or channel_filter_raw == "":
            channel_filter = None
        else:
            try:
                channel_filter = int(channel_filter_raw)
            except (TypeError, ValueError):
                channel_filter = None

        validated = _validate_editor_upload_path(midi_path_raw, "slopsmith_midi_")
        if not validated:
            return JSONResponse({"error": "MIDI file not found"}, 400)
        midi_path = str(validated)
        if track_index is None:
            return JSONResponse({"error": "track_index required"}, 400)
        try:
            track_index = int(track_index)
        except (TypeError, ValueError):
            return JSONResponse({"error": "track_index must be an integer"}, 400)

        def _convert():
            wire = convert_midi_track_to_keys_wire(
                midi_path, track_index, audio_offset, "Keys",
                channel_filter=channel_filter,
            )
            # Convert wire → editor's long-named shape so the frontend can
            # consume it identically to import-keys output.
            arr_data = {
                "name": wire["name"],
                "tuning": wire["tuning"],
                "capo": wire["capo"],
                "notes": [],
                "chords": [],
                "chord_templates": [],
            }
            for n in wire["notes"]:
                arr_data["notes"].append({
                    "time": n["t"],
                    "string": n["s"],
                    "fret": n["f"],
                    "sustain": n["sus"],
                    "techniques": {
                        "bend": n.get("bn", 0),
                        "slide_to": n.get("sl", -1),
                        "slide_unpitch_to": n.get("slu", -1),
                        "hammer_on": n.get("ho", False),
                        "pull_off": n.get("po", False),
                        "harmonic": n.get("hm", False),
                        "harmonic_pinch": n.get("hp", False),
                        "palm_mute": n.get("pm", False),
                        "mute": n.get("mt", False),
                        "tremolo": n.get("tr", False),
                        "accent": n.get("ac", False),
                        "tap": n.get("tp", False),
                        "link_next": False,
                    },
                })
            return arr_data

        try:
            arr_data = await asyncio.get_event_loop().run_in_executor(None, _convert)
        except Exception as e:
            import traceback
            traceback.print_exc()
            return JSONResponse({"error": str(e)}, 500)

        # Clean up the MIDI temp dir now that conversion is complete — the
        # client no longer needs to reference midi_path after this response.
        try:
            shutil.rmtree(Path(midi_path).parent)
        except OSError as _cleanup_err:
            import warnings
            warnings.warn(f"Could not clean up MIDI temp dir: {_cleanup_err}")

        return {"arrangement": arr_data}

    # ── Convert GP tracks to arrangement and open in editor ──────────

    @app.post("/api/plugins/editor/convert-gp")
    async def convert_gp(data: dict):
        """Convert selected GP tracks to arrangements."""
        from lib.gp2rs import convert_file, auto_select_tracks
        from lib.song import parse_arrangement, Song, Beat, Section

        gp_path = data.get("gp_path", "")
        audio_url = data.get("audio_url", "")
        audio_path = data.get("audio_path", "")  # local path in container
        # Auto-sync may provide a pre-computed offset; use it if present. Reject
        # a malformed/non-finite explicit value rather than silently using 0.0
        # (which would import with the wrong alignment and no feedback).
        _raw_offset = data.get("audio_offset")
        if _raw_offset is None:
            _provided_offset = 0.0
        else:
            try:
                _provided_offset = float(_raw_offset)
            except (TypeError, ValueError):
                return JSONResponse({"error": "audio_offset must be a number"}, 400)
            if not math.isfinite(_provided_offset):
                return JSONResponse({"error": "audio_offset must be finite"}, 400)
            # The client round-trips auto_sync's GpSyncData value, which uses
            # the GP sign convention: NEGATIVE when the audio has a lead-in
            # before bar 1. convert_file ADDS its offset to note times, so a
            # lead-in must be applied as a POSITIVE shift — same negation the
            # embedded-audio path below applies to the GP8 FramePadding
            # offset, and for the same reason (applied as-is, a 5s intro
            # shifted the chart 5s the wrong way).
            _provided_offset = -_provided_offset
        # Per-bar sync points (auto-sync flow). When present and usable, the
        # converted chart is warped onto the recording's timeline bar by bar
        # instead of only shifted by the scalar audio_offset — the offset
        # stays as the fallback when the warp can't be applied.
        _sync_points_payload = data.get("sync_points") or []
        _warp_points = None
        if _sync_points_payload:
            _warp_points, _sync_err = _parse_sync_points_payload(_sync_points_payload)
            if _sync_err:
                return JSONResponse({"error": _sync_err}, 400)
        track_indices = data.get("track_indices")  # None = auto-select
        arrangement_names = data.get("arrangement_names")  # {idx: name}
        title = data.get("title", "")
        artist = data.get("artist", "")
        album = data.get("album", "")
        year = data.get("year", "")

        validated_gp = _validate_editor_upload_path(gp_path, "slopsmith_gp_")
        if not validated_gp:
            return JSONResponse({"error": "GP file not found"}, 400)
        gp_path = str(validated_gp)

        # Embedded mode needs the optional gp8_audio_sync module — degrade
        # gracefully with a 503 up front (matching the PR's stated behaviour)
        # rather than failing deep inside the conversion worker.
        if data.get("audio_mode") == "embedded":
            try:
                import lib.gp8_audio_sync  # noqa: F401
            except ImportError:
                return JSONResponse(
                    {"error": "GP8 embedded audio support is unavailable on this server "
                              "(gp8_audio_sync / librosa not installed)."}, 503)

        # Whether the client explicitly sent an offset — if so, never override it
        # with the GP8-derived one below.
        _client_sent_offset = "audio_offset" in (data or {})

        def _convert():
            nonlocal audio_url, _provided_offset  # assigned below
            tmp = tempfile.mkdtemp(prefix="slopsmith_editor_create_")

            # For GP8 embedded audio: extract the OGG and use it as the audio source
            _audio_mode = data.get("audio_mode", "")
            if _audio_mode == "embedded":
                # Embedded mode uses ONLY the extracted GP8 track — ignore any
                # client-supplied audio_url so a stale/extraneous value can't be
                # used on extraction failure and can't defeat the fail-fast
                # check below.
                audio_url = None
                try:
                    from lib.gp8_audio_sync import extract_audio, extract_sync
                    _ogg = extract_audio(gp_path, tmp)
                    if _ogg:
                        _title = data.get("title") or Path(gp_path).stem
                        _audio_id = re.sub(r"[^a-zA-Z0-9_-]", "_", _title)[:60]
                        if not _audio_id:
                            # Title sanitised to empty — fall back to the GP stem.
                            _audio_id = re.sub(r"[^a-zA-Z0-9_-]", "_", Path(gp_path).stem)[:60] or "gp_import"
                        # Add the per-conversion temp dir's unique suffix so
                        # concurrent imports / same-title songs don't overwrite
                        # each other's editor_audio_*.ogg in STORAGE_DIR.
                        _uniq = Path(tmp).name.replace("slopsmith_editor_create_", "")
                        _audio_id = f"{_audio_id}_{_uniq}"
                        _dest = STORAGE_DIR / f"editor_audio_{_audio_id}.ogg"
                        shutil.copy2(_ogg, _dest)
                        audio_url = f"{STORAGE_URL}/editor_audio_{_audio_id}.ogg"
                        # Apply the embedded sync offset (GP8 FramePadding) so the
                        # chart lines up with the backing track — unless the client
                        # explicitly supplied its own offset.
                        if not _client_sent_offset:
                            try:
                                _sync = extract_sync(gp_path)
                                if _sync is not None:
                                    # A negative FramePadding means the audio
                                    # has a lead-in before bar 1, so bar 1 sits
                                    # LATER in the recording — the chart notes
                                    # must shift forward by that amount. The raw
                                    # `audio_offset` carries the GP sign
                                    # (negative), which applied as-is shifted
                                    # notes the wrong way (a whole-song shift the
                                    # user had to undo with a ~+0.26s offset).
                                    # Negate so the lead-in pushes notes forward.
                                    _cand = -float(_sync.audio_offset)
                                    # Guard against a corrupt GP yielding NaN/Inf
                                    # propagating into convert_file(); keep the
                                    # default offset if not finite.
                                    if math.isfinite(_cand):
                                        _provided_offset = _cand
                            except Exception as _sexc:
                                import logging as _elog
                                _elog.getLogger("slopsmith.plugin.editor").debug(
                                    "embedded sync offset extraction failed for %s: %s", gp_path, _sexc
                                )  # keep the default offset on any failure
                except Exception as _exc:
                    import logging as _elog
                    _elog.getLogger("slopsmith.plugin.editor").debug(
                        "embedded audio extraction failed for %s: %s", gp_path, _exc
                    )
                    # fall through with audio_url still None (reset above) — the
                    # fail-fast check below then raises, since embedded mode must
                    # not silently fall back to any other audio source.

            # Fail fast if embedded mode was requested but no audio was produced
            if _audio_mode == "embedded" and not audio_url:
                raise RuntimeError(
                    f"GP8 embedded audio extraction produced no output for {gp_path!r}. "
                    "The file may not contain an embedded backing track, or extraction failed."
                )

            # Auto-select tracks if none specified
            names_map = None
            if track_indices is None:
                indices, names_map = auto_select_tracks(gp_path)
            else:
                indices = track_indices
                if arrangement_names:
                    names_map = {int(k): v for k, v in arrangement_names.items()}

            # Decide up front whether the per-bar warp applies: in warp mode
            # the conversion runs at offset 0 and the anchors (which encode
            # bar 1's audio time) place the whole chart; in offset mode the
            # scalar offset is baked in during conversion as before.
            _warp_anchors = None
            _warp_skip = None  # why the warp was skipped, for the response
            if (_warp_points and len(_warp_points) >= 2
                    and _audio_mode != "embedded"):
                try:
                    from lib.gp_autosync import (
                        bar_start_times, build_warp_anchors,
                        gp_has_expandable_repeats,
                    )
                    from lib.gp8_audio_sync import SyncPoint as _WarpSP
                    if gp_has_expandable_repeats(gp_path):
                        # GP3/4/5 repeat expansion produces an as-performed
                        # timeline the as-written sync points can't map onto.
                        _warp_skip = "repeats"
                        import logging as _elog
                        _elog.getLogger("slopsmith.plugin.editor").info(
                            "convert-gp: %s uses repeats/directions — "
                            "per-bar sync unavailable, applying offset only",
                            gp_path,
                        )
                    else:
                        _anchors = build_warp_anchors(
                            [_WarpSP(bar=p["bar"], time_secs=p["time_secs"],
                                     modified_tempo=p["modified_bpm"],
                                     original_tempo=p["original_bpm"])
                             for p in _warp_points],
                            bar_start_times(gp_path),
                        )
                        if len(_anchors) >= 2:
                            _warp_anchors = _anchors
                        else:
                            _warp_skip = "degenerate"
                except ImportError:
                    # Expected on older cores that predate the warp helpers —
                    # a compatibility case, not an error: fall back quietly.
                    _warp_skip = "unavailable"
                    import logging as _elog
                    _elog.getLogger("slopsmith.plugin.editor").info(
                        "convert-gp: core lacks lib.gp_autosync warp helpers "
                        "— applying offset-only sync"
                    )
                except Exception:
                    _warp_skip = "error"
                    import logging as _elog
                    _elog.getLogger("slopsmith.plugin.editor").exception(
                        "convert-gp: warp setup failed — falling back to "
                        "offset-only sync"
                    )

            # Convert GP to XMLs
            xml_paths = convert_file(
                gp_path, tmp,
                track_indices=indices,
                audio_offset=0.0 if _warp_anchors else _provided_offset,
                arrangement_names=names_map,
            )

            # Parse the generated XMLs into a Song object
            song = Song()
            song.title = title
            song.artist = artist
            song.album = album
            if year:
                try:
                    song.year = int(year)
                except ValueError:
                    pass

            for xml_path in xml_paths:
                arr = parse_arrangement(xml_path)
                song.arrangements.append(arr)

            # Get beats and sections from first XML
            if xml_paths:
                import xml.etree.ElementTree as XET
                tree = XET.parse(xml_paths[0])
                root = tree.getroot()

                el = root.find("songLength")
                if el is not None and el.text:
                    song.song_length = float(el.text)

                container = root.find("ebeats")
                if container is not None:
                    for eb in container.findall("ebeat"):
                        t = float(eb.get("time", "0"))
                        m = int(eb.get("measure", "-1"))
                        song.beats.append(Beat(time=t, measure=m))

                container = root.find("sections")
                if container is not None:
                    for s in container.findall("section"):
                        song.sections.append(Section(
                            name=s.get("name", ""),
                            number=int(s.get("number", "1")),
                            start_time=float(s.get("startTime", "0")),
                        ))

            # Apply the per-bar warp: retime every note/beat/section from the
            # tab's authored timeline onto the recording's (Songsterr-style
            # piecewise mapping — the recording's tempo drift is followed
            # instead of accumulating).
            if _warp_anchors:
                from lib.gp_autosync import warp_song_times, warp_time
                warp_song_times(song, lambda t: warp_time(t, _warp_anchors))
                # The GP notation sidecars (keys tracks) were written by
                # convert_file on the unwarped timeline — retime them on
                # disk so _attach_gp_notation and the sloppak assembly read
                # times consistent with the warped notes.
                for _xp in xml_paths:
                    _warp_notation_sidecar(
                        _xp, lambda t: warp_time(t, _warp_anchors))

            # If we have a local audio file path, copy to static
            if audio_path and Path(audio_path).exists():
                audio_id = re.sub(r"[^a-zA-Z0-9_-]", "_", title or "gp_import")[:60]
                ext = Path(audio_path).suffix
                dest = STORAGE_DIR / f"editor_audio_{audio_id}{ext}"
                shutil.copy2(audio_path, dest)
                audio_url = f"{STORAGE_URL}/editor_audio_{audio_id}{ext}"

            result = _song_to_dict(song, audio_url)
            # Derived at the read site so the flag can never drift from what
            # actually happened: anchors set => the warp above ran.
            if _warp_points:
                result["sync_applied"] = "warp" if _warp_anchors else "offset"
                if not _warp_anchors:
                    # 'repeats' | 'degenerate' | 'error' | 'unavailable' —
                    # lets the client explain the fallback truthfully
                    # instead of guessing at a cause.
                    result["sync_reason"] = _warp_skip or "unavailable"
            return result, tmp, xml_paths

        try:
            result, session_dir, xml_files = (
                await asyncio.get_event_loop().run_in_executor(None, _convert)
            )
        except Exception as e:
            import traceback
            traceback.print_exc()
            return JSONResponse({"error": str(e)}, 500)

        session_id = f"create_{re.sub(r'[^a-z0-9]', '', (title or 'new').lower())[:30]}"
        if session_id in sessions:
            old = sessions[session_id]
            shutil.rmtree(old["dir"], ignore_errors=True)

        sessions[session_id] = {
            "dir": session_dir,
            "audio_file": None,
            "filename": "",
            "xml_files": xml_files,
            "create_mode": True,
            "gp_path": gp_path,
            "metadata": {
                "title": title, "artist": artist,
                "album": album, "year": year,
                # Spec-complete metadata typed in the create modal is merged into
                # the session so /build persists it too (not just blank projects).
                **_extended_manifest_meta(data),
            },
            "last_touched": time.time(),
        }
        result["session_id"] = session_id
        result["create_mode"] = True

        # Drum tracks: the converter emits them as RS-note "Drums"
        # arrangements (the drum branch packs the GM percussion MIDI as
        # string = midi // 24, fret = midi % 24). The editor's drum editor
        # reads a `drum_tab`, not an arrangement, so pull any drum
        # arrangement out, rebuild it as a drum_tab, and drop the same
        # entries from BOTH result["arrangements"] and the session's
        # xml_files so the two stay index-aligned for a later /build.
        def _drum_arrs_to_drum_tab(drum_arrs):
            from lib import drums as _drums
            hits, kit_seen = [], {}
            for arr in drum_arrs:
                for n in arr.get("notes", []):
                    try:
                        midi = int(n["string"]) * 24 + int(n["fret"])
                    except (KeyError, TypeError, ValueError):
                        continue
                    piece = _drums.midi_to_piece(midi)
                    if piece is None:
                        continue
                    hits.append({"t": round(float(n.get("time", 0) or 0), 3), "p": piece})
                    if piece not in kit_seen:
                        kit_seen[piece] = piece.replace("_", " ").title()
                # Simultaneous hits land in chords — fold those in too.
                for ch in arr.get("chords", []):
                    for cn in ch.get("notes", []):
                        try:
                            midi = int(cn["string"]) * 24 + int(cn["fret"])
                        except (KeyError, TypeError, ValueError):
                            continue
                        piece = _drums.midi_to_piece(midi)
                        if piece is None:
                            continue
                        hits.append({"t": round(float(cn.get("time", 0) or 0), 3), "p": piece})
                        if piece not in kit_seen:
                            kit_seen[piece] = piece.replace("_", " ").title()
            hits.sort(key=lambda h: h["t"])
            return {
                "version": getattr(_drums, "SCHEMA_VERSION", 1),
                "name": "Drums",
                "kit": [{"id": pid, "name": name} for pid, name in kit_seen.items()],
                "hits": hits,
            }

        # Inject GP-sourced notation sidecars into keys arrangements so the
        # build step uses accurate GP voice/stave data instead of notation_lift.
        for _arr, _xp in zip(result.get("arrangements", []), xml_files):
            if not _KEYS_NAME_RE.search(_arr.get("name", "")):
                continue
            _attach_gp_notation(_arr, _xp)

        _arrs = result.get("arrangements", [])
        _drum_idx = {
            i for i, a in enumerate(_arrs)
            if (a.get("name") or "").lower().startswith("drum")
        }
        if _drum_idx:
            _tab = _drum_arrs_to_drum_tab([_arrs[i] for i in sorted(_drum_idx)])
            if _tab["hits"]:
                result["drum_tab"] = _tab
            result["arrangements"] = [
                a for i, a in enumerate(_arrs) if i not in _drum_idx
            ]
            _xf = sessions[session_id]["xml_files"]
            sessions[session_id]["xml_files"] = [
                xf for i, xf in enumerate(_xf) if i not in _drum_idx
            ]
        return result

    # ── Import an EOF (Editor on Fire) project (arrangement XML) ───────────
    @app.post("/api/plugins/editor/import-xml-project")
    async def import_xml_project(
        files: list[UploadFile] = File(...),
        audio_url: str = Form(""),
        title: str = Form(""),
        artist: str = Form(""),
        album: str = Form(""),
        year: str = Form(""),
        extended_meta: str = Form(""),
    ):
        """Import EOF (Editor on Fire) arrangement XML into a create session.

        Takes the EOF-exported arrangement XML file(s) (``<song>`` roots) and
        loads them with the same loader the app uses for loose folders, yielding
        a create-mode session the editor opens — so the user can expand drums and
        keys in sync, then Build a .sloppak.

        Audio is supplied separately (uploaded via the modal's Audio input first,
        then its ``audio_url`` passed here) and album art / preview clip are baked
        at Build time from their own inputs — so this endpoint only deals with the
        charts + metadata. Open authoring format only.
        """
        from lib.song import load_song as _load_arrangement_dir

        # Spec-complete metadata arrives as one JSON form field so we don't need
        # eight more Form() params; a malformed blob is tolerated (just ignored).
        try:
            _ext_meta = json.loads(extended_meta) if extended_meta.strip() else {}
        except (ValueError, TypeError):
            _ext_meta = {}

        tmp = tempfile.mkdtemp(prefix="slopsmith_xmlproj_")
        try:
            xml_count = 0
            for idx, uf in enumerate(files):
                raw = uf.filename or ""
                if Path(raw).suffix.lower() != ".xml":
                    continue  # only arrangement XML; audio/art/preview come elsewhere
                # `filename` is attacker-controlled — collapse to a safe basename
                # inside tmp (no `..`, no separators) before writing.
                safe = re.sub(r"[^A-Za-z0-9._-]", "_", Path(raw).name) or f"arr_{idx}.xml"
                (Path(tmp) / safe).write_bytes(await uf.read())
                xml_count += 1

            if xml_count == 0:
                shutil.rmtree(tmp, ignore_errors=True)
                return JSONResponse(
                    {"error": "No arrangement XML (.xml) files were selected."}, 400)

            def _load():
                return _load_arrangement_dir(tmp)

            song = await asyncio.get_event_loop().run_in_executor(None, _load)
            if not song.arrangements:
                shutil.rmtree(tmp, ignore_errors=True)
                return JSONResponse(
                    {"error": "No playable arrangements found — only vocals/showlights, "
                              "or this isn't a recognised EOF arrangement XML."}, 400)

            # User-entered metadata (from the modal fields) overrides what the XML
            # carried; fall back to the XML values when a field was left blank.
            if title.strip():
                song.title = title.strip()
            if artist.strip():
                song.artist = artist.strip()
            if album.strip():
                song.album = album.strip()
            if year.strip():
                ym = re.search(r"\d{4}", year)
                if ym:
                    song.year = int(ym.group())

            # Resolve the chart's start point into the times so they become
            # audio-absolute (the editor plays on raw audio time and the built
            # file carries no offset field). Exporters split the start between
            # two header fields and use opposite conventions:
            #   * a negative <offset> equal to -<startBeat>, with note times
            #     already audio-absolute  → the two cancel, net shift 0
            #   * a positive <offset> with <startBeat> 0                → shift = offset
            # Summing them, shift = offset + startBeat, is correct for both
            # without inspecting which kind of file it is.
            start_beat = 0.0
            for _xf in sorted(Path(tmp).glob("*.xml")):
                try:
                    _root = ET.parse(_xf).getroot()
                except Exception:
                    continue
                if _root.tag != "song":
                    continue
                _arr = _root.find("arrangement")
                if _arr is None or not _arr.text or _arr.text.strip().lower() in (
                        "vocals", "showlights", "jvocals"):
                    continue
                _sb = _root.find("startBeat")
                if _sb is not None and _sb.text:
                    try:
                        start_beat = float(_sb.text)
                    except ValueError:
                        start_beat = 0.0
                break
            shift = song.offset + start_beat
            if shift:
                _apply_chart_offset(song, shift)

            # Audio was uploaded separately; keep its URL for editor playback and
            # resolve it to a path for the build step (best-effort).
            audio_url = (audio_url or "").strip() or None
            audio_file = None
            if audio_url:
                resolved = _resolve_storage_url(audio_url)
                if resolved and resolved.exists():
                    audio_file = str(resolved)

            result = _song_to_dict(song, audio_url)

            session_id = f"create_{re.sub(r'[^a-z0-9]', '', (song.title or 'new').lower())[:30]}"
            if session_id in sessions:
                shutil.rmtree(sessions[session_id]["dir"], ignore_errors=True)
            sessions[session_id] = {
                "dir": tmp,
                "audio_file": audio_file,
                "filename": "",
                "xml_files": [str(p) for p in sorted(Path(tmp).glob("*.xml"))],
                "create_mode": True,
                "gp_path": None,
                "metadata": {
                    "title": song.title, "artist": song.artist,
                    "album": song.album, "year": song.year,
                    # Spec-complete metadata from the create modal (a JSON blob
                    # form field) is merged so /build persists it, matching the
                    # blank-create and GP-import paths.
                    **_extended_manifest_meta(_ext_meta),
                },
                "last_touched": time.time(),
            }
            result["session_id"] = session_id
            result["create_mode"] = True
            return result
        except Exception as e:
            shutil.rmtree(tmp, ignore_errors=True)
            import traceback
            traceback.print_exc()
            return JSONResponse({"error": f"XML project import failed: {e}"}, 500)

    # ── Import piano/keyboard tracks from a GP file ────────────────────

    @app.post("/api/plugins/editor/import-keys")
    async def import_keys_track(data: dict):
        """Import a piano/keyboard track from a GP file and return as an arrangement."""
        from lib.gp2rs import convert_file, convert_piano_track
        from lib.song import parse_arrangement, Song, Beat, Section
        import guitarpro

        gp_path_raw = data.get("gp_path", "")
        # Accept a list of track indices (preferred — passing an RH/LH piano pair
        # together lets convert_file's _find_piano_pairs merge them into one
        # full-keyboard arrangement) or a single `track_index` (back-compat).
        raw_indices = data.get("track_indices")
        if raw_indices is None:
            single = data.get("track_index")
            raw_indices = [single] if single is not None else []
        try:
            audio_offset = float(data.get("audio_offset", 0.0))
        except (TypeError, ValueError):
            return JSONResponse({"error": "audio_offset must be a number"}, 400)

        validated = _validate_editor_upload_path(gp_path_raw, "slopsmith_gp_")
        if not validated:
            return JSONResponse({"error": "GP file not found"}, 400)
        gp_path = str(validated)
        if not raw_indices:
            return JSONResponse({"error": "track_index(es) required"}, 400)
        try:
            track_indices = [int(i) for i in raw_indices]
        except (TypeError, ValueError):
            return JSONResponse({"error": "track indices must be integers"}, 400)
        # De-dupe while preserving order.
        _seen_idx: set = set()
        track_indices = [i for i in track_indices
                         if not (i in _seen_idx or _seen_idx.add(i))]

        # `_arr_to_data` is now a module-level helper (shared with the
        # guitar/bass import) — see the top of this file.

        def _convert():
            tmp = tempfile.mkdtemp(prefix="slopsmith_keys_")
            # GP8 (.gp, ZIP) / GP6 (.gpx, BCFZ) go through convert_file's gpx
            # converter: passing ALL chosen indices in one call lets
            # gp2rs_gpx._find_piano_pairs merge an RH/LH pair into one
            # full-keyboard arrangement (unrelated keys tracks stay separate),
            # and the "Keys" name selects the piano converter. GP3/4/5 binary is
            # read directly by PyGuitarPro, one track at a time — the piano-pair
            # merge is gpx-only, so an RH/LH pair in a GP3/4/5 file still imports
            # as two arrangements (a separate, pre-existing limitation; the common
            # GP6/GP8 case is the one this fixes).
            if Path(gp_path).suffix.lower() in (".gp", ".gpx"):
                xml_paths = convert_file(
                    gp_path, tmp, track_indices=track_indices,
                    audio_offset=audio_offset,
                    arrangement_names={i: "Keys" for i in track_indices},
                )
            else:
                song = guitarpro.parse(gp_path)
                xml_paths = []
                for idx in track_indices:
                    xml_str = convert_piano_track(song, idx, audio_offset, "Keys")
                    xp = os.path.join(tmp, f"Keys_{idx}.xml")
                    Path(xp).write_text(xml_str, encoding="utf-8")
                    xml_paths.append(xp)
            if not xml_paths:
                raise RuntimeError("Keys track(s) produced no arrangement")

            arrangements = []
            for _n, xml_path in enumerate(xml_paths):
                # Disambiguate names when >1 arrangement results (e.g. two
                # unrelated keys tracks): Keys, Keys 2, Keys 3, …
                name = "Keys" if _n == 0 else f"Keys {_n + 1}"
                arrangements.append(
                    _arr_to_data(parse_arrangement(xml_path), name))
            return arrangements, tmp, xml_paths

        try:
            arrangements, tmp_dir, xml_paths = (
                await asyncio.get_event_loop().run_in_executor(None, _convert)
            )
        except Exception as e:
            import traceback
            traceback.print_exc()
            return JSONResponse({"error": str(e)}, 500)

        # Embed GP-sourced notation payloads so the save path can write them
        # directly instead of re-deriving via notation_lift (which has no
        # knowledge of GP stave assignments and produces wrong hand splits).
        # gp2notation writes "{xml_stem}.notation.json" next to each XML;
        # arrangement ids don't exist yet at this point, so match by XML stem.
        # No glob fallback: a missing sidecar for one track must never be
        # back-filled from the *first* sidecar in the dir (that persists another
        # track's notation as this arrangement's) — better to fall back to the
        # lift than to ship the wrong part's notes.
        for arr, xml_path in zip(arrangements, xml_paths):
            _attach_gp_notation(arr, xml_path)

        # Multi-track shape; keep singular `arrangement`/`xml_path` for any
        # caller still on the old single-track contract.
        return {
            "arrangements": arrangements,
            "xml_paths": xml_paths,
            "arrangement": arrangements[0],
            "xml_path": xml_paths[0],
            "tmp_dir": tmp_dir,
        }

    # ── Import a guitar/bass track from a GP file into the session ───

    @app.post("/api/plugins/editor/import-guitar-track")
    async def import_guitar_track(data: dict):
        """Import a single GUITAR/BASS track from a GP file as an arrangement.

        Mirrors `import_keys_track` but for string instruments: no piano
        forcing, single track, and the caller supplies the arrangement `name`
        (a bass name MUST match /bass/i so the editor lays out 4 lanes). Notes
        are aligned to the session's existing audio via `audio_offset`; the
        song-level beats/sections/audio are untouched. Returns the arrangement
        dict for the frontend to either append (Add) or swap in (Replace).
        """
        from lib.gp2rs import convert_file, list_tracks
        from lib.song import parse_arrangement

        gp_path_raw = data.get("gp_path", "")
        track_index = data.get("track_index")
        name = str(data.get("name", "") or "").strip()

        # Reject a malformed/non-finite offset rather than silently aligning to
        # 0.0 (mirrors convert_gp) — a wrong offset imports mis-timed notes.
        _raw_offset = data.get("audio_offset")
        if _raw_offset is None:
            audio_offset = 0.0
        else:
            try:
                audio_offset = float(_raw_offset)
            except (TypeError, ValueError):
                return JSONResponse({"error": "audio_offset must be a number"}, 400)
            if not math.isfinite(audio_offset):
                return JSONResponse({"error": "audio_offset must be finite"}, 400)

        validated = _validate_editor_upload_path(gp_path_raw, "slopsmith_gp_")
        if not validated:
            return JSONResponse({"error": "GP file not found"}, 400)
        gp_path = str(validated)
        if track_index is None:
            return JSONResponse({"error": "track_index required"}, 400)
        try:
            track_index = int(track_index)
        except (TypeError, ValueError):
            return JSONResponse({"error": "track_index must be an integer"}, 400)
        if not name:
            return JSONResponse({"error": "name required"}, 400)

        def _convert():
            # Guard: this endpoint only produces string-instrument charts, so
            # reject piano/drums/percussion/vocal tracks (the frontend already
            # filters them out, but a crafted request could still ask for one).
            tracks = list_tracks(gp_path)
            tinfo = next(
                (t for t in tracks if int(t.get("index", -1)) == track_index),
                None,
            )
            if tinfo is None:
                raise ValueError(f"track {track_index} not found")
            if (tinfo.get("is_piano") or tinfo.get("is_drums")
                    or tinfo.get("is_percussion") or tinfo.get("is_vocal")):
                raise ValueError("Only guitar or bass tracks can be imported here")

            tmp = tempfile.mkdtemp(prefix="slopsmith_gtr_")
            xml_paths = convert_file(
                gp_path, tmp, track_indices=[track_index],
                audio_offset=audio_offset,
                arrangement_names={track_index: name},
            )
            if not xml_paths:
                raise RuntimeError("Guitar/bass track produced no arrangement")
            arr_data = _arr_to_data(parse_arrangement(xml_paths[0]), name)
            return arr_data, tmp, xml_paths[0]

        try:
            arrangement, tmp_dir, xml_path = (
                await asyncio.get_event_loop().run_in_executor(None, _convert)
            )
        except ValueError as e:
            return JSONResponse({"error": str(e)}, 400)
        except Exception as e:
            import traceback
            traceback.print_exc()
            return JSONResponse({"error": str(e)}, 500)

        return {
            "arrangement": arrangement,
            "xml_path": xml_path,
            "tmp_dir": tmp_dir,
        }

    # ── Import drum/percussion tracks from a GP file ─────────────────

    @app.post("/api/plugins/editor/import-drums")
    async def import_drums_track(data: dict):
        """Import a drum/percussion track from a GP file and return as an arrangement."""
        from lib.gp2rs import convert_file, convert_drum_track
        from lib.song import parse_arrangement, Song, Beat, Section
        import guitarpro

        gp_path_raw = data.get("gp_path", "")
        track_index = data.get("track_index")
        try:
            audio_offset = float(data.get("audio_offset", 0.0))
        except (TypeError, ValueError):
            return JSONResponse({"error": "audio_offset must be a number"}, 400)

        validated = _validate_editor_upload_path(gp_path_raw, "slopsmith_gp_")
        if not validated:
            return JSONResponse({"error": "GP file not found"}, 400)
        gp_path = str(validated)
        if track_index is None:
            return JSONResponse({"error": "track_index required"}, 400)
        try:
            track_index = int(track_index)
        except (TypeError, ValueError):
            return JSONResponse({"error": "track_index must be an integer"}, 400)

        def _convert():
            tmp = tempfile.mkdtemp(prefix="slopsmith_drums_")
            # GP8 (.gp, ZIP) and GP6 (.gpx, BCFZ) can't be read by PyGuitarPro
            # (GP3/4/5 binary only) — it raises "unsupported version '…'".
            # Route those through convert_file, which dispatches to the gpx
            # converter by extension; forcing the arrangement name to "Drums"
            # makes the GP5 branch pick the drum converter too.
            if Path(gp_path).suffix.lower() in (".gp", ".gpx"):
                xml_paths = convert_file(
                    gp_path, tmp, track_indices=[track_index],
                    audio_offset=audio_offset,
                    arrangement_names={track_index: "Drums"},
                )
                if not xml_paths:
                    raise RuntimeError("Drum track produced no arrangement")
                xml_path = xml_paths[0]
            else:
                song = guitarpro.parse(gp_path)
                xml_str = convert_drum_track(
                    song, track_index, audio_offset, "Drums"
                )
                xml_path = os.path.join(tmp, "Drums.xml")
                Path(xml_path).write_text(xml_str, encoding="utf-8")

            arr = parse_arrangement(xml_path)
            arr_data = {
                "name": "Drums",
                "tuning": arr.tuning,
                "capo": arr.capo,
                "notes": [],
                "chords": [],
                "chord_templates": [],
            }

            for n in arr.notes:
                arr_data["notes"].append({
                    "time": round(n.time, 3),
                    "string": n.string,
                    "fret": n.fret,
                    "sustain": round(n.sustain, 3),
                    "techniques": {
                        "bend": n.bend,
                        "slide_to": n.slide_to,
                        "slide_unpitch_to": n.slide_unpitch_to,
                        "hammer_on": n.hammer_on,
                        "pull_off": n.pull_off,
                        "harmonic": n.harmonic,
                        "harmonic_pinch": n.harmonic_pinch,
                        "palm_mute": n.palm_mute,
                        "mute": n.mute,
                        "tremolo": n.tremolo,
                        "accent": n.accent,
                        "tap": n.tap,
                        "link_next": n.link_next,
                    },
                })

            for ch in arr.chords:
                chord_data = {
                    "time": round(ch.time, 3),
                    "chord_id": ch.chord_id,
                    "high_density": ch.high_density,
                    "notes": [],
                }
                for cn in ch.notes:
                    chord_data["notes"].append({
                        "time": round(cn.time, 3),
                        "string": cn.string,
                        "fret": cn.fret,
                        "sustain": round(cn.sustain, 3),
                        "techniques": {
                            "bend": cn.bend,
                            "slide_to": cn.slide_to,
                            "slide_unpitch_to": cn.slide_unpitch_to,
                            "hammer_on": cn.hammer_on,
                            "pull_off": cn.pull_off,
                            "harmonic": cn.harmonic,
                            "palm_mute": cn.palm_mute,
                            "mute": cn.mute,
                            "tremolo": cn.tremolo,
                            "accent": cn.accent,
                            "tap": cn.tap,
                            "link_next": cn.link_next,
                        },
                    })
                arr_data["chords"].append(chord_data)

            for ct in arr.chord_templates:
                arr_data["chord_templates"].append({
                    "name": ct.name,
                    "displayName": getattr(ct, "display_name", "") or ct.name,
                    "arp": bool(getattr(ct, "arpeggio", False)),
                    "frets": ct.frets,
                    "fingers": ct.fingers,
                })

            return arr_data, tmp, xml_path

        try:
            arr_data, tmp_dir, xml_path = (
                await asyncio.get_event_loop().run_in_executor(None, _convert)
            )
        except Exception as e:
            import traceback
            traceback.print_exc()
            return JSONResponse({"error": str(e)}, 500)

        return {"arrangement": arr_data, "tmp_dir": tmp_dir, "xml_path": xml_path}

    # ── Import drum track → drum_tab.json (GP file) ──────────────────
    #
    # Sibling to `import-drums` above. That endpoint returns a guitar-style
    # arrangement dict (drums MIDI-encoded via string*24+fret) for the legacy
    # drums plugin path. The new endpoint returns the canonical
    # `drum_tab.json` shape documented in `docs/sloppak-spec.md` §5.3, ready
    # to be persisted via /save_song's new `drum_tab:` body field.

    @app.post("/api/plugins/editor/import-drums-tab")
    async def import_drums_tab(data: dict):
        """Import a GP drum track and return it as a drum_tab.json dict."""
        from lib.gp2rs import convert_drum_track_to_drumtab, convert_file
        from lib.song import parse_arrangement
        import guitarpro

        gp_path_raw = data.get("gp_path", "")
        track_index = data.get("track_index")
        try:
            audio_offset = float(data.get("audio_offset", 0.0))
        except (TypeError, ValueError):
            return JSONResponse({"error": "audio_offset must be a number"}, 400)

        validated = _validate_editor_upload_path(gp_path_raw, "slopsmith_gp_")
        if not validated:
            return JSONResponse({"error": "GP file not found"}, 400)
        gp_path = str(validated)
        if track_index is None:
            return JSONResponse({"error": "track_index required"}, 400)
        try:
            track_index = int(track_index)
        except (TypeError, ValueError):
            return JSONResponse({"error": "track_index must be an integer"}, 400)

        arr_name = str(data.get("arrangement_name") or "Drums") or "Drums"

        # Capture MIDI notes the converter couldn't map so the client can
        # surface a warning + manual-mapping UI rather than silently
        # dropping percussion that's outside the 18-piece vocab.
        unmapped: dict[int, dict] = {}

        # Cached compat probe — see _supports_unmapped at setup scope.
        supports = _supports_unmapped(convert_drum_track_to_drumtab)

        def _gp8_drum_tab():
            # GP8 (.gp, ZIP) / GP6 (.gpx, BCFZ) can't be read by PyGuitarPro
            # (GP3/4/5 binary only) — convert_drum_track_to_drumtab would
            # raise "unsupported version '…'". Route through convert_file,
            # which dispatches to the gpx converter by extension, then fold
            # the resulting "Drums" arrangement into a drum_tab the same way
            # the create flow's _drum_arrs_to_drum_tab does (midi = string*24
            # + fret → GM piece), capturing unmapped hits for the manual-map UI.
            from lib import drums as _drums
            tmp = tempfile.mkdtemp(prefix="slopsmith_drumtab_")
            xml_paths = convert_file(
                gp_path, tmp, track_indices=[track_index],
                audio_offset=audio_offset,
                arrangement_names={track_index: arr_name},
            )
            if not xml_paths:
                raise RuntimeError("Drum track produced no arrangement")
            arr = parse_arrangement(xml_paths[0])
            hits, kit_seen = [], {}

            def _fold(notes):
                for n in notes:
                    try:
                        midi = int(n.string) * 24 + int(n.fret)
                    except (TypeError, ValueError):
                        continue
                    t = round(float(n.time or 0), 3)
                    piece = _drums.midi_to_piece(midi)
                    if piece is None:
                        rec = unmapped.setdefault(midi, {"count": 0, "times": []})
                        rec["count"] += 1
                        if len(rec["times"]) < 64:
                            rec["times"].append(t)
                        continue
                    hits.append({"t": t, "p": piece})
                    kit_seen.setdefault(piece, piece.replace("_", " ").title())

            _fold(arr.notes)
            for ch in arr.chords:
                _fold(ch.notes)
            # The per-track XML was only needed to fold into the drum_tab —
            # drop the scratch dir now (the GP upload dir itself is cleaned by
            # the caller on success, mirroring the GP5 path).
            shutil.rmtree(tmp, ignore_errors=True)
            hits.sort(key=lambda h: h["t"])
            return {
                "version": getattr(_drums, "SCHEMA_VERSION", 1),
                "name": arr_name,
                "kit": [{"id": pid, "name": name} for pid, name in kit_seen.items()],
                "hits": hits,
            }

        def _convert():
            if Path(gp_path).suffix.lower() in (".gp", ".gpx"):
                return _gp8_drum_tab()
            song = guitarpro.parse(gp_path)
            if supports:
                return convert_drum_track_to_drumtab(
                    song, track_index, audio_offset, arr_name,
                    out_unmapped=unmapped,
                )
            return convert_drum_track_to_drumtab(
                song, track_index, audio_offset, arr_name,
            )

        try:
            drum_tab = await asyncio.get_event_loop().run_in_executor(None, _convert)
        except IndexError:
            # song.tracks[track_index] out of range — a client input error,
            # not a server fault. Leave the upload dir for a retry.
            return JSONResponse(
                {"error": f"track_index {track_index} out of range"}, 400
            )
        except Exception as e:
            import traceback
            traceback.print_exc()
            # Leave the upload temp dir on failure so the user can retry.
            return JSONResponse({"error": str(e)}, 500)

        # Clean up the GP upload temp dir now that conversion succeeded —
        # mirrors import_keys_midi. Without this, slopsmith_gp_* dirs would
        # accumulate in the system temp dir indefinitely.
        try:
            shutil.rmtree(Path(gp_path).parent)
        except OSError as _cleanup_err:
            import warnings
            warnings.warn(f"Could not clean up GP temp dir: {_cleanup_err}")

        # Sort unmapped by MIDI ascending so the client UI is stable.
        # Defensive .get() reads — if a future converter shape ever leaves
        # `count` or `times` partially populated, return zero/empty rather
        # than KeyError'ing a successful import into a 500.
        unmapped_list = [
            _safe_unmapped_entry(m, rec)
            for m, rec in sorted(unmapped.items())
        ]
        return {"drum_tab": drum_tab, "unmapped": unmapped_list}

    # ── MIDI drum import: list channel 10 (index 9) tracks ──────────

    @app.post("/api/plugins/editor/import-drums-midi-list")
    async def import_drums_midi_list(file: UploadFile = File(...)):
        """Upload a MIDI file and list channel 10 (drum) tracks for the picker.

        MIDI channel 10 is the General MIDI percussion channel; in 0-based
        wire encoding this is channel index 9 — `list_drum_tracks` filters
        on `channel == 9`. Returns `{midi_path, tracks: [...]}` so the
        frontend can show a track-picker modal identical to the keys flow.
        """
        from lib.midi_import import list_drum_tracks

        orig_suffix = Path(file.filename or "").suffix.lower()
        if orig_suffix not in (".mid", ".midi"):
            return JSONResponse(
                {"error": "Only .mid/.midi files are accepted"}, 400
            )

        # Opportunistic TTL cleanup of stale upload sandboxes (30 min).
        # Matches the keys-midi path so unclaimed uploads don't accumulate.
        _ttl_secs = 30 * 60
        tmp_root = Path(tempfile.gettempdir())
        for _stale in tmp_root.glob("slopsmith_drums_midi_*"):
            try:
                if _stale.is_dir():
                    age = time.time() - _stale.stat().st_mtime
                    if age > _ttl_secs:
                        shutil.rmtree(_stale, ignore_errors=True)
            except OSError:
                pass

        suffix = orig_suffix or ".mid"
        tmp = tempfile.mkdtemp(prefix="slopsmith_drums_midi_")
        midi_path = os.path.join(tmp, "upload" + suffix)
        content = await file.read()
        Path(midi_path).write_bytes(content)

        def _list():
            return list_drum_tracks(midi_path)

        try:
            tracks = await asyncio.get_event_loop().run_in_executor(None, _list)
        except Exception as e:
            shutil.rmtree(tmp, ignore_errors=True)
            return JSONResponse({"error": f"Failed to parse MIDI file: {e}"}, 500)

        if not tracks:
            shutil.rmtree(tmp, ignore_errors=True)
            return JSONResponse(
                {"error": "No drum (channel-10) tracks found in MIDI file"}, 400
            )

        return {"midi_path": midi_path, "tracks": tracks}

    # ── MIDI drum import: convert a track → drum_tab.json ──────────

    @app.post("/api/plugins/editor/import-drums-midi")
    async def import_drums_midi(data: dict):
        """Convert a MIDI drum track to a drum_tab.json dict."""
        from lib.midi_import import convert_drum_track_from_midi

        midi_path_raw = data.get("midi_path", "")
        track_index = data.get("track_index")
        try:
            audio_offset = float(data.get("audio_offset", 0.0))
        except (TypeError, ValueError):
            return JSONResponse({"error": "audio_offset must be a number"}, 400)

        validated = _validate_editor_upload_path(midi_path_raw, "slopsmith_drums_midi_")
        if not validated:
            return JSONResponse({"error": "MIDI file not found"}, 400)
        midi_path = str(validated)
        if track_index is None:
            return JSONResponse({"error": "track_index required"}, 400)
        try:
            track_index = int(track_index)
        except (TypeError, ValueError):
            return JSONResponse({"error": "track_index must be an integer"}, 400)

        arr_name = str(data.get("arrangement_name") or "Drums") or "Drums"

        # Capture MIDI notes the converter couldn't map so the client can
        # surface a warning + manual-mapping UI rather than silently
        # dropping percussion that's outside the 18-piece vocab.
        unmapped: dict[int, dict] = {}

        # Cached compat probe — see _supports_unmapped at setup scope.
        supports = _supports_unmapped(convert_drum_track_from_midi)

        def _convert():
            if supports:
                return convert_drum_track_from_midi(
                    midi_path, track_index, audio_offset, arr_name,
                    out_unmapped=unmapped,
                )
            return convert_drum_track_from_midi(
                midi_path, track_index, audio_offset, arr_name,
            )

        _midi_tmp_dir = Path(midi_path).parent
        try:
            drum_tab = await asyncio.get_event_loop().run_in_executor(None, _convert)
        except ValueError as e:
            # convert_drum_track_from_midi raises ValueError for client input
            # errors (track_index out of range, non-finite audio_offset) —
            # surface those as 400, not a 500. Upload dir left for a retry.
            return JSONResponse({"error": str(e)}, 400)
        except Exception as e:
            import traceback
            traceback.print_exc()
            # Leave the upload temp dir in place on failure — the frontend
            # keeps `_addDrumsFile` and re-enables the Import button, so the
            # user can retry the same upload. Deleting the dir here would
            # make that retry 404 with "MIDI file not found". Stale dirs are
            # swept by the opportunistic TTL cleanup, same as import_keys_midi.
            return JSONResponse({"error": str(e)}, 500)

        # Clean up the MIDI temp dir now that conversion is complete — mirrors
        # import_keys_midi which also rmtrees after a successful conversion so
        # temp dirs don't accumulate between TTL cleanup runs.
        try:
            shutil.rmtree(_midi_tmp_dir)
        except OSError as _cleanup_err:
            import warnings
            warnings.warn(f"Could not clean up drums MIDI temp dir: {_cleanup_err}")

        # Defensive .get() reads — if a future converter shape ever leaves
        # `count` or `times` partially populated, return zero/empty rather
        # than KeyError'ing a successful import into a 500.
        unmapped_list = [
            _safe_unmapped_entry(m, rec)
            for m, rec in sorted(unmapped.items())
        ]
        return {"drum_tab": drum_tab, "unmapped": unmapped_list}

    # ── Remove arrangement from session ────────────────────────────

    @app.post("/api/plugins/editor/remove-arrangement")
    async def remove_arrangement(data: dict):
        """Remove an arrangement from the current editing session."""
        session_id = data.get("session_id", "")
        session = sessions.get(session_id)
        if not session:
            return JSONResponse({"error": "No active session"}, 400)
        session["last_touched"] = time.time()

        raw_idx = data.get("arrangement_index")
        if raw_idx is None:
            idx = -1
        else:
            try:
                idx = int(raw_idx)
            except (TypeError, ValueError):
                return JSONResponse({"error": "arrangement_index must be an integer"}, 400)

        # Sloppak: nothing to remove server-side until save. The frontend
        # splices its in-memory arrangements and the next save rewrites
        # the manifest + drops the orphaned arrangement JSON.
        if session.get("format") == "sloppak":
            return {"success": True, "arrangement_count": -1, "format": "sloppak"}

        xml_files = session.get("xml_files") or []
        if not (0 <= idx < len(xml_files)):
            return JSONResponse({"error": "arrangement_index out of range"}, 400)
        removed = xml_files.pop(idx)
        # Create-mode sessions stage each arrangement as an intermediate XML
        # (plus any sidecars) under the session dir before the sloppak build.
        # Delete the XML and every sidecar keyed off the XML stem so the next
        # build doesn't still ship the "removed" arrangement:
        #   songs/arr/<stem>.xml          (this file)
        #   songs/bin/generic/<stem>.notechart  (compiled chart)
        #   manifests/songs_dlc_*/<stem>.json (manifest)
        xml_p = Path(removed)
        stem = xml_p.stem
        session_dir = Path(session.get("dir") or "")

        try:
            xml_p.unlink(missing_ok=True)
        except Exception:
            pass

        sng_path = xml_p.parent.parent / "bin" / "generic" / f"{stem}.notechart"
        try:
            sng_path.unlink(missing_ok=True)
        except Exception:
            pass

        if session_dir and session_dir.is_dir():
            for manifest_json in session_dir.rglob(f"manifests/**/{stem}.json"):
                try:
                    manifest_json.unlink(missing_ok=True)
                except Exception:
                    pass

        return {"success": True, "arrangement_count": len(xml_files)}

    # ── Add arrangement to existing session ──────────────────────────

    @app.post("/api/plugins/editor/add-arrangement")
    async def add_arrangement(data: dict):
        """Add a new arrangement (e.g. Keys) to the current editing session."""
        session_id = data.get("session_id", "")
        session = sessions.get(session_id)
        if not session:
            return JSONResponse({"error": "No active session"}, 400)
        session["last_touched"] = time.time()

        arrangement = data.get("arrangement")
        xml_path = data.get("xml_path", "")

        if not arrangement:
            return JSONResponse({"error": "arrangement data required"}, 400)

        # Sloppak sessions don't use XML on disk — the save endpoint writes
        # arrangement JSON files when the user commits. The frontend keeps
        # the new arrangement in S.arrangements and sends the full snapshot
        # at save time.
        if session.get("format") == "sloppak":
            return {"success": True, "arrangement_count": -1, "format": "sloppak"}

        # archive path: persist the XML so save can use the existing flow.
        if xml_path and Path(xml_path).exists():
            # Copy XML into session dir
            dest = os.path.join(session["dir"], f"Keys_{len(session.get('xml_files', []))}.xml")
            shutil.copy2(xml_path, dest)
            if "xml_files" not in session:
                session["xml_files"] = []
            session["xml_files"].append(dest)

        return {"success": True, "arrangement_count": len(session.get("xml_files", []))}

    # ── Build Song from create-mode session ──────────────────────────

    @app.post("/api/plugins/editor/build")
    async def build_song_endpoint(data: dict):
        """Build a song from the current create-mode session.

        Always writes a native `.sloppak`. (the native `.archive`/custom-song export
        has been removed — the sloppak container carries every arrangement,
        including extended-range 7/8-string guitar and 5/6-string bass that
        the old note-chart binary format couldn't.)
        """
        session_id = data.get("session_id", "")
        session = sessions.get(session_id)
        if not session or not session.get("create_mode"):
            return JSONResponse({"error": "No active create session"}, 400)
        session["last_touched"] = time.time()

        arrangements_data = data.get("arrangements", [])
        beats = data.get("beats", [])
        sections = data.get("sections", [])
        # Merge session metadata (album/year captured at convert-gp time)
        # with anything the frontend sent (the build modal currently
        # only ships {title, artist, artistName}). Without the merge,
        # extended-range sloppak builds via _write_sloppak_pak would
        # silently drop album/year fields the user typed during import.
        meta = dict(session.get("metadata") or {})
        meta.update(data.get("metadata") or {})
        audio_url = data.get("audio_url", "")
        art_path = data.get("art_path", "")
        preview_path = data.get("preview_path", "")
        # Drum tab (from a GP drum-track import or the +Drums modal).
        drum_tab = data.get("drum_tab")
        if drum_tab is not None:
            # Validate the shape at the request boundary so a malformed tab
            # fails fast with 400 instead of bubbling out of _write_sloppak_pak
            # as a 500. Minimum contract: a dict with a list `hits`.
            if (not isinstance(drum_tab, dict)
                    or not isinstance(drum_tab.get("hits", []), list)):
                return JSONResponse(
                    {"error": "drum_tab must be a JSON object with a 'hits' array"},
                    400,
                )

        def _build_sloppak():
            """Build a `.sloppak` for the create-mode session.

            Output filename is derived from title/artist for create-mode
            sessions (no existing source filename to preserve).
            """
            resolved = _resolve_storage_url(audio_url) if audio_url else None
            audio_file = str(resolved) if resolved else ""
            if not audio_file or not Path(audio_file).exists():
                raise RuntimeError("No audio file available for build")

            dlc_dir = get_dlc_dir()
            if not dlc_dir:
                raise RuntimeError("DLC folder not configured")

            title = meta.get("title", "Untitled")
            artist = meta.get("artistName") or meta.get("artist", "Unknown")
            safe_t = re.sub(r'[<>:"/\\|?*]', '_', title)
            safe_a = re.sub(r'[<>:"/\\|?*]', '_', artist)
            output = dlc_dir / f"{safe_t}_{safe_a}.feedpak"
            return _write_sloppak_pak(
                audio_file=audio_file,
                art_path=_safe_storage_asset(art_path),
                preview_path=_safe_storage_asset(preview_path),
                arrangements_data=arrangements_data,
                beats=beats,
                sections=sections,
                meta=meta,
                output_path=output,
                drum_tab=drum_tab if isinstance(drum_tab, dict) else None,
            )

        try:
            output_path = await asyncio.get_event_loop().run_in_executor(
                None, _build_sloppak
            )
        except IsADirectoryError as e:
            # _write_sloppak_pak refused to clobber an authoring-form
            # sloppak directory at the target path. Surface as 409 so
            # the UI can prompt the user to remove/rename it.
            return JSONResponse({"error": str(e)}, 409)
        except Exception as e:
            import traceback
            traceback.print_exc()
            return JSONResponse({"error": str(e)}, 500)

        return {
            "success": True,
            "path": output_path,
            "format": "sloppak",
        }

    # ── Helpers ──────────────────────────────────────────────────────────

    def _probe_audio_duration(path) -> "float | None":
        """Best-effort audio duration in seconds via ffprobe (None on failure)."""
        try:
            from lib.audio import _bundled_or_path
            ffprobe = _bundled_or_path("ffprobe") or shutil.which("ffprobe")
        except Exception:
            ffprobe = shutil.which("ffprobe")
        if not ffprobe:
            return None
        try:
            pr = subprocess.run(
                [ffprobe, "-v", "error", "-show_entries", "format=duration",
                 "-of", "csv=p=0", str(path)],
                capture_output=True, timeout=15,
            )
            if pr.returncode == 0:
                return round(float(pr.stdout.strip()), 3)
        except Exception:
            pass
        return None

    def _make_preview_clip(src: "Path", out_dir: "Path",
                           clip_seconds: float = 28.0) -> "Path | None":
        """Auto-generate a short hover-to-listen preview from the master audio —
        an OGG snippet starting ~20% into the song (past most intros). Best-effort:
        returns None if ffmpeg is unavailable or the source is missing/too short.
        Replaces the old manual "Preview Clip" upload."""
        try:
            from lib.audio import _ffmpeg_cmd
            ffmpeg = _ffmpeg_cmd()
        except Exception:
            ffmpeg = None
        if not ffmpeg or not src or not Path(src).exists():
            return None
        start, dur = 0.0, None
        try:
            from lib.audio import _bundled_or_path
            ffprobe = _bundled_or_path("ffprobe") or shutil.which("ffprobe")
        except Exception:
            ffprobe = shutil.which("ffprobe")
        if ffprobe:
            try:
                pr = subprocess.run(
                    [ffprobe, "-v", "error", "-show_entries", "format=duration",
                     "-of", "csv=p=0", str(src)],
                    capture_output=True, timeout=15,
                )
                if pr.returncode == 0:
                    dur = float(pr.stdout.strip())
            except Exception:
                dur = None
        if dur and dur > clip_seconds + 2:
            start = max(0.0, min(dur * 0.2, dur - clip_seconds))
        out = out_dir / "preview.ogg"
        try:
            subprocess.run(
                [ffmpeg, "-y", "-ss", str(round(start, 3)), "-t", str(clip_seconds),
                 "-i", str(src), "-vn", "-c:a", "libvorbis", "-q:a", "4", str(out)],
                capture_output=True, timeout=60,
            )
        except Exception:
            return None
        if out.exists() and out.stat().st_size > 100:
            return out
        return None

    def _write_sloppak_pak(*, audio_file: str, art_path: str,
                          arrangements_data: list, beats: list, sections: list,
                          meta: dict, output_path: Path,
                          drum_tab: dict | None = None,
                          lyrics: list | None = None,
                          preview_path: str = "",
                          fail_if_exists: bool = False,
                          duration_override: float | None = None) -> str:
        """Stage a sloppak at `output_path` from the in-memory edit state.

        Shared between the create-mode build path (output_path derived
        from title/artist) and the save-as-sloppak path (output_path
        derived from the source archive filename, so the new sloppak sits
        next to the original on disk).

        Optional `drum_tab`: when provided, written as `drum_tab.json`
        and referenced from the manifest's top-level `drum_tab:` key.
        Currently only used by the create-sloppak flow (when the user
        opts into starting with an empty drum tab); the regular /save
        path writes drum_tab via its own staging logic, not through
        this helper.
        """
        # Draft-now packs carry no audio (audio_file == ""): emit an empty
        # `stems: []` the author fills in later via Replace Audio. A NON-empty
        # audio_file that doesn't resolve is still a real error.
        _has_audio = bool(audio_file)
        if _has_audio and not Path(audio_file).exists():
            raise RuntimeError("No audio file available for sloppak write")
        # Sloppak supports a packed-zip form (foo.sloppak file) and an
        # authoring directory form (foo.sloppak/ tree). Replacing a
        # directory with a zip via tmp_zip.replace(...) would raise
        # mid-operation and surface as a 500. Refuse early with a clear
        # signal so callers can convert it into a 409.
        if output_path.exists() and output_path.is_dir():
            raise IsADirectoryError(
                f"Refusing to overwrite authoring-form sloppak directory at {output_path}"
            )

        title = meta.get("title", "Untitled")
        artist = meta.get("artistName") or meta.get("artist", "Unknown")
        album = meta.get("albumName") or meta.get("album", "")
        year_raw = str(meta.get("albumYear") or meta.get("year", ""))
        ym = _YEAR_RE.search(year_raw) if year_raw else None
        year = int(ym.group(1)) if ym else 0

        staging = Path(tempfile.mkdtemp(prefix="slopsmith_sloppak_build_"))
        try:
            arr_dir = staging / "arrangements"
            arr_dir.mkdir()
            stems_dir = staging / "stems"
            stems_dir.mkdir()

            # Single combined-audio stem — the editor only carries one
            # audio source per session (archive load decodes the WEM to a
            # single ogg; create-mode imports one audio file). Name it
            # `full.ogg` to match the ecosystem convention (the player's stem
            # mixer + `_mix_stems_for_editor` key on `stems/full.ogg`); naming
            # it `audio.ogg` here meant those consumers couldn't find the mix.
            # Transcode to OGG when the source isn't already OGG so playback
            # works regardless of the uploaded audio format.
            # No audio (draft): stem_filename stays None -> manifest `stems: []`.
            stem_filename = None
            if _has_audio:
                audio_ext = Path(audio_file).suffix.lower()
                if audio_ext == ".ogg":
                    stem_filename = "full.ogg"
                    shutil.copy2(audio_file, stems_dir / stem_filename)
                else:
                    # Try to transcode to the conventional `full.ogg` so on-create
                    # stem separation can find the source mix.
                    try:
                        from lib.audio import _ffmpeg_cmd, _ffmpeg_wav_to_ogg
                        _ff = _ffmpeg_cmd()
                    except Exception:
                        _ff = None
                    _ogg_dest = stems_dir / "full.ogg"
                    _ok = False
                    if _ff:
                        _r = _ffmpeg_wav_to_ogg(_ff, Path(audio_file), _ogg_dest)
                        _ok = (_r.returncode == 0 and _ogg_dest.exists()
                               and _ogg_dest.stat().st_size >= 100)
                    if _ok:
                        stem_filename = "full.ogg"
                    else:
                        # ffmpeg unavailable or transcode failed — keep the source
                        # under its REAL extension (and point the manifest at it)
                        # rather than writing mislabeled bytes to a `.ogg` name,
                        # which would break decode/playback. Stem-split (which keys
                        # on full.ogg) is best-effort and simply won't run here.
                        _ogg_dest.unlink(missing_ok=True)
                        stem_filename = f"full{audio_ext}"
                        shutil.copy2(audio_file, stems_dir / stem_filename)

            used_ids: set[str] = set()
            manifest_arrangements = []
            # For create-mode the beats[] is just a placeholder grid
            # (a few seconds at the head of the song), so max(beats.time)
            # would write a ~2s manifest.duration regardless of the
            # actual audio length. Callers that know the real duration
            # (e.g. create_sloppak, which probes the audio with ffprobe)
            # pass it via duration_override.
            if (duration_override is not None
                    and isinstance(duration_override, (int, float))
                    and duration_override > 0):
                duration = float(duration_override)
            else:
                duration = 0.0
                for b in beats:
                    try:
                        duration = max(duration, float(b.get("time", 0)))
                    except (TypeError, ValueError):
                        pass

            for i, ad in enumerate(arrangements_data):
                name = ad.get("name", f"Arr{i}")
                # `_arrangement_id` already inserts into `used_ids` for us.
                aid = _arrangement_id(name, used_ids)
                # Normalize tuning to the real string count so the
                # written sloppak unambiguously reflects the editor's
                # in-memory count (the RS-XML 6-slot padding does NOT
                # round-trip through sloppak — we want length 4 for a
                # real 4-string bass, length 6 for a genuine 6-string).
                real_count = _arrangement_string_count(ad)
                normalized_tuning = _normalize_tuning_to_count(
                    ad.get("tuning", [0] * 6), real_count,
                )
                # Honor authored anchors when the key is present (even
                # if it's an explicit `[]` — that's "clear authored
                # anchors, recompute"). Only fall back to the legacy
                # `anchors` passthrough when `anchors_user` isn't in the
                # arrangement dict at all.
                if "anchors_user" in ad:
                    authored_anchors = ad["anchors_user"] or []
                else:
                    authored_anchors = ad.get("anchors") or []
                # Same key-presence vs explicit-empty distinction for
                # `handshapes` (empty means "no handshapes") and `tones`
                # (None means "no authored tones").
                if "handshapes" in ad:
                    authored_handshapes = ad["handshapes"] or []
                else:
                    authored_handshapes = []
                wire = _arr_dict_to_wire(
                    name,
                    normalized_tuning,
                    int(ad.get("capo", 0)),
                    ad.get("notes", []),
                    ad.get("chords", []),
                    ad.get("chord_templates", []),
                    tones=ad.get("tones"),
                    handshapes=authored_handshapes,
                    anchors_user=authored_anchors,
                )
                if i == 0:
                    wire["beats"] = [
                        {"time": round(float(b.get("time", 0)), 3),
                         "measure": int(b.get("measure", -1))}
                        for b in beats
                    ]
                    wire["sections"] = [
                        {"name": s.get("name", ""),
                         "number": int(s.get("number", 0)),
                         "time": round(float(s.get("start_time", 0)), 3)}
                        for s in sections
                    ]
                (arr_dir / f"{aid}.json").write_text(
                    json.dumps(wire, separators=(",", ":")),
                    encoding="utf-8",
                )
                arr_entry = {
                    "id": aid,
                    "name": name,
                    "file": f"arrangements/{aid}.json",
                    "tuning": normalized_tuning,
                    "capo": int(ad.get("capo", 0)),
                }
                # Dual-write notation sidecar for keys-family arrangements here
                # too, so Save-As-Sloppak / create charts get notation-renderer
                # support without a reopen-and-save round trip (no-op otherwise).
                # `_gp_notation` is passed as an argument, never copied onto the
                # manifest entry, so it can't leak into the shipped manifest.
                _write_keys_notation_sidecar(
                    staging, arr_entry, wire, beats,
                    gp_notation=ad.get("_gp_notation"))
                manifest_arrangements.append(arr_entry)

            manifest = {
                "title": title,
                "artist": artist,
                "album": album,
                "duration": round(duration, 3),
                # `id: "full"` matches the convention the editor's load
                # path and replace-audio path already use; sloppak
                # readers prefer that id when picking the default stem.
                # Draft packs (no audio yet) carry an empty stems list — the
                # loader tolerates it (audio_url resolves to null) and Replace
                # Audio fills it in later.
                "stems": (
                    [{"id": "full", "file": f"stems/{stem_filename}"}]
                    if stem_filename else []
                ),
                "arrangements": manifest_arrangements,
            }
            if year:
                manifest["year"] = year
            # Optional author credits (feedpak `authors:` array). Written only
            # when non-empty so packs without credits stay byte-identical.
            _authors = meta.get("authors")
            if isinstance(_authors, list):
                _authors = [str(a).strip() for a in _authors if str(a).strip()]
                if _authors:
                    manifest["authors"] = _authors

            # Spec-complete optional metadata (feedpak §5.1) — written only when
            # present so packs without them stay minimal. String scalars,
            # int scalars (track/disc), and the genres list.
            for _mk in ("album_artist", "mbid", "isrc", "language"):
                _mv = meta.get(_mk)
                if isinstance(_mv, str) and _mv.strip():
                    manifest[_mk] = _mv.strip()
            for _mk in ("track", "disc"):
                _mv = meta.get(_mk)
                if isinstance(_mv, int) and not isinstance(_mv, bool):
                    manifest[_mk] = _mv
            _genres = meta.get("genres")
            if isinstance(_genres, list):
                _genres = [str(g).strip() for g in _genres if str(g).strip()]
                if _genres:
                    manifest["genres"] = _genres

            if art_path and Path(art_path).exists():
                cover_ext = Path(art_path).suffix.lower() or ".jpg"
                cover_name = f"cover{cover_ext}"
                shutil.copy2(art_path, staging / cover_name)
                manifest["cover"] = cover_name

            # Optional hover-preview clip — copied verbatim under its own
            # extension (no transcode) and referenced from the manifest's
            # `preview:` key, the same key the Song Preview plugin reads.
            if preview_path and Path(preview_path).exists():
                pv_ext = Path(preview_path).suffix.lower() or ".ogg"
                pv_name = f"preview{pv_ext}"
                shutil.copy2(preview_path, staging / pv_name)
                manifest["preview"] = pv_name

            if isinstance(drum_tab, dict):
                # Validate the shape via the same permissive validator
                # the loader uses — refusing now beats writing a manifest
                # entry that points at a drum_tab.json the loader would
                # silently drop (leaving the user with a broken file).
                # NB: validator returns (ok, reason); the previous
                # `if not validator(...)` check was a no-op because a
                # 2-tuple is always truthy.
                from lib import drums as _drums_mod
                ok, reason = _drums_mod.validate_drum_tab(drum_tab)
                if not ok:
                    raise ValueError(
                        f"drum_tab failed validation: {reason}"
                    )
                (staging / "drum_tab.json").write_text(
                    json.dumps(drum_tab, separators=(",", ":")),
                    encoding="utf-8",
                )
                manifest["drum_tab"] = "drum_tab.json"

            # Vocals seed: an empty (or authored) lyrics track. feedpak §7.1
            # lyrics.json is a flat array of syllables — an empty array is a
            # valid, empty track the author fills in later.
            if isinstance(lyrics, list):
                (staging / "lyrics.json").write_text(
                    json.dumps(lyrics, separators=(",", ":")),
                    encoding="utf-8",
                )
                manifest["lyrics"] = "lyrics.json"
                manifest["lyrics_source"] = "authored"

            _write_song_timeline_sidecar(staging, manifest, beats, sections)

            (staging / "manifest.yaml").write_text(
                yaml.safe_dump(manifest, sort_keys=False, allow_unicode=True),
                encoding="utf-8",
            )

            output_path.parent.mkdir(parents=True, exist_ok=True)
            # `fail_if_exists` callers (create-sloppak) want a clear
            # 409 instead of silently overwriting, even under concurrent
            # creates. O_CREAT|O_EXCL is the kernel's atomic
            # "reserve-or-fail" primitive — exactly one concurrent
            # caller wins, the rest get FileExistsError. We then write
            # the real zip to a tmp file and rename over our reservation.
            placeholder_created = False
            if fail_if_exists:
                try:
                    os.close(os.open(
                        str(output_path),
                        os.O_CREAT | os.O_EXCL | os.O_WRONLY,
                        0o644,
                    ))
                    placeholder_created = True
                except FileExistsError:
                    raise FileExistsError(
                        f"{output_path.name} already exists; refusing to overwrite"
                    )
            # Match the existing /save paths: keep a one-time .bak when
            # we're about to overwrite an existing sloppak so the user
            # has a recovery point. Skipped on `fail_if_exists` since
            # we just atomically created a placeholder there.
            elif output_path.exists() and output_path.is_file():
                backup = output_path.with_suffix(output_path.suffix + ".bak")
                if not backup.exists():
                    shutil.copy2(output_path, backup)
            tmp_zip = output_path.with_suffix(output_path.suffix + ".tmp")
            try:
                with zipfile.ZipFile(str(tmp_zip), "w", zipfile.ZIP_DEFLATED) as zf:
                    for f in staging.rglob("*"):
                        if f.is_file():
                            zf.write(f, f.relative_to(staging).as_posix())
                tmp_zip.replace(output_path)
            except Exception:
                # Don't leave the 0-byte placeholder behind if the
                # zip write or rename fails — the next call would see
                # it as a "real" existing file. Also clean up the
                # partial tmp zip so failed attempts don't accumulate.
                if placeholder_created:
                    try:
                        if (output_path.exists()
                                and output_path.stat().st_size == 0):
                            output_path.unlink()
                    except OSError:
                        pass
                try:
                    tmp_zip.unlink(missing_ok=True)
                except OSError:
                    pass
                raise
            return str(output_path)
        finally:
            shutil.rmtree(staging, ignore_errors=True)

    # `_arr_dict_to_wire`, `_build_arrangement_xml`, and `_compute_anchors`
    # live at module scope (above `setup`) so the tests can import them
    # directly. Callers inside `setup` reference them by name and resolve
    # through Python's global scope.

    def _song_to_dict(song, audio_url):
        """Convert a Song object to JSON-serializable dict."""
        result = {
            "title": song.title,
            "artist": song.artist,
            "album": song.album,
            "year": song.year,
            "duration": song.song_length,
            "offset": song.offset,
            "audio_url": audio_url,
            "beats": [
                {"time": b.time, "measure": b.measure} for b in song.beats
            ],
            "sections": [
                {
                    "name": s.name,
                    "number": s.number,
                    "start_time": s.start_time,
                }
                for s in song.sections
            ],
            "arrangements": [],
        }

        # Mirror the Note dataclass surface — every authorable technique
        # round-trips so the editor can render and re-emit them. Shared with the
        # import path via the module-level helper (field set + per-field absent
        # defaults live there) so load and import stay byte-identical.
        _tech_dict = _note_tech_dict

        for arr in song.arrangements:
            arr_data = {
                "name": arr.name,
                "tuning": arr.tuning,
                "capo": arr.capo,
                "notes": [],
                "chords": [],
                "chord_templates": [],
                # `tones` is opaque {base, changes, definitions} — passes
                # through verbatim when the source carried it, otherwise
                # `None` so the frontend can distinguish "no tone data"
                # from "authored-but-empty". The editor's first author
                # action seeds a populated dict; without this distinction
                # a load → save cycle would persist an empty `tones`
                # block into sloppaks that previously had no `tones` key.
                "tones": arr.tones if arr.tones else None,
                "handshapes": [
                    {
                        "chord_id": h.chord_id,
                        "start_time": round(h.start_time, 3),
                        "end_time": round(h.end_time, 3),
                        "arp": h.arpeggio,
                    }
                    for h in (arr.hand_shapes or [])
                ],
            }
            # Loaded anchors become the user-overridable initial set
            # (`anchors_user`). We ALSO emit the legacy `anchors` field
            # with the same payload until the editor UI is fully on
            # `anchors_user` — frontend code paths like the tempo
            # re-time logic still read `arr.anchors`, and archive saves
            # that flip to sloppak format without a reload would
            # otherwise lose anchors entirely.
            anchors_payload = [
                {
                    "time": round(a.time, 3),
                    "fret": a.fret,
                    "width": a.width,
                }
                for a in (arr.anchors or [])
            ]
            arr_data["anchors"] = list(anchors_payload)
            arr_data["anchors_user"] = list(anchors_payload)

            for n in arr.notes:
                arr_data["notes"].append({
                    "time": round(n.time, 3),
                    "string": n.string,
                    "fret": n.fret,
                    "sustain": round(n.sustain, 3),
                    "techniques": _tech_dict(n),
                })

            for ch in arr.chords:
                chord_data = {
                    "time": round(ch.time, 3),
                    "chord_id": ch.chord_id,
                    "high_density": ch.high_density,
                    # Harmony function (§6.3.1) rides the instance; core already
                    # validated it on decode (partial/invalid -> None).
                    "fn": getattr(ch, "fn", None),
                    "notes": [],
                }
                for cn in ch.notes:
                    chord_data["notes"].append({
                        "time": round(cn.time, 3),
                        "string": cn.string,
                        "fret": cn.fret,
                        "sustain": round(cn.sustain, 3),
                        "techniques": _tech_dict(cn),
                    })
                arr_data["chords"].append(chord_data)

            for ct in arr.chord_templates:
                arr_data["chord_templates"].append({
                    "name": ct.name,
                    "displayName": getattr(ct, "display_name", "") or ct.name,
                    "arp": bool(getattr(ct, "arpeggio", False)),
                    "frets": ct.frets,
                    "fingers": ct.fingers,
                    # Voicing (§6.6) rides the template (display only).
                    "voicing": getattr(ct, "voicing", "") or "",
                    # CAGED shape + guide tones (§6.6) ride the template too
                    # (display only); guarded so an invalid value can't leak.
                    # Core's ChordTemplate exposes guide_tones as snake_case
                    # (wire/camelCase only on the dict side).
                    "caged": _caged_wire(getattr(ct, "caged", "")),
                    "guideTones": _guide_tones_wire(getattr(ct, "guide_tones", [])),
                })

            result["arrangements"].append(arr_data)

        return result
