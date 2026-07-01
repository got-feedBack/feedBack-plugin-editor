"""Tests for the shared `_arr_to_data` arrangement-dict builder (routes.py).

`_arr_to_data` was hoisted from inside `import_keys_track` to module level so
the new `import-guitar-track` endpoint reuses it (no copy-paste). It turns a
parsed `lib.song` arrangement into the wire dict the editor frontend appends to
`S.arrangements`. It's pure — it only reads attributes off the passed
arrangement — so we exercise it with lightweight fakes (same "inject a fake"
pattern as test_arrangement_xml_alignment.py), no Slopsmith core import needed.
"""
from types import SimpleNamespace

from routes import _arr_to_data


def _note(**kw):
    base = dict(
        time=1.23456, string=0, fret=5, sustain=0.5,
        bend=None, slide_to=-1, slide_unpitch_to=-1, hammer_on=False,
        pull_off=False, harmonic=False, harmonic_pinch=False, palm_mute=False,
        mute=False, tremolo=False, accent=False, tap=False, link_next=False,
    )
    base.update(kw)
    return SimpleNamespace(**base)


def _chord_note(**kw):
    # Chord notes carry the same tech fields minus `harmonic_pinch`.
    base = dict(
        time=2.0, string=1, fret=7, sustain=0.0,
        bend=None, slide_to=-1, slide_unpitch_to=-1, hammer_on=False,
        pull_off=False, harmonic=False, harmonic_pinch=False, palm_mute=False,
        mute=False, tremolo=False, accent=False, tap=False, link_next=False,
    )
    base.update(kw)
    return SimpleNamespace(**base)


def _make_arr(**kw):
    base = dict(tuning=[0, 0, 0, 0, 0, 0], capo=0, notes=[], chords=[], chord_templates=[])
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


def test_notes_rounded_and_techniques_carried():
    arr = _make_arr(notes=[_note(time=1.23456, sustain=0.98765, palm_mute=True, fret=3)])
    data = _arr_to_data(arr, "Lead")
    n = data["notes"][0]
    assert n["time"] == 1.235          # rounded to 3 places
    assert n["sustain"] == 0.988
    assert n["fret"] == 3
    assert n["string"] == 0
    assert n["techniques"]["palm_mute"] is True
    assert n["techniques"]["hammer_on"] is False
    # The full guitar tech set (incl. harmonic_pinch, unlike chord notes).
    for key in ("bend", "slide_to", "slide_unpitch_to", "hammer_on", "pull_off",
                "harmonic", "harmonic_pinch", "palm_mute", "mute", "tremolo",
                "accent", "tap", "link_next"):
        assert key in n["techniques"]


def test_chords_and_templates():
    chord = SimpleNamespace(
        time=2.5, chord_id=4, high_density=True,
        notes=[_chord_note(string=0, fret=3), _chord_note(string=1, fret=5)],
    )
    ct = SimpleNamespace(name="C", display_name="Cmaj", arpeggio=True,
                         frets=[3, 2, 0, 1, 0, -1], fingers=[3, 2, 0, 1, 0, -1])
    arr = _make_arr(chords=[chord], chord_templates=[ct])
    data = _arr_to_data(arr, "Rhythm")

    c = data["chords"][0]
    assert c["time"] == 2.5
    assert c["chord_id"] == 4
    assert c["high_density"] is True
    assert len(c["notes"]) == 2
    assert c["notes"][0]["fret"] == 3
    # Chord notes carry the pinch-harmonic flag too (parity with single notes).
    assert "harmonic_pinch" in c["notes"][0]["techniques"]

    tmpl = data["chord_templates"][0]
    assert tmpl["name"] == "C"
    assert tmpl["displayName"] == "Cmaj"
    assert tmpl["arp"] is True
    assert tmpl["frets"] == [3, 2, 0, 1, 0, -1]
    assert tmpl["fingers"] == [3, 2, 0, 1, 0, -1]


def test_template_display_name_falls_back_to_name():
    ct = SimpleNamespace(name="Am", display_name="", frets=[], fingers=[])
    # no `arpeggio` attr → getattr default False
    arr = _make_arr(chord_templates=[ct])
    data = _arr_to_data(arr, "Lead")
    tmpl = data["chord_templates"][0]
    assert tmpl["displayName"] == "Am"
    assert tmpl["arp"] is False
