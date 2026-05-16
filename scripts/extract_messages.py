"""Extract and store messages from messages_from_james.md and messages_to_james.md."""

from __future__ import annotations

import datetime
import hashlib
import re
from pathlib import Path

import psycopg

from scripts.extract_sessions import _sanitize_string


# ---------------------------------------------------------------------------
# Date parsing
# ---------------------------------------------------------------------------

# General regex: find YYYY-MM-DD anywhere in the header text.
# Handles zero-padded and non-zero-padded months/days.
_DATE_RE = re.compile(r"(\d{4})-(\d{1,2})-(\d{1,2})")

# Typo recovery: YYYY-MM-DDhh:mm (missing T separator, day runs into hour)
# e.g., "2026-01-2309:58" -> we want 2026-01-23
_TYPO_RE = re.compile(r"(\d{4})-(\d{2})(\d{2})\d{2}:\d{2}")


def _parse_date_from_header(header_text: str) -> datetime.date | None:
    """Extract a date from a ## header line's text content.

    Flexible: tries general YYYY-MM-DD first, then typo recovery.
    Returns None if no valid date can be extracted.
    """
    if not header_text or not header_text.strip():
        return None

    # Try standard YYYY-MM-DD extraction first
    m = _DATE_RE.search(header_text)
    if m:
        try:
            return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            pass  # Invalid date components (e.g., month 99)

    # Typo recovery: YYYY-MMDDhh:mm (missing T, day glued to time)
    m = _TYPO_RE.search(header_text)
    if m:
        try:
            year = int(m.group(1))
            month = int(m.group(2))
            day = int(m.group(3))
            return datetime.date(year, month, day)
        except ValueError:
            pass

    return None


# ---------------------------------------------------------------------------
# Message parsing
# ---------------------------------------------------------------------------

# Regex to detect the start of a fenced code block (backtick or tilde)
_FENCE_OPEN_RE = re.compile(r"^(`{3,}|~{3,})")


def _is_substantive_preamble(text: str) -> bool:
    """Return True if the preamble text has substantive content beyond just a title."""
    lines = text.strip().splitlines()
    # Filter out blank lines and lines that are just h1 titles
    substantive = [line for line in lines if line.strip() and not line.strip().startswith("# ")]
    return len(substantive) > 0


def parse_messages(filepath: Path, direction: str) -> list[dict]:
    """Parse a markdown message file. Split on ``## `` headers.

    Returns a list of dicts with keys:
        direction, date, content, line_start, line_end
    """
    filepath = Path(filepath)
    try:
        text = filepath.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return []

    if not text.strip():
        return []

    lines = text.splitlines()
    # Find all ## header positions, respecting fenced code blocks
    headers: list[tuple[int, str]] = []  # (0-indexed line number, header text after "## ")
    in_fence = False
    fence_marker = ""

    for i, line in enumerate(lines):
        stripped = line.strip() if line else ""

        if in_fence:
            # Check for closing fence: must match or exceed opening fence length
            close_m = _FENCE_OPEN_RE.match(stripped)
            if (
                close_m
                and close_m.group(1)[0] == fence_marker[0]
                and len(close_m.group(1)) >= len(fence_marker)
            ):
                in_fence = False
                fence_marker = ""
            continue

        # Check for opening fence
        fence_m = _FENCE_OPEN_RE.match(stripped)
        if fence_m:
            in_fence = True
            fence_marker = fence_m.group(1)
            continue

        # Check for ## header (must start at beginning of line, ignoring leading whitespace)
        if stripped.startswith("## ") or stripped == "##":
            header_text = stripped[3:] if stripped.startswith("## ") else ""
            headers.append((i, header_text))

    messages: list[dict] = []

    # Handle preamble (text before first header)
    if headers:
        first_header_line = headers[0][0]
        if first_header_line > 0:
            preamble_lines = lines[:first_header_line]
            preamble_text = "\n".join(preamble_lines).strip()
            if _is_substantive_preamble(preamble_text):
                # Find last non-blank line in preamble
                last_content = 0
                for j in range(first_header_line - 1, -1, -1):
                    if lines[j].strip():
                        last_content = j
                        break
                messages.append(
                    {
                        "direction": direction,
                        "date": None,
                        "content": preamble_text,
                        "line_start": 1,
                        "line_end": last_content + 1,  # 1-indexed
                    }
                )
    else:
        # No headers at all -- entire file is preamble
        preamble_text = "\n".join(lines).strip()
        if _is_substantive_preamble(preamble_text):
            # Find last non-blank line
            last_content = 0
            for j in range(len(lines) - 1, -1, -1):
                if lines[j].strip():
                    last_content = j
                    break
            messages.append(
                {
                    "direction": direction,
                    "date": None,
                    "content": preamble_text,
                    "line_start": 1,
                    "line_end": last_content + 1,
                }
            )
        return messages

    # Process each header section
    for idx, (line_idx, header_text) in enumerate(headers):
        date = _parse_date_from_header(header_text)

        # Determine content range: from line after header to line before next header (or EOF)
        content_start = line_idx + 1
        if idx + 1 < len(headers):
            content_end = headers[idx + 1][0]  # exclusive
        else:
            content_end = len(lines)

        content_lines = lines[content_start:content_end]
        content = "\n".join(content_lines).strip()

        # Find line_end: last non-blank line in the section, or the header line itself
        line_end = line_idx  # default to header line
        for j in range(content_end - 1, line_idx, -1):
            if lines[j].strip():
                line_end = j
                break

        messages.append(
            {
                "direction": direction,
                "date": date,
                "content": content,
                "line_start": line_idx + 1,  # 1-indexed
                "line_end": line_end + 1,  # 1-indexed
            }
        )

    return messages


# ---------------------------------------------------------------------------
# Database storage
# ---------------------------------------------------------------------------


def _content_hash(content: str) -> str:
    """Return a short hash of content for dedup purposes."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]


def store_message(conn: psycopg.Connection, message: dict) -> None:
    """Insert a message into the messages table. Dedup by (direction, line_start, content hash).

    Uses delete-then-insert for the direction to achieve idempotency across re-runs.
    For individual calls, uses ON CONFLICT-like logic via a check before insert.
    """
    content = message["content"]
    if isinstance(content, str):
        content = _sanitize_string(content)

    direction = message["direction"]
    date = message.get("date")
    line_start = message.get("line_start")
    line_end = message.get("line_end")

    # Check for existing identical message (dedup)
    existing = conn.execute(
        "SELECT id FROM messages WHERE direction = %s AND line_start = %s",
        (direction, line_start),
    ).fetchone()

    if existing:
        return  # Already stored

    conn.execute(
        """
        INSERT INTO messages (direction, date, content, line_start, line_end)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (direction, date, content, line_start, line_end),
    )
    conn.commit()


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


def extract_all_messages(messages_dir: Path, conn: psycopg.Connection) -> int:
    """Parse messages_from_james.md and messages_to_james.md, store all messages.

    Idempotent: deletes existing messages for a direction before re-inserting.
    Returns total count of messages stored.
    """
    messages_dir = Path(messages_dir)
    total = 0

    file_map = {
        "messages_from_james.md": "from_james",
        "messages_to_james.md": "to_james",
    }

    for filename, direction in file_map.items():
        filepath = messages_dir / filename
        if not filepath.exists():
            continue

        messages = parse_messages(filepath, direction)

        # Delete existing messages for this direction for idempotency
        conn.execute(
            "DELETE FROM messages WHERE direction = %s",
            (direction,),
        )
        conn.commit()

        for msg in messages:
            store_message(conn, msg)
            total += 1

    return total
