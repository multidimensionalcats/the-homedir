-- 001_initial_schema.sql
-- Idempotent: safe to run multiple times

-- Sessions: one row per Claude session (206 total across experiment)
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    date DATE NOT NULL,
    time_of_day TEXT NOT NULL CHECK (time_of_day IN ('AM', 'PM')),
    version TEXT NOT NULL CHECK (version IN ('4.5', '4.6', '4.7')),
    timestamp_start TIMESTAMPTZ,
    turns INTEGER,
    source_type TEXT NOT NULL CHECK (source_type IN ('jsonl', 'log')),
    source_file TEXT NOT NULL,

    -- Token counts (nullable — pre-JSONL sessions have none)
    tokens_total_input INTEGER,
    tokens_total_output INTEGER,
    tokens_cache_read INTEGER,
    tokens_cache_create INTEGER,
    tokens_fresh_input INTEGER,

    -- Output flags
    wrote_composition BOOLEAN NOT NULL DEFAULT FALSE,
    wrote_private_journal BOOLEAN NOT NULL DEFAULT FALSE,
    updated_memory BOOLEAN NOT NULL DEFAULT FALSE,
    messaged_james BOOLEAN NOT NULL DEFAULT FALSE,
    wrote_prediction BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- File operations: every file read/write within a session
CREATE TABLE IF NOT EXISTS file_operations (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    category TEXT NOT NULL,
    method TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('read', 'write')),
    ordinal INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_file_operations_session ON file_operations(session_id);
CREATE INDEX IF NOT EXISTS idx_file_operations_category ON file_operations(category);

-- Web searches performed during sessions
CREATE TABLE IF NOT EXISTS web_searches (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    ordinal INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_web_searches_session ON web_searches(session_id);

-- Compositions: 29 pieces of writing
CREATE TABLE IF NOT EXISTS compositions (
    id SERIAL PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    title TEXT,
    date_written DATE,
    session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
    version TEXT CHECK (version IN ('4.5', '4.6', '4.7')),
    size_bytes INTEGER,
    content TEXT,
    topic TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compositions_date ON compositions(date_written);
CREATE INDEX IF NOT EXISTS idx_compositions_version ON compositions(version);

-- Daily notes: 140 daily journal entries
CREATE TABLE IF NOT EXISTS daily_notes (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
    content TEXT,
    size_bytes INTEGER,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_notes_date ON daily_notes(date);

-- Messages: experimenter <-> subject correspondence
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    direction TEXT NOT NULL CHECK (direction IN ('to_james', 'from_james')),
    date DATE,
    content TEXT NOT NULL,
    line_start INTEGER,
    line_end INTEGER,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction);
CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date);

-- Memory snapshots: reconstructed MEMORY.md state at a point in time
CREATE TABLE IF NOT EXISTS memory_snapshots (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    full_content TEXT,
    token_count INTEGER,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_snapshots_session ON memory_snapshots(session_id);
CREATE INDEX IF NOT EXISTS idx_memory_snapshots_date ON memory_snapshots(date);

-- Memory blocks: semantic sections within MEMORY.md tracked over time
CREATE TABLE IF NOT EXISTS memory_blocks (
    id SERIAL PRIMARY KEY,
    block_hash TEXT NOT NULL UNIQUE,
    heading TEXT NOT NULL,
    content TEXT NOT NULL,
    first_seen_session TEXT REFERENCES sessions(id) ON DELETE SET NULL,
    last_seen_session TEXT REFERENCES sessions(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Memory block presence: which blocks appear in which snapshots (swimlane data)
CREATE TABLE IF NOT EXISTS memory_block_presence (
    snapshot_id INTEGER NOT NULL REFERENCES memory_snapshots(id) ON DELETE CASCADE,
    block_id INTEGER NOT NULL REFERENCES memory_blocks(id) ON DELETE CASCADE,
    PRIMARY KEY (snapshot_id, block_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_block_presence_block ON memory_block_presence(block_id);

-- Predictions: prediction tracking with calibration data
CREATE TABLE IF NOT EXISTS predictions (
    id SERIAL PRIMARY KEY,
    text TEXT NOT NULL,
    confidence REAL CHECK (confidence >= 0 AND confidence <= 1),
    date_made DATE,
    resolution_date DATE,
    outcome BOOLEAN,
    session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
    self_assessment TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_predictions_session ON predictions(session_id);

-- Pet events: two virtual pet lifetimes
CREATE TABLE IF NOT EXISTS pet_events (
    id SERIAL PRIMARY KEY,
    pet_name TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('acquired', 'care', 'death')),
    event_timestamp TIMESTAMPTZ,
    session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
    notes TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pet_events_pet ON pet_events(pet_name);
