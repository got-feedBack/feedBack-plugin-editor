"""Tests for the measure-granular GP-notation preserve-on-edit merge.

One note edit used to invalidate the WHOLE GP notation sidecar: the save
fell through to the heuristic lift and silently discarded the GP payload's
exact per-stave hand assignments, dynamics, pedal events, fingering, and
grace notes for EVERY measure of the arrangement (workspace design 0.4 —
the keys data-corruption gate).

Now `_merge_gp_notation_after_edit` splices: measures whose ``(time, midi)``
note multiset still matches the current wire keep their GP measure objects
verbatim (staves live per measure, so hand split + attrs ride along); only
edited measures take the freshly lifted measure. Any grid misalignment
returns None and the caller falls back to the full lift — the old behavior.

Run: python -m pytest tests/test_notation_preserve_merge.py -q
"""

import copy

from routes import (  # noqa: E402
    _merge_gp_notation_after_edit,
    _notation_measure_note_counts,
    _wire_measure_note_counts,
)


def _beat(t, notes, **flags):
    b = {"t": t, "dur": 4, "notes": notes}
    b.update(flags)
    return b


def _gp_payload():
    """3 measures at t=0/2/4, two staves, GP-only attrs sprinkled in."""
    return {
        "version": 1,
        "instrument": "piano",
        "source": "gp",
        "measures": [
            {
                "t": 0.0,
                "staves": {
                    "G2": {"voices": [{"beats": [
                        _beat(0.0, [{"midi": 60, "fng": 1}]),
                    ]}]},
                    "F4": {"voices": [{"beats": [
                        _beat(1.0, [{"midi": 36}]),
                    ]}]},
                },
            },
            {
                "t": 2.0,
                "staves": {
                    "G2": {"voices": [{"beats": [
                        _beat(2.0, [{"midi": 64}]),
                    ]}]},
                },
            },
            {
                "t": 4.0,
                "staves": {
                    "G2": {"voices": [{"beats": [
                        _beat(4.0, [{"midi": 67}], dyn="p", spd=True),
                    ]}]},
                },
            },
        ],
    }


def _lifted_payload(mid_measure_midi=65):
    """The heuristic lift of the edited wire: single staff, same t grid."""
    return {
        "version": 1,
        "instrument": "piano",
        "measures": [
            {"t": 0.0, "staves": {"G2": {"voices": [{"beats": [
                _beat(0.0, [{"midi": 60}]), _beat(1.0, [{"midi": 36}]),
            ]}]}}},
            {"t": 2.0, "staves": {"G2": {"voices": [{"beats": [
                _beat(2.0, [{"midi": mid_measure_midi}]),
            ]}]}}},
            {"t": 4.0, "staves": {"G2": {"voices": [{"beats": [
                _beat(4.0, [{"midi": 67}]),
            ]}]}}},
        ],
    }


def _wire(mid_note=("2.0", 2, 17)):
    """Wire matching the GP payload except measure 1 (midi 65 ≠ 64):
    s*24+f — 60=(2,12), 36=(1,12), 65=(2,17), 67=(2,19)."""
    t, s, f = mid_note
    return {
        "notes": [
            {"t": 0.0, "s": 2, "f": 12},
            {"t": 1.0, "s": 1, "f": 12},
            {"t": float(t), "s": s, "f": f},
            {"t": 4.0, "s": 2, "f": 19},
        ],
        "chords": [],
    }


def test_unchanged_measures_keep_gp_objects_edited_measure_takes_lift():
    gp = _gp_payload()
    out = _merge_gp_notation_after_edit(gp, _lifted_payload(), _wire())
    assert out is not None
    merged, preserved, total = out
    assert (preserved, total) == (2, 3)
    m0, m1, m2 = merged["measures"]
    # Measure 0: GP object verbatim — two staves (hand split) + fingering.
    assert set(m0["staves"].keys()) == {"G2", "F4"}
    assert m0["staves"]["G2"]["voices"][0]["beats"][0]["notes"][0]["fng"] == 1
    # Measure 1 (edited): the lifted measure, new pitch.
    assert m1["staves"]["G2"]["voices"][0]["beats"][0]["notes"][0]["midi"] == 65
    # Measure 2: GP attrs (dynamics + pedal) survive.
    beat2 = m2["staves"]["G2"]["voices"][0]["beats"][0]
    assert beat2["dyn"] == "p" and beat2["spd"] is True
    # Top-level GP keys survive the merge.
    assert merged["instrument"] == "piano" and merged["version"] == 1


def test_fully_matching_wire_preserves_everything():
    wire = _wire(mid_note=("2.0", 2, 16))  # 2*24+16 = 64: matches GP
    out = _merge_gp_notation_after_edit(_gp_payload(), _lifted_payload(64), wire)
    merged, preserved, total = out
    assert (preserved, total) == (3, 3)


def test_grid_misalignment_returns_none():
    gp = _gp_payload()
    drifted = _lifted_payload()
    drifted["measures"][1]["t"] = 2.01           # >2 ms boundary drift
    assert _merge_gp_notation_after_edit(gp, drifted, _wire()) is None
    short = _lifted_payload()
    short["measures"] = short["measures"][:2]    # measure-count mismatch
    assert _merge_gp_notation_after_edit(gp, short, _wire()) is None
    no_t = _lifted_payload()
    del no_t["measures"][0]["t"]
    assert _merge_gp_notation_after_edit(gp, no_t, _wire()) is None
    assert _merge_gp_notation_after_edit({}, _lifted_payload(), _wire()) is None


def test_wire_chord_notes_fall_back_to_the_chord_time():
    wire = {
        "notes": [
            {"t": 0.0, "s": 2, "f": 12},
            {"t": 1.0, "s": 1, "f": 12},
            {"t": 2.0, "s": 2, "f": 16},
        ],
        # 67 arrives as a chord note with no own t — bucketed at the chord's.
        "chords": [{"t": 4.0, "notes": [{"s": 2, "f": 19}]}],
    }
    out = _merge_gp_notation_after_edit(_gp_payload(), _lifted_payload(64), wire)
    merged, preserved, total = out
    assert (preserved, total) == (3, 3)


def test_ten_ms_bucketing_absorbs_independent_rounding():
    gp = _gp_payload()
    gp["measures"][0]["staves"]["F4"]["voices"][0]["beats"][0]["t"] = 1.001
    wire = _wire(mid_note=("2.0", 2, 16))
    wire["notes"][1]["t"] = 0.999               # both bucket to 1.0
    out = _merge_gp_notation_after_edit(gp, _lifted_payload(64), wire)
    assert out is not None and out[1] == 3


def test_note_count_helpers_shapes():
    counts = _notation_measure_note_counts(_gp_payload())
    assert len(counts) == 3
    assert counts[0][(0.0, 60)] == 1 and counts[0][(1.0, 36)] == 1
    assert _notation_measure_note_counts({"measures": "junk"}) is None
    wire_counts = _wire_measure_note_counts(_wire(), [0.0, 2.0, 4.0])
    assert wire_counts[2][(4.0, 67)] == 1
    assert _wire_measure_note_counts(_wire(), []) == []


def test_inputs_are_not_mutated():
    gp = _gp_payload()
    lifted = _lifted_payload()
    wire = _wire()
    gp_copy, lifted_copy = copy.deepcopy(gp), copy.deepcopy(lifted)
    _merge_gp_notation_after_edit(gp, lifted, wire)
    assert gp == gp_copy and lifted == lifted_copy
