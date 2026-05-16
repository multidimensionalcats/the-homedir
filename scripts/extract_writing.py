"""Extract composition metadata and content from writing directory files."""

from __future__ import annotations

import datetime
import re
from pathlib import Path

import psycopg

from scripts.extract_sessions import _sanitize_string, _strip_null_bytes, detect_version


# ---------------------------------------------------------------------------
# Size limits
# ---------------------------------------------------------------------------
_MAX_CONTENT_LEN = 500_000  # 500KB max content


# ---------------------------------------------------------------------------
# Title extraction
# ---------------------------------------------------------------------------


def extract_title(content: str) -> str | None:
    """Extract title from first `# ` line. Return None if no title found.

    Only h1 headings count (single # followed by a space).
    """
    if not content:
        return None

    for line in content.splitlines():
        stripped = line.strip()
        # Must start with exactly "# " (one hash, one space)
        if stripped.startswith("# ") and not stripped.startswith("## "):
            title = stripped[2:].strip()
            if title:
                return title
    return None


# ---------------------------------------------------------------------------
# Date extraction
# ---------------------------------------------------------------------------

# Patterns to match date metadata in composition files
_DATE_PATTERNS = [
    re.compile(r"\*?Draft begun:\s*(\d{4}-\d{2}-\d{2})\*?"),
    re.compile(r"\*?Written:\s*(\d{4}-\d{2}-\d{2})\*?"),
]


def extract_date_from_content(content: str) -> datetime.date | None:
    """Look for date patterns in the first 10 lines. Return None if not found."""
    if not content:
        return None

    lines = content.splitlines()[:10]
    text_window = "\n".join(lines)

    for pattern in _DATE_PATTERNS:
        match = pattern.search(text_window)
        if match:
            try:
                return datetime.date.fromisoformat(match.group(1))
            except ValueError:
                # Invalid date (e.g., month 13) -- skip this match
                continue

    return None


# ---------------------------------------------------------------------------
# Single-file extraction
# ---------------------------------------------------------------------------


def extract_composition(filepath: Path) -> dict:
    """Read a single composition file and return metadata dict.

    Returns dict with: slug, filename, title, date_written, size_bytes, content.
    Does NOT determine version or session_id (those come from DB cross-reference).
    """
    filepath = Path(filepath)
    slug = filepath.stem  # e.g., "version-number.md" -> "version-number"
    filename = filepath.name

    try:
        content = filepath.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        # Binary file or encoding issue -- read with error handling
        try:
            content = filepath.read_text(encoding="utf-8", errors="replace")
        except (OSError, ValueError):
            content = None
    except OSError:
        content = None

    if content is not None:
        content = _strip_null_bytes(content)
        if len(content) > _MAX_CONTENT_LEN:
            content = content[:_MAX_CONTENT_LEN]

    title = extract_title(content) if content else None
    date_written = extract_date_from_content(content) if content else None
    size_bytes = len(content.encode("utf-8")) if content else 0

    return {
        "slug": slug,
        "filename": filename,
        "title": title,
        "date_written": date_written,
        "size_bytes": size_bytes,
        "content": content if content is not None else "",
    }


# ---------------------------------------------------------------------------
# Database storage
# ---------------------------------------------------------------------------


def store_composition(conn: psycopg.Connection, composition: dict) -> None:
    """Insert into compositions table. Idempotent via ON CONFLICT DO UPDATE."""
    slug = _sanitize_string(composition["slug"])
    filename = _sanitize_string(composition["filename"])
    title = _sanitize_string(composition.get("title")) if composition.get("title") else None
    content = _sanitize_string(composition.get("content")) if composition.get("content") else None
    session_id = composition.get("session_id")
    version = composition.get("version")
    topic = composition.get("topic")

    if content and len(content) > _MAX_CONTENT_LEN:
        content = content[:_MAX_CONTENT_LEN]

    conn.execute(
        """
        INSERT INTO compositions (
            slug, filename, title, date_written, session_id,
            version, size_bytes, content, topic
        ) VALUES (
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s
        )
        ON CONFLICT (slug) DO UPDATE SET
            filename = EXCLUDED.filename,
            title = EXCLUDED.title,
            date_written = EXCLUDED.date_written,
            session_id = EXCLUDED.session_id,
            version = EXCLUDED.version,
            size_bytes = EXCLUDED.size_bytes,
            content = EXCLUDED.content,
            topic = EXCLUDED.topic
        """,
        (
            slug,
            filename,
            title,
            composition.get("date_written"),
            session_id,
            version,
            composition.get("size_bytes", 0),
            content,
            topic,
        ),
    )
    conn.commit()


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


def extract_all_writing(
    writing_dir: Path,
    conn: psycopg.Connection,
    include_drafts: bool = False,
) -> int:
    """Process all .md files in writing_dir (and optionally drafts/).

    For each composition:
    1. Extract composition metadata
    2. Determine version from date_written using detect_version
    3. Try to find the producing session_id by querying sessions table
    4. Store in DB

    Return count of compositions processed.
    """
    writing_dir = Path(writing_dir)
    count = 0

    # Collect .md files from the main directory
    md_files: list[Path] = []
    if writing_dir.is_dir():
        for f in sorted(writing_dir.iterdir()):
            if f.is_file() and f.suffix == ".md":
                md_files.append(f)

    # Optionally include drafts/ subdirectory
    if include_drafts:
        drafts_dir = writing_dir / "drafts"
        if drafts_dir.is_dir():
            for f in sorted(drafts_dir.iterdir()):
                if f.is_file() and f.suffix == ".md":
                    md_files.append(f)

    for filepath in md_files:
        try:
            composition = extract_composition(filepath)
        except (OSError, PermissionError):
            # Skip unreadable files
            continue

        # Determine version from date_written
        if composition.get("date_written"):
            composition["version"] = detect_version(composition["date_written"])
        else:
            composition["version"] = None

        # Try to find producing session_id
        composition["session_id"] = _find_session_id(conn, composition.get("date_written"))

        store_composition(conn, composition)
        count += 1

    return count


def _find_session_id(conn: psycopg.Connection, date_written: datetime.date | None) -> str | None:
    """Find a session on the given date where wrote_composition=True."""
    if date_written is None:
        return None

    row = conn.execute(
        """
        SELECT id FROM sessions
        WHERE date = %s AND wrote_composition = TRUE
        ORDER BY timestamp_start ASC NULLS LAST
        LIMIT 1
        """,
        (date_written,),
    ).fetchone()

    return row[0] if row else None
