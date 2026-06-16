"""Tests for the editor's keys → notation save path.

Covers ``_write_keys_notation_sidecar`` (routes.py): a keys-family arrangement
is dual-written — the legacy wire arrangement plus a ``notation_<id>.json``
sidecar — and the per-arrangement ``notation:`` manifest key is stamped onto the
entry. Non-keys arrangements, unsafe ids, and content with no liftable
downbeats fall back to legacy wire only.

These exercise the real shared core in slopsmith ``lib/notation_lift.py``; the
test discovers a core ``lib/`` on disk (``SLOPSMITH_CORE_LIB`` env var or a
sibling checkout) and skips when none is available — mirroring conftest's
"runs where the plugin's runtime deps are installed" assumption.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest
import yaml


# ── Make core slopsmith lib importable (the host app puts it on the path) ─────

def _discover_core_lib() -> Path | None:
    env = os.environ.get("SLOPSMITH_CORE_LIB")
    if env and (Path(env) / "notation_lift.py").is_file():
        return Path(env)
    candidates = [
        Path("/tmp/slop-notation-lift/lib"),
        Path.home() / "Repositories" / "slopsmith" / "lib",
    ]
    # Any sibling repo checkout that carries the extracted module.
    repos = Path.home() / "Repositories"
    if repos.is_dir():
        candidates += sorted(repos.glob("slopsmith*/lib"))
    for c in candidates:
        if (c / "notation_lift.py").is_file():
            return c
    return None


_CORE_LIB = _discover_core_lib()
if _CORE_LIB and str(_CORE_LIB) not in sys.path:
    sys.path.insert(0, str(_CORE_LIB))

pytest.importorskip(
    "notation_lift",
    reason="core slopsmith lib/notation_lift.py not found (set SLOPSMITH_CORE_LIB)",
)

import notation  # noqa: E402  (core lib, now on path)
from routes import _write_keys_notation_sidecar  # noqa: E402


# ── Helpers ──────────────────────────────────────────────────────────────────

def _wire_note(t: float, midi: int, sus: float = 0.0) -> dict:
    """Editor wire note: midi packed as s*24 + f."""
    return {"t": t, "s": midi // 24, "f": midi % 24, "sus": sus}


def _beats_4_4(n: int, bpm: float = 120.0) -> list[dict]:
    spm = 4 * 60.0 / bpm
    return [{"time": round(i * spm, 3), "measure": i} for i in range(n)]


def _keys_wire() -> dict:
    return {
        "name": "Keys",
        "notes": [
            _wire_note(0.0, 60, 0.5), _wire_note(0.0, 48, 0.5),  # both hands
            _wire_note(0.5, 64, 0.5),
        ],
        "chords": [],
    }


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_dual_write_emits_notation_and_stamps_manifest_key(tmp_path):
    entry = {"id": "keys", "name": "Keys", "file": "arrangements/keys.json"}
    nt_name = _write_keys_notation_sidecar(
        tmp_path, entry, _keys_wire(), _beats_4_4(2))

    assert nt_name == "notation_keys.json"
    # Manifest key stamped onto the entry that the save loop will dump.
    assert entry["notation"] == "notation_keys.json"
    # Legacy file path is untouched (dual-write — caller still wrote the wire).
    assert entry["file"] == "arrangements/keys.json"

    nt_path = tmp_path / "notation_keys.json"
    assert nt_path.is_file()
    payload = json.loads(nt_path.read_text())
    ok, reason = notation.validate_notation(payload)
    assert ok, reason
    assert payload["instrument"] == "piano"
    assert {s["id"] for s in payload["staves"]} == {"rh", "lh"}


def test_non_keys_arrangement_is_skipped(tmp_path):
    entry = {"id": "lead", "name": "Lead Guitar", "file": "arrangements/lead.json"}
    assert _write_keys_notation_sidecar(tmp_path, entry, _keys_wire(), _beats_4_4(2)) is None
    assert "notation" not in entry
    assert not list(tmp_path.glob("notation_*.json"))


def test_no_downbeats_falls_back_to_legacy_only(tmp_path):
    entry = {"id": "keys", "name": "Keys", "file": "arrangements/keys.json"}
    # Empty beats → no downbeats → build_notation returns None → legacy wire only.
    assert _write_keys_notation_sidecar(tmp_path, entry, _keys_wire(), []) is None
    assert "notation" not in entry
    assert not list(tmp_path.glob("notation_*.json"))


def test_empty_notes_falls_back_to_legacy_only(tmp_path):
    entry = {"id": "piano", "name": "Piano", "file": "arrangements/piano.json"}
    wire = {"name": "Piano", "notes": [], "chords": []}
    assert _write_keys_notation_sidecar(tmp_path, entry, wire, _beats_4_4(2)) is None
    assert "notation" not in entry


def test_unsafe_id_is_skipped(tmp_path):
    entry = {"id": "../evil", "name": "Keys", "file": "arrangements/keys.json"}
    assert _write_keys_notation_sidecar(tmp_path, entry, _keys_wire(), _beats_4_4(2)) is None
    assert "notation" not in entry
    assert not list(tmp_path.glob("notation_*.json"))


def test_stale_notation_cleared_when_no_longer_liftable(tmp_path):
    # Re-saving a keys arrangement that previously had notation but now has no
    # liftable content must clear the stale manifest key AND remove the old
    # sidecar, so notation renderers don't strand on data that no longer matches
    # the just-saved wire.
    entry = {"id": "keys", "name": "Keys", "file": "arrangements/keys.json"}
    # First save: real notation written.
    assert _write_keys_notation_sidecar(tmp_path, entry, _keys_wire(), _beats_4_4(2))
    assert entry["notation"] == "notation_keys.json"
    assert (tmp_path / "notation_keys.json").is_file()

    # Second save: notes cleared → nothing to lift → stale key + file dropped.
    empty_wire = {"name": "Keys", "notes": [], "chords": []}
    assert _write_keys_notation_sidecar(tmp_path, entry, empty_wire, _beats_4_4(2)) is None
    assert "notation" not in entry
    assert not (tmp_path / "notation_keys.json").exists()


def test_notation_round_trips_chord_notes(tmp_path):
    # Chord notes (no own time) should be decoded at the chord's time and land
    # in the sidecar — exercises the import/live-record chord path too.
    entry = {"id": "keys", "name": "Keys", "file": "arrangements/keys.json"}
    wire = {
        "name": "Keys",
        "notes": [],
        "chords": [{"t": 0.0, "notes": [{"s": 60 // 24, "f": 60 % 24},
                                        {"s": 64 // 24, "f": 64 % 24}]}],
    }
    nt_name = _write_keys_notation_sidecar(tmp_path, entry, wire, _beats_4_4(1))
    assert nt_name == "notation_keys.json"
    payload = json.loads((tmp_path / "notation_keys.json").read_text())
    ok, reason = notation.validate_notation(payload)
    assert ok, reason
    midis = {
        n["midi"]
        for m in payload["measures"]
        for st in m["staves"].values()
        for v in st["voices"]
        for b in v["beats"]
        for n in b["notes"]
    }
    assert {60, 64} <= midis
