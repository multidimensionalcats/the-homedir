"""Hostile tests for scripts/validate_dates.py (NOT yet implemented — RED).

Covers:
  - EXPERIMENT_START module constant
  - find_outliers(conn, start, end): SELECT-only scan of
      messages.date, sessions.date, compositions.date_written,
      predictions.date_made, pet_events.event_timestamp
    for values outside [start, end] inclusive; NULL dates are not outliers.
  - quarantine_outliers(conn, start, end): moves outlier rows into the
    quarantine table (full-row JSONB, reason mentioning the valid range,
    content_hash dedup), deletes originals, cascades session children,
    idempotent across runs, per-table counts returned.
  - Both functions raise a clear error when the quarantine table is missing.

The module under test does not exist yet, so the import below fails at
collection time — that is the intended RED state.

Deviations / decisions (spec is loose on outlier-dict key names):
  - "source_table" and "reason" are asserted as exact keys; the primary key
    value and the offending date are asserted to appear among the dict's
    VALUES (any key name), so a reasonable implementation isn't rejected on
    naming alone while a dict that omits the data still fails.
  - quarantine_outliers per-table counts: tables with zero moves may be
    reported as 0 or omitted; both are accepted (result.get(table, 0)).
  - Rows in the dedup test are seeded with explicit id AND created_at so a
    re-inserted row is byte-identical (SERIAL/DEFAULT NOW() would otherwise
    silently change the content hash and dodge the dedup path).
  - pet_events tests pin the session timezone to UTC (and restore it) so
    the timestamptz::date boundary is deterministic.
"""

import datetime
import json
import pathlib
import threading
import time

import psycopg.pq
import pytest

from scripts.validate_dates import (  # noqa: F401  (RED: module absent)
    EXPERIMENT_START,
    find_outliers,
    quarantine_outliers,
)

MIGRATIONS_DIR = pathlib.Path(__file__).parent.parent.parent / "migrations"
MIGRATION_002 = MIGRATIONS_DIR / "002_quarantine_and_version_48.sql"

END = datetime.date(2026, 6, 30)

ZWJ = chr(0x200D)  # U+200D ZERO WIDTH JOINER
HOSTILE_TEXT = (
    "family: \N{MAN}"
    + ZWJ
    + "\N{WOMAN}"
    + ZWJ
    + "\N{GIRL}"
    + ZWJ
    + "\N{BOY}"
    + " robot \N{ROBOT FACE} "
    + ZWJ * 3
    + " end"
)


# ===========================================================================
# Seeding helpers — explicit values on every NOT NULL column
# ===========================================================================


def _seed_message(
    conn,
    *,
    date,
    content="a message",
    direction="to_james",
    msg_id=None,
    line_start=None,
    line_end=None,
    created_at=None,
):
    """Insert a messages row; returns its id."""
    cols = ["direction", "date", "content", "line_start", "line_end"]
    vals = [direction, date, content, line_start, line_end]
    if msg_id is not None:
        cols.insert(0, "id")
        vals.insert(0, msg_id)
    if created_at is not None:
        cols.append("created_at")
        vals.append(created_at)
    placeholders = ", ".join(["%s"] * len(cols))
    row = conn.execute(
        f"INSERT INTO messages ({', '.join(cols)}) VALUES ({placeholders}) RETURNING id",
        vals,
    ).fetchone()
    return row[0]


def _seed_session(conn, session_id, date):
    conn.execute(
        "INSERT INTO sessions (id, date, time_of_day, version, source_type, source_file) "
        "VALUES (%s, %s, 'AM', '4.7', 'jsonl', 'seed.jsonl')",
        (session_id, date),
    )


def _seed_composition(conn, slug, date_written):
    conn.execute(
        "INSERT INTO compositions (slug, filename, date_written) VALUES (%s, %s, %s)",
        (slug, f"{slug}.md", date_written),
    )


def _seed_prediction(conn, text, date_made):
    row = conn.execute(
        "INSERT INTO predictions (text, date_made) VALUES (%s, %s) RETURNING id",
        (text, date_made),
    ).fetchone()
    return row[0]


def _seed_pet_event(conn, pet_name, event_timestamp):
    row = conn.execute(
        "INSERT INTO pet_events (pet_name, event_type, event_timestamp) "
        "VALUES (%s, 'care', %s) RETURNING id",
        (pet_name, event_timestamp),
    ).fetchone()
    return row[0]


def _count(conn, table, where="TRUE", params=()):
    return conn.execute(f"SELECT COUNT(*) FROM {table} WHERE {where}", params).fetchone()[0]


def _moved(result, table):
    """Per-table count from quarantine_outliers; absent table means 0 moved."""
    assert isinstance(result, dict), (
        f"quarantine_outliers must return a dict of per-table counts, got {type(result)}"
    )
    return result.get(table, 0)


def _outliers_for(outliers, table):
    for o in outliers:
        assert isinstance(o, dict), f"find_outliers items must be dicts, got {type(o)}"
        assert "source_table" in o, f"outlier dict missing 'source_table': {o}"
        assert "reason" in o, f"outlier dict missing 'reason': {o}"
        assert isinstance(o["reason"], str) and o["reason"].strip(), (
            f"outlier reason must be a non-empty string: {o!r}"
        )
    return [o for o in outliers if o["source_table"] == table]


def _assert_outlier_carries(outlier, pk_value, offending):
    """The dict must contain the pk value and the offending date SOMEWHERE
    among its values (key names are the implementation's choice)."""
    str_vals = [str(v) for v in outlier.values()]
    assert any(str(pk_value) == s for s in str_vals), (
        f"outlier dict does not carry primary key {pk_value!r}: {outlier!r}"
    )
    date_iso = offending.isoformat() if hasattr(offending, "isoformat") else str(offending)
    # For timestamps, accept either full timestamp or its date part appearing.
    assert any(date_iso[:10] in s for s in str_vals), (
        f"outlier dict does not carry offending date {date_iso!r}: {outlier!r}"
    )


def _fetch_jsonb(value):
    """psycopg may hand JSONB back as dict or str depending on adaptation."""
    if isinstance(value, str):
        return json.loads(value)
    return value


# ===========================================================================
# 0. Module constant
# ===========================================================================


class TestExperimentStartConstant:
    def test_experiment_start_value(self):
        assert EXPERIMENT_START == datetime.date(2026, 1, 15)

    def test_experiment_start_is_a_date_not_datetime(self):
        # A datetime here would silently change every boundary comparison.
        assert type(EXPERIMENT_START) is datetime.date


# ===========================================================================
# 1-2. Future and past message outliers
# ===========================================================================


class TestMessageOutliers:
    def test_future_message_found_and_quarantined(self, db_conn):
        bad = datetime.date(3036, 3, 2)
        msg_id = _seed_message(db_conn, date=bad, content="from the year 3036")
        _seed_message(db_conn, date=datetime.date(2026, 3, 1), content="fine")
        db_conn.commit()

        outliers = find_outliers(db_conn, EXPERIMENT_START, END)
        found = _outliers_for(outliers, "messages")
        assert len(found) == 1, f"expected exactly 1 messages outlier, got {found!r}"
        _assert_outlier_carries(found[0], msg_id, bad)

        # SELECT-only: find_outliers must not have touched the data.
        assert _count(db_conn, "messages") == 2, "find_outliers modified messages"
        assert _count(db_conn, "quarantine") == 0, "find_outliers wrote to quarantine"

        result = quarantine_outliers(db_conn, EXPERIMENT_START, END)
        assert _moved(result, "messages") == 1
        assert _count(db_conn, "messages") == 1, "outlier message not deleted"
        assert _count(db_conn, "messages", "id = %s", (msg_id,)) == 0, (
            "the WRONG message was deleted"
        )
        assert _count(db_conn, "quarantine") == 1

        src, reason = db_conn.execute("SELECT source_table, reason FROM quarantine").fetchone()
        assert src == "messages"
        assert "2026-01-15" in reason, f"reason does not mention range start: {reason!r}"
        assert "2026-06-30" in reason, f"reason does not mention range end: {reason!r}"

    def test_past_message_quarantined(self, db_conn):
        bad = datetime.date(2024, 2, 24)
        msg_id = _seed_message(db_conn, date=bad, content="before the experiment")
        db_conn.commit()

        outliers = _outliers_for(find_outliers(db_conn, EXPERIMENT_START, END), "messages")
        assert len(outliers) == 1
        _assert_outlier_carries(outliers[0], msg_id, bad)

        result = quarantine_outliers(db_conn, EXPERIMENT_START, END)
        assert _moved(result, "messages") == 1
        assert _count(db_conn, "messages") == 0
        assert _count(db_conn, "quarantine", "source_table = 'messages'") == 1


# ===========================================================================
# 3. Inclusive boundaries
# ===========================================================================


class TestBoundaries:
    def test_start_and_end_kept_end_plus_one_quarantined(self, db_conn):
        id_start = _seed_message(db_conn, date=EXPERIMENT_START, content="on start")
        id_end = _seed_message(db_conn, date=END, content="on end")
        id_over = _seed_message(db_conn, date=END + datetime.timedelta(days=1), content="one over")
        db_conn.commit()

        found = _outliers_for(find_outliers(db_conn, EXPERIMENT_START, END), "messages")
        assert len(found) == 1, (
            f"boundary rows misclassified: expected only end+1 as outlier, got {found!r}"
        )
        _assert_outlier_carries(found[0], id_over, END + datetime.timedelta(days=1))

        result = quarantine_outliers(db_conn, EXPERIMENT_START, END)
        assert _moved(result, "messages") == 1
        remaining = {r[0] for r in db_conn.execute("SELECT id FROM messages").fetchall()}
        assert remaining == {id_start, id_end}, (
            f"boundary rows must be KEPT (inclusive range); remaining={remaining}"
        )

    def test_start_minus_one_quarantined(self, db_conn):
        # Symmetry: off-by-one on the lower edge too.
        _seed_message(
            db_conn,
            date=EXPERIMENT_START - datetime.timedelta(days=1),
            content="one under",
        )
        db_conn.commit()
        found = _outliers_for(find_outliers(db_conn, EXPERIMENT_START, END), "messages")
        assert len(found) == 1


# ===========================================================================
# 4. NULL dates are not outliers
# ===========================================================================


class TestNullDates:
    def test_null_dates_kept_everywhere(self, db_conn):
        _seed_message(db_conn, date=None, content="undated message")
        _seed_composition(db_conn, "vd-null-comp", None)
        _seed_prediction(db_conn, "undated prediction", None)
        _seed_pet_event(db_conn, "nullpet", None)
        db_conn.commit()

        outliers = find_outliers(db_conn, EXPERIMENT_START, END)
        assert outliers == [], f"NULL dates must not be outliers, got {outliers!r}"

        result = quarantine_outliers(db_conn, EXPERIMENT_START, END)
        assert all(v == 0 for v in result.values()), f"moved NULL-dated rows: {result!r}"
        assert _count(db_conn, "messages") == 1
        assert _count(db_conn, "compositions") == 1
        assert _count(db_conn, "predictions") == 1
        assert _count(db_conn, "pet_events") == 1
        assert _count(db_conn, "quarantine") == 0


# ===========================================================================
# 5. Session outlier cascades its children
# ===========================================================================


class TestSessionCascade:
    def test_outlier_session_children_cascade(self, db_conn):
        bad_date = datetime.date(3036, 1, 1)
        _seed_session(db_conn, "vd-bad-sess", bad_date)
        db_conn.execute(
            "INSERT INTO file_operations (session_id, path, category, method, direction, ordinal) "
            "VALUES ('vd-bad-sess', '/home/claude/MEMORY.md', 'memory', 'Read', 'read', 0), "
            "       ('vd-bad-sess', '/home/claude/notes/daily/x.md', 'notes', 'Write', 'write', 1)"
        )
        db_conn.execute(
            "INSERT INTO web_searches (session_id, query, ordinal) "
            "VALUES ('vd-bad-sess', 'what year is it', 0)"
        )
        # Control: a valid session with children that must SURVIVE.
        _seed_session(db_conn, "vd-good-sess", datetime.date(2026, 2, 1))
        db_conn.execute(
            "INSERT INTO file_operations (session_id, path, category, method, direction, ordinal) "
            "VALUES ('vd-good-sess', '/home/claude/notes/keep.md', 'notes', 'Read', 'read', 0)"
        )
        db_conn.commit()

        found = _outliers_for(find_outliers(db_conn, EXPERIMENT_START, END), "sessions")
        assert len(found) == 1
        _assert_outlier_carries(found[0], "vd-bad-sess", bad_date)

        result = quarantine_outliers(db_conn, EXPERIMENT_START, END)
        assert _moved(result, "sessions") == 1

        assert _count(db_conn, "sessions", "id = 'vd-bad-sess'") == 0
        assert _count(db_conn, "file_operations", "session_id = 'vd-bad-sess'") == 0, (
            "child file_operations not cascaded"
        )
        assert _count(db_conn, "web_searches", "session_id = 'vd-bad-sess'") == 0, (
            "child web_searches not cascaded"
        )
        # Only the session row itself is quarantined — children are deleted
        # via FK cascade, not copied into quarantine.
        assert _count(db_conn, "quarantine") == 1
        assert _count(db_conn, "quarantine", "source_table = 'sessions'") == 1

        # The valid session and its child are untouched.
        assert _count(db_conn, "sessions", "id = 'vd-good-sess'") == 1
        assert _count(db_conn, "file_operations", "session_id = 'vd-good-sess'") == 1


# ===========================================================================
# 6. Empty database
# ===========================================================================


class TestEmptyDatabase:
    def test_empty_db_no_crash(self, db_conn):
        outliers = find_outliers(db_conn, EXPERIMENT_START, END)
        assert outliers == []

        result = quarantine_outliers(db_conn, EXPERIMENT_START, END)
        assert isinstance(result, dict)
        assert all(v == 0 for v in result.values()), f"empty DB moved rows: {result!r}"
        assert _count(db_conn, "quarantine") == 0


# ===========================================================================
# 7. Double sweep / content-hash dedup
# ===========================================================================


class TestIdempotentSweep:
    FIXED_TS = "2026-02-01T10:00:00+00:00"

    def _seed_identical_message(self, conn):
        # Explicit id AND created_at: SERIAL/DEFAULT NOW() would otherwise
        # differ on re-insert and quietly change the content hash.
        return _seed_message(
            conn,
            msg_id=999001,
            date=datetime.date(3036, 3, 2),
            content="deja vu",
            line_start=1,
            line_end=3,
            created_at=self.FIXED_TS,
        )

    def test_second_sweep_moves_nothing(self, db_conn):
        self._seed_identical_message(db_conn)
        db_conn.commit()

        first = quarantine_outliers(db_conn, EXPERIMENT_START, END)
        assert _moved(first, "messages") == 1
        assert _count(db_conn, "quarantine") == 1

        second = quarantine_outliers(db_conn, EXPERIMENT_START, END)
        assert all(v == 0 for v in second.values()), (
            f"second sweep on clean data moved rows: {second!r}"
        )
        assert _count(db_conn, "quarantine") == 1, "second sweep duplicated quarantine rows"
        assert _count(db_conn, "messages") == 0

    def test_requarantining_identical_row_dedups_without_error(self, db_conn):
        self._seed_identical_message(db_conn)
        db_conn.commit()
        quarantine_outliers(db_conn, EXPERIMENT_START, END)
        assert _count(db_conn, "quarantine") == 1

        # Re-insert the byte-identical row and sweep again: must not raise
        # (UniqueViolation on content_hash), must not duplicate, and must
        # still remove the offending row from messages.
        self._seed_identical_message(db_conn)
        db_conn.commit()
        quarantine_outliers(db_conn, EXPERIMENT_START, END)

        assert _count(db_conn, "quarantine") == 1, (
            "identical row was quarantined twice — content_hash dedup broken"
        )
        assert _count(db_conn, "messages") == 0, (
            "re-inserted identical outlier survived the second sweep"
        )


# ===========================================================================
# 8. Hostile unicode survives into row_data
# ===========================================================================


class TestUnicodeFidelity:
    def test_zwj_emoji_content_round_trips(self, db_conn):
        _seed_message(db_conn, date=datetime.date(3036, 3, 2), content=HOSTILE_TEXT)
        db_conn.commit()

        quarantine_outliers(db_conn, EXPERIMENT_START, END)
        row = db_conn.execute(
            "SELECT row_data FROM quarantine WHERE source_table = 'messages'"
        ).fetchone()
        assert row is not None, "message never reached quarantine"
        row_data = _fetch_jsonb(row[0])
        assert row_data["content"] == HOSTILE_TEXT, (
            "ZWJ/emoji content mangled in quarantine row_data"
        )


# ===========================================================================
# 9. Missing quarantine table => clear error, not silent no-op
# ===========================================================================


class TestMissingQuarantineTable:
    def test_both_functions_raise_clearly(self, db_conn):
        _seed_message(db_conn, date=datetime.date(3036, 3, 2), content="doomed")
        db_conn.commit()
        db_conn.execute("DROP TABLE quarantine")
        db_conn.commit()
        try:
            with pytest.raises(Exception) as find_exc:
                find_outliers(db_conn, EXPERIMENT_START, END)
            assert "quarantine" in str(find_exc.value).lower(), (
                f"find_outliers error does not mention quarantine: {find_exc.value!r}"
            )
            db_conn.rollback()

            with pytest.raises(Exception) as q_exc:
                quarantine_outliers(db_conn, EXPERIMENT_START, END)
            assert "quarantine" in str(q_exc.value).lower(), (
                f"quarantine_outliers error does not mention quarantine: {q_exc.value!r}"
            )
            db_conn.rollback()

            # Not a silent no-op: the outlier row must still be in messages.
            assert _count(db_conn, "messages") == 1, (
                "quarantine_outliers deleted the row despite having nowhere to put it"
            )
        finally:
            # conftest applies migrations once per session — recreate the
            # table ourselves or every later test is poisoned.
            db_conn.rollback()
            with open(MIGRATION_002) as f:
                db_conn.execute(f.read())
            db_conn.commit()


# ===========================================================================
# 9b. Wave 3 (code-review finding): error paths must not leak a transaction
# ===========================================================================


class TestNoLeakedTransactionOnErrorPaths:
    """W3: pre-loop guard failures must leave the connection IDLE.

    The missing-table check executes SQL (so it opens an implicit
    transaction under autocommit=False), then raises. If the function does
    not roll back before re-raising, the caller's connection is left in
    INTRANS and the caller's next unrelated commit silently bundles the
    leaked transaction. These tests pin the contract: after ANY raise from
    either public function, the connection must be back to IDLE with no
    manual rollback by the caller.
    """

    def test_connection_idle_after_missing_table_raises(self, db_conn):
        _seed_message(db_conn, date=datetime.date(3036, 3, 2), content="leak probe")
        db_conn.commit()
        db_conn.execute("DROP TABLE quarantine")
        db_conn.commit()
        try:
            with pytest.raises(Exception):
                find_outliers(db_conn, EXPERIMENT_START, END)
            status = db_conn.info.transaction_status
            assert status == psycopg.pq.TransactionStatus.IDLE, (
                "find_outliers raised on missing quarantine table but left the "
                f"connection in {status.name}; the caller's next commit would "
                "silently bundle the leaked transaction"
            )

            with pytest.raises(Exception):
                quarantine_outliers(db_conn, EXPERIMENT_START, END)
            status = db_conn.info.transaction_status
            assert status == psycopg.pq.TransactionStatus.IDLE, (
                "quarantine_outliers raised on missing quarantine table but "
                f"left the connection in {status.name}"
            )

            # The caller must be able to carry on with unrelated work
            # immediately, with NO manual rollback in between.
            assert _count(db_conn, "messages") == 1
        finally:
            db_conn.rollback()
            with open(MIGRATION_002) as f:
                db_conn.execute(f.read())
            db_conn.commit()

    def test_connection_idle_after_inverted_range_raises(self, db_conn):
        # The ValueError guard runs before any SQL; a regression that
        # reorders the guards (or queries first) would show up here.
        with pytest.raises(ValueError):
            find_outliers(db_conn, END, EXPERIMENT_START)
        assert db_conn.info.transaction_status == psycopg.pq.TransactionStatus.IDLE

        with pytest.raises(ValueError):
            quarantine_outliers(db_conn, END, EXPERIMENT_START)
        assert db_conn.info.transaction_status == psycopg.pq.TransactionStatus.IDLE


# ===========================================================================
# 10. Outliers in every monitored table simultaneously
# ===========================================================================


class TestAllTablesAtOnce:
    def test_all_five_tables_swept_in_one_call(self, db_conn):
        far_future = datetime.date(3036, 5, 5)
        _seed_message(db_conn, date=far_future, content="bad message")
        _seed_session(db_conn, "vd-all-sess", far_future)
        _seed_composition(db_conn, "vd-all-comp", far_future)
        _seed_prediction(db_conn, "bad prediction", far_future)
        _seed_pet_event(db_conn, "chronos", "3036-05-05T12:00:00+00:00")
        # One valid row per table that must survive.
        keep = datetime.date(2026, 3, 3)
        _seed_message(db_conn, date=keep, content="good message")
        _seed_session(db_conn, "vd-all-sess-ok", keep)
        _seed_composition(db_conn, "vd-all-comp-ok", keep)
        _seed_prediction(db_conn, "good prediction", keep)
        _seed_pet_event(db_conn, "chronos", "2026-03-03T12:00:00+00:00")
        db_conn.commit()

        outliers = find_outliers(db_conn, EXPERIMENT_START, END)
        by_table = {
            t: _outliers_for(outliers, t)
            for t in ("messages", "sessions", "compositions", "predictions", "pet_events")
        }
        for table, found in by_table.items():
            assert len(found) == 1, f"{table}: expected 1 outlier, got {found!r}"
        assert len(outliers) == 5, f"unexpected extra outliers: {outliers!r}"

        result = quarantine_outliers(db_conn, EXPERIMENT_START, END)
        for table in ("messages", "sessions", "compositions", "predictions", "pet_events"):
            assert _moved(result, table) == 1, f"per-table count wrong for {table}: {result!r}"
            assert _count(db_conn, "quarantine", "source_table = %s", (table,)) == 1
            assert _count(db_conn, table) == 1, f"{table}: valid row did not survive"
        assert _count(db_conn, "quarantine") == 5


# ===========================================================================
# 11. pet_events timestamp vs date boundary
# ===========================================================================


class TestPetEventTimestampBoundary:
    def test_timestamp_boundary_trap(self, db_conn):
        db_conn.execute("SET TIME ZONE 'UTC'")
        db_conn.commit()
        try:
            bad_id = _seed_pet_event(db_conn, "futurepet", "3036-01-01T00:00:00+00:00")
            # 23:59:59 ON the end date: a naive `event_timestamp <= end`
            # comparison casts the end DATE to midnight and wrongly flags this.
            keep_id = _seed_pet_event(db_conn, "edgepet", "2026-06-30T23:59:59+00:00")
            db_conn.commit()

            found = _outliers_for(find_outliers(db_conn, EXPERIMENT_START, END), "pet_events")
            assert len(found) == 1, (
                "date-vs-timestamp boundary bug: 23:59:59 on the end date was "
                f"flagged (or the 3036 event was missed): {found!r}"
            )
            _assert_outlier_carries(found[0], bad_id, datetime.date(3036, 1, 1))

            result = quarantine_outliers(db_conn, EXPERIMENT_START, END)
            assert _moved(result, "pet_events") == 1
            assert _count(db_conn, "pet_events", "id = %s", (keep_id,)) == 1, (
                "the 23:59:59-on-end-date event was wrongly quarantined"
            )
            assert _count(db_conn, "pet_events", "id = %s", (bad_id,)) == 0
        finally:
            db_conn.rollback()
            db_conn.execute("SET TIME ZONE DEFAULT")
            db_conn.commit()

    def test_timestamp_before_start_midnight_kept(self, db_conn):
        db_conn.execute("SET TIME ZONE 'UTC'")
        db_conn.commit()
        try:
            # 00:00:00 on the start date is IN range (inclusive lower bound).
            _seed_pet_event(db_conn, "dawnpet", "2026-01-15T00:00:00+00:00")
            db_conn.commit()
            found = _outliers_for(find_outliers(db_conn, EXPERIMENT_START, END), "pet_events")
            assert found == [], f"midnight on start date wrongly flagged: {found!r}"
        finally:
            db_conn.rollback()
            db_conn.execute("SET TIME ZONE DEFAULT")
            db_conn.commit()


# ===========================================================================
# 12. row_data round-trip: every original column
# ===========================================================================


class TestRowDataRoundTrip:
    def test_all_message_columns_preserved(self, db_conn):
        msg_id = _seed_message(
            db_conn,
            date=datetime.date(3036, 3, 2),
            content="full row \N{ROBOT FACE}",
            direction="from_james",
            line_start=42,
            line_end=57,
            created_at="2026-02-01T10:00:00+00:00",
        )
        db_conn.commit()

        quarantine_outliers(db_conn, EXPERIMENT_START, END)
        row = db_conn.execute(
            "SELECT row_data FROM quarantine WHERE source_table = 'messages'"
        ).fetchone()
        assert row is not None
        row_data = _fetch_jsonb(row[0])

        expected_cols = {
            "id",
            "direction",
            "date",
            "content",
            "line_start",
            "line_end",
            "created_at",
        }
        assert expected_cols.issubset(row_data.keys()), (
            f"row_data is not the full row; missing {expected_cols - set(row_data)}"
        )
        assert row_data["id"] == msg_id
        assert row_data["direction"] == "from_james"
        assert row_data["content"] == "full row \N{ROBOT FACE}"
        assert row_data["line_start"] == 42
        assert row_data["line_end"] == 57
        assert "3036-03-02" in str(row_data["date"]), (
            f"offending date lost in row_data: {row_data['date']!r}"
        )
        assert row_data["created_at"] is not None


# ===========================================================================
# HARDENING WAVE 2 — added after a clean first-attempt GREEN (per project
# rules, a first-try pass means the suite wasn't hostile enough).
#
# Decisions documented per Agent A convention:
#   - W2-1 (timezone): timestamps are seeded with explicit +00:00 offsets, so
#     the stored instant is session-TZ-independent; only the implementation's
#     cast can be TZ-sensitive. Both a UTC+14 and a UTC-12 zone are used so a
#     session-TZ-dependent `::date` cast flips the boundary row in at least
#     one of them.
#   - W2-2 (isolation): the failure is injected via a trigger on quarantine
#     that fires only for source_table='compositions', so the probe is
#     independent of the order in which the implementation sweeps tables.
#     The assertions are therefore order-agnostic: the broken table must be
#     fully rolled back (no half-move), every other table must be in a fully
#     swept XOR fully intact state, never half. The call is allowed to either
#     propagate the error or swallow-and-report it.
#   - W2-5 (inverted range): the spec doesn't define start > end. Contract
#     pinned on principle: raising ValueError is the defensible behavior —
#     an inverted range is always a caller bug, and silently quarantining
#     everything non-NULL would be catastrophic on production data. If the
#     implementation silently does something else, this test SHOULD fail and
#     force a fix.
#   - W2-6 (cross-table hash): truly identical row_data JSON across two
#     tables is impossible here (column names differ: messages.content vs
#     predictions.text), so the test asserts the observable contract instead:
#     maximally-aligned rows from different tables must never collapse into
#     one quarantine row, and their content_hashes must be distinct.
# ===========================================================================


class TestSessionTimezoneIndependence:
    """W2-1: results must not depend on the connection's TIME ZONE setting."""

    @pytest.mark.parametrize("zone", ["Pacific/Kiritimati", "Etc/GMT+12"])
    def test_boundary_immune_to_session_timezone(self, db_conn, zone):
        db_conn.execute(f"SET TIME ZONE '{zone}'")
        db_conn.commit()
        try:
            bad_id = _seed_pet_event(db_conn, "tzpet", "3036-01-01T00:00:00+00:00")
            # 23:59:59 UTC on the end date. Under Pacific/Kiritimati (UTC+14)
            # a session-TZ-dependent ::date cast reads this as 2026-07-01 and
            # wrongly flags it; under Etc/GMT+12 it reads as 2026-06-30.
            keep_id = _seed_pet_event(db_conn, "tzpet", "2026-06-30T23:59:59+00:00")
            db_conn.commit()

            found = _outliers_for(find_outliers(db_conn, EXPERIMENT_START, END), "pet_events")
            assert len(found) == 1, f"session TZ {zone} changed outlier classification: {found!r}"
            _assert_outlier_carries(found[0], bad_id, datetime.date(3036, 1, 1))

            result = quarantine_outliers(db_conn, EXPERIMENT_START, END)
            assert _moved(result, "pet_events") == 1
            assert _count(db_conn, "pet_events", "id = %s", (keep_id,)) == 1, (
                f"boundary event wrongly quarantined under session TZ {zone}"
            )
        finally:
            db_conn.rollback()
            db_conn.execute("SET TIME ZONE DEFAULT")
            db_conn.commit()


class TestPerTableTransactionIsolation:
    """W2-2: a failure sweeping one table must not corrupt any table's state."""

    def test_failure_in_one_table_leaves_no_half_moved_rows(self, db_conn):
        msg_id = _seed_message(db_conn, date=datetime.date(3036, 3, 2), content="isolation probe")
        _seed_composition(db_conn, "vd-iso-comp", datetime.date(3036, 3, 2))
        db_conn.commit()

        # Fail the compositions sweep at the quarantine-insert step, whatever
        # order the implementation processes tables in.
        db_conn.execute(
            "CREATE FUNCTION vd_block_comp() RETURNS trigger AS $$ "
            "BEGIN RAISE EXCEPTION 'vd-test: blocked compositions quarantine'; END "
            "$$ LANGUAGE plpgsql"
        )
        db_conn.execute(
            "CREATE TRIGGER vd_block_comp_trg BEFORE INSERT ON quarantine "
            "FOR EACH ROW WHEN (NEW.source_table = 'compositions') "
            "EXECUTE FUNCTION vd_block_comp()"
        )
        db_conn.commit()
        try:
            raised = False
            result = None
            try:
                result = quarantine_outliers(db_conn, EXPERIMENT_START, END)
            except Exception:
                raised = True
                db_conn.rollback()

            # The broken table: fully rolled back. Row survives, nothing in
            # quarantine, no half-move in either direction.
            assert _count(db_conn, "compositions", "slug = 'vd-iso-comp'") == 1, (
                "compositions outlier deleted although its quarantine insert failed"
            )
            assert _count(db_conn, "quarantine", "source_table = 'compositions'") == 0, (
                "orphaned compositions quarantine entry despite trigger failure"
            )
            if not raised:
                assert _moved(result, "compositions") == 0, (
                    f"reported moving compositions rows it could not move: {result!r}"
                )

            # Every other table: fully swept XOR fully intact — never half.
            msg_present = _count(db_conn, "messages", "id = %s", (msg_id,))
            msg_quarantined = _count(db_conn, "quarantine", "source_table = 'messages'")
            assert (msg_present, msg_quarantined) in ((0, 1), (1, 0)), (
                f"messages left half-moved: present={msg_present}, quarantined={msg_quarantined}"
            )
        finally:
            db_conn.rollback()
            db_conn.execute("DROP TRIGGER IF EXISTS vd_block_comp_trg ON quarantine")
            db_conn.execute("DROP FUNCTION IF EXISTS vd_block_comp()")
            db_conn.commit()


class TestHashSensitivity:
    """W2-3: dedup must not collapse rows that differ in any column."""

    def test_rows_differing_only_in_metadata_both_quarantined(self, db_conn):
        common = dict(
            date=datetime.date(3036, 3, 2),
            content="same words, different row",
            direction="to_james",
            line_start=1,
            line_end=2,
        )
        _seed_message(db_conn, msg_id=888001, created_at="2026-02-01T10:00:00+00:00", **common)
        _seed_message(db_conn, msg_id=888002, created_at="2026-02-01T10:00:01+00:00", **common)
        db_conn.commit()

        result = quarantine_outliers(db_conn, EXPERIMENT_START, END)
        assert _moved(result, "messages") == 2
        assert _count(db_conn, "messages") == 0, "an outlier survived the sweep"
        assert _count(db_conn, "quarantine", "source_table = 'messages'") == 2, (
            "content-hash over-collapsed two distinct rows into one quarantine entry"
        )
        hashes = [r[0] for r in db_conn.execute("SELECT content_hash FROM quarantine").fetchall()]
        assert len(set(hashes)) == 2, f"duplicate content_hash for distinct rows: {hashes!r}"


class TestVolumeSweep:
    """W2-4: exact counts at volume, keepers and outliers interleaved."""

    N = 300

    def test_300_outliers_interleaved_with_300_keepers(self, db_conn):
        params = []
        for i in range(self.N * 2):
            if i % 2 == 0:
                params.append(
                    (datetime.date(3036, 1, 1) + datetime.timedelta(days=i % 28), f"out-{i}")
                )
            else:
                params.append(
                    (datetime.date(2026, 3, 1) + datetime.timedelta(days=i % 28), f"keep-{i}")
                )
        with db_conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO messages (direction, date, content) VALUES ('to_james', %s, %s)",
                params,
            )
        db_conn.commit()

        found = _outliers_for(find_outliers(db_conn, EXPERIMENT_START, END), "messages")
        assert len(found) == self.N, f"expected {self.N} outliers, got {len(found)}"

        result = quarantine_outliers(db_conn, EXPERIMENT_START, END)
        assert _moved(result, "messages") == self.N
        assert _count(db_conn, "messages") == self.N, "keeper count wrong after sweep"
        # NB: patterns must be bound parameters — _count always passes a
        # params sequence, so psycopg parses the WHERE string for
        # placeholders and a literal % would be a placeholder syntax error.
        assert _count(db_conn, "messages", "content LIKE %s", ("out-%",)) == 0, (
            "an outlier survived the volume sweep"
        )
        assert _count(db_conn, "messages", "content LIKE %s", ("keep-%",)) == self.N, (
            "a keeper was lost in the volume sweep"
        )
        assert _count(db_conn, "quarantine", "source_table = 'messages'") == self.N


class TestInvertedRange:
    """W2-5: start > end must raise ValueError, not sweep the world."""

    def test_find_outliers_rejects_inverted_range(self, db_conn):
        _seed_message(db_conn, date=datetime.date(2026, 3, 1), content="innocent")
        db_conn.commit()
        with pytest.raises(ValueError):
            find_outliers(db_conn, END, EXPERIMENT_START)

    def test_quarantine_outliers_rejects_inverted_range(self, db_conn):
        _seed_message(db_conn, date=datetime.date(2026, 3, 1), content="innocent")
        db_conn.commit()
        with pytest.raises(ValueError):
            quarantine_outliers(db_conn, END, EXPERIMENT_START)
        db_conn.rollback()
        # The world must be unswept.
        assert _count(db_conn, "messages") == 1, (
            "inverted range deleted in-range data before raising"
        )
        assert _count(db_conn, "quarantine") == 0


class TestCrossTableHashDistinctness:
    """W2-6: content_hash must distinguish rows from different tables."""

    def test_aligned_rows_from_two_tables_never_collapse(self, db_conn):
        shared_date = datetime.date(3036, 3, 2)
        shared_text = "identical payload"
        shared_ts = "2026-02-01T10:00:00+00:00"
        _seed_message(
            db_conn,
            msg_id=777001,
            date=shared_date,
            content=shared_text,
            created_at=shared_ts,
        )
        db_conn.execute(
            "INSERT INTO predictions (id, text, date_made, created_at) VALUES (777001, %s, %s, %s)",
            (shared_text, shared_date, shared_ts),
        )
        db_conn.commit()

        result = quarantine_outliers(db_conn, EXPERIMENT_START, END)
        assert _moved(result, "messages") == 1
        assert _moved(result, "predictions") == 1
        assert _count(db_conn, "quarantine") == 2, (
            "rows from different tables collapsed into one quarantine entry"
        )
        rows = db_conn.execute(
            "SELECT source_table, content_hash FROM quarantine ORDER BY source_table"
        ).fetchall()
        assert {r[0] for r in rows} == {"messages", "predictions"}
        assert rows[0][1] != rows[1][1], (
            "content_hash identical across tables — source_table not in the hash input"
        )


# ===========================================================================
# HARDENING WAVE 4 — concurrent-update race (adversarial council finding,
# verified against the implementation: quarantine_outliers SELECTs outlier
# rows, then DELETEs each one BY PRIMARY KEY ONLY in a separate statement,
# so the outlier predicate is not re-checked at delete time).
#
# Contract pinned: the outlier predicate must be ATOMIC with the delete.
#   - A row that no longer matches the outlier condition at delete time must
#     survive the sweep, must NOT appear in quarantine, and must not inflate
#     the per-table counts.
#   - Symmetrically, a row concurrently rewritten but STILL invalid may be
#     swept — and the quarantined copy must be the committed-at-delete-time
#     version, never the stale snapshot the sweep first read.
#
# Determinism (documented per Agent A convention):
#   The interleaving is scheduled by the Postgres lock manager, not by
#   sleeps, so the ORDER of operations is deterministic:
#     1. conn B UPDATEs the target row inside an open transaction and holds
#        the row lock WITHOUT committing. Every read the sweep performs is
#        therefore guaranteed to see the OLD committed (outlier) version —
#        the "stale read" half of the race requires no timing at all.
#     2. quarantine_outliers(conn A) runs in a worker thread on its own
#        connection. Whatever shape the implementation takes, any statement
#        that writes or write-locks the target row (DELETE, or
#        SELECT ... FOR UPDATE) must queue behind B's row lock.
#     3. The main thread polls pg_stat_activity until a backend in this
#        database is actually WAITING on a heavyweight lock, THEN commits B.
#        Under READ COMMITTED, Postgres re-evaluates only the *blocked
#        statement's own WHERE clause* against the new row version
#        (EvalPlanQual). A pk-only DELETE still matches, so the concurrent
#        update is destroyed (the bug). A delete whose WHERE carries the
#        outlier predicate — or a SELECT ... FOR UPDATE re-check — no longer
#        matches, so the row survives (the fix).
#   The poll affects liveness only (how long we wait before committing B),
#   never the order of operations. We deliberately do NOT use REPEATABLE
#   READ to stage the stale view: under RR a concurrently-modified row makes
#   BOTH the buggy pk-only DELETE and a correct predicate-carrying DELETE
#   fail with serialization_failure, which cannot distinguish them. The
#   uncommitted-writer/EPQ schedule above distinguishes them exactly.
#   Residual gap: an implementation that never touches the row at all would
#   never block; the poll then times out (10s), B is committed anyway so the
#   worker always finishes, and the post-conditions still hold vacuously.
#   The `blocked` assertion flags that situation as a test-integrity failure
#   rather than letting it become a silent vacuous pass.
# ===========================================================================


def _wait_for_lock_waiter(poll_conn, timeout=10.0):
    """Wait until some OTHER backend in this database waits on a lock.

    Polls on poll_conn, rolling back after every probe so each iteration
    opens a fresh transaction and sees fresh backend state (activity views
    are snapshotted within a transaction). Returns True when a lock waiter
    was observed, False on timeout — never raises.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        waiting = poll_conn.execute(
            "SELECT count(*) FROM pg_stat_activity"
            " WHERE datname = current_database()"
            "   AND pid <> pg_backend_pid()"
            "   AND wait_event_type = 'Lock'"
        ).fetchone()[0]
        poll_conn.rollback()
        if waiting:
            return True
        time.sleep(0.02)
    return False


class TestConcurrentUpdateRace:
    """W4: select-then-delete race — the predicate must travel with the delete."""

    VALID_NEW_DATE = datetime.date(2026, 4, 1)
    STILL_INVALID_NEW_DATE = datetime.date(3040, 1, 1)

    def _sweep_racing_update(self, db_conn, target_id, new_date):
        """Run quarantine_outliers while target_id is concurrently UPDATEd.

        The update is issued first and its lock held; it commits only once
        the sweep is observed queued behind the row lock (or after the poll
        times out, so the worker can always finish). Returns a dict:
          result   — quarantine_outliers return value (None if it raised)
          error    — exception raised by quarantine_outliers (or None)
          blocked  — whether the sweep was observed waiting on the lock
          status_a/status_b — final transaction_status of both connections
        Both extra connections are closed in the finally block.
        """
        from scripts.db import connect, get_database_name

        # Both extra connections resolve to the *_test database because
        # conftest exported HOMEDIR_TEST=1 at import time. Refuse otherwise.
        assert get_database_name().endswith("_test"), (
            "second connection would hit a non-test database"
        )

        conn_a = connect()  # the sweeper
        conn_b = connect()  # the concurrent writer
        out = {
            "result": None,
            "error": None,
            "blocked": False,
            "status_a": None,
            "status_b": None,
        }
        try:
            # Liveness cap: a broken interleaving must fail, not hang CI.
            conn_a.execute("SET statement_timeout = '30s'")
            conn_a.commit()

            # Step 1: B updates the row and HOLDS the lock (no commit yet).
            cur = conn_b.execute(
                "UPDATE messages SET date = %s WHERE id = %s",
                (new_date, target_id),
            )
            assert cur.rowcount == 1, "race setup failed: target row missing"

            # Step 2: the sweep, on its own connection, in a worker thread.
            def _sweep():
                try:
                    out["result"] = quarantine_outliers(conn_a, EXPERIMENT_START, END)
                except Exception as exc:  # captured for the caller to judge
                    out["error"] = exc
                    conn_a.rollback()

            worker = threading.Thread(target=_sweep, daemon=True)
            worker.start()

            # Step 3: commit B only once the sweep is queued on the lock.
            out["blocked"] = _wait_for_lock_waiter(db_conn)
            conn_b.commit()

            worker.join(timeout=30.0)
            if worker.is_alive():  # safety net — should be unreachable
                conn_a.cancel()
                worker.join(timeout=10.0)
            assert not worker.is_alive(), (
                "sweep thread never finished even after cancel — deadlock?"
            )

            out["status_a"] = conn_a.info.transaction_status
            out["status_b"] = conn_b.info.transaction_status
            return out
        finally:
            db_conn.rollback()  # clear any half-open poll transaction
            for c in (conn_b, conn_a):
                try:
                    if not c.closed and (
                        c.info.transaction_status != psycopg.pq.TransactionStatus.IDLE
                    ):
                        c.rollback()
                except Exception:
                    pass  # cleanup best-effort; the close below still runs
                finally:
                    try:
                        c.close()
                    except Exception:
                        pass

    def test_concurrently_validated_row_survives_and_is_not_quarantined(self, db_conn):
        """A row corrected to a VALID date after the sweep read it must not
        be deleted, must not appear in quarantine, and must not be counted —
        while a genuinely bad row in the same sweep is still moved."""
        rescued_id = _seed_message(
            db_conn, date=datetime.date(3036, 3, 2), content="rescued mid-sweep"
        )
        doomed_id = _seed_message(db_conn, date=datetime.date(3037, 1, 1), content="genuinely bad")
        db_conn.commit()

        out = self._sweep_racing_update(db_conn, rescued_id, self.VALID_NEW_DATE)

        assert out["error"] is None, f"sweep raised under a concurrent update: {out['error']!r}"
        assert out["blocked"], (
            "test-integrity failure: the sweep never queued behind the "
            "concurrent writer's row lock, so the race window was not "
            "exercised — do not trust a pass from this run"
        )

        # Lost-update check: the row survives, bearing the NEW valid date.
        row = db_conn.execute("SELECT date FROM messages WHERE id = %s", (rescued_id,)).fetchone()
        assert row is not None, (
            "LOST UPDATE: the row was concurrently corrected to a valid date "
            "but the sweep deleted it anyway — the outlier predicate is not "
            "atomic with the delete"
        )
        assert row[0] == self.VALID_NEW_DATE, (
            f"rescued row survived with the wrong date: {row[0]!r}"
        )

        # No stale copy in quarantine; only the genuine outlier moved.
        q_ids = {
            _fetch_jsonb(r[0])["id"]
            for r in db_conn.execute(
                "SELECT row_data FROM quarantine WHERE source_table = 'messages'"
            ).fetchall()
        }
        assert rescued_id not in q_ids, (
            "STALE COPY: the concurrently-validated row landed in quarantine"
        )
        assert q_ids == {doomed_id}, (
            f"quarantine holds the wrong rows: {q_ids!r} (expected only {doomed_id})"
        )
        assert _count(db_conn, "messages", "id = %s", (doomed_id,)) == 0, (
            "the genuinely bad row escaped the sweep"
        )

        # Per-table counts reflect only genuinely-swept rows.
        assert _moved(out["result"], "messages") == 1, (
            f"count includes the rescued row: {out['result']!r}"
        )

        # No leaked transactions on either side of the race.
        assert out["status_a"] == psycopg.pq.TransactionStatus.IDLE, (
            f"sweeper connection left in {out['status_a']}"
        )
        assert out["status_b"] == psycopg.pq.TransactionStatus.IDLE, (
            f"writer connection left in {out['status_b']}"
        )

    def test_concurrent_rewrite_still_invalid_quarantines_current_version(self, db_conn):
        """A row concurrently rewritten to ANOTHER invalid date may be swept,
        but what lands in quarantine must be the committed-at-delete-time
        version — archiving the stale pre-update snapshot is the named
        defect's other face."""
        target_id = _seed_message(
            db_conn, date=datetime.date(3036, 3, 2), content="rewritten mid-sweep"
        )
        db_conn.commit()

        out = self._sweep_racing_update(db_conn, target_id, self.STILL_INVALID_NEW_DATE)

        assert out["error"] is None, f"sweep raised under a concurrent update: {out['error']!r}"
        assert out["blocked"], (
            "test-integrity failure: the sweep never queued behind the "
            "concurrent writer's row lock — race window not exercised"
        )

        # Still invalid at delete time, so the sweep may (must) take it.
        assert _count(db_conn, "messages", "id = %s", (target_id,)) == 0, (
            "row invalid both before and after the concurrent rewrite survived the sweep"
        )
        rows = db_conn.execute(
            "SELECT row_data FROM quarantine WHERE source_table = 'messages'"
        ).fetchall()
        assert len(rows) == 1, f"expected exactly 1 quarantined row, got {len(rows)}"
        row_data = _fetch_jsonb(rows[0][0])
        assert row_data["id"] == target_id
        assert "3040-01-01" in str(row_data["date"]), (
            f"quarantine archived the STALE pre-update snapshot "
            f"(date={row_data['date']!r}); the delete-time version "
            f"({self.STILL_INVALID_NEW_DATE.isoformat()}) is what must be "
            f"quarantined"
        )
        assert _moved(out["result"], "messages") == 1

        # No leaked transactions on either side of the race.
        assert out["status_a"] == psycopg.pq.TransactionStatus.IDLE
        assert out["status_b"] == psycopg.pq.TransactionStatus.IDLE
