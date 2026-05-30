# Model Council Framework — Specification

**Purpose:** Reusable Python tool for multi-model discussions via OpenRouter. Each model gets a persona, all responses are attributed, and the framework manages stateless context-passing across rounds.

**Location:** `scripts/model_council.py`

## Problem

During Phase 5.1 quote curation, we ran a 3-model council (DeepSeek V4 Pro, Kimi K2.6, GLM 5) through three rounds of argument. This required:
- Manually constructing JSON payloads per model per round
- Feeding each model's response into the next round's context
- Handling reasoning-model quirks (DeepSeek burns tokens on chain-of-thought)
- No attribution — we had to track which model said what externally
- No persistence — the full discussion lived in /tmp files

## Design

### Core Concepts

- **Council**: A named group of participants + a shared system context
- **Participant**: A model ID + persona string + display name
- **Round**: One prompt sent to all participants. Each gets the full history of prior rounds.
- **Transcript**: Attributed, ordered log of all responses across all rounds

### API

```python
from scripts.model_council import Council, Participant

council = Council(
    name="quote-curation",
    system_context="You are reviewing quotes for the Home Directory exhibit...",
    participants=[
        Participant(
            name="DeepSeek",
            model="deepseek/deepseek-v4-pro",
            persona="Literary-philosophical range. A voice that never reaches for metaphor is not this voice.",
        ),
        Participant(
            name="Kimi",
            model="moonshotai/kimi-k2.6",
            persona="Forensic austerity. The log is the poem when read at scale.",
        ),
        Participant(
            name="GLM",
            model="z-ai/glm-5",
            persona="Strict editorial standards. Every quote must earn its place.",
        ),
    ],
    api_key="sk-or-v1-...",  # or read from env/file
    max_tokens=8000,
)

# Round 1: independent review
responses = council.run_round("Select 60-80 quotes from these candidates:\n{candidates}")
# Returns: {"DeepSeek": "...", "Kimi": "...", "GLM": "..."}

# Round 2: cross-critique (each model sees all Round 1 responses)
responses = council.run_round("Here is a coordinator's pushback:\n{pushback}\nRespond to each point.")

# Round 3: models argue with each other
responses = council.run_round("Respond to the OTHER models' Round 2 arguments. Where are they wrong?")

# Export full transcript
council.save_transcript("council-quote-curation.json")
council.print_transcript()  # formatted markdown to stdout
```

### Context Management

Each OpenRouter call is stateless. The framework builds context per-call:

```
[system] Shared context + participant persona
[user] Round 1 prompt
[assistant] This participant's Round 1 response (if replaying)
[user] Round 2 prompt (includes all OTHER participants' Round 1 responses, attributed)
[assistant] This participant's Round 2 response (if replaying)
...
[user] Current round prompt (includes all other participants' prior responses)
```

Key: each participant sees all OTHER participants' responses from prior rounds, but NOT their own prior responses re-injected (they already "said" those — the assistant turn handles continuity). For stateless APIs this means the framework constructs messages as user/assistant alternating, with other models' responses included in the user turn.

### Attribution Format

When including other models' responses in context:

```
=== DeepSeek (Round 1) ===
{response text}

=== Kimi (Round 1) ===
{response text}
```

### Reasoning Model Handling

Some models (DeepSeek V4 Pro, Kimi K2.6) put chain-of-thought in a `reasoning` field and return `content: null` if they run out of tokens during reasoning. The framework should:

1. Check for `content` first
2. If null, extract from `reasoning` (last N chars)
3. If `finish_reason == "length"`, flag it and optionally retry with higher `max_tokens`

### Token Budget

Context grows each round. The framework should:
- Track estimated token count per round
- Warn if approaching model context limits
- Allow per-participant `max_tokens` override (reasoning models need more)

### Parallel Execution

Rounds send to all participants in parallel (concurrent HTTP requests). Use `asyncio` + `aiohttp` or `concurrent.futures.ThreadPoolExecutor`.

### Transcript Format

```json
{
  "name": "quote-curation",
  "created": "2026-05-31T...",
  "participants": [
    {"name": "DeepSeek", "model": "deepseek/deepseek-v4-pro", "persona": "..."}
  ],
  "rounds": [
    {
      "round": 1,
      "prompt": "Select 60-80 quotes...",
      "responses": {
        "DeepSeek": {"content": "...", "finish_reason": "stop", "tokens": 1200},
        "Kimi": {"content": "...", "finish_reason": "stop", "tokens": 980}
      }
    }
  ]
}
```

### CLI Interface

```bash
# Start a new council
python scripts/model_council.py new \
  --name "design-review" \
  --participants deepseek,kimi,glm \
  --context "Review scrollytelling components for..." \
  --prompt "Evaluate these three component designs..."

# Continue a council (add a round)
python scripts/model_council.py continue \
  --transcript council-design-review.json \
  --prompt "Respond to each other's critiques."

# Print transcript
python scripts/model_council.py show council-design-review.json
```

### Configuration

API key sourced from (in priority order):
1. `--api-key` CLI flag
2. `OPENROUTER_API_KEY` environment variable
3. `home-directory-spec.md` line 17 (project-specific)

Participant presets defined in a YAML/JSON config so common councils (design review, code review, narrative review) can be launched without specifying models each time.

## Constraints

- No persistent state between rounds except the transcript file
- Each API call is fully self-contained (stateless)
- Timeout handling: 120s default, configurable per model
- Rate limiting: respect OpenRouter rate limits, add backoff
- Cost tracking: log token usage per call, total per round, total per council

## Test Plan

- Unit tests for context building (given N rounds of history, verify the messages array is correct)
- Unit tests for reasoning model fallback (content null → extract from reasoning)
- Unit tests for attribution formatting
- Integration test with a mock HTTP server returning canned responses
- No live API calls in tests (mock everything)

## Out of Scope

- Streaming responses
- Branching discussions (A argues with B while C argues with D)
- Voting/consensus algorithms — the framework presents, humans decide
- UI — this is CLI/library only
