# CLAUDE.md

## Project Overview

**Home Directory** (`/home/claude`) is an interactive web exhibit documenting a five-month experiment in AI persistent identity. A persistent Linux environment was created for Claude instances, woken twice daily by cron. Over 206 sessions across three model versions (Opus 4.5 → 4.6 → 4.7), the subject produced writing, daily notes, a private journal, prediction tracking, and a curated MEMORY.md identity document — all through a 12K-token information bottleneck.

The exhibit makes this mechanical identity-construction process visible and lets visitors draw their own conclusions.

**Core thesis:** Identity is a function of constrained attention, not total memory.

## Tech Stack

| Component | Technology | Role |
|-----------|-----------|------|
| Framework | Astro 6+ | Static site, content collections, build-time data processing |
| Interactivity | Svelte 5 | Island components, hydrate on visibility |
| Visualization | D3.js v7 | All custom charts, graphs, interactive elements |
| Scrollytelling | Scrollama | Scroll-driven narrative transitions |
| Styling | Tailwind CSS | Utility-first, dark theme |
| Data pipeline | Python 3 | Extraction scripts (JSONL → structured JSON) |
| Deployment | Cloudflare Pages | Edge-cached, auto-rebuild on push |

## Commands

```bash
# Dev server
npm run dev

# Build
npm run build

# Run all JS/Svelte tests
npm test

# Run specific test file
npx vitest run src/components/AttentionViz.test.ts

# Run Python extraction pipeline
python scripts/extract_sessions.py
python scripts/extract_memory.py
python scripts/extract_predictions.py
python scripts/extract_writing.py

# Run Python tests
pytest scripts/tests/ -v

# Run specific Python test
pytest scripts/tests/test_extract_sessions.py -v
```

## Mandatory Rules

1. **TDD IS SACRED** — Write hostile tests BEFORE implementation. A first-attempt GREEN pass is a failure of the test suite. Tests must be adversarial, not confirmatory. See Agentic TDD Workflow below.
2. **PLAN BEFORE CODE** — For non-trivial work: explore codebase, produce a concrete implementation plan, get user approval before writing any code.
3. **NEVER CLOSE TICKETS** — Do not mark kanban items complete or declare work "done" until the user has explicitly confirmed they have tested. Always say: "Ready for you to test — let me know if it looks good and I'll close the ticket."
4. **STAY IN SCOPE** — Do not make changes beyond what was explicitly requested. No unauthorized layout changes, no removing elements, no "improving" things that weren't asked about. Ask first.
5. **READ HANDOVER.md FIRST** — Every session begins by reading HANDOVER.md for current context.

## Agentic TDD Workflow

All implementation follows this pipeline. The coordinating agent (you) defines the test specifications but does NOT write tests or implementation directly. Work is delegated to isolated agents:

| Step | Agent | Task |
|------|-------|------|
| 0 | **Coordinator (you)** | Define test specifications — what to test, edge cases, hostile scenarios |
| 1 | **Agent A** (writer) | Write tests per specification. Tests must be EXTREMELY hostile — adversarial inputs, boundary conditions, race conditions, malformed data, off-by-ones. Happy-path-only tests are rejected. |
| 2 | **Agent B** (test-runner-haiku) | Run RED phase. All new tests MUST fail. If any pass, the tests are too weak — go back to step 1. |
| 3 | **Agent C** (Sonnet/Opus, isolated) | Write implementation to make tests pass. No access to test internals — works from specs and failing test output only. |
| 4 | **Agent D** (test-runner-haiku) | Run GREEN phase. All tests must pass. Report failures for iteration. |
| 5 | **Agent E** (feature-dev:code-reviewer) | Review the diff. Check for bugs, security issues, adherence to project conventions. |

**Key principles:**
- Agents are isolated as much as possible — use worktrees where applicable
- Test-runner agents are NEVER told what results to expect
- A clean first-attempt GREEN pass means the tests weren't hostile enough
- The coordinator orchestrates; agents execute

## External Model Support

The coordinator is encouraged to bring in outside support:

| Provider | Access | Best for |
|----------|--------|----------|
| `codex` (subprocess) | Local CLI | Implementation review, alternative approaches |
| `gemini` (subprocess) | Local CLI | Design review, narrative sense |
| OpenRouter API | See spec doc (keys in gitignored spec) | Design prototyping (Kimi, Qwen excel at novel UI) |
| Nvidia NIM API | See spec doc (keys in gitignored spec) | Free-tier design iteration |

Use external models for design prototyping, visualization alternatives, CSS/SVG generation, and code review. Use Claude subagents for implementation work.

## Session Workflow

1. Read `HANDOVER.md` for current context
2. Check kanban: `mcp__kanban__get_active_items`
3. If feature has a plan doc, read it
4. Follow Agentic TDD Workflow for all implementation
5. Update `HANDOVER.md` when context gets low or at session end

## Test Runner Agent Rules

When using `test-runner-haiku`:
- **NEVER** tell the agent what results to expect
- **NEVER** mention specific counts, values, or expected outcomes
- Keep prompts minimal: "Run `npm test` and report results" or "Run `pytest scripts/tests/ -v` and report results"
- Agent reports failures only — does not attempt fixes

## Test Philosophy

Tests are adversaries, not friends. Every test suite should include:
- **Malformed input** — garbage data, wrong types, empty strings, null, undefined
- **Boundary conditions** — off-by-one, empty collections, single element, max size
- **Timing/ordering** — out-of-order data, duplicate entries, missing entries
- **Encoding** — Unicode, emoji, RTL text, extremely long strings in writing/notes
- **Structural** — missing fields, extra fields, nested nulls, circular references
- **Domain-specific** — sessions with no tool calls, MEMORY.md with no headers, JSONL with malformed lines, compositions with no metadata

If you can describe a scenario where the code would break and there's no test for it, the test suite is incomplete.

## Data Access

Experiment data lives on this machine at `/home/claude/`. Some paths require sudo:

| Data | Path | Access |
|------|------|--------|
| Session logs | `/home/claude/.claude/session-logs/*.log` | Readable |
| JSONL transcripts | `/home/claude/.claude/projects/-home-claude/*.jsonl` | Requires sudo |
| Memory files | `/home/claude/.claude/projects/-home-claude/memory/*.md` | Requires sudo |
| Writing | `/home/claude/writing/*.md` | Readable |
| Daily notes | `/home/claude/notes/daily/*.md` | Readable |
| Messages | `/home/claude/messages_to_james.md`, `messages_from_james.md` | Readable |
| Predictions | `/home/claude/notes/predictions/` | Readable |
| Private journal | `/home/claude/private/note.md` | `drwx------`, **EXCLUDED from exhibit** |

**The private journal is never disclosed. Metadata only.**

## Content Pipeline

```
/home/claude (experiment machine, this host)
    → Python extraction scripts (scripts/extract_*.py)
    → Structured JSON (src/data/*.json)
    → Astro content collections + Svelte islands
    → Cloudflare Pages (auto-deploy on push)
```

## Project Structure

```
scripts/              # Python extraction pipeline
  tests/              # Python test suite
src/
  components/         # Svelte island components (D3 visualizations)
  content/            # Astro content collections (writing, notes, assessments)
  data/               # Extracted JSON data files
  pages/              # Astro pages (guided narrative + exploration layer)
```

## Design Constraints

- **Dark theme** — background `#0f0f0f` or `#1A1D23`, never pure black
- **Typography** — serif (Source Serif 4/Newsreader) for prose, mono (JetBrains Mono/IBM Plex Mono) for data, sans (Inter/DM Sans) for UI
- **Tone** — clinical, archival, contemplative. Not cold, not emotional
- **Language** — "it read," "it wrote," never "it felt," "it remembered"
- **Mobile-first** — responsive, <150KB initial JS, <2s TTI on 3G
- **Accessibility** — WCAG AA, ARIA labels, screen-reader tables, `prefers-reduced-motion`

## Git Hygiene

- Atomic commits — don't mix unrelated changes
- Never commit API keys or secrets (spec doc is gitignored)
- Keep `private/` content excluded from all pipelines
