"""Backend coercion for the per-track ``regions[]`` (PR 1: model + persistence).

The backend ``_coerce_track_session`` rebuilds every track field-by-field, so an
unknown field is stripped on the save->build round-trip. These pin that a
track's authored regions are PRESERVED, validated the same way the frontend
``src/region.js`` validates them, and that a default set is OMITTED so untouched
packs stay byte-identical (and that the schema version is bumped to 3).
"""

import yaml

from routes import (
    _coerce_track_regions,
    _coerce_track_session,
    _regions_are_default,
)


def test_default_region_sets_collapse_to_empty():
    assert _coerce_track_regions(None) == []
    assert _coerce_track_regions("nope") == []
    assert _coerce_track_regions([]) == []
    # a lone full-span region is the implicit default -> no residue.
    assert _coerce_track_regions([{"id": "region:1", "startBeat": 0, "lenBeat": None}]) == []
    assert _regions_are_default([]) is True


def test_regions_validate_dedupe_sort_and_drop_invalid():
    regions = _coerce_track_regions([
        {"id": "b", "startBeat": 16, "lenBeat": 8},
        "not-a-dict",
        {"id": "a", "startBeat": 4, "lenBeat": 4},
        {"id": "a", "startBeat": 99},           # duplicate id -> first wins
        {"startBeat": 2},                        # no id -> dropped
    ])
    assert [(r["id"], r["startBeat"]) for r in regions] == [("a", 4.0), ("b", 16.0)]


def test_audio_trim_pairs_and_inverted_out_point_opens_to_end():
    [r] = _coerce_track_regions([{"id": "r3", "srcIn": 1.5, "srcOut": 3}])
    assert r["srcIn"] == 1.5 and r["srcOut"] == 3.0
    [r] = _coerce_track_regions([{"id": "r4", "srcIn": 3, "srcOut": 1}])
    assert r["srcIn"] == 3.0 and r["srcOut"] is None


def test_label_and_mute_carried_only_when_set():
    [r] = _coerce_track_regions([{"id": "r5", "startBeat": 8, "name": "  Chorus  ", "muted": True}])
    assert r["name"] == "Chorus" and r["muted"] is True
    [r] = _coerce_track_regions([{"id": "r6", "startBeat": 8, "name": "   ", "muted": False}])
    assert "name" not in r and "muted" not in r


def test_regions_are_input_bounded():
    regions = _coerce_track_regions([{"id": f"r{i}", "startBeat": i + 1} for i in range(400)])
    assert len(regions) == 200


def test_session_preserves_authored_regions_omits_defaults_and_bumps_version():
    session = _coerce_track_session({
        "tracks": [
            {"id": "audio:master", "type": "audio", "sourceId": "master",
             "regions": [{"id": "r2", "startBeat": 16, "lenBeat": 8},
                         {"id": "r1", "startBeat": 0, "lenBeat": 16}]},
            {"id": "audio:Gtr", "type": "audio", "sourceId": "Gtr",
             "regions": [{"id": "region:1", "startBeat": 0, "lenBeat": None}]},  # default
        ],
    })
    assert session["version"] == 3
    master, gtr = session["tracks"]
    assert [r["id"] for r in master["regions"]] == ["r1", "r2"], "attached and sorted by startBeat"
    assert "regions" not in gtr, "a default region set leaves no residue"


def test_authored_regions_round_trip_through_manifest_yaml():
    session = _coerce_track_session({
        "tracks": [{"id": "audio:master", "type": "audio", "sourceId": "master",
                    "regions": [{"id": "r1", "startBeat": 8, "lenBeat": 8, "name": "Chorus"}]}],
    })
    loaded = yaml.safe_load(yaml.safe_dump(session, sort_keys=False, allow_unicode=True))
    again = _coerce_track_session(loaded)
    assert again["tracks"][0]["regions"] == [
        {"id": "r1", "startBeat": 8.0, "lenBeat": 8.0, "name": "Chorus"}]


def test_audio_trimmed_region_round_trips_through_manifest_yaml():
    # The round-trip above covers a NOTATION window (startBeat/lenBeat); this pins
    # the AUDIO trim pair (fractional srcIn/srcOut) through the same coerce ->
    # YAML dump/load -> coerce path with no drift (PR4 "identical window").
    session = _coerce_track_session({
        "tracks": [{"id": "audio:master", "type": "audio", "sourceId": "master",
                    "regions": [{"id": "r1", "startBeat": 8, "lenBeat": None,
                                 "srcIn": 1.25, "srcOut": 3.75, "name": "Solo"}]}],
    })
    loaded = yaml.safe_load(yaml.safe_dump(session, sort_keys=False, allow_unicode=True))
    again = _coerce_track_session(loaded)
    assert again["tracks"][0]["regions"] == [
        {"id": "r1", "startBeat": 8.0, "lenBeat": None,
         "srcIn": 1.25, "srcOut": 3.75, "name": "Solo"}]
