"""Wire-serialization tests for the per-chord harmony annotations (§6.3.1 fn /
§6.6 voicing): default-omitted + range-guarded, matching core's _validate_fn and
the teaching-marks (#17) guard. Display only — never grading."""

import pytest

from routes import (_arr_dict_to_wire, _caged_wire, _chord_fn_wire,
                    _guide_tones_wire)


def _chord(time=1.0, chord_id=0, fn=None, notes=None):
    c = {"time": time, "chord_id": chord_id, "high_density": False,
         "notes": notes if notes is not None else [
             {"time": time, "string": 0, "fret": 3, "sustain": 0.0, "techniques": {}}]}
    if fn is not None:
        c["fn"] = fn
    return c


def _template(name="Am", voicing=None, caged=None, guideTones=None):
    ct = {"name": name, "displayName": name, "frets": [-1, 0, 2, 2, 1, 0],
          "fingers": [-1] * 6}
    if voicing is not None:
        ct["voicing"] = voicing
    if caged is not None:
        ct["caged"] = caged
    if guideTones is not None:
        ct["guideTones"] = guideTones
    return ct


def _wire(chords=(), templates=()):
    return _arr_dict_to_wire("Lead", [0] * 6, 0, [], list(chords), list(templates))


# ── chord fn (§6.3.1) ────────────────────────────────────────────────────────

def test_chord_fn_emitted_when_complete():
    w = _wire(chords=[_chord(fn={"rn": "ii7", "q": "m7", "deg": 2})])
    assert w["chords"][0]["fn"] == {"rn": "ii7", "q": "m7", "deg": 2}


def test_chord_fn_omitted_when_absent():
    assert "fn" not in _wire(chords=[_chord()])["chords"][0]


@pytest.mark.parametrize("bad", [
    {},                                     # empty
    {"rn": "ii7", "q": "m7"},               # missing deg
    {"rn": "ii7", "deg": 2},                # missing q
    {"q": "m7", "deg": 2},                  # missing rn
    {"rn": "", "q": "m7", "deg": 2},        # blank rn
    {"rn": "ii7", "q": "  ", "deg": 2},     # blank q
    {"rn": "ii7", "q": "m7", "deg": 15},    # deg too high
    {"rn": "ii7", "q": "m7", "deg": -1},    # deg too low
    {"rn": "ii7", "q": "m7", "deg": "2"},   # deg not int
    {"rn": "ii7", "q": "m7", "deg": True},  # deg bool
    "ii7",                                  # not a dict
])
def test_chord_fn_omitted_when_partial_or_out_of_range(bad):
    assert "fn" not in _wire(chords=[_chord(fn=bad)])["chords"][0]


def test_chord_fn_trimmed_on_emit():
    w = _wire(chords=[_chord(fn={"rn": " V7 ", "q": " 7 ", "deg": 7})])
    assert w["chords"][0]["fn"] == {"rn": "V7", "q": "7", "deg": 7}


def test_chord_fn_wire_helper_validates():
    assert _chord_fn_wire({"rn": "vi", "q": "m", "deg": 9}) == {"rn": "vi", "q": "m", "deg": 9}
    assert _chord_fn_wire({"rn": "vi", "q": "m"}) is None
    assert _chord_fn_wire(None) is None


# ── template voicing (§6.6) ──────────────────────────────────────────────────

def test_template_voicing_emitted_when_present():
    assert _wire(templates=[_template(voicing="drop2")])["templates"][0]["voicing"] == "drop2"


def test_template_voicing_trimmed():
    assert _wire(templates=[_template(voicing="  open ")])["templates"][0]["voicing"] == "open"


@pytest.mark.parametrize("empty", [None, "", "   "])
def test_template_voicing_omitted_when_empty(empty):
    assert "voicing" not in _wire(templates=[_template(voicing=empty)])["templates"][0]


@pytest.mark.parametrize("bad", [7, ["open"], {"v": "open"}])
def test_template_voicing_omitted_when_non_string(bad):
    assert "voicing" not in _wire(templates=[_template(voicing=bad)])["templates"][0]


# ── template caged (§6.6) ────────────────────────────────────────────────────

def test_template_caged_emitted_when_valid():
    assert _wire(templates=[_template(caged="E")])["templates"][0]["caged"] == "E"


def test_template_caged_trimmed():
    assert _wire(templates=[_template(caged="  G ")])["templates"][0]["caged"] == "G"


@pytest.mark.parametrize("empty", [None, "", "   "])
def test_template_caged_omitted_when_empty(empty):
    assert "caged" not in _wire(templates=[_template(caged=empty)])["templates"][0]


@pytest.mark.parametrize("bad", ["X", "e", "CE", 7, ["E"], {"c": "E"}])
def test_template_caged_omitted_when_invalid(bad):
    assert "caged" not in _wire(templates=[_template(caged=bad)])["templates"][0]


def test_caged_wire_helper_validates():
    assert _caged_wire(" C ") == "C"
    assert _caged_wire("X") == ""
    assert _caged_wire(None) == ""


# ── template guideTones (§6.6) ───────────────────────────────────────────────

def test_template_guide_tones_emitted_when_present():
    assert _wire(templates=[_template(guideTones=[4, 10])])["templates"][0]["guideTones"] == [4, 10]


def test_template_guide_tones_filters_out_of_range_and_non_int():
    w = _wire(templates=[_template(guideTones=[4, 12, -1, "x", 10, True])])
    assert w["templates"][0]["guideTones"] == [4, 10]   # bool + out-of-range + str dropped


@pytest.mark.parametrize("empty", [None, [], [12], [-1], "4,10", 7])
def test_template_guide_tones_omitted_when_empty_or_invalid(empty):
    assert "guideTones" not in _wire(templates=[_template(guideTones=empty)])["templates"][0]


def test_guide_tones_wire_helper_validates():
    assert _guide_tones_wire([0, 4, 11]) == [0, 4, 11]
    assert _guide_tones_wire([12, -1, True, "3"]) == []
    assert _guide_tones_wire(None) == []
