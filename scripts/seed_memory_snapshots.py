"""One-time seed importer: src/data/memory-snapshots.json -> memory tables.

The MEMORY.md history was originally extracted from the sudo-only JSONL
transcripts under /home/claude, but those transcripts fell to a 30-day
retention sweep and the April--May 2026 files are gone. The exported
``src/data/memory-snapshots.json`` (14 snapshots, 38 blocks,
2026-04-18 .. 2026-05-18) is now the ONLY surviving record of that
history, and the production memory tables are empty. This script imports
the export back into the database — the round-trip inverse of
:func:`scripts.prebuild_export.export_memory_snapshots` — so the
database becomes the authoritative source once more.

Two deliberate departures from a naive re-import:

* Block ``content`` is unrecoverable (the export carries headings only),
  so every seeded block stores an empty string — the column is NOT NULL
  and fabricating content would poison the record.
* The file's ``first_seen_date``/``last_seen_date`` are internally
  inconsistent legacy values and are IGNORED. Block lineage
  (``first_seen_session``/``last_seen_session``) is re-derived from the
  snapshots that actually contain each block, ordered by (date, id) —
  ids are assigned in insert order, so the derived lineage matches the
  export's own ordering. This corrected lineage is what makes the
  seeded database authoritative rather than merely restored.

The import is idempotent and superset-safe: rows that already exist
identically insert zero, new rows in a superset file are added, and
lineage is recomputed globally across the union. Any conflict with
existing rows — a hash with a different heading, a snapshot whose
date/token count/block set changed — is refused, never skipped or
overwritten. The whole import is all-or-nothing: any failure rolls the
entire transaction back and leaves the connection usable.

:func:`main` is the CLI entry point
(``python scripts/seed_memory_snapshots.py [--json PATH]``). It writes
no files, commits only on success, and reports per-table insert counts.

Limitations and non-guarantees:

* Concurrency: the seed assumes it is the only writer. If a concurrent
  writer (e.g. a simultaneous ``run_ingest --with-transcripts``) inserts
  overlapping rows between this script's validation pass and its
  inserts, the import fails gracefully via a unique-constraint
  violation, the entire transaction rolls back, and the seed must be
  retried — the failure mode is a clean abort, never corruption.
* Ordering is not contractual: the order of ``block_hashes`` within a
  snapshot and the order of the ``blocks`` array in the regenerated
  export are NOT guaranteed. Consumers must treat both as sets.
* Empty-string headings are accepted deliberately: the extractor
  produces ``heading = ""`` for bare ``##`` headers, and this importer
  stays consistent with that rather than rejecting such blocks.
"""

from __future__ import annotations

import argparse
import datetime
import json
import sys
from pathlib import Path

if not __package__:
    # Direct execution (`python scripts/seed_memory_snapshots.py`) puts
    # scripts/ on sys.path rather than the repo root that the
    # `scripts.` imports below require.
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg

from scripts.db import connect

DEFAULT_JSON_PATH = Path("src/data/memory-snapshots.json")

_COUNTED_TABLES: tuple[str, ...] = (
    "memory_snapshots",
    "memory_blocks",
    "memory_block_presence",
)


class SeedError(Exception):
    """Operational seed failure; the message names the offending items."""


# ---------------------------------------------------------------------------
# Input validation (pure — no database access)
# ---------------------------------------------------------------------------


def _check_no_nul(value: str, where: str) -> None:
    """Refuse NUL (U+0000) up front: Postgres TEXT rejects it at insert time."""
    if "\x00" in value:
        raise SeedError(f"{where} contains a NUL (U+0000) character, which Postgres TEXT rejects")


def _require_str(value: object, where: str) -> str:
    """A non-empty NUL-free string, or a SeedError naming the field."""
    if not isinstance(value, str) or not value:
        raise SeedError(f"{where} must be a non-empty string, got {value!r}")
    _check_no_nul(value, where)
    return value


def _validate_snapshots(raw_snapshots: list) -> list[dict]:
    """Validate and normalise the snapshots array.

    Returns entries with ``date`` parsed to :class:`datetime.date` and
    ``block_hashes`` deduplicated preserving order (SET semantics — a
    hash repeated within one snapshot yields one presence row). A
    duplicate ``session_id`` within the file is corrupt provenance and
    refused outright.
    """
    seen_ids: set[str] = set()
    snapshots: list[dict] = []
    for i, entry in enumerate(raw_snapshots):
        where = f"snapshots[{i}]"
        if not isinstance(entry, dict):
            raise SeedError(f"{where} must be an object, got {type(entry).__name__}")

        session_id = _require_str(entry.get("session_id"), f"{where}.session_id")
        where = f"{where} (session_id {session_id!r})"

        raw_date = entry.get("date")
        if not isinstance(raw_date, str):
            raise SeedError(f"{where}: date must be a YYYY-MM-DD string, got {raw_date!r}")
        try:
            date = datetime.date.fromisoformat(raw_date)
        except ValueError as e:
            raise SeedError(f"{where}: unparseable date {raw_date!r}: {e}") from e

        token_count = entry.get("token_count")
        if token_count is not None and (
            isinstance(token_count, bool) or not isinstance(token_count, int)
        ):
            raise SeedError(f"{where}: token_count must be an integer or null, got {token_count!r}")

        raw_hashes = entry.get("block_hashes")
        if not isinstance(raw_hashes, list):
            raise SeedError(f"{where}: block_hashes must be a list, got {raw_hashes!r}")
        deduped: list[str] = []
        seen_hashes: set[str] = set()
        for j, block_hash in enumerate(raw_hashes):
            block_hash = _require_str(block_hash, f"{where}: block_hashes[{j}]")
            if block_hash not in seen_hashes:
                seen_hashes.add(block_hash)
                deduped.append(block_hash)

        if session_id in seen_ids:
            raise SeedError(
                f"duplicate snapshot session_id {session_id!r} within the file "
                f"(corrupt provenance); nothing imported"
            )
        seen_ids.add(session_id)

        snapshots.append(
            {
                "session_id": session_id,
                "date": date,
                "token_count": token_count,
                "block_hashes": deduped,
            }
        )
    return snapshots


def _validate_blocks(raw_blocks: list) -> dict[str, str]:
    """Validate the blocks array into an insertion-ordered hash -> heading map.

    Identical duplicate entries (same hash, same heading — the legacy
    date fields never participate in identity) dedupe silently; the same
    hash with a different heading is a conflict and refused.
    """
    headings: dict[str, str] = {}
    for i, entry in enumerate(raw_blocks):
        where = f"blocks[{i}]"
        if not isinstance(entry, dict):
            raise SeedError(f"{where} must be an object, got {type(entry).__name__}")

        block_hash = _require_str(entry.get("hash"), f"{where}.hash")
        heading = entry.get("heading")
        if not isinstance(heading, str):
            raise SeedError(
                f"{where} (hash {block_hash}): heading must be a string, got {heading!r}"
            )
        _check_no_nul(heading, f"{where} (hash {block_hash}): heading")

        if block_hash in headings:
            if headings[block_hash] != heading:
                raise SeedError(
                    f"block hash {block_hash} appears twice in the file with "
                    f"different headings; nothing imported"
                )
            continue  # identical duplicate: dedupe silently
        headings[block_hash] = heading
    return headings


def _parse_file(json_path: Path) -> tuple[list[dict], dict[str, str]]:
    """Load and fully validate the export file before any database work.

    Every guard fires here, so an invalid file leaves the database
    untouched by construction.
    """
    if json_path.is_dir():
        raise SeedError(f"{json_path} is a directory, not a JSON file")
    try:
        text = json_path.read_text(encoding="utf-8")
    except OSError as e:
        raise SeedError(f"cannot read {json_path}: {e}") from e
    except UnicodeDecodeError as e:
        raise SeedError(f"{json_path} is not valid UTF-8: {e}") from e

    try:
        data = json.loads(text)
    except ValueError as e:
        raise SeedError(f"{json_path} is not valid JSON: {e}") from e

    if not isinstance(data, dict):
        raise SeedError(
            f"{json_path}: top level must be an object with 'snapshots' and "
            f"'blocks' lists, got {type(data).__name__}"
        )
    raw_snapshots = data.get("snapshots")
    raw_blocks = data.get("blocks")
    if not isinstance(raw_snapshots, list):
        raise SeedError(f"{json_path}: 'snapshots' must be a list, got {raw_snapshots!r}")
    if not isinstance(raw_blocks, list):
        raise SeedError(f"{json_path}: 'blocks' must be a list, got {raw_blocks!r}")

    snapshots = _validate_snapshots(raw_snapshots)
    headings = _validate_blocks(raw_blocks)

    # Every hash a snapshot references must have a blocks[] entry —
    # heading and content are NOT NULL and cannot be fabricated.
    missing: list[str] = []
    seen_missing: set[str] = set()
    for snapshot in snapshots:
        for block_hash in snapshot["block_hashes"]:
            if block_hash not in headings and block_hash not in seen_missing:
                seen_missing.add(block_hash)
                missing.append(block_hash)
    if missing:
        raise SeedError(
            f"snapshot block_hashes with no blocks[] entry (heading is "
            f"unrecoverable): {', '.join(missing)}; nothing imported"
        )

    return snapshots, headings


# ---------------------------------------------------------------------------
# Database-side conflict checks
# ---------------------------------------------------------------------------


def _check_sessions_exist(conn: psycopg.Connection, session_ids: list[str]) -> None:
    """Every snapshot must reference an existing session; name ALL missing."""
    if not session_ids:
        return
    rows = conn.execute("SELECT id FROM sessions WHERE id = ANY(%s)", (session_ids,)).fetchall()
    known = {row[0] for row in rows}
    missing = [sid for sid in session_ids if sid not in known]
    if missing:
        raise SeedError(
            f"snapshot session_ids not present in the sessions table: "
            f"{', '.join(missing)}; nothing imported"
        )


def _existing_block_ids(conn: psycopg.Connection, headings: dict[str, str]) -> dict[str, int]:
    """Ids of blocks already in the database, refusing heading conflicts.

    An existing hash with a different heading is never overwritten — the
    original is preserved and the import refused.
    """
    if not headings:
        return {}
    rows = conn.execute(
        "SELECT block_hash, heading, id FROM memory_blocks WHERE block_hash = ANY(%s)",
        (list(headings),),
    ).fetchall()
    conflicts = [row[0] for row in rows if row[1] != headings[row[0]]]
    if conflicts:
        raise SeedError(
            f"block hashes already in the database with a different heading "
            f"(originals preserved): {', '.join(conflicts)}; nothing imported"
        )
    return {row[0]: row[2] for row in rows}


def _existing_snapshots(
    conn: psycopg.Connection, snapshots: list[dict]
) -> tuple[dict[str, int], dict[int, set[str]]]:
    """Existing snapshot ids and their presence hash-sets, refusing conflicts.

    A snapshot already in the database must match the file entry exactly
    (date, token_count, and block-hash SET) to count as "already
    imported"; any difference — including an ambiguous duplicate
    session_id in the database itself — is refused.
    """
    if not snapshots:
        return {}, {}
    by_session = {snapshot["session_id"]: snapshot for snapshot in snapshots}
    rows = conn.execute(
        "SELECT id, session_id, date, token_count FROM memory_snapshots WHERE session_id = ANY(%s)",
        (list(by_session),),
    ).fetchall()
    if not rows:
        return {}, {}

    duplicates = sorted({row[1] for row in rows if sum(r[1] == row[1] for r in rows) > 1})
    if duplicates:
        raise SeedError(
            f"multiple existing memory_snapshots rows for session_ids "
            f"{', '.join(duplicates)}; cannot verify an identical import — "
            f"nothing imported"
        )

    presence: dict[int, set[str]] = {row[0]: set() for row in rows}
    presence_rows = conn.execute(
        """
        SELECT mbp.snapshot_id, mb.block_hash
        FROM memory_block_presence mbp
        JOIN memory_blocks mb ON mb.id = mbp.block_id
        WHERE mbp.snapshot_id = ANY(%s)
        """,
        (list(presence),),
    ).fetchall()
    for snapshot_id, block_hash in presence_rows:
        presence[snapshot_id].add(block_hash)

    conflicting: list[str] = []
    snapshot_ids: dict[str, int] = {}
    for snapshot_id, session_id, date, token_count in rows:
        entry = by_session[session_id]
        if (
            date != entry["date"]
            or token_count != entry["token_count"]
            or presence[snapshot_id] != set(entry["block_hashes"])
        ):
            conflicting.append(session_id)
        else:
            snapshot_ids[session_id] = snapshot_id
    if conflicting:
        raise SeedError(
            f"existing memory_snapshots differ from the file (date, "
            f"token_count, or block set) for session_ids "
            f"{', '.join(conflicting)}; nothing imported"
        )
    return snapshot_ids, presence


# ---------------------------------------------------------------------------
# Seeding
# ---------------------------------------------------------------------------


def seed_memory(conn, json_path: Path) -> dict[str, int]:
    """Import the memory-snapshots export into the database.

    Returns counts of INSERTED rows keyed by physical table name. All
    work stays in the caller's open transaction — the caller commits;
    any failure rolls the transaction back here and re-raises, so the
    connection is never left poisoned and nothing is ever partially
    imported.
    """
    snapshots, headings = _parse_file(Path(json_path))
    counts = dict.fromkeys(_COUNTED_TABLES, 0)
    if not snapshots and not headings:
        return counts

    try:
        # Conflict and referential checks — all reads, before any write.
        _check_sessions_exist(conn, [snapshot["session_id"] for snapshot in snapshots])
        block_ids = _existing_block_ids(conn, headings)
        snapshot_ids, existing_presence = _existing_snapshots(conn, snapshots)

        # Blocks: new hashes only. Content is unrecoverable — always ''.
        for block_hash, heading in headings.items():
            if block_hash in block_ids:
                continue
            row = conn.execute(
                "INSERT INTO memory_blocks (block_hash, heading, content) "
                "VALUES (%s, %s, '') RETURNING id",
                (block_hash, heading),
            ).fetchone()
            block_ids[block_hash] = row[0]
            counts["memory_blocks"] += 1

        # Snapshots: new session_ids only, inserted in input array order
        # so serial ids realise the (date, input-order) lineage tie-break.
        for snapshot in snapshots:
            if snapshot["session_id"] in snapshot_ids:
                continue
            row = conn.execute(
                "INSERT INTO memory_snapshots (session_id, date, token_count) "
                "VALUES (%s, %s, %s) RETURNING id",
                (snapshot["session_id"], snapshot["date"], snapshot["token_count"]),
            ).fetchone()
            snapshot_ids[snapshot["session_id"]] = row[0]
            counts["memory_snapshots"] += 1

        # Presence links: SET semantics, missing links only.
        for snapshot in snapshots:
            snapshot_id = snapshot_ids[snapshot["session_id"]]
            already = existing_presence.get(snapshot_id, set())
            for block_hash in snapshot["block_hashes"]:
                if block_hash in already:
                    continue
                conn.execute(
                    "INSERT INTO memory_block_presence (snapshot_id, block_id) VALUES (%s, %s)",
                    (snapshot_id, block_ids[block_hash]),
                )
                counts["memory_block_presence"] += 1

        # Lineage: derived, never trusted. The file's legacy
        # first/last_seen dates are ignored; each block's lineage comes
        # from the snapshots that actually contain it, globally across
        # the union of existing and newly seeded rows, ordered by
        # (date, id). Blocks contained by no snapshot stay NULL/NULL —
        # the heading record survives even without lineage.
        #
        # SINGLE-WRITER assumption: the (date, id) tie-break relies on
        # serial ids realising input order, which holds only when no
        # concurrent writer (e.g. a simultaneous
        # `run_ingest --with-transcripts`) is inserting snapshots. A
        # concurrent insert can claim an id out of input order and
        # silently misorder the tie-broken lineage for equal dates.
        rows = conn.execute(
            """
            SELECT mb.block_hash, ms.session_id
            FROM memory_block_presence mbp
            JOIN memory_blocks mb ON mb.id = mbp.block_id
            JOIN memory_snapshots ms ON ms.id = mbp.snapshot_id
            WHERE mb.block_hash = ANY(%s)
            ORDER BY ms.date, ms.id
            """,
            (list(headings),),
        ).fetchall()
        first_seen: dict[str, str] = {}
        last_seen: dict[str, str] = {}
        for block_hash, session_id in rows:
            first_seen.setdefault(block_hash, session_id)
            last_seen[block_hash] = session_id
        for block_hash in headings:
            conn.execute(
                "UPDATE memory_blocks "
                "SET first_seen_session = %s, last_seen_session = %s "
                "WHERE block_hash = %s",
                (first_seen.get(block_hash), last_seen.get(block_hash), block_hash),
            )
    except SeedError:
        _rollback_quietly(conn)
        raise
    except psycopg.Error as e:
        _rollback_quietly(conn)
        raise SeedError(f"database error during seed (fully rolled back): {e}") from e

    return counts


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _rollback_quietly(conn: psycopg.Connection) -> None:
    """Roll back the connection; hygiene must never mask the real failure."""
    try:
        conn.rollback()
    except Exception:  # noqa: BLE001 — hygiene only
        pass


def _parse_args(argv: list[str]) -> argparse.Namespace:
    """Parse CLI arguments. Pure argparse — no I/O, no side effects."""
    parser = argparse.ArgumentParser(
        prog="seed_memory_snapshots.py",
        description=(
            "One-time seed: import src/data/memory-snapshots.json — the only "
            "surviving record of the MEMORY.md history after transcript "
            "pruning — into the memory tables, deriving corrected block "
            "lineage so the database becomes authoritative."
        ),
    )
    parser.add_argument(
        "--json",
        type=Path,
        default=DEFAULT_JSON_PATH,
        metavar="PATH",
        help="memory-snapshots export file to import (default: %(default)s)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None, conn: psycopg.Connection | None = None) -> int:
    """Run the seed CLI and return a process exit code.

    ``argv=None`` reads sys.argv. An injected ``conn`` is used as-is and
    never closed — on failure it is rolled back, never poisoned; when
    ``conn`` is None exactly one connection is opened via
    :func:`scripts.db.connect` and closed before returning. The import
    commits only on success (0); every operational failure prints the
    offending items to stderr, rolls the whole import back, and exits 1.
    """
    args = _parse_args(sys.argv[1:] if argv is None else argv)

    owns_connection = conn is None
    if owns_connection:
        try:
            conn = connect()
        except Exception as e:  # noqa: BLE001 — operational failures never raise
            print(f"ERROR: could not connect to the database: {e}", file=sys.stderr)
            return 1
    try:
        try:
            counts = seed_memory(conn, args.json)
            conn.commit()
        except Exception as e:  # noqa: BLE001 — operational failures never raise
            _rollback_quietly(conn)
            print(f"ERROR: {e}", file=sys.stderr)
            return 1
        for table in _COUNTED_TABLES:
            print(f"{table} +{counts[table]}")
        return 0
    finally:
        if owns_connection:
            try:
                conn.close()
            except Exception:  # noqa: BLE001 — hygiene only
                pass


if __name__ == "__main__":
    raise SystemExit(main())
