"""MusicXML authored-notation preservation + the per-note `hand` field.

The keys LH/RH hand arc, slice A: a MusicXML import's grand-staff hand
assignments arrive two ways — the notation payload (preserved verbatim on the
authored-over-lift save rail, stamped ``source:"musicxml"``) and a per-note
``techniques.hand`` (``'lh'``/``'rh'``, registered in ``_NOTE_TECH_FIELDS``
so it rides the save wire and the content signature).

Rail tests reuse test_notation_save.py's core-lib discovery contract (skip
when core slopsmith lib isn't available); the field-registry and wire tests
are pure and always run.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest


def _discover_core_lib() -> Path | None:
    env = os.environ.get("SLOPSMITH_CORE_LIB")
    if env and (Path(env) / "notation_lift.py").is_file():
        return Path(env)
    candidates = [
        Path("/tmp/slop-notation-lift/lib"),
        Path.home() / "Repositories" / "slopsmith" / "lib",
    ]
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

from routes import (  # noqa: E402
    _NOTE_TECH_BOOL_FIELDS,
    _NOTE_TECH_FIELDS,
    _arr_dict_to_wire,
    _note_tech_default,
    _notes_fingerprint,
    _stamp_musicxml_notation,
)


# ── The `hand` field registry invariants ─────────────────────────────────────

def test_hand_registered_as_string_technique():
    assert "hand" in _NOTE_TECH_FIELDS
    # String-valued: _safe_bool would corrupt it, and the absent-attr default
    # must be None (unassigned), never False and never the -1 int sentinel.
    assert "hand" not in _NOTE_TECH_BOOL_FIELDS
    assert _note_tech_default("hand") is None


def _editor_note(t, midi, hand=None, sus=0.5):
    tech = {}
    if hand is not None:
        tech["hand"] = hand
    return {
        "time": t, "string": midi // 24, "fret": midi % 24,
        "sustain": sus, "techniques": tech,
    }


def _wire_of(notes, chords=()):
    return _arr_dict_to_wire("Piano", [0] * 6, 0, list(notes), list(chords), [])


def test_hand_rides_the_save_wire():
    wire = _wire_of([_editor_note(0.0, 60, "rh"), _editor_note(0.5, 48, "lh")])
    assert wire["notes"][0]["hand"] == "rh"
    assert wire["notes"][1]["hand"] == "lh"


def test_hand_omitted_when_unassigned():
    wire = _wire_of([_editor_note(0.0, 60)])
    assert "hand" not in wire["notes"][0]


@pytest.mark.parametrize("junk", ["LH", "left", "", True, 1, ["lh"], {"h": 1}])
def test_hand_junk_never_rides_the_wire(junk):
    wire = _wire_of([_editor_note(0.0, 60, junk)])
    assert "hand" not in wire["notes"][0]


def test_hand_edit_flips_the_notes_fingerprint():
    """A hand EDIT must invalidate a preserved authored notation payload —
    the sidecar's whole point is the hand split, so freezing it over an
    edited hand would silently show the old hands forever. `hand` is the
    ONE technique in the identity tuple; other technique edits still don't
    invalidate (they're irrelevant to keys/staff notation)."""
    base = [_editor_note(0.0, 60)]
    with_hand = [_editor_note(0.0, 60, "rh")]
    assert _notes_fingerprint(base, []) != _notes_fingerprint(with_hand, [])
    # Same hand, editor shape vs wire shape → SAME fingerprint (the
    # import-time / save-time agreement the rail depends on).
    wire_shape = [{"t": 0.0, "s": 2, "f": 12, "sus": 0.5, "hand": "rh"}]
    assert _notes_fingerprint(with_hand, []) == _notes_fingerprint(wire_shape, [])
    # A non-hand technique edit still leaves the fingerprint alone.
    with_pm = [dict(_editor_note(0.0, 60), techniques={"palm_mute": True})]
    assert _notes_fingerprint(base, []) == _notes_fingerprint(with_pm, [])
    # Junk hand values read as unassigned on both shapes.
    junk = [dict(_editor_note(0.0, 60), techniques={"hand": "LH"})]
    assert _notes_fingerprint(base, []) == _notes_fingerprint(junk, [])


def test_fingerprint_survives_stacked_unison_with_mixed_hands():
    """A doubled unison (two notes at the same pitch/time/duration — real in
    piano writing, e.g. both hands on one pitch) where one note carries a hand
    and the other doesn't yields two tuples identical in (t,s,f,sus) but
    differing only in the hand field. The sort inside _notes_fingerprint would
    then compare that field across the pair; a None sentinel makes it a
    None-vs-str compare and raises TypeError, crashing the save. Must not
    raise, and the mixed pair must fingerprint differently from an all-lh
    pair (the hand still counts)."""
    mixed = [_editor_note(0.0, 60, "lh"), _editor_note(0.0, 60)]
    both_lh = [_editor_note(0.0, 60, "lh"), _editor_note(0.0, 60, "lh")]
    # Neither call raises, and the assigned-vs-unassigned split still matters.
    assert _notes_fingerprint(mixed, []) != _notes_fingerprint(both_lh, [])
    # Same stacking inside a chord's member list must also be order-safe.
    chord = {"time": 0.0, "notes": [_editor_note(0.0, 60, "rh"), _editor_note(0.0, 60)]}
    assert _notes_fingerprint([], [chord])  # no raise → truthy hex digest


def test_hand_rides_chord_member_notes():
    chord = {
        "time": 0.0, "chord_id": 0, "high_density": False,
        "notes": [_editor_note(0.0, 60, "rh"), _editor_note(0.0, 48, "lh")],
    }
    wire = _wire_of([], [chord])
    hands = [cn.get("hand") for cn in wire["chords"][0]["notes"]]
    assert hands == ["rh", "lh"]


# ── add-arrangement stamping (`_stamp_musicxml_notation`) ────────────────────

def _payload(marker="authored"):
    return {
        "version": 1,
        "instrument": "piano",
        "staves": [{"id": "rh", "clef": "G2"}, {"id": "lh", "clef": "F4"}],
        "measures": [{"idx": 1, "t": 0.0, "marker": marker, "staves": {}}],
    }


def test_stamp_pops_payload_and_fingerprints_notes():
    arr = {"name": "Piano", "notes": [_editor_note(0.0, 60, "rh")],
           "chords": [], "notation": _payload()}
    stamped = _stamp_musicxml_notation(arr)
    assert "notation" not in arr  # never rides the session as dead weight
    assert stamped["source"] == "musicxml"
    assert stamped["source_notes_fp"] == _notes_fingerprint(arr["notes"], [])
    assert stamped["measures"][0]["marker"] == "authored"


def test_stamp_fp_flips_when_notes_differ():
    notes_a = [_editor_note(0.0, 60)]
    notes_b = [_editor_note(0.0, 62)]
    a = _stamp_musicxml_notation({"notes": notes_a, "notation": _payload()})
    b = _stamp_musicxml_notation({"notes": notes_b, "notation": _payload()})
    assert a["source_notes_fp"] != b["source_notes_fp"]


@pytest.mark.parametrize("bad", [None, "x", 7, {}, {"measures": []},
                                 {"no_measures": True}])
def test_stamp_rejects_unusable_payloads(bad):
    arr = {"notes": [], "notation": bad}
    assert _stamp_musicxml_notation(arr) is None
    assert "notation" not in arr


def test_stamp_noop_without_notation_key():
    arr = {"notes": [_editor_note(0.0, 60)]}
    assert _stamp_musicxml_notation(arr) is None


# ── The authored-over-lift rail honors source:"musicxml" ─────────────────────

pytestmark_core = pytest.mark.skipif(
    _CORE_LIB is None, reason="core slopsmith lib not found (set SLOPSMITH_CORE_LIB)")


def _beats_4_4(n, bpm=120.0):
    # Measure DOWNBEATS (matching test_notation_save.py's helper): one entry
    # per measure, `n` measures total.
    spm = 4 * 60.0 / bpm
    return [{"time": round(i * spm, 3), "measure": i} for i in range(n)]


def _keys_wire_one_note():
    return {
        "name": "Piano", "tuning": [0] * 6, "capo": 0,
        "notes": [{"t": 0.0, "s": 2, "f": 12, "sus": 0.5}],  # C4 (midi 60)
        "chords": [],
    }


def _valid_musicxml_payload(tmp_path, wire, beats):
    """A payload the validator accepts, distinguishable from a fresh lift:
    build it via the real lift, then stamp musicxml provenance and a marker."""
    import notation_lift
    payload = notation_lift.build_notation(
        notation_lift.decode_wire_notes(wire), beats, ts=(4, 4),
        instrument="piano")
    payload = json.loads(json.dumps(payload))
    payload["source"] = "musicxml"
    payload["source_notes_fp"] = _notes_fingerprint(
        wire["notes"], wire["chords"])
    payload["arranger"] = "authored-marker"  # survives only if kept verbatim
    return payload


@pytestmark_core
def test_musicxml_notation_kept_when_notes_unchanged(tmp_path):
    from routes import _write_keys_notation_sidecar
    wire = _keys_wire_one_note()
    beats = _beats_4_4(8)
    payload = _valid_musicxml_payload(tmp_path, wire, beats)
    entry = {"id": "piano", "name": "Piano"}
    nt = _write_keys_notation_sidecar(
        tmp_path, entry, wire, beats, gp_notation=payload)
    assert nt == "notation_piano.json"
    on_disk = json.loads((tmp_path / nt).read_text(encoding="utf-8"))
    assert on_disk["source"] == "musicxml"  # provenance preserved, not "gp"
    assert on_disk.get("arranger") == "authored-marker"  # kept verbatim


@pytestmark_core
def test_musicxml_sidecar_honored_on_reopen(tmp_path):
    """A reopened pak's on-disk source:'musicxml' sidecar is preserved by a
    no-edit save instead of being clobbered by a fresh heuristic lift."""
    from routes import _write_keys_notation_sidecar
    wire = _keys_wire_one_note()
    beats = _beats_4_4(8)
    payload = _valid_musicxml_payload(tmp_path, wire, beats)
    (tmp_path / "notation_piano.json").write_text(
        json.dumps(payload), encoding="utf-8")
    entry = {"id": "piano", "name": "Piano"}
    nt = _write_keys_notation_sidecar(tmp_path, entry, wire, beats)
    assert nt == "notation_piano.json"
    on_disk = json.loads((tmp_path / nt).read_text(encoding="utf-8"))
    assert on_disk["source"] == "musicxml"
    assert on_disk.get("arranger") == "authored-marker"


@pytestmark_core
def test_musicxml_notation_invalidated_by_note_edit(tmp_path):
    """Edits win: a stale fingerprint must not freeze import-time notation
    over the user's edited notes. A SINGLE-measure song, so the edit touches
    every measure → the measure-granular merge preserves 0 and the rail takes
    the plain full relift (multi-measure preservation is pinned by the GP
    tests in test_notation_save.py; the membership rule is shared)."""
    from routes import _write_keys_notation_sidecar
    wire = _keys_wire_one_note()
    beats = _beats_4_4(1)
    payload = _valid_musicxml_payload(tmp_path, wire, beats)
    edited = json.loads(json.dumps(wire))
    edited["notes"][0]["f"] = 14  # transpose: fp flips, measure content diffs
    entry = {"id": "piano", "name": "Piano"}
    nt = _write_keys_notation_sidecar(
        tmp_path, entry, edited, beats, gp_notation=payload)
    assert nt == "notation_piano.json"
    on_disk = json.loads((tmp_path / nt).read_text(encoding="utf-8"))
    assert on_disk.get("arranger") != "authored-marker"  # relifted, not frozen
