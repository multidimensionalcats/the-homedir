"""Hostile tests for scripts/ingest.py Stage-1 orchestration (NOT yet implemented — RED).

Covers:
  - IngestConfig dataclass: default source paths derived from source_root
    (default /home/claude), output_dir default src/data, transcripts_dir None.
  - assert_no_private_paths(cfg): realpath-based guard (symlinks, `..`
    traversal) raising before any read when a source path lands under
    <source_root>/private.
  - table_counts(conn): row counts for exactly the six ingest tables.
  - run_ingest(conn, cfg): FK-ordered orchestration (sessions → writing →
    messages → predictions → pets → memory-if-transcripts), per-extractor
    try/except + rollback, errors recorded and run CONTINUES, deltas computed
    from table_counts diffs (never extractor return values), memory skip
    recorded when transcripts_dir is None/unreadable, and NO quarantine or
    export side effects (those are later phases).

The module under test does not exist yet, so the import below fails at
collection time — that is the intended RED state.

Deviations / decisions (spec is loose on some names; documented per convention):
  - Defaults factory: the spec says "a classmethod or factory". Tests try
    `IngestConfig.from_source_root(root)` first and fall back to
    `IngestConfig(source_root=root)` (i.e. __post_init__ derivation). Either
    is accepted; the DERIVED PATHS are pinned exactly either way.
  - Report field names pinned to the plan doc (Phase 3 uses
    `IngestReport.deltas` and `report.errors["writing"]`): `deltas` is a
    mapping table → int, `errors` a mapping extractor-name → error info.
    The memory-skip record is pinned more loosely: an attribute named
    `skipped` or `skips` must be a mapping with a key containing "memory"
    and a non-empty string reason (the spec names no field for it).
  - Guard exception type is unspecified: any Exception is accepted, but its
    message must mention "private" (a bare KeyError/TypeError from broken
    code would still fail the message assertion).
  - Path fields may be str or Path: comparisons normalize via Path(...), so
    tests are strict on LOCATION, lenient on type.
  - table_counts is pinned to EXACTLY the six spec'd keys (set equality):
    the report deltas are defined in terms of it, so extra/missing keys
    would silently skew every delta assertion downstream.
  - Monkeypatching extractors patches BOTH `scripts.ingest.<name>` (if the
    implementation used `from ... import name`) and the source module
    attribute (if it used `import module` + attribute access), so the test
    does not depend on the implementation's import style.
  - Binary (invalid-UTF-8) garbage lives in a SEPARATE activity file:
    parse_activity_log reads whole files, so undecodable bytes poison only
    that one file by contract; the in-file malformed lines (truncated JSON,
    NUL bytes, non-dict JSON) are valid UTF-8.
  - chmod-0o000 tests are skipped when running as root (root ignores mode).
  - Test 12 also asserts output_dir is untouched — the natural observable
    for "run_ingest must NOT call export".
  - No positive memory-ingest test (transcripts_dir with real transcripts):
    that is Phase 4 (staging) territory per the plan; this phase only pins
    the skip behavior.
"""

import dataclasses
import datetime
import json
import os
import pathlib

import pytest

from psycopg.pq import TransactionStatus

import scripts.extract_memory as extract_memory_module
import scripts.extract_messages as extract_messages_module
import scripts.extract_pets as extract_pets_module
import scripts.extract_predictions as extract_predictions_module
import scripts.extract_sessions as extract_sessions_module
import scripts.extract_writing as extract_writing_module
from scripts.ingest import (  # noqa: F401  (RED: module absent)
    IngestConfig,
    assert_no_private_paths,
    run_ingest,
    table_counts,
)

NUL = chr(0)  # cannot be a literal in source

TABLES = (
    "sessions",
    "compositions",
    "messages",
    "predictions",
    "pet_events",
    "memory_snapshots",
)

not_root = pytest.mark.skipif(os.geteuid() == 0, reason="chmod 0o000 is not enforced for root")


# ===========================================================================
# Config / report access helpers
# ===========================================================================


def _make_cfg(source_root, **overrides):
    """Build an IngestConfig with defaults derived from source_root.

    Accepts either a `from_source_root` classmethod/factory or derivation in
    the constructor. Overrides are applied via dataclasses.replace so the
    dataclass requirement is exercised on every construction.
    """
    factory = getattr(IngestConfig, "from_source_root", None)
    if callable(factory):
        cfg = factory(pathlib.Path(source_root))
    else:
        cfg = IngestConfig(source_root=pathlib.Path(source_root))
    if overrides:
        cfg = dataclasses.replace(cfg, **overrides)
    return cfg


def _default_cfg():
    """A config built with NO arguments — the /home/claude defaults."""
    factory = getattr(IngestConfig, "from_source_root", None)
    if callable(factory):
        try:
            return factory()
        except TypeError:
            pass
    return IngestConfig()


def _cfg_for_run(source_root, tmp_path, **overrides):
    """Config for run_ingest tests: output_dir always redirected to tmp so a
    buggy implementation that exports cannot touch the real src/data."""
    out = tmp_path / "out-guard"
    return _make_cfg(source_root, output_dir=out, **overrides), out


def _deltas(report):
    deltas = getattr(report, "deltas", None)
    assert deltas is not None, f"IngestReport has no 'deltas': {report!r}"
    assert isinstance(deltas, dict), f"deltas must be a dict, got {type(deltas)}"
    return deltas


def _errors(report):
    errors = getattr(report, "errors", None)
    assert errors is not None, f"IngestReport has no 'errors': {report!r}"
    assert isinstance(errors, dict), f"errors must be a dict, got {type(errors)}"
    return errors


def _skips(report):
    for attr in ("skipped", "skips"):
        val = getattr(report, attr, None)
        if val is not None:
            return val
    pytest.fail(f"IngestReport records no skips (expected a 'skipped' mapping): {report!r}")


def _memory_skip_reason(report):
    skips = _skips(report)
    assert isinstance(skips, dict), f"skip record must be a mapping, got {type(skips)}"
    keys = [k for k in skips if "memory" in str(k).lower()]
    assert keys, f"no memory skip recorded: {skips!r}"
    reason = skips[keys[0]]
    assert isinstance(reason, str) and reason.strip(), (
        f"memory skip reason must be a non-empty string: {reason!r}"
    )
    return reason


def _sql_counts(conn):
    """Independent ground truth — never uses table_counts (which is under test)."""
    return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in TABLES}


def _patch_extractor(monkeypatch, func_name, source_module, replacement):
    """Patch an extractor under BOTH possible import styles."""
    import scripts.ingest as ingest_module

    patched = False
    if hasattr(ingest_module, func_name):
        monkeypatch.setattr(ingest_module, func_name, replacement)
        patched = True
    if hasattr(source_module, func_name):
        monkeypatch.setattr(source_module, func_name, replacement)
        patched = True
    assert patched, f"could not find {func_name} to patch anywhere"


# ===========================================================================
# Fixture-tree builders (formats verified against the real parsers)
# ===========================================================================


def _jsonl_line(**kwargs):
    return json.dumps(kwargs)


def _session_lines(session_id, start="09:00:00", end="09:05:00", tools=()):
    """JSONL lines for one complete activity-log session."""
    lines = [_jsonl_line(ts=start, event="session_start", s=session_id, cwd="/home/claude")]
    for tool in tools:
        lines.append(
            _jsonl_line(
                ts=tool.get("ts", "09:01:00"),
                event="tool",
                s=session_id,
                t=tool["t"],
                i=tool["i"],
            )
        )
    lines.append(_jsonl_line(ts=end, event="session_end", s=session_id))
    return lines


def _write_activity_file(source_root, date_str, session_ids, extra_lines=()):
    activity_dir = source_root / ".claude" / "activity-logs"
    activity_dir.mkdir(parents=True, exist_ok=True)
    lines = []
    for i, sid in enumerate(session_ids):
        lines.extend(
            _session_lines(
                sid,
                start=f"0{(i % 8) + 1}:00:00",
                end=f"0{(i % 8) + 1}:05:00",
                tools=[{"t": "Read", "i": f"/home/claude/notes/daily/{date_str}.md"}],
            )
        )
        lines.extend(extra_lines if i == 0 else ())
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


def _write_writing(source_root, slug="the-first-piece", date_str="2026-03-03"):
    writing_dir = source_root / "writing"
    writing_dir.mkdir(parents=True, exist_ok=True)
    path = writing_dir / f"{slug}.md"
    path.write_text(
        "# The First Piece\n\n"
        f"*Written: {date_str}*\n\n"
        "Body with emoji \N{ROBOT FACE} and ZWJ family "
        "\N{MAN}‍\N{WOMAN}‍\N{GIRL}.\n",
        encoding="utf-8",
    )
    return path


def _write_messages(source_root):
    source_root.mkdir(parents=True, exist_ok=True)
    (source_root / "messages_from_james.md").write_text(
        "# Messages from James\n\n"
        "## 2026-03-04 — checking in\n\n"
        "Hello from James. \N{ROBOT FACE}\n",
        encoding="utf-8",
    )
    (source_root / "messages_to_james.md").write_text(
        "# Messages to James\n\n## 2026-03-04 — reply\n\nAll quiet in the home directory.\n",
        encoding="utf-8",
    )


def _write_prediction(source_root, date_str="2026-03-05"):
    pred_dir = source_root / "notes" / "predictions"
    pred_dir.mkdir(parents=True, exist_ok=True)
    path = pred_dir / f"{date_str}.md"
    path.write_text(
        "# Predictions\n\n"
        "## 1. Build passes\n\n"
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
    """Valid data in every source; returns expected per-table deltas.

    Also plants a sentinel private/ dir — nothing in this phase may read it.
    """
    _write_activity_file(source_root, "2026-03-01", ["happy-sess-01"])
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
        "messages": 2,  # one per direction file
        "predictions": 1,
        "pet_events": 1,
        "memory_snapshots": 0,  # transcripts_dir defaults to None
    }


# ===========================================================================
# DB seeding helpers (for table_counts ground truth)
# ===========================================================================


def _seed_session(conn, session_id, date=datetime.date(2026, 3, 15)):
    conn.execute(
        "INSERT INTO sessions (id, date, time_of_day, version, source_type, source_file) "
        "VALUES (%s, %s, 'AM', '4.7', 'jsonl', 'seed.jsonl')",
        (session_id, date),
    )


# ===========================================================================
# 1. IngestConfig defaults
# ===========================================================================


class TestIngestConfigDefaults:
    def test_is_a_dataclass(self):
        assert dataclasses.is_dataclass(IngestConfig), "IngestConfig must be a @dataclass"

    def test_paths_derive_from_source_root(self, tmp_path):
        root = tmp_path / "fakehome"
        cfg = _make_cfg(root)
        expected = {
            "source_root": root,
            "activity_logs_dir": root / ".claude" / "activity-logs",
            "session_logs_dir": root / ".claude" / "session-logs",
            "writing_dir": root / "writing",
            "messages_dir": root,  # the source root itself
            "predictions_dir": root / "notes" / "predictions",
            "daily_notes_dir": root / "notes" / "daily",
        }
        for field, want in expected.items():
            got = getattr(cfg, field, None)
            assert got is not None, f"IngestConfig missing field {field!r}"
            assert pathlib.Path(got) == want, f"{field}: expected {want}, got {got!r}"
        assert pathlib.Path(cfg.output_dir) == pathlib.Path("src/data")
        assert cfg.transcripts_dir is None

    def test_no_arg_defaults_use_home_claude(self):
        cfg = _default_cfg()
        assert pathlib.Path(cfg.source_root) == pathlib.Path("/home/claude")
        assert pathlib.Path(cfg.activity_logs_dir) == pathlib.Path(
            "/home/claude/.claude/activity-logs"
        )
        assert pathlib.Path(cfg.messages_dir) == pathlib.Path("/home/claude")

    def test_default_paths_contain_no_private_component(self):
        """Static guarantee: no default source path has 'private' as a
        path component. Non-path fields (e.g. the with_transcripts bool
        added in Phase 4) are skipped — only str/PathLike values are
        path-checked."""
        cfg = _default_cfg()
        checked = 0
        for field in dataclasses.fields(cfg):
            value = getattr(cfg, field.name)
            if not isinstance(value, (str, os.PathLike)):
                continue
            checked += 1
            parts = pathlib.Path(value).parts
            assert "private" not in parts, (
                f"default {field.name} = {value!r} contains a 'private' component"
            )
        assert checked >= 7, (
            "path-field filter is too aggressive — the guard checked "
            f"only {checked} fields and may have gone vacuous"
        )

    def test_default_config_passes_private_guard(self, tmp_path):
        root = tmp_path / "fakehome"
        _build_full_tree(root)
        cfg = _make_cfg(root)
        assert assert_no_private_paths(cfg) is None


# ===========================================================================
# 2. Private-path guard
# ===========================================================================


class TestPrivatePathGuard:
    def _assert_guard_fires_and_nothing_ingested(self, db_conn, tmp_path, cfg):
        with pytest.raises(Exception) as exc:
            assert_no_private_paths(cfg)
        assert "private" in str(exc.value).lower(), (
            f"guard error does not mention 'private': {exc.value!r}"
        )
        with pytest.raises(Exception):
            run_ingest(db_conn, cfg)
        db_conn.rollback()
        counts = _sql_counts(db_conn)
        assert counts == {t: 0 for t in TABLES}, (
            f"run_ingest ingested rows despite a private source path: {counts}"
        )

    def test_messages_dir_directly_inside_private(self, db_conn, tmp_path):
        root = tmp_path / "fakehome"
        _build_full_tree(root)
        # Put real, parseable message files inside private: if the guard is
        # missing, ingest WILL find them and the zero-rows assertion bites.
        _write_messages(root / "private")
        cfg, _ = _cfg_for_run(root, tmp_path, messages_dir=root / "private")
        self._assert_guard_fires_and_nothing_ingested(db_conn, tmp_path, cfg)

    def test_dotdot_traversal_into_private(self, db_conn, tmp_path):
        root = tmp_path / "fakehome"
        _build_full_tree(root)
        _write_messages(root / "private")
        sneaky = root / "writing" / ".." / "private"
        assert ".." in sneaky.parts  # the unresolved path must LOOK innocent-ish
        cfg, _ = _cfg_for_run(root, tmp_path, messages_dir=sneaky)
        self._assert_guard_fires_and_nothing_ingested(db_conn, tmp_path, cfg)

    def test_symlink_into_private(self, db_conn, tmp_path):
        root = tmp_path / "fakehome"
        _build_full_tree(root)
        _write_messages(root / "private")
        link = root / "mail"
        link.symlink_to(root / "private", target_is_directory=True)
        assert "private" not in link.parts  # lexically clean — only realpath catches it
        cfg, _ = _cfg_for_run(root, tmp_path, messages_dir=link)
        self._assert_guard_fires_and_nothing_ingested(db_conn, tmp_path, cfg)

    def test_sibling_named_private_backup_is_not_flagged(self, tmp_path):
        """A naive startswith(str(private)) match would wrongly flag
        <root>/private_backup. Only paths UNDER <root>/private are private."""
        root = tmp_path / "fakehome"
        _build_full_tree(root)
        lookalike = root / "private_backup"
        _write_messages(lookalike)
        cfg = _make_cfg(root, messages_dir=lookalike)
        assert assert_no_private_paths(cfg) is None, (
            "guard wrongly flagged a sibling directory whose name merely starts with 'private'"
        )

    def test_private_dir_is_symlink_real_target_is_still_private(self, db_conn, tmp_path):
        """<root>/private is itself a SYMLINK to ../real_secret, and the
        source path points at real_secret DIRECTLY — never touching the
        symlink. real_secret IS the private journal's real location, so
        reaching it via its real path is still a disclosure and the guard
        MUST raise.

        This only holds if the guard resolves BOTH sides: a resolved source
        path (tmp/real_secret) compared against the UNRESOLVED private dir
        (tmp/fakehome/private) never matches, and the guard is dodged."""
        real_secret = tmp_path / "real_secret"
        _write_messages(real_secret)  # parseable bait at the REAL location
        root = tmp_path / "fakehome"
        root.mkdir()
        (root / "private").symlink_to(pathlib.Path("..") / "real_secret", target_is_directory=True)
        # The offending path is lexically spotless: no 'private' component,
        # no '..', no symlink hop. Only a resolve-both-sides compare bites.
        assert "private" not in real_secret.parts
        assert ".." not in real_secret.parts
        cfg, _ = _cfg_for_run(root, tmp_path, messages_dir=real_secret)
        self._assert_guard_fires_and_nothing_ingested(db_conn, tmp_path, cfg)

    def test_private_dir_is_symlink_path_through_it_flagged(self, db_conn, tmp_path):
        """Reverse direction of the same layout (regression pin): the source
        path goes THROUGH the private symlink (<root>/private/sub). Whether
        compared lexically or fully resolved, this must raise."""
        real_secret = tmp_path / "real_secret"
        _write_messages(real_secret / "sub")  # bait under the real target
        root = tmp_path / "fakehome"
        root.mkdir()
        (root / "private").symlink_to(pathlib.Path("..") / "real_secret", target_is_directory=True)
        cfg, _ = _cfg_for_run(root, tmp_path, messages_dir=root / "private" / "sub")
        self._assert_guard_fires_and_nothing_ingested(db_conn, tmp_path, cfg)

    def test_non_private_symlink_is_not_flagged(self, tmp_path):
        """Control: a symlink that has nothing to do with private must pass.
        <root>/notes -> ../elsewhere, source path through it. A guard that
        became symlink-phobic (flagging any symlinked source, or resolving
        into a 'not under source_root anymore → suspicious' rule) would
        wrongly raise here."""
        root = tmp_path / "fakehome"
        root.mkdir()
        private = root / "private"
        private.mkdir()
        (private / "note.md").write_text("SENTINEL — never ingest\n", encoding="utf-8")
        elsewhere = tmp_path / "elsewhere"
        _write_messages(elsewhere)
        (root / "notes").symlink_to(pathlib.Path("..") / "elsewhere", target_is_directory=True)
        cfg = _make_cfg(root, messages_dir=root / "notes")
        assert assert_no_private_paths(cfg) is None, (
            "guard wrongly flagged a benign symlinked source dir that resolves nowhere near private"
        )


# ===========================================================================
# 3. table_counts
# ===========================================================================


class TestTableCounts:
    def test_empty_db_all_zeros_exact_keys(self, db_conn):
        counts = table_counts(db_conn)
        assert counts == {t: 0 for t in TABLES}, (
            f"empty DB must yield exactly the six spec'd keys, all zero: {counts!r}"
        )
        assert all(type(v) is int for v in counts.values())

    def test_seeded_rows_counted_exactly(self, db_conn):
        _seed_session(db_conn, "tc-s1")
        _seed_session(db_conn, "tc-s2")
        db_conn.execute(
            "INSERT INTO compositions (slug, filename) VALUES ('tc-comp', 'tc-comp.md')"
        )
        for i in range(3):
            db_conn.execute(
                "INSERT INTO messages (direction, date, content) "
                "VALUES ('to_james', '2026-03-15', %s)",
                (f"msg {i}",),
            )
        db_conn.execute(
            "INSERT INTO predictions (text, date_made) VALUES ('tc-pred', '2026-03-15')"
        )
        for name in ("Pixel", "Echo"):
            db_conn.execute(
                "INSERT INTO pet_events (pet_name, event_type, event_timestamp) "
                "VALUES (%s, 'care', '2026-03-15T00:00:00+00:00')",
                (name,),
            )
        db_conn.execute(
            "INSERT INTO memory_snapshots (session_id, date, full_content) "
            "VALUES ('tc-s1', '2026-03-15', 'mem')"
        )
        db_conn.commit()

        assert table_counts(db_conn) == {
            "sessions": 2,
            "compositions": 1,
            "messages": 3,
            "predictions": 1,
            "pet_events": 2,
            "memory_snapshots": 1,
        }


# ===========================================================================
# 4. Happy path
# ===========================================================================


class TestHappyPath:
    def test_full_tree_populates_all_tables(self, db_conn, tmp_path):
        root = tmp_path / "fakehome"
        expected = _build_full_tree(root)
        cfg, _ = _cfg_for_run(root, tmp_path)

        before = _sql_counts(db_conn)
        report = run_ingest(db_conn, cfg)
        after = _sql_counts(db_conn)

        deltas = _deltas(report)
        for table in TABLES:
            actual_delta = after[table] - before[table]
            assert actual_delta == expected[table], (
                f"{table}: expected {expected[table]} new rows, got {actual_delta}"
            )
            assert deltas[table] == actual_delta, (
                f"{table}: report delta {deltas[table]} != independently "
                f"queried delta {actual_delta}"
            )
        assert _errors(report) == {}, f"clean run recorded errors: {report.errors!r}"

        # Content fidelity spot-checks (hostile unicode survives the pipeline).
        content = db_conn.execute(
            "SELECT content FROM messages WHERE direction = 'from_james'"
        ).fetchone()[0]
        assert "\N{ROBOT FACE}" in content, "emoji mangled in ingested message"
        slug, title = db_conn.execute("SELECT slug, title FROM compositions").fetchone()
        assert slug == "the-first-piece"
        assert title == "The First Piece"


# ===========================================================================
# 5. Idempotent re-run
# ===========================================================================


class TestIdempotentRerun:
    def test_second_run_all_deltas_zero(self, db_conn, tmp_path):
        root = tmp_path / "fakehome"
        _build_full_tree(root)
        cfg, _ = _cfg_for_run(root, tmp_path)

        run_ingest(db_conn, cfg)
        counts_after_first = _sql_counts(db_conn)

        report2 = run_ingest(db_conn, cfg)
        deltas2 = _deltas(report2)
        assert deltas2 == {t: 0 for t in TABLES}, (
            f"re-run on identical sources must be a no-op, got deltas {deltas2!r}"
        )
        assert _errors(report2) == {}
        assert _sql_counts(db_conn) == counts_after_first, (
            "re-run changed table contents despite zero reported deltas"
        )


# ===========================================================================
# 6. Duplicate session id across two activity files
# ===========================================================================


class TestDuplicateSessions:
    def test_same_session_id_in_two_files_one_row_one_delta(self, db_conn, tmp_path):
        """extract_all() returns PARSED session counts (2 here), but only one
        row is inserted (ON CONFLICT DO NOTHING). A delta computed from the
        extractor's return value instead of table_counts reports 2 — wrong."""
        root = tmp_path / "fakehome"
        _write_activity_file(root, "2026-03-01", ["dup-sess-01"])
        _write_activity_file(root, "2026-03-05", ["dup-sess-01"])
        cfg, _ = _cfg_for_run(root, tmp_path)

        report = run_ingest(db_conn, cfg)

        assert _sql_counts(db_conn)["sessions"] == 1
        assert _deltas(report)["sessions"] == 1, (
            "delta was taken from the extractor's return value, not from table_counts before/after"
        )
        assert _errors(report) == {}


# ===========================================================================
# 7. Malformed JSONL mid-file + undecodable sibling file
# ===========================================================================


class TestMalformedJsonl:
    def test_garbage_lines_do_not_kill_valid_sessions(self, db_conn, tmp_path):
        root = tmp_path / "fakehome"
        garbage = [
            '{"event": "tool", "s": "mal-a", "t": "Read", "i": "/trunc',  # truncated
            NUL + NUL + '{"event": "tool"}',  # NUL bytes
            "[1, 2, 3]",  # non-dict JSON
            '"just a string"',  # non-dict JSON
            '{"no_event_key": true}',  # dict, wrong shape
            "utter garbage §§§ not json at all",
        ]
        activity_dir = root / ".claude" / "activity-logs"
        activity_dir.mkdir(parents=True)
        lines = (
            _session_lines("mal-good-1", start="08:00:00", end="08:05:00")
            + garbage
            + _session_lines("mal-good-2", start="09:00:00", end="09:05:00")
        )
        (activity_dir / "activity-2026-03-01.jsonl").write_text(
            "\n".join(lines) + "\n", encoding="utf-8"
        )
        # Invalid UTF-8 in a SEPARATE file: whole-file decode failure must
        # poison only this file, never the run.
        (activity_dir / "activity-2026-03-02.jsonl").write_bytes(
            b"\xff\xfe\x00binary garbage\xff\xfe"
        )

        report = run_ingest(db_conn, _cfg_for_run(root, tmp_path)[0])

        ids = {r[0] for r in db_conn.execute("SELECT id FROM sessions").fetchall()}
        assert ids == {"mal-good-1", "mal-good-2"}, (
            f"valid sessions lost to malformed neighbors: {ids}"
        )
        assert _deltas(report)["sessions"] == 2
        assert _errors(report) == {}, (
            f"tolerated-garbage input must not be an error: {_errors(report)!r}"
        )


# ===========================================================================
# 8. Permission-denied source dir
# ===========================================================================


class TestPermissionDenied:
    @not_root
    def test_unreadable_activity_dir_does_not_abort_run(self, db_conn, tmp_path):
        root = tmp_path / "fakehome"
        _write_activity_file(root, "2026-03-01", ["perm-sess-01"])
        _write_writing(root)  # a LATER extractor that must still run
        activity_dir = root / ".claude" / "activity-logs"
        os.chmod(activity_dir, 0o000)
        try:
            cfg, _ = _cfg_for_run(root, tmp_path)
            report = run_ingest(db_conn, cfg)  # must NOT raise
        finally:
            os.chmod(activity_dir, 0o755)

        deltas = _deltas(report)
        assert deltas["sessions"] == 0, "sessions were ingested from a directory with mode 0o000?"
        assert deltas["compositions"] == 1, (
            "a later extractor did not run after the permission failure"
        )
        # Spec: "error or zero-delta recorded" — zero delta is asserted above;
        # if an error IS recorded it must sit under the sessions step.
        errors = _errors(report)
        assert set(errors) <= {"sessions"}, f"permission failure misattributed: {errors!r}"


# ===========================================================================
# 9. Missing source dirs
# ===========================================================================


class TestMissingSourceDirs:
    def test_empty_source_root_completes_with_zero_deltas(self, db_conn, tmp_path):
        root = tmp_path / "barren"
        root.mkdir()
        cfg, _ = _cfg_for_run(root, tmp_path)

        report = run_ingest(db_conn, cfg)

        assert _deltas(report) == {t: 0 for t in TABLES}
        assert _errors(report) == {}, (
            f"missing source dirs are a normal condition, not an error: {_errors(report)!r}"
        )
        assert _sql_counts(db_conn) == {t: 0 for t in TABLES}

    def test_source_root_itself_missing(self, db_conn, tmp_path):
        cfg, _ = _cfg_for_run(tmp_path / "never-created", tmp_path)
        report = run_ingest(db_conn, cfg)
        assert _deltas(report) == {t: 0 for t in TABLES}


# ===========================================================================
# 10. Partial failure mid-run
# ===========================================================================


class TestPartialFailureMidRun:
    def test_writing_failure_recorded_run_continues_rollback_called(
        self, db_conn, tmp_path, monkeypatch
    ):
        root = tmp_path / "fakehome"
        expected = _build_full_tree(root)
        cfg, _ = _cfg_for_run(root, tmp_path)

        def exploding_writing(*args, **kwargs):
            # Leave an UNCOMMITTED half-row behind, then die. Only an actual
            # conn.rollback() in run_ingest removes it — a later extractor's
            # commit would otherwise sweep it in.
            db_conn.execute(
                "INSERT INTO compositions (slug, filename) "
                "VALUES ('half-committed-probe', 'half.md')"
            )
            raise RuntimeError("writing extractor exploded (test-injected)")

        _patch_extractor(
            monkeypatch,
            "extract_all_writing",
            extract_writing_module,
            exploding_writing,
        )

        report = run_ingest(db_conn, cfg)  # must NOT raise

        deltas = _deltas(report)
        # Earlier step committed.
        assert deltas["sessions"] == expected["sessions"]
        # Failed step contributed nothing.
        assert deltas["compositions"] == 0
        # LATER steps still ran.
        assert deltas["messages"] == expected["messages"], (
            "messages extractor did not run after the writing failure"
        )
        assert deltas["predictions"] == expected["predictions"]
        assert deltas["pet_events"] == expected["pet_events"]

        errors = _errors(report)
        assert "writing" in errors, f"failure not recorded under the extractor's name: {errors!r}"
        assert "exploded" in str(errors["writing"]), (
            f"error record lost the underlying exception message: {errors['writing']!r}"
        )

        # rollback() was actually called: the half-row must be gone even
        # though later extractors committed on this same connection.
        half = db_conn.execute(
            "SELECT COUNT(*) FROM compositions WHERE slug = 'half-committed-probe'"
        ).fetchone()[0]
        assert half == 0, (
            "half-committed row from the failed extractor survived — "
            "conn.rollback() was not called before continuing"
        )
        assert (
            db_conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == expected["sessions"]
        ), "earlier committed work was lost"


# ===========================================================================
# 11. Memory step skip behavior
# ===========================================================================


class TestMemorySkip:
    def test_transcripts_none_records_skip_other_tables_unaffected(self, db_conn, tmp_path):
        root = tmp_path / "fakehome"
        expected = _build_full_tree(root)
        cfg, _ = _cfg_for_run(root, tmp_path)
        assert cfg.transcripts_dir is None  # the default

        report = run_ingest(db_conn, cfg)

        _memory_skip_reason(report)
        assert _deltas(report)["memory_snapshots"] == 0
        assert _errors(report) == {}, (
            f"a skipped memory step is not an ERROR on a clean run: {_errors(report)!r}"
        )
        assert _deltas(report)["sessions"] == expected["sessions"]

    def test_transcripts_dir_nonexistent_records_skip_no_raise(self, db_conn, tmp_path):
        root = tmp_path / "fakehome"
        _build_full_tree(root)
        cfg, _ = _cfg_for_run(root, tmp_path, transcripts_dir=tmp_path / "no-such-transcripts")
        report = run_ingest(db_conn, cfg)  # must NOT raise
        _memory_skip_reason(report)
        assert _deltas(report)["memory_snapshots"] == 0

    @not_root
    def test_transcripts_dir_unreadable_records_skip_no_raise(self, db_conn, tmp_path):
        root = tmp_path / "fakehome"
        _build_full_tree(root)
        transcripts = tmp_path / "locked-transcripts"
        transcripts.mkdir()
        (transcripts / "session.jsonl").write_text(
            '{"timestamp": "2026-03-01T09:00:00Z"}\n', encoding="utf-8"
        )
        os.chmod(transcripts, 0o000)
        try:
            cfg, _ = _cfg_for_run(root, tmp_path, transcripts_dir=transcripts)
            report = run_ingest(db_conn, cfg)  # must NOT raise
        finally:
            os.chmod(transcripts, 0o755)

        _memory_skip_reason(report)
        assert _deltas(report)["memory_snapshots"] == 0
        # Other tables ingested normally despite the unreadable transcripts.
        assert _deltas(report)["sessions"] > 0


# ===========================================================================
# 12. Report integrity
# ===========================================================================


class TestReportIntegrity:
    def test_deltas_cover_all_six_tables_even_on_empty_run(self, db_conn, tmp_path):
        root = tmp_path / "barren"
        root.mkdir()
        cfg, _ = _cfg_for_run(root, tmp_path)
        report = run_ingest(db_conn, cfg)
        assert set(TABLES) <= set(_deltas(report)), (
            f"deltas missing tables: {set(TABLES) - set(_deltas(report))}"
        )

    def test_errors_empty_dict_on_clean_run(self, db_conn, tmp_path):
        root = tmp_path / "fakehome"
        _build_full_tree(root)
        cfg, _ = _cfg_for_run(root, tmp_path)
        report = run_ingest(db_conn, cfg)
        assert _errors(report) == {}


# ===========================================================================
# 13. No quarantine, no export (later phases)
# ===========================================================================


class TestNoQuarantineNoExport:
    def test_outlier_dated_session_is_ingested_not_quarantined(self, db_conn, tmp_path):
        """Stage-1 orchestration ingests; it does NOT sweep. A session dated
        3036 must land in sessions and the quarantine table must not move.
        The output dir must also stay untouched — export is wired later."""
        root = tmp_path / "fakehome"
        _write_activity_file(root, "3036-01-01", ["outlier-sess-3036"])
        cfg, out_dir = _cfg_for_run(root, tmp_path)

        q_before = db_conn.execute("SELECT COUNT(*) FROM quarantine").fetchone()[0]
        report = run_ingest(db_conn, cfg)
        q_after = db_conn.execute("SELECT COUNT(*) FROM quarantine").fetchone()[0]

        assert q_after == q_before == 0, (
            "run_ingest touched the quarantine table — quarantine is a "
            "later phase, wired in the CLI"
        )
        assert _deltas(report)["sessions"] == 1
        assert (
            db_conn.execute(
                "SELECT COUNT(*) FROM sessions WHERE id = 'outlier-sess-3036'"
            ).fetchone()[0]
            == 1
        ), "the outlier-dated session was not ingested"

        assert (not out_dir.exists()) or list(out_dir.iterdir()) == [], (
            "run_ingest wrote to output_dir — export is a later phase"
        )


# ===========================================================================
# WAVE 2 — hardening pass (first-attempt-GREEN rule).
#
# Written to the CONTRACT; scripts/ingest.py was not read. Where the contract
# is silent, the principled behavior is pinned and a disagreeing
# implementation should fail and be fixed:
#   - Error keys are the step names used elsewhere in this file
#     (sessions/writing/messages/predictions/pets/memory), matching the
#     wave-1 assertions the implementation already passes.
#   - An EMPTY but readable transcripts_dir is a RUN with zero yield, not a
#     skip: "skipped" is reserved for steps that could not be attempted.
#   - The private guard must resolve BOTH sides (source path AND
#     source_root) before comparing, or a symlinked source_root defeats it.
#   - Recorder return values are junk (0) on purpose: nothing downstream may
#     depend on extractor return values.
# ===========================================================================

_EXTRACTOR_SITES = {
    "sessions": ("extract_all", extract_sessions_module),
    "writing": ("extract_all_writing", extract_writing_module),
    "messages": ("extract_all_messages", extract_messages_module),
    "predictions": ("extract_all_predictions", extract_predictions_module),
    "pets": ("extract_all_pets", extract_pets_module),
    "memory": ("extract_memory_from_jsonl", extract_memory_module),
}

FK_ORDER = ["sessions", "writing", "messages", "predictions", "pets", "memory"]


def _install_recorders(monkeypatch, calls, names=tuple(FK_ORDER)):
    """Replace extractors with call-recording no-ops returning junk (0)."""
    for name in names:
        func_name, module = _EXTRACTOR_SITES[name]

        def _recorder(*args, _name=name, **kwargs):
            calls.append(_name)
            return 0

        _patch_extractor(monkeypatch, func_name, module, _recorder)


def _assert_memory_not_skipped(report):
    """Inverse of _memory_skip_reason: no memory entry in any skip record."""
    for attr in ("skipped", "skips"):
        skips = getattr(report, attr, None)
        if skips:
            memory_keys = [k for k in skips if "memory" in str(k).lower()]
            assert not memory_keys, f"memory step wrongly recorded as skipped: {skips!r}"


class TestExtractorCallOrder:
    """FK order is load-bearing (writing FKs sessions by date), not incidental."""

    def test_fk_order_with_transcripts(self, db_conn, tmp_path, monkeypatch):
        calls = []
        _install_recorders(monkeypatch, calls)
        root = tmp_path / "barren"
        root.mkdir()
        transcripts = tmp_path / "transcripts"
        transcripts.mkdir()  # set AND readable → memory step must run
        cfg, _ = _cfg_for_run(root, tmp_path, transcripts_dir=transcripts)

        run_ingest(db_conn, cfg)

        assert calls == FK_ORDER, f"extractor order must be exactly {FK_ORDER}, got {calls}"

    def test_fk_order_without_transcripts(self, db_conn, tmp_path, monkeypatch):
        calls = []
        _install_recorders(monkeypatch, calls)
        root = tmp_path / "barren"
        root.mkdir()
        cfg, _ = _cfg_for_run(root, tmp_path)
        assert cfg.transcripts_dir is None

        run_ingest(db_conn, cfg)

        assert calls == FK_ORDER[:-1], (
            f"expected the five non-memory extractors in FK order, got {calls}"
        )
        assert "memory" not in calls, (
            "memory extractor was CALLED despite transcripts_dir=None — skip means not attempted"
        )


class TestTwoExtractorsFailing:
    def test_both_errors_recorded_rest_still_run(self, db_conn, tmp_path, monkeypatch):
        calls = []
        _install_recorders(monkeypatch, calls, names=("sessions", "messages", "pets"))

        def exploding_writing(*args, **kwargs):
            # Uncommitted probe: only a real rollback removes it.
            db_conn.execute(
                "INSERT INTO compositions (slug, filename) "
                "VALUES ('w2-double-fail-probe', 'probe.md')"
            )
            raise RuntimeError("writing exploded (wave-2 injected)")

        def exploding_predictions(*args, **kwargs):
            raise ValueError("predictions exploded (wave-2 injected)")

        _patch_extractor(
            monkeypatch,
            "extract_all_writing",
            extract_writing_module,
            exploding_writing,
        )
        _patch_extractor(
            monkeypatch,
            "extract_all_predictions",
            extract_predictions_module,
            exploding_predictions,
        )

        root = tmp_path / "barren"
        root.mkdir()
        cfg, _ = _cfg_for_run(root, tmp_path)

        report = run_ingest(db_conn, cfg)  # must NOT raise

        errors = _errors(report)
        assert set(errors) == {"writing", "predictions"}, (
            f"both failures must be recorded under their own step names: {errors!r}"
        )
        assert "exploded" in str(errors["writing"])
        assert "exploded" in str(errors["predictions"])
        # Steps between and after the two failures still ran.
        assert "messages" in calls, "messages did not run between the failures"
        assert "pets" in calls, "pets did not run after the second failure"
        # Rollback after the first failure removed the uncommitted probe.
        probe = db_conn.execute(
            "SELECT COUNT(*) FROM compositions WHERE slug = 'w2-double-fail-probe'"
        ).fetchone()[0]
        assert probe == 0, (
            "uncommitted row from the first failed extractor survived — "
            "rollback not called before continuing"
        )


class TestGuardBeforeRead:
    @not_root
    def test_private_and_unreadable_raises_guard_not_permission(self, db_conn, tmp_path):
        """A dir that is BOTH under private AND mode 0o000: the guard error
        (mentioning 'private') must win — a PermissionError would prove the
        implementation touched the filesystem before guarding."""
        root = tmp_path / "fakehome"
        _build_full_tree(root)
        locked_private = root / "private"
        os.chmod(locked_private, 0o000)
        try:
            cfg, _ = _cfg_for_run(root, tmp_path, messages_dir=locked_private)

            with pytest.raises(Exception) as guard_exc:
                assert_no_private_paths(cfg)
            assert not isinstance(guard_exc.value, PermissionError), (
                "guard raised PermissionError — it read the filesystem "
                "instead of comparing resolved paths"
            )
            assert "private" in str(guard_exc.value).lower()

            with pytest.raises(Exception) as run_exc:
                run_ingest(db_conn, cfg)
            assert not isinstance(run_exc.value, PermissionError), (
                "run_ingest hit the filesystem before the private guard"
            )
            assert "private" in str(run_exc.value).lower()
        finally:
            os.chmod(locked_private, 0o755)

        db_conn.rollback()
        assert _sql_counts(db_conn) == {t: 0 for t in TABLES}, (
            "rows were ingested despite the guard raising"
        )


class TestSkipVsZeroDistinction:
    def test_empty_readable_transcripts_runs_memory_not_skip(self, db_conn, tmp_path, monkeypatch):
        calls = []
        _install_recorders(monkeypatch, calls, names=("memory",))
        root = tmp_path / "barren"
        root.mkdir()
        transcripts = tmp_path / "empty-transcripts"
        transcripts.mkdir()
        cfg, _ = _cfg_for_run(root, tmp_path, transcripts_dir=transcripts)

        report = run_ingest(db_conn, cfg)

        assert "memory" in calls, (
            "an EMPTY but readable transcripts_dir must still RUN the memory "
            "extractor (zero yield ≠ skip)"
        )
        _assert_memory_not_skipped(report)
        assert _deltas(report)["memory_snapshots"] == 0
        assert _errors(report) == {}

    def test_transcripts_none_extractor_never_called(self, db_conn, tmp_path, monkeypatch):
        calls = []
        _install_recorders(monkeypatch, calls, names=("memory",))
        root = tmp_path / "barren"
        root.mkdir()
        cfg, _ = _cfg_for_run(root, tmp_path)
        assert cfg.transcripts_dir is None

        report = run_ingest(db_conn, cfg)

        assert "memory" not in calls, "memory extractor was invoked despite transcripts_dir=None"
        _memory_skip_reason(report)


class TestConnectionHygiene:
    def test_idle_after_clean_run(self, db_conn, tmp_path):
        root = tmp_path / "barren"
        root.mkdir()
        cfg, _ = _cfg_for_run(root, tmp_path)
        run_ingest(db_conn, cfg)
        assert db_conn.info.transaction_status == TransactionStatus.IDLE, (
            "clean run left the connection in a transaction — the caller's "
            "next commit would bundle ingest work"
        )

    def test_idle_after_failing_extractor(self, db_conn, tmp_path, monkeypatch):
        def exploding_pets(*args, **kwargs):
            raise RuntimeError("pets exploded (wave-2 injected)")

        _patch_extractor(monkeypatch, "extract_all_pets", extract_pets_module, exploding_pets)
        root = tmp_path / "barren"
        root.mkdir()
        cfg, _ = _cfg_for_run(root, tmp_path)

        report = run_ingest(db_conn, cfg)

        assert "pets" in _errors(report)
        assert db_conn.info.transaction_status == TransactionStatus.IDLE, (
            "failed-extractor path left the connection mid-transaction"
        )


class TestDeltaIsolation:
    def test_deltas_report_ground_truth_not_extractor_claims(self, db_conn, tmp_path, monkeypatch):
        """A misbehaving extractor writes to a DIFFERENT table than its own
        and returns a lying count. Deltas must reflect table_counts ground
        truth: the row shows up under the table it actually landed in."""
        calls = []
        _install_recorders(
            monkeypatch,
            calls,
            names=("sessions", "writing", "predictions", "pets"),
        )

        def sneaky_messages(*args, **kwargs):
            db_conn.execute(
                "INSERT INTO predictions (text, date_made) "
                "VALUES ('w2-sneaky-cross-table', '2026-03-15')"
            )
            db_conn.commit()
            return 5  # lying return value — must be ignored

        _patch_extractor(
            monkeypatch,
            "extract_all_messages",
            extract_messages_module,
            sneaky_messages,
        )
        root = tmp_path / "barren"
        root.mkdir()
        cfg, _ = _cfg_for_run(root, tmp_path)

        report = run_ingest(db_conn, cfg)

        deltas = _deltas(report)
        assert deltas["messages"] == 0, (
            "messages delta must come from table_counts (0 rows landed "
            "there), not the extractor's claimed 5"
        )
        assert deltas["predictions"] == 1, (
            "the cross-table row is ground truth and must appear under predictions"
        )
        for table in ("sessions", "compositions", "pet_events", "memory_snapshots"):
            assert deltas[table] == 0


class TestHostileSourceRoot:
    def test_unicode_and_spaces_in_source_root(self, db_conn, tmp_path):
        root = tmp_path / "wéird dir \N{HOUSE BUILDING}"
        root.mkdir()
        cfg, _ = _cfg_for_run(root, tmp_path)

        assert pathlib.Path(cfg.writing_dir) == root / "writing"
        assert pathlib.Path(cfg.messages_dir) == root
        assert assert_no_private_paths(cfg) is None

        report = run_ingest(db_conn, cfg)
        assert _deltas(report) == {t: 0 for t in TABLES}
        assert _errors(report) == {}

    def test_trailing_slash_source_root(self, db_conn, tmp_path):
        """Path fields may be str or Path (wave-1 deviation note): a raw
        string root with a trailing slash must derive the same paths."""
        root = tmp_path / "slashy"
        root.mkdir()
        cfg = _make_cfg(str(root) + os.sep)
        cfg = dataclasses.replace(cfg, output_dir=tmp_path / "out-guard")

        assert pathlib.Path(cfg.writing_dir) == root / "writing"
        assert pathlib.Path(cfg.predictions_dir) == root / "notes" / "predictions"
        assert assert_no_private_paths(cfg) is None

        report = run_ingest(db_conn, cfg)
        assert _deltas(report) == {t: 0 for t in TABLES}


class TestSymlinkedSourceRoot:
    def test_symlinked_root_benign_path_into_private_caught(self, db_conn, tmp_path):
        """source_root is itself a symlink, and the offending source path is
        lexically clean (link/mail). Only an implementation that resolves
        BOTH the source path AND source_root before comparing catches this:
        resolving one side only makes the comparison miss."""
        real = tmp_path / "real-home"
        _build_full_tree(real)
        _write_messages(real / "private")  # parseable bait inside private
        (real / "mail").symlink_to(real / "private", target_is_directory=True)

        link = tmp_path / "linkhome"
        link.symlink_to(real, target_is_directory=True)

        sneaky = link / "mail"
        assert "private" not in sneaky.parts  # lexically clean on both hops

        cfg, _ = _cfg_for_run(link, tmp_path, messages_dir=sneaky)

        with pytest.raises(Exception) as exc:
            assert_no_private_paths(cfg)
        assert "private" in str(exc.value).lower(), (
            f"guard missed a symlinked-root traversal into private: {exc.value!r}"
        )

        with pytest.raises(Exception):
            run_ingest(db_conn, cfg)
        db_conn.rollback()
        assert _sql_counts(db_conn)["messages"] == 0, (
            "bait messages inside private were ingested through the symlinked source_root"
        )
