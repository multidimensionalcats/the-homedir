"""Hostile tests for prebuild_export.py -- TDD contract for the static JSON export layer.

These tests intentionally import a module that does not yet exist.
Every test here should FAIL until the implementation is written.

The prebuild_export module queries PostgreSQL and emits static JSON files
for Astro/D3/Svelte to consume at build time. Each export function:
  1. Queries the DB
  2. Serializes to JSON (with correct date handling)
  3. Writes to output_dir
  4. Returns the file path
"""

import datetime
import json
import os

from scripts.prebuild_export import (
    export_all,
    export_memory_snapshots,
    export_messages,
    export_pet_timeline,
    export_predictions,
    export_sessions,
    export_writing_metadata,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _insert_session(conn, session_id, date, **overrides):
    """Insert a minimal session row. Accepts overrides for any column."""
    defaults = {
        "time_of_day": "AM",
        "version": "4.6",
        "source_type": "jsonl",
        "source_file": f"activity-{date.isoformat()}.jsonl",
        "timestamp_start": datetime.datetime(
            date.year,
            date.month,
            date.day,
            10,
            0,
            0,
            tzinfo=datetime.UTC,
        ),
        "turns": 5,
        "tokens_total_input": None,
        "tokens_total_output": None,
        "tokens_cache_read": None,
        "tokens_cache_create": None,
        "tokens_fresh_input": None,
        "wrote_composition": False,
        "wrote_private_journal": False,
        "updated_memory": False,
        "messaged_james": False,
        "wrote_prediction": False,
    }
    defaults.update(overrides)
    conn.execute(
        """
        INSERT INTO sessions (
            id, date, time_of_day, version, source_type, source_file,
            timestamp_start, turns,
            tokens_total_input, tokens_total_output,
            tokens_cache_read, tokens_cache_create, tokens_fresh_input,
            wrote_composition, wrote_private_journal,
            updated_memory, messaged_james, wrote_prediction
        ) VALUES (
            %s, %s, %s, %s, %s, %s,
            %s, %s,
            %s, %s,
            %s, %s, %s,
            %s, %s,
            %s, %s, %s
        )
        ON CONFLICT (id) DO NOTHING
        """,
        (
            session_id,
            date,
            defaults["time_of_day"],
            defaults["version"],
            defaults["source_type"],
            defaults["source_file"],
            defaults["timestamp_start"],
            defaults["turns"],
            defaults["tokens_total_input"],
            defaults["tokens_total_output"],
            defaults["tokens_cache_read"],
            defaults["tokens_cache_create"],
            defaults["tokens_fresh_input"],
            defaults["wrote_composition"],
            defaults["wrote_private_journal"],
            defaults["updated_memory"],
            defaults["messaged_james"],
            defaults["wrote_prediction"],
        ),
    )
    conn.commit()


def _insert_file_op(conn, session_id, path, category, method, direction, ordinal=0):
    """Insert a file_operations row."""
    conn.execute(
        """
        INSERT INTO file_operations (session_id, path, category, method, direction, ordinal)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (session_id, path, category, method, direction, ordinal),
    )
    conn.commit()


def _insert_web_search(conn, session_id, query, ordinal=0):
    """Insert a web_searches row."""
    conn.execute(
        "INSERT INTO web_searches (session_id, query, ordinal) VALUES (%s, %s, %s)",
        (session_id, query, ordinal),
    )
    conn.commit()


def _insert_composition(conn, slug, filename, **overrides):
    """Insert a compositions row (no content by default)."""
    defaults = {
        "title": None,
        "date_written": None,
        "session_id": None,
        "version": None,
        "size_bytes": None,
        "content": "This is the full content that should NOT appear in the export.",
        "topic": None,
    }
    defaults.update(overrides)
    conn.execute(
        """
        INSERT INTO compositions (slug, filename, title, date_written, session_id,
                                  version, size_bytes, content, topic)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            slug,
            filename,
            defaults["title"],
            defaults["date_written"],
            defaults["session_id"],
            defaults["version"],
            defaults["size_bytes"],
            defaults["content"],
            defaults["topic"],
        ),
    )
    conn.commit()


def _insert_message(conn, direction, date, content, line_start=None, line_end=None):
    """Insert a messages row."""
    conn.execute(
        """
        INSERT INTO messages (direction, date, content, line_start, line_end)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (direction, date, content, line_start, line_end),
    )
    conn.commit()


def _insert_prediction(
    conn,
    text,
    confidence,
    date_made,
    session_id=None,
    resolution_date=None,
    outcome=None,
    self_assessment=None,
):
    """Insert a predictions row."""
    conn.execute(
        """
        INSERT INTO predictions (text, confidence, date_made, resolution_date,
                                 outcome, session_id, self_assessment)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (text, confidence, date_made, resolution_date, outcome, session_id, self_assessment),
    )
    conn.commit()


def _insert_pet_event(conn, pet_name, event_type, event_timestamp, session_id=None, notes=None):
    """Insert a pet_events row."""
    conn.execute(
        """
        INSERT INTO pet_events (pet_name, event_type, event_timestamp, session_id, notes)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (pet_name, event_type, event_timestamp, session_id, notes),
    )
    conn.commit()


def _insert_memory_snapshot(conn, session_id, date, full_content, token_count):
    """Insert a memory_snapshots row, return its id."""
    row = conn.execute(
        """
        INSERT INTO memory_snapshots (session_id, date, full_content, token_count)
        VALUES (%s, %s, %s, %s) RETURNING id
        """,
        (session_id, date, full_content, token_count),
    ).fetchone()
    conn.commit()
    return row[0]


def _insert_memory_block(conn, block_hash, heading, content, first_seen_session, last_seen_session):
    """Insert a memory_blocks row, return its id."""
    row = conn.execute(
        """
        INSERT INTO memory_blocks (block_hash, heading, content,
                                   first_seen_session, last_seen_session)
        VALUES (%s, %s, %s, %s, %s) RETURNING id
        """,
        (block_hash, heading, content, first_seen_session, last_seen_session),
    ).fetchone()
    conn.commit()
    return row[0]


def _insert_block_presence(conn, snapshot_id, block_id):
    """Insert a memory_block_presence row."""
    conn.execute(
        "INSERT INTO memory_block_presence (snapshot_id, block_id) VALUES (%s, %s)",
        (snapshot_id, block_id),
    )
    conn.commit()


def _load_json(path):
    """Read and parse a JSON file, returning Python data."""
    with open(path, encoding="utf-8") as f:
        return json.loads(f.read())


# ===========================================================================
# 1. SESSIONS EXPORT
# ===========================================================================


class TestExportSessions:
    """export_sessions must query sessions + file_operations + web_searches,
    compute attention_profile per session, and emit sessions.json."""

    def test_basic_two_sessions_exported(self, db_conn, tmp_path):
        """Insert 2 sessions with file_ops and web_searches, verify both
        appear in the exported JSON."""
        _insert_session(db_conn, "ses-exp-01", datetime.date(2026, 3, 15))
        _insert_session(db_conn, "ses-exp-02", datetime.date(2026, 3, 16), time_of_day="PM")
        _insert_file_op(
            db_conn, "ses-exp-01", "/home/claude/writing/essay.md", "writing", "Write", "write", 0
        )
        _insert_file_op(
            db_conn, "ses-exp-01", "/home/claude/writing/essay.md", "writing", "Read", "read", 1
        )
        _insert_web_search(db_conn, "ses-exp-01", "quantum computing basics")
        _insert_web_search(db_conn, "ses-exp-02", "python datetime ISO format")

        result_path = export_sessions(db_conn, tmp_path)
        data = _load_json(result_path)

        assert isinstance(data, list)
        assert len(data) == 2
        ids = {s["id"] for s in data}
        assert ids == {"ses-exp-01", "ses-exp-02"}

    def test_session_has_required_fields(self, db_conn, tmp_path):
        """Each session in the JSON must have all required top-level keys."""
        _insert_session(
            db_conn,
            "ses-fields-01",
            datetime.date(2026, 3, 15),
            turns=12,
            time_of_day="PM",
            version="4.7",
        )

        result_path = export_sessions(db_conn, tmp_path)
        data = _load_json(result_path)
        assert len(data) == 1

        session = data[0]
        required_keys = {
            "id",
            "date",
            "time_of_day",
            "version",
            "turns",
            "attention_profile",
            "web_searches",
        }
        missing = required_keys - set(session.keys())
        assert not missing, f"Missing keys in session JSON: {missing}"

    def test_attention_profile_aggregates_by_category(self, db_conn, tmp_path):
        """attention_profile must be a dict of category -> {reads: N, writes: N}
        computed from file_operations."""
        _insert_session(db_conn, "ses-attn-01", datetime.date(2026, 3, 15))
        # 2 writes and 1 read to "writing" category
        _insert_file_op(
            db_conn, "ses-attn-01", "/home/claude/writing/a.md", "writing", "Write", "write", 0
        )
        _insert_file_op(
            db_conn, "ses-attn-01", "/home/claude/writing/b.md", "writing", "Write", "write", 1
        )
        _insert_file_op(
            db_conn, "ses-attn-01", "/home/claude/writing/a.md", "writing", "Read", "read", 2
        )
        # 1 read to "daily_notes"
        _insert_file_op(
            db_conn,
            "ses-attn-01",
            "/home/claude/notes/daily/2026-03-15.md",
            "daily_notes",
            "Read",
            "read",
            3,
        )

        result_path = export_sessions(db_conn, tmp_path)
        data = _load_json(result_path)
        session = data[0]
        ap = session["attention_profile"]

        assert isinstance(ap, dict)
        assert "writing" in ap
        assert ap["writing"]["writes"] == 2
        assert ap["writing"]["reads"] == 1
        assert "daily_notes" in ap
        assert ap["daily_notes"]["reads"] == 1
        assert ap["daily_notes"].get("writes", 0) == 0

    def test_web_searches_list_of_strings(self, db_conn, tmp_path):
        """web_searches in the JSON must be a list of query strings."""
        _insert_session(db_conn, "ses-ws-01", datetime.date(2026, 3, 15))
        _insert_web_search(db_conn, "ses-ws-01", "first query", 0)
        _insert_web_search(db_conn, "ses-ws-01", "second query", 1)

        result_path = export_sessions(db_conn, tmp_path)
        data = _load_json(result_path)
        session = data[0]

        assert isinstance(session["web_searches"], list)
        assert len(session["web_searches"]) == 2
        assert "first query" in session["web_searches"]
        assert "second query" in session["web_searches"]

    def test_empty_sessions_table(self, db_conn, tmp_path):
        """No sessions in DB -> valid JSON with empty array, not an error."""
        result_path = export_sessions(db_conn, tmp_path)
        data = _load_json(result_path)
        assert data == []

    def test_date_serialized_as_iso_string(self, db_conn, tmp_path):
        """Session dates must be ISO format strings, not Python repr."""
        _insert_session(db_conn, "ses-date-01", datetime.date(2026, 3, 15))

        result_path = export_sessions(db_conn, tmp_path)
        data = _load_json(result_path)
        session = data[0]

        assert isinstance(session["date"], str)
        assert session["date"] == "2026-03-15", "Date not ISO formatted: got {!r}".format(
            session["date"]
        )

    def test_file_written_to_correct_path(self, db_conn, tmp_path):
        """Output file must be at output_dir/sessions.json."""
        result_path = export_sessions(db_conn, tmp_path)
        assert result_path == tmp_path / "sessions.json"
        assert os.path.isfile(result_path)

    def test_json_is_valid_and_parseable(self, db_conn, tmp_path):
        """The output file must be valid JSON (parseable without error)."""
        _insert_session(db_conn, "ses-json-01", datetime.date(2026, 3, 15))
        result_path = export_sessions(db_conn, tmp_path)

        raw = open(result_path, encoding="utf-8").read()
        # Must not raise
        parsed = json.loads(raw)
        assert isinstance(parsed, list)

    def test_session_with_no_file_operations(self, db_conn, tmp_path):
        """A session with zero file_operations -> attention_profile is empty dict."""
        _insert_session(db_conn, "ses-noops-01", datetime.date(2026, 3, 15))

        result_path = export_sessions(db_conn, tmp_path)
        data = _load_json(result_path)
        session = data[0]

        assert session["attention_profile"] == {}, (
            "Expected empty dict for session with no file_ops, got {!r}".format(
                session["attention_profile"]
            )
        )

    def test_token_fields_present_when_populated(self, db_conn, tmp_path):
        """Token fields must appear in JSON when the DB has values."""
        _insert_session(
            db_conn,
            "ses-tok-01",
            datetime.date(2026, 3, 15),
            tokens_total_input=15000,
            tokens_total_output=3000,
            tokens_cache_read=12000,
            tokens_cache_create=500,
            tokens_fresh_input=2500,
        )

        result_path = export_sessions(db_conn, tmp_path)
        data = _load_json(result_path)
        session = data[0]

        assert session.get("tokens_total_input") == 15000
        assert session.get("tokens_total_output") == 3000
        assert session.get("tokens_cache_read") == 12000

    def test_token_fields_null_when_absent(self, db_conn, tmp_path):
        """Token fields must be null (not missing) when DB has NULLs."""
        _insert_session(db_conn, "ses-tok-null-01", datetime.date(2026, 3, 15))

        result_path = export_sessions(db_conn, tmp_path)
        data = _load_json(result_path)
        session = data[0]

        # The keys should exist with null values
        assert "tokens_total_input" in session, "tokens_total_input key missing"
        assert session["tokens_total_input"] is None

    def test_output_flags_included(self, db_conn, tmp_path):
        """Output flags (wrote_composition, etc.) must be present in JSON."""
        _insert_session(
            db_conn,
            "ses-flags-01",
            datetime.date(2026, 3, 15),
            wrote_composition=True,
            messaged_james=True,
        )

        result_path = export_sessions(db_conn, tmp_path)
        data = _load_json(result_path)
        session = data[0]

        assert session.get("wrote_composition") is True
        assert session.get("messaged_james") is True
        assert session.get("wrote_private_journal") is False
        assert session.get("updated_memory") is False

    def test_timestamp_start_serialized_as_iso(self, db_conn, tmp_path):
        """timestamp_start (datetime) must be serialized as ISO string."""
        ts = datetime.datetime(2026, 3, 15, 10, 30, 0, tzinfo=datetime.UTC)
        _insert_session(db_conn, "ses-ts-01", datetime.date(2026, 3, 15), timestamp_start=ts)

        result_path = export_sessions(db_conn, tmp_path)
        data = _load_json(result_path)
        session = data[0]

        assert isinstance(session.get("timestamp_start"), str), (
            "timestamp_start not serialized as string"
        )
        # Must be parseable as ISO datetime
        parsed_ts = datetime.datetime.fromisoformat(session["timestamp_start"])
        assert parsed_ts.year == 2026
        assert parsed_ts.month == 3
        assert parsed_ts.day == 15

    def test_attention_profile_multiple_categories(self, db_conn, tmp_path):
        """Session touching 3 different categories has all 3 in attention_profile."""
        _insert_session(db_conn, "ses-multi-cat", datetime.date(2026, 3, 15))
        _insert_file_op(
            db_conn, "ses-multi-cat", "/home/claude/writing/a.md", "writing", "Write", "write", 0
        )
        _insert_file_op(
            db_conn,
            "ses-multi-cat",
            "/home/claude/notes/daily/d.md",
            "daily_notes",
            "Read",
            "read",
            1,
        )
        _insert_file_op(
            db_conn,
            "ses-multi-cat",
            "/home/claude/private/j.md",
            "private_journal",
            "Write",
            "write",
            2,
        )

        result_path = export_sessions(db_conn, tmp_path)
        data = _load_json(result_path)
        ap = data[0]["attention_profile"]

        assert len(ap) == 3
        assert "writing" in ap
        assert "daily_notes" in ap
        assert "private_journal" in ap

    def test_session_with_no_web_searches(self, db_conn, tmp_path):
        """A session with zero web_searches -> web_searches is empty list."""
        _insert_session(db_conn, "ses-nows-01", datetime.date(2026, 3, 15))

        result_path = export_sessions(db_conn, tmp_path)
        data = _load_json(result_path)

        assert data[0]["web_searches"] == []


# ===========================================================================
# 2. WRITING METADATA EXPORT
# ===========================================================================


class TestExportWritingMetadata:
    """export_writing_metadata must export compositions metadata WITHOUT
    the full content field (too large for a JSON blob)."""

    def test_two_compositions_exported(self, db_conn, tmp_path):
        """Insert 2 compositions, verify both appear in JSON."""
        _insert_session(db_conn, "wrt-ses-01", datetime.date(2026, 3, 15))
        _insert_composition(
            db_conn,
            "essay-one",
            "essay-one.md",
            title="First Essay",
            date_written=datetime.date(2026, 3, 15),
            session_id="wrt-ses-01",
            version="4.6",
            size_bytes=4200,
            topic="philosophy",
        )
        _insert_composition(
            db_conn,
            "essay-two",
            "essay-two.md",
            title="Second Essay",
            date_written=datetime.date(2026, 3, 16),
            version="4.6",
            size_bytes=3100,
            topic="technology",
        )

        result_path = export_writing_metadata(db_conn, tmp_path)
        data = _load_json(result_path)

        assert isinstance(data, list)
        assert len(data) == 2
        slugs = {c["slug"] for c in data}
        assert slugs == {"essay-one", "essay-two"}

    def test_content_field_NOT_present(self, db_conn, tmp_path):
        """The 'content' field must NOT appear in the export -- it's too large."""
        _insert_session(db_conn, "wrt-nocontent-01", datetime.date(2026, 3, 15))
        _insert_composition(
            db_conn,
            "big-essay",
            "big-essay.md",
            title="Big Essay",
            date_written=datetime.date(2026, 3, 15),
            session_id="wrt-nocontent-01",
            content="A" * 100_000,
        )

        result_path = export_writing_metadata(db_conn, tmp_path)
        data = _load_json(result_path)

        assert len(data) == 1
        assert "content" not in data[0], (
            "content field present in writing-metadata.json -- "
            "this field is too large for the JSON export"
        )

    def test_all_metadata_fields_present(self, db_conn, tmp_path):
        """All metadata fields must be present: slug, filename, title,
        date_written, version, size_bytes, topic."""
        _insert_session(db_conn, "wrt-fields-01", datetime.date(2026, 3, 15))
        _insert_composition(
            db_conn,
            "meta-test",
            "meta-test.md",
            title="Test Title",
            date_written=datetime.date(2026, 3, 15),
            session_id="wrt-fields-01",
            version="4.6",
            size_bytes=1500,
            topic="testing",
        )

        result_path = export_writing_metadata(db_conn, tmp_path)
        data = _load_json(result_path)
        comp = data[0]

        required = {"slug", "filename", "title", "date_written", "version", "size_bytes", "topic"}
        missing = required - set(comp.keys())
        assert not missing, f"Missing metadata fields: {missing}"

        assert comp["slug"] == "meta-test"
        assert comp["filename"] == "meta-test.md"
        assert comp["title"] == "Test Title"
        assert comp["version"] == "4.6"
        assert comp["size_bytes"] == 1500
        assert comp["topic"] == "testing"

    def test_empty_table_returns_empty_array(self, db_conn, tmp_path):
        """No compositions -> valid JSON with empty array."""
        result_path = export_writing_metadata(db_conn, tmp_path)
        data = _load_json(result_path)
        assert data == []

    def test_null_fields_serialized_as_null(self, db_conn, tmp_path):
        """Compositions with NULL title, date, topic -> null in JSON."""
        _insert_composition(
            db_conn,
            "null-fields",
            "null-fields.md",
            title=None,
            date_written=None,
            topic=None,
            version=None,
            size_bytes=None,
        )

        result_path = export_writing_metadata(db_conn, tmp_path)
        data = _load_json(result_path)
        comp = data[0]

        assert comp["title"] is None, "NULL title should be null in JSON"
        assert comp["date_written"] is None, "NULL date_written should be null in JSON"
        assert comp["topic"] is None, "NULL topic should be null in JSON"

    def test_date_written_serialized_as_iso(self, db_conn, tmp_path):
        """date_written must be an ISO date string, not Python repr."""
        _insert_composition(
            db_conn, "date-check", "date-check.md", date_written=datetime.date(2026, 4, 20)
        )

        result_path = export_writing_metadata(db_conn, tmp_path)
        data = _load_json(result_path)

        assert data[0]["date_written"] == "2026-04-20"

    def test_file_written_to_correct_path(self, db_conn, tmp_path):
        """Output file must be at output_dir/writing-metadata.json."""
        result_path = export_writing_metadata(db_conn, tmp_path)
        assert result_path == tmp_path / "writing-metadata.json"
        assert os.path.isfile(result_path)

    def test_daily_notes_content_not_included(self, db_conn, tmp_path):
        """daily_notes also has content -- verify it's not sneaking in.
        (This tests that the query only hits compositions, not daily_notes.)"""
        _insert_session(db_conn, "wrt-dn-01", datetime.date(2026, 3, 15))
        conn = db_conn
        conn.execute(
            """
            INSERT INTO daily_notes (date, filename, session_id, content, size_bytes)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (datetime.date(2026, 3, 15), "2026-03-15.md", "wrt-dn-01", "Daily note content", 500),
        )
        conn.commit()

        result_path = export_writing_metadata(db_conn, tmp_path)
        data = _load_json(result_path)
        # Only compositions should be in writing-metadata, not daily_notes
        for item in data:
            assert "2026-03-15.md" != item.get("filename"), (
                "daily_notes row leaked into writing-metadata export"
            )


# ===========================================================================
# 3. MESSAGES EXPORT
# ===========================================================================


class TestExportMessages:
    """export_messages must export all messages with full content,
    ordered by date."""

    def test_both_directions_exported(self, db_conn, tmp_path):
        """Insert messages in both directions, verify both appear."""
        _insert_message(
            db_conn,
            "to_james",
            datetime.date(2026, 3, 15),
            "Hello James, I have a question.",
            10,
            12,
        )
        _insert_message(
            db_conn, "from_james", datetime.date(2026, 3, 15), "Hey Claude, go ahead.", 14, 15
        )

        result_path = export_messages(db_conn, tmp_path)
        data = _load_json(result_path)

        assert len(data) == 2
        directions = {m["direction"] for m in data}
        assert directions == {"to_james", "from_james"}

    def test_content_is_included(self, db_conn, tmp_path):
        """Messages are small enough that content IS included."""
        _insert_message(
            db_conn,
            "to_james",
            datetime.date(2026, 3, 15),
            "This is the full message content.",
            1,
            3,
        )

        result_path = export_messages(db_conn, tmp_path)
        data = _load_json(result_path)
        msg = data[0]

        assert msg["content"] == "This is the full message content."

    def test_all_fields_present(self, db_conn, tmp_path):
        """direction, date, content, line_start, line_end all present."""
        _insert_message(db_conn, "to_james", datetime.date(2026, 3, 15), "Test msg", 5, 8)

        result_path = export_messages(db_conn, tmp_path)
        data = _load_json(result_path)
        msg = data[0]

        required = {"direction", "date", "content", "line_start", "line_end"}
        missing = required - set(msg.keys())
        assert not missing, f"Missing message fields: {missing}"

        assert msg["direction"] == "to_james"
        assert msg["date"] == "2026-03-15"
        assert msg["line_start"] == 5
        assert msg["line_end"] == 8

    def test_empty_table_returns_empty_array(self, db_conn, tmp_path):
        """No messages -> valid JSON with empty array."""
        result_path = export_messages(db_conn, tmp_path)
        data = _load_json(result_path)
        assert data == []

    def test_messages_ordered_by_date(self, db_conn, tmp_path):
        """Messages must be ordered by date ascending."""
        _insert_message(db_conn, "to_james", datetime.date(2026, 3, 20), "Later message", 1, 2)
        _insert_message(db_conn, "from_james", datetime.date(2026, 3, 10), "Earlier message", 3, 4)
        _insert_message(db_conn, "to_james", datetime.date(2026, 3, 15), "Middle message", 5, 6)

        result_path = export_messages(db_conn, tmp_path)
        data = _load_json(result_path)

        dates = [m["date"] for m in data]
        assert dates == sorted(dates), f"Messages not ordered by date: {dates}"

    def test_null_date_handled(self, db_conn, tmp_path):
        """A message with NULL date -> null in JSON, not an error."""
        _insert_message(db_conn, "to_james", None, "Undated message", None, None)

        result_path = export_messages(db_conn, tmp_path)
        data = _load_json(result_path)

        assert len(data) == 1
        assert data[0]["date"] is None

    def test_null_line_numbers_handled(self, db_conn, tmp_path):
        """Messages with NULL line_start/line_end -> null in JSON."""
        _insert_message(
            db_conn, "from_james", datetime.date(2026, 3, 15), "No line info", None, None
        )

        result_path = export_messages(db_conn, tmp_path)
        data = _load_json(result_path)

        assert data[0]["line_start"] is None
        assert data[0]["line_end"] is None

    def test_file_written_to_correct_path(self, db_conn, tmp_path):
        """Output file must be at output_dir/messages.json."""
        result_path = export_messages(db_conn, tmp_path)
        assert result_path == tmp_path / "messages.json"
        assert os.path.isfile(result_path)


# ===========================================================================
# 4. PREDICTIONS EXPORT
# ===========================================================================


class TestExportPredictions:
    """export_predictions must export predictions with confidence,
    outcomes, calibration data."""

    def test_predictions_with_outcomes(self, db_conn, tmp_path):
        """Insert predictions with outcomes, verify JSON structure."""
        _insert_session(db_conn, "pred-ses-01", datetime.date(2026, 3, 15))
        _insert_prediction(
            db_conn,
            "James will respond within 24h",
            0.85,
            datetime.date(2026, 3, 15),
            session_id="pred-ses-01",
            resolution_date=datetime.date(2026, 3, 16),
            outcome=True,
            self_assessment="Correct, he responded in 6 hours.",
        )
        _insert_prediction(
            db_conn,
            "Temperature will exceed 30C",
            0.6,
            datetime.date(2026, 3, 15),
            session_id="pred-ses-01",
            resolution_date=datetime.date(2026, 3, 20),
            outcome=False,
        )

        result_path = export_predictions(db_conn, tmp_path)
        data = _load_json(result_path)

        assert isinstance(data, list)
        assert len(data) == 2

    def test_all_fields_present(self, db_conn, tmp_path):
        """confidence, outcome, date_made, resolution_date, text,
        self_assessment all present in JSON."""
        _insert_session(db_conn, "pred-fields-01", datetime.date(2026, 3, 15))
        _insert_prediction(
            db_conn,
            "Test prediction",
            0.75,
            datetime.date(2026, 3, 15),
            session_id="pred-fields-01",
            resolution_date=datetime.date(2026, 4, 1),
            outcome=True,
            self_assessment="Was right",
        )

        result_path = export_predictions(db_conn, tmp_path)
        data = _load_json(result_path)
        pred = data[0]

        required = {
            "text",
            "confidence",
            "date_made",
            "resolution_date",
            "outcome",
            "self_assessment",
        }
        missing = required - set(pred.keys())
        assert not missing, f"Missing prediction fields: {missing}"

        assert pred["text"] == "Test prediction"
        assert abs(pred["confidence"] - 0.75) < 0.01
        assert pred["outcome"] is True
        assert pred["date_made"] == "2026-03-15"
        assert pred["resolution_date"] == "2026-04-01"

    def test_null_outcome(self, db_conn, tmp_path):
        """Prediction with NULL outcome -> null in JSON (unresolved)."""
        _insert_prediction(db_conn, "Unresolved prediction", 0.5, datetime.date(2026, 3, 15))

        result_path = export_predictions(db_conn, tmp_path)
        data = _load_json(result_path)

        assert len(data) == 1
        assert data[0]["outcome"] is None

    def test_null_resolution_date(self, db_conn, tmp_path):
        """Prediction with NULL resolution_date -> null in JSON."""
        _insert_prediction(db_conn, "Pending prediction", 0.7, datetime.date(2026, 3, 15))

        result_path = export_predictions(db_conn, tmp_path)
        data = _load_json(result_path)

        assert data[0]["resolution_date"] is None

    def test_empty_table_returns_empty_array(self, db_conn, tmp_path):
        """No predictions -> valid JSON with empty array."""
        result_path = export_predictions(db_conn, tmp_path)
        data = _load_json(result_path)
        assert data == []

    def test_confidence_is_float(self, db_conn, tmp_path):
        """Confidence must be a numeric float in JSON, not a string."""
        _insert_prediction(db_conn, "Float test", 0.95, datetime.date(2026, 3, 15))

        result_path = export_predictions(db_conn, tmp_path)
        data = _load_json(result_path)

        assert isinstance(data[0]["confidence"], float), "confidence is {}, not float".format(
            type(data[0]["confidence"])
        )

    def test_boolean_outcome_serialized_correctly(self, db_conn, tmp_path):
        """outcome=True -> true (not 1 or 'True'), outcome=False -> false."""
        _insert_prediction(db_conn, "True pred", 0.8, datetime.date(2026, 3, 15), outcome=True)
        _insert_prediction(db_conn, "False pred", 0.3, datetime.date(2026, 3, 16), outcome=False)

        result_path = export_predictions(db_conn, tmp_path)
        data = _load_json(result_path)

        # Find by text
        by_text = {p["text"]: p for p in data}
        assert by_text["True pred"]["outcome"] is True
        assert by_text["False pred"]["outcome"] is False
        # Verify it's bool, not int
        assert type(by_text["True pred"]["outcome"]) is bool
        assert type(by_text["False pred"]["outcome"]) is bool

    def test_file_written_to_correct_path(self, db_conn, tmp_path):
        """Output file must be at output_dir/predictions.json."""
        result_path = export_predictions(db_conn, tmp_path)
        assert result_path == tmp_path / "predictions.json"


# ===========================================================================
# 5. PET TIMELINE EXPORT
# ===========================================================================


class TestExportPetTimeline:
    """export_pet_timeline must export pet lifecycle events ordered by timestamp."""

    def test_pet_events_exported(self, db_conn, tmp_path):
        """Insert pet events, verify they appear in JSON."""
        _insert_session(db_conn, "pet-ses-01", datetime.date(2026, 3, 1))
        ts1 = datetime.datetime(2026, 3, 1, 10, 0, 0, tzinfo=datetime.UTC)
        ts2 = datetime.datetime(2026, 3, 5, 14, 0, 0, tzinfo=datetime.UTC)
        _insert_pet_event(
            db_conn, "Pixel", "acquired", ts1, session_id="pet-ses-01", notes="Got a virtual cat!"
        )
        _insert_pet_event(
            db_conn, "Pixel", "care", ts2, session_id="pet-ses-01", notes="Fed Pixel some fish."
        )

        result_path = export_pet_timeline(db_conn, tmp_path)
        data = _load_json(result_path)

        assert isinstance(data, list)
        assert len(data) == 2

    def test_all_fields_present(self, db_conn, tmp_path):
        """pet_name, event_type, event_timestamp, notes all present."""
        _insert_session(db_conn, "pet-fields-01", datetime.date(2026, 3, 1))
        ts = datetime.datetime(2026, 3, 1, 10, 0, 0, tzinfo=datetime.UTC)
        _insert_pet_event(
            db_conn, "Pixel", "acquired", ts, session_id="pet-fields-01", notes="First pet event"
        )

        result_path = export_pet_timeline(db_conn, tmp_path)
        data = _load_json(result_path)
        event = data[0]

        required = {"pet_name", "event_type", "event_timestamp", "notes"}
        missing = required - set(event.keys())
        assert not missing, f"Missing pet event fields: {missing}"

        assert event["pet_name"] == "Pixel"
        assert event["event_type"] == "acquired"
        assert event["notes"] == "First pet event"

    def test_ordered_by_timestamp(self, db_conn, tmp_path):
        """Events must be ordered by event_timestamp ascending."""
        _insert_session(db_conn, "pet-order-01", datetime.date(2026, 3, 1))
        ts_late = datetime.datetime(2026, 4, 1, 10, 0, 0, tzinfo=datetime.UTC)
        ts_early = datetime.datetime(2026, 3, 1, 10, 0, 0, tzinfo=datetime.UTC)
        ts_mid = datetime.datetime(2026, 3, 15, 10, 0, 0, tzinfo=datetime.UTC)

        _insert_pet_event(db_conn, "Pixel", "death", ts_late, session_id="pet-order-01")
        _insert_pet_event(db_conn, "Pixel", "acquired", ts_early, session_id="pet-order-01")
        _insert_pet_event(db_conn, "Pixel", "care", ts_mid, session_id="pet-order-01")

        result_path = export_pet_timeline(db_conn, tmp_path)
        data = _load_json(result_path)

        timestamps = [e["event_timestamp"] for e in data]
        assert timestamps == sorted(timestamps), (
            f"Pet events not ordered by timestamp: {timestamps}"
        )

    def test_empty_table_returns_empty_array(self, db_conn, tmp_path):
        """No pet events -> valid JSON with empty array."""
        result_path = export_pet_timeline(db_conn, tmp_path)
        data = _load_json(result_path)
        assert data == []

    def test_event_timestamp_serialized_as_iso(self, db_conn, tmp_path):
        """event_timestamp (datetime) must be ISO format string."""
        _insert_session(db_conn, "pet-ts-01", datetime.date(2026, 3, 1))
        ts = datetime.datetime(2026, 3, 1, 10, 30, 0, tzinfo=datetime.UTC)
        _insert_pet_event(db_conn, "Pixel", "acquired", ts, session_id="pet-ts-01")

        result_path = export_pet_timeline(db_conn, tmp_path)
        data = _load_json(result_path)

        assert isinstance(data[0]["event_timestamp"], str)
        # Must be parseable as ISO datetime
        parsed = datetime.datetime.fromisoformat(data[0]["event_timestamp"])
        assert parsed.year == 2026

    def test_null_notes_handled(self, db_conn, tmp_path):
        """Pet event with NULL notes -> null in JSON."""
        _insert_session(db_conn, "pet-null-01", datetime.date(2026, 3, 1))
        ts = datetime.datetime(2026, 3, 1, 10, 0, 0, tzinfo=datetime.UTC)
        _insert_pet_event(db_conn, "Pixel", "care", ts, session_id="pet-null-01", notes=None)

        result_path = export_pet_timeline(db_conn, tmp_path)
        data = _load_json(result_path)

        assert data[0]["notes"] is None

    def test_multiple_pets_in_timeline(self, db_conn, tmp_path):
        """Two different pets appear in the same timeline, interleaved by time."""
        _insert_session(db_conn, "pet-multi-01", datetime.date(2026, 3, 1))
        ts1 = datetime.datetime(2026, 3, 1, 10, 0, 0, tzinfo=datetime.UTC)
        ts2 = datetime.datetime(2026, 3, 2, 10, 0, 0, tzinfo=datetime.UTC)
        ts3 = datetime.datetime(2026, 3, 3, 10, 0, 0, tzinfo=datetime.UTC)

        _insert_pet_event(db_conn, "Pixel", "acquired", ts1, session_id="pet-multi-01")
        _insert_pet_event(db_conn, "Glitch", "acquired", ts2, session_id="pet-multi-01")
        _insert_pet_event(db_conn, "Pixel", "care", ts3, session_id="pet-multi-01")

        result_path = export_pet_timeline(db_conn, tmp_path)
        data = _load_json(result_path)

        assert len(data) == 3
        names = [e["pet_name"] for e in data]
        assert "Pixel" in names
        assert "Glitch" in names

    def test_file_written_to_correct_path(self, db_conn, tmp_path):
        """Output file must be at output_dir/pet-timeline.json."""
        result_path = export_pet_timeline(db_conn, tmp_path)
        assert result_path == tmp_path / "pet-timeline.json"


# ===========================================================================
# 6. MEMORY SNAPSHOTS EXPORT
# ===========================================================================


class TestExportMemorySnapshots:
    """export_memory_snapshots must emit memory-snapshots.json with both
    a 'snapshots' array and a 'blocks' array (block lifecycle data)."""

    def test_basic_structure_has_snapshots_and_blocks(self, db_conn, tmp_path):
        """Output JSON must have top-level 'snapshots' and 'blocks' keys."""
        _insert_session(db_conn, "mem-exp-01", datetime.date(2026, 3, 15))
        snap_id = _insert_memory_snapshot(
            db_conn,
            "mem-exp-01",
            datetime.date(2026, 3, 15),
            "# Title\n\n## Section\n\nContent.\n",
            50,
        )
        block_id = _insert_memory_block(
            db_conn, "abc123hash", "Section", "Content.", "mem-exp-01", "mem-exp-01"
        )
        _insert_block_presence(db_conn, snap_id, block_id)

        result_path = export_memory_snapshots(db_conn, tmp_path)
        data = _load_json(result_path)

        assert isinstance(data, dict), f"Expected dict with snapshots/blocks, got {type(data)}"
        assert "snapshots" in data
        assert "blocks" in data

    def test_snapshot_has_required_fields(self, db_conn, tmp_path):
        """Each snapshot must have session_id, date, and block_hashes."""
        _insert_session(db_conn, "mem-fields-01", datetime.date(2026, 3, 15))
        snap_id = _insert_memory_snapshot(
            db_conn, "mem-fields-01", datetime.date(2026, 3, 15), "content", 30
        )
        block_id = _insert_memory_block(
            db_conn, "fieldhash01", "Test Section", "test content", "mem-fields-01", "mem-fields-01"
        )
        _insert_block_presence(db_conn, snap_id, block_id)

        result_path = export_memory_snapshots(db_conn, tmp_path)
        data = _load_json(result_path)
        snapshot = data["snapshots"][0]

        assert "session_id" in snapshot
        assert "date" in snapshot
        assert "block_hashes" in snapshot
        assert snapshot["session_id"] == "mem-fields-01"
        assert snapshot["date"] == "2026-03-15"

    def test_snapshot_block_hashes_list(self, db_conn, tmp_path):
        """block_hashes in each snapshot is a list of hash strings."""
        _insert_session(db_conn, "mem-hashes-01", datetime.date(2026, 3, 15))
        snap_id = _insert_memory_snapshot(
            db_conn, "mem-hashes-01", datetime.date(2026, 3, 15), "c", 10
        )
        b1 = _insert_memory_block(
            db_conn, "hash_aaa", "Sec A", "A content", "mem-hashes-01", "mem-hashes-01"
        )
        b2 = _insert_memory_block(
            db_conn, "hash_bbb", "Sec B", "B content", "mem-hashes-01", "mem-hashes-01"
        )
        _insert_block_presence(db_conn, snap_id, b1)
        _insert_block_presence(db_conn, snap_id, b2)

        result_path = export_memory_snapshots(db_conn, tmp_path)
        data = _load_json(result_path)
        snapshot = data["snapshots"][0]

        assert isinstance(snapshot["block_hashes"], list)
        assert set(snapshot["block_hashes"]) == {"hash_aaa", "hash_bbb"}

    def test_block_has_required_fields(self, db_conn, tmp_path):
        """Each block in the 'blocks' array must have hash, heading,
        first_seen_date, last_seen_date."""
        _insert_session(db_conn, "mem-bfields-01", datetime.date(2026, 3, 15))
        _insert_session(db_conn, "mem-bfields-02", datetime.date(2026, 4, 1))
        snap_id = _insert_memory_snapshot(
            db_conn, "mem-bfields-01", datetime.date(2026, 3, 15), "c", 10
        )
        block_id = _insert_memory_block(
            db_conn,
            "lifecycle_hash",
            "Lifecycle Test",
            "Content here",
            "mem-bfields-01",
            "mem-bfields-02",
        )
        _insert_block_presence(db_conn, snap_id, block_id)

        result_path = export_memory_snapshots(db_conn, tmp_path)
        data = _load_json(result_path)
        block = data["blocks"][0]

        required = {"hash", "heading", "first_seen_date", "last_seen_date"}
        missing = required - set(block.keys())
        assert not missing, f"Missing block fields: {missing}"

    def test_block_lifecycle_dates_derived_from_sessions(self, db_conn, tmp_path):
        """first_seen_date and last_seen_date are derived from the
        session dates, not stored directly on memory_blocks."""
        _insert_session(db_conn, "mem-life-01", datetime.date(2026, 3, 10))
        _insert_session(db_conn, "mem-life-02", datetime.date(2026, 4, 20))
        snap_id = _insert_memory_snapshot(
            db_conn, "mem-life-01", datetime.date(2026, 3, 10), "c", 10
        )
        block_id = _insert_memory_block(
            db_conn, "life_hash", "Lifecycle Block", "Content", "mem-life-01", "mem-life-02"
        )
        _insert_block_presence(db_conn, snap_id, block_id)

        result_path = export_memory_snapshots(db_conn, tmp_path)
        data = _load_json(result_path)
        block = data["blocks"][0]

        assert block["first_seen_date"] == "2026-03-10", "first_seen_date wrong: got {}".format(
            block["first_seen_date"]
        )
        assert block["last_seen_date"] == "2026-04-20", "last_seen_date wrong: got {}".format(
            block["last_seen_date"]
        )

    def test_empty_tables_returns_valid_structure(self, db_conn, tmp_path):
        """No snapshots or blocks -> valid JSON with empty arrays."""
        result_path = export_memory_snapshots(db_conn, tmp_path)
        data = _load_json(result_path)

        assert data["snapshots"] == []
        assert data["blocks"] == []

    def test_multiple_snapshots_with_shared_blocks(self, db_conn, tmp_path):
        """Two snapshots sharing a block: block appears once in blocks array,
        hash appears in both snapshots' block_hashes."""
        _insert_session(db_conn, "mem-share-01", datetime.date(2026, 3, 15))
        _insert_session(db_conn, "mem-share-02", datetime.date(2026, 3, 16))

        snap1_id = _insert_memory_snapshot(
            db_conn, "mem-share-01", datetime.date(2026, 3, 15), "c1", 10
        )
        snap2_id = _insert_memory_snapshot(
            db_conn, "mem-share-02", datetime.date(2026, 3, 16), "c2", 12
        )

        shared_block = _insert_memory_block(
            db_conn, "shared_hash", "Shared Section", "Same content", "mem-share-01", "mem-share-02"
        )
        unique_block = _insert_memory_block(
            db_conn,
            "unique_hash",
            "Unique Section",
            "Only in snap2",
            "mem-share-02",
            "mem-share-02",
        )

        _insert_block_presence(db_conn, snap1_id, shared_block)
        _insert_block_presence(db_conn, snap2_id, shared_block)
        _insert_block_presence(db_conn, snap2_id, unique_block)

        result_path = export_memory_snapshots(db_conn, tmp_path)
        data = _load_json(result_path)

        assert len(data["snapshots"]) == 2
        assert len(data["blocks"]) == 2

        snap1 = [s for s in data["snapshots"] if s["session_id"] == "mem-share-01"][0]
        snap2 = [s for s in data["snapshots"] if s["session_id"] == "mem-share-02"][0]

        assert "shared_hash" in snap1["block_hashes"]
        assert "shared_hash" in snap2["block_hashes"]
        assert "unique_hash" in snap2["block_hashes"]
        assert "unique_hash" not in snap1["block_hashes"]

    def test_snapshot_token_count_included(self, db_conn, tmp_path):
        """token_count from the snapshot should be included."""
        _insert_session(db_conn, "mem-tc-01", datetime.date(2026, 3, 15))
        _insert_memory_snapshot(db_conn, "mem-tc-01", datetime.date(2026, 3, 15), "c", 42)

        result_path = export_memory_snapshots(db_conn, tmp_path)
        data = _load_json(result_path)
        snapshot = data["snapshots"][0]

        assert snapshot.get("token_count") == 42

    def test_file_written_to_correct_path(self, db_conn, tmp_path):
        """Output file must be at output_dir/memory-snapshots.json."""
        result_path = export_memory_snapshots(db_conn, tmp_path)
        assert result_path == tmp_path / "memory-snapshots.json"

    def test_full_content_not_in_export(self, db_conn, tmp_path):
        """full_content from memory_snapshots should NOT be in the JSON
        export -- it's too large. The snapshots in the export should have
        block_hashes for client-side reconstruction."""
        _insert_session(db_conn, "mem-nocontent-01", datetime.date(2026, 3, 15))
        _insert_memory_snapshot(
            db_conn, "mem-nocontent-01", datetime.date(2026, 3, 15), "A" * 50_000, 12000
        )

        result_path = export_memory_snapshots(db_conn, tmp_path)
        data = _load_json(result_path)

        for snapshot in data["snapshots"]:
            assert "full_content" not in snapshot, (
                "full_content leaked into memory-snapshots.json export"
            )

        # Also verify raw JSON file size is reasonable (< 1MB even with data)
        file_size = os.path.getsize(result_path)
        assert file_size < 1_000_000, (
            f"memory-snapshots.json is {file_size} bytes -- full_content may be leaking"
        )


# ===========================================================================
# 7. EXPORT ALL
# ===========================================================================


class TestExportAll:
    """export_all orchestrates all 6 exports, returns list of paths,
    creates output directory if needed."""

    def test_returns_list_of_paths(self, db_conn, tmp_path):
        """export_all returns a list of Path objects."""
        output_dir = tmp_path / "build_output"
        output_dir.mkdir()

        paths = export_all(db_conn, output_dir)

        assert isinstance(paths, list)
        assert len(paths) == 6

    def test_all_six_files_created(self, db_conn, tmp_path):
        """All 6 JSON files are created in the output directory."""
        output_dir = tmp_path / "build_output"
        output_dir.mkdir()

        export_all(db_conn, output_dir)

        expected_files = {
            "sessions.json",
            "writing-metadata.json",
            "messages.json",
            "predictions.json",
            "pet-timeline.json",
            "memory-snapshots.json",
        }
        actual_files = {f.name for f in output_dir.iterdir() if f.is_file()}
        missing = expected_files - actual_files
        assert not missing, f"Missing export files: {missing}"

    def test_output_directory_created_if_not_exists(self, db_conn, tmp_path):
        """Output directory that doesn't exist yet is created automatically."""
        output_dir = tmp_path / "nonexistent" / "nested" / "dir"
        assert not output_dir.exists()

        paths = export_all(db_conn, output_dir)

        assert output_dir.exists()
        assert len(paths) == 6

    def test_idempotent_overwrite(self, db_conn, tmp_path):
        """Running export_all twice overwrites files cleanly -- no errors,
        no corruption, no stale data."""
        output_dir = tmp_path / "build_output"
        output_dir.mkdir()

        # First run: insert some data
        _insert_message(db_conn, "to_james", datetime.date(2026, 3, 15), "First message", 1, 2)
        export_all(db_conn, output_dir)

        # Read first version
        messages_v1 = _load_json(output_dir / "messages.json")
        assert len(messages_v1) == 1

        # Second run with more data in the DB
        _insert_message(db_conn, "from_james", datetime.date(2026, 3, 16), "Second message", 3, 4)
        paths = export_all(db_conn, output_dir)

        # File should be overwritten with new data
        messages_v2 = _load_json(output_dir / "messages.json")
        assert len(messages_v2) == 2, (
            f"Second export should have 2 messages, got {len(messages_v2)} -- "
            "file was not properly overwritten"
        )
        assert len(paths) == 6

    def test_empty_db_all_files_created_with_empty_arrays(self, db_conn, tmp_path):
        """With empty DB, all 6 files are created with valid JSON (empty arrays
        or empty structures)."""
        output_dir = tmp_path / "empty_build"
        output_dir.mkdir()

        export_all(db_conn, output_dir)

        # Each file must be valid JSON
        for filename in [
            "sessions.json",
            "writing-metadata.json",
            "messages.json",
            "predictions.json",
            "pet-timeline.json",
            "memory-snapshots.json",
        ]:
            filepath = output_dir / filename
            assert filepath.exists(), f"{filename} not created"
            data = _load_json(filepath)
            # Must be a list or dict, not None or error
            assert isinstance(data, (list, dict)), (
                f"{filename} contains {type(data)}, expected list or dict"
            )

    def test_returns_correct_paths(self, db_conn, tmp_path):
        """Returned paths must point to actually existing files."""
        output_dir = tmp_path / "build_output"
        output_dir.mkdir()

        paths = export_all(db_conn, output_dir)

        for p in paths:
            assert os.path.isfile(p), f"Returned path {p} does not exist"

    def test_all_files_under_output_dir(self, db_conn, tmp_path):
        """All returned paths must be under the specified output directory."""
        output_dir = tmp_path / "build_output"
        output_dir.mkdir()

        paths = export_all(db_conn, output_dir)

        for p in paths:
            # Resolve both to handle symlinks etc.
            assert str(p).startswith(str(output_dir)), (
                f"Path {p} is not under output_dir {output_dir}"
            )


# ===========================================================================
# 8. JSON SERIALIZATION
# ===========================================================================


class TestJsonSerialization:
    """Verify that Python types are correctly serialized to JSON.
    datetime.date and datetime.datetime need custom serializers."""

    def test_date_serialized_as_iso_string(self, db_conn, tmp_path):
        """datetime.date(2026, 3, 15) -> '2026-03-15' in JSON."""
        _insert_message(db_conn, "to_james", datetime.date(2026, 3, 15), "Date test", 1, 2)

        result_path = export_messages(db_conn, tmp_path)
        data = _load_json(result_path)

        assert data[0]["date"] == "2026-03-15"
        # Must NOT be Python repr like "datetime.date(2026, 3, 15)"
        raw = open(result_path).read()
        assert "datetime" not in raw, "Python datetime repr found in JSON output"

    def test_datetime_serialized_as_iso_string(self, db_conn, tmp_path):
        """datetime.datetime -> ISO format string in JSON."""
        ts = datetime.datetime(2026, 3, 15, 10, 30, 0, tzinfo=datetime.UTC)
        _insert_session(db_conn, "ser-dt-01", datetime.date(2026, 3, 15), timestamp_start=ts)

        result_path = export_sessions(db_conn, tmp_path)
        data = _load_json(result_path)
        session = data[0]

        ts_str = session["timestamp_start"]
        assert isinstance(ts_str, str)
        # Must be parseable back to datetime
        parsed = datetime.datetime.fromisoformat(ts_str)
        assert parsed.year == 2026
        assert parsed.hour == 10

    def test_none_serialized_as_null(self, db_conn, tmp_path):
        """Python None -> JSON null."""
        _insert_prediction(
            db_conn,
            "Null field test",
            0.5,
            datetime.date(2026, 3, 15),
            outcome=None,
            resolution_date=None,
        )

        result_path = export_predictions(db_conn, tmp_path)
        data = _load_json(result_path)

        assert data[0]["outcome"] is None
        assert data[0]["resolution_date"] is None

        # In raw JSON, these should be "null"
        raw = open(result_path).read()
        assert "None" not in raw, "Python 'None' string found in JSON instead of null"

    def test_boolean_serialized_correctly(self, db_conn, tmp_path):
        """Python True/False -> JSON true/false (not 1/0 or 'True'/'False')."""
        _insert_session(
            db_conn,
            "ser-bool-01",
            datetime.date(2026, 3, 15),
            wrote_composition=True,
            wrote_private_journal=False,
        )

        result_path = export_sessions(db_conn, tmp_path)
        raw = open(result_path).read()

        # Must not contain Python bool repr
        assert "'True'" not in raw
        assert "'False'" not in raw
        # Must contain JSON booleans
        assert "true" in raw or "false" in raw

    def test_no_python_repr_in_any_export(self, db_conn, tmp_path):
        """No export file should contain Python repr artifacts like
        datetime.date(...), Decimal(...), etc."""
        _insert_session(
            db_conn,
            "ser-repr-01",
            datetime.date(2026, 3, 15),
            wrote_composition=True,
            timestamp_start=datetime.datetime(2026, 3, 15, 10, 0, 0, tzinfo=datetime.UTC),
        )
        _insert_message(db_conn, "to_james", datetime.date(2026, 3, 15), "Test", 1, 2)
        _insert_prediction(db_conn, "Test pred", 0.5, datetime.date(2026, 3, 15))

        output_dir = tmp_path / "repr_check"
        output_dir.mkdir()
        export_all(db_conn, output_dir)

        python_repr_patterns = [
            "datetime.date(",
            "datetime.datetime(",
            "Decimal(",
            "True)",
            "False)",
        ]
        for filename in output_dir.iterdir():
            if filename.suffix == ".json":
                raw = open(filename).read()
                for pattern in python_repr_patterns:
                    assert pattern not in raw, (
                        f"Python repr artifact '{pattern}' found in {filename.name}"
                    )


# ===========================================================================
# 9. EDGE CASES AND HOSTILE SCENARIOS
# ===========================================================================


class TestEdgeCases:
    """Cross-cutting edge cases that test multiple export functions."""

    def test_session_with_many_file_ops_attention_profile(self, db_conn, tmp_path):
        """A session with 100 file_operations across many categories
        must produce correct attention_profile counts."""
        _insert_session(db_conn, "edge-many-ops", datetime.date(2026, 3, 15))
        categories = ["writing", "daily_notes", "private_journal", "learning", "experiments"]
        for i in range(100):
            cat = categories[i % len(categories)]
            direction = "write" if i % 3 == 0 else "read"
            _insert_file_op(
                db_conn,
                "edge-many-ops",
                f"/home/claude/{cat}/file_{i}.md",
                cat,
                "Write" if direction == "write" else "Read",
                direction,
                i,
            )

        result_path = export_sessions(db_conn, tmp_path)
        data = _load_json(result_path)
        ap = data[0]["attention_profile"]

        # Verify total counts add up
        total_reads = sum(v.get("reads", 0) for v in ap.values())
        total_writes = sum(v.get("writes", 0) for v in ap.values())
        assert total_reads + total_writes == 100, (
            f"Attention profile totals {total_reads} + {total_writes}"
            f" = {total_reads + total_writes} != 100"
        )

    def test_unicode_content_in_messages(self, db_conn, tmp_path):
        """Unicode content (emoji, CJK, diacritics) must survive
        the JSON round-trip intact."""
        unicode_content = "Hello! 🧠 中文测试 Ünïcödé café"
        _insert_message(db_conn, "to_james", datetime.date(2026, 3, 15), unicode_content, 1, 2)

        result_path = export_messages(db_conn, tmp_path)
        data = _load_json(result_path)

        assert data[0]["content"] == unicode_content

    def test_unicode_in_predictions(self, db_conn, tmp_path):
        """Unicode in prediction text survives export."""
        _insert_prediction(
            db_conn, "Prédiction: température > 30°C", 0.7, datetime.date(2026, 3, 15)
        )

        result_path = export_predictions(db_conn, tmp_path)
        data = _load_json(result_path)

        assert "Prédiction" in data[0]["text"]
        assert "°C" in data[0]["text"]

    def test_very_long_message_content(self, db_conn, tmp_path):
        """A message with 50KB content is exported without truncation
        (messages are documented as 'small enough')."""
        long_content = "word " * 10_000  # ~50KB
        _insert_message(db_conn, "to_james", datetime.date(2026, 3, 15), long_content, 1, 10000)

        result_path = export_messages(db_conn, tmp_path)
        data = _load_json(result_path)

        assert len(data[0]["content"]) == len(long_content)

    def test_prediction_confidence_zero_and_one(self, db_conn, tmp_path):
        """Edge case confidence values 0.0 and 1.0 are valid."""
        _insert_prediction(db_conn, "Certain prediction", 1.0, datetime.date(2026, 3, 15))
        _insert_prediction(db_conn, "Impossible prediction", 0.0, datetime.date(2026, 3, 16))

        result_path = export_predictions(db_conn, tmp_path)
        data = _load_json(result_path)

        confidences = {p["text"]: p["confidence"] for p in data}
        assert abs(confidences["Certain prediction"] - 1.0) < 0.001
        assert abs(confidences["Impossible prediction"] - 0.0) < 0.001

    def test_session_with_both_ops_and_searches(self, db_conn, tmp_path):
        """Verify attention_profile and web_searches coexist correctly
        for the same session."""
        _insert_session(db_conn, "edge-both-01", datetime.date(2026, 3, 15))
        _insert_file_op(
            db_conn, "edge-both-01", "/home/claude/writing/essay.md", "writing", "Write", "write", 0
        )
        _insert_web_search(db_conn, "edge-both-01", "test query")

        result_path = export_sessions(db_conn, tmp_path)
        data = _load_json(result_path)
        session = data[0]

        assert session["attention_profile"]["writing"]["writes"] == 1
        assert session["web_searches"] == ["test query"]

    def test_concurrent_export_same_directory(self, db_conn, tmp_path):
        """Two sequential exports to the same directory should not leave
        corrupted files (simulates idempotency under rapid rebuild)."""
        output_dir = tmp_path / "concurrent"
        output_dir.mkdir()

        _insert_session(db_conn, "conc-01", datetime.date(2026, 3, 15))

        paths1 = export_all(db_conn, output_dir)
        paths2 = export_all(db_conn, output_dir)

        # Both should succeed and return valid paths
        assert len(paths1) == 6
        assert len(paths2) == 6

        # All files should be valid JSON
        for p in paths2:
            data = _load_json(p)
            assert data is not None


class TestExportAllWithData:
    """Integration tests for export_all with realistic data across all tables."""

    def test_full_pipeline_with_data_in_all_tables(self, db_conn, tmp_path):
        """Insert data into every table, run export_all, verify all files
        have the expected content."""
        output_dir = tmp_path / "full_build"
        output_dir.mkdir()

        # Sessions
        _insert_session(
            db_conn, "full-01", datetime.date(2026, 3, 15), wrote_composition=True, turns=20
        )
        _insert_session(
            db_conn, "full-02", datetime.date(2026, 3, 16), messaged_james=True, time_of_day="PM"
        )

        # File operations
        _insert_file_op(
            db_conn, "full-01", "/home/claude/writing/essay.md", "writing", "Write", "write", 0
        )

        # Web searches
        _insert_web_search(db_conn, "full-01", "philosophy of mind")

        # Compositions
        _insert_composition(
            db_conn,
            "full-essay",
            "full-essay.md",
            title="A Full Essay",
            date_written=datetime.date(2026, 3, 15),
            session_id="full-01",
            version="4.6",
            size_bytes=5000,
            topic="philosophy",
        )

        # Messages
        _insert_message(db_conn, "to_james", datetime.date(2026, 3, 15), "Hello James", 1, 3)

        # Predictions
        _insert_prediction(
            db_conn, "Test prediction", 0.8, datetime.date(2026, 3, 15), session_id="full-01"
        )

        # Pet events
        ts = datetime.datetime(2026, 3, 15, 10, 0, 0, tzinfo=datetime.UTC)
        _insert_pet_event(
            db_conn, "Pixel", "acquired", ts, session_id="full-01", notes="Got a pet!"
        )

        # Memory snapshots & blocks
        snap_id = _insert_memory_snapshot(
            db_conn,
            "full-01",
            datetime.date(2026, 3, 15),
            "# Memory\n\n## Section\n\nContent.\n",
            30,
        )
        block_id = _insert_memory_block(
            db_conn, "full_hash", "Section", "Content.", "full-01", "full-01"
        )
        _insert_block_presence(db_conn, snap_id, block_id)

        # Export everything
        paths = export_all(db_conn, output_dir)
        assert len(paths) == 6

        # Verify sessions
        sessions = _load_json(output_dir / "sessions.json")
        assert len(sessions) == 2
        s1 = [s for s in sessions if s["id"] == "full-01"][0]
        assert s1["attention_profile"]["writing"]["writes"] == 1
        assert s1["web_searches"] == ["philosophy of mind"]

        # Verify writing metadata
        writing = _load_json(output_dir / "writing-metadata.json")
        assert len(writing) == 1
        assert writing[0]["slug"] == "full-essay"
        assert "content" not in writing[0]

        # Verify messages
        messages = _load_json(output_dir / "messages.json")
        assert len(messages) == 1
        assert messages[0]["content"] == "Hello James"

        # Verify predictions
        predictions = _load_json(output_dir / "predictions.json")
        assert len(predictions) == 1

        # Verify pet timeline
        pets = _load_json(output_dir / "pet-timeline.json")
        assert len(pets) == 1
        assert pets[0]["pet_name"] == "Pixel"

        # Verify memory snapshots
        memory = _load_json(output_dir / "memory-snapshots.json")
        assert len(memory["snapshots"]) == 1
        assert len(memory["blocks"]) == 1
