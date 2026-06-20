"""Tests for .jsonc support in the Arrangement Editor (feedpak-spec §8).

The editor reads the existing arrangement JSON to preserve
anchors/handshapes/phrases/tones on save, and re-writes the arrangement file.
For ``.jsonc`` arrangements both sides must be comment-aware: the read strips
comments, the write preserves top-level comments (phase 1 — header, before-key,
trailing, footer; comments inside nested arrays/objects are dropped, the
documented phase-1 limitation).

These cover the four helpers in ``routes.py``: ``_parse_jsonc``,
``_load_arrangement_json``, ``_extract_jsonc_top_comments``, and
``_preserve_jsonc_comments`` — the read site and the write site both delegate
to them.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from routes import (  # noqa: E402
    _extract_jsonc_top_comments,
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


# ── _extract_jsonc_top_comments ──────────────────────────────────────────────

def test_extract_header_and_footer_comments():
    text = '// header\n/* block header */\n{"a": 1}\n// footer\n'
    out = _extract_jsonc_top_comments(text)
    assert out["header"] == ["// header", "/* block header */"]
    assert out["footer"] == ["// footer"]
    assert out["before_key"] == {}
    assert out["trailing"] == []


def test_extract_before_key_comments():
    text = (
        '{\n'
        '  // before-a\n'
        '  "a": 1,\n'
        '  /* before-b */\n'
        '  "b": 2\n'
        '}'
    )
    out = _extract_jsonc_top_comments(text)
    assert out["before_key"] == {"a": ["// before-a"], "b": ["/* before-b */"]}
    assert out["header"] == []
    assert out["footer"] == []


def test_extract_trailing_comment_before_closing_brace():
    text = '{"a": 1\n  // trailing\n}'
    out = _extract_jsonc_top_comments(text)
    assert out["trailing"] == ["// trailing"]


def test_extract_drops_nested_comments():
    """Comments inside nested arrays/objects (depth > 1) are not captured —
    the documented phase-1 limitation."""
    text = (
        '{\n'
        '  "notes": [\n'
        '    // inside the notes array — NOT captured\n'
        '    {"t": 0}\n'
        '  ]\n'
        '}'
    )
    out = _extract_jsonc_top_comments(text)
    assert out["before_key"] == {}  # the comment is inside notes[], not before a top-level key
    assert out["header"] == []
    assert out["trailing"] == []
    assert out["footer"] == []


# ── _preserve_jsonc_comments (round trip) ────────────────────────────────────

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
    # Parses back to the same data.
    assert _parse_jsonc(out) == wire
    # All comment blocks preserved.
    assert "// header line" in out
    assert "/* block header */" in out
    assert "// before notes" in out
    assert "/* before beats */" in out
    assert "// trailing comment" in out
    assert "// footer" in out
    # Footer sits on its own line after the closing brace.
    assert "}\n// footer" in out


def test_round_trip_drops_comments_for_removed_keys():
    """If a top-level key was removed from the new wire, its before-key comment
    is dropped (acceptable for phase 1)."""
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


def test_round_trip_nested_comments_are_dropped():
    """Comments inside nested arrays/objects are not preserved (phase 1)."""
    original = (
        '{\n'
        '  "notes": [\n'
        '    // inside notes — will be dropped\n'
        '    {"t": 0}\n'
        '  ]\n'
        '}'
    )
    wire = {"notes": [{"t": 0}]}
    out = _preserve_jsonc_comments(original, json.dumps(wire, indent=2))
    assert _parse_jsonc(out) == wire
    assert "// inside notes" not in out


# ── Combined read → modify → write round trip (the editor's save path) ───────

def test_jsonc_arrangement_save_round_trip(tmp_path: Path):
    """Simulate the editor's save path on a .jsonc arrangement:

    1. existing .jsonc arrangement on disk (with comments + preserved anchors)
    2. read it via _load_arrangement_json (read site)
    3. merge preserved fields into the new wire (as save_song does)
    4. write it back via _preserve_jsonc_comments (write site)
    5. read it again — comments survive at top level, anchors survive in data
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
        '  "notes": [{"t": 0.5, "s": 0, "f": 5, "sus": 0}],\n'
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

    # 2. new wire from the editor (notes edited; anchors not in the UI body).
    new_wire = {
        "name": "Lead", "tuning": [0, 0, 0, 0, 0, 0], "capo": 0,
        "notes": [{"t": 0.5, "s": 0, "f": 5, "sus": 0}, {"t": 1.0, "s": 1, "f": 3}],
        "chords": [], "templates": [],
    }
    # 3. merge preserved fields (mirrors save_song's merge).
    new_wire["anchors"] = preserved.get("anchors", [])

    # 4. write site: preserve comments, serialize pretty-printed.
    original_text = existing.read_text(encoding="utf-8")
    written = _preserve_jsonc_comments(original_text, json.dumps(new_wire, indent=2))
    existing.write_text(written, encoding="utf-8")

    # 5. read back: data correct, top-level comments survived.
    back = _load_arrangement_json(existing)
    assert len(back["notes"]) == 2          # the edited note count
    assert back["notes"][1]["f"] == 3
    assert back["anchors"] == [{"time": 1.0, "fret": 3, "width": 4}]  # preserved

    text_back = existing.read_text(encoding="utf-8")
    assert "// lead chart — hand-edited" in text_back   # header preserved
    assert "// edited notes below" in text_back           # before-key preserved
    assert "/* preserved from a prior save */" in text_back  # before-key preserved
