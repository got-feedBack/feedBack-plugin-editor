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
from routes import (  # noqa: E402
    _notes_fingerprint,
    _write_keys_notation_sidecar,
)


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


# ── GP-sourced notation provenance (source:"gp" + fingerprint) ────────────────

def _valid_gp_payload(tmp_path, wire, beats, *, marker="from-gp"):
    """A schema-valid notation payload, produced by running the lift once, then
    stamped as GP-sourced (with a marker so we can tell it apart from a fresh
    lift) and fingerprinted against ``wire``."""
    seed = {"id": "seed", "name": "Keys", "file": "arrangements/seed.json"}
    assert _write_keys_notation_sidecar(tmp_path, seed, wire, beats)
    payload = json.loads((tmp_path / "notation_seed.json").read_text())
    (tmp_path / "notation_seed.json").unlink()
    payload["source"] = "gp"
    payload["source_notes_fp"] = _notes_fingerprint(wire.get("notes"), wire.get("chords"))
    payload["_marker"] = marker
    return payload


def test_notes_fingerprint_agrees_across_editor_and_wire_shapes():
    # Same notes in editor shape ({time,string,fret,sustain}) and wire shape
    # ({t,s,f,sus}) must fingerprint identically — that equality is what lets
    # the import-time stamp match the save-time wire when nothing was edited.
    editor = [{"time": 0.0, "string": 2, "fret": 12, "sustain": 0.5}]
    wire = [{"t": 0.0, "s": 2, "f": 12, "sus": 0.5}]
    assert _notes_fingerprint(editor, []) == _notes_fingerprint(wire, [])
    # A pitch change flips it.
    assert _notes_fingerprint(editor, []) != _notes_fingerprint(
        [{"time": 0.0, "string": 2, "fret": 13, "sustain": 0.5}], [])


def test_gp_notation_kept_when_notes_unchanged(tmp_path):
    wire = _keys_wire()
    beats = _beats_4_4(2)
    gp = _valid_gp_payload(tmp_path, wire, beats)

    entry = {"id": "keys", "name": "Keys", "file": "arrangements/keys.json"}
    nt = _write_keys_notation_sidecar(tmp_path, entry, wire, beats, gp_notation=gp)
    assert nt == "notation_keys.json"
    payload = json.loads((tmp_path / "notation_keys.json").read_text())
    # GP payload was kept (marker + provenance survive), NOT re-derived by lift.
    assert payload["source"] == "gp"
    assert payload["_marker"] == "from-gp"


def test_gp_notation_invalidated_when_notes_edited(tmp_path):
    # gp_notation whose fingerprint no longer matches the wire (the user edited
    # notes since import) must be ignored — the lift re-derives from the edits.
    beats = _beats_4_4(2)
    gp = _valid_gp_payload(tmp_path, _keys_wire(), beats)
    gp["source_notes_fp"] = "stale-fingerprint-000"

    entry = {"id": "keys", "name": "Keys", "file": "arrangements/keys.json"}
    nt = _write_keys_notation_sidecar(tmp_path, entry, _keys_wire(), beats, gp_notation=gp)
    assert nt == "notation_keys.json"
    payload = json.loads((tmp_path / "notation_keys.json").read_text())
    assert payload.get("source") != "gp"      # lift output, not the frozen GP one
    assert "_marker" not in payload


def test_gp_notation_survives_reopen_via_on_disk_sidecar(tmp_path):
    # Reopen path: no gp_notation forwarded from the client, but an on-disk
    # source:"gp" sidecar exists. An untouched-notes save keeps it.
    wire = _keys_wire()
    beats = _beats_4_4(2)
    gp = _valid_gp_payload(tmp_path, wire, beats)
    (tmp_path / "notation_keys.json").write_text(json.dumps(gp), encoding="utf-8")

    entry = {"id": "keys", "name": "Keys", "file": "arrangements/keys.json"}
    _write_keys_notation_sidecar(tmp_path, entry, wire, beats, gp_notation=None)
    payload = json.loads((tmp_path / "notation_keys.json").read_text())
    assert payload["source"] == "gp" and payload["_marker"] == "from-gp"

    # ...but once the notes change, the on-disk GP sidecar is no longer kept.
    edited = _keys_wire()
    edited["notes"].append(_wire_note(1.0, 72, 0.25))
    _write_keys_notation_sidecar(tmp_path, entry, edited, beats, gp_notation=None)
    payload2 = json.loads((tmp_path / "notation_keys.json").read_text())
    assert payload2.get("source") != "gp" and "_marker" not in payload2


def test_invalid_gp_payload_falls_back_to_lift(tmp_path):
    # A GP payload that fails the notation schema (missing required `staves`)
    # must never be written as a server-vouched sidecar — fall back to the lift.
    wire = _keys_wire()
    beats = _beats_4_4(2)
    bad = {
        "source": "gp",
        "source_notes_fp": _notes_fingerprint(wire["notes"], wire["chords"]),
        "instrument": "piano",
        "measures": [],           # missing "staves" → invalid
        "_marker": "from-gp",
    }
    entry = {"id": "keys", "name": "Keys", "file": "arrangements/keys.json"}
    nt = _write_keys_notation_sidecar(tmp_path, entry, wire, beats, gp_notation=bad)
    assert nt == "notation_keys.json"
    payload = json.loads((tmp_path / "notation_keys.json").read_text())
    assert payload.get("source") != "gp" and "_marker" not in payload


def test_gp_notation_never_stamped_onto_entry_for_non_keys(tmp_path):
    # Leak guard: even handed a GP payload, a non-keys arrangement writes no
    # sidecar and the helper never puts _gp_notation (or notation) on the entry.
    entry = {"id": "lead", "name": "Lead Guitar", "file": "arrangements/lead.json"}
    gp = {"source": "gp", "source_notes_fp": "x", "staves": [], "measures": []}
    assert _write_keys_notation_sidecar(
        tmp_path, entry, _keys_wire(), _beats_4_4(2), gp_notation=gp) is None
    assert "notation" not in entry and "_gp_notation" not in entry
    assert not list(tmp_path.glob("notation_*.json"))


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
