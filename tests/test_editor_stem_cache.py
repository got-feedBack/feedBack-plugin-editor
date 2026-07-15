"""Regression coverage for editor stem-cache filename collisions."""

from routes import _editor_stem_cache_basename


def test_distinct_stem_ids_that_sanitize_alike_get_distinct_cache_names():
    # `drums/kit` and `drums:kit` are distinct sources but both sanitize to
    # `drums_kit`; without the per-source index they would share one cached
    # file and every URL would play the last-copied stem.
    a = _editor_stem_cache_basename("song123", 0, "drums/kit")
    b = _editor_stem_cache_basename("song123", 1, "drums:kit")
    assert a != b
    assert a == "editor_stem_song123_0_drums_kit"
    assert b == "editor_stem_song123_1_drums_kit"
