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
"""

from routes import _is_drum_pointer_entry, _sanitize_extra_drum_tab


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
