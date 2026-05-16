"""Extract and store MEMORY.md snapshots and track block-level changes over time."""

from __future__ import annotations

import datetime
import hashlib
import json
import re
from pathlib import Path

import psycopg

from scripts.extract_sessions import _sanitize_string


# ---------------------------------------------------------------------------
# Block splitting
# ---------------------------------------------------------------------------

# Regex to detect the start of a fenced code block (backtick or tilde)
_FENCE_OPEN_RE = re.compile(r"^(`{3,}|~{3,})")


def _strip_nulls(s: str) -> str:
    """Remove null bytes from a string."""
    if not isinstance(s, str):
        return s
    return s.replace("\x00", "")


def split_into_blocks(content: str) -> list[dict]:
    """Split MEMORY.md content on ``## `` headers.

    Returns a list of dicts with keys: heading, content, hash.
    The h1 preamble (``# ...``) is excluded. ``## `` inside fenced code
    blocks is not treated as a header.  ``### `` subsections stay within
    their parent ``## `` block.
    """
    if not content:
        return []

    # Normalize: strip null bytes, handle Windows line endings
    content = _strip_nulls(content)
    content = content.replace("\r\n", "\n").replace("\r", "\n")

    lines = content.split("\n")

    # Walk lines, tracking fenced code blocks and ## headers
    headers: list[tuple[int, str]] = []  # (line_index, heading_text)
    in_fence = False
    fence_marker = ""

    for i, line in enumerate(lines):
        stripped = line.strip()

        if in_fence:
            # Check for closing fence
            close_m = _FENCE_OPEN_RE.match(stripped)
            if (
                close_m
                and close_m.group(1)[0] == fence_marker[0]
                and len(close_m.group(1)) >= len(fence_marker)
                and len(stripped.replace(close_m.group(1)[0], "")) == 0
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

        # Detect ## header (but NOT ### or #)
        # Only match ## at the start of the line (column 0), not indented.
        if line.startswith("## ") and not line.startswith("### "):
            heading_text = line[3:].strip()
            heading_text = _strip_nulls(heading_text)
            headers.append((i, heading_text))
        elif stripped == "##" and line == line.lstrip():
            # Bare ## with no text, only at column 0
            headers.append((i, ""))

    # If no ## headers found, return empty
    if not headers:
        return []

    blocks: list[dict] = []
    for idx, (line_idx, heading) in enumerate(headers):
        # Content range: from line after header to line before next header (or EOF)
        content_start = line_idx + 1
        if idx + 1 < len(headers):
            content_end = headers[idx + 1][0]
        else:
            content_end = len(lines)

        block_content = "\n".join(lines[content_start:content_end]).strip()
        block_content = _strip_nulls(block_content)

        block_hash = compute_block_hash(heading, block_content)
        blocks.append(
            {
                "heading": heading,
                "content": block_content,
                "hash": block_hash,
            }
        )

    return blocks


# ---------------------------------------------------------------------------
# Block hashing
# ---------------------------------------------------------------------------


def compute_block_hash(heading: str, content: str) -> str:
    """Compute a deterministic SHA-256 hash from heading and content.

    Strips trailing whitespace from content before hashing so that
    trailing-space differences don't produce different hashes.
    """
    heading = _strip_nulls(heading) if heading else ""
    content = _strip_nulls(content) if content else ""
    content = content.rstrip()

    payload = f"{heading}\n{content}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Snapshot creation
# ---------------------------------------------------------------------------


def extract_snapshot_from_content(
    content: str,
    session_id: str,
    date: datetime.date,
) -> dict:
    """Create a snapshot dict from full MEMORY.md content."""
    content = _strip_nulls(content) if content else ""

    blocks = split_into_blocks(content)
    token_count = len(content) // 4

    return {
        "session_id": session_id,
        "date": date,
        "full_content": content,
        "token_count": token_count,
        "blocks": blocks,
    }


# ---------------------------------------------------------------------------
# Database storage
# ---------------------------------------------------------------------------


def store_snapshot(conn: psycopg.Connection, snapshot: dict) -> None:
    """Insert a memory snapshot and its blocks into the database.

    Idempotent: skips if a snapshot for this session_id already exists.
    Uses ``INSERT ... ON CONFLICT`` for blocks so that existing blocks
    get their ``last_seen_session`` updated.  Everything is wrapped in
    a single transaction for atomicity.
    """
    session_id = _sanitize_string(snapshot["session_id"])
    date = snapshot["date"]
    full_content = _sanitize_string(snapshot.get("full_content") or "")
    token_count = snapshot.get("token_count", 0)
    blocks = snapshot.get("blocks", [])

    with conn.transaction():
        # Check for existing snapshot for this session
        existing = conn.execute(
            "SELECT id FROM memory_snapshots WHERE session_id = %s",
            (session_id,),
        ).fetchone()
        if existing:
            return  # Already stored — idempotent skip

        # Insert snapshot row
        row = conn.execute(
            """
            INSERT INTO memory_snapshots (session_id, date, full_content, token_count)
            VALUES (%s, %s, %s, %s)
            RETURNING id
            """,
            (session_id, date, full_content, token_count),
        ).fetchone()
        snapshot_id = row[0]

        # Insert / update each block and create presence records
        for block in blocks:
            block_hash = block["hash"]
            heading = _sanitize_string(block["heading"])
            block_content = _sanitize_string(block["content"])

            # Upsert: insert new block or update last_seen_session
            block_row = conn.execute(
                """
                INSERT INTO memory_blocks (
                    block_hash, heading, content,
                    first_seen_session, last_seen_session
                )
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (block_hash) DO UPDATE SET
                    last_seen_session = EXCLUDED.last_seen_session
                RETURNING id
                """,
                (block_hash, heading, block_content, session_id, session_id),
            ).fetchone()
            block_id = block_row[0]

            # Create presence join record
            conn.execute(
                """
                INSERT INTO memory_block_presence (snapshot_id, block_id)
                VALUES (%s, %s)
                ON CONFLICT DO NOTHING
                """,
                (snapshot_id, block_id),
            )


# ---------------------------------------------------------------------------
# Activity-log scanning for memory sessions
# ---------------------------------------------------------------------------


def find_memory_sessions(activity_dir: Path) -> list[dict]:
    """Scan activity-log JSONL files for sessions that accessed memory files.

    A session accessed memory if it has tool events where ``t`` is
    Read, Write, or Edit and ``i`` contains ``memory/`` or ``MEMORY``.

    Returns list of dicts: ``{session_id, date, paths}``.
    """
    activity_dir = Path(activity_dir)
    if not activity_dir.is_dir():
        return []

    # session_id -> {date, paths set}
    sessions: dict[str, dict] = {}
    session_order: list[str] = []

    for jsonl_file in sorted(activity_dir.glob("activity-*.jsonl")):
        # Extract date from filename
        date_match = re.search(r"activity-(\d{4}-\d{2}-\d{2})\.jsonl", jsonl_file.name)
        if not date_match:
            continue
        log_date = datetime.date.fromisoformat(date_match.group(1))

        try:
            text = jsonl_file.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue

        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except (json.JSONDecodeError, ValueError):
                continue
            if not isinstance(obj, dict):
                continue

            # Only care about tool events
            if obj.get("event") != "tool":
                continue

            tool_type = obj.get("t", "")
            if tool_type not in ("Read", "Write", "Edit"):
                continue

            tool_input = obj.get("i", "")
            if not isinstance(tool_input, str):
                continue

            # Check if the path references memory files
            if "memory/" not in tool_input and "MEMORY" not in tool_input:
                continue

            sid = obj.get("s", "")
            if not sid:
                continue

            if sid not in sessions:
                sessions[sid] = {"session_id": sid, "date": log_date, "paths": []}
                session_order.append(sid)

            if tool_input not in sessions[sid]["paths"]:
                sessions[sid]["paths"].append(tool_input)

    return [sessions[sid] for sid in session_order]


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


_SESSION_ID_RE = re.compile(r"^[a-zA-Z0-9_-]+$")


def extract_all_memory(
    activity_dir: Path,
    conn: psycopg.Connection,
    content_dir: Path | None = None,
) -> int:
    """Orchestrate memory extraction: find sessions, create and store snapshots.

    Returns the count of snapshots stored.
    """
    activity_dir = Path(activity_dir)
    if not activity_dir.is_dir():
        return 0

    memory_sessions = find_memory_sessions(activity_dir)
    if not memory_sessions:
        return 0

    count = 0

    for ms in memory_sessions:
        session_id = ms["session_id"]
        date = ms["date"]

        # Guard against path traversal via malicious session_id values
        if not _SESSION_ID_RE.fullmatch(session_id):
            continue

        # Try to locate MEMORY.md content
        content = None

        # Strategy 1: Look in content_dir for files named by session_id or date
        if content_dir is not None:
            content_dir_path = Path(content_dir)
            if content_dir_path.is_dir():
                # Try session_id-based filenames
                candidates = [
                    content_dir_path / f"{session_id}.md",
                    content_dir_path / f"{session_id}",
                    content_dir_path / session_id / "MEMORY.md",
                    # Date-based filenames
                    content_dir_path / f"{date}.md",
                    content_dir_path / f"{date}",
                    content_dir_path / str(date) / "MEMORY.md",
                ]
                for candidate in candidates:
                    if candidate.is_file():
                        try:
                            content = candidate.read_text(encoding="utf-8")
                        except (OSError, UnicodeDecodeError):
                            continue
                        break

        # If no content found, skip this session
        if content is None:
            continue

        snapshot = extract_snapshot_from_content(content, session_id, date)
        try:
            store_snapshot(conn, snapshot)
            count += 1
        except psycopg.errors.ForeignKeyViolation:
            # Session FK doesn't exist — skip
            conn.rollback()
            continue

    return count
