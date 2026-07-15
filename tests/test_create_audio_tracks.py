from routes import (
    _coerce_create_audio_tracks,
    _copy_create_audio_tracks,
    _create_audio_sources,
)


def test_create_audio_tracks_puts_selected_guide_first_and_keeps_every_source():
    tracks = _coerce_create_audio_tracks([
        {"id": "audio:1", "name": "Master.wav", "url": "/storage/master.wav"},
        {"id": "audio:2", "name": "Drums.wav", "url": "/storage/drums.wav", "guide": True},
        {"id": "audio:3", "name": "Bass.wav", "url": "/storage/bass.wav"},
    ])
    assert [track["name"] for track in tracks] == ["Drums.wav", "Master.wav", "Bass.wav"]
    assert [track["id"] for track in tracks] == ["drums", "master", "bass"]
    assert tracks[0]["guide"] is True
    assert sum(track["guide"] for track in tracks) == 1


def test_create_audio_tracks_dedupes_ids_and_rejects_invalid_rows():
    tracks = _coerce_create_audio_tracks([
        {"name": "Drums L.wav", "url": "/storage/a.wav"},
        {"name": "Drums L.wav", "url": "/storage/b.wav"},
        {"name": "bad", "url": ""},
        "not a row",
    ])
    assert [track["id"] for track in tracks] == ["drums_l", "drums_l_2"]
    assert tracks[0]["guide"] is True
    assert tracks[1]["guide"] is False


def test_copy_create_audio_tracks_writes_every_non_guide_source(tmp_path):
    stems = tmp_path / "stems"
    stems.mkdir()
    master = tmp_path / "master.wav"
    drums = tmp_path / "drums.wav"
    bass = tmp_path / "bass.flac"
    master.write_bytes(b"master")
    drums.write_bytes(b"drums")
    bass.write_bytes(b"bass")
    rows = _copy_create_audio_tracks(stems, master, [
        {"id": "master", "path": str(master)},
        {"id": "drums", "path": str(drums)},
        {"id": "bass", "path": str(bass)},
    ])
    assert rows == [
        {"id": "drums", "name": "drums", "file": "stems/drums.wav"},
        {"id": "bass", "name": "bass", "file": "stems/bass.flac"},
    ]
    assert (stems / "drums.wav").read_bytes() == b"drums"
    assert (stems / "bass.flac").read_bytes() == b"bass"


def test_create_audio_sources_exposes_master_and_stems_immediately():
    tracks = _coerce_create_audio_tracks([
        {"name": "Master.wav", "url": "/master", "guide": True},
        {"name": "Drums.wav", "url": "/drums"},
    ])
    assert _create_audio_sources("/master", tracks) == [
        {"id": "master", "name": "Master.wav", "kind": "master", "url": "/master"},
        {"id": "stem:drums", "name": "Drums.wav", "kind": "stem", "url": "/drums"},
    ]
