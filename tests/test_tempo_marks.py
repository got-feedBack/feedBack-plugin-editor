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


def test_coerce_feel_marks_round_trip():
    marks = routes._coerce_tempo_marks([
        {"measure": 8, "kind": "feel", "ratio": 0.5, "provenance": "confirmed"},
        {"measure": 20, "kind": "feel", "ratio": 1},
        {"measure": 30, "kind": "feel", "ratio": 3},      # not in the vocabulary
        {"measure": 31, "kind": "feel"},                   # ratio required
    ])
    assert [(m["measure"], m["ratio"]) for m in marks] == [(8, 0.5), (20, 1.0)]
    manifest = {}
    routes._apply_tempo_marks(manifest, marks)
    assert routes._coerce_tempo_marks(manifest["editor_tempo_marks"]) == marks


def test_coerce_ramp_marks_round_trip():
    marks = routes._coerce_tempo_marks([
        {"measure": 12, "kind": "ramp", "measureEnd": 16,
         "bpmStart": 120, "bpmEnd": 140, "curve": "ease-out", "provenance": "confirmed"},
        {"measure": 20, "kind": "ramp", "measureEnd": 20, "bpmStart": 120, "bpmEnd": 140},  # empty span
        {"measure": 30, "kind": "ramp", "measureEnd": 34, "bpmStart": 0, "bpmEnd": 140},    # bad bpm
        {"measure": 40, "kind": "ramp", "measureEnd": 44,
         "bpmStart": 100, "bpmEnd": 90, "curve": "wiggly"},                                  # curve degrades
    ])
    assert [(m["measure"], m.get("curve")) for m in marks] == [(12, "ease-out"), (40, "linear")]
    manifest = {}
    routes._apply_tempo_marks(manifest, marks)
    assert routes._coerce_tempo_marks(manifest["editor_tempo_marks"]) == marks


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


def test_coerce_fractional_fields_drop_not_truncate():
    """Item 2 (review #276): int() truncated fractions — measure 3.9 became 3,
    silently MOVING a mark despite the frontend's exact-integer rules. A
    fractional value in any integer field now DROPS the entry."""
    assert routes._coerce_tempo_marks([{"measure": 3.9, "kind": "hold"}]) == []
    assert routes._coerce_tempo_marks(
        [{"measure": 1, "kind": "meter", "num": 7.9, "den": 8}]) == []
    assert routes._coerce_tempo_marks(
        [{"measure": 1, "kind": "meter", "num": 7, "den": 8.9}]) == []
    assert routes._coerce_tempo_marks(
        [{"measure": 1, "kind": "meter", "num": 7, "den": 8,
          "grouping": [2, 2, 3.9]}]) == []


def test_coerce_integral_floats_accepted_as_ints():
    """The chosen rule: exact finite integers only, where an INTEGRAL-valued
    float (3.0) counts — JSON round-trips through some encoders float-ize
    whole numbers. The output is normalized back to int."""
    (m,) = routes._coerce_tempo_marks(
        [{"measure": 3.0, "kind": "meter", "num": 7.0, "den": 8.0,
          "grouping": [2.0, 2, 3]}])
    assert m == {"measure": 3, "kind": "meter", "num": 7, "den": 8,
                 "grouping": [2, 2, 3]}
    assert all(isinstance(v, int) and not isinstance(v, bool)
               for v in (m["measure"], m["num"], m["den"], *m["grouping"]))


def test_coerce_booleans_drop_every_integer_field():
    """bool is an int subclass — int(True) == 1 slipped through as a real
    measure/numerator/grouping entry. Booleans are not integers here."""
    assert routes._coerce_tempo_marks([{"measure": True, "kind": "hold"}]) == []
    assert routes._coerce_tempo_marks([{"measure": False, "kind": "hold"}]) == []
    assert routes._coerce_tempo_marks(
        [{"measure": 1, "kind": "meter", "num": True, "den": 8}]) == []
    assert routes._coerce_tempo_marks(
        [{"measure": 1, "kind": "meter", "num": 7, "den": True}]) == []
    assert routes._coerce_tempo_marks(
        [{"measure": 1, "kind": "meter", "num": 7, "den": 8,
          "grouping": [True, 3, 3]}]) == []


def test_coerce_numeric_strings_drop():
    """int("3") used to succeed; the frontend never sends strings, so a
    string in an integer field is corruption and drops the entry."""
    assert routes._coerce_tempo_marks([{"measure": "3", "kind": "hold"}]) == []
    assert routes._coerce_tempo_marks(
        [{"measure": 1, "kind": "meter", "num": "7", "den": 8}]) == []
    assert routes._coerce_tempo_marks(
        [{"measure": 1, "kind": "meter", "num": 7, "den": "8"}]) == []
    assert routes._coerce_tempo_marks(
        [{"measure": 1, "kind": "meter", "num": 7, "den": 8,
          "grouping": ["2", "2", "3"]}]) == []


def test_coerce_nan_inf_drop_and_never_crash():
    """int(float('inf')) raises OverflowError, which the old except clause
    did not catch — a hand-edited pack could crash the load. NaN/±inf now
    drop the entry, quietly, in every integer field."""
    for bad in (float("nan"), float("inf"), float("-inf")):
        assert routes._coerce_tempo_marks([{"measure": bad, "kind": "hold"}]) == []
        assert routes._coerce_tempo_marks(
            [{"measure": 1, "kind": "meter", "num": bad, "den": 8}]) == []
        assert routes._coerce_tempo_marks(
            [{"measure": 1, "kind": "meter", "num": 7, "den": bad}]) == []
        assert routes._coerce_tempo_marks(
            [{"measure": 1, "kind": "meter", "num": 7, "den": 8,
              "grouping": [2, 2, bad]}]) == []


def test_coerce_out_of_range_integers_still_drop():
    assert routes._coerce_tempo_marks([{"measure": 0, "kind": "hold"}]) == []
    assert routes._coerce_tempo_marks([{"measure": -1, "kind": "hold"}]) == []
    assert routes._coerce_tempo_marks(
        [{"measure": 1, "kind": "meter", "num": 0, "den": 8}]) == []
    assert routes._coerce_tempo_marks(
        [{"measure": 1, "kind": "meter", "num": 33, "den": 8}]) == []
    assert routes._coerce_tempo_marks(
        [{"measure": 1, "kind": "meter", "num": 7, "den": 3}]) == []
    assert routes._coerce_tempo_marks(
        [{"measure": 1, "kind": "meter", "num": 7, "den": 8,
          "grouping": [0, 7]}]) == []
    assert routes._coerce_tempo_marks(
        [{"measure": 1, "kind": "meter", "num": 7, "den": 8,
          "grouping": [-1, 8]}]) == []


def test_save_boundary_rejects_same_as_load():
    """The request path (_parse_tempo_marks → _coerce) and the manifest load
    path (_coerce directly) share one validator: bad entries drop at BOTH
    boundaries, good neighbors survive."""
    wire = [
        {"measure": 3.9, "kind": "hold"},
        {"measure": True, "kind": "hold"},
        {"measure": "3", "kind": "hold"},
        {"measure": float("inf"), "kind": "hold"},
        {"measure": 1, "kind": "meter", "num": 7, "den": 8, "grouping": [2, 2, 3.9]},
        {"measure": 2, "kind": "hold"},                       # the one survivor
    ]
    parsed = routes._parse_tempo_marks({"tempo_marks": wire})
    assert parsed == [{"measure": 2, "kind": "hold", "factor": 2.0}]
    manifest = {}
    routes._apply_tempo_marks(manifest, parsed)
    assert routes._coerce_tempo_marks(manifest["editor_tempo_marks"]) == parsed


def test_exact_int_unit():
    """The reusable validator a stacked PR can lean on (P2-6+): exact finite
    integers (int or integral float) or None."""
    assert routes._exact_int(3) == 3
    assert routes._exact_int(3.0) == 3
    assert routes._exact_int(-2) == -2
    assert routes._exact_int(0) == 0
    for bad in (3.9, True, False, float("nan"), float("inf"), float("-inf"),
                "3", None, [], {}):
        assert routes._exact_int(bad) is None, repr(bad)


def test_coerce_ramp_measure_end_exact_int():
    """Item 7 (review #279): measureEnd was parsed with a bare int() — 8.9
    truncated to 8 (silently moving the ramp's end), "8" parsed (strings are
    corruption on this wire), and inf crashed the load (OverflowError isn't
    a ValueError). Same _exact_int rule as every other integer mark field."""
    base = {"measure": 4, "kind": "ramp", "bpmStart": 120, "bpmEnd": 140}
    assert routes._coerce_tempo_marks([{**base, "measureEnd": 8.9}]) == []
    assert routes._coerce_tempo_marks([{**base, "measureEnd": True}]) == []
    assert routes._coerce_tempo_marks([{**base, "measureEnd": "8"}]) == []
    assert routes._coerce_tempo_marks([{**base, "measureEnd": None}]) == []
    for bad in (float("nan"), float("inf"), float("-inf")):
        assert routes._coerce_tempo_marks([{**base, "measureEnd": bad}]) == []
    # measureEnd <= measure is not a span — drops, never a backwards range.
    assert routes._coerce_tempo_marks([{**base, "measureEnd": 4}]) == []
    assert routes._coerce_tempo_marks([{**base, "measureEnd": 3}]) == []
    # An INTEGRAL float still counts (JSON encoders float-ize whole numbers)
    # and normalizes back to int.
    (m,) = routes._coerce_tempo_marks([{**base, "measureEnd": 8.0}])
    assert m["measureEnd"] == 8
    assert isinstance(m["measureEnd"], int) and not isinstance(m["measureEnd"], bool)


def test_save_boundary_rejects_malformed_ramps():
    """Malformed ramps drop identically at the request (_parse) and manifest
    load (_coerce) boundaries; valid neighbors survive."""
    wire = [
        {"measure": 2, "kind": "ramp", "measureEnd": 6.9, "bpmStart": 120, "bpmEnd": 140},
        {"measure": 3, "kind": "ramp", "measureEnd": "7", "bpmStart": 120, "bpmEnd": 140},
        {"measure": 4, "kind": "ramp", "measureEnd": float("inf"), "bpmStart": 120, "bpmEnd": 140},
        {"measure": 5, "kind": "ramp", "measureEnd": True, "bpmStart": 120, "bpmEnd": 140},
        {"measure": 6, "kind": "ramp", "measureEnd": 9, "bpmStart": 120, "bpmEnd": 140},  # survivor
    ]
    parsed = routes._parse_tempo_marks({"tempo_marks": wire})
    assert [(m["measure"], m["measureEnd"]) for m in parsed] == [(6, 9)]
    manifest = {}
    routes._apply_tempo_marks(manifest, parsed)
    assert routes._coerce_tempo_marks(manifest["editor_tempo_marks"]) == parsed


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
