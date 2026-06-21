"""Tests for .jsonc support in the Arrangement Editor (feedpak-spec §8).

The editor reads the existing arrangement JSON to preserve
anchors/handshapes/phrases/tones on save, and re-writes the arrangement file.
For ``.jsonc`` arrangements both sides must be comment-aware: the read strips
comments, the write preserves comments on a best-effort basis — including
comments nested inside arrays/objects (phase 2).

Anchoring (phase 2): each comment is anchored to a structural identity in the
original (header, footer, before-key, before-value, before-elem, trailing)
and re-inserted at the matching spot in the freshly serialized JSON. Array
elements anchor by a content signature (the ``t`` value for objects that have
one, else a compact JSON hash), so a comment follows its element across
reorders / additions / removals of *other* elements. Editing the anchored
element's ``t`` (or any field of a ``t``-less element) changes its signature
and the comment drifts or drops — the documented best-effort limit.

These cover the helpers in ``routes.py``: ``_parse_jsonc``,
``_load_arrangement_json``, ``_jsonc_extract_comments``, and
``_preserve_jsonc_comments`` — the read site and the write site both delegate
to them.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from routes import (  # noqa: E402
    _jsonc_extract_comments,
    _jsonc_inline_comment,
    _jsonc_save_text,
    _load_arrangement_json,
    _parse_jsonc,
    _preserve_jsonc_comments,
)


# ── _parse_jsonc ─────────────────────────────────────────────────────────────

def test_parse_jsonc_strips_line_comment():
    assert _parse_jsonc('{"a": 1 // c\n}') == {"a": 1}


def test_parse_jsonc_strips_block_comment():
    assert _parse_jsonc('{"a": /* x */ 2}') == {"a": 2}


def test_parse_jsonc_strips_multiline_block_comment():
    text = '{\n  /* multi\n     line */\n  "a": 1\n}'
    assert _parse_jsonc(text) == {"a": 1}


def test_parse_jsonc_preserves_comment_like_text_in_strings():
    text = '{"url": "https://x/y", "note": "// not a comment /* still not */"}'
    out = _parse_jsonc(text)
    assert out["url"] == "https://x/y"
    assert out["note"] == "// not a comment /* still not */"


def test_parse_jsonc_rejects_malformed():
    with pytest.raises(json.JSONDecodeError):
        _parse_jsonc('{"a": // broken\n}')


def test_parse_jsonc_plain_json_passes_through():
    assert _parse_jsonc('{"a": 1}') == {"a": 1}


# ── _load_arrangement_json ───────────────────────────────────────────────────

def test_load_arrangement_json_reads_jsonc_with_comments(tmp_path: Path):
    p = tmp_path / "lead.jsonc"
    p.write_text('// chart\n{"name": "Lead", "notes": []}', encoding="utf-8")
    out = _load_arrangement_json(p)
    assert out == {"name": "Lead", "notes": []}


def test_load_arrangement_json_reads_plain_json(tmp_path: Path):
    p = tmp_path / "lead.json"
    p.write_text('{"name": "Lead", "notes": []}', encoding="utf-8")
    out = _load_arrangement_json(p)
    assert out == {"name": "Lead", "notes": []}


def test_load_arrangement_json_preserves_anchors_through_comments(tmp_path: Path):
    """The read site loads the existing arrangement to preserve anchors/
    handshapes/phrases/tones — a .jsonc arrangement must surface them."""
    p = tmp_path / "lead.jsonc"
    p.write_text(
        '/* arrangement */\n'
        '{"name": "Lead", "anchors": [{"time": 1.0, "fret": 3}], '
        '"handshapes": [], "phrases": [], "tones": []}',
        encoding="utf-8",
    )
    out = _load_arrangement_json(p)
    assert out["anchors"] == [{"time": 1.0, "fret": 3}]


# ── _jsonc_extract_comments (anchor structure) ───────────────────────────────

def test_extract_header_and_footer_comments():
    text = '// header\n/* block header */\n{"a": 1}\n// footer\n'
    out = _jsonc_extract_comments(text)
    assert out[("header",)] == ["// header", "/* block header */"]
    assert out[("footer",)] == ["// footer"]


def test_extract_before_key_comments():
    text = (
        '{\n'
        '  // before-a\n'
        '  "a": 1,\n'
        '  /* before-b */\n'
        '  "b": 2\n'
        '}'
    )
    out = _jsonc_extract_comments(text)
    assert out[("before-key", "a")] == ["// before-a"]
    assert out[("before-key", "b")] == ["/* before-b */"]
    assert ("header",) not in out
    assert ("footer",) not in out


def test_extract_trailing_comment_before_closing_brace():
    text = '{"a": 1\n  // trailing\n}'
    out = _jsonc_extract_comments(text)
    assert out[("trailing",)] == ["// trailing"]


def test_extract_capts_nested_before_elem_comment():
    """A comment before an array element anchors to the element's signature."""
    text = (
        '{\n'
        '  "notes": [\n'
        '    // first note\n'
        '    {"t": 0.5}\n'
        '  ]\n'
        '}'
    )
    out = _jsonc_extract_comments(text)
    # The note has t=0.5 -> signature "t=0.5".
    assert out[("notes", "before-elem", "t=0.5")] == ["// first note"]


def test_extract_capt_nested_before_key_comment_inside_element():
    """A comment before a key inside an array element anchors to that key plus
    the element's signature path."""
    text = (
        '{\n'
        '  "notes": [\n'
        '    {\n'
        '      "t": 0.5,\n'
        '      // bend\n'
        '      "f": 5\n'
        '    }\n'
        '  ]\n'
        '}'
    )
    out = _jsonc_extract_comments(text)
    assert out[("notes", "t=0.5", "before-key", "f")] == ["// bend"]


def test_extract_capt_trailing_comment_inside_nested_array():
    text = (
        '{\n'
        '  "notes": [\n'
        '    {"t": 0.5}\n'
        '    // end of notes\n'
        '  ]\n'
        '}'
    )
    out = _jsonc_extract_comments(text)
    assert out[("notes", "trailing")] == ["// end of notes"]


# ── _preserve_jsonc_comments (top-level round trip) ──────────────────────────

def test_round_trip_preserves_header_before_key_trailing_footer():
    original = (
        '// header line\n'
        '/* block header */\n'
        '{\n'
        '  "name": "Lead",\n'
        '  // before notes\n'
        '  "notes": [],\n'
        '  "chords": [],\n'
        '  /* before beats */\n'
        '  "beats": []\n'
        '  // trailing comment\n'
        '}\n'
        '// footer\n'
    )
    wire = {"name": "Lead", "notes": [], "chords": [], "beats": []}
    out = _preserve_jsonc_comments(original, json.dumps(wire, indent=2))
    assert _parse_jsonc(out) == wire
    assert "// header line" in out
    assert "/* block header */" in out
    assert "// before notes" in out
    assert "/* before beats */" in out
    assert "// trailing comment" in out
    assert "// footer" in out
    assert "}\n// footer" in out


def test_round_trip_drops_comments_for_removed_keys():
    """If a key was removed from the new wire, its before-key comment drops."""
    original = (
        '{\n'
        '  // before-old\n'
        '  "old": 1,\n'
        '  "kept": 2\n'
        '}'
    )
    wire = {"kept": 2}  # "old" removed
    out = _preserve_jsonc_comments(original, json.dumps(wire, indent=2))
    assert _parse_jsonc(out) == wire
    assert "// before-old" not in out


def test_round_trip_no_comments_is_identity():
    wire = {"name": "Lead", "notes": []}
    original = json.dumps(wire, indent=2)  # no comments
    out = _preserve_jsonc_comments(original, original)
    assert out == original


# ── _preserve_jsonc_comments (nested round trip — phase 2) ───────────────────

def test_round_trip_preserves_nested_before_key_inside_note():
    """A comment before a key inside a note object survives a save, even when
    a non-``t`` field of that note is edited (the note's ``t`` anchors it)."""
    original = (
        '{\n'
        '  "notes": [\n'
        '    {\n'
        '      "t": 0.5,\n'
        '      // tricky bend here\n'
        '      "f": 5,\n'
        '      "s": 0\n'
        '    }\n'
        '  ]\n'
        '}'
    )
    wire = _parse_jsonc(original)
    wire["notes"][0]["f"] = 7  # edit fret; t unchanged -> comment survives
    out = _preserve_jsonc_comments(original, json.dumps(wire, indent=2))
    assert _parse_jsonc(out) == wire
    assert "// tricky bend here" in out
    # The comment lands on its own line, indented to match the key it precedes.
    assert '      // tricky bend here\n      "f"' in out


def test_round_trip_preserves_nested_before_elem_comment():
    """A comment before an array element survives a save when the element is
    unchanged."""
    original = (
        '{\n'
        '  "notes": [\n'
        '    // first note\n'
        '    {"t": 0.5, "f": 5}\n'
        '  ]\n'
        '}'
    )
    wire = _parse_jsonc(original)
    out = _preserve_jsonc_comments(original, json.dumps(wire, indent=2))
    assert _parse_jsonc(out) == wire
    assert "// first note" in out


def test_round_trip_comment_follows_element_across_insertion():
    """A comment anchored to an element follows that element when a new element
    is inserted before it (the anchor is the element's ``t``, not its index)."""
    original = (
        '{\n'
        '  "notes": [\n'
        '    {"t": 0.5, "f": 5},\n'
        '    // this one is the bend\n'
        '    {"t": 1.0, "f": 3}\n'
        '  ]\n'
        '}'
    )
    wire = _parse_jsonc(original)
    wire["notes"].insert(1, {"t": 0.75, "f": 2})  # new note before t=1.0
    out = _preserve_jsonc_comments(original, json.dumps(wire, indent=2))
    assert _parse_jsonc(out) == wire
    assert "// this one is the bend" in out
    # The comment now precedes the t=1.0 note (which moved from index 1 to 2).
    assert '// this one is the bend\n    {\n      "t": 1.0' in out


def test_round_trip_comment_drops_when_anchored_note_t_edited():
    """Editing the anchored note's ``t`` changes its signature, so a before-elem
    or nested before-key comment drops — the documented best-effort limit."""
    original = (
        '{\n'
        '  "notes": [\n'
        '    // bend\n'
        '    {"t": 1.0, "f": 3}\n'
        '  ]\n'
        '}'
    )
    wire = _parse_jsonc(original)
    wire["notes"][0]["t"] = 2.0  # t changed -> sig changes -> comment drops
    out = _preserve_jsonc_comments(original, json.dumps(wire, indent=2))
    assert _parse_jsonc(out) == wire
    assert "// bend" not in out


def test_round_trip_preserves_deeply_nested_comment_in_chord_notes():
    """A comment before a ``t``-less element (a chord-note) survives when that
    element is unchanged, but drops when any of its fields is edited (no stable
    primary key to anchor to)."""
    original = (
        '{\n'
        '  "chords": [\n'
        '    {\n'
        '      "t": 0.5,\n'
        '      "notes": [\n'
        '        // first string\n'
        '        {"s": 0, "f": 3}\n'
        '      ]\n'
        '    }\n'
        '  ]\n'
        '}'
    )
    # Unchanged -> comment survives.
    wire = _parse_jsonc(original)
    out = _preserve_jsonc_comments(original, json.dumps(wire, indent=2))
    assert _parse_jsonc(out) == wire
    assert "// first string" in out
    # Edit the t-less chord-note's f -> sig changes -> comment drops.
    wire2 = _parse_jsonc(original)
    wire2["chords"][0]["notes"][0]["f"] = 5
    out2 = _preserve_jsonc_comments(original, json.dumps(wire2, indent=2))
    assert _parse_jsonc(out2) == wire2
    assert "// first string" not in out2


def test_round_trip_preserves_trailing_comment_in_nested_array():
    original = (
        '{\n'
        '  "notes": [\n'
        '    {"t": 0.5},\n'
        '    {"t": 1.0}\n'
        '    // end of notes\n'
        '  ]\n'
        '}'
    )
    wire = _parse_jsonc(original)
    out = _preserve_jsonc_comments(original, json.dumps(wire, indent=2))
    assert _parse_jsonc(out) == wire
    assert "// end of notes" in out
    # Trailing comment indented to the array's close bracket.
    assert "    // end of notes\n  ]" in out


def test_round_trip_preserves_empty_array_trailing_comment():
    original = '{"notes": [\n    // nothing yet\n  ]}'
    wire = {"notes": []}
    out = _preserve_jsonc_comments(original, json.dumps(wire, indent=2))
    assert _parse_jsonc(out) == wire
    assert "// nothing yet" in out


# ── Combined read → modify → write round trip (the editor's save path) ───────

def test_jsonc_arrangement_save_round_trip(tmp_path: Path):
    """Simulate the editor's save path on a .jsonc arrangement:

    1. existing .jsonc arrangement on disk (with comments + preserved anchors)
    2. read it via _load_arrangement_json (read site)
    3. merge preserved fields into the new wire (as save_song does)
    4. write it back via _preserve_jsonc_comments (write site)
    5. read it again — comments survive (top-level + nested), anchors survive
       in data
    """
    existing = tmp_path / "arrangements" / "lead.jsonc"
    existing.parent.mkdir(parents=True)
    existing.write_text(
        '// lead chart — hand-edited\n'
        '{\n'
        '  "name": "Lead",\n'
        '  "tuning": [0, 0, 0, 0, 0, 0],\n'
        '  "capo": 0,\n'
        '  // edited notes below\n'
        '  "notes": [\n'
        '    {\n'
        '      "t": 0.5,\n'
        '      // bend on the downbeat\n'
        '      "f": 5,\n'
        '      "s": 0,\n'
        '      "sus": 0\n'
        '    }\n'
        '  ],\n'
        '  "chords": [],\n'
        '  /* preserved from a prior save */\n'
        '  "anchors": [{"time": 1.0, "fret": 3, "width": 4}],\n'
        '  "handshapes": [], "templates": []\n'
        '}',
        encoding="utf-8",
    )

    # 1. read site: load existing, capture preserved fields.
    data = _load_arrangement_json(existing)
    preserved = {}
    for _k in ("anchors", "handshapes", "phrases", "tones"):
        if _k in data:
            preserved[_k] = data[_k]

    # 2. new wire from the editor (a second note added; anchors not in the UI).
    new_wire = {
        "name": "Lead", "tuning": [0, 0, 0, 0, 0, 0], "capo": 0,
        "notes": [
            {"t": 0.5, "s": 0, "f": 5, "sus": 0},  # unchanged -> nested comment survives
            {"t": 1.0, "s": 1, "f": 3, "sus": 0},  # added
        ],
        "chords": [], "templates": [],
    }
    new_wire["anchors"] = preserved.get("anchors", [])

    # 3. write site: preserve comments, serialize pretty-printed.
    original_text = existing.read_text(encoding="utf-8")
    written = _preserve_jsonc_comments(original_text, json.dumps(new_wire, indent=2))
    existing.write_text(written, encoding="utf-8")

    # 4. read back: data correct, top-level + nested comments survived.
    back = _load_arrangement_json(existing)
    assert len(back["notes"]) == 2
    assert back["notes"][0]["f"] == 5
    assert back["notes"][1]["f"] == 3
    assert back["anchors"] == [{"time": 1.0, "fret": 3, "width": 4}]

    text_back = existing.read_text(encoding="utf-8")
    assert "// lead chart — hand-edited" in text_back      # header
    assert "// edited notes below" in text_back            # before-key (top level)
    assert "// bend on the downbeat" in text_back          # before-key (nested in note)
    assert "/* preserved from a prior save */" in text_back  # before-key (top level)


# ── save-time safety: _jsonc_save_text never corrupts the arrangement ─────────

def _round_trips_to(text, wire):
    """The written .jsonc must always parse back to the exact arrangement."""
    return _parse_jsonc(text) == wire


def test_save_text_falls_back_when_comment_would_corrupt():
    # A comment placed between a key's ':' and its value used to produce
    #   "capo": // pickme 0,
    # which strips to invalid JSON — silent save corruption. The guard now
    # validates the round-trip and falls back to plain JSON (comment dropped,
    # file valid) rather than write something that won't reload.
    orig = '{\n  "name": "Lead",\n  "capo": // pickme\n    0,\n  "notes": []\n}'
    wire = _parse_jsonc(orig)
    out = _jsonc_save_text(orig, wire)
    assert _round_trips_to(out, wire)          # never corrupt
    assert _parse_jsonc(out) == wire


@pytest.mark.parametrize("orig", [
    '{\n  "name": "Lead",\n  "capo": 0, // trailing\n  "notes": []\n}',
    '{\n  // before a key\n  "name": "Lead",\n  "capo": 0\n}',
    '// header\n{\n  "name": "Lead",\n  "capo": 0\n}',
    '{\n  "capo": 0 /* inline block */\n}',
    '{\n  "capo": 0\n  // trailing before close\n}',
    '{"name": "Lead", "notes": []}',           # no comments at all
])
def test_save_text_always_round_trips(orig):
    wire = _parse_jsonc(orig)
    out = _jsonc_save_text(orig, wire)
    assert _round_trips_to(out, wire)


def test_save_text_preserves_safe_comments():
    # The guard must not throw away a comment it CAN keep safely.
    orig = '{\n  // section A\n  "name": "Lead",\n  "capo": 0\n}'
    out = _jsonc_save_text(orig, _parse_jsonc(orig))
    assert "// section A" in out


def test_inline_comment_closes_line_comments():
    # A // line comment placed inline must become a CLOSED /* */ block comment,
    # not an unterminated /* that eats the rest of the file.
    assert _jsonc_inline_comment("// hi") == "/* hi */"
    assert _jsonc_inline_comment("//hi") == "/* hi */"
    assert _jsonc_inline_comment("/* x */") == "/* x */"   # block unchanged
    # An inline-rendered line comment is itself valid JSONC.
    assert _parse_jsonc('{"a": 1 ' + _jsonc_inline_comment("// c") + ', "b": 2}') == {"a": 1, "b": 2}
