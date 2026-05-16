"""Export database contents to JSON files for the static site prebuild step."""

from __future__ import annotations

import datetime
import json
from pathlib import Path


class _DateTimeEncoder(json.JSONEncoder):
    """Custom JSON encoder that handles date/datetime objects."""

    def default(self, obj):
        if isinstance(obj, datetime.datetime):
            if obj.tzinfo is None:
                obj = obj.replace(tzinfo=datetime.timezone.utc)
            else:
                obj = obj.astimezone(datetime.timezone.utc)
            return obj.isoformat()
        if isinstance(obj, datetime.date):
            return obj.isoformat()
        return super().default(obj)


def _write_json(path: Path, data) -> None:
    """Write data to a JSON file with indent=2 and a trailing newline."""
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, cls=_DateTimeEncoder)
        f.write("\n")


def export_sessions(conn, output_dir: Path) -> Path:
    """Export sessions with attention profiles, web searches, and output flags."""
    output_dir = Path(output_dir)

    # Fetch all sessions
    rows = conn.execute(
        """
        SELECT id, date, time_of_day, version, timestamp_start, turns,
               tokens_total_input, tokens_total_output, tokens_cache_read,
               tokens_cache_create, tokens_fresh_input,
               wrote_composition, wrote_private_journal, updated_memory,
               messaged_james, wrote_prediction
        FROM sessions
        ORDER BY date, time_of_day
        """
    ).fetchall()

    # Bulk pre-fetch file_operations grouped by session_id, category, direction
    fo_all = conn.execute(
        """
        SELECT session_id, category, direction, COUNT(*) as cnt
        FROM file_operations
        GROUP BY session_id, category, direction
        """
    ).fetchall()

    fo_by_session: dict = {}
    for fo_row in fo_all:
        sid, cat, direction, cnt = fo_row[0], fo_row[1], fo_row[2], fo_row[3]
        profile = fo_by_session.setdefault(sid, {})
        if cat not in profile:
            profile[cat] = {"reads": 0, "writes": 0}
        if direction == "read":
            profile[cat]["reads"] = cnt
        elif direction == "write":
            profile[cat]["writes"] = cnt

    # Bulk pre-fetch web_searches ordered by session_id, ordinal
    ws_all = conn.execute(
        """
        SELECT session_id, query
        FROM web_searches
        ORDER BY session_id, ordinal
        """
    ).fetchall()

    ws_by_session: dict = {}
    for ws_row in ws_all:
        ws_by_session.setdefault(ws_row[0], []).append(ws_row[1])

    sessions = []
    for row in rows:
        session_id = row[0]

        # Token fields (top-level, null when absent)
        token_fields = {
            "tokens_total_input": row[6],
            "tokens_total_output": row[7],
            "tokens_cache_read": row[8],
            "tokens_cache_create": row[9],
            "tokens_fresh_input": row[10],
        }

        attention_profile = fo_by_session.get(session_id, {})
        web_searches = ws_by_session.get(session_id, [])

        # Output flags (top-level)
        output_flags = {
            "wrote_composition": row[11],
            "wrote_private_journal": row[12],
            "updated_memory": row[13],
            "messaged_james": row[14],
            "wrote_prediction": row[15],
        }

        session = {
            "id": session_id,
            "date": row[1],
            "time_of_day": row[2],
            "version": row[3],
            "timestamp_start": row[4],
            "turns": row[5],
            **token_fields,
            "attention_profile": attention_profile,
            "web_searches": web_searches,
            **output_flags,
        }
        sessions.append(session)

    out_path = output_dir / "sessions.json"
    _write_json(out_path, sessions)

    return out_path


def export_writing_metadata(conn, output_dir: Path) -> Path:
    """Export composition metadata (excluding content)."""
    output_dir = Path(output_dir)

    rows = conn.execute(
        """
        SELECT slug, filename, title, date_written, session_id,
               version, size_bytes, topic
        FROM compositions
        ORDER BY date_written NULLS LAST, slug
        """
    ).fetchall()

    compositions = []
    for row in rows:
        compositions.append(
            {
                "slug": row[0],
                "filename": row[1],
                "title": row[2],
                "date_written": row[3],
                "session_id": row[4],
                "version": row[5],
                "size_bytes": row[6],
                "topic": row[7],
            }
        )

    out_path = output_dir / "writing-metadata.json"
    _write_json(out_path, compositions)

    return out_path


def export_messages(conn, output_dir: Path) -> Path:
    """Export all messages ordered by date."""
    output_dir = Path(output_dir)

    rows = conn.execute(
        """
        SELECT direction, date, content, line_start, line_end
        FROM messages
        ORDER BY date NULLS LAST, id
        """
    ).fetchall()

    messages = []
    for row in rows:
        messages.append(
            {
                "direction": row[0],
                "date": row[1],
                "content": row[2],
                "line_start": row[3],
                "line_end": row[4],
            }
        )

    out_path = output_dir / "messages.json"
    _write_json(out_path, messages)

    return out_path


def export_predictions(conn, output_dir: Path) -> Path:
    """Export all predictions."""
    output_dir = Path(output_dir)

    rows = conn.execute(
        """
        SELECT text, confidence, date_made, resolution_date, outcome, self_assessment
        FROM predictions
        ORDER BY date_made NULLS LAST, id
        """
    ).fetchall()

    predictions = []
    for row in rows:
        predictions.append(
            {
                "text": row[0],
                "confidence": row[1],
                "date_made": row[2],
                "resolution_date": row[3],
                "outcome": row[4],
                "self_assessment": row[5],
            }
        )

    out_path = output_dir / "predictions.json"
    _write_json(out_path, predictions)

    return out_path


def export_pet_timeline(conn, output_dir: Path) -> Path:
    """Export pet events ordered by timestamp."""
    output_dir = Path(output_dir)

    rows = conn.execute(
        """
        SELECT pet_name, event_type, event_timestamp, notes
        FROM pet_events
        ORDER BY event_timestamp NULLS LAST, id
        """
    ).fetchall()

    events = []
    for row in rows:
        events.append(
            {
                "pet_name": row[0],
                "event_type": row[1],
                "event_timestamp": row[2],
                "notes": row[3],
            }
        )

    out_path = output_dir / "pet-timeline.json"
    _write_json(out_path, events)

    return out_path


def export_memory_snapshots(conn, output_dir: Path) -> Path:
    """Export memory snapshots and blocks (without full content)."""
    output_dir = Path(output_dir)

    # Fetch snapshots
    snap_rows = conn.execute(
        """
        SELECT ms.id, ms.session_id, ms.date, ms.token_count
        FROM memory_snapshots ms
        ORDER BY ms.date, ms.id
        """
    ).fetchall()

    # Bulk pre-fetch block hashes grouped by snapshot_id
    bp_all = conn.execute(
        """
        SELECT mbp.snapshot_id, mb.block_hash
        FROM memory_block_presence mbp
        JOIN memory_blocks mb ON mb.id = mbp.block_id
        ORDER BY mbp.snapshot_id, mb.id
        """
    ).fetchall()

    bp_by_snapshot: dict = {}
    for bp_row in bp_all:
        bp_by_snapshot.setdefault(bp_row[0], []).append(bp_row[1])

    snapshots = []
    for snap_row in snap_rows:
        snap_id = snap_row[0]
        block_hashes = bp_by_snapshot.get(snap_id, [])

        snapshots.append(
            {
                "session_id": snap_row[1],
                "date": snap_row[2],
                "token_count": snap_row[3],
                "block_hashes": block_hashes,
            }
        )

    # Fetch blocks with first/last seen dates via JOIN to sessions
    block_rows = conn.execute(
        """
        SELECT mb.block_hash, mb.heading,
               s_first.date AS first_seen_date,
               s_last.date AS last_seen_date
        FROM memory_blocks mb
        LEFT JOIN sessions s_first ON s_first.id = mb.first_seen_session
        LEFT JOIN sessions s_last ON s_last.id = mb.last_seen_session
        ORDER BY mb.id
        """
    ).fetchall()

    blocks = []
    for block_row in block_rows:
        blocks.append(
            {
                "hash": block_row[0],
                "heading": block_row[1],
                "first_seen_date": block_row[2],
                "last_seen_date": block_row[3],
            }
        )

    output = {
        "snapshots": snapshots,
        "blocks": blocks,
    }

    out_path = output_dir / "memory-snapshots.json"
    _write_json(out_path, output)

    return out_path


def export_all(conn, output_dir: Path) -> list[Path]:
    """Run all export functions. Create output_dir if needed. Return list of file paths."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    paths = [
        export_sessions(conn, output_dir),
        export_writing_metadata(conn, output_dir),
        export_messages(conn, output_dir),
        export_predictions(conn, output_dir),
        export_pet_timeline(conn, output_dir),
        export_memory_snapshots(conn, output_dir),
    ]

    return paths
