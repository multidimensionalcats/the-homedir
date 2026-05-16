# HANDOVER.md

## NEXT SESSION: Phase 2 — Remaining Extraction Scripts

### What needs doing
- **extract_predictions.py** (#62723) — Parse prediction files from `notes/predictions/` and daily notes. Complexity 3.
- **extract_pets.py** (#62725) — Parse tamagotchi data for two pet lifetimes (Pixel: 22h, Echo: 73h). Complexity 2.
- **extract_memory.py** (#62721) — HARDEST. Reconstruct MEMORY.md evolution from session telemetry. No git history. Complexity 5.
- **Prebuild JSON export** (#62726) — Query Postgres, emit static JSON for Astro/D3. Complexity 3.

### What's done
- **extract_sessions.py** — DONE. Hardened against hostile inputs (null bytes, path traversal, unicode, resource exhaustion). 179 tests (88 base + 80 hostile + 11 schema).
- **extract_writing.py** — DONE. 29 compositions extracted with title/date/content. 55 tests.
- **extract_messages.py** — DONE. Flexible date parsing for both message formats. 47 tests.
- **Total: 281 tests, all passing.**

### Infrastructure (Phase 1 — done, in kanban review)
- GitHub repo: https://github.com/multidimensionalcats/the-homedir (6 commits pushed)
- PostgreSQL: `homedir` + `homedir_test` databases, schema with 11 tables
- Python: venv, pyproject.toml, db.py, conftest.py with test safety
- CI: GitHub Actions (lint + test + security), local pre-commit/pre-push hooks
- Linting: ruff (E, F, W, I, UP, S, B rules)

### Data sources on this machine
- Activity logs: `/home/claude/.claude/activity-logs/activity-YYYY-MM-DD.jsonl` (121 files, readable)
- Session logs: `/home/claude/.claude/session-logs/YYYY-MM-DD-morning/evening.log` (227 files, readable)
- JSONL transcripts: `/home/claude/.claude/projects/-home-claude/*.jsonl` (requires sudo, only 2 found — most data is in activity-logs)
- Writing: `/home/claude/writing/*.md` (29 files, readable)
- Messages: `/home/claude/messages_from_james.md`, `messages_to_james.md` (readable)
- Predictions: `/home/claude/notes/predictions/` (readable)
- Tamagotchi: `/home/claude/tamagotchi/` (readable)
- Memory files: `/home/claude/.claude/projects/-home-claude/memory/` (requires sudo)

### Key decisions
- PostgreSQL is source of truth; JSON files are build artifacts for Astro
- Agentic TDD workflow with isolated agents (context economy + cognitive independence)
- Hostile test philosophy: first-attempt GREEN = test suite failure
- External models (Qwen, Kimi via OpenRouter) used for security review
- Spec doc gitignored (contains API keys)

### Kanban
- Project ID: 578bb67097a6b010
- Epics: #62707 (Phase 1, in_progress), #62708 (Phase 2, in_progress), #62709-#62713 (Phases 3-7, backlog)
- Active: #62720 (extract_sessions, in_progress)
