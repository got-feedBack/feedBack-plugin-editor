"""Whole-song GP import keeps SEVERAL drum tracks as separate parts.

Before this, `convert_gp` folded every drum arrangement into ONE `drum_tab`
(`_drum_arrs_to_drum_tab([all of them])`), so a two-drummer / kit+aux-perc GP
came in as a single squashed drum part. `_gp_drum_arrs_to_parts` now splits
them: one tab per drum track, the first as the primary and the rest as
`drum_parts` (the shape a reload adopts and /build persists) — but only when a
melodic part exists to sit beside (a drums arrangement never sits at index 0),
so a drums-only import still folds.
"""
import sys
import types

import pytest

from routes import _gp_drum_arrs_to_parts

KICK, SNARE, HH_CLOSED = 36, 38, 42
CONGA_HI, TIMBALE = 62, 65  # outside the 18-piece vocab → unmapped

_FAKE_PIECES = {KICK: "kick", SNARE: "snare", HH_CLOSED: "hh_closed"}


@pytest.fixture(autouse=True)
def fake_core_drums(monkeypatch):
    mod = types.ModuleType("lib.drums")
    mod.midi_to_piece = lambda midi: _FAKE_PIECES.get(midi)
    mod.SCHEMA_VERSION = 1
    pkg = sys.modules.get("lib") or types.ModuleType("lib")
    monkeypatch.setitem(sys.modules, "lib", pkg)
    monkeypatch.setitem(sys.modules, "lib.drums", mod)


def note(midi, time=0.0):
    return {"string": midi // 24, "fret": midi % 24, "time": time}


def arr(name="Drums", notes=()):
    return {"name": name, "notes": list(notes), "chords": []}


def pieces(tab):
    return [h["p"] for h in tab["hits"]]


def test_several_drum_tracks_with_a_melodic_part_split_into_parts():
    a1 = arr("Drums", [note(KICK, 0.0), note(SNARE, 0.5)])
    a2 = arr("Percussion", [note(HH_CLOSED, 0.25)])
    primary, extras, unmapped = _gp_drum_arrs_to_parts([a1, a2], has_pitched=True)
    assert primary is not None
    assert primary["name"] == "Drums" and pieces(primary) == ["kick", "snare"]
    assert len(extras) == 1
    assert extras[0]["name"] == "Percussion"
    assert extras[0]["id"] == "", "id blank → the frontend assigns a fresh one"
    assert extras[0]["drum_tab"]["name"] == "Percussion"
    assert pieces(extras[0]["drum_tab"]) == ["hh_closed"]
    assert not unmapped


def test_a_single_drum_track_folds_with_no_extras():
    primary, extras, _ = _gp_drum_arrs_to_parts([arr("Drums", [note(KICK)])], has_pitched=True)
    assert pieces(primary) == ["kick"]
    assert extras == []


def test_drums_only_import_folds_even_with_several_tracks():
    # No melodic part → plural drum parts can't be represented (a drums
    # arrangement never sits at index 0), so fold — no loss, no split.
    a1 = arr("Drums", [note(KICK, 0.0)])
    a2 = arr("Percussion", [note(SNARE, 1.0)])
    primary, extras, _ = _gp_drum_arrs_to_parts([a1, a2], has_pitched=False)
    assert extras == []
    assert pieces(primary) == ["kick", "snare"], "both tracks folded, time-sorted"


def test_an_empty_leading_track_is_dropped_primary_is_first_with_hits():
    a1 = arr("Click", [])                 # no mappable hits
    a2 = arr("Drums", [note(KICK)])
    a3 = arr("Perc", [note(SNARE)])
    primary, extras, _ = _gp_drum_arrs_to_parts([a1, a2, a3], has_pitched=True)
    assert primary["name"] == "Drums"
    assert len(extras) == 1 and extras[0]["name"] == "Perc"


def test_all_unmapped_keeps_one_empty_tab_for_recovery():
    a1 = arr("Drums", [note(CONGA_HI, 0.0)])
    a2 = arr("Perc", [note(TIMBALE, 1.0)])
    primary, extras, unmapped = _gp_drum_arrs_to_parts([a1, a2], has_pitched=True)
    assert primary is not None and primary["hits"] == []
    assert extras == []
    assert set(unmapped) == {CONGA_HI, TIMBALE}


def test_nothing_mappable_and_nothing_to_remap_returns_none():
    primary, extras, unmapped = _gp_drum_arrs_to_parts([arr("Drums", [])], has_pitched=True)
    assert primary is None and extras == [] and not unmapped


def test_gp_track_name_is_preserved_and_length_capped():
    primary, extras, _ = _gp_drum_arrs_to_parts(
        [arr("D" * 200, [note(KICK)]), arr("Perc", [note(SNARE)])], has_pitched=True)
    assert primary["name"] == "D" * 120 and len(primary["name"]) == 120
    assert extras[0]["name"] == "Perc"
