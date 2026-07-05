from __future__ import annotations

import json
import shutil
from pathlib import Path

from routes import (
    _build_song_timeline,
    _load_song_timeline,
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
