"""Read-path coverage for the `.sloppak → .feedpak` rename (PR #31).

The editor opens both the current `.feedpak` suffix and the legacy `.sloppak`
one (same byte-identical package), and rejects everything else now that
external `.archive` loading is gone. That contract lives in the `load_song`
route's suffix guard inside `setup(app, context)`.

The rest of the suite tests only pure module-level helpers and never enters
`setup()` (which does `from lib.song import …` — core modules absent from this
standalone repo). To reach the route handler we drive `setup()` with a fake
app that just captures the registered coroutines, plus tiny `lib` stubs that
satisfy the import. The suffix guard runs before any `lib`/`sloppak_mod` use,
so the stubs are structural only — the guard tests never call into them.
"""

from __future__ import annotations

import asyncio
import importlib
import json
import sys
import types
from pathlib import Path

import pytest


def _install_lib_stubs():
    """Minimal `lib`, `lib.song`, `lib.sloppak` so `setup()` can import them.

    Returns the keys added to sys.modules so the fixture can restore state.
    """
    added = []
    if "lib" not in sys.modules:
        lib = types.ModuleType("lib")
        lib.__path__ = []  # mark as a package so `from lib import sloppak` works
        sys.modules["lib"] = lib
        added.append("lib")
    lib = sys.modules["lib"]

    if "lib.song" not in sys.modules:
        song = types.ModuleType("lib.song")
        song.load_song = lambda *a, **k: None      # never called by the guard
        song.phrase_to_wire = lambda *a, **k: None
        sys.modules["lib.song"] = song
        lib.song = song
        added.append("lib.song")

    if "lib.sloppak" not in sys.modules:
        sloppak = types.ModuleType("lib.sloppak")
        sys.modules["lib.sloppak"] = sloppak
        lib.sloppak = sloppak
        added.append("lib.sloppak")
    return added


class _FakeApp:
    """Captures handlers registered via `@app.get`/`@app.post` by path."""

    def __init__(self):
        self.routes: dict = {}

    def _register(self, path):
        def decorator(fn):
            self.routes[path] = fn
            return fn
        return decorator

    def get(self, path, *a, **k):
        return self._register(path)

    def post(self, path, *a, **k):
        return self._register(path)


@pytest.fixture()
def load_song_route(tmp_path):
    """The real `load_song` coroutine, wired to a temp DLC dir."""
    added = _install_lib_stubs()
    sys.modules.pop("routes", None)
    routes = importlib.import_module("routes")

    dlc = tmp_path / "dlc"
    dlc.mkdir()
    context = {
        "config_dir": tmp_path,
        "get_dlc_dir": lambda: dlc,
        "meta_db": None,
        "get_sloppak_cache_dir": lambda: str(tmp_path / "cache"),
    }
    app = _FakeApp()
    routes.setup(app, context)
    handler = app.routes["/api/plugins/editor/load"]
    try:
        yield handler, dlc
    finally:
        sys.modules.pop("routes", None)
        for name in added:
            sys.modules.pop(name, None)


def _call(handler, filename):
    resp = asyncio.run(handler({"filename": filename}))
    body = json.loads(bytes(resp.body))
    return resp.status_code, body


# A non-existent name that clears the suffix gate reaches the existence check
# and 404s; a bad suffix is rejected at the gate with 400. The 404-vs-400 split
# is exactly what tells us whether a suffix is accepted.

@pytest.mark.parametrize("name", ["song.feedpak", "song.sloppak", "SONG.FEEDPAK", "Song.SlopPak"])
def test_load_accepts_both_suffixes(load_song_route, name):
    handler, _dlc = load_song_route
    status, body = _call(handler, name)
    assert status == 404, body            # past the suffix gate, file just absent
    assert "File not found" in body.get("error", "")


@pytest.mark.parametrize("name", ["song.archive", "song.zip", "song.txt", "noext"])
def test_load_rejects_other_suffixes(load_song_route, name):
    handler, _dlc = load_song_route
    status, body = _call(handler, name)
    assert status == 400, body
    assert "Unsupported file type" in body.get("error", "")


def test_load_existing_feedpak_clears_the_gate(load_song_route):
    """A real `.feedpak` on disk is not rejected by the suffix guard.

    It later fails deeper (the stubbed `lib.song.load_song` returns None), but
    the point here is that the suffix check itself lets `.feedpak` through —
    proven by NOT getting the 400 "Unsupported file type" response.
    """
    handler, dlc = load_song_route
    (dlc / "real.feedpak").write_bytes(b"PK\x03\x04")  # presence is enough
    status, body = _call(handler, "real.feedpak")
    assert not (status == 400 and "Unsupported file type" in body.get("error", "")), body
