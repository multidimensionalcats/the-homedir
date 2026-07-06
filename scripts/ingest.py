"""Stage-1 ingest orchestration for the Home Directory data pipeline.

Coordinates the individual extractors (sessions, writing, messages,
predictions, pets, memory snapshots) against a single database
connection, enforcing the private-path guarantee before any source data
is read and reporting per-table row deltas afterwards.

This module is orchestration only: extraction is coordinated by
:func:`run_ingest`, and the JSON export by :func:`run_export`, which
wraps :mod:`scripts.prebuild_export` in a temp-then-move flow guarded
against shrinking exports and quotes.json corruption. It does not run
the quarantine sweep (:mod:`scripts.validate_dates`) — that is wired in
a later phase — and it deliberately has no CLI.
"""

from __future__ import annotations

import hashlib
import json
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
from scripts.prebuild_export import export_all


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
    shrink guard refused to copy. ``errors`` maps a failure site to its
    message; operational failures land here rather than raising.
    ``quotes_verified`` is True only when the content hash of
    ``quotes.json`` was confirmed unchanged (or absent) after the move —
    it stays False whenever verification never ran.
    """

    written: dict[str, tuple[int | None, int]] = field(default_factory=dict)
    blocked: dict[str, tuple[int, int]] = field(default_factory=dict)
    quotes_verified: bool = False
    errors: dict[str, str] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        """True iff nothing was blocked, nothing errored, and quotes survived."""
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
