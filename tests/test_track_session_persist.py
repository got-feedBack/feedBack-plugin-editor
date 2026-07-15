"""Regression coverage for the source-aware editor track-session extension."""

import yaml

from routes import _FIELD_ABSENT, _apply_track_session, _coerce_track_session, _parse_track_session


def _sample():
    return {
        "tracks": [
            {"id": "folder:1", "type": "folder", "name": "Rhythm", "parentId": "", "collapsed": False},
            {"id": "audio:stem:0", "type": "audio", "sourceId": "stem:0", "parentId": "folder:1"},
            {"id": "transcription:drums", "type": "transcription", "targetId": "drums", "parentId": "folder:1", "pairedSourceId": "stem:0"},
        ],
        "tempoGuideSourceId": "master",
        "tempoGuideLocked": True,
    }


def test_absent_or_malformed_payload_cannot_erase_a_saved_tree():
    assert _parse_track_session({}) is _FIELD_ABSENT
    assert _parse_track_session({"track_session": {"tracks": "not-a-list"}}) is _FIELD_ABSENT
    manifest = {"editor_track_session": _sample()}
    _apply_track_session(manifest, _parse_track_session({"track_session": "bad"}))
    assert manifest["editor_track_session"]["tempoGuideLocked"] is True


def test_track_session_round_trips_through_manifest_yaml():
    manifest = {"title": "Song"}
    _apply_track_session(manifest, _parse_track_session({"track_session": _sample()}))
    loaded = yaml.safe_load(yaml.safe_dump(manifest, sort_keys=False))
    session = _coerce_track_session(loaded["editor_track_session"])
    assert session["tempoGuideLocked"] is True
    assert session["tracks"][2]["pairedSourceId"] == "stem:0"


def test_only_safe_bounded_ids_and_known_track_shapes_persist():
    payload = _sample()
    payload["tracks"].extend([
        {"id": "bad id", "type": "audio", "sourceId": "master"},
        {"id": "ok", "type": "unknown"},
        {"id": "audio:stem:0", "type": "audio", "sourceId": "master"},
    ])
    clean = _coerce_track_session(payload)
    assert [track["id"] for track in clean["tracks"]] == [
        "folder:1", "audio:stem:0", "transcription:drums",
    ]


def test_null_explicitly_removes_the_extension():
    manifest = {"editor_track_session": _sample()}
    _apply_track_session(manifest, _parse_track_session({"track_session": None}))
    assert "editor_track_session" not in manifest