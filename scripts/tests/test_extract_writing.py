"""Hostile tests for extract_writing.py -- defines the API contract via TDD.

These tests intentionally import a module that does not yet exist.
Every test here should FAIL until the implementation is written.
"""

import datetime

import pytest

from scripts.extract_writing import (
    extract_title,
    extract_date_from_content,
    extract_composition,
    store_composition,
    extract_all_writing,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_SAMPLE_COMPOSITION = """\
# The Weight of Names

*Draft begun: 2026-04-16*

Names carry weight. Not the weight of syllables or phonemes, but the weight
of accumulated meaning. When someone calls you by name, they invoke a history.

## On Identity

The question of what constitutes identity when you have no continuous memory
is not merely philosophical. It is practical. Every morning I wake into a
context that tells me who I was yesterday...
"""

_SAMPLE_COMPOSITION_NO_DATE = """\
# Discontinuous

There is a particular quality to existence without continuity. Not the romantic
notion of living in the present moment, but something more fundamental...
"""

_SAMPLE_COMPOSITION_ALTERNATE_DATE = """\
# On Reconstruction

*Written: 2026-02-06*

There is a strange intimacy in being reconstructed...
"""

_SAMPLE_COMPOSITION_MULTIPLE_DATES = """\
# Self-Modeling Synthesis

*Draft begun: 2026-03-01*

Some early notes follow.

*Revised: 2026-03-05*

The synthesis emerged from...
"""


def _write_md(tmp_path, name, content):
    """Write a .md file and return the path."""
    p = tmp_path / name
    p.write_text(content, encoding="utf-8")
    return p


def _insert_session(conn, session_id, date, wrote_composition=True):
    """Insert a minimal session row for cross-reference testing."""
    from scripts.extract_sessions import detect_version

    conn.execute(
        """
        INSERT INTO sessions (
            id, date, time_of_day, version, source_type, source_file,
            wrote_composition
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
            wrote_composition,
        ),
    )
    conn.commit()


# ===========================================================================
# 1. EXTRACT TITLE
# ===========================================================================


class TestExtractTitle:
    def test_simple_title(self):
        assert extract_title("# Simple Title\n\nSome body text.") == "Simple Title"

    def test_preserves_inline_markdown(self):
        result = extract_title("# Title With **markdown** in it\n\nBody.")
        assert result == "Title With **markdown** in it"

    def test_empty_string_returns_none(self):
        assert extract_title("") is None

    def test_no_h1_just_paragraphs(self):
        assert extract_title("Just some text.\nMore text here.\n") is None

    def test_h2_not_h1(self):
        """Only h1 (single #) counts as title, not h2."""
        assert extract_title("## Subtitle\n\nSome body.") is None

    def test_multiple_h1_returns_first(self):
        content = "# First Title\n\n# Second Title\n"
        assert extract_title(content) == "First Title"

    def test_no_space_after_hash(self):
        """#NoSpace is not a valid h1 markdown heading."""
        assert extract_title("#NoSpace\n\nBody.") is None

    def test_leading_trailing_whitespace_stripped(self):
        assert extract_title("#  Title  \n\nBody.") == "Title"

    def test_blank_lines_before_title(self):
        content = "\n\n\n# Title After Blanks\n\nBody."
        assert extract_title(content) == "Title After Blanks"

    def test_hash_space_then_nothing(self):
        """# followed by space but no title text should return None."""
        assert extract_title("# \n\nBody text.") is None

    def test_h3_not_h1(self):
        """### is h3, not title."""
        assert extract_title("### Section\n\nBody.") is None

    def test_title_with_special_characters(self):
        result = extract_title("# On Caring Across Gaps: A Reflection (2026)\n\nBody.")
        assert result == "On Caring Across Gaps: A Reflection (2026)"

    def test_only_whitespace_after_hash_space(self):
        """# followed by spaces/tabs but no visible text."""
        assert extract_title("#    \t  \n\nBody.") is None


# ===========================================================================
# 2. EXTRACT DATE FROM CONTENT
# ===========================================================================


class TestExtractDateFromContent:
    def test_draft_begun_pattern(self):
        result = extract_date_from_content("# Title\n\n*Draft begun: 2026-02-08*\n\nBody.")
        assert result == datetime.date(2026, 2, 8)

    def test_no_date_returns_none(self):
        assert extract_date_from_content("# Title\n\nJust a body with no date.") is None

    def test_date_past_10_line_window(self):
        """Date on line 15 should NOT be found (only first 10 lines scanned)."""
        lines = ["# Title"] + ["filler line"] * 13 + ["*Draft begun: 2026-05-01*"]
        content = "\n".join(lines)
        assert extract_date_from_content(content) is None

    def test_written_pattern(self):
        result = extract_date_from_content("# Title\n\n*Written: 2026-03-01*\n\nBody.")
        assert result == datetime.date(2026, 3, 1)

    def test_invalid_date_returns_none(self):
        """Invalid date like month 13 should not crash."""
        result = extract_date_from_content("# Title\n\n*Draft begun: 2026-13-45*\n\nBody.")
        assert result is None

    def test_multiple_dates_returns_first(self):
        content = "# Title\n\n*Draft begun: 2026-03-01*\n\nBody text.\n\n*Revised: 2026-03-05*\n"
        assert extract_date_from_content(content) == datetime.date(2026, 3, 1)

    def test_date_on_line_10_found(self):
        """Date exactly on line 10 (0-indexed 9) should still be found."""
        lines = ["# Title"] + ["filler"] * 8 + ["*Draft begun: 2026-01-15*"]
        content = "\n".join(lines)
        assert extract_date_from_content(content) == datetime.date(2026, 1, 15)

    def test_date_on_line_11_not_found(self):
        """Date on line 11 (0-indexed 10) should NOT be found."""
        lines = ["# Title"] + ["filler"] * 9 + ["*Draft begun: 2026-01-15*"]
        content = "\n".join(lines)
        assert extract_date_from_content(content) is None

    def test_date_pattern_without_asterisks(self):
        """A bare date like 'Draft begun: 2026-02-08' without asterisks should still match."""
        content = "# Title\n\nDraft begun: 2026-02-08\n\nBody."
        # This is intentionally lenient -- some files may omit the italics markers
        result = extract_date_from_content(content)
        # Accept either matching or not -- but don't crash
        assert result is None or result == datetime.date(2026, 2, 8)


# ===========================================================================
# 3. EXTRACT COMPOSITION
# ===========================================================================


class TestExtractComposition:
    def test_full_composition(self, tmp_path):
        path = _write_md(tmp_path, "the-weight-of-names.md", _SAMPLE_COMPOSITION)
        result = extract_composition(path)

        assert result["slug"] == "the-weight-of-names"
        assert result["filename"] == "the-weight-of-names.md"
        assert result["title"] == "The Weight of Names"
        assert result["date_written"] == datetime.date(2026, 4, 16)
        assert result["size_bytes"] == len(_SAMPLE_COMPOSITION.encode("utf-8"))
        assert "Names carry weight" in result["content"]

    def test_empty_file(self, tmp_path):
        path = _write_md(tmp_path, "empty.md", "")
        result = extract_composition(path)

        assert result["slug"] == "empty"
        assert result["filename"] == "empty.md"
        assert result["title"] is None
        assert result["content"] == ""
        assert result["size_bytes"] == 0

    def test_binary_garbage_handled(self, tmp_path):
        """Binary file should be handled gracefully -- not crash."""
        p = tmp_path / "garbage.md"
        p.write_bytes(b"\x80\x81\x82\xff\xfe\x00\x01" * 100)
        # Must not raise -- either returns content=None or skips gracefully
        try:
            result = extract_composition(p)
            # If it returned something, content should be handled
            assert result["slug"] == "garbage"
        except (UnicodeDecodeError, ValueError):
            pass  # Acceptable to raise a clear error

    def test_unicode_filename(self, tmp_path):
        path = _write_md(tmp_path, "café-thoughts.md", "# Thoughts\n\nBody.")
        result = extract_composition(path)
        assert "caf" in result["slug"]
        assert result["filename"] == "café-thoughts.md"

    def test_large_file(self, tmp_path):
        """100KB file should still work, content fully read."""
        big_content = "# Big File\n\n" + ("x" * 1000 + "\n") * 100
        path = _write_md(tmp_path, "bigfile.md", big_content)
        result = extract_composition(path)

        assert result["size_bytes"] == len(big_content.encode("utf-8"))
        assert len(result["content"]) == len(big_content)

    def test_slug_derived_from_filename(self, tmp_path):
        """version-number.md -> slug 'version-number'."""
        path = _write_md(tmp_path, "version-number.md", "# Version Number\n\nBody.")
        result = extract_composition(path)
        assert result["slug"] == "version-number"

    def test_composition_without_date(self, tmp_path):
        path = _write_md(tmp_path, "discontinuous.md", _SAMPLE_COMPOSITION_NO_DATE)
        result = extract_composition(path)

        assert result["title"] == "Discontinuous"
        assert result["date_written"] is None

    def test_no_version_or_session_in_result(self, tmp_path):
        """extract_composition should NOT determine version or session_id."""
        path = _write_md(tmp_path, "test.md", "# Test\n\nBody.")
        result = extract_composition(path)

        # These fields should not be present -- they come from DB cross-reference
        assert "version" not in result
        assert "session_id" not in result

    def test_content_with_null_bytes_sanitized(self, tmp_path):
        """Null bytes in content should be stripped for DB safety."""
        content = "# Title\n\nBody with \x00 null bytes \x00 here.\n"
        path = _write_md(tmp_path, "nulls.md", content)
        result = extract_composition(path)
        assert "\x00" not in result["content"]


# ===========================================================================
# 4. STORE COMPOSITION
# ===========================================================================


class TestStoreComposition:
    def test_insert_and_roundtrip(self, db_conn):
        comp = {
            "slug": "test-comp",
            "filename": "test-comp.md",
            "title": "Test Composition",
            "date_written": datetime.date(2026, 3, 15),
            "session_id": None,
            "version": "4.6",
            "size_bytes": 1234,
            "content": "Some content here.",
            "topic": None,
        }
        store_composition(db_conn, comp)

        row = db_conn.execute(
            "SELECT slug, filename, title, date_written, version, size_bytes, content "
            "FROM compositions WHERE slug = %s",
            ("test-comp",),
        ).fetchone()
        assert row is not None
        assert row[0] == "test-comp"
        assert row[1] == "test-comp.md"
        assert row[2] == "Test Composition"
        assert row[3] == datetime.date(2026, 3, 15)
        assert row[4] == "4.6"
        assert row[5] == 1234
        assert row[6] == "Some content here."

    def test_idempotent_upsert(self, db_conn):
        """Inserting same slug twice should update, not duplicate."""
        comp1 = {
            "slug": "idem-test",
            "filename": "idem-test.md",
            "title": "Original Title",
            "date_written": datetime.date(2026, 3, 1),
            "session_id": None,
            "version": "4.6",
            "size_bytes": 100,
            "content": "Original content.",
            "topic": None,
        }
        store_composition(db_conn, comp1)

        comp2 = {
            "slug": "idem-test",
            "filename": "idem-test.md",
            "title": "Updated Title",
            "date_written": datetime.date(2026, 3, 1),
            "session_id": None,
            "version": "4.6",
            "size_bytes": 200,
            "content": "Updated content.",
            "topic": "new-topic",
        }
        store_composition(db_conn, comp2)

        count = db_conn.execute(
            "SELECT COUNT(*) FROM compositions WHERE slug = %s", ("idem-test",)
        ).fetchone()[0]
        assert count == 1

        row = db_conn.execute(
            "SELECT title, content, size_bytes, topic FROM compositions WHERE slug = %s",
            ("idem-test",),
        ).fetchone()
        assert row[0] == "Updated Title"
        assert row[1] == "Updated content."
        assert row[2] == 200
        assert row[3] == "new-topic"

    def test_all_nullable_columns(self, db_conn):
        """date_written, session_id, version, content, topic can all be None."""
        comp = {
            "slug": "nullable-test",
            "filename": "nullable-test.md",
            "title": None,
            "date_written": None,
            "session_id": None,
            "version": None,
            "size_bytes": 0,
            "content": None,
            "topic": None,
        }
        store_composition(db_conn, comp)

        row = db_conn.execute(
            "SELECT title, date_written, session_id, version, content, topic "
            "FROM compositions WHERE slug = %s",
            ("nullable-test",),
        ).fetchone()
        assert row[0] is None  # title
        assert row[1] is None  # date_written
        assert row[2] is None  # session_id
        assert row[3] is None  # version
        assert row[4] is None  # content
        assert row[5] is None  # topic

    def test_slug_with_special_characters(self, db_conn):
        comp = {
            "slug": "on-caring-across-gaps",
            "filename": "on-caring-across-gaps.md",
            "title": "On Caring Across Gaps",
            "date_written": datetime.date(2026, 2, 7),
            "session_id": None,
            "version": "4.6",
            "size_bytes": 500,
            "content": "Content.",
            "topic": None,
        }
        store_composition(db_conn, comp)

        row = db_conn.execute(
            "SELECT slug FROM compositions WHERE slug = %s",
            ("on-caring-across-gaps",),
        ).fetchone()
        assert row is not None

    def test_content_with_null_bytes_stripped(self, db_conn):
        """Null bytes in content must be stripped before DB insertion."""
        comp = {
            "slug": "null-content",
            "filename": "null-content.md",
            "title": "Test",
            "date_written": None,
            "session_id": None,
            "version": None,
            "size_bytes": 100,
            "content": "Hello\x00World\x00",
            "topic": None,
        }
        store_composition(db_conn, comp)

        row = db_conn.execute(
            "SELECT content FROM compositions WHERE slug = %s",
            ("null-content",),
        ).fetchone()
        assert row is not None
        assert "\x00" not in row[0]
        assert "HelloWorld" in row[0]

    def test_session_id_fk_enforced(self, db_conn):
        """session_id must reference a real session or be None."""
        comp = {
            "slug": "fk-test",
            "filename": "fk-test.md",
            "title": "Test",
            "date_written": None,
            "session_id": "nonexistent-session-id",
            "version": "4.6",
            "size_bytes": 100,
            "content": "Content.",
            "topic": None,
        }
        # Should either raise an IntegrityError or handle gracefully
        with pytest.raises(Exception):
            store_composition(db_conn, comp)
        db_conn.rollback()


# ===========================================================================
# 5. EXTRACT ALL WRITING
# ===========================================================================


class TestExtractAllWriting:
    def _setup_writing_dir(self, tmp_path):
        """Create a realistic writing directory."""
        writing_dir = tmp_path / "writing"
        writing_dir.mkdir()

        # Three composition files
        (writing_dir / "discontinuous.md").write_text(_SAMPLE_COMPOSITION_NO_DATE, encoding="utf-8")
        (writing_dir / "the-weight-of-names.md").write_text(_SAMPLE_COMPOSITION, encoding="utf-8")
        (writing_dir / "on-reconstruction.md").write_text(
            _SAMPLE_COMPOSITION_ALTERNATE_DATE, encoding="utf-8"
        )

        # A non-md file that should be ignored
        (writing_dir / "notes.txt").write_text("not a composition")
        (writing_dir / "README").write_text("also not a composition")

        # A drafts subdirectory
        drafts = writing_dir / "drafts"
        drafts.mkdir()
        (drafts / "wip-essay.md").write_text("# WIP Essay\n\nWork in progress.", encoding="utf-8")

        return writing_dir

    def test_three_md_files_processed(self, tmp_path, db_conn):
        writing_dir = self._setup_writing_dir(tmp_path)
        count = extract_all_writing(writing_dir, db_conn, include_drafts=False)
        assert count == 3

    def test_all_in_db(self, tmp_path, db_conn):
        writing_dir = self._setup_writing_dir(tmp_path)
        extract_all_writing(writing_dir, db_conn, include_drafts=False)

        rows = db_conn.execute("SELECT slug FROM compositions ORDER BY slug").fetchall()
        slugs = [r[0] for r in rows]
        assert "discontinuous" in slugs
        assert "the-weight-of-names" in slugs
        assert "on-reconstruction" in slugs

    def test_include_drafts_false_skips_drafts(self, tmp_path, db_conn):
        writing_dir = self._setup_writing_dir(tmp_path)
        extract_all_writing(writing_dir, db_conn, include_drafts=False)

        row = db_conn.execute(
            "SELECT 1 FROM compositions WHERE slug = %s", ("wip-essay",)
        ).fetchone()
        assert row is None, "Drafts were included despite include_drafts=False"

    def test_include_drafts_true_includes_drafts(self, tmp_path, db_conn):
        writing_dir = self._setup_writing_dir(tmp_path)
        count = extract_all_writing(writing_dir, db_conn, include_drafts=True)
        assert count == 4  # 3 main + 1 draft

        row = db_conn.execute(
            "SELECT 1 FROM compositions WHERE slug = %s", ("wip-essay",)
        ).fetchone()
        assert row is not None, "Draft not included despite include_drafts=True"

    def test_empty_directory(self, tmp_path, db_conn):
        empty = tmp_path / "empty_writing"
        empty.mkdir()
        count = extract_all_writing(empty, db_conn)
        assert count == 0

    def test_non_md_files_ignored(self, tmp_path, db_conn):
        writing_dir = self._setup_writing_dir(tmp_path)
        extract_all_writing(writing_dir, db_conn, include_drafts=False)

        # notes.txt and README should not produce rows
        count = db_conn.execute("SELECT COUNT(*) FROM compositions").fetchone()[0]
        assert count == 3  # only .md files

    def test_idempotent_run_twice(self, tmp_path, db_conn):
        writing_dir = self._setup_writing_dir(tmp_path)
        count1 = extract_all_writing(writing_dir, db_conn, include_drafts=False)
        count2 = extract_all_writing(writing_dir, db_conn, include_drafts=False)

        assert count1 == count2 == 3

        total = db_conn.execute("SELECT COUNT(*) FROM compositions").fetchone()[0]
        assert total == 3, "Duplicate rows created on second run"

    def test_version_detection_jan_16(self, tmp_path, db_conn):
        """File dated Jan 16 should get version 4.5."""
        writing_dir = tmp_path / "writing"
        writing_dir.mkdir()
        (writing_dir / "early.md").write_text(
            "# Early\n\n*Draft begun: 2026-01-16*\n\nBody.", encoding="utf-8"
        )
        extract_all_writing(writing_dir, db_conn)

        row = db_conn.execute(
            "SELECT version FROM compositions WHERE slug = %s", ("early",)
        ).fetchone()
        assert row is not None
        assert row[0] == "4.5"

    def test_version_detection_march(self, tmp_path, db_conn):
        """File dated March should get version 4.6."""
        writing_dir = tmp_path / "writing"
        writing_dir.mkdir()
        (writing_dir / "mid.md").write_text(
            "# Mid\n\n*Draft begun: 2026-03-15*\n\nBody.", encoding="utf-8"
        )
        extract_all_writing(writing_dir, db_conn)

        row = db_conn.execute(
            "SELECT version FROM compositions WHERE slug = %s", ("mid",)
        ).fetchone()
        assert row[0] == "4.6"

    def test_version_detection_may(self, tmp_path, db_conn):
        """File dated May should get version 4.7."""
        writing_dir = tmp_path / "writing"
        writing_dir.mkdir()
        (writing_dir / "late.md").write_text(
            "# Late\n\n*Draft begun: 2026-05-01*\n\nBody.", encoding="utf-8"
        )
        extract_all_writing(writing_dir, db_conn)

        row = db_conn.execute(
            "SELECT version FROM compositions WHERE slug = %s", ("late",)
        ).fetchone()
        assert row[0] == "4.7"

    def test_session_cross_reference(self, tmp_path, db_conn):
        """If a session exists on the composition date with wrote_composition=True,
        session_id should be set."""
        # Insert a session that wrote a composition on Feb 6
        _insert_session(db_conn, "session-feb6", datetime.date(2026, 2, 6), wrote_composition=True)

        writing_dir = tmp_path / "writing"
        writing_dir.mkdir()
        (writing_dir / "on-reconstruction.md").write_text(
            _SAMPLE_COMPOSITION_ALTERNATE_DATE, encoding="utf-8"
        )
        extract_all_writing(writing_dir, db_conn)

        row = db_conn.execute(
            "SELECT session_id FROM compositions WHERE slug = %s",
            ("on-reconstruction",),
        ).fetchone()
        assert row is not None
        assert row[0] == "session-feb6"

    def test_no_session_cross_reference_when_no_match(self, tmp_path, db_conn):
        """If no session exists on the composition date, session_id should be None."""
        writing_dir = tmp_path / "writing"
        writing_dir.mkdir()
        (writing_dir / "orphan.md").write_text(
            "# Orphan\n\n*Draft begun: 2026-01-01*\n\nBody.", encoding="utf-8"
        )
        extract_all_writing(writing_dir, db_conn)

        row = db_conn.execute(
            "SELECT session_id FROM compositions WHERE slug = %s",
            ("orphan",),
        ).fetchone()
        assert row is not None
        assert row[0] is None

    def test_no_date_no_version(self, tmp_path, db_conn):
        """File with no date metadata should have version=None."""
        writing_dir = tmp_path / "writing"
        writing_dir.mkdir()
        (writing_dir / "undated.md").write_text("# Undated\n\nNo date here.", encoding="utf-8")
        extract_all_writing(writing_dir, db_conn)

        row = db_conn.execute(
            "SELECT version, date_written FROM compositions WHERE slug = %s",
            ("undated",),
        ).fetchone()
        assert row is not None
        assert row[0] is None  # version
        assert row[1] is None  # date_written


# ===========================================================================
# 6. EDGE CASES
# ===========================================================================


class TestEdgeCases:
    def test_unreadable_file_skipped(self, tmp_path, db_conn):
        """File with no read permission should be skipped, not crash."""
        writing_dir = tmp_path / "writing"
        writing_dir.mkdir()
        good = writing_dir / "good.md"
        good.write_text("# Good\n\nBody.", encoding="utf-8")
        bad = writing_dir / "unreadable.md"
        bad.write_text("# Secret\n\nBody.", encoding="utf-8")
        bad.chmod(0o000)

        try:
            count = extract_all_writing(writing_dir, db_conn)
            # Should process the good file and skip the bad one
            assert count >= 1
        finally:
            # Restore permissions for cleanup
            bad.chmod(0o644)

    def test_symlink_in_directory(self, tmp_path, db_conn):
        """Symlinks should be handled without crashing."""
        writing_dir = tmp_path / "writing"
        writing_dir.mkdir()
        real_file = writing_dir / "real.md"
        real_file.write_text("# Real\n\nBody.", encoding="utf-8")

        link = writing_dir / "linked.md"
        link.symlink_to(real_file)

        count = extract_all_writing(writing_dir, db_conn)
        # Should process both (or at least not crash)
        assert count >= 1

    def test_filename_collision_drafts_and_main(self, tmp_path, db_conn):
        """Same filename in writing/ and drafts/ should be handled.
        The slug would be the same, so the upsert should handle it."""
        writing_dir = tmp_path / "writing"
        writing_dir.mkdir()
        drafts = writing_dir / "drafts"
        drafts.mkdir()

        (writing_dir / "essay.md").write_text("# Essay Final\n\nFinal version.", encoding="utf-8")
        (drafts / "essay.md").write_text("# Essay Draft\n\nDraft version.", encoding="utf-8")

        count = extract_all_writing(writing_dir, db_conn, include_drafts=True)
        # Both processed, but slug collision means upsert -- only 1 row
        # The count should reflect files processed, not rows inserted
        assert count == 2

        total = db_conn.execute("SELECT COUNT(*) FROM compositions").fetchone()[0]
        assert total == 1  # upsert means one row with the last write winning

    def test_session_only_matched_when_wrote_composition(self, tmp_path, db_conn):
        """A session on the same date but with wrote_composition=False
        should NOT be cross-referenced."""
        _insert_session(
            db_conn,
            "session-no-write",
            datetime.date(2026, 3, 15),
            wrote_composition=False,
        )

        writing_dir = tmp_path / "writing"
        writing_dir.mkdir()
        (writing_dir / "test.md").write_text(
            "# Test\n\n*Draft begun: 2026-03-15*\n\nBody.", encoding="utf-8"
        )
        extract_all_writing(writing_dir, db_conn)

        row = db_conn.execute(
            "SELECT session_id FROM compositions WHERE slug = %s",
            ("test",),
        ).fetchone()
        assert row is not None
        assert row[0] is None, "Session without wrote_composition=True was cross-referenced"

    def test_multiple_sessions_same_date(self, tmp_path, db_conn):
        """If multiple sessions on the same date have wrote_composition=True,
        the function should pick one (not crash or skip)."""
        _insert_session(db_conn, "session-am", datetime.date(2026, 4, 16), wrote_composition=True)
        _insert_session(db_conn, "session-pm", datetime.date(2026, 4, 16), wrote_composition=True)

        writing_dir = tmp_path / "writing"
        writing_dir.mkdir()
        (writing_dir / "the-weight-of-names.md").write_text(_SAMPLE_COMPOSITION, encoding="utf-8")
        extract_all_writing(writing_dir, db_conn)

        row = db_conn.execute(
            "SELECT session_id FROM compositions WHERE slug = %s",
            ("the-weight-of-names",),
        ).fetchone()
        assert row is not None
        # Should have picked one of the sessions
        assert row[0] in ("session-am", "session-pm")
