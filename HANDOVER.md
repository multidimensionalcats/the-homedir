# HANDOVER.md

## NEXT SESSION: Phase 3 — Astro Site Scaffolding

### What needs doing
- Scaffold Astro 6+ project with Svelte 5, Tailwind CSS, D3.js, Scrollama
- Set up content collections for writing, notes, assessments
- Prebuild integration that runs extraction pipeline → JSON export → Astro build
- Configure for Cloudflare Pages deployment
- See `home-directory-spec.md` (gitignored, local only) §4 for architecture details

### Phase 2 — Data Extraction Pipeline (COMPLETE)
All 7 scripts done, 560 tests passing:

| Script | Tests | What it does |
|--------|-------|-------------|
| extract_sessions.py | 179 | Parse activity-log JSONL + session-log text, classify file ops, store in Postgres. Hardened against hostile inputs. |
| extract_writing.py | 55 | Extract composition metadata from /home/claude/writing/*.md |
| extract_messages.py | 47 | Parse experimenter correspondence with flexible date handling |
| extract_predictions.py | 62 | Parse prediction markdown, extract claims/confidence/outcomes |
| extract_pets.py | 53 | Scan daily notes for pet lifecycle events via keyword detection |
| extract_memory.py | 72 | Reconstruct MEMORY.md evolution, semantic block decomposition |
| prebuild_export.py | 77 | Query Postgres → 6 static JSON files for Astro/D3/Svelte |

**Not yet run against real data.** Scripts are tested against synthetic fixtures only. Running the full pipeline against /home/claude is a separate task.

### Infrastructure (Phase 1 — COMPLETE)
- GitHub repo: https://github.com/multidimensionalcats/the-homedir
- PostgreSQL: `homedir` + `homedir_test`, schema with 11 tables
- Python: venv, pyproject.toml, db.py, conftest.py
- CI: GitHub Actions (lint + test + security), local pre-commit/pre-push hooks
- Linting: ruff

### Data sources on this machine
- Activity logs: `/home/claude/.claude/activity-logs/activity-YYYY-MM-DD.jsonl` (121 files)
- Session logs: `/home/claude/.claude/session-logs/YYYY-MM-DD-morning/evening.log` (227 files)
- Writing: `/home/claude/writing/*.md` (29 files)
- Messages: `/home/claude/messages_from_james.md`, `messages_to_james.md`
- Predictions: `/home/claude/notes/predictions/` (4 files)
- Tamagotchi: `/home/claude/tamagotchi/` (Go binaries only — pet data in daily notes)
- Memory files: `/home/claude/.claude/projects/-home-claude/memory/` (requires sudo)

### Kanban
- Project: 578bb67097a6b010
- Phase 1 (#62707): in_progress, all children in review
- Phase 2 (#62708): in_progress, all children in review
- Phases 3-7 (#62709-#62713): backlog

### Key workflow rules (learned this session)
- Agentic TDD pipeline is NON-NEGOTIABLE: Agent A (tests) → Agent B test-runner-haiku (RED) → Agent C (impl, blind) → Agent D test-runner-haiku (GREEN) → Agent E code-reviewer (review)
- test-runner-haiku agents must run in FOREGROUND (not backgrounded) — they need interactive permission prompts
- Coordinator orchestrates, does NOT write code or run tests directly
- First-attempt GREEN pass = test suite failure — tests must be hostile
- External AI review (Qwen/Kimi via OpenRouter) for security-sensitive code
