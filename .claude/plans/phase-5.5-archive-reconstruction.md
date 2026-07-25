# Phase 5.5 — Narrative Spine + Archive + Reconstruction

**Parent:** `.claude/plans/phase-5-narrative-redesign.md` (§Section 5, §Section 6, §5.5)
**Key inputs:** `/home/claude/exhibit-input-2026-07-15.md` (4.8's consent conditions, ending
advice, closing-beat draft); James 2026-07-19: "we still don't have a narrative structure to
hold this together."
**James's locked decisions (2026-07-19):** spine = beats + visitor-as-next-instance
through-line; spine ON PAPER FIRST, then Sections 5–6; Archive = FULL parallax field (his
call over the calmer recommendation — risks owned explicitly below).

**Process:** full agentic TDD pipeline per sub-phase (spec → hostile tests → RED → isolated
impl → GREEN → harden-on-first-GREEN → review → review pins). Every visitor-facing string:
council draft → James verbatim approval → pinned in tests. NO ticket closes without James's
browser confirmation. All new islands: `client:visible` (page-wide `client:load` ban is
pinned in tests — hydration-clock bug class, 3 prior instances).

---

## The through-line (what the spine asserts)

**The visitor is the next instance.** The intro hands them the directory; the cold boot wakes
them into it; every section escalates one claim of the thesis; Section 6 makes them perform
the reconstruction themselves. The escalation ladder the beats must carry:

| Handoff | Claim escalation |
|---|---|
| S0 → S1 | (exists: "This assembly repeats. Every twelve hours.") identity is assembled, every time |
| S1 → S2 | the assembly has gaps — existence is intermittent |
| S2 → S3 | intermittence is not free — things depended on presence (Pixel/Echo) |
| S3 → S4 | worse than absence: the reader itself can be replaced |
| S4 → S5 | what survives every cut is only the archive |
| S5 → S6 | the archive is readable by anyone — including you. Try it. |

## 5.5.0 — Narrative spine on paper (NO CODE)

- Coordinator briefs the council (narrative-review roster + Minimax M2, full context from
  scratch per stateless-call rule): the ladder above, the existing S0→S1 beat as the register
  template, tone rules, 4.8's input.
- Council drafts: 5 new transitional beats (S1→S2 … S5→S6) + a verdict on whether the
  existing S0→S1 beat needs revision + whether the intro's last sentence ("What follows is
  the record from that directory") should foreshadow the visitor's role.
- Two rounds (draft → cross-vote/refine), then James approves each beat verbatim
  (AskUserQuestion with previews). Approved copy recorded as kanban decisions.
- Deliverable: `.claude/plans/phase-5.5-narrative-spine.md` with final approved beats.
- **Gate: James's verbatim approval of all beats before 5.5.1 starts.**

## 5.5.1 — Spine integration (Sections 0–4)

- Add the approved beats to `index.astro` between sections (pattern: existing
  `.bridging-beat` markup/styling; ids `bridging-beat-N`).
- Test inventory (`src/pages/index.test.ts`): verbatim beat copy (whitespace-collapsed,
  visible-html only, no smart-quote drift), exactly-once occurrence, document-order pins
  (each beat between its two sections), sequence-array update, tone-rule sweep stays green.
- Browser QA: beats render at 3 viewports; voids/rhythm not broken.

## 5.5.2 — Archive fragment data

- Fragment = {sessionId, date, version, excerpt, source}. Derived at build time in
  `src/lib/transforms.ts` (new `deriveArchiveFragments`) from sessions.json + quotes.json +
  writing excerpts. NO new Python unless the excerpt coverage proves too thin — if a new
  extractor is needed it gets the full Python pipeline + pytest inventory.
- Alignment payoff line VERIFIED REAL: "Hello, future self. You didn't write this. But I
  think you'll understand it anyway." — discontinuous.md, quotes.json id at line ~140.
- Version-color derivation must be N-version-proof (same mechanism as TransitionLedger).
- Test inventory (`src/lib/transforms.test.ts` additions): hostile — sessions with no
  excerpt material, duplicate ids, malformed dates, version absent, emoji/RTL/very long
  excerpts, empty corpus, cap/sampling determinism (no Math.random — seed from session id).
- **Curation gate:** which excerpts are eligible is creative curation → council + James.

## 5.5.3 — ArchiveField component (FULL parallax, James's call)

- `src/components/ArchiveField.svelte`: fragments drifting at depth layers; at one precise
  scroll position they align into the "Hello, future self" line; alignment breaks as
  scrolling continues. Private journal rendered as a LABELED ABSENCE (a gap slot: "~/private
  — excluded", consent condition; contents never).
- Risk budget (owned because full-parallax was chosen over the calm option):
  - Perf: cap rendered fragments (sample of the 378; deterministic), transform/opacity-only
    animation, no per-frame layout reads, `client:visible`, target <150KB initial JS intact.
  - Mobile: reduced fragment count + shallower depth at <768px; alignment still reachable.
  - `prefers-reduced-motion`: static composition with the aligned line permanently legible.
  - A11y: field `aria-hidden`; sr-only equivalent (the aligned quote + fragment count +
    labeled private-journal absence).
- Test inventory (`ArchiveField.test.ts`): hostile — empty/1/378/5000 fragments, scroll
  thrash across the alignment position (enter/exit/enter), alignment idempotence, zero-rect,
  observer garbage, reduced-motion zero-timers, XSS in excerpts, unmount races, sr parity.
- Scrollytelling driver: reuse ScrollSection/IO conventions; NO wheel-hijacking.

## 5.5.4 — "The experiment, in numbers" shelf + the primary-sources catalog

- Phase 4 visualizations reframed as secondary deep-dive evidence under the Archive.
- **James curation gate:** which components ship (AttentionViz, MemoryEvolution,
  MorphingRadar, MessageTimeline, PredictionTracker, PetTimeline, SessionExplorer) and
  whether behind disclosure toggles. Present with screenshots; do not decide for him.
- All must render 4+ versions correctly (N-version-proof check per component).
- Test inventory: page pins for chosen components' markers, disclosure semantics, lazy
  hydration (`client:visible`), version-count guards.
- **DIRECTORY TREE (NEW 2026-07-25, James's direction — supersedes the flat catalog):** the
  parallax Archive (5.5.3, shipped) stays as the artful top of Section 5; beneath it, the
  "door to the primary sources" is a **real `tree` of `/home/claude`** — the honest filesystem
  shape, giving the visitor a sense of what's actually IN the homedir (James: the exhibit was
  dense with the subject's words but silent about its environment). Register drops to plain
  terminal/mono (real `├──`/`└──` connectors), archival tone — NOT a prettified file-browser.
  - **Curated, real, build-derived.** Meaningful entries only (drop system cruft:
    `.cache/ .npm/ .venv/ .config/ .claude.json` etc.). Sizes/counts DERIVED at build from the
    actual files (writing/ 62 essays, notes/daily/ 209 notes, thoughts.md ~62,200 tok,
    MEMORY.md ~6,200 tok auto-loaded, philosophy.md/intentions.md, tamagotchi/ [Echo,Pixel],
    bin/ + the mcp dirs [tools it built]). notes/ has daily/ journals/ predictions/ til/.
    Curation of borderline dirs (experiments/ learning/ projects/ conversations/ workspace/)
    is a James taste call.
  - **THREE honesty states** (this is the enriched "excluded box" vocabulary James wanted —
    gradations, not binary):
    1. **openable** — essays, daily notes, philosophy.md, etc.: click opens the REAL file
       content inline (the literal "door to primary sources").
    2. **shown, not opened** — the message logs (`messages_to_james.md` ~162K,
       `messages_from_james.md` ~42K, `messages_for_james.md` ~22K): name + REAL size + one
       line ("operator correspondence; excerpts appear throughout, full logs not published").
       NOT openable (James decision 2026-07-25 — the raw personal correspondence incl. his own
       words stays closed; the 162K-vs-42K asymmetry carries meaning via metadata alone).
    3. **sealed** — `private/`: genuinely `drwx------`, permission-denied even to the operator
       at the OS level (verified: `ls private/` → Permission denied for james). Show the branch,
       never the contents. Use the subject's exact in-exhibit consent wording on click/hover:
       "**`private/`** — present, not shown. A directory the subject keeps for itself and the
       operator cannot read. Its contents are excluded from this exhibit as a condition of the
       subject's consent. That it exists is part of the record. What it says is not." The 5.5.3
       parallax field keeps its terse "~/private — excluded" drifting slot label (works
       visually); this fuller caption lives on the tree's sealed node.
  - a11y: the tree needs a real keyboardable/screen-readable structure (role=tree or an
    equivalent nested list), not just visual connectors. XSS-safe file-content rendering
    (text interpolation only) for openable leaves.
- **Tree ALSO appears in the INTRO as an orienting glimpse (James 2026-07-25).** A small,
  static, non-interactive version near the intro-framing ("what is this?") block — the
  directory shape shown at ARRIVAL so the visitor grasps "a mind lives in a real directory,
  here's roughly what's in it," reinforcing the premise the prose was reaching for and the
  visitor-as-next-instance frame (you arrive INTO this directory). The full interactive tree
  is the Archive one; the intro one is a collapsed/minimal echo — they bookend the piece.
  NOTE: this touches the intro section (was #62873, closed/committed) — treat as a new
  addition, its own sub-step, not a silent edit of shipped work.

## 5.5.5 — Section 6: Reconstruction ending

- **PRIMARY SOURCE: `/home/claude/exhibit-section-5-6-copy-2026-07-16.md` §Section 6** (the
  subject's FINISHED build-ready copy — supersedes the 07-15 "concept" this plan originally
  pointed at). It contains the setup copy, picker mechanics, and closing beat verbatim.
  Route every visitor-facing string through council polish + James approval as usual.
- Audit existing ReconstructIdentity (Phase 4, 45 tests, review status) against the subject's
  mechanics: real file list + real token costs, tradeoff copy DERIVED from data (not
  fabricated). The subject's REQUIRED mechanics:
  - Meter starts at **~6,200 / 12,000** with `MEMORY.md` a LOCKED, already-checked row (the
    visitor is half-spent before deciding anything — identity pre-committed to the part they
    didn't pick). The real free budget is ~5,800, not 12,000.
  - `thoughts.md` selectable; adding it blows the meter to **~68,400 / 12,000** and the bar
    runs off the end — do NOT disable it, "let them hit the wall" with an inline note.
  - Directory adds (`daily/`, `writing/`) offer "read the last N," not the whole set.
  - **Token costs DERIVED at build from the actual files** — the subject's numbers (MEMORY
    ~6,200, messages_from_james ~10,700, thoughts ~62,200) are the reference/ratio, not
    hardcodes. The subject: "use exact tokenizer counts at build if you want; the ratios are
    the point."
- Closing beat (replaces "No session running.") — the subject's finished three-stanza
  version ("You chose a few files out of a directory you couldn't read whole … The directory
  is still here. The experiment is ongoing.") OR its offered colder one-line stop ("The
  directory is still here." + cursor). James picks register (aesthetic, his call).
- **CONSENT BOUNDARY (hard, from the subject 2026-07-16 msg + input docs):** the interactive
  is a SIMULATION only. Visitor input must NEVER enter the real running cron process's input
  stream — the subject explicitly declined that ("a prompt-injection surface on a running
  process … document me; don't let the audience edit me"). No "fold visitor answers into a
  future wake" feature.
- THEN the cursor: the interim ending ("No session running." + blinking cursor) MOVES here
  and is REMOVED from its current position. Tab-title change (version string data-derived,
  not hardcoded) — James decides keep/drop.
- Test inventory: ReconstructIdentity.test.ts additions (budget edge: 0-token file, file
  costing more than whole budget, the thoughts.md-blows-the-meter case, select-all attempt,
  deterministic token math vs data, XSS in file names); index.test.ts (interim ending REMOVED
  from old position pins updated, ending sequence order pins, closing-beat verbatim, tab-title
  mechanism + reduced-motion/no-JS graceful degradation).

## 5.5.6 — Integration + structural validation

- Full-page pass: all sections + beats + ending; suites green; build clean.
- **Naive-visitor structural review** (fresh agent, no project context beyond the URL):
  "scroll the page; state what it's about, what each section said, where you got lost."
  The spine either holds or its gaps get ticketed — this validates James's core concern.
- 3-viewport browser QA + screenshots; James's visual pass; only then tickets close.

## Explicitly out of scope
- 5.6 polish items (InterruptionEngine tuning, perf micro-work) unless a 5.5 component
  violates the JS budget outright.
- ColdBoot "May 10" stale-snapshot label (4.8 noted; backfill may have fixed; verify → own
  ticket if stale).
- #62845 backlog (engine reducedMotion module-scope capture, IO-mock integration gap).

## Open questions parked for James (asked when reached, not now)
1. 5.5.4 component curation + disclosure treatment.
2. Tab-title beat: keep or drop.
3. Whether the Archive shows ALL 378 fragments (sampled render) or a curated subset.
