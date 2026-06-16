"""Tests for round-trip load: _populate_notation_notes (routes.py).

A notation-only arrangement loads with an empty note list; the loader populates
its piano-roll notes from the notation via the shared core flattener. A
dual-written arrangement (already has wire notes) is left untouched.

Exercises the real core `lib/notation.notation_to_notes`; discovers a core
`lib/` on disk (SLOPSMITH_CORE_LIB env or a sibling checkout) and skips if none.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest


def _discover_core_lib() -> "Path | None":
    """Locate a core `lib/` carrying notation_to_notes: the SLOPSMITH_CORE_LIB
    env var first, else a sibling slopsmith checkout under ~/Repositories."""
    cands = []
    env = os.environ.get("SLOPSMITH_CORE_LIB")
    if env:
        cands.append(Path(env))
    repos = Path.home() / "Repositories"
    if repos.is_dir():
        cands += sorted(repos.glob("slopsmith*/lib"))
    for c in cands:
        nt = c / "notation.py"
        # Require the new flattener so we test against a current core.
        if nt.is_file() and "notation_to_notes" in nt.read_text():
            return c
    return None


_CORE_LIB = _discover_core_lib()
if _CORE_LIB:
    # `import notation` (lib dir on path) AND `from lib import notation` (repo
    # root on path, the form routes.py uses) must both resolve.
    for p in (str(_CORE_LIB), str(_CORE_LIB.parent)):
        if p not in sys.path:
            sys.path.insert(0, p)

pytest.importorskip("notation", reason="core lib/notation.py with notation_to_notes not found")
import notation  # noqa: E402  (assert the symbol exists)
if not hasattr(notation, "notation_to_notes"):
    pytest.skip("core notation lacks notation_to_notes", allow_module_level=True)

from routes import _populate_notation_notes  # noqa: E402


def _notation():
    return {
        "version": 1, "instrument": "piano",
        "staves": [{"id": "rh", "clef": "G2"}, {"id": "lh", "clef": "F4"}],
        "measures": [{
            "idx": 1, "t": 0.0, "ts": [4, 4], "tempo": 120.0,
            "staves": {
                "rh": {"voices": [{"v": 1, "beats": [
                    {"t": 0.0, "dur": 4, "notes": [{"midi": 67}]},
                    {"t": 0.5, "dur": 4, "notes": [{"midi": 64}]},
                ]}]},
                "lh": {"voices": [{"v": 1, "beats": [
                    {"t": 0.0, "dur": 2, "notes": [{"midi": 48}]},
                ]}]},
            },
        }],
    }


def test_populates_empty_notation_only_arrangement():
    arrangements = [{"id": "keys", "name": "Keys", "notes": []}]
    _populate_notation_notes(arrangements, {"keys": _notation()})
    notes = arrangements[0]["notes"]
    assert len(notes) == 3
    # Pitch round-trips through string*24 + fret; both hands present.
    midis = sorted(n["string"] * 24 + n["fret"] for n in notes)
    assert midis == [48, 64, 67]
    assert all(n["techniques"] == {} for n in notes)
    assert all("time" in n and "sustain" in n for n in notes)


def test_does_not_overwrite_existing_wire_notes():
    existing = [{"time": 0.0, "string": 2, "fret": 0, "sustain": 0.1, "techniques": {}}]
    arrangements = [{"id": "keys", "name": "Keys", "notes": list(existing)}]
    _populate_notation_notes(arrangements, {"keys": _notation()})
    assert arrangements[0]["notes"] == existing  # untouched (dual-write keeps wire)


def test_does_not_touch_chord_only_wire_arrangement():
    # A dual-written arrangement whose wire is chord-only (no top-level notes but
    # has chords) must stay authoritative — no notation notes injected.
    arrangements = [{"id": "keys", "name": "Keys", "notes": [],
                     "chords": [{"time": 0.0, "chord_id": 1, "notes": []}]}]
    _populate_notation_notes(arrangements, {"keys": _notation()})
    assert arrangements[0]["notes"] == []


def test_no_notation_is_noop():
    arrangements = [{"id": "lead", "name": "Lead", "notes": []}]
    _populate_notation_notes(arrangements, {"keys": _notation()})  # id mismatch
    assert arrangements[0]["notes"] == []
    _populate_notation_notes(arrangements, None)  # no notation map
    assert arrangements[0]["notes"] == []
