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


def test_directory_backup_target_is_left_alone(tmp_path: Path):
    """A directory sitting at the `.bak` path must not swallow the pack.

    Copying straight onto it (`shutil.copy2`) would drop `song.sloppak`
    *inside* `song.sloppak.bak/`, silently turning the backup into a
    junk directory. The helper must skip a non-file backup target, leave
    it untouched, and never raise. FAILS on the in-place copy version.
    """
    out = tmp_path / "song.sloppak"
    out.write_bytes(b"v1")
    bak = tmp_path / "song.sloppak.bak"
    bak.mkdir()
    _refresh_save_backup(out, bak)                 # must not raise
    assert bak.is_dir()                            # left untouched
    assert not (bak / "song.sloppak").exists()     # pack NOT dropped inside


def test_failed_roll_preserves_prior_good_backup(tmp_path: Path, monkeypatch):
    """A mid-copy failure must NOT destroy the previous good `.bak`.

    Rolling the backup by copying straight onto `.bak` truncates it the
    instant copy2 opens the destination — so a copy that dies mid-write
    (disk full, interrupted) leaves the ONLY recovery point corrupt right
    before the pack is overwritten. The roll must be atomic: stage to a
    temp file, then rename over `.bak`. FAILS on the in-place version.
    """
    import routes

    out = tmp_path / "song.sloppak"
    bak = tmp_path / "song.sloppak.bak"
    out.write_bytes(b"v2-current-pack")
    bak.write_bytes(b"v1-prior-good-backup")   # existing recovery point

    def exploding_copy2(src, dst):
        # Simulate copy2 that has already opened/truncated the destination
        # and written a partial payload before the volume fills up.
        Path(dst).write_bytes(b"PARTIAL-CORRUPT")
        raise OSError("No space left on device")

    monkeypatch.setattr(routes.shutil, "copy2", exploding_copy2)

    _refresh_save_backup(out, bak)   # best-effort: must not raise

    # The prior good backup must survive a failed roll intact, and no
    # partial temp file may be left lying around.
    assert bak.read_bytes() == b"v1-prior-good-backup"
    assert not list(tmp_path.glob("*.tmp")), "partial temp copy left behind"
