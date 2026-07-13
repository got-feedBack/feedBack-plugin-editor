"""Tests for `_manifest_authors` and `_plugin_version` (routes.py).

The feedpak spec (§5.4) defines `authors:` as a list of OBJECTS with a
required `name` — session metadata carries plain strings, so the manifest
write must convert. `origin` provenance stamps the plugin version.
"""
from routes import _manifest_authors, _plugin_version


def test_strings_become_charter_objects():
    assert _manifest_authors(["me", " you "]) == [
        {"name": "me", "role": "charter"},
        {"name": "you", "role": "charter"},
    ]


def test_dict_entries_pass_through_and_blank_names_drop():
    assert _manifest_authors(
        [{"name": "me", "role": "arranger"}, {"name": "  "}, "", "you"]
    ) == [
        {"name": "me", "role": "arranger"},
        {"name": "you", "role": "charter"},
    ]


def test_non_string_junk_is_dropped_not_stringified():
    # None must not become the author "None"; numbers/lists/None-names drop.
    assert _manifest_authors([None, 42, ["x"], {"name": None}, {"name": 7}]) == []


def test_non_list_yields_empty():
    assert _manifest_authors(None) == []
    assert _manifest_authors("me, you") == []


def test_plugin_version_reads_plugin_json():
    v = _plugin_version()
    assert isinstance(v, str) and v  # non-empty in a checkout
