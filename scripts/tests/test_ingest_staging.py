"""Hostile tests for Phase 4 transcript staging (NOT yet implemented — RED).

Covers ``stage_transcripts(cfg, run=subprocess.run)`` in scripts/ingest.py
and its wiring into ``run_ingest``. The import below fails at collection
time until Phase 4 is implemented — that is the intended RED state.

CONTRACT CHOICE (the plan's Phase 4 + Phase 6 sections describe a
``--with-transcripts`` CLI flag mutually exclusive with ``--transcripts-dir``;
these tests pin the cfg-flag variant of the wiring):

  - ``IngestConfig`` gains a new field ``with_transcripts: bool = False``.
  - ``run_ingest(conn, cfg, run=subprocess.run)`` gains an optional keyword
    ``run`` (an injectable subprocess runner) which it forwards to
    ``stage_transcripts``. Existing two-arg calls keep working.
  - Staging happens ONLY when ``cfg.with_transcripts`` is True and
    ``cfg.transcripts_dir`` is None. When ``transcripts_dir`` is set
    explicitly, ``stage_transcripts`` is never called and the explicit dir
    is used as before (and is NEVER deleted — it belongs to the caller).
  - ``stage_transcripts``:
      * creates a staging dir via ``tempfile.mkdtemp(prefix=
        "homedir-transcripts-")`` (mode 0700, under tempfile.gettempdir()),
      * invokes the injected ``run`` callable with a sudo copy command for
        ``<source_root>/.claude/projects/-home-claude/*.jsonl`` into the
        staging dir,
      * returns the staging dir as ``pathlib.Path`` on success,
      * returns None (no raise) on non-zero exit or FileNotFoundError, and
        on that failure path removes the staging dir it created (no /tmp
        litter — pinned as the principled behavior; spec is silent).
  - On the staged path, ``run_ingest`` runs memory ingest against the
    staged copy and removes the staging dir afterwards EVEN IF the memory
    extractor raises (finally cleanup). A failed staging attempt records
    the memory step in ``report.skipped`` with a non-empty reason, is NOT
    an error, and never aborts the run.

Other deviations / decisions:
  - The exact sudo command shape is NOT pinned (list argv vs ``sh -c``
    string both accepted). What IS pinned: the command references
    ``.claude/projects/-home-claude`` and the staging dir, and NO argument
    contains "private" (case-insensitive) — the private-journal guard.
  - The fake runner honors ``check=True`` (raises CalledProcessError on
    non-zero) so both returncode-checking and check=True implementations
    are exercised faithfully.
  - Runner-failure tests assert both "the captured staging dir no longer
    exists" and "no NEW homedir-transcripts-* dirs remain in
    tempfile.gettempdir()" (before/after set diff).
  - The transcript fixture was built against the actual
    ``extract_memory_from_jsonl`` parser: first line carries a
    ``timestamp``, an assistant ``tool_use`` (name Read, file_path ending
    in MEMORY.md, no limit/offset) is matched to a user ``tool_result`` by
    tool_use_id, line-number prefixes ``\\d+\\t`` are stripped, and the
    snapshot is matched to a session row by DATE — so each staged-ingest
    test seeds a session dated to the transcript timestamp.
  - A fixture-validation test (TestFixtureValidity) exercises the EXISTING
    extractor directly; it is RED only via the module-level import failure
    and exists to stop a broken fixture from masquerading as an
    implementation bug during GREEN iteration.

Never invokes real sudo: every path that could reach subprocess injects a
fake runner, and staging is only ever triggered with the fake in place.
"""

import datetime
import inspect
import json
import os
import pathlib
import re
import shlex
import shutil
import stat
import subprocess
import tempfile
import uuid

import pytest

import scripts.extract_memory as extract_memory_module
from scripts.extract_memory import extract_memory_from_jsonl
from scripts.ingest import (  # noqa: F401  (RED: stage_transcripts absent)
    IngestConfig,
    run_ingest,
    stage_transcripts,
)

STAGING_PREFIX = "homedir-transcripts-"
_STAGING_RE = re.compile(r"/\S*homedir-transcripts-[^\s'\"/]*")

TABLES = (
    "sessions",
    "compositions",
    "messages",
    "predictions",
    "pet_events",
    "memory_snapshots",
)

not_root = pytest.mark.skipif(os.geteuid() == 0, reason="mode 0o000 is not enforced for root")


# ===========================================================================
# Fake subprocess runner
# ===========================================================================


def _cmd_strings(cmd):
    """Flatten a subprocess command (list of str/Path, or a shell string)."""
    if isinstance(cmd, (str, bytes)):
        return [cmd.decode("utf-8", "replace") if isinstance(cmd, bytes) else cmd]
    return [str(part) for part in cmd]


def _find_staging_dir(cmd):
    """Extract the mkdtemp staging path referenced anywhere in the command."""
    hits = []
    for s in _cmd_strings(cmd):
        hits.extend(_STAGING_RE.findall(s))
    unique = sorted(set(hits))
    return pathlib.Path(unique[0]) if unique else None


class FakeRunner:
    """Injectable stand-in for subprocess.run. NEVER executes anything.

    On call it records (cmd, kwargs), locates the staging dir in the argv,
    snapshots its existence + mode at call time, optionally "copies"
    ``*.jsonl`` fixtures from ``copy_from`` into it, and returns a
    CompletedProcess with the configured returncode/stderr. Honors
    ``check=True`` (raises CalledProcessError) and can raise an arbitrary
    exception (FileNotFoundError for the no-sudo-binary case) instead.
    """

    def __init__(self, copy_from=None, returncode=0, stderr="", exc=None):
        self.copy_from = pathlib.Path(copy_from) if copy_from else None
        self.returncode = returncode
        self.stderr = stderr
        self.exc = exc
        self.calls = []  # list of (cmd, kwargs)
        self.staging_dirs = []  # staging Path found in each call's argv (or None)
        self.staging_existed = []  # dir existed at call time
        self.staging_modes = []  # stat.S_IMODE at call time (or None)

    def __call__(self, *args, **kwargs):
        cmd = args[0] if args else kwargs.get("args")
        self.calls.append((cmd, kwargs))
        if self.exc is not None:
            raise self.exc

        staging = _find_staging_dir(cmd) if cmd is not None else None
        self.staging_dirs.append(staging)
        if staging is not None and staging.is_dir():
            self.staging_existed.append(True)
            self.staging_modes.append(stat.S_IMODE(staging.stat().st_mode))
            if self.returncode == 0 and self.copy_from is not None:
                for src in sorted(self.copy_from.glob("*.jsonl")):
                    shutil.copy(src, staging / src.name)
        else:
            self.staging_existed.append(False)
            self.staging_modes.append(None)

        if self.returncode != 0 and kwargs.get("check"):
            raise subprocess.CalledProcessError(self.returncode, cmd, output="", stderr=self.stderr)
        return subprocess.CompletedProcess(cmd, self.returncode, stdout="", stderr=self.stderr)


# ===========================================================================
# Transcript fixture (format verified against extract_memory_from_jsonl)
# ===========================================================================

MEMORY_CONTENT = (
    "# MEMORY.md\n"
    "\n"
    "## Identity\n"
    "Identity is a function of constrained attention \N{ROBOT FACE}.\n"
    "\n"
    "## Routines\n"
    "Fed Pixel. Wrote a daily note.\n"
)


def _numbered(content):
    """Add the ``\\d+\\t`` line-number prefixes the parser strips."""
    return "\n".join(f"{i + 1}\t{line}" for i, line in enumerate(content.split("\n")))


def _write_transcript(
    dir_path,
    name="session-abc.jsonl",
    date="2026-03-15",
    content=MEMORY_CONTENT,
    tool_use_id="toolu_mem_01",
):
    dir_path = pathlib.Path(dir_path)
    dir_path.mkdir(parents=True, exist_ok=True)
    lines = [
        json.dumps(
            {
                "type": "user",
                "timestamp": f"{date}T09:00:00.000Z",
                "message": {"role": "user", "content": "wake up"},
            }
        ),
        json.dumps(
            {
                "type": "assistant",
                "timestamp": f"{date}T09:00:05.000Z",
                "message": {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "tool_use",
                            "id": tool_use_id,
                            "name": "Read",
                            "input": {"file_path": "/home/claude/MEMORY.md"},
                        }
                    ],
                },
            }
        ),
        json.dumps(
            {
                "type": "user",
                "timestamp": f"{date}T09:00:06.000Z",
                "message": {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": tool_use_id,
                            "content": _numbered(content),
                        }
                    ],
                },
            }
        ),
    ]
    path = dir_path / name
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


# ===========================================================================
# DB / source-tree helpers
# ===========================================================================


def _seed_session(conn, session_id, date=datetime.date(2026, 3, 15)):
    conn.execute(
        "INSERT INTO sessions (id, date, time_of_day, version, source_type, "
        "source_file) VALUES (%s, %s, 'AM', '4.7', 'jsonl', 'seed.jsonl')",
        (session_id, date),
    )
    conn.commit()


def _write_writing(source_root):
    """One parseable composition so 'other extractors ran' is observable."""
    writing_dir = pathlib.Path(source_root) / "writing"
    writing_dir.mkdir(parents=True, exist_ok=True)
    (writing_dir / "staging-era-piece.md").write_text(
        "# Staging Era Piece\n\n*Written: 2026-03-14*\n\nBody text.\n",
        encoding="utf-8",
    )


def _plant_private_bait(source_root):
    """A .jsonl inside private/ — nothing staged may ever reference it."""
    private = pathlib.Path(source_root) / "private"
    private.mkdir(parents=True, exist_ok=True)
    _write_transcript(private, name="secret.jsonl", date="2026-03-15")
    (private / "note.md").write_text("SENTINEL — never staged\n", encoding="utf-8")


def _cfg(root, tmp_path, **overrides):
    root = pathlib.Path(root)
    root.mkdir(parents=True, exist_ok=True)
    return IngestConfig(source_root=root, output_dir=tmp_path / "out-guard", **overrides)


def _tmp_staging_set():
    return set(pathlib.Path(tempfile.gettempdir()).glob(STAGING_PREFIX + "*"))


def _sql_count(conn, table):
    return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]


def _memory_skip_reason(report):
    skipped = report.skipped
    keys = [k for k in skipped if "memory" in str(k).lower()]
    assert keys, f"no memory skip recorded: {skipped!r}"
    reason = skipped[keys[0]]
    assert isinstance(reason, str) and reason.strip(), (
        f"memory skip reason must be a non-empty string: {reason!r}"
    )
    return reason


def _assert_memory_not_skipped(report):
    keys = [k for k in report.skipped if "memory" in str(k).lower()]
    assert not keys, f"memory step wrongly recorded as skipped: {report.skipped!r}"


def _patch_memory_extractor(monkeypatch, replacement):
    """Patch extract_memory_from_jsonl under BOTH possible import styles."""
    import scripts.ingest as ingest_module

    patched = False
    if hasattr(ingest_module, "extract_memory_from_jsonl"):
        monkeypatch.setattr(ingest_module, "extract_memory_from_jsonl", replacement)
        patched = True
    if hasattr(extract_memory_module, "extract_memory_from_jsonl"):
        monkeypatch.setattr(extract_memory_module, "extract_memory_from_jsonl", replacement)
        patched = True
    assert patched, "could not find extract_memory_from_jsonl to patch"


# ===========================================================================
# 0. Contract signatures + fixture validity
# ===========================================================================


class TestContractSignatures:
    def test_stage_transcripts_run_param_defaults_to_subprocess_run(self):
        sig = inspect.signature(stage_transcripts)
        assert "run" in sig.parameters, "stage_transcripts must take an injectable 'run' callable"
        assert sig.parameters["run"].default is subprocess.run, (
            "the 'run' default must be subprocess.run itself"
        )

    def test_run_ingest_gains_optional_run_param(self):
        sig = inspect.signature(run_ingest)
        assert "run" in sig.parameters, (
            "run_ingest must accept run= to forward to stage_transcripts"
        )
        assert sig.parameters["run"].default is subprocess.run

    def test_ingest_config_with_transcripts_defaults_false(self, tmp_path):
        cfg = _cfg(tmp_path / "home", tmp_path)
        assert cfg.with_transcripts is False, (
            "IngestConfig.with_transcripts must exist and default to False"
        )


class TestFixtureValidity:
    """Guards the fixture, not new code: the transcript must be parseable by
    the EXISTING extractor, or every staged-ingest failure below is noise."""

    def test_fixture_transcript_parses_and_stores_one_snapshot(self, db_conn, tmp_path):
        _seed_session(db_conn, "fixture-sess", datetime.date(2026, 3, 15))
        transcripts = tmp_path / "fixture-transcripts"
        _write_transcript(transcripts)

        stored = extract_memory_from_jsonl(transcripts, db_conn)
        db_conn.commit()

        assert stored == 1, "the fixture transcript is not valid for extract_memory_from_jsonl"
        full = db_conn.execute("SELECT full_content FROM memory_snapshots").fetchone()[0]
        assert "## Identity" in full, (
            "line-number prefixes were not built in the strippable "
            "\\d+\\t form — headers did not survive"
        )
        assert "\N{ROBOT FACE}" in full, "emoji mangled in snapshot content"


# ===========================================================================
# 1. stage_transcripts direct behavior
# ===========================================================================


class TestStageTranscriptsDirect:
    def test_success_returns_0700_staging_path_with_copied_files(self, tmp_path):
        root = tmp_path / "fakehome"
        source = root / ".claude" / "projects" / "-home-claude"
        _write_transcript(source, name="real-a.jsonl")
        _write_transcript(source, name="real-b.jsonl", date="2026-03-16")
        _plant_private_bait(root)
        cfg = _cfg(root, tmp_path)
        runner = FakeRunner(copy_from=source)

        before = _tmp_staging_set()
        result = stage_transcripts(cfg, run=runner)
        try:
            assert result is not None, "runner succeeded but got None back"
            assert isinstance(result, pathlib.Path), f"must return pathlib.Path, got {type(result)}"
            assert result.is_dir()
            assert STAGING_PREFIX in result.name, (
                f"staging dir {result} lacks the mkdtemp prefix {STAGING_PREFIX!r}"
            )
            assert result.resolve().parent == pathlib.Path(tempfile.gettempdir()).resolve(), (
                f"staging dir {result} was not created under tempfile.gettempdir()"
            )
            assert result in _tmp_staging_set() - before, (
                "staging dir predates this call — mkdtemp was not used"
            )
            assert stat.S_IMODE(result.stat().st_mode) == 0o700, "staging dir must be mode 0700"
            assert len(runner.calls) == 1, (
                f"expected exactly one runner invocation, got {len(runner.calls)}"
            )
            # The dir existed (0700) BEFORE the copy command ran.
            assert runner.staging_existed == [True], (
                "staging dir did not exist when the copy command was invoked"
            )
            assert runner.staging_modes == [0o700]
            copied = sorted(p.name for p in result.glob("*.jsonl"))
            assert copied == ["real-a.jsonl", "real-b.jsonl"], (
                f"fake copy did not land in the staging dir: {copied}"
            )
        finally:
            if result is not None and result.is_dir():
                shutil.rmtree(result, ignore_errors=True)

    def test_command_references_source_glob_and_staging_never_private(self, tmp_path):
        root = tmp_path / "fakehome"
        _write_transcript(root / ".claude" / "projects" / "-home-claude")
        _plant_private_bait(root)
        cfg = _cfg(root, tmp_path)
        runner = FakeRunner(copy_from=None)

        result = stage_transcripts(cfg, run=runner)
        try:
            assert runner.calls, "stage_transcripts never invoked the runner"
            cmd, _ = runner.calls[0]
            joined = " ".join(_cmd_strings(cmd))
            assert ".claude/projects/-home-claude" in joined, (
                f"command does not reference the transcripts source: {joined}"
            )
            assert str(root) in joined, (
                f"command does not reference the configured source_root: {joined}"
            )
            assert STAGING_PREFIX in joined, f"command does not reference the staging dir: {joined}"
            for arg in _cmd_strings(cmd):
                assert "private" not in arg.lower(), (
                    f"sudo command references a private path: {arg!r}"
                )
        finally:
            if result is not None and pathlib.Path(result).is_dir():
                shutil.rmtree(result, ignore_errors=True)

    def test_source_root_with_spaces_and_unicode_still_referenced(self, tmp_path):
        root = tmp_path / "wéird home \N{HOUSE BUILDING}"
        _write_transcript(root / ".claude" / "projects" / "-home-claude")
        cfg = _cfg(root, tmp_path)
        runner = FakeRunner()

        result = stage_transcripts(cfg, run=runner)
        try:
            assert runner.calls
            joined = " ".join(_cmd_strings(runner.calls[0][0]))
            assert "wéird home \N{HOUSE BUILDING}" in joined, (
                "unicode/space source_root mangled in the copy command"
            )
        finally:
            if result is not None and pathlib.Path(result).is_dir():
                shutil.rmtree(result, ignore_errors=True)

    def test_nonzero_exit_returns_none_and_no_tmp_litter(self, tmp_path):
        cfg = _cfg(tmp_path / "fakehome", tmp_path)
        runner = FakeRunner(returncode=1, stderr="sudo: a password is required")

        before = _tmp_staging_set()
        result = stage_transcripts(cfg, run=runner)  # must NOT raise
        after = _tmp_staging_set()

        assert result is None, f"non-zero runner exit must yield None, got {result!r}"
        assert after - before == set(), f"failed staging left temp litter: {after - before}"
        captured = runner.staging_dirs[0] if runner.staging_dirs else None
        if captured is not None:
            assert not captured.exists(), f"staging dir {captured} survived a failed sudo copy"

    def test_runner_raising_file_not_found_returns_none_no_litter(self, tmp_path):
        cfg = _cfg(tmp_path / "fakehome", tmp_path)
        runner = FakeRunner(exc=FileNotFoundError("No such file: 'sudo'"))

        before = _tmp_staging_set()
        result = stage_transcripts(cfg, run=runner)  # must NOT raise
        after = _tmp_staging_set()

        assert result is None
        assert after - before == set(), f"FileNotFoundError path left temp litter: {after - before}"


# ===========================================================================
# 2. Staging wired through run_ingest — success path
# ===========================================================================


class TestStagedIngestSuccess:
    def test_staged_transcripts_populate_memory_snapshots(self, db_conn, tmp_path):
        root = tmp_path / "fakehome"
        _write_writing(root)
        _plant_private_bait(root)
        _seed_session(db_conn, "staged-sess-1", datetime.date(2026, 3, 15))
        fixtures = tmp_path / "fixture-transcripts"
        _write_transcript(fixtures, name="one.jsonl", date="2026-03-15")
        # Identical content under a second name: dedup through the staged
        # path must keep the delta at exactly 1, not 2.
        _write_transcript(fixtures, name="one-copy.jsonl", date="2026-03-15")
        cfg = _cfg(root, tmp_path, with_transcripts=True)
        assert cfg.transcripts_dir is None
        runner = FakeRunner(copy_from=fixtures)

        before_tmp = _tmp_staging_set()
        report = run_ingest(db_conn, cfg, run=runner)
        after_tmp = _tmp_staging_set()

        assert report.deltas["memory_snapshots"] == 1, (
            f"staged ingest must store exactly one deduped snapshot: {report.deltas!r}"
        )
        assert _sql_count(db_conn, "memory_snapshots") == 1
        full = db_conn.execute("SELECT full_content FROM memory_snapshots").fetchone()[0]
        assert "## Identity" in full and "\N{ROBOT FACE}" in full
        _assert_memory_not_skipped(report)
        assert "memory" not in report.errors, (
            f"clean staged run recorded a memory error: {report.errors!r}"
        )
        # Other extractors ran normally alongside staging.
        assert report.deltas["compositions"] == 1
        # Staging dir gone after the run — and no litter anywhere.
        assert len(runner.calls) == 1
        staged = runner.staging_dirs[0]
        assert staged is not None, "runner argv never named the staging dir"
        assert not staged.exists(), f"staging dir {staged} not removed after a successful run"
        assert after_tmp - before_tmp == set(), f"run left temp litter: {after_tmp - before_tmp}"

    def test_memory_extractor_receives_the_staged_dir(self, db_conn, tmp_path, monkeypatch):
        seen_dirs = []

        def recording_extractor(jsonl_dir, conn, *args, **kwargs):
            seen_dirs.append(pathlib.Path(jsonl_dir))
            return 0

        _patch_memory_extractor(monkeypatch, recording_extractor)
        cfg = _cfg(tmp_path / "fakehome", tmp_path, with_transcripts=True)
        runner = FakeRunner()

        run_ingest(db_conn, cfg, run=runner)

        assert seen_dirs, "memory extractor never ran on the staged path"
        staged = runner.staging_dirs[0]
        assert staged is not None
        assert seen_dirs[0] == staged, (
            f"memory ingest ran against {seen_dirs[0]}, not the staged copy {staged}"
        )

    def test_empty_staging_runs_memory_with_zero_delta_not_skipped(self, db_conn, tmp_path):
        """Runner succeeds but copies nothing: the step RAN (zero yield),
        so it must be neither skipped nor an error — and must not crash."""
        root = tmp_path / "fakehome"
        _write_writing(root)
        cfg = _cfg(root, tmp_path, with_transcripts=True)
        runner = FakeRunner(copy_from=None)  # exit 0, no files copied

        report = run_ingest(db_conn, cfg, run=runner)

        assert report.deltas["memory_snapshots"] == 0
        _assert_memory_not_skipped(report)
        assert report.errors == {}, f"empty staged dir is not an error: {report.errors!r}"
        staged = runner.staging_dirs[0]
        assert staged is not None and not staged.exists(), "empty staging dir not cleaned up"


# ===========================================================================
# 3. Staging failure → graceful skip
# ===========================================================================


class TestStagingFailureSkips:
    def _assert_graceful_skip(self, db_conn, report, runner):
        reason = _memory_skip_reason(report)
        assert reason  # non-empty, checked in helper
        assert "memory" not in report.errors, (
            f"failed staging must be a SKIP, not an error: {report.errors!r}"
        )
        assert report.deltas["memory_snapshots"] == 0
        assert _sql_count(db_conn, "memory_snapshots") == 0
        # Other extractors were unaffected by the staging failure.
        assert report.deltas["compositions"] == 1, (
            "a staging failure disturbed the other extractors"
        )
        assert runner.calls, "staging was never even attempted"

    def test_sudo_password_required_records_skip_run_continues(self, db_conn, tmp_path):
        root = tmp_path / "fakehome"
        _write_writing(root)
        cfg = _cfg(root, tmp_path, with_transcripts=True)
        runner = FakeRunner(returncode=1, stderr="sudo: a password is required")

        before_tmp = _tmp_staging_set()
        report = run_ingest(db_conn, cfg, run=runner)  # must NOT raise
        after_tmp = _tmp_staging_set()

        self._assert_graceful_skip(db_conn, report, runner)
        assert after_tmp - before_tmp == set(), (
            f"failed staging left temp litter: {after_tmp - before_tmp}"
        )

    def test_missing_sudo_binary_records_skip_run_continues(self, db_conn, tmp_path):
        root = tmp_path / "fakehome"
        _write_writing(root)
        cfg = _cfg(root, tmp_path, with_transcripts=True)
        runner = FakeRunner(exc=FileNotFoundError("No such file: 'sudo'"))

        report = run_ingest(db_conn, cfg, run=runner)  # must NOT raise

        self._assert_graceful_skip(db_conn, report, runner)


# ===========================================================================
# 4. Finally-cleanup when the memory extractor raises
# ===========================================================================


class TestCleanupOnExtractorFailure:
    def test_staging_removed_and_error_recorded_when_extractor_raises(
        self, db_conn, tmp_path, monkeypatch
    ):
        def exploding_extractor(*args, **kwargs):
            raise RuntimeError("memory extractor exploded (test-injected)")

        _patch_memory_extractor(monkeypatch, exploding_extractor)
        root = tmp_path / "fakehome"
        _write_writing(root)
        fixtures = tmp_path / "fixture-transcripts"
        _write_transcript(fixtures)
        cfg = _cfg(root, tmp_path, with_transcripts=True)
        runner = FakeRunner(copy_from=fixtures)

        before_tmp = _tmp_staging_set()
        report = run_ingest(db_conn, cfg, run=runner)  # must NOT raise
        after_tmp = _tmp_staging_set()

        assert "memory" in report.errors, f"extractor failure not recorded: {report.errors!r}"
        assert "exploded" in str(report.errors["memory"]), (
            "error record lost the underlying exception message"
        )
        staged = runner.staging_dirs[0]
        assert staged is not None
        assert not staged.exists(), (
            f"staging dir {staged} survived an extractor failure — cleanup "
            "must be in a finally block"
        )
        assert after_tmp - before_tmp == set(), (
            f"extractor failure left temp litter: {after_tmp - before_tmp}"
        )
        # The failure stayed contained: earlier extractors' work persists.
        assert report.deltas["compositions"] == 1
        assert report.deltas["memory_snapshots"] == 0


# ===========================================================================
# 5. When staging must NOT happen
# ===========================================================================


class TestNoStagingPaths:
    def _install_stage_recorder(self, monkeypatch):
        import scripts.ingest as ingest_module

        calls = []

        def recording_stage(*args, **kwargs):
            calls.append((args, kwargs))
            return None

        monkeypatch.setattr(ingest_module, "stage_transcripts", recording_stage)
        return calls

    def test_stage_not_called_when_neither_flag_nor_dir(self, db_conn, tmp_path, monkeypatch):
        calls = self._install_stage_recorder(monkeypatch)
        cfg = _cfg(tmp_path / "fakehome", tmp_path)
        assert cfg.with_transcripts is False
        assert cfg.transcripts_dir is None

        report = run_ingest(db_conn, cfg)

        assert calls == [], (
            "stage_transcripts was invoked without with_transcripts or "
            "transcripts_dir — sudo would run on every plain ingest"
        )
        _memory_skip_reason(report)  # existing skip behavior preserved
        assert report.deltas["memory_snapshots"] == 0

    def test_explicit_transcripts_dir_bypasses_staging_and_survives(
        self, db_conn, tmp_path, monkeypatch
    ):
        """A caller-supplied transcripts_dir is used directly: no staging,
        no sudo — and run_ingest must NEVER delete the caller's directory."""
        calls = self._install_stage_recorder(monkeypatch)
        _seed_session(db_conn, "explicit-sess", datetime.date(2026, 3, 15))
        transcripts = tmp_path / "my-own-transcripts"
        fixture = _write_transcript(transcripts)
        cfg = _cfg(tmp_path / "fakehome", tmp_path, transcripts_dir=transcripts)

        report = run_ingest(db_conn, cfg)

        assert calls == [], "stage_transcripts was invoked despite an explicit transcripts_dir"
        assert report.deltas["memory_snapshots"] == 1
        _assert_memory_not_skipped(report)
        assert transcripts.is_dir() and fixture.is_file(), (
            "run_ingest deleted a caller-supplied transcripts_dir — "
            "cleanup must only ever target dirs IT staged"
        )

    @not_root
    def test_unreadable_explicit_transcripts_dir_skips_no_raise_no_staging(
        self, db_conn, tmp_path, monkeypatch
    ):
        """Regression pin for the pre-existing skip path under the new code:
        an unreadable explicit dir is a skip, never a crash, never a
        staging attempt, and never a deletion."""
        calls = self._install_stage_recorder(monkeypatch)
        root = tmp_path / "fakehome"
        _write_writing(root)
        transcripts = tmp_path / "locked-transcripts"
        _write_transcript(transcripts)
        os.chmod(transcripts, 0o000)
        try:
            cfg = _cfg(root, tmp_path, transcripts_dir=transcripts)
            report = run_ingest(db_conn, cfg)  # must NOT raise
        finally:
            os.chmod(transcripts, 0o755)

        assert calls == []
        _memory_skip_reason(report)
        assert report.deltas["memory_snapshots"] == 0
        assert report.deltas["compositions"] == 1
        assert transcripts.is_dir(), "run_ingest removed the caller's unreadable transcripts_dir"


# ===========================================================================
# 6. Sudo-command guard through the full run_ingest path
# ===========================================================================


class TestSudoCommandGuard:
    def test_no_run_ingest_staging_argv_ever_mentions_private(self, db_conn, tmp_path):
        root = tmp_path / "fakehome"
        _write_transcript(root / ".claude" / "projects" / "-home-claude")
        _plant_private_bait(root)
        cfg = _cfg(root, tmp_path, with_transcripts=True)
        runner = FakeRunner()

        run_ingest(db_conn, cfg, run=runner)

        assert runner.calls, "staging never attempted"
        for cmd, kwargs in runner.calls:
            for arg in _cmd_strings(cmd):
                assert "private" not in arg.lower(), (
                    f"staged copy command references a private path: {arg!r}"
                )
            cwd = kwargs.get("cwd")
            if cwd is not None:
                assert "private" not in str(cwd).lower()
        joined = " ".join(s for cmd, _ in runner.calls for s in _cmd_strings(cmd))
        assert ".claude/projects/-home-claude" in joined, (
            f"copy command does not target the transcripts project dir: {joined}"
        )
        assert STAGING_PREFIX in joined, f"copy command does not target the staging dir: {joined}"


# ===========================================================================
# WAVE 2 — hardening (written blind to the implementation, per pipeline
# rules after a first-attempt GREEN). Contract-level probes: if any of
# these fail, the implementation gets fixed, not the test.
# ===========================================================================


def _shell_string_of(cmd):
    """Return the shell-evaluated string of a command, or None if pure argv.

    Covers the two legitimate shapes: a plain string command (shell=True
    style) and an argv list carrying ``sh -c <string>`` — in both cases the
    returned string is what a shell would evaluate, so quoting bugs live
    there. A pure argv list with no ``-c`` returns None (no shell layer).
    """
    if isinstance(cmd, (str, bytes)):
        return cmd.decode("utf-8", "replace") if isinstance(cmd, bytes) else cmd
    parts = [str(p) for p in cmd]
    for i, part in enumerate(parts):
        if part == "-c" and i + 1 < len(parts):
            return parts[i + 1]
    return None


def _assert_hostile_path_round_trips(cmd, hostile_path):
    """The hostile path must survive command construction as ONE token.

    Shell-string commands: shlex.split must round-trip the full path inside
    a single token (proper shlex.quote-ing). An unquoted ``;``/space name
    fragments into several tokens; an unquoted single quote makes the
    string unparseable — both are quoting bugs. Pure-argv commands: the
    path must arrive inside exactly one argv element.
    """
    hostile = str(hostile_path)
    shell = _shell_string_of(cmd)
    if shell is None:
        parts = [str(p) for p in cmd]
        matching = [p for p in parts if hostile in p]
        assert matching, (
            f"hostile path {hostile!r} did not arrive as a single argv element: {parts!r}"
        )
        return
    try:
        tokens = shlex.split(shell)
    except ValueError as exc:
        pytest.fail(
            f"copy command is not shell-parseable — a quote character from "
            f"{hostile!r} was interpolated unquoted: {exc}\n{shell!r}"
        )
    assert any(hostile in tok for tok in tokens), (
        f"hostile path {hostile!r} fragmented across shell tokens — "
        f"paths are not shlex.quote-d: {tokens!r}"
    )


def _pwned_files(marker):
    """Any marker files an injected command would have created."""
    hits = []
    for base in (pathlib.Path.cwd(), pathlib.Path(tempfile.gettempdir())):
        hits.extend(base.glob(f"*{marker}*"))
    return hits


class MessyFailingRunner(FakeRunner):
    """Simulates a sudo copy that half-populates the staging dir, then
    fails: files land, exit code is non-zero. FakeRunner only copies on
    returncode == 0, so the partial-copy-then-fail shape needs this."""

    def __call__(self, *args, **kwargs):
        cmd = args[0] if args else kwargs.get("args")
        staging = _find_staging_dir(cmd) if cmd is not None else None
        if staging is not None and staging.is_dir() and self.copy_from is not None:
            for src in sorted(self.copy_from.glob("*.jsonl")):
                shutil.copy(src, staging / src.name)
        return super().__call__(*args, **kwargs)


class TestShellInjectionResistance:
    """source_root is attacker-ish data as far as command construction is
    concerned: metacharacters in directory names must never change the
    command's meaning. Nothing here executes a real shell — the FakeRunner
    swallows the command — so the teeth are the token round-trip
    assertions plus a marker-file sweep catching any local evaluation of
    the constructed string during command building."""

    def _probe(self, tmp_path, dirname, marker):
        root = tmp_path / dirname
        _write_transcript(root / ".claude" / "projects" / "-home-claude")
        cfg = _cfg(root, tmp_path)
        runner = FakeRunner()

        result = stage_transcripts(cfg, run=runner)
        try:
            assert runner.calls, "staging never invoked the runner"
            cmd, _ = runner.calls[0]
            _assert_hostile_path_round_trips(cmd, root)
            assert _pwned_files(marker) == [], (
                f"metacharacters in {dirname!r} were EXECUTED during command construction"
            )
        finally:
            for leftover in _pwned_files(marker):
                leftover.unlink()
            if result is not None and pathlib.Path(result).is_dir():
                shutil.rmtree(result, ignore_errors=True)

    def test_semicolon_and_spaces_in_source_root(self, tmp_path):
        u = uuid.uuid4().hex[:8]
        self._probe(tmp_path, f"inj; touch pwned-{u}", f"pwned-{u}")

    def test_command_substitution_in_source_root(self, tmp_path):
        u = uuid.uuid4().hex[:8]
        self._probe(tmp_path, f"sub$(touch pwned2-{u}) dir", f"pwned2-{u}")

    def test_single_quote_and_space_in_source_root(self, tmp_path):
        u = uuid.uuid4().hex[:8]
        self._probe(tmp_path, f"o'brien home {u}", f"pwned3-{u}")


class TestUnexpectedRunnerException:
    def test_runtime_error_propagates_but_staging_is_removed(self, tmp_path):
        """Only non-zero exits and FileNotFoundError are graceful skips.
        Anything else is a bug in the runner or environment and must
        PROPAGATE — silently converting it to None would hide real
        failures — but the staging dir must still be cleaned up."""
        cfg = _cfg(tmp_path / "fakehome", tmp_path)
        runner = FakeRunner(exc=RuntimeError("runner exploded (test-injected)"))

        before = _tmp_staging_set()
        with pytest.raises(RuntimeError, match="test-injected"):
            stage_transcripts(cfg, run=runner)
        after = _tmp_staging_set()

        assert after - before == set(), (
            f"unexpected-exception path left temp litter: {after - before}"
        )


class TestDoubleStaging:
    def test_two_sequential_staged_runs_use_distinct_dirs(self, db_conn, tmp_path):
        root = tmp_path / "fakehome"
        _write_writing(root)
        _seed_session(db_conn, "dbl-sess-1", datetime.date(2026, 3, 15))
        _seed_session(db_conn, "dbl-sess-2", datetime.date(2026, 3, 16))
        fixtures_a = tmp_path / "fixtures-a"
        _write_transcript(fixtures_a, name="a.jsonl", date="2026-03-15")
        fixtures_b = tmp_path / "fixtures-b"
        _write_transcript(
            fixtures_b,
            name="b.jsonl",
            date="2026-03-16",
            content=MEMORY_CONTENT + "\n## Second Era\nNew content.\n",
        )
        cfg = _cfg(root, tmp_path, with_transcripts=True)
        runner_a = FakeRunner(copy_from=fixtures_a)
        runner_b = FakeRunner(copy_from=fixtures_b)

        report_a = run_ingest(db_conn, cfg, run=runner_a)
        report_b = run_ingest(db_conn, cfg, run=runner_b)

        assert report_a.deltas["memory_snapshots"] == 1
        assert report_b.deltas["memory_snapshots"] == 1, (
            "second staged run must ingest its own (distinct) snapshot: "
            f"{report_b.deltas!r} / errors {report_b.errors!r} / "
            f"skipped {report_b.skipped!r}"
        )
        staged_a = runner_a.staging_dirs[0]
        staged_b = runner_b.staging_dirs[0]
        assert staged_a is not None and staged_b is not None
        assert staged_a != staged_b, (
            "sequential runs reused the same staging dir — cross-run contamination is possible"
        )
        assert not staged_a.exists() and not staged_b.exists(), (
            "one of the sequential staging dirs was not cleaned up"
        )


class TestStagingDirUniqueness:
    def test_two_direct_calls_return_distinct_prefixed_tmp_dirs(self, tmp_path):
        root = tmp_path / "fakehome"
        _write_transcript(root / ".claude" / "projects" / "-home-claude")
        cfg = _cfg(root, tmp_path)
        first = second = None
        try:
            first = stage_transcripts(cfg, run=FakeRunner())
            second = stage_transcripts(cfg, run=FakeRunner())

            for result in (first, second):
                assert result is not None
                assert result.name.startswith(STAGING_PREFIX), (
                    f"{result} lacks the {STAGING_PREFIX!r} prefix"
                )
                assert result.resolve().parent == pathlib.Path(tempfile.gettempdir()).resolve()
            assert first != second, (
                "stage_transcripts returned the same dir twice — mkdtemp uniqueness contract broken"
            )
        finally:
            for result in (first, second):
                if result is not None and pathlib.Path(result).is_dir():
                    shutil.rmtree(result, ignore_errors=True)


class TestPrecedenceExplicitDirWins:
    def test_with_transcripts_true_and_explicit_dir_uses_explicit(self, db_conn, tmp_path):
        """Both knobs set: the caller's explicit dir wins, sudo is never
        attempted, and the caller's dir is never deleted."""
        _seed_session(db_conn, "prec-sess", datetime.date(2026, 3, 15))
        transcripts = tmp_path / "callers-own-transcripts"
        fixture = _write_transcript(transcripts)
        cfg = _cfg(
            tmp_path / "fakehome",
            tmp_path,
            with_transcripts=True,
            transcripts_dir=transcripts,
        )
        runner = FakeRunner()

        report = run_ingest(db_conn, cfg, run=runner)

        assert runner.calls == [], (
            "explicit transcripts_dir set, yet the sudo runner was invoked — precedence is wrong"
        )
        assert report.deltas["memory_snapshots"] == 1
        _assert_memory_not_skipped(report)
        assert transcripts.is_dir() and fixture.is_file(), (
            "run_ingest deleted the caller's explicit transcripts_dir"
        )


class TestPartialCopyNoLitter:
    def test_files_copied_then_nonzero_exit_still_fully_removed(self, tmp_path):
        """sudo can die AFTER copying some files (mid-glob permission
        error, disk full). The half-populated staging dir must still be
        removed — rmdir-only cleanup would fail on a non-empty dir."""
        root = tmp_path / "fakehome"
        fixtures = tmp_path / "fixture-transcripts"
        _write_transcript(fixtures, name="half-copied.jsonl")
        _write_transcript(root / ".claude" / "projects" / "-home-claude")
        cfg = _cfg(root, tmp_path)
        runner = MessyFailingRunner(copy_from=fixtures, returncode=1, stderr="install: write error")

        before = _tmp_staging_set()
        result = stage_transcripts(cfg, run=runner)  # must NOT raise
        after = _tmp_staging_set()

        assert result is None
        staged = runner.staging_dirs[0] if runner.staging_dirs else None
        assert staged is not None, "runner argv never named the staging dir"
        assert not staged.exists(), (
            f"half-populated staging dir {staged} survived a failed copy — "
            "cleanup must handle non-empty dirs (shutil.rmtree, not rmdir)"
        )
        assert after - before == set(), f"partial-copy failure left temp litter: {after - before}"


class TestStagedPathUsableAtCallTime:
    def test_extractor_gets_existing_staged_dir_removed_only_after(
        self, db_conn, tmp_path, monkeypatch
    ):
        """Cleanup must be sequenced AFTER the memory step: the extractor
        must receive the staging dir while it still exists on disk."""
        seen = []

        def recording_extractor(jsonl_dir, conn, *args, **kwargs):
            p = pathlib.Path(jsonl_dir)
            seen.append((p, p.is_dir()))
            return 0

        _patch_memory_extractor(monkeypatch, recording_extractor)
        fixtures = tmp_path / "fixture-transcripts"
        _write_transcript(fixtures)
        cfg = _cfg(tmp_path / "fakehome", tmp_path, with_transcripts=True)
        runner = FakeRunner(copy_from=fixtures)

        run_ingest(db_conn, cfg, run=runner)

        assert seen, "memory extractor never ran on the staged path"
        staged_path, existed_at_call = seen[0]
        assert staged_path == runner.staging_dirs[0]
        assert existed_at_call, (
            "staging dir was already removed when the memory extractor "
            "was invoked — cleanup is sequenced before the step it serves"
        )
        assert not staged_path.exists(), (
            "staging dir survived the run — cleanup after the memory step is missing"
        )
