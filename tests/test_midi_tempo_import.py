"""Tests for the MIDI tempo-map import gate (DAW 3.2).

`_safe_midi_tempo_map` wraps core `convert_midi_tempo_map` (feedback #796) so
a keys/drums MIDI import can offer the file's own tempo/time-signature/beat
grid as the project timeline. The gating + shaping is pure
(`_sanitize_midi_tempo_map`) and tested here without a real .mid or the core
lib; the core-import wrapper is tested for its two failure floors (older core
without the function → {}, extraction raising → {}) via injection.

Run: python -m pytest tests/test_midi_tempo_import.py -q
"""

import sys
import types

from routes import _sanitize_midi_tempo_map, _safe_midi_tempo_map


# ── _sanitize_midi_tempo_map: the gate + shape (pure) ────────────────

def _grid(n_bars=2):
    """A minimal valid map: n_bars numbered downbeats + interior beats."""
    beats = []
    for m in range(1, n_bars + 1):
        beats.append({"time": float(m - 1), "measure": m, "den": 4})
        beats.append({"time": m - 0.5, "measure": -1})
    return {
        "tempos": [{"time": 0.0, "bpm": 120.0}],
        "time_signatures": [{"time": 0.0, "ts": [4, 4]}],
        "beats": beats,
    }


def test_valid_map_passes_through_with_all_three_keys():
    out = _sanitize_midi_tempo_map(_grid(3))
    assert set(out) == {"tempos", "time_signatures", "beats"}
    assert len(out["beats"]) == 6
    assert out["time_signatures"] == [{"time": 0.0, "ts": [4, 4]}]


def test_gridless_map_is_dropped():
    # beats present but NO numbered downbeat → nothing worth offering.
    interior_only = {"beats": [{"time": 0.0, "measure": -1}], "tempos": [], "time_signatures": []}
    assert _sanitize_midi_tempo_map(interior_only) == {}
    assert _sanitize_midi_tempo_map({"beats": []}) == {}
    assert _sanitize_midi_tempo_map({}) == {}


def test_single_downbeat_still_offered():
    # One bar IS a grid — a short loop is legitimate content to adopt.
    out = _sanitize_midi_tempo_map(_grid(1))
    assert out and len(out["beats"]) == 2


def test_non_dict_and_missing_optional_lists_coerce():
    assert _sanitize_midi_tempo_map(None) == {}
    assert _sanitize_midi_tempo_map("nope") == {}
    # beats valid but tempos/sigs missing or wrong type → coerced to [].
    m = {"beats": _grid(2)["beats"]}
    out = _sanitize_midi_tempo_map(m)
    assert out["tempos"] == [] and out["time_signatures"] == []
    m2 = {"beats": _grid(2)["beats"], "tempos": "x", "time_signatures": 5}
    out2 = _sanitize_midi_tempo_map(m2)
    assert out2["tempos"] == [] and out2["time_signatures"] == []


# ── _safe_midi_tempo_map: the two failure floors + happy path ────────

def _install_fake_core(monkeypatch, impl):
    """Install a fake lib.midi_import.convert_midi_tempo_map."""
    mod = types.ModuleType("lib.midi_import")
    mod.convert_midi_tempo_map = impl
    pkg = sys.modules.get("lib") or types.ModuleType("lib")
    monkeypatch.setitem(sys.modules, "lib", pkg)
    monkeypatch.setitem(sys.modules, "lib.midi_import", mod)


def test_older_core_without_the_function_returns_empty(monkeypatch):
    # A core module that lacks convert_midi_tempo_map → ImportError path → {}.
    mod = types.ModuleType("lib.midi_import")  # no convert_midi_tempo_map attr
    pkg = sys.modules.get("lib") or types.ModuleType("lib")
    monkeypatch.setitem(sys.modules, "lib", pkg)
    monkeypatch.setitem(sys.modules, "lib.midi_import", mod)
    assert _safe_midi_tempo_map("whatever.mid", 0) == {}


def test_extraction_raising_never_propagates(monkeypatch):
    def boom(path, idx):
        raise RuntimeError("corrupt SMF")
    _install_fake_core(monkeypatch, boom)
    assert _safe_midi_tempo_map("bad.mid", 0) == {}


def test_happy_path_is_gated_through_sanitize(monkeypatch):
    _install_fake_core(monkeypatch, lambda path, idx: _grid(2))
    out = _safe_midi_tempo_map("ok.mid", 0)
    assert out and len(out["beats"]) == 4
    # A gridless core result is still dropped by the shared gate.
    _install_fake_core(monkeypatch, lambda path, idx: {"beats": [], "tempos": []})
    assert _safe_midi_tempo_map("empty.mid", 0) == {}


def test_track_index_is_forwarded(monkeypatch):
    seen = {}
    def capture(path, idx):
        seen["idx"] = idx
        return _grid(1)
    _install_fake_core(monkeypatch, capture)
    _safe_midi_tempo_map("t.mid", 7)
    assert seen["idx"] == 7, "type-2 files depend on the track_index reaching core"
