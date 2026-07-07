"""Hostile tests for scripts/ingest.py Phase-6 CLI (NOT yet implemented — RED).

Covers:
  - _parse_args(argv): full flag surface, --max-date parsed to datetime.date
    at argparse time, mutual exclusion of --with-transcripts /
    --transcripts-dir, SystemExit 2 for every argparse failure.
  - format_report(ingest, quarantine, export, *, dry_run): section markers,
    per-table delta lines, export old -> new lines, quotes.json "untouched",
    BLOCKED, memory SKIPPED, dry-run "would" wording, skipped stages.
  - main(argv, conn): real-run orchestration (ingest → quarantine sweep →
    export), exit codes 0/1/2, --skip-* flags, --max-date sweep bounds,
    --force, injected-conn ownership, None-conn connect/close ownership.
  - DRY-RUN IMMUTABILITY: byte-for-byte nothing changes in the DB or on disk,
    exact "+2" session delta, would-quarantine reporting, per-source SKIP
    lines, dry-run purity (DB-writing orchestrators and quarantine_outliers
    are never called).
  - Static pins: package.json "extract" script and the __main__ guard in
    scripts/ingest.py source text.

The CLI names under test (_parse_args, format_report, main) do not exist in
scripts/ingest.py yet, so the import below fails at collection time — that is
the intended RED state.

Deviations / ambiguity resolutions (documented per suite convention):
  1. Namespace attribute names pinned to argparse's standard dest derivation:
     dry_run, skip_export, skip_ingest, with_transcripts, transcripts_dir,
     source_root, output_dir, max_date, force.
  2. Path-valued args (source_root, output_dir, transcripts_dir) may come out
     of argparse as str or Path; tests normalize via pathlib.Path() — strict
     on LOCATION, lenient on type. max_date is pinned to exactly
     datetime.date (bool-adjacent or str sneaking through fails).
  3. Skipped-stage sections: PINNED PRESENT. Every report contains all three
     section markers ("== Stage 1: ingest ==", "== Quarantine ==",
     "== Stage 2: export =="); a skipped stage's section contains the word
     "skipped" (case-insensitive). main passes None as the report object for
     a stage that did not run; format_report(None, None, None, dry_run=False)
     renders three skipped sections.
  4. format_report's `quarantine` argument is polymorphic by construction of
     the contract: a dict of per-table counts on a real run (the return of
     quarantine_outliers), a list of outlier dicts on a dry run (the return
     of find_outliers), or None when skipped. All three are pinned.
  5. "before -> after" lines are pinned only where the data structurally
     carries both numbers: ExportReport.written/blocked tuples render
     "old -> new" (pinned literally, e.g. "3 -> 5"). IngestReport carries
     only deltas, so ingest per-table lines pin table name plus a
     "+N"-signed delta (e.g. "+2"); zero-delta rendering is NOT pinned.
  6. Ingest errors must SURFACE in format_report output (extractor name and
     message text) — main exits 1 for them, and a cron log that hides WHY is
     useless. The contract does not forbid it and the exit-code contract
     makes it the only legible behavior.
  7. Dry-run vs real-run quarantine wording: the dry-run quarantine section
     must contain "would" (case-insensitive); the real-run quarantine
     section must NOT contain "would". This operationalizes "without the
     word implying it happened" as a testable, symmetric pin.
  8. Dry-run purity is pinned by sabotage: all six DB-writing orchestrators
     (extract_all, extract_all_writing, extract_all_messages,
     extract_all_predictions, extract_all_pets, extract_memory_from_jsonl)
     AND quarantine_outliers are patched to raise; a dry run must still exit
     0 (pure parse functions + find_outliers + real export_all into a temp
     dir only).
  9. The None-conn path is pinned with a fake connect patched at BOTH
     scripts.ingest and scripts.db (import-style agnostic, per the stage-1
     suite's _patch_extractor convention). The fake returns a proxy that
     counts close() calls (context-manager exit counts as a close) without
     ever closing the shared test connection, so HOMEDIR_TEST semantics are
     preserved and no real/prod DB is touched. Pinned: exactly one connect
     call, at least one close, the injected-path connection NEVER closed.
 10. A quarantine sweep that RAISES on a real run is pinned as exit code 1
     with the exception captured (main must not propagate it).
 11. Per-source "SKIP" lines are pinned with uppercase "SKIP" (the contract
     quotes the token); with the whole source root unreadable, at least 3
     distinct Stage-1 lines must carry it.
 12. chmod-0o000 tests are skipped when running as root (root ignores mode).
 13. The __main__-guard static test pins the guard line via regex plus the
     substring "SystemExit(main(" in the file text (covers both
     `raise SystemExit(main())` and argv-forwarding variants).
 14. --max-date garbage set: "2026-13-45", "notadate", "2026-02-30", "".
     "20260101" is deliberately EXCLUDED (valid ISO-8601 basic format for
     date.fromisoformat on Python 3.11+, so it is not unambiguous garbage).
 15. No test ever touches /home/claude or src/data: every main() call passes
     --source-root/--output-dir under tmp_path, and the None-conn test
     replaces connect entirely. The tempfile default dir is sandboxed in the
     flagship dry-run test to pin "tmp deleted".
 16. Argparse mutual-exclusion/2-exit behavior is pinned both directly on
     _parse_args AND through main(): main must let argparse's SystemExit(2)
     propagate, with the DB untouched.

REVIEW PINS (appended after code review of the shipped dry-run path; the
tests live in the clearly-marked "REVIEW PINS" section at the bottom):
 17. --skip-ingest on a dry run skips the quarantine ESTIMATE exactly as it
     skips the real sweep: the quarantine section says "skipped", carries no
     "would quarantine" line, and find_outliers is provably never called
     (pinned by patching it to explode — the run must still exit 0).
 18. Dry-run exit codes have PARITY with the real run: any state where a
     real run would exit 1 (a shrink-blocked export, a conjured quotes.json)
     must make the dry run exit 1 too. A cron dry-check that reports clean
     when the real run would fail is a false-clean. Would-block is pinned
     via substring "BLOCK" on the affected file's own report line; the
     --force variant must exit 0 (parity with a real --force run) while
     STILL writing nothing.
 19. Wording resolution for the --force dry-run: the shrink-guarded file's
     report line(s) must carry a visible override indication, pinned as
     case-insensitive "overwrit" or "force", and must NOT say "BLOCK".
 20. Dry-run quotes-error surfacing is pinned as a line carrying both
     "ERROR" and "quotes" (the report's established ERROR-line shape), plus
     the absence of any "quotes.json ... untouched" claim.
 21. Two-sided dry-run purity: resolution 8 proves the DB writers are NOT
     called; the spy pin proves find_outliers IS called — exactly once,
     with the --max-date bound among its arguments — on the default dry
     path. The read side must be provably taken, not just the write side
     provably avoided.
 22. The --max-date boundary test now ingests via a first run whose sweep
     bound (2026-12-31) quarantines nothing, and pins the landed session
     dates BEFORE asserting the boundary sweep's effect in a second run —
     it no longer implicitly trusts parse_activity_log's filename-date
     derivation. Idempotent session inserts (ON CONFLICT DO NOTHING) make
     the second ingest a no-op.
"""

import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import sys
import tempfile

import pytest

import scripts.db as db_module
import scripts.extract_memory as extract_memory_module
import scripts.extract_messages as extract_messages_module
import scripts.extract_pets as extract_pets_module
import scripts.extract_predictions as extract_predictions_module
import scripts.extract_sessions as extract_sessions_module
import scripts.extract_writing as extract_writing_module
import scripts.ingest as ingest_module
import scripts.prebuild_export as prebuild_export_module
import scripts.validate_dates as validate_dates_module
from scripts.ingest import (  # noqa: F401  (RED: CLI names absent)
    ExportReport,
    IngestReport,
    _parse_args,
    format_report,
    main,
)

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]

not_root = pytest.mark.skipif(os.geteuid() == 0, reason="chmod 0o000 is not enforced for root")

TABLES = (
    "sessions",
    "compositions",
    "messages",
    "predictions",
    "pet_events",
    "memory_snapshots",
)
# quarantine included: dry-run immutability must cover the sweep target too.
COUNT_TABLES = TABLES + ("quarantine",)

# Exact section markers pinned by the contract.
M1 = "== Stage 1: ingest =="
MQ = "== Quarantine =="
M2 = "== Stage 2: export =="
MARKERS = (M1, MQ, M2)

# The six files export_all produces.
FILES = (
    "sessions.json",
    "writing-metadata.json",
    "messages.json",
    "predictions.json",
    "pet-timeline.json",
    "memory-snapshots.json",
)

EMPTY_PAYLOADS = {
    "sessions.json": [],
    "writing-metadata.json": [],
    "messages.json": [],
    "predictions.json": [],
    "pet-timeline.json": [],
    "memory-snapshots.json": {"snapshots": [], "blocks": []},
}

# Hand-curated quotes sentinel: unicode, RTL, emoji, no trailing newline.
QUOTES_SENTINEL = (
    '[{"quote": "יהי אור 🌱", "source": "curated"}, '
    '{"quote": "مرحبا — hand-picked", "source": "council"}]'
).encode()


# ===========================================================================
# Report-text helpers
# ===========================================================================


def _section(text, marker):
    """The slice of `text` from `marker` up to the next marker (or the end)."""
    assert marker in text, f"section marker {marker!r} missing from report:\n{text}"
    start = text.index(marker)
    end = len(text)
    for m in MARKERS:
        idx = text.find(m, start + len(marker))
        if idx != -1:
            end = min(end, idx)
    return text[start:end]


def _assert_line(text, *needles):
    """Assert some single LINE of `text` contains every needle; return it."""
    for line in text.splitlines():
        if all(n in line for n in needles):
            return line
    pytest.fail(f"no line contains all of {needles!r} in:\n{text}")


def _assert_no_line(text, *needles):
    for line in text.splitlines():
        assert not all(n in line for n in needles), (
            f"forbidden line (contains all of {needles!r}): {line!r}"
        )


# ===========================================================================
# DB / disk helpers
# ===========================================================================


def _sql_counts(conn, tables=COUNT_TABLES):
    """Independent ground truth — never uses scripts.ingest.table_counts."""
    return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in tables}


def _hash_dir(path):
    """{filename: sha256 hexdigest} for every regular file directly in path."""
    p = pathlib.Path(path)
    if not p.is_dir():
        return {}
    return {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in p.iterdir() if f.is_file()}


def _read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _dump_json(path, data):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _memory_payload(n_snapshots, n_blocks):
    return {
        "snapshots": [
            {"session_id": f"s{i}", "date": "2026-01-01", "token_count": 100, "block_hashes": []}
            for i in range(n_snapshots)
        ],
        "blocks": [
            {"hash": f"h{i}", "heading": "H", "first_seen_date": None, "last_seen_date": None}
            for i in range(n_blocks)
        ],
    }


def _seed_session(conn, session_id, date=datetime.date(2026, 3, 1)):
    conn.execute(
        "INSERT INTO sessions (id, date, time_of_day, version, source_type, source_file) "
        "VALUES (%s, %s, 'AM', '4.7', 'jsonl', 'seed.jsonl')",
        (session_id, date),
    )
    conn.commit()


def _seed_message(conn, date, content="seeded message"):
    conn.execute(
        "INSERT INTO messages (direction, date, content) VALUES ('to_james', %s, %s)",
        (date, content),
    )
    conn.commit()


# ===========================================================================
# Fixture-tree builders (formats verified against the real parsers; style
# mirrors test_ingest_stage1.py)
# ===========================================================================


def _jsonl_line(**kwargs):
    return json.dumps(kwargs)


def _session_lines(session_id, start="09:00:00", end="09:05:00"):
    return [
        _jsonl_line(ts=start, event="session_start", s=session_id, cwd="/home/claude"),
        _jsonl_line(
            ts=start,
            event="tool",
            s=session_id,
            t="Read",
            i="/home/claude/notes/daily/note.md",
        ),
        _jsonl_line(ts=end, event="session_end", s=session_id),
    ]


def _write_activity_file(source_root, date_str, session_ids):
    activity_dir = source_root / ".claude" / "activity-logs"
    activity_dir.mkdir(parents=True, exist_ok=True)
    lines = []
    for i, sid in enumerate(session_ids):
        lines.extend(
            _session_lines(sid, start=f"0{(i % 8) + 1}:00:00", end=f"0{(i % 8) + 1}:05:00")
        )
    path = activity_dir / f"activity-{date_str}.jsonl"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def _write_session_log(source_root, date_str="2026-03-02", tod="morning"):
    log_dir = source_root / ".claude" / "session-logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    path = log_dir / f"{date_str}-{tod}.log"
    path.write_text(
        f"=== Session started: {date_str} 09:00:00 ===\nsome session output\n",
        encoding="utf-8",
    )
    return path


def _write_writing(source_root, slug="the-first-piece", date_str="2026-03-03", body=None):
    writing_dir = source_root / "writing"
    writing_dir.mkdir(parents=True, exist_ok=True)
    title = slug.replace("-", " ").title()
    path = writing_dir / f"{slug}.md"
    path.write_text(
        f"# {title}\n\n*Written: {date_str}*\n\n"
        + (body if body is not None else "A body with emoji \N{ROBOT FACE}.\n"),
        encoding="utf-8",
    )
    return path


def _write_messages(source_root, from_content=None, to_content=None):
    source_root.mkdir(parents=True, exist_ok=True)
    (source_root / "messages_from_james.md").write_text(
        "# Messages from James\n\n## 2026-03-04 — checking in\n\n"
        + (from_content if from_content is not None else "Hello from James. \N{ROBOT FACE}\n"),
        encoding="utf-8",
    )
    (source_root / "messages_to_james.md").write_text(
        "# Messages to James\n\n## 2026-03-04 — reply\n\n"
        + (to_content if to_content is not None else "All quiet in the home directory.\n"),
        encoding="utf-8",
    )


def _write_prediction(source_root, date_str="2026-03-05"):
    pred_dir = source_root / "notes" / "predictions"
    pred_dir.mkdir(parents=True, exist_ok=True)
    path = pred_dir / f"{date_str}.md"
    path.write_text(
        "# Predictions\n\n## 1. Build passes\n\n"
        "**Prediction:** The build will pass on the first try (70%)\n",
        encoding="utf-8",
    )
    return path


def _write_daily_note(source_root, date_str="2026-03-06"):
    notes_dir = source_root / "notes" / "daily"
    notes_dir.mkdir(parents=True, exist_ok=True)
    path = notes_dir / f"{date_str}.md"
    path.write_text(
        "# Daily note\n\nfed Pixel this morning, usual tamagotchi routine\n",
        encoding="utf-8",
    )
    return path


def _build_full_tree(source_root):
    """Valid data in every source; returns expected per-table ingest deltas.

    Also plants a sentinel private/ dir — nothing may ever read it.
    """
    _write_activity_file(source_root, "2026-03-01", ["cli-sess-01"])
    _write_session_log(source_root, "2026-03-02", "morning")
    _write_writing(source_root)
    _write_messages(source_root)
    _write_prediction(source_root)
    _write_daily_note(source_root)
    private = source_root / "private"
    private.mkdir(parents=True, exist_ok=True)
    (private / "note.md").write_text("SENTINEL — never ingest\n", encoding="utf-8")
    return {
        "sessions": 2,  # 1 jsonl + 1 session log
        "compositions": 1,
        "messages": 2,
        "predictions": 1,
        "pet_events": 1,
        "memory_snapshots": 0,
    }


# ===========================================================================
# CLI invocation helpers
# ===========================================================================


def _argv(root, out, *extra):
    return ["--source-root", str(root), "--output-dir", str(out), *extra]


def _run_cli(db_conn, capsys, argv):
    """Invoke main with the injected test connection; return (rc, stdout)."""
    rc = main(argv, conn=db_conn)
    captured = capsys.readouterr()
    assert isinstance(rc, int) and not isinstance(rc, bool), (
        f"main must return an int exit code, got {rc!r}"
    )
    return rc, captured.out


def _patch_both(monkeypatch, func_name, source_module, replacement):
    """Patch a name under BOTH possible import styles (stage-1 convention)."""
    patched = False
    if hasattr(ingest_module, func_name):
        monkeypatch.setattr(ingest_module, func_name, replacement)
        patched = True
    if hasattr(source_module, func_name):
        monkeypatch.setattr(source_module, func_name, replacement)
        patched = True
    assert patched, f"could not find {func_name} to patch anywhere"


_ORCHESTRATOR_SITES = {
    "sessions": ("extract_all", extract_sessions_module),
    "writing": ("extract_all_writing", extract_writing_module),
    "messages": ("extract_all_messages", extract_messages_module),
    "predictions": ("extract_all_predictions", extract_predictions_module),
    "pets": ("extract_all_pets", extract_pets_module),
    "memory": ("extract_memory_from_jsonl", extract_memory_module),
}


def _explode(name):
    def _boom(*args, **kwargs):
        raise AssertionError(f"{name} must not be called on this code path")

    return _boom


# ===========================================================================
# 1. _parse_args — flag surface, types, argparse failures
# ===========================================================================


class TestParseArgs:
    def test_returns_namespace_with_pinned_defaults(self):
        args = _parse_args([])
        assert isinstance(args, argparse.Namespace)
        assert args.dry_run is False
        assert args.skip_export is False
        assert args.skip_ingest is False
        assert args.with_transcripts is False
        assert args.transcripts_dir is None
        assert args.force is False
        assert args.max_date is None
        assert pathlib.Path(args.source_root) == pathlib.Path("/home/claude")
        assert pathlib.Path(args.output_dir) == pathlib.Path("src/data")

    def test_all_boolean_flags_set(self):
        args = _parse_args(["--dry-run", "--skip-export", "--skip-ingest", "--force"])
        assert args.dry_run is True
        assert args.skip_export is True
        assert args.skip_ingest is True
        assert args.force is True

    def test_source_root_and_output_dir_overrides(self, tmp_path):
        args = _parse_args(
            ["--source-root", str(tmp_path / "róót dir"), "--output-dir", str(tmp_path / "out")]
        )
        assert pathlib.Path(args.source_root) == tmp_path / "róót dir"
        assert pathlib.Path(args.output_dir) == tmp_path / "out"

    def test_max_date_parses_to_datetime_date_at_argparse_time(self):
        args = _parse_args(["--max-date", "2026-03-10"])
        assert type(args.max_date) is datetime.date, (
            f"--max-date must be a datetime.date after parsing, got "
            f"{type(args.max_date).__name__}: {args.max_date!r}"
        )
        assert args.max_date == datetime.date(2026, 3, 10)

    @pytest.mark.parametrize("garbage", ["2026-13-45", "notadate", "2026-02-30", ""])
    def test_max_date_garbage_is_argparse_error_exit_2(self, garbage, capsys):
        with pytest.raises(SystemExit) as exc:
            _parse_args(["--max-date", garbage])
        assert exc.value.code == 2, f"argparse errors must exit 2, got {exc.value.code!r}"
        err = capsys.readouterr().err
        assert "max-date" in err, f"stderr does not mention the offending option:\n{err}"

    def test_unknown_flag_exits_2(self):
        with pytest.raises(SystemExit) as exc:
            _parse_args(["--nonsense"])
        assert exc.value.code == 2

    def test_with_transcripts_and_transcripts_dir_mutually_exclusive(self, tmp_path, capsys):
        with pytest.raises(SystemExit) as exc:
            _parse_args(["--with-transcripts", "--transcripts-dir", str(tmp_path)])
        assert exc.value.code == 2
        assert capsys.readouterr().err, "argparse mutual-exclusion error must go to stderr"

    def test_each_transcripts_flag_alone_is_accepted(self, tmp_path):
        a1 = _parse_args(["--with-transcripts"])
        assert a1.with_transcripts is True
        assert a1.transcripts_dir is None

        a2 = _parse_args(["--transcripts-dir", str(tmp_path / "tx")])
        assert pathlib.Path(a2.transcripts_dir) == tmp_path / "tx"
        assert a2.with_transcripts is False

    def test_argparse_error_propagates_through_main_with_db_untouched(
        self, db_conn, tmp_path, capsys
    ):
        before = _sql_counts(db_conn)
        with pytest.raises(SystemExit) as exc:
            main(
                ["--with-transcripts", "--transcripts-dir", str(tmp_path)],
                conn=db_conn,
            )
        assert exc.value.code == 2
        assert _sql_counts(db_conn) == before
        capsys.readouterr()


# ===========================================================================
# 2. Static contract — package.json and the __main__ guard
# ===========================================================================


class TestStaticContract:
    def test_package_json_extract_script_pins_ingest_cli(self):
        pkg = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))
        assert pkg["scripts"]["extract"] == "python scripts/ingest.py", (
            f"package.json 'extract' must be exactly 'python scripts/ingest.py', "
            f"got {pkg['scripts'].get('extract')!r}"
        )

    def test_main_guard_present_in_ingest_source(self):
        src = (REPO_ROOT / "scripts" / "ingest.py").read_text(encoding="utf-8")
        assert re.search(r'(?m)^if __name__ == ["\']__main__["\']\s*:', src), (
            "scripts/ingest.py has no __main__ guard"
        )
        assert "SystemExit(main(" in src, (
            "the __main__ guard must exit with main()'s return code via SystemExit"
        )


# ===========================================================================
# 3. format_report — pure formatting unit tests
# ===========================================================================


def _ingest_report(deltas=None, errors=None, skipped=None):
    return IngestReport(
        deltas=deltas if deltas is not None else {t: 0 for t in TABLES},
        errors=errors or {},
        skipped=skipped or {},
    )


class TestFormatReport:
    def test_full_real_run_report(self):
        ingest = _ingest_report(
            deltas={
                "sessions": 2,
                "compositions": 1,
                "messages": 0,
                "predictions": 0,
                "pet_events": 0,
                "memory_snapshots": 0,
            },
            skipped={"memory": "transcripts_dir not configured"},
        )
        export = ExportReport(
            written={
                "sessions.json": (3, 5),
                "messages.json": (None, 0),
            },
            quotes_verified=True,
        )
        text = format_report(ingest, {"messages": 1}, export, dry_run=False)

        assert isinstance(text, str)
        for marker in MARKERS:
            assert marker in text, f"missing section marker {marker!r}"
        # Ingest per-table line: name + signed delta (resolution 5).
        _assert_line(_section(text, M1), "sessions", "+2")
        _assert_line(_section(text, M1), "compositions", "+1")
        # Memory skip surfaces as SKIPPED on the memory line.
        _assert_line(text, "memory", "SKIPPED")
        # Export line: before -> after plus delta.
        _assert_line(_section(text, M2), "sessions.json", "3 -> 5", "+2")
        # quotes.json verified → untouched.
        _assert_line(text, "quotes.json", "untouched")
        # Real-run quarantine: table + count, and no dry-run wording.
        q = _section(text, MQ)
        _assert_line(q, "messages", "1")
        assert "would" not in q.lower(), "real-run quarantine section uses dry-run 'would' wording"

    def test_blocked_file_renders_blocked_line(self):
        export = ExportReport(
            written={"sessions.json": (1, 1)},
            blocked={"memory-snapshots.json": (5, 0)},
            quotes_verified=True,
        )
        text = format_report(_ingest_report(), {}, export, dry_run=False)
        line = _assert_line(text, "memory-snapshots.json", "BLOCKED")
        assert "untouched" not in line

    def test_quotes_unverified_never_claims_untouched(self):
        export = ExportReport(
            written={name: (0, 0) for name in FILES},
            errors={"quotes": "hash mismatch abc -> def"},
            quotes_verified=False,
        )
        text = format_report(_ingest_report(), {}, export, dry_run=False)
        _assert_no_line(text, "quotes.json", "untouched")
        assert "hash mismatch" in text, "the quotes error was swallowed by the report"

    def test_dry_run_quarantine_uses_would_wording(self):
        outliers = [
            {
                "source_table": "messages",
                "reason": "date 3036-01-01 outside valid range 2026-01-15..2026-07-06",
                "pk": 7,
                "value": datetime.date(3036, 1, 1),
            }
        ]
        text = format_report(
            _ingest_report(deltas={**{t: 0 for t in TABLES}, "sessions": 2}),
            outliers,
            ExportReport(quotes_verified=True),
            dry_run=True,
        )
        q = _section(text, MQ)
        assert "would" in q.lower(), f"dry-run quarantine section lacks 'would':\n{q}"
        assert "messages" in q
        # Dry-run ingest deltas render the same "+N" way.
        _assert_line(_section(text, M1), "sessions", "+2")

    def test_all_stages_skipped_sections_present_and_say_skipped(self):
        text = format_report(None, None, None, dry_run=False)
        assert isinstance(text, str)
        for marker in MARKERS:
            section = _section(text, marker)
            assert "skipped" in section.lower(), (
                f"skipped stage section for {marker!r} does not say skipped:\n{section}"
            )

    def test_ingest_errors_surface_with_name_and_message(self):
        ingest = _ingest_report(errors={"writing": "kaboom-xyz (injected)"})
        text = format_report(ingest, {}, ExportReport(quotes_verified=True), dry_run=False)
        assert "writing" in text
        assert "kaboom-xyz" in text, "extractor error message hidden from the report"

    def test_unicode_hostile_inputs_do_not_crash(self):
        outliers = [
            {
                "source_table": "messages",
                "reason": "date ٣٠٣٦ خارج النطاق — 🧨 \N{ZERO WIDTH JOINER}x " + "y" * 500,
                "pk": 1,
                "value": datetime.date(3036, 1, 1),
            }
        ]
        ingest = _ingest_report(errors={"writing": "שגיאה 🤖 מרה"})
        text = format_report(ingest, outliers, ExportReport(), dry_run=True)
        assert isinstance(text, str)
        assert "🧨" in text
        assert "🤖" in text

    def test_degenerate_empty_reports_do_not_crash(self):
        text = format_report(IngestReport(), {}, ExportReport(), dry_run=False)
        assert isinstance(text, str)
        for marker in MARKERS:
            assert marker in text
        _assert_no_line(text, "quotes.json", "untouched")


# ===========================================================================
# 4. DRY RUN — immutability flagship and friends
# ===========================================================================


class TestDryRun:
    def test_flagship_dry_run_changes_nothing_and_reports_exact_plus2(
        self, db_conn, tmp_path, capsys, monkeypatch
    ):
        # Sandbox the default temp dir so "tmp deleted" is observable.
        temp_sandbox = tmp_path / "temp-sandbox"
        temp_sandbox.mkdir()
        monkeypatch.setattr(tempfile, "tempdir", str(temp_sandbox))

        root = tmp_path / "fakehome"
        # 3 parsed sessions, 1 already in the DB → EXACT delta +2.
        _write_activity_file(root, "2026-03-01", ["dup-sess", "new-a", "new-b"])
        _write_writing(root)  # 1 new composition slug
        _seed_session(db_conn, "dup-sess", datetime.date(2026, 3, 1))

        out = tmp_path / "out"
        out.mkdir()
        (out / "quotes.json").write_bytes(QUOTES_SENTINEL)
        # Pre-created files must NOT create an accidental shrink-guard
        # would-block (the dry run mirrors the real run's exit code): the
        # memory tables are empty in the seeded DB and root has no memory
        # sources, so the file on disk carries the matching empty payload.
        # sessions.json holds the 1 already-ingested session (a real run
        # GROWS it to 3), so it diffs in Stage 2 without tripping the guard.
        _dump_json(out / "sessions.json", [{"id": "dup-sess"}])
        _dump_json(out / "memory-snapshots.json", EMPTY_PAYLOADS["memory-snapshots.json"])
        hashes_before = _hash_dir(out)
        counts_before = _sql_counts(db_conn)

        rc, stdout = _run_cli(db_conn, capsys, _argv(root, out, "--dry-run"))

        assert rc == 0
        # Byte-for-byte NOTHING changed: DB, disk, quarantine.
        assert _sql_counts(db_conn) == counts_before, "dry run mutated the database"
        assert _hash_dir(out) == hashes_before, (
            "dry run changed output_dir contents (bytes, additions, or deletions)"
        )
        assert (out / "quotes.json").read_bytes() == QUOTES_SENTINEL
        # Exact session delta, computed from parsed ids minus existing ids.
        _assert_line(_section(stdout, M1), "sessions", "+2")
        # Stage-2 diff ran against the real files.
        assert "sessions.json" in _section(stdout, M2)
        # Temp staging was cleaned up.
        assert list(temp_sandbox.iterdir()) == [], (
            f"dry run left temp litter: {[p.name for p in temp_sandbox.iterdir()]}"
        )
        # The connection survives main.
        assert db_conn.execute("SELECT 1").fetchone() == (1,)

    def test_dry_run_never_calls_db_writers_or_quarantine_sweep(
        self, db_conn, tmp_path, capsys, monkeypatch
    ):
        # Resolution 8: sabotage every DB-writing orchestrator + the sweep.
        for func_name, module in _ORCHESTRATOR_SITES.values():
            _patch_both(monkeypatch, func_name, module, _explode(func_name))
        _patch_both(
            monkeypatch,
            "quarantine_outliers",
            validate_dates_module,
            _explode("quarantine_outliers"),
        )

        root = tmp_path / "fakehome"
        _build_full_tree(root)  # real parseable sources for the parse functions
        out = tmp_path / "out"
        counts_before = _sql_counts(db_conn)

        rc, stdout = _run_cli(db_conn, capsys, _argv(root, out, "--dry-run"))

        assert rc == 0, (
            "dry run failed — it must use pure parse functions and "
            "find_outliers only, never the DB-writing orchestrators"
        )
        assert _sql_counts(db_conn) == counts_before
        for marker in MARKERS:
            assert marker in stdout

    def test_dry_run_reports_would_quarantine_and_keeps_row(self, db_conn, tmp_path, capsys):
        _seed_message(db_conn, datetime.date(3036, 1, 1), "message from the far future")
        root = tmp_path / "barren"
        root.mkdir()
        out = tmp_path / "out"

        rc, stdout = _run_cli(db_conn, capsys, _argv(root, out, "--dry-run"))

        assert rc == 0
        q = _section(stdout, MQ)
        assert "would" in q.lower(), f"dry-run quarantine section lacks 'would':\n{q}"
        assert "messages" in q, f"the outlier's table is not reported:\n{q}"
        row = db_conn.execute(
            "SELECT COUNT(*) FROM messages WHERE date = %s", (datetime.date(3036, 1, 1),)
        ).fetchone()[0]
        assert row == 1, "dry run REMOVED the outlier row — that is a real quarantine"
        assert _sql_counts(db_conn)["quarantine"] == 0

    @not_root
    def test_dry_run_unreadable_source_root_skips_per_source(self, db_conn, tmp_path, capsys):
        root = tmp_path / "locked-home"
        _build_full_tree(root)
        out = tmp_path / "out"
        counts_before = _sql_counts(db_conn)
        os.chmod(root, 0o000)
        try:
            rc, stdout = _run_cli(db_conn, capsys, _argv(root, out, "--dry-run"))
        finally:
            os.chmod(root, 0o755)

        assert rc == 0, "an unreadable source root must not crash a dry run"
        skip_lines = [ln for ln in _section(stdout, M1).splitlines() if "SKIP" in ln]
        assert len(skip_lines) >= 3, (
            f"expected per-source SKIP lines for the unreadable sources, got:\n{stdout}"
        )
        assert _sql_counts(db_conn) == counts_before


# ===========================================================================
# 5. Full run — happy path, quarantine wiring, transcripts pass-through
# ===========================================================================


class TestFullRun:
    def test_happy_path_populates_db_exports_and_reports(self, db_conn, tmp_path, capsys):
        root = tmp_path / "fakehome"
        expected = _build_full_tree(root)
        out = tmp_path / "out"

        rc, stdout = _run_cli(db_conn, capsys, _argv(root, out))

        assert rc == 0
        counts = _sql_counts(db_conn)
        for table in TABLES:
            assert counts[table] == expected[table], (
                f"{table}: expected {expected[table]} rows, got {counts[table]}"
            )
        assert counts["quarantine"] == 0
        # Exactly the six export files; no quotes.json conjured.
        assert {p.name for p in out.iterdir()} == set(FILES)
        assert not (out / "quotes.json").exists()
        assert len(_read_json(out / "sessions.json")) == 2
        # Report: markers, "+" deltas, quarantine line, quotes untouched.
        for marker in MARKERS:
            assert marker in stdout
        _assert_line(_section(stdout, M1), "sessions", "+2")
        _assert_line(_section(stdout, M1), "compositions", "+1")
        _assert_line(stdout, "quotes.json", "untouched")
        # Private sentinel never leaked anywhere.
        assert "SENTINEL" not in stdout
        for name in FILES:
            assert "SENTINEL" not in (out / name).read_text(encoding="utf-8"), name

    def test_preexisting_outlier_rows_are_quarantined_and_reported(self, db_conn, tmp_path, capsys):
        # One row beyond any sane date, one BEFORE EXPERIMENT_START — the
        # sweep's lower bound is pinned too.
        _seed_message(db_conn, datetime.date(3036, 1, 1), "far future")
        _seed_message(db_conn, datetime.date(2026, 1, 1), "before the experiment began")
        _seed_message(db_conn, datetime.date(2026, 3, 4), "valid keeper")
        root = tmp_path / "barren"
        root.mkdir()
        out = tmp_path / "out"

        rc, stdout = _run_cli(db_conn, capsys, _argv(root, out))

        assert rc == 0
        dates = {r[0] for r in db_conn.execute("SELECT date FROM messages").fetchall()}
        assert dates == {datetime.date(2026, 3, 4)}, (
            f"outlier rows survived the sweep (or the keeper was lost): {dates}"
        )
        assert _sql_counts(db_conn)["quarantine"] == 2
        q = _section(stdout, MQ)
        assert "messages" in q, f"quarantined table not reported:\n{q}"
        assert "would" not in q.lower(), "real run used dry-run 'would' wording"

    def test_memory_skipped_by_default_but_runs_with_transcripts_dir(
        self, db_conn, tmp_path, capsys
    ):
        root = tmp_path / "fakehome"
        _write_activity_file(root, "2026-03-01", ["tx-sess-01"])
        out1 = tmp_path / "out1"

        rc1, stdout1 = _run_cli(db_conn, capsys, _argv(root, out1))
        assert rc1 == 0
        _assert_line(stdout1, "memory", "SKIPPED")

        # Readable empty transcripts dir → memory step RUNS (zero yield ≠ skip).
        transcripts = tmp_path / "empty-transcripts"
        transcripts.mkdir()
        out2 = tmp_path / "out2"
        rc2, stdout2 = _run_cli(
            db_conn, capsys, _argv(root, out2, "--transcripts-dir", str(transcripts))
        )
        assert rc2 == 0
        _assert_no_line(stdout2, "memory", "SKIPPED")


# ===========================================================================
# 6. Exit codes — 1 for operational failures, never a raise
# ===========================================================================


class TestExitCodes:
    def test_failing_extractor_exits_1_but_others_still_ran(
        self, db_conn, tmp_path, capsys, monkeypatch
    ):
        def exploding_writing(*args, **kwargs):
            raise RuntimeError("writing exploded (cli-injected)")

        _patch_both(monkeypatch, "extract_all_writing", extract_writing_module, exploding_writing)
        root = tmp_path / "fakehome"
        expected = _build_full_tree(root)
        out = tmp_path / "out"

        rc, stdout = _run_cli(db_conn, capsys, _argv(root, out))

        assert rc == 1, "an ingest error must yield exit code 1"
        counts = _sql_counts(db_conn)
        assert counts["sessions"] == expected["sessions"], "earlier extractor did not run"
        assert counts["messages"] == expected["messages"], (
            "extractors after the failure did not run"
        )
        assert counts["compositions"] == 0
        assert "exploded" in stdout, "the extractor failure is invisible in the report"

    def test_blocked_export_exits_1_and_file_untouched(self, db_conn, tmp_path, capsys):
        root = tmp_path / "fakehome"
        _write_activity_file(root, "2026-03-01", ["blk-sess-01"])
        out = tmp_path / "out"
        _dump_json(out / "memory-snapshots.json", _memory_payload(2, 1))  # count 3
        pre_bytes = (out / "memory-snapshots.json").read_bytes()

        rc, stdout = _run_cli(db_conn, capsys, _argv(root, out))

        assert rc == 1, "a shrink-blocked export must yield exit code 1"
        assert (out / "memory-snapshots.json").read_bytes() == pre_bytes, (
            "the shrink guard claimed to block a file it overwrote"
        )
        _assert_line(stdout, "memory-snapshots.json", "BLOCKED")
        # The rest of the export still landed.
        assert (out / "sessions.json").exists()
        assert len(_read_json(out / "sessions.json")) == 1

    def test_force_overrides_shrink_guard_and_exits_0(self, db_conn, tmp_path, capsys):
        root = tmp_path / "fakehome"
        _write_activity_file(root, "2026-03-01", ["frc-sess-01"])
        out = tmp_path / "out"
        _dump_json(out / "memory-snapshots.json", _memory_payload(2, 1))

        rc, stdout = _run_cli(db_conn, capsys, _argv(root, out, "--force"))

        assert rc == 0
        assert _read_json(out / "memory-snapshots.json") == {"snapshots": [], "blocks": []}, (
            "--force did not overwrite the shrink-guarded file"
        )
        _assert_no_line(stdout, "memory-snapshots.json", "BLOCKED")

    def test_quarantine_sweep_raising_is_captured_as_exit_1(
        self, db_conn, tmp_path, capsys, monkeypatch
    ):
        def exploding_sweep(*args, **kwargs):
            raise RuntimeError("sweep exploded (cli-injected)")

        _patch_both(monkeypatch, "quarantine_outliers", validate_dates_module, exploding_sweep)
        root = tmp_path / "fakehome"
        _write_activity_file(root, "2026-03-01", ["swp-sess-01"])
        out = tmp_path / "out"

        rc, stdout = _run_cli(db_conn, capsys, _argv(root, out))  # must NOT raise

        assert rc == 1, "a raising quarantine sweep must be captured as exit code 1"
        assert _sql_counts(db_conn)["sessions"] == 1, "ingest work was lost to the sweep failure"


# ===========================================================================
# 7. --skip-export / --skip-ingest
# ===========================================================================


class TestSkipFlags:
    def test_skip_export_ingests_but_leaves_output_dir_alone(self, db_conn, tmp_path, capsys):
        root = tmp_path / "fakehome"
        expected = _build_full_tree(root)
        out = tmp_path / "out"
        out.mkdir()
        (out / "quotes.json").write_bytes(QUOTES_SENTINEL)
        (out / "stale.json").write_text("[1, 2, 3]", encoding="utf-8")
        hashes_before = _hash_dir(out)

        rc, stdout = _run_cli(db_conn, capsys, _argv(root, out, "--skip-export"))

        assert rc == 0
        assert _sql_counts(db_conn)["sessions"] == expected["sessions"], "ingest did not run"
        assert _hash_dir(out) == hashes_before, "--skip-export still wrote to output_dir"
        assert "skipped" in _section(stdout, M2).lower(), (
            "the export section does not say it was skipped"
        )

    def test_skip_ingest_exports_but_leaves_db_and_outliers_alone(self, db_conn, tmp_path, capsys):
        # Sources exist but must never be ingested; a pre-seeded outlier must
        # survive because the sweep is tied to --skip-ingest.
        root = tmp_path / "fakehome"
        _build_full_tree(root)
        _seed_message(db_conn, datetime.date(3036, 1, 1), "outlier that must survive")
        counts_before = _sql_counts(db_conn)
        out = tmp_path / "out"

        rc, stdout = _run_cli(db_conn, capsys, _argv(root, out, "--skip-ingest"))

        assert rc == 0
        assert _sql_counts(db_conn) == counts_before, (
            "--skip-ingest changed the database (ingest or sweep ran)"
        )
        assert {p.name for p in out.iterdir()} == set(FILES), "export did not run"
        # The surviving outlier is exported as-is.
        assert len(_read_json(out / "messages.json")) == 1
        assert "skipped" in _section(stdout, M1).lower()
        assert "skipped" in _section(stdout, MQ).lower(), (
            "the quarantine sweep must be skipped together with --skip-ingest"
        )

    def test_both_skips_produce_only_a_report(self, db_conn, tmp_path, capsys):
        root = tmp_path / "fakehome"
        _build_full_tree(root)
        _seed_message(db_conn, datetime.date(3036, 1, 1), "outlier that must survive")
        counts_before = _sql_counts(db_conn)
        out = tmp_path / "out"  # never created

        rc, stdout = _run_cli(db_conn, capsys, _argv(root, out, "--skip-ingest", "--skip-export"))

        assert rc == 0
        assert _sql_counts(db_conn) == counts_before
        assert not out.exists(), "a fully-skipped run still touched output_dir"
        for marker in MARKERS:
            assert marker in stdout
        assert "skipped" in stdout.lower()


# ===========================================================================
# 8. --max-date sweep bounds
# ===========================================================================


class TestMaxDate:
    def test_beyond_max_date_quarantined_boundary_kept(self, db_conn, tmp_path, capsys):
        root = tmp_path / "fakehome"
        _write_activity_file(root, "2026-03-10", ["boundary-sess"])  # == max-date: kept
        _write_activity_file(root, "2026-03-11", ["beyond-sess"])  # max-date+1: swept
        _seed_message(db_conn, datetime.date(2026, 3, 10), "boundary message")
        _seed_message(db_conn, datetime.date(2026, 3, 11), "beyond message")
        out = tmp_path / "out"

        # REVIEW PIN (resolution 22, fixture tightening): ingest first with
        # the sweep bounded far in the future (nothing quarantined), and pin
        # the dates the sessions ACTUALLY landed with before the boundary
        # sweep's effect is asserted — this test must not implicitly trust
        # parse_activity_log's filename-date derivation.
        rc0, _ = _run_cli(
            db_conn, capsys, _argv(root, out, "--skip-export", "--max-date", "2026-12-31")
        )
        assert rc0 == 0
        assert _sql_counts(db_conn)["quarantine"] == 0, (
            "the wide-bound ingest run must not quarantine anything"
        )
        ingested = dict(db_conn.execute("SELECT id, date FROM sessions").fetchall())
        assert ingested == {
            "boundary-sess": datetime.date(2026, 3, 10),
            "beyond-sess": datetime.date(2026, 3, 11),
        }, f"sessions did not land with their filename-derived dates: {ingested}"

        rc, stdout = _run_cli(db_conn, capsys, _argv(root, out, "--max-date", "2026-03-10"))

        assert rc == 0
        session_ids = {r[0] for r in db_conn.execute("SELECT id FROM sessions").fetchall()}
        assert "boundary-sess" in session_ids, "the boundary date itself must be KEPT (inclusive)"
        assert "beyond-sess" not in session_ids, "max_date+1 session survived the sweep"
        message_dates = {r[0] for r in db_conn.execute("SELECT date FROM messages").fetchall()}
        assert message_dates == {datetime.date(2026, 3, 10)}
        assert _sql_counts(db_conn)["quarantine"] == 2, (
            "expected exactly the beyond-max-date session and message in quarantine"
        )
        q = _section(stdout, MQ)
        assert "sessions" in q and "messages" in q, f"swept tables not reported:\n{q}"


# ===========================================================================
# 9. Connection ownership
# ===========================================================================


class _ConnProxy:
    """Delegating wrapper that intercepts close() without closing the real
    connection (the real one is the session-scoped test fixture)."""

    def __init__(self, real):
        self._real = real
        self.close_calls = 0

    def close(self):
        self.close_calls += 1

    # psycopg's context manager commits/rolls back then closes; mimic the
    # bookkeeping without touching the real connection's lifetime.
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type is None:
            self._real.commit()
        else:
            self._real.rollback()
        self.close_calls += 1
        return False

    def __getattr__(self, name):
        return getattr(self._real, name)


class TestConnectionOwnership:
    def test_injected_conn_is_not_closed_by_main(self, db_conn, tmp_path, capsys):
        root = tmp_path / "barren"
        root.mkdir()
        out = tmp_path / "out"

        rc, _ = _run_cli(db_conn, capsys, _argv(root, out))

        assert rc == 0
        assert not db_conn.closed, "main closed a connection it does not own"
        assert db_conn.execute("SELECT 1").fetchone() == (1,)

    def test_none_conn_opens_via_db_connect_and_closes_it(
        self, db_conn, tmp_path, capsys, monkeypatch
    ):
        calls = []
        proxy = _ConnProxy(db_conn)

        def fake_connect(*args, **kwargs):
            calls.append((args, kwargs))
            return proxy

        # Import-style agnostic patch (resolution 9): the module attribute
        # always exists on scripts.db; a from-import lands on scripts.ingest.
        monkeypatch.setattr(db_module, "connect", fake_connect)
        if hasattr(ingest_module, "connect"):
            monkeypatch.setattr(ingest_module, "connect", fake_connect)

        root = tmp_path / "barren"
        root.mkdir()
        out = tmp_path / "out"

        rc = main(_argv(root, out))  # conn deliberately omitted
        capsys.readouterr()

        assert rc == 0
        assert len(calls) == 1, (
            f"main must open exactly one connection via scripts.db.connect, opened {len(calls)}"
        )
        assert proxy.close_calls >= 1, "main never closed the connection it opened"
        # The underlying shared test connection must survive the proxy close.
        assert not db_conn.closed
        assert db_conn.execute("SELECT 1").fetchone() == (1,)

    def test_argv_none_reads_sys_argv(self, db_conn, tmp_path, capsys, monkeypatch):
        root = tmp_path / "barren"
        root.mkdir()
        out = tmp_path / "out"
        monkeypatch.setattr(sys, "argv", ["ingest.py", *_argv(root, out, "--skip-export")])

        rc = main(None, conn=db_conn)
        stdout = capsys.readouterr().out

        assert rc == 0
        assert not out.exists(), "--skip-export from sys.argv was ignored"
        for marker in MARKERS:
            assert marker in stdout


# ===========================================================================
# 10. Unicode end-to-end
# ===========================================================================


class TestUnicode:
    def test_emoji_and_rtl_sources_full_run_and_report_print(self, db_conn, tmp_path, capsys):
        root = tmp_path / "fakehome"
        _write_activity_file(root, "2026-03-01", ["uni-sess-01"])
        _write_writing(
            root,
            slug="on-mirrors",
            body="مرحبا بالعالم — שלום עולם 🌍 "
            "\N{WOMAN}\N{ZERO WIDTH JOINER}\N{PERSONAL COMPUTER} done.\n",
        )
        _write_messages(
            root,
            from_content="مرحبا 🤖 — an RTL greeting ‏and back again.\n",
            to_content="שלום James 🌱 all systems nominal.\n",
        )
        out = tmp_path / "out"

        rc, stdout = _run_cli(db_conn, capsys, _argv(root, out))

        assert rc == 0
        content = db_conn.execute(
            "SELECT content FROM messages WHERE direction = 'from_james'"
        ).fetchone()[0]
        assert "🤖" in content, "emoji mangled during ingest"
        exported = _read_json(out / "messages.json")
        assert any("🤖" in m["content"] for m in exported), "emoji mangled during export"
        # The report printed (capsys captured it) without UnicodeEncodeError.
        assert isinstance(stdout, str)
        for marker in MARKERS:
            assert marker in stdout


# ===========================================================================
# REVIEW PINS — dry-run defects found in code review (resolutions 17-21).
# These pin the FIXED behavior and are expected RED against the shipped
# implementation: the quarantine estimate runs under --dry-run
# --skip-ingest, the dry exit code ignores would-block and quotes states,
# and quotes_verified is hardcoded True on the dry export path.
# ===========================================================================


class TestReviewPinsDryRun:
    # -- Pin 1: --skip-ingest must skip the quarantine estimate too ---------

    def test_dry_run_skip_ingest_renders_quarantine_as_skipped(self, db_conn, tmp_path, capsys):
        # A seeded outlier the (skipped) estimate must never report on.
        _seed_message(db_conn, datetime.date(3036, 1, 1), "outlier a skipped sweep must not see")
        root = tmp_path / "fakehome"
        _build_full_tree(root)
        out = tmp_path / "out"
        out.mkdir()
        (out / "quotes.json").write_bytes(QUOTES_SENTINEL)
        hashes_before = _hash_dir(out)
        counts_before = _sql_counts(db_conn)

        rc, stdout = _run_cli(db_conn, capsys, _argv(root, out, "--dry-run", "--skip-ingest"))

        assert rc == 0
        q = _section(stdout, MQ)
        assert "skipped" in q.lower(), (
            f"--dry-run --skip-ingest must skip the quarantine estimate:\n{q}"
        )
        assert "would quarantine" not in q.lower(), (
            f"a skipped quarantine estimate still reported outliers:\n{q}"
        )
        assert "skipped" in _section(stdout, M1).lower()
        assert _sql_counts(db_conn) == counts_before, "the skipped dry run touched the database"
        assert _hash_dir(out) == hashes_before, "the skipped dry run touched output_dir"
        assert (out / "quotes.json").read_bytes() == QUOTES_SENTINEL

    def test_dry_run_skip_ingest_never_calls_find_outliers(
        self, db_conn, tmp_path, capsys, monkeypatch
    ):
        _seed_message(db_conn, datetime.date(3036, 1, 1), "bait for an eager estimate")
        _patch_both(monkeypatch, "find_outliers", validate_dates_module, _explode("find_outliers"))
        root = tmp_path / "fakehome"
        _build_full_tree(root)
        out = tmp_path / "out"
        counts_before = _sql_counts(db_conn)

        rc, stdout = _run_cli(db_conn, capsys, _argv(root, out, "--dry-run", "--skip-ingest"))

        assert rc == 0, (
            "find_outliers was invoked (and exploded) on the --dry-run "
            "--skip-ingest path — the sweep estimate is tied to the ingest stage"
        )
        assert "skipped" in _section(stdout, MQ).lower()
        assert _sql_counts(db_conn) == counts_before
        assert not out.exists(), "a dry run created output_dir"

    # -- Pin 2: dry-run exit-code parity with the real run (false-clean) ----

    def _would_block_setup(self, db_conn, tmp_path):
        """Pre-existing populated memory-snapshots.json + empty memory tables.

        A REAL run here shrink-blocks memory-snapshots.json and exits 1;
        a real --force run overwrites it and exits 0. The dry run must
        predict whichever exit code the corresponding real run would yield.
        """
        root = tmp_path / "fakehome"
        _write_activity_file(root, "2026-03-01", ["parity-sess-01"])
        out = tmp_path / "out"
        _dump_json(out / "memory-snapshots.json", _memory_payload(2, 1))  # 3 records
        (out / "quotes.json").write_bytes(QUOTES_SENTINEL)
        return root, out, _hash_dir(out), _sql_counts(db_conn)

    def test_dry_run_exits_1_when_the_real_run_would_block(self, db_conn, tmp_path, capsys):
        root, out, hashes_before, counts_before = self._would_block_setup(db_conn, tmp_path)

        rc, stdout = _run_cli(db_conn, capsys, _argv(root, out, "--dry-run"))

        assert rc == 1, (
            "a real run here exits 1 (shrink guard blocks memory-snapshots.json); "
            "a dry run reporting 0 is a false-clean"
        )
        m2 = _section(stdout, M2)
        assert "BLOCK" in m2, f"no would-block indication in the export section:\n{m2}"
        _assert_line(m2, "memory-snapshots.json", "BLOCK")
        # Exit 1 or not, a dry run writes NOTHING.
        assert _hash_dir(out) == hashes_before, "the dry run wrote to output_dir"
        assert (out / "quotes.json").read_bytes() == QUOTES_SENTINEL
        assert _sql_counts(db_conn) == counts_before

    def test_dry_run_force_parity_exits_0_and_still_writes_nothing(self, db_conn, tmp_path, capsys):
        root, out, hashes_before, counts_before = self._would_block_setup(db_conn, tmp_path)

        rc, stdout = _run_cli(db_conn, capsys, _argv(root, out, "--dry-run", "--force"))

        assert rc == 0, "a real --force run here exits 0; the dry run must agree"
        m2 = _section(stdout, M2)
        assert "BLOCK" not in m2, f"--force dry run still reports a block:\n{m2}"
        file_lines = [ln for ln in m2.splitlines() if "memory-snapshots.json" in ln]
        assert file_lines, f"memory-snapshots.json missing from the export section:\n{m2}"
        assert any(re.search(r"(?i)overwrit|force", ln) for ln in file_lines), (
            "the shrink-guarded file's line(s) give no visible would-be-"
            f"overwritten/override indication (resolution 19): {file_lines!r}"
        )
        # --force NEVER licenses a dry run to write.
        assert _hash_dir(out) == hashes_before, "--dry-run --force wrote to output_dir"
        assert (out / "quotes.json").read_bytes() == QUOTES_SENTINEL
        assert _sql_counts(db_conn) == counts_before

    # -- Pin 3: a conjured quotes.json must fail the dry run too ------------

    def test_dry_run_surfaces_conjured_quotes_json_as_failure(
        self, db_conn, tmp_path, capsys, monkeypatch
    ):
        real_export_all = prebuild_export_module.export_all

        def conjuring_export_all(conn_arg, output_dir, *args, **kwargs):
            result = real_export_all(conn_arg, output_dir, *args, **kwargs)
            (pathlib.Path(output_dir) / "quotes.json").write_text(
                '[{"quote": "conjured — never curated"}]', encoding="utf-8"
            )
            return result

        _patch_both(monkeypatch, "export_all", prebuild_export_module, conjuring_export_all)

        root = tmp_path / "fakehome"
        _write_activity_file(root, "2026-03-01", ["qts-sess-01"])
        out = tmp_path / "out"
        out.mkdir()
        (out / "quotes.json").write_bytes(QUOTES_SENTINEL)
        hashes_before = _hash_dir(out)

        rc, stdout = _run_cli(db_conn, capsys, _argv(root, out, "--dry-run"))

        assert rc == 1, (
            "the export conjured a quotes.json — a real run aborts and exits 1; "
            "the dry run must not report clean"
        )
        # No untouched/verified claim about quotes may survive (resolution 20).
        _assert_no_line(stdout, "quotes.json", "untouched")
        _assert_line(stdout, "ERROR", "quotes")
        # The REAL quotes.json sentinel is byte-identical regardless.
        assert (out / "quotes.json").read_bytes() == QUOTES_SENTINEL
        assert _hash_dir(out) == hashes_before, "the dry run wrote to output_dir"

    # -- Pin 4: two-sided sabotage — the read path must be provably taken ---

    def test_dry_run_consults_find_outliers_exactly_once(
        self, db_conn, tmp_path, capsys, monkeypatch
    ):
        _seed_message(db_conn, datetime.date(3036, 1, 1), "outlier the dry run must SEE")
        real_find_outliers = validate_dates_module.find_outliers
        calls = []

        def spying_find_outliers(*args, **kwargs):
            calls.append((args, kwargs))
            return real_find_outliers(*args, **kwargs)

        _patch_both(monkeypatch, "find_outliers", validate_dates_module, spying_find_outliers)

        root = tmp_path / "fakehome"
        _build_full_tree(root)
        out = tmp_path / "out"

        rc, stdout = _run_cli(
            db_conn, capsys, _argv(root, out, "--dry-run", "--max-date", "2026-04-01")
        )

        assert rc == 0
        assert len(calls) == 1, (
            f"the default dry-run path must consult find_outliers exactly once, "
            f"got {len(calls)} calls — the read side must be provably taken, "
            f"not just the write side provably avoided"
        )
        call_values = list(calls[0][0]) + list(calls[0][1].values())
        assert datetime.date(2026, 4, 1) in call_values, (
            f"--max-date did not reach find_outliers on the dry path: {calls[0]!r}"
        )
        q = _section(stdout, MQ)
        assert "would" in q.lower(), f"dry-run quarantine section lacks 'would':\n{q}"
        assert "messages" in q, f"the seeded outlier's table is not reported:\n{q}"
        # And the spy's outlier stayed put — still an estimate, not a sweep.
        assert _sql_counts(db_conn)["quarantine"] == 0
