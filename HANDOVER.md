# HANDOVER.md

## Current State: Phase 4 Planning (COMPLETE, approved)

### Phase 4 Plan

**Location:** `/home/james/.claude/plans/we-re-never-done-plan-steady-moler.md`

Council-reviewed (Gemini, Kimi K2.6, Grok 4.3) and user-approved. 17 kanban items, ~8 sessions. Start with item 4.0 (Data Transform Layer).

Key council corrections incorporated:
- Empty sessions (55%) are the artistic thesis, not a data gap — absence is the protagonist
- Streamgraph replaced with Presence Matrix (binary encoding handles void natively)
- Weekly aggregation is first-class (mobile), not a fallback
- MemoryEvolution uses palimpsest aesthetic (blocks ghost/fade, not binary on/off)
- Version transitions feel discontinuous (jump, not smooth morph)
- Decision gate has explicit criteria

### Previous session: Real Data Extraction (COMPLETE)

Ran all 7 extraction scripts against real `/home/claude` data. Fixed bugs found in production data through TDD pipeline. Filled the memory extraction gap.

| Script | Records | Issues |
|--------|---------|--------|
| `extract_sessions` | 478 sessions | Clean |
| `extract_writing` | 30 compositions | Clean |
| `extract_messages` | 85 messages | Clean |
| `extract_predictions` | 21 predictions | Clean |
| `extract_pets` | 23 events | Fixed — greedy name extraction produced garbage |
| `extract_memory` | 24 snapshots (50 blocks) | New function — extracts from JSONL transcripts |
| `prebuild_export` | 6 JSON files | Clean |

**Bugs fixed:**
1. Pet extraction: removed greedy capitalized-word fallback + filtered to known names only (Pixel, Echo). 9 hostile tests added.
2. Data contract schemas: 6 fields needed `.nullable()` to match real data. Pet event types corrected to real taxonomy.
3. Memory extraction: new `extract_memory_from_jsonl` function scans JSONL conversation transcripts for Read events. 9 hostile tests. Covers Apr 18–May 18 only (JSONL files don't exist before April).

**Total: 809 tests (231 JS + 578 Python), 488 pages building in 2.2s.**

### Previous session: Phase 3 — Astro Site Scaffolding (COMPLETE, user tested)

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

### Phase 2 — Data Extraction Pipeline (COMPLETE, run against real data)
All 7 scripts + `extract_memory_from_jsonl` run successfully. 578 Python tests passing.

### Phase 1 — Infrastructure (COMPLETE)
GitHub repo, PostgreSQL, Python env, CI, pre-commit hooks.

### NEXT SESSION: Phase 4 — Execute Visualization Plan

**Plan doc:** `/home/james/.claude/plans/we-re-never-done-plan-steady-moler.md`
**Start with:** Item 4.0 (Data Transform Layer) + Item 4.1 (Chart Utilities)

**Real data in `src/data/`:**
- `sessions.json` (478 sessions, 352KB) — 55% have empty attention profiles
- `writing-metadata.json` (30 compositions, 7.5KB)
- `messages.json` (85 messages, 158KB) — has `3036-03-02` date anomaly
- `predictions.json` (21 predictions, 6.7KB) — all outcomes null
- `pet-timeline.json` (23 events — Pixel + Echo, 7.2KB)
- `memory-snapshots.json` (24 snapshots, 50 blocks, 25KB — Apr 18–May 18 only)
- Some predictions have `confidence: null`
- Some messages have `date: null`
- All nullable fields are reflected in Zod schemas — D3 code must handle null gracefully

**Permission changes made (persist across reboots):**
- `chmod o+rx` on `/home/claude/.claude/projects/`, `.../-home-claude/`, `.../memory/`
- `chmod o+r` on `/home/claude/.claude/projects/-home-claude/*.jsonl`

### Kanban
- Project: 578bb67097a6b010
- Phase 2 (#62708): CLOSED
- Phase 3 (#62709): CLOSED
- Phase 4 (#62710): backlog — needs children created from plan doc
- Phases 5-7 (#62711-#62713): backlog

### Data sources on this machine
- Activity logs: `/home/claude/.claude/activity-logs/activity-YYYY-MM-DD.jsonl` (121 files)
- Session logs: `/home/claude/.claude/session-logs/YYYY-MM-DD-morning/evening.log` (227 files)
- Writing: `/home/claude/writing/*.md` (29 files)
- Messages: `/home/claude/messages_from_james.md`, `messages_to_james.md`
- Predictions: `/home/claude/notes/predictions/` (4 files)
- Tamagotchi: `/home/claude/tamagotchi/` (Go binaries only — pet data in daily notes)
- Memory files: `/home/claude/.claude/projects/-home-claude/memory/` (requires sudo)
