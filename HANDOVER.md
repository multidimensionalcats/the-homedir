# HANDOVER.md

## Current State: Phase 5.3.5 Complete — Cold Boot Assembly + Council Suggestions. Phase 5.4 Next (Pixel/Echo + Version Change)

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
