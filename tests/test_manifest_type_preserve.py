"""Tests for manifest `type` preservation + infer-once stamping.

The full-snapshot save path rebuilt every manifest arrangement entry from
scratch (`{id, name, file, tuning, capo}`), silently dropping spec fields the
editor doesn't author — `type` (§5.2), `centOffset`, and any future additive
key — on EVERY save, violating the format's unknown-key preservation rule
(feedpak-spec §1.2). Rebuilt entries now merge onto the existing entry for
the same id (`_merge_manifest_entry`), and entries with no `type` get an
inferred one from the display name exactly once (`_infer_arrangement_type`)
— conservative: ambiguous / vocals / drums names stay untyped, because a
wrong type is worse than none.

Run: python -m pytest tests/test_manifest_type_preserve.py -q
"""

from routes import _infer_arrangement_type, _merge_manifest_entry  # noqa: E402


# ── inference ────────────────────────────────────────────────────────────────

def test_infer_keys_family_maps_to_piano():
    # Spec §5.2 spells the keyboard type `piano` (`keys` is a read alias).
    for name in ("Keys", "Piano", "keyboard", "Synth Lead", "PIANO RH"):
        assert _infer_arrangement_type(name) == "piano", name


def test_infer_keys_family_matches_mid_name_like_the_sidecar_detector():
    # Regression: type inference must use the SAME word-boundary matcher as the
    # keys notation-sidecar detector (`_KEYS_NAME_RE`), not a prefix-anchored
    # one. Names where the keys keyword isn't the first word still earn a keys
    # sidecar, so they must infer a keys/piano `type` too — otherwise the
    # manifest facet and the notation renderer disagree for the same entry.
    for name in ("Electric Piano", "Grand Piano", "Lead Synth", "Rhodes Keys"):
        assert _infer_arrangement_type(name) == "piano", name


def test_infer_bass_anywhere_in_the_name():
    assert _infer_arrangement_type("Bass") == "bass"
    assert _infer_arrangement_type("5-string Bass") == "bass"
    assert _infer_arrangement_type("bass (DI)") == "bass"
    # Keys is checked before bass, so synth-family names take the piano-roll
    # pathway even when they also read as bass (intentional, unchanged by the
    # prefix→word-boundary switch: "synth" still matches at a word boundary).
    assert _infer_arrangement_type("Synth Bass") == "piano"


def test_infer_guitar_roles():
    for name in ("Lead", "Rhythm 2", "Combo", "Guitar 3", "Acoustic", "Electric"):
        assert _infer_arrangement_type(name) == "guitar", name


def test_infer_stays_silent_on_ambiguous_vocals_and_drums_names():
    # Vocals/drums are side-file mechanisms per the spec, never arrangement
    # types; unknown names stay untyped rather than guessing wrong.
    for name in ("Vocals", "Voice", "Singing", "Drums", "Solo Thing", "Track 7", "", None):
        assert _infer_arrangement_type(name) == "", repr(name)


# ── merge ────────────────────────────────────────────────────────────────────

def test_merge_preserves_spec_and_unknown_keys():
    old = {
        "id": "lead",
        "name": "Old Name",
        "file": "arrangements/lead.json",
        "tuning": [0, 0, 0, 0, 0, 0],
        "capo": 0,
        "type": "guitar",
        "centOffset": -6,
        "notation": "notation_lead.json",
        "x_future_key": {"nested": True},
    }
    rebuilt = {
        "id": "lead",
        "name": "Lead (renamed)",
        "file": "arrangements/lead.json",
        "tuning": [-2, -2, -2, -2, -2, -2],
        "capo": 2,
    }
    out = _merge_manifest_entry(old, rebuilt)
    # Editor-owned keys take the rebuilt values…
    assert out["name"] == "Lead (renamed)"
    assert out["tuning"] == [-2, -2, -2, -2, -2, -2]
    assert out["capo"] == 2
    # …and everything the editor doesn't author survives.
    assert out["type"] == "guitar"
    assert out["centOffset"] == -6
    assert out["notation"] == "notation_lead.json"
    assert out["x_future_key"] == {"nested": True}


def test_merge_preserves_zero_cent_offset():
    # Guard against a truthiness regression: a deliberate `centOffset: 0`
    # (retuned back to concert pitch) must survive the merge exactly like a
    # non-zero offset. The merge keeps it because the rebuilt entry never
    # carries centOffset, so `out.update(rebuilt)` can't clobber it — but a
    # future "only copy truthy fields" shortcut would silently drop the 0.
    old = {"id": "lead", "name": "Old", "centOffset": 0, "type": "guitar"}
    rebuilt = {"id": "lead", "name": "Lead", "file": "arrangements/lead.json",
               "tuning": [0] * 6, "capo": 0}
    out = _merge_manifest_entry(old, rebuilt)
    assert "centOffset" in out
    assert out["centOffset"] == 0
    assert out["type"] == "guitar"


def test_merge_with_no_old_entry_is_just_the_rebuilt_entry():
    rebuilt = {"id": "new", "name": "New", "file": "arrangements/new.json",
               "tuning": [0] * 6, "capo": 0}
    assert _merge_manifest_entry(None, rebuilt) == rebuilt
    assert _merge_manifest_entry("garbage", rebuilt) == rebuilt


def test_merge_does_not_mutate_inputs():
    old = {"id": "a", "type": "bass"}
    rebuilt = {"id": "a", "name": "A"}
    out = _merge_manifest_entry(old, rebuilt)
    out["type"] = "changed"
    out["name"] = "changed"
    assert old["type"] == "bass"
    assert rebuilt["name"] == "A"


# ── editor-authored type round-trips (the save-carry contract) ────────────────
# The save path now carries an editor-provided `type` into the rebuilt entry
# (previously the rebuilt entry never had one, so a set/changed type could only
# survive by accident of the merge preserving the OLD value). These pin that a
# type SET in the editor persists and can override a stale on-disk value — the
# contract drums-as-arrangements and a future "set instrument" action rely on.

def test_a_newly_typed_arrangement_persists_its_type():
    # No old entry (a freshly added arrangement): the editor-set type survives.
    rebuilt = {"id": "drm", "name": "Kit", "file": "arrangements/drm.json",
               "tuning": [0] * 6, "capo": 0, "type": "drums"}
    out = _merge_manifest_entry(None, rebuilt)
    assert out["type"] == "drums"


def test_editor_set_type_overrides_a_stale_on_disk_type():
    # The rebuilt (editor) type wins over the old entry's type — so changing an
    # instrument in the editor actually re-types the entry, rather than the old
    # value silently sticking.
    old = {"id": "x", "name": "X", "type": "guitar", "centOffset": -3}
    rebuilt = {"id": "x", "name": "X", "file": "arrangements/x.json",
               "tuning": [0] * 6, "capo": 0, "type": "drums"}
    out = _merge_manifest_entry(old, rebuilt)
    assert out["type"] == "drums", "editor type wins"
    assert out["centOffset"] == -3, "unrelated preserved keys still survive"
