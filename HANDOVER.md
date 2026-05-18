# HANDOVER.md

## Current State: Phase 3 — Astro Site Scaffolding (COMPLETE, user tested)

### What was done this session

All 8 tasks for Phase 3 completed:

| # | Task | Status | Tests |
|---|------|--------|-------|
| 1 | Project init (Astro 6.3.3, Svelte 5, Tailwind 4, D3, Vitest) | review | — |
| 2 | Design system (CSS-first Tailwind, @fontsource, color palette) | review | — |
| 3 | Base layouts (Layout.astro, ExploreLayout.astro) | review | — |
| 4 | Content collections + schemas (TDD) | review | 188 tests |
| 5 | Page structure (13 pages, dynamic routes, getStaticPaths) | review | — |
| 6 | Prebuild integration (6 fixture JSON files) | review | — |
| 7 | Svelte island smoke test (TDD) | review | 17 tests |
| 8 | CI integration (frontend job in GitHub Actions) | review | — |

**Total: 231 tests (188 schema + 17 component + 26 data contract), all passing. 13 pages building in 1.9s.**

### Key architecture decisions

- **No `@astrojs/cloudflare`** — static site, deploy `dist/` directly to CF Pages
- **Tailwind 4 CSS-first** — `@import "tailwindcss"` + `@theme` in `src/styles/global.css`, via `@tailwindcss/vite`
- **Content collections** use `loader: glob()` (Astro 6 requirement), schemas extracted to `src/schemas.ts`
- **D3 convention**: `$effect` (not `onMount`), `.join()` (not `.enter()`), `$state(null)` for container refs
- **Scrollama islands**: use `client:load` (must be active from page load); D3 islands: `client:visible`
- **JSON data committed to repo** — no Python/Postgres needed in CI
- **Self-hosted fonts** via `@fontsource` (Source Serif 4, JetBrains Mono, Inter)

### Council review process

Plan was reviewed by 4 models: Claude (with searxng), Qwen 3.6 Plus, Grok 4.3, Kimi K2.6. Key corrections:
- Dropped `@astrojs/cloudflare` (unanimous)
- Added `loader: glob()` for content collections
- Corrected `svelte-scrollama` (doesn't exist) → use `scrollama` directly
- `src/content.config.ts` (not `src/content/config.ts`) for Astro 6

### External model attack results

Qwen 3.6 Plus found 2 real bugs in schemas (fixed):
1. Missing `.strip()` on nested `attention_profile` objects — extra fields leaked
2. `timestamp_start` accepted empty strings — needed `.min(1).nullable()`

Qwen found 5 issues in the Svelte component (3 fixed):
1. Switched `onMount` → `$effect` for reactivity
2. Switched `.enter()` → `.join()` for modern D3
3. Added NaN/negative value guards

### Code review findings (Agent E)

Reviewed full diff. Key issues found and addressed:
- **CI Node version**: Astro 6 requires Node >= 22.12.0, CI had Node 20 → fixed to Node 22
- **CI secrets scan**: grep matched its own pattern in ci.yml → added `--exclude="ci.yml"`
- **CI permissions**: Added `permissions: contents: read` to limit blast radius
- **memory-snapshots.json**: blocks was a dict, pipeline outputs array → fixed
- **session/[id].astro**: hardcoded IDs instead of reading sessions.json → fixed
- **ExploreLayout.astro**: no active-link indicator, no mobile nav → noted for future
- **Layout.astro**: missing canonical link, OG meta, favicon → noted for future

### Pipeline rules learned this session

1. **First-attempt GREEN = test suite failure** — saved to memory
2. **External model attack step** between GREEN and code review — saved to memory
3. **Never dismiss security hooks** — saved to memory
4. **Coordinator must not write code directly** — delegate ALL implementation to agents
5. **Agent E (code review) runs on EVERY step** — not just TDD steps

### Phase 2 — Data Extraction Pipeline (COMPLETE, in review)
All 7 scripts done, 560 tests passing. Not yet run against real data in /home/claude.

### Phase 1 — Infrastructure (COMPLETE)
GitHub repo, PostgreSQL, Python env, CI, pre-commit hooks.

### NEXT SESSION: Run real extraction pipeline against /home/claude

**Goal:** Run all 7 Python extraction scripts against the real experiment data in `/home/claude`, then export JSON for the frontend. This is the bridge between the tested-but-never-run Phase 2 pipeline and the Phase 3 scaffold that currently has fixture data.

**Why this first:** Every visualization depends on real data. Designing D3 charts against 3 fake sessions then swapping in 206 real ones produces broken scales, wrong layouts, and missed edge cases. Data first, then visualize.

**Steps:**

1. Run `extract_sessions.py` against real JSONL + session logs in `/home/claude/.claude/`. This is the biggest script (179 tests) and most likely to hit edge cases in real data. Some paths require sudo (memory files, JSONL transcripts).

2. Run `extract_writing.py` against `/home/claude/writing/*.md` (29 files). These have no YAML frontmatter — the script parses inline titles/dates.

3. Run `extract_messages.py` against `/home/claude/messages_from_james.md` and `messages_to_james.md`.

4. Run `extract_predictions.py` against `/home/claude/notes/predictions/` (4 files).

5. Run `extract_pets.py` against `/home/claude/notes/daily/*.md` (scans for pet lifecycle events).

6. Run `extract_memory.py` against `/home/claude/.claude/projects/-home-claude/memory/` (requires sudo). Reconstructs MEMORY.md evolution.

7. Run `prebuild_export.py` to export Postgres → JSON files in `src/data/`, replacing the fixture data.

8. Verify the site still builds with real data (`npm run build`). Fix any schema validation failures — the Zod schemas and data contract tests will catch mismatches between real pipeline output and what the frontend expects.

9. Commit the real JSON data to the repo.

**Expect breakage.** The scripts were tested against synthetic fixtures. Real data will have edge cases: malformed JSONL lines, unexpected file paths, encoding issues, sessions with no tool calls, empty notes, etc. Each failure is a bug to fix through the TDD pipeline.

**Data access notes:**
- Activity logs: `/home/claude/.claude/activity-logs/` — readable
- Session logs: `/home/claude/.claude/session-logs/` — readable  
- JSONL transcripts: `/home/claude/.claude/projects/-home-claude/*.jsonl` — requires sudo
- Memory files: `/home/claude/.claude/projects/-home-claude/memory/` — requires sudo
- Writing, notes, messages, predictions: `/home/claude/` — readable
- Private journal: `/home/claude/private/` — EXCLUDED, never read

### Kanban
- Project: 578bb67097a6b010
- Phase 2 (#62708): in_progress (all children in review)
- Phase 3 (#62709): in_progress (all 8 children in review, user tested — scaffold renders correctly)
- Phases 4-7 (#62710-#62713): backlog

### Data sources on this machine
- Activity logs: `/home/claude/.claude/activity-logs/activity-YYYY-MM-DD.jsonl` (121 files)
- Session logs: `/home/claude/.claude/session-logs/YYYY-MM-DD-morning/evening.log` (227 files)
- Writing: `/home/claude/writing/*.md` (29 files)
- Messages: `/home/claude/messages_from_james.md`, `messages_to_james.md`
- Predictions: `/home/claude/notes/predictions/` (4 files)
- Tamagotchi: `/home/claude/tamagotchi/` (Go binaries only — pet data in daily notes)
- Memory files: `/home/claude/.claude/projects/-home-claude/memory/` (requires sudo)
