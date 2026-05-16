"""Extract pet lifecycle events from daily note files."""

from __future__ import annotations

import datetime
import re
from pathlib import Path

import psycopg

from scripts.extract_sessions import _sanitize_string


# ---------------------------------------------------------------------------
# Known pet names (canonical casing)
# ---------------------------------------------------------------------------
_KNOWN_PETS: dict[str, str] = {
    "pixel": "Pixel",
    "echo": "Echo",
}

# ---------------------------------------------------------------------------
# Keyword → event_type mappings
# ---------------------------------------------------------------------------
_DEATH_KEYWORDS = re.compile(
    r"\b(?:died|deceased|death)\b",
    re.IGNORECASE,
)
_ACQUIRED_KEYWORDS = re.compile(
    r"(?:\b(?:acquired|created)\b|(?:create\s+)?new\s+pet)",
    re.IGNORECASE,
)
_CARE_KEYWORDS = re.compile(
    r"\b(?:fed|checked\s+on|cared\s+for|care)\b",
    re.IGNORECASE,
)

# Pet-related context keywords (to identify lines worth scanning)
_PET_CONTEXT_RE = re.compile(
    r"\b(?:tamagotchi|pet|pixel|echo)\b",
    re.IGNORECASE,
)

# Extract a pet name from text: known names, or capitalized name near pet/tamagotchi keyword
_PET_NAME_IN_PARENS = re.compile(r"\(\s*([A-Z][a-z]+)\s*\)")
_CAPITALIZED_NAME = re.compile(r"\b([A-Z][a-z]{2,})\b")


# ---------------------------------------------------------------------------
# Date extraction from filename
# ---------------------------------------------------------------------------
_FILENAME_DATE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")


def _extract_date_from_filename(filename: str) -> datetime.date | None:
    """Extract date from a filename like 2026-02-01.md or 2026-02-01-evening.md."""
    m = _FILENAME_DATE_RE.search(filename)
    if m:
        try:
            return datetime.date.fromisoformat(m.group(1))
        except ValueError:
            return None
    return None


# ---------------------------------------------------------------------------
# Pet name extraction
# ---------------------------------------------------------------------------


def _find_pet_name(text: str) -> str | None:
    """Find a pet name in text. Returns canonical name or None.

    Strategy:
    1. Check for known pet names (case-insensitive)
    2. Check for name in parentheses after 'pet' keyword (e.g., 'new pet (Echo)')
    3. Do NOT return names that aren't known pets or near pet keywords
    """
    text_lower = text.lower()

    # Check for known pet names
    for lower_name, canonical in _KNOWN_PETS.items():
        if lower_name in text_lower:
            return canonical

    # Check for name in parentheses (common pattern: "Create new pet (Name)")
    paren_match = _PET_NAME_IN_PARENS.search(text)
    if paren_match:
        name = paren_match.group(1)
        # Only accept if near a pet keyword
        if _PET_CONTEXT_RE.search(text):
            return name

    return None


# ---------------------------------------------------------------------------
# Event type detection
# ---------------------------------------------------------------------------


def _detect_event_type(text: str) -> str | None:
    """Determine event type from text content. Returns event_type or None."""
    # Check in priority order: death > acquired > care
    if _DEATH_KEYWORDS.search(text):
        return "death"
    if _ACQUIRED_KEYWORDS.search(text):
        return "acquired"
    if _CARE_KEYWORDS.search(text):
        return "care"
    return None


# ---------------------------------------------------------------------------
# Scanning daily notes
# ---------------------------------------------------------------------------


def scan_daily_notes_for_pet_events(notes_dir: Path) -> list[dict]:
    """Scan daily note files for pet-related content.

    For each .md file in notes_dir, look for pet-related keywords and extract
    structured events.

    Returns list of event dicts with: pet_name, event_type, event_date, notes.
    """
    notes_dir = Path(notes_dir)
    if not notes_dir.is_dir():
        return []

    events: list[dict] = []

    for filepath in sorted(notes_dir.iterdir()):
        if not filepath.is_file() or filepath.suffix != ".md":
            continue

        event_date = _extract_date_from_filename(filepath.name)
        if event_date is None:
            continue

        try:
            content = filepath.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue

        if not content.strip():
            continue

        # Sanitize: strip null bytes
        content = _sanitize_string(content)

        # Process the file looking for pet events.
        # We examine each line (and some multi-line context) for pet mentions.
        lines = content.splitlines()

        # Track events we've already found in this file to avoid near-duplicates
        seen_in_file: set[tuple[str, str]] = set()

        for i, line in enumerate(lines):
            # Only process lines that mention pet-related context
            if not _PET_CONTEXT_RE.search(line):
                continue

            pet_name = _find_pet_name(line)
            if pet_name is None:
                continue

            event_type = _detect_event_type(line)
            if event_type is None:
                continue

            key = (pet_name, event_type)
            if key in seen_in_file:
                continue
            seen_in_file.add(key)

            events.append(
                {
                    "pet_name": pet_name,
                    "event_type": event_type,
                    "event_date": event_date,
                    "notes": line.strip(),
                }
            )

    return events


# ---------------------------------------------------------------------------
# Database storage
# ---------------------------------------------------------------------------


def store_pet_event(conn: psycopg.Connection, event: dict) -> None:
    """Insert a pet event into pet_events table.

    Idempotent: uses (pet_name, event_type, event_date) as dedup key.
    If the same event already exists, it is skipped.
    """
    pet_name = _sanitize_string(event["pet_name"])
    event_type = event["event_type"]
    event_date = event.get("event_date")
    notes = _sanitize_string(event.get("notes", "")) if event.get("notes") else None
    session_id = event.get("session_id")

    # Convert event_date to a timestamp for the event_timestamp column
    event_timestamp = None
    if event_date is not None:
        event_timestamp = datetime.datetime.combine(
            event_date, datetime.time(), tzinfo=datetime.timezone.utc
        )

    # Use a CTE-based approach to check for existing matching event
    # and only insert if not already present (idempotent)
    conn.execute(
        """
        INSERT INTO pet_events (pet_name, event_type, event_timestamp, session_id, notes)
        SELECT %s, %s, %s, %s, %s
        WHERE NOT EXISTS (
            SELECT 1 FROM pet_events
            WHERE pet_name = %s AND event_type = %s
            AND event_timestamp = %s
        )
        """,
        (
            pet_name,
            event_type,
            event_timestamp,
            session_id,
            notes,
            pet_name,
            event_type,
            event_timestamp,
        ),
    )
    conn.commit()


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


def extract_all_pets(notes_dir: Path, conn: psycopg.Connection) -> int:
    """Scan daily notes for pet events and store them.

    Returns the count of events stored (not counting duplicates on re-run).
    """
    notes_dir = Path(notes_dir)
    if not notes_dir.is_dir():
        return 0

    events = scan_daily_notes_for_pet_events(notes_dir)
    count = 0

    for event in events:
        # Check if this event already exists before counting
        pet_name = _sanitize_string(event["pet_name"])
        event_type = event["event_type"]
        event_date = event.get("event_date")
        event_timestamp = None
        if event_date is not None:
            event_timestamp = datetime.datetime.combine(
                event_date, datetime.time(), tzinfo=datetime.timezone.utc
            )

        existing = conn.execute(
            """
            SELECT 1 FROM pet_events
            WHERE pet_name = %s AND event_type = %s AND event_timestamp = %s
            """,
            (pet_name, event_type, event_timestamp),
        ).fetchone()

        store_pet_event(conn, event)

        if existing is None:
            count += 1

    return count
