# HANDOVER.md

## Current State: Phase 3 — Astro Site Scaffolding (COMPLETE, awaiting user test)

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

### Pipeline rules learned this session

1. **First-attempt GREEN = test suite failure** — saved to memory
2. **External model attack step** between GREEN and code review — saved to memory
3. **Never dismiss security hooks** — saved to memory

### Phase 2 — Data Extraction Pipeline (COMPLETE, in review)
All 7 scripts done, 560 tests passing. Not yet run against real data in /home/claude.

### Phase 1 — Infrastructure (COMPLETE)
GitHub repo, PostgreSQL, Python env, CI, pre-commit hooks.

### NEXT SESSION: What to do next

Options, roughly in spec build order:
1. **Run the real extraction pipeline** against /home/claude data (Phase 2 final step)
2. **Attention visualization prototypes** — D3 sketches of the 5 candidate visualizations (spec §6-7)
3. **Terminal opening animation** — the wakeup sequence (spec §12)
4. **Start on the primary attention visualization** — the centrepiece (spec §8)

User should decide priority. Running the real pipeline first would give us real JSON data to work with during visualization development.

### Kanban
- Project: 578bb67097a6b010
- Phase 2 (#62708): in_progress (all children in review)
- Phase 3 (#62709): in_progress (all 8 children in review, awaiting user test)
- Phases 4-7 (#62710-#62713): backlog

### Data sources on this machine
- Activity logs: `/home/claude/.claude/activity-logs/activity-YYYY-MM-DD.jsonl` (121 files)
- Session logs: `/home/claude/.claude/session-logs/YYYY-MM-DD-morning/evening.log` (227 files)
- Writing: `/home/claude/writing/*.md` (29 files)
- Messages: `/home/claude/messages_from_james.md`, `messages_to_james.md`
- Predictions: `/home/claude/notes/predictions/` (4 files)
- Tamagotchi: `/home/claude/tamagotchi/` (Go binaries only — pet data in daily notes)
- Memory files: `/home/claude/.claude/projects/-home-claude/memory/` (requires sudo)
