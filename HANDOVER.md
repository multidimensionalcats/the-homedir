# HANDOVER.md

## NEXT SESSION: Phase 2 — Data Extraction Pipeline

### What needs doing
- **Phase 1** (git repo on experiment machine) is done — user confirmed `/home/claude` has git init
- **Phase 2**: Build the Python extraction pipeline (`extract_sessions.py`, `extract_memory.py`, `extract_predictions.py`, `extract_writing.py`)
- Start with `extract_sessions.py` — it's the foundation everything else depends on
- See `home-directory-spec.md` (gitignored, local only) §5 for full extraction specifications

### What's set up
- GitHub repo: https://github.com/multidimensionalcats/the-homedir
- Remote configured, no commits pushed yet
- `.gitignore` covers: spec doc (has API keys), `.env`, `node_modules/`, `dist/`
- `CLAUDE.md` written with full project rules
- Astro project not yet scaffolded (Phase 5 in spec)

### Decisions made
- Spec doc stays gitignored (contains API keys)
- Agentic TDD workflow: coordinator defines tests → Agent A writes → Agent B runs RED → Agent C implements → Agent D runs GREEN → Agent E reviews
- External models (OpenRouter, NIM, codex, gemini) available for design prototyping
- Experiment data accessible locally at `/home/claude/` (some paths need sudo)

### Open questions
- No initial commit yet — need to decide what goes in it (CLAUDE.md, HANDOVER.md, .gitignore?)
- Astro scaffolding timing — spec says Phase 5, but could start earlier in parallel
- Experiment repo on `/home/claude` has no remote yet — needs `.gitignore` and push setup
