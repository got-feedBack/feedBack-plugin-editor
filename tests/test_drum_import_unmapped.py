"""The Create-New wizard must report percussion it can't place, not eat it.

Reported by =Scr4tch= (2026-07-17), confirmed across 10+ builds: importing
drums through the new-song wizard never offered to remap incompatible MIDI
numbers, but adding drums to an EXISTING pack in the editor did. Their
"I see it on the 2nd import but never the 1st" is the same fact from the
user's side — the first import is the wizard, later ones take the add route.

Root cause was in the wizard's converter, which dropped anything outside the
18-piece vocabulary with a bare `continue`. It now records those notes in the
same {midi, count, times} shape the add-drums route builds, so both feed the
one manual-mapping dialog.
"""
import sys
import types

import pytest

from routes import _drum_arrs_to_drum_tab

# GM percussion values that DO map to the 18-piece vocab.
KICK, SNARE, HH_CLOSED = 36, 38, 42
# Well outside it — the "incompatible midi numbers" from the report.
CONGA_HI, TIMBALE, AGOGO = 62, 65, 67

# The piece vocabulary lives in the HOST's `lib.drums`, which isn't importable
# in the plugin's test env — the same reason this converter sat nested and
# untested until now. Stub the mapping table (a dependency, never the subject:
# what's under test is which notes get collected and how, not core's GM table),
# following tests/test_midi_tempo_import.py's fake-core pattern.
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
    """A converter-shaped note: percussion packs midi as string*24 + fret."""
    return {"string": midi // 24, "fret": midi % 24, "time": time}


def chord(midis, time=0.0):
    return {"notes": [note(m, time) for m in midis]}


def arr(notes=(), chords=()):
    return {"name": "Drums", "notes": list(notes), "chords": list(chords)}


def test_mappable_notes_still_become_hits():
    tab = _drum_arrs_to_drum_tab([arr([note(KICK, 0.5), note(SNARE, 1.0)])])
    assert [h["p"] for h in tab["hits"]] == ["kick", "snare"]
    assert [h["t"] for h in tab["hits"]] == [0.5, 1.0]


def test_unmapped_notes_are_reported_not_silently_dropped():
    """The bug. Before the fix this dict came back empty."""
    unmapped = {}
    tab = _drum_arrs_to_drum_tab(
        [arr([note(KICK, 0.0), note(CONGA_HI, 0.25), note(TIMBALE, 0.5)])],
        out_unmapped=unmapped,
    )
    # The mappable note still lands.
    assert [h["p"] for h in tab["hits"]] == ["kick"]
    # …and the two that don't are now accounted for.
    assert set(unmapped) == {CONGA_HI, TIMBALE}
    assert unmapped[CONGA_HI]["count"] == 1
    assert unmapped[CONGA_HI]["times"] == [0.25]


def test_repeated_unmapped_notes_accumulate_per_midi_value():
    unmapped = {}
    _drum_arrs_to_drum_tab(
        [arr([note(AGOGO, t) for t in (0.0, 0.5, 1.0)])],
        out_unmapped=unmapped,
    )
    assert unmapped[AGOGO]["count"] == 3
    assert unmapped[AGOGO]["times"] == [0.0, 0.5, 1.0]


def test_unmapped_notes_inside_chords_are_caught_too():
    """Simultaneous hits arrive as chords; the old code had a second, separate
    `continue` for that branch, so a chord could leak unmapped notes even once
    the note branch was fixed."""
    unmapped = {}
    tab = _drum_arrs_to_drum_tab(
        [arr(chords=[chord([KICK, CONGA_HI], 2.0)])],
        out_unmapped=unmapped,
    )
    assert [h["p"] for h in tab["hits"]] == ["kick"]
    assert unmapped[CONGA_HI]["count"] == 1
    assert unmapped[CONGA_HI]["times"] == [2.0]


def test_time_sample_list_is_bounded():
    """A pathological import must not build an unbounded times[] — the add
    route caps at 64 and this has to match, or the two dialogs disagree about
    how much they can place."""
    unmapped = {}
    _drum_arrs_to_drum_tab(
        [arr([note(AGOGO, i * 0.01) for i in range(500)])],
        out_unmapped=unmapped,
    )
    assert unmapped[AGOGO]["count"] == 500, "every note is still counted"
    assert len(unmapped[AGOGO]["times"]) == 64, "but the samples are capped"


def test_out_unmapped_is_optional():
    """Callers that don't care must keep working — the parameter was added to
    an existing signature."""
    tab = _drum_arrs_to_drum_tab([arr([note(KICK), note(CONGA_HI)])])
    assert [h["p"] for h in tab["hits"]] == ["kick"]


def test_malformed_notes_are_skipped_without_being_reported():
    """A note with no usable string/fret isn't 'unmapped percussion' — it's
    junk. Reporting it would put a meaningless row in the mapping dialog."""
    unmapped = {}
    tab = _drum_arrs_to_drum_tab(
        [arr([{"time": 0.0}, {"string": "x", "fret": "y"}, note(KICK)])],
        out_unmapped=unmapped,
    )
    assert [h["p"] for h in tab["hits"]] == ["kick"]
    assert unmapped == {}


def test_hits_stay_time_sorted_across_arrangements():
    tab = _drum_arrs_to_drum_tab([
        arr([note(SNARE, 2.0)]),
        arr([note(KICK, 0.5), note(HH_CLOSED, 1.0)]),
    ])
    assert [h["t"] for h in tab["hits"]] == [0.5, 1.0, 2.0]


@pytest.mark.parametrize("midi", [CONGA_HI, TIMBALE, AGOGO])
def test_reported_shape_matches_the_add_drums_contract(midi):
    """Both routes feed the same dialog, which reads {midi, count, times}."""
    unmapped = {}
    _drum_arrs_to_drum_tab([arr([note(midi, 1.25)])], out_unmapped=unmapped)
    rec = unmapped[midi]
    assert set(rec) == {"count", "times"}
    assert isinstance(rec["count"], int)
    assert isinstance(rec["times"], list)
