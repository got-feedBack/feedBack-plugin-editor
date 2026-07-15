"""Regression coverage for the persistent `editor_track_session` manifest key.

The tree persists identity/order relationships only (rows referencing
sources and chart-track keys, folders, tombstoned removals, the tempo-guide
role) — pairing stays in `editor_stem_links`, mix state stays session-only.
Absent-vs-null on the wire follows the house `_FIELD_ABSENT` contract:
absent preserves, explicit null removes, malformed has no authority.
"""

import yaml

from routes import (
    _FIELD_ABSENT,
    _apply_track_session,
    _coerce_track_session,
    _parse_track_session,
    _track_session_id,
)


def _sample():
    return {
        "tracks": [
            {"id": "folder:1", "type": "folder", "name": "Rhythm", "parentId": "", "collapsed": False},
            {"id": "audio:Guitar_L", "type": "audio", "sourceId": "Guitar_L", "parentId": "folder:1"},
            {"id": "transcription:Lead Guitar", "type": "transcription", "targetId": "Lead Guitar", "parentId": "folder:1"},
        ],
        "tempoGuideSourceId": "master",
        "tempoGuideLocked": True,
        "tempoGuideMode": "metronome",
        "removedSourceIds": ["Bass_DI"],
    }


def test_absent_or_malformed_payload_cannot_erase_a_saved_tree():
    assert _parse_track_session({}) is _FIELD_ABSENT
    assert _parse_track_session({"track_session": {"tracks": "not-a-list"}}) is _FIELD_ABSENT
    manifest = {"editor_track_session": _sample()}
    _apply_track_session(manifest, _parse_track_session({"track_session": "bad"}))
    assert manifest["editor_track_session"]["tempoGuideLocked"] is True


def test_explicit_null_removes_the_key_so_default_trees_leave_no_residue():
    manifest = {"editor_track_session": _sample()}
    _apply_track_session(manifest, _parse_track_session({"track_session": None}))
    assert "editor_track_session" not in manifest


def test_track_session_round_trips_through_manifest_yaml():
    manifest = {"title": "Song"}
    _apply_track_session(manifest, _parse_track_session({"track_session": _sample()}))
    loaded = yaml.safe_load(yaml.safe_dump(manifest, sort_keys=False, allow_unicode=True))
    session = _coerce_track_session(loaded["editor_track_session"])
    assert session["tempoGuideLocked"] is True
    assert session["tempoGuideMode"] == "metronome"
    assert session["removedSourceIds"] == ["Bass_DI"]
    assert session["tracks"][2]["targetId"] == "Lead Guitar"


def test_chart_track_keys_are_names_so_ids_allow_interior_spaces():
    # stemLinks keys are arrangement NAMES today; the tree speaks the same
    # dialect, so 'Lead Guitar' must survive while control chars and
    # unbounded ids are still rejected.
    assert _track_session_id("Lead Guitar") == "Lead Guitar"
    assert _track_session_id("  padded  ") == "padded"
    assert _track_session_id("evil\x00id") == ""
    assert _track_session_id("x" * 161) == ""
    assert _track_session_id(42) == ""


def test_removed_sources_and_guide_mode_are_bounded_and_type_safe():
    payload = _sample()
    payload["removedSourceIds"] = "Bass_DI"
    payload["tempoGuideMode"] = "plugin"
    clean = _coerce_track_session(payload)
    assert clean["removedSourceIds"] == []
    assert clean["tempoGuideMode"] == "audio"


def test_only_known_track_shapes_and_bounded_ids_persist():
    payload = _sample()
    payload["tracks"].extend([
        {"id": "audio:x", "type": "audio"},                     # no sourceId
        {"id": "t", "type": "unknown"},                          # unknown type
        {"id": "audio:Guitar_L", "type": "audio", "sourceId": "Guitar_L"},  # duplicate id
        "not-a-dict",
        {"id": "n" * 200, "type": "folder"},                     # unbounded id
    ])
    clean = _coerce_track_session(payload)
    assert [t["id"] for t in clean["tracks"]] == [
        "folder:1", "audio:Guitar_L", "transcription:Lead Guitar"]
    # Rows carry no pairing field — editor_stem_links owns pairing.
    assert all("pairedSourceId" not in t for t in clean["tracks"])


def test_tracks_list_is_capped_and_names_are_bounded():
    payload = {
        "tracks": [{"id": f"folder:{i}", "type": "folder", "name": "n" * 500}
                   for i in range(400)],
    }
    clean = _coerce_track_session(payload)
    assert len(clean["tracks"]) == 300
    assert all(len(t["name"]) <= 120 for t in clean["tracks"])
