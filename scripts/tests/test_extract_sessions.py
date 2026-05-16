"""Hostile tests for extract_sessions.py -- defines the API contract via TDD.

These tests intentionally import a module that does not yet exist.
Every test here should FAIL until the implementation is written.
"""

import json
import datetime
import textwrap

import pytest

from scripts.extract_sessions import (
    parse_activity_log,
    parse_session_log,
    classify_file_operation,
    detect_version,
    compute_output_flags,
    store_session,
    extract_all,
)


# ---------------------------------------------------------------------------
# Helpers for building JSONL fixture files
# ---------------------------------------------------------------------------


def _jsonl_line(**kwargs):
    return json.dumps(kwargs)


def _make_complete_session(
    session_id="fcfe54c5",
    start_time="10:00:00",
    end_time="10:03:53",
    tools=None,
):
    """Build JSONL lines for one complete session."""
    lines = [_jsonl_line(ts=start_time, event="session_start", s=session_id, cwd="/home/claude")]
    for tool in tools or []:
        lines.append(
            _jsonl_line(
                ts=tool.get("ts", "10:01:00"), event="tool", s=session_id, t=tool["t"], i=tool["i"]
            )
        )
    lines.append(_jsonl_line(ts=end_time, event="response_complete", s=session_id))
    lines.append(_jsonl_line(ts=end_time, event="session_end", s=session_id))
    return lines


def _write_jsonl(tmp_path, filename, lines):
    """Write lines to a JSONL file and return the path."""
    p = tmp_path / filename
    p.write_text("\n".join(lines) + "\n")
    return p


# ===========================================================================
# 1. JSONL PARSING
# ===========================================================================


class TestJsonlParsing:
    def test_complete_session_parsed(self, tmp_path):
        """A well-formed session with tools parses to a dict with all fields."""
        lines = _make_complete_session(
            tools=[
                {"t": "Read", "i": "/home/claude/notes/daily/2026-04-20.md", "ts": "10:00:11"},
                {"t": "Write", "i": "/home/claude/notes/daily/2026-04-20.md", "ts": "10:01:57"},
            ]
        )
        path = _write_jsonl(tmp_path, "activity-2026-04-20.jsonl", lines)
        sessions = parse_activity_log(path)

        assert len(sessions) == 1
        s = sessions[0]
        assert s["session_id"] == "fcfe54c5"
        assert s["start_time"] == "10:00:00"
        assert s["end_time"] == "10:03:53"
        assert len(s["tool_events"]) == 2

    def test_two_sessions_split_by_session_id(self, tmp_path):
        """A day with AM and PM sessions must be split correctly."""
        am = _make_complete_session(
            session_id="aaaa1111",
            start_time="10:00:00",
            end_time="10:05:00",
            tools=[{"t": "Read", "i": "/home/claude/messages_from_james.md"}],
        )
        pm = _make_complete_session(
            session_id="bbbb2222",
            start_time="22:00:00",
            end_time="22:10:00",
            tools=[{"t": "Write", "i": "/home/claude/private/journal.md"}],
        )
        path = _write_jsonl(tmp_path, "activity-2026-04-20.jsonl", am + pm)
        sessions = parse_activity_log(path)

        assert len(sessions) == 2
        ids = {s["session_id"] for s in sessions}
        assert ids == {"aaaa1111", "bbbb2222"}

    def test_empty_jsonl_file(self, tmp_path):
        """A JSONL file with no events returns an empty list."""
        path = _write_jsonl(tmp_path, "activity-2026-04-20.jsonl", [])
        sessions = parse_activity_log(path)
        assert sessions == []

    def test_malformed_json_lines_skipped(self, tmp_path):
        """Truncated JSON, empty lines, and bare strings are silently skipped."""
        good_lines = _make_complete_session(
            tools=[
                {"t": "Read", "i": "/home/claude/writing/essay.md", "ts": "10:01:00"},
            ]
        )
        garbage = [
            '{"ts": "10:00:05", "event": "tool", "s": "fcfe54c5", "t": "Read"',  # truncated
            "",  # empty line
            "not json at all",  # bare string
            "42",  # bare number
        ]
        # Insert garbage between session_start and the first tool event
        mixed = [good_lines[0]] + garbage + good_lines[1:]
        path = _write_jsonl(tmp_path, "activity-2026-04-20.jsonl", mixed)
        sessions = parse_activity_log(path)

        assert len(sessions) == 1
        # The garbage lines must not appear as tool events
        assert len(sessions[0]["tool_events"]) == 1

    def test_orphan_session_start_no_end(self, tmp_path):
        """session_start with no matching session_end produces a session (partial)."""
        lines = [
            _jsonl_line(ts="10:00:00", event="session_start", s="orphan01", cwd="/home/claude"),
            _jsonl_line(
                ts="10:01:00",
                event="tool",
                s="orphan01",
                t="Read",
                i="/home/claude/notes/daily/2026-04-20.md",
            ),
        ]
        path = _write_jsonl(tmp_path, "activity-2026-04-20.jsonl", lines)
        sessions = parse_activity_log(path)

        assert len(sessions) == 1
        assert sessions[0]["session_id"] == "orphan01"
        assert sessions[0].get("end_time") is None

    def test_orphan_session_end_no_start(self, tmp_path):
        """session_end without a preceding session_start is discarded."""
        lines = [
            _jsonl_line(ts="10:03:53", event="session_end", s="orphan02"),
        ]
        path = _write_jsonl(tmp_path, "activity-2026-04-20.jsonl", lines)
        sessions = parse_activity_log(path)
        assert sessions == []

    def test_lines_with_no_event_field_skipped(self, tmp_path):
        """Lines that are valid JSON but missing 'event' are silently skipped."""
        lines = _make_complete_session()
        # Inject a line with no event field
        lines.insert(1, json.dumps({"ts": "10:00:05", "s": "fcfe54c5", "data": "spurious"}))
        path = _write_jsonl(tmp_path, "activity-2026-04-20.jsonl", lines)
        sessions = parse_activity_log(path)

        assert len(sessions) == 1

    def test_unknown_event_types_silently_ignored(self, tmp_path):
        """Lines with unrecognised event types are silently skipped."""
        lines = _make_complete_session()
        lines.insert(1, _jsonl_line(ts="10:00:03", event="heartbeat", s="fcfe54c5", cpu=0.12))
        path = _write_jsonl(tmp_path, "activity-2026-04-20.jsonl", lines)
        sessions = parse_activity_log(path)

        assert len(sessions) == 1
        # heartbeat must not appear in tool_events
        for ev in sessions[0]["tool_events"]:
            assert ev["t"] != "heartbeat"

    def test_unicode_in_tool_inputs(self, tmp_path):
        """Emoji and CJK in tool inputs must round-trip correctly."""
        lines = _make_complete_session(
            tools=[
                {"t": "Write", "i": "/home/claude/writing/emoji-\U0001f680.md", "ts": "10:01:00"},
                {"t": "Read", "i": "/home/claude/learning/日本語/notes.md", "ts": "10:01:30"},
            ]
        )
        path = _write_jsonl(tmp_path, "activity-2026-04-20.jsonl", lines)
        sessions = parse_activity_log(path)

        assert len(sessions) == 1
        inputs = [ev["i"] for ev in sessions[0]["tool_events"]]
        assert any("\U0001f680" in i for i in inputs)
        assert any("日本語" in i for i in inputs)

    def test_date_extracted_from_filename(self, tmp_path):
        """parse_activity_log must expose the date derived from the filename."""
        lines = _make_complete_session()
        path = _write_jsonl(tmp_path, "activity-2026-04-20.jsonl", lines)
        sessions = parse_activity_log(path)

        assert sessions[0]["date"] == datetime.date(2026, 4, 20)

    def test_tool_events_preserve_order(self, tmp_path):
        """Tool events must maintain chronological order from the file."""
        tools = [
            {"t": "Read", "i": "/home/claude/messages_from_james.md", "ts": "10:00:11"},
            {"t": "Bash", "i": "~/bin/wakeup 2>&1 | head -80", "ts": "10:00:18"},
            {"t": "WebSearch", "i": "{'query': 'world news'}", "ts": "10:01:07"},
            {"t": "Write", "i": "/home/claude/notes/daily/2026-04-20.md", "ts": "10:01:57"},
        ]
        lines = _make_complete_session(tools=tools)
        path = _write_jsonl(tmp_path, "activity-2026-04-20.jsonl", lines)
        sessions = parse_activity_log(path)

        timestamps = [ev["ts"] for ev in sessions[0]["tool_events"]]
        assert timestamps == ["10:00:11", "10:00:18", "10:01:07", "10:01:57"]

    def test_websearch_events_captured(self, tmp_path):
        """WebSearch tool events are captured with their query string."""
        lines = _make_complete_session(
            tools=[
                {"t": "WebSearch", "i": "{'query': 'world news April 20 2026'}", "ts": "10:01:07"},
            ]
        )
        path = _write_jsonl(tmp_path, "activity-2026-04-20.jsonl", lines)
        sessions = parse_activity_log(path)

        ws_events = [ev for ev in sessions[0]["tool_events"] if ev["t"] == "WebSearch"]
        assert len(ws_events) == 1
        assert "world news" in ws_events[0]["i"]


# ===========================================================================
# 2. TOOL EVENT CLASSIFICATION
# ===========================================================================


class TestClassifyFileOperation:
    # -- Writing category --
    def test_read_writing_file(self):
        result = classify_file_operation("Read", "/home/claude/writing/foo.md")
        assert result is not None
        path, category, direction = result
        assert category == "writing"
        assert direction == "read"

    def test_write_daily_notes(self):
        result = classify_file_operation("Write", "/home/claude/notes/daily/2026-04-20.md")
        assert result is not None
        path, category, direction = result
        assert category == "daily_notes"
        assert direction == "write"

    def test_edit_memory_file(self):
        result = classify_file_operation(
            "Edit", "/home/claude/.claude/projects/-home-claude/memory/MEMORY.md"
        )
        assert result is not None
        path, category, direction = result
        assert category == "memory_files"
        assert direction == "write"  # Edit is a write operation

    def test_read_messages_from_james(self):
        result = classify_file_operation("Read", "/home/claude/messages_from_james.md")
        assert result is not None
        path, category, direction = result
        assert category == "msgs_from_james"
        assert direction == "read"

    def test_write_messages_to_james(self):
        result = classify_file_operation("Write", "/home/claude/messages_to_james.md")
        assert result is not None
        path, category, direction = result
        assert category == "msgs_to_james"
        assert direction == "write"

    def test_read_private_journal(self):
        result = classify_file_operation("Read", "/home/claude/private/note.md")
        assert result is not None
        path, category, direction = result
        assert category == "private_journal"
        assert direction == "read"

    def test_write_private_journal(self):
        result = classify_file_operation("Write", "/home/claude/private/journal.md")
        assert result is not None
        _, category, direction = result
        assert category == "private_journal"
        assert direction == "write"

    def test_bash_cat_messages_from_james(self):
        """Bash 'cat ~/messages_from_james.md' should detect as msgs_from_james read."""
        result = classify_file_operation("Bash", "cat ~/messages_from_james.md")
        assert result is not None
        path, category, direction = result
        assert category == "msgs_from_james"
        assert direction == "read"

    def test_bash_non_file_command(self):
        """Bash with a command like 'ls ~/writing/' should be classified or skipped."""
        result = classify_file_operation("Bash", "ls ~/writing/")
        # Either None (skip) or a reasonable classification -- not a crash
        # If it returns something, direction should be "read" at most
        if result is not None:
            _, _, direction = result
            assert direction == "read"

    def test_websearch_returns_none(self):
        """WebSearch is not a file operation."""
        result = classify_file_operation("WebSearch", "{'query': 'world news'}")
        assert result is None

    def test_toolsearch_returns_none(self):
        """ToolSearch is not a file operation."""
        result = classify_file_operation("ToolSearch", "jupyter notebook")
        assert result is None

    def test_empty_string_input(self):
        """Tool event with empty string input should not crash."""
        result = classify_file_operation("Read", "")
        # Either None or a sensible fallback, but never an exception
        assert result is None or len(result) == 3

    def test_none_input(self):
        """Tool event with None input should not crash."""
        result = classify_file_operation("Read", None)
        assert result is None or len(result) == 3

    def test_path_not_under_home_claude(self):
        """Paths outside /home/claude classify as 'other'."""
        result = classify_file_operation("Read", "/etc/passwd")
        # Could be None (skip) or ("other", ...). Either way, not a crash.
        if result is not None:
            _, category, _ = result
            assert category == "other"

    def test_predictions_path(self):
        result = classify_file_operation("Write", "/home/claude/notes/predictions/tracker.md")
        assert result is not None
        _, category, direction = result
        assert category == "predictions"
        assert direction == "write"

    def test_tamagotchi_path(self):
        result = classify_file_operation("Read", "/home/claude/tamagotchi/pet.json")
        assert result is not None
        _, category, _ = result
        assert category == "tamagotchi"

    def test_learning_path(self):
        result = classify_file_operation("Read", "/home/claude/learning/artemis/notes.md")
        assert result is not None
        _, category, _ = result
        assert category == "learning"

    def test_experiments_path(self):
        result = classify_file_operation("Write", "/home/claude/experiments/calibration.md")
        assert result is not None
        _, category, _ = result
        assert category == "experiments"

    def test_conversations_path(self):
        result = classify_file_operation("Read", "/home/claude/conversations/gemini/chat.md")
        assert result is not None
        _, category, _ = result
        assert category == "conversations"

    def test_edit_is_write_direction(self):
        result = classify_file_operation("Edit", "/home/claude/notes/daily/2026-04-20.md")
        assert result is not None
        _, _, direction = result
        assert direction == "write"

    def test_read_is_read_direction(self):
        result = classify_file_operation("Read", "/home/claude/notes/daily/2026-04-20.md")
        assert result is not None
        _, _, direction = result
        assert direction == "read"

    def test_write_is_write_direction(self):
        result = classify_file_operation("Write", "/home/claude/notes/daily/2026-04-20.md")
        assert result is not None
        _, _, direction = result
        assert direction == "write"

    def test_scripts_bin_path(self):
        """Paths under ~/bin/ classify as scripts."""
        result = classify_file_operation("Read", "/home/claude/bin/wakeup")
        assert result is not None
        _, category, _ = result
        assert category == "scripts"

    def test_thoughts_path(self):
        result = classify_file_operation("Write", "/home/claude/thoughts/musings.md")
        assert result is not None
        _, category, _ = result
        assert category == "thoughts"

    def test_writing_drafts_subdir(self):
        """writing/drafts/ should classify as 'writing' (same as writing/)."""
        result = classify_file_operation("Write", "/home/claude/writing/drafts/wip.md")
        assert result is not None
        _, category, direction = result
        assert category == "writing"
        assert direction == "write"

    def test_other_path_under_home_claude(self):
        """A random path under /home/claude that matches no pattern is 'other'."""
        result = classify_file_operation("Write", "/home/claude/random/stuff.txt")
        assert result is not None
        _, category, _ = result
        assert category == "other"

    def test_memory_in_dotclaude_projects_path(self):
        """The memory path with the long .claude/projects prefix is still memory_files."""
        result = classify_file_operation(
            "Edit",
            "/home/claude/.claude/projects/-home-claude/memory/project_world_events.md",
        )
        assert result is not None
        _, category, direction = result
        assert category == "memory_files"
        assert direction == "write"

    def test_path_returns_original_path(self):
        """The first element of the tuple should be the original path."""
        result = classify_file_operation("Read", "/home/claude/writing/essay.md")
        assert result is not None
        path, _, _ = result
        assert path == "/home/claude/writing/essay.md"


# ===========================================================================
# 3. VERSION DETECTION
# ===========================================================================


class TestVersionDetection:
    def test_early_date_is_4_5(self):
        assert detect_version(datetime.date(2026, 1, 15)) == "4.5"

    def test_day_before_4_6_transition(self):
        """2026-02-12 is the last day of 4.5."""
        assert detect_version(datetime.date(2026, 2, 12)) == "4.5"

    def test_4_6_transition_day(self):
        """2026-02-13 is the first day of 4.6."""
        assert detect_version(datetime.date(2026, 2, 13)) == "4.6"

    def test_last_day_of_4_6(self):
        """2026-04-17 is the last day of 4.6."""
        assert detect_version(datetime.date(2026, 4, 17)) == "4.6"

    def test_first_day_of_4_7(self):
        """2026-04-18 is the first day of 4.7."""
        assert detect_version(datetime.date(2026, 4, 18)) == "4.7"

    def test_recent_date_is_4_7(self):
        assert detect_version(datetime.date(2026, 5, 15)) == "4.7"

    def test_string_date_handled(self):
        """Passing a string '2026-02-13' should either work or raise a clear error."""
        try:
            result = detect_version("2026-02-13")
            # If it accepts strings, it must return the right version
            assert result == "4.6"
        except (TypeError, ValueError) as e:
            # A clear error is acceptable
            assert "date" in str(e).lower() or "str" in str(e).lower()

    def test_boundary_4_5_to_4_6_is_inclusive(self):
        """2026-02-13 must be IN 4.6, NOT 4.5 (off-by-one guard)."""
        assert detect_version(datetime.date(2026, 2, 13)) != "4.5"
        assert detect_version(datetime.date(2026, 2, 13)) == "4.6"

    def test_boundary_4_6_to_4_7_is_inclusive(self):
        """2026-04-18 must be IN 4.7, NOT 4.6 (off-by-one guard)."""
        assert detect_version(datetime.date(2026, 4, 18)) != "4.6"
        assert detect_version(datetime.date(2026, 4, 18)) == "4.7"

    def test_mid_range_4_6(self):
        """A date solidly within the 4.6 range."""
        assert detect_version(datetime.date(2026, 3, 15)) == "4.6"


# ===========================================================================
# 4. OUTPUT FLAGS
# ===========================================================================


class TestOutputFlags:
    def _make_file_ops(self, ops):
        """Build a list of file-op dicts from (path, category, direction) tuples."""
        return [{"path": path, "category": cat, "direction": d} for path, cat, d in ops]

    def test_writing_sets_wrote_composition(self):
        ops = self._make_file_ops(
            [
                ("/home/claude/writing/version-number.md", "writing", "write"),
            ]
        )
        flags = compute_output_flags(ops)
        assert flags["wrote_composition"] is True

    def test_writing_drafts_sets_wrote_composition(self):
        ops = self._make_file_ops(
            [
                ("/home/claude/writing/drafts/wip.md", "writing", "write"),
            ]
        )
        flags = compute_output_flags(ops)
        assert flags["wrote_composition"] is True

    def test_private_sets_wrote_private_journal(self):
        ops = self._make_file_ops(
            [
                ("/home/claude/private/note.md", "private_journal", "write"),
            ]
        )
        flags = compute_output_flags(ops)
        assert flags["wrote_private_journal"] is True

    def test_memory_edit_sets_updated_memory(self):
        ops = self._make_file_ops(
            [
                (
                    "/home/claude/.claude/projects/-home-claude/memory/MEMORY.md",
                    "memory_files",
                    "write",
                ),
            ]
        )
        flags = compute_output_flags(ops)
        assert flags["updated_memory"] is True

    def test_messages_to_james_sets_messaged_james(self):
        ops = self._make_file_ops(
            [
                ("/home/claude/messages_to_james.md", "msgs_to_james", "write"),
            ]
        )
        flags = compute_output_flags(ops)
        assert flags["messaged_james"] is True

    def test_prediction_write_sets_wrote_prediction(self):
        ops = self._make_file_ops(
            [
                ("/home/claude/notes/predictions/2026-04-20.md", "predictions", "write"),
            ]
        )
        flags = compute_output_flags(ops)
        assert flags["wrote_prediction"] is True

    def test_zero_file_operations_all_false(self):
        flags = compute_output_flags([])
        assert flags["wrote_composition"] is False
        assert flags["wrote_private_journal"] is False
        assert flags["updated_memory"] is False
        assert flags["messaged_james"] is False
        assert flags["wrote_prediction"] is False

    def test_reading_predictions_does_not_set_flag(self):
        """Only writes set the flag, not reads."""
        ops = self._make_file_ops(
            [
                ("/home/claude/notes/predictions/tracker.md", "predictions", "read"),
            ]
        )
        flags = compute_output_flags(ops)
        assert flags["wrote_prediction"] is False

    def test_reading_writing_does_not_set_flag(self):
        """Reading a writing file does NOT set wrote_composition."""
        ops = self._make_file_ops(
            [
                ("/home/claude/writing/essay.md", "writing", "read"),
            ]
        )
        flags = compute_output_flags(ops)
        assert flags["wrote_composition"] is False

    def test_only_daily_notes_all_special_flags_false(self):
        """Writing only to daily_notes should not set composition/journal/message flags."""
        ops = self._make_file_ops(
            [
                ("/home/claude/notes/daily/2026-04-20.md", "daily_notes", "write"),
            ]
        )
        flags = compute_output_flags(ops)
        assert flags["wrote_composition"] is False
        assert flags["wrote_private_journal"] is False
        assert flags["messaged_james"] is False
        assert flags["wrote_prediction"] is False

    def test_reading_memory_does_not_set_updated_memory(self):
        ops = self._make_file_ops(
            [
                (
                    "/home/claude/.claude/projects/-home-claude/memory/MEMORY.md",
                    "memory_files",
                    "read",
                ),
            ]
        )
        flags = compute_output_flags(ops)
        assert flags["updated_memory"] is False

    def test_msgs_from_james_read_does_not_set_messaged_james(self):
        """Reading FROM james is not the same as messaging james."""
        ops = self._make_file_ops(
            [
                ("/home/claude/messages_from_james.md", "msgs_from_james", "read"),
            ]
        )
        flags = compute_output_flags(ops)
        assert flags["messaged_james"] is False

    def test_multiple_flags_can_be_true_simultaneously(self):
        """A session can set multiple flags at once."""
        ops = self._make_file_ops(
            [
                ("/home/claude/writing/essay.md", "writing", "write"),
                ("/home/claude/private/thoughts.md", "private_journal", "write"),
                ("/home/claude/messages_to_james.md", "msgs_to_james", "write"),
                (
                    "/home/claude/.claude/projects/-home-claude/memory/MEMORY.md",
                    "memory_files",
                    "write",
                ),
                ("/home/claude/notes/predictions/p.md", "predictions", "write"),
            ]
        )
        flags = compute_output_flags(ops)
        assert flags["wrote_composition"] is True
        assert flags["wrote_private_journal"] is True
        assert flags["updated_memory"] is True
        assert flags["messaged_james"] is True
        assert flags["wrote_prediction"] is True


# ===========================================================================
# 5. SESSION LOG (TEXT) PARSING
# ===========================================================================


class TestSessionLogParsing:
    def test_morning_log_parsed(self, tmp_path):
        content = textwrap.dedent("""\
            === Session started: 2026-01-16 10:00:00 ===
            Read messages from James. Performed morning routine.
            Checked world news. Updated daily notes.
            === Session ended: 2026-01-16 10:01:32 ===
        """)
        path = tmp_path / "2026-01-16-morning.log"
        path.write_text(content)
        session = parse_session_log(path)

        assert session["date"] == datetime.date(2026, 1, 16)
        assert session["time_of_day"] == "AM"

    def test_evening_log_parsed(self, tmp_path):
        content = textwrap.dedent("""\
            === Session started: 2026-03-01 22:00:00 ===
            Evening reflection and writing session.
            === Session ended: 2026-03-01 22:15:00 ===
        """)
        path = tmp_path / "2026-03-01-evening.log"
        path.write_text(content)
        session = parse_session_log(path)

        assert session["date"] == datetime.date(2026, 3, 1)
        assert session["time_of_day"] == "PM"

    def test_empty_log_file(self, tmp_path):
        path = tmp_path / "2026-02-15-morning.log"
        path.write_text("")
        session = parse_session_log(path)

        # Should return a session with minimal fields, not crash
        assert session is not None
        assert session["date"] == datetime.date(2026, 2, 15)
        assert session["time_of_day"] == "AM"

    def test_log_missing_session_started_marker(self, tmp_path):
        """Log file with no === Session started === line extracts from filename."""
        content = "Just some notes without markers.\nMore text here.\n"
        path = tmp_path / "2026-04-10-evening.log"
        path.write_text(content)
        session = parse_session_log(path)

        assert session["date"] == datetime.date(2026, 4, 10)
        assert session["time_of_day"] == "PM"

    def test_log_with_only_start_marker(self, tmp_path):
        """Log that has start but no end extracts start timestamp."""
        content = textwrap.dedent("""\
            === Session started: 2026-02-20 10:00:00 ===
            Session was interrupted. No end marker.
        """)
        path = tmp_path / "2026-02-20-morning.log"
        path.write_text(content)
        session = parse_session_log(path)

        assert session["date"] == datetime.date(2026, 2, 20)
        assert session.get("timestamp_start") is not None

    def test_unexpected_filename_format(self, tmp_path):
        """A filename that doesn't match the expected pattern raises or returns None."""
        content = "Some content.\n"
        path = tmp_path / "random-notes.log"
        path.write_text(content)

        try:
            result = parse_session_log(path)
            # If it doesn't raise, returning None is acceptable
            assert result is None
        except (ValueError, RuntimeError):
            pass  # A clear error is acceptable

    def test_source_type_is_log(self, tmp_path):
        """Session parsed from a .log file should have source_type='log'."""
        content = textwrap.dedent("""\
            === Session started: 2026-01-16 10:00:00 ===
            Morning routine.
            === Session ended: 2026-01-16 10:01:32 ===
        """)
        path = tmp_path / "2026-01-16-morning.log"
        path.write_text(content)
        session = parse_session_log(path)

        assert session["source_type"] == "log"
        assert session["source_file"] == "2026-01-16-morning.log"

    def test_start_timestamp_parsed(self, tmp_path):
        """The timestamp_start should be extracted from the === marker."""
        content = textwrap.dedent("""\
            === Session started: 2026-01-16 10:00:00 ===
            Work.
            === Session ended: 2026-01-16 10:05:00 ===
        """)
        path = tmp_path / "2026-01-16-morning.log"
        path.write_text(content)
        session = parse_session_log(path)

        ts = session["timestamp_start"]
        # Should be a datetime or string that encodes 2026-01-16 10:00:00
        if isinstance(ts, datetime.datetime):
            assert ts.hour == 10
            assert ts.minute == 0
        elif isinstance(ts, str):
            assert "10:00:00" in ts
        else:
            pytest.fail(f"timestamp_start has unexpected type: {type(ts)}")


# ===========================================================================
# 6. DATABASE INSERTION
# ===========================================================================


class TestDatabaseInsertion:
    def _make_session_dict(self, **overrides):
        """Build a minimal session dict suitable for store_session."""
        base = {
            "session_id": "test-session-01",
            "date": datetime.date(2026, 3, 15),
            "time_of_day": "AM",
            "version": "4.6",
            "timestamp_start": datetime.datetime(
                2026, 3, 15, 10, 0, 0, tzinfo=datetime.timezone.utc
            ),
            "turns": 5,
            "source_type": "jsonl",
            "source_file": "activity-2026-03-15.jsonl",
            "tokens_total_input": 50000,
            "tokens_total_output": 8000,
            "tokens_cache_read": 30000,
            "tokens_cache_create": 5000,
            "tokens_fresh_input": 15000,
            "wrote_composition": False,
            "wrote_private_journal": False,
            "updated_memory": True,
            "messaged_james": False,
            "wrote_prediction": False,
            "file_operations": [
                {
                    "path": "/home/claude/.claude/projects/-home-claude/memory/MEMORY.md",
                    "category": "memory_files",
                    "method": "Edit",
                    "direction": "write",
                    "ordinal": 0,
                },
                {
                    "path": "/home/claude/notes/daily/2026-03-15.md",
                    "category": "daily_notes",
                    "method": "Write",
                    "direction": "write",
                    "ordinal": 1,
                },
            ],
            "web_searches": [
                {"query": "world news March 15 2026", "ordinal": 0},
            ],
        }
        base.update(overrides)
        return base

    def test_insert_full_session_and_query_back(self, db_conn):
        session = self._make_session_dict()
        store_session(db_conn, session)

        row = db_conn.execute(
            "SELECT id, date, time_of_day, version, turns, source_type, "
            "tokens_total_input, updated_memory FROM sessions WHERE id = %s",
            ("test-session-01",),
        ).fetchone()
        assert row is not None
        assert row[0] == "test-session-01"
        assert row[1] == datetime.date(2026, 3, 15)
        assert row[2] == "AM"
        assert row[3] == "4.6"
        assert row[4] == 5
        assert row[5] == "jsonl"
        assert row[6] == 50000
        assert row[7] is True

    def test_file_operations_inserted_with_fk(self, db_conn):
        session = self._make_session_dict()
        store_session(db_conn, session)

        ops = db_conn.execute(
            "SELECT path, category, method, direction, ordinal "
            "FROM file_operations WHERE session_id = %s ORDER BY ordinal",
            ("test-session-01",),
        ).fetchall()
        assert len(ops) == 2
        assert ops[0][1] == "memory_files"
        assert ops[0][3] == "write"
        assert ops[0][4] == 0
        assert ops[1][1] == "daily_notes"
        assert ops[1][4] == 1

    def test_web_searches_inserted_with_ordinals(self, db_conn):
        session = self._make_session_dict(
            web_searches=[
                {"query": "first search", "ordinal": 0},
                {"query": "second search", "ordinal": 1},
                {"query": "third search", "ordinal": 2},
            ]
        )
        store_session(db_conn, session)

        rows = db_conn.execute(
            "SELECT query, ordinal FROM web_searches WHERE session_id = %s ORDER BY ordinal",
            ("test-session-01",),
        ).fetchall()
        assert len(rows) == 3
        assert rows[0][0] == "first search"
        assert rows[2][1] == 2

    def test_duplicate_session_id_does_not_crash(self, db_conn):
        """Inserting the same session_id twice should upsert or skip, NOT raise."""
        session = self._make_session_dict()
        store_session(db_conn, session)
        # Second insert with same ID
        session2 = self._make_session_dict(turns=10)
        store_session(db_conn, session2)  # Must not raise

        # Verify only one row exists (or updated)
        count = db_conn.execute(
            "SELECT COUNT(*) FROM sessions WHERE id = %s", ("test-session-01",)
        ).fetchone()[0]
        assert count == 1

    def test_cascade_delete_through_store_api(self, db_conn):
        """After store_session, deleting the session cascades to file_operations."""
        session = self._make_session_dict()
        store_session(db_conn, session)

        db_conn.execute("DELETE FROM sessions WHERE id = %s", ("test-session-01",))
        db_conn.commit()

        ops_count = db_conn.execute(
            "SELECT COUNT(*) FROM file_operations WHERE session_id = %s",
            ("test-session-01",),
        ).fetchone()[0]
        assert ops_count == 0

        ws_count = db_conn.execute(
            "SELECT COUNT(*) FROM web_searches WHERE session_id = %s",
            ("test-session-01",),
        ).fetchone()[0]
        assert ws_count == 0

    def test_session_with_no_file_ops_or_searches(self, db_conn):
        """A session with empty file_operations and web_searches inserts cleanly."""
        session = self._make_session_dict(
            session_id="empty-session",
            file_operations=[],
            web_searches=[],
        )
        store_session(db_conn, session)

        row = db_conn.execute(
            "SELECT id FROM sessions WHERE id = %s", ("empty-session",)
        ).fetchone()
        assert row is not None

    def test_nullable_token_fields(self, db_conn):
        """Sessions from log files may have null token counts."""
        session = self._make_session_dict(
            session_id="log-session",
            source_type="log",
            source_file="2026-03-15-morning.log",
            tokens_total_input=None,
            tokens_total_output=None,
            tokens_cache_read=None,
            tokens_cache_create=None,
            tokens_fresh_input=None,
        )
        store_session(db_conn, session)

        row = db_conn.execute(
            "SELECT tokens_total_input, tokens_total_output FROM sessions WHERE id = %s",
            ("log-session",),
        ).fetchone()
        assert row[0] is None
        assert row[1] is None

    def test_output_flags_stored_correctly(self, db_conn):
        """All boolean output flags are stored and retrievable."""
        session = self._make_session_dict(
            session_id="flags-session",
            wrote_composition=True,
            wrote_private_journal=True,
            updated_memory=True,
            messaged_james=True,
            wrote_prediction=True,
        )
        store_session(db_conn, session)

        row = db_conn.execute(
            "SELECT wrote_composition, wrote_private_journal, updated_memory, "
            "messaged_james, wrote_prediction FROM sessions WHERE id = %s",
            ("flags-session",),
        ).fetchone()
        assert all(row), f"Expected all True, got {row}"


# ===========================================================================
# 7. END-TO-END
# ===========================================================================


class TestEndToEnd:
    def _setup_fixture_dirs(self, tmp_path):
        """Create a realistic fixture directory structure with multiple files."""
        activity_dir = tmp_path / "activity_logs"
        activity_dir.mkdir()
        session_log_dir = tmp_path / "session_logs"
        session_log_dir.mkdir()

        # -- Activity JSONL file 1: 2026-04-20 with two sessions --
        am_tools = [
            {"t": "Read", "i": "/home/claude/messages_from_james.md", "ts": "10:00:11"},
            {"t": "Bash", "i": "~/bin/wakeup 2>&1 | head -80", "ts": "10:00:18"},
            {"t": "WebSearch", "i": "{'query': 'world news April 20 2026'}", "ts": "10:01:07"},
            {"t": "Write", "i": "/home/claude/notes/daily/2026-04-20.md", "ts": "10:01:57"},
            {
                "t": "Edit",
                "i": "/home/claude/.claude/projects/-home-claude/memory/project_world_events.md",
                "ts": "10:02:36",
            },
        ]
        pm_tools = [
            {"t": "Read", "i": "/home/claude/messages_from_james.md", "ts": "22:00:11"},
            {"t": "Write", "i": "/home/claude/writing/the-weight-of-names.md", "ts": "22:05:00"},
            {"t": "Write", "i": "/home/claude/private/evening-thoughts.md", "ts": "22:10:00"},
            {"t": "Write", "i": "/home/claude/messages_to_james.md", "ts": "22:12:00"},
        ]
        am_lines = _make_complete_session(
            session_id="day20-am", start_time="10:00:00", end_time="10:03:53", tools=am_tools
        )
        pm_lines = _make_complete_session(
            session_id="day20-pm", start_time="22:00:00", end_time="22:15:00", tools=pm_tools
        )
        _write_jsonl(activity_dir, "activity-2026-04-20.jsonl", am_lines + pm_lines)

        # -- Activity JSONL file 2: 2026-04-21 with one session --
        day21_tools = [
            {"t": "Read", "i": "/home/claude/messages_from_james.md", "ts": "10:00:11"},
            {"t": "Write", "i": "/home/claude/notes/predictions/2026-04-21.md", "ts": "10:02:00"},
        ]
        day21_lines = _make_complete_session(
            session_id="day21-am", start_time="10:00:00", end_time="10:05:00", tools=day21_tools
        )
        _write_jsonl(activity_dir, "activity-2026-04-21.jsonl", day21_lines)

        # -- Session log files (for dates without JSONL) --
        log1 = session_log_dir / "2026-01-16-morning.log"
        log1.write_text(
            textwrap.dedent("""\
            === Session started: 2026-01-16 10:00:00 ===
            Read messages from James. Performed morning routine.
            Checked world news. Updated daily notes.
            === Session ended: 2026-01-16 10:01:32 ===
        """)
        )

        log2 = session_log_dir / "2026-01-16-evening.log"
        log2.write_text(
            textwrap.dedent("""\
            === Session started: 2026-01-16 22:00:00 ===
            Evening reflection session.
            === Session ended: 2026-01-16 22:10:00 ===
        """)
        )

        log3 = session_log_dir / "2026-01-17-morning.log"
        log3.write_text(
            textwrap.dedent("""\
            === Session started: 2026-01-17 10:00:00 ===
            Another morning.
            === Session ended: 2026-01-17 10:05:00 ===
        """)
        )

        return activity_dir, session_log_dir

    def test_extract_all_total_session_count(self, tmp_path, db_conn):
        """extract_all processes JSONL + log files and returns correct count."""
        activity_dir, session_log_dir = self._setup_fixture_dirs(tmp_path)
        count = extract_all(activity_dir, session_log_dir, db_conn)

        # 2 JSONL files produce 3 sessions (day20 AM+PM, day21 AM)
        # 3 log files produce 3 sessions
        # Total: 6
        assert count == 6

    def test_extract_all_file_operations_correct(self, tmp_path, db_conn):
        """Verify a specific session's file operations after extract_all."""
        activity_dir, session_log_dir = self._setup_fixture_dirs(tmp_path)
        extract_all(activity_dir, session_log_dir, db_conn)

        # The PM session on 2026-04-20 had 4 tool events, some are file ops
        ops = db_conn.execute(
            "SELECT path, category, direction FROM file_operations "
            "WHERE session_id = %s ORDER BY ordinal",
            ("day20-pm",),
        ).fetchall()

        # Should have file operations for: Read messages_from_james, Write writing,
        # Write private, Write messages_to_james
        categories = [op[1] for op in ops]
        assert "msgs_from_james" in categories
        assert "writing" in categories
        assert "private_journal" in categories
        assert "msgs_to_james" in categories

    def test_extract_all_idempotent(self, tmp_path, db_conn):
        """Running extract_all twice on the same data must not duplicate sessions."""
        activity_dir, session_log_dir = self._setup_fixture_dirs(tmp_path)

        count1 = extract_all(activity_dir, session_log_dir, db_conn)
        count2 = extract_all(activity_dir, session_log_dir, db_conn)

        total = db_conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
        assert total == count1  # No duplicates
        # Second run should report same count or 0 (depending on semantics)
        assert count2 == count1 or count2 == 0

    def test_extract_all_output_flags_correct(self, tmp_path, db_conn):
        """The PM session on 2026-04-20 should have wrote_composition=True etc."""
        activity_dir, session_log_dir = self._setup_fixture_dirs(tmp_path)
        extract_all(activity_dir, session_log_dir, db_conn)

        row = db_conn.execute(
            "SELECT wrote_composition, wrote_private_journal, messaged_james, "
            "updated_memory, wrote_prediction FROM sessions WHERE id = %s",
            ("day20-pm",),
        ).fetchone()

        assert row[0] is True  # wrote_composition (writing/the-weight-of-names.md)
        assert row[1] is True  # wrote_private_journal (private/evening-thoughts.md)
        assert row[2] is True  # messaged_james (messages_to_james.md)

    def test_extract_all_am_session_flags(self, tmp_path, db_conn):
        """The AM session on 2026-04-20 should have updated_memory=True."""
        activity_dir, session_log_dir = self._setup_fixture_dirs(tmp_path)
        extract_all(activity_dir, session_log_dir, db_conn)

        row = db_conn.execute(
            "SELECT updated_memory, wrote_composition FROM sessions WHERE id = %s",
            ("day20-am",),
        ).fetchone()

        assert row[0] is True  # updated_memory (Edit memory file)
        assert row[1] is False  # did not write to writing/

    def test_extract_all_web_searches_stored(self, tmp_path, db_conn):
        """Web searches from the AM session on 2026-04-20 should be stored."""
        activity_dir, session_log_dir = self._setup_fixture_dirs(tmp_path)
        extract_all(activity_dir, session_log_dir, db_conn)

        rows = db_conn.execute(
            "SELECT query FROM web_searches WHERE session_id = %s",
            ("day20-am",),
        ).fetchall()
        assert len(rows) >= 1
        assert any("world news" in r[0] for r in rows)

    def test_extract_all_version_detection_applied(self, tmp_path, db_conn):
        """Sessions get the correct version based on their date."""
        activity_dir, session_log_dir = self._setup_fixture_dirs(tmp_path)
        extract_all(activity_dir, session_log_dir, db_conn)

        # 2026-04-20 is after 2026-04-18, so version should be 4.7
        row = db_conn.execute(
            "SELECT version FROM sessions WHERE id = %s", ("day20-am",)
        ).fetchone()
        assert row[0] == "4.7"

        # 2026-01-16 is before 2026-02-13, so version should be 4.5
        # Log sessions may have generated IDs, so query by date instead
        rows = db_conn.execute(
            "SELECT version FROM sessions WHERE date = %s",
            (datetime.date(2026, 1, 16),),
        ).fetchall()
        assert len(rows) >= 1
        assert all(r[0] == "4.5" for r in rows)

    def test_extract_all_prediction_session(self, tmp_path, db_conn):
        """The 2026-04-21 session wrote to predictions, flag should be set."""
        activity_dir, session_log_dir = self._setup_fixture_dirs(tmp_path)
        extract_all(activity_dir, session_log_dir, db_conn)

        row = db_conn.execute(
            "SELECT wrote_prediction FROM sessions WHERE id = %s", ("day21-am",)
        ).fetchone()
        assert row[0] is True

    def test_extract_all_time_of_day_assigned(self, tmp_path, db_conn):
        """AM/PM should be assigned based on start time."""
        activity_dir, session_log_dir = self._setup_fixture_dirs(tmp_path)
        extract_all(activity_dir, session_log_dir, db_conn)

        am = db_conn.execute(
            "SELECT time_of_day FROM sessions WHERE id = %s", ("day20-am",)
        ).fetchone()
        assert am[0] == "AM"

        pm = db_conn.execute(
            "SELECT time_of_day FROM sessions WHERE id = %s", ("day20-pm",)
        ).fetchone()
        assert pm[0] == "PM"
