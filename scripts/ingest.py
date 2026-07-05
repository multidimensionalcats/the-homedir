"""Stage-1 ingest orchestration for the Home Directory data pipeline.

Coordinates the individual extractors (sessions, writing, messages,
predictions, pets, memory snapshots) against a single database
connection, enforcing the private-path guarantee before any source data
is read and reporting per-table row deltas afterwards.

This module is orchestration only: it does not run the quarantine sweep
(:mod:`scripts.validate_dates`) or the JSON export
(:mod:`scripts.prebuild_export`) — those are wired in a later phase —
and it deliberately has no CLI.
"""

from __future__ import annotations

import os
import shlex
import shutil
import subprocess
import tempfile
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import psycopg

from scripts.extract_memory import extract_memory_from_jsonl
from scripts.extract_messages import extract_all_messages
from scripts.extract_pets import extract_all_pets
from scripts.extract_predictions import extract_all_predictions
from scripts.extract_sessions import extract_all
from scripts.extract_writing import extract_all_writing


DEFAULT_SOURCE_ROOT = Path("/home/claude")

# Default source subdirectories, relative to source_root.
# NONE of these may ever contain a "private" path component — the
# private journal is excluded from all pipelines.
SOURCES: dict[str, str] = {
    "activity_logs_dir": ".claude/activity-logs",
    "session_logs_dir": ".claude/session-logs",
    "writing_dir": "writing",
    "messages_dir": ".",  # messages_*.md live at the root
    "predictions_dir": "notes/predictions",
    "daily_notes_dir": "notes/daily",
}

# Tables whose row counts are tracked across an ingest run.
_TRACKED_TABLES: tuple[str, ...] = (
    "sessions",
    "compositions",
    "messages",
    "predictions",
    "pet_events",
    "memory_snapshots",
)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass
class IngestConfig:
    """Paths for one ingest run.

    All directory fields default relative to ``source_root`` (see
    ``SOURCES``); a no-arg construction yields the /home/claude layout.
    ``transcripts_dir`` is opt-in: memory snapshot extraction only runs
    when it is set and readable. ``with_transcripts`` asks the runner to
    stage the JSONL transcripts itself via a sudo copy
    (:func:`stage_transcripts`); it only takes effect when
    ``transcripts_dir`` is unset — an explicit ``transcripts_dir`` is
    used as-is and is never staged or deleted.
    """

    source_root: Path = DEFAULT_SOURCE_ROOT
    activity_logs_dir: Path | None = None
    session_logs_dir: Path | None = None
    writing_dir: Path | None = None
    messages_dir: Path | None = None
    predictions_dir: Path | None = None
    daily_notes_dir: Path | None = None
    output_dir: Path = Path("src/data")
    transcripts_dir: Path | None = None
    with_transcripts: bool = False

    def __post_init__(self) -> None:
        self.source_root = Path(self.source_root)
        self.output_dir = Path(self.output_dir)
        if self.transcripts_dir is not None:
            self.transcripts_dir = Path(self.transcripts_dir)
        for name, rel in SOURCES.items():
            current = getattr(self, name)
            if current is None:
                setattr(self, name, self.source_root / rel)
            else:
                setattr(self, name, Path(current))

    @classmethod
    def from_source_root(cls, root: Path | str) -> IngestConfig:
        """Config with every source directory derived from ``root``."""
        return cls(source_root=Path(root))


# ---------------------------------------------------------------------------
# Private-path guard
# ---------------------------------------------------------------------------


def assert_no_private_paths(cfg: IngestConfig) -> None:
    """Raise ValueError if any source path resolves under <root>/private.

    Paths are resolved with :meth:`Path.resolve` so symlinks into the
    private directory and ``..`` traversal are caught. The private
    directory itself is also resolved, so when ``<root>/private`` is a
    symlink, paths through the link AND paths at its real target are
    both flagged. The comparison uses path components
    (``Path.is_relative_to``), so sibling directories such as
    ``<root>/private_backup`` are NOT flagged.
    """
    private_dir = (Path(cfg.source_root).resolve() / "private").resolve()

    checked: dict[str, Path | None] = {name: getattr(cfg, name) for name in SOURCES}
    checked["transcripts_dir"] = cfg.transcripts_dir

    for name, path in checked.items():
        if path is None:
            continue
        resolved = Path(path).resolve()
        if resolved == private_dir or resolved.is_relative_to(private_dir):
            raise ValueError(
                f"{name} ({path}) resolves to {resolved}, which is inside "
                f"the private directory {private_dir}; private content is "
                f"excluded from all pipelines"
            )


# ---------------------------------------------------------------------------
# Table counts
# ---------------------------------------------------------------------------


def table_counts(conn: psycopg.Connection) -> dict[str, int]:
    """Row counts for every tracked table.

    Runs inside its own transaction block so the implicit transaction
    opened by the SELECTs is closed before returning — count snapshots
    must never leave the caller's connection in INTRANS.
    """
    counts: dict[str, int] = {}
    with conn.transaction():
        for table in _TRACKED_TABLES:
            row = conn.execute(f"SELECT count(*) FROM {table}").fetchone()
            counts[table] = row[0]
    return counts


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------


@dataclass
class IngestReport:
    """Outcome of one :func:`run_ingest` call.

    ``deltas`` always contains every tracked table (after minus before);
    ``errors`` maps extractor name to the exception message for steps
    that failed; ``skipped`` maps step name to the reason it did not run.
    """

    deltas: dict[str, int] = field(default_factory=dict)
    errors: dict[str, str] = field(default_factory=dict)
    skipped: dict[str, str] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Transcript staging
# ---------------------------------------------------------------------------

# JSONL transcripts live under this path relative to source_root; they
# require sudo to read, hence the staged copy.
_TRANSCRIPTS_REL = Path(".claude/projects/-home-claude")


def stage_transcripts(
    cfg: IngestConfig,
    run: Callable[..., subprocess.CompletedProcess] = subprocess.run,
) -> Path | None:
    """Copy the sudo-only JSONL transcripts into a private staging dir.

    Creates a mode-0700 temp directory and invokes ``run`` with a sudo
    command that copies ``<source_root>/.claude/projects/-home-claude/
    *.jsonl`` into it. Returns the staging path on success. On any
    failure — non-zero exit from the runner or a missing sudo binary
    (:class:`FileNotFoundError`) — the staging directory is removed and
    None is returned; no temp litter is ever left behind.

    The constructed command references only the transcripts glob and the
    staging directory. It must never touch anything under ``private``.
    """
    staging = Path(tempfile.mkdtemp(prefix="homedir-transcripts-", dir=tempfile.gettempdir()))
    # mkdtemp already yields 0700; chmod to make the guarantee explicit.
    staging.chmod(0o700)

    src_dir = Path(cfg.source_root) / _TRANSCRIPTS_REL
    cmd = [
        "sudo",
        "sh",
        "-c",
        f"install -m 0644 -t {shlex.quote(str(staging))} {shlex.quote(str(src_dir))}/*.jsonl",
    ]

    try:
        result = run(cmd)
    except FileNotFoundError:
        # No sudo binary on this host.
        shutil.rmtree(staging, ignore_errors=True)
        return None
    except Exception:
        # Unexpected runner failure: still no /tmp litter.
        shutil.rmtree(staging, ignore_errors=True)
        raise

    if result.returncode != 0:
        shutil.rmtree(staging, ignore_errors=True)
        return None

    return staging


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def _transcripts_skip_reason(transcripts_dir: Path | None) -> str | None:
    """Reason the memory step must be skipped, or None if it can run."""
    if transcripts_dir is None:
        return "transcripts_dir not configured"
    path = Path(transcripts_dir)
    if not path.is_dir():
        return f"transcripts_dir {path} is not a readable directory"
    if not os.access(path, os.R_OK | os.X_OK):
        return f"transcripts_dir {path} is not readable"
    return None


def run_ingest(
    conn: psycopg.Connection,
    cfg: IngestConfig,
    run: Callable[..., subprocess.CompletedProcess] = subprocess.run,
) -> IngestReport:
    """Run all extractors in foreign-key order and report per-table deltas.

    The private-path guard runs first, before any source data is read.
    Each extractor is isolated: a failure rolls back its uncommitted
    work, is recorded in ``errors``, and the run continues with the next
    extractor. Deltas come from :func:`table_counts` before/after diffs,
    never from extractor return values.

    ``run`` is forwarded to :func:`stage_transcripts` when
    ``cfg.with_transcripts`` is set without an explicit
    ``transcripts_dir``. A staged directory is removed after the memory
    step (even when the extractor raises); an explicitly configured
    ``transcripts_dir`` is never deleted. Failed staging skips the
    memory step (recorded in ``skipped``, not ``errors``) and the run
    continues normally.
    """
    assert_no_private_paths(cfg)

    report = IngestReport()
    before = table_counts(conn)

    # (name, callable) in FK order — sessions first, since compositions
    # link back to their producing session.
    steps: list[tuple[str, object]] = [
        ("sessions", lambda: extract_all(cfg.activity_logs_dir, cfg.session_logs_dir, conn)),
        ("writing", lambda: extract_all_writing(cfg.writing_dir, conn)),
        ("messages", lambda: extract_all_messages(cfg.messages_dir, conn)),
        ("predictions", lambda: extract_all_predictions(cfg.predictions_dir, conn)),
        ("pets", lambda: extract_all_pets(cfg.daily_notes_dir, conn)),
    ]

    # Resolve where the memory extractor reads from. Staging fires only
    # when transcripts were requested AND no explicit dir was given; an
    # explicit transcripts_dir is used as-is and never deleted.
    staged: Path | None = None
    memory_dir: Path | None = cfg.transcripts_dir
    staging_failed = False
    if cfg.with_transcripts and cfg.transcripts_dir is None:
        staged = stage_transcripts(cfg, run=run)
        if staged is None:
            staging_failed = True
            report.skipped["memory"] = (
                "transcripts staging failed: sudo copy of JSONL transcripts did not succeed"
            )
        else:
            memory_dir = staged

    if not staging_failed:
        skip_reason = _transcripts_skip_reason(memory_dir)
        if skip_reason is None:

            def _memory_step(memory_dir: Path = memory_dir) -> None:
                try:
                    extract_memory_from_jsonl(memory_dir, conn)
                finally:
                    # Only ever remove OUR staged copy — never a
                    # user-supplied transcripts_dir.
                    if staged is not None:
                        shutil.rmtree(staged, ignore_errors=True)

            steps.append(("memory", _memory_step))
        else:
            report.skipped["memory"] = skip_reason
            if staged is not None:
                shutil.rmtree(staged, ignore_errors=True)

    for name, step in steps:
        try:
            step()
            # Flush any work the extractor left in an implicit
            # transaction so a later step's rollback cannot undo it.
            conn.commit()
        except Exception as e:  # noqa: BLE001 — isolate every extractor
            conn.rollback()
            report.errors[name] = str(e)

    after = table_counts(conn)
    report.deltas = {t: after[t] - before[t] for t in _TRACKED_TABLES}
    return report
