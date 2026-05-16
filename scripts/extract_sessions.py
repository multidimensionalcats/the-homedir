"""Extract and classify Claude session data from activity logs and session logs."""

from __future__ import annotations

import datetime
import hashlib
import json
import re
from pathlib import Path

import psycopg


# ---------------------------------------------------------------------------
# Version boundaries (inclusive start dates)
# ---------------------------------------------------------------------------
_VERSION_BOUNDARIES = [
    (datetime.date(2026, 4, 18), "4.7"),
    (datetime.date(2026, 2, 13), "4.6"),
]


def detect_version(date: datetime.date | str) -> str:
    """Return the model version active on the given date."""
    if isinstance(date, str):
        date = datetime.date.fromisoformat(date)
    for boundary, version in _VERSION_BOUNDARIES:
        if date >= boundary:
            return version
    return "4.5"


# ---------------------------------------------------------------------------
# File-operation classification
# ---------------------------------------------------------------------------
_CATEGORY_RULES: list[tuple[str, str]] = [
    ("messages_from_james", "msgs_from_james"),
    ("messages_to_james", "msgs_to_james"),
    ("private/", "private_journal"),
    ("writing/", "writing"),
    ("notes/daily/", "daily_notes"),
    ("notes/predictions/", "predictions"),
    ("prediction", "predictions"),
    ("thoughts", "thoughts"),
    ("memory/", "memory_files"),
    ("MEMORY", "memory_files"),
    ("learning/", "learning"),
    ("experiments/", "experiments"),
    ("tamagotchi/", "tamagotchi"),
    ("conversations/", "conversations"),
]


def _categorize_path(path: str) -> str:
    """Return the category for a given file path."""
    # Check for scripts (~/bin/ or /home/claude/bin/)
    if path.startswith("~/bin/") or path.startswith("/home/claude/bin/"):
        return "scripts"
    for pattern, category in _CATEGORY_RULES:
        if pattern in path:
            return category
    return "other"


def classify_file_operation(
    tool_type: str, tool_input: str | None
) -> tuple[str, str, str] | None:
    """Classify a tool event into (path, category, direction) or None."""
    if not tool_input:
        return None

    if tool_type == "Read":
        cat = _categorize_path(tool_input)
        return (tool_input, cat, "read")

    if tool_type == "Write":
        cat = _categorize_path(tool_input)
        return (tool_input, cat, "write")

    if tool_type == "Edit":
        cat = _categorize_path(tool_input)
        return (tool_input, cat, "write")

    if tool_type == "Bash":
        return _classify_bash(tool_input)

    # WebSearch, WebFetch, ToolSearch, and anything else → not a file operation
    return None


def _classify_bash(command: str) -> tuple[str, str, str] | None:
    """Heuristic classification of Bash commands as file operations."""
    # Detect reads via cat/head/tail
    read_match = re.search(
        r"\b(?:cat|head|tail)\s+([^\s|;&>]+)", command
    )
    if read_match:
        path = read_match.group(1)
        # Only classify paths that look like they're under /home/claude or ~/
        if path.startswith("/home/claude") or path.startswith("~/"):
            cat = _categorize_path(path)
            return (path, cat, "read")

    # Detect writes via > or >>
    write_match = re.search(r">>?\s*([^\s;&|]+)", command)
    if write_match:
        path = write_match.group(1)
        if path.startswith("/home/claude") or path.startswith("~/"):
            cat = _categorize_path(path)
            return (path, cat, "write")

    return None


# ---------------------------------------------------------------------------
# Output flags
# ---------------------------------------------------------------------------

def compute_output_flags(file_operations: list[dict]) -> dict:
    """Compute boolean output flags from a list of file operation dicts."""
    flags = {
        "wrote_composition": False,
        "wrote_private_journal": False,
        "updated_memory": False,
        "messaged_james": False,
        "wrote_prediction": False,
    }
    for op in file_operations:
        if op.get("direction") != "write":
            continue
        cat = op.get("category")
        if cat == "writing":
            flags["wrote_composition"] = True
        elif cat == "private_journal":
            flags["wrote_private_journal"] = True
        elif cat == "memory_files":
            flags["updated_memory"] = True
        elif cat == "msgs_to_james":
            flags["messaged_james"] = True
        elif cat == "predictions":
            flags["wrote_prediction"] = True
    return flags


# ---------------------------------------------------------------------------
# Activity-log parsing (JSONL)
# ---------------------------------------------------------------------------

def parse_activity_log(filepath: str | Path) -> list[dict]:
    """Parse a JSONL activity log and return a list of session dicts."""
    filepath = Path(filepath)

    # Extract date from filename: activity-YYYY-MM-DD.jsonl
    date_match = re.search(r"activity-(\d{4}-\d{2}-\d{2})\.jsonl", filepath.name)
    if not date_match:
        return []
    log_date = datetime.date.fromisoformat(date_match.group(1))

    # Read and parse all lines
    try:
        text = filepath.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return []

    if not text.strip():
        return []

    # Parse events
    events: list[dict] = []
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
        if "event" not in obj:
            continue
        if obj["event"] not in ("session_start", "tool", "session_end", "response_complete"):
            continue
        events.append(obj)

    # Group events by session ID
    known_sessions: set[str] = set()
    session_events: dict[str, list[dict]] = {}
    session_order: list[str] = []

    # First pass: find all session_start events to register known sessions
    for ev in events:
        sid = ev.get("s")
        if not sid:
            continue
        if ev["event"] == "session_start":
            known_sessions.add(sid)
            if sid not in session_events:
                session_events[sid] = []
                session_order.append(sid)
            session_events[sid].append(ev)

    # Second pass: add remaining events to known sessions
    for ev in events:
        sid = ev.get("s")
        if not sid:
            continue
        if ev["event"] == "session_start":
            continue  # already added
        if sid in known_sessions:
            session_events[sid].append(ev)

    # Build session dicts
    results: list[dict] = []
    for sid in session_order:
        evts = session_events[sid]
        if not evts:
            continue

        # Find first event timestamp
        first_ts_str = evts[0].get("ts")
        start_time = None
        if first_ts_str:
            try:
                first_time = datetime.time.fromisoformat(first_ts_str)
                timestamp_start = datetime.datetime.combine(
                    log_date, first_time,
                    tzinfo=datetime.timezone.utc
                )
                time_of_day = "AM" if first_time.hour < 12 else "PM"
                start_time = first_ts_str
            except (ValueError, TypeError):
                timestamp_start = None
                time_of_day = "AM"
        else:
            timestamp_start = None
            time_of_day = "AM"

        # Find end_time from session_end event only
        end_time = None
        for e in evts:
            if e.get("event") == "session_end":
                end_time = e.get("ts")
                break

        tool_events = [e for e in evts if e.get("event") == "tool"]

        # Extract web search queries
        web_searches: list[str] = []
        for te in tool_events:
            if te.get("t") == "WebSearch":
                inp = te.get("i", "")
                # Try to extract query from dict-like string
                q = _extract_web_query(inp)
                if q:
                    web_searches.append(q)

        session_dict = {
            "session_id": sid,
            "date": log_date,
            "time_of_day": time_of_day,
            "start_time": start_time,
            "end_time": end_time,
            "timestamp_start": timestamp_start,
            "source_type": "jsonl",
            "source_file": filepath.name,
            "tool_events": tool_events,
            "web_searches": web_searches,
            "turns": len(tool_events),
        }
        results.append(session_dict)

    return results


def _extract_web_query(inp: str) -> str | None:
    """Extract a search query string from a WebSearch tool input."""
    if not inp:
        return None
    # Try parsing as a Python-like dict: {'query': '...'}
    match = re.search(r"['\"]query['\"]\s*:\s*['\"](.+?)['\"]", inp)
    if match:
        return match.group(1)
    # Try parsing as JSON
    try:
        data = json.loads(inp)
        if isinstance(data, dict):
            return data.get("query")
    except (json.JSONDecodeError, ValueError):
        pass
    # Last resort: return the raw string if it looks like a plain query
    return inp.strip() if inp.strip() else None


# ---------------------------------------------------------------------------
# Session-log parsing (text)
# ---------------------------------------------------------------------------

def parse_session_log(filepath: str | Path) -> dict | None:
    """Parse a text session log and return a session dict, or None."""
    filepath = Path(filepath)

    # Extract date and time-of-day from filename: YYYY-MM-DD-morning.log or YYYY-MM-DD-evening.log
    name_match = re.search(
        r"(\d{4}-\d{2}-\d{2})-(morning|evening)\.log", filepath.name
    )
    if not name_match:
        return None

    log_date = datetime.date.fromisoformat(name_match.group(1))
    tod_raw = name_match.group(2)
    time_of_day = "AM" if tod_raw == "morning" else "PM"

    # Generate a stable ID from the filename
    stable_id = hashlib.sha256(filepath.name.encode()).hexdigest()[:8]

    # Try to read content
    try:
        text = filepath.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        text = ""

    # Extract timestamp_start from === Session started: YYYY-MM-DD HH:MM:SS ===
    timestamp_start = None
    start_match = re.search(
        r"===\s*Session started:\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*===",
        text,
    )
    if start_match:
        try:
            timestamp_start = datetime.datetime.strptime(
                start_match.group(1), "%Y-%m-%d %H:%M:%S"
            ).replace(tzinfo=datetime.timezone.utc)
        except ValueError:
            pass

    return {
        "session_id": stable_id,
        "date": log_date,
        "time_of_day": time_of_day,
        "timestamp_start": timestamp_start,
        "source_type": "log",
        "source_file": filepath.name,
        "tool_events": [],
        "web_searches": [],
        "turns": None,
    }


# ---------------------------------------------------------------------------
# Database storage
# ---------------------------------------------------------------------------

def store_session(conn: psycopg.Connection, session: dict) -> None:
    """Insert a session and its related records. Idempotent — skips duplicates."""
    sid = session["session_id"]

    # Check if session already exists
    row = conn.execute(
        "SELECT 1 FROM sessions WHERE id = %s", (sid,)
    ).fetchone()
    if row is not None:
        return

    conn.execute(
        """
        INSERT INTO sessions (
            id, date, time_of_day, version, timestamp_start, turns,
            source_type, source_file,
            tokens_total_input, tokens_total_output, tokens_cache_read,
            tokens_cache_create, tokens_fresh_input,
            wrote_composition, wrote_private_journal, updated_memory,
            messaged_james, wrote_prediction
        ) VALUES (
            %s, %s, %s, %s, %s, %s,
            %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s
        )
        """,
        (
            sid,
            session["date"],
            session["time_of_day"],
            session.get("version", detect_version(session["date"])),
            session.get("timestamp_start"),
            session.get("turns"),
            session["source_type"],
            session["source_file"],
            session.get("tokens_total_input"),
            session.get("tokens_total_output"),
            session.get("tokens_cache_read"),
            session.get("tokens_cache_create"),
            session.get("tokens_fresh_input"),
            session.get("wrote_composition", False),
            session.get("wrote_private_journal", False),
            session.get("updated_memory", False),
            session.get("messaged_james", False),
            session.get("wrote_prediction", False),
        ),
    )

    # Insert file operations
    for idx, op in enumerate(session.get("file_operations", [])):
        if isinstance(op, dict):
            path = op.get("path", "")
            category = op.get("category", "other")
            method = op.get("method", "")
            direction = op.get("direction", "read")
            ordinal = op.get("ordinal", idx)
        elif isinstance(op, (list, tuple)):
            path, category, direction = op[0], op[1], op[2]
            method = op[3] if len(op) > 3 else ""
            ordinal = idx
        else:
            continue
        conn.execute(
            """
            INSERT INTO file_operations (session_id, path, category, method, direction, ordinal)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (sid, path, category, method, direction, ordinal),
        )

    # Insert web searches
    for idx, ws in enumerate(session.get("web_searches", [])):
        if isinstance(ws, dict):
            query = ws.get("query", "")
            ordinal = ws.get("ordinal", idx)
        else:
            query = str(ws)
            ordinal = idx
        conn.execute(
            """
            INSERT INTO web_searches (session_id, query, ordinal)
            VALUES (%s, %s, %s)
            """,
            (sid, query, ordinal),
        )

    conn.commit()


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def extract_all(
    activity_dir: str | Path,
    session_log_dir: str | Path,
    conn: psycopg.Connection,
) -> int:
    """Process all activity and session log files, store to DB. Return session count."""
    activity_dir = Path(activity_dir)
    session_log_dir = Path(session_log_dir)
    total = 0

    # Process JSONL activity logs
    if activity_dir.is_dir():
        for jsonl_file in sorted(activity_dir.glob("activity-*.jsonl")):
            sessions = parse_activity_log(jsonl_file)
            for session in sessions:
                _enrich_session(session)
                store_session(conn, session)
                total += 1

    # Process text session logs
    if session_log_dir.is_dir():
        for log_file in sorted(session_log_dir.glob("*.log")):
            session = parse_session_log(log_file)
            if session is None:
                continue
            _enrich_session(session)
            store_session(conn, session)
            total += 1

    return total


def _enrich_session(session: dict) -> None:
    """Add version, file_operations, and output flags to a session dict."""
    # Detect version
    session["version"] = detect_version(session["date"])

    # Classify file operations from tool events
    file_ops: list[dict] = []
    for ev in session.get("tool_events", []):
        tool_type = ev.get("t", "")
        tool_input = ev.get("i")
        result = classify_file_operation(tool_type, tool_input)
        if result:
            path, category, direction = result
            file_ops.append({
                "path": path,
                "category": category,
                "direction": direction,
                "method": tool_type,
            })

    session["file_operations"] = file_ops

    # Compute output flags
    flags = compute_output_flags(file_ops)
    session.update(flags)
