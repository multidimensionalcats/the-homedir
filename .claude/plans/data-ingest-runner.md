# Implementation Plan: Data-Ingest CLI Runner (`scripts/ingest.py`)

**Date:** 2026-07-04
**Status:** Awaiting approval

## 1. Verified Ground Truth (explored, not assumed)

These facts were confirmed directly during planning and correct/extend earlier assumptions:

**Data sources and permissions (checked with `ls -la` / `head` as user james):**

| Source | Path | Access | Consumed by |
|---|---|---|---|
| Activity logs (JSONL, custom event format) | `/home/claude/.claude/activity-logs/activity-YYYY-MM-DD.jsonl` | **world-readable, no sudo** | `extract_sessions.extract_all`, `extract_memory.extract_all_memory` |
| Session logs | `/home/claude/.claude/session-logs/*.log` | readable | `extract_sessions.extract_all` |
| Claude Code transcripts | `/home/claude/.claude/projects/-home-claude/*.jsonl` | `-rw-------` claude — **sudo required** | `extract_memory.extract_memory_from_jsonl` only |
| Memory files (current) | `/home/claude/.claude/projects/-home-claude/memory/*.md` | **actually world-readable** (`-rw-r--r--`, dir `drwxr-xr-x`) — the spec's "requires sudo" is outdated | `extract_memory` (current-state fallback) |
| Writing | `/home/claude/writing/*.md` | readable | `extract_writing.extract_all_writing` |
| Daily notes | `/home/claude/notes/daily/*.md` | readable | `extract_pets.extract_all_pets` |
| Messages | `/home/claude/messages_{from,to}_james.md` | readable | `extract_messages.extract_all_messages(messages_dir=/home/claude, conn)` |
| Predictions | `/home/claude/notes/predictions/` | readable | `extract_predictions.extract_all_predictions` |
| Private journal | `/home/claude/private/` | `drwx------`, unreadable | **NEVER a source. Hard exclusion.** |

Key consequence: **stage-1 session ingest needs no sudo at all.** The `activity-*.jsonl` files that `extract_all()` globs (line 830, `scripts/extract_sessions.py`) live in the world-readable `activity-logs/` dir, not the protected `projects/` dir. Only historical MEMORY.md snapshot extraction (`extract_memory_from_jsonl`) touches the sudo-protected transcripts. `sudo -n true` fails (password required) — no passwordless sudo, so the runner must degrade gracefully.

**DB state (queried live, `homedir` DB):**
- `sessions`: 478 rows, max date **2026-05-18** — ~47 days / ~94 sessions behind (today is 2026-07-04).
- `messages`: 85 rows; **5 date outliers**: ids 17–20 dated 2024-02/03 and id 23 dated **3036-03-02**. All `from_james`, all mis-parsed headers.
- `memory_snapshots`: **0 rows** — yet `src/data/memory-snapshots.json` contains real snapshot data. **Running `export_all()` today would clobber memory-snapshots.json with `{"snapshots": [], "blocks": []}`.** The runner needs an export shrink-guard.
- `daily_notes`: 0 rows, no extractor populates it and `export_all` doesn't export it (out of scope).
- 1 leaked `test%` session in prod (already filtered by `_deduplicate_sessions` at export).

**Schema landmine for Opus 4.8:** `migrations/001_initial_schema.sql` has `CHECK (version IN ('4.5','4.6','4.7'))` on both `sessions.version` and `compositions.version`. `detect_version()` (`scripts/extract_sessions.py:104`, boundaries at lines 98–101: 4.6 → 2026-02-13, 4.7 → 2026-04-18) returns `'4.7'` for all future dates, so ingest won't crash today but will mislabel post-4.8 sessions; adding `'4.8'` to `_VERSION_BOUNDARIES` without a migration would violate the CHECK. Both must change together.

**Extractor idempotency (all verified in code):** sessions `ON CONFLICT (id) DO NOTHING`; compositions `ON CONFLICT (slug) DO UPDATE`; messages delete-then-reinsert per direction; predictions dedup on `(date_made, md5(text))`; pet events dedup; memory blocks `ON CONFLICT (block_hash)`. Re-running is safe. **But** `extract_messages.py:243,277` and `extract_writing.py:168` call `conn.commit()` internally — a rollback-based dry-run is impossible without touching extractors, which drives the dry-run design below (report-only, no `store_*` calls).

**quotes.json:** confirmed `export_all()` writes exactly 6 files (`sessions.json`, `writing-metadata.json`, `messages.json`, `predictions.json`, `pet-timeline.json`, `memory-snapshots.json`); no code path in `scripts/` writes `quotes.json`. `extract_quotes.extract_all_quotes` returns a candidate list and never touches DB or disk — it is a curation aid and stays out of the runner.

**Conventions to follow (cited):**
1. **Test-DB pattern** — `scripts/tests/conftest.py`: sets `os.environ["HOMEDIR_TEST"] = "1"` at import, session-scoped `db_conn` fixture asserts `dbname.endswith("_test")`, `setup_schema` applies `migrations/001_initial_schema.sql`, autouse `clean_tables` truncates after each test. New tests use these fixtures unchanged.
2. **CLI pattern** — `scripts/model_council.py`: `_parse_args(argv: list[str]) -> argparse.Namespace` with subparsers, `main(argv: list[str] | None = None)`, `if __name__ == "__main__": main()`. `ingest.py` mirrors this exactly (it is the only existing CLI in the repo).
3. **Hostile-path handling** — `scripts/extract_sessions.py:81–92` `_sanitize_path` (strip nulls, NFKC normalize, `os.path.normpath`) and `_categorize_path`'s canonical-prefix + homoglyph checks. The private-path guard reuses this approach.
4. **Hostile test style** — `scripts/tests/test_extract_sessions_hostile.py`: `NUL = chr(0)` runtime constant, `_jsonl_line`/`_make_session_lines`/`_write_jsonl(tmp_path, ...)` helpers.

## 2. Architecture

Three new files plus one migration; **zero changes to extractor parse/store logic** (DRY — the runner orchestrates only). One small conftest change.

```
migrations/002_quarantine_and_version_48.sql   (new)
scripts/validate_dates.py                      (new — pure validation/quarantine layer)
scripts/ingest.py                              (new — CLI + orchestration)
scripts/tests/conftest.py                      (edit — apply all migrations, sorted)
package.json                                   (edit — "extract": "python scripts/ingest.py")
```

### Layer separation inside `ingest.py`

```
CLI layer:            _parse_args(argv) -> Namespace          # argparse only, no I/O
Config layer:         @dataclass IngestConfig                 # every path a field; defaults =
                      SOURCES constants; from_args(ns)        # spec Appendix B paths
Guard layer:          assert_no_private_paths(cfg)            # resolves each path, raises if
                                                              # under /home/claude/private
Orchestration:        run_ingest(conn, cfg) -> IngestReport   # stage 1: calls the 6 extract_all_*
                      run_export(conn, cfg) -> ExportReport   # stage 2: wraps export_all + guards
                      table_counts(conn) -> dict[str, int]    # before/after snapshots
Staging:              stage_transcripts(cfg, run=subprocess.run) -> Path | None   # sudo copy
Reporting:            format_report(ingest, export, quarantine) -> str
Entry:                main(argv=None) -> int                  # exit codes 0/1/2
```

Every function takes `conn`/`cfg` as parameters — no module-level connections, so tests inject the `_test` DB conn from the existing `db_conn` fixture and `tmp_path` sources.

### Ingest order (FK-driven, verified against schema)

1. `extract_all(activity_logs_dir, session_logs_dir, conn)` — sessions first (everything else FKs to it)
2. `extract_all_writing(writing_dir, conn)` — looks up `session_id` from sessions by date
3. `extract_all_messages(messages_dir, conn)`
4. `extract_all_predictions(predictions_dir, conn)`
5. `extract_all_pets(daily_notes_dir, conn)`
6. `extract_memory_from_jsonl(staged_transcripts_dir, conn, current_memory_path)` — **only if** transcripts available
7. `quarantine_outliers(conn, start, end)` — date-sanity sweep
8. `run_export(conn, cfg)` — stage 2

Each extractor call is wrapped in `try/except Exception` + `conn.rollback()`; a failure records `report.errors[name]` and **continues** to the next extractor (partial-failure requirement), and `main` returns exit code 1 if any errors occurred.

### Design decision: sudo handling — pre-staged copy via explicit opt-in

Rejected options: (a) running the whole runner under `sudo` (would create root-owned JSON in `src/data/`, run pip-installed code as root, and is unnecessary since only 1 of 6 extractors needs it); (b) silent `sudo` subprocess (no passwordless sudo exists; hidden password prompts inside a pipeline are hostile UX).

Chosen: **default run needs no sudo and skips memory-snapshot ingest with a visible "SKIPPED (transcripts not readable)" line.** Two explicit opt-ins:
- `--transcripts-dir PATH` — point at an already-readable copy (james stages it however he likes).
- `--with-transcripts` — the runner itself creates a `tempfile.mkdtemp(prefix="homedir-transcripts-")` (mode 0700) and runs `sudo install -m 0644 -t <staging> /home/claude/.claude/projects/-home-claude/*.jsonl` via an **injected runner callable** (`run=subprocess.run` default), letting sudo prompt interactively. Non-zero exit → warn, skip memory ingest, do not fail the run. Staging dir removed in a `finally`. The glob is transcripts-only; `memory/*.md` is world-readable and needs no staging; nothing under `private/` is ever referenced.

### Design decision: `--dry-run` = report-only (no `store_*`, no writes)

Because `extract_messages`/`extract_writing` commit internally, a rollback dry-run is unsound. Instead:
- **Stage 1 dry-run:** call the pure **parse** functions only (`parse_activity_log`, `parse_session_log`, `parse_messages`, `extract_composition`, `parse_prediction_file`, `scan_daily_notes_for_pet_events`) and compare against read-only SELECTs. Exact deltas where cheap: sessions (parsed ids − existing ids), compositions (slugs). Labeled estimates for messages/predictions/pets (parsed count vs table count). Reuses extractor parsers — no logic duplication.
- **Stage 2 dry-run:** run the real `export_all(conn, tmp_dir)` into a `TemporaryDirectory`, diff record counts per file against `src/data/*.json`, print the diff, delete the tmp dir. `src/data` untouched by construction.
- Dry-run also reports what the quarantine sweep **would** move (`find_outliers` SELECT only).

### Design decision: date validation as post-ingest quarantine sweep

Pre-parse filtering would require modifying every extractor's parse/store loop (DRY violation) and would not fix the 5 bad rows already in the DB. Instead `scripts/validate_dates.py` sweeps after ingest:
- `EXPERIMENT_START = date(2026, 1, 15)`; upper bound = `date.today()` (overridable `--max-date` for tests).
- `find_outliers(conn, start, end)` — SELECT-only; covers `messages.date`, `sessions.date`, `compositions.date_written`, `predictions.date_made`, `pet_events.event_timestamp`. NULL dates are allowed (schema allows them; export orders `NULLS LAST`).
- `quarantine_outliers(...)` — moves each outlier row (as JSONB, with `source_table`, `reason`, `quarantined_at`) into a new `quarantine` table (migration 002), then deletes the original inside one transaction per table. Sessions cascade children by existing FK `ON DELETE CASCADE`. Because `extract_all_messages` delete-reinserts, the 3036 row reappears each run and is re-quarantined each run — idempotent by content-hash dedup in the quarantine insert.

### Migration 002 (`migrations/002_quarantine_and_version_48.sql`, idempotent like 001)

1. `CREATE TABLE IF NOT EXISTS quarantine (id SERIAL PK, source_table TEXT NOT NULL, row_data JSONB NOT NULL, reason TEXT NOT NULL, content_hash TEXT NOT NULL UNIQUE, quarantined_at TIMESTAMPTZ DEFAULT NOW())`.
2. Drop + re-add `sessions_version_check` and `compositions_version_check` to include `'4.8'` (guarded `DO $$ ... $$` blocks for idempotency).
3. Companion code change: append `(datetime.date(2026, 7, ??), "4.8")` to `_VERSION_BOUNDARIES` **once James supplies the cutover date**; until then the constraint is relaxed and detection continues returning 4.7 (safe, correctable later via one UPDATE — if any session date ≥ a `KNOWN_LATEST_BOUNDARY` sentinel, the runner prints a "version boundary may be stale" warning).

Conftest change: `setup_schema` applies `sorted(MIGRATIONS_DIR.glob("*.sql"))` instead of only `001_initial_schema.sql`.

### Export guards (stage 2)

- **quotes.json guard:** before export, `sha256(src/data/quotes.json)`; after export, re-hash and `assert` identical; report line `quotes.json untouched (sha256 verified)`. Also assert `quotes.json` not in `export_all`'s returned paths.
- **Shrink guard (the memory-snapshots clobber):** export first to a temp dir; for each file, if the new top-level record count is 0 while the existing `src/data` file has > 0 records, **do not copy that file**, print `BLOCKED: memory-snapshots.json would shrink 47 -> 0 (use --force to override)`, exit code 1. Otherwise move files into `src/data`. `--force` overrides.

### Report format (printed and returned by `format_report`)

```
== Stage 1: ingest ==
sessions        478 -> 572   (+94)
compositions     30 ->  38   (+8)
messages         85 ->  93   (+8)
predictions      21 ->  24   (+3)
pet_events       23 ->  23   (+0)
memory_snapshots  0 ->   0   SKIPPED (transcripts not readable; use --with-transcripts)
== Quarantine ==
messages: 5 rows outside 2026-01-15..2026-07-04 (ids 17,18,19,20,23; worst: 3036-03-02)
== Stage 2: export ==
sessions.json           written (479 -> 573 records)
memory-snapshots.json   BLOCKED shrink guard (47 -> 0)
quotes.json             untouched (sha256 verified)
exit: 1 (1 blocked export)
```

### CLI surface

```
python scripts/ingest.py [--dry-run] [--skip-export] [--skip-ingest]
    [--with-transcripts | --transcripts-dir PATH]
    [--source-root /home/claude] [--output-dir src/data]
    [--max-date YYYY-MM-DD] [--force]
```
`--source-root` re-roots all default source paths (tests point it at `tmp_path`). `package.json`: `"extract": "python scripts/ingest.py"`.

## 3. Phases with Per-Phase Test File Inventory

TDD pipeline per project convention (CLAUDE.md "Agentic TDD Workflow"): each phase = spec → Agent A writes tests → RED run → Agent C implements → GREEN run → code review. Phases are ordered so each builds on GREEN of the previous.

### Phase 1 — Migration 002 + conftest multi-migration support
Files: `migrations/002_quarantine_and_version_48.sql`, edit `scripts/tests/conftest.py`.
**Test file: `scripts/tests/test_schema.py` (extend) + `scripts/tests/test_migration_002.py` (new)**
- quarantine table exists with UNIQUE content_hash; inserting duplicate hash raises IntegrityError
- `row_data` JSONB round-trips unicode (emoji, RTL override chars) and content containing NUL-stripped text
- sessions row with `version='4.8'` inserts OK; `version='5.0'` still rejected; same for compositions
- migration applied **twice** against same schema → no error (idempotency)
- migration applied to an **empty database** (fresh schema) → no error (missing-tables scenario)
- conftest now applies 002: fixture-created schema has quarantine table

### Phase 2 — `scripts/validate_dates.py` (quarantine layer)
**Test file: `scripts/tests/test_validate_dates.py` (new)** — uses `db_conn` fixture per conftest convention.
- seeds a message dated `3036-03-02` → `find_outliers` returns it; `quarantine_outliers` moves it; messages count drops by 1; quarantine has 1 row with reason containing the range
- seeds messages dated `2024-02-24` (below range) → quarantined
- boundary dates: `2026-01-15` and `end` date itself are **kept**; `end + 1 day` quarantined
- NULL dates in messages/predictions/compositions are kept (not outliers)
- session outlier: seeded session dated 3036 **with child file_operations and web_searches** → session quarantined, children cascade-deleted, no FK error
- empty DB → both functions return empty/0, no crash
- double sweep (run twice) → second run moves 0 rows, quarantine count unchanged (content-hash dedup)
- unicode/null bytes: message content with zero-width joiners survives into `row_data` JSONB intact
- missing quarantine table (drop it first) → raises a clear error (not silent no-op)

### Phase 3 — Stage-1 orchestration: `run_ingest`, `table_counts`, `IngestConfig`, private guard
**Test file: `scripts/tests/test_ingest_stage1.py` (new)** — builds fake source trees in `tmp_path` (helpers copied stylistically from `test_extract_sessions_hostile.py`), injects `db_conn`.
- happy path: activity JSONL + session logs + writing + messages + predictions in tmp tree → all tables populated, `IngestReport.deltas` matches `table_counts` before/after
- **idempotent re-run:** second `run_ingest` on same sources → all deltas +0
- **duplicate sessions:** same session id in two activity files → 1 row
- **malformed JSONL:** truncated line, non-dict JSON, binary garbage line, line with NUL byte mid-file → parse continues, valid sessions ingested, no exception escapes
- **permission-denied path:** source dir `chmod 0o000` (restore in teardown) → extractor records 0, `run_ingest` completes, no raise
- missing source dirs entirely → completes with zero deltas
- **partial ingest failure mid-run:** monkeypatch `extract_all_writing` to raise after sessions succeeded → sessions delta positive, `report.errors["writing"]` populated, messages/predictions still ran, DB has no half-committed writing rows (rollback called)
- **private-path guarantee:** `IngestConfig` with any path resolving under `<source_root>/private` (including via `../private` traversal and a symlink into private) → `assert_no_private_paths` raises before any read; also assert default `SOURCES` contains no `private` component (static test)
- empty DB start (fixture guarantees) and pre-populated DB start both produce correct before/after counts

### Phase 4 — Transcript staging + memory ingest wiring: `stage_transcripts`
**Test file: `scripts/tests/test_ingest_staging.py` (new)** — never calls real sudo; injects fake `run` callables.
- fake runner that "copies" fixture transcripts → returns staging path; `run_ingest` with it calls `extract_memory_from_jsonl` and memory_snapshots delta > 0 (uses tiny valid transcript fixture matching `extract_memory_from_jsonl`'s expected format)
- **sudo unavailable:** fake runner returns exit 1 (stderr "a password is required") → returns None, memory step reported `SKIPPED`, run exit code still 0, other tables ingested
- fake runner raises `FileNotFoundError` (no sudo binary) → same graceful skip
- staging dir is created with mode 0700 and **removed even when the subsequent memory extractor raises** (finally-cleanup test)
- staged dir empty (runner succeeds but copies nothing) → memory delta 0, no crash
- `--transcripts-dir` pointing at unreadable dir → skip + report, no crash
- assert the constructed sudo command references only `projects/-home-claude/*.jsonl` — never `private` (inspect fake runner's captured argv)

### Phase 5 — Stage-2 export wrapper: `run_export` with quotes/shrink guards
**Test file: `scripts/tests/test_ingest_export.py` (new)** — `output_dir=tmp_path/"data"`, DB via `db_conn`.
- exports 6 files with seeded DB; returned report lists per-file old→new record counts
- **quotes.json protection:** place sentinel `quotes.json` (known bytes incl. unicode) in output dir → after `run_export` bytes identical, report contains "untouched"; adversarial: monkeypatch `export_all` to also write `quotes.json` → `run_export` detects hash change and raises/exits 1 (guard actually bites, not decorative)
- **shrink guard:** existing `memory-snapshots.json` with 3 snapshots, empty memory tables → file NOT overwritten, report says BLOCKED, function signals failure; with `force=True` → overwritten
- shrink guard does not fire on legitimate growth or equal counts, nor on 0→0
- output dir missing → created; output dir unwritable → clear error captured, no partial temp litter in `src/data`
- **empty DB export:** all-empty tables + no pre-existing files → 6 valid empty-list JSON files written (matches current `export_all` behavior)
- mid-export failure (monkeypatch one export fn to raise) → no files in final output dir mutated (temp-dir-then-move semantics), error reported

### Phase 6 — CLI: `_parse_args`, `main`, `--dry-run`, report formatting, npm wiring
**Test file: `scripts/tests/test_ingest_cli.py` (new)** — invokes `main([...])` in-process (model_council pattern), captures stdout via capsys.
- `--dry-run`: snapshot all table counts + sha256 of every file in output dir before; run; assert **byte-for-byte nothing changed** in DB or disk; report contains exact "+N sessions" for a fixture with 2 new + 1 duplicate session
- dry-run reports would-quarantine rows (seeded 3036 message) without removing them
- full run happy path: report contains `+` deltas, quarantine line, `quotes.json untouched`, exit 0
- exit codes: extractor failure → 1; blocked export → 1; bad args (`--nonsense`) → SystemExit 2; `--transcripts-dir` + `--with-transcripts` together → argparse mutual-exclusion error
- `--skip-export` runs no stage 2 (output hashes unchanged); `--skip-ingest` runs no stage 1 (DB counts unchanged)
- `--max-date` respected by quarantine (session dated today+1 quarantined when max-date=today)
- unreadable source root in dry-run → still exits cleanly with per-source SKIP lines
- static test: `package.json` `"extract"` script equals `"python scripts/ingest.py"` (guards the wiring)

### Phase 7 — Live smoke run + docs (no new code)
Manual/checklist phase, not TDD: run `python scripts/ingest.py --dry-run` against real sources; review report; run for real; verify `sessions` max date == today, 5 messages quarantined, memory-snapshots.json blocked (expected until transcripts staged); optionally run `--with-transcripts` interactively to backfill memory snapshots; `npm run extract` then `npm run build`; update `HANDOVER.md`. Note in HANDOVER that the 4.8 boundary date must be added to `_VERSION_BOUNDARIES` when known.

## 4. Explicitly OUT of Scope (follow-ups)

- **Memory snapshot coverage backfill / gap analysis** — runner ingests what transcripts provide; auditing which historical sessions lack snapshots is follow-up.
- **`src/content/` collection sync** — `src/content/{writing,notes}` are hand-picked curated copies (2 notes, 2 writings out of 140+/38 files), not a mirror; syncing is editorial, not mechanical. Runner does not touch `src/content/`.
- **daily_notes table ingest** — table exists but has no extractor and no export consumer.
- **Quote curation** — `extract_all_quotes` stays a manual curation aid; `quotes.json` remains hand-maintained and council-reviewed.
- **Auto-rebuild cron / CI hook** — runner is manual; scheduling it is follow-up.
- **Deleting the leaked `test%` session** from prod (export already filters it) and fixing the 2024/3036 *source* parsing bug in `extract_messages._parse_date_from_header` (quarantine contains the blast radius; parser fix is a separate TDD task).
- **Frontend handling of version 4.8** (colors, radar morphs, narrative) — schema/detection groundwork only.
- **Prod-DB collation version mismatch warning** (`ALTER DATABASE ... REFRESH COLLATION VERSION`) — ops task, not code.

## 5. Risks / Notes for the Implementer

- `extract_all()` return value counts parsed sessions, not inserted ones — deltas must come from `table_counts` diffs, never extractor return values.
- Do not wrap `extract_all_messages`/`extract_all_writing` in `conn.transaction()` — their internal `conn.commit()` calls would raise `ProgrammingError` inside an explicit transaction block (psycopg3).
- `extract_all_messages` is delete-then-reinsert: a mid-run crash between delete and reinsert loses messages; the per-extractor `except: conn.rollback()` in `run_ingest` covers this since its commit happens only at the end of its own function.
- The hostile-test suite runs against the `homedir_test` DB automatically via conftest's `HOMEDIR_TEST=1`; never override that env var in new tests.

## Critical Files for Implementation

- `scripts/extract_sessions.py` (extract_all, detect_version, _VERSION_BOUNDARIES, _sanitize_path — orchestration entry point and path-guard pattern)
- `scripts/prebuild_export.py` (export_all wrapped by run_export; verified it never writes quotes.json)
- `scripts/tests/conftest.py` (HOMEDIR_TEST DB fixtures; must be extended to apply all migrations)
- `scripts/model_council.py` (the repo's only existing CLI — _parse_args/main/__main__ pattern to mirror)
- `migrations/001_initial_schema.sql` (version CHECK constraints that migration 002 must relax; schema for quarantine sweep)
