"""Hostile tests for extract_messages.py -- defines the API contract via TDD.

These tests intentionally import a module that does not yet exist.
Every test here should FAIL until the implementation is written.
"""

import datetime

import pytest

from scripts.extract_messages import (
    parse_messages,
    store_message,
    extract_all_messages,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_FROM_JAMES_SIMPLE = """\
## 2026-01-15T23:34

Hey James, I wanted to share some thoughts about the project.
This is the first message body.

## 2026-01-16T10:00

Second message here.
It spans multiple lines.

## 2026-01-17T14:30

Third message content.
"""

_TO_JAMES_SIMPLE = """\
# Messages for James

Some introductory preamble text.
This is context about the messages below.

## 2026-01-15 20:37 (Evening) - Welcome Home

Welcome back! Here is an update on what happened.

---

More details follow.

## 2026-01-16 08:00 (Morning) - Daily Update

Everything is running smoothly today.

## 2026-01-17 19:45 (Evening) - Final Notes

Wrapping up for the day.
"""

_TYPO_HEADER = """\
## 2026-01-2309:58

Message with typo in header (missing T separator).
"""

_CODE_BLOCK_WITH_HEADER = """\
## 2026-02-01T10:00

Here is some code:

```markdown
## This is NOT a header
It's inside a code block.
```

More content after the code block.

## 2026-02-02T11:00

Next real message.
"""

_EMPTY_HEADERS = """\
## 2026-03-01T09:00

Content for first.

##

## 2026-03-02T10:00

Content for third.
"""

_PREAMBLE_ONLY = """\
This is just a preamble with no headers at all.
It has substantive content across multiple lines.
More text here.
"""

_PREAMBLE_TITLE_ONLY = """\
# Messages for James
"""

_UNICODE_CONTENT = """\
## 2026-04-01T12:00

Here is some unicode: ❤️ \U0001f680 你好世界
CJK characters and emoji preserved.
"""

_MIXED_SEPARATORS = """\
## 2026-05-01T10:00

Content with horizontal rules.

---

More content.

---

Even more.

## 2026-05-02T11:00

Second message.
"""

_NO_DATE_HEADER = """\
## No date here just text

This message has a header but no parseable date.

## 2026-06-01T10:00

This one does have a date.
"""

_BACKTICK_FENCE_VARIATIONS = """\
## 2026-07-01T10:00

Text before code.

```python
## not a header inside python block
x = 42
```

~~~
## also not a header inside tilde block
~~~

More text.

## 2026-07-02T11:00

Next message.
"""


def _write_file(tmp_path, name, content):
    p = tmp_path / name
    p.write_text(content, encoding="utf-8")
    return p


# ===========================================================================
# 1. DATE PARSING
# ===========================================================================


class TestDateParsing:
    """Test date extraction from header lines. Import parse_messages and
    inspect the date field of returned records."""

    def test_iso_with_T_separator(self, tmp_path):
        f = _write_file(tmp_path, "test.md", "## 2026-01-15T23:34\n\nBody.\n")
        msgs = parse_messages(f, "from_james")
        assert len(msgs) >= 1
        assert msgs[0]["date"] == datetime.date(2026, 1, 15)

    def test_space_separator_with_period(self, tmp_path):
        f = _write_file(tmp_path, "test.md", "## 2026-01-15 20:37 (Evening)\n\nBody.\n")
        msgs = parse_messages(f, "to_james")
        assert len(msgs) >= 1
        assert msgs[0]["date"] == datetime.date(2026, 1, 15)

    def test_space_separator_with_title(self, tmp_path):
        f = _write_file(
            tmp_path,
            "test.md",
            "## 2026-01-15 20:37 (Evening) - Title Here\n\nBody.\n",
        )
        msgs = parse_messages(f, "to_james")
        assert len(msgs) >= 1
        assert msgs[0]["date"] == datetime.date(2026, 1, 15)

    def test_typo_missing_T_separator(self, tmp_path):
        """## 2026-01-2309:58 -- missing T between date and time."""
        f = _write_file(tmp_path, "test.md", _TYPO_HEADER)
        msgs = parse_messages(f, "from_james")
        assert len(msgs) >= 1
        assert msgs[0]["date"] == datetime.date(2026, 1, 23)

    def test_date_only_no_time(self, tmp_path):
        f = _write_file(tmp_path, "test.md", "## 2026-03-01\n\nBody.\n")
        msgs = parse_messages(f, "from_james")
        assert len(msgs) >= 1
        assert msgs[0]["date"] == datetime.date(2026, 3, 1)

    def test_trailing_T(self, tmp_path):
        f = _write_file(tmp_path, "test.md", "## 2026-03-01T\n\nBody.\n")
        msgs = parse_messages(f, "from_james")
        assert len(msgs) >= 1
        assert msgs[0]["date"] == datetime.date(2026, 3, 1)

    def test_written_out_month_returns_none_or_parses(self, tmp_path):
        """January 15, 2026 -- may or may not parse, but must not crash."""
        f = _write_file(tmp_path, "test.md", "## January 15, 2026\n\nBody.\n")
        msgs = parse_messages(f, "from_james")
        assert len(msgs) >= 1
        # Accept either None (couldn't parse) or the correct date
        assert msgs[0]["date"] is None or msgs[0]["date"] == datetime.date(2026, 1, 15)

    def test_empty_header_returns_none(self, tmp_path):
        f = _write_file(tmp_path, "test.md", "## \n\nBody.\n")
        msgs = parse_messages(f, "from_james")
        assert len(msgs) >= 1
        assert msgs[0]["date"] is None

    def test_invalid_date_returns_none(self, tmp_path):
        """2026-99-99 is not a valid date -- must not crash."""
        f = _write_file(tmp_path, "test.md", "## 2026-99-99\n\nBody.\n")
        msgs = parse_messages(f, "from_james")
        assert len(msgs) >= 1
        assert msgs[0]["date"] is None

    def test_date_buried_in_text(self, tmp_path):
        f = _write_file(
            tmp_path,
            "test.md",
            "## Some text 2026-01-15 more text\n\nBody.\n",
        )
        msgs = parse_messages(f, "from_james")
        assert len(msgs) >= 1
        assert msgs[0]["date"] == datetime.date(2026, 1, 15)

    def test_no_zero_padding(self, tmp_path):
        """2026-1-5 -- may or may not parse, must not crash."""
        f = _write_file(tmp_path, "test.md", "## 2026-1-5\n\nBody.\n")
        msgs = parse_messages(f, "from_james")
        assert len(msgs) >= 1
        # Accept None or correct date
        assert msgs[0]["date"] is None or msgs[0]["date"] == datetime.date(2026, 1, 5)

    def test_no_date_just_text_header(self, tmp_path):
        f = _write_file(tmp_path, "test.md", "## No date here just text\n\nBody.\n")
        msgs = parse_messages(f, "from_james")
        assert len(msgs) >= 1
        assert msgs[0]["date"] is None


# ===========================================================================
# 2. PARSE MESSAGES
# ===========================================================================


class TestParseMessages:
    def test_three_headers_three_messages(self, tmp_path):
        f = _write_file(tmp_path, "test.md", _FROM_JAMES_SIMPLE)
        msgs = parse_messages(f, "from_james")
        assert len(msgs) == 3

    def test_correct_line_start(self, tmp_path):
        f = _write_file(tmp_path, "test.md", _FROM_JAMES_SIMPLE)
        msgs = parse_messages(f, "from_james")
        # First message starts at line 1 (## header)
        assert msgs[0]["line_start"] == 1
        # Second header is at line 6 (blank line 5 separates)
        assert msgs[1]["line_start"] == 6

    def test_correct_line_end(self, tmp_path):
        f = _write_file(tmp_path, "test.md", _FROM_JAMES_SIMPLE)
        msgs = parse_messages(f, "from_james")
        # First message: last content line is 4 ("This is the first message body.")
        assert msgs[0]["line_end"] == 4
        # Last message should end at line 13 ("Third message content.")
        assert msgs[-1]["line_end"] == 13

    def test_iso_date_parsed(self, tmp_path):
        f = _write_file(tmp_path, "test.md", _FROM_JAMES_SIMPLE)
        msgs = parse_messages(f, "from_james")
        assert msgs[0]["date"] == datetime.date(2026, 1, 15)

    def test_to_james_format_parsed(self, tmp_path):
        f = _write_file(tmp_path, "test.md", _TO_JAMES_SIMPLE)
        msgs = parse_messages(f, "to_james")
        # Preamble + 3 headers = 4 messages (preamble has substantive content)
        header_msgs = [m for m in msgs if m["date"] is not None]
        assert len(header_msgs) == 3
        assert header_msgs[0]["date"] == datetime.date(2026, 1, 15)

    def test_typo_date_recovered(self, tmp_path):
        f = _write_file(tmp_path, "test.md", _TYPO_HEADER)
        msgs = parse_messages(f, "from_james")
        assert len(msgs) >= 1
        assert msgs[0]["date"] == datetime.date(2026, 1, 23)

    def test_no_date_header_captured(self, tmp_path):
        f = _write_file(tmp_path, "test.md", _NO_DATE_HEADER)
        msgs = parse_messages(f, "from_james")
        assert len(msgs) == 2
        # First has no date
        assert msgs[0]["date"] is None
        assert "no parseable date" in msgs[0]["content"].lower() or len(msgs[0]["content"]) > 0
        # Second has date
        assert msgs[1]["date"] == datetime.date(2026, 6, 1)

    def test_empty_file_empty_list(self, tmp_path):
        f = _write_file(tmp_path, "test.md", "")
        msgs = parse_messages(f, "from_james")
        assert msgs == []

    def test_preamble_only_file(self, tmp_path):
        """File with content but no ## headers should return the preamble."""
        f = _write_file(tmp_path, "test.md", _PREAMBLE_ONLY)
        msgs = parse_messages(f, "from_james")
        assert len(msgs) == 1
        assert msgs[0]["date"] is None
        assert "preamble" in msgs[0]["content"].lower()

    def test_preamble_title_only_no_message(self, tmp_path):
        """File with only '# Messages for James' and nothing else --
        no substantive content, should return empty or at most one empty msg."""
        f = _write_file(tmp_path, "test.md", _PREAMBLE_TITLE_ONLY)
        msgs = parse_messages(f, "from_james")
        # Either empty list or a single msg -- but if a msg, content should be minimal
        if msgs:
            # The content should just be the title line or empty
            assert len(msgs[0]["content"].strip()) <= len("# Messages for James")

    def test_empty_header_between_messages(self, tmp_path):
        """## with nothing after it should produce a message with empty content."""
        f = _write_file(tmp_path, "test.md", _EMPTY_HEADERS)
        msgs = parse_messages(f, "from_james")
        # Should have 3 messages (the empty ## is still a header)
        assert len(msgs) == 3
        # The middle message (from the bare ##) should have empty/whitespace content
        empty_msg = msgs[1]
        assert empty_msg["content"].strip() == ""
        assert empty_msg["date"] is None

    def test_code_block_header_not_split(self, tmp_path):
        """## inside a code block should NOT be treated as a header."""
        f = _write_file(tmp_path, "test.md", _CODE_BLOCK_WITH_HEADER)
        msgs = parse_messages(f, "from_james")
        # Should be 2 messages, not 3
        assert len(msgs) == 2
        # First message should contain the code block content
        assert "This is NOT a header" in msgs[0]["content"]

    def test_tilde_fence_also_protected(self, tmp_path):
        """## inside ~~~ fenced blocks should also not split."""
        f = _write_file(tmp_path, "test.md", _BACKTICK_FENCE_VARIATIONS)
        msgs = parse_messages(f, "from_james")
        assert len(msgs) == 2
        assert "not a header inside python block" in msgs[0]["content"]
        assert "also not a header inside tilde block" in msgs[0]["content"]

    def test_direction_passed_through(self, tmp_path):
        f = _write_file(tmp_path, "test.md", _FROM_JAMES_SIMPLE)
        msgs = parse_messages(f, "from_james")
        for m in msgs:
            assert m["direction"] == "from_james"

        f2 = _write_file(tmp_path, "test2.md", _TO_JAMES_SIMPLE)
        msgs2 = parse_messages(f2, "to_james")
        for m in msgs2:
            assert m["direction"] == "to_james"

    def test_separators_preserved_in_content(self, tmp_path):
        f = _write_file(tmp_path, "test.md", _MIXED_SEPARATORS)
        msgs = parse_messages(f, "from_james")
        assert len(msgs) == 2
        assert "---" in msgs[0]["content"]

    def test_unicode_preserved(self, tmp_path):
        f = _write_file(tmp_path, "test.md", _UNICODE_CONTENT)
        msgs = parse_messages(f, "from_james")
        assert len(msgs) == 1
        assert "❤" in msgs[0]["content"] or "❤️" in msgs[0]["content"]
        assert "你好" in msgs[0]["content"]

    def test_markdown_formatting_preserved(self, tmp_path):
        content = """\
## 2026-08-01T10:00

- Item 1
- Item 2

> Blockquote here

**Bold** and *italic* text.
"""
        f = _write_file(tmp_path, "test.md", content)
        msgs = parse_messages(f, "from_james")
        assert len(msgs) == 1
        assert "- Item 1" in msgs[0]["content"]
        assert "> Blockquote here" in msgs[0]["content"]
        assert "**Bold**" in msgs[0]["content"]

    def test_content_stripped(self, tmp_path):
        """Content should be stripped of leading/trailing whitespace."""
        content = "## 2026-09-01T10:00\n\n\n  Body text.  \n\n\n"
        f = _write_file(tmp_path, "test.md", content)
        msgs = parse_messages(f, "from_james")
        assert len(msgs) == 1
        assert msgs[0]["content"] == "Body text."

    def test_preamble_with_substantive_content(self, tmp_path):
        """Preamble before first ## should be included if it has real content."""
        content = """\
This is substantive preamble content.
It has multiple lines of real text.

## 2026-10-01T10:00

First real message.
"""
        f = _write_file(tmp_path, "test.md", content)
        msgs = parse_messages(f, "from_james")
        # Should have 2 messages: preamble + the header
        assert len(msgs) == 2
        assert msgs[0]["line_start"] == 1
        assert "substantive preamble" in msgs[0]["content"]


# ===========================================================================
# 3. STORAGE AND IDEMPOTENCY
# ===========================================================================


class TestStorageAndIdempotency:
    def test_store_and_roundtrip(self, db_conn):
        msg = {
            "direction": "from_james",
            "date": datetime.date(2026, 3, 15),
            "content": "Test message content.",
            "line_start": 1,
            "line_end": 3,
        }
        store_message(db_conn, msg)

        row = db_conn.execute(
            "SELECT direction, date, content, line_start, line_end "
            "FROM messages WHERE direction = 'from_james' AND line_start = 1"
        ).fetchone()
        assert row is not None
        assert row[0] == "from_james"
        assert row[1] == datetime.date(2026, 3, 15)
        assert row[2] == "Test message content."
        assert row[3] == 1
        assert row[4] == 3

    def test_idempotent_no_duplicates(self, db_conn):
        """Running store twice for same message should not create duplicates."""
        msg = {
            "direction": "from_james",
            "date": datetime.date(2026, 3, 15),
            "content": "Idempotent test message.",
            "line_start": 10,
            "line_end": 12,
        }
        store_message(db_conn, msg)
        store_message(db_conn, msg)

        count = db_conn.execute(
            "SELECT COUNT(*) FROM messages WHERE direction = 'from_james' AND line_start = 10"
        ).fetchone()[0]
        assert count == 1

    def test_null_date_stored(self, db_conn):
        msg = {
            "direction": "to_james",
            "date": None,
            "content": "Message with no date.",
            "line_start": 1,
            "line_end": 2,
        }
        store_message(db_conn, msg)

        row = db_conn.execute(
            "SELECT date FROM messages WHERE direction = 'to_james' AND line_start = 1"
        ).fetchone()
        assert row is not None
        assert row[0] is None

    def test_null_bytes_stripped(self, db_conn):
        msg = {
            "direction": "from_james",
            "date": datetime.date(2026, 4, 1),
            "content": "Content with \x00 null \x00 bytes.",
            "line_start": 20,
            "line_end": 22,
        }
        store_message(db_conn, msg)

        row = db_conn.execute(
            "SELECT content FROM messages WHERE direction = 'from_james' AND line_start = 20"
        ).fetchone()
        assert row is not None
        assert "\x00" not in row[0]
        assert "Content with" in row[0]

    def test_very_long_content(self, db_conn):
        """50KB content should be storable."""
        big_content = "A" * 50_000
        msg = {
            "direction": "from_james",
            "date": datetime.date(2026, 5, 1),
            "content": big_content,
            "line_start": 100,
            "line_end": 200,
        }
        store_message(db_conn, msg)

        row = db_conn.execute(
            "SELECT LENGTH(content) FROM messages "
            "WHERE direction = 'from_james' AND line_start = 100"
        ).fetchone()
        assert row is not None
        assert row[0] == 50_000

    def test_line_start_end_roundtrip(self, db_conn):
        msg = {
            "direction": "to_james",
            "date": datetime.date(2026, 6, 1),
            "content": "Line range test.",
            "line_start": 42,
            "line_end": 99,
        }
        store_message(db_conn, msg)

        row = db_conn.execute(
            "SELECT line_start, line_end FROM messages "
            "WHERE direction = 'to_james' AND line_start = 42"
        ).fetchone()
        assert row is not None
        assert row[0] == 42
        assert row[1] == 99

    def test_direction_constraint(self, db_conn):
        """Direction must be 'to_james' or 'from_james'."""
        msg = {
            "direction": "invalid_direction",
            "date": datetime.date(2026, 7, 1),
            "content": "Should fail.",
            "line_start": 1,
            "line_end": 1,
        }
        with pytest.raises(Exception):
            store_message(db_conn, msg)
        db_conn.rollback()

    def test_content_not_null(self, db_conn):
        """Content is NOT NULL in schema -- empty string OK, None not."""
        msg = {
            "direction": "from_james",
            "date": datetime.date(2026, 8, 1),
            "content": "",
            "line_start": 300,
            "line_end": 300,
        }
        # Empty string should work
        store_message(db_conn, msg)
        row = db_conn.execute("SELECT content FROM messages WHERE line_start = 300").fetchone()
        assert row is not None
        assert row[0] == ""


# ===========================================================================
# 4. EXTRACT ALL MESSAGES
# ===========================================================================


class TestExtractAllMessages:
    def test_both_files_parsed(self, tmp_path, db_conn):
        _write_file(tmp_path, "messages_from_james.md", _FROM_JAMES_SIMPLE)
        _write_file(tmp_path, "messages_to_james.md", _TO_JAMES_SIMPLE)
        count = extract_all_messages(tmp_path, db_conn)
        assert count > 0
        # Should have messages from both files
        from_count = db_conn.execute(
            "SELECT COUNT(*) FROM messages WHERE direction = 'from_james'"
        ).fetchone()[0]
        to_count = db_conn.execute(
            "SELECT COUNT(*) FROM messages WHERE direction = 'to_james'"
        ).fetchone()[0]
        assert from_count > 0
        assert to_count > 0
        assert count == from_count + to_count

    def test_missing_one_file_no_error(self, tmp_path, db_conn):
        """Only from_james exists -- should parse what's available."""
        _write_file(tmp_path, "messages_from_james.md", _FROM_JAMES_SIMPLE)
        count = extract_all_messages(tmp_path, db_conn)
        assert count == 3  # 3 messages in _FROM_JAMES_SIMPLE

    def test_neither_file_returns_zero(self, tmp_path, db_conn):
        count = extract_all_messages(tmp_path, db_conn)
        assert count == 0

    def test_idempotent_run_twice(self, tmp_path, db_conn):
        _write_file(tmp_path, "messages_from_james.md", _FROM_JAMES_SIMPLE)
        count1 = extract_all_messages(tmp_path, db_conn)
        count2 = extract_all_messages(tmp_path, db_conn)
        assert count1 == count2

        total = db_conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
        assert total == count1, "Duplicates created on second run"

    def test_from_james_direction(self, tmp_path, db_conn):
        _write_file(tmp_path, "messages_from_james.md", _FROM_JAMES_SIMPLE)
        extract_all_messages(tmp_path, db_conn)

        rows = db_conn.execute("SELECT DISTINCT direction FROM messages").fetchall()
        directions = {r[0] for r in rows}
        assert directions == {"from_james"}

    def test_to_james_direction(self, tmp_path, db_conn):
        _write_file(tmp_path, "messages_to_james.md", _TO_JAMES_SIMPLE)
        extract_all_messages(tmp_path, db_conn)

        rows = db_conn.execute("SELECT DISTINCT direction FROM messages").fetchall()
        directions = {r[0] for r in rows}
        assert directions == {"to_james"}

    def test_returns_total_count(self, tmp_path, db_conn):
        _write_file(tmp_path, "messages_from_james.md", _FROM_JAMES_SIMPLE)
        _write_file(tmp_path, "messages_to_james.md", _TO_JAMES_SIMPLE)
        count = extract_all_messages(tmp_path, db_conn)

        db_count = db_conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
        assert count == db_count

    def test_dates_stored_correctly(self, tmp_path, db_conn):
        _write_file(tmp_path, "messages_from_james.md", _FROM_JAMES_SIMPLE)
        extract_all_messages(tmp_path, db_conn)

        rows = db_conn.execute(
            "SELECT date FROM messages WHERE direction = 'from_james' ORDER BY line_start"
        ).fetchall()
        dates = [r[0] for r in rows]
        assert datetime.date(2026, 1, 15) in dates
        assert datetime.date(2026, 1, 16) in dates
        assert datetime.date(2026, 1, 17) in dates
