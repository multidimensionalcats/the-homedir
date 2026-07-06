"""Hostile tests for migrations/002_quarantine_and_version_48.sql.

Covers:
  - New `quarantine` table (structure, JSONB fidelity, uniqueness)
  - Relaxed version CHECK constraints on sessions/compositions ('4.8' allowed)
  - Idempotency of the migration file
  - Applying 001 + 002 against a fresh schema
  - HARDENED CONTRACT (council findings F1/F2): 002 must drop ALL
    single-column CHECK constraints on <table>.version unconditionally
    (no textual inspection of the constraint definition), then create the
    canonical `<table>_version_check CHECK (version IN
    ('4.5','4.6','4.7','4.8'))`. Multi-column CHECKs that merely involve
    version are out of scope and must be left untouched. The current
    `pg_get_constraintdef(oid) NOT LIKE '%4.8%'` heuristic inverts on
    constraints like CHECK (version <> '4.8') -- the text CONTAINS '4.8'
    so the constraint is spared, and 4.8 inserts then fail while the
    migration believes the schema is ready.

These tests rely on conftest.setup_schema applying ALL migrations in
sorted order (not just 001). The original tests were expected to FAIL
RED until the migration file and conftest change existed. The hardened-
contract tests (TestInvertedConstraint... onward) are expected to FAIL
RED against the current LIKE-heuristic migration and pass only once 002
is rewritten to the drop-all-single-column-version-checks contract.

Cleanup note: conftest's autouse clean_tables truncates every table it
finds in pg_tables for schemaname='public', so rows inserted into the
new quarantine table are covered automatically -- no manual deletes
needed. The fresh-schema test creates its own temporary schema and is
responsible for dropping it itself (clean_tables only sweeps 'public').
Hardened-contract tests create adversarial DDL; clean_tables does NOT
undo DDL, so every such test restores constraint state itself via
_restore_version_ddl in a finally block.
"""

import json
import pathlib

import psycopg.errors
from psycopg import sql

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


def _apply_migration_002(conn):
    """Re-execute the 002 migration file against the shared connection.

    Same mechanism conftest.setup_schema uses (execute the file's SQL),
    but scoped to 002 alone so tests can plant adversarial DDL first and
    then observe what a re-run of the migration does to it. Rolls back
    first so a prior expected-failure never poisons the DDL transaction.
    """
    conn.rollback()
    with open(MIGRATION_002) as f:
        conn.execute(f.read())
    conn.commit()


def _version_attnum(conn, table):
    """attnum of <table>.version -- the key pg_constraint.conkey is matched on."""
    row = conn.execute(
        "SELECT attnum FROM pg_attribute "
        "WHERE attrelid = %s::regclass AND attname = 'version' AND NOT attisdropped",
        (table,),
    ).fetchone()
    assert row is not None, f"{table}.version column missing"
    return row[0]


def _single_column_version_checks(conn, table):
    """Sorted names of CHECK constraints whose conkey is EXACTLY [version].

    This is the population the hardened contract says 002 must reduce to
    exactly one canonical constraint. Multi-column CHECKs that involve
    version do not match (conkey has 2+ entries) -- by design.
    """
    col = _version_attnum(conn, table)
    rows = conn.execute(
        "SELECT conname FROM pg_constraint "
        "WHERE conrelid = %s::regclass AND contype = 'c' "
        "AND conkey = ARRAY[%s]::smallint[]",
        (table, col),
    ).fetchall()
    return sorted(r[0] for r in rows)


def _canonical_constraint_def(conn, table):
    """pg_get_constraintdef of <table>_version_check, or None if absent."""
    row = conn.execute(
        "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
        "WHERE conrelid = %s::regclass AND contype = 'c' AND conname = %s",
        (table, f"{table}_version_check"),
    ).fetchone()
    return row[0] if row else None


def _add_check(conn, table, name, predicate, not_valid=False):
    """Add a CHECK constraint with an arbitrary (possibly hostile) name.

    Uses psycopg sql.Identifier so names with spaces, quotes, mixed case
    and non-ASCII survive quoting. `predicate` is a trusted test constant.
    """
    conn.execute(
        sql.SQL("ALTER TABLE {tbl} ADD CONSTRAINT {name} CHECK ({pred}){nv}").format(
            tbl=sql.Identifier(table),
            name=sql.Identifier(name),
            pred=sql.SQL(predicate),
            nv=sql.SQL(" NOT VALID" if not_valid else ""),
        )
    )


def _drop_constraint(conn, table, name):
    conn.execute(
        sql.SQL("ALTER TABLE {tbl} DROP CONSTRAINT {name}").format(
            tbl=sql.Identifier(table), name=sql.Identifier(name)
        )
    )


def _restore_version_ddl(conn):
    """Restore canonical constraint state after adversarial DDL.

    conftest's autouse clean_tables only truncates ROWS; constraints added
    by a test would otherwise leak into every subsequent test. Surgical
    restore: drop every CHECK constraint whose conkey INVOLVES the version
    column (single- or multi-column -- catches both adversarial planted
    constraints and anything a buggy migration left behind), leaving 001's
    inline checks on other columns (time_of_day, source_type, ...) alone,
    then re-apply 002 so the canonical constraint is recreated.
    """
    conn.rollback()
    for table in ("sessions", "compositions"):
        col = _version_attnum(conn, table)
        names = [
            r[0]
            for r in conn.execute(
                "SELECT conname FROM pg_constraint "
                "WHERE conrelid = %s::regclass AND contype = 'c' AND %s = ANY(conkey)",
                (table, col),
            ).fetchall()
        ]
        for name in names:
            _drop_constraint(conn, table, name)
    conn.commit()
    _apply_migration_002(conn)


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


# ===========================================================================
# HARDENED CONTRACT (council findings F1/F2)
#
# 002 must drop ALL single-column CHECK constraints on version -- no
# textual inspection -- then create the canonical named constraint.
# Everything below plants adversarial DDL, re-applies 002 via
# _apply_migration_002, asserts the contract, and restores DDL state in
# a finally block (clean_tables cannot undo DDL).
# ===========================================================================


# All four versions the canonical constraint must admit; used to assert
# the recreated constraint definition names every one of them.
CANONICAL_VERSIONS = ("4.5", "4.6", "4.7", "4.8")


class TestInvertedConstraintSessions:
    """F1: THE INVERSION CASE. CHECK (version <> '4.8') CONTAINS the
    string '4.8', so the LIKE heuristic spares it -- then every 4.8
    insert dies while the migration believes the schema is ready. The
    hardened contract drops it unconditionally. Fails RED against the
    current 002."""

    def test_inverted_check_containing_48_is_dropped(self, db_conn):
        try:
            db_conn.rollback()
            _add_check(db_conn, "sessions", "sessions_no48_trap", "version <> '4.8'")
            db_conn.commit()

            _apply_migration_002(db_conn)

            # 4.8 must now be insertable -- the trap constraint is gone.
            _insert_session(db_conn, "hardened-inv-s48", "4.8")
            db_conn.commit()
            got = db_conn.execute(
                "SELECT version FROM sessions WHERE id = 'hardened-inv-s48'"
            ).fetchone()
            assert got == ("4.8",)

            # 5.0 must still be rejected -- "drop them all" must not mean
            # "drop them all and forget to recreate the canonical one".
            try:
                _insert_session(db_conn, "hardened-inv-s50", "5.0")
                db_conn.commit()
                assert False, "version='5.0' accepted -- canonical CHECK missing after 002"
            except psycopg.errors.CheckViolation:
                db_conn.rollback()

            # Exactly one single-column version check remains, canonically named.
            assert _single_column_version_checks(db_conn, "sessions") == ["sessions_version_check"]
        finally:
            _restore_version_ddl(db_conn)


class TestInvertedConstraintCompositions:
    """F2: same inversion, compositions table."""

    def test_inverted_check_containing_48_is_dropped(self, db_conn):
        try:
            db_conn.rollback()
            _add_check(db_conn, "compositions", "compositions_no48_trap", "version <> '4.8'")
            db_conn.commit()

            _apply_migration_002(db_conn)

            _insert_composition(db_conn, "hardened-inv-c48", "4.8")
            db_conn.commit()
            got = db_conn.execute(
                "SELECT version FROM compositions WHERE slug = 'hardened-inv-c48'"
            ).fetchone()
            assert got == ("4.8",)

            try:
                _insert_composition(db_conn, "hardened-inv-c50", "5.0")
                db_conn.commit()
                assert False, "version='5.0' accepted -- canonical CHECK missing after 002"
            except psycopg.errors.CheckViolation:
                db_conn.rollback()

            assert _single_column_version_checks(db_conn, "compositions") == [
                "compositions_version_check"
            ]
        finally:
            _restore_version_ddl(db_conn)


class TestHostileConstraintNames:
    """Constraint names are attacker-controlled schema drift: mixed case,
    spaces, embedded double quotes, non-ASCII. The migration's dynamic
    DROP must quote them correctly (format %I or equivalent) and the
    hardened contract must drop them regardless of their definition
    text -- this one's predicate also rejects 4.8, so it doubles as an
    inversion case and fails RED today."""

    EVIL_NAME = 'Evil "Check" \N{CHECK MARK} 4.8 trap'

    def test_hostile_quoted_name_dropped_and_canonical_added(self, db_conn):
        try:
            db_conn.rollback()
            _add_check(db_conn, "sessions", self.EVIL_NAME, "version NOT IN ('4.8')")
            db_conn.commit()

            # Sanity: the hostile name really exists before 002 runs, so a
            # passing test can't be explained by the ADD having failed.
            assert self.EVIL_NAME in _single_column_version_checks(db_conn, "sessions")

            _apply_migration_002(db_conn)

            names = _single_column_version_checks(db_conn, "sessions")
            assert self.EVIL_NAME not in names, "hostile-named constraint survived 002"
            assert names == ["sessions_version_check"]

            _insert_session(db_conn, "hardened-evilname-48", "4.8")
            db_conn.commit()
        finally:
            _restore_version_ddl(db_conn)

    def test_canonical_name_squatted_with_wrong_predicate_is_replaced(self, db_conn):
        """Nastiest drift: a constraint that already HAS the canonical
        name but the WRONG predicate. A lazy 'IF NOT EXISTS by name'
        guard would spare it forever. Drop-all-then-recreate must end
        with the canonical name AND the canonical predicate."""
        try:
            db_conn.rollback()
            for name in _single_column_version_checks(db_conn, "sessions"):
                _drop_constraint(db_conn, "sessions", name)
            _add_check(db_conn, "sessions", "sessions_version_check", "version <> '4.8'")
            db_conn.commit()

            _apply_migration_002(db_conn)

            assert _single_column_version_checks(db_conn, "sessions") == ["sessions_version_check"]
            condef = _canonical_constraint_def(db_conn, "sessions")
            assert condef is not None
            for ver in CANONICAL_VERSIONS:
                assert ver in condef, (
                    f"canonical sessions_version_check does not admit '{ver}': {condef}"
                )

            _insert_session(db_conn, "hardened-squat-48", "4.8")
            db_conn.commit()
            try:
                _insert_session(db_conn, "hardened-squat-50", "5.0")
                db_conn.commit()
                assert False, "version='5.0' accepted after canonical-name squat"
            except psycopg.errors.CheckViolation:
                db_conn.rollback()
        finally:
            _restore_version_ddl(db_conn)


class TestRedundantConstraintStack:
    """Multiple redundant single-column version checks stacked up --
    including an exact duplicate of the canonical predicate under a
    different name (spared by the LIKE heuristic: contains '4.8') and a
    NOT VALID inverted trap (also spared today). After 002 exactly ONE
    must remain: the canonical."""

    STACK = (
        # (name, predicate, not_valid)
        ("sessions_dup_allow48", "version IN ('4.5', '4.6', '4.7', '4.8')", False),
        ("sessions_len3", "length(version) = 3", False),
        ("sessions_regex", "version ~ '^[0-9][.][0-9]$'", False),
        ("sessions_notvalid_trap", "version <> '4.8'", True),
    )

    def test_stack_collapses_to_single_canonical(self, db_conn):
        try:
            db_conn.rollback()
            for name, predicate, not_valid in self.STACK:
                _add_check(db_conn, "sessions", name, predicate, not_valid=not_valid)
            db_conn.commit()

            # Sanity: the stack is really there (canonical + 4 planted).
            assert len(_single_column_version_checks(db_conn, "sessions")) >= 5

            _apply_migration_002(db_conn)

            assert _single_column_version_checks(db_conn, "sessions") == [
                "sessions_version_check"
            ], "redundant single-column version checks survived 002"

            _insert_session(db_conn, "hardened-stack-48", "4.8")
            db_conn.commit()
            try:
                _insert_session(db_conn, "hardened-stack-50", "5.0")
                db_conn.commit()
                assert False, "version='5.0' accepted after stack collapse"
            except psycopg.errors.CheckViolation:
                db_conn.rollback()
        finally:
            _restore_version_ddl(db_conn)


class TestMultiColumnChecksOutOfScope:
    """Multi-column CHECKs that merely INVOLVE version (conkey has 2+
    columns) are explicitly out of scope: 002 must leave them untouched.
    Guards against over-correcting the LIKE bug into 'drop everything
    that mentions version'. One probe's text even contains '4.8' to
    prove definition text plays no role in either direction. (These may
    already pass against the current 002 -- they pin the rewrite's
    scope, not the inversion bug.)"""

    def test_multicolumn_checks_survive_002(self, db_conn):
        probes = (
            ("sessions", "sessions_multicol_probe", "version <> '9.9' OR turns IS NULL"),
            ("sessions", "sessions_multicol_48text", "version <> '4.8' OR turns IS NULL"),
            (
                "compositions",
                "compositions_multicol_probe",
                "version <> '9.9' OR size_bytes IS NULL",
            ),
        )
        try:
            db_conn.rollback()
            for table, name, predicate in probes:
                _add_check(db_conn, table, name, predicate)
            db_conn.commit()

            _apply_migration_002(db_conn)

            for table, name, _predicate in probes:
                row = db_conn.execute(
                    "SELECT array_length(conkey, 1) FROM pg_constraint "
                    "WHERE conrelid = %s::regclass AND contype = 'c' AND conname = %s",
                    (table, name),
                ).fetchone()
                assert row is not None, f"multi-column CHECK {name} was dropped by 002"
                assert row[0] == 2, f"{name} is not the 2-column constraint we planted"

            # Canonical single-column constraint coexists with the probes...
            assert _single_column_version_checks(db_conn, "sessions") == ["sessions_version_check"]
            assert _single_column_version_checks(db_conn, "compositions") == [
                "compositions_version_check"
            ]

            # ...and 4.8 inserts satisfy both canonical and probes.
            _insert_session(db_conn, "hardened-multicol-48", "4.8")
            _insert_composition(db_conn, "hardened-multicol-c48", "4.8")
            db_conn.commit()
        finally:
            _restore_version_ddl(db_conn)


class TestIdempotencyWithDataPresent:
    """The hardened drop-all-then-recreate re-validates existing rows on
    ADD CONSTRAINT. With committed '4.8' (and legacy) rows present, 002
    applied twice must not error, must not lose rows, and must leave
    constraint behavior intact."""

    def test_double_reapply_with_48_rows_present(self, db_conn):
        db_conn.rollback()
        for ver in CANONICAL_VERSIONS:
            _insert_session(db_conn, f"hardened-idem-{ver.replace('.', '')}", ver)
        _insert_composition(db_conn, "hardened-idem-c48", "4.8")
        db_conn.commit()

        _apply_migration_002(db_conn)
        _apply_migration_002(db_conn)

        s_count = db_conn.execute(
            "SELECT COUNT(*) FROM sessions WHERE id LIKE 'hardened-idem-%'"
        ).fetchone()[0]
        c_count = db_conn.execute(
            "SELECT COUNT(*) FROM compositions WHERE slug = 'hardened-idem-c48'"
        ).fetchone()[0]
        assert s_count == 4, "re-applying 002 lost sessions rows"
        assert c_count == 1, "re-applying 002 lost compositions rows"

        # Constraint behavior intact after the double run.
        _insert_session(db_conn, "hardened-idem-post-48", "4.8")
        db_conn.commit()
        try:
            _insert_session(db_conn, "hardened-idem-post-50", "5.0")
            db_conn.commit()
            assert False, "version='5.0' accepted after double re-apply"
        except psycopg.errors.CheckViolation:
            db_conn.rollback()
        try:
            _insert_composition(db_conn, "hardened-idem-post-c50", "5.0")
            db_conn.commit()
            assert False, "compositions version='5.0' accepted after double re-apply"
        except psycopg.errors.CheckViolation:
            db_conn.rollback()

        # No duplicate constraints accumulated across runs.
        assert _single_column_version_checks(db_conn, "sessions") == ["sessions_version_check"]
        assert _single_column_version_checks(db_conn, "compositions") == [
            "compositions_version_check"
        ]


class TestConstraintCountAudit:
    """Catalog-level audit: after a re-apply on the pristine schema,
    pg_constraint holds EXACTLY ONE contype='c' constraint per table
    whose conkey is exactly the version column, it carries the canonical
    name, and its definition admits all four versions. Behavioral tests
    can be fooled by overlapping constraints; the catalog cannot."""

    def test_exactly_one_single_column_version_check_per_table(self, db_conn):
        _apply_migration_002(db_conn)

        for table in ("sessions", "compositions"):
            names = _single_column_version_checks(db_conn, table)
            assert names == [f"{table}_version_check"], (
                f"{table}: expected exactly the canonical single-column version "
                f"check, found {names}"
            )
            condef = _canonical_constraint_def(db_conn, table)
            for ver in CANONICAL_VERSIONS:
                assert ver in condef, f"{table}_version_check does not admit '{ver}': {condef}"

        # Quarantine half of 002 is unchanged by the hardening.
        rows = db_conn.execute(
            "SELECT tablename FROM pg_tables "
            "WHERE schemaname = 'public' AND tablename = 'quarantine'"
        ).fetchall()
        assert len(rows) == 1, "quarantine table missing after hardened 002"
