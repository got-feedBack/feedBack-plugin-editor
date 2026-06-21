"""Tests for _apply_chart_offset — the start-offset resolution used by the
EOF/arrangement-XML import to make chart times audio-absolute. Regression
coverage for two gaps found in review of #27: chord notes at exactly t=0 were
skipped, and tone-change times were not shifted."""

from __future__ import annotations

from types import SimpleNamespace as NS

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from routes import _apply_chart_offset  # noqa: E402


def _song():
    def note(t):
        return NS(time=t)

    def chord(t, cn_times):
        return NS(time=t, notes=[note(ct) for ct in cn_times])

    def hs(s, e):
        return NS(start_time=s, end_time=e)

    lvl = NS(notes=[note(1.0)], chords=[chord(2.0, [2.0, 0.0])],
             anchors=[note(1.0)], hand_shapes=[hs(1.0, 2.0)])
    phrase = NS(start_time=0.0, end_time=3.0, levels=[lvl])
    arr = NS(
        notes=[note(1.0), note(0.0)],            # incl. a note at the origin
        chords=[chord(0.5, [0.5, 0.0])],         # chord note at exactly 0.0
        anchors=[note(2.0)],
        hand_shapes=[hs(1.0, 2.5)],
        phrases=[phrase],
        tones={"base": "x", "changes": [{"t": 1.0, "name": "a"},
                                        {"time": 2.0, "name": "b"}],
               "definitions": []},
    )
    return NS(arrangements=[arr], beats=[note(1.0)],
              sections=[NS(start_time=1.0)], offset=0.0)


def test_zero_delta_is_noop():
    s = _song()
    _apply_chart_offset(s, 0.0)
    assert s.arrangements[0].notes[0].time == 1.0


def test_shifts_all_absolute_times_including_chord_note_at_zero():
    s = _song()
    _apply_chart_offset(s, 0.5)
    arr = s.arrangements[0]
    assert [n.time for n in arr.notes] == [0.5, -0.5]
    ch = arr.chords[0]
    assert ch.time == 0.0
    # The chord note at exactly 0.0 must move with its chord (was the bug).
    assert [cn.time for cn in ch.notes] == [0.0, -0.5]
    assert arr.anchors[0].time == 1.5
    assert (arr.hand_shapes[0].start_time, arr.hand_shapes[0].end_time) == (0.5, 2.0)
    ph = arr.phrases[0]
    assert (ph.start_time, ph.end_time) == (-0.5, 2.5)
    assert [cn.time for cn in ph.levels[0].chords[0].notes] == [1.5, -0.5]
    assert s.beats[0].time == 0.5
    assert s.sections[0].start_time == 0.5
    assert s.offset == 0.0


def test_shifts_tone_change_times():
    s = _song()
    _apply_chart_offset(s, 0.5)
    changes = s.arrangements[0].tones["changes"]
    assert changes[0]["t"] == 0.5      # "t"-keyed change shifted
    assert changes[1]["time"] == 1.5   # "time"-keyed change shifted
    assert changes[0]["name"] == "a"   # non-time fields untouched


def test_tolerates_missing_optional_collections():
    arr = NS(notes=[NS(time=1.0)], chords=[], anchors=[], hand_shapes=[],
             phrases=None, tones=None)
    s = NS(arrangements=[arr], beats=[], sections=[], offset=0.0)
    _apply_chart_offset(s, 0.25)        # must not raise on None phrases/tones
    assert arr.notes[0].time == 0.75
