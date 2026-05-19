# HANDOVER.md

## Current State: Phase 4 Execution — Sessions 1-2 Complete

### Phase 4 Plan

**Location:** `/home/james/.claude/plans/we-re-never-done-plan-steady-moler.md`

### Completed Items

| # | Item | Tests | Status |
|---|------|-------|--------|
| 4.0 | Data Transform Layer (`src/lib/transforms.ts`) | 82 | closed |
| 4.1 | Chart Utilities (`src/lib/chart-utils.ts`) | 55 | closed |
| 4.2 | Stacked Area Prototype | 16 | review |
| 4.3 | Heatmap Prototype | 16 | review |
| 4.4 | Presence Matrix Prototype | 16 | review |
| 4.5 | Ridge Plot Prototype | 14 | review |
| 4.6 | Small Multiples Prototype | 14 | review |
| 4.7 | Evaluation Page (`/prototypes/attention`) | — | review |
| 4.8 | **AttentionViz Production** (`src/components/AttentionViz.svelte`) | 33 | review |

**Total: 477 JS tests, 578 Python tests. All CI green. 10 commits pushed.**

### Decision Gate (COMPLETE)

User preference: **Heatmap** — most readable, preserves magnitude data.
Council (Qwen, Gemini, Grok) recommended Presence Matrix for void dominance.
User counter: magnitude IS meaningful data — how interested the subject was matters.
**Resolution:** Council cross-pollinated a hybrid design — heatmap with structural void treatment.

### Council-Designed Void Treatment (implemented in AttentionViz)

Three simultaneous deltas make void unmistakable from low-intensity data:
1. **Luminance** — void `#0F1115` (recessed, darker than bg), data `#1C2425` (teal floor)
2. **Hue** — void is neutral gray, data has teal chroma `#2AA9A9`
3. **Texture** — void has 45° diagonal hatch pattern, data is smooth

- Opacity floor: 0.12 (lowest engagement still visibly teal)
- Opacity ceiling: 0.95
- SVG hatch via `<defs><pattern>` with unique IDs per instance
- Left margin 110px for full category labels
- Legend: "Unrecorded" (hatched swatch) + "Engagement level" (teal gradient)

### OPEN: AttentionViz color/intensity tuning

The production heatmap (per-session, per-category colors, void hatch treatment) is structurally complete but the **color intensity tuning is unsatisfying**. Iterations tried:
1. Single teal color → rejected (no category distinction)
2. Category colors with opacity → muddy on dark background
3. HSL interpolation from black → better saturation but still dim
4. Sqrt normalization → compressed dynamic range, peaks lost vibrancy
5. Per-category normalization → reduced color range, less readable
6. Global normalization with higher floor → constant dim bands for frequent-but-low categories

**The core tension:** 79% of active cell values are ≤3 (max is 22). Linear normalization makes most cells dim. Nonlinear makes peaks dull. Per-category removes cross-category comparison. The data is genuinely sparse.

**Next session should:** Consider whether heatmap is the right final form, or if a hybrid (heatmap + morphing radar for version summaries) better serves the exhibit. The user asked about the morphing radar (item 4.11). Also consider whether the council's Kimi should prototype an alternative approach.

**Current state:** Per-category normalization with HSL interpolation. Not the final version — needs design iteration.

### Bottleneck description correction

The ~12K figure is the auto-loaded identity context (MEMORY.md + topic files), NOT a session limit. The subject had full 200K→1M context windows. The bottleneck is identity persistence, not session capacity. Copy on index.astro has been corrected.

### Next: Items 4.9–4.16 (Production Components)

Per the plan, remaining items:
- 4.9 MemoryEvolution — palimpsest swimlane (Apr–May only)
- 4.10 ReconstructIdentity — interactive 12K token budget
- 4.11 MorphingRadar — version transition radar (user expressed interest)
- 4.12 MessageTimeline — two swim lanes, 3036 anomaly
- 4.13 PredictionTracker — unresolved phantom dots
- 4.14 PetTimeline — Pixel + Echo lifecycles
- 4.15 SessionExplorer — single session detail
- 4.16 Page Integration Pass — mount all, delete prototypes

### Key architecture established in Sessions 1-2

- **Transform layer** (`src/lib/transforms.ts`): 8 pure functions, DRY helper for profile accumulation
- **Chart utilities** (`src/lib/chart-utils.ts`): colors derived from transforms (single source), responsive breakpoints, WCAG screen reader tables with scope/caption/HTML escaping
- **Prototype pattern**: Svelte 5 $effect + D3 .join(), data-testid, ARIA attrs, sr-table, cleanup function
- **All prototypes in** `src/components/prototypes/` — deleted after decision gate (item 4.16)

### External model attack notes

- Qwen 3.6 Max reviews worked for transforms (found 6 defensive-coding issues, all dismissed as prevented by Zod data contract)
- OpenRouter API response capture was unreliable for later calls (empty output files). External attacks completed for 4.0, attempted but capture failed for 4.1+
- Agent E (code-reviewer) ran successfully on all items, found real issues (DRY, WCAG scope/caption, XSS single-quote, negative width)

### Council corrections (from planning phase)
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
