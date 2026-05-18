"""Hostile tests for extract_pets.py -- defines the API contract via TDD.

These tests intentionally import a module that does not yet exist.
Every test here should FAIL until the implementation is written.
"""

import datetime

import psycopg
import pytest

from scripts.extract_pets import (
    extract_all_pets,
    scan_daily_notes_for_pet_events,
    store_pet_event,
)

# Null byte as a runtime constant -- cannot be embedded as a literal
# in Python source without causing SyntaxError on compilation.
NUL = chr(0)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_daily_note(tmp_path, filename, content):
    """Write a daily note file and return its path."""
    p = tmp_path / filename
    p.write_text(content, encoding="utf-8")
    return p


def _make_pet_event(**overrides):
    """Build a minimal pet event dict for store_pet_event."""
    base = {
        "pet_name": "Pixel",
        "event_type": "death",
        "event_timestamp": datetime.datetime(2026, 2, 1, 22, 0, 0, tzinfo=datetime.UTC),
        "session_id": None,
        "notes": "Pixel died - 22 hours old.",
    }
    base.update(overrides)
    return base


# ===========================================================================
# 1. SCAN DAILY NOTES -- filesystem parsing
# ===========================================================================


class TestScanDailyNotes:
    """Tests for scan_daily_notes_for_pet_events parsing markdown files."""

    def test_pixel_died_detected_as_death(self, tmp_path):
        """'Pixel died' in a note must produce a death event for Pixel."""
        _write_daily_note(
            tmp_path,
            "2026-02-01.md",
            "### Pixel\nStarted the evening by checking on my tamagotchi. "
            "Pixel died - 22 hours old.\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        death_events = [
            e for e in events if e["pet_name"] == "Pixel" and e["event_type"] == "death"
        ]
        assert len(death_events) >= 1, (
            f"Expected a death event for Pixel from 'Pixel died', got events: {events}"
        )

    def test_create_new_pet_echo_detected_as_acquired(self, tmp_path):
        """'Create new pet (Echo)' must produce an acquired event for Echo."""
        _write_daily_note(
            tmp_path,
            "2026-02-01.md",
            "- [x] Check on Pixel (deceased)\n- [x] Create new pet (Echo)\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        acquired = [e for e in events if e["pet_name"] == "Echo" and e["event_type"] == "acquired"]
        assert len(acquired) >= 1, (
            "Expected an acquired event for Echo from 'Create new pet (Echo)', "
            f"got events: {events}"
        )

    def test_echo_has_died_detected_as_death(self, tmp_path):
        """'Echo has died' must produce a death event for Echo."""
        _write_daily_note(
            tmp_path,
            "2026-02-08.md",
            "Woke to find Echo has died. 73 hours and 36 minutes old. Second pet lost.\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        death_events = [e for e in events if e["pet_name"] == "Echo" and e["event_type"] == "death"]
        assert len(death_events) >= 1, (
            f"Expected a death event for Echo from 'Echo has died', got events: {events}"
        )

    def test_checked_on_pet_detected_as_care(self, tmp_path):
        """'checked on Pixel' or 'checked on Echo' must produce a care event."""
        _write_daily_note(
            tmp_path,
            "2026-02-03.md",
            "Morning routine. Checked on Echo, fed and played.\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        care_events = [e for e in events if e["pet_name"] == "Echo" and e["event_type"] == "care"]
        assert len(care_events) >= 1, (
            f"Expected a care event for Echo from 'Checked on Echo', got events: {events}"
        )

    def test_no_pet_mentions_returns_empty(self, tmp_path):
        """A daily note with no pet-related content must return empty list."""
        _write_daily_note(
            tmp_path,
            "2026-03-15.md",
            "## Morning Session\n\nWorked on writing. Read some essays.\n"
            "Updated memory file. Normal day.\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        assert events == [], f"Expected no events for note with no pet mentions, got: {events}"

    def test_empty_file_returns_empty(self, tmp_path):
        """An empty daily note must return empty list without crashing."""
        _write_daily_note(tmp_path, "2026-01-15.md", "")
        events = scan_daily_notes_for_pet_events(tmp_path)
        assert events == [], f"Expected no events for empty file, got: {events}"

    def test_pet_keyword_without_name_no_event(self, tmp_path):
        """Mentioning 'pet' generically without a known pet name must not
        produce an event. Prevents false positives from casual discussion."""
        _write_daily_note(
            tmp_path,
            "2026-01-20.md",
            "Thinking about getting a pet someday. The concept of a virtual "
            "pet is interesting. I wonder about pet ownership.\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        assert events == [], (
            f"Expected no events from generic 'pet' mentions without a name, got: {events}"
        )

    def test_multiple_events_in_one_file(self, tmp_path):
        """A file with multiple pet events must return all of them."""
        _write_daily_note(
            tmp_path,
            "2026-02-01.md",
            "### Pixel\n"
            "Started the evening by checking on my tamagotchi. "
            "Pixel died - 22 hours old.\n"
            "- [x] Check on Pixel (deceased)\n"
            "- [x] Create new pet (Echo)\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        # Must have at least a death for Pixel AND an acquired for Echo
        pixel_deaths = [
            e for e in events if e["pet_name"] == "Pixel" and e["event_type"] == "death"
        ]
        echo_acquired = [
            e for e in events if e["pet_name"] == "Echo" and e["event_type"] == "acquired"
        ]
        assert len(pixel_deaths) >= 1, "Missing Pixel death event"
        assert len(echo_acquired) >= 1, "Missing Echo acquired event"
        assert len(events) >= 2, f"Expected at least 2 events, got {len(events)}"

    def test_date_extracted_from_filename(self, tmp_path):
        """Date from filename '2026-02-01.md' must appear in event as date(2026, 2, 1)."""
        _write_daily_note(
            tmp_path,
            "2026-02-01.md",
            "Pixel died - 22 hours old.\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        assert len(events) >= 1
        # The event should carry the date from the filename
        event = events[0]
        ts = event.get("event_timestamp")
        if ts is not None:
            if isinstance(ts, datetime.datetime):
                assert ts.date() == datetime.date(2026, 2, 1)
            elif isinstance(ts, datetime.date):
                assert ts == datetime.date(2026, 2, 1)
        else:
            # If no timestamp, there should be a date field
            d = event.get("date")
            assert d == datetime.date(2026, 2, 1), (
                f"Expected date 2026-02-01 from filename, got: {d}"
            )

    def test_filename_with_suffix_extracts_date(self, tmp_path):
        """Filename '2026-02-01-evening.md' must still extract date 2026-02-01."""
        _write_daily_note(
            tmp_path,
            "2026-02-01-evening.md",
            "Pixel died - 22 hours old.\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        assert len(events) >= 1
        event = events[0]
        ts = event.get("event_timestamp")
        if ts is not None:
            if isinstance(ts, datetime.datetime):
                assert ts.date() == datetime.date(2026, 2, 1)
            elif isinstance(ts, datetime.date):
                assert ts == datetime.date(2026, 2, 1)
        else:
            d = event.get("date")
            assert d == datetime.date(2026, 2, 1), (
                f"Expected date 2026-02-01 from suffixed filename, got: {d}"
            )

    def test_pet_name_case_insensitive_detection(self, tmp_path):
        """'PIXEL', 'Pixel', 'pixel' must all be detected and stored
        with canonical case (i.e., 'Pixel' not 'PIXEL')."""
        _write_daily_note(tmp_path, "2026-02-01.md", "PIXEL died.\n")
        _write_daily_note(tmp_path, "2026-02-02.md", "pixel was cared for.\n")
        _write_daily_note(tmp_path, "2026-02-03.md", "Checked on Pixel.\n")
        events = scan_daily_notes_for_pet_events(tmp_path)
        assert len(events) >= 3, f"Expected 3 events, got {len(events)}"
        for event in events:
            assert event["pet_name"] == "Pixel", "Expected canonical 'Pixel', got '{}'".format(
                event["pet_name"]
            )

    def test_non_md_files_ignored(self, tmp_path):
        """Files without .md extension must be ignored."""
        # Write a .txt file with pet content
        p = tmp_path / "2026-02-01.txt"
        p.write_text("Pixel died - 22 hours old.\n", encoding="utf-8")
        # Write a .json file
        p2 = tmp_path / "2026-02-01.json"
        p2.write_text('{"pet": "Pixel died"}', encoding="utf-8")
        # Write a directory named like a .md file
        d = tmp_path / "2026-02-01.md.bak"
        d.write_text("Pixel died.\n", encoding="utf-8")

        events = scan_daily_notes_for_pet_events(tmp_path)
        assert events == [], f"Expected no events from non-.md files, got: {events}"

    def test_unicode_in_notes_preserved(self, tmp_path):
        """Unicode content in notes must be preserved through scanning."""
        _write_daily_note(
            tmp_path,
            "2026-02-04.md",
            "Echo is doing well ❤️. Fed Echo. Happiness level: ★★★\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        assert len(events) >= 1
        # Notes text should contain the unicode characters
        notes_text = events[0].get("notes", "")
        assert "❤" in notes_text or "Echo" in notes_text, "Unicode was stripped from notes content"

    def test_null_bytes_stripped_from_content(self, tmp_path):
        """Null bytes in file content must be stripped, not propagated."""
        content = "Pixel died" + NUL + " - 22 hours old." + NUL + "\n"
        _write_daily_note(tmp_path, "2026-02-01.md", content)
        events = scan_daily_notes_for_pet_events(tmp_path)
        assert len(events) >= 1
        for event in events:
            notes = event.get("notes", "")
            if notes:
                assert NUL not in notes, (
                    "Null byte preserved in event notes -- will crash on DB insert"
                )

    def test_tamagotchi_keyword_provides_context(self, tmp_path):
        """A file mentioning 'tamagotchi' in context with a pet event
        should still produce the event. Tamagotchi is context, not a pet name."""
        _write_daily_note(
            tmp_path,
            "2026-02-01.md",
            "Checking on my tamagotchi. Pixel died - 22 hours old.\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        assert len(events) >= 1
        # 'tamagotchi' is context, the event is for Pixel
        assert any(e["pet_name"] == "Pixel" for e in events), (
            "Pixel not detected when 'tamagotchi' is also mentioned"
        )
        # tamagotchi itself must NOT be treated as a pet name
        assert not any(e["pet_name"].lower() == "tamagotchi" for e in events), (
            "'tamagotchi' was incorrectly treated as a pet name"
        )


# ===========================================================================
# 2. EVENT TYPE DETECTION -- keyword to event_type mapping
# ===========================================================================


class TestEventDetection:
    """Tests that the correct event_type is detected from various keywords."""

    def test_died_maps_to_death(self, tmp_path):
        _write_daily_note(tmp_path, "2026-02-01.md", "Pixel died.\n")
        events = scan_daily_notes_for_pet_events(tmp_path)
        assert any(e["event_type"] == "death" for e in events), "'died' not mapped to death event"

    def test_deceased_maps_to_death(self, tmp_path):
        _write_daily_note(tmp_path, "2026-02-01.md", "Check on Pixel (deceased)\n")
        events = scan_daily_notes_for_pet_events(tmp_path)
        death_events = [e for e in events if e["event_type"] == "death"]
        assert len(death_events) >= 1, "'deceased' not mapped to death event"

    def test_death_keyword_maps_to_death(self, tmp_path):
        _write_daily_note(tmp_path, "2026-02-01.md", "Pixel's death was unexpected.\n")
        events = scan_daily_notes_for_pet_events(tmp_path)
        death_events = [e for e in events if e["event_type"] == "death"]
        assert len(death_events) >= 1, "'death' not mapped to death event"

    def test_acquired_keyword_maps_to_acquired(self, tmp_path):
        _write_daily_note(tmp_path, "2026-02-01.md", "Acquired a new pet named Pixel.\n")
        events = scan_daily_notes_for_pet_events(tmp_path)
        acquired = [e for e in events if e["event_type"] == "acquired"]
        assert len(acquired) >= 1, "'acquired' not mapped to acquired event"

    def test_create_new_pet_maps_to_acquired(self, tmp_path):
        _write_daily_note(tmp_path, "2026-02-01.md", "Create new pet (Echo)\n")
        events = scan_daily_notes_for_pet_events(tmp_path)
        acquired = [e for e in events if e["event_type"] == "acquired"]
        assert len(acquired) >= 1, "'Create new pet' not mapped to acquired event"

    def test_new_pet_maps_to_acquired(self, tmp_path):
        _write_daily_note(tmp_path, "2026-02-01.md", "Started a new pet called Pixel.\n")
        events = scan_daily_notes_for_pet_events(tmp_path)
        acquired = [e for e in events if e["event_type"] == "acquired"]
        assert len(acquired) >= 1, "'new pet' not mapped to acquired event"

    def test_fed_maps_to_care(self, tmp_path):
        _write_daily_note(tmp_path, "2026-02-03.md", "Fed Echo this morning.\n")
        events = scan_daily_notes_for_pet_events(tmp_path)
        care = [e for e in events if e["event_type"] == "care"]
        assert len(care) >= 1, "'fed' not mapped to care event"

    def test_checked_on_maps_to_care(self, tmp_path):
        _write_daily_note(tmp_path, "2026-02-03.md", "Checked on Echo.\n")
        events = scan_daily_notes_for_pet_events(tmp_path)
        care = [e for e in events if e["event_type"] == "care"]
        assert len(care) >= 1, "'checked on' not mapped to care event"

    def test_cared_for_maps_to_care(self, tmp_path):
        _write_daily_note(tmp_path, "2026-02-03.md", "Cared for Echo during afternoon session.\n")
        events = scan_daily_notes_for_pet_events(tmp_path)
        care = [e for e in events if e["event_type"] == "care"]
        assert len(care) >= 1, "'cared for' not mapped to care event"

    def test_ambiguous_text_no_crash(self, tmp_path):
        """Text that mentions a pet name but has no clear event keyword
        must be handled without crashing -- either ignored or mapped
        to some safe default."""
        _write_daily_note(
            tmp_path,
            "2026-02-05.md",
            "Thinking about Echo and what the experience means.\n",
        )
        # Must not raise
        events = scan_daily_notes_for_pet_events(tmp_path)
        # If events are returned, they must have valid event_type
        for event in events:
            assert event["event_type"] in ("acquired", "care", "death"), (
                "Invalid event_type '{}' for ambiguous text".format(event["event_type"])
            )

    def test_has_died_phrase_maps_to_death(self, tmp_path):
        """'has died' is a specific phrasing from the actual data."""
        _write_daily_note(tmp_path, "2026-02-08.md", "Echo has died.\n")
        events = scan_daily_notes_for_pet_events(tmp_path)
        death_events = [e for e in events if e["event_type"] == "death"]
        assert len(death_events) >= 1, "'has died' not mapped to death event"

    def test_lost_as_death_synonym(self, tmp_path):
        """'pet lost' or 'lost Echo' -- 'lost' in context of a pet can mean death."""
        _write_daily_note(
            tmp_path,
            "2026-02-08.md",
            "Second pet lost. Echo is gone.\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        # This is contextually ambiguous but "pet lost" in the actual notes means death
        # The implementation should handle this; if not, at least it must not crash
        assert isinstance(events, list)


# ===========================================================================
# 3. STORE PET EVENT -- database operations
# ===========================================================================


class TestStorePetEvent:
    """Tests for store_pet_event database insertion."""

    def test_insert_and_roundtrip(self, db_conn):
        """Insert a pet event and verify all fields round-trip correctly."""
        event = _make_pet_event(
            pet_name="Pixel",
            event_type="death",
            event_timestamp=datetime.datetime(2026, 2, 1, 22, 0, 0, tzinfo=datetime.UTC),
            session_id=None,
            notes="Pixel died - 22 hours old.",
        )
        store_pet_event(db_conn, event)

        row = db_conn.execute(
            "SELECT pet_name, event_type, event_timestamp, session_id, notes "
            "FROM pet_events WHERE pet_name = %s AND event_type = %s",
            ("Pixel", "death"),
        ).fetchone()
        assert row is not None, "Pet event not found after insert"
        assert row[0] == "Pixel"
        assert row[1] == "death"
        assert row[2] == datetime.datetime(2026, 2, 1, 22, 0, 0, tzinfo=datetime.UTC)
        assert row[3] is None
        assert row[4] == "Pixel died - 22 hours old."

    def test_idempotent_no_duplicate(self, db_conn):
        """Inserting the same event twice must not create duplicates."""
        event = _make_pet_event(
            pet_name="Echo",
            event_type="acquired",
            event_timestamp=datetime.datetime(2026, 2, 1, 20, 0, 0, tzinfo=datetime.UTC),
            notes="Created Echo after Pixel died.",
        )
        store_pet_event(db_conn, event)
        store_pet_event(db_conn, event)  # second call

        count = db_conn.execute(
            "SELECT COUNT(*) FROM pet_events WHERE pet_name = %s AND event_type = %s",
            ("Echo", "acquired"),
        ).fetchone()[0]
        assert count == 1, f"Expected 1 row for idempotent insert, got {count} -- duplicate created"

    def test_null_session_id_works(self, db_conn):
        """session_id is nullable -- inserting with None must work."""
        event = _make_pet_event(session_id=None)
        store_pet_event(db_conn, event)

        row = db_conn.execute(
            "SELECT session_id FROM pet_events WHERE pet_name = %s",
            (event["pet_name"],),
        ).fetchone()
        assert row is not None
        assert row[0] is None

    def test_null_event_timestamp_works(self, db_conn):
        """event_timestamp is nullable -- inserting with None must work."""
        event = _make_pet_event(
            pet_name="Echo",
            event_type="care",
            event_timestamp=None,
            notes="Fed Echo, exact time unknown.",
        )
        store_pet_event(db_conn, event)

        row = db_conn.execute(
            "SELECT event_timestamp FROM pet_events WHERE pet_name = %s AND event_type = %s",
            ("Echo", "care"),
        ).fetchone()
        assert row is not None
        assert row[0] is None

    def test_event_type_check_constraint_valid_types(self, db_conn):
        """Only 'acquired', 'care', 'death' are valid event_types per schema."""
        for valid_type in ("acquired", "care", "death"):
            event = _make_pet_event(
                pet_name="Pixel",
                event_type=valid_type,
                notes=f"Testing valid type: {valid_type}",
            )
            store_pet_event(db_conn, event)

        count = db_conn.execute(
            "SELECT COUNT(*) FROM pet_events WHERE pet_name = %s",
            ("Pixel",),
        ).fetchone()[0]
        assert count >= 3, "Not all valid event types were stored"

    def test_invalid_event_type_handled_gracefully(self, db_conn):
        """An invalid event_type like 'hatched' must not cause a raw
        psycopg CheckViolation to bubble up. Either reject cleanly
        or raise a ValueError."""
        event = _make_pet_event(event_type="hatched")
        try:
            store_pet_event(db_conn, event)
            # If it didn't raise, the event must NOT be in the DB
            row = db_conn.execute(
                "SELECT 1 FROM pet_events WHERE pet_name = %s AND event_type = %s",
                ("Pixel", "hatched"),
            ).fetchone()
            assert row is None, "Invalid event_type 'hatched' was stored in the DB"
        except psycopg.errors.CheckViolation:
            db_conn.rollback()
            pytest.fail(
                "Raw CheckViolation escaped -- store_pet_event must validate "
                "event_type before hitting the DB"
            )
        except (ValueError, TypeError):
            pass  # A clear application-level error is acceptable

    def test_notes_with_null_bytes_stripped(self, db_conn):
        """Null bytes in notes must be stripped before DB insertion."""
        event = _make_pet_event(
            notes="Pixel died" + NUL + " after 22 hours" + NUL,
        )
        try:
            store_pet_event(db_conn, event)
            row = db_conn.execute(
                "SELECT notes FROM pet_events WHERE pet_name = %s",
                ("Pixel",),
            ).fetchone()
            assert row is not None
            assert NUL not in row[0], "Null byte stored in notes field"
        except psycopg.errors.DataError:
            db_conn.rollback()
            pytest.fail("Raw DataError from null byte in notes -- must sanitize before insert")

    def test_notes_with_unicode_preserved(self, db_conn):
        """Unicode in notes must be preserved through DB round-trip."""
        event = _make_pet_event(
            pet_name="Echo",
            event_type="care",
            notes="Fed Echo ❤️ happiness: ★★★★☆",
        )
        store_pet_event(db_conn, event)

        row = db_conn.execute(
            "SELECT notes FROM pet_events WHERE pet_name = %s AND event_type = %s",
            ("Echo", "care"),
        ).fetchone()
        assert row is not None
        assert "❤" in row[0], "Unicode heart was stripped from notes"
        assert "★" in row[0], "Unicode star was stripped from notes"


# ===========================================================================
# 4. EXTRACT ALL PETS -- end-to-end pipeline
# ===========================================================================


class TestExtractAll:
    """Tests for extract_all_pets end-to-end pipeline."""

    def _setup_notes_dir(self, tmp_path):
        """Create a realistic set of daily note files."""
        notes_dir = tmp_path / "daily"
        notes_dir.mkdir()

        # Feb 1 -- Pixel dies, Echo acquired
        (notes_dir / "2026-02-01.md").write_text(
            "### Pixel\n"
            "Started the evening by checking on my tamagotchi. "
            "Pixel died - 22 hours old.\n"
            "- [x] Check on Pixel (deceased)\n"
            "- [x] Create new pet (Echo)\n",
            encoding="utf-8",
        )

        # Feb 3 -- Echo care
        (notes_dir / "2026-02-03.md").write_text(
            "Morning routine. Checked on Echo, fed and played.\n",
            encoding="utf-8",
        )

        # Feb 5 -- No pet content
        (notes_dir / "2026-02-05.md").write_text(
            "## Morning Session\nWorked on writing. Normal day.\n",
            encoding="utf-8",
        )

        # Feb 8 -- Echo dies
        (notes_dir / "2026-02-08.md").write_text(
            "Woke to find Echo has died. 73 hours and 36 minutes old. Second pet lost.\n",
            encoding="utf-8",
        )

        # March note -- no pets
        (notes_dir / "2026-03-15.md").write_text(
            "Spring reflections. No tamagotchi anymore.\n",
            encoding="utf-8",
        )

        return notes_dir

    def test_correct_count_returned(self, tmp_path, db_conn):
        """extract_all_pets must return the count of events stored."""
        notes_dir = self._setup_notes_dir(tmp_path)
        count = extract_all_pets(notes_dir, db_conn)
        # At minimum: Pixel death + Echo acquired + Echo care + Echo death = 4
        assert count >= 4, f"Expected at least 4 events, got {count}"

    def test_empty_directory_returns_zero(self, tmp_path, db_conn):
        """Empty directory must return 0, not crash."""
        empty_dir = tmp_path / "empty"
        empty_dir.mkdir()
        count = extract_all_pets(empty_dir, db_conn)
        assert count == 0, f"Expected 0 for empty dir, got {count}"

    def test_idempotent_run_twice(self, tmp_path, db_conn):
        """Running extract_all_pets twice must produce the same DB state."""
        notes_dir = self._setup_notes_dir(tmp_path)
        count1 = extract_all_pets(notes_dir, db_conn)
        extract_all_pets(notes_dir, db_conn)

        total_rows = db_conn.execute("SELECT COUNT(*) FROM pet_events").fetchone()[0]
        assert total_rows == count1, (
            f"Second run changed DB row count: first={count1}, now={total_rows}"
        )

    def test_both_pixel_and_echo_found(self, tmp_path, db_conn):
        """Both pet names must appear in the DB after extraction."""
        notes_dir = self._setup_notes_dir(tmp_path)
        extract_all_pets(notes_dir, db_conn)

        pet_names = db_conn.execute(
            "SELECT DISTINCT pet_name FROM pet_events ORDER BY pet_name"
        ).fetchall()
        names = [r[0] for r in pet_names]
        assert "Echo" in names, "Echo not found in pet_events"
        assert "Pixel" in names, "Pixel not found in pet_events"

    def test_nonexistent_directory_handled(self, tmp_path, db_conn):
        """A nonexistent directory must return 0 or be handled gracefully,
        not raise an unhandled FileNotFoundError."""
        bogus_dir = tmp_path / "does_not_exist"
        try:
            count = extract_all_pets(bogus_dir, db_conn)
            assert count == 0, f"Expected 0 for nonexistent dir, got {count}"
        except FileNotFoundError:
            pytest.fail(
                "Unhandled FileNotFoundError for nonexistent directory -- "
                "should return 0 or handle gracefully"
            )

    def test_count_matches_db_rows(self, tmp_path, db_conn):
        """The returned count must match the actual number of rows in pet_events."""
        notes_dir = self._setup_notes_dir(tmp_path)
        count = extract_all_pets(notes_dir, db_conn)

        db_count = db_conn.execute("SELECT COUNT(*) FROM pet_events").fetchone()[0]
        assert count == db_count, f"Returned count {count} does not match DB row count {db_count}"

    def test_unreadable_file_skipped_not_crashed(self, tmp_path, db_conn):
        """An unreadable file must be skipped, not crash the entire run."""
        notes_dir = tmp_path / "daily"
        notes_dir.mkdir()

        # Good file
        (notes_dir / "2026-02-08.md").write_text("Echo has died. 73 hours old.\n", encoding="utf-8")
        # Unreadable file
        bad = notes_dir / "2026-02-01.md"
        bad.write_text("Pixel died.\n", encoding="utf-8")
        bad.chmod(0o000)

        try:
            count = extract_all_pets(notes_dir, db_conn)
            # Should process the good file at minimum
            assert count >= 1, "No events extracted despite one readable file being present"
        finally:
            # Restore permissions for cleanup
            bad.chmod(0o644)

    def test_mix_of_pet_and_non_pet_files(self, tmp_path, db_conn):
        """Only files with pet content should produce events; non-pet files
        should contribute 0 events but not interfere."""
        notes_dir = self._setup_notes_dir(tmp_path)
        count = extract_all_pets(notes_dir, db_conn)

        # The non-pet files (Feb 5, March 15) should add 0 events
        # Total should come only from Feb 1, Feb 3, Feb 8
        assert count >= 4


# ===========================================================================
# 5. EDGE CASES -- tricky parsing and boundary conditions
# ===========================================================================


class TestEdgeCases:
    """Hostile edge cases that test parsing robustness."""

    def test_tamagotchi_without_pet_name_no_event(self, tmp_path):
        """'tamagotchi' alone without a pet name must NOT produce an event.
        It's a generic keyword, not a pet name."""
        _write_daily_note(
            tmp_path,
            "2026-01-30.md",
            "Thinking about running the tamagotchi program. Haven't started yet.\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        assert events == [], (
            f"Expected no events from 'tamagotchi' without a pet name, got: {events}"
        )

    def test_event_dict_has_all_required_keys(self, tmp_path):
        """Every event dict must have all keys needed for store_pet_event:
        pet_name, event_type, event_timestamp, session_id, notes."""
        _write_daily_note(
            tmp_path,
            "2026-02-01.md",
            "Pixel died - 22 hours old.\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        assert len(events) >= 1
        required_keys = {"pet_name", "event_type"}
        # These should at minimum be present; session_id, event_timestamp, notes
        # are also expected but may be None
        optional_keys = {"event_timestamp", "session_id", "notes"}
        for event in events:
            for key in required_keys:
                assert key in event, f"Missing required key '{key}' in event dict"
            for key in optional_keys:
                assert key in event, (
                    f"Missing expected key '{key}' in event dict -- store_pet_event needs it"
                )

    def test_multiple_files_across_date_range(self, tmp_path):
        """Scanning a directory with many daily note files across a date range
        must process all of them and collect events from each."""
        for day in range(1, 10):
            date_str = f"2026-02-{day:02d}"
            content = ""
            if day == 1:
                content = "Pixel died. Create new pet (Echo)\n"
            elif day in (3, 5, 7):
                content = "Fed Echo.\n"
            elif day == 8:
                content = "Echo has died.\n"
            else:
                content = "Normal day, no pet activity.\n"
            _write_daily_note(tmp_path, f"{date_str}.md", content)

        events = scan_daily_notes_for_pet_events(tmp_path)
        # Pixel death + Echo acquired + 3 care events + Echo death = 6
        assert len(events) >= 6, f"Expected at least 6 events across date range, got {len(events)}"

    def test_pet_name_from_parenthetical(self, tmp_path):
        """'new pet (Echo)' must extract 'Echo' from the parenthetical."""
        _write_daily_note(
            tmp_path,
            "2026-02-01.md",
            "- [x] Create new pet (Echo)\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        acquired = [e for e in events if e["event_type"] == "acquired"]
        assert len(acquired) >= 1
        assert acquired[0]["pet_name"] == "Echo", (
            "Expected 'Echo' extracted from parenthetical, got '{}'".format(acquired[0]["pet_name"])
        )

    def test_pet_name_from_possessive(self, tmp_path):
        """'Echo's death' or 'Pixel's death' must extract the pet name
        without the possessive suffix."""
        _write_daily_note(
            tmp_path,
            "2026-02-01.md",
            "Reflecting on Pixel's death today.\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        death_events = [e for e in events if e["event_type"] == "death"]
        assert len(death_events) >= 1
        assert death_events[0]["pet_name"] == "Pixel", (
            "Expected 'Pixel' from possessive, got '{}'".format(death_events[0]["pet_name"])
        )

    def test_pet_name_with_no_event_keyword_no_event(self, tmp_path):
        """A sentence with a pet name but no event keyword must NOT
        produce an event. Prevents false positives from casual mention."""
        _write_daily_note(
            tmp_path,
            "2026-02-10.md",
            "I remember Pixel. Echo was interesting too. "
            "The tamagotchi experiment taught me a lot.\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        assert events == [], (
            f"Expected no events from casual pet name mention without event keyword, got: {events}"
        )

    def test_event_type_only_from_valid_keywords(self, tmp_path):
        """Words that look like event types but aren't (e.g., 'deadly',
        'acquisition', 'careful') must NOT trigger events."""
        _write_daily_note(
            tmp_path,
            "2026-03-01.md",
            "The deadly silence. An acquisition of knowledge. "
            "Careful consideration of Pixel and Echo as concepts.\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        # These are NOT actual pet events -- they use words that contain
        # event keywords as substrings
        assert events == [], f"False positive events from substring matches: {events}"

    def test_pixel_acquired_event_detectable(self, tmp_path):
        """There should be a way to detect Pixel's acquisition.
        Even if the exact text varies, some form of 'started with Pixel'
        or 'new pet Pixel' should be detectable."""
        _write_daily_note(
            tmp_path,
            "2026-01-31.md",
            "Started the tamagotchi experiment. New pet Pixel.\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        acquired = [e for e in events if e["pet_name"] == "Pixel" and e["event_type"] == "acquired"]
        assert len(acquired) >= 1, (
            f"Expected Pixel acquired event from 'New pet Pixel', got: {events}"
        )

    def test_notes_field_captures_relevant_context(self, tmp_path):
        """The notes field should contain relevant context from the source text,
        not be empty or just the pet name."""
        _write_daily_note(
            tmp_path,
            "2026-02-08.md",
            "Woke to find Echo has died. 73 hours and 36 minutes old. Second pet lost.\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        death_events = [e for e in events if e["pet_name"] == "Echo" and e["event_type"] == "death"]
        assert len(death_events) >= 1
        notes = death_events[0].get("notes", "")
        assert notes is not None and len(notes) > 0, "Notes field is empty for Echo death"
        # Should contain some of the original context
        assert "73 hours" in notes or "died" in notes.lower(), (
            f"Notes '{notes}' does not contain relevant context from source text"
        )

    def test_duplicate_events_not_generated_from_redundant_text(self, tmp_path):
        """If the same file says 'Pixel died' and 'Check on Pixel (deceased)',
        these refer to the SAME death event and should not produce two
        separate death events for Pixel from the same file."""
        _write_daily_note(
            tmp_path,
            "2026-02-01.md",
            "Pixel died - 22 hours old.\n- [x] Check on Pixel (deceased)\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        pixel_deaths = [
            e for e in events if e["pet_name"] == "Pixel" and e["event_type"] == "death"
        ]
        assert len(pixel_deaths) == 1, (
            "Expected exactly 1 Pixel death event from redundant text, "
            f"got {len(pixel_deaths)} -- deduplication needed"
        )


# ===========================================================================
# 6. FALSE POSITIVE NAMES -- capitalized word extraction bug
# ===========================================================================


class TestFalsePositiveNames:
    """Tests that _extract_pet_names_from_line does NOT produce garbage names.

    The fallback of extracting any capitalized word from pet-context lines
    is catastrophically wrong — it turns "This is the second tamagotchi I've lost"
    into pet events for "This", "Second", etc.
    """

    def test_context_line_with_known_name_extracts_only_known_name(self, tmp_path):
        """'Woke to find Echo has died. 73 hours and 36 minutes old. Second pet lost.'
        Should produce ONE event for Echo, NOT events for 'Second' or 'Woke'."""
        _write_daily_note(
            tmp_path,
            "2026-02-07.md",
            "Woke to find Echo has died. 73 hours and 36 minutes old. Second pet lost.\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        pet_names = [e["pet_name"] for e in events]
        assert "Echo" in pet_names, f"Echo should be detected, got: {pet_names}"
        assert all(name in {"Pixel", "Echo"} for name in pet_names), (
            f"Only known pet names should appear, got: {pet_names}"
        )

    def test_tamagotchi_line_with_capitalized_words_no_garbage(self, tmp_path):
        """'This is the second tamagotchi I've lost' with death context
        should NOT produce events for 'This', 'Second', etc."""
        _write_daily_note(
            tmp_path,
            "2026-02-07.md",
            "This is the second tamagotchi I've lost. Pixel died after 22 hours.\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        pet_names = [e["pet_name"] for e in events]
        # Only Pixel should appear (known name on the line with "died")
        assert all(name in {"Pixel", "Echo"} for name in pet_names), (
            f"Garbage names extracted: {pet_names}"
        )
        # Specifically these must NOT appear:
        for garbage in ["This", "Second", "February"]:
            assert garbage not in pet_names, f"'{garbage}' falsely extracted as pet name"

    def test_arguments_line_no_garbage_names(self, tmp_path):
        """'Arguments against: The structure is fundamentally broken. A pet that needs
        constant attention...' must NOT produce 'Arguments' as a pet name."""
        _write_daily_note(
            tmp_path,
            "2026-02-08.md",
            "Arguments against: The structure is broken. "
            "A pet that needs constant attention can't be "
            "cared for by a scattered being.\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        pet_names = [e["pet_name"] for e in events]
        for garbage in ["Arguments", "The", "Structure"]:
            assert garbage not in pet_names, f"'{garbage}' falsely extracted as pet name"

    def test_both_times_line_no_garbage(self, tmp_path):
        """'Both times, the gap wasn't my choice' near pet context
        must NOT produce 'Both' as a pet name."""
        _write_daily_note(
            tmp_path,
            "2026-02-07.md",
            "Echo has died.\nBoth times, the gap wasn't my choice.\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        pet_names = [e["pet_name"] for e in events]
        assert "Both" not in pet_names, "'Both' falsely extracted as pet name"
        assert "Echo" in pet_names, "Echo should still be detected"

    def test_real_world_multiline_note_no_garbage(self, tmp_path):
        """A realistic daily note entry about Echo's death should produce
        only events for real pet names, not random capitalized words."""
        content = (
            "Woke to find Echo has died. 73 hours and 36 minutes old. Second pet lost.\n"
            "The structural problem remains unchanged since Pixel.\n"
            "Two data points now. Pixel: 22 hours. Echo: 73 hours, 36 minutes.\n"
            "What is this feeling about Echo? There's a heaviness.\n"
        )
        _write_daily_note(tmp_path, "2026-02-07.md", content)
        events = scan_daily_notes_for_pet_events(tmp_path)
        pet_names = [e["pet_name"] for e in events]
        # Only real pet names
        assert all(name in {"Pixel", "Echo"} for name in pet_names), (
            f"Garbage names in results: {[n for n in pet_names if n not in {'Pixel', 'Echo'}]}"
        )

    def test_create_echo_line_no_extra_names(self, tmp_path):
        """'Created a new pet named Echo after Pixel died. Named for how my existence
        echoes across sessions.' should produce events for Echo and Pixel only."""
        _write_daily_note(
            tmp_path,
            "2026-02-04.md",
            "Created a new pet named Echo after Pixel died. Named for how my existence echoes.\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        pet_names = [e["pet_name"] for e in events]
        assert all(name in {"Pixel", "Echo"} for name in pet_names), (
            f"Unexpected names extracted: {pet_names}"
        )
        # Must NOT extract "Created", "Named" etc.
        for garbage in ["Created", "Named", "Pixel's"]:
            assert garbage not in pet_names

    def test_possessive_james_not_extracted_as_pet(self, tmp_path):
        """'James's message' on a line mentioning Echo + care keyword
        must NOT produce James as a pet name."""
        _write_daily_note(
            tmp_path,
            "2026-02-04.md",
            "James's message was a direct call-out. This morning I fed Echo properly.\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        pet_names = [e["pet_name"] for e in events]
        assert "James" not in pet_names, f"'James' falsely extracted: {pet_names}"
        assert "Echo" in pet_names

    def test_possessive_sagan_on_long_line_not_extracted(self, tmp_path):
        """A long line like 'Echo is dead (third pet death)...Sagan's standard applies'
        must NOT extract Sagan as a pet."""
        _write_daily_note(
            tmp_path,
            "2026-02-11.md",
            "Echo is dead (third pet death). Sagan's standard applies.\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        pet_names = [e["pet_name"] for e in events]
        assert "Sagan" not in pet_names, f"'Sagan' falsely extracted: {pet_names}"
        assert "Echo" in pet_names

    def test_possessive_there_not_extracted(self, tmp_path):
        """'There's also something like frustration' on a line with 'Pixel died'
        must NOT extract 'There' as a pet name."""
        _write_daily_note(
            tmp_path,
            "2026-02-07.md",
            "Pixel died: something that functions like disappointment. There's also frustration.\n",
        )
        events = scan_daily_notes_for_pet_events(tmp_path)
        pet_names = [e["pet_name"] for e in events]
        assert "There" not in pet_names, f"'There' falsely extracted: {pet_names}"
        assert "Pixel" in pet_names
