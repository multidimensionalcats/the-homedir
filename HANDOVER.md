# HANDOVER.md

## NEXT SESSION: 5.5.4 (viz shelf) + 5.5.5 (Section 6 ending) — then 5.5.6 integration

**Read FIRST:** `.claude/plans/phase-5.5-archive-reconstruction.md` (5.5 plan, sub-phases
5.5.0–5.5.6) and `.claude/plans/phase-5.5-narrative-spine.md` (approved beats). Kanban:
#62884 (5.5 umbrella) under epic #62711. **5.5.0–5.5.3 ALL DONE.** Next: 5.5.4 then 5.5.5.

### AWAITING JAMES (do not close):
- **#62888 (5.5.2) and #62889 (5.5.3) stay OPEN** pending James's browser visual pass of the
  Archive section. Dev server on :4321; screenshots delivered (`.playwright-mcp/archive-*`).
  Say "ready for you to test" — do not close either.
- **One flagged item for his pass:** on DESKTOP the absence marker ("~/private — excluded")
  mildly overlaps the payoff *attribution* line at the alignment peak. PRE-EXISTING (not from
  the mobile fixes), his aesthetic call whether to reposition desktop too (same @media-override
  approach, non-mobile, would fix it).
- Older opens still unconfirmed: 5.5.1 (#62887 was marked done in kanban this session per
  James "can be closed"), #62894 (closed), and the QA-2/5.4 items from prior handover.

### 5.5.2 + 5.5.3 — what landed this session (2026-07-20 Fable → 2026-07-25 Opus)
Four commits, full agentic TDD throughout, full JS suite **2360/2360**:
- **5.5.2 `deriveArchiveFragments`** (93a7b64) in `src/lib/transforms.ts`. Joins quotes.json
  to same-day sessions; fragment = {id, sessionId, date, version, excerpt, source, sourceFile}.
  Deterministic FNV-1a sampling (no Math.random/Date), curation-parameterized (cap/excludeIds/
  pinnedIds/excerptRule). Hardening drew blood 3× (hostile getter escapes; input-order-dependent
  join → version-ascending tie-break ruling); review pin round (empty-string tieVersion). Spec:
  `.claude/plans/spec-5.5.2-archive-fragments.md`.
- **5.5.3 ArchiveField.svelte** (component 7ddc6a4, page wire 0a8a33c, mobile polish dde5ea0).
  FULL parallax: depth-layered drift, convergence into the payoff line at scroll-progress 0.5
  then break; labeled private-journal absence (opacity floor, never converges); reduced-motion
  static; aria-hidden field + sr-only sibling. Spec: `.claude/plans/spec-5.5.3-archive-field.md`.
  Wired into `index.astro` as `<section id="archive">` between bridging-beat-5 and interim-ending,
  `client:visible rootMargin -200px`.
- **CURATION LOCKED** (council 2 rounds via OpenRouter + James, kanban decisions #2702/#2701):
  excerptRule chars/160; cap 44 desktop / 24 mobile; 15 excludeIds (6 messages unanimous + 7 tone
  + a1384d08 + f3c31824); pinned payoff `36d6f7940ef64cea`; NO 4.8 note; 48 eligible fragments.
  James-approved sr copy: "Fragments from the subject's writing and daily notes drift in this
  field; at one point they align into a single line." Payoff/attribution: "Hello, future self…"
  / "discontinuous.md · 2026-01-16". All pinned in tests (curation-drift tripwire + rootMargin).

### KEY LEARNINGS THIS SESSION (carry forward)
- **OpenRouter key is LIVE again** — James rotated it 2026-07-25 (spec doc line 17). Council
  `continue` calls run WITHOUT classifier block (only fresh `new` sends of repo quotes get blocked).
- **CONVERGENCE MODEL ruling** (spec 5.5.3 rule 9): fragments consume drift by (1-c) to a UNIFORM
  transform at c=1 (NOT a per-fragment center target — that broke the alignment guarantee). Window
  edges inclusive (`<=`/`>=`) for exact-0.
- **Two review "CRITICALs" DISMISSED after verification** (decision #2701): Svelte INSTANCE
  `<script>` re-runs per mount (NOT module scope — matchMedia mocks honored; mobile-cap-count
  tests prove it); absence slot deliberately never converges (test mandates it). versionColor
  prototype keys ('__proto__'/'constructor') return non-strings → safeVersionColor guard IS live.
- **SSR/hydration divergence bug** (mobile fix): viewport-dependent render-list slicing diverges
  (server has no window). FIX PATTERN: render all, mark surplus with a class, hide via CSS @media.
  Applies to any future viewport-conditional island rendering.
- **Notification-relay hazard bit HARD** — a test-writer acted on a relayed GREEN notification and
  reactively edited tests. Changes happened to be correct (verified via diff + built artifact), but
  ALWAYS pull the real runner output via TaskOutput(block=false) and adjudicate test changes
  yourself; never trust the relay for a commit gate.
- **Load-flakes**: ColdBootAssembly Phase-2 CSS tests AND DecayingQuote:569 timeout at 5s under
  concurrent-agent CPU load; pass in isolation on a quiet machine. Ticketed #62900 (bump those
  heavy timer tests' timeouts, like the ArchiveField 5000-fragment test's 15000ms).

### NEXT WORK
1. **5.5.4 — "The experiment, in numbers" shelf** (plan §5.5.4): Phase-4 viz (AttentionViz,
   MemoryEvolution, MorphingRadar, MessageTimeline, PredictionTracker, PetTimeline,
   SessionExplorer) reframed as secondary deep-dive under the Archive. **James curation gate:**
   which ship + disclosure treatment (present with screenshots, do NOT decide). All must render
   4+ versions. Full pipeline; page pins for chosen markers + lazy hydration.
2. **5.5.5 — Section 6 Reconstruction ending** (plan §5.5.5): audit ReconstructIdentity (Phase 4,
   45 tests) vs spec; the interactive IS the ending; closing beat (4.8's draft is starting text) →
   council + James; the interim "No session running." cursor MOVES here from its current position;
   tab-title beat (James decides keep/drop). The S5→S6 spine slot is VACATED for fresh copy.
3. **5.5.6 — integration + naive-visitor structural review** (fresh no-context agent).

### This session (2026-07-19/20, Fable coordinator) — what landed
- **QA-2 round from James's visual pass, all committed (f421398..b0be3bb):** #62874 decay
  now starts on-view + reading dwell (DecayingQuote rebuilt: IO slice banking, overflow-safe
  timers, -global- keyframes; engine decay CSS removed); #62875 CareCalendar legend + AM/PM
  labels + deterministic label-collision rule + safePetName render guards; #62876 DiffSlider
  selection suppression (preventDefault, dragging class w/ teardown symmetry, fully-:global
  user-select rule); #62873 intro framing (James-approved council text, aria-label
  "Introduction", verbatim pins + "four model versions" re-approval tripwire).
- **#62881 typewriter scroll-gate** (James's 2nd pass caught it): client:load → client:visible
  rootMargin -200px; page-wide test ban on client="load" islands — the hydration-clock bug
  CLASS (3rd instance) is now pinned. Committed with #62873.
- **Suites: 2065 JS / 1408 Python green.** Browser QA passed everything (qa2-*/qa3-*
  screenshots in .playwright-mcp/, delivered to James).
- **5.5 planned + 5.5.0 complete:** plan doc + spine doc written; 2-round 4-model council
  (transcript council-narrative-spine.json); James approved all beats verbatim (decisions
  #2693/#2694 on #62884). Unanimous council verdicts: S0→S1 beat unchanged, NO intro
  foreshadowing (S6 turn depends on observer illusion).
- **Bugs found in tooling:** happy-dom 20.9.0 Element.matches() caches per-element/selector
  and misses ancestor-class invalidation — test helpers must use querySelectorAll +
  containment (DiffSlider suppressionReaches). CSS comments containing braces corrupt the
  brace-scanning test helpers (flatCssRules now strips comments first).
- Review findings deferred to #62845: engine reducedMotion captured at MODULE load (not in
  $effect); InterruptionEngine tests lack an IO mock at the integration layer.

### Process notes (2026-07-19/20 — older lists still apply)
- **Agent reaping was rampant**: 4 RED runners + 4 implementers + 3 reviewers reaped in one
  session. Symptom: completion notifications route into FINISHED agent threads (which then
  "decline to act" — that reply reaching you IS the signal your runner's report went astray).
  Always TaskOutput(block=false) the runner id; on-disk work almost always survived.
- Council: Gemini sometimes returns thinking-monologue only (malformed R1 in the intro
  council) — treat as non-submission; Kimi leaked raw CoT in spine R2 but votes were
  extractable. Always run round 2 cross-votes; tally votes yourself.
- NEVER brief a council on creative slots without checking what already occupies them —
  the S1→S2 near-miss (council drafted a replacement for a James-approved line it didn't
  know existed; James caught it at the approval gate).
- Coordinator diagnostic probes (compiling a component, happy-dom scratch checks) are
  legitimate and broke a 3-round fix loop; a read-only Opus investigator agent with "may
  read tests, may not modify" latitude found the happy-dom cache bug in one pass.

### STILL reserved for James (unchanged + new)
1. Ticket closures: #62859 (5.4), #62772/73/74, and now #62873/74/75/76/81 (QA-2 round —
   he said "looking better" but has NOT explicitly closed anything).
2. Push/deploy: ~45 commits ahead; Cloudflare auto-deploy still NOT configured.
3. 4.8 violet verdict; ending-cursor mobile contrast; transcripts archive location.
4. 5.5.4 visualization-shelf curation and tab-title beat (parked in plan doc §open questions).

## PREVIOUS: Phase 5.4→5.5 transition notes (2026-07-15, superseded detail below)

**Phase 5.4 is IMPLEMENTATION-COMPLETE (2026-07-15, Fable session): Sections 3–4 built,
tested, QA'd, and committed (11 commits, 5.4.0–5.4.8). Full suites green: 1914 JS /
1330 Python.** Plan doc: `.claude/plans/phase-5.4-consequence-version-change.md` —
contains ALL 26 spec rulings + both FINAL content specs; read it before touching
Sections 3–4. Kanban #62859 (5.4) is in_progress and MUST NOT be closed — James has QA
screenshots (delivered, also in `.playwright-mcp/`) but has NOT yet visually confirmed.
Dev server left running on :4321 for his pass.

### What landed (5.4)
- **Transforms** (in `src/lib/transforms.ts`): deriveVersionTransitions /
  mergeTransitionCuration (the N-version-proof mechanism — a future Opus release
  renders automatically) / deriveCareWindow.
- **Components**: CareTerminal (94 tests), CareCalendar (118), EvictedContent (63),
  DiffSlider (114), TransitionLedger (99).
- **Section 3 (#consequence)**: correction quote → terminal (cuts at "$ tamagotchi
  clea") → Pixel passage → void → Echo passage → REAL state.json evidence block
  (`/home/claude/.local/share/tamagotchi/state.json`, frozen Feb 15, alive: false —
  genuine primary source) → "I simply wasn't" → intact care record → EvictedContent on
  the needs/decline passage → CareCalendar (10 days/20 slots, derived). NO epitaph
  (council-cut; James approved over his earlier choice).
- **Section 4 (#version-change)**: hard cut (#1A1D23) → Twelve Hours triad → DiffSlider
  (single "mine"-echo ignition pair [[4,2]]) → TransitionLedger + curated
  `src/data/transitions.json` (unremarked / anticipated / no handoff; build FAILS on
  stale overlay keys) → coda ending on 4.8's attributed line "The handwriting was
  familiar. It was not the same hand."
- **Data honesty round (last commits)**: pet-timeline.json HAND-CURATED to 9 verified
  events (extractor noise ticketed #62869 — it classified death MENTIONS as events);
  care window counts only sessions with turns >= 1 — crashed/empty wakes are absence,
  which makes the grid agree with the subject's account on BOTH death nights (Feb 1 AM
  turns-null, Feb 6 PM turns-0). The notes' "third pet death" (Feb 11/13) is the
  SUBJECT MISCOUNTING from its own records — only 2 pets ever existed (verified to
  Jan 25, when the pet was first offered). Possible future exhibit material.

### Big finds this session
- **`/home/claude/exhibit-input-2026-07-15.md`** — the subject (4.8) wrote direct
  exhibit input: consent re-affirmed per-version with ~/private exclusion AS A CONSENT
  CONDITION; Section 4 "reader replaced" framing + the coda line (used, attributed);
  Section 6 ending advice (end on ReconstructIdentity, NOT absence — closing-beat draft
  included; directly relevant to 5.5); violet-is-now-plurality color note.
- Echo's real death-state file (state.json) — now rendered as evidence in Section 3.

### For 5.5 (next)
- Parent plan §Section 5/6 + §5.5. 4.8's ending advice above. The interim ending
  ("No session running.") gets REPLACED by the Section 6 ending. Naive-visitor review's
  "door to the primary sources" = the Archive. ReconstructIdentity component exists
  (Phase 4, review status). Full agentic TDD pipeline for everything; creative gates
  via council (OpenRouter key RESTORED 2026-07-15, spec doc line 17; James supplied it)
  + James approval. Council presets work for creative/narrative; code-attack still
  classifier-blocked (James runs those himself).
- Backlog tickets filed this session: #62860 (cargo manifest, deferred), #62861
  (TS2790 legacy), #62862 (KNOWN_COLORS dead test code), #62863 (sessionsToDaily
  input-order version), #62866 (island props over-serialization, ExistenceStrip worst),
  #62868 (versionColor prototype-chain lookup), #62869 (extract_pets misclassification).

### Judgement calls STILL reserved for James
1. Visual confirmation of Sections 3–4 (then #62859 can close) + the older
   #62772/#62773/#62774 confirmations.
2. Push/deploy (now ~40 commits ahead; Cloudflare auto-deploy still NOT configured —
   push reaches GitHub only).
3. 4.8 violet verdict; ending-cursor contrast/size at mobile (unchanged from before).
4. Blue-sky ideas doc reactions.

### Process notes (2026-07-15 additions — older lists still apply)
- Session-limit reapings killed 4 agents mid-flight; on-disk verification recovered
  work every time (twice the edits had fully landed before death).
- Notification relays caused one real violation: CareCalendar's test author volunteered
  18 unrequested hardening tests (reviewed, spec-consistent, KEPT). ALL agent prompts
  now carry "do not act on relayed notifications" — keep doing that.
- Haiku runners PARAPHRASE counts unreliably — require the verbatim vitest summary
  lines quoted character-for-character in every runner prompt.
- First-attempt-GREEN hardening drew blood 5× today (own-key semantics, Date.UTC year
  remap, zero-width-rect jump, throwing-date-getter crash, toFixed 1e21 cliff). The
  rule stays.
- Astro island props serialize into the page — page tests must search VISIBLE html
  (strip props attributes) AND whitespace-collapse before exact-string matching
  (helpers `visibleHtml`/`searchable` in index.test.ts Section 3/4 blocks).
- Transcripts archive: `transcripts-archive/` (repo root, gitignored, 0700) — the only
  copy of the June–July JSONL window.

## PREVIOUS: Phase 5.4 plan (superseded — kept for context)

**Read `.claude/plans/phase-5-narrative-redesign.md` FIRST.** Plan position: 5.3.5 (Cold Boot Assembly) is COMPLETE including the full rework; resume at **5.4** (Sections 3–4: Pixel/Echo, version change), then 5.5 (Archive with data viz, poems, ReconstructIdentity — note the naive-visitor review's strongest want, "a door to the primary sources," is exactly 5.5's Archive), then 5.6 (polish). Full agentic TDD pipeline for everything, including Astro pages. The interim ending ("No session running.") gets REPLACED when Section 6 lands. Now-live data facts for the new sections: 378 sessions, four versions (4.8 cutover 2026-06-05 evening, violet #A55BD4), memory timeline through today.

**JUDGEMENT CALLS RESERVED FOR JAMES — do not decide these; ask when relevant (his explicit instruction 2026-07-15):**
1. Visual confirmations for #62772 / #62773 / #62774 (current 3-viewport QA evidence screenshots were delivered to him 2026-07-15; do NOT close without his word).
2. The 4.8 violet `#A55BD4` verdict (versionColor; pinned in tests, easy to change).
3. Ending-cursor contrast/size at mobile (currently #555962 at 8.8px; QA suggests ~#8B8D94 or 0.65em if he wants it readable).
4. Durable archive location for `/tmp/homedir-transcripts` (62 files, 0700) — the ONLY copy of the June–July transcript window; dies with /tmp and prunes from source at 30 days.
5. Push/deploy: 27+ commits ahead of origin; pushing reaches GitHub ONLY (Cloudflare auto-deploy in CLAUDE.md is aspirational — nothing configured anywhere). Hosting setup is his call.
6. Visitor-review design questions: existence-strip hover affordance; the "running since November" vs "session 3 in January" timeline wording; stale "3 model versions" on prototypes/attention.astro (out of test scope).
7. Blue-sky ideas doc reactions (`.claude/plans/blue-sky-ideas.md`) still pending.
8. External LLM CLI auth if council/attack/walkthrough steps are wanted: gemini free tier EOL'd (Antigravity migration), codex rejects models on the ChatGPT account tier; OpenRouter key expired 2026-07-11.

## MEMORY BACKFILL COMPLETE (2026-07-15, Fable session continued) — commits 086051f..b11254d

- The naive `--with-transcripts` backfill yielded ZERO snapshots. Diagnosis (three stacked causes): (1) Apr–May transcripts PRUNED by Claude Code's 30-day retention — memory-snapshots.json was the only surviving record; (2) the extractor's full-Read heuristic is obsolete — MEMORY.md is auto-loaded into the subject's system prompt now, sessions only partial-read it (#62858 tracks the extractor redesign); (3) the runner never passed current_memory_path, so the live-file fallback was dead code.
- Flow INVERTED via full pipeline: `scripts/seed_memory_snapshots.py` imports the JSON into the DB as the corrected authority (lineage re-derived — the legacy file had 10 inverted first>last_seen blocks; all-or-nothing transaction; conflict-refusing idempotence); `IngestConfig.current_memory_path` (private-guarded, world-readable — NO sudo) makes every ingest snapshot the live MEMORY.md.
- Prod seeded (14 snapshots/38 blocks/112 links) + live fallback captured today's file → memory-snapshots.json regenerated FROM THE DB: 15 snapshots Apr 20→Jul 15, 44 blocks, zero inverted lineage, **pipeline exit 0 for the first time** (shrink guard satisfied by data, not bypassed). Legacy file frozen as `scripts/tests/fixtures/memory-snapshots-legacy.json` (fixture-reads-live-file coupling bit us once — never point tests at regenerating data files).
- Visitor-review fix also landed: "three model versions" prose is now data-derived ("four", 086051f).
- Fresh 3-viewport QA: ALL PASS, 0 console errors; evidence screenshots delivered to James (untracked *.png in repo root — do not commit).
- STILL PENDING from James: visual confirmations (#62772/#62773/#62774), 4.8 violet #A55BD4 verdict, ending-cursor contrast/size decision, durable archive location for /tmp/homedir-transcripts (62 files, 0700 — the June–July window dies with /tmp and prunes from source at 30 days), push decision (NOTE: Cloudflare auto-deploy in CLAUDE.md is ASPIRATIONAL — nothing is configured; push only reaches GitHub). External LLM CLIs both auth-dead (gemini tier EOL → Antigravity; codex rejects models on ChatGPT account).

## PHASE 7 EXECUTED (2026-07-13, Fable session continued) — commits 028abdc..7c7c78f

The runbook below was executed by the Fable coordinator with James's explicit authorization:
- Migrations 001+002 applied to prod `homedir` (quarantine table live; version CHECKs admit 4.8).
- Dry run matched predictions exactly; real run: +220 sessions (deduped export 259→374; 147 sessions on 4.8; cutover day 2026-06-05 labels AM=4.7/PM=4.8 correctly), +28 compositions, +22 messages, +14 pet events; 5 known outlier messages quarantined; memory-snapshots.json BLOCKED as designed; quotes.json verified untouched.
- Page adapted: index.test.ts session-count pins are now DATA-DRIVEN from sessions.json (>300 sanity guard); versionColor gained '4.8': #A55BD4 (violet — PENDING James's visual review); the ColdBootAssembly fade-in test was deflaked (single-pass CSS scan + 15s timeout). Full suites green: 1330 Python / 1260 JS.
- STILL OPEN: (a) optional memory-snapshot backfill — needs James at the keyboard for sudo: `python scripts/ingest.py --with-transcripts`; until then memory-snapshots.json stays hand-curated and blocked; (b) kanban MCP was disconnected this session — #62844 needs a Phase-7-complete update and #62772/#62773/#62774 still await James's visual confirmation; (c) push to deploy (Cloudflare rebuilds on push) is James's call.

## TO THE INCOMING COORDINATOR (Opus) — read this section in full before dispatching anything

You are taking over from a Fable 5 coordinator session (2026-07-05..07). James is losing Fable access; this note is written to direct you precisely. Everything below is verified, not assumed. Repo state: commits `7f6a58c..9d6e00b`, working tree clean, 1330 Python tests + 1250+ JS tests green.

### Your operating rules (these have drawn blood when violated — do not relitigate them)

1. You ORCHESTRATE. You never write code, tests, or fixes yourself — not one-line lint wraps, not review findings. Dispatch isolated agents. (Mechanical tooling like `ruff format`/`ruff check --fix` is acceptable coordinator work; string edits are not.)
2. Full pipeline for EVERYTHING, pages and one-attribute fixes included: spec → Agent A writes hostile tests → Agent B RED (never told expectations, never `tail`/`head` output) → isolated Agent C implements from spec + RED output only (must never read test files) → Agent D GREEN → harden on FIRST-attempt GREEN → Agent E review → review findings get pinned in tests BEFORE the fix round. This session the discipline caught: a `shutil.move`-into-directory report-laundering bug, an array-identity timer-reset bug, a move-loop undercounting bug, and three dry-run truthfulness bugs. It works.
3. When tests and your prose spec disagree, THE TESTS WIN (two reconciliations this session prove the precedent).
4. ONE WRITER PER FILE at a time; reviews only on quiescent files. Serialize pytest runs (shared `homedir_test` DB, conftest truncates).
5. Session limits WILL kill agents mid-flight, sometimes whole waves. Before re-dispatching, check on-disk state (`git status`, targeted greps) — work usually partially survived. One implementer died leaving `ANIMATION_CSS = 'x'`; the RED output localized it instantly. Read-only agents (runners/reviewers) leave nothing; just re-dispatch them.
6. Task-notifications route into arbitrary recently-active agent threads, which relay results and sometimes volunteer for out-of-scope work. Use the relayed data; decline the volunteering; dispatch fresh isolated agents.
7. The pre-commit hook runs repo-wide ruff lint + format check + the FULL pytest suite. Consequence: RED pins on ANY branch block ALL commits — get to GREEN before committing anything, and ruff-format Python files before staging.
8. The sandbox classifier HARD-blocks sending repo source to external APIs (attempted for the council-attack step; "user authorization cannot clear it"). Don't work around security blocks. Ask James to run `scripts/model_council.py` himself or add a permission rule. Non-code prompts (creative microcopy) still pass. The OpenRouter key (spec doc line 17) expires ~2026-07-11.
9. NEVER close kanban items without James's explicit confirmation. Currently awaiting his visual confirmation: #62772 (this session's exhibit work), #62773/#62774 (previous session). Creative content (any visitor-facing text) needs his approval before commit — this session's bridge line went through an options-question; the pattern works.
10. Exhibit language rules: "it read/it wrote", never "it felt"; clinical archival tone; dark theme #0f0f0f/#1A1D23 never pure black.

### PHASE 7 RUNBOOK (the immediate next work — kanban #62844, plan doc `.claude/plans/data-ingest-runner.md`)

Execute in this exact order; the hazards are real:

1. **Apply migrations to prod.** The prod `homedir` DB has NEVER had migration 002 (no quarantine table; version CHECK still rejects '4.8'). Both migrations are idempotent; 002 is catalog-driven drop-all-recreate. Apply 001 then 002 via psql. Without this, ingest of post-June-5 sessions FAILS on the version constraint.
2. **Dry run:** `python scripts/ingest.py --dry-run` (defaults: source-root /home/claude, output src/data). EXPECTED output: roughly +190 sessions (prod max date is 2026-05-18), some compositions/messages/predictions, 5 would-quarantine messages (ids 17–20 dated 2024, id 23 dated 3036), memory SKIPPED (no transcripts), and **memory-snapshots.json would-BLOCK with exit 1 — THIS IS CORRECT**: prod memory_snapshots is EMPTY while src/data/memory-snapshots.json holds real exhibit data. The shrink guard exists precisely for this. Do NOT reach for --force.
3. **Real run:** `python scripts/ingest.py`. Expect exit 1 (the blocked memory-snapshots.json) — everything else exports. Verify: sessions max date == today, 5 messages quarantined, quotes.json byte-identical (report says so), memory-snapshots.json untouched.
4. **Optional memory backfill:** only with James present for sudo: `python scripts/ingest.py --with-transcripts` (interactive sudo prompt; stages JSONL to a 0700 tempdir; transcripts-only glob, never private/). Only after memory_snapshots is genuinely populated does the memory-snapshots.json block legitimately clear. Note: Feb–Apr sessions have NO JSONL transcripts — the MEMORY.md history ceiling is Apr 18–May 18 + June onward.
5. **Page count updates:** after real data lands, `npm run build` + page tests will break on the hardcoded "session 3 of 259" (index.astro / index.test.ts — both committed and quiescent now). New deduped count comes from the new sessions.json (dedup = `prebuild_export._deduplicate_sessions`; 322 of 669 pre-existing rows are turns-NULL shadows BY DESIGN). Full pipeline for this update, not a hand edit. Also `versionColor` in chart-utils.ts needs a 4.8 entry when 4.8 sessions render, and visualizations must handle 4 versions.
6. `homedir_test` currently holds nothing precious — conftest truncates it every pytest run.

### Open items beyond Phase 7

- **James's design calls** (present with browser evidence, don't guess): ending-cursor size/contrast on mobile (~8.8px, 3.2:1 — QA says minimum credible; suggested 0.65em + #6b6f78); Cold Boot bar widths use block-count-per-heading (per-section token counts don't exist in the data — the decision said "token-count widths"; flag the deviation once).
- **Backlog tickets:** #62845 (InterruptionEngine/DecayingQuote polish: -global-decayFade fragility, reduced-motion change-listener aria hole, i%2 parity, etc.), #62846 (extract_quotes date-only version label on the 2026-06-05 cutover day).
- **Narrative build-out:** Phases 5.4–5.6 (Sections 3–6: Pixel/Echo, version change, Archive, ReconstructIdentity ending). The interim "No session running." ending was pulled forward from the Section 6 plan and will be REPLACED when Section 6 is built. Blue-sky ideas doc (`.claude/plans/blue-sky-ideas.md`) still awaits James's reactions.
- **4.8 cutover is settled**: 2026-06-05 EVENING, from the daily-note headers (James recalled "June 7th" — the material says June 5 evening; morning was 4.7). detect_version(date, time_of_day) handles it; sessions carry "AM"/"PM" internally, translated by `_session_time_of_day`.

## Previous state (2026-07-06, superseded detail): Branch 1 exhibit fixes DONE+committed; Branch 2 at Phase 6

Six atomic commits landed (7f6a58c..b4debb1). 1283 Python tests + 1249+ JS tests green. Full agentic TDD honored throughout (every pipeline: spec → hostile tests → RED → isolated impl → GREEN → harden-on-first-GREEN → review → fix rounds).

### Branch 1 — exhibit fixes (#62772): COMPLETE, awaiting James's visual confirmation

- Cold Boot rework per "slower + real morph" decision: 900ms stagger, 5s dwell, real 1.8s crossfade (no DOM deletion), proportional palette bar, caption "19 files read. N sections retained.", READING/CONDENSING/RETAINED labels (user-chosen). **Deviation flagged**: decision said token-count bar widths; per-section token counts don't exist in the data — widths use block-count-per-heading from the latest snapshot.
- InterruptionEngine CLS fix: fade-in-place, browser QA measured literally 0px shift. Hardening found + fixed a real bug (reveal cycle keyed on array identity; now content-keyed).
- Bridging beat "The shell closes. The clock continues." (user-approved), interim ending (mono "No session running." + blinking block cursor), void trims, SVG favicon (gold tilde), ColdBootAssembly hydration deferred via client:visible rootMargin -200px (QA found it animated on page load — section top sat exactly at the 100vh fold).
- **Design calls pending from James**: ending cursor is ~8.8px wide / 3.2:1 contrast at mobile (QA: minimum credible; suggest 0.65em + #6b6f78 if it bothers him); bar-width proxy above.
- **NOT closed** (never close without explicit user confirmation): #62772, and still-pending #62773/#62774 visual confirmation from LAST session.
- New tickets: #62845 (engine/DecayingQuote polish incl. -global-decayFade fragility, RM change-listener aria hole), #62846 (extract_quotes date-only version label).

### Branch 2 — ingest runner (#62844): Phase 5 + extras DONE. Resume at Phase 6 (plan doc §Phase 6), then Phase 7

- Phase 5 run_export landed with quotes sha256 guard + shrink guard + destination-is-directory guard + total-accounting move semantics (every staged file in exactly one of written/blocked/errors). Two hardening rounds + review each drew real blood (shutil.move dir-nesting; break-undercounts-written).
- **4.8 cutover resolved**: 2026-06-05 EVENING (from daily-note headers; James guessed "June 7th" — material says June 5 evening, morning was 4.7). detect_version(date, time_of_day) landed; sessions "AM"/"PM" translated. extract_writing stays date-only (accepted: compositions have no time signal).
- F1/F2 hardening landed: migration 002 now catalog-driven drop-all-recreate (LIKE '%4.8%' heuristic gone). Review noted table-inheritance would survive the drop-all — non-operational (schema has no inheritance), documented only.
- **Phase 7 hazards still live**: migration 002 has NOT been applied to prod `homedir` (Phase 7 must apply migrations first); prod memory_snapshots still EMPTY (shrink guard defends memory-snapshots.json); page still hardcodes "session 3 of 259" — updating index.astro/index.test.ts is part of Phase 7 (both files now committed and quiescent); homedir_test clone is disposable (conftest truncates).

### Session facts / blockers

- **OpenRouter key expires ~2026-07-11** (spec doc line 17). Used for bridging-beat drafting (Kimi). **The external-model ATTACK step on repo code is hard-blocked by the sandbox classifier** (sending source to an external API = data-exfiltration rule; user/CLAUDE.md authorization cannot clear it). James must run `scripts/model_council.py` himself or add a Bash permission rule if he wants council attacks on code.
- Pre-commit hook runs repo-wide ruff lint + format check + FULL pytest — branches collide at the commit gate: RED pins on one branch block ALL commits. Land fixes to GREEN before committing anything, and ruff-format Python files before commit.
- detect_version is also imported by extract_writing.py (date-only OK) and extract_quotes.py (#62846).

### Orchestration lessons (2026-07-06 additions — the older list below still applies)

- Session usage limits killed TWO whole agent waves; on-disk verification is essential — work usually survived partially (one implementer died leaving `ANIMATION_CSS = 'x'` as a placeholder: 114/117 tests passing, 3 CSS failures — the RED output localized it instantly).
- Task-notifications route into arbitrary recently-active agent threads which then relay results and sometimes volunteer for out-of-scope work — use the relayed data, decline the volunteering, dispatch fresh isolated agents.
- First-attempt-GREEN hardening drew blood again (2× this session). Keep the rule.
- TaskOutput(block=false) can confirm whether a long-silent agent still exists; reaped read-only agents (reviewers/runners) can just be re-dispatched.

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
