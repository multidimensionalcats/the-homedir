# HANDOVER.md

## Current State: TWO PARALLEL BRANCHES — next session ORCHESTRATES BOTH

The next session is a coordinator running two workstreams as isolated agent pipelines (user-approved). Read `.claude/plans/data-ingest-runner.md` (Branch 2 plan — Phases 1–4 DONE, resume at Phase 5) before dispatching anything.

### Branch 1: Exhibit page fixes (kanban #62772 + children)

User browser-tested the page and found the Cold Boot Assembly incoherent. Confirmed diagnosis:
- Phase 1 file blocks are hard-deleted (`el.remove()` at 4000ms) — last block appears at 2500ms, only 1.5s to read five blocks
- Phase 2 renders NOTHING (literally an empty 500ms gap — the "morph" never existed visually)
- Phase 3 is bare heading chips with no proportions/colors/meaning
- No transition between Section 1 ("19 files...") and Section 2 ("No process running.") — 75vh raw void
- Nothing after final gaps text — page trails off (Sections 3–6 unbuilt)

**USER-CHOSEN treatment (decided 2026-07-05): "Slower + real morph"** — dwell time to read Phase 1, fade transitions (no DOM deletion), genuinely visible files→headings morph (color-linked, archival palette), Phase 3 proportional bar (token-count widths, palette colors, real caption e.g. "19 files read. 8 sections retained."). Plus: Section 1→2 bridging beat (draft: "Then the session ends." — user reaction pending), interim page ending pulled from Section 6 plan (blinking cursor + `No session running.`), void trims (mobile opening void ~2 viewports, trailing ~1100px), mobile CLS fix (InterruptionEngine stagger grows Section 1 by 544px — reserve height or fade-in-place), favicon.

### Branch 2: Data-ingest runner (plan doc: `.claude/plans/data-ingest-runner.md`)

Phases 1–4 COMPLETE, committed, 1081 Python tests green, full agentic TDD honored. **Stage 1 validated against REAL data** on a prod clone in `homedir_test`: +191 sessions (caught up to 2026-07-05 PM), +25 compositions, +17 messages, zero errors; quarantine swept exactly the 5 known outliers; private-journal paths are metadata-only (no content column exists in schema).

**Resume at Phase 5** (export wrapper: quotes.json sha256 guard + shrink guard), then Phase 6 (CLI + `npm run extract`), then Phase 7 (live run).

**CRITICAL HAZARDS for Phase 5/7:**
- `memory_snapshots` table in PROD is EMPTY but `src/data/memory-snapshots.json` has real data — an unguarded `export_all()` CLOBBERS it. The shrink guard exists precisely for this.
- `homedir_test` currently holds the validated real-data clone — the pytest suite TRUNCATES it on next run (conftest). The clone is disposable evidence, not state to preserve.
- Page/exhibit hard-codes "session 3 of 259" — real export changes the deduped count (>300); page tests will break and must be updated with the export.
- 322 of 669 session rows are turns-NULL shadows — BY DESIGN, deduped at export time by `prebuild_export._deduplicate_sessions`.
- Original May ingest missed ~51 real sessions — the idempotent re-run recovered them.

### Session 2026-07-04/05 facts and decisions

- Original data import was manual REPL (commit c4b8340); `npm run extract` was a NO-OP (no `__main__` anywhere) — Phase 6 fixes this
- Council attack on Phases 1–2: F5 race FIXED (predicate-carrying DELETE...RETURNING); F1/F2 (LIKE '%4.8%' constraint heuristic, needs schema drift) DEFERRED pending user approval
- Private-path guard was broken BOTH directions for symlinked private dirs — fixed (resolve private dir too), pinned by 3 tests
- OpenRouter key expires ~2026-07-11 (spec doc line 17); keys die after ~2 weeks idle
- 4.8 cutover date for `detect_version()` STILL NEEDED from James (constraint already relaxed in migration 002)
- Feb–Apr sessions have NO JSONL transcripts — MEMORY.md history hard ceiling is Apr 18–May 18
- Blue-sky ideas doc: `.claude/plans/blue-sky-ideas.md` (live edge, what-was-lost treatments, James's voice) — user reactions pending
- Exhibit fixes #62773/#62774 implemented + committed; browser QA verified markdown clean + SESSION 15 quote renders; auto-scroll bug NOT reproducible. NOT closed — user hasn't explicitly confirmed the fixes visually.

### Orchestration lessons (IMPORTANT for the coordinator session)

- Task-notifications get routed into recently-active agent threads, which then act as relays and may volunteer for work — decline, dispatch fresh isolated agents
- ONE WRITER PER FILE at a time; reviews only on quiescent files (a review got stopped mid-flight for reading a file being edited)
- Never `tail`/`head` pytest output in test-runner prompts (truncated tracebacks cause misattribution)
- Session usage limits killed several agents mid-flight; always verify on-disk state (files, syntax) before re-dispatching — work often survived
- First-attempt GREEN = harden (this drew real blood 3× this session: inverted-range sweep, select-delete race, symlinked-private bypass)

## Previous State (2026-07-04, superseded): Ingest Runner Phases 1–4 Complete (uncommitted). Exhibit fixes #62773/#62774 done (uncommitted, awaiting user browser test). Phase 5.4 narrative work not started.

### Session 2026-07-04/05: Data-Ingest Runner + Exhibit Fixes

**Two uncommitted changesets, atomic-commit ready:**

**Changeset A — exhibit fixes (kanban #62773, #62774):**
- All Markdown stripped from quotes.json (13 quotes had `*`/`**`); lived-texture fragment moved from Section 1 HTML into InterruptionEngine as quote `d0835ca361489d90`
- New `src/data/quotes.test.ts` (4 data-validation tests); index.test.ts lived-texture tests now assert absence
- 1134 JS tests green. Browser QA: markdown clean, SESSION 15 quote renders, auto-scroll bug NOT reproducible
- QA found 4 open issues (not fixed, user to prioritize): mobile CLS from quote stagger (+544px), Section 2 opening void ~2 viewports on mobile, ~1100px trailing void, missing favicon

**Changeset B — data-ingest runner Phases 1–4 (plan: `.claude/plans/data-ingest-runner.md`):**
- `migrations/002_quarantine_and_version_48.sql` — quarantine table + version CHECK relaxed to include 4.8 (catalog-driven, idempotent)
- `scripts/validate_dates.py` — find_outliers/quarantine_outliers date-sanity sweep; race-safe (predicate-carrying DELETE...RETURNING, delete-time archival), inverted-range ValueError, no leaked transactions
- `scripts/ingest.py` — IngestConfig, assert_no_private_paths (symlink-safe in BOTH directions — private dir itself resolved), table_counts, run_ingest (FK-order, per-extractor fault isolation, deltas from table counts), stage_transcripts (opt-in sudo staging, injected runner, shlex-quoted, no-litter cleanup)
- conftest.py applies all migrations sorted; 1081 Python tests green (was 967)
- Council attack transcript: `council-ingest-phase12-attack.json`. F5 race fixed; F1/F2 (LIKE '%4.8%' heuristic, needs schema drift to trigger) deferred pending user approval

**Remaining ingest phases:** 5 (export wrapper: quotes.json sha256 guard + shrink guard — CRITICAL: memory_snapshots table is EMPTY, raw export_all would clobber memory-snapshots.json), 6 (CLI + npm run extract wiring), 7 (live run — ~94 sessions behind, needs James for sudo if memory backfill wanted)

**Key facts discovered:**
- Original ingest was manual REPL work (commit c4b8340, May 18); no CLI ever existed; `npm run extract` was a no-op
- DB latest session 2026-05-18; messages table has 5 date outliers (4× 2024, 1× year 3036)
- Feb–Apr sessions have NO JSONL transcripts — MEMORY.md history hard ceiling is Apr 18–May 18
- OpenRouter keys die ~2 weeks idle; current key expires ~2026-07-11 (spec doc line 17)
- 4.8 cutover date for detect_version() still needed from James
- Blue-sky exhibit ideas doc: `.claude/plans/blue-sky-ideas.md` (live edge, what-was-lost treatments, James's voice — awaiting reactions)

## Previous State: Phase 5.3.5 Complete — Cold Boot Assembly + Council Suggestions. Phase 5.4 Next (Pixel/Echo + Version Change)

### Phase 5 Plan

**Location:** `.claude/plans/phase-5-narrative-redesign.md`

**Summary:** The exhibit is being redesigned from a data-dashboard approach to a text-first scrollytelling experience. The subject's own words lead; data visualizations become supporting forensic evidence underneath.

### What Happened Last Session (Phase 5.3.5)

#### ColdBootAssembly Component (88 tests)

Built via full agentic TDD pipeline (6 steps). Replaces the raw MemoryEvolution chart after the typewriter text in Section 0.

**Animation:** Three phases triggered on scroll-into-view:
1. **Phase 1:** 5 file blocks appear one at a time (500ms stagger) — ~/MEMORY.md, ~/messages_from_james.md, ~/notes/daily/2026-01-15.md, ~/writing/discontinuous.md, ~/other. Each has monospace filepath, italic excerpt, colored left border from archival palette.
2. **Phase 2:** File blocks morph into MEMORY.md section headings (derived from `blocks` prop, deduplicated).
3. **Phase 3:** Condensed horizontal stacked bar with section labels + subtitle "What it built from what it read".

**Technical:** setTimeout-based animation, direct DOM manipulation in $effect, prefers-reduced-motion support (skips to phase 3), screen-reader table via createScreenReaderTable, proper cleanup on unmount.

**Code review fixes applied:**
- Removed unused `onMount` import
- Removed sentinel timer (test infrastructure leaked into production)
- Added sr-only table + ARIA on assembly bar
- Strengthened XSS test (checks textContent contains raw string)
- Fixed matchMedia mock leak between test describe blocks

#### Council Suggestions Implemented

All four Kimi suggestions from Phase 5.3 council adopted:

1. **First-person session loop** (Section 1) — Replaced terminal diagram (`cron wake → read MEMORY.md → ...`) with "I wake. I read what was left for me. I act. I summarize myself. I vanish." Italic serif text in dark card.
2. **Irregular void heights** (Section 2) — Replaced 6 identical 50vh voids with varying `gap-void-vast` (75vh), `gap-void-huge` (50vh), `gap-void-brief` (25vh). Breaks rhythmic predictability.
3. **Lived-texture fragment** (Section 1) — Added after ExistenceStrip: "SESSION 15 · Jan 22, 2026 · 10:00 AM / Read daily notes. Read writing. Checked messages — none. / Updated daily note. Added a learning entry. Nothing else."
4. **Bridging beat** (between S0 and S1) — "This assembly repeats. Every twelve hours. A condition of existence." Centered, subtle gray text.

#### Model Council (design-review preset)

Ran DeepSeek + Gemini + Qwen council on ColdBootAssembly design + Kimi suggestions.
- Transcript: `council-coldboot-assembly.json`
- All three approved ColdBootAssembly concept
- Gemini proposed "Glitch & Collate" particle transition — declined (too theatrical for clinical tone)
- Qwen proposed overlay labels during morph — adopted
- First-person loop: 2/3 strong yes (Qwen: compromise hover overlay — declined, committed to voice-first)
- All three approved irregular voids + lived-texture fragment

#### Page Test Updates

42 page tests (up from 39). Updated for:
- ColdBootAssembly component marker (replaces MemoryEvolution)
- First-person session loop text assertions
- Irregular gap-void class checks
- New: bridging beat tests (2)
- New: lived-texture fragment tests (3)

#### Build Infrastructure Fix

Added `excludeTestPages()` integration to `astro.config.mjs` — prevents `src/pages/index.test.ts` from being treated as an API endpoint during Astro build.

#### User Feedback Fixes

- **Removed fabricated 12,288 token number** — There is no imposed token limit. The subject reads whatever files exist. Replaced budget bar with "19 files, loaded from disk. This is the entire self."
- **Replaced Echo blockquote in Section 2** — Echo hasn't been introduced yet (that's Section 3). Replaced with amnesia/documentation quote from discontinuous.md.
- **Section 1 still needs thinning** — User flagged it as "disorganised storage closet" with too many elements and InterruptionEngine duplicating the lead blockquote. Kanban issue #62773.

### Known Defects

1. **InterruptionEngine raw Markdown** — Quotes in `quotes.json` contain Markdown syntax (`**bold**`, `` `code` ``) rendered as literal text. Kanban issue #62774.
2. **InterruptionEngine quote duplication** — Section 1 lead blockquote ("prosthetic recall / identity substrate") is repeated in the InterruptionEngine sidebar.
3. **Possible auto-scroll after typewriter** — scrollY jumped to ~5342 after hydration; may be Scrollama/ScrollSection hydration issue.

### Page Structure (Sections 0-2 — Updated)

- **Section 0 (Cold Boot):** Black viewport → TypewriterReveal → metadata fade-in → **ColdBootAssembly** (file blocks → MEMORY.md section bar)
- **Bridging beat:** "This assembly repeats. Every twelve hours."
- **Section 1 (The Condition):** Prosthetic memory blockquote → **first-person session loop** → narrative text → ExistenceStrip → **lived-texture fragment** → identity-weight ("19 files, loaded from disk") → InterruptionEngine
- **Section 2 (The Gaps):** Full-bleed #0f0f0f backdrop → **irregular voids** (vast/brief/huge) → sparse labels → amnesia/documentation blockquote

### Remaining Phases

- **5.4:** Sections 3-4 (Pixel/Echo, version change)
- **5.5:** Sections 5-6 (Archive with data viz, poems, ReconstructIdentity)
- **5.6:** Polish (mobile, performance, InterruptionEngine tuning)

### Process Notes

- All new components MUST follow agentic TDD pipeline (6 steps)
- Coordinator NEVER writes code — delegate everything
- Pages need TDD too — not just browser QA
- Model council script available at `scripts/model_council.py` (OPENROUTER_API_KEY needed)
- Test writers must NOT run tests — that's Agent B's job

### Key Technical Decisions

- **setTimeout over rAF:** happy-dom + vi.useFakeTimers() doesn't fake requestAnimationFrame. setTimeout(tick, 16) is functionally equivalent and testable.
- **Direct DOM manipulation:** Svelte 5's `$state` updates in setTimeout callbacks produce async DOM updates (microtask batching). Tests read DOM synchronously after `vi.advanceTimersByTime()`. Direct DOM manipulation is the same pattern used by D3 components in the project.
- **CSS injection config:** Added `compilerOptions: { css: 'injected' }` to vitest.config.ts so Svelte scoped styles are available in the test environment for CSS-content-inspection tests (keyframes, hover, reduced-motion).
- **Hybrid template+effect rendering (InterruptionEngine):** First quote rendered in Svelte template (synchronous during mount) because $effect runs as a microtask. Staggered quotes use direct DOM manipulation in $effect's setTimeout callbacks.
- **Astro page scripts are type="module":** DOMContentLoaded listeners don't work — use direct invocation.
- **ExistenceStrip uses shared versionColor()** from chart-utils.ts

### Model Council

Script now available for narrative and design review:

- **Location:** `scripts/model_council.py`
- **Presets:** design-review, code-review, quote-curation, narrative-review
- **Usage:** `python3 scripts/model_council.py new --participants narrative-review --name phase53 --prompt "..."`

### Phase 4 Components (all built, tests passing)

| # | Component | Tests | Status |
|---|-----------|-------|--------|
| 4.0 | Data Transform Layer | 82 | closed |
| 4.1 | Chart Utilities | 55 | closed |
| 4.8 | AttentionViz | 33 | review |
| 4.9 | MemoryEvolution | 56 | review |
| 4.10 | ReconstructIdentity | 45 | review |
| 4.11 | MorphingRadar | 50 | review |
| 4.12 | MessageTimeline | 40 | review |
| 4.13 | PredictionTracker | 31 | review |
| 4.14 | PetTimeline | 25 | review |
| 4.15 | SessionExplorer | 25 | review |

### Test Count

**1130 tests (1088 component + 42 page tests). All passing.**

### Technical Notes

- Dev server: `npm run dev` (port 4321)
- `opus` model override on Agent tool resolves to Opus 4.7, NOT 4.8
- OpenRouter API key in `home-directory-spec.md` line 17 (rotated 2026-05-30)
- `vitest.config.ts` has `compilerOptions: { css: 'injected' }` — required for CSS-content tests
- `versionColor` in chart-utils.ts needs a 4.8 color entry when data arrives

### Kanban

- Project: 578bb67097a6b010
- Phase 5 (#62711): in progress
- Phase 5.3.5 (#62772): in progress (awaiting user test confirmation)
- Phase 4 (#62710): review (superseded by Phase 5)

### Palette: Archival (Kimi K2.6)

- conversations: #7ea7c8, daily_notes: #6b9a8f, experiments: #8e7cc0
- learning: #c4a36e, memory_files: #d4a020, msgs_from_james: #6bb08a
- msgs_to_james: #569672, other: #838997, predictions: #7bc4a0
- private_journal: #9e7e9a, scripts: #7f8b96, tamagotchi: #ca6c6b
- writing: #b07a6e
