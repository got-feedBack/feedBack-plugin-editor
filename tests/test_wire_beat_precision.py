"""Regression: arrangement-JSON wire beat/section times keep 6-decimal precision.

The save paths write three beat-time serializations — `song_timeline.json`,
the arrangement XML `<ebeat>`s, and the DLC arrangement JSON `wire["beats"]` /
`wire["sections"]`. All three must agree on precision, else a downstream
consumer that derives tempo from the wire beat array sees drift the other two
don't. This pins the wire path to 6 decimals (was 3): a beat at 1.234560 must
serialize to 1.23456, not 1.235.
"""
from __future__ import annotations

from routes import _wire_beats_sections


def test_wire_beat_and_section_times_keep_six_decimals():
    # Nonzero 6th decimal on both so the assertion pins full 6dp, not 5dp/3dp.
    beats, sections = _wire_beats_sections(
        [{"time": 1.234561, "measure": 1}],
        [{"name": "intro", "number": 1, "start_time": 2.345671}],
    )
    # Full 6dp survives (fails at the old 3dp: 1.235 / 2.346).
    assert beats[0]["time"] == 1.234561, beats
    assert sections[0]["time"] == 2.345671, sections
    assert beats[0]["time"] != round(1.234561, 3), beats
    assert sections[0]["time"] != round(2.345671, 3), sections


def test_wire_constant_tempo_beat_survives_without_ms_drift():
    # 140 BPM => 0.428571 s/beat, doesn't land on a ms boundary. At 3dp the
    # third beat rounds to 0.857 (drift); at 6dp it stays 0.857142.
    spb = round(60.0 / 140.0, 6)
    beats, _ = _wire_beats_sections(
        [{"time": round(i * spb, 6), "measure": 1 if i == 0 else -1}
         for i in range(3)],
        [],
    )
    assert beats[2]["time"] == round(2 * spb, 6), beats[2]
    assert beats[2]["time"] != round(2 * spb, 3), beats[2]
