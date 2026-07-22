"""Create-mode Save stays temporary while Export keeps library behavior."""

from __future__ import annotations

import asyncio
import importlib
import json
import sys
import types
from pathlib import Path

import pytest


class _FakeApp:
    def __init__(self):
        self.routes = {}

    def _register(self, path):
        def decorator(fn):
            self.routes[path] = fn
            return fn
        return decorator

    def get(self, path, *args, **kwargs):
        return self._register(path)

    def post(self, path, *args, **kwargs):
        return self._register(path)


@pytest.fixture()
def build_routes(tmp_path):
    added = []
    if "lib" not in sys.modules:
        lib = types.ModuleType("lib")
        lib.__path__ = []
        sys.modules["lib"] = lib
        added.append("lib")
    lib = sys.modules["lib"]
    if "lib.song" not in sys.modules:
        song = types.ModuleType("lib.song")
        song.load_song = lambda *args, **kwargs: None
        song.phrase_to_wire = lambda *args, **kwargs: None
        sys.modules["lib.song"] = song
        lib.song = song
        added.append("lib.song")
    if "lib.sloppak" not in sys.modules:
        sloppak = types.ModuleType("lib.sloppak")
        sys.modules["lib.sloppak"] = sloppak
        lib.sloppak = sloppak
        added.append("lib.sloppak")

    sys.modules.pop("routes", None)
    routes = importlib.import_module("routes")
    dlc = tmp_path / "dlc"
    dlc.mkdir()
    app = _FakeApp()
    routes.setup(app, {
        "config_dir": tmp_path,
        "get_dlc_dir": lambda: dlc,
        "meta_db": None,
        "get_sloppak_cache_dir": lambda: str(tmp_path / "cache"),
    })
    session_dir = tmp_path / "session"
    session_dir.mkdir()
    storage = tmp_path / "editor_cache"
    audio = storage / "source.ogg"
    audio.write_bytes(b"OggS" + b"test-audio" * 20)
    routes._sessions["create"] = {
        "create_mode": True,
        "dir": str(session_dir),
        "metadata": {},
    }
    try:
        yield routes, app, dlc, session_dir
    finally:
        sys.modules.pop("routes", None)
        for name in added:
            sys.modules.pop(name, None)


def _payload(**extra):
    data = {
        "session_id": "create",
        "audio_url": "/api/plugins/editor/cache/source.ogg",
        "metadata": {"title": "My Song", "artist": "The Band"},
        "arrangements": [],
        "beats": [],
        "sections": [],
    }
    data.update(extra)
    return data


def test_session_destination_builds_outside_library_and_is_downloadable(build_routes):
    routes, app, dlc, session_dir = build_routes
    result = asyncio.run(app.routes["/api/plugins/editor/build"](
        _payload(destination="session")))

    assert result["success"] is True
    assert result["destination"] == "session"
    assert result["filename"] == "My Song_The Band.feedpak"
    assert "path" not in result, "private session temp paths stay server-side"
    assert list(dlc.iterdir()) == []
    assert "filename" not in routes._sessions["create"]

    response = asyncio.run(app.routes["/api/plugins/editor/session/export"]("create"))
    assert Path(response.path).parent == session_dir
    assert Path(response.path).name.startswith("project-save-")
    assert "My%20Song_The%20Band.feedpak" in response.headers["content-disposition"]


def test_omitted_destination_preserves_library_build(build_routes):
    routes, app, dlc, _session_dir = build_routes
    result = asyncio.run(app.routes["/api/plugins/editor/build"](_payload()))

    expected = dlc / "My Song_The Band.feedpak"
    assert result["destination"] == "library"
    assert Path(result["path"]) == expected
    assert expected.is_file()
    assert routes._sessions["create"]["filename"] == expected.name


def test_library_build_removes_previous_private_save_generation(build_routes):
    routes, app, dlc, session_dir = build_routes
    first = asyncio.run(app.routes["/api/plugins/editor/build"](
        _payload(destination="session")))
    assert first["success"] is True
    previous = Path(routes._sessions["create"]["export_path"])
    assert previous.parent == session_dir
    assert previous.is_file()

    second = asyncio.run(app.routes["/api/plugins/editor/build"](
        _payload(destination="library")))
    assert second["success"] is True
    assert list(dlc.iterdir()), "the explicit library export still publishes"
    assert not previous.exists(), "the superseded private generation is reclaimed"
    assert "export_path" not in routes._sessions["create"]
    assert "export_filename" not in routes._sessions["create"]


def test_unknown_destination_is_rejected_before_writing(build_routes):
    _routes, app, dlc, session_dir = build_routes
    response = asyncio.run(app.routes["/api/plugins/editor/build"](
        _payload(destination="somewhere")))

    assert response.status_code == 400
    assert json.loads(bytes(response.body))["error"] == (
        "destination must be 'library' or 'session'")
    assert list(dlc.iterdir()) == []
    assert list(session_dir.iterdir()) == []
