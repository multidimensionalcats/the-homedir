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

-- Relax the version CHECK on sessions and compositions to accept '4.8'
-- (Opus 4.8 joins the experiment).
--
-- Strategy: drop-all-then-recreate. For each table, EVERY CHECK constraint
-- whose column set is exactly the version column (conkey = ARRAY[attnum]) is
-- dropped unconditionally — regardless of its name (quoted via format('%I'),
-- so hostile names with spaces/quotes/unicode are handled), regardless of
-- validity (NOT VALID included), and including any pre-existing constraint
-- already bearing the canonical name. The canonical <table>_version_check is
-- then added unconditionally.
--
-- An earlier revision used a textual heuristic — dropping only constraints
-- whose definition was NOT LIKE '%4.8%'. That inverts on constraints whose
-- text mentions '4.8' but rejects it (e.g. CHECK (version <> '4.8')), which
-- would then survive and block 4.8 inserts; it also let name-squatting and
-- redundant constraint stacks persist. The heuristic was abandoned in favor
-- of catalog-driven identification only (conkey), with no inspection of the
-- constraint definition text.
--
-- Multi-column CHECK constraints that merely involve version (conkey with
-- 2+ elements) are never touched, even if their text mentions '4.8'.
--
-- Idempotent: a second application drops the canonical constraint and
-- recreates it identically, ending in the same state.
DO $$
DECLARE
    tbl text;
    col smallint;
    con RECORD;
BEGIN
    FOREACH tbl IN ARRAY ARRAY['sessions', 'compositions'] LOOP
        SELECT attnum INTO col
        FROM pg_attribute
        WHERE attrelid = tbl::regclass
          AND attname = 'version'
          AND NOT attisdropped;

        IF col IS NULL THEN
            RAISE EXCEPTION 'table % has no version column', tbl;
        END IF;

        FOR con IN
            SELECT conname
            FROM pg_constraint
            WHERE conrelid = tbl::regclass
              AND contype = 'c'
              AND conkey = ARRAY[col]
        LOOP
            EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', tbl, con.conname);
        END LOOP;

        EXECUTE format(
            'ALTER TABLE %I ADD CONSTRAINT %I CHECK (version IN (%L, %L, %L, %L))',
            tbl, tbl || '_version_check', '4.5', '4.6', '4.7', '4.8');
    END LOOP;
END $$;
