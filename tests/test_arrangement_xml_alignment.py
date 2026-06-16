"""Tests for archive arrangement <-> source-XML alignment (issue #425).

`lib.song.load_song` priority-sorts `song.arrangements` (Lead > Combo >
Rhythm > Bass), and the editor dropdown / `arrangement_index` follows that
order. The save path writes `xml_files[arrangement_index]`, so `xml_files`
MUST be in the same order. A raw rglob walk is in filesystem order, which
silently misrouted saves into the wrong arrangement — or raised "Invalid
arrangement index" when the lists diverged. These tests pin the pairing.

`_align_xml_files_to_arrangements` calls `from lib.song import
parse_arrangement`; we inject a fake `lib.song` so the test doesn't depend
on the Slopsmith core being importable in the plugin's CI env.
"""
import sys
import types
from pathlib import Path

import pytest

from routes import (
    _align_xml_files_to_arrangements,
    _arrangement_xml_candidates,
    _note_chord_signature,
    _NOTE_TECH_FIELDS,
)
import routes


# --- _note_chord_signature ------------------------------------------------

def test_signature_is_order_independent():
    a = _note_chord_signature(
        [(1.0, 0, 5, 0.0), (2.0, 1, 7, 0.5), (0.5, 2, 3, 0.0)],
        [(4.0, 1, ((0, 5), (1, 7))), (1.0, 2, ((2, 3),))],
    )
    b = _note_chord_signature(
        [(0.5, 2, 3, 0.0), (2.0, 1, 7, 0.5), (1.0, 0, 5, 0.0)],
        [(1.0, 2, ((2, 3),)), (4.0, 1, ((0, 5), (1, 7)))],
    )
    assert a == b


def test_signature_distinguishes_note_content():
    lead = _note_chord_signature([(1.0, 0, 5, 0.0), (2.0, 1, 7, 0.0)], [])
    rhythm = _note_chord_signature([(1.0, 0, 5, 0.0), (2.0, 1, 8, 0.0)], [])
    assert lead != rhythm


def test_signature_distinguishes_chord_voicing_and_sustain():
    # Same note positions, different chord shape -> distinct signature.
    base = _note_chord_signature([(1.0, 0, 5, 0.0)], [(2.0, 1, ((0, 5), (1, 7)))])
    other_voicing = _note_chord_signature(
        [(1.0, 0, 5, 0.0)], [(2.0, 1, ((0, 5), (1, 8)))]
    )
    assert base != other_voicing
    # Same positions/voicing, different sustain -> distinct signature.
    longer = _note_chord_signature([(1.0, 0, 5, 1.5)], [(2.0, 1, ((0, 5), (1, 7)))])
    short = _note_chord_signature([(1.0, 0, 5, 0.0)], [(2.0, 1, ((0, 5), (1, 7)))])
    assert longer != short


# --- fake lib.song.parse_arrangement --------------------------------------

class _FakeNote:
    def __init__(self, time, string, fret, sustain=0.0, **tech):
        self.time, self.string, self.fret = time, string, fret
        self.sustain = sustain
        # Mirror the Note dataclass technique surface the signature reads.
        for f in _NOTE_TECH_FIELDS:
            setattr(self, f, tech.get(f))


class _FakeChord:
    def __init__(self, time, chord_id=0, notes=(), high_density=False):
        self.time = time
        self.chord_id = chord_id
        self.high_density = high_density
        self.notes = [_FakeNote(time, s, f) for (s, f) in notes]


class _FakeArr:
    def __init__(self, notes, chords=()):
        self.notes = [_FakeNote(*n) for n in notes]
        self.chords = [_FakeChord(*c) for c in chords]


def _write_arr_xml(path: Path, arr_name: str = "Part Real_Guitar"):
    path.write_text(
        f"<song><arrangement>{arr_name}</arrangement></song>", encoding="utf-8"
    )


@pytest.fixture
def fake_lib_song(monkeypatch):
    """Install a fake `lib.song` whose parse_arrangement maps a path to a
    caller-registered note/chord set. Returns the registry dict."""
    by_path: dict[str, _FakeArr] = {}

    fake_song = types.ModuleType("lib.song")
    fake_song.parse_arrangement = lambda p: by_path[str(p)]
    fake_lib = types.ModuleType("lib")
    fake_lib.song = fake_song

    monkeypatch.setitem(sys.modules, "lib", fake_lib)
    monkeypatch.setitem(sys.modules, "lib.song", fake_song)
    return by_path


# --- _align_xml_files_to_arrangements -------------------------------------

def test_alignment_follows_result_order_not_filesystem_order(
    tmp_path, fake_lib_song, monkeypatch
):
    # Three arrangements with distinct note content.
    lead = tmp_path / "lead.xml"
    rhythm = tmp_path / "rhythm.xml"
    bass = tmp_path / "bass.xml"
    _write_arr_xml(lead)
    _write_arr_xml(rhythm)
    _write_arr_xml(bass)

    fake_lib_song[str(lead)] = _FakeArr([(1.0, 0, 5), (2.0, 1, 7)], [])
    fake_lib_song[str(rhythm)] = _FakeArr(
        [(1.0, 0, 5), (2.0, 1, 8)], [(3.0, 1, ((0, 5), (1, 8)))]
    )
    fake_lib_song[str(bass)] = _FakeArr([(0.5, 4, 3)], [])

    # Force the candidate (filesystem) order to be DIFFERENT from the result
    # order, so a broken implementation that just returns candidates can't
    # accidentally pass — the function must genuinely reorder.
    candidate_order = [str(bass), str(lead), str(rhythm)]
    monkeypatch.setattr(
        routes, "_arrangement_xml_candidates", lambda d: list(candidate_order)
    )

    # `result["arrangements"]` in load_song priority order (Lead, Rhythm,
    # Bass) — deliberately not matching the candidate order above.
    result = {
        "arrangements": [
            {"notes": [{"time": 2.0, "string": 1, "fret": 7},
                       {"time": 1.0, "string": 0, "fret": 5}], "chords": []},
            {"notes": [{"time": 1.0, "string": 0, "fret": 5},
                       {"time": 2.0, "string": 1, "fret": 8}],
             "chords": [{"time": 3.0, "chord_id": 1, "high_density": False,
                         "notes": [{"string": 0, "fret": 5},
                                   {"string": 1, "fret": 8}]}]},
            {"notes": [{"time": 0.5, "string": 4, "fret": 3}], "chords": []},
        ]
    }

    aligned = _align_xml_files_to_arrangements(str(tmp_path), result)
    assert aligned == [str(lead), str(rhythm), str(bass)]
    assert aligned != candidate_order  # proves a real reorder happened


def test_alignment_distinguishes_arrangements_differing_only_by_technique(
    tmp_path, fake_lib_song, monkeypatch
):
    # Two arrangements with byte-identical note positions/sustain/voicing,
    # differing ONLY in a technique flag. If the signature ignored
    # techniques they'd collide and fall back to filesystem order; with
    # techniques folded in they pair correctly. (Guards Copilot's review
    # point that the fingerprint must cover all authorable fields.)
    plain = tmp_path / "plain.xml"
    muted = tmp_path / "muted.xml"
    _write_arr_xml(plain)
    _write_arr_xml(muted)
    fake_lib_song[str(plain)] = _FakeArr([(1.0, 0, 5)])
    fake_lib_song[str(muted)] = _FakeArr([(1.0, 0, 5)])
    fake_lib_song[str(muted)].notes[0].palm_mute = True

    candidate_order = [str(plain), str(muted)]
    monkeypatch.setattr(
        routes, "_arrangement_xml_candidates", lambda d: list(candidate_order)
    )

    # Result order is the reverse: muted first, plain second.
    result = {
        "arrangements": [
            {"notes": [{"time": 1.0, "string": 0, "fret": 5,
                        "techniques": {"palm_mute": True}}], "chords": []},
            {"notes": [{"time": 1.0, "string": 0, "fret": 5}], "chords": []},
        ]
    }

    aligned = _align_xml_files_to_arrangements(str(tmp_path), result)
    assert aligned == [str(muted), str(plain)]


def test_alignment_falls_back_when_pairing_ambiguous(tmp_path, fake_lib_song):
    # Two content-identical arrangements -> signatures collide; the function
    # should fall back to raw candidate (filesystem) order rather than guess.
    a = tmp_path / "a.xml"
    b = tmp_path / "b.xml"
    _write_arr_xml(a)
    _write_arr_xml(b)
    fake_lib_song[str(a)] = _FakeArr([(1.0, 0, 5)], [])
    fake_lib_song[str(b)] = _FakeArr([(1.0, 0, 5)], [])

    result = {
        "arrangements": [
            {"notes": [{"time": 1.0, "string": 0, "fret": 5}], "chords": []},
            {"notes": [{"time": 1.0, "string": 0, "fret": 5}], "chords": []},
        ]
    }

    candidates = _arrangement_xml_candidates(str(tmp_path))
    aligned = _align_xml_files_to_arrangements(str(tmp_path), result)
    # Same membership, length preserved (never drops an arrangement's XML).
    assert sorted(aligned) == sorted(candidates)
    assert len(aligned) == 2


def test_candidates_skip_vocals_and_showlights(tmp_path):
    _write_arr_xml(tmp_path / "guitar.xml", "Part Real_Guitar")
    _write_arr_xml(tmp_path / "vocals.xml", "Vocals")
    _write_arr_xml(tmp_path / "show.xml", "ShowLights")
    (tmp_path / "notsong.xml").write_text("<foo/>", encoding="utf-8")

    candidates = _arrangement_xml_candidates(str(tmp_path))
    assert candidates == [str(tmp_path / "guitar.xml")]
