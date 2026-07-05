"""Tests for _parse_sync_points_payload — the shared validator for the
sync_points JSON shape that autosync-gp returns and refine-sync / convert-gp
accept back from the client."""

import math

from routes import _parse_sync_points_payload


def _pt(bar=0, t=1.0, mbpm=120.0, obpm=120.0):
    return {"bar": bar, "time_secs": t, "modified_bpm": mbpm, "original_bpm": obpm}


def test_valid_payload_is_coerced():
    points, err = _parse_sync_points_payload([_pt(0, 1.5), _pt(bar="4", t="9.25")])
    assert err is None
    assert points == [
        {"bar": 0, "time_secs": 1.5, "modified_bpm": 120.0, "original_bpm": 120.0},
        {"bar": 4, "time_secs": 9.25, "modified_bpm": 120.0, "original_bpm": 120.0},
    ]


def test_empty_list_is_valid():
    points, err = _parse_sync_points_payload([])
    assert err is None
    assert points == []


def test_non_list_rejected():
    points, err = _parse_sync_points_payload({"bar": 0})
    assert points is None
    assert "must be a list" in err


def test_oversized_payload_rejected():
    points, err = _parse_sync_points_payload([_pt()] * 2001)
    assert points is None
    assert "too many" in err


def test_missing_keys_rejected():
    points, err = _parse_sync_points_payload([{"bar": 0, "time_secs": 1.0}])
    assert points is None
    assert "missing required keys" in err


def test_non_numeric_rejected():
    points, err = _parse_sync_points_payload([_pt(t="not-a-number")])
    assert points is None
    assert "non-numeric" in err


def test_nan_and_negative_rejected():
    for bad in (
        _pt(t=math.nan),
        _pt(mbpm=math.inf),
        _pt(bar=-1),
        _pt(t=-0.5),
        _pt(mbpm=0.0),
        _pt(obpm=-10.0),
    ):
        points, err = _parse_sync_points_payload([bad])
        assert points is None
        assert "out-of-range" in err
