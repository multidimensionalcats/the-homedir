"""Smoke tests to verify database schema and test infrastructure."""


EXPECTED_TABLES = {
    "sessions",
    "file_operations",
    "web_searches",
    "compositions",
    "daily_notes",
    "messages",
    "memory_snapshots",
    "memory_blocks",
    "memory_block_presence",
    "predictions",
    "pet_events",
}


class TestSchemaExists:
    def test_all_expected_tables_exist(self, db_conn):
        rows = db_conn.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
        ).fetchall()
        tables = {r[0] for r in rows}
        assert tables == EXPECTED_TABLES

    def test_sessions_table_has_correct_columns(self, db_conn):
        rows = db_conn.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'sessions' AND table_schema = 'public' "
            "ORDER BY ordinal_position"
        ).fetchall()
        columns = [r[0] for r in rows]
        assert "id" in columns
        assert "date" in columns
        assert "version" in columns
        assert "tokens_total_input" in columns
        assert "wrote_composition" in columns
        assert "source_type" in columns

    def test_file_operations_fk_enforced(self, db_conn):
        """Inserting a file_operation with a nonexistent session_id must fail."""
        import psycopg.errors

        try:
            db_conn.execute(
                "INSERT INTO file_operations (session_id, path, category, method, direction) "
                "VALUES ('nonexistent', '/fake', 'other', 'Read', 'read')"
            )
            db_conn.commit()
            assert False, "Should have raised ForeignKeyViolation"
        except psycopg.errors.ForeignKeyViolation:
            db_conn.rollback()

    def test_sessions_version_check_constraint(self, db_conn):
        """Version must be one of 4.5, 4.6, 4.7."""
        import psycopg.errors

        try:
            db_conn.execute(
                "INSERT INTO sessions (id, date, time_of_day, version, source_type, source_file) "
                "VALUES ('test1', '2026-01-15', 'AM', '3.9', 'log', 'test.log')"
            )
            db_conn.commit()
            assert False, "Should have raised CheckViolation"
        except psycopg.errors.CheckViolation:
            db_conn.rollback()

    def test_sessions_time_of_day_check_constraint(self, db_conn):
        """time_of_day must be AM or PM."""
        import psycopg.errors

        try:
            db_conn.execute(
                "INSERT INTO sessions (id, date, time_of_day, version, source_type, source_file) "
                "VALUES ('test2', '2026-01-15', 'NOON', '4.5', 'log', 'test.log')"
            )
            db_conn.commit()
            assert False, "Should have raised CheckViolation"
        except psycopg.errors.CheckViolation:
            db_conn.rollback()

    def test_compositions_slug_unique(self, db_conn):
        """Duplicate slugs must be rejected."""
        import psycopg.errors

        db_conn.execute(
            "INSERT INTO compositions (slug, filename) VALUES ('test-slug', 'test.md')"
        )
        db_conn.commit()
        try:
            db_conn.execute(
                "INSERT INTO compositions (slug, filename) VALUES ('test-slug', 'other.md')"
            )
            db_conn.commit()
            assert False, "Should have raised UniqueViolation"
        except psycopg.errors.UniqueViolation:
            db_conn.rollback()

    def test_daily_notes_date_unique(self, db_conn):
        """Only one daily note per date."""
        import psycopg.errors

        db_conn.execute(
            "INSERT INTO daily_notes (date, filename) VALUES ('2026-03-01', 'note1.md')"
        )
        db_conn.commit()
        try:
            db_conn.execute(
                "INSERT INTO daily_notes (date, filename) VALUES ('2026-03-01', 'note2.md')"
            )
            db_conn.commit()
            assert False, "Should have raised UniqueViolation"
        except psycopg.errors.UniqueViolation:
            db_conn.rollback()

    def test_memory_block_presence_composite_pk(self, db_conn):
        """memory_block_presence uses (snapshot_id, block_id) as composite PK."""
        db_conn.execute(
            "INSERT INTO sessions (id, date, time_of_day, version, source_type, source_file) "
            "VALUES ('s1', '2026-01-15', 'AM', '4.5', 'log', 'test.log')"
        )
        db_conn.execute(
            "INSERT INTO memory_snapshots (id, session_id, date) VALUES (1, 's1', '2026-01-15')"
        )
        db_conn.execute(
            "INSERT INTO memory_blocks (id, block_hash, heading, content) "
            "VALUES (1, 'abc123', '## Test', 'content')"
        )
        db_conn.execute(
            "INSERT INTO memory_block_presence (snapshot_id, block_id) VALUES (1, 1)"
        )
        db_conn.commit()

        import psycopg.errors

        try:
            db_conn.execute(
                "INSERT INTO memory_block_presence (snapshot_id, block_id) VALUES (1, 1)"
            )
            db_conn.commit()
            assert False, "Should have raised UniqueViolation"
        except psycopg.errors.UniqueViolation:
            db_conn.rollback()

    def test_predictions_confidence_range(self, db_conn):
        """Confidence must be between 0 and 1."""
        import psycopg.errors

        try:
            db_conn.execute(
                "INSERT INTO predictions (text, confidence) VALUES ('test', 1.5)"
            )
            db_conn.commit()
            assert False, "Should have raised CheckViolation"
        except psycopg.errors.CheckViolation:
            db_conn.rollback()

    def test_cascade_delete_session_removes_file_ops(self, db_conn):
        """Deleting a session cascades to file_operations."""
        db_conn.execute(
            "INSERT INTO sessions (id, date, time_of_day, version, source_type, source_file) "
            "VALUES ('cascade_test', '2026-02-01', 'PM', '4.6', 'jsonl', 'test.jsonl')"
        )
        db_conn.execute(
            "INSERT INTO file_operations (session_id, path, category, method, direction) "
            "VALUES ('cascade_test', '/test', 'other', 'Read', 'read')"
        )
        db_conn.commit()

        db_conn.execute("DELETE FROM sessions WHERE id = 'cascade_test'")
        db_conn.commit()

        count = db_conn.execute(
            "SELECT COUNT(*) FROM file_operations WHERE session_id = 'cascade_test'"
        ).fetchone()[0]
        assert count == 0

    def test_migration_is_idempotent(self, db_conn):
        """Running the migration a second time should not error."""
        import pathlib

        migration = pathlib.Path(__file__).parent.parent.parent / "migrations" / "001_initial_schema.sql"
        with open(migration) as f:
            sql = f.read()
        db_conn.execute(sql)
        db_conn.commit()
