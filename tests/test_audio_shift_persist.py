"""Tests for audio-shift persistence (the "Shift Audio…" data-loss fix).

The frontend has shipped `audio_shift` in every save body (and read
`data.audio_shift` back on load) since the Shift Audio feature landed — but
the backend silently dropped it, so a shifted recording came back misaligned
on every reopen. The save path now persists it as a manifest extension key
(feedpak §4 ignored-but-preserved), the sloppak load path surfaces it, and
the build paths carry it through `meta`.

`_parse_audio_shift` is the one shared boundary: these tests pin its
absent-vs-zero contract (absent = older client, leave the persisted value
alone; zero = explicitly unshifted, REMOVE the key) and its never-fail
coercion (a garbage value must cost the field, never the whole save).

Run: python -m pytest tests/test_audio_shift_persist.py -q
"""

import yaml  # noqa: E402

from routes import (  # noqa: E402
    _FIELD_ABSENT,
    _apply_audio_shift,
    _coerce_audio_shift,
    _parse_audio_shift,
)


def test_absent_key_returns_the_sentinel_identity():
    # Absent ≠ zero: an older client that never sends the field must not
    # wipe a shift a newer client persisted.
    assert _parse_audio_shift({}) is _FIELD_ABSENT
    assert _parse_audio_shift({"other": 1}) is _FIELD_ABSENT


def test_explicit_zero_and_empty_values_mean_unshifted():
    # Zero (and the falsy JSON spellings the wire can carry) is an explicit
    # "unshifted" — the caller removes the manifest key.
    assert _parse_audio_shift({"audio_shift": 0}) == 0.0
    assert _parse_audio_shift({"audio_shift": None}) == 0.0
    assert _parse_audio_shift({"audio_shift": ""}) == 0.0


def test_numeric_values_round_trip_including_negative():
    # Negative = recording slid earlier; both directions are legal.
    assert _parse_audio_shift({"audio_shift": 0.25}) == 0.25
    assert _parse_audio_shift({"audio_shift": -0.5}) == -0.5
    assert _parse_audio_shift({"audio_shift": 2}) == 2.0


def test_string_numbers_coerce_like_every_other_lenient_field():
    assert _parse_audio_shift({"audio_shift": "0.125"}) == 0.125


def test_garbage_is_absent_not_zero_so_it_never_fails_the_save_nor_wipes_state():
    # The field is supplementary alignment state — a malformed value must
    # never cost the user their actual note edits with a 400/500. But it must
    # not coerce to 0.0 either: zero is a COMMAND (it removes the manifest
    # key), so reading garbage as zero would hand a malformed body the power to
    # erase a shift the charter really saved. Unusable input touches nothing.
    for bad in ("abc", {"nested": 1}, [1, 2], object()):
        assert _parse_audio_shift({"audio_shift": bad}) is _FIELD_ABSENT, repr(bad)


def test_rounded_to_microseconds_so_float_noise_never_reaches_the_manifest():
    assert _parse_audio_shift({"audio_shift": 0.1234567899}) == 0.123457


def test_non_finite_never_reaches_the_manifest():
    # `float("nan")` and `float("inf")` both SUCCEED and are truthy, so
    # without the isfinite guard they'd pass the nonzero write check and land
    # in manifest.yaml as `.nan` / `.inf` — poisoning the pack for every
    # reader. (`json.loads` accepts bare NaN/Infinity, so this is reachable.)
    # At the request boundary they are garbage → absent (change nothing);
    # on the sanitize paths there is nothing to preserve → a clean 0.0.
    for bad in ("nan", "inf", "-inf", float("nan"), float("inf")):
        assert _parse_audio_shift({"audio_shift": bad}) is _FIELD_ABSENT, repr(bad)
        assert _coerce_audio_shift(bad) == 0.0, repr(bad)

    # …and whichever path it came down, the key never lands in a manifest.
    manifest = {"title": "Song"}
    _apply_audio_shift(manifest, _parse_audio_shift({"audio_shift": float("nan")}))
    _apply_audio_shift(manifest, _coerce_audio_shift(float("inf")))
    assert "audio_shift" not in manifest


def test_a_malformed_body_does_not_wipe_a_saved_shift():
    # The data-loss regression: garbage used to coerce to 0.0, and zero REMOVES
    # the key — so one malformed save body silently threw away the charter's
    # alignment. Garbage is now absent-shaped, so the persisted value survives.
    for bad in ("abc", float("nan"), float("inf"), [1, 2]):
        manifest = {"title": "Song", "audio_shift": 0.25}
        _apply_audio_shift(manifest, _parse_audio_shift({"audio_shift": bad}))
        assert manifest["audio_shift"] == 0.25, repr(bad)


def test_an_explicit_zero_still_outranks_garbage_and_clears_the_key():
    # The flip side: don't over-correct. A real zero is a real command.
    manifest = {"title": "Song", "audio_shift": 0.25}
    _apply_audio_shift(manifest, _parse_audio_shift({"audio_shift": 0}))
    assert "audio_shift" not in manifest


# ── the save → disk → load round trip (the bug this PR fixes) ────────────────

def _round_trip(manifest: dict) -> float:
    """Serialize the manifest the way a save does, read it the way a load does.

    yaml is the real disk boundary — a value that survives in memory but not
    through safe_dump/safe_load is still lost work on reopen.
    """
    reloaded = yaml.safe_load(yaml.safe_dump(manifest, sort_keys=False))
    return _coerce_audio_shift(reloaded.get("audio_shift"))


def test_a_saved_shift_comes_back_identical_on_reopen():
    # The whole point of the fix: align a song, save, reopen, still aligned.
    manifest = {"title": "Song"}
    _apply_audio_shift(manifest, _parse_audio_shift({"audio_shift": 0.25}))
    assert manifest["audio_shift"] == 0.25
    assert _round_trip(manifest) == 0.25


def test_a_negative_shift_round_trips_too():
    manifest = {"title": "Song"}
    _apply_audio_shift(manifest, _parse_audio_shift({"audio_shift": -1.5}))
    assert _round_trip(manifest) == -1.5


def test_sliding_back_to_zero_removes_the_key_from_the_pack():
    # An unshifted song must stay byte-identical to a pack that never had a
    # shift — zero REMOVES the key rather than writing `audio_shift: 0`.
    manifest = {"title": "Song", "audio_shift": 0.25}
    _apply_audio_shift(manifest, _parse_audio_shift({"audio_shift": 0}))
    assert "audio_shift" not in manifest
    assert _round_trip(manifest) == 0.0


def test_an_older_client_that_omits_the_field_does_not_wipe_a_saved_shift():
    # Absent ≠ zero. A client that predates the feature saves title edits
    # without shipping `audio_shift`; the persisted alignment must survive.
    manifest = {"title": "Song", "audio_shift": 0.25}
    _apply_audio_shift(manifest, _parse_audio_shift({"title": "Renamed"}))
    assert manifest["audio_shift"] == 0.25


def test_an_old_pack_with_no_key_loads_as_unshifted_not_nan():
    # Backward compat: every pack built before this feature has no
    # `audio_shift` key at all. The load path must produce a clean 0.0 —
    # never None/NaN — so the frontend leaves the recording where it is.
    shift = _coerce_audio_shift({"title": "Old Song"}.get("audio_shift"))
    assert shift == 0.0
    assert isinstance(shift, float)


def test_the_build_path_carries_the_shift_from_meta_into_a_fresh_manifest():
    # The build writes a brand-new manifest from `meta`; nonzero lands, and a
    # meta with no shift leaves a fresh pack with no key (stays minimal).
    built = {}
    _apply_audio_shift(built, _coerce_audio_shift({"audio_shift": 0.4}.get("audio_shift")))
    assert built["audio_shift"] == 0.4

    unshifted = {}
    _apply_audio_shift(unshifted, _coerce_audio_shift({}.get("audio_shift")))
    assert "audio_shift" not in unshifted
