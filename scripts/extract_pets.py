"""Extract pet event data from daily notes markdown files."""

from __future__ import annotations

import datetime
import re
from pathlib import Path

import psycopg

from scripts.extract_sessions import _sanitize_string


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_KNOWN_PET_NAMES = {"Pixel", "Echo"}

# Event type keyword patterns — use word boundaries to avoid substring traps.
# "deadly" must NOT match "death", "careful" must NOT match "care",
# "acquisition" must NOT match "acquired".
_DEATH_RE = re.compile(r"\b(?:died|deceased|death)\b", re.IGNORECASE)
_ACQUIRED_RE = re.compile(
    r"\b(?:acquired|adopted)\b|(?:create\s+new\s+pet|new\s+pet)", re.IGNORECASE
)
_CARE_RE = re.compile(r"\b(?:fed|checked\s+on|cared\s+for)\b", re.IGNORECASE)

# Pet/tamagotchi context keywords — a line must contain one of these
# (or a known pet name) for us to consider it pet-related.
_PET_CONTEXT_RE = re.compile(r"\b(?:pet|tamagotchi)\b", re.IGNORECASE)

# Extract a capitalized name from parenthetical like "(Echo)"
_PAREN_NAME_RE = re.compile(r"\(([A-Z][a-z]+)\)")

# Possessive: "Echo's" -> "Echo"
_POSSESSIVE_RE = re.compile(r"\b([A-Z][a-z]+)'s\b")

# General capitalized name (at least 2 chars, first letter uppercase, rest lowercase)
_CAP_NAME_RE = re.compile(r"\b([A-Z][a-z]+)\b")

# Date extraction from filenames: YYYY-MM-DD.md or YYYY-MM-DD-something.md
_DATE_FROM_FILENAME_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")

# Valid event types for the DB CHECK constraint
_VALID_EVENT_TYPES = {"acquired", "care", "death"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _extract_date_from_filename(filename: str) -> datetime.date | None:
    """Extract a date from a filename like 2026-01-15.md or 2026-01-15-evening.md."""
    m = _DATE_FROM_FILENAME_RE.search(filename)
    if not m:
        return None
    try:
        return datetime.date.fromisoformat(m.group(1))
    except ValueError:
        return None


def _detect_event_type(text: str) -> str | None:
    """Detect event type from text using priority: death > acquired > care."""
    if _DEATH_RE.search(text):
        return "death"
    if _ACQUIRED_RE.search(text):
        return "acquired"
    if _CARE_RE.search(text):
        return "care"
    return None


def _extract_pet_names_from_line(line: str) -> list[str]:
    """Extract pet names from a line of text.

    Looks for:
    1. Known pet names (case-insensitive match, canonical case output)
    2. Parenthetical names like "(Echo)"
    3. Possessive names like "Echo's"
    """
    names: list[str] = []
    seen: set[str] = set()

    # Check for known pet names (case-insensitive)
    for known in _KNOWN_PET_NAMES:
        pattern = re.compile(r"\b" + re.escape(known) + r"(?:'s)?\b", re.IGNORECASE)
        if pattern.search(line):
            canonical = known[0].upper() + known[1:].lower()
            if canonical.lower() not in seen:
                names.append(canonical)
                seen.add(canonical.lower())

    # Extract parenthetical names: "new pet (Echo)"
    for m in _PAREN_NAME_RE.finditer(line):
        name = m.group(1)
        canonical = name[0].upper() + name[1:].lower()
        if canonical.lower() not in seen:
            names.append(canonical)
            seen.add(canonical.lower())

    # Extract possessive names: "Echo's death"
    for m in _POSSESSIVE_RE.finditer(line):
        name = m.group(1)
        canonical = name[0].upper() + name[1:].lower()
        if canonical.lower() not in seen:
            names.append(canonical)
            seen.add(canonical.lower())

    # Filter to known pet names only — parenthetical/possessive patterns are too
    # broad and match "James's", "Sagan's", "There's", "(Mars)" etc.
    known_lower = {n.lower() for n in _KNOWN_PET_NAMES}
    return [n for n in names if n.lower() in known_lower]


def _is_pet_relevant_line(line: str) -> bool:
    """Check if a line is relevant to pet events.

    A line is relevant if it contains a known pet name OR pet/tamagotchi keywords.
    """
    for known in _KNOWN_PET_NAMES:
        if re.search(r"\b" + re.escape(known) + r"\b", line, re.IGNORECASE):
            return True
    if _PET_CONTEXT_RE.search(line):
        return True
    return False


# ---------------------------------------------------------------------------
# Scanner
# ---------------------------------------------------------------------------


def scan_daily_notes_for_pet_events(notes_dir: Path) -> list[dict]:
    """Scan .md files in notes_dir for pet-related content.

    For each file:
    1. Extract date from filename (YYYY-MM-DD.md or YYYY-MM-DD-evening.md)
    2. Read content, scan for pet names near event keywords
    3. Return list of event dicts

    Each event dict has: pet_name, event_type,
    event_timestamp (datetime, midnight UTC), notes (text snippet)
    Dedup: only one event per (pet_name, event_type) per file.
    """
    notes_dir = Path(notes_dir)

    if not notes_dir.exists() or not notes_dir.is_dir():
        return []

    events: list[dict] = []

    for filepath in sorted(notes_dir.iterdir()):
        if not filepath.is_file():
            continue
        if filepath.suffix != ".md":
            continue

        # Extract date from filename
        event_date = _extract_date_from_filename(filepath.name)
        if event_date is None:
            continue

        # Read file content
        try:
            content = filepath.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue

        if not content:
            continue

        # Strip null bytes
        content = content.replace("\x00", "")

        if not content.strip():
            continue

        # Track (pet_name, event_type) pairs to dedup within this file
        seen_in_file: set[tuple[str, str]] = set()

        # Process line by line
        for line in content.splitlines():
            if not line.strip():
                continue

            # Check if this line is pet-relevant
            if not _is_pet_relevant_line(line):
                continue

            # Detect event type from this line
            event_type = _detect_event_type(line)
            if event_type is None:
                continue

            # Extract pet names from this line
            pet_names = _extract_pet_names_from_line(line)
            if not pet_names:
                continue

            for pet_name in pet_names:
                key = (pet_name.lower(), event_type)
                if key in seen_in_file:
                    continue
                seen_in_file.add(key)

                event_timestamp = datetime.datetime.combine(
                    event_date,
                    datetime.time.min,
                    tzinfo=datetime.timezone.utc,
                )
                events.append(
                    {
                        "pet_name": pet_name,
                        "event_type": event_type,
                        "event_timestamp": event_timestamp,
                        "session_id": None,
                        "notes": line.strip(),
                    }
                )

    return events


# ---------------------------------------------------------------------------
# Database storage
# ---------------------------------------------------------------------------


def store_pet_event(conn, event: dict) -> bool:
    """Insert a pet event into the pet_events table.

    Idempotent: dedup on (pet_name, event_type, event_timestamp::date).
    Sanitizes strings. Handles invalid event_type gracefully.

    Returns True if a row was inserted, False if skipped or invalid.
    """
    pet_name = _sanitize_string(event["pet_name"])
    event_type = event["event_type"]
    # Support both event_timestamp and event_date keys, preferring event_timestamp
    raw_ts = event.get("event_timestamp") or event.get("event_date")
    notes = _sanitize_string(event.get("notes", "")) if event.get("notes") else None

    # Validate event_type before attempting insert to avoid CheckViolation
    if event_type not in _VALID_EVENT_TYPES:
        return False

    # Construct timestamp from raw value at midnight UTC
    if isinstance(raw_ts, datetime.datetime):
        event_timestamp = (
            raw_ts if raw_ts.tzinfo is not None else raw_ts.replace(tzinfo=datetime.timezone.utc)
        )
    elif isinstance(raw_ts, datetime.date):
        event_timestamp = datetime.datetime.combine(
            raw_ts, datetime.time.min, tzinfo=datetime.timezone.utc
        )
    else:
        event_timestamp = None

    try:
        with conn.transaction():
            # Dedup: check if this (pet_name, event_type, date) already exists.
            # Use UTC-aware date comparison to avoid server-timezone skew.
            if event_timestamp is not None:
                event_date_for_dedup = event_timestamp.date()
                existing = conn.execute(
                    """
                    SELECT id FROM pet_events
                    WHERE pet_name = %s
                      AND event_type = %s
                      AND (event_timestamp AT TIME ZONE 'UTC')::date = %s
                    """,
                    (pet_name, event_type, event_date_for_dedup),
                ).fetchone()
            else:
                existing = conn.execute(
                    """
                    SELECT id FROM pet_events
                    WHERE pet_name = %s
                      AND event_type = %s
                      AND event_timestamp IS NULL
                    """,
                    (pet_name, event_type),
                ).fetchone()

            if existing:
                return False

            conn.execute(
                """
                INSERT INTO pet_events (pet_name, event_type, event_timestamp, notes)
                VALUES (%s, %s, %s, %s)
                """,
                (pet_name, event_type, event_timestamp, notes),
            )
            return True
    except psycopg.errors.CheckViolation:
        return False
    except psycopg.errors.IntegrityError:
        return False


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


def extract_all_pets(notes_dir: Path, conn) -> int:
    """Scan daily notes for pet events, store them, and return count stored.

    Idempotent. Non-existent directory returns 0.
    """
    notes_dir = Path(notes_dir)

    if not notes_dir.exists() or not notes_dir.is_dir():
        return 0

    events = scan_daily_notes_for_pet_events(notes_dir)
    count = 0

    for event in events:
        if store_pet_event(conn, event):
            count += 1

    return count
