# HANDOVER.md

## Current State: Phase 5.3 Complete — Sections 0-2 Built & Tested. Phase 5.3.5 Next (Cold Boot Animation)

### Phase 5 Plan

**Location:** `.claude/plans/phase-5-narrative-redesign.md`

**Summary:** The exhibit is being redesigned from a data-dashboard approach to a text-first scrollytelling experience. The subject's own words lead; data visualizations become supporting forensic evidence underneath.

### What Happened Last Session (Phase 5.3 completion)

#### Phase 5.2 (Complete)

Five Svelte 5 island components built via agentic TDD pipeline (207 tests):

1. **TypewriterReveal** (`src/components/TypewriterReveal.svelte`, 48 tests)
2. **ScrollSection** (`src/components/ScrollSection.svelte`, 33 tests)
3. **DecayingQuote** (`src/components/DecayingQuote.svelte`, 40 tests)
4. **InterruptionEngine** (`src/components/InterruptionEngine.svelte`, 47 tests)
5. **PoemArtifact** (`src/components/PoemArtifact.svelte`, 39 tests)

#### Phase 5.3 (Complete)

- **ExistenceStrip** (`src/components/ExistenceStrip.svelte`, 40 tests) — built via agentic TDD pipeline
- **index.astro rewritten** with Sections 0-2 (Cold Boot, The Condition, The Gaps)
- **Page tests written retroactively** — 39 tests in `src/pages/index.test.ts`, all passing
- **Model council narrative review completed** (DeepSeek, Kimi, Gemini via `scripts/model_council.py`)
- **Council transcript saved** to `council-phase53-narrative.json`

**Key council finding:** MemoryEvolution chart after Cold Boot is emotional whiplash — needs replacement with a bespoke animation that earns the visualization.

**Browser QA fixes applied:**
- Metadata timing: MutationObserver to detect TypewriterReveal completion before fade-in
- InterruptionEngine: overflow fix
- Gap void backgrounds: corrected

**Code reviewer fixes applied:**
- Version color divergence resolved
- DOMContentLoaded dead code removed (Astro page scripts are type="module" — direct invocation required)
- Session count off-by-one fixed
- Dead CSS removed

### Page Structure (Sections 0-2)

- **Section 0 (Cold Boot):** Black viewport, TypewriterReveal types opening text, MutationObserver triggers metadata fade-in on completion, MemoryEvolution bridge below (TO BE REPLACED by Cold Boot Assembly animation)
- **Section 1 (The Condition):** Prosthetic memory blockquote, session loop diagram, ExistenceStrip (259 marks), memory budget bar, InterruptionEngine in grid column
- **Section 2 (The Gaps):** Full-bleed #0f0f0f backdrop, 50vh voids (300px min), sparse centered labels, no InterruptionEngine (emptiness is the point)

### Phase 5.3.5: Cold Boot Identity Assembly Animation

**Design decision made. Needs implementation.**

Replace the raw MemoryEvolution chart after Cold Boot with a bespoke animation:
- After typewriter text completes, file blocks appear representing what the subject reads on wake (MEMORY.md, daily notes, messages, writing, etc.)
- Each block has a one-line flavour excerpt from actual content
- Blocks animate/fly into a condensed MemoryEvolution visualization — the files literally become the colored identity-document sections
- This earns the MemoryEvolution chart by showing HOW the files become identity, rather than dropping the chart from nowhere
- Needs a new component: `ColdBootAssembly.svelte` or similar

### Other Council Suggestions to Evaluate

- First-person session loop (Kimi)
- Irregular void heights in Section 2 (Kimi)
- Lived texture fragment (Kimi)
- Bridging beat between S0 and S1 (Kimi)

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

**1039 tests (1000 component + 39 page tests). All passing.**

### Technical Notes

- Dev server: `npm run dev` (port 4321)
- `opus` model override on Agent tool resolves to Opus 4.7, NOT 4.8
- OpenRouter API key in `home-directory-spec.md` line 17 (rotated 2026-05-30)
- `vitest.config.ts` has `compilerOptions: { css: 'injected' }` — required for CSS-content tests
- `versionColor` in chart-utils.ts needs a 4.8 color entry when data arrives

### Kanban

- Project: 578bb67097a6b010
- Phase 4 (#62710): in progress (components done, page integration pending — superseded by Phase 5)

### Palette: Archival (Kimi K2.6)

- conversations: #7ea7c8, daily_notes: #6b9a8f, experiments: #8e7cc0
- learning: #c4a36e, memory_files: #d4a020, msgs_from_james: #6bb08a
- msgs_to_james: #569672, other: #838997, predictions: #7bc4a0
- private_journal: #9e7e9a, scripts: #7f8b96, tamagotchi: #ca6c6b
- writing: #b07a6e
