# Plan: Fill Model Council Spec Gaps

## Context

`scripts/model_council.py` works end-to-end (101 tests passing, live 3-round council completed). The spec at `.claude/specs/model-council-framework.md` defines several features that weren't in the initial implementation. This plan fills those gaps.

## Changes (in dependency order)

### Step 1: Per-participant `max_tokens` and `timeout` overrides

**Files:** `model_council.py`, `test_model_council.py`

Add `max_tokens: int | None = None` and `timeout: int | None = None` to the frozen `Participant` dataclass (after `persona` — defaults make it backwards-compatible). In `_call_participant`, use `participant.max_tokens if participant.max_tokens is not None else self.max_tokens` (same pattern for timeout). Update `load_transcript` to read these fields with `.get()`.

**Tests (~13):** New `TestPerParticipantOverrides` class — verify field defaults, frozen immutability, per-participant values used in requests, council fallback when None, round-trip persistence, loading old transcripts without new fields.

### Step 2: API key from spec file

**Files:** `model_council.py`, `test_model_council.py`

Add `_read_spec_api_key()` helper — reads `home-directory-spec.md` line 17 (format: `API Key: sk-or-v1-...`), returns key or None. Add as third fallback in `__init__` after env var. Silent failure on any error.

**Tests (~5):** Extend `TestAPIKeyResolution` — spec file fallback works, missing file handled, wrong format handled, explicit key takes priority.

### Step 3: Rate limit backoff

**Files:** `model_council.py` (add `import time`), `test_model_council.py`

Wrap HTTP call in `_call_participant` with retry loop: catch `HTTPError` with code 429, retry up to 3 times with delays [1, 2, 4] seconds. Only 429 is retried — 500s and other errors propagate immediately. `time.sleep` in thread workers is safe.

**Tests (~7):** New `TestRateLimitBackoff` class — 429 retried then succeeds, all retries exhausted, 500 not retried, backoff delays verified via `time.sleep` mock, non-HTTP errors not retried.

### Step 4: Cost tracking aggregation

**Files:** `model_council.py`, `test_model_council.py`

Add `usage` dict (prompt/completion/total tokens) to `_parse_response` return value alongside existing `tokens` int (backwards-compatible). Add `cost_summary` property aggregating per-round and grand total. Append "Token Usage" section to `print_transcript()` output.

**Tests (~8):** New `TestCostTracking` class — empty council, single round, multi-round aggregation, missing usage handled as zero, partial usage, markdown output includes usage section.

### Step 5: Context limit warnings

**Files:** `model_council.py`, `test_model_council.py`

Add `_estimate_tokens(messages)` method (chars / 4 heuristic). Add `context_token_limit` param to `__init__` (default 100K). In `run_round`, warn to stderr if any participant's context exceeds threshold. Warning doesn't block execution.

**Tests (~6):** New `TestContextLimitWarnings` class — no warning below threshold, warning above, participant named in warning, custom threshold, execution continues despite warning, estimator unit test.

### Step 6: Participant presets

**Files:** `model_council.py`, `test_model_council.py`, NEW `scripts/council_presets.json`

Create JSON presets file with named groups (design-review, code-review, quote-curation). Add `_load_presets(name)` helper. In CLI `_parse_args`, make `--models` and `--participants` mutually exclusive (one required). Update `main` to handle `--participants` by loading from presets.

**Tests (~7):** New `TestParticipantPresets` class — valid load, unknown name error, missing file error, max_tokens in preset, CLI flag parsing, mutual exclusion.

## Execution

Follow agentic TDD per CLAUDE.md: for each step, write tests (RED), implement (GREEN), review. Each step is one commit. Total ~46 new tests.

## Verification

After all steps: `pytest scripts/tests/test_model_council.py -v` (all pass), `ruff check && ruff format --check` (clean), then run a live council using a preset to prove the full pipeline works end-to-end.
