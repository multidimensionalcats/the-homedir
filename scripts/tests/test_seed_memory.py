"""Hostile tests for scripts/seed_memory_snapshots.py (NOT yet implemented — RED).

The one-time seed import that makes the database authoritative for MEMORY.md
history. `src/data/memory-snapshots.json` (14 snapshots + 38 blocks,
2026-04-18 .. 2026-05-18) is the ONLY surviving record — source transcripts
were pruned by 30-day retention and the prod memory tables are empty. The
script imports the JSON into memory_snapshots / memory_blocks /
memory_block_presence; the export pipeline then regenerates the file from
the DB and the shrink guard is permanently satisfied.

Contract under test:
  seed_memory(conn, json_path: Path) -> dict   (counts inserted per table)
  main(argv=None, conn=None) -> int            (CLI: --json PATH, default
                                                src/data/memory-snapshots.json)
  _parse_args(argv)                            (repo _parse_args/main pattern)

The import below fails at collection time because the module does not exist
yet — that is the intended RED state. Do not weaken it.

Schema realities and ambiguity resolutions (documented per suite convention):

  1. Counts dict keys are pinned to the physical table names:
     {"memory_snapshots", "memory_blocks", "memory_block_presence"} — int
     values, counting INSERTED rows only (0 on a no-op re-run).
  2. memory_blocks.content is TEXT NOT NULL (001_initial_schema.sql) but the
     surviving JSON carries no content — it is unrecoverable. PINNED: the
     seed writes the empty string '' (never NULL, never fabricated text).
  3. memory_snapshots.full_content is nullable and unrecoverable. PINNED:
     left NULL.
  4. first_seen_session / last_seen_session are DERIVED from the snapshots
     that contain each hash, ordered by snapshot date — earliest containing
     snapshot's session_id and latest's. Ties on equal dates are broken by
     the INPUT ARRAY ORDER (stable sort), which matches the export's
     (date, id) ordering when insertion follows input order. The JSON's
     block-level first_seen_date/last_seen_date fields are IGNORED on
     import: in the real file they are internally inconsistent (several
     rows have first_seen_date > last_seen_date, e.g. "Identity & Context"
     2026-05-11 > 2026-05-10, while the hash appears in every snapshot
     2026-04-20..2026-05-18). Derivation supersedes them; after the seed the
     regenerated file carries containment-derived dates. The real-file
     round-trip therefore compares exported block dates against
     containment-derived expectations computed INDEPENDENTLY by the test
     from the input snapshots (the "derived via the sessions join" clause),
     while snapshots and block headings must match the input exactly.
  5. Blocks present in blocks[] but in NO snapshot (superset blocks list):
     IMPORTED with NULL first_seen_session/last_seen_session (both columns
     are nullable by schema; the blocks list is the only surviving record of
     the heading, so dropping or erroring would lose data). Export then
     emits null first/last_seen_date for them.
  6. A snapshot block_hashes entry with NO matching blocks[] record: exit 1,
     error naming the hash, full rollback. heading/content are NOT NULL and
     must not be fabricated.
  7. Duplicate snapshot session_id WITHIN one input file: exit 1 (snapshot
     identity is session_id; two point-in-time records for one session in
     one file is corrupt provenance — never silently pick one).
  8. Duplicate block entries within one file: byte-identical (same hash AND
     same heading) → deduplicated to a single row, counted once. Same hash
     with a DIFFERENT heading → exit 1, nothing imported. A hash repeated
     within a single snapshot's block_hashes → set semantics, one presence
     row (round-trip compares hash SETS).
  9. Conflict rule extends to snapshots: an existing memory_snapshots row
     for session_id S with a different token_count, date, or hash-set than
     the input → exit 1, never silently skip or overwrite. A SUPERSET file
     over a partially-seeded DB (all overlapping records byte-identical)
     inserts only the new records AND recomputes first/last_seen lineage so
     the derivation invariant of (4) holds globally over the union.
 10. Failure channel: main returns 1 and writes a message to stderr naming
     the offending ids/hashes/paths; the transaction is fully rolled back
     (NO partial import) and an injected conn is left USABLE (not in an
     aborted transaction) and NOT closed. All failure paths are exercised
     through main; seed_memory is exercised on success paths (its
     raise-vs-return style is not pinned).
 11. main PERSISTS on success: rows survive a conn.rollback() issued after
     main returns 0 (i.e. main commits). An injected conn is never closed;
     conn=None opens exactly one connection via scripts.db and its work is
     visible to other connections afterwards.
 12. _parse_args mirrors the repo pattern (scripts/ingest.py,
     scripts/model_council.py): unknown flags exit 2 via argparse; --json
     defaults to src/data/memory-snapshots.json (str-or-Path lenient,
     compared through pathlib.Path).
 13. NUL (\\u0000) inside a heading: exit 1, DB untouched. PostgreSQL TEXT
     cannot store NUL; the seed must surface that as a clean failure, not a
     half-committed import or an aborted connection.
 14. The seed NEVER writes files — DB writes only. The input file and the
     real src/data/memory-snapshots.json must be byte-identical before and
     after a run, and no new files may appear.
"""

import datetime
import json
import pathlib
import shutil

import pytest

from scripts.prebuild_export import export_memory_snapshots
from scripts.seed_memory_snapshots import _parse_args, main, seed_memory

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
REAL_JSON = REPO_ROOT / "src" / "data" / "memory-snapshots.json"

# Hashes: TEXT column, no format constraint — realistic 64-char values plus
# deliberately non-hex strings elsewhere to keep implementations honest.
H1 = "11" * 32
H2 = "22" * 32
H3 = "33" * 32
H_UNI = "44" * 32
H_ORPHAN = "55" * 32
H_LONG = "66" * 32

UNI_HEADING = "🧠 Zikaron זיכרון — ذاكرة 👩‍💻 café ✍️"
LONG_HEADING = 'He said "x\\y"\n\tline2 ' + "б" * 8000


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _insert_session(conn, session_id, date, **overrides):
    """Insert a minimal committed sessions row (NOT NULL columns only)."""
    if isinstance(date, str):
        date = datetime.date.fromisoformat(date)
    row = {
        "id": session_id,
        "date": date,
        "time_of_day": "AM",
        "version": "4.6",
        "source_type": "jsonl",
        "source_file": f"{session_id}.jsonl",
    }
    row.update(overrides)
    conn.execute(
        """
        INSERT INTO sessions (id, date, time_of_day, version, source_type, source_file)
        VALUES (%(id)s, %(date)s, %(time_of_day)s, %(version)s, %(source_type)s, %(source_file)s)
        ON CONFLICT (id) DO NOTHING
        """,
        row,
    )
    conn.commit()


def _seed_sessions(conn, data):
    """Insert a matching sessions row (date = snapshot date) per snapshot."""
    for s in data["snapshots"]:
        _insert_session(conn, s["session_id"], s["date"])


def _write_fixture(dirpath, data, name="memory-fixture.json"):
    p = pathlib.Path(dirpath) / name
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return p


def _mem_counts(conn):
    return {
        "memory_snapshots": conn.execute("SELECT COUNT(*) FROM memory_snapshots").fetchone()[0],
        "memory_blocks": conn.execute("SELECT COUNT(*) FROM memory_blocks").fetchone()[0],
        "memory_block_presence": conn.execute(
            "SELECT COUNT(*) FROM memory_block_presence"
        ).fetchone()[0],
    }


def _assert_conn_usable(conn):
    """The connection must not be closed or stuck in an aborted transaction."""
    assert not conn.closed
    assert conn.execute("SELECT 1").fetchone() == (1,)


def _assert_failed_clean(conn, rc, err):
    """Exit 1, a real stderr message, zero rows anywhere, conn usable."""
    assert rc == 1
    assert err.strip() != ""
    _assert_conn_usable(conn)
    assert _mem_counts(conn) == {
        "memory_snapshots": 0,
        "memory_blocks": 0,
        "memory_block_presence": 0,
    }


def _presence_pairs(conn):
    rows = conn.execute(
        """
        SELECT ms.session_id, mb.block_hash
        FROM memory_block_presence p
        JOIN memory_snapshots ms ON ms.id = p.snapshot_id
        JOIN memory_blocks mb ON mb.id = p.block_id
        """
    ).fetchall()
    return {(r[0], r[1]) for r in rows}


def _lineage(conn, block_hash):
    return conn.execute(
        "SELECT first_seen_session, last_seen_session FROM memory_blocks WHERE block_hash = %s",
        (block_hash,),
    ).fetchone()


def _derived_lineage(data):
    """Independently compute expected lineage from containment (resolution 4).

    Returns {hash: (first_date, last_date, first_session, last_session)};
    orphan blocks map to (None, None, None, None). Stable sort on date —
    ties keep input array order.
    """
    ordered = sorted(data["snapshots"], key=lambda s: s["date"])
    first, last = {}, {}
    for s in ordered:
        for h in s["block_hashes"]:
            first.setdefault(h, s)
            last[h] = s
    out = {}
    for b in data["blocks"]:
        h = b["hash"]
        if h in first:
            out[h] = (
                first[h]["date"],
                last[h]["date"],
                first[h]["session_id"],
                last[h]["session_id"],
            )
        else:
            out[h] = (None, None, None, None)
    return out


def _snap_records(data):
    return {
        (s["session_id"], s["date"], s["token_count"], frozenset(s["block_hashes"]))
        for s in data["snapshots"]
    }


def _export_json(conn, tmpdir):
    out = pathlib.Path(tmpdir) / "export-out"
    out.mkdir(exist_ok=True)
    path = export_memory_snapshots(conn, out)
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))


def _consistent_fixture():
    """Snapshots deliberately OUT of date order; block dates consistent with
    containment derivation, so a correct seed+export round-trips exactly."""
    return {
        "snapshots": [
            {
                "session_id": "sess-c",
                "date": "2026-04-09",
                "token_count": 1000,
                "block_hashes": [H1, H3, H_UNI],
            },
            {
                "session_id": "sess-a",
                "date": "2026-04-02",
                "token_count": 800,
                "block_hashes": [H1, H2],
            },
            {
                "session_id": "sess-b",
                "date": "2026-04-05",
                "token_count": None,
                "block_hashes": [H1],
            },
        ],
        "blocks": [
            {
                "hash": H1,
                "heading": "Identity & Context",
                "first_seen_date": "2026-04-02",
                "last_seen_date": "2026-04-09",
            },
            {
                "hash": H2,
                "heading": "Key Files",
                "first_seen_date": "2026-04-02",
                "last_seen_date": "2026-04-02",
            },
            {
                "hash": H3,
                "heading": "Quick Reference: Current Situation (April 9)",
                "first_seen_date": "2026-04-09",
                "last_seen_date": "2026-04-09",
            },
            {
                "hash": H_UNI,
                "heading": UNI_HEADING,
                "first_seen_date": "2026-04-09",
                "last_seen_date": "2026-04-09",
            },
            {
                "hash": H_ORPHAN,
                "heading": "Ghost — curated out before any surviving snapshot",
                "first_seen_date": None,
                "last_seen_date": None,
            },
        ],
    }


# ---------------------------------------------------------------------------
# _parse_args
# ---------------------------------------------------------------------------


class TestParseArgs:
    def test_default_json_path_pinned(self):
        args = _parse_args([])
        assert pathlib.Path(args.json) == pathlib.Path("src/data/memory-snapshots.json")

    def test_json_override(self, tmp_path):
        target = tmp_path / "elsewhere.json"
        args = _parse_args(["--json", str(target)])
        assert pathlib.Path(args.json) == target

    def test_unknown_flag_exits_2(self):
        with pytest.raises(SystemExit) as excinfo:
            _parse_args(["--definitely-not-a-flag"])
        assert excinfo.value.code == 2


# ---------------------------------------------------------------------------
# Input guards: missing / malformed / wrong-shape files (resolutions 10, 13)
# ---------------------------------------------------------------------------


class TestInputGuards:
    def test_missing_file_exit_1_named_db_untouched(self, db_conn, tmp_path, capsys):
        ghost = tmp_path / "does-not-exist.json"
        rc = main(["--json", str(ghost)], conn=db_conn)
        err = capsys.readouterr().err
        _assert_failed_clean(db_conn, rc, err)
        assert "does-not-exist.json" in err

    def test_path_is_a_directory_exit_1(self, db_conn, tmp_path, capsys):
        rc = main(["--json", str(tmp_path)], conn=db_conn)
        _assert_failed_clean(db_conn, rc, capsys.readouterr().err)

    @pytest.mark.parametrize(
        "raw",
        [
            b"",
            b'{"snapshots": [',
            b"\x89PNG\r\n\x1a\n not json at all",
            b"[1, 2",
            b"{'snapshots': []}",  # single quotes — not JSON
        ],
        ids=["empty", "truncated-object", "binary-garbage", "truncated-array", "single-quotes"],
    )
    def test_malformed_json_exit_1_db_untouched(self, db_conn, tmp_path, capsys, raw):
        p = tmp_path / "bad.json"
        p.write_bytes(raw)
        rc = main(["--json", str(p)], conn=db_conn)
        _assert_failed_clean(db_conn, rc, capsys.readouterr().err)

    @pytest.mark.parametrize(
        "payload",
        [
            [],
            "just a string",
            42,
            None,
            {"snapshots": []},  # missing blocks
            {"blocks": []},  # missing snapshots
            {"snapshots": None, "blocks": []},
            {"snapshots": [], "blocks": {}},
            {"snapshots": ["not-a-dict"], "blocks": []},
            {"snapshots": [], "blocks": ["not-a-dict"]},
            # snapshot missing session_id
            {
                "snapshots": [{"date": "2026-04-02", "token_count": 1, "block_hashes": []}],
                "blocks": [],
            },
            # snapshot missing date
            {
                "snapshots": [{"session_id": "s1", "token_count": 1, "block_hashes": []}],
                "blocks": [],
            },
            # snapshot missing block_hashes
            {
                "snapshots": [{"session_id": "s1", "date": "2026-04-02", "token_count": 1}],
                "blocks": [],
            },
            # block_hashes wrong type
            {
                "snapshots": [
                    {
                        "session_id": "s1",
                        "date": "2026-04-02",
                        "token_count": 1,
                        "block_hashes": "abc",
                    }
                ],
                "blocks": [],
            },
            # unparseable date
            {
                "snapshots": [
                    {
                        "session_id": "s1",
                        "date": "2026-13-45",
                        "token_count": 1,
                        "block_hashes": [],
                    }
                ],
                "blocks": [],
            },
            # token_count wrong type
            {
                "snapshots": [
                    {
                        "session_id": "s1",
                        "date": "2026-04-02",
                        "token_count": "many",
                        "block_hashes": [],
                    }
                ],
                "blocks": [],
            },
            # block missing hash
            {"snapshots": [], "blocks": [{"heading": "x"}]},
            # block missing heading
            {"snapshots": [], "blocks": [{"hash": H1}]},
        ],
        ids=[
            "top-level-list",
            "top-level-string",
            "top-level-int",
            "top-level-null",
            "missing-blocks-key",
            "missing-snapshots-key",
            "snapshots-null",
            "blocks-not-a-list",
            "snapshot-not-a-dict",
            "block-not-a-dict",
            "snapshot-no-session-id",
            "snapshot-no-date",
            "snapshot-no-block-hashes",
            "block-hashes-string",
            "garbage-date",
            "token-count-string",
            "block-no-hash",
            "block-no-heading",
        ],
    )
    def test_wrong_shape_exit_1_db_untouched(self, db_conn, tmp_path, capsys, payload):
        # A matching session exists so shape validation is what fails, never FK.
        _insert_session(db_conn, "s1", "2026-04-02")
        p = _write_fixture(tmp_path, payload)
        rc = main(["--json", str(p)], conn=db_conn)
        _assert_failed_clean(db_conn, rc, capsys.readouterr().err)

    def test_nul_byte_in_heading_exit_1_db_untouched(self, db_conn, tmp_path, capsys):
        # Postgres TEXT cannot store U+0000 — must be a clean failure with a
        # full rollback, not an aborted transaction or a partial import.
        data = {
            "snapshots": [
                {
                    "session_id": "s1",
                    "date": "2026-04-02",
                    "token_count": 10,
                    "block_hashes": [H1],
                }
            ],
            "blocks": [
                {
                    "hash": H1,
                    "heading": "bad\u0000heading",
                    "first_seen_date": "2026-04-02",
                    "last_seen_date": "2026-04-02",
                }
            ],
        }
        _insert_session(db_conn, "s1", "2026-04-02")
        p = _write_fixture(tmp_path, data)
        rc = main(["--json", str(p)], conn=db_conn)
        _assert_failed_clean(db_conn, rc, capsys.readouterr().err)

    def test_empty_but_valid_file_is_a_clean_noop(self, db_conn, tmp_path):
        p = _write_fixture(tmp_path, {"snapshots": [], "blocks": []})
        counts = seed_memory(db_conn, p)
        assert counts == {
            "memory_snapshots": 0,
            "memory_blocks": 0,
            "memory_block_presence": 0,
        }
        assert _mem_counts(db_conn) == counts


# ---------------------------------------------------------------------------
# Referential safety (contract 3, resolution 6)
# ---------------------------------------------------------------------------


class TestReferentialSafety:
    def test_missing_sessions_all_named_no_partial_import(self, db_conn, tmp_path, capsys):
        data = {
            "snapshots": [
                {
                    "session_id": "real-1",
                    "date": "2026-04-02",
                    "token_count": 1,
                    "block_hashes": [H1],
                },
                {
                    "session_id": "ghost-1",
                    "date": "2026-04-03",
                    "token_count": 2,
                    "block_hashes": [H1],
                },
                {
                    "session_id": "ghost-2",
                    "date": "2026-04-04",
                    "token_count": 3,
                    "block_hashes": [H1],
                },
            ],
            "blocks": [
                {
                    "hash": H1,
                    "heading": "Identity",
                    "first_seen_date": "2026-04-02",
                    "last_seen_date": "2026-04-04",
                },
            ],
        }
        _insert_session(db_conn, "real-1", "2026-04-02")  # ghosts deliberately absent
        p = _write_fixture(tmp_path, data)
        rc = main(["--json", str(p)], conn=db_conn)
        err = capsys.readouterr().err
        _assert_failed_clean(db_conn, rc, err)
        # Error must NAME every missing id — never silently skip.
        assert "ghost-1" in err
        assert "ghost-2" in err

    def test_snapshot_hash_with_no_block_record_exit_1(self, db_conn, tmp_path, capsys):
        rogue = "deadbeef" * 8
        data = {
            "snapshots": [
                {
                    "session_id": "s1",
                    "date": "2026-04-02",
                    "token_count": 1,
                    "block_hashes": [H1, rogue],
                }
            ],
            "blocks": [
                {
                    "hash": H1,
                    "heading": "Identity",
                    "first_seen_date": "2026-04-02",
                    "last_seen_date": "2026-04-02",
                },
            ],
        }
        _insert_session(db_conn, "s1", "2026-04-02")
        p = _write_fixture(tmp_path, data)
        rc = main(["--json", str(p)], conn=db_conn)
        err = capsys.readouterr().err
        _assert_failed_clean(db_conn, rc, err)
        assert rogue in err


# ---------------------------------------------------------------------------
# Core seeding + lineage derivation (contract 1, resolutions 2-5)
# ---------------------------------------------------------------------------


class TestCoreSeedAndDerivation:
    def test_counts_dict_exact(self, db_conn, tmp_path):
        data = _consistent_fixture()
        _seed_sessions(db_conn, data)
        p = _write_fixture(tmp_path, data)
        counts = seed_memory(db_conn, p)
        assert counts == {
            "memory_snapshots": 3,
            "memory_blocks": 5,
            "memory_block_presence": 6,
        }
        assert _mem_counts(db_conn) == counts

    def test_snapshot_columns_come_from_json_not_sessions(self, db_conn, tmp_path):
        # sessions.date deliberately diverges — memory_snapshots.date must be
        # the JSON snapshot date; full_content stays NULL (resolution 3);
        # a null token_count stays NULL.
        data = {
            "snapshots": [
                {"session_id": "s1", "date": "2026-04-02", "token_count": 1234, "block_hashes": []},
                {"session_id": "s2", "date": "2026-04-05", "token_count": None, "block_hashes": []},
            ],
            "blocks": [],
        }
        _insert_session(db_conn, "s1", "2026-01-01")
        _insert_session(db_conn, "s2", "2026-01-01")
        p = _write_fixture(tmp_path, data)
        seed_memory(db_conn, p)
        rows = db_conn.execute(
            "SELECT session_id, date, token_count, full_content "
            "FROM memory_snapshots ORDER BY session_id"
        ).fetchall()
        assert rows == [
            ("s1", datetime.date(2026, 4, 2), 1234, None),
            ("s2", datetime.date(2026, 4, 5), None, None),
        ]

    def test_block_content_is_empty_string_never_null(self, db_conn, tmp_path):
        data = _consistent_fixture()
        _seed_sessions(db_conn, data)
        p = _write_fixture(tmp_path, data)
        seed_memory(db_conn, p)
        contents = [r[0] for r in db_conn.execute("SELECT content FROM memory_blocks").fetchall()]
        assert len(contents) == 5
        assert all(c == "" for c in contents)  # resolution 2: '' exactly

    def test_lineage_derived_by_date_not_file_order(self, db_conn, tmp_path):
        # Fixture lists snapshots as [04-09, 04-02, 04-05]; the shared block's
        # lineage must still be first=sess-a (04-02), last=sess-c (04-09).
        data = _consistent_fixture()
        _seed_sessions(db_conn, data)
        p = _write_fixture(tmp_path, data)
        seed_memory(db_conn, p)
        assert _lineage(db_conn, H1) == ("sess-a", "sess-c")
        assert _lineage(db_conn, H2) == ("sess-a", "sess-a")
        assert _lineage(db_conn, H3) == ("sess-c", "sess-c")

    def test_duplicate_dates_stable_by_input_order(self, db_conn, tmp_path):
        # Two snapshots on the SAME date; input order zzz-then-aaa is the
        # opposite of lexicographic — a sort by (date, session_id) instead of
        # a stable sort on date alone gets this backwards (resolution 4).
        data = {
            "snapshots": [
                {"session_id": "zzz", "date": "2026-05-01", "token_count": 1, "block_hashes": [H1]},
                {"session_id": "aaa", "date": "2026-05-01", "token_count": 2, "block_hashes": [H1]},
            ],
            "blocks": [
                {
                    "hash": H1,
                    "heading": "Tied",
                    "first_seen_date": "2026-05-01",
                    "last_seen_date": "2026-05-01",
                },
            ],
        }
        _seed_sessions(db_conn, data)
        p = _write_fixture(tmp_path, data)
        seed_memory(db_conn, p)
        assert _lineage(db_conn, H1) == ("zzz", "aaa")

    def test_shared_hash_single_block_row_many_presence(self, db_conn, tmp_path):
        data = _consistent_fixture()
        _seed_sessions(db_conn, data)
        p = _write_fixture(tmp_path, data)
        seed_memory(db_conn, p)
        n = db_conn.execute(
            "SELECT COUNT(*) FROM memory_blocks WHERE block_hash = %s", (H1,)
        ).fetchone()[0]
        assert n == 1
        expected_pairs = {
            ("sess-a", H1),
            ("sess-a", H2),
            ("sess-b", H1),
            ("sess-c", H1),
            ("sess-c", H3),
            ("sess-c", H_UNI),
        }
        assert _presence_pairs(db_conn) == expected_pairs

    def test_hash_repeated_within_one_snapshot_is_set_semantics(self, db_conn, tmp_path):
        # Presence PK is (snapshot_id, block_id) — a repeated hash must not
        # blow up the insert or double-count (resolution 8).
        data = {
            "snapshots": [
                {
                    "session_id": "s1",
                    "date": "2026-04-02",
                    "token_count": 1,
                    "block_hashes": [H1, H1],
                },
            ],
            "blocks": [
                {
                    "hash": H1,
                    "heading": "Identity",
                    "first_seen_date": "2026-04-02",
                    "last_seen_date": "2026-04-02",
                },
            ],
        }
        _insert_session(db_conn, "s1", "2026-04-02")
        p = _write_fixture(tmp_path, data)
        counts = seed_memory(db_conn, p)
        assert counts["memory_block_presence"] == 1
        assert _presence_pairs(db_conn) == {("s1", H1)}

    def test_snapshot_with_empty_block_hashes(self, db_conn, tmp_path):
        data = {
            "snapshots": [
                {"session_id": "s1", "date": "2026-04-02", "token_count": 7, "block_hashes": []}
            ],
            "blocks": [],
        }
        _insert_session(db_conn, "s1", "2026-04-02")
        p = _write_fixture(tmp_path, data)
        counts = seed_memory(db_conn, p)
        assert counts == {
            "memory_snapshots": 1,
            "memory_blocks": 0,
            "memory_block_presence": 0,
        }
        produced = _export_json(db_conn, tmp_path)
        assert produced["snapshots"] == [
            {"session_id": "s1", "date": "2026-04-02", "token_count": 7, "block_hashes": []}
        ]

    def test_orphan_block_imported_with_null_lineage(self, db_conn, tmp_path):
        data = _consistent_fixture()
        _seed_sessions(db_conn, data)
        p = _write_fixture(tmp_path, data)
        seed_memory(db_conn, p)
        assert _lineage(db_conn, H_ORPHAN) == (None, None)
        produced = _export_json(db_conn, tmp_path)
        orphan = [b for b in produced["blocks"] if b["hash"] == H_ORPHAN]
        assert len(orphan) == 1
        assert orphan[0]["first_seen_date"] is None
        assert orphan[0]["last_seen_date"] is None


# ---------------------------------------------------------------------------
# Idempotence and conflicts (contract 2, 5; resolutions 7-9)
# ---------------------------------------------------------------------------


class TestIdempotenceAndConflicts:
    def test_second_run_inserts_zero_of_everything(self, db_conn, tmp_path):
        data = _consistent_fixture()
        _seed_sessions(db_conn, data)
        p = _write_fixture(tmp_path, data)
        first = seed_memory(db_conn, p)
        assert first["memory_snapshots"] == 3  # sanity: first run did insert
        second = seed_memory(db_conn, p)
        assert second == {
            "memory_snapshots": 0,
            "memory_blocks": 0,
            "memory_block_presence": 0,
        }
        assert _mem_counts(db_conn) == first

    def test_reseed_via_main_exits_0_both_times(self, db_conn, tmp_path):
        data = _consistent_fixture()
        _seed_sessions(db_conn, data)
        p = _write_fixture(tmp_path, data)
        assert main(["--json", str(p)], conn=db_conn) == 0
        after_first = _mem_counts(db_conn)
        assert main(["--json", str(p)], conn=db_conn) == 0
        assert _mem_counts(db_conn) == after_first

    def test_superset_reseed_inserts_only_new_and_recomputes_lineage(self, db_conn, tmp_path):
        # Resolution 9: overlapping records identical → only new rows insert,
        # and H1's lineage must extend to the new latest snapshot.
        snap1 = {"session_id": "s1", "date": "2026-04-01", "token_count": 100, "block_hashes": [H1]}
        block1 = {
            "hash": H1,
            "heading": "Alpha",
            "first_seen_date": "2026-04-01",
            "last_seen_date": "2026-04-01",
        }
        file1 = {"snapshots": [snap1], "blocks": [block1]}
        file2 = {
            "snapshots": [
                snap1,
                {
                    "session_id": "s2",
                    "date": "2026-04-08",
                    "token_count": 200,
                    "block_hashes": [H1, H2],
                },
            ],
            "blocks": [
                {**block1, "last_seen_date": "2026-04-08"},
                {
                    "hash": H2,
                    "heading": "Beta",
                    "first_seen_date": "2026-04-08",
                    "last_seen_date": "2026-04-08",
                },
            ],
        }
        _insert_session(db_conn, "s1", "2026-04-01")
        _insert_session(db_conn, "s2", "2026-04-08")

        assert main(["--json", str(_write_fixture(tmp_path, file1, "f1.json"))], conn=db_conn) == 0
        assert _lineage(db_conn, H1) == ("s1", "s1")

        counts = seed_memory(db_conn, _write_fixture(tmp_path, file2, "f2.json"))
        assert counts == {
            "memory_snapshots": 1,
            "memory_blocks": 1,
            "memory_block_presence": 2,
        }
        assert _lineage(db_conn, H1) == ("s1", "s2")
        assert _lineage(db_conn, H2) == ("s2", "s2")
        assert _presence_pairs(db_conn) == {("s1", H1), ("s2", H1), ("s2", H2)}

    def test_conflicting_heading_across_runs_errors_no_overwrite(self, db_conn, tmp_path, capsys):
        base = {
            "snapshots": [
                {"session_id": "s1", "date": "2026-04-01", "token_count": 1, "block_hashes": [H1]}
            ],
            "blocks": [
                {
                    "hash": H1,
                    "heading": "Original",
                    "first_seen_date": "2026-04-01",
                    "last_seen_date": "2026-04-01",
                },
            ],
        }
        _insert_session(db_conn, "s1", "2026-04-01")
        assert main(["--json", str(_write_fixture(tmp_path, base, "f1.json"))], conn=db_conn) == 0

        evil = json.loads(json.dumps(base))
        evil["blocks"][0]["heading"] = "Rewritten history"
        rc = main(["--json", str(_write_fixture(tmp_path, evil, "f2.json"))], conn=db_conn)
        err = capsys.readouterr().err
        assert rc == 1
        assert err.strip() != ""
        assert H1 in err
        _assert_conn_usable(db_conn)
        # Original data untouched, nothing new snuck in.
        heading = db_conn.execute(
            "SELECT heading FROM memory_blocks WHERE block_hash = %s", (H1,)
        ).fetchone()[0]
        assert heading == "Original"
        assert _mem_counts(db_conn) == {
            "memory_snapshots": 1,
            "memory_blocks": 1,
            "memory_block_presence": 1,
        }

    def test_conflicting_heading_within_one_file_errors(self, db_conn, tmp_path, capsys):
        data = {
            "snapshots": [],
            "blocks": [
                {"hash": H1, "heading": "One", "first_seen_date": None, "last_seen_date": None},
                {"hash": H1, "heading": "Two", "first_seen_date": None, "last_seen_date": None},
            ],
        }
        p = _write_fixture(tmp_path, data)
        rc = main(["--json", str(p)], conn=db_conn)
        err = capsys.readouterr().err
        _assert_failed_clean(db_conn, rc, err)
        assert H1 in err

    def test_identical_duplicate_block_entries_dedupe_to_one(self, db_conn, tmp_path):
        entry = {"hash": H1, "heading": "Same", "first_seen_date": None, "last_seen_date": None}
        data = {"snapshots": [], "blocks": [entry, dict(entry)]}
        p = _write_fixture(tmp_path, data)
        counts = seed_memory(db_conn, p)
        assert counts["memory_blocks"] == 1
        assert _mem_counts(db_conn)["memory_blocks"] == 1

    def test_duplicate_snapshot_session_id_within_file_errors(self, db_conn, tmp_path, capsys):
        data = {
            "snapshots": [
                {"session_id": "s1", "date": "2026-04-01", "token_count": 1, "block_hashes": []},
                {"session_id": "s1", "date": "2026-04-02", "token_count": 2, "block_hashes": []},
            ],
            "blocks": [],
        }
        _insert_session(db_conn, "s1", "2026-04-01")
        p = _write_fixture(tmp_path, data)
        rc = main(["--json", str(p)], conn=db_conn)
        err = capsys.readouterr().err
        _assert_failed_clean(db_conn, rc, err)
        assert "s1" in err

    @pytest.mark.parametrize(
        "mutate",
        [
            lambda s: s.__setitem__("token_count", 999),
            lambda s: s.__setitem__("date", "2026-04-09"),
            lambda s: s.__setitem__("block_hashes", [H1, H2]),
        ],
        ids=["token-count-differs", "date-differs", "hash-set-differs"],
    )
    def test_conflicting_snapshot_reseed_errors_never_skips(
        self, db_conn, tmp_path, capsys, mutate
    ):
        base = {
            "snapshots": [
                {"session_id": "s1", "date": "2026-04-01", "token_count": 100, "block_hashes": [H1]}
            ],
            "blocks": [
                {
                    "hash": H1,
                    "heading": "Alpha",
                    "first_seen_date": "2026-04-01",
                    "last_seen_date": "2026-04-01",
                },
                {"hash": H2, "heading": "Beta", "first_seen_date": None, "last_seen_date": None},
            ],
        }
        _insert_session(db_conn, "s1", "2026-04-01")
        assert main(["--json", str(_write_fixture(tmp_path, base, "f1.json"))], conn=db_conn) == 0
        before = _mem_counts(db_conn)

        evil = json.loads(json.dumps(base))
        mutate(evil["snapshots"][0])
        rc = main(["--json", str(_write_fixture(tmp_path, evil, "f2.json"))], conn=db_conn)
        err = capsys.readouterr().err
        assert rc == 1
        assert "s1" in err
        _assert_conn_usable(db_conn)
        assert _mem_counts(db_conn) == before
        row = db_conn.execute(
            "SELECT date, token_count FROM memory_snapshots WHERE session_id = 's1'"
        ).fetchone()
        assert row == (datetime.date(2026, 4, 1), 100)


# ---------------------------------------------------------------------------
# Round-trips (contract 4 — the flagship)
# ---------------------------------------------------------------------------


class TestRoundTrip:
    def test_synthetic_round_trip_record_equivalent(self, db_conn, tmp_path):
        data = _consistent_fixture()
        _seed_sessions(db_conn, data)
        p = _write_fixture(tmp_path, data)
        assert main(["--json", str(p)], conn=db_conn) == 0

        produced = _export_json(db_conn, tmp_path)

        # Snapshots: record-equivalent, hash lists compared as sets.
        assert _snap_records(produced) == _snap_records(data)
        # No snapshot gained or lost hashes to list-dedup bugs.
        for s in produced["snapshots"]:
            assert len(s["block_hashes"]) == len(set(s["block_hashes"]))

        # Blocks: same hash->heading mapping, no duplicates.
        assert {b["hash"]: b["heading"] for b in produced["blocks"]} == {
            b["hash"]: b["heading"] for b in data["blocks"]
        }
        assert len(produced["blocks"]) == len(data["blocks"])

        # Dates: fixture is containment-consistent, so exported dates must
        # equal BOTH the input's stored dates and the derived expectations.
        derived = _derived_lineage(data)
        produced_dates = {
            b["hash"]: (b["first_seen_date"], b["last_seen_date"]) for b in produced["blocks"]
        }
        assert produced_dates == {
            b["hash"]: (b["first_seen_date"], b["last_seen_date"]) for b in data["blocks"]
        }
        assert produced_dates == {h: (d[0], d[1]) for h, d in derived.items()}

    def test_unicode_rtl_emoji_and_long_headings_round_trip(self, db_conn, tmp_path):
        data = {
            "snapshots": [
                {
                    "session_id": "sess-uni",
                    "date": "2026-04-02",
                    "token_count": 42,
                    "block_hashes": [H_UNI, H_LONG],
                }
            ],
            "blocks": [
                {
                    "hash": H_UNI,
                    "heading": UNI_HEADING,
                    "first_seen_date": "2026-04-02",
                    "last_seen_date": "2026-04-02",
                },
                {
                    "hash": H_LONG,
                    "heading": LONG_HEADING,
                    "first_seen_date": "2026-04-02",
                    "last_seen_date": "2026-04-02",
                },
            ],
        }
        _seed_sessions(db_conn, data)
        p = _write_fixture(tmp_path, data)
        assert main(["--json", str(p)], conn=db_conn) == 0

        stored = {
            r[0]: r[1]
            for r in db_conn.execute("SELECT block_hash, heading FROM memory_blocks").fetchall()
        }
        assert stored == {H_UNI: UNI_HEADING, H_LONG: LONG_HEADING}  # byte-exact

        produced = _export_json(db_conn, tmp_path)
        assert {b["hash"]: b["heading"] for b in produced["blocks"]} == stored

    def test_real_file_full_14_38_round_trip(self, db_conn, tmp_path):
        # THE FLAGSHIP. The real surviving JSON, copied into tmp, seeded
        # against synthesized matching sessions, exported back out.
        assert REAL_JSON.is_file(), f"real dataset missing: {REAL_JSON}"
        copy = tmp_path / "memory-snapshots.json"
        shutil.copyfile(REAL_JSON, copy)
        src = json.loads(copy.read_text(encoding="utf-8"))

        # Pin the known dataset before trusting derived assertions.
        assert len(src["snapshots"]) == 14
        assert len(src["blocks"]) == 38
        presence_expected = sum(len(s["block_hashes"]) for s in src["snapshots"])
        assert presence_expected == 112

        _seed_sessions(db_conn, src)
        assert main(["--json", str(copy)], conn=db_conn) == 0
        assert _mem_counts(db_conn) == {
            "memory_snapshots": 14,
            "memory_blocks": 38,
            "memory_block_presence": presence_expected,
        }

        produced = _export_json(db_conn, tmp_path)

        # Snapshots record-equivalent (session_id, date, token_count, hash SET).
        assert _snap_records(produced) == _snap_records(src)
        assert len(produced["snapshots"]) == 14

        # Blocks: all 38 hashes with their exact headings, no dupes.
        assert {b["hash"]: b["heading"] for b in produced["blocks"]} == {
            b["hash"]: b["heading"] for b in src["blocks"]
        }
        assert len(produced["blocks"]) == 38

        # Dates: containment-derived (resolution 4). The file's own
        # first/last_seen_date values are internally inconsistent legacy
        # values and must NOT round-trip verbatim where they disagree with
        # containment; the regenerated file is the corrected authority.
        derived = _derived_lineage(src)
        assert {
            b["hash"]: (b["first_seen_date"], b["last_seen_date"]) for b in produced["blocks"]
        } == {h: (d[0], d[1]) for h, d in derived.items()}

        # And it really is a correction: the legacy file contains at least
        # one first_seen_date AFTER last_seen_date; the export must not.
        assert any(
            b["first_seen_date"] > b["last_seen_date"]
            for b in src["blocks"]
            if b["first_seen_date"] and b["last_seen_date"]
        )
        assert all(
            b["first_seen_date"] <= b["last_seen_date"]
            for b in produced["blocks"]
            if b["first_seen_date"] and b["last_seen_date"]
        )

        # Idempotence on the real dataset.
        assert main(["--json", str(copy)], conn=db_conn) == 0
        assert _mem_counts(db_conn)["memory_block_presence"] == presence_expected


# ---------------------------------------------------------------------------
# CLI / connection ownership / filesystem purity (contract 6, resolutions 10-14)
# ---------------------------------------------------------------------------


class TestCliContract:
    def test_injected_conn_never_closed(self, db_conn, tmp_path):
        data = _consistent_fixture()
        _seed_sessions(db_conn, data)
        p = _write_fixture(tmp_path, data)
        rc = main(["--json", str(p)], conn=db_conn)
        assert rc == 0
        _assert_conn_usable(db_conn)

    def test_injected_conn_not_closed_even_on_failure(self, db_conn, tmp_path, capsys):
        rc = main(["--json", str(tmp_path / "nope.json")], conn=db_conn)
        assert rc == 1
        capsys.readouterr()
        _assert_conn_usable(db_conn)

    def test_main_commits_rows_survive_rollback(self, db_conn, tmp_path):
        data = _consistent_fixture()
        _seed_sessions(db_conn, data)
        p = _write_fixture(tmp_path, data)
        assert main(["--json", str(p)], conn=db_conn) == 0
        db_conn.rollback()  # discards any uncommitted work
        assert _mem_counts(db_conn) == {
            "memory_snapshots": 3,
            "memory_blocks": 5,
            "memory_block_presence": 6,
        }

    def test_conn_none_opens_own_connection_and_persists(self, db_conn, tmp_path):
        # No injected conn: main must connect via scripts.db (conftest pins
        # the *_test database) and commit — the work must be visible from
        # this separate connection afterwards.
        data = _consistent_fixture()
        _seed_sessions(db_conn, data)
        p = _write_fixture(tmp_path, data)
        rc = main(["--json", str(p)])
        assert rc == 0
        assert _mem_counts(db_conn) == {
            "memory_snapshots": 3,
            "memory_blocks": 5,
            "memory_block_presence": 6,
        }

    def test_seed_touches_no_files(self, db_conn, tmp_path):
        data = _consistent_fixture()
        _seed_sessions(db_conn, data)
        p = _write_fixture(tmp_path, data)

        input_before = p.read_bytes()
        real_before = REAL_JSON.read_bytes()
        listing_before = sorted(q for q in tmp_path.rglob("*"))

        assert main(["--json", str(p)], conn=db_conn) == 0

        assert p.read_bytes() == input_before  # input file byte-identical
        assert REAL_JSON.read_bytes() == real_before  # real dataset untouched
        assert sorted(q for q in tmp_path.rglob("*")) == listing_before  # nothing created
