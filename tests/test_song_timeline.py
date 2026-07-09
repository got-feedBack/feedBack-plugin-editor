from __future__ import annotations

import json
import shutil
from pathlib import Path

from routes import (
    _build_song_timeline,
    _load_song_timeline,
    _merge_song_timeline_payload,
    _write_song_timeline_sidecar,
)


def _workdir(name: str) -> Path:
    path = Path(".tmp") / "song_timeline_tests" / name
    if path.exists():
        shutil.rmtree(path, ignore_errors=True)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _beats():
    return [
        {"time": 0.0, "measure": 1, "den": 4},
        {"time": 0.5, "measure": -1},
        {"time": 1.0, "measure": -1},
        {"time": 1.5, "measure": -1},
        {"time": 2.0, "measure": 2, "den": 8},
        {"time": 2.5, "measure": -1},
        {"time": 3.0, "measure": -1},
        {"time": 3.5, "measure": -1},
        {"time": 4.0, "measure": 3, "den": 8},
        {"time": 5.0, "measure": -1},
        {"time": 6.0, "measure": -1},
    ]


def test_build_song_timeline_derives_signature_and_tempo_events():
    timeline = _build_song_timeline(_beats(), [
        {"name": "intro", "number": 1, "start_time": 0.0},
    ])

    assert timeline["version"] == 1
    assert timeline["beats"][0] == {"time": 0.0, "measure": 1}
    assert timeline["sections"] == [{"name": "intro", "number": 1, "time": 0.0}]
    assert timeline["time_signatures"] == [
        {"time": 0.0, "ts": [4, 4]},
        {"time": 2.0, "ts": [4, 8]},
        {"time": 4.0, "ts": [3, 8]},
    ]
    assert timeline["tempos"] == [
        {"time": 0.0, "bpm": 120.0},
    ]


def test_build_song_timeline_constant_tempo_does_not_drift():
    # A constant 140 BPM grid whose bars DON'T land on a millisecond boundary
    # (0.428571 s/beat). At the old 3-decimal precision the per-bar BPM derived
    # from the rounded spans wobbled (140.023 / 139.942 / ...), so a constant
    # tempo surfaced as a multi-event "variable" map. At 6 decimals it stays one
    # 140.0 event. (Guards the beat-precision fix — mirrors gp2rs's 6-decimal
    # ebeat output so an imported constant tempo survives a save/reload.)
    spb = round(60.0 / 140.0, 6)
    beats = []
    for i in range(13):  # 3 bars of 4/4 + a trailing downbeat to close bar 3
        beats.append({
            "time": round(i * spb, 6),
            "measure": (i // 4 + 1) if i % 4 == 0 else -1,
            "den": 4,
        })
    timeline = _build_song_timeline(beats, [])
    assert timeline["tempos"] == [{"time": 0.0, "bpm": 140.0}], timeline["tempos"]


def test_write_song_timeline_sidecar_stamps_manifest():
    workdir = _workdir("stamps_manifest")
    manifest = {"title": "Example"}

    _write_song_timeline_sidecar(workdir, manifest, _beats(), [])

    assert manifest["song_timeline"] == "song_timeline.json"
    payload = json.loads((workdir / "song_timeline.json").read_text(encoding="utf-8"))
    assert payload["time_signatures"][1] == {"time": 2.0, "ts": [4, 8]}


def test_write_song_timeline_sidecar_removes_stale_empty_grid():
    workdir = _workdir("removes_stale")
    manifest = {"song_timeline": "song_timeline.json"}
    stale = workdir / "song_timeline.json"
    stale.write_text("{}", encoding="utf-8")

    _write_song_timeline_sidecar(workdir, manifest, [], [])

    assert "song_timeline" not in manifest


def test_write_song_timeline_sidecar_preserves_unknown_on_empty_grid():
    workdir = _workdir("empty_grid_preserves_unknown")
    existing = {
        "version": 1,
        "beats": [{"time": 99.0, "measure": 1}],
        "metric_modulations": [{"time": 2.0, "from": "quarter", "to": "eighth"}],
        "notes": "author annotation",
    }
    (workdir / "song_timeline.json").write_text(json.dumps(existing), encoding="utf-8")
    manifest = {"song_timeline": "song_timeline.json"}

    _write_song_timeline_sidecar(workdir, manifest, [], [])

    assert manifest["song_timeline"] == "song_timeline.json"
    payload = json.loads((workdir / "song_timeline.json").read_text(encoding="utf-8"))
    assert payload == {
        "metric_modulations": existing["metric_modulations"],
        "notes": "author annotation",
    }


def test_load_song_timeline_takes_priority_and_restores_denominators():
    workdir = _workdir("load_priority")
    (workdir / "song_timeline.json").write_text(json.dumps({
        "version": 1,
        "beats": [
            {"time": 0.0, "measure": 1},
            {"time": 0.5, "measure": -1},
            {"time": 1.0, "measure": 2},
        ],
        "sections": [{"name": "verse", "number": 2, "time": 8.0}],
        "time_signatures": [{"time": 1.0, "ts": [7, 8]}],
    }), encoding="utf-8")

    loaded = _load_song_timeline(workdir, {"song_timeline": "song_timeline.json"})

    assert loaded["beats"] == [
        {"time": 0.0, "measure": 1},
        {"time": 0.5, "measure": -1},
        {"time": 1.0, "measure": 2, "den": 8},
    ]
    assert loaded["sections"] == [{"name": "verse", "number": 2, "start_time": 8.0}]

def test_write_song_timeline_sidecar_preserves_unknown_modulation_metadata():
    workdir = _workdir("preserves_unknown")
    existing = {
        "version": 1,
        "beats": [{"time": 99.0, "measure": 1}],
        "time_signatures": [{"time": 99.0, "ts": [9, 8]}],
        "metric_modulations": [
            {"time": 2.0, "from": "quarter", "to": "dotted-quarter"},
        ],
        "notes": "author annotation",
    }
    (workdir / "song_timeline.json").write_text(json.dumps(existing), encoding="utf-8")
    manifest = {"song_timeline": "song_timeline.json"}

    _write_song_timeline_sidecar(workdir, manifest, _beats(), [])

    payload = json.loads((workdir / "song_timeline.json").read_text(encoding="utf-8"))
    assert payload["metric_modulations"] == existing["metric_modulations"]
    assert payload["notes"] == "author annotation"
    assert payload["beats"][0] == {"time": 0.0, "measure": 1}
    assert payload["time_signatures"][0] == {"time": 0.0, "ts": [4, 4]}


def test_merge_song_timeline_payload_drops_stale_owned_arrays_when_absent():
    merged = _merge_song_timeline_payload(
        {
            "version": 1,
            "beats": [{"time": 1.0, "measure": 1}],
            "tempos": [{"time": 1.0, "bpm": 80}],
            "custom": {"keep": True},
        },
        {"version": 1, "sections": []},
    )

    assert merged == {"version": 1, "sections": [], "custom": {"keep": True}}
