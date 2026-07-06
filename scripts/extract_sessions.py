"""Extract and classify Claude session data from activity logs and session logs."""

from __future__ import annotations

import datetime
import hashlib
import json
import os
import re
import unicodedata
from pathlib import Path

import psycopg


# ---------------------------------------------------------------------------
# Size limits
# ---------------------------------------------------------------------------
_MAX_SESSION_ID_LEN = 100
_MAX_FILE_PATH_LEN = 1000
_MAX_WEB_QUERY_LEN = 500
_MAX_TOOL_INPUT_LEN = 9999
_MAX_WEB_SEARCHES_PER_SESSION = 100


# ---------------------------------------------------------------------------
# Unicode / sanitization helpers
# ---------------------------------------------------------------------------

# Unicode control characters to strip: bidi overrides, zero-width joiners/spaces,
# RTL/LTR overrides, and other problematic control characters.
_UNICODE_CONTROL_RE = re.compile(
    "["
    "​"  # zero-width space
    "‌"  # zero-width non-joiner
    "‍"  # zero-width joiner
    "‎"  # left-to-right mark
    "‏"  # right-to-left mark
    "‪"  # left-to-right embedding
    "‫"  # right-to-left embedding
    "‬"  # pop directional formatting
    "‭"  # left-to-right override
    "‮"  # right-to-left override
    "⁠"  # word joiner
    "⁡"  # function application
    "⁢"  # invisible times
    "⁣"  # invisible separator
    "⁤"  # invisible plus
    "⁦"  # left-to-right isolate
    "⁧"  # right-to-left isolate
    "⁨"  # first strong isolate
    "⁩"  # pop directional isolate
    "﻿"  # zero-width no-break space (BOM)
    "]"
)


def _strip_null_bytes(s: str) -> str:
    """Remove null bytes from a string."""
    if not isinstance(s, str):
        return s
    return s.replace("\x00", "")


def _strip_unicode_control(s: str) -> str:
    """Remove problematic Unicode control characters from a string."""
    if not isinstance(s, str):
        return s
    return _UNICODE_CONTROL_RE.sub("", s)


def _sanitize_string(s: str) -> str:
    """Full sanitization: strip null bytes and Unicode control characters."""
    if not isinstance(s, str):
        return s
    s = _strip_null_bytes(s)
    s = _strip_unicode_control(s)
    return s


def _sanitize_path(path: str) -> str:
    """Sanitize and normalize a file path for safe classification and storage."""
    if not isinstance(path, str):
        return path
    path = _sanitize_string(path)
    # NFKC normalize for Unicode attack prevention
    path = unicodedata.normalize("NFKC", path)
    # Canonicalize to collapse ../ sequences
    path = os.path.normpath(path)
    # normpath strips trailing slash and converts // to /, but also
    # converts ~/foo to ~/foo (leaves ~ alone)
    return path


# ---------------------------------------------------------------------------
# Version boundaries (inclusive start date + start time-of-day, newest first)
# ---------------------------------------------------------------------------
_VERSION_BOUNDARIES = [
    (datetime.date(2026, 6, 5), "evening", "4.8"),
    (datetime.date(2026, 4, 18), "morning", "4.7"),
    (datetime.date(2026, 2, 13), "morning", "4.6"),
]


def detect_version(date: datetime.date | str, time_of_day: str | None = None) -> str:
    """Return the model version active for a session at the given date and time.

    Version cutovers can happen mid-day: the 4.8 boundary begins with the
    EVENING session of 2026-06-05 (the morning session that day was still 4.7).
    A session at (date, time_of_day) is at-or-after a boundary
    (boundary_date, boundary_tod) when its date is after boundary_date, or
    equal to boundary_date and either the boundary starts in the morning or
    the session itself is not a morning session.

    Only the EXACT string "morning" counts as morning; None or any other
    value (including non-strings) is treated as evening-or-later. Boundaries
    are scanned newest-first; the first match wins, else "4.5".
    """
    if isinstance(date, str):
        date = datetime.date.fromisoformat(date)
    for boundary_date, boundary_tod, version in _VERSION_BOUNDARIES:
        if date > boundary_date:
            return version
        if date == boundary_date and (boundary_tod == "morning" or time_of_day != "morning"):
            return version
    return "4.5"


def _session_time_of_day(session: dict) -> str | None:
    """Translate a session's internal "AM"/"PM" time_of_day for detect_version."""
    tod = session.get("time_of_day")
    if tod == "AM":
        return "morning"
    if tod == "PM":
        return "evening"
    return tod


# ---------------------------------------------------------------------------
# File-operation classification
# ---------------------------------------------------------------------------

# Direct first-directory-component to category mapping.
_FIRST_DIR_MAP = {
    "private": "private_journal",
    "writing": "writing",
    "learning": "learning",
    "experiments": "experiments",
    "tamagotchi": "tamagotchi",
    "conversations": "conversations",
    "thoughts": "thoughts",
}


def _categorize_path(path: str) -> str:
    """Return the category for a given file path."""
    # Sanitize: strip null bytes, unicode control chars, NFKC normalize
    path = _sanitize_string(path)
    path = unicodedata.normalize("NFKC", path)

    # Canonicalize to collapse ../ sequences
    canonical = os.path.normpath(path)

    # Check for scripts (~/bin/ or /home/claude/bin/)
    is_script = (
        canonical.startswith("~/bin/")
        or canonical.startswith("/home/claude/bin/")
        or canonical.startswith("~/bin")
    )
    if is_script:
        return "scripts"

    # After canonicalization, paths outside /home/claude/ are "other"
    # (handles path traversal attacks)
    is_outside = (
        canonical.startswith("/")
        and not canonical.startswith("/home/claude/")
        and canonical != "/home/claude"
    )
    if is_outside:
        return "other"

    # Also check for homoglyphs in "/home/claude" prefix
    # After NFKC normalization, check that the path bytes match exactly
    if canonical.startswith("/home/"):
        prefix_end = canonical.find("/", len("/home/"))
        if prefix_end == -1:
            prefix_end = len(canonical)
        user_dir = canonical[len("/home/") : prefix_end]
        if user_dir != "claude":
            return "other"

    # For paths under /home/claude/, determine category by the FIRST matching
    # directory component from root. This prevents subdirectory names from
    # shadowing the primary directory category.
    #
    # Strategy: extract the path relative to /home/claude/, then check
    # directory components from left to right.
    rel_path = None
    if canonical.startswith("/home/claude/"):
        rel_path = canonical[len("/home/claude/") :]
    elif canonical.startswith("~/"):
        rel_path = canonical[len("~/") :]

    if rel_path is not None:
        # Split into segments for directory-level matching
        segments = rel_path.split("/")

        # Check whole-path substring rules that match specific filenames first
        # (messages_from_james, messages_to_james)
        # Match against the full relative path, not just the first segment.
        if "messages_from_james" in rel_path:
            return "msgs_from_james"
        if "messages_to_james" in rel_path:
            return "msgs_to_james"

        # Now do hierarchical directory matching: find the first directory
        # component (from root) that matches a category rule.
        # Build progressive path prefixes and check each.
        first_dir = segments[0] if segments else ""

        # Direct first-directory matches (highest priority)
        if first_dir in _FIRST_DIR_MAP:
            return _FIRST_DIR_MAP[first_dir]

        # Multi-component directory matches
        if first_dir == "notes":
            second_dir = segments[1] if len(segments) > 1 else ""
            if second_dir == "daily":
                return "daily_notes"
            if second_dir == "predictions":
                return "predictions"
            # Other notes subdirs fall through

        # Memory paths: segment-based check for memory/ directory or MEMORY file
        for seg in segments:
            if seg.lower() == "memory" or seg.startswith("MEMORY."):
                return "memory_files"

        # prediction as a directory segment (not substring in filenames)
        # Only match if "predictions" or "prediction" is an actual directory name
        for seg in segments[:-1]:  # exclude filename
            if seg == "predictions" or seg == "prediction":
                return "predictions"

    return "other"


def classify_file_operation(tool_type: str, tool_input: str | None) -> tuple[str, str, str] | None:
    """Classify a tool event into (path, category, direction) or None."""
    if not tool_input:
        return None

    # Sanitize the tool input
    tool_input = _sanitize_string(tool_input)

    if tool_type == "Read":
        path = _sanitize_path(tool_input)
        cat = _categorize_path(path)
        return (path, cat, "read")

    if tool_type == "Write":
        path = _sanitize_path(tool_input)
        cat = _categorize_path(path)
        return (path, cat, "write")

    if tool_type == "Edit":
        path = _sanitize_path(tool_input)
        cat = _categorize_path(path)
        return (path, cat, "write")

    if tool_type == "Bash":
        return _classify_bash(tool_input)

    # WebSearch, WebFetch, ToolSearch, and anything else -> not a file operation
    return None


def _classify_bash(command: str) -> tuple[str, str, str] | None:
    """Heuristic classification of Bash commands as file operations."""
    # Sanitize command string
    command = _sanitize_string(command)

    # Reject heredoc content: if the command contains << followed by a delimiter,
    # paths appearing after the first line should not be classified
    # Simple heuristic: if << appears, only analyze the first line
    if "<<" in command:
        first_line = command.split("\n")[0]
        # If the first line has a heredoc redirect, limit analysis to that line
        if "<<" in first_line:
            command = first_line

    # Strip quoted strings to avoid matching > inside quotes as redirects.
    # Replace quoted content with placeholder to prevent false matches.
    # But remember the original command for path extraction from quotes.
    original_command = command

    # Extract paths from quoted strings first (for commands like cat "path with spaces")
    # We'll use these if the unquoted regex doesn't match.
    quoted_paths: list[str] = []
    for qmatch in re.finditer(r"""(?:"|')(/home/claude/[^"']*?)(?:"|')""", original_command):
        quoted_paths.append(qmatch.group(1))

    # Remove content inside double-quoted strings for redirect analysis
    # Replace with a safe placeholder that won't trigger redirect matching
    cleaned_command = re.sub(r'"[^"]*"', '"QUOTED"', command)
    cleaned_command = re.sub(r"'[^']*'", "'QUOTED'", cleaned_command)

    # Detect reads via cat/head/tail/grep
    # Try quoted paths first for cat/head/tail/grep
    read_cmd_match = re.search(r"\b(?:cat|head|tail|grep)\b", original_command)
    if read_cmd_match:
        cmd_name = read_cmd_match.group(0)
        # Check for quoted paths in the original command
        for qp in quoted_paths:
            sanitized = _sanitize_path(qp)
            if sanitized.startswith("/home/claude") or sanitized.startswith("~/"):
                cat = _categorize_path(sanitized)
                return (sanitized, cat, "read")

        # Try unquoted paths after the command
        # For grep, the path comes after the pattern argument
        if cmd_name == "grep":
            # grep [-flags] 'pattern' /path/to/file
            grep_path = re.search(
                r'\bgrep\b\s+(?:-[^\s]+\s+)*(?:[\'"][^"\']*[\'"]\s+)?([^\s|;&>]+)', original_command
            )
            if grep_path:
                path = grep_path.group(1)
                path = _sanitize_path(path)
                if path.startswith("/home/claude") or path.startswith("~/"):
                    cat = _categorize_path(path)
                    return (path, cat, "read")
        else:
            # cat/head/tail: path follows command and optional flags
            read_match = re.search(
                r"\b(?:cat|head|tail)\s+(?:-[^\s]+\s+)*([^\s|;&>]+)", original_command
            )
            if read_match:
                path = read_match.group(1)
                # Strip surrounding quotes if present
                if (path.startswith('"') and path.endswith('"')) or (
                    path.startswith("'") and path.endswith("'")
                ):
                    path = path[1:-1]
                path = _sanitize_path(path)
                if path.startswith("/home/claude") or path.startswith("~/"):
                    cat = _categorize_path(path)
                    return (path, cat, "read")

    # Detect writes via tee command (before redirect detection)
    tee_match = re.search(r"\btee\s+(?:-[^\s]+\s+)*([^\s|;&>]+)", original_command)
    if tee_match:
        path = tee_match.group(1)
        # Strip surrounding quotes
        if (path.startswith('"') and path.endswith('"')) or (
            path.startswith("'") and path.endswith("'")
        ):
            path = path[1:-1]
        path = _sanitize_path(path)
        if path.startswith("/home/claude") or path.startswith("~/"):
            cat = _categorize_path(path)
            return (path, cat, "write")
    # Also check for quoted paths with tee
    if re.search(r"\btee\b", original_command):
        for qp in quoted_paths:
            sanitized = _sanitize_path(qp)
            if sanitized.startswith("/home/claude") or sanitized.startswith("~/"):
                cat = _categorize_path(sanitized)
                return (sanitized, cat, "write")

    # Detect writes via > or >> (use cleaned command to avoid matching inside quotes)
    write_match = re.search(r">>?\s*([^\s;&|]+)", cleaned_command)
    if write_match:
        # Get the path from the cleaned version
        path_candidate = write_match.group(1)
        if path_candidate == '"QUOTED"' or path_candidate == "'QUOTED'":
            # The actual redirect target was inside quotes - find it in original
            # Find the redirect in the original command
            redirect_match = re.search(r'>>?\s*(["\'])(/home/claude/[^"\']*?)\1', original_command)
            if redirect_match:
                path = redirect_match.group(2)
                path = _sanitize_path(path)
                if path.startswith("/home/claude") or path.startswith("~/"):
                    cat = _categorize_path(path)
                    return (path, cat, "write")
        else:
            path = path_candidate
            path = _sanitize_path(path)
            if path.startswith("/home/claude") or path.startswith("~/"):
                # Skip file descriptor redirects (2>/dev/null, etc.)
                # Check if the >> or > is preceded by a digit (file descriptor)
                pre_redirect = cleaned_command[: write_match.start()]
                if pre_redirect and pre_redirect[-1].isdigit():
                    pass  # Skip fd redirect, fall through
                else:
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

        # Sanitize string fields: strip null bytes from tool inputs and session IDs
        if "i" in obj and isinstance(obj["i"], str):
            obj["i"] = _sanitize_string(obj["i"])
            # Truncate huge tool inputs
            if len(obj["i"]) > _MAX_TOOL_INPUT_LEN:
                obj["i"] = obj["i"][:_MAX_TOOL_INPUT_LEN]
        if "s" in obj and isinstance(obj["s"], str):
            obj["s"] = _sanitize_string(obj["s"])

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

        # Find the session_start event's timestamp for time_of_day
        start_ts_str = None
        for e in evts:
            if e.get("event") == "session_start":
                start_ts_str = e.get("ts")
                break

        # Fall back to first event's timestamp if no session_start found
        if start_ts_str is None:
            start_ts_str = evts[0].get("ts")

        start_time = None
        timestamp_start = None
        time_of_day = "AM"

        if start_ts_str:
            try:
                # Handle sub-second precision and timezone offsets
                # Try parsing with fromisoformat first (handles HH:MM:SS.fff and +offset)
                ts_to_parse = start_ts_str
                first_time = datetime.time.fromisoformat(ts_to_parse)
                timestamp_start = datetime.datetime.combine(
                    log_date, first_time, tzinfo=datetime.timezone.utc
                )
                time_of_day = "AM" if first_time.hour < 12 else "PM"
                start_time = start_ts_str
            except (ValueError, TypeError):
                # If fromisoformat fails, try truncating to HH:MM:SS
                try:
                    if ":" in start_ts_str:
                        truncated = start_ts_str.split(".")[0]
                        truncated = truncated.split("+")[0]
                        truncated = truncated.split("-")[0]
                    else:
                        truncated = start_ts_str
                    # Only try if it looks like a time
                    if ":" in truncated and len(truncated) >= 5:
                        first_time = datetime.time.fromisoformat(truncated)
                        timestamp_start = datetime.datetime.combine(
                            log_date, first_time, tzinfo=datetime.timezone.utc
                        )
                        time_of_day = "AM" if first_time.hour < 12 else "PM"
                        start_time = start_ts_str
                except (ValueError, TypeError):
                    pass

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

    inp = _sanitize_string(inp)

    # Try parsing as a Python-like dict: {'query': '...'}  or {"query": "..."}
    match = re.search(r"""['\"]query['\"]\s*:\s*['\"](.+?)['\"]""", inp)
    if match:
        result = match.group(1)
        if len(result) > _MAX_WEB_QUERY_LEN:
            result = result[:_MAX_WEB_QUERY_LEN]
        return result

    # Try parsing as JSON
    try:
        data = json.loads(inp)
        if isinstance(data, dict):
            q = data.get("query")
            if q is not None:
                q = str(q)
                if len(q) > _MAX_WEB_QUERY_LEN:
                    q = q[:_MAX_WEB_QUERY_LEN]
                return q if q else None
    except (json.JSONDecodeError, ValueError, RecursionError):
        pass

    # Do NOT return raw input as fallback -- it could be multi-KB garbage.
    # Only return something if it looks like a clean, short query string.
    stripped = inp.strip()
    if not stripped:
        return None

    # Reject inputs that look like structured data or are too long
    # or contain too many control characters
    printable_count = sum(1 for c in stripped if c.isprintable())
    if printable_count < len(stripped) * 0.8:
        return None  # Too many non-printable chars

    if len(stripped) > _MAX_WEB_QUERY_LEN:
        return None  # Too long to be a real query

    return None


# ---------------------------------------------------------------------------
# Session-log parsing (text)
# ---------------------------------------------------------------------------


def parse_session_log(filepath: str | Path) -> dict | None:
    """Parse a text session log and return a session dict, or None."""
    filepath = Path(filepath)

    # Extract date and time-of-day from filename: YYYY-MM-DD-morning.log or YYYY-MM-DD-evening.log
    name_match = re.search(r"(\d{4}-\d{2}-\d{2})-(morning|evening)\.log", filepath.name)
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
    """Insert a session and its related records. Idempotent -- skips duplicates.
    Uses a transaction to ensure atomicity: if any INSERT fails, all are rolled back.
    """
    # Sanitize all string fields before DB insertion
    sid = _sanitize_string(session["session_id"])
    # Truncate oversized session IDs
    if len(sid) > _MAX_SESSION_ID_LEN:
        sid = sid[:_MAX_SESSION_ID_LEN]

    source_file = session.get("source_file", "")
    if isinstance(source_file, str):
        source_file = _sanitize_string(source_file)

    # Atomically skip duplicates: INSERT ... ON CONFLICT DO NOTHING
    # avoids the TOCTOU race of SELECT-then-INSERT.
    with conn.transaction():
        cur = conn.execute(
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
            ON CONFLICT (id) DO NOTHING
            """,
            (
                sid,
                session["date"],
                session["time_of_day"],
                session.get(
                    "version",
                    detect_version(session["date"], _session_time_of_day(session)),
                ),
                session.get("timestamp_start"),
                session.get("turns"),
                session["source_type"],
                source_file,
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
        if cur.rowcount == 0:
            # Session already existed; skip file_operations and web_searches
            return

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

            # Sanitize strings
            path = _sanitize_string(str(path))
            if len(path) > _MAX_FILE_PATH_LEN:
                path = path[:_MAX_FILE_PATH_LEN]

            conn.execute(
                """
                INSERT INTO file_operations (session_id, path, category, method, direction, ordinal)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (sid, path, category, method, direction, ordinal),
            )

        # Insert web searches (with cap).
        web_searches = session.get("web_searches", [])
        for idx, ws in enumerate(web_searches[:_MAX_WEB_SEARCHES_PER_SESSION]):
            if isinstance(ws, dict):
                query = ws.get("query", "")
                ordinal = ws.get("ordinal", idx)
            else:
                query = str(ws)
                ordinal = idx

            # Sanitize unicode control chars and truncate query
            query = _strip_unicode_control(query)
            if len(query) > _MAX_WEB_QUERY_LEN:
                query = query[:_MAX_WEB_QUERY_LEN]

            # Try inserting inside a savepoint; on DataError (e.g.
            # residual null byte), sanitize and retry in its own
            # savepoint.  If the session has file_operations already
            # committed in this transaction, propagate so the whole
            # transaction rolls back atomically.
            try:
                with conn.transaction():
                    conn.execute(
                        """
                        INSERT INTO web_searches (session_id, query, ordinal)
                        VALUES (%s, %s, %s)
                        """,
                        (sid, query, ordinal),
                    )
            except psycopg.errors.DataError:
                if session.get("file_operations"):
                    raise
                query = _sanitize_string(query)
                with conn.transaction():
                    conn.execute(
                        """
                        INSERT INTO web_searches (session_id, query, ordinal)
                        VALUES (%s, %s, %s)
                        """,
                        (sid, query, ordinal),
                    )


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
    # Detect version (time-aware: AM/PM sessions on a cutover date can differ)
    session["version"] = detect_version(session["date"], _session_time_of_day(session))

    # Classify file operations from tool events
    file_ops: list[dict] = []
    for ev in session.get("tool_events", []):
        tool_type = ev.get("t", "")
        tool_input = ev.get("i")
        result = classify_file_operation(tool_type, tool_input)
        if result:
            path, category, direction = result
            file_ops.append(
                {
                    "path": path,
                    "category": category,
                    "direction": direction,
                    "method": tool_type,
                }
            )

    session["file_operations"] = file_ops

    # Compute output flags
    flags = compute_output_flags(file_ops)
    session.update(flags)
