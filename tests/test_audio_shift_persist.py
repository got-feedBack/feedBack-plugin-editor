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

from routes import _FIELD_ABSENT, _parse_audio_shift  # noqa: E402


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


def test_garbage_coerces_to_zero_instead_of_failing_the_save():
    # The field is supplementary alignment state — a malformed value must
    # never cost the user their actual note edits with a 400/500.
    assert _parse_audio_shift({"audio_shift": "abc"}) == 0.0
    assert _parse_audio_shift({"audio_shift": {"nested": 1}}) == 0.0
    assert _parse_audio_shift({"audio_shift": [1, 2]}) == 0.0


def test_rounded_to_microseconds_so_float_noise_never_reaches_the_manifest():
    assert _parse_audio_shift({"audio_shift": 0.1234567899}) == 0.123457
