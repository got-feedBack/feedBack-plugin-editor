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


def test_signature_denominator_is_folded_onto_downbeats():
    # Regression (Codex): core may convey the denominator only in
    # `time_signatures`, leaving the downbeat row bare. The editor's canonical
    # home for the denominator is `beat.den`; the frontend + _build_song_timeline
    # read that, not the list. Adopting the grid must land `den` on the downbeat
    # or a 6/8 map saves as 6/4. FAILS pre-fix (den never folded).
    tm = {
        "beats": [
            {"time": 0.0, "measure": 1},          # downbeat, NO inline den
            {"time": 0.5, "measure": -1},
            {"time": 1.0, "measure": 2},          # downbeat, NO inline den
            {"time": 1.5, "measure": -1},
        ],
        "tempos": [],
        "time_signatures": [{"time": 0.0, "ts": [6, 8]}],
    }
    out = _sanitize_midi_tempo_map(tm)
    assert out["beats"][0].get("den") == 8, "6/8 denominator folded onto bar-1 downbeat"
    # A downbeat with no matching signature event is left as-is (defaults /4
    # downstream), and interior beats never get a den.
    assert "den" not in out["beats"][1]


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


def test_beats_ride_the_audio_offset(monkeypatch):
    # Regression (Codex): the note converters place notes at raw + audio_offset,
    # but convert_midi_tempo_map emits the grid at raw MIDI times. The wrapper
    # must shift the grid by the same offset or adopting it (Use) leaves bars
    # audio_offset seconds away from the just-imported notes. FAILS pre-fix:
    # _safe_midi_tempo_map ignored (took no) audio_offset.
    _install_fake_core(monkeypatch, lambda path, idx: _grid(2))
    out = _safe_midi_tempo_map("ok.mid", 0, 1.5)
    assert out["beats"][0]["time"] == 1.5, "bar-1 downbeat (raw t=0) shifted by offset"
    assert out["beats"][2]["time"] == 2.5, "bar-2 downbeat (raw t=1) shifted by offset"
    # measure labels + den survive the shift untouched
    assert out["beats"][0]["measure"] == 1 and out["beats"][0]["den"] == 4
    assert out["tempos"][0]["time"] == 1.5
    assert out["time_signatures"][0]["time"] == 1.5


def test_zero_offset_leaves_grid_untouched(monkeypatch):
    _install_fake_core(monkeypatch, lambda path, idx: _grid(2))
    out = _safe_midi_tempo_map("ok.mid", 0, 0.0)
    assert out["beats"][0]["time"] == 0.0 and out["beats"][2]["time"] == 1.0
    # default (offset omitted) also means no shift — back-compat with callers
    out2 = _safe_midi_tempo_map("ok.mid", 0)
    assert out2["beats"][0]["time"] == 0.0


def test_negative_offset_shifts_grid_backward(monkeypatch):
    _install_fake_core(monkeypatch, lambda path, idx: _grid(1))
    out = _safe_midi_tempo_map("ok.mid", 0, -0.25)
    assert out["beats"][0]["time"] == -0.25


def test_non_finite_offset_is_ignored(monkeypatch):
    _install_fake_core(monkeypatch, lambda path, idx: _grid(1))
    out = _safe_midi_tempo_map("ok.mid", 0, float("nan"))
    assert out["beats"][0]["time"] == 0.0, "a non-finite offset must not poison the grid"


def test_track_index_is_forwarded(monkeypatch):
    seen = {}
    def capture(path, idx):
        seen["idx"] = idx
        return _grid(1)
    _install_fake_core(monkeypatch, capture)
    _safe_midi_tempo_map("t.mid", 7)
    assert seen["idx"] == 7, "type-2 files depend on the track_index reaching core"
