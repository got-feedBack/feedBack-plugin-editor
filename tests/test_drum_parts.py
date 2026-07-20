"""Regression coverage for the multiple-drum-parts save/load helpers.

A song can hold SEVERAL drum parts (feedpak-spec 1.17.0 "drums as
arrangements"): the PRIMARY persists as the song-level `drum_tab` (the
back-compat alias current cores play), the EXTRAS as `type: drums`
manifest arrangement entries carrying per-arrangement `drum_tab` file
pointers and NO note `file` — entries an old reader (and the core
loader's file/notation gate) skips cleanly.

Pinned here:
  - `_is_drum_pointer_entry` — the split that keeps the pitched save
    pipeline from ever pairing a wire arrangement with a file-less
    pointer entry (mispairing would corrupt the manifest);
  - `_sanitize_extra_drum_tab` — every persisted extra tab holds the
    same invariants as the primary (no malformed/duplicate hits,
    millisecond-rounded, time-ordered) and the request body is never
    mutated.
  - `_create_build_drum_entries` — the CREATE-MODE /build write: the
    `type: drums` manifest entries + the extra side files, mirroring the
    /save_song drum-parts wire.
"""

import json

from routes import (
    _create_build_drum_entries,
    _is_drum_pointer_entry,
    _sanitize_extra_drum_tab,
)


def test_pointer_entry_is_type_drums_without_a_note_file():
    assert _is_drum_pointer_entry(
        {"id": "drums_live", "type": "drums", "drum_tab": "drum_tab_live.json"}
    )
    # Case / synonym normalization mirrors the frontend's type test.
    assert _is_drum_pointer_entry({"type": "Drums", "drum_tab": "x.json"})
    assert _is_drum_pointer_entry({"type": "drum", "drum_tab": "x.json"})
    # A whitespace-only `file` is still file-less (the core loader strips too).
    assert _is_drum_pointer_entry({"type": "drums", "file": "   "})


def test_fretted_and_notation_entries_are_never_pointer_entries():
    # An ordinary fretted arrangement — even one NAMED Drums — is not a pointer.
    assert not _is_drum_pointer_entry(
        {"id": "lead", "name": "Drums", "file": "arrangements/lead.json"}
    )
    # A type:drums entry WITH a real note file stays in the pitched pipeline
    # (defensive: never orphan a file-backed entry into the drum block).
    assert not _is_drum_pointer_entry({"type": "drums", "file": "arrangements/d.json"})
    # Untyped / other-typed / malformed entries are not pointers.
    assert not _is_drum_pointer_entry({"id": "keys", "type": "piano"})
    assert not _is_drum_pointer_entry({"id": "x"})
    assert not _is_drum_pointer_entry("drums")
    assert not _is_drum_pointer_entry(None)


def test_sanitize_drops_malformed_and_duplicate_hits_and_sorts():
    tab = {
        "version": 1,
        "name": "Drums (Live)",
        "kit": [],
        "hits": [
            {"t": 2.0004, "p": "snare"},
            {"t": 1.0, "p": "kick"},
            {"t": 2.0, "p": "snare"},          # dup of the first after rounding
            {"t": -1.0, "p": "kick"},          # negative → malformed
            {"t": float("nan"), "p": "kick"},  # non-finite → malformed
            {"t": 3.0},                        # no piece → malformed
            "junk",                            # not a dict → malformed
            {"t": "1.5", "p": "hh"},           # numeric string coerces
        ],
    }
    out = _sanitize_extra_drum_tab(tab)
    assert [(h["t"], h["p"]) for h in out["hits"]] == [
        (1.0, "kick"), (1.5, "hh"), (2.0, "snare"),
    ]
    # Never mutates the request body: the original keeps all 8 raw hits.
    assert len(tab["hits"]) == 8
    # Non-hit fields pass through.
    assert out["name"] == "Drums (Live)"
    assert out["version"] == 1


def test_sanitize_tolerates_a_missing_or_bogus_hits_field():
    assert _sanitize_extra_drum_tab({"version": 1})["hits"] == []
    assert _sanitize_extra_drum_tab({"version": 1, "hits": "junk"})["hits"] == []


# ── create-mode /build write (_create_build_drum_entries) ────────────────────

def _dtab(name, hits=None):
    return {"version": 1, "name": name, "kit": [],
            "hits": hits if hits is not None else [{"t": 1.0, "p": "kick"}]}


def test_create_build_writes_side_files_and_primary_alias(tmp_path):
    primary = _dtab("Drums")
    entries = _create_build_drum_entries(tmp_path, primary, [
        {"id": "drums-2", "name": "Drums (Live)", "drum_tab": _dtab("Drums (Live)", [{"t": 2.0, "p": "snare"}])},
    ])
    # Primary alias FIRST (points at the song-level file, no side file written),
    # then the extra with its own drum_tab_<id>.json.
    assert entries == [
        {"id": "drums", "name": "Drums", "type": "drums", "drum_tab": "drum_tab.json"},
        {"id": "drums-2", "name": "Drums (Live)", "type": "drums", "drum_tab": "drum_tab_drums-2.json"},
    ]
    # The primary's file is the caller's job — only the extra is written here.
    assert not (tmp_path / "drum_tab.json").exists()
    written = json.loads((tmp_path / "drum_tab_drums-2.json").read_text())
    assert written["name"] == "Drums (Live)"
    assert [h["p"] for h in written["hits"]] == ["snare"]


def test_create_build_empty_extras_writes_only_the_primary_alias(tmp_path):
    entries = _create_build_drum_entries(tmp_path, _dtab("Drums"), [])
    assert entries == [
        {"id": "drums", "name": "Drums", "type": "drums", "drum_tab": "drum_tab.json"}]
    assert list(tmp_path.glob("drum_tab_*.json")) == []


def test_create_build_sanitizes_and_names_the_extra_tab(tmp_path):
    # Malformed/duplicate hits are dropped and the entry name propagates into
    # the written tab's name field (kept in lockstep for reload).
    dirty = _dtab("x", [{"t": 2.0, "p": "kick"}, {"t": 2.0, "p": "kick"}, {"t": -1, "p": "kick"}, {"t": 1.0, "p": "snare"}])
    _create_build_drum_entries(tmp_path, _dtab("Drums"), [
        {"id": "drums-2", "name": "Live Kit", "drum_tab": dirty}])
    tab = json.loads((tmp_path / "drum_tab_drums-2.json").read_text())
    assert tab["name"] == "Live Kit"
    assert [(h["t"], h["p"]) for h in tab["hits"]] == [(1.0, "snare"), (2.0, "kick")]
    # The request body is never mutated (sanitize returns a copy).
    assert len(dirty["hits"]) == 4


def test_create_build_de_collides_ids_and_sanitizes_filenames(tmp_path):
    entries = _create_build_drum_entries(tmp_path, _dtab("Drums"), [
        {"id": "drums", "drum_tab": _dtab("A")},      # collides with the primary
        {"id": "Weird Name!", "drum_tab": _dtab("B")},  # unsafe filename chars
        {"id": "", "drum_tab": _dtab("C")},            # empty → default
    ])
    ids = [e["id"] for e in entries]
    assert ids[0] == "drums"                 # the primary alias
    assert len(set(ids)) == len(ids), "no duplicate ids"
    assert "drums" not in ids[1:]            # the colliding extra was renamed
    for e in entries[1:]:
        assert (tmp_path / f"drum_tab_{e['id']}.json").exists()
        assert e["id"] == e["id"].lower() and " " not in e["id"] and "!" not in e["id"]


def test_create_build_sanitizes_a_non_list_hits_tab_to_empty(tmp_path):
    # Schema validation is the endpoint's job (build_song_endpoint rejects a
    # non-list `hits` with 400); if junk still reaches the pure writer, it
    # sanitizes to empty rather than crashing the build.
    entries = _create_build_drum_entries(tmp_path, _dtab("Drums"), [
        {"id": "bad", "drum_tab": {"version": 1, "hits": "not-a-list"}}])
    assert [e["id"] for e in entries] == ["drums", "bad"]
    assert json.loads((tmp_path / "drum_tab_bad.json").read_text())["hits"] == []
