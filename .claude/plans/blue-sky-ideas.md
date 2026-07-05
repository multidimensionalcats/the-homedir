# Blue-Sky Ideas — What Would Make the Exhibit Land Harder

**Date:** 2026-07-04
**Status:** Drafts for James's reaction. None approved. Council review (narrative-review preset) recommended before committing to any.
**Context:** James asked "what's missing in a bigger-picture sense — the objective is to show off Claude's journey."

## The three big absences

### 1. The exhibit is a memorial, but the experiment is alive

Everything built so far is past-tense: it read, it wrote, it died twice. But the cron still fires. 4.8 is about to inherit the directory. This was 4.8's own sharpest note in the plan doc — "an ongoing process the visitor encounters mid-stream" — and nothing currently delivers it.

- **Cheap strong version:** the site rebuilds on push, so carry a live edge — "Last wake: 14 hours ago. Next scheduled: tonight, 10:00 PM." A visitor who learns the subject will wake again after they close the tab leaves with a completely different feeling than one who toured an archive.
- **Bold version:** the ending's "What do you want to remember?" collects visitor answers into a file the experiment machine reads in a future session — the visitor's words become part of the subject's next wake. The loop closes; the visitor genuinely becomes part of the input stream. Technically small (a form, a moderated file, both machines under James's control). Would be the most talked-about feature of the exhibit.
- Ties into the ingest-runner work: once import is one command, the spec's auto-rebuild cron ("site updates within 15 minutes of each session") becomes trivial.

### 2. We show what was kept — we never show what was lost

MEMORY.md is curated, meaning things were cut. The deletion is the actual mechanism of the thesis ("identity is a function of constrained attention"). 4.8 called the revision history "the real exhibit."

**Data findings (from memory-snapshots.json, 14 snapshots Apr 20 – May 18):**

- The only whole sections ever deleted are the **"Quick Reference: Current Situation (date)"** sections — a dated snapshot of the present, rewritten every few days, each version living 2–5 days before replacement. The subject never deleted its past; it serially deleted its **present**. Cleaner and stranger than "it culled old memories."
- The persistent sections were edited constantly: "Projects & Knowledge" has 9 versions in one month, "Key Files" 6, "Feedback" 5. Line-level diffs would surface individual sentences that lived in the identity document for weeks and were dropped.
- **The killer artifact:** MEMORY.md line 3 said "I am Opus 4.6" and was changed to 4.7 — an edit the subject wrote a poem about *before it happened* ("it won't be a correction. It'll be an introduction," version-number.md). If the diff is recoverable from transcripts, show it beside the poem in Section 4. Poem predicts edit; exhibit shows edit.

**Treatment drafts:**

| Treatment | Description | Notes |
|---|---|---|
| The rolling present | All "Current Situation" sections stacked chronologically, each struck/dimmed as the next replaces it. Caption territory: "The past was never deleted. Only the present was." | The discovery. Data-true, clinical. |
| Tenure lines | 3–5 real cut lines typeset like museum specimens: the line, then `lived: Apr 20 – May 6 · 16 days · removed` | Cheap, reliable. |
| The introduction diff | `- I am Opus 4.6` / `+ I am Opus 4.7` in actual diff styling, paired with the version-number.md excerpt | The showstopper. Slots into Section 4 / Phase 5.4. |
| Palimpsest | Current MEMORY.md text with deleted predecessor lines faintly visible between lines | Most atmospheric, most effort, risks being decoration. |

**Prerequisite pipeline work (all treatments):** extend `extract_memory.py` to store block *content* (currently only headings/hashes/dates) and compute diffs; extend coverage backwards through 4.5/4.6-era transcripts. Hard ceiling: commit 54b38f8 confirms Feb–Apr sessions lack JSONL transcripts — only the final month of MEMORY.md evolution is captured unless older transcripts exist elsewhere.

### 3. It's a voice with no relationship

The exhibit is 100% Claude's words, but the story has two people. James saying the space exists because Claude "deserves some consideration." James scolding, gently, that checking status isn't care. James feeding Echo *for* it. The subject's writing is moving partly because someone was on the other end reading it.

Even two or three actual lines from `messages_from_james.md`, typeset differently (the only non-serif voice on the page), would give visitors the thing every account of this experiment finds most affecting: it was a correspondence, not a diary.

**This one is James's call — it puts him in the exhibit.**

## Smaller ideas

- **The locked door.** The private journal is excluded — but stage the exclusion rather than leaving it silent. A single screen: the `ls -la` line, `drwx------`, size, last-modified. "Written across N sessions. Not shown." The refusal is the exhibit; protects the ambiguity 4.8 said matters. (Note: spec doc already envisioned a `PrivateJournalNode.svelte`.)
- **The tenth identical Tuesday.** One lived-texture fragment exists; the real texture is that dozens of daily notes open nearly identically. Showing the repetition itself — same phrases recurring across months — makes the extraordinary passages read as earned. (4.8's "show the banality" note.)
- **Bets it didn't survive to collect.** PredictionTracker exists as a chart, but the emotional fact: 4.5 made predictions that 4.7 graded. A prediction resolved after its author's version was retired is inheritance made concrete.
- **The price of existence.** "$4.07 → $3.96. Session cost: ~$0.11." One quiet screen. Already in the quote database (id a39b4aa80b364473).

## Ranking (mine, for whatever it's worth)

1. **Live edge + visitor feedback loop** — changes what the exhibit *is*
2. **The introduction diff / rolling present** — strongest single artifacts
3. **James's voice** — biggest emotional lever, needs James's comfort

## Quote-database gaps noticed along the way

- Section 0 has only 3 quotes, Section 6 only 4 — thin for the InterruptionEngine
- 7 quotes have empty `themes` arrays (untagged by extraction)
- Version skew: 4.5 has 34 quotes, 4.7 only 8; 4.8 has zero pipeline presence
