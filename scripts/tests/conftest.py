import os
import pathlib
import pytest

os.environ["HOMEDIR_TEST"] = "1"

MIGRATIONS_DIR = pathlib.Path(__file__).parent.parent.parent / "migrations"


@pytest.fixture(scope="session")
def db_conn():
    from scripts.db import connect, get_database_name

    dbname = get_database_name()
    assert dbname.endswith("_test"), f"Refusing to run tests against non-test database: {dbname}"

    conn = connect()
    yield conn
    conn.close()


@pytest.fixture(scope="session", autouse=True)
def setup_schema(db_conn):
    _drop_all_tables(db_conn)
    migration = MIGRATIONS_DIR / "001_initial_schema.sql"
    with open(migration) as f:
        db_conn.execute(f.read())
    db_conn.commit()
    yield
    _drop_all_tables(db_conn)


@pytest.fixture(autouse=True)
def clean_tables(db_conn):
    yield
    _truncate_all_tables(db_conn)


def _drop_all_tables(conn):
    conn.execute("DROP SCHEMA public CASCADE")
    conn.execute("CREATE SCHEMA public")
    conn.commit()


def _truncate_all_tables(conn):
    tables = conn.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public'").fetchall()
    if tables:
        table_names = ", ".join(t[0] for t in tables)
        conn.execute(f"TRUNCATE {table_names} CASCADE")
        conn.commit()
