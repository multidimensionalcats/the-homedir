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


# ---------------------------------------------------------------------------
# JSONL transcript scanning
# ---------------------------------------------------------------------------

_LINE_NUMBER_RE = re.compile(r"^\d+\t")


def extract_memory_from_jsonl(
    jsonl_dir: Path | str,
    conn: psycopg.Connection,
    current_memory_path: Path | str | None = None,
) -> int:
    """Extract MEMORY.md snapshots from JSONL transcript files.

    Scans ``.jsonl`` files for Read tool events targeting MEMORY.md,
    extracts the content from matching tool_result blocks, and stores
    deduplicated snapshots in the database.

    Returns the count of snapshots stored.
    """
    jsonl_dir = Path(jsonl_dir)
    if not jsonl_dir.is_dir():
        return 0

    seen_hashes: set[str] = set()
    count = 0

    for jsonl_file in sorted(jsonl_dir.glob("*.jsonl")):
        try:
            text = jsonl_file.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue

        raw_lines = text.splitlines()
        if not raw_lines:
            continue

        # Step 1a: Parse first line to extract the date
        first_line = raw_lines[0].strip()
        if not first_line:
            continue
        try:
            first_obj = json.loads(first_line)
        except (json.JSONDecodeError, ValueError):
            continue
        if not isinstance(first_obj, dict):
            continue

        timestamp_str = first_obj.get("timestamp", "")
        if not timestamp_str:
            continue
        try:
            file_date = datetime.date.fromisoformat(timestamp_str[:10])
        except (ValueError, TypeError):
            continue

        # Step 1b-d: Scan for Read events targeting MEMORY.md and matching tool_results
        # Parse all lines into objects once
        parsed_lines: list[dict | None] = []
        for raw_line in raw_lines:
            raw_line = raw_line.strip()
            if not raw_line:
                parsed_lines.append(None)
                continue
            try:
                parsed_lines.append(json.loads(raw_line))
            except (json.JSONDecodeError, ValueError):
                parsed_lines.append(None)

        # Find all Read tool_use events for MEMORY.md
        # Collect (line_index, tool_use_id) pairs
        read_events: list[tuple[int, str]] = []
        for i, obj in enumerate(parsed_lines):
            if obj is None or not isinstance(obj, dict):
                continue
            if obj.get("type") != "assistant":
                continue
            message = obj.get("message")
            if not isinstance(message, dict):
                continue
            content_list = message.get("content")
            if not isinstance(content_list, list):
                continue
            for block in content_list:
                if not isinstance(block, dict):
                    continue
                if block.get("type") != "tool_use":
                    continue
                if block.get("name") != "Read":
                    continue
                tool_input = block.get("input")
                if not isinstance(tool_input, dict):
                    continue
                file_path = tool_input.get("file_path", "")
                if not isinstance(file_path, str):
                    continue
                if not file_path.endswith("MEMORY.md"):
                    continue
                tool_use_id = block.get("id", "")
                if tool_use_id:
                    read_events.append((i, tool_use_id))

        if not read_events:
            continue

        # For each Read event, find the matching tool_result in subsequent lines
        # Keep the LAST one that has a valid tool_result
        last_content: str | None = None
        for line_idx, tool_use_id in read_events:
            # Search subsequent lines for matching tool_result
            for j in range(line_idx + 1, len(parsed_lines)):
                obj = parsed_lines[j]
                if obj is None or not isinstance(obj, dict):
                    continue
                if obj.get("type") != "user":
                    continue
                message = obj.get("message")
                if not isinstance(message, dict):
                    continue
                content_list = message.get("content")
                if not isinstance(content_list, list):
                    continue
                found = False
                for block in content_list:
                    if not isinstance(block, dict):
                        continue
                    if block.get("type") != "tool_result":
                        continue
                    if block.get("tool_use_id") != tool_use_id:
                        continue
                    raw_content = block.get("content", "")
                    if not isinstance(raw_content, str):
                        continue
                    # Strip line number prefixes
                    stripped_lines = []
                    for cline in raw_content.split("\n"):
                        stripped_lines.append(_LINE_NUMBER_RE.sub("", cline))
                    last_content = "\n".join(stripped_lines)
                    found = True
                    break
                if found:
                    break

        if last_content is None:
            continue

        # Step 1f: Find a matching session by date
        row = conn.execute(
            "SELECT id FROM sessions WHERE date = %s LIMIT 1",
            (file_date,),
        ).fetchone()
        if row is None:
            continue
        session_id = row[0]

        # Step 1h: Dedup by content hash
        content_hash = hashlib.sha256(last_content.encode("utf-8")).hexdigest()
        if content_hash in seen_hashes:
            continue
        seen_hashes.add(content_hash)

        # Step 1i: Create and store snapshot
        snapshot = extract_snapshot_from_content(last_content, session_id, file_date)
        try:
            store_snapshot(conn, snapshot)
            count += 1
        except psycopg.errors.ForeignKeyViolation:
            conn.rollback()
            continue

    # Step 2: Handle current_memory_path
    if current_memory_path is not None:
        current_memory_path = Path(current_memory_path)
        if current_memory_path.is_file():
            try:
                current_content = current_memory_path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                return count

            # Find the most recent session
            row = conn.execute(
                "SELECT id, date FROM sessions ORDER BY date DESC, id DESC LIMIT 1"
            ).fetchone()
            if row is not None:
                recent_session_id = row[0]
                recent_date = row[1]

                content_hash = hashlib.sha256(current_content.encode("utf-8")).hexdigest()
                if content_hash not in seen_hashes:
                    seen_hashes.add(content_hash)
                    snapshot = extract_snapshot_from_content(
                        current_content, recent_session_id, recent_date
                    )
                    try:
                        store_snapshot(conn, snapshot)
                        count += 1
                    except psycopg.errors.ForeignKeyViolation:
                        conn.rollback()

    return count
