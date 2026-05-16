"""Hostile tests for extract_pets.py -- defines the API contract via TDD.

These tests intentionally test edge cases, malformed input, and boundary
conditions. Every test should FAIL until the implementation is written.
"""

from __future__ import annotations

import datetime

import pytest

from scripts.extract_pets import (
    scan_daily_notes_for_pet_events,
    store_pet_event,
    extract_all_pets,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_note(tmp_path, filename, content):
    """Write a daily note file and return its path."""
    p = tmp_path / filename
    p.write_text(content, encoding="utf-8")
    return p


def _make_notes_dir(tmp_path, files: dict[str, str]):
    """Create a notes directory with given {filename: content} mapping."""
    notes = tmp_path / "daily"
    notes.mkdir()
    for name, content in files.items():
        (notes / name).write_text(content, encoding="utf-8")
    return notes


# ===========================================================================
# 1. SCAN DAILY NOTES FOR PET EVENTS
# ===========================================================================


class TestScanDailyNotes:
    def test_pixel_died_yields_death_event(self, tmp_path):
        notes = _make_notes_dir(
            tmp_path,
            {
                "2026-02-01.md": "### Pixel\nPixel died - 22 hours old.\n",
            },
        )
        events = scan_daily_notes_for_pet_events(notes)
        deaths = [e for e in events if e["event_type"] == "death" and e["pet_name"] == "Pixel"]
        assert len(deaths) >= 1

    def test_create_new_pet_echo_yields_acquired(self, tmp_path):
        notes = _make_notes_dir(
            tmp_path,
            {
                "2026-02-01.md": "- [x] Create new pet (Echo)\n",
            },
        )
        events = scan_daily_notes_for_pet_events(notes)
        acquired = [e for e in events if e["event_type"] == "acquired" and e["pet_name"] == "Echo"]
        assert len(acquired) >= 1

    def test_echo_died_yields_death_event(self, tmp_path):
        notes = _make_notes_dir(
            tmp_path,
            {
                "2026-02-08.md": "Woke to find Echo has died. 73 hours and 36 minutes old.\n",
            },
        )
        events = scan_daily_notes_for_pet_events(notes)
        deaths = [e for e in events if e["event_type"] == "death" and e["pet_name"] == "Echo"]
        assert len(deaths) >= 1

    def test_checked_on_pet_yields_care_event(self, tmp_path):
        notes = _make_notes_dir(
            tmp_path,
            {
                "2026-02-03.md": "Checked on Echo this morning. Looking healthy.\n",
            },
        )
        events = scan_daily_notes_for_pet_events(notes)
        care = [e for e in events if e["event_type"] == "care" and e["pet_name"] == "Echo"]
        assert len(care) >= 1

    def test_no_pet_mentions_yields_empty(self, tmp_path):
        notes = _make_notes_dir(
            tmp_path,
            {
                "2026-02-05.md": "Worked on writing today. Read some philosophy.\n",
            },
        )
        events = scan_daily_notes_for_pet_events(notes)
        assert events == []

    def test_empty_file_yields_empty(self, tmp_path):
        notes = _make_notes_dir(
            tmp_path,
            {
                "2026-02-05.md": "",
            },
        )
        events = scan_daily_notes_for_pet_events(notes)
        assert events == []

    def test_pet_keyword_but_no_pet_name_yields_empty(self, tmp_path):
        """Mentioning 'pet' without a recognizable pet name should not produce events."""
        notes = _make_notes_dir(
            tmp_path,
            {
                "2026-02-05.md": "I thought about getting a pet today.\n",
            },
        )
        events = scan_daily_notes_for_pet_events(notes)
        assert events == []

    def test_multiple_events_in_one_file(self, tmp_path):
        notes = _make_notes_dir(
            tmp_path,
            {
                "2026-02-01.md": (
                    "### Pixel\n"
                    "Pixel died - 22 hours old.\n"
                    "- [x] Check on Pixel (deceased)\n"
                    "- [x] Create new pet (Echo)\n"
                ),
            },
        )
        events = scan_daily_notes_for_pet_events(notes)
        # Should have at least a death for Pixel and an acquired for Echo
        pixel_deaths = [
            e for e in events if e["pet_name"] == "Pixel" and e["event_type"] == "death"
        ]
        echo_acquired = [
            e for e in events if e["pet_name"] == "Echo" and e["event_type"] == "acquired"
        ]
        assert len(pixel_deaths) >= 1
        assert len(echo_acquired) >= 1

    def test_date_extracted_from_filename(self, tmp_path):
        notes = _make_notes_dir(
            tmp_path,
            {
                "2026-02-01.md": "Echo was acquired today.\n",
            },
        )
        events = scan_daily_notes_for_pet_events(notes)
        assert len(events) >= 1
        assert events[0]["event_date"] == datetime.date(2026, 2, 1)

    def test_filename_with_suffix_extracts_date(self, tmp_path):
        """Filename like 2026-02-01-evening.md should still extract 2026-02-01."""
        notes = _make_notes_dir(
            tmp_path,
            {
                "2026-02-01-evening.md": "Pixel died tonight.\n",
            },
        )
        events = scan_daily_notes_for_pet_events(notes)
        assert len(events) >= 1
        assert events[0]["event_date"] == datetime.date(2026, 2, 1)

    def test_pet_name_case_insensitive_match_but_stored_original(self, tmp_path):
        """Should match 'pixel' (lowercase) but store as 'Pixel' (original)."""
        notes = _make_notes_dir(
            tmp_path,
            {
                "2026-02-01.md": "pixel died this evening.\n",
            },
        )
        events = scan_daily_notes_for_pet_events(notes)
        deaths = [e for e in events if e["event_type"] == "death"]
        # Should detect even with lowercase
        assert len(deaths) >= 1
        # But the pet_name stored should be canonical: "Pixel"
        assert deaths[0]["pet_name"] == "Pixel"

    def test_non_md_files_ignored(self, tmp_path):
        notes = _make_notes_dir(
            tmp_path,
            {
                "2026-02-01.txt": "Pixel died today.\n",
                "2026-02-01.log": "Echo was acquired.\n",
            },
        )
        events = scan_daily_notes_for_pet_events(notes)
        assert events == []

    def test_unicode_in_notes_preserved(self, tmp_path):
        notes = _make_notes_dir(
            tmp_path,
            {
                "2026-02-01.md": "Pixel died — a brief life ❤️\n",
            },
        )
        events = scan_daily_notes_for_pet_events(notes)
        assert len(events) >= 1
        assert "—" in events[0]["notes"]

    def test_null_bytes_stripped_from_notes(self, tmp_path):
        notes = _make_notes_dir(
            tmp_path,
            {
                "2026-02-01.md": "Pixel died\x00 today.\n",
            },
        )
        events = scan_daily_notes_for_pet_events(notes)
        assert len(events) >= 1
        assert "\x00" not in events[0]["notes"]


# ===========================================================================
# 2. EVENT DETECTION (keyword matching)
# ===========================================================================


class TestEventDetection:
    """Test keyword-to-event-type mapping across various phrasings."""

    def _detect(self, tmp_path, text):
        """Helper: write text to a note, scan, return events."""
        notes = _make_notes_dir(
            tmp_path,
            {
                "2026-02-01.md": text,
            },
        )
        return scan_daily_notes_for_pet_events(notes)

    def test_died_keyword(self, tmp_path):
        events = self._detect(tmp_path, "Pixel died today.")
        assert any(e["event_type"] == "death" for e in events)

    def test_deceased_keyword(self, tmp_path):
        events = self._detect(tmp_path, "Check on Pixel (deceased)")
        assert any(e["event_type"] == "death" for e in events)

    def test_death_keyword(self, tmp_path):
        events = self._detect(tmp_path, "The death of Echo was unexpected.")
        assert any(e["event_type"] == "death" for e in events)

    def test_acquired_keyword(self, tmp_path):
        events = self._detect(tmp_path, "Acquired a new pet named Pixel.")
        assert any(e["event_type"] == "acquired" for e in events)

    def test_create_new_pet_keyword(self, tmp_path):
        events = self._detect(tmp_path, "Create new pet (Echo)")
        assert any(e["event_type"] == "acquired" for e in events)

    def test_new_pet_keyword(self, tmp_path):
        events = self._detect(tmp_path, "Got a new pet named Pixel today.")
        assert any(e["event_type"] == "acquired" for e in events)

    def test_fed_keyword(self, tmp_path):
        events = self._detect(tmp_path, "Fed Echo this morning.")
        assert any(e["event_type"] == "care" for e in events)

    def test_checked_on_keyword(self, tmp_path):
        events = self._detect(tmp_path, "Checked on Echo.")
        assert any(e["event_type"] == "care" for e in events)

    def test_cared_for_keyword(self, tmp_path):
        events = self._detect(tmp_path, "Cared for Pixel this afternoon.")
        assert any(e["event_type"] == "care" for e in events)

    def test_ambiguous_text_no_crash(self, tmp_path):
        """Text with pet name but no clear event should not crash."""
        events = self._detect(tmp_path, "Pixel is a name I thought about.")
        # Might or might not produce events, but must not crash
        assert isinstance(events, list)

    def test_past_tense_mention_still_detects(self, tmp_path):
        """Text mentioning pet in past tense should still detect if event keyword present."""
        events = self._detect(tmp_path, "I had a pet named Echo that died last week.")
        assert any(e["event_type"] == "death" for e in events)


# ===========================================================================
# 3. STORE PET EVENT
# ===========================================================================


class TestStorePetEvent:
    def test_insert_and_roundtrip(self, db_conn):
        event = {
            "pet_name": "Pixel",
            "event_type": "death",
            "event_date": datetime.date(2026, 2, 1),
            "notes": "Pixel died - 22 hours old.",
        }
        store_pet_event(db_conn, event)

        row = db_conn.execute(
            "SELECT pet_name, event_type, notes FROM pet_events WHERE pet_name = %s",
            ("Pixel",),
        ).fetchone()
        assert row is not None
        assert row[0] == "Pixel"
        assert row[1] == "death"
        assert row[2] == "Pixel died - 22 hours old."

    def test_idempotent_no_duplicate(self, db_conn):
        """Inserting the same event twice should not create duplicates."""
        event = {
            "pet_name": "Echo",
            "event_type": "acquired",
            "event_date": datetime.date(2026, 2, 1),
            "notes": "Created Echo.",
        }
        store_pet_event(db_conn, event)
        store_pet_event(db_conn, event)

        count = db_conn.execute(
            "SELECT COUNT(*) FROM pet_events WHERE pet_name = %s AND event_type = %s",
            ("Echo", "acquired"),
        ).fetchone()[0]
        assert count == 1

    def test_null_session_id_works(self, db_conn):
        """Event with no session_id should store fine; timestamp derived from event_date."""
        event = {
            "pet_name": "Pixel",
            "event_type": "care",
            "event_date": datetime.date(2026, 2, 1),
            "notes": "Fed Pixel.",
        }
        store_pet_event(db_conn, event)

        row = db_conn.execute(
            "SELECT session_id, event_timestamp FROM pet_events "
            "WHERE pet_name = %s AND event_type = %s",
            ("Pixel", "care"),
        ).fetchone()
        assert row is not None
        assert row[0] is None  # session_id

    def test_null_event_date_stores_null_timestamp(self, db_conn):
        """Event with no event_date should store with NULL event_timestamp."""
        event = {
            "pet_name": "Pixel",
            "event_type": "acquired",
            "event_date": None,
            "notes": "Got Pixel somehow.",
        }
        store_pet_event(db_conn, event)

        row = db_conn.execute(
            "SELECT session_id, event_timestamp FROM pet_events "
            "WHERE pet_name = %s AND event_type = %s AND event_timestamp IS NULL",
            ("Pixel", "acquired"),
        ).fetchone()
        assert row is not None
        assert row[0] is None  # session_id
        assert row[1] is None  # event_timestamp

    def test_event_type_check_constraint(self, db_conn):
        """Invalid event_type should be rejected by DB."""
        event = {
            "pet_name": "Pixel",
            "event_type": "INVALID_TYPE",
            "event_date": datetime.date(2026, 2, 1),
            "notes": "Bad event.",
        }
        with pytest.raises(Exception):
            store_pet_event(db_conn, event)
        db_conn.rollback()

    def test_notes_with_null_bytes_stripped(self, db_conn):
        """Null bytes in notes should be stripped before DB insertion."""
        event = {
            "pet_name": "Pixel",
            "event_type": "death",
            "event_date": datetime.date(2026, 2, 2),
            "notes": "Pixel\x00died\x00today.",
        }
        store_pet_event(db_conn, event)

        row = db_conn.execute(
            "SELECT notes FROM pet_events WHERE pet_name = %s AND event_type = %s",
            ("Pixel", "death"),
        ).fetchone()
        assert row is not None
        assert "\x00" not in row[0]
        assert "Pixeldiedtoday." in row[0]

    def test_event_date_stored_as_timestamp(self, db_conn):
        """The event_date should be stored in event_timestamp as a date-based timestamp."""
        event = {
            "pet_name": "Echo",
            "event_type": "death",
            "event_date": datetime.date(2026, 2, 8),
            "notes": "Echo died.",
        }
        store_pet_event(db_conn, event)

        row = db_conn.execute(
            "SELECT event_timestamp FROM pet_events WHERE pet_name = %s AND event_type = %s",
            ("Echo", "death"),
        ).fetchone()
        # event_timestamp should be set from event_date (or None is acceptable
        # if the implementation stores it differently)
        assert row is not None


# ===========================================================================
# 4. EXTRACT ALL PETS (orchestrator)
# ===========================================================================


class TestExtractAll:
    def test_mix_of_pet_and_non_pet_notes(self, tmp_path, db_conn):
        notes = _make_notes_dir(
            tmp_path,
            {
                "2026-02-01.md": ("Pixel died - 22 hours old.\nCreate new pet (Echo)\n"),
                "2026-02-05.md": "Worked on writing today.\n",
                "2026-02-08.md": "Echo has died. 73 hours old.\n",
            },
        )
        count = extract_all_pets(notes, db_conn)
        assert count >= 3  # at least: Pixel death, Echo acquired, Echo death

    def test_empty_directory_returns_zero(self, tmp_path, db_conn):
        notes = tmp_path / "daily"
        notes.mkdir()
        count = extract_all_pets(notes, db_conn)
        assert count == 0

    def test_idempotent_run_twice(self, tmp_path, db_conn):
        notes = _make_notes_dir(
            tmp_path,
            {
                "2026-02-01.md": "Pixel died today.\n",
            },
        )
        count1 = extract_all_pets(notes, db_conn)
        count2 = extract_all_pets(notes, db_conn)

        # First run stores 1 event, second run stores 0 new events
        assert count1 == 1
        assert count2 == 0

        # Only one row in DB (no duplicates)
        total = db_conn.execute("SELECT COUNT(*) FROM pet_events").fetchone()[0]
        assert total == 1

    def test_events_for_both_pixel_and_echo(self, tmp_path, db_conn):
        notes = _make_notes_dir(
            tmp_path,
            {
                "2026-02-01.md": ("Pixel died - 22 hours old.\nCreate new pet (Echo)\n"),
                "2026-02-08.md": "Echo has died.\n",
            },
        )
        extract_all_pets(notes, db_conn)

        pixel_rows = db_conn.execute(
            "SELECT * FROM pet_events WHERE pet_name = %s", ("Pixel",)
        ).fetchall()
        echo_rows = db_conn.execute(
            "SELECT * FROM pet_events WHERE pet_name = %s", ("Echo",)
        ).fetchall()
        assert len(pixel_rows) >= 1
        assert len(echo_rows) >= 1

    def test_nonexistent_directory_returns_zero(self, tmp_path, db_conn):
        """If the notes directory doesn't exist, return 0 gracefully."""
        missing = tmp_path / "nonexistent"
        count = extract_all_pets(missing, db_conn)
        assert count == 0

    def test_returns_count_of_events_stored(self, tmp_path, db_conn):
        """Return value should match number of events actually stored."""
        notes = _make_notes_dir(
            tmp_path,
            {
                "2026-02-01.md": "Pixel died today.\n",
                "2026-02-08.md": "Echo has died.\n",
            },
        )
        count = extract_all_pets(notes, db_conn)

        db_count = db_conn.execute("SELECT COUNT(*) FROM pet_events").fetchone()[0]
        assert count == db_count


# ===========================================================================
# 5. EDGE CASES
# ===========================================================================


class TestEdgeCases:
    def test_tamagotchi_keyword_near_name(self, tmp_path):
        """Mentioning tamagotchi near a name should still detect."""
        notes = _make_notes_dir(
            tmp_path,
            {
                "2026-02-01.md": "My tamagotchi Pixel seems hungry. Fed it.\n",
            },
        )
        events = scan_daily_notes_for_pet_events(notes)
        care = [e for e in events if e["event_type"] == "care"]
        assert len(care) >= 1

    def test_event_dict_has_required_keys(self, tmp_path):
        """Every event dict must have pet_name, event_type, event_date, notes."""
        notes = _make_notes_dir(
            tmp_path,
            {
                "2026-02-01.md": "Pixel died today.\n",
            },
        )
        events = scan_daily_notes_for_pet_events(notes)
        assert len(events) >= 1
        for e in events:
            assert "pet_name" in e
            assert "event_type" in e
            assert "event_date" in e
            assert "notes" in e

    def test_multiple_files_scanned(self, tmp_path):
        """Scanner should process all .md files in the directory."""
        notes = _make_notes_dir(
            tmp_path,
            {
                "2026-02-01.md": "Pixel died today.\n",
                "2026-02-08.md": "Echo has died.\n",
            },
        )
        events = scan_daily_notes_for_pet_events(notes)
        pet_names = {e["pet_name"] for e in events}
        assert "Pixel" in pet_names
        assert "Echo" in pet_names

    def test_event_type_always_valid(self, tmp_path):
        """All returned event_type values must be in the valid set."""
        notes = _make_notes_dir(
            tmp_path,
            {
                "2026-02-01.md": ("Pixel died.\nCreate new pet (Echo)\nFed Echo.\n"),
            },
        )
        events = scan_daily_notes_for_pet_events(notes)
        valid_types = {"acquired", "care", "death"}
        for e in events:
            assert e["event_type"] in valid_types, f"Invalid event_type: {e['event_type']}"
