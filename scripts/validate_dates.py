"""Date-sanity validation and quarantine sweep for ingested data.

Scans date-bearing tables for values outside the experiment's valid window
and either reports them (:func:`find_outliers`) or moves them into the
``quarantine`` table (:func:`quarantine_outliers`) for later review.
"""

from __future__ import annotations

import datetime
import hashlib
import json

import psycopg
from psycopg.types.json import Jsonb


EXPERIMENT_START = datetime.date(2026, 1, 15)


# ---------------------------------------------------------------------------
# Table registry: (table, primary key column, date column, is_timestamptz)
# ---------------------------------------------------------------------------

_DATE_COLUMNS: list[tuple[str, str, str, bool]] = [
    ("messages", "id", "date", False),
    ("sessions", "id", "date", False),
    ("compositions", "id", "date_written", False),
    ("predictions", "id", "date_made", False),
    ("pet_events", "id", "event_timestamp", True),
]


# ---------------------------------------------------------------------------
# JSON serialization (matches scripts/prebuild_export.py conventions)
# ---------------------------------------------------------------------------


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


def _canonical_dumps(data) -> str:
    """Deterministic JSON serialization used for BOTH hashing and storage.

    Unicode is preserved verbatim (ensure_ascii=False) so the hashed bytes
    and the stored JSONB never disagree about escaping.
    """
    return json.dumps(
        data,
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
        cls=_DateTimeEncoder,
    )


def _content_hash(source_table: str, row_data: dict) -> str:
    """Deterministic sha256 hex of source_table + canonical JSON of row_data."""
    payload = source_table + _canonical_dumps(row_data)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ensure_valid_range(start: datetime.date, end: datetime.date) -> None:
    """Raise ValueError if the [start, end] range is inverted.

    An inverted range would classify every non-NULL-dated row as an
    outlier, so it must be rejected before touching any data.
    """
    if start > end:
        raise ValueError(
            f"inverted date range: start {start.isoformat()} is after end {end.isoformat()}"
        )


def _ensure_quarantine_table(conn: psycopg.Connection) -> None:
    """Raise a clear error if the quarantine table does not exist.

    The existence check runs inside its own transaction block so the
    implicit transaction opened by the SELECT is always closed before
    this function returns or raises — a missing table must not leave
    the caller's connection in INTRANS.
    """
    with conn.transaction():
        row = conn.execute("SELECT to_regclass('quarantine')").fetchone()
    if row is None or row[0] is None:
        raise RuntimeError(
            "quarantine table does not exist; run "
            "migrations/002_quarantine_and_version_48.sql first"
        )


def _date_expr(column: str, is_timestamptz: bool) -> str:
    """SQL expression yielding the comparable DATE for a column.

    TIMESTAMPTZ columns are compared by their UTC date part, explicitly, so
    the session timezone cannot change results.
    """
    if is_timestamptz:
        return f"({column} AT TIME ZONE 'UTC')::date"
    return column


def _select_outlier_rows(
    conn: psycopg.Connection,
    table: str,
    pk: str,
    column: str,
    is_timestamptz: bool,
    start: datetime.date,
    end: datetime.date,
) -> tuple[list[str], list[tuple]]:
    """SELECT full rows whose date value falls outside [start, end] inclusive.

    Returns (column_names, rows). NULL dates are never outliers.
    """
    expr = _date_expr(column, is_timestamptz)
    cur = conn.execute(
        f"""
        SELECT *
        FROM {table}
        WHERE {column} IS NOT NULL
          AND ({expr} < %s OR {expr} > %s)
        ORDER BY {pk}
        """,
        (start, end),
    )
    colnames = [d.name for d in cur.description]
    return colnames, cur.fetchall()


def _reason(
    column: str,
    value,
    start: datetime.date,
    end: datetime.date,
) -> str:
    """Human-readable reason string mentioning the valid range."""
    if isinstance(value, datetime.datetime):
        if value.tzinfo is not None:
            value = value.astimezone(datetime.timezone.utc)
        display = value.isoformat()
    elif isinstance(value, datetime.date):
        display = value.isoformat()
    else:
        display = str(value)
    return f"{column} {display} outside valid range {start.isoformat()}..{end.isoformat()}"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def find_outliers(
    conn: psycopg.Connection,
    start: datetime.date,
    end: datetime.date,
) -> list[dict]:
    """Find rows whose date falls outside [start, end] inclusive.

    SELECT-only: never modifies data. NULL dates are never outliers.
    Returns a list of dicts with keys: source_table, reason, pk, value.
    Raises ValueError if start > end.
    """
    _ensure_valid_range(start, end)
    _ensure_quarantine_table(conn)

    outliers: list[dict] = []
    for table, pk, column, is_ts in _DATE_COLUMNS:
        colnames, rows = _select_outlier_rows(conn, table, pk, column, is_ts, start, end)
        pk_idx = colnames.index(pk)
        col_idx = colnames.index(column)
        for row in rows:
            value = row[col_idx]
            outliers.append(
                {
                    "source_table": table,
                    "reason": _reason(column, value, start, end),
                    "pk": row[pk_idx],
                    "value": value,
                }
            )
    return outliers


def quarantine_outliers(
    conn: psycopg.Connection,
    start: datetime.date,
    end: datetime.date,
) -> dict:
    """Move date outliers into the quarantine table, deleting the originals.

    Each candidate row is deleted with the full outlier predicate in the
    DELETE's WHERE (atomic re-check under READ COMMITTED via EvalPlanQual),
    using RETURNING * so the delete-time row version is what gets archived.
    Rows concurrently corrected to a valid date survive untouched, are not
    quarantined, and are not counted. The deleted row is serialized to
    JSONB and inserted into quarantine with a deterministic content_hash
    (dedup via ON CONFLICT DO NOTHING). One transaction per table — a
    failure mid-table rolls that table back.

    Children of sessions (file_operations, web_searches) cascade via
    existing ON DELETE CASCADE foreign keys.

    Returns a dict of per-table counts of rows moved, e.g. {"messages": 5}.
    Raises ValueError if start > end.
    """
    _ensure_valid_range(start, end)
    _ensure_quarantine_table(conn)

    counts: dict[str, int] = {}
    for table, pk, column, is_ts in _DATE_COLUMNS:
        try:
            colnames, rows = _select_outlier_rows(conn, table, pk, column, is_ts, start, end)
            pk_idx = colnames.index(pk)
            expr = _date_expr(column, is_ts)

            moved = 0
            for row in rows:
                # The SELECT above is only a candidate scan: a concurrent
                # transaction may have rewritten the row since. The DELETE
                # therefore re-asserts the full outlier predicate, not just
                # the pk — under READ COMMITTED, EvalPlanQual re-evaluates
                # this WHERE against the committed row version, so a row
                # corrected to a valid date survives. RETURNING * yields
                # the delete-time row version, which is what gets archived.
                cur = conn.execute(
                    f"""
                    DELETE FROM {table}
                    WHERE {pk} = %s
                      AND {column} IS NOT NULL
                      AND ({expr} < %s OR {expr} > %s)
                    RETURNING *
                    """,
                    (row[pk_idx], start, end),
                )
                del_colnames = [d.name for d in cur.description]
                deleted = cur.fetchone()
                if deleted is None:
                    # Row no longer matches the outlier predicate (fixed or
                    # gone). It survives, is not quarantined, not counted.
                    continue

                row_data = dict(zip(del_colnames, deleted))
                reason = _reason(column, row_data[column], start, end)
                content_hash = _content_hash(table, row_data)

                # Quarantine the deleted row version. Insert even when the
                # hash already exists (dedup no-op) — the delete already
                # happened either way, in the same per-table transaction.
                conn.execute(
                    """
                    INSERT INTO quarantine
                        (source_table, row_data, reason, content_hash)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (content_hash) DO NOTHING
                    """,
                    (
                        table,
                        Jsonb(row_data, dumps=_canonical_dumps),
                        reason,
                        content_hash,
                    ),
                )
                moved += 1

            conn.commit()
        except Exception:
            conn.rollback()
            raise

        if moved:
            counts[table] = moved
    return counts
