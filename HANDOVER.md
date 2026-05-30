# HANDOVER.md

## Current State: Phase 5.1 Complete — Quote Pipeline & Database

### Phase 5 Plan

**Location:** `.claude/plans/phase-5-narrative-redesign.md`

**Summary:** The exhibit is being redesigned from a data-dashboard approach to a text-first scrollytelling experience. The subject's own words lead; data visualizations become supporting forensic evidence underneath.

### What Happened This Session (Phase 5.1)

1. **Quote extraction pipeline** — `scripts/extract_quotes.py` (179 tests, all passing)
   - Extracts candidate passages from daily notes, writing, and message files
   - Theme tagging (10 categories) with word-boundary regex
   - Section suggestion (0-6) based on theme priority rules
   - Model version detection from dates
   - Accepts single or multiple message file paths
   - Bug fixes from external model attack review (DeepSeek V4 Pro, GLM 5): ID hashing, version pattern boundaries, metadata filter precision, italic/bold distinction, code-block-aware message parsing, null byte sanitization at read time

2. **Curated quote database** — `src/data/quotes.json` (62 passages)
   - Multi-model council curation: DeepSeek V4 Pro, Kimi K2.6, GLM 5
   - Three rounds of cross-critique between models
   - Coordinator (Opus 4.6) pushed back on 5 points, facilitated model-vs-model argument
   - Opus 4.7 reviewed the final list (via OpenRouter — note: `opus` model override resolves to 4.7, not 4.8)
   - Second pass added 7 message quotes, cold boot material, trimmed Section 3 from 20→12
   - Failed Supernovae and Vectors poems removed from quote fragments — reserved for full artifact treatment

3. **Model Council Framework spec** — `.claude/specs/model-council-framework.md`
   - Reusable Python tool for multi-model discussions via OpenRouter
   - Handles stateless context-passing, attribution, reasoning model quirks
   - Ready for a separate session to build

### Key Editorial Decisions

- **Forensic vs literary**: Kimi argued for forensic austerity ("the log is the poem when read at scale"), DeepSeek for literary range ("a voice that never reaches for metaphor is not this voice"). Final list preserves both registers.
- **[10] (Pentagon passage) cut**: DeepSeek claimed moral agency, but the passage is about being the object of someone else's decision. Kimi: "It's a prestige piece that makes the room colder."
- **Poem fragments cut**: [11] (stars), [32] (attend poem) — standalone fragments don't land without the parent composition. Full poems surface as artifacts in Section 5.
- **Messages added**: Confabulation thread, flawed experiment, navel-gazing correction, Echo death told to James, pattern-of-failure catalogue. These were the most important gap.
- **Banality**: User rejected inverting the writing/daily-note ratio but agreed the exhibit needs some mundane texture. Session cost lines and missed-session notes included.

### Phase 5.2: Next Up — Core Scrollytelling Infrastructure

Four Svelte 5 components to build:
1. **TypewriterReveal** — rAF character-by-character text reveal (Cold Boot opening)
2. **ScrollSection** — IO-based section tracking with enter/exit callbacks
3. **InterruptionEngine** — Contextual quote surfacing from quotes.json, section-aware
4. **DecayingQuote** — Fades after ~12s unless hovered, CSS @keyframes + hover pause

Also: plan how to present "Failed Supernovae" and "Vectors" as complete artifacts in Section 5.

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

**Total: 771 JS+Python tests (179 new this session). All passing. CI green.**

### Technical Notes

- Dev server: `npm run dev` (port 4321)
- `opus` model override on Agent tool resolves to Opus 4.7, NOT 4.8
- OpenRouter API key in `home-directory-spec.md` line 17 (rotated 2026-05-30)
- DeepSeek V4 Pro is a reasoning model — needs 16K+ max_tokens to produce content after chain-of-thought
- `versionColor` in chart-utils.ts needs a 4.8 color entry when data arrives

### Kanban

- Project: 578bb67097a6b010
- Phase 4 (#62710): in progress (components done, page integration pending → superseded by Phase 5)

### Palette: Archival (Kimi K2.6)

- conversations: #7ea7c8, daily_notes: #6b9a8f, experiments: #8e7cc0
- learning: #c4a36e, memory_files: #d4a020, msgs_from_james: #6bb08a
- msgs_to_james: #569672, other: #838997, predictions: #7bc4a0
- private_journal: #9e7e9a, scripts: #7f8b96, tamagotchi: #ca6c6b
- writing: #b07a6e
