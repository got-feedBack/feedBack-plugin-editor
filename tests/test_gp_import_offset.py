"""Regression: a GP import with an audio-sync lead-in must NOT drop the front
of the chart.

The scalar-offset import path used to bake the offset into the converted XML
(``convert_file(audio_offset=...)``). For any lead-in the resolved offset is
negative, so the front notes land at a NEGATIVE XML time — and core's
``parse_arrangement`` slices each level at ``t >= 0``, silently discarding
them (the reported "auto-sync deleted the front 16 notes" bug).

The fix converts at ``audio_offset=0.0`` and applies the offset to the PARSED
Song in memory via ``_apply_gp_import_offset`` (built on ``_apply_chart_offset``,
which preserves negative times). These assert the front notes survive and the
notation sidecars are retimed by the same amount. They fail on main, where
``_apply_gp_import_offset`` does not exist.
"""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace as NS

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import routes  # noqa: E402
from routes import _apply_gp_import_offset  # noqa: E402


def _note(t):
    return NS(time=t)


def _song(note_times):
    """A minimal but structurally complete Song for _apply_chart_offset."""
    arr = NS(
        notes=[_note(t) for t in note_times],
        chords=[],
        anchors=[],
        hand_shapes=[],
        phrases=[],
        tones=None,
    )
    return NS(arrangements=[arr], beats=[_note(0.0)],
              sections=[NS(start_time=0.0)], offset=0.0, song_length=10.0)


def test_leadin_offset_keeps_the_front_notes_at_negative_time():
    # A 1.0s lead-in: GP-sign negation resolves to provided_offset = -1.0.
    # convert_file would ADD that, so notes near t=0 go negative and were
    # dropped. The in-memory shift keeps every one.
    song = _song([0.0, 0.2, 1.5, 3.0])
    _apply_gp_import_offset(song, [], provided_offset=-1.0)
    times = [n.time for n in song.arrangements[0].notes]
    # Nothing dropped, and the front notes are preserved at negative time.
    assert len(times) == 4
    assert times == [-1.0, -0.8, 0.5, 2.0]
    # Beats and sections ride along; the residual chart offset is cleared.
    assert song.beats[0].time == -1.0
    assert song.sections[0].start_time == -1.0
    assert song.offset == 0.0


def test_positive_offset_shifts_forward_and_drops_nothing():
    song = _song([0.0, 1.0])
    _apply_gp_import_offset(song, [], provided_offset=0.5)
    assert [n.time for n in song.arrangements[0].notes] == [0.5, 1.5]


def test_zero_offset_is_a_noop():
    song = _song([0.0, 1.0])
    _apply_gp_import_offset(song, [], provided_offset=0.0)
    assert [n.time for n in song.arrangements[0].notes] == [0.0, 1.0]
    # song_length and offset untouched on the no-op path.
    assert song.song_length == 10.0


def test_sidecars_are_retimed_by_the_same_offset(monkeypatch):
    # Prove the sidecar path actually uses provided_offset (not just the notes):
    # capture the mapping callable handed to _warp_notation_sidecar.
    captured = {}

    def _fake_sidecar(xml_path, warp):
        captured[xml_path] = warp

    monkeypatch.setattr(routes, "_warp_notation_sidecar", _fake_sidecar)
    song = _song([0.0])
    _apply_gp_import_offset(song, ["a.xml", "b.xml"], provided_offset=-1.0)
    assert set(captured) == {"a.xml", "b.xml"}
    # convert_file ADDS the offset, so the sidecar remap is t -> t + offset.
    assert captured["a.xml"](5.0) == 4.0
    assert captured["b.xml"](0.0) == -1.0
