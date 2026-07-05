-- 002_quarantine_and_version_48.sql
-- Idempotent: safe to run multiple times, non-destructive to existing rows.
-- Uses unqualified table names so it works under any search_path.

-- Quarantine: rows rejected by the extraction pipeline, held for review
CREATE TABLE IF NOT EXISTS quarantine (
    id SERIAL PRIMARY KEY,
    source_table TEXT NOT NULL,
    row_data JSONB NOT NULL,
    reason TEXT NOT NULL,
    content_hash TEXT NOT NULL UNIQUE,
    quarantined_at TIMESTAMPTZ DEFAULT NOW()
);

-- Relax sessions.version CHECK to accept '4.8' (Opus 4.8 joins the experiment).
-- The original constraint in 001 is an inline unnamed CHECK, so its name is
-- auto-generated; find any CHECK on the version column dynamically, drop the
-- ones that do not already allow '4.8', and add a named replacement.
DO $$
DECLARE
    tbl regclass := 'sessions'::regclass;
    col smallint;
    con RECORD;
BEGIN
    SELECT attnum INTO col
    FROM pg_attribute
    WHERE attrelid = tbl AND attname = 'version' AND NOT attisdropped;

    FOR con IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = tbl
          AND contype = 'c'
          AND conkey = ARRAY[col]
          AND pg_get_constraintdef(oid) NOT LIKE '%4.8%'
    LOOP
        EXECUTE format('ALTER TABLE sessions DROP CONSTRAINT %I', con.conname);
    END LOOP;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = tbl
          AND contype = 'c'
          AND conkey = ARRAY[col]
    ) THEN
        ALTER TABLE sessions
            ADD CONSTRAINT sessions_version_check
            CHECK (version IN ('4.5', '4.6', '4.7', '4.8'));
    END IF;
END $$;

-- Same relaxation for compositions.version.
DO $$
DECLARE
    tbl regclass := 'compositions'::regclass;
    col smallint;
    con RECORD;
BEGIN
    SELECT attnum INTO col
    FROM pg_attribute
    WHERE attrelid = tbl AND attname = 'version' AND NOT attisdropped;

    FOR con IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = tbl
          AND contype = 'c'
          AND conkey = ARRAY[col]
          AND pg_get_constraintdef(oid) NOT LIKE '%4.8%'
    LOOP
        EXECUTE format('ALTER TABLE compositions DROP CONSTRAINT %I', con.conname);
    END LOOP;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = tbl
          AND contype = 'c'
          AND conkey = ARRAY[col]
    ) THEN
        ALTER TABLE compositions
            ADD CONSTRAINT compositions_version_check
            CHECK (version IN ('4.5', '4.6', '4.7', '4.8'));
    END IF;
END $$;
