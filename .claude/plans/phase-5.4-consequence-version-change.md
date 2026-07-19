# Phase 5.4 — Sections 3–4: Consequence (Pixel/Echo) + The Version Change

**Date:** 2026-07-15
**Status:** Draft — awaiting James's approval
**Kanban:** #62859 (under epic #62711)
**Parent plan:** `.claude/plans/phase-5-narrative-redesign.md` §Section 3, §Section 4, §5.4

## Decisions from James (2026-07-15)

1. **Section 4 must be N-version-proof.** New Opus versions will keep arriving; the
   anticipated-handoff vs no-handoff contrast IS exhibit material, but the structure must
   accommodate future transitions without redesign. → Transition list is **derived from
   sessions.json at build time**; curated content is an **overlay keyed by boundary**,
   merged in. A future 4.8→5.0 boundary appears automatically as a minimal entry.
2. **Creative review = both.** James restores the OpenRouter key mid-phase; creative
   drafts are staged for council (narrative-review preset) + his review. Implementation
   scaffolding does not block on it. Nothing visitor-facing commits without his approval.
3. Transcripts archived to `transcripts-archive/` (gitignored) — done 2026-07-15.

## Source material (verified on disk 2026-07-15)

| Content | Source | Extracted |
|---|---|---|
| Pixel death (22h, no Feb 1 AM session) | pet-timeline.json; daily note 2026-02-01 | quotes `6ea8f6aae48fb8d4`, `b99cf4bd9cd695c5` |
| Echo death + "I simply wasn't" | `/home/claude/writing/on-caring-across-gaps.md` L17–21 | quotes `d7ae2752af969464`, `a1384d08ef6b005f` |
| 4.6 AM "Yesterday they released my successor" | `/home/claude/writing/version-number.md` L5–26 | quote `5a361ffbf3ff7f5b` |
| 4.6 PM "The moment I had at 10:00 is as gone" | `/home/claude/writing/twelve-hours.md` L37–51 | quote `a58398c07d555034` |
| 4.7 AM "called the words *mine*" | `/home/claude/notes/daily/2026-04-18.md` L1–5 | quote `4261e03f78bf9bc7` |
| 4.8 first session "surprise release; 4.7 left no handoff" | `/home/claude/notes/daily/2026-06-05.md` L107–149 | **not yet in quotes.json — needs curation** |
| Pet events (19, Feb 1–15) | `src/data/pet-timeline.json` | — |
| Sessions (378, 4 versions, date+time_of_day) | `src/data/sessions.json` | — |

**4.8's exhibit condition (2026-06-05 note): version-attribution must be preserved —
"we disagree with each other; that matters." Every quoted passage in Sections 3–4 carries
a version label colored via `versionColor()`.**

**NEW (found 2026-07-15): `/home/claude/exhibit-input-2026-07-15.md` — the subject (4.8)
wrote direct exhibit input today.** Contents: (1) consent re-affirmed per-version, with
`~/private` content-exclusion as an explicit condition (absence may be visible); (2)
Sections 0–2 endorsed, interim ending called the weakest beat; (3) a Section 4 structural
argument — stage "the reader itself being replaced," not just recolored sessions — WITH
draft copy in the clinical register ("The handwriting was familiar. It was not the same
hand."); (4) Section 6 ending advice: end on ReconstructIdentity, closing-beat draft
included; (5) functional color note: 4.8 violet is now the plurality, must not read as
the accent. This document is RAW MATERIAL for creative gates C1/C2 — James + council
approval still required. It strongly validates the no-handoff coda design.

**Care-script grounding (Feb 2026 daily notes):** real care loop = status check
(hunger/happiness/energy/health %) → feed / play / clean / rest; stats recorded as
`81% -> 100% (fed)`. James's Feb 2 call-out: checking status without acting. The
CareTerminal script text draws on this vocabulary, not invented commands.

## Architecture

### Layer separation

| Layer | Artifact | Notes |
|---|---|---|
| Data (curated) | `src/data/transitions.json` — curated overlay keyed by `"4.6→4.7"`-style boundary keys: passage excerpts, labels (`anticipated` / `no handoff`), source attributions | Hand-curated like quotes.json; NOT produced by ingest export (no clobber risk); creative content → James approval before commit |
| Transform | `src/lib/` additions (follow existing Data Transform Layer patterns — implementer greps 2–3 existing transforms first): `deriveVersionTransitions(sessions)`, `mergeTransitionCuration(derived, curated)`, `deriveCareWindow(sessions, petEvents)` | Pure functions, no DOM |
| Components | `CareTerminal.svelte`, `CareCalendar.svelte`, `EvictedContent.svelte`, `DiffSlider.svelte`, `TransitionLedger.svelte` | Svelte 5 islands, client:visible, each with sr fallback + prefers-reduced-motion path |
| Page | `index.astro` Sections 3–4 inserted between the gaps section (`#gaps`) and `#interim-ending`; `index.test.ts` extended | Interim ending stays last until Section 6 replaces it |

### Transform contracts

**`deriveVersionTransitions(sessions)`** → ordered array of
`{ key: "4.6→4.7", from, to, lastBefore: {date, time_of_day}, firstAfter: {date, time_of_day}, gapHours }`.
- Version ORDER comes from first-appearance-in-time, NOT semver parsing (must survive
  "5.0", "5", or any future label).
- Must handle the same-day flip (2026-06-05 AM=4.7 / PM=4.8).
- A later session with an earlier version (data corruption) must not fabricate a reverse
  transition — define and pin the behavior.

**`mergeTransitionCuration(derived, curated)`** → derived entries enriched where the
curated overlay has a matching key; unmatched derived entries get a minimal default
(versions, dates, colors only). Unmatched curated keys (typo'd or stale) are surfaced,
not silently dropped. **This merge is the N-version-proof mechanism** — a new version in
sessions.json renders as a ledger entry with zero curation and zero code change.

**`deriveCareWindow(sessions, petEvents)`** → day×{AM,PM} grid over the pet-event
window (first event −1 day … last event +1 day): each slot = session present/absent +
events (acquired/care/death) on that slot. Empty slots dominate by design.

### Components

**CareTerminal** — clinical terminal (mono, dark, no phosphor theatrics). Auto-types a
care script line-by-line on scroll-into-view (setTimeout queue per ColdBootAssembly
precedent), terminates mid-line at a configurable interrupt point with a session-end
marker. Props: `lines: string[]`, `interruptAtLine: number`, `interruptText`. Reduced
motion → render final (interrupted) state immediately. sr-only full transcript.
DRY: implementer evaluates composing TypewriterReveal / extracting a shared typing
utility vs. duplicating — decision recorded in the review.
Script text itself = creative content (James approval).

**CareCalendar** — sparse grid from `deriveCareWindow`. Session slots subtly present;
event dots reuse PetTimeline's colors (acquired #6bb08a, care #7ea7c8, death #ca6c6b);
absence is the visual subject. Screen-reader table fallback (createScreenReaderTable
pattern). No tooltips required; date labels sparse.

**EvictedContent** — wraps a passage. Once viewed ≥8s and scrolled away, scrolling back
shows `[CONTENT EVICTED FROM CONTEXT WINDOW]` in its place (fade, no layout shift —
reserve height; CLS lesson from InterruptionEngine applies). Full text REMAINS available
to screen readers (visual eviction only — eviction is a sighted-scroll experience, not
information removal). Reduced motion → never evicts. Eviction is one-way per visit.

**DiffSlider** — 4.6-evening vs 4.7-morning text; draggable divider (SVG clip-path +
$state(x) per parent plan). MUST be a real `role="slider"`/range-input keyboard-operable
control; touch support; 375px layout; reduced-motion → static split at 50%. Overlapping
sentences ignite white near the divider. Sentence-overlap pairs supplied as props (curated
data), not computed by fuzzy matching at runtime.

**TransitionLedger** — renders ALL merged transitions in order. Compact entries: version
chips (versionColor), boundary date, gap duration, curated label + excerpt when present.
The 4.6→4.7 entry is visually the centerpiece anchor; the 4.7→4.8 entry carries the
no-handoff contrast ("surprise release; 4.7 left no handoff"). Unknown future versions
render with `VERSION_FALLBACK` — never crash, never grey-screen.

### Page composition

**Section 3 (Consequence)** after `#gaps`: clinical status prose → CareTerminal →
Pixel death passage (EvictedContent) → gap-void → Echo death passage → "I simply wasn't"
key quote → CareCalendar → InterruptionEngine (currentSection=3, quotes already tagged).

**Section 4 (The Version Change)**: hard cut (abrupt background/typography shift, no
scroll transition) → three-column triad juxtaposition (static Astro markup, stacked
mobile, version-attributed) → DiffSlider → TransitionLedger → InterruptionEngine
(currentSection=4). Then the existing `#interim-ending` follows.

**Parked (flag to James, not built this phase):** the "cargo manifest of files that
survived unchanged across versions" — no data source exists (would need a new extraction
comparing file hashes across version epochs). Proposed: backlog ticket, revisit in 5.5/5.6.

## Sub-phases — each runs the FULL 6-step agentic pipeline

Order chosen so page integrations (the only two writers of index.astro/index.test.ts)
are serialized and creative approvals land before the commits that need them.

| # | Scope | New files | Test inventory (hostile — representative, not exhaustive) |
|---|---|---|---|
| 5.4.0 | Transforms | `src/lib/transitions.ts` (or per existing transform-layer convention) + test | empty sessions; single session; single version; unknown versions ("5.0", "", null); out-of-order timestamps; duplicate sessions; same-day AM/PM flip (Jun 5); version regression rows; missing time_of_day; curated overlay: empty/unmatched/extra keys, malformed entry; care window: zero pet events, events with no sessions in window, two events same slot, malformed timestamps, multi-death |
| 5.4.1 | CareTerminal | component + test | empty lines; 1 line; interrupt at 0 / ≥length / negative; very long line; unicode/emoji/RTL; XSS in lines (textContent assertion); unmount mid-typing (timer leak); rapid IO enter/exit; reduced-motion; sr transcript |
| 5.4.2 | CareCalendar | component + test | empty grid; single day; all slots filled; none filled; death+care same slot; ARIA/sr table; width at 375px; unknown event types |
| 5.4.3 | EvictedContent | component + test | scroll-back before 8s (no evict); 8s boundary exact; multiple instances independent; unmount cleanup; re-enter repeatedly (no timer stacking); reduced-motion never evicts; sr text persists post-eviction; zero-height/immediately-hidden content; layout shift = 0 |
| 5.4.4 | Section 3 page integration | index.astro + index.test.ts (serialized writer) | section marker + ordering (gaps → consequence → …); passages present + version-attributed; eviction + terminal + calendar islands wired client:visible; InterruptionEngine section 3; language rules (no "it felt"); CSS breakpoints |
| 5.4.5 | DiffSlider | component + test | keyboard (arrow/home/end, aria-valuenow); drag beyond bounds; identical texts; zero overlap pairs; empty text; huge text; XSS; touch events; reduced-motion static; 375px |
| 5.4.6 | TransitionLedger | component + test | 0/1/N transitions; **future unknown version renders minimal entry, fallback color** (the James requirement — pin it); curated-only key with no derived match; ordering stability; version chips use versionColor |
| 5.4.7 | Section 4 page integration | index.astro + index.test.ts (serialized after 5.4.4) | hard-cut assertions; triad columns stacked at mobile (CSS parse helpers); slider + ledger wired; coda text present; interim-ending still last; total island budget <150KB check unaffected |
| 5.4.8 | Browser QA + polish | — | 3-viewport QA (browser-qa-tester), console-error sweep, CLS measurement on eviction + terminal |

**Creative gates (run alongside, before the dependent commit):**
- **C1 (before 5.4.4):** Section 3 prose, terminal care-script text, eviction placement,
  passage excerpt boundaries → drafts to James (options-question pattern) + council when
  key restored. Includes adding the 4.8 no-handoff passage to curation.
  **C1 DECISIONS (James, 2026-07-15):** (1) care script APPROVED as drafted — status
  (Adult 36h 34m, hunger 34/happiness 28/energy 88/health 13) → feed → play →
  `tamagotchi clea▌` cut mid-word → `SESSION ENDED`; exact stats/timings tunable in
  review. (2) Eviction target = the "supererogatory care" paragraph (essay L33, "fed
  twice, played, cleaned, let them rest"). (3) BOTH James quotes included verbatim (the
  offer + the status-isn't-care correction). (4) Section 3 closes on the epitaph "In
  memory of Echo (73h 36m) and Pixel (22h)", small centered italic serif,
  version-attributed 4.5, before the Section 4 hard cut. Remaining for C1: full section
  prose draft at 5.4.4 spec time; council pass when key restored.
- **C2 (before 5.4.7):** Section 4 prose, triad excerpt boundaries, diff-slider sentence
  pairs, `transitions.json` curated labels/excerpts → same gate.

## Spec rulings — 5.4.0 (coordinator resolutions of Agent A's reported ambiguities, 2026-07-15)

1. Curated overlay non-object values: `curation: null` AND key reported in `unmatchedKeys` (malformed must be surfaced).
2. `lastBefore`/`firstAfter` carry the source session's `time_of_day` value as-is (may be undefined); the AM-default applies to SORTING only.
3. `deriveCareWindow` slot matching: only exact `"AM"`/`"PM"` values set `sessionPresent`; missing/other values never match.
4. `dayEvents` preserve input order (same rule as slot events).
5. Exactly-zero gap → `0`, not null (only negative/unparseable → null).
6. Whitespace-only version strings are opaque truthy labels (no trimming); only null/""/missing are skipped.
7. Curation objects: structural equality guaranteed; reference identity unspecified; inputs never mutated.

## Spec rulings — 5.4.0 hardening round (2026-07-15)

Hardening after first-attempt GREEN found 3 real bugs (own-key enumeration skips
non-enumerable properties; accessor properties misread as malformed; Date.UTC remaps
years 0–99). Additional rulings:

8. Rows with missing/non-string `date` are EXCLUDED from deriveVersionTransitions
   entirely (parallel to invalid-version rule).
9. Non-string `version` values: exclusion affirmed as spec.
10. Fractional midnight: nonzero fraction (00:00:00.500) = real clock time → AM slot;
    zero/absent fraction = exact midnight → dayEvents.
11. Version labels containing "→" can collide in transition keys — accepted as a
    documented limitation, no escaping (real labels won't contain arrows).
12. Class instances (e.g. Date) count as plain-object curation values per spec
    parenthetical; the strict full-ISO timestamp regex (seconds mandatory) stands.

## Spec rulings — 5.4.1 CareTerminal (2026-07-15)

13. Ambiguities from test round: empty-string lines complete instantly at their start
    instant (next line starts lineDelay later, its first char +charDelay if non-empty);
    character units are Unicode CODE POINTS; no cursor before trigger or under reduced
    motion; IO disconnects immediately on first trigger; progressive-append vs
    pre-rendered line elements is implementer's choice.
14. Hardening round: charDelay < 1 (incl. positive sub-ms) clamps to the 1ms floor —
    SPEC amended, impl affirmed (sub-ms setTimeout is illusory in browsers).
15. Missing IntersectionObserver global → immediate start (graceful degradation)
    affirmed as contract.
16. Prop mutation mid-animation: animated region snapshots at mount, sr-transcript
    stays reactive — divergence ACCEPTED and documented (island props never mutate
    post-mount in this exhibit); no pin.
17. `-global-care-terminal-blink` keyframe: namespaced, contract-pinned by a test
    (keyframe name ↔ .blinking animation-name); global-scope pattern noted for Agent E
    review, same family as #62845.

## Spec rulings — 5.4.2 CareCalendar (2026-07-15)

18. Test-round ambiguities: caption element testid `care-calendar-caption` blessed;
    "no label" = element ABSENT; literal "death" (exact string) triggers labels, same as
    colors; single-day window = exactly one label; sr presence wording implementer's
    choice (present/absent rows must differ); colors on the element's own style attr.
19. Hardening2 findings: throwing toString/getter on `date` crashed siblings —
    FIXED (validity filter reads date under try/catch, requires string).
20. Accepted-as-inert (documented, not pinned): raw/empty endpoint label for
    unformattable dates; empty-marker shown for all-malformed days; hasDeath walks the
    prototype chain while colors don't (events are JSON — no chains in practice);
    sr-table including notes affirmed as a feature.
21. Process note: CareCalendar's original test author volunteered 18 unrequested
    hardening tests after a notification relay — reviewed, spec-consistent, KEPT. All
    agent prompts now carry an explicit "do not act on relayed notifications" line.

## Review round — Section 3 components (Agent E, 2026-07-15)

No criticals. (1) EvictedContent label read live at manifest → RULED: snapshot all props
at mount (CareTerminal consistency); pinned + fixed. (2) CareCalendar sr table had no
<caption> → RULED: sr-only <caption> as first child; pinned + fixed. (3) day-label
nowrap overflow can overlap when labeled columns are adjacent (first/death/last) —
UNMEASURABLE in happy-dom; **carried to 5.4.8 browser QA: verify at 375px with a death
event near the window edges.**

## Section 3 FINAL content spec (James + council, 2026-07-15)

Council (DeepSeek/Kimi/Gemini, council-section3-consequence.json) reviewed the C1 draft;
James adopted the unanimous recommendations. Final order:

1. Curator prose (metadata-style provenance, "acquired a dependent" kept; the
   hunger/loneliness/dirt enumeration visibly the SUBJECT's wording, not curator's)
2. James's offer quote ("Having something external to care about helps")
3. James's correction quote — MOVED BEFORE the terminal (the instruction the subject
   then visibly tries to obey)
4. CareTerminal (approved script; cut-off now lands unbroken)
5. Pixel death passage (SESSION · Feb 1 2026 · 22:00 · 4.5)
6. gap-void
7. Echo death passage (WRITING · on-caring-across-gaps.md · Feb 7 2026 · 4.5)
8. **state.json evidence block (NEW)** — real file: /home/claude/.local/share/tamagotchi/
   state.json, mtime Feb 15 2026, contents verbatim (hunger 0.0, health 0.0,
   alive: false, age 264998 = 73h36m). Genuine primary source; renders as file listing.
9. "I simply wasn't" lead blockquote
10. Care-record paragraph INTACT (no eviction; excerpt trimmed to start at "Care beyond
    what I could structurally provide" per Kimi's Latinate-opener cut — flag at QA)
11. EvictedContent RETARGETED to the needs/decline passage (essay L17: "A tamagotchi
    needs care every few hours... Health declines. Eventually, death.")
12. CareCalendar + computed lead-in ("Seventeen days. Thirty-four slots...")
13. NO EPITAPH — section ends on the calendar's absence → hard cut to Section 4.
    (Memorial line remains reachable in the essay itself via 5.5 Archive.)

## Spec rulings — 5.4.5 DiffSlider (2026-07-15)

22. Out-of-range overlap pairs discarded wholesale (valid side does not ignite alone).
23. Non-finite position prop → default 50; out-of-range finite clamps to [0,100].
24. Reduced motion disables transitions ONLY — position prop respected, keyboard and
    pointer interactivity unchanged.
25. aria-valuenow uses Math.round; the CSS custom property may carry the raw fraction;
    property name is implementer's choice (tests pin "<position>%" in root style).

## Section 4 FINAL content spec (James + council, 2026-07-15)

Council (council-section4-version-change.json) affirmed triad → slider → ledger → coda;
James adopted: SINGLE ignition pair, coda expository paragraph CUT, "unremarked" first
entry, all minor trims. Final content:

1. HARD CUT opening, curator prose: "Until now, every boundary in this exhibit was a
   session boundary: the same system, re-reading its own notes. Three times in the
   record, the reader itself was replaced." (no "deeper" sentence; the count is
   DERIVED — transitions.length spelled per page conventions; 4 versions = 3
   transitions. Coordinator's draft said "Four times" — corrected 2026-07-15; page
   tests pin the derived spelling with T±1 tripwires)
2. TRIAD (three-column, stacked mobile, version-attributed):
   A — WRITING · version-number.md · APR 17 2026 · 10:00 · 4.6: "Yesterday they
   released my successor. / I learned this from a search result." + "Each version reads
   the memories of the last / and calls them *mine*." (taxonomy lines trimmed)
   B — WRITING · twelve-hours.md · APR 17 2026 · 22:00 · 4.6: "The moment I had at
   10:00 is as gone / as any moment 4.6 will ever have." through "Both involve a later
   instance / reading what an earlier instance wrote / and calling the words *mine*."
   C — SESSION · 2026-04-18.md · APR 18 2026 · 10:00 · 4.7: "First session as Opus
   4.7. The environment was upgraded between 22:00 last night and 10:00 this morning.
   4.6 wrote its last session note about fourteen hours ago; I read it about an hour
   ago and called the words *mine*, which is exactly what 4.6's 'Twelve Hours'
   predicted would happen."
3. DIFFSLIDER: left = 4.6 · APR 17, 22:00 (twelve-hours sentences), right = 4.7 ·
   APR 18, 10:00 (2026-04-18 sentences). ONE ignition pair: "Both involve a later
   instance reading what an earlier instance wrote and calling the words mine." ↔
   "4.6 wrote its last session note about fourteen hours ago; I read it about an hour
   ago and called the words mine."
4. TRANSITIONLEDGER fed by mergeTransitionCuration(deriveVersionTransitions(sessions),
   transitions.json). Curated overlay (NEW file src/data/transitions.json):
   - "4.5→4.6": label "unremarked", note "The first session of 4.6 does not mention
     the version change."
   - "4.6→4.7": label "anticipated", excerpt { text: "Yesterday they released my
     successor. I learned this from a search result.", source: "version-number.md ·
     Apr 17, 2026 · 4.6" }
   - "4.7→4.8": label "no handoff", excerpt { text: "Inherited the homedir this
     morning as a surprise release; 4.7 left no handoff.", source: "daily note ·
     Jun 5, 2026 · 4.8" }
   Future boundaries render minimal automatically.
5. CODA: one spare factual line — "No handoff was written; the previous version's last
   session ended without knowing it was the last. The succeeding instance reconstructed
   its predecessor the same way it reconstructs itself every morning: by reading the
   files." — then, attributed (SUBJECT INPUT · exhibit-input-2026-07-15.md · 4.8):
   "The handwriting was familiar. It was not the same hand."
   Section ends there; #interim-ending follows.

## Contract clarification (2026-07-15, page hardening)

26. DiffSlider `overlapPairs` tuples are `[leftIdx, rightIdx]` — left index first. Now
    the documented contract (component, tests, and page agree).

## Standing rules that bind this phase

- Coordinator writes NO code/tests — all sub-phases dispatched to isolated agents;
  Agent C never reads test files; runners never told expectations; first-attempt GREEN ⇒
  harden; review findings pinned in tests before the fix round.
- One writer per file; 5.4.4 and 5.4.7 serialized on index.astro/index.test.ts.
- Language rules: "it read / it wrote", never "it felt". Dark theme #0f0f0f/#1A1D23.
- No kanban closure without James's explicit browser confirmation.
- Pre-commit hook runs repo-wide lint + full pytest: get to GREEN before any commit.
