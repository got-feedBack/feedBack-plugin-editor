"""Multitrack stem ingest: the backend pures + the links persistence
contract (the audio_shift/editor_tempo_marks twin, third time now)."""

import routes


def test_stem_safe_id_sanitizes_and_dedups():
    assert routes._stem_safe_id("Guitar L (DI).wav", set()) == "Guitar_L__DI"
    assert routes._stem_safe_id("Guitar L (DI).wav", {"Guitar_L__DI"}) == "Guitar_L__DI_2"
    assert routes._stem_safe_id("", set()) == "track"
    assert routes._stem_safe_id("....", set()) == "track"
    long = routes._stem_safe_id("x" * 200 + ".wav", set())
    assert len(long) <= 60


def test_stems_rename_pure_moves_id_and_refuses_collisions():
    stems = [{"id": "a", "file": "stems/a.wav"}, {"id": "b", "file": "stems/b.wav"}]
    renamed, entry = routes._stems_rename_pure(stems, "a", "gtr")
    assert [e["id"] for e in renamed] == ["gtr", "b"]
    assert entry["file"] == "stems/a.wav", "the endpoint moves the file, not the pure"
    assert routes._stems_rename_pure(stems, "a", "b") == (None, None), "collision refused"
    assert routes._stems_rename_pure(stems, "zzz", "q") == (None, None), "unknown refused"
    assert stems[0]["id"] == "a", "input untouched (immutability)"


def test_stems_reorder_pure_requires_full_permutation():
    stems = [{"id": "a"}, {"id": "b"}, {"id": "c"}]
    out = routes._stems_reorder_pure(stems, ["c", "a", "b"])
    assert [e["id"] for e in out] == ["c", "a", "b"]
    assert routes._stems_reorder_pure(stems, ["c", "a"]) is None, "partial gets no authority to drop"
    assert routes._stems_reorder_pure(stems, ["c", "a", "x"]) is None, "foreign id refused"


def test_stems_manifest_list_preserves_unknown_fields():
    manifest = {"stems": [
        {"id": "guitar", "file": "stems/guitar.opus", "codec": "opus",
         "default": "on", "some_other_tools_field": 42},
        {"file": "orphan.ogg"},          # no id -> dropped
        "junk",
    ]}
    out = routes._stems_manifest_list(manifest)
    assert len(out) == 1
    assert out[0]["some_other_tools_field"] == 42, "another tool's metadata survives"


def test_stem_links_contract_absent_empty_garbage():
    assert routes._parse_stem_links({}) is routes._FIELD_ABSENT
    assert routes._parse_stem_links({"stem_links": "trash"}) is routes._FIELD_ABSENT
    assert routes._parse_stem_links({"stem_links": {}}) == {}
    parsed = routes._parse_stem_links({"stem_links": {"a1": "Guitar_L", 3: "x", "b": 7}})
    assert parsed == {"a1": "Guitar_L"}, "non-string keys/values dropped"
    manifest = {"editor_stem_links": {"a1": "old"}}
    routes._apply_stem_links(manifest, routes._FIELD_ABSENT)
    assert manifest["editor_stem_links"] == {"a1": "old"}, "absent leaves persisted links alone"
    routes._apply_stem_links(manifest, {"a1": "Guitar_L"})
    assert manifest["editor_stem_links"] == {"a1": "Guitar_L"}
    routes._apply_stem_links(manifest, {})
    assert "editor_stem_links" not in manifest, "empty removes the key"
