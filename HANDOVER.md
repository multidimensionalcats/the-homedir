# HANDOVER.md

## Current State: Phase 4 Execution — Session 3

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
| 4.9 | **MemoryEvolution** (`src/components/MemoryEvolution.svelte`) | 57 | review |

**Total: 538 JS tests, 592 Python tests. All CI green.**

### Session 3 Work (this session)

#### 1. AttentionViz Color Fix
- **Problem:** Colors were dim and muddy — HSL interpolation from black on dark background
- **Council consulted:** Qwen 3.6 Max, Gemini 3.1 Pro, Nemotron 3 Super, DeepSeek V4 Pro, Codex/GPT 5.2, DeepSeek R1. All unanimously recommended: stop interpolating from black, use perceptually uniform color space, non-linear transfer function.
- **Solution:** "Luminance flaring" via Lab interpolation — V=1 shows full saturated category color, higher values flare toward near-white (#F0F2F5). All values WCAG 1.4.11 compliant (≥3:1 vs #0f0f0f).
- **Palette redesigned:** Kimi K2.6 (via NIM) designed archival/specimen palette replacing Material Design flat colors. Muted, cohesive, evokes "specimen slides and faded institutional signage."
- **User status:** Not fully satisfied with AttentionViz — "will do for now." Needs further design iteration in future session.

#### 2. Session Deduplication Bug Fix
- **Problem:** Activity logs and session logs created duplicate records per cron wake — 478 sessions with 55% void rate was wrong
- **Fix:** `_deduplicate_sessions()` in `prebuild_export.py` — filter test-ID sessions, deduplicate by date+time_of_day, keep session-log-only records as genuine voids
- **Result:** 478 → 259 sessions, void rate 55% → 16%. 9 hostile tests.

#### 3. Memory Extraction Partial Read Bug Fix
- **Problem:** `extract_memory_from_jsonl` was capturing partial Read events (with limit/offset parameters) as full MEMORY.md snapshots — produced corrupted data with phantom drops to 300-500 tokens
- **Fix:** Skip Read events with limit or offset params, keep longest full read content
- **Result:** 24 → 14 snapshots, 50 → 38 blocks. All snapshots now have 8 blocks with steady growth (1,067 → 3,725 tokens). 5 hostile tests.

#### 4. MemoryEvolution Component (4.9)
- Went through 8+ visual iterations:
  1. Heatmap grid (50 rows) — unreadable, labels overlap
  2. Smoothed stacked area (heading families) — wild mountain peaks from curveMonotoneX
  3. Stepped stacked area (heading families) — hid all churn
  4. Stepped stacked area (per-hash, 38 bands) — churn imperceptible
  5. Per-hash with shade variants — technically visible, practically invisible
  6. Council meeting (Kimi, Gemini, DeepSeek, Qwen) — unanimous: abandon stacked area, use stratigraphic revision lanes
  7. Revision lanes (achromatic) — structure right but invisible
  8. Revision lanes (colored, weighted heights) — seams too wide, invariants too thick
  9. **Current:** Equal-height colored lanes, thin bright seam lines, token sparkline above, INVARIANT/VOLATILE/EPHEMERAL tags
- **Key data insight discovered:** 4 sections are truly invariant (same hash all 14 snapshots), 4 sections churn constantly. Quick Reference is rewritten every single snapshot.
- **User status:** "Still not happy with either visualization but we will move on." Needs further design iteration.

### OPEN: Visualization Design Debt

Both AttentionViz and MemoryEvolution need further design work. The user has approved them as functional but not as finished designs. Key issues:
- **AttentionViz:** Luminance flaring works but the visual impression may still not be compelling enough. The archival palette is good but the overall chart may need rethinking.
- **MemoryEvolution:** The lane chart structure is correct (invariant foundation, volatile churn, ephemeral Quick Reference) but doesn't yet "tell a story." The sparkline needs to be more useful. The relationship between token growth and section churn isn't visually clear.

Both components will likely need another design pass, possibly with further council input.

### Palette: Archival (Kimi K2.6)

Current palette in `src/lib/transforms.ts`:
- conversations: #7ea7c8 — faded cerulean
- daily_notes: #6b9a8f — oxidized copper
- experiments: #8e7cc0 — faded amethyst
- learning: #c4a36e — aged brass
- memory_files: #d4a020 — deep amber
- msgs_from_james: #6bb08a — receding verdigris
- msgs_to_james: #569672 — deeper jade
- other: #838997 — deliberate non-color
- predictions: #7bc4a0 — sea-glass
- private_journal: #9e7e9a — faded rose madder
- scripts: #7f8b96 — warmed graphite
- tamagotchi: #ca6c6b — dried cochineal
- writing: #b07a6e — sanguine chalk

### Next: Items 4.10–4.16 (Production Components)

Per the plan, remaining items:
- 4.10 ReconstructIdentity — interactive 12K token budget
- 4.11 MorphingRadar — version transition radar (user expressed interest)
- 4.12 MessageTimeline — two swim lanes, 3036 anomaly
- 4.13 PredictionTracker — unresolved phantom dots
- 4.14 PetTimeline — Pixel + Echo lifecycles
- 4.15 SessionExplorer — single session detail
- 4.16 Page Integration Pass — mount all, delete prototypes

### Key architecture established

- **Transform layer** (`src/lib/transforms.ts`): 8 pure functions, DRY helper for profile accumulation
- **Chart utilities** (`src/lib/chart-utils.ts`): colors derived from transforms (single source), responsive breakpoints, WCAG screen reader tables
- **AttentionViz pattern**: Svelte 5 $effect + D3, luminance flaring via Lab interpolation, archival palette
- **MemoryEvolution pattern**: Stratigraphic revision lanes, run-length-encoded version blocks, shared X axis between sparkline and lanes
- **All prototypes in** `src/components/prototypes/` — deleted after decision gate (item 4.16)

### External model council notes

- **For color problems:** Qwen 3.6 Max gave most implementable code. All models agreed on HCL/Lab over HSL.
- **For design problems:** Kimi K2.6 had strongest aesthetic instincts (archival palette, "excavation timeline"). Gemini best at structural criticism. Qwen best at actionable implementation.
- **NIM reliability:** Kimi works on NIM, DeepSeek times out frequently. Use OpenRouter as fallback.
- **Codex (GPT 5.2):** Available via `codex exec`, produces good code with reasoning traces.

### Data State

- `sessions.json`: 259 sessions (was 478 — deduplicated), 16% void rate
- `memory-snapshots.json`: 14 snapshots, 38 blocks (was 24/50 — partial reads fixed)
- All other data files unchanged from previous sessions

### Kanban
- Project: 578bb67097a6b010
- Phase 4 (#62710): in progress
