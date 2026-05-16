"""Hostile security and edge-case tests for extract_sessions.py.

These tests target specific vulnerabilities found by security review.
Each test class focuses on a distinct attack vector and is expected to
FAIL against the current implementation until fixes are applied.
"""

import json
import datetime
import os

import pytest
import psycopg

from scripts.extract_sessions import (
    parse_activity_log,
    parse_session_log,
    classify_file_operation,
    detect_version,
    compute_output_flags,
    store_session,
    extract_all,
    _categorize_path,
    _classify_bash,
    _extract_web_query,
)

# Null byte as a runtime constant -- cannot be embedded as a literal
# in Python source without causing SyntaxError on compilation.
NUL = chr(0)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _jsonl_line(**kwargs):
    return json.dumps(kwargs)


def _make_session_lines(session_id, start_time="10:00:00", end_time="10:05:00", tools=None):
    """Build JSONL lines for one complete session."""
    lines = [_jsonl_line(ts=start_time, event="session_start", s=session_id, cwd="/home/claude")]
    for tool in (tools or []):
        lines.append(_jsonl_line(ts=tool.get("ts", "10:01:00"), event="tool", s=session_id,
                                 t=tool["t"], i=tool["i"]))
    lines.append(_jsonl_line(ts=end_time, event="session_end", s=session_id))
    return lines


def _write_jsonl(tmp_path, filename, lines):
    p = tmp_path / filename
    p.write_text("\n".join(lines) + "\n")
    return p


def _make_session_dict(**overrides):
    """Build a minimal session dict for store_session."""
    base = {
        "session_id": "hostile-test-01",
        "date": datetime.date(2026, 3, 15),
        "time_of_day": "AM",
        "version": "4.6",
        "timestamp_start": datetime.datetime(2026, 3, 15, 10, 0, 0,
                                              tzinfo=datetime.timezone.utc),
        "turns": 3,
        "source_type": "jsonl",
        "source_file": "activity-2026-03-15.jsonl",
        "wrote_composition": False,
        "wrote_private_journal": False,
        "updated_memory": False,
        "messaged_james": False,
        "wrote_prediction": False,
        "file_operations": [],
        "web_searches": [],
    }
    base.update(overrides)
    return base


# ===========================================================================
# 1. TRANSACTION INTEGRITY -- partial insert corruption
# ===========================================================================

class TestTransactionIntegrity:
    """store_session does not wrap inserts in a transaction.  If a
    file_operation INSERT fails (e.g. invalid direction), the sessions
    row must also be rolled back -- it must not be left orphaned."""

    def test_invalid_direction_rolls_back_session_row(self, db_conn):
        """A file_operation with direction='delete' violates the CHECK
        constraint.  The entire store_session call must be atomic: the
        sessions row must NOT survive if the file_operation fails."""
        session = _make_session_dict(
            session_id="txn-rollback-01",
            file_operations=[
                {
                    "path": "/home/claude/notes/daily/2026-03-15.md",
                    "category": "daily_notes",
                    "method": "Write",
                    "direction": "write",
                    "ordinal": 0,
                },
                {
                    "path": "/home/claude/writing/evil.md",
                    "category": "writing",
                    "method": "Write",
                    "direction": "delete",  # invalid -- violates CHECK constraint
                    "ordinal": 1,
                },
            ],
        )

        # The insert should either raise cleanly or silently skip, but
        # the sessions row must NOT be orphaned in the DB.
        try:
            store_session(db_conn, session)
        except Exception:
            # Reset the connection after error so subsequent queries work
            db_conn.rollback()

        # The session row must NOT exist if the file_operation failed
        row = db_conn.execute(
            "SELECT 1 FROM sessions WHERE id = %s", ("txn-rollback-01",)
        ).fetchone()
        assert row is None, (
            "Session row was orphaned in the DB after file_operation INSERT "
            "failed -- store_session lacks proper transaction wrapping"
        )

    def test_invalid_web_search_rolls_back_everything(self, db_conn):
        """If a web_search INSERT fails after sessions and file_operations
        succeeded, all three must be rolled back."""
        # We force a web_search failure by inserting a null byte that
        # Postgres rejects in TEXT columns.
        session = _make_session_dict(
            session_id="txn-rollback-02",
            file_operations=[
                {
                    "path": "/home/claude/writing/ok.md",
                    "category": "writing",
                    "method": "Write",
                    "direction": "write",
                    "ordinal": 0,
                },
            ],
            web_searches=["valid query first", "query with " + NUL + " null byte"],
        )

        try:
            store_session(db_conn, session)
        except Exception:
            db_conn.rollback()

        row = db_conn.execute(
            "SELECT 1 FROM sessions WHERE id = %s", ("txn-rollback-02",)
        ).fetchone()
        assert row is None, (
            "Session row was orphaned after web_search INSERT failed"
        )

    def test_partial_file_ops_not_committed_on_failure(self, db_conn):
        """If the second file_operation fails, the first one must also
        be rolled back -- no partial file_operations left behind."""
        session = _make_session_dict(
            session_id="txn-rollback-03",
            file_operations=[
                {
                    "path": "/home/claude/writing/good.md",
                    "category": "writing",
                    "method": "Write",
                    "direction": "write",
                    "ordinal": 0,
                },
                {
                    "path": "/home/claude/writing/bad.md",
                    "category": "writing",
                    "method": "Write",
                    "direction": "INVALID",
                    "ordinal": 1,
                },
            ],
        )

        try:
            store_session(db_conn, session)
        except Exception:
            db_conn.rollback()

        count = db_conn.execute(
            "SELECT COUNT(*) FROM file_operations WHERE session_id = %s",
            ("txn-rollback-03",),
        ).fetchone()[0]
        assert count == 0, (
            "Partial file_operations were left behind after a later INSERT failed"
        )

    def test_commit_not_called_before_all_inserts_complete(self, db_conn):
        """Verify that if the third file_operation (out of 3) fails, the
        session row AND the first two file_operations are all absent.
        This catches the bug where conn.commit() is called once at the
        end rather than wrapping everything in a savepoint/transaction."""
        session = _make_session_dict(
            session_id="txn-rollback-04",
            file_operations=[
                {
                    "path": "/home/claude/writing/ok1.md",
                    "category": "writing",
                    "method": "Write",
                    "direction": "write",
                    "ordinal": 0,
                },
                {
                    "path": "/home/claude/writing/ok2.md",
                    "category": "writing",
                    "method": "Write",
                    "direction": "write",
                    "ordinal": 1,
                },
                {
                    "path": "/home/claude/writing/boom.md",
                    "category": "writing",
                    "method": "Write",
                    "direction": "nope",  # invalid
                    "ordinal": 2,
                },
            ],
        )
        try:
            store_session(db_conn, session)
        except Exception:
            db_conn.rollback()

        # Both session and file_ops must be absent
        session_row = db_conn.execute(
            "SELECT 1 FROM sessions WHERE id = %s", ("txn-rollback-04",)
        ).fetchone()
        file_ops_count = db_conn.execute(
            "SELECT COUNT(*) FROM file_operations WHERE session_id = %s",
            ("txn-rollback-04",),
        ).fetchone()[0]
        assert session_row is None, "Session row orphaned after third file_op failed"
        assert file_ops_count == 0, (
            "First two file_operations survived despite third failing"
        )


# ===========================================================================
# 2. NULL BYTES IN INPUT
# ===========================================================================

class TestNullBytes:
    """Python json.loads happily preserves null bytes but PostgreSQL TEXT
    columns reject them with a DataError.  The pipeline must either
    strip them or raise a clear application-level error."""

    def test_null_byte_in_session_id_rejected(self, db_conn):
        """A session_id containing a null byte must be stripped or
        rejected before hitting the DB."""
        session = _make_session_dict(
            session_id="null" + NUL + "session",
        )
        # Must either raise a clear ValueError/sanitization error,
        # or strip the null byte and succeed -- NOT a raw psycopg DataError
        try:
            store_session(db_conn, session)
            # If it succeeded, the null byte must have been stripped
            row = db_conn.execute(
                "SELECT id FROM sessions WHERE id LIKE %s", ("null%session%",)
            ).fetchone()
            assert row is not None
            assert NUL not in row[0], "Null byte was stored verbatim in session_id"
        except psycopg.errors.DataError:
            db_conn.rollback()
            pytest.fail(
                "Raw psycopg DataError escaped -- pipeline must sanitize "
                "null bytes before DB insertion"
            )
        except (ValueError, TypeError):
            pass  # A clear application-level error is acceptable

    def test_null_byte_in_file_path_rejected(self, db_conn):
        """A file path with a null byte must be sanitized before INSERT."""
        session = _make_session_dict(
            session_id="nullpath-01",
            file_operations=[
                {
                    "path": "/home/claude/writing/test" + NUL + ".md",
                    "category": "writing",
                    "method": "Write",
                    "direction": "write",
                    "ordinal": 0,
                },
            ],
        )
        try:
            store_session(db_conn, session)
            row = db_conn.execute(
                "SELECT path FROM file_operations WHERE session_id = %s",
                ("nullpath-01",),
            ).fetchone()
            assert row is not None
            assert NUL not in row[0], "Null byte stored in file path"
        except psycopg.errors.DataError:
            db_conn.rollback()
            pytest.fail(
                "Raw psycopg DataError from null byte in file path -- "
                "pipeline must sanitize"
            )

    def test_null_byte_in_web_search_query_rejected(self, db_conn):
        """A web search query with a null byte must be sanitized."""
        session = _make_session_dict(
            session_id="nullws-01",
            web_searches=["search with " + NUL + " null"],
        )
        try:
            store_session(db_conn, session)
            row = db_conn.execute(
                "SELECT query FROM web_searches WHERE session_id = %s",
                ("nullws-01",),
            ).fetchone()
            assert row is not None
            assert NUL not in row[0], "Null byte stored in web search query"
        except psycopg.errors.DataError:
            db_conn.rollback()
            pytest.fail(
                "Raw psycopg DataError from null byte in web search query"
            )

    def test_null_byte_in_jsonl_tool_input_sanitized(self, tmp_path):
        """Null bytes in JSONL tool input paths must be caught during parsing."""
        path_with_null = "/home/claude/writing/test" + NUL + ".md"
        lines = _make_session_lines(
            "nulljsonl-01",
            tools=[{"t": "Read", "i": path_with_null, "ts": "10:01:00"}],
        )
        p = tmp_path / "activity-2026-05-01.jsonl"
        p.write_text("\n".join(lines) + "\n")
        sessions = parse_activity_log(p)

        assert len(sessions) == 1
        # The tool input should have null bytes stripped
        tool_input = sessions[0]["tool_events"][0]["i"]
        assert NUL not in tool_input, (
            "Null byte preserved in parsed tool input -- will crash on DB insert"
        )

    def test_null_byte_in_source_file_field(self, db_conn):
        """A null byte in the source_file field must be sanitized."""
        session = _make_session_dict(
            session_id="nullsrc-01",
            source_file="activity-2026-03-15" + NUL + ".jsonl",
        )
        try:
            store_session(db_conn, session)
            row = db_conn.execute(
                "SELECT source_file FROM sessions WHERE id = %s",
                ("nullsrc-01",),
            ).fetchone()
            assert row is not None
            assert NUL not in row[0], "Null byte stored in source_file"
        except psycopg.errors.DataError:
            db_conn.rollback()
            pytest.fail("Raw DataError from null byte in source_file")


# ===========================================================================
# 3. PATH TRAVERSAL
# ===========================================================================

class TestPathTraversal:
    """_categorize_path and _classify_bash do no path canonicalization.
    Paths with ../ can escape /home/claude/ while still matching as
    valid /home/claude paths."""

    def test_traversal_escapes_home_claude_via_read(self):
        """cat /home/claude/../../etc/passwd starts with /home/claude but
        resolves to /etc/passwd.  Must NOT be classified as a valid
        /home/claude read."""
        result = classify_file_operation(
            "Bash", "cat /home/claude/../../etc/passwd"
        )
        # Either None (rejected) or the path must be canonicalized
        if result is not None:
            path, category, direction = result
            # After canonicalization, this resolves to /etc/passwd
            # which is NOT under /home/claude
            assert ".." not in path, (
                "Path traversal stored raw: {}".format(path)
            )
            # If it somehow still classifies, it must not resolve to /etc/passwd
            assert "/etc/passwd" not in path

    def test_traversal_in_writing_subdir(self):
        """Path /home/claude/writing/../../../etc/shadow must NOT be
        classified as 'writing'."""
        result = classify_file_operation(
            "Read", "/home/claude/writing/../../../etc/shadow"
        )
        if result is not None:
            path, category, direction = result
            assert category != "writing", (
                "Path traversal falsely classified as 'writing'"
            )
            assert ".." not in path, "Traversal stored raw: {}".format(path)

    def test_traversal_in_bash_redirect(self):
        """echo data >> /home/claude/notes/../../../etc/crontab must
        NOT be classified as a notes write."""
        result = _classify_bash(
            'echo "pwned" >> /home/claude/notes/../../../etc/crontab'
        )
        if result is not None:
            path, category, direction = result
            assert category != "daily_notes", (
                "Path traversal falsely classified as notes category"
            )
            assert ".." not in path

    def test_categorize_path_rejects_traversal(self):
        """Direct call to _categorize_path with traversal."""
        cat = _categorize_path("/home/claude/../../etc/passwd")
        # This should NOT match any /home/claude category rules
        # After resolving ../, it's /etc/passwd -- should be "other" at best
        # but ideally the function should canonicalize first
        assert cat == "other" or cat is None, (
            "Traversal path got category '{}' instead of 'other'".format(cat)
        )

    def test_traversal_through_writing_to_shadow(self):
        """Path that starts in writing/ but escapes: the 'writing/' substring
        matches but the real resolved path is /etc/shadow."""
        path = "/home/claude/writing/../../../etc/shadow"
        # _categorize_path sees "writing/" substring and returns "writing"
        # but the resolved path is /etc/shadow
        cat = _categorize_path(path)
        assert cat != "writing", (
            "Path '{}' classified as 'writing' despite resolving to /etc/shadow".format(path)
        )

    def test_traversal_through_private_to_etc(self):
        """Path that traverses through private/ to reach /etc/."""
        path = "/home/claude/private/../../etc/passwd"
        cat = _categorize_path(path)
        # This contains "private/" so it matches private_journal
        # but it resolves to /etc/passwd
        assert cat != "private_journal", (
            "Path resolving to /etc/passwd classified as private_journal"
        )

    def test_double_encoded_traversal(self):
        """Path with double dots that looks harmless but resolves out of tree."""
        # /home/claude/notes/daily/../../writing/../../../etc/hosts
        # resolves to /etc/hosts
        result = classify_file_operation(
            "Read",
            "/home/claude/notes/daily/../../writing/../../../etc/hosts"
        )
        if result is not None:
            path, category, _ = result
            assert ".." not in path, "Double-traversal stored raw"
            assert category not in ("daily_notes", "writing"), (
                "Multi-hop traversal to /etc/hosts got category '{}'".format(category)
            )


# ===========================================================================
# 4. IDEMPOTENCY / RACE CONDITIONS
# ===========================================================================

class TestIdempotency:
    """store_session uses SELECT-then-INSERT for deduplication.  This is
    not atomic and can lead to duplicate file_operations if re-run."""

    def test_double_store_does_not_duplicate_file_ops(self, db_conn):
        """Calling store_session twice with the same session must not
        produce duplicate file_operations."""
        session = _make_session_dict(
            session_id="idempotent-01",
            file_operations=[
                {
                    "path": "/home/claude/writing/essay.md",
                    "category": "writing",
                    "method": "Write",
                    "direction": "write",
                    "ordinal": 0,
                },
            ],
            web_searches=["test query"],
        )
        store_session(db_conn, session)
        store_session(db_conn, session)  # second call

        ops_count = db_conn.execute(
            "SELECT COUNT(*) FROM file_operations WHERE session_id = %s",
            ("idempotent-01",),
        ).fetchone()[0]
        assert ops_count == 1, (
            "Expected 1 file_operation, got {} -- "
            "duplicate inserted on re-run".format(ops_count)
        )

    def test_double_store_does_not_duplicate_web_searches(self, db_conn):
        """Same session stored twice must not duplicate web_searches."""
        session = _make_session_dict(
            session_id="idempotent-02",
            web_searches=["query one", "query two"],
        )
        store_session(db_conn, session)
        store_session(db_conn, session)

        ws_count = db_conn.execute(
            "SELECT COUNT(*) FROM web_searches WHERE session_id = %s",
            ("idempotent-02",),
        ).fetchone()[0]
        assert ws_count == 2, (
            "Expected 2 web_searches, got {} -- duplicated on re-run".format(ws_count)
        )

    def test_extract_all_rerun_no_duplicate_file_ops(self, tmp_path, db_conn):
        """Running extract_all twice must not duplicate file_operations."""
        activity_dir = tmp_path / "activity"
        activity_dir.mkdir()
        session_log_dir = tmp_path / "logs"
        session_log_dir.mkdir()

        lines = _make_session_lines(
            "rerun-01",
            tools=[
                {"t": "Write", "i": "/home/claude/writing/essay.md", "ts": "10:01:00"},
                {"t": "Read", "i": "/home/claude/notes/daily/2026-05-01.md", "ts": "10:02:00"},
            ],
        )
        _write_jsonl(activity_dir, "activity-2026-05-01.jsonl", lines)

        extract_all(activity_dir, session_log_dir, db_conn)
        extract_all(activity_dir, session_log_dir, db_conn)

        ops_count = db_conn.execute(
            "SELECT COUNT(*) FROM file_operations WHERE session_id = %s",
            ("rerun-01",),
        ).fetchone()[0]
        assert ops_count == 2, (
            "Expected 2 file_operations, got {} after double extract_all".format(ops_count)
        )

    def test_partial_failure_then_retry_is_clean(self, db_conn):
        """If the first store_session call partially fails (session row
        inserted but file_op fails), a retry must either succeed cleanly
        or fail cleanly -- not leave double session rows or duplicate ops."""
        # First attempt: has an invalid file_op that will fail
        session_bad = _make_session_dict(
            session_id="retry-01",
            file_operations=[
                {
                    "path": "/home/claude/writing/essay.md",
                    "category": "writing",
                    "method": "Write",
                    "direction": "write",
                    "ordinal": 0,
                },
                {
                    "path": "/home/claude/writing/bad.md",
                    "category": "writing",
                    "method": "Write",
                    "direction": "INVALID",  # will fail CHECK constraint
                    "ordinal": 1,
                },
            ],
        )
        try:
            store_session(db_conn, session_bad)
        except Exception:
            db_conn.rollback()

        # Now retry with a corrected session
        session_good = _make_session_dict(
            session_id="retry-01",
            file_operations=[
                {
                    "path": "/home/claude/writing/essay.md",
                    "category": "writing",
                    "method": "Write",
                    "direction": "write",
                    "ordinal": 0,
                },
            ],
        )
        store_session(db_conn, session_good)

        # Verify exactly 1 session row and 1 file_op
        session_count = db_conn.execute(
            "SELECT COUNT(*) FROM sessions WHERE id = %s", ("retry-01",)
        ).fetchone()[0]
        ops_count = db_conn.execute(
            "SELECT COUNT(*) FROM file_operations WHERE session_id = %s",
            ("retry-01",),
        ).fetchone()[0]
        assert session_count == 1, "Duplicate session rows after retry"
        assert ops_count == 1, (
            "Expected 1 file_op after retry, got {}".format(ops_count)
        )


# ===========================================================================
# 5. CATEGORY SUBSTRING FALSE POSITIVES
# ===========================================================================

class TestCategorySubstringFalsePositives:
    """_categorize_path uses `if pattern in path` which matches substrings
    inside words, causing false positives."""

    def test_unpredictable_not_predictions(self):
        """'prediction' is a substring of 'unpredictable-futures' -- the file
        is in writing/, not notes/predictions/.  The word 'prediction' appears
        in the filename 'unpredictable-futures' because 'prediction' is a
        substring of... wait, 'unpredictable' does NOT contain 'prediction'.
        But 'prediction-review' DOES.  Testing both."""
        # This one: "prediction" IS present in the path via the filename
        result = classify_file_operation(
            "Write", "/home/claude/writing/prediction-outcomes.md"
        )
        assert result is not None
        _, category, _ = result
        assert category == "writing", (
            "Expected 'writing', got '{}' -- "
            "'prediction' substring in filename overrode 'writing/' directory".format(category)
        )

    def test_prediction_review_in_daily_notes(self):
        """/home/claude/notes/daily/prediction-review.md is under notes/daily/
        and must be 'daily_notes', not 'predictions'."""
        cat = _categorize_path("/home/claude/notes/daily/prediction-review.md")
        assert cat == "daily_notes", (
            "Expected 'daily_notes', got '{}' -- "
            "'prediction' in filename overrode 'notes/daily/' path match".format(cat)
        )

    def test_experimental_methods_is_learning(self):
        """/home/claude/learning/experimental-methods.md is under learning/.
        'experiments/' would NOT match because it needs the slash, but
        'experiment' as a substring could cause issues in future rules."""
        cat = _categorize_path("/home/claude/learning/experimental-methods.md")
        assert cat == "learning", (
            "Expected 'learning', got '{}' -- "
            "substring match from 'experimental'".format(cat)
        )

    def test_about_memory_in_conversations(self):
        """/home/claude/conversations/about-memory.md is under conversations/.
        The substring 'memory/' is NOT present (no trailing slash after 'memory')
        but 'MEMORY' IS a rule and 'memory' in 'about-memory' could match
        'memory/' if the path had a slash after it. Testing both rules."""
        # 'memory/' is at index 8 in rules, 'conversations/' at index 13
        # 'memory/' NOT in '/home/claude/conversations/about-memory.md' (no slash after memory)
        # But 'MEMORY' is also a rule -- 'MEMORY' is not in this path (case-sensitive)
        cat = _categorize_path("/home/claude/conversations/about-memory.md")
        assert cat == "conversations", (
            "Expected 'conversations', got '{}' -- "
            "some memory rule overrode 'conversations/' match".format(cat)
        )

    def test_thoughts_on_writing_in_notes_daily(self):
        """/home/claude/notes/daily/thoughts-on-writing.md is under notes/daily/.
        'thoughts' substring must not match 'thoughts' category."""
        cat = _categorize_path("/home/claude/notes/daily/thoughts-on-writing.md")
        assert cat == "daily_notes", (
            "Expected 'daily_notes', got '{}' -- "
            "'thoughts' substring matched from filename".format(cat)
        )

    def test_memory_lane_in_writing(self):
        """'/home/claude/writing/memory-lane.md' -- 'memory/' is NOT a substring
        (no slash after 'memory' in the path), but 'MEMORY' is also a rule.
        Must be 'writing' not 'memory_files'."""
        cat = _categorize_path("/home/claude/writing/memory-lane.md")
        assert cat == "writing", (
            "Expected 'writing', got '{}' -- memory rule matched in writing/ path".format(cat)
        )

    def test_path_with_prediction_as_directory(self):
        """'/home/claude/prediction-tracker/data.md' -- contains 'prediction'
        substring but is NOT under notes/predictions/. Must be 'other' or
        at least not 'predictions' since it's its own directory."""
        cat = _categorize_path("/home/claude/prediction-tracker/data.md")
        # The 'prediction' rule at index 6 matches as substring
        # This is a false positive: it's a separate directory, not notes/predictions/
        assert cat != "predictions", (
            "Expected 'other' for standalone prediction-tracker/ dir, "
            "got 'predictions' -- substring match is too greedy"
        )

    def test_thoughts_directory_in_experiments(self):
        """'/home/claude/experiments/thoughts-experiment/log.md' -- contains
        'experiments/' (matches at index 11) and 'thoughts' (matches at index 7).
        Since experiments/ appears in the rule list AFTER thoughts, this tests
        whether rule ordering causes 'thoughts' to win."""
        cat = _categorize_path("/home/claude/experiments/thoughts-experiment/log.md")
        assert cat == "experiments", (
            "Expected 'experiments', got '{}' -- "
            "'thoughts' substring in subdirectory overrode 'experiments/' match".format(cat)
        )


# ===========================================================================
# 6. CATEGORY RULE ORDERING SHADOWS
# ===========================================================================

class TestCategoryOrdering:
    """Rule order in _CATEGORY_RULES determines which category wins when
    a path matches multiple patterns.  These tests verify the path's
    primary directory takes precedence."""

    def test_writing_private_draft(self):
        """/home/claude/writing/private/draft.md -- the primary directory
        is writing/, so it must be 'writing', NOT 'private_journal'.
        But 'private/' appears at index 2 and 'writing/' at index 3,
        so 'private/' matches first in the linear scan."""
        cat = _categorize_path("/home/claude/writing/private/draft.md")
        assert cat == "writing", (
            "Expected 'writing', got '{}' -- "
            "'private/' rule shadowed 'writing/' despite writing being "
            "the primary directory".format(cat)
        )

    def test_private_writing_is_private(self):
        """/home/claude/private/writing/secret-essay.md -- primary dir is
        private/, so it must be 'private_journal'."""
        cat = _categorize_path("/home/claude/private/writing/secret-essay.md")
        assert cat == "private_journal", (
            "Expected 'private_journal', got '{}'".format(cat)
        )

    def test_daily_notes_thoughts_on_memory(self):
        """/home/claude/notes/daily/thoughts-on-memory.md -- primary dir is
        notes/daily/, must be 'daily_notes', not 'thoughts' or 'memory_files'."""
        cat = _categorize_path("/home/claude/notes/daily/thoughts-on-memory.md")
        assert cat == "daily_notes", (
            "Expected 'daily_notes', got '{}' -- "
            "substring match overrode path-based match".format(cat)
        )

    def test_experiments_memory_test(self):
        """/home/claude/experiments/memory-test/log.md -- primary dir is
        experiments/, must be 'experiments', not 'memory_files'.
        'memory/' (with slash) would match 'memory-test/' as substring."""
        cat = _categorize_path("/home/claude/experiments/memory-test/log.md")
        assert cat == "experiments", (
            "Expected 'experiments', got '{}' -- "
            "'memory/' in subdirectory name overrode 'experiments/' match".format(cat)
        )

    def test_writing_memory_essay(self):
        """/home/claude/writing/memory-and-identity.md -- primary dir is
        writing/, must be 'writing', not 'memory_files'.
        Tests that 'memory/' substring in the filename (no trailing slash)
        doesn't match the 'memory/' rule."""
        cat = _categorize_path("/home/claude/writing/memory-and-identity.md")
        assert cat == "writing", (
            "Expected 'writing', got '{}' -- "
            "'memory' substring in filename overrode 'writing/' directory".format(cat)
        )

    def test_learning_memory_techniques(self):
        """/home/claude/learning/memory-techniques.md -- learning/ is the
        primary dir but 'memory/' rule comes before 'learning/' in the list.
        Must be 'learning', not 'memory_files'."""
        # 'memory/' is at index 8, 'learning/' at index 10
        # 'memory/' is in 'memory-techniques' only if there's a slash...
        # Actually 'memory/' is NOT in 'learning/memory-techniques.md'
        # because it would be 'memory-' not 'memory/'
        # But let's test with a subdir: learning/memory/review.md
        cat = _categorize_path("/home/claude/learning/memory/review.md")
        assert cat == "learning", (
            "Expected 'learning', got '{}' -- "
            "'memory/' subdirectory in learning/ overrode 'learning/' match".format(cat)
        )

    def test_conversations_about_thoughts(self):
        """/home/claude/conversations/thoughts-exchange.md -- 'thoughts' rule
        is at index 7, 'conversations/' at index 13. 'thoughts' appears
        as substring in the filename. Must be 'conversations'."""
        cat = _categorize_path("/home/claude/conversations/thoughts-exchange.md")
        assert cat == "conversations", (
            "Expected 'conversations', got '{}' -- "
            "'thoughts' substring matched before 'conversations/' directory".format(cat)
        )


# ===========================================================================
# 7. BASH REGEX FRAGILITY
# ===========================================================================

class TestBashRegex:
    """The bash parser uses simple regexes that break on quoted paths,
    pipe chains, file descriptor redirects, and other common patterns."""

    def test_quoted_path_with_spaces(self):
        """cat with a quoted path containing spaces must extract the
        full path, not truncate at the space."""
        result = _classify_bash('cat "/home/claude/writing/my important draft.md"')
        assert result is not None, "Quoted path with spaces was not detected"
        path, category, direction = result
        # Path must contain the full filename, not be truncated
        assert "important draft.md" in path, (
            "Path truncated at space: got '{}'".format(path)
        )
        assert category == "writing"
        assert direction == "read"

    def test_redirect_inside_quotes_not_misread(self):
        """echo "score > 5" >> /home/claude/notes/log.md -- the > inside
        quotes is not a redirect.  Must classify as write to notes/log.md."""
        result = _classify_bash('echo "score > 5" >> /home/claude/notes/log.md')
        assert result is not None
        path, category, direction = result
        assert direction == "write"
        # The path must be the notes file, not something extracted from
        # the quoted content
        assert "notes/log.md" in path, (
            "Extracted wrong path: '{}' -- matched > inside quotes".format(path)
        )

    def test_grep_classified_as_read(self):
        """grep -r 'pattern' /home/claude/writing/ is a read-like operation."""
        result = _classify_bash("grep -r 'pattern' /home/claude/writing/essay.md")
        assert result is not None, (
            "grep command not detected as file operation"
        )
        _, _, direction = result
        assert direction == "read"

    def test_cat_piped_to_head(self):
        """cat /home/claude/notes/daily/2026-01-15.md | head -5 must
        classify as a read of the notes file."""
        result = _classify_bash(
            "cat /home/claude/notes/daily/2026-01-15.md | head -5"
        )
        assert result is not None
        path, category, direction = result
        assert "notes/daily/2026-01-15.md" in path
        assert direction == "read"

    def test_fd_redirect_does_not_confuse_parser(self):
        """2>/dev/null cat /home/claude/writing/test.md -- the file
        descriptor redirect must not confuse the path extraction."""
        result = _classify_bash("2>/dev/null cat /home/claude/writing/test.md")
        assert result is not None, (
            "File descriptor redirect confused the parser"
        )
        path, category, direction = result
        assert "writing/test.md" in path
        assert direction == "read"

    def test_tee_command_classified_as_write(self):
        """echo 'data' | tee /home/claude/notes/log.md is a write."""
        result = _classify_bash("echo 'data' | tee /home/claude/notes/log.md")
        # tee writes to a file; this should be detected
        assert result is not None, "tee command not detected as file operation"
        _, _, direction = result
        assert direction == "write"

    def test_single_quoted_path_with_spaces(self):
        """cat with single-quoted path containing spaces must extract full path."""
        result = _classify_bash("cat '/home/claude/writing/my draft.md'")
        assert result is not None, "Single-quoted path with spaces not detected"
        path, _, _ = result
        assert "my draft.md" in path, (
            "Single-quoted path truncated at space: got '{}'".format(path)
        )

    def test_heredoc_redirect_not_file_write(self):
        """cat << EOF should not classify EOF as a file path.
        And the >> in the heredoc content must not cause false matches."""
        result = _classify_bash("cat << 'EOF'\nsome text >> /home/claude/writing/x.md\nEOF")
        # This should either be None or at worst extract the cat, not the path
        # inside the heredoc
        if result is not None:
            path, _, direction = result
            # If it matched something, it must not be the heredoc content
            assert direction != "write" or "writing/x.md" not in path, (
                "Heredoc content falsely classified as file write"
            )

    def test_mv_command_not_detected(self):
        """mv is a file operation (rename/move) but the current regex only
        handles cat/head/tail and redirects. This documents the gap."""
        result = _classify_bash(
            "mv /home/claude/writing/draft.md /home/claude/writing/final.md"
        )
        # Current implementation won't detect this -- that's a known gap
        # This test documents it but doesn't fail on it (it's a detection
        # gap, not a misclassification)

    def test_cp_command_write_detection(self):
        """cp src dst is a write to dst. Current regex misses this."""
        result = _classify_bash(
            "cp /home/claude/writing/draft.md /home/claude/writing/backup.md"
        )
        # cp is a write to the destination; current regex won't catch it
        # This test documents the gap
        if result is not None:
            _, _, direction = result
            # If somehow detected, the destination should be a write
            assert direction in ("read", "write")

    def test_backtick_in_path_not_executed(self):
        """Backticks in a path should not cause code execution concerns in
        the regex parser (they don't, but the extracted path is garbage)."""
        result = _classify_bash("cat /home/claude/notes/`date +%F`.md")
        if result is not None:
            path, _, _ = result
            # The path should contain the literal backtick expression,
            # not be silently dropped
            assert "/home/claude/notes/" in path


# ===========================================================================
# 8. TIME-OF-DAY EDGE CASES
# ===========================================================================

class TestTimeOfDayEdgeCases:
    """time_of_day is derived from the first event timestamp.  Edge cases
    around sub-second precision, noon boundary, and parse failures."""

    def test_subsecond_timestamp_parsed_as_pm(self, tmp_path):
        """Timestamp '22:30:45.123' with sub-second precision must
        parse as PM, not default to AM on parse failure."""
        lines = _make_session_lines(
            "subsec-01",
            start_time="22:30:45.123",
            end_time="22:45:00",
            tools=[{"t": "Read", "i": "/home/claude/notes/daily/2026-05-01.md",
                     "ts": "22:31:00"}],
        )
        p = _write_jsonl(tmp_path, "activity-2026-05-01.jsonl", lines)
        sessions = parse_activity_log(p)

        assert len(sessions) == 1
        assert sessions[0]["time_of_day"] == "PM", (
            "Got '{}' -- sub-second timestamp "
            "may have caused parse failure defaulting to AM".format(
                sessions[0]["time_of_day"])
        )

    def test_morning_timestamp_is_am(self, tmp_path):
        """Timestamp '09:15:00' must be AM."""
        lines = _make_session_lines(
            "morning-01",
            start_time="09:15:00",
            end_time="09:30:00",
        )
        p = _write_jsonl(tmp_path, "activity-2026-05-01.jsonl", lines)
        sessions = parse_activity_log(p)

        assert sessions[0]["time_of_day"] == "AM"

    def test_noon_exactly_is_pm(self, tmp_path):
        """Timestamp '12:00:00' is exactly noon and must be PM."""
        lines = _make_session_lines(
            "noon-01",
            start_time="12:00:00",
            end_time="12:30:00",
        )
        p = _write_jsonl(tmp_path, "activity-2026-05-01.jsonl", lines)
        sessions = parse_activity_log(p)

        assert sessions[0]["time_of_day"] == "PM", (
            "12:00:00 classified as AM -- noon is PM"
        )

    def test_microsecond_precision_timestamp(self, tmp_path):
        """Timestamp '14:30:00.123456' with microsecond precision must
        still parse correctly as PM."""
        lines = _make_session_lines(
            "micro-01",
            start_time="14:30:00.123456",
            end_time="15:00:00",
        )
        p = _write_jsonl(tmp_path, "activity-2026-05-01.jsonl", lines)
        sessions = parse_activity_log(p)

        assert sessions[0]["time_of_day"] == "PM"

    def test_midnight_is_am(self, tmp_path):
        """Timestamp '00:00:00' is midnight and must be AM."""
        lines = _make_session_lines(
            "midnight-01",
            start_time="00:00:00",
            end_time="00:30:00",
        )
        p = _write_jsonl(tmp_path, "activity-2026-05-01.jsonl", lines)
        sessions = parse_activity_log(p)

        assert sessions[0]["time_of_day"] == "AM"

    def test_11_59_am_is_am(self, tmp_path):
        """Timestamp '11:59:59' is one second before noon and must be AM."""
        lines = _make_session_lines(
            "1159-01",
            start_time="11:59:59",
            end_time="12:05:00",
        )
        p = _write_jsonl(tmp_path, "activity-2026-05-01.jsonl", lines)
        sessions = parse_activity_log(p)

        assert sessions[0]["time_of_day"] == "AM"

    def test_subsecond_am_timestamp_not_default(self, tmp_path):
        """Timestamp '06:30:00.999' must parse as AM and NOT default to AM
        because the parse succeeded -- verify start_time is set correctly."""
        lines = _make_session_lines(
            "subsec-am-01",
            start_time="06:30:00.999",
            end_time="07:00:00",
        )
        p = _write_jsonl(tmp_path, "activity-2026-05-01.jsonl", lines)
        sessions = parse_activity_log(p)

        assert len(sessions) == 1
        assert sessions[0]["time_of_day"] == "AM"
        # Crucially, start_time should be set (not None from parse failure)
        assert sessions[0]["start_time"] is not None, (
            "start_time is None -- sub-second timestamp caused parse failure"
        )

    def test_iso_offset_timestamp_handled(self, tmp_path):
        """Timestamp with timezone offset like '22:30:00+00:00' must
        parse as PM, not fail and default to AM."""
        lines = _make_session_lines(
            "tz-offset-01",
            start_time="22:30:00+00:00",
            end_time="23:00:00",
        )
        p = _write_jsonl(tmp_path, "activity-2026-05-01.jsonl", lines)
        sessions = parse_activity_log(p)

        assert len(sessions) == 1
        assert sessions[0]["time_of_day"] == "PM", (
            "Got '{}' -- timezone offset in timestamp caused parse "
            "failure defaulting to AM".format(sessions[0]["time_of_day"])
        )


# ===========================================================================
# 9. WEB QUERY FALLBACK RETURNS RAW BLOB
# ===========================================================================

class TestWebQueryFallback:
    """_extract_web_query falls back to returning the raw input string.
    For malformed inputs this can produce multi-KB blobs stored in the DB."""

    def test_huge_malformed_input_not_stored_raw(self):
        """A 5KB input string that fails regex extraction must NOT be
        returned as the query verbatim."""
        huge_input = "x" * 5000
        result = _extract_web_query(huge_input)
        # The function should return None for unparseable garbage,
        # not a 5KB string
        assert result is None or len(result) < 500, (
            "_extract_web_query returned a {}-char raw blob "
            "as a 'query' -- should be None or truncated".format(len(result))
        )

    def test_python_repr_dict_extracts_query_not_blob(self):
        """Input like "{'query': 'test', 'extra': 'x' * 5000}" should
        extract just 'test', not store the whole repr string."""
        padding = "x" * 5000
        inp = "{{'query': 'actual search term', 'extra_field': '{}'}}".format(padding)
        result = _extract_web_query(inp)
        assert result == "actual search term", (
            "Expected 'actual search term', got: {}".format(repr(result)[:100])
        )

    def test_multiline_json_like_blob_not_returned_raw(self):
        """A multi-line string that looks like JSON but is invalid must
        not be returned as the query."""
        blob = "{\n  'query': 'test',\n" + "  'data': '" + "A" * 3000 + "'\n}"
        result = _extract_web_query(blob)
        # Should extract 'test' via regex, not return the whole blob
        if result is not None:
            assert len(result) < 500, (
                "Returned {}-char blob instead of extracting query".format(len(result))
            )

    def test_empty_string_returns_none(self):
        """Empty string input must return None, not empty string."""
        result = _extract_web_query("")
        assert result is None, (
            "Expected None for empty input, got {}".format(repr(result))
        )

    def test_whitespace_only_returns_none(self):
        """Whitespace-only input must return None."""
        result = _extract_web_query("   \n\t  ")
        assert result is None, (
            "Expected None for whitespace input, got {}".format(repr(result))
        )

    def test_binary_garbage_not_stored(self):
        """Random non-UTF8-like bytes (as string) must not be stored as query."""
        garbage = "".join(chr(i) for i in range(1, 32))  # control chars
        result = _extract_web_query(garbage)
        assert result is None or len(result) < 50, (
            "Control character garbage returned as web query"
        )

    def test_huge_query_in_valid_json_truncated(self):
        """A valid JSON with an absurdly long query string must be truncated."""
        huge_query = "a" * 100_000
        inp = json.dumps({"query": huge_query})
        result = _extract_web_query(inp)
        # It should extract the query but it will be 100K chars
        # The pipeline should truncate this
        assert result is None or len(result) < 10_000, (
            "100K-char query returned without truncation (len={})".format(
                len(result) if result else 0)
        )

    def test_nested_quotes_extract_correctly(self):
        """Input with escaped/nested quotes must extract the right query."""
        inp = "{'query': \"climate change impact 2026\", 'safe': true}"
        result = _extract_web_query(inp)
        assert result is not None
        assert "climate change" in result, (
            "Failed to extract query from mixed-quote input, got: {}".format(repr(result))
        )


# ===========================================================================
# 10. OUT-OF-ORDER EVENTS
# ===========================================================================

class TestOutOfOrderEvents:
    """Events may appear out of order in a JSONL file.  Tool events
    appearing before session_start must still be assigned correctly."""

    def test_tool_events_before_session_start(self, tmp_path):
        """Tool events for session 'abc' appear BEFORE its session_start.
        The session must still be parsed with those events included."""
        lines = [
            # Tool event appears before session_start in file
            _jsonl_line(ts="10:01:00", event="tool", s="ooo-01",
                        t="Read", i="/home/claude/notes/daily/2026-05-01.md"),
            _jsonl_line(ts="10:00:00", event="session_start", s="ooo-01",
                        cwd="/home/claude"),
            _jsonl_line(ts="10:02:00", event="tool", s="ooo-01",
                        t="Write", i="/home/claude/writing/essay.md"),
            _jsonl_line(ts="10:05:00", event="session_end", s="ooo-01"),
        ]
        p = _write_jsonl(tmp_path, "activity-2026-05-01.jsonl", lines)
        sessions = parse_activity_log(p)

        assert len(sessions) == 1
        # Must capture BOTH tool events, including the one before session_start
        assert len(sessions[0]["tool_events"]) == 2, (
            "Expected 2 tool events, got {} -- "
            "tool event before session_start was dropped".format(
                len(sessions[0]["tool_events"]))
        )

    def test_interleaved_sessions_separated_correctly(self, tmp_path):
        """Events from two sessions are interleaved (not cleanly grouped).
        Both sessions must be correctly separated."""
        lines = [
            _jsonl_line(ts="10:00:00", event="session_start", s="inter-A",
                        cwd="/home/claude"),
            _jsonl_line(ts="10:00:00", event="session_start", s="inter-B",
                        cwd="/home/claude"),
            _jsonl_line(ts="10:01:00", event="tool", s="inter-A",
                        t="Read", i="/home/claude/writing/a.md"),
            _jsonl_line(ts="10:01:30", event="tool", s="inter-B",
                        t="Write", i="/home/claude/notes/daily/2026-05-01.md"),
            _jsonl_line(ts="10:02:00", event="tool", s="inter-A",
                        t="Write", i="/home/claude/private/journal.md"),
            _jsonl_line(ts="10:03:00", event="session_end", s="inter-B"),
            _jsonl_line(ts="10:04:00", event="tool", s="inter-A",
                        t="Read", i="/home/claude/messages_from_james.md"),
            _jsonl_line(ts="10:05:00", event="session_end", s="inter-A"),
        ]
        p = _write_jsonl(tmp_path, "activity-2026-05-01.jsonl", lines)
        sessions = parse_activity_log(p)

        assert len(sessions) == 2

        by_id = {s["session_id"]: s for s in sessions}
        assert "inter-A" in by_id
        assert "inter-B" in by_id

        a_tools = by_id["inter-A"]["tool_events"]
        b_tools = by_id["inter-B"]["tool_events"]

        assert len(a_tools) == 3, "Session A has {} tools, expected 3".format(len(a_tools))
        assert len(b_tools) == 1, "Session B has {} tools, expected 1".format(len(b_tools))

    def test_out_of_order_time_of_day_uses_session_start(self, tmp_path):
        """When tool events appear before session_start in the file,
        time_of_day must still be based on the session_start timestamp,
        NOT the first event in file order."""
        lines = [
            # A PM tool event appears before the AM session_start
            _jsonl_line(ts="23:59:00", event="tool", s="tod-ooo-01",
                        t="Read", i="/home/claude/writing/essay.md"),
            _jsonl_line(ts="09:00:00", event="session_start", s="tod-ooo-01",
                        cwd="/home/claude"),
            _jsonl_line(ts="09:05:00", event="session_end", s="tod-ooo-01"),
        ]
        p = _write_jsonl(tmp_path, "activity-2026-05-01.jsonl", lines)
        sessions = parse_activity_log(p)

        assert len(sessions) == 1
        # time_of_day should be AM (from session_start at 09:00:00)
        # not PM (from tool event at 23:59:00 which appeared first in file)
        assert sessions[0]["time_of_day"] == "AM", (
            "Got '{}' -- time_of_day was derived "
            "from file order instead of session_start timestamp".format(
                sessions[0]["time_of_day"])
        )

    def test_session_end_before_session_start_in_file(self, tmp_path):
        """A session_end event appearing before session_start in the file
        (for the same session) must still result in a valid end_time."""
        lines = [
            _jsonl_line(ts="10:05:00", event="session_end", s="end-first-01"),
            _jsonl_line(ts="10:00:00", event="session_start", s="end-first-01",
                        cwd="/home/claude"),
            _jsonl_line(ts="10:01:00", event="tool", s="end-first-01",
                        t="Read", i="/home/claude/writing/a.md"),
        ]
        p = _write_jsonl(tmp_path, "activity-2026-05-01.jsonl", lines)
        sessions = parse_activity_log(p)

        assert len(sessions) == 1
        # The end_time should be captured even though it appeared first in file
        assert sessions[0]["end_time"] == "10:05:00", (
            "end_time not captured when session_end appeared before session_start"
        )

    def test_events_for_unknown_session_ignored(self, tmp_path):
        """Tool events with a session ID that never has a session_start
        must be silently dropped, not cause crashes or phantom sessions."""
        lines = [
            _jsonl_line(ts="10:00:00", event="session_start", s="known-01",
                        cwd="/home/claude"),
            _jsonl_line(ts="10:01:00", event="tool", s="unknown-99",
                        t="Read", i="/home/claude/writing/a.md"),
            _jsonl_line(ts="10:02:00", event="tool", s="known-01",
                        t="Read", i="/home/claude/writing/b.md"),
            _jsonl_line(ts="10:05:00", event="session_end", s="known-01"),
        ]
        p = _write_jsonl(tmp_path, "activity-2026-05-01.jsonl", lines)
        sessions = parse_activity_log(p)

        assert len(sessions) == 1
        assert sessions[0]["session_id"] == "known-01"
        # The tool event for unknown-99 must not appear
        tool_sessions = [e.get("s") for e in sessions[0]["tool_events"]]
        assert "unknown-99" not in tool_sessions


# ===========================================================================
# 11. UNICODE ATTACKS
# ===========================================================================

class TestUnicodeAttacks:
    """No normalization or stripping of Unicode control characters.
    This enables session spoofing, category bypass, and UI attacks."""

    def test_rtl_override_in_session_id_stripped(self, db_conn):
        """U+202E (RTL Override) in a session_id must be stripped or
        rejected to prevent UI spoofing."""
        rtl_char = "‮"
        session = _make_session_dict(
            session_id="session" + rtl_char + "fdp.exe",
        )
        try:
            store_session(db_conn, session)
            row = db_conn.execute(
                "SELECT id FROM sessions WHERE id LIKE %s", ("session%",)
            ).fetchone()
            assert row is not None
            assert rtl_char not in row[0], (
                "RTL Override character stored in session_id -- "
                "enables UI spoofing attacks"
            )
        except (ValueError, psycopg.errors.DataError):
            db_conn.rollback()
            pass  # Rejection is acceptable

    def test_zero_width_joiner_in_path_normalized(self):
        """A path with zero-width joiner (U+200D) must be normalized
        so category matching still works correctly."""
        # Insert ZWJ into "writing" -> "wri<ZWJ>ting"
        zwj = "‍"
        spoofed_path = "/home/claude/wri" + zwj + "ting/essay.md"
        cat = _categorize_path(spoofed_path)
        # After normalization, the ZWJ should be stripped and "writing/"
        # should match. Without normalization, "writing/" won't be found
        # as a substring because "wri‍ting/" != "writing/"
        assert cat == "writing", (
            "Expected 'writing', got '{}' -- zero-width joiner "
            "in path broke category matching".format(cat)
        )

    def test_cyrillic_a_in_home_claude_rejected(self):
        """Cyrillic 'a' (U+0430) looks like Latin 'a' but is a different
        character.  /home/cl<cyrillic-a>ude/ must NOT match /home/claude/ rules.
        The real test: 'writing/' is still a valid substring regardless of
        the homoglyph in the path prefix, so the category may still match.
        The pipeline should either reject the path or normalize it."""
        cyrillic_a = "а"
        spoofed = "/home/cl" + cyrillic_a + "ude/writing/essay.md"
        result = classify_file_operation("Read", spoofed)
        # The path looks like /home/claude/writing/essay.md visually
        # but the base path is not actually /home/claude/
        # 'writing/' IS a valid substring, so _categorize_path returns "writing"
        # The real vulnerability: this path is NOT under /home/claude/ but gets
        # classified as if it were
        if result is not None:
            path, category, _ = result
            # Ideally the pipeline should detect the homoglyph
            assert category == "other", (
                "Cyrillic homoglyph in path accepted with category '{}' -- "
                "enables path spoofing".format(category)
            )

    def test_combining_characters_in_filename(self):
        """Path with combining acute accent (U+0301) on 'e' in 'notes'
        creates a visually similar path with different bytes."""
        # "notes" with combining accent on 'e': note + combining accent + s
        # This is NOT the same bytes as "notes" in NFC form
        path = "/home/claude/notés/daily/2026-01-15.md"
        cat = _categorize_path(path)
        # "notes/daily/" substring check: "notés/daily/" != "notes/daily/"
        # So this will NOT match notes/daily/ at byte level and fall through
        assert cat in ("daily_notes", "other"), (
            "Expected 'daily_notes' or 'other', got '{}' -- "
            "combining character caused unexpected category match".format(cat)
        )

    def test_bidi_override_in_file_path_stripped(self):
        """Bidirectional control characters in file paths must be
        stripped to prevent log injection and display attacks."""
        lre = "‪"  # Left-to-right embedding
        pdf = "‬"  # Pop directional formatting
        evil_path = "/home/claude/writing/report" + lre + "gpj.exe" + pdf + ".md"
        result = classify_file_operation("Write", evil_path)
        assert result is not None
        path, _, _ = result
        assert lre not in path and pdf not in path, (
            "Bidi control characters stored in file path"
        )

    def test_zero_width_space_in_session_id_deduplicated(self, db_conn):
        """Two session IDs that differ only by a zero-width space (U+200B)
        are visually identical but textually different. The pipeline should
        normalize them to prevent deduplication bypass."""
        zws = "​"
        session1 = _make_session_dict(session_id="session-abc123")
        session2 = _make_session_dict(
            session_id="session-abc" + zws + "123",
        )
        store_session(db_conn, session1)
        store_session(db_conn, session2)

        count = db_conn.execute(
            "SELECT COUNT(*) FROM sessions WHERE id LIKE %s", ("session-abc%123%",)
        ).fetchone()[0]
        # These should be treated as the same session after normalization
        assert count == 1, (
            "Zero-width space created a duplicate session: {} rows".format(count)
        )


# ===========================================================================
# 12. RESOURCE EXHAUSTION
# ===========================================================================

class TestResourceExhaustion:
    """No input size limits.  Malicious inputs can cause excessive memory
    use or unreasonably large DB rows."""

    def test_1mb_tool_input_truncated_or_handled(self, tmp_path):
        """A tool event with a 1MB 'i' field must not be stored raw.
        The pipeline should truncate or skip it."""
        huge_payload = "A" * (1024 * 1024)  # 1MB
        lines = _make_session_lines(
            "exhaust-01",
            tools=[{"t": "Write", "i": huge_payload, "ts": "10:01:00"}],
        )
        p = _write_jsonl(tmp_path, "activity-2026-05-01.jsonl", lines)
        sessions = parse_activity_log(p)

        assert len(sessions) == 1
        # The tool input should be truncated to something reasonable
        tool_input = sessions[0]["tool_events"][0]["i"]
        assert len(tool_input) < 10000, (
            "Tool input is {} chars -- "
            "1MB payload stored without truncation".format(len(tool_input))
        )

    def test_100k_events_single_session(self, tmp_path):
        """A session with 100,000 tool events must parse without crashing.
        This is unrealistically large and should be handled gracefully."""
        lines = [
            _jsonl_line(ts="10:00:00", event="session_start", s="exhaust-02",
                        cwd="/home/claude"),
        ]
        for i in range(100_000):
            lines.append(
                _jsonl_line(ts="10:01:00", event="tool", s="exhaust-02",
                            t="Read", i="/home/claude/notes/file_{}.md".format(i))
            )
        lines.append(
            _jsonl_line(ts="23:59:59", event="session_end", s="exhaust-02")
        )
        p = _write_jsonl(tmp_path, "activity-2026-05-01.jsonl", lines)

        # Must complete without OOM -- we just verify it returns
        sessions = parse_activity_log(p)
        assert len(sessions) == 1
        # Sanity check that it actually parsed (might be slow, that's OK)
        assert sessions[0]["turns"] == 100_000

    def test_10k_char_session_id_rejected_or_truncated(self, db_conn):
        """A session_id that is 10,000 characters long is clearly malicious.
        Must be rejected or truncated."""
        long_id = "x" * 10_000
        session = _make_session_dict(session_id=long_id)

        try:
            store_session(db_conn, session)
            row = db_conn.execute(
                "SELECT LENGTH(id) FROM sessions WHERE id = %s", (long_id,)
            ).fetchone()
            if row is not None:
                assert row[0] < 1000, (
                    "10,000-char session_id stored without truncation "
                    "(length={})".format(row[0])
                )
        except (ValueError, psycopg.errors.DataError):
            db_conn.rollback()
            pass  # Rejection is acceptable

    def test_huge_web_search_query_truncated(self, db_conn):
        """A web search query that is 100KB must be truncated before storage."""
        huge_query = "search " * 15000  # ~105KB
        session = _make_session_dict(
            session_id="exhaust-ws-01",
            web_searches=[huge_query],
        )
        store_session(db_conn, session)

        row = db_conn.execute(
            "SELECT LENGTH(query) FROM web_searches WHERE session_id = %s",
            ("exhaust-ws-01",),
        ).fetchone()
        assert row is not None
        assert row[0] < 10000, (
            "100KB web search query stored without truncation (length={})".format(row[0])
        )

    def test_deeply_nested_json_tool_input(self, tmp_path):
        """A tool input with deeply nested JSON braces must not cause
        regex catastrophic backtracking or stack overflow."""
        # 1000 levels of nesting
        nested = '{"a":' * 1000 + '"deep"' + '}' * 1000
        lines = _make_session_lines(
            "exhaust-03",
            tools=[{"t": "WebSearch", "i": nested, "ts": "10:01:00"}],
        )
        p = _write_jsonl(tmp_path, "activity-2026-05-01.jsonl", lines)
        # Must not hang or crash
        sessions = parse_activity_log(p)
        assert len(sessions) == 1

    def test_huge_file_path_in_operation(self, db_conn):
        """A file path that is 100KB long must be rejected or truncated
        before storage."""
        huge_path = "/home/claude/writing/" + "a" * 100_000 + ".md"
        session = _make_session_dict(
            session_id="exhaust-path-01",
            file_operations=[
                {
                    "path": huge_path,
                    "category": "writing",
                    "method": "Write",
                    "direction": "write",
                    "ordinal": 0,
                },
            ],
        )
        store_session(db_conn, session)

        row = db_conn.execute(
            "SELECT LENGTH(path) FROM file_operations WHERE session_id = %s",
            ("exhaust-path-01",),
        ).fetchone()
        assert row is not None
        assert row[0] < 10_000, (
            "100KB file path stored without truncation (length={})".format(row[0])
        )

    def test_many_web_searches_per_session(self, db_conn):
        """A session with 10,000 web searches must be handled gracefully.
        Real sessions have at most a handful."""
        session = _make_session_dict(
            session_id="exhaust-ws-many-01",
            web_searches=["query {}".format(i) for i in range(10_000)],
        )
        store_session(db_conn, session)

        count = db_conn.execute(
            "SELECT COUNT(*) FROM web_searches WHERE session_id = %s",
            ("exhaust-ws-many-01",),
        ).fetchone()[0]
        # Either all 10K were stored (no limit) or a reasonable cap was applied
        # The assertion here is that it completed without error
        # but ideally there would be a cap
        assert count <= 10_000, "More searches stored than submitted"
        # Flag if no cap was applied
        if count == 10_000:
            pytest.fail(
                "10,000 web searches stored without any cap -- "
                "resource exhaustion risk"
            )
