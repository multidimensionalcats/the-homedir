"""Hostile tests for migrations/002_quarantine_and_version_48.sql.

Covers:
  - New `quarantine` table (structure, JSONB fidelity, uniqueness)
  - Relaxed version CHECK constraints on sessions/compositions ('4.8' allowed)
  - Idempotency of the migration file
  - Applying 001 + 002 against a fresh schema

These tests rely on conftest.setup_schema applying ALL migrations in
sorted order (not just 001). They are expected to FAIL RED until both
the migration file and the conftest change exist.

Cleanup note: conftest's autouse clean_tables truncates every table it
finds in pg_tables for schemaname='public', so rows inserted into the
new quarantine table are covered automatically -- no manual deletes
needed. The fresh-schema test creates its own temporary schema and is
responsible for dropping it itself (clean_tables only sweeps 'public').
"""

import json
import pathlib

import psycopg.errors

MIGRATIONS_DIR = pathlib.Path(__file__).parent.parent.parent / "migrations"
MIGRATION_001 = MIGRATIONS_DIR / "001_initial_schema.sql"
MIGRATION_002 = MIGRATIONS_DIR / "002_quarantine_and_version_48.sql"

# Runtime constants for hostile text -- some of these are hazardous to
# embed as bare literals (RTL override can garble source display).
RTL_OVERRIDE = chr(0x202E)  # U+202E RIGHT-TO-LEFT OVERRIDE
ZWJ = chr(0x200D)  # U+200D ZERO WIDTH JOINER
LONG_STRING = "\N{SNOWMAN}x" * 5000  # 10,000 chars, multibyte-heavy


def _insert_session(conn, session_id, version):
    """Insert a minimal valid sessions row (all NOT NULL columns only)."""
    conn.execute(
        "INSERT INTO sessions (id, date, time_of_day, version, source_type, source_file) "
        "VALUES (%s, '2026-07-01', 'AM', %s, 'jsonl', 'activity-2026-07-01.jsonl')",
        (session_id, version),
    )


def _insert_composition(conn, slug, version):
    """Insert a minimal valid compositions row (slug + filename are NOT NULL)."""
    conn.execute(
        "INSERT INTO compositions (slug, filename, version) VALUES (%s, %s, %s)",
        (slug, f"{slug}.md", version),
    )


# ===========================================================================
# 1. Quarantine table structure
# ===========================================================================


class TestQuarantineTableExists:
    def test_quarantine_table_present(self, db_conn):
        rows = db_conn.execute(
            "SELECT tablename FROM pg_tables "
            "WHERE schemaname = 'public' AND tablename = 'quarantine'"
        ).fetchall()
        assert len(rows) == 1, "quarantine table does not exist"

    def test_quarantine_has_expected_columns_and_types(self, db_conn):
        rows = db_conn.execute(
            "SELECT column_name, data_type, is_nullable "
            "FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = 'quarantine'"
        ).fetchall()
        cols = {r[0]: (r[1], r[2]) for r in rows}

        expected = {"id", "source_table", "row_data", "reason", "content_hash", "quarantined_at"}
        assert expected.issubset(cols.keys()), (
            f"quarantine missing columns: {expected - set(cols.keys())}"
        )

        # Types matter -- a TEXT row_data would silently accept garbage JSON.
        assert cols["row_data"][0] == "jsonb"
        assert cols["quarantined_at"][0] == "timestamp with time zone"

        # NOT NULL enforcement on the columns that carry meaning.
        assert cols["source_table"][1] == "NO"
        assert cols["row_data"][1] == "NO"
        assert cols["reason"][1] == "NO"
        assert cols["content_hash"][1] == "NO"

    def test_quarantine_rejects_null_reason(self, db_conn):
        """NOT NULL must actually be enforced, not just declared."""
        try:
            db_conn.execute(
                "INSERT INTO quarantine (source_table, row_data, reason, content_hash) "
                "VALUES ('sessions', '{}'::jsonb, NULL, 'hash-null-reason')"
            )
            db_conn.commit()
            assert False, "Should have raised NotNullViolation"
        except psycopg.errors.NotNullViolation:
            db_conn.rollback()

    def test_quarantined_at_defaults_to_now(self, db_conn):
        db_conn.execute(
            "INSERT INTO quarantine (source_table, row_data, reason, content_hash) "
            "VALUES ('sessions', '{}'::jsonb, 'test default', 'hash-default-ts')"
        )
        db_conn.commit()
        ts = db_conn.execute(
            "SELECT quarantined_at FROM quarantine WHERE content_hash = 'hash-default-ts'"
        ).fetchone()[0]
        assert ts is not None, "quarantined_at DEFAULT NOW() did not populate"


# ===========================================================================
# 2. content_hash uniqueness
# ===========================================================================


class TestContentHashUniqueness:
    def test_duplicate_content_hash_rejected(self, db_conn):
        db_conn.execute(
            "INSERT INTO quarantine (source_table, row_data, reason, content_hash) "
            "VALUES ('sessions', '{\"a\": 1}'::jsonb, 'first insert', 'dup-hash-01')"
        )
        db_conn.commit()
        try:
            # Different payload, same hash -- uniqueness is on the hash alone.
            db_conn.execute(
                "INSERT INTO quarantine (source_table, row_data, reason, content_hash) "
                "VALUES ('compositions', '{\"b\": 2}'::jsonb, 'second insert', 'dup-hash-01')"
            )
            db_conn.commit()
            assert False, "Should have raised UniqueViolation"
        except psycopg.errors.UniqueViolation:
            db_conn.rollback()

        # The original row must have survived the failed duplicate.
        count = db_conn.execute(
            "SELECT COUNT(*) FROM quarantine WHERE content_hash = 'dup-hash-01'"
        ).fetchone()[0]
        assert count == 1


# ===========================================================================
# 3. JSONB round-trip fidelity under hostile unicode
# ===========================================================================


class TestJsonbRoundTrip:
    def test_hostile_unicode_round_trips_exactly(self, db_conn):
        payload = {
            "emoji": "family: \N{MAN}" + ZWJ + "\N{WOMAN}" + ZWJ + "\N{GIRL}",
            "rtl": "session " + RTL_OVERRIDE + "gol.7102-",
            "zwj_bare": ZWJ * 3,
            "long": LONG_STRING,
            "nested": {"rtl_key" + RTL_OVERRIDE: ["\N{ROBOT FACE}", ZWJ, LONG_STRING[:100]]},
            "numbers": [0, -1, 1.5],
            "null_value": None,
        }
        db_conn.execute(
            "INSERT INTO quarantine (source_table, row_data, reason, content_hash) "
            "VALUES ('sessions', %s::jsonb, 'hostile unicode round-trip', 'unicode-rt-01')",
            (json.dumps(payload),),
        )
        db_conn.commit()

        row = db_conn.execute(
            "SELECT row_data FROM quarantine WHERE content_hash = 'unicode-rt-01'"
        ).fetchone()
        assert row is not None
        stored = row[0]
        if isinstance(stored, str):  # depends on psycopg jsonb adaptation
            stored = json.loads(stored)
        assert stored == payload, "JSONB payload did not round-trip exactly"
        assert len(stored["long"]) == 10000


# ===========================================================================
# 4-5. sessions version constraint: '4.8' allowed, garbage still rejected
# ===========================================================================


class TestSessionsVersionConstraint:
    def test_sessions_accepts_version_48(self, db_conn):
        _insert_session(db_conn, "mig002-v48", "4.8")
        db_conn.commit()
        got = db_conn.execute("SELECT version FROM sessions WHERE id = 'mig002-v48'").fetchone()
        assert got == ("4.8",)

    def test_sessions_preserves_legacy_versions(self, db_conn):
        """The relaxed constraint must be ('4.5','4.6','4.7','4.8') -- a
        'fix' of CHECK (version IN ('4.8')) would pass the accept/reject
        tests in this class while breaking every legacy insert."""
        for ver in ("4.5", "4.6", "4.7"):
            _insert_session(db_conn, f"mig002-legacy-{ver.replace('.', '')}", ver)
        db_conn.commit()
        count = db_conn.execute(
            "SELECT COUNT(*) FROM sessions WHERE id LIKE 'mig002-legacy-%'"
        ).fetchone()[0]
        assert count == 3

    def test_sessions_still_rejects_version_50(self, db_conn):
        # Guard against the lazy fix of dropping the CHECK constraint
        # entirely. First assert the constraint definition actually names
        # '4.8' (this is what makes the test FAIL RED today -- rejecting
        # '5.0' alone would already pass against the 001 schema), then
        # assert '5.0' is still rejected behaviorally.
        defs = db_conn.execute(
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
            "WHERE conrelid = 'sessions'::regclass AND contype = 'c'"
        ).fetchall()
        version_defs = [d[0] for d in defs if "version" in d[0]]
        assert any("4.8" in d for d in version_defs), (
            f"sessions version CHECK does not include '4.8': {version_defs}"
        )

        try:
            _insert_session(db_conn, "mig002-v50", "5.0")
            db_conn.commit()
            assert False, "Should have raised CheckViolation"
        except psycopg.errors.CheckViolation:
            db_conn.rollback()


# ===========================================================================
# 6. compositions version constraint: same pattern
# ===========================================================================


class TestCompositionsVersionConstraint:
    def test_compositions_accepts_48_and_rejects_50(self, db_conn):
        _insert_composition(db_conn, "mig002-comp-48", "4.8")
        db_conn.commit()
        got = db_conn.execute(
            "SELECT version FROM compositions WHERE slug = 'mig002-comp-48'"
        ).fetchone()
        assert got == ("4.8",)

        try:
            _insert_composition(db_conn, "mig002-comp-50", "5.0")
            db_conn.commit()
            assert False, "Should have raised CheckViolation"
        except psycopg.errors.CheckViolation:
            db_conn.rollback()

    def test_compositions_preserves_legacy_versions(self, db_conn):
        """Same guard as sessions: relaxing must not evict '4.5'-'4.7'."""
        for ver in ("4.5", "4.6", "4.7"):
            _insert_composition(db_conn, f"mig002-legacy-comp-{ver.replace('.', '')}", ver)
        db_conn.commit()
        count = db_conn.execute(
            "SELECT COUNT(*) FROM compositions WHERE slug LIKE 'mig002-legacy-comp-%'"
        ).fetchone()[0]
        assert count == 3

    def test_compositions_constraint_definition_names_48(self, db_conn):
        """Belt-and-braces: the CHECK must exist AND include '4.8' --
        dropping the constraint would make the accept test pass while
        silently admitting any garbage version."""
        defs = db_conn.execute(
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
            "WHERE conrelid = 'compositions'::regclass AND contype = 'c'"
        ).fetchall()
        version_defs = [d[0] for d in defs if "version" in d[0]]
        assert version_defs, "compositions has no version CHECK constraint at all"
        assert any("4.8" in d for d in version_defs)


# ===========================================================================
# 7. Migration 002 idempotency
# ===========================================================================


class TestMigration002Idempotent:
    def test_migration_file_applies_twice_without_error(self, db_conn):
        """Fails RED today with FileNotFoundError -- 002 does not exist."""
        with open(MIGRATION_002) as f:
            sql = f.read()
        # Twice in a row against the already-migrated test DB. Each run
        # committed separately so the second run cannot hide behind the
        # first run's uncommitted state.
        db_conn.execute(sql)
        db_conn.commit()
        db_conn.execute(sql)
        db_conn.commit()

    def test_data_survives_reapplication(self, db_conn):
        """Idempotent must mean non-destructive: re-running 002 must not
        drop/recreate quarantine and lose rows, and must not break the
        relaxed constraint."""
        db_conn.execute(
            "INSERT INTO quarantine (source_table, row_data, reason, content_hash) "
            "VALUES ('sessions', '{\"k\": \"v\"}'::jsonb, 'survivor', 'survive-reapply-01')"
        )
        _insert_session(db_conn, "mig002-survivor", "4.8")
        db_conn.commit()

        with open(MIGRATION_002) as f:
            db_conn.execute(f.read())
        db_conn.commit()

        q_count = db_conn.execute(
            "SELECT COUNT(*) FROM quarantine WHERE content_hash = 'survive-reapply-01'"
        ).fetchone()[0]
        s_count = db_conn.execute(
            "SELECT COUNT(*) FROM sessions WHERE id = 'mig002-survivor'"
        ).fetchone()[0]
        assert q_count == 1, "re-applying 002 destroyed quarantine rows"
        assert s_count == 1, "re-applying 002 destroyed sessions rows"

        # And '4.8' must still be accepted afterwards.
        _insert_session(db_conn, "mig002-survivor-2", "4.8")
        db_conn.commit()


# ===========================================================================
# 8. Migration 002 applies on top of a fresh 001 schema
# ===========================================================================


class TestMigration002OnFreshSchema:
    def test_001_then_002_on_fresh_schema(self, db_conn):
        """Run 001 then 002 into a throwaway schema via search_path.

        Choice documented per spec: the shared test DB's public schema is
        already fully migrated by conftest, so 'fresh' is simulated with a
        dedicated temporary schema. The migration files use unqualified
        table names, so pointing search_path at the temp schema exercises
        the true fresh-install ordering (002 must not assume anything 001
        didn't create). The schema is dropped in a finally block because
        conftest's clean_tables only truncates 'public'.
        """
        db_conn.rollback()  # ensure clean transaction state
        schema = "mig002_fresh_test"
        try:
            db_conn.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")
            db_conn.execute(f"CREATE SCHEMA {schema}")
            db_conn.execute(f"SET search_path TO {schema}")

            with open(MIGRATION_001) as f:
                db_conn.execute(f.read())
            with open(MIGRATION_002) as f:
                db_conn.execute(f.read())

            # The fresh schema must be fully functional post-002.
            db_conn.execute(
                "INSERT INTO sessions (id, date, time_of_day, version, source_type, source_file) "
                "VALUES ('fresh-48', '2026-07-01', 'PM', '4.8', 'log', 'fresh.log')"
            )
            db_conn.execute(
                "INSERT INTO quarantine (source_table, row_data, reason, content_hash) "
                "VALUES ('sessions', '{}'::jsonb, 'fresh schema', 'fresh-hash-01')"
            )
            db_conn.commit()

            count = db_conn.execute("SELECT COUNT(*) FROM quarantine").fetchone()[0]
            assert count == 1
        finally:
            db_conn.rollback()
            db_conn.execute("SET search_path TO public")
            db_conn.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")
            db_conn.commit()


# ===========================================================================
# Conftest behavior: all migrations applied in sorted order
# ===========================================================================


class TestConftestAppliesAllMigrations:
    def test_migration_002_file_exists_on_disk(self):
        """The sorted-glob conftest change is meaningless if the file it
        should pick up does not exist. Fails RED via plain assertion
        rather than an insert error, so the failure message is exact."""
        assert MIGRATION_002.is_file(), f"missing migration file: {MIGRATION_002}"

    def test_sorted_glob_puts_001_before_002(self):
        """Guards the ordering assumption sorted(glob('*.sql')) relies on:
        if someone names a migration so it sorts before 001, fresh
        installs break. Also fails RED today (002 absent from the list)."""
        names = [p.name for p in sorted(MIGRATIONS_DIR.glob("*.sql"))]
        assert "001_initial_schema.sql" in names
        assert "002_quarantine_and_version_48.sql" in names
        assert names.index("001_initial_schema.sql") < names.index(
            "002_quarantine_and_version_48.sql"
        )
        assert names[0] == "001_initial_schema.sql", (
            f"a migration sorts before 001 -- fresh installs will break: {names}"
        )
