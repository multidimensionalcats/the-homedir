"""Ingest orchestration and pipeline CLI for the Home Directory data pipeline.

Coordinates the individual extractors (sessions, writing, messages,
predictions, pets, memory snapshots) against a single database
connection, enforcing the private-path guarantee before any source data
is read and reporting per-table row deltas afterwards.

Orchestration lives in :func:`run_ingest` (Stage-1 extraction) and
:func:`run_export` (Stage-2 JSON export, which wraps
:mod:`scripts.prebuild_export` in a temp-then-move flow guarded against
shrinking exports and quotes.json corruption). :func:`main` is the CLI
entry point (``python scripts/ingest.py``, the package.json ``extract``
script): it runs both stages with the date-quarantine sweep
(:mod:`scripts.validate_dates`) between them, and offers a strictly
read-only ``--dry-run`` mode that estimates deltas from the pure parse
functions without writing a byte to the database or output directory.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

if not __package__:
    # Direct execution (`python scripts/ingest.py`, the package.json
    # "extract" script) puts scripts/ on sys.path rather than the repo
    # root that the `scripts.` imports below require.
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg

from scripts.db import connect
from scripts.extract_memory import extract_memory_from_jsonl
from scripts.extract_messages import extract_all_messages, parse_messages
from scripts.extract_pets import extract_all_pets, scan_daily_notes_for_pet_events
from scripts.extract_predictions import extract_all_predictions, parse_prediction_file
from scripts.extract_sessions import extract_all, parse_activity_log, parse_session_log
from scripts.extract_writing import extract_all_writing, extract_composition
from scripts.prebuild_export import export_all
from scripts.validate_dates import EXPERIMENT_START, find_outliers, quarantine_outliers

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

# Live MEMORY.md the memory extractor snapshots as a fallback when the
# JSONL transcripts contain no Read of it, relative to source_root.
_CURRENT_MEMORY_REL = Path(".claude/projects/-home-claude/memory/MEMORY.md")

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
    used as-is and is never staged or deleted. ``current_memory_path``
    is the live MEMORY.md the memory extractor snapshots as a fallback;
    it defaults relative to ``source_root``
    (``.claude/projects/-home-claude/memory/MEMORY.md``), and a
    nonexistent path simply yields nothing.
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
    current_memory_path: Path | None = None

    def __post_init__(self) -> None:
        self.source_root = Path(self.source_root)
        self.output_dir = Path(self.output_dir)
        if self.transcripts_dir is not None:
            self.transcripts_dir = Path(self.transcripts_dir)
        if self.current_memory_path is None:
            self.current_memory_path = self.source_root / _CURRENT_MEMORY_REL
        else:
            self.current_memory_path = Path(self.current_memory_path)
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
    checked["current_memory_path"] = cfg.current_memory_path

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
                    extract_memory_from_jsonl(memory_dir, conn, cfg.current_memory_path)
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


# ---------------------------------------------------------------------------
# Export report
# ---------------------------------------------------------------------------


@dataclass
class ExportReport:
    """Outcome of one :func:`run_export` call.

    ``written`` maps bare filename to ``(old_count, new_count)`` for files
    copied into the output directory — ``old_count`` is None when there was
    no readable pre-existing baseline (missing file, invalid UTF-8, or
    unparseable JSON; all three mean "nothing trustworthy to compare
    against"). ``blocked`` maps filename to the same tuple for files the
    shrink guard refused to copy. ``overridden`` maps filename to the
    same tuple for files a dry run predicts the shrink guard would block
    but ``--force`` overwrites (dry-run only; a real forced run records
    them in ``written``). ``errors`` maps a failure site to its message;
    operational failures land here rather than raising.
    ``quotes_verified`` is True only when the content hash of
    ``quotes.json`` was confirmed unchanged (or absent) after the move —
    it stays False whenever verification never ran.
    """

    written: dict[str, tuple[int | None, int]] = field(default_factory=dict)
    blocked: dict[str, tuple[int, int]] = field(default_factory=dict)
    overridden: dict[str, tuple[int, int]] = field(default_factory=dict)
    quotes_verified: bool = False
    errors: dict[str, str] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        """True iff nothing was blocked, nothing errored, and quotes survived.

        Overridden files do not fail the report — an override is an
        intentional ``--force`` outcome, mirroring a real forced run.
        """
        return not self.blocked and not self.errors and self.quotes_verified


# ---------------------------------------------------------------------------
# Export orchestration
# ---------------------------------------------------------------------------

# quotes.json is curated by hand and must never be produced or replaced
# by the export pipeline; run_export treats any sign of it in an export
# as corruption and refuses to touch the output directory.
_QUOTES_FILENAME = "quotes.json"


def _sha256_or_none(path: Path) -> str | None:
    """Content hash of ``path``, or None when the file cannot be read.

    None doubles as "absent": the quotes guard compares hashes before and
    after the move, and absent-both-times must compare equal.
    """
    try:
        return hashlib.sha256(Path(path).read_bytes()).hexdigest()
    except OSError:
        return None


def _record_count(path: Path) -> int | None:
    """Number of records in a JSON export file, or None when unreadable.

    Counting is type-based, never filename-based, so the shrink guard
    works for any file the exporter produces: a top-level list counts its
    elements; a top-level object counts the elements of its top-level
    list values only (lists nested deeper inside non-list values are
    invisible — they belong to some record, they are not records); any
    other JSON type carries zero records. Missing, unreadable, non-UTF-8,
    or unparseable files count as None so callers can distinguish "no
    trustworthy baseline" from "genuinely empty export".
    """
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        # ValueError covers json.JSONDecodeError and UnicodeDecodeError.
        return None
    if isinstance(payload, list):
        return len(payload)
    if isinstance(payload, dict):
        return sum(len(v) for v in payload.values() if isinstance(v, list))
    return 0


def _make_export_staging(output_dir: Path) -> Path:
    """Create a fresh, empty staging directory guaranteed outside ``output_dir``.

    :func:`run_export` hands this directory to ``export_all`` so the real
    output directory is never mutated until every guard has passed. Each
    call yields a distinct, empty, mode-0700 directory from
    :func:`tempfile.mkdtemp`; when the system temp location itself sits
    inside ``output_dir`` (e.g. TMPDIR pointed at it), fallback parents
    are tried so staged files can never masquerade as real exports or be
    left behind inside the output tree.
    """
    resolved_out = Path(output_dir).resolve()
    last_error: OSError | None = None
    for base in (None, Path.home(), Path.cwd()):
        try:
            staging = Path(tempfile.mkdtemp(prefix="homedir-export-", dir=base))
        except OSError as e:
            last_error = e
            continue
        resolved = staging.resolve()
        if resolved == resolved_out or resolved.is_relative_to(resolved_out):
            shutil.rmtree(staging, ignore_errors=True)
            continue
        return staging
    raise last_error or OSError(f"could not create a staging directory outside {output_dir}")


def run_export(
    conn: psycopg.Connection,
    cfg: IngestConfig,
    force: bool = False,
) -> ExportReport:
    """Export the database to JSON files via a guarded temp-then-move flow.

    ``export_all`` writes into a fresh staging directory, never directly
    into ``cfg.output_dir``, so every guard is evaluated against a
    complete export before a single byte of the output directory changes:

    * **quotes guard** — quotes.json is hand-curated and must never come
      out of the pipeline. If the export produced one (in the staging
      directory or in the returned path list), the whole move is aborted
      and the pre-existing quotes.json is untouched. After a normal move
      the file is re-hashed; any change is reported and
      ``quotes_verified`` stays False.
    * **shrink guard** — a file whose new export holds zero records must
      not replace a baseline that holds some: an empty export is far more
      likely a broken extractor than 206 sessions genuinely vanishing.
      Such files land in ``blocked`` and the old file survives.
      ``force=True`` overrides the guard for intentional resets.

    Operational failures (export crash, unwritable output directory,
    missing staging space) are recorded in ``errors`` — this function
    never raises for them, so a cron-driven pipeline always gets a report
    it can log. The staging directory is removed on every path, and the
    connection is rolled back before returning so the read-only export
    queries never leave the caller's connection in INTRANS (same
    convention as :func:`table_counts`).
    """
    report = ExportReport()
    out_dir = Path(cfg.output_dir)
    quotes_before = _sha256_or_none(out_dir / _QUOTES_FILENAME)

    staging: Path | None = None
    try:
        try:
            staging = _make_export_staging(out_dir)
        except OSError as e:
            report.errors["staging"] = str(e)
            return report

        try:
            exported = export_all(conn, staging)
        except Exception as e:  # noqa: BLE001 — failures belong in the report
            report.errors["export_all"] = str(e)
            return report

        # Quotes guard, part 1: refuse the entire move if the export
        # produced a quotes.json anywhere. Both the returned path list
        # and the actual staging contents are checked — a broken (or
        # hostile) exporter may lie in either direction.
        exported_names: set[str] = set()
        try:
            for entry in exported or ():
                exported_names.add(Path(entry).name)
        except (TypeError, ValueError):
            # Unusable return value; the staging scan below still guards.
            pass
        if _QUOTES_FILENAME in exported_names or (staging / _QUOTES_FILENAME).exists():
            report.errors["quotes"] = (
                f"export produced a {_QUOTES_FILENAME}; quotes are curated by "
                f"hand and never exported — the move was aborted and "
                f"{out_dir} is untouched"
            )
            return report

        # The output directory is only created once the export itself has
        # succeeded and the quotes guard has passed, so a crashed export
        # leaves no trace — not even an empty directory tree.
        try:
            out_dir.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            report.errors["output_dir"] = f"cannot create output directory {out_dir}: {e}"
            return report
        if not out_dir.is_dir() or not os.access(out_dir, os.W_OK | os.X_OK):
            report.errors["output_dir"] = f"output directory {out_dir} is not a writable directory"
            return report

        # Shrink guard: decide the fate of EVERY staged file before
        # moving ANY of them, so a blocked file can never sit next to a
        # half-finished move. An unparseable staged file counts as zero
        # records — a garbage export must not replace a good baseline.
        to_move: list[tuple[Path, int | None, int]] = []
        for src in sorted(p for p in staging.iterdir() if p.is_file()):
            new_count = _record_count(src) or 0
            old_count = _record_count(out_dir / src.name)
            if new_count == 0 and old_count is not None and old_count > 0 and not force:
                report.blocked[src.name] = (old_count, new_count)
            else:
                to_move.append((src, old_count, new_count))

        # Total-accounting move loop: every staged file's name ends up in
        # exactly ONE of written/blocked/errors. Successes are recorded
        # the moment they land on disk; the first failure is recorded
        # under ITS OWN filename (both failure modes); every file after
        # the failure is recorded as "not attempted" so the report never
        # undercounts (or overstates) disk state.
        for index, (src, old_count, new_count) in enumerate(to_move):
            dst = out_dir / src.name
            failure: str | None = None
            # shutil.move(src, dst) with dst an existing directory (or a
            # symlink to one — os.path.isdir follows links, and so does
            # shutil.move's own check) silently moves src INSIDE dst and
            # reports success. That would deposit the export into a
            # foreign directory while the report claimed the file itself
            # was written. Refuse instead: the filename lands in
            # ``errors`` (never ``written``), and nothing is moved.
            if dst.is_dir():
                failure = (
                    f"destination {dst} is an existing directory; refusing "
                    f"to nest {src.name} inside it — remove or rename the "
                    f"directory and re-run the export"
                )
            else:
                try:
                    shutil.move(str(src), str(dst))
                except OSError as e:
                    failure = f"failed to move {src.name} into {out_dir}: {e}"
            if failure is None:
                report.written[src.name] = (old_count, new_count)
                continue
            report.errors[src.name] = failure
            for later_src, _, _ in to_move[index + 1 :]:
                report.errors[later_src.name] = (
                    f"not attempted: move aborted after {src.name} failed"
                )
            break

        # Quotes guard, part 2: prove the move left quotes.json alone.
        quotes_after = _sha256_or_none(out_dir / _QUOTES_FILENAME)
        if quotes_after == quotes_before:
            report.quotes_verified = True
        else:
            report.errors["quotes"] = (
                f"{_QUOTES_FILENAME} changed during export "
                f"(sha256 {quotes_before} -> {quotes_after})"
            )
        return report
    finally:
        if staging is not None:
            shutil.rmtree(staging, ignore_errors=True)
        # Connection hygiene: export queries are read-only, so a rollback
        # loses nothing and guarantees the caller never inherits INTRANS.
        try:
            conn.rollback()
        except Exception:  # noqa: BLE001 — hygiene must never mask the report
            pass


# ---------------------------------------------------------------------------
# CLI parsing
# ---------------------------------------------------------------------------


def _max_date_arg(value: str) -> datetime.date:
    """argparse ``type=`` converter for ``--max-date`` (YYYY-MM-DD).

    Conversion happens at argparse time so an invalid value fails with the
    usual argparse error (SystemExit 2) naming --max-date, never deep
    inside the pipeline.
    """
    try:
        return datetime.date.fromisoformat(value)
    except ValueError as e:
        raise argparse.ArgumentTypeError(
            f"invalid --max-date value {value!r}: expected YYYY-MM-DD"
        ) from e


def _parse_args(argv: list[str]) -> argparse.Namespace:
    """Parse CLI arguments. Pure argparse — no I/O, no side effects."""
    parser = argparse.ArgumentParser(
        prog="ingest.py",
        description=(
            "Run the Home Directory data pipeline: Stage-1 ingest, the "
            "date-quarantine sweep, and the guarded Stage-2 JSON export."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="report what would change without writing to the database or output directory",
    )
    parser.add_argument(
        "--skip-export",
        action="store_true",
        help="do not run the Stage-2 JSON export",
    )
    parser.add_argument(
        "--skip-ingest",
        action="store_true",
        help="do not run the Stage-1 ingest",
    )
    transcripts = parser.add_mutually_exclusive_group()
    transcripts.add_argument(
        "--with-transcripts",
        action="store_true",
        help="stage the sudo-only JSONL transcripts for memory snapshot extraction",
    )
    transcripts.add_argument(
        "--transcripts-dir",
        type=Path,
        default=None,
        metavar="PATH",
        help="read JSONL transcripts from this directory (used as-is, never staged or deleted)",
    )
    parser.add_argument(
        "--source-root",
        type=Path,
        default=DEFAULT_SOURCE_ROOT,
        metavar="PATH",
        help="experiment home directory the source subdirectories derive from",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("src/data"),
        metavar="PATH",
        help="directory the Stage-2 JSON files are exported into",
    )
    parser.add_argument(
        "--max-date",
        type=_max_date_arg,
        default=None,
        metavar="YYYY-MM-DD",
        help="inclusive upper bound for the date-quarantine sweep (default: today)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="override the export shrink guard for intentional resets",
    )
    return parser.parse_args(argv)


# ---------------------------------------------------------------------------
# Report formatting
# ---------------------------------------------------------------------------


def _as_dict(value: object) -> dict:
    """Best-effort dict view of a report field; degenerate values become {}."""
    if isinstance(value, dict):
        return value
    if value is None:
        return {}
    try:
        return dict(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return {}


def _format_count(value: object) -> str:
    """Render a record count; None (no readable baseline) renders as "none"."""
    return "none" if value is None else str(value)


def _format_delta_line(name: object, delta: object) -> str:
    """Per-table delta line, e.g. ``sessions +3``."""
    try:
        return f"{name} {int(delta):+d}"  # type: ignore[call-overload]
    except (TypeError, ValueError):
        return f"{name} {delta}"


def _format_written_line(name: object, counts: object) -> str:
    """Written-file line, e.g. ``sessions.json 3 -> 5 +2``."""
    try:
        old, new = counts  # type: ignore[misc]
    except (TypeError, ValueError):
        return f"{name} {counts}"
    delta = ""
    try:
        delta = f" {int(new) - int(old):+d}"
    except (TypeError, ValueError):
        pass
    return f"{name} {_format_count(old)} -> {_format_count(new)}{delta}"


def _format_ingest_section(ingest: IngestReport | None, dry_run: bool) -> list[str]:
    lines = ["== Stage 1: ingest =="]
    if ingest is None:
        lines.append("skipped")
        return lines
    if dry_run:
        lines.append("dry run: estimated deltas only, nothing was ingested")
    for name, delta in _as_dict(getattr(ingest, "deltas", None)).items():
        lines.append(_format_delta_line(name, delta))
    for name, message in _as_dict(getattr(ingest, "errors", None)).items():
        lines.append(f"ERROR {name}: {message}")
    for name, reason in _as_dict(getattr(ingest, "skipped", None)).items():
        lines.append(f"SKIPPED {name}: {reason}")
    return lines


def _format_quarantine_section(
    quarantine: dict | list | BaseException | None,
) -> list[str]:
    lines = ["== Quarantine =="]
    if quarantine is None:
        lines.append("skipped")
        return lines
    if isinstance(quarantine, BaseException):
        lines.append(f"ERROR: quarantine sweep failed: {quarantine}")
        return lines
    if isinstance(quarantine, dict):
        # Real-run result of quarantine_outliers: per-table moved counts.
        total = 0
        for count in quarantine.values():
            try:
                total += int(count)  # type: ignore[call-overload]
            except (TypeError, ValueError):
                continue
        lines.append(f"quarantined {total} rows")
        for table, count in quarantine.items():
            lines.append(f"{table}: {count}")
        return lines
    # Dry-run result of find_outliers: a list of outlier dicts.
    try:
        outliers = list(quarantine)
    except TypeError:
        outliers = [quarantine]
    lines.append(f"would quarantine {len(outliers)} rows")
    for outlier in outliers:
        if isinstance(outlier, dict):
            table = outlier.get("source_table", "?")
            pk = outlier.get("pk", "?")
            reason = outlier.get("reason", "")
            lines.append(f"{table} pk={pk}: {reason}")
        else:
            lines.append(str(outlier))
    return lines


def _format_export_section(export: ExportReport | None, dry_run: bool) -> list[str]:
    lines = ["== Stage 2: export =="]
    if export is None:
        lines.append("skipped")
        return lines
    if dry_run:
        lines.append("dry run: no files were written; deltas show what a real export would change")
    for name, counts in _as_dict(getattr(export, "written", None)).items():
        lines.append(_format_written_line(name, counts))
    for name, counts in _as_dict(getattr(export, "blocked", None)).items():
        lines.append(
            f"BLOCKED {_format_written_line(name, counts)} "
            f"(shrink guard; re-run with --force to override)"
        )
    for name, counts in _as_dict(getattr(export, "overridden", None)).items():
        lines.append(
            f"{_format_written_line(name, counts)} "
            f"(shrink guard overridden by --force; existing file would be overwritten)"
        )
    if getattr(export, "quotes_verified", False):
        lines.append("quotes.json untouched (verified)")
    else:
        lines.append("quotes.json NOT verified")
    for site, message in _as_dict(getattr(export, "errors", None)).items():
        lines.append(f"ERROR {site}: {message}")
    return lines


def format_report(
    ingest: IngestReport | None,
    quarantine: dict | list | BaseException | None,
    export: ExportReport | None,
    *,
    dry_run: bool,
) -> str:
    """Render the three-stage pipeline report.

    All three section markers are always present; a stage that did not
    run (its report is None) renders as "skipped". ``quarantine`` is
    polymorphic: a dict of per-table counts (real run), a list of outlier
    dicts (dry run, "would quarantine" wording), an exception captured
    from a failed sweep, or None (skipped).
    """
    lines: list[str] = []
    if dry_run:
        lines.append("DRY RUN — no database writes, no files written")
        lines.append("")
    lines.extend(_format_ingest_section(ingest, dry_run))
    lines.append("")
    lines.extend(_format_quarantine_section(quarantine))
    lines.append("")
    lines.extend(_format_export_section(export, dry_run))
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Dry run
# ---------------------------------------------------------------------------


def _rollback_quietly(conn: psycopg.Connection) -> None:
    """Roll back the connection; hygiene must never mask a report."""
    try:
        conn.rollback()
    except Exception:  # noqa: BLE001 — hygiene only
        pass


def _source_skip_reason(path: Path) -> str | None:
    """Reason a dry-run source directory cannot be read, or None."""
    if not path.is_dir():
        return f"{path} is missing or not a directory"
    if not os.access(path, os.R_OK | os.X_OK):
        return f"{path} is not readable"
    return None


def _dry_ingest_report(conn: psycopg.Connection, cfg: IngestConfig) -> IngestReport:
    """Estimate Stage-1 deltas without writing anything.

    Uses only the pure parse functions against the configured source
    directories and read-only SELECTs against the database: exact deltas
    for sessions (parsed ids minus stored ids) and compositions (slugs),
    count-difference estimates for messages, predictions, and pet
    events. An unreadable source directory becomes a SKIPPED line, never
    a crash. The implicit transaction opened by the SELECTs is rolled
    back before returning.
    """
    report = IngestReport()
    try:
        # Sessions — exact: ids parsed from both log formats minus stored ids.
        parsed_ids: set[str] = set()
        activity_dir = Path(cfg.activity_logs_dir)
        session_dir = Path(cfg.session_logs_dir)
        activity_skip = _source_skip_reason(activity_dir)
        session_skip = _source_skip_reason(session_dir)
        if activity_skip:
            report.skipped["activity_logs"] = activity_skip
        else:
            for path in sorted(activity_dir.glob("activity-*.jsonl")):
                for session in parse_activity_log(path):
                    parsed_ids.add(session["session_id"])
        if session_skip:
            report.skipped["session_logs"] = session_skip
        else:
            for path in sorted(session_dir.glob("*.log")):
                session = parse_session_log(path)
                if session is not None:
                    parsed_ids.add(session["session_id"])
        if activity_skip is None or session_skip is None:
            rows = conn.execute("SELECT id FROM sessions").fetchall()
            report.deltas["sessions"] = len(parsed_ids - {row[0] for row in rows})

        # Compositions — exact: parsed slugs minus stored slugs.
        writing_dir = Path(cfg.writing_dir)
        writing_skip = _source_skip_reason(writing_dir)
        if writing_skip:
            report.skipped["writing"] = writing_skip
        else:
            slugs: set[str] = set()
            for path in sorted(writing_dir.iterdir()):
                if not (path.is_file() and path.suffix == ".md"):
                    continue
                try:
                    slugs.add(extract_composition(path)["slug"])
                except (OSError, PermissionError):
                    continue
            rows = conn.execute("SELECT slug FROM compositions").fetchall()
            report.deltas["compositions"] = len(slugs - {row[0] for row in rows})

        # Messages — estimate: extract_all_messages deletes and re-inserts
        # per direction, so parsed-minus-stored may legitimately be negative.
        messages_dir = Path(cfg.messages_dir)
        messages_skip = _source_skip_reason(messages_dir)
        if messages_skip:
            report.skipped["messages"] = messages_skip
        else:
            parsed_messages = 0
            for filename, direction in (
                ("messages_from_james.md", "from_james"),
                ("messages_to_james.md", "to_james"),
            ):
                path = messages_dir / filename
                if not path.is_file():
                    continue
                try:
                    parsed_messages += len(parse_messages(path, direction))
                except (OSError, PermissionError, UnicodeDecodeError):
                    continue
            row = conn.execute("SELECT count(*) FROM messages").fetchone()
            report.deltas["messages"] = parsed_messages - row[0]

        # Predictions — estimate; idempotent inserts never shrink the table.
        predictions_dir = Path(cfg.predictions_dir)
        predictions_skip = _source_skip_reason(predictions_dir)
        if predictions_skip:
            report.skipped["predictions"] = predictions_skip
        else:
            parsed_predictions = 0
            for path in sorted(predictions_dir.glob("*.md")):
                try:
                    parsed_predictions += len(parse_prediction_file(path))
                except (OSError, PermissionError):
                    continue
            row = conn.execute("SELECT count(*) FROM predictions").fetchone()
            report.deltas["predictions"] = max(0, parsed_predictions - row[0])

        # Pet events — estimate; idempotent inserts never shrink the table.
        notes_dir = Path(cfg.daily_notes_dir)
        notes_skip = _source_skip_reason(notes_dir)
        if notes_skip:
            report.skipped["daily_notes"] = notes_skip
        else:
            events = scan_daily_notes_for_pet_events(notes_dir)
            row = conn.execute("SELECT count(*) FROM pet_events").fetchone()
            report.deltas["pet_events"] = max(0, len(events) - row[0])

        # Memory snapshots need staged transcripts (a sudo copy — a write),
        # so a dry run never estimates them.
        if cfg.with_transcripts or cfg.transcripts_dir is not None:
            report.skipped["memory"] = "memory snapshots are not estimated in a dry run"

        return report
    finally:
        _rollback_quietly(conn)


def _dry_export_report(
    conn: psycopg.Connection,
    cfg: IngestConfig,
    force: bool = False,
) -> ExportReport:
    """Diff a real export (into a temp directory) against the output directory.

    Runs the real :func:`export_all` into a staging directory guaranteed
    outside ``cfg.output_dir``, compares per-file record counts against
    the existing files, and removes the staging directory on every path.
    ``cfg.output_dir`` itself is never created or touched — ``force``
    changes only how a would-blocked file is classified, never whether
    anything is written.

    Both of :func:`run_export`'s guards are *predicted* with the same
    semantics rather than papered over: an export that produced a
    quotes.json (in staging or in the returned path list) is reported as
    the quotes-guard error a real run would abort with, and
    ``quotes_verified`` is not claimed; a file whose new export holds
    zero records over a populated baseline lands in ``blocked`` (or in
    ``overridden`` when ``force`` is set, exactly as a real forced run
    would move it).
    """
    report = ExportReport()
    out_dir = Path(cfg.output_dir)
    try:
        staging = _make_export_staging(out_dir)
    except OSError as e:
        report.errors["staging"] = str(e)
        return report
    try:
        try:
            exported = export_all(conn, staging)
        except Exception as e:  # noqa: BLE001 — failures belong in the report
            report.errors["export_all"] = str(e)
            return report

        # Quotes-guard prediction: mirror run_export's part-1 check so a
        # dry run predicts the abort instead of masking it. Both the
        # returned path list and the actual staging contents are checked.
        exported_names: set[str] = set()
        try:
            for entry in exported or ():
                exported_names.add(Path(entry).name)
        except (TypeError, ValueError):
            # Unusable return value; the staging scan below still guards.
            pass
        if _QUOTES_FILENAME in exported_names or (staging / _QUOTES_FILENAME).exists():
            report.errors["quotes"] = (
                f"export produced a {_QUOTES_FILENAME}; quotes are curated by "
                f"hand and never exported — a real run would abort the move "
                f"and leave {out_dir} alone"
            )
            return report

        # Shrink-guard prediction: same would-block semantics as
        # run_export (empty export over a populated baseline).
        for src in sorted(p for p in staging.iterdir() if p.is_file()):
            new_count = _record_count(src) or 0
            old_count = _record_count(out_dir / src.name)
            would_block = new_count == 0 and old_count is not None and old_count > 0
            if would_block and not force:
                report.blocked[src.name] = (old_count, new_count)
            elif would_block:
                report.overridden[src.name] = (old_count, new_count)
            else:
                report.written[src.name] = (old_count, new_count)
        # Nothing outside the staging directory was touched, so the
        # hand-curated quotes.json survives by construction.
        report.quotes_verified = True
        return report
    finally:
        shutil.rmtree(staging, ignore_errors=True)
        _rollback_quietly(conn)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def _quarantine_end(args: argparse.Namespace) -> datetime.date:
    """Inclusive upper bound for the quarantine sweep (validate_dates semantics)."""
    return args.max_date if args.max_date is not None else datetime.date.today()


def _run_real(
    conn: psycopg.Connection,
    cfg: IngestConfig,
    args: argparse.Namespace,
) -> int:
    """Real run: ingest, quarantine sweep, export; print the report.

    The quarantine sweep is part of Stage 1: ``--skip-ingest`` skips it
    along with the ingest, and its section renders as skipped.
    """
    ingest_report: IngestReport | None = None
    quarantine_failed = False
    quarantine_result: dict | BaseException | None = None
    if not args.skip_ingest:
        try:
            ingest_report = run_ingest(conn, cfg)
        except Exception as e:  # noqa: BLE001 — failures belong in the report
            ingest_report = IngestReport(errors={"ingest": str(e)})
            _rollback_quietly(conn)

        try:
            quarantine_result = quarantine_outliers(conn, EXPERIMENT_START, _quarantine_end(args))
        except Exception as e:  # noqa: BLE001 — the sweep must never abort the run
            quarantine_failed = True
            quarantine_result = e
            _rollback_quietly(conn)

    export_report: ExportReport | None = None
    if not args.skip_export:
        try:
            export_report = run_export(conn, cfg, force=args.force)
        except Exception as e:  # noqa: BLE001 — failures belong in the report
            export_report = ExportReport(errors={"export": str(e)})
            _rollback_quietly(conn)

    print(format_report(ingest_report, quarantine_result, export_report, dry_run=False))

    failed = quarantine_failed
    if ingest_report is not None and ingest_report.errors:
        failed = True
    if export_report is not None and not export_report.ok:
        failed = True
    return 1 if failed else 0


def _run_dry(
    conn: psycopg.Connection,
    cfg: IngestConfig,
    args: argparse.Namespace,
) -> int:
    """Dry run: read-only estimates for all three stages; print the report.

    Mirrors the real run's gating and exit semantics: the quarantine
    estimate is part of Stage 1, so ``--skip-ingest`` skips it along with
    the ingest estimate (``find_outliers`` never runs, the section
    renders as skipped); the export diff exits non-zero exactly when a
    real export would not be ok (shrink-guard block, predicted quotes
    abort, or an error) — ``--force`` lifts a would-block the same way it
    lifts a real block, still without writing a byte.
    """
    failed = False

    ingest_report: IngestReport | None = None
    quarantine_result: list[dict] | BaseException | None = None
    if not args.skip_ingest:
        try:
            ingest_report = _dry_ingest_report(conn, cfg)
        except Exception as e:  # noqa: BLE001 — a dry run must still report
            failed = True
            ingest_report = IngestReport(errors={"dry-run ingest": str(e)})
            _rollback_quietly(conn)

        try:
            quarantine_result = find_outliers(conn, EXPERIMENT_START, _quarantine_end(args))
        except Exception as e:  # noqa: BLE001 — a dry run must still report
            failed = True
            quarantine_result = e
        _rollback_quietly(conn)

    export_report: ExportReport | None = None
    if not args.skip_export:
        try:
            export_report = _dry_export_report(conn, cfg, force=args.force)
        except Exception as e:  # noqa: BLE001 — a dry run must still report
            export_report = ExportReport(errors={"dry-run export": str(e)})
            _rollback_quietly(conn)
        if not export_report.ok:
            failed = True

    print(format_report(ingest_report, quarantine_result, export_report, dry_run=True))
    return 1 if failed else 0


def main(argv: list[str] | None = None, conn: psycopg.Connection | None = None) -> int:
    """Run the pipeline CLI and return a process exit code.

    ``argv=None`` reads sys.argv. An injected ``conn`` is used as-is and
    never closed; when ``conn`` is None exactly one connection is opened
    via :func:`scripts.db.connect` and closed before returning.
    Operational failures never raise — they land in the printed report
    and the exit code (0 clean; 1 when ingest errored, the quarantine
    sweep raised, or the export was not ok).
    """
    args = _parse_args(sys.argv[1:] if argv is None else argv)

    cfg = IngestConfig(
        source_root=args.source_root,
        output_dir=args.output_dir,
        transcripts_dir=args.transcripts_dir,
        with_transcripts=args.with_transcripts,
    )
    try:
        # Fail before touching anything — including in dry-run and
        # skip-ingest modes, which would otherwise bypass run_ingest's
        # own guard.
        assert_no_private_paths(cfg)
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    owns_connection = conn is None
    if owns_connection:
        try:
            conn = connect()
        except Exception as e:  # noqa: BLE001 — operational failures never raise
            print(f"ERROR: could not connect to the database: {e}", file=sys.stderr)
            return 1
    try:
        if args.dry_run:
            return _run_dry(conn, cfg, args)
        return _run_real(conn, cfg, args)
    except Exception as e:  # noqa: BLE001 — operational failures never raise
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    finally:
        if owns_connection:
            try:
                conn.close()
            except Exception:  # noqa: BLE001 — hygiene only
                pass


if __name__ == "__main__":
    raise SystemExit(main())
