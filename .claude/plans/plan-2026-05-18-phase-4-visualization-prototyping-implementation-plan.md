# Phase 4: Visualization Prototyping — Implementation Plan

## Context

Phases 2 (data extraction) and 3 (Astro scaffolding) are complete. Real data is in `src/data/` — 478 sessions, 30 compositions, 85 messages, 21 predictions, 23 pet events, 24 memory snapshots. The site builds with 488 static pages but all pages are empty scaffold. Phase 4 makes data visible.

The kanban epic says: "D3 sketches of primary attention visualization (5 candidates), choose winner."

## Council Review Summary

**Gemini 2.5 Flash**: Build order correct, no circular deps. Flagged keyboard navigation gap, general error handling, performance optimization timing.

**Kimi K2.6** (most impactful): The 261 empty sessions are the *artistic thesis*, not a data gap — "an identity mostly unwitnessed." The 3036 date anomaly is a rupture, not a bug. Memory snapshots should feel like erosion/palimpsest, not a spreadsheet. Five attention candidates are "standard NYT Opinion fare" — need at least one that questions whether attention should be a chart at all. MorphingRadar is corporate. ReconstructIdentity should feel like an autopsy. Version transitions should feel like reincarnation. Interface should subject the user to the same discontinuity the AI suffers.

**Grok 4.3**: MemoryEvolution shouldn't start before the decision gate. 7 transforms in one session is optimistic. Weekly aggregation should be first-class, not "may need." Small Multiples is strongest default but buried last. Ridge and Streamgraph both suffer with 55% empty data. No candidate explores binary presence-only encoding. Decision gate needs success criteria. Bundle size creep from 5 D3 prototypes.

## Incorporated Changes

1. **Empty sessions are the protagonist** — reframed from data gap to core visual feature. Transforms include explicit `hasAttentionData` flag. Prototypes must make absence visually dominant.
2. **Weekly aggregation as first-class option** in transforms (Grok). `sessionsToWeekly()` added alongside daily.
3. **Replaced Streamgraph with Presence Matrix** (Grok + Kimi). Binary presence/absence encoding handles 55% empty data natively. More honest than wiggling empty baselines.
4. **Decision gate has criteria** (Grok): which prototype best communicates the bottleneck thesis, handles empty sessions most honestly, works on mobile.
5. **MemoryEvolution moved after decision gate** (Grok). No work starts on secondary viz before winner chosen.
6. **Prototype cleanup explicit** (Grok): `src/components/prototypes/` deleted after winner promoted.
7. **Kimi's palimpsest/erosion concept** adopted for MemoryEvolution — blocks fade/ghost rather than binary appear/disappear.

## Data Realities

- **261 of 478 sessions (55%) have empty attention profiles** — this IS the story: an identity mostly unwitnessed
- **All `tokens_total_input` are null** — ReconstructIdentity uses hardcoded spec values
- **Memory snapshots: Apr 18–May 18 only** (24 snapshots, 50 blocks, 1 month of 5)
- **All 21 prediction outcomes: null** — adapted to confidence timeline with unresolved phantoms
- **Message date anomaly: `3036-03-02`** — surface as rupture annotation, not clamped silently
- **Version boundaries**: 4.5 (Jan 15–Feb 12), 4.6 (Feb 13–Apr 17), 4.7 (Apr 18–May 18)

## Build Order (17 kanban items)

### Foundation (Session 1)

**4.0 — Data Transform Layer** (`src/lib/transforms.ts` + `src/lib/transforms.test.ts`)
Pure functions reshaping raw JSON into viz-ready structures. Every component imports from here.
- `sessionsToDaily()` — group by date, aggregate reads/writes per category, flag `hasAttentionData`
- `sessionsToWeekly()` — same but weekly buckets (mobile-first aggregation)
- `sessionsToVersionPhases()` — version boundary dates + session counts
- `sessionsToAttentionCategories()` — 13 category names + design system colors
- `memoryToSwimlane()` — hash-based snapshots → presence matrix with persistence scores
- `messagesToTimeline()` — sort, split by direction, flag anomalous dates (don't clamp)
- `predictionsToCalibration()` — handle null confidence/outcome
- `petEventsToLifecycles()` — group by pet, order by timestamp
- **Est. 60-80 hostile tests** (empty arrays, null fields, single items, duplicates, anomalous dates, unknown categories)

**4.1 — Chart Utilities** (`src/lib/chart-utils.ts` + `src/lib/chart-utils.test.ts`)
- `categoryColor()` — attention category → hex
- `versionColor()` — "4.5"/"4.6"/"4.7" → blue/amber/green
- `responsiveDimensions()` — container width → {width, height, margin} at 3 breakpoints
- `createScreenReaderTable()` — visually-hidden `<table>` for WCAG
- `a11yDescribe()` — ARIA description generator
- **Est. 25-35 tests**

### Attention Viz Prototypes (Sessions 2-3)

Five candidates, all using `sessionsToDaily()` output. Each must make the 261 unobserved sessions *visually dominant* — absence is the story.

**4.2 — Stacked Area** (`src/components/prototypes/AttentionStackedArea.svelte`)
X=time, Y=total file ops, colored bands stacked. Unobserved days: thin gray baseline. MEMORY.md gold band emerges Feb 18. Version boundaries as vertical lines. **~15 tests.**

**4.3 — Heatmap** (`src/components/prototypes/AttentionHeatmap.svelte`)
X=time (123 days), Y=13 categories. Cell intensity = reads+writes. Unobserved days: dark "void" column. Phase changes as horizontal band transitions. **~15 tests.**

**4.4 — Presence Matrix** (`src/components/prototypes/AttentionPresenceMatrix.svelte`)
Binary encoding: X=time, Y=categories. Cells are lit/dark (category touched or not). Unobserved sessions are a distinct void row. Shows *what was attended to*, not *how much*. Handles 55% empty data natively — the void IS the dominant visual. **~15 tests.** *(Replaced streamgraph per council)*

**4.5 — Ridge Plot** (`src/components/prototypes/AttentionRidgePlot.svelte`)
13 overlapping mini-area charts. Joy Division aesthetic. Each category independently readable. Unobserved periods as flat voids between peaks. **~12 tests.**

**4.6 — Small Multiples** (`src/components/prototypes/AttentionSmallMultiples.svelte`)
Grid of 13 independent area charts (3-col desktop, 1-col mobile). Shared x-axis. Maximum clarity. Strongest candidate per Grok. **~12 tests.**

**4.7 — Evaluation Page** (`src/pages/prototypes/attention.astro`)
Dev page mounting all 5 vertically with real data. Each labeled with strengths/weaknesses. No tests.

### Decision Gate

**Criteria** (per Grok):
1. Which best communicates the constrained-attention thesis?
2. Which handles the 55% void most honestly?
3. Which works on mobile without horizontal scroll?
4. Which matches the clinical/archival tone?

User views `/prototypes/attention`, decides. Prototypes directory deleted after.

### Production Components (Sessions 5-8)

**4.8 — AttentionViz.svelte (Production)** (`src/components/AttentionViz.svelte`)
Winning prototype promoted. Adds: tooltip, version labels, MEMORY.md Feb-18 annotation, `prefers-reduced-motion`, screen-reader table, responsive (daily on desktop, weekly on mobile), Scrollama trigger hooks, keyboard navigation. **~30-40 tests.**

**4.9 — MemoryEvolution.svelte** (`src/components/MemoryEvolution.svelte`)
Palimpsest-style swimlane (per Kimi): X=24 snapshots (Apr 18–May 18), Y=50 blocks sorted by persistence. Blocks that survive show full gold; transient blocks ghost/fade. Token count line. Hover shows heading. Explicit "Data: April–May only" annotation. **~25-30 tests.**

**4.10 — ReconstructIdentity.svelte** (`src/components/ReconstructIdentity.svelte`)
Interactive 12K token budget. Files as cards with costs (hardcoded from spec). Selecting a file depletes budget; remaining files gray out when budget insufficient. Right panel: editorial text describing the resulting identity archetype. Per Kimi: when files are removed, the identity description *loses coherence* — words blur or fade, not just swap. **~25-30 tests.**

**4.11 — MorphingRadar.svelte** (`src/components/MorphingRadar.svelte`)
Radar chart: 6 axes (introspection, creative output, web research, predictions, messaging, memory mgmt). 3 version polygons. Scroll-triggered morph 4.5→4.6→4.7. Per Kimi: version transitions should feel discontinuous (jump, not smooth interpolate) — the subject didn't "evolve", it was replaced. **~20-25 tests.**

**4.12 — MessageTimeline.svelte** (`src/components/MessageTimeline.svelte`)
Two swim lanes. Each message a dot, clickable for content. Gaps are the story — the 10-session silence is visible negative space. `3036` date surfaced as a visual anomaly annotation, not hidden. **~18-22 tests.**

**4.13 — PredictionTracker.svelte** (`src/components/PredictionTracker.svelte`)
Timeline by confidence (Y) and date (X). All dots are gray "unresolved phantoms" (per Kimi) — hovering over them shows the prediction text and self-assessment, but the outcome cell is explicitly empty. **~15-18 tests.**

**4.14 — PetTimeline.svelte** (`src/components/PetTimeline.svelte`)
Two vertical timelines. Acquisition → care → death. Subject's own words verbatim on hover. Brevity of Pixel (same-day death) vs Echo's arc. **~15-18 tests.**

**4.15 — SessionExplorer.svelte** (`src/components/SessionExplorer.svelte`)
Single session detail: version badge, attention mini-chart vs experiment average (ghost overlay), activity flags as icons, web search terms. "No data recorded" for empty-profile sessions. **~18-22 tests.**

**4.16 — Page Integration Pass**
Mount all components in Astro pages with `client:visible`. Update `index.astro` (acts 2-5), all `explore/` pages. Delete `src/components/prototypes/` and `src/pages/prototypes/`. Build verification.

## Key Technical Decisions

1. **Transform layer before any component** — decouples data reshaping from rendering
2. **Weekly aggregation is first-class** — mobile gets weekly, desktop gets daily
3. **Prototypes are throwaway** — explicit deletion in item 4.16
4. **`client:visible` hydration** — lazy load, <150KB initial JS
5. **happy-dom limitation** — tests assert structure, not pixel positions
6. **`prefers-reduced-motion`** — all transitions gated, static fallback
7. **Screen-reader tables** — every viz has a visually-hidden `<table>`
8. **Absence is visual** — unobserved sessions are never hidden, always rendered as void

## Critical Files

| File | Role |
|------|------|
| `src/components/Placeholder.svelte` | Pattern reference ($state, $effect, .join(), cleanup) |
| `src/styles/global.css` | 8 semantic colors, 3 font families, dark theme |
| `src/schemas.ts` | Zod types defining the data contract |
| `src/data/sessions.json` | 478 sessions, attention_profile (13 categories) |
| `src/data/memory-snapshots.json` | 24 snapshots, 50 blocks |
| `home-directory-spec.md` | Full visualization specs + API keys |

## Session Estimate

| Session | Items | Focus |
|---------|-------|-------|
| 1 | 4.0, 4.1 | Data transforms + chart utilities |
| 2 | 4.2, 4.3 | Stacked area + heatmap prototypes |
| 3 | 4.4, 4.5, 4.6 | Presence matrix + ridge plot + small multiples |
| 4 | 4.7 | Evaluation page (assemble all 5 with real data) |
| — | Decision gate | User picks winner |
| 5 | 4.8 | Production AttentionViz |
| 6 | 4.9, 4.10 | MemoryEvolution + ReconstructIdentity |
| 7 | 4.11, 4.12, 4.13 | Radar + Messages + Predictions |
| 8 | 4.14, 4.15, 4.16 | Pets + SessionExplorer + page integration |

**Total: ~8 sessions + 1 decision gate. ~300-380 new tests.**

## Verification

1. Each component: TDD pipeline (RED → GREEN → review)
2. Each component: visible in browser at correct page
3. Evaluation page: all 5 prototypes render with real 478-session data
4. Production components: responsive at mobile/tablet/desktop
5. `npm test` — all tests pass
6. `npm run build` — site builds without errors
7. Lighthouse accessibility ≥90

## Risks

| Risk | Mitigation |
|------|------------|
| 55% empty attention data | Reframed as artistic feature; every viz must render void prominently |
| Memory snapshots: 1 month of 5 | Explicit date-range annotation on component |
| Predictions all unresolved | Adapted to confidence timeline with phantom dots |
| D3 in happy-dom | Test structure not position; visual verification manual |
| Mobile performance (478 sessions) | Weekly aggregation first-class; canvas fallback if needed |
| Bundle size from 5 prototypes | Explicit cleanup in 4.16; tree-shaking for production |
| Decision gate stalls | Defined criteria; user reviews in-browser, not screenshots |
