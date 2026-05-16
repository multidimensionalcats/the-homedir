import os
import psycopg


def get_database_name() -> str:
    base = os.environ.get("HOMEDIR_DB", "homedir")
    if os.environ.get("HOMEDIR_TEST") == "1":
        if not base.endswith("_test"):
            base = f"{base}_test"
    return base


def get_connection_params() -> dict:
    return {
        "dbname": get_database_name(),
        "user": os.environ.get("HOMEDIR_DB_USER", "james"),
        "host": os.environ.get("HOMEDIR_DB_HOST", "/run/postgresql"),
        "port": int(os.environ.get("HOMEDIR_DB_PORT", "5432")),
    }


def connect(**overrides) -> psycopg.Connection:
    params = get_connection_params()
    params.update(overrides)
    return psycopg.connect(**params)


def run_migration(conn: psycopg.Connection, migration_path: str) -> None:
    with open(migration_path) as f:
        sql = f.read()
    conn.execute(sql)
    conn.commit()
