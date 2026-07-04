"""Tests for the shared `_arr_to_data` arrangement-dict builder (routes.py).

`_arr_to_data` turns a parsed `lib.song` arrangement into the wire dict the
editor frontend appends to `S.arrangements`. It is pure, so the tests use
lightweight fakes rather than a full parser fixture.
"""
from types import SimpleNamespace

from routes import _NOTE_TECH_BOOL_FIELDS, _NOTE_TECH_FIELDS, _arr_to_data


def _tech_defaults(**kw):
    base = {key: -1 for key in _NOTE_TECH_FIELDS}
    base.update(
        bend=None,
        slide_to=-1,
        slide_unpitch_to=-1,
        hammer_on=False,
        pull_off=False,
        harmonic=False,
        harmonic_pinch=False,
        palm_mute=False,
        mute=False,
        vibrato=False,
        tremolo=False,
        accent=False,
        tap=False,
        link_next=False,
        fret_hand_mute=False,
        pluck=False,
        slap=False,
        right_hand=-1,
        pick_direction=-1,
        ignore=False,
        fret_finger=-1,
        strum_group=-1,
        scale_degree=-1,
        bend_values=None,
    )
    base.update(kw)
    return base


def _note(**kw):
    base = dict(time=1.23456, string=0, fret=5, sustain=0.5)
    base.update(_tech_defaults())
    base.update(kw)
    return SimpleNamespace(**base)


def _chord_note(**kw):
    base = dict(time=2.0, string=1, fret=7, sustain=0.0)
    base.update(_tech_defaults())
    base.update(kw)
    return SimpleNamespace(**base)


def _make_arr(**kw):
    base = dict(
        tuning=[0, 0, 0, 0, 0, 0],
        capo=0,
        notes=[],
        chords=[],
        chord_templates=[],
        anchors=[],
        hand_shapes=[],
    )
    base.update(kw)
    return SimpleNamespace(**base)


def test_basic_shape_and_name():
    arr = _make_arr()
    data = _arr_to_data(arr, "Bass")
    assert data["name"] == "Bass"
    assert data["tuning"] == [0, 0, 0, 0, 0, 0]
    assert data["capo"] == 0
    assert data["notes"] == []
    assert data["chords"] == []
    assert data["chord_templates"] == []
    assert data["anchors"] == []
    assert data["anchors_user"] == []
    assert data["handshapes"] == []


def test_notes_rounded_and_all_techniques_carried():
    arr = _make_arr(notes=[_note(
        time=1.23456,
        sustain=0.98765,
        fret=3,
        palm_mute=True,
        slap=True,
        pluck=True,
        right_hand=2,
        pick_direction=1,
        fret_hand_mute=True,
        bend_values=[{"t": 0, "v": 1.0}],
    )])
    data = _arr_to_data(arr, "Lead")
    n = data["notes"][0]
    assert n["time"] == 1.235
    assert n["sustain"] == 0.988
    assert n["fret"] == 3
    assert n["string"] == 0
    assert n["techniques"]["palm_mute"] is True
    assert n["techniques"]["slap"] is True
    assert n["techniques"]["pluck"] is True
    assert n["techniques"]["right_hand"] == 2
    assert n["techniques"]["pick_direction"] == 1
    assert n["techniques"]["fret_hand_mute"] is True
    assert n["techniques"]["bend_values"] == [{"t": 0, "v": 1.0}]
    for key in _NOTE_TECH_FIELDS:
        assert key in n["techniques"]


def test_missing_optional_techniques_use_safe_defaults():
    """A parser/core note that omits optional technique attrs must fall back to
    field-typed defaults, NOT a blanket -1. The save path coerces booleans with
    `_safe_bool`, and `_safe_bool(-1)` is True, so a -1 default would silently
    switch on every absent boolean technique on an import -> save round trip;
    `bend` -1 becomes a spurious -1.0 bend and `bend_intent` -1 a schema-invalid
    `bt`."""
    bare = SimpleNamespace(time=1.0, string=0, fret=5, sustain=0.5)
    tech = _arr_to_data(_make_arr(notes=[bare]), "Lead")["notes"][0]["techniques"]
    for key in _NOTE_TECH_BOOL_FIELDS:
        assert tech[key] is False, f"{key} must default False, got {tech[key]!r}"
    assert tech["bend"] is None
    assert tech["bend_intent"] == 0
    assert tech["bend_values"] is None
    for key in ("slide_to", "slide_unpitch_to", "right_hand", "pick_direction",
                "fret_finger", "strum_group", "scale_degree"):
        assert tech[key] == -1


def test_chords_and_templates_preserve_authoring_metadata():
    chord = SimpleNamespace(
        time=2.5,
        chord_id=4,
        high_density=True,
        fn={"rn": "I", "q": "maj", "deg": 0},
        notes=[
            _chord_note(string=0, fret=3, slap=True),
            _chord_note(string=1, fret=5, pluck=True),
        ],
    )
    ct = SimpleNamespace(
        name="C",
        display_name="Cmaj",
        arpeggio=True,
        frets=[3, 2, 0, 1, 0, -1],
        fingers=[3, 2, 0, 1, 0, -1],
        voicing="drop2",
        caged="C",
        guide_tones=[4, 10],
    )
    arr = _make_arr(chords=[chord], chord_templates=[ct])
    data = _arr_to_data(arr, "Rhythm")

    c = data["chords"][0]
    assert c["time"] == 2.5
    assert c["chord_id"] == 4
    assert c["high_density"] is True
    assert c["fn"] == {"rn": "I", "q": "maj", "deg": 0}
    assert len(c["notes"]) == 2
    assert c["notes"][0]["fret"] == 3
    assert c["notes"][0]["techniques"]["slap"] is True
    assert c["notes"][1]["techniques"]["pluck"] is True
    for key in _NOTE_TECH_FIELDS:
        assert key in c["notes"][0]["techniques"]

    tmpl = data["chord_templates"][0]
    assert tmpl["name"] == "C"
    assert tmpl["displayName"] == "Cmaj"
    assert tmpl["arp"] is True
    assert tmpl["frets"] == [3, 2, 0, 1, 0, -1]
    assert tmpl["fingers"] == [3, 2, 0, 1, 0, -1]
    assert tmpl["voicing"] == "drop2"
    assert tmpl["caged"] == "C"
    assert tmpl["guideTones"] == [4, 10]


def test_template_display_name_falls_back_to_name():
    ct = SimpleNamespace(name="Am", display_name="", frets=[], fingers=[])
    arr = _make_arr(chord_templates=[ct])
    data = _arr_to_data(arr, "Lead")
    tmpl = data["chord_templates"][0]
    assert tmpl["displayName"] == "Am"
    assert tmpl["arp"] is False
    assert tmpl["voicing"] == ""
    assert tmpl["caged"] == ""
    assert tmpl["guideTones"] == []


def test_anchors_and_handshapes_carried_for_imported_arrangements():
    anchors = [
        SimpleNamespace(time=10.406, fret=3, width=4),
        SimpleNamespace(time=13.671, fret=1, width=4),
        SimpleNamespace(time=16.937, fret=5, width=4),
    ]
    hand_shapes = [
        SimpleNamespace(chord_id=2, start_time=1.23456, end_time=3.45678, arpeggio=True),
    ]
    arr = _make_arr(anchors=anchors, hand_shapes=hand_shapes)
    data = _arr_to_data(arr, "Lead")

    expected_anchors = [
        {"time": 10.406, "fret": 3, "width": 4},
        {"time": 13.671, "fret": 1, "width": 4},
        {"time": 16.937, "fret": 5, "width": 4},
    ]
    assert data["anchors"] == expected_anchors
    assert data["anchors_user"] == expected_anchors
    assert data["anchors_user"] is not data["anchors"]
    assert data["handshapes"] == [
        {"chord_id": 2, "start_time": 1.235, "end_time": 3.457, "arp": True},
    ]
