"""Hostile tests for extract_memory.py -- defines the API contract via TDD.

These tests intentionally import a module that does not yet exist.
Every test here should FAIL until the implementation is written.
"""

import datetime
import json

import pytest

from scripts.extract_memory import (
    split_into_blocks,
    compute_block_hash,
    extract_snapshot_from_content,
    store_snapshot,
    find_memory_sessions,
    extract_all_memory,
)

# Null byte as a runtime constant -- cannot be embedded as a literal
# in Python source without causing SyntaxError on compilation.
NUL = chr(0)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_MINIMAL_MEMORY = """\
# Claude's Persistent Memory

This is preamble text before any sections.

## Identity & Context

I am Claude, an AI assistant made by Anthropic.
I exist in a unique experimental setup.

## Key Files

- MEMORY.md (this file)
- notes/daily/*.md

## Feedback

James has provided feedback about various things.
"""

_MEMORY_WITH_CODE_BLOCK = """\
# Claude's Persistent Memory

## Configuration

Here is some config:

```markdown
## This Is Not A Real Section

It just looks like one inside a code block.
```

## Real Section

This is actual content.
"""

_MEMORY_WITH_SUBSECTIONS = """\
# Claude's Persistent Memory

## Projects & Knowledge

### Project Alpha
Details about alpha.

### Project Beta
Details about beta.

## Quick Reference

Some quick notes.
"""

_LARGE_BLOCK_CONTENT = "x" * 50_000

_MEMORY_UNICODE = """\
# Claude's Persistent Memory

## Identité & Kontext

Ünïcödé content with emojis: 🧠💭
CJK characters: 中文测试

## 日本語セクション

Japanese heading and content.
"""


def _insert_session(conn, session_id, date):
    """Insert a minimal session row for FK satisfaction."""
    from scripts.extract_sessions import detect_version

    conn.execute(
        """
        INSERT INTO sessions (
            id, date, time_of_day, version, source_type, source_file,
            updated_memory
        ) VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO NOTHING
        """,
        (
            session_id,
            date,
            "AM",
            detect_version(date),
            "jsonl",
            "activity-{}.jsonl".format(date.isoformat()),
            True,
        ),
    )
    conn.commit()


def _jsonl_line(**kwargs):
    return json.dumps(kwargs)


def _write_jsonl(path, lines):
    path.write_text("\n".join(lines) + "\n")
    return path


def _make_activity_lines(session_id, tools, start_time="10:00:00", end_time="10:05:00"):
    """Build JSONL lines for one complete session with given tool events."""
    lines = [_jsonl_line(ts=start_time, event="session_start", s=session_id, cwd="/home/claude")]
    for tool in tools:
        lines.append(
            _jsonl_line(
                ts=tool.get("ts", "10:01:00"),
                event="tool",
                s=session_id,
                t=tool["t"],
                i=tool["i"],
            )
        )
    lines.append(_jsonl_line(ts=end_time, event="session_end", s=session_id))
    return lines


# ===========================================================================
# 1. SPLIT INTO BLOCKS
# ===========================================================================


class TestSplitIntoBlocks:
    """split_into_blocks must parse MEMORY.md content into semantic blocks
    delimited by ## headings. The h1 preamble is excluded."""

    def test_standard_three_sections(self):
        """Standard MEMORY.md with 3 ## sections produces 3 blocks."""
        blocks = split_into_blocks(_MINIMAL_MEMORY)
        assert len(blocks) == 3

    def test_block_has_heading_content_hash(self):
        """Each block dict contains heading, content, and hash keys."""
        blocks = split_into_blocks(_MINIMAL_MEMORY)
        for block in blocks:
            assert "heading" in block, "Block missing 'heading' key"
            assert "content" in block, "Block missing 'content' key"
            assert "hash" in block, "Block missing 'hash' key"

    def test_heading_without_prefix(self):
        """Block headings must NOT include the '## ' prefix."""
        blocks = split_into_blocks(_MINIMAL_MEMORY)
        headings = [b["heading"] for b in blocks]
        assert "Identity & Context" in headings
        assert "Key Files" in headings
        assert "Feedback" in headings
        for h in headings:
            assert not h.startswith("## "), "Heading '{}' still has ## prefix".format(h)
            assert not h.startswith("# "), "Heading '{}' still has # prefix".format(h)

    def test_h1_preamble_excluded(self):
        """The h1 '# Claude's Persistent Memory' and its preamble text
        must not appear as a block."""
        blocks = split_into_blocks(_MINIMAL_MEMORY)
        headings = [b["heading"] for b in blocks]
        assert "Claude's Persistent Memory" not in headings
        for block in blocks:
            assert "This is preamble text" not in block["content"], (
                "Preamble text leaked into a block"
            )

    def test_empty_content(self):
        """Empty string produces empty list."""
        blocks = split_into_blocks("")
        assert blocks == []

    def test_only_h1_no_h2(self):
        """Content with only h1 and no h2 sections produces empty list."""
        content = "# Claude's Persistent Memory\n\nJust preamble, no sections.\n"
        blocks = split_into_blocks(content)
        assert blocks == []

    def test_code_block_h2_not_split(self):
        """A '## ' inside a fenced code block must NOT cause a split."""
        blocks = split_into_blocks(_MEMORY_WITH_CODE_BLOCK)
        headings = [b["heading"] for b in blocks]
        assert "This Is Not A Real Section" not in headings, (
            "Heading inside code block was treated as a real section"
        )
        assert "Configuration" in headings
        assert "Real Section" in headings
        assert len(blocks) == 2

    def test_subsections_kept_within_parent(self):
        """### subsections remain within their parent ## block."""
        blocks = split_into_blocks(_MEMORY_WITH_SUBSECTIONS)
        headings = [b["heading"] for b in blocks]
        assert "Projects & Knowledge" in headings
        assert "Quick Reference" in headings
        # ### headings must NOT be separate blocks
        assert "Project Alpha" not in headings
        assert "Project Beta" not in headings
        assert len(blocks) == 2

        # The parent block must contain the subsection content
        pk_block = [b for b in blocks if b["heading"] == "Projects & Knowledge"][0]
        assert "Project Alpha" in pk_block["content"]
        assert "Project Beta" in pk_block["content"]

    def test_unicode_headings_preserved(self):
        """Unicode characters in headings are preserved verbatim."""
        blocks = split_into_blocks(_MEMORY_UNICODE)
        headings = [b["heading"] for b in blocks]
        assert "Identité & Kontext" in headings
        assert "日本語セクション" in headings

    def test_trailing_whitespace_stripped_from_content(self):
        """Trailing whitespace on block content is stripped."""
        content = (
            "# Title\n\n## Section One\n\n"
            "Content with trailing spaces   \n   \n\n"
            "## Section Two\n\nMore content.\n"
        )
        blocks = split_into_blocks(content)
        for block in blocks:
            assert block["content"] == block["content"].rstrip(), (
                "Trailing whitespace not stripped from block content: {!r}".format(
                    block["content"][-20:]
                )
            )

    def test_heading_only_block_still_present(self):
        """A section with only a heading and no body is still a block."""
        content = "# Title\n\n## Empty Section\n\n## Non-Empty Section\n\nSome content.\n"
        blocks = split_into_blocks(content)
        headings = [b["heading"] for b in blocks]
        assert "Empty Section" in headings, "Heading-only block was dropped"

    def test_duplicate_headings_different_content_different_hashes(self):
        """Two sections with the same heading but different content
        produce blocks with different hashes."""
        content = (
            "# Title\n\n"
            "## Notes\n\nFirst version of notes.\n\n"
            "## Notes\n\nSecond version with different content.\n"
        )
        blocks = split_into_blocks(content)
        notes_blocks = [b for b in blocks if b["heading"] == "Notes"]
        assert len(notes_blocks) == 2, "Expected 2 blocks with heading 'Notes'"
        assert notes_blocks[0]["hash"] != notes_blocks[1]["hash"], (
            "Blocks with same heading but different content have the same hash"
        )

    def test_duplicate_headings_same_content_same_hash(self):
        """Two identical sections (same heading + same content) produce
        the same hash."""
        content = "# Title\n\n## Notes\n\nIdentical content.\n\n## Notes\n\nIdentical content.\n"
        blocks = split_into_blocks(content)
        notes_blocks = [b for b in blocks if b["heading"] == "Notes"]
        assert len(notes_blocks) == 2
        assert notes_blocks[0]["hash"] == notes_blocks[1]["hash"], (
            "Identical blocks have different hashes"
        )

    def test_null_bytes_stripped(self):
        """Null bytes in content are stripped before processing."""
        content = "# Title\n\n## Sec" + NUL + "tion\n\nCon" + NUL + "tent.\n"
        blocks = split_into_blocks(content)
        assert len(blocks) >= 1
        for block in blocks:
            assert NUL not in block["heading"], "Null byte in heading"
            assert NUL not in block["content"], "Null byte in content"
            assert NUL not in block["hash"], "Null byte in hash"

    def test_very_large_block_handled(self):
        """A block with 50KB of content is handled without error."""
        content = "# Title\n\n## Huge Section\n\n" + _LARGE_BLOCK_CONTENT + "\n"
        blocks = split_into_blocks(content)
        assert len(blocks) == 1
        assert len(blocks[0]["content"]) >= 50_000

    def test_windows_line_endings(self):
        """Content with \\r\\n line endings is handled correctly."""
        content = (
            "# Title\r\n\r\n## Section One\r\n\r\nContent.\r\n\r\n## Section Two\r\n\r\nMore.\r\n"
        )
        blocks = split_into_blocks(content)
        assert len(blocks) == 2

    def test_no_h1_with_h2_sections(self):
        """Content that starts directly with ## (no h1) still works."""
        content = "## First Section\n\nContent one.\n\n## Second Section\n\nContent two.\n"
        blocks = split_into_blocks(content)
        assert len(blocks) == 2
        headings = [b["heading"] for b in blocks]
        assert "First Section" in headings
        assert "Second Section" in headings


# ===========================================================================
# 2. COMPUTE BLOCK HASH
# ===========================================================================


class TestComputeBlockHash:
    """compute_block_hash must produce deterministic, collision-resistant
    hashes from heading + content."""

    def test_deterministic(self):
        """Same heading + content always yields the same hash."""
        h1 = compute_block_hash("Test Heading", "Test content.")
        h2 = compute_block_hash("Test Heading", "Test content.")
        assert h1 == h2

    def test_different_content_different_hash(self):
        """Different content with same heading produces different hash."""
        h1 = compute_block_hash("Section", "Content A")
        h2 = compute_block_hash("Section", "Content B")
        assert h1 != h2

    def test_different_heading_different_hash(self):
        """Different heading with same content produces different hash."""
        h1 = compute_block_hash("Heading A", "Same content")
        h2 = compute_block_hash("Heading B", "Same content")
        assert h1 != h2

    def test_empty_content_valid_hash(self):
        """Empty content string still produces a valid hash."""
        result = compute_block_hash("Empty Block", "")
        assert isinstance(result, str)
        assert len(result) > 0

    def test_unicode_valid_hash(self):
        """Unicode heading and content produce a valid hash."""
        result = compute_block_hash("日本語セクション", "Ünïcödé content 🧠")
        assert isinstance(result, str)
        assert len(result) > 0

    def test_hash_is_hex_string(self):
        """Hash output is a hex digest string (all hex characters)."""
        result = compute_block_hash("Test", "Content")
        assert isinstance(result, str)
        # Must be valid hex
        try:
            int(result, 16)
        except ValueError:
            pytest.fail("Hash '{}' is not a valid hex string".format(result))

    def test_null_bytes_stripped_before_hashing(self):
        """Null bytes are stripped before hashing, so content with and
        without null bytes produces the same hash."""
        h_clean = compute_block_hash("Heading", "Content")
        h_dirty = compute_block_hash("Head" + NUL + "ing", "Con" + NUL + "tent")
        assert h_clean == h_dirty, (
            "Null bytes were not stripped before hashing -- "
            "clean hash '{}' != dirty hash '{}'".format(h_clean, h_dirty)
        )

    def test_trailing_whitespace_normalization(self):
        """Trailing whitespace should not affect the hash.
        'Content' and 'Content   ' must produce the same hash."""
        h1 = compute_block_hash("Section", "Content")
        h2 = compute_block_hash("Section", "Content   ")
        h3 = compute_block_hash("Section", "Content\n\n")
        assert h1 == h2, "Trailing spaces changed the hash: '{}' vs '{}'".format(h1, h2)
        assert h1 == h3, "Trailing newlines changed the hash: '{}' vs '{}'".format(h1, h3)

    def test_leading_whitespace_preserved_in_hash(self):
        """Leading whitespace in content SHOULD change the hash (it's
        semantically meaningful), unlike trailing whitespace."""
        h1 = compute_block_hash("Section", "Content")
        h2 = compute_block_hash("Section", "  Content")
        # These should differ -- leading whitespace is part of the content
        assert h1 != h2, "Leading whitespace was normalized away -- hashes should differ"

    def test_hash_length_consistent(self):
        """All hashes have the same length (consistent algorithm)."""
        hashes = [
            compute_block_hash("A", "1"),
            compute_block_hash("B", "2"),
            compute_block_hash("", ""),
            compute_block_hash("Long " * 100, "Content " * 100),
        ]
        lengths = set(len(h) for h in hashes)
        assert len(lengths) == 1, "Hash lengths vary: {}".format(lengths)


# ===========================================================================
# 3. EXTRACT SNAPSHOT FROM CONTENT
# ===========================================================================


class TestExtractSnapshot:
    """extract_snapshot_from_content creates a snapshot dict with
    decomposed blocks from full MEMORY.md content."""

    def test_three_blocks(self):
        """Content with 3 ## sections produces snapshot with 3 blocks."""
        snap = extract_snapshot_from_content(
            _MINIMAL_MEMORY, "session-01", datetime.date(2026, 3, 15)
        )
        assert len(snap["blocks"]) == 3

    def test_session_id_preserved(self):
        """session_id from input appears in snapshot."""
        snap = extract_snapshot_from_content(
            _MINIMAL_MEMORY, "session-abc", datetime.date(2026, 3, 15)
        )
        assert snap["session_id"] == "session-abc"

    def test_date_preserved(self):
        """date from input appears in snapshot."""
        snap = extract_snapshot_from_content(
            _MINIMAL_MEMORY, "session-01", datetime.date(2026, 4, 20)
        )
        assert snap["date"] == datetime.date(2026, 4, 20)

    def test_token_count_estimated(self):
        """token_count is a rough estimate based on content length."""
        snap = extract_snapshot_from_content(
            _MINIMAL_MEMORY, "session-01", datetime.date(2026, 3, 15)
        )
        assert "token_count" in snap
        assert isinstance(snap["token_count"], int)
        assert snap["token_count"] > 0
        # Rough sanity: typical tokenization is ~4 chars per token
        # MEMORY content is ~250 chars, so expect 50-200 tokens roughly
        assert snap["token_count"] < len(_MINIMAL_MEMORY), (
            "token_count ({}) exceeds character count ({}) -- suspicious".format(
                snap["token_count"], len(_MINIMAL_MEMORY)
            )
        )

    def test_full_content_stored(self):
        """The full_content field contains the raw MEMORY.md content."""
        snap = extract_snapshot_from_content(
            _MINIMAL_MEMORY, "session-01", datetime.date(2026, 3, 15)
        )
        assert snap["full_content"] == _MINIMAL_MEMORY

    def test_empty_content(self):
        """Empty content produces snapshot with 0 blocks."""
        snap = extract_snapshot_from_content("", "session-empty", datetime.date(2026, 3, 15))
        assert len(snap["blocks"]) == 0
        assert snap["full_content"] == ""

    def test_null_bytes_stripped(self):
        """Null bytes in content are stripped in the snapshot."""
        dirty = "# Title\n\n## Sec" + NUL + "tion\n\nCon" + NUL + "tent.\n"
        snap = extract_snapshot_from_content(dirty, "session-nul", datetime.date(2026, 3, 15))
        assert NUL not in snap["full_content"]
        for block in snap["blocks"]:
            assert NUL not in block["heading"]
            assert NUL not in block["content"]

    def test_blocks_have_hash_heading_content(self):
        """Each block in the snapshot has heading, content, and hash."""
        snap = extract_snapshot_from_content(
            _MINIMAL_MEMORY, "session-01", datetime.date(2026, 3, 15)
        )
        for block in snap["blocks"]:
            assert "heading" in block
            assert "content" in block
            assert "hash" in block

    def test_snapshot_has_expected_keys(self):
        """Snapshot dict has all required keys."""
        snap = extract_snapshot_from_content(
            _MINIMAL_MEMORY, "session-01", datetime.date(2026, 3, 15)
        )
        required_keys = {"session_id", "date", "full_content", "token_count", "blocks"}
        assert required_keys.issubset(snap.keys()), "Missing keys: {}".format(
            required_keys - snap.keys()
        )


# ===========================================================================
# 4. STORE SNAPSHOT
# ===========================================================================


class TestStoreSnapshot:
    """store_snapshot must insert into memory_snapshots, memory_blocks,
    and memory_block_presence. It must be idempotent and reuse blocks."""

    def _make_snapshot(self, session_id="snap-session-01", date=None, content=None):
        """Build a snapshot dict using extract_snapshot_from_content."""
        if date is None:
            date = datetime.date(2026, 3, 15)
        if content is None:
            content = _MINIMAL_MEMORY
        return extract_snapshot_from_content(content, session_id, date)

    def test_all_tables_populated(self, db_conn):
        """Insert snapshot with 3 blocks, verify all 3 tables have rows."""
        _insert_session(db_conn, "snap-01", datetime.date(2026, 3, 15))
        snap = self._make_snapshot(session_id="snap-01")
        store_snapshot(db_conn, snap)

        # memory_snapshots
        row = db_conn.execute(
            "SELECT id, session_id, date, token_count FROM memory_snapshots WHERE session_id = %s",
            ("snap-01",),
        ).fetchone()
        assert row is not None, "No memory_snapshots row created"
        snapshot_id = row[0]
        assert row[1] == "snap-01"
        assert row[2] == datetime.date(2026, 3, 15)

        # memory_blocks
        block_count = db_conn.execute("SELECT COUNT(*) FROM memory_blocks").fetchone()[0]
        assert block_count == 3, "Expected 3 memory_blocks, got {}".format(block_count)

        # memory_block_presence
        presence_count = db_conn.execute(
            "SELECT COUNT(*) FROM memory_block_presence WHERE snapshot_id = %s",
            (snapshot_id,),
        ).fetchone()[0]
        assert presence_count == 3, "Expected 3 presence records, got {}".format(presence_count)

    def test_snapshot_row_correct_session_and_date(self, db_conn):
        """memory_snapshots row has correct session_id and date."""
        _insert_session(db_conn, "snap-02", datetime.date(2026, 4, 1))
        snap = self._make_snapshot(session_id="snap-02", date=datetime.date(2026, 4, 1))
        store_snapshot(db_conn, snap)

        row = db_conn.execute(
            "SELECT session_id, date FROM memory_snapshots WHERE session_id = %s",
            ("snap-02",),
        ).fetchone()
        assert row[0] == "snap-02"
        assert row[1] == datetime.date(2026, 4, 1)

    def test_blocks_have_correct_hashes(self, db_conn):
        """memory_blocks rows have hashes matching the snapshot blocks."""
        _insert_session(db_conn, "snap-03", datetime.date(2026, 3, 15))
        snap = self._make_snapshot(session_id="snap-03")
        expected_hashes = {b["hash"] for b in snap["blocks"]}
        store_snapshot(db_conn, snap)

        rows = db_conn.execute("SELECT block_hash FROM memory_blocks").fetchall()
        stored_hashes = {r[0] for r in rows}
        assert expected_hashes == stored_hashes, (
            "Stored hashes don't match expected: missing={}, extra={}".format(
                expected_hashes - stored_hashes, stored_hashes - expected_hashes
            )
        )

    def test_presence_join_records_exist(self, db_conn):
        """memory_block_presence links the snapshot to its blocks."""
        _insert_session(db_conn, "snap-04", datetime.date(2026, 3, 15))
        snap = self._make_snapshot(session_id="snap-04")
        store_snapshot(db_conn, snap)

        snapshot_row = db_conn.execute(
            "SELECT id FROM memory_snapshots WHERE session_id = %s", ("snap-04",)
        ).fetchone()
        snapshot_id = snapshot_row[0]

        presence = db_conn.execute(
            "SELECT block_id FROM memory_block_presence WHERE snapshot_id = %s",
            (snapshot_id,),
        ).fetchall()
        assert len(presence) == 3

        # Verify each block_id references a real memory_blocks row
        block_ids = [p[0] for p in presence]
        for bid in block_ids:
            exists = db_conn.execute("SELECT 1 FROM memory_blocks WHERE id = %s", (bid,)).fetchone()
            assert exists is not None, "Presence references nonexistent block_id {}".format(bid)

    def test_idempotent_no_duplicate_snapshots(self, db_conn):
        """Storing the same snapshot twice does not create duplicate
        memory_snapshots rows."""
        _insert_session(db_conn, "snap-05", datetime.date(2026, 3, 15))
        snap = self._make_snapshot(session_id="snap-05")
        store_snapshot(db_conn, snap)
        store_snapshot(db_conn, snap)

        count = db_conn.execute(
            "SELECT COUNT(*) FROM memory_snapshots WHERE session_id = %s",
            ("snap-05",),
        ).fetchone()[0]
        assert count == 1, "Duplicate snapshot created: {} rows".format(count)

    def test_idempotent_no_duplicate_blocks(self, db_conn):
        """Storing the same snapshot twice does not create duplicate
        memory_blocks rows."""
        _insert_session(db_conn, "snap-06", datetime.date(2026, 3, 15))
        snap = self._make_snapshot(session_id="snap-06")
        store_snapshot(db_conn, snap)
        store_snapshot(db_conn, snap)

        count = db_conn.execute("SELECT COUNT(*) FROM memory_blocks").fetchone()[0]
        assert count == 3, "Duplicate blocks created: {} rows instead of 3".format(count)

    def test_block_reuse_across_snapshots(self, db_conn):
        """If two different snapshots share a block (same hash), the
        memory_blocks row is reused, not duplicated."""
        # Two snapshots that share the "Feedback" section
        content_v1 = (
            "# Claude's Persistent Memory\n\n"
            "## Identity\n\nI am Claude.\n\n"
            "## Feedback\n\nJames has provided feedback.\n"
        )
        content_v2 = (
            "# Claude's Persistent Memory\n\n"
            "## Identity\n\nI am Claude, updated identity.\n\n"
            "## Feedback\n\nJames has provided feedback.\n"
        )

        _insert_session(db_conn, "snap-07a", datetime.date(2026, 3, 15))
        _insert_session(db_conn, "snap-07b", datetime.date(2026, 3, 16))

        snap_v1 = extract_snapshot_from_content(content_v1, "snap-07a", datetime.date(2026, 3, 15))
        snap_v2 = extract_snapshot_from_content(content_v2, "snap-07b", datetime.date(2026, 3, 16))

        store_snapshot(db_conn, snap_v1)
        store_snapshot(db_conn, snap_v2)

        # "Feedback" block has same heading + content in both, so same hash
        feedback_blocks = db_conn.execute(
            "SELECT COUNT(*) FROM memory_blocks WHERE heading = %s",
            ("Feedback",),
        ).fetchone()[0]
        assert feedback_blocks == 1, "Shared Feedback block was duplicated: {} rows".format(
            feedback_blocks
        )

        # But Identity block differs, so 2 rows for Identity
        identity_blocks = db_conn.execute(
            "SELECT COUNT(*) FROM memory_blocks WHERE heading = %s",
            ("Identity",),
        ).fetchone()[0]
        assert identity_blocks == 2, "Different Identity blocks should be 2, got {}".format(
            identity_blocks
        )

    def test_block_lifecycle_first_seen(self, db_conn):
        """first_seen_session is set to the session that first introduced
        the block."""
        _insert_session(db_conn, "snap-08a", datetime.date(2026, 3, 15))
        _insert_session(db_conn, "snap-08b", datetime.date(2026, 3, 16))

        content = "# Title\n\n## Section\n\nContent.\n"
        snap1 = extract_snapshot_from_content(content, "snap-08a", datetime.date(2026, 3, 15))
        store_snapshot(db_conn, snap1)

        snap2 = extract_snapshot_from_content(content, "snap-08b", datetime.date(2026, 3, 16))
        store_snapshot(db_conn, snap2)

        block = db_conn.execute(
            "SELECT first_seen_session, last_seen_session FROM memory_blocks WHERE heading = %s",
            ("Section",),
        ).fetchone()
        assert block is not None
        assert block[0] == "snap-08a", "first_seen_session should be 'snap-08a', got '{}'".format(
            block[0]
        )

    def test_block_lifecycle_last_seen_updated(self, db_conn):
        """last_seen_session is updated to the most recent session that
        contained the block."""
        _insert_session(db_conn, "snap-09a", datetime.date(2026, 3, 15))
        _insert_session(db_conn, "snap-09b", datetime.date(2026, 3, 16))

        content = "# Title\n\n## Section\n\nContent.\n"
        snap1 = extract_snapshot_from_content(content, "snap-09a", datetime.date(2026, 3, 15))
        store_snapshot(db_conn, snap1)

        snap2 = extract_snapshot_from_content(content, "snap-09b", datetime.date(2026, 3, 16))
        store_snapshot(db_conn, snap2)

        block = db_conn.execute(
            "SELECT last_seen_session FROM memory_blocks WHERE heading = %s",
            ("Section",),
        ).fetchone()
        assert block[0] == "snap-09b", "last_seen_session should be 'snap-09b', got '{}'".format(
            block[0]
        )

    def test_session_fk_enforced(self, db_conn):
        """Snapshot with a session_id that doesn't exist in sessions table
        must raise an error (FK constraint)."""
        snap = self._make_snapshot(session_id="nonexistent-session-999")
        with pytest.raises(Exception):
            store_snapshot(db_conn, snap)
        db_conn.rollback()

    def test_null_content_snapshot(self, db_conn):
        """Snapshot with empty content (no blocks) is handled gracefully."""
        _insert_session(db_conn, "snap-10", datetime.date(2026, 3, 15))
        snap = self._make_snapshot(session_id="snap-10", content="")
        store_snapshot(db_conn, snap)

        row = db_conn.execute(
            "SELECT id, token_count FROM memory_snapshots WHERE session_id = %s",
            ("snap-10",),
        ).fetchone()
        assert row is not None, "Snapshot with empty content was not stored"

        presence_count = db_conn.execute(
            "SELECT COUNT(*) FROM memory_block_presence WHERE snapshot_id = %s",
            (row[0],),
        ).fetchone()[0]
        assert presence_count == 0

    def test_large_content(self, db_conn):
        """50KB block content is stored without error."""
        _insert_session(db_conn, "snap-11", datetime.date(2026, 3, 15))
        content = "# Title\n\n## Huge\n\n" + _LARGE_BLOCK_CONTENT + "\n"
        snap = self._make_snapshot(session_id="snap-11", content=content)
        store_snapshot(db_conn, snap)

        row = db_conn.execute(
            "SELECT LENGTH(content) FROM memory_blocks WHERE heading = %s",
            ("Huge",),
        ).fetchone()
        assert row is not None
        assert row[0] >= 50_000, "Large content was truncated to {}".format(row[0])

    def test_full_content_stored_in_snapshot(self, db_conn):
        """The full_content field in memory_snapshots contains the raw content."""
        _insert_session(db_conn, "snap-12", datetime.date(2026, 3, 15))
        snap = self._make_snapshot(session_id="snap-12")
        store_snapshot(db_conn, snap)

        row = db_conn.execute(
            "SELECT full_content FROM memory_snapshots WHERE session_id = %s",
            ("snap-12",),
        ).fetchone()
        assert row is not None
        assert "Identity & Context" in row[0]
        assert "Key Files" in row[0]

    def test_transaction_integrity_on_block_failure(self, db_conn):
        """If inserting a block fails mid-way, the snapshot row must also
        be rolled back -- no orphaned memory_snapshots rows."""
        _insert_session(db_conn, "snap-txn-01", datetime.date(2026, 3, 15))
        snap = self._make_snapshot(session_id="snap-txn-01")
        # Corrupt a block hash to trigger a constraint violation on the second insert
        # by setting it to a null-byte-containing value that Postgres rejects
        snap["blocks"][1]["hash"] = "valid_hash"
        snap["blocks"][1]["heading"] = "Test" + NUL + "Heading"

        try:
            store_snapshot(db_conn, snap)
        except Exception:
            db_conn.rollback()

        # If the snapshot was stored despite the block failure, that's a bug
        row = db_conn.execute(
            "SELECT 1 FROM memory_snapshots WHERE session_id = %s",
            ("snap-txn-01",),
        ).fetchone()
        # Either both succeed (null bytes were stripped) or both fail
        if row is not None:
            # If snapshot exists, verify all blocks also exist (no partial state)
            block_count = db_conn.execute(
                """SELECT COUNT(*) FROM memory_block_presence p
                   JOIN memory_snapshots s ON p.snapshot_id = s.id
                   WHERE s.session_id = %s""",
                ("snap-txn-01",),
            ).fetchone()[0]
            assert block_count == 3, "Partial block insertion: {} of 3 blocks present".format(
                block_count
            )


# ===========================================================================
# 5. FIND MEMORY SESSIONS
# ===========================================================================


class TestFindMemorySessions:
    """find_memory_sessions scans activity logs for sessions that
    Read/Write/Edit memory files."""

    def test_read_memory_md_found(self, tmp_path):
        """Activity log with Read of MEMORY.md returns that session."""
        activity_dir = tmp_path / "activity"
        activity_dir.mkdir()
        lines = _make_activity_lines(
            "mem-read-01",
            tools=[{"t": "Read", "i": "/home/claude/MEMORY.md", "ts": "10:01:00"}],
        )
        _write_jsonl(activity_dir / "activity-2026-03-15.jsonl", lines)

        sessions = find_memory_sessions(activity_dir)
        assert len(sessions) >= 1
        session_ids = [s["session_id"] for s in sessions]
        assert "mem-read-01" in session_ids

    def test_edit_memory_subdir_found(self, tmp_path):
        """Activity log with Edit of memory/feedback_*.md returns that session."""
        activity_dir = tmp_path / "activity"
        activity_dir.mkdir()
        lines = _make_activity_lines(
            "mem-edit-01",
            tools=[{"t": "Edit", "i": "/home/claude/memory/feedback_2026-03.md", "ts": "10:01:00"}],
        )
        _write_jsonl(activity_dir / "activity-2026-03-15.jsonl", lines)

        sessions = find_memory_sessions(activity_dir)
        assert len(sessions) >= 1
        session_ids = [s["session_id"] for s in sessions]
        assert "mem-edit-01" in session_ids

    def test_write_memory_md_found(self, tmp_path):
        """Activity log with Write of MEMORY.md returns that session."""
        activity_dir = tmp_path / "activity"
        activity_dir.mkdir()
        lines = _make_activity_lines(
            "mem-write-01",
            tools=[{"t": "Write", "i": "/home/claude/MEMORY.md", "ts": "10:01:00"}],
        )
        _write_jsonl(activity_dir / "activity-2026-03-15.jsonl", lines)

        sessions = find_memory_sessions(activity_dir)
        assert len(sessions) >= 1
        session_ids = [s["session_id"] for s in sessions]
        assert "mem-write-01" in session_ids

    def test_no_memory_operations_empty(self, tmp_path):
        """Activity log with no memory file operations returns empty list."""
        activity_dir = tmp_path / "activity"
        activity_dir.mkdir()
        lines = _make_activity_lines(
            "no-mem-01",
            tools=[
                {"t": "Read", "i": "/home/claude/writing/essay.md", "ts": "10:01:00"},
                {"t": "Write", "i": "/home/claude/notes/daily/2026-03-15.md", "ts": "10:02:00"},
            ],
        )
        _write_jsonl(activity_dir / "activity-2026-03-15.jsonl", lines)

        sessions = find_memory_sessions(activity_dir)
        mem_ids = [s["session_id"] for s in sessions]
        assert "no-mem-01" not in mem_ids

    def test_returns_session_id_date_and_paths(self, tmp_path):
        """Each result has session_id, date, and list of memory file paths."""
        activity_dir = tmp_path / "activity"
        activity_dir.mkdir()
        lines = _make_activity_lines(
            "mem-info-01",
            tools=[{"t": "Read", "i": "/home/claude/MEMORY.md", "ts": "10:01:00"}],
        )
        _write_jsonl(activity_dir / "activity-2026-03-15.jsonl", lines)

        sessions = find_memory_sessions(activity_dir)
        assert len(sessions) >= 1
        session = [s for s in sessions if s["session_id"] == "mem-info-01"][0]
        assert "session_id" in session
        assert "date" in session
        assert "paths" in session or "memory_paths" in session or "files" in session, (
            "Session result missing paths/memory_paths/files field: {}".format(session.keys())
        )

    def test_multiple_memory_ops_one_entry(self, tmp_path):
        """Multiple memory operations in one session produce one entry
        with all paths listed."""
        activity_dir = tmp_path / "activity"
        activity_dir.mkdir()
        lines = _make_activity_lines(
            "mem-multi-01",
            tools=[
                {"t": "Read", "i": "/home/claude/MEMORY.md", "ts": "10:01:00"},
                {"t": "Edit", "i": "/home/claude/memory/feedback_2026-03.md", "ts": "10:02:00"},
                {"t": "Write", "i": "/home/claude/MEMORY.md", "ts": "10:03:00"},
            ],
        )
        _write_jsonl(activity_dir / "activity-2026-03-15.jsonl", lines)

        sessions = find_memory_sessions(activity_dir)
        matching = [s for s in sessions if s["session_id"] == "mem-multi-01"]
        assert len(matching) == 1, (
            "Expected 1 entry for session with multiple memory ops, got {}".format(len(matching))
        )

        # Get the paths field (whatever it's called)
        session = matching[0]
        paths = session.get("paths") or session.get("memory_paths") or session.get("files") or []
        assert len(paths) >= 2, "Expected at least 2 memory paths, got {}".format(len(paths))

    def test_non_memory_files_ignored(self, tmp_path):
        """Non-memory file operations are not included in memory paths."""
        activity_dir = tmp_path / "activity"
        activity_dir.mkdir()
        lines = _make_activity_lines(
            "mem-filter-01",
            tools=[
                {"t": "Read", "i": "/home/claude/MEMORY.md", "ts": "10:01:00"},
                {"t": "Write", "i": "/home/claude/writing/essay.md", "ts": "10:02:00"},
            ],
        )
        _write_jsonl(activity_dir / "activity-2026-03-15.jsonl", lines)

        sessions = find_memory_sessions(activity_dir)
        session = [s for s in sessions if s["session_id"] == "mem-filter-01"][0]
        paths = session.get("paths") or session.get("memory_paths") or session.get("files") or []

        # writing/essay.md should NOT be in the memory paths
        for p in paths:
            assert "essay.md" not in p, "Non-memory file 'essay.md' in memory paths"

    def test_empty_activity_dir(self, tmp_path):
        """Empty directory returns empty list."""
        activity_dir = tmp_path / "empty_activity"
        activity_dir.mkdir()

        sessions = find_memory_sessions(activity_dir)
        assert sessions == []

    def test_non_jsonl_files_ignored(self, tmp_path):
        """Non-.jsonl files in the activity directory are ignored."""
        activity_dir = tmp_path / "activity"
        activity_dir.mkdir()
        (activity_dir / "notes.txt").write_text("not a log file\n")
        (activity_dir / "README.md").write_text("# Activity Logs\n")

        sessions = find_memory_sessions(activity_dir)
        assert sessions == []

    def test_date_extracted_from_filename(self, tmp_path):
        """Date is extracted from activity log filename."""
        activity_dir = tmp_path / "activity"
        activity_dir.mkdir()
        lines = _make_activity_lines(
            "mem-date-01",
            tools=[{"t": "Read", "i": "/home/claude/MEMORY.md", "ts": "10:01:00"}],
        )
        _write_jsonl(activity_dir / "activity-2026-04-20.jsonl", lines)

        sessions = find_memory_sessions(activity_dir)
        session = [s for s in sessions if s["session_id"] == "mem-date-01"][0]
        assert session["date"] == datetime.date(2026, 4, 20) or session["date"] == "2026-04-20", (
            "Date not extracted from filename: got {}".format(session["date"])
        )

    def test_memory_subdir_files_recognized(self, tmp_path):
        """Files under memory/ subdirectory (not just MEMORY.md) are recognized."""
        activity_dir = tmp_path / "activity"
        activity_dir.mkdir()
        lines = _make_activity_lines(
            "mem-subdir-01",
            tools=[
                {"t": "Write", "i": "/home/claude/memory/context.md", "ts": "10:01:00"},
            ],
        )
        _write_jsonl(activity_dir / "activity-2026-03-15.jsonl", lines)

        sessions = find_memory_sessions(activity_dir)
        session_ids = [s["session_id"] for s in sessions]
        assert "mem-subdir-01" in session_ids, "Session writing to memory/ subdirectory not found"

    def test_case_sensitivity_MEMORY_md(self, tmp_path):
        """MEMORY.md (uppercase) must be detected. memory.md (lowercase)
        is a different file and may or may not be detected depending on
        implementation."""
        activity_dir = tmp_path / "activity"
        activity_dir.mkdir()
        lines = _make_activity_lines(
            "mem-case-01",
            tools=[{"t": "Read", "i": "/home/claude/MEMORY.md", "ts": "10:01:00"}],
        )
        _write_jsonl(activity_dir / "activity-2026-03-15.jsonl", lines)

        sessions = find_memory_sessions(activity_dir)
        session_ids = [s["session_id"] for s in sessions]
        assert "mem-case-01" in session_ids, "MEMORY.md (uppercase) not detected"


# ===========================================================================
# 6. EXTRACT ALL MEMORY (orchestrator)
# ===========================================================================


class TestExtractAll:
    """extract_all_memory orchestrates the full pipeline: find memory
    sessions, extract snapshots, store everything."""

    def _setup_activity_with_content(self, tmp_path):
        """Create activity logs and optional content directory."""
        activity_dir = tmp_path / "activity"
        activity_dir.mkdir()
        content_dir = tmp_path / "content"
        content_dir.mkdir()

        # Session 1: reads MEMORY.md
        lines1 = _make_activity_lines(
            "all-mem-01",
            tools=[{"t": "Read", "i": "/home/claude/MEMORY.md", "ts": "10:01:00"}],
        )
        _write_jsonl(activity_dir / "activity-2026-03-15.jsonl", lines1)

        # Session 2: writes MEMORY.md
        lines2 = _make_activity_lines(
            "all-mem-02",
            tools=[{"t": "Write", "i": "/home/claude/MEMORY.md", "ts": "14:01:00"}],
            start_time="14:00:00",
            end_time="14:05:00",
        )
        _write_jsonl(activity_dir / "activity-2026-03-16.jsonl", lines2)

        # Provide content files for the sessions
        (content_dir / "all-mem-01.md").write_text(_MINIMAL_MEMORY, encoding="utf-8")
        (content_dir / "all-mem-02.md").write_text(
            "# Claude's Persistent Memory\n\n"
            "## Identity & Context\n\nUpdated identity.\n\n"
            "## New Section\n\nBrand new content.\n",
            encoding="utf-8",
        )

        return activity_dir, content_dir

    def test_snapshots_stored(self, tmp_path, db_conn):
        """Activity logs with memory sessions result in stored snapshots."""
        activity_dir, content_dir = self._setup_activity_with_content(tmp_path)

        # Need session rows for FK
        _insert_session(db_conn, "all-mem-01", datetime.date(2026, 3, 15))
        _insert_session(db_conn, "all-mem-02", datetime.date(2026, 3, 16))

        count = extract_all_memory(activity_dir, db_conn, content_dir)
        assert count >= 1, "Expected at least 1 snapshot stored, got {}".format(count)

        snapshot_count = db_conn.execute("SELECT COUNT(*) FROM memory_snapshots").fetchone()[0]
        assert snapshot_count >= 1

    def test_empty_directory_returns_zero(self, tmp_path, db_conn):
        """Empty activity directory returns 0."""
        empty_dir = tmp_path / "empty"
        empty_dir.mkdir()
        count = extract_all_memory(empty_dir, db_conn)
        assert count == 0

    def test_idempotent(self, tmp_path, db_conn):
        """Running extract_all_memory twice produces no duplicates."""
        activity_dir, content_dir = self._setup_activity_with_content(tmp_path)
        _insert_session(db_conn, "all-mem-01", datetime.date(2026, 3, 15))
        _insert_session(db_conn, "all-mem-02", datetime.date(2026, 3, 16))

        count1 = extract_all_memory(activity_dir, db_conn, content_dir)
        extract_all_memory(activity_dir, db_conn, content_dir)

        snapshot_count = db_conn.execute("SELECT COUNT(*) FROM memory_snapshots").fetchone()[0]
        db_conn.execute("SELECT COUNT(*) FROM memory_blocks").fetchone()[0]

        # Running twice should not double the rows
        assert snapshot_count == count1, (
            "Duplicate snapshots after second run: {} snapshots but first run stored {}".format(
                snapshot_count, count1
            )
        )

    def test_returns_count(self, tmp_path, db_conn):
        """Return value is the integer count of snapshots stored."""
        activity_dir, content_dir = self._setup_activity_with_content(tmp_path)
        _insert_session(db_conn, "all-mem-01", datetime.date(2026, 3, 15))
        _insert_session(db_conn, "all-mem-02", datetime.date(2026, 3, 16))

        count = extract_all_memory(activity_dir, db_conn, content_dir)
        assert isinstance(count, int)
        assert count >= 0

    def test_no_content_dir_still_works(self, tmp_path, db_conn):
        """If content_dir is None, the function still runs (may find fewer
        snapshots but should not crash)."""
        activity_dir = tmp_path / "activity"
        activity_dir.mkdir()
        lines = _make_activity_lines(
            "all-mem-nocontent",
            tools=[{"t": "Read", "i": "/home/claude/MEMORY.md", "ts": "10:01:00"}],
        )
        _write_jsonl(activity_dir / "activity-2026-03-15.jsonl", lines)
        _insert_session(db_conn, "all-mem-nocontent", datetime.date(2026, 3, 15))

        # Should not crash even without content_dir
        count = extract_all_memory(activity_dir, db_conn, content_dir=None)
        assert isinstance(count, int)

    def test_blocks_reused_across_snapshots(self, tmp_path, db_conn):
        """Blocks that appear in multiple snapshots are reused, not duplicated."""
        activity_dir, content_dir = self._setup_activity_with_content(tmp_path)
        _insert_session(db_conn, "all-mem-01", datetime.date(2026, 3, 15))
        _insert_session(db_conn, "all-mem-02", datetime.date(2026, 3, 16))

        extract_all_memory(activity_dir, db_conn, content_dir)

        # "Identity & Context" heading appears in both snapshots but with
        # different content (original vs "Updated identity"), so 2 blocks.
        # No heading should have more than 2 rows (one per unique content).
        identity_count = db_conn.execute(
            "SELECT COUNT(*) FROM memory_blocks WHERE heading = %s",
            ("Identity & Context",),
        ).fetchone()[0]
        assert identity_count <= 2, "Identity block duplicated beyond expected: {} rows".format(
            identity_count
        )

    def test_nonexistent_directory_handled(self, tmp_path, db_conn):
        """Passing a nonexistent directory raises an appropriate error
        or returns 0 -- must not crash with an unhandled exception."""
        nonexistent = tmp_path / "does_not_exist"
        try:
            count = extract_all_memory(nonexistent, db_conn)
            assert count == 0
        except (FileNotFoundError, OSError):
            pass  # Acceptable to raise a clear error


# ===========================================================================
# 7. CROSS-CUTTING HOSTILE TESTS
# ===========================================================================


class TestNullByteSanitization:
    """Null bytes must be stripped from all text fields before DB insertion."""

    def test_null_in_block_heading_stripped(self):
        content = "# Title\n\n## Head" + NUL + "ing\n\nContent.\n"
        blocks = split_into_blocks(content)
        for block in blocks:
            assert NUL not in block["heading"]

    def test_null_in_block_content_stripped(self):
        content = "# Title\n\n## Section\n\nCon" + NUL + "tent with nu" + NUL + "lls.\n"
        blocks = split_into_blocks(content)
        for block in blocks:
            assert NUL not in block["content"]

    def test_null_in_snapshot_full_content(self):
        dirty = "# Title\n\n## Section\n\n" + NUL + "Content" + NUL + ".\n"
        snap = extract_snapshot_from_content(dirty, "nul-snap", datetime.date(2026, 3, 15))
        assert NUL not in snap["full_content"]

    def test_null_in_hash_computation(self):
        """Null bytes must be stripped before computing hash, so
        'abc' and 'a\\x00bc' hash the same."""
        h1 = compute_block_hash("Heading", "abc")
        h2 = compute_block_hash("Heading", "a" + NUL + "bc")
        assert h1 == h2


class TestEdgeCaseContent:
    """Edge cases in MEMORY.md content parsing."""

    def test_only_preamble_no_sections(self):
        """Content with only h1 preamble and no ## sections."""
        content = "# Claude's Persistent Memory\n\nJust preamble.\nMore preamble.\n"
        blocks = split_into_blocks(content)
        assert blocks == []

    def test_h2_with_no_content_between_consecutive_h2s(self):
        """Two consecutive ## headers with nothing between them."""
        content = "# Title\n\n## First\n## Second\n\nContent for second.\n"
        blocks = split_into_blocks(content)
        headings = [b["heading"] for b in blocks]
        assert "First" in headings
        assert "Second" in headings
        # First block has no content
        first = [b for b in blocks if b["heading"] == "First"][0]
        assert first["content"].strip() == ""

    def test_deeply_nested_headings(self):
        """#### and ##### headings stay within their parent ## block."""
        content = (
            "# Title\n\n"
            "## Parent\n\n"
            "### Child\n\n"
            "#### Grandchild\n\n"
            "##### Great-grandchild\n\n"
            "Content at deep level.\n"
        )
        blocks = split_into_blocks(content)
        assert len(blocks) == 1
        assert "Great-grandchild" in blocks[0]["content"]

    def test_multiple_code_blocks(self):
        """Multiple code blocks, some containing ## headers."""
        content = (
            "# Title\n\n"
            "## Real One\n\n"
            "```\n## Fake One\n```\n\n"
            "```python\n## Fake Two\ndef foo():\n    pass\n```\n\n"
            "## Real Two\n\n"
            "Content.\n"
        )
        blocks = split_into_blocks(content)
        headings = [b["heading"] for b in blocks]
        assert "Real One" in headings
        assert "Real Two" in headings
        assert "Fake One" not in headings
        assert "Fake Two" not in headings
        assert len(blocks) == 2

    def test_indented_h2_not_split(self):
        """An indented '  ## ' (with leading spaces) is not a valid
        markdown heading and should not cause a split."""
        content = (
            "# Title\n\n## Real Section\n\nSome content.\n  ## Not A Heading\n\nMore content.\n"
        )
        blocks = split_into_blocks(content)
        assert len(blocks) == 1
        assert "Not A Heading" in blocks[0]["content"]

    def test_h2_with_trailing_hashes(self):
        """Markdown allows trailing hashes: ## Heading ## -- the trailing
        hashes should be stripped from the heading."""
        content = "# Title\n\n## Trailing Hashes ##\n\nContent.\n"
        blocks = split_into_blocks(content)
        assert len(blocks) == 1
        # Heading should either include or strip the trailing ## -- but
        # at minimum should not crash or misparse
        heading = blocks[0]["heading"]
        assert "Trailing" in heading

    def test_content_with_horizontal_rules(self):
        """Horizontal rules (---) within sections don't affect parsing."""
        content = (
            "# Title\n\n"
            "## Section One\n\n"
            "Content before rule.\n\n"
            "---\n\n"
            "Content after rule.\n\n"
            "## Section Two\n\nMore.\n"
        )
        blocks = split_into_blocks(content)
        assert len(blocks) == 2
        sec1 = [b for b in blocks if b["heading"] == "Section One"][0]
        assert "Content before rule" in sec1["content"]
        assert "Content after rule" in sec1["content"]

    def test_snapshot_token_count_zero_for_empty(self):
        """Empty content should have token_count of 0."""
        snap = extract_snapshot_from_content("", "empty-01", datetime.date(2026, 3, 15))
        assert snap["token_count"] == 0


class TestResourceExhaustion:
    """Large inputs must not cause OOM or unreasonable storage."""

    def test_very_large_memory_file(self):
        """A 200KB MEMORY.md with many sections is parsed without error."""
        sections = []
        for i in range(100):
            sections.append("## Section {}\n\n{}".format(i, "x" * 2000))
        content = "# Title\n\n" + "\n\n".join(sections) + "\n"
        blocks = split_into_blocks(content)
        assert len(blocks) == 100

    def test_block_with_100k_lines(self):
        """A single block with 100K lines of content."""
        lines = ["Line {}".format(i) for i in range(100_000)]
        content = "# Title\n\n## Huge Block\n\n" + "\n".join(lines) + "\n"
        blocks = split_into_blocks(content)
        assert len(blocks) == 1
        assert "Line 99999" in blocks[0]["content"]
