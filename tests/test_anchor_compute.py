"""Unit tests for the fret-hand anchor engine (`_compute_anchors`).

The rewrite added look-ahead run placement and lone-outlier tolerance to the
old single forward-greedy pass. These tests pin the two headline behaviours
(both of which the old engine got wrong) plus the structural invariants the
downstream consumers — position suggest, chord grip, the stretch/legato
lints, the anchor-resolve sweep — rely on.
"""

from routes import _compute_anchors, _fretted_groups


def note(t, fret):
    return {"time": float(t), "fret": fret, "string": 0}


def chord(t, frets):
    return {"time": float(t), "notes": [{"time": float(t), "fret": f} for f in frets]}


def seq(frets):
    """One single note per integer beat, in the given fret order."""
    return [note(i, f) for i, f in enumerate(frets)]


def frets_of(anchors):
    return [a["fret"] for a in anchors]


# --- degenerate inputs ------------------------------------------------------

def test_no_notes_returns_single_default_anchor():
    assert _compute_anchors([], []) == [{"time": 0.0, "fret": 1, "width": 4}]


def test_only_open_strings_returns_single_default_anchor():
    got = _compute_anchors([note(0.0, 0), note(1.0, -1)], [])
    assert got == [{"time": 0.0, "fret": 1, "width": 4}]


# --- placement --------------------------------------------------------------

def test_single_note_keeps_one_comfort_fret_below():
    # fret 5 alone -> index sits at 4 (5 - 1), window [4, 8]
    assert _compute_anchors([note(1.0, 5)], []) == [
        {"time": 0.0, "fret": 4, "width": 4}]


def test_single_high_note_is_fret_11():
    # Pins the value test_xml_export's comment references: lone fret-12 -> 11.
    assert frets_of(_compute_anchors([note(1.0, 12)], [])) == [11]


def test_first_anchor_always_covers_time_zero():
    assert _compute_anchors([note(9.0, 7)], [])[0]["time"] == 0.0


def test_low_note_clamps_to_fret_one():
    assert frets_of(_compute_anchors([note(0.0, 1)], [])) == [1]


def test_full_width_run_cannot_slip_below_top_note():
    # frets 3..7 exactly fill the width -> anchor must stay at 3 (not 2), or
    # the window [2, 6] would drop the top note 7.
    assert frets_of(_compute_anchors(seq([3, 5, 7]), [])) == [3]


# --- look-ahead (the headline win) -----------------------------------------

def test_lookahead_folds_3_1_5_into_one_anchor():
    # min 1, max 5, span 4 == width -> a single hand position at fret 1.
    # The old forward greedy anchored on the 3, then relocated on the 1.
    got = _compute_anchors(seq([3, 1, 5]), [])
    assert len(got) == 1
    assert got[0]["fret"] == 1


# --- anti-thrash outlier tolerance -----------------------------------------

def test_lone_high_outlier_is_a_reach_not_two_shifts():
    # 3 3 3 [12] 3 3 3 -> ONE anchor; the old greedy thrashed (3 -> 11 -> 3).
    got = _compute_anchors(seq([3, 3, 3, 12, 3, 3, 3]), [])
    assert len(got) == 1
    assert got[0]["fret"] == 2


def test_outlier_return_uses_the_effective_comfort_window():
    # The raw run spans only fret 3, but _place gives it window [2, 6]. A
    # return at fret 4 is inside that real window and must not cause 2→11→3
    # thrash around the lone fret-12 reach.
    got = _compute_anchors(seq([3, 3, 3, 12, 4, 4, 4]), [])
    assert frets_of(got) == [2]


def test_trailing_outlier_is_a_real_final_position():
    # No evidence of return (nothing follows) -> the final high note is a
    # genuine move, so it gets its own anchor rather than a phantom reach.
    got = _compute_anchors(seq([3, 3, 3, 12]), [])
    assert frets_of(got) == [2, 11]


def test_two_separated_blips_both_tolerated():
    got = _compute_anchors(seq([3, 20, 3, 20, 3]), [])
    assert len(got) == 1


def test_sustained_excursion_is_a_real_move():
    # Two notes at 12 -> a genuine trip up and back: three anchors.
    got = _compute_anchors(seq([3, 3, 12, 12, 3, 3]), [])
    assert frets_of(got) == [2, 11, 2]


def test_consecutive_outlier_then_non_return_breaks():
    # 3 [12 15] 3 -> the 12/15 pair is a real high region, not a lone reach.
    got = _compute_anchors(seq([3, 12, 15, 3]), [])
    assert len(got) == 3
    assert frets_of(got)[0] == 2 and frets_of(got)[-1] == 2


# --- long scale genuinely shifts -------------------------------------------

def test_ascending_scale_shifts_positions_monotonically():
    got = _compute_anchors(seq(list(range(1, 13))), [])
    fr = frets_of(got)
    assert len(fr) > 1
    assert fr == sorted(fr)                              # never moves backwards
    assert all(a != b for a, b in zip(fr, fr[1:]))       # no redundant repeats


# --- chords are one group (no mid-chord relocation) ------------------------

def test_wide_chord_is_a_single_group():
    # A chord spanning 3..12 must not thrash inside itself: one anchor.
    assert len(_compute_anchors([], [chord(1.0, [3, 5, 12])])) == 1


def test_chord_and_coincident_note_group_by_time():
    groups = _fretted_groups([note(1.0, 3)], [chord(1.0, [5, 7])])
    assert groups == [(1.0, 3, 7)]


# --- structural invariants + robustness ------------------------------------

def test_output_is_time_sorted_positive_and_deduped():
    got = _compute_anchors(seq([5, 9, 2, 14, 3, 7, 11, 1]), [])
    times = [a["time"] for a in got]
    assert times == sorted(times)
    assert all(a["fret"] >= 1 for a in got)
    assert all(a["width"] == 4 for a in got)
    assert all(a["fret"] != b["fret"] for a, b in zip(got, got[1:]))


def test_deterministic():
    data = seq([4, 8, 3, 12, 6, 2])
    assert _compute_anchors(data, []) == _compute_anchors(data, [])


def test_robust_to_missing_and_float_fields():
    notes = [{"time": 0.0}, {"time": 1.0, "fret": 5.0}]      # missing fret; float fret
    chords = [{"time": 2.0, "notes": [{"fret": 7}]}]         # chord note lacks time
    got = _compute_anchors(notes, chords)
    assert got
    assert all(a["fret"] >= 1 for a in got)


def test_every_in_range_note_lies_in_its_active_anchor_window():
    # A dense passage with no lone outliers: every note must sit inside the
    # active anchor's inclusive [fret, fret + width] window.
    frets = [2, 3, 4, 5, 6, 5, 4, 3, 7, 8, 9, 8, 7]
    anchors = _compute_anchors(seq(frets), [])

    def active(t):
        cur = anchors[0]
        for a in anchors:
            if a["time"] <= t + 1e-9:
                cur = a
        return cur

    for i, f in enumerate(frets):
        a = active(float(i))
        assert a["fret"] <= f <= a["fret"] + a["width"], (i, f, a)
