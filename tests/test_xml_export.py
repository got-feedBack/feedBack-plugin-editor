"""Tests for the editor's XML emission helpers.

Covers:
* tone-change emission (`<tonebase>` + `<tones>`)
* all new note technique attributes on `<note>` and `<chordNote>`
* chord-note overrides (one chord member with a technique its siblings lack)
* real `<handShapes>` emission (replacing the legacy hardcoded count="0")
* manual anchors via `anchors_user` overriding `_compute_anchors`
* default behavior unchanged when no new fields are supplied
"""
import copy
from xml.etree import ElementTree as ET

from routes import (
    _arr_dict_to_wire,
    _build_arrangement_xml,
    _compute_anchors,
    _handshapes_from_old_root,
    _tones_from_old_root,
)


# ---- helpers ---------------------------------------------------------------

EMPTY_OLD_ROOT = ET.fromstring(
    '<song version="7"><tuning string0="0" string1="0" string2="0" '
    'string3="0" string4="0" string5="0"/></song>'
)


def _bare_metadata(**over):
    base = {
        "title": "Test",
        "artistName": "Tester",
        "albumName": "Album",
        "albumYear": "2024",
        "arrangement": "Lead",
        "offset": "0.000",
        "songLength": "30.000",
        "startBeat": "0.000",
        "averageTempo": "120",
    }
    base.update(over)
    return base


def _note(time, string=0, fret=5, sustain=0.0, **tech):
    return {
        "time": time, "string": string, "fret": fret, "sustain": sustain,
        "techniques": tech,
    }


def _stub_templates(n=8):
    """A list of `n` placeholder chord templates so handshape `chord_id`
    values up to `n - 1` are in-range for the XML emission bound."""
    return [
        {"name": f"T{i}", "frets": [0]*6, "fingers": [-1]*6}
        for i in range(n)
    ]


def _build(notes=(), chords=(), templates=None, **kwargs):
    if templates is None:
        templates = _stub_templates()
    return _build_arrangement_xml(
        EMPTY_OLD_ROOT,
        list(notes), list(chords), list(templates),
        beats=[{"time": 0.0, "measure": 1}],
        sections=[{"name": "intro", "number": 1, "start_time": 0.0}],
        metadata=_bare_metadata(),
        **kwargs,
    )


def _parse(xml_str):
    return ET.fromstring(xml_str)


# ---- tones -----------------------------------------------------------------

def test_no_tones_emits_no_tonebase_or_tones_element():
    xml = _build()
    root = _parse(xml)
    assert root.find("tonebase") is None
    assert root.find("tones") is None


def test_tones_emits_tonebase_and_tones_with_slot_ids():
    tones = {
        "base": "Clean",
        "changes": [
            {"t": 1.0, "name": "Clean"},   # same as base → no id
            {"t": 5.0, "name": "Drive"},   # first non-base → id 0
            {"t": 10.0, "name": "Lead"},   # second non-base → id 1
            {"t": 15.0, "name": "Drive"},  # repeat → id 0 again
        ],
        "definitions": [],
    }
    xml = _build(tones=tones)
    root = _parse(xml)

    base = root.find("tonebase")
    assert base is not None and base.text == "Clean"

    tones_el = root.find("tones")
    assert tones_el is not None
    assert tones_el.get("count") == "4"

    entries = tones_el.findall("tone")
    assert len(entries) == 4
    # First entry — base, no id assigned.
    assert entries[0].get("name") == "Clean"
    assert entries[0].get("id") is None
    # Second — first non-base → slot 0.
    assert entries[1].get("name") == "Drive"
    assert entries[1].get("id") == "0"
    # Third — second non-base → slot 1.
    assert entries[2].get("name") == "Lead"
    assert entries[2].get("id") == "1"
    # Fourth — repeat of Drive → reuses slot 0.
    assert entries[3].get("name") == "Drive"
    assert entries[3].get("id") == "0"


def test_tones_changes_sorted_by_time():
    tones = {
        "base": "Clean",
        "changes": [
            {"t": 30.0, "name": "Lead"},
            {"t": 5.0, "name": "Drive"},
            {"t": 10.0, "name": "Drive"},
        ],
    }
    xml = _build(tones=tones)
    root = _parse(xml)
    times = [float(e.get("time")) for e in root.find("tones").findall("tone")]
    assert times == sorted(times)


def test_tones_payload_without_base_uses_clean_default_for_skip_check():
    """Payload with `changes` but no `base` — a change named "Clean" must not get a slot id.

    `<tonebase>` defaults to "Clean" in this case; the slot-id loop has
    to compare against the same effective value, otherwise "Clean" in
    changes incorrectly becomes a non-base slot.
    """
    tones = {
        "base": "",
        "changes": [
            {"t": 1.0, "name": "Clean"},
            {"t": 5.0, "name": "Drive"},
        ],
    }
    xml = _build(tones=tones)
    root = _parse(xml)
    assert root.find("tonebase").text == "Clean"
    entries = root.find("tones").findall("tone")
    assert entries[0].get("name") == "Clean"
    assert entries[0].get("id") is None
    assert entries[1].get("name") == "Drive"
    assert entries[1].get("id") == "0"


def test_tones_with_only_base_still_emits_tonebase():
    xml = _build(tones={"base": "Clean", "changes": []})
    root = _parse(xml)
    assert root.find("tonebase").text == "Clean"
    # Base-only authored — the tones block stays (count="0") so consumers
    # see "this arrangement has authored tone metadata, just no changes".
    tones_el = root.find("tones")
    assert tones_el is not None
    assert tones_el.get("count") == "0"


# ---- new technique attributes ---------------------------------------------

_NEW_NOTE_TECHS = {
    "vibrato": ("vibrato", "1"),
    "fret_hand_mute": ("fretHandMute", "1"),
    "pluck": ("pluck", "1"),
    "slap": ("slap", "1"),
    "ignore": ("ignore", "1"),
}


def test_new_note_techniques_emit_to_xml():
    notes = [_note(1.0, **{tech: True for tech in _NEW_NOTE_TECHS})]
    xml = _build(notes=notes)
    note_el = _parse(xml).find(".//notes/note")
    for tech, (xml_attr, expected) in _NEW_NOTE_TECHS.items():
        assert note_el.get(xml_attr) == expected, f"{tech!r} → {xml_attr}"


def test_right_hand_and_pick_direction_default_to_minus_one():
    note_el = _parse(_build(notes=[_note(1.0)])).find(".//notes/note")
    assert note_el.get("rightHand") == "-1"
    assert note_el.get("pickDirection") == "-1"


def test_right_hand_and_pick_direction_round_trip_integers():
    notes = [_note(1.0, right_hand=2, pick_direction=1)]
    note_el = _parse(_build(notes=notes)).find(".//notes/note")
    assert note_el.get("rightHand") == "2"
    assert note_el.get("pickDirection") == "1"


def test_link_next_emits_as_linkNext_attribute():
    note_el = _parse(_build(notes=[_note(1.0, link_next=True)])).find(
        ".//notes/note")
    assert note_el.get("linkNext") == "1"


# ---- chord-note overrides --------------------------------------------------

def test_chord_member_can_have_unique_technique():
    chord = {
        "time": 2.0, "chord_id": 0, "high_density": False,
        "notes": [
            # Member A — plain.
            {"time": 2.0, "string": 1, "fret": 3, "sustain": 0.5,
             "techniques": {}},
            # Member B — bent.
            {"time": 2.0, "string": 2, "fret": 5, "sustain": 0.5,
             "techniques": {"bend": 1.0, "vibrato": True}},
        ],
    }
    xml = _build(chords=[chord])
    chord_notes = _parse(xml).findall(".//chord/chordNote")
    assert len(chord_notes) == 2

    plain, bent = chord_notes
    assert plain.get("bend") == "0.0"
    assert plain.get("vibrato") == "0"

    assert bent.get("bend") == "1.0"
    assert bent.get("vibrato") == "1"


# ---- handshapes ------------------------------------------------------------

def test_handshapes_default_to_empty_count_zero():
    hs_el = _parse(_build()).find(".//handShapes")
    assert hs_el is not None
    assert hs_el.get("count") == "0"
    assert hs_el.findall("handShape") == []


def test_authored_handshapes_emit_to_xml():
    handshapes = [
        {"chord_id": 0, "start_time": 1.0, "end_time": 2.5},
        {"chord_id": 1, "start_time": 5.0, "end_time": 6.5, "arp": True},
    ]
    xml = _build(handshapes=handshapes)
    hs_el = _parse(xml).find(".//handShapes")
    assert hs_el.get("count") == "2"

    entries = hs_el.findall("handShape")
    assert entries[0].get("chordId") == "0"
    assert entries[0].get("startTime") == "1.000"
    assert entries[0].get("endTime") == "2.500"
    assert entries[0].get("arpeggio") is None

    assert entries[1].get("chordId") == "1"
    assert entries[1].get("arpeggio") == "1"


# ---- anchors_user override ------------------------------------------------

def test_anchors_user_overrides_compute_anchors_when_supplied():
    # With a note on fret 12, _compute_anchors would emit an anchor at
    # fret 11. Override forces our own positions instead.
    notes = [_note(1.0, fret=12)]
    custom = [
        {"time": 0.0, "fret": 5, "width": 4},
        {"time": 4.0, "fret": 10, "width": 5},
    ]
    xml = _build(notes=notes, anchors_user=custom)
    anchors = _parse(xml).findall(".//anchors/anchor")
    assert len(anchors) == 2
    assert (anchors[0].get("time"), anchors[0].get("fret"),
            anchors[0].get("width")) == ("0.000", "5", "4")
    assert (anchors[1].get("time"), anchors[1].get("fret"),
            anchors[1].get("width")) == ("4.000", "10", "5")


def test_empty_anchors_user_falls_back_to_compute_anchors():
    notes = [_note(1.0, fret=12)]
    xml = _build(notes=notes, anchors_user=[])
    auto = _compute_anchors(notes, [])
    anchors = _parse(xml).findall(".//anchors/anchor")
    assert len(anchors) == len(auto)
    assert anchors[0].get("fret") == str(auto[0]["fret"])


def test_empty_handshapes_honoured_explicitly():
    """Caller-supplied empty `handshapes=[]` emits `<handShapes count="0">`."""
    xml = _build(handshapes=[])
    hs_el = _parse(xml).find(".//handShapes")
    assert hs_el.get("count") == "0"


# ---- malformed payload defenses -------------------------------------------

def test_malformed_anchors_user_falls_back_silently():
    """A non-list / list of garbage shouldn't raise — fall back to auto."""
    notes = [_note(1.0, fret=12)]
    auto = _compute_anchors(notes, [])

    for bad in ("not a list", {"oops": True}, [None, "x", {"missing keys": 1}]):
        xml = _build(notes=notes, anchors_user=bad)
        anchors = _parse(xml).findall(".//anchors/anchor")
        assert len(anchors) == len(auto), (
            f"bad anchors_user {bad!r} should fall back to _compute_anchors"
        )


def test_malformed_handshapes_skipped_silently():
    """A non-list / list of garbage shouldn't raise — filter out bad entries."""
    for bad in ("not a list", {"oops": True}, [None, "x"]):
        xml = _build(handshapes=bad)
        hs_el = _parse(xml).find(".//handShapes")
        assert hs_el.get("count") == "0"


def test_partially_malformed_handshapes_keeps_valid_entries():
    handshapes = [
        {"chord_id": 0, "start_time": 1.0, "end_time": 2.0},
        "garbage",
        {"chord_id": "not an int", "start_time": 0.0, "end_time": 0.0},
        {"chord_id": 1, "start_time": 3.0, "end_time": 4.0},
    ]
    xml = _build(handshapes=handshapes)
    hs_el = _parse(xml).find(".//handShapes")
    assert hs_el.get("count") == "2"


def test_handshape_arp_string_false_is_not_truthy():
    """`"false"` / `"0"` for arp must decode to False, not Python-string-truthy True."""
    handshapes = [
        {"chord_id": 0, "start_time": 1.0, "end_time": 2.0, "arp": "false"},
        {"chord_id": 1, "start_time": 3.0, "end_time": 4.0, "arp": "0"},
        {"chord_id": 2, "start_time": 5.0, "end_time": 6.0, "arp": "true"},
        {"chord_id": 3, "start_time": 7.0, "end_time": 8.0, "arp": 1},
    ]
    xml = _build(handshapes=handshapes)
    entries = _parse(xml).find(".//handShapes").findall("handShape")
    assert entries[0].get("arpeggio") is None
    assert entries[1].get("arpeggio") is None
    assert entries[2].get("arpeggio") == "1"
    assert entries[3].get("arpeggio") == "1"


def test_handshape_with_chord_id_out_of_range_is_dropped():
    """`chordId` must be < len(chord_templates) — drop out-of-range entries."""
    handshapes = [
        {"chord_id": 0, "start_time": 1.0, "end_time": 2.0},
        {"chord_id": 5, "start_time": 3.0, "end_time": 4.0},  # template count == 2
        {"chord_id": 1, "start_time": 5.0, "end_time": 6.0},
    ]
    # Only 2 templates → ids 0 and 1 are valid; id 5 should drop.
    templates = [
        {"name": "C", "frets": [0, 1, 0, 2, 3, -1], "fingers": [-1]*6},
        {"name": "G", "frets": [3, 0, 0, 0, 2, 3], "fingers": [-1]*6},
    ]
    xml = _build(handshapes=handshapes, templates=templates)
    hs_el = _parse(xml).find(".//handShapes")
    assert hs_el.get("count") == "2"
    chord_ids = sorted(int(e.get("chordId")) for e in hs_el.findall("handShape"))
    assert chord_ids == [0, 1]


def test_tone_changes_drop_negative_and_non_finite_times():
    """Negative / NaN / inf tone times can't reach the XML."""
    tones = {
        "base": "Clean",
        "changes": [
            {"t": -1.0, "name": "Drive"},
            {"t": float("nan"), "name": "Drive"},
            {"t": float("inf"), "name": "Lead"},
            {"t": 5.0, "name": "Drive"},   # the only valid one
        ],
    }
    xml = _build(tones=tones)
    entries = _parse(xml).find("tones").findall("tone")
    assert len(entries) == 1
    assert entries[0].get("time") == "5.000"


def test_anchor_with_negative_or_non_finite_time_is_dropped():
    """Anchors with negative / NaN / inf time can't reach the XML."""
    anchors = [
        {"time": -1.0, "fret": 5, "width": 4},
        {"time": float("nan"), "fret": 5, "width": 4},
        {"time": float("inf"), "fret": 5, "width": 4},
        {"time": 2.0, "fret": 7, "width": 4},  # only valid
    ]
    xml = _build(notes=[_note(1.0)], anchors_user=anchors)
    entries = _parse(xml).findall(".//anchors/anchor")
    assert len(entries) == 1
    assert entries[0].get("time") == "2.000"


def test_anchor_with_zero_width_is_clamped_to_one():
    anchors = [{"time": 0.0, "fret": 5, "width": 0}]
    entry = _parse(_build(anchors_user=anchors)).find(".//anchors/anchor")
    assert entry.get("width") == "1"


def test_anchor_with_zero_or_negative_fret_is_clamped_to_one():
    anchors = [
        {"time": 0.0, "fret": 0, "width": 4},
        {"time": 1.0, "fret": -3, "width": 4},
    ]
    frets = [
        e.get("fret")
        for e in _parse(_build(anchors_user=anchors)).findall(".//anchors/anchor")
    ]
    assert frets == ["1", "1"]


def test_anchors_user_emitted_in_time_sorted_order():
    """Client-provided unsorted anchors get sorted by time before emission."""
    anchors = [
        {"time": 5.0, "fret": 10, "width": 4},
        {"time": 1.0, "fret": 2, "width": 4},
        {"time": 3.0, "fret": 5, "width": 4},
    ]
    times = [
        e.get("time")
        for e in _parse(_build(anchors_user=anchors)).findall(".//anchors/anchor")
    ]
    assert times == ["1.000", "3.000", "5.000"]


def test_handshape_with_invalid_times_is_dropped():
    """Negative / non-finite / end<start handshapes are dropped."""
    handshapes = [
        {"chord_id": 0, "start_time": -1.0, "end_time": 2.0},
        {"chord_id": 0, "start_time": float("nan"), "end_time": 2.0},
        {"chord_id": 0, "start_time": 5.0, "end_time": 3.0},  # reversed
        {"chord_id": 0, "start_time": 1.0, "end_time": 2.0},  # only valid
    ]
    xml = _build(handshapes=handshapes)
    hs_el = _parse(xml).find(".//handShapes")
    assert hs_el.get("count") == "1"


def test_handshape_with_negative_or_missing_chord_id_is_dropped():
    """`chordId` must be a non-negative (zero-based) chord-template index — drop sentinel/missing rows."""
    handshapes = [
        {"chord_id": 0, "start_time": 1.0, "end_time": 2.0},  # kept
        {"start_time": 3.0, "end_time": 4.0},                 # missing
        {"chord_id": -1, "start_time": 5.0, "end_time": 6.0}, # negative
        {"chord_id": 5, "start_time": 7.0, "end_time": 8.0},  # kept
    ]
    xml = _build(handshapes=handshapes)
    hs_el = _parse(xml).find(".//handShapes")
    assert hs_el.get("count") == "2"
    chord_ids = [e.get("chordId") for e in hs_el.findall("handShape")]
    assert chord_ids == ["0", "5"]


# ---- preservation from old_root -------------------------------------------

def test_tones_from_old_root_returns_none_when_absent():
    root = ET.fromstring('<song><capo>0</capo></song>')
    assert _tones_from_old_root(root) is None


def test_tones_from_old_root_extracts_base_and_changes():
    root = ET.fromstring(
        '<song>'
        '<tonebase>Clean</tonebase>'
        '<tones count="2">'
        '<tone time="5.0" name="Drive"/>'
        '<tone time="10.0" name="Lead"/>'
        '</tones>'
        '</song>'
    )
    parsed = _tones_from_old_root(root)
    assert parsed["base"] == "Clean"
    assert parsed["definitions"] == []
    assert parsed["changes"] == [
        {"t": 5.0, "name": "Drive"},
        {"t": 10.0, "name": "Lead"},
    ]


def test_handshapes_from_old_root_extracts_first_level():
    root = ET.fromstring(
        '<song><levels><level difficulty="0"><handShapes count="2">'
        '<handShape chordId="3" startTime="1.0" endTime="2.5"/>'
        '<handShape chordId="4" startTime="5.0" endTime="6.5" arpeggio="1"/>'
        '</handShapes></level></levels></song>'
    )
    parsed = _handshapes_from_old_root(root)
    assert parsed == [
        {"chord_id": 3, "start_time": 1.0, "end_time": 2.5, "arp": False},
        {"chord_id": 4, "start_time": 5.0, "end_time": 6.5, "arp": True},
    ]


# ---- wire-format round-trip -----------------------------------------------

def test_arr_dict_to_wire_includes_new_short_codes():
    notes = [_note(1.0, vibrato=True, fret_hand_mute=True, pluck=True,
                   slap=True, right_hand=2, pick_direction=1,
                   ignore=True, link_next=True)]
    wire = _arr_dict_to_wire(
        "Lead", [0]*6, 0, notes, [], [],
    )
    wn = wire["notes"][0]
    assert wn["vb"] is True
    assert wn["fhm"] is True
    assert wn["plk"] is True
    assert wn["slp"] is True
    assert wn["rh"] == 2
    assert wn["pkd"] == 1
    assert wn["ig"] is True
    assert wn["ln"] is True


def test_arr_dict_to_wire_emits_tones_when_provided():
    tones = {"base": "Clean", "changes": [{"t": 1.0, "name": "Drive"}]}
    wire = _arr_dict_to_wire(
        "Lead", [0]*6, 0, [], [], [], tones=tones,
    )
    assert wire["tones"] == tones


def test_arr_dict_to_wire_omits_tones_when_none():
    wire = _arr_dict_to_wire("Lead", [0]*6, 0, [], [], [])
    assert "tones" not in wire


def test_arr_dict_to_wire_safe_int_on_right_hand_pick_direction():
    """Malformed `right_hand`/`pick_direction` decode to -1 instead of crashing."""
    notes = [_note(1.0, right_hand="up", pick_direction=None)]
    wire = _arr_dict_to_wire("Lead", [0]*6, 0, notes, [], [])
    assert wire["notes"][0]["rh"] == -1
    assert wire["notes"][0]["pkd"] == -1


def test_arr_dict_to_wire_tolerates_malformed_anchors_and_handshapes():
    """Bad payloads don't 500 — the wire builder drops invalid entries.

    Empty / malformed `anchors_user` falls back to `_compute_anchors`
    (covered by `..._recomputes_via_compute_anchors`); here we just
    confirm a garbage payload doesn't crash and the wire still has
    well-formed handshape entries.
    """
    wire = _arr_dict_to_wire(
        "Lead", [0]*6, 0, [], [], _stub_templates(2),
        anchors_user="not a list",
        handshapes=[None, "garbage", {"chord_id": 0}],  # last is half-valid
    )
    assert isinstance(wire["anchors"], list)
    # The half-valid handshape survives — chord_id=0, defaults for the rest.
    assert all(isinstance(h, dict) for h in wire["handshapes"])
    assert len(wire["handshapes"]) == 1
    assert wire["handshapes"][0]["chord_id"] == 0


def test_note_attrs_xml_tolerates_none_for_slide_and_bend():
    """`slide_to: None` / `bend: "abc"` shouldn't emit "None" or crash formatting."""
    notes = [_note(1.0, slide_to=None, slide_unpitch_to=None, bend="not a number")]
    note_el = _parse(_build(notes=notes)).find(".//notes/note")
    assert note_el.get("slideTo") == "-1"
    assert note_el.get("slideUnpitchTo") == "-1"
    assert note_el.get("bend") == "0.0"


def test_arr_dict_to_wire_tolerates_none_for_slide_and_bend():
    """Same defensive coercion through the wire builder."""
    notes = [_note(1.0, slide_to=None, slide_unpitch_to=None, bend="abc")]
    wire = _arr_dict_to_wire("Lead", [0]*6, 0, notes, [], [])
    wn = wire["notes"][0]
    assert wn["sl"] == -1
    assert wn["slu"] == -1
    assert wn["bn"] == 0


def test_arr_dict_to_wire_emits_bend_shape():
    """bt/bnv (§6.2.1) ride the wire alongside the scalar bn peak."""
    notes = [_note(1.0, bend=2.0, bend_intent=4, bend_values=[
        {"t": 0.0, "v": 0.0}, {"t": 0.25, "v": 2.0}, {"t": 0.5, "v": 0.0}])]
    wn = _arr_dict_to_wire("Lead", [0]*6, 0, notes, [], [])["notes"][0]
    assert wn["bn"] == 2.0
    assert wn["bt"] == 4
    assert wn["bnv"] == [
        {"t": 0.0, "v": 0.0}, {"t": 0.25, "v": 2.0}, {"t": 0.5, "v": 0.0}]


def test_arr_dict_to_wire_default_omits_bend_shape():
    """bt omitted when 0, bnv omitted when absent — keeps payloads tight."""
    wn = _arr_dict_to_wire(
        "Lead", [0]*6, 0, [_note(1.0, bend=1.0)], [], [])["notes"][0]
    assert "bt" not in wn
    assert "bnv" not in wn


def test_arr_dict_to_wire_sanitizes_bend_curve():
    """Malformed bnv entries dropped and sorted by t; empty/garbage -> omitted."""
    notes = [_note(1.0, bend=2.0, bend_values=[
        {"t": 0.5, "v": 2.0}, {"t": "x", "v": 1}, {"t": 0.0, "v": 0.0}, "junk"])]
    wn = _arr_dict_to_wire("Lead", [0]*6, 0, notes, [], [])["notes"][0]
    assert wn["bnv"] == [{"t": 0.0, "v": 0.0}, {"t": 0.5, "v": 2.0}]
    notes2 = [_note(1.0, bend=2.0, bend_values=[{"t": "a", "v": "b"}])]
    wn2 = _arr_dict_to_wire("Lead", [0]*6, 0, notes2, [], [])["notes"][0]
    assert "bnv" not in wn2


# ---- teaching marks fg/ch/sd (§6.2.2) --------------------------------------

def test_arr_dict_to_wire_emits_teaching_marks():
    """fg/ch/sd ride the wire under their literal short codes."""
    notes = [_note(1.0, fret_finger=2, strum_group=5, scale_degree=7)]
    wn = _arr_dict_to_wire("Lead", [0]*6, 0, notes, [], [])["notes"][0]
    assert wn["fg"] == 2
    assert wn["ch"] == 5
    assert wn["sd"] == 7


def test_arr_dict_to_wire_default_omits_teaching_marks():
    """fg/ch/sd are default-omitted when unset (-1) so payloads stay tight."""
    wn = _arr_dict_to_wire("Lead", [0]*6, 0, [_note(1.0)], [], [])["notes"][0]
    for k in ("fg", "ch", "sd"):
        assert k not in wn


def test_fret_finger_round_trips_through_xml():
    """fg exports as the `fretFinger` chart-XML attr (core's _parse_note reads
    it back); strum_group/scale_degree have no chart-XML attribute."""
    note_el = _parse(_build(notes=[_note(1.0, fret_finger=3)])).find(".//notes/note")
    assert note_el.get("fretFinger") == "3"
    # Default unset.
    plain = _parse(_build(notes=[_note(1.0)])).find(".//notes/note")
    assert plain.get("fretFinger") == "-1"


def test_arr_dict_to_wire_chord_note_carries_bend_shape():
    """Chord member notes inherit bt/bnv through _note_in_chord -> _note."""
    chord = {
        "time": 2.0, "chord_id": 0, "high_density": False,
        "notes": [_note(2.0, string=1, fret=5, bend=1.0, bend_intent=2,
                        bend_values=[{"t": 0.0, "v": 1.0}, {"t": 0.3, "v": 0.0}])],
    }
    wire = _arr_dict_to_wire("Lead", [0]*6, 0, [], [chord], _stub_templates(2))
    cn = wire["chords"][0]["notes"][0]
    assert cn["bt"] == 2
    assert cn["bnv"] == [{"t": 0.0, "v": 1.0}, {"t": 0.3, "v": 0.0}]


def test_note_tech_fields_include_bend_intent_not_values():
    """bend_intent joins the signature-backed field set; bend_values (a list)
    is handled explicitly so it can't land in the hashable content signatures."""
    from routes import _NOTE_TECH_FIELDS
    assert "bend_intent" in _NOTE_TECH_FIELDS
    assert "bend_values" not in _NOTE_TECH_FIELDS


def test_chord_high_density_string_false_decodes_to_false():
    """Wire-style "false" / "0" for `high_density` must not flip the flag on.

    Hits both the XML emission (`highDensity` attr) and the wire-format
    encoding (`hd` short code).
    """
    chord_false = {
        "time": 1.0, "chord_id": 0, "high_density": "false",
        "notes": [{"time": 1.0, "string": 1, "fret": 3, "sustain": 0.0,
                   "techniques": {}}],
    }
    chord_true = {
        "time": 2.0, "chord_id": 0, "high_density": "1",
        "notes": [{"time": 2.0, "string": 1, "fret": 3, "sustain": 0.0,
                   "techniques": {}}],
    }
    # XML side
    chords_el = _parse(_build(chords=[chord_false, chord_true])).findall(
        ".//chord")
    assert chords_el[0].get("highDensity") == "0"
    assert chords_el[1].get("highDensity") == "1"
    # Wire side
    wire = _arr_dict_to_wire("Lead", [0]*6, 0, [], [chord_false, chord_true], [])
    assert wire["chords"][0]["hd"] is False
    assert wire["chords"][1]["hd"] is True


def test_technique_flag_string_false_decodes_to_false():
    """Wire-style "false" / "0" must not flip flags on via string-truthiness.

    Hits both surfaces (`_arr_dict_to_wire._note` for the wire path,
    `_note_attrs_xml` for the XML path).
    """
    notes = [
        _note(1.0, vibrato="false", fret_hand_mute="0", pluck="no",
              slap=False, link_next="true", ignore="1"),
    ]
    # XML side
    note_el = _parse(_build(notes=notes)).find(".//notes/note")
    assert note_el.get("vibrato") == "0"
    assert note_el.get("fretHandMute") == "0"
    assert note_el.get("pluck") == "0"
    assert note_el.get("slap") == "0"
    assert note_el.get("linkNext") == "1"
    assert note_el.get("ignore") == "1"
    # Wire side
    wire = _arr_dict_to_wire("Lead", [0]*6, 0, notes, [], [])
    wn = wire["notes"][0]
    assert wn["vb"] is False
    assert wn["fhm"] is False
    assert wn["plk"] is False
    assert wn["slp"] is False
    assert wn["ln"] is True
    assert wn["ig"] is True


def test_note_attrs_xml_tolerates_non_numeric_right_hand_pick_direction():
    """Malformed `right_hand` / `pick_direction` defaults to -1 instead of crashing."""
    notes = [_note(1.0, right_hand="up", pick_direction=None)]
    xml = _build(notes=notes)
    note_el = _parse(xml).find(".//notes/note")
    assert note_el.get("rightHand") == "-1"
    assert note_el.get("pickDirection") == "-1"


def test_arr_dict_to_wire_empty_anchors_user_recomputes_via_compute_anchors():
    """Sloppak save: empty `anchors_user` → auto-compute, never persist zero anchors.

    The highway reads `wire["anchors"]` for fret-hand positioning; a
    sloppak with no anchors at all would render badly. Mirrors the XML
    writer's fallback semantic.
    """
    notes = [_note(1.0, fret=12)]
    auto = _compute_anchors(notes, [])
    # explicit empty list
    wire = _arr_dict_to_wire(
        "Lead", [0]*6, 0, notes, [], [], anchors_user=[],
    )
    assert len(wire["anchors"]) == len(auto) > 0
    assert wire["anchors"][0]["fret"] == auto[0]["fret"]
    # malformed → also auto-compute
    wire = _arr_dict_to_wire(
        "Lead", [0]*6, 0, notes, [], [], anchors_user="garbage",
    )
    assert len(wire["anchors"]) == len(auto) > 0


def test_arr_dict_to_wire_handshapes_and_anchors_user():
    handshapes = [{"chord_id": 0, "start_time": 1.0, "end_time": 2.0,
                   "arp": True}]
    anchors = [{"time": 0.0, "fret": 5, "width": 4}]
    wire = _arr_dict_to_wire(
        "Lead", [0]*6, 0, [], [], _stub_templates(1),
        handshapes=handshapes, anchors_user=anchors,
    )
    assert wire["handshapes"][0]["chord_id"] == 0
    assert wire["handshapes"][0]["arp"] is True
    assert wire["anchors"][0]["fret"] == 5


# ---- phrase level repopulation --------------------------------------------
#
# Regression for the "highway shows original chart instead of edits" bug:
# `_save_sloppak` used to round-trip phrase levels verbatim from the source
# archive, so `static/highway.js`'s mastery filter (which reads notes from
# `phrases[].levels[idx].notes`, never from the flat `notes` array, when
# phrases are present) silently rendered the original chart.

from routes import _repopulate_phrase_levels


def _phrase(start, end, n_levels=1, *, notes=None, max_diff=None):
    levels = [
        {"difficulty": i,
         "notes": list(notes) if notes is not None else [{"t": -999}],
         "chords": [{"t": -999}],
         "anchors": [{"time": -999}],
         "handshapes": [{"chord_id": i}]}
        for i in range(n_levels)
    ]
    return {
        "start_time": start,
        "end_time": end,
        "max_difficulty": (n_levels - 1) if max_diff is None else max_diff,
        "levels": levels,
    }


def test_repopulate_phrase_levels_slices_by_time_window():
    phrases = [_phrase(0.0, 5.0), _phrase(5.0, 10.0)]
    notes = [
        {"t": 1.0, "s": 0, "f": 3},
        {"t": 4.999, "s": 1, "f": 5},
        {"t": 5.0, "s": 2, "f": 7},     # boundary belongs to next phrase
        {"t": 9.0, "s": 3, "f": 9},
    ]
    out = _repopulate_phrase_levels(phrases, notes, [], [])
    assert [n["t"] for n in out[0]["levels"][0]["notes"]] == [1.0, 4.999]
    # Last phrase: end extends to +inf, so the 9.0 note lands in it.
    assert [n["t"] for n in out[1]["levels"][0]["notes"]] == [5.0, 9.0]


def test_repopulate_phrase_levels_first_phrase_catches_pre_start_notes():
    """Notes before the first phrase's start_time still need to surface
    on the highway — they fall into the first phrase's level (which
    extends back to -inf)."""
    phrases = [_phrase(10.0, 20.0), _phrase(20.0, 30.0)]
    notes = [{"t": 0.5, "s": 0, "f": 3}, {"t": 25.0, "s": 1, "f": 5}]
    out = _repopulate_phrase_levels(phrases, notes, [], [])
    assert out[0]["levels"][0]["notes"] == [{"t": 0.5, "s": 0, "f": 3}]
    assert out[1]["levels"][0]["notes"] == [{"t": 25.0, "s": 1, "f": 5}]


def test_repopulate_phrase_levels_ignores_stale_end_time():
    """Boundaries come from the *next* phrase's start_time, not from
    `end_time`. The editor's tempo remap touches phrase start times but
    not end times, so a stale `end_time` must not mis-bucket a note.

    Setup: phrase[0] has end_time=2.0 (stale, predating a tempo edit
    that pushed phrase[1].start_time out to 8.0). A note at t=5.0
    falls in the gap relative to end_time but inside the live
    [phrase[0].start, phrase[1].start) window. The slicer must land
    it in phrase[0]."""
    phrases = [_phrase(0.0, 2.0), _phrase(8.0, 10.0)]
    notes = [{"t": 5.0, "s": 0, "f": 3}]
    out = _repopulate_phrase_levels(phrases, notes, [], [])
    assert out[0]["levels"][0]["notes"] == [{"t": 5.0, "s": 0, "f": 3}]
    assert out[1]["levels"][0]["notes"] == []


def test_repopulate_phrase_levels_overwrites_stale_levels():
    """Each level's old `notes` (representing the source archive) must be
    replaced — not merged — by the fresh slice. Otherwise stale notes
    would still surface in the mastery filter."""
    phrases = [_phrase(0.0, 5.0, n_levels=3)]
    notes = [{"t": 2.0, "s": 0, "f": 3}]
    out = _repopulate_phrase_levels(phrases, notes, [], [])
    for lv in out[0]["levels"]:
        assert lv["notes"] == notes
        # Sentinel -999 from the input must be gone.
        assert all(n["t"] != -999 for n in lv["notes"])


def test_repopulate_phrase_levels_last_phrase_catches_past_end_notes():
    """User additions past the original last-phrase boundary should not
    disappear from the chart."""
    phrases = [_phrase(0.0, 5.0), _phrase(5.0, 10.0)]
    notes = [{"t": 99.0, "s": 0, "f": 3}]
    out = _repopulate_phrase_levels(phrases, notes, [], [])
    assert out[0]["levels"][0]["notes"] == []
    assert out[1]["levels"][0]["notes"] == [{"t": 99.0, "s": 0, "f": 3}]


def test_repopulate_phrase_levels_preserves_handshapes_and_metadata():
    """Handshapes aren't editor-authored — they must round-trip verbatim,
    along with phrase metadata (start/end/max_difficulty) and level
    `difficulty`."""
    phrases = [_phrase(0.0, 5.0, n_levels=2, max_diff=7)]
    out = _repopulate_phrase_levels(phrases, [], [], [])
    p = out[0]
    assert p["start_time"] == 0.0
    assert p["end_time"] == 5.0
    assert p["max_difficulty"] == 7
    assert [lv["difficulty"] for lv in p["levels"]] == [0, 1]
    assert [lv["handshapes"] for lv in p["levels"]] == [
        [{"chord_id": 0}], [{"chord_id": 1}],
    ]


def test_repopulate_phrase_levels_does_not_mutate_input():
    phrases = [_phrase(0.0, 5.0)]
    snapshot = copy.deepcopy(phrases)
    _repopulate_phrase_levels(phrases, [{"t": 1.0}], [], [])
    assert phrases == snapshot


def test_repopulate_phrase_levels_handles_chords_and_anchors():
    phrases = [_phrase(0.0, 10.0)]
    chords = [{"t": 1.0, "id": 0}, {"t": 9.0, "id": 1}]
    anchors = [{"time": 0.0, "fret": 5, "width": 4},
               {"time": 8.0, "fret": 7, "width": 4}]
    out = _repopulate_phrase_levels(phrases, [], chords, anchors)
    lv = out[0]["levels"][0]
    assert lv["chords"] == chords
    assert lv["anchors"] == anchors
