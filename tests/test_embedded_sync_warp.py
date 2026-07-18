"""Tests for the embedded-audio warp gate.

A GP8 file can carry its own backing track AND its own sync points. The
create flow used embedded audio with an offset only and DISCARDED the
sync points, so a chart stayed at a constant tempo against a recording
that changes tempo.

Reported from a real chart whose audio drops 137 -> 98.7 BPM at bar 193:
the chart ran ~5.5 s early by bar 224.

These fail on main, where `_warp_applies` / `_gp_sync_points_to_warp_payload`
don't exist and the handler excluded embedded mode outright.
"""

import math

from routes import _gp_sync_points_to_warp_payload, _warp_applies


class _SP:
    """Stand-in for lib.gp8_audio_sync.SyncPoint (duck-typed by the code)."""

    def __init__(self, bar, time_secs, modified_tempo, original_tempo):
        self.bar = bar
        self.time_secs = time_secs
        self.modified_tempo = modified_tempo
        self.original_tempo = original_tempo


# The points actually read out of the reported file.
REPORTED = [
    _SP(0, 0.0, 137.0, 137.0),
    _SP(193, 338.1021995464853, 98.73595, 137.0),
    _SP(198, 350.2558276643991, 136.08, 137.0),
    _SP(224, 397.8748752834467, 136.08011, 137.0),
]


def test_gp_points_convert_to_the_warp_payload_shape():
    out = _gp_sync_points_to_warp_payload(REPORTED)
    assert len(out) == 4
    assert out[0] == {
        "bar": 0, "time_secs": 0.0, "modified_bpm": 137.0, "original_bpm": 137.0,
    }
    assert out[1]["bar"] == 193
    assert math.isclose(out[1]["modified_bpm"], 98.73595)
    # Every entry carries exactly the four keys the warp builder reads.
    for p in out:
        assert set(p) == {"bar", "time_secs", "modified_bpm", "original_bpm"}


def test_a_malformed_point_discards_the_whole_set():
    """Half a set would misplace the chart — fall back to offset-only."""
    bad = list(REPORTED) + [_SP(None, "nope", 120.0, 120.0)]
    assert _gp_sync_points_to_warp_payload(bad) == []
    assert _gp_sync_points_to_warp_payload([object()]) == []
    assert _gp_sync_points_to_warp_payload(None) == []
    assert _gp_sync_points_to_warp_payload([]) == []


def test_embedded_audio_warps_from_the_gp_s_own_points():
    """The regression: these were being dropped."""
    points = _gp_sync_points_to_warp_payload(REPORTED)
    assert _warp_applies("embedded", points, from_gp=True) is True


def test_embedded_still_refuses_client_points():
    """Client points describe a DIFFERENT, user-staged recording."""
    points = _gp_sync_points_to_warp_payload(REPORTED)
    assert _warp_applies("embedded", points, from_gp=False) is False


def test_non_embedded_modes_are_unchanged():
    points = _gp_sync_points_to_warp_payload(REPORTED)
    for mode in ("autosync", "upload", None, ""):
        assert _warp_applies(mode, points, from_gp=False) is True


def test_fewer_than_two_points_never_warps():
    one = _gp_sync_points_to_warp_payload(REPORTED[:1])
    for mode in ("embedded", "autosync"):
        assert _warp_applies(mode, one, from_gp=True) is False
        assert _warp_applies(mode, [], from_gp=True) is False
        assert _warp_applies(mode, None, from_gp=True) is False


def test_the_reported_drift_is_what_the_warp_removes():
    """Documents the user-visible size of the bug.

    Ignoring the points holds the chart at the original tempo, so the last
    sync bar lands early by several seconds.
    """
    pts = _gp_sync_points_to_warp_payload(REPORTED)
    first, last = pts[0], pts[-1]
    bars = last["bar"] - first["bar"]
    constant = first["time_secs"] + bars * 4 * 60.0 / first["original_bpm"]
    drift = constant - last["time_secs"]
    assert drift < -5.0, f"expected the chart to run early, got {drift:+.1f}s"
