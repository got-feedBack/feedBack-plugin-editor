"""Filename BPM priors + the create-flow starter grid (TEMPO-ASSIST B).

A BPM carried in an audio file's name ("Song-147bpm.mp3") is an
opportunistic hint: it spaces the create flow's seed grid so the constant
starting point is already right. Absent → the 120 default, byte-identical
to the old literal seed. Never a gate, never a requirement.
"""

import pytest

from routes import _create_seed_beats, _filename_bpm


@pytest.mark.parametrize("name,bpm", [
    ("Song-147bpm.mp3", 147.0),
    ("147 BPM click.wav", 147.0),
    ("98.5bpm", 98.5),
    ("take2 bpm=104", 104.0),
    ("BPM 72 (rough)", 72.0),
    ("mix_bpm-133_v2.ogg", 133.0),
])
def test_filename_bpm_parses_standalone_values(name, bpm):
    assert _filename_bpm(name) == bpm


@pytest.mark.parametrize("name", [
    "Song.mp3",
    "2147bpm",       # a longer digit run is a hash/id, not a tempo
    "a147bpm",       # glued to a word is not a standalone value
    "147bpms",       # trailing letters break the unit word
    "39bpm",         # below the 40–300 sanity window
    "301bpm",        # above it
    "bpm",
    "",
    None,
])
def test_filename_bpm_rejects_junk(name):
    assert _filename_bpm(name) is None


def test_seed_beats_default_is_the_old_120_literal():
    assert _create_seed_beats(None) == [
        {"time": 0.0, "measure": 1},
        {"time": 0.5, "measure": -1},
        {"time": 1.0, "measure": -1},
        {"time": 1.5, "measure": -1},
        {"time": 2.0, "measure": 2},
    ]


def test_seed_beats_spaces_the_measure_at_the_hinted_bpm():
    beats = _create_seed_beats(150.0)
    assert [b["time"] for b in beats] == [0.0, 0.4, 0.8, 1.2, 1.6]
    assert [b["measure"] for b in beats] == [1, -1, -1, -1, 2]


def test_seed_beats_rounds_to_the_timeline_precision():
    beats = _create_seed_beats(147.0)
    for beat in beats:
        assert beat["time"] == round(beat["time"], 6)
    assert beats[4]["time"] == pytest.approx(4 * 60.0 / 147.0, abs=1e-6)
