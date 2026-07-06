"""Tests for the rolling save backup (`_refresh_save_backup`).

The `.bak` safety copy was written only once (`if not backup.exists()`), so a
user editing a pack over weeks kept a FIRST-EVER-SAVE recovery point that
grew staler with every save — a stale safety net. The backup now rolls: it
is refreshed to the current on-disk pack before every overwrite, so it is
always the previous save (one step back). Best-effort: a failed backup copy
never blocks the save itself.

Run: python -m pytest tests/test_rolling_backup.py -q
"""

from pathlib import Path

from routes import _refresh_save_backup  # noqa: E402


def test_backup_created_on_first_overwrite(tmp_path: Path):
    out = tmp_path / "song.sloppak"
    bak = tmp_path / "song.sloppak.bak"
    out.write_bytes(b"v1")
    _refresh_save_backup(out, bak)
    assert bak.read_bytes() == b"v1"


def test_backup_rolls_to_the_previous_save(tmp_path: Path):
    out = tmp_path / "song.sloppak"
    bak = tmp_path / "song.sloppak.bak"
    out.write_bytes(b"v1")
    _refresh_save_backup(out, bak)          # save #1: bak = v1
    out.write_bytes(b"v2")
    _refresh_save_backup(out, bak)          # save #2: bak must ROLL to v2
    assert bak.read_bytes() == b"v2", "backup is the previous save, not the first ever"


def test_missing_output_writes_no_backup_and_does_not_raise(tmp_path: Path):
    out = tmp_path / "missing.sloppak"
    bak = tmp_path / "missing.sloppak.bak"
    _refresh_save_backup(out, bak)
    assert not bak.exists()


def test_directory_output_is_skipped(tmp_path: Path):
    out = tmp_path / "dirform.sloppak"
    out.mkdir()
    bak = tmp_path / "dirform.sloppak.bak"
    _refresh_save_backup(out, bak)
    assert not bak.exists()


def test_backup_failure_never_raises(tmp_path: Path):
    out = tmp_path / "song.sloppak"
    out.write_bytes(b"v1")
    # A directory at the backup path makes copy2 fail with OSError —
    # the save must proceed anyway.
    bak = tmp_path / "song.sloppak.bak"
    bak.mkdir()
    _refresh_save_backup(out, bak)   # must not raise
