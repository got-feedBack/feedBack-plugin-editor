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


def test_reorder_with_hidden_keeps_full_and_reorders_managed():
    # A real sloppak manifest carries a `full` mix entry the manager hides
    # (load + _stem_state_payload both skip it). The frontend's `order` is a
    # permutation of only the SURFACED stems, so it never names `full`.
    # Pre-fix, validating that order against the whole list (incl. `full`)
    # rejected every reorder with 400. `full` must be kept, managed reordered.
    stems = [{"id": "full", "file": "full.ogg"},
             {"id": "Guitar_L", "file": "stems/Guitar_L.wav"},
             {"id": "Bass_DI", "file": "stems/Bass_DI.wav"}]
    out = routes._reorder_with_hidden(stems, ["Bass_DI", "Guitar_L"])
    assert out is not None, "a surfaced-subset order must NOT be rejected"
    assert [e["id"] for e in out] == ["full", "Bass_DI", "Guitar_L"], \
        "full stays; managed stems take the requested order; nothing dropped"
    # Foreign / duplicate ids still fail closed.
    assert routes._reorder_with_hidden(stems, ["Bass_DI", "nope"]) is None, "foreign id refused"
    assert routes._reorder_with_hidden(stems, ["Bass_DI", "Bass_DI"]) is None, "duplicate refused"
    assert routes._reorder_with_hidden(stems, "notalist") is None, "non-list refused"


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


def test_stem_links_for_op_prefers_the_request_snapshot():
    # Absent from the request (older client) -> the session's last-known links.
    assert routes._stem_links_for_op({"a1": "G"}, routes._FIELD_ABSENT) == {"a1": "G"}
    assert routes._stem_links_for_op(None, routes._FIELD_ABSENT) == {}
    # Present -> the atomic snapshot wins, even when empty (explicit unpair-all):
    # this is what keeps an unsaved pairing from being overwritten by the op's
    # response (review #283 item 15).
    assert routes._stem_links_for_op({"a1": "old"}, {}) == {}
    assert routes._stem_links_for_op({"a1": "old"}, {"a1": "G"}) == {"a1": "G"}
    # Session garbage coerces away instead of crashing the op.
    assert routes._stem_links_for_op("trash", routes._FIELD_ABSENT) == {}


def test_stem_links_from_form_absent_garbage_and_value():
    # The multipart twin of _parse_stem_links (import-stems is a Form POST, so
    # the snapshot arrives JSON-encoded): absent/garbage gets no authority.
    assert routes._stem_links_from_form(None) is routes._FIELD_ABSENT
    assert routes._stem_links_from_form("not json") is routes._FIELD_ABSENT
    assert routes._stem_links_from_form('["a", "list"]') is routes._FIELD_ABSENT
    assert routes._stem_links_from_form("{}") == {}
    parsed = routes._stem_links_from_form('{"a1": "Guitar_L", "b": 7}')
    assert parsed == {"a1": "Guitar_L"}, "coerced through the same sanitizer"


def test_stem_session_persisted_only_for_dir_form_sloppak():
    # The item-16 boundary: dir-form writes land straight in the library
    # (durable now); zip-form persists on Save, create-mode on Build.
    assert routes._stem_session_persisted(
        {"format": "sloppak", "sloppak_state": {"form": "dir"}}) is True
    assert routes._stem_session_persisted(
        {"format": "sloppak", "sloppak_state": {"form": "zip"}}) is False
    assert routes._stem_session_persisted(
        {"format": "sloppak", "sloppak_state": {}}) is False
    assert routes._stem_session_persisted(
        {"format": "sloppak", "sloppak_state": None}) is False
    assert routes._stem_session_persisted({"create_mode": True}) is False
    assert routes._stem_session_persisted({}) is False


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
