"""_pick_timeline_xml_root: the GP-create song timeline must come from the
first converted-track XML that actually carries a beat grid.

A lyrics-only GP vocal track converts to an XML with no ebeats and no notes;
when such a track landed first in xml_paths, the old blind xml_paths[0] read
imported a GRID-LESS session — notes present, no beats, Tempo Map hidden
(repro: Garth Brooks — The Thunder Rolls .gpx, whose Vocal track is empty
while all seven other tracks carry the same 282-beat grid).
"""
from pathlib import Path

from routes import _pick_timeline_xml_root


GRIDLESS = "<song version=\"7\"><title>t</title></song>"
EMPTY_CONTAINER = "<song version=\"7\"><ebeats count=\"0\"/></song>"
GRIDDED = (
    "<song version=\"7\"><songLength>206.341</songLength>"
    "<ebeats count=\"2\"><ebeat time=\"0.0\" measure=\"1\"/>"
    "<ebeat time=\"0.73\" measure=\"-1\"/></ebeats></song>"
)


def _write(tmp_path: Path, name: str, body: str) -> str:
    p = tmp_path / name
    p.write_text(body, encoding="utf-8")
    return str(p)


def test_empty_first_track_is_skipped_for_the_gridded_one(tmp_path):
    vocal = _write(tmp_path, "vocal.xml", GRIDLESS)
    lead = _write(tmp_path, "lead.xml", GRIDDED)
    root = _pick_timeline_xml_root([vocal, lead])
    assert root is not None
    assert root.find("ebeats/ebeat") is not None, "must pick the XML with the grid"
    assert root.find("songLength").text == "206.341"


def test_an_ebeats_container_with_no_beats_counts_as_gridless(tmp_path):
    hollow = _write(tmp_path, "hollow.xml", EMPTY_CONTAINER)
    lead = _write(tmp_path, "lead.xml", GRIDDED)
    root = _pick_timeline_xml_root([hollow, lead])
    assert root.find("ebeats/ebeat") is not None


def test_falls_back_to_the_first_xml_when_no_track_has_a_grid(tmp_path):
    a = _write(tmp_path, "a.xml", GRIDLESS)
    b = _write(tmp_path, "b.xml", EMPTY_CONTAINER)
    root = _pick_timeline_xml_root([a, b])
    assert root is not None
    assert root.find("title") is not None, "fallback is the FIRST parseable XML"


def test_unparseable_and_missing_files_are_skipped(tmp_path):
    junk = _write(tmp_path, "junk.xml", "<song")  # truncated — parse error
    missing = str(tmp_path / "nope.xml")
    lead = _write(tmp_path, "lead.xml", GRIDDED)
    root = _pick_timeline_xml_root([junk, missing, lead])
    assert root.find("ebeats/ebeat") is not None


def test_degenerate_inputs():
    assert _pick_timeline_xml_root([]) is None
    assert _pick_timeline_xml_root(None) is None
