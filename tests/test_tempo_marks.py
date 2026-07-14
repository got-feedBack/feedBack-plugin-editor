"""Authored tempo/meter marks (P2-5): the backend persistence contract.

The marks ride the `editor_tempo_marks` manifest extension key with exactly
the audio_shift semantics: absent request field -> _FIELD_ABSENT (an older
client must not wipe persisted marks), empty list -> genuine "no marks"
(REMOVES the key), garbage -> no authority to erase, invalid entries dropped
(a corrupt mark must never cost a save).
"""

import routes


def test_coerce_drops_invalid_and_dedups():
    marks = routes._coerce_tempo_marks([
        {"measure": 3, "kind": "hold", "factor": 2, "provenance": "confirmed"},
        {"measure": 3, "kind": "hold", "factor": 4},              # dup (measure, kind)
        {"measure": 1, "kind": "meter", "num": 7, "den": 8, "grouping": [2, 2, 3]},
        {"measure": 2, "kind": "meter", "num": 7, "den": 8, "grouping": [2, 2, 2]},  # bad sum
        {"measure": 0, "kind": "hold"},                            # measure < 1
        {"measure": 4, "kind": "ramp"},                            # P2-7, not yet
        "junk", None, 42,
    ])
    assert [(m["measure"], m["kind"]) for m in marks] == [(1, "meter"), (3, "hold")]
    assert marks[0]["grouping"] == [2, 2, 3]
    assert marks[1]["factor"] == 2
    assert marks[1]["provenance"] == "confirmed"


def test_coerce_hold_factor_degrades_not_raises():
    (m,) = routes._coerce_tempo_marks([{"measure": 1, "kind": "hold", "factor": "lots"}])
    assert m["factor"] == 2.0
    (m,) = routes._coerce_tempo_marks([{"measure": 1, "kind": "hold", "factor": 999}])
    assert m["factor"] == 2.0
    (m,) = routes._coerce_tempo_marks([{"measure": 1, "kind": "hold", "factor": 3.5}])
    assert m["factor"] == 3.5


def test_parse_absent_vs_empty_vs_garbage():
    assert routes._parse_tempo_marks({}) is routes._FIELD_ABSENT
    assert routes._parse_tempo_marks({"tempo_marks": "trash"}) is routes._FIELD_ABSENT
    assert routes._parse_tempo_marks({"tempo_marks": []}) == []
    parsed = routes._parse_tempo_marks(
        {"tempo_marks": [{"measure": 2, "kind": "hold"}]})
    assert parsed == [{"measure": 2, "kind": "hold", "factor": 2.0}]


def test_apply_write_remove_and_absent_noop():
    manifest = {"editor_tempo_marks": [{"measure": 9, "kind": "hold", "factor": 2.0}]}
    # Absent leaves the persisted value alone (older client).
    routes._apply_tempo_marks(manifest, routes._FIELD_ABSENT)
    assert manifest["editor_tempo_marks"][0]["measure"] == 9
    # A real list replaces it.
    routes._apply_tempo_marks(manifest, [{"measure": 1, "kind": "hold", "factor": 2.0}])
    assert manifest["editor_tempo_marks"][0]["measure"] == 1
    # An empty list REMOVES the key — no residue in the pack.
    routes._apply_tempo_marks(manifest, [])
    assert "editor_tempo_marks" not in manifest


def test_round_trip_save_shape_is_load_shape():
    """What _apply writes, _coerce reads back byte-identically (the manifest
    round-trip a save -> reopen performs), including stable ordering."""
    wire = [
        {"measure": 5, "kind": "meter", "num": 7, "den": 8,
         "grouping": [3, 2, 2], "provenance": "confirmed"},
        {"measure": 2, "kind": "hold", "factor": 2.0, "provenance": "imported"},
    ]
    manifest = {}
    routes._apply_tempo_marks(manifest, routes._coerce_tempo_marks(wire))
    reread = routes._coerce_tempo_marks(manifest["editor_tempo_marks"])
    assert reread == routes._coerce_tempo_marks(wire)
    assert [m["measure"] for m in reread] == [2, 5], "measure-sorted for stable saves"
