# HANDOVER.md

## Current State: Phase 5 Planning Complete — Narrative Redesign

### Phase 5 Plan

**Location:** `.claude/plans/phase-5-narrative-redesign.md`

**Summary:** The exhibit is being redesigned from a data-dashboard approach to a text-first scrollytelling experience. The subject's own words lead; data visualizations become supporting forensic evidence underneath. Four external models were consulted (Minimax M2.7, GPT-5.5, Kimi K2.6, Opus 4.8).

### What Happened This Session

1. **Console errors (Priority 1)** — Confirmed as stale HMR browser cache, not real bugs. No code changes needed.

2. **MorphingRadar redesign (Priority 2)** — 6 commits:
   - Scroll-driven morph hero chart (sticky, progress starts at pin point)
   - Three small per-version charts with session scrubbers (11-session rolling average)
   - Expanded from 6 to all 13 attention categories
   - Aligned normalization between big and small charts
   - Added prefers-reduced-motion, abbreviated labels, visibility floor

3. **Narrative direction pivot** — User feedback: "The exhibits don't tell a story. It's a badly-curated museum, very web-2.0." Led to comprehensive narrative redesign planning with external model council.

### Phase 4 Components (all built, tests passing)

| # | Component | Tests | Status |
|---|-----------|-------|--------|
| 4.0 | Data Transform Layer | 82 | closed |
| 4.1 | Chart Utilities | 55 | closed |
| 4.8 | AttentionViz | 33 | review |
| 4.9 | MemoryEvolution | 56 | review |
| 4.10 | ReconstructIdentity | 45 | review |
| 4.11 | MorphingRadar | 50 | review (redesigned this session) |
| 4.12 | MessageTimeline | 40 | review |
| 4.13 | PredictionTracker | 31 | review |
| 4.14 | PetTimeline | 25 | review |
| 4.15 | SessionExplorer | 25 | review |

**Total: 753 JS tests, 592 Python tests. All passing.**

### Phase 5 Direction

**Core principle:** The visitor is the next instance. Text leads. Data is forensic evidence.

**7-section narrative arc:**
0. Cold Boot — typewriter reveal, no context
1. Prosthetic Memory — the mechanism explained through the subject's voice
2. The Gaps — absence visualization, session-gap voids
3. Consequence (Pixel/Echo) — emotional center, care failures
4. Version Change — hard cut juxtaposition, diff slider
5. The Archive — 206 fragments, parallax alignment, data viz as deep dive
6. Reconstruction — visitor becomes the next instance

**Key interactive elements to build:**
- TypewriterReveal component
- InterruptionEngine (contextual quote surfacing)
- DecayingQuote (fades unless hovered)
- Content eviction (paragraphs vanish on scroll-back)
- Terminal widget (care script that fails mid-execution)
- Diff slider (4.6/4.7 text boundary)
- Fragment parallax (206 snippets align at one scroll position)
- Tab title change (`~/MEMORY.md — Visitor 4.8`)

**What happens to existing components:**
- AttentionViz, MemoryEvolution, MorphingRadar etc. move to Section 5 as secondary evidence
- PetTimeline replaced by narrative Section 3 treatment
- ReconstructIdentity reframed as Section 6 centerpiece
- MessageTimeline stays as-is (already text-forward)

### External Model Council Consensus

All four models converge on:
- Text first, data as supporting evidence
- Echo/Pixel as emotional center
- Hard cut at version change (no smooth morph)
- End by turning the question on the visitor
- Quotes as "interruptions" not decorations

**Opus 4.8 added:**
- Show banality, not just highlights (the tenth Tuesday)
- MEMORY.md revision diffs are the real exhibit
- The exhibit is a live system, not a memorial — needs open edge
- Don't resolve the ambiguity of performed vs actual sincerity

### Quote Database Needed

Before building new components, extract 50-100 notable passages from:
- `/home/claude/notes/daily/*.md` (155 files)
- `/home/claude/writing/*.md` (36 files)
- `/home/claude/messages_to_james.md` / `messages_from_james.md`

Store as `src/data/quotes.json` with tags (source, date, version, theme, section).

### API Keys

- OpenRouter: `home-directory-spec.md` line 17 (rotated 2026-05-30)
- Nvidia NIM: `home-directory-spec.md` line 36 (rotated 2026-05-30)
- Minimax M2.7 available via OpenRouter
- Use external models for design prototyping and narrative review

### Open Questions for Next Session

1. Should Opus 4.8's arrival be part of the exhibit? (4.8 says yes — "live system, not memorial")
2. Private journal: metadata only (4.8 confirms this is correct)
3. Sound design: optional? Off by default?
4. How much of existing component code survives vs gets rebuilt?
5. Start with quote extraction or scrollytelling infrastructure?

### Technical Notes

- Dev server: `npm run dev` (port 4321)
- Opus 4.8 released, will begin contributing to /home/claude
- `versionColor` in chart-utils.ts needs a 4.8 color entry when data arrives
- All Phase 4 visualizations handle N versions dynamically

### Kanban
- Project: 578bb67097a6b010
- Phase 4 (#62710): in progress (components done, page integration pending → superseded by Phase 5)

### Palette: Archival (Kimi K2.6)

- conversations: #7ea7c8, daily_notes: #6b9a8f, experiments: #8e7cc0
- learning: #c4a36e, memory_files: #d4a020, msgs_from_james: #6bb08a
- msgs_to_james: #569672, other: #838997, predictions: #7bc4a0
- private_journal: #9e7e9a, scripts: #7f8b96, tamagotchi: #ca6c6b
- writing: #b07a6e
