# Spec 5.5.2 — deriveArchiveFragments (src/lib/transforms.ts)

Status: MECHANICS FINAL; curation parameter DEFAULTS provisional pending council + James
(gate). The function is curation-parameterized so the gate outcome changes only the
call-site arguments (pattern: mergeTransitionCuration overlay), never the mechanics.

## Signature

```ts
export interface ArchiveFragment {
  id: string;          // quote id (stable hash from quotes.json)
  sessionId: string | null; // joined same-day session id, or null if no join
  date: string;        // quote date, YYYY-MM-DD
  version: string | null;   // quote.model_version, else joined session.version, else null
  excerpt: string;     // derived per excerptRule — verbatim prefix of quote text
  source: string | null;    // quote.source_type passthrough (no enum enforcement)
  sourceFile: string | null;// quote.source_file passthrough
}

export interface ArchiveFragmentOptions {
  cap?: number;              // max fragments returned; default: no cap
  excludeIds?: string[];     // curation exclusions (quote ids)
  pinnedIds?: string[];      // always included if valid+eligible; count toward cap
  excerptRule?: { mode: 'sentence' | 'chars'; maxChars: number };
                             // default { mode: 'chars', maxChars: 140 } — PROVISIONAL
}

export function deriveArchiveFragments(
  sessions: any[],
  quotes: any[],
  options?: ArchiveFragmentOptions,
): ArchiveFragment[];
```

## Rules (mechanics — final)

1. **Defensive inputs.** Non-array `sessions` or `quotes` → treated as `[]`. Never throws
   on malformed rows; invalid rows are silently dropped. This includes rows with HOSTILE
   PROPERTY GETTERS: if reading any field of a row throws, that row is malformed — the
   quote is dropped / the session is excluded from the join — and the exception never
   escapes `deriveArchiveFragments`. Inputs are NEVER mutated.
2. **Quote validity.** A quote row is valid iff: object (not null/array), `id` is a
   non-empty string, `text` is a string non-empty after trim, `date` is a string matching
   `/^\d{4}-\d{2}-\d{2}$/` AND a real calendar date (2026-02-30 is invalid). Anything else
   dropped. Duplicate quote ids: first occurrence in input order wins; later dropped.
3. **Session join.** Valid sessions (object, non-empty string `id`, valid date per rule 2)
   grouped by date. For a quote's date, joined session = same-date session, AM before PM
   (missing/unknown `time_of_day` ranks as AM — same rank rule as deriveVersionTransitions),
   ties broken by session id ascending (string compare). No same-day session → sessionId
   null; the fragment SURVIVES (archive material is not lost to a join miss).
   COORDINATOR RULING (hardening round): rows fully tied on (date, time_of_day rank,
   id) are further tie-broken by version ascending (raw string compare; missing,
   non-string, or EMPTY-STRING version ranks LAST — an empty string normalizes to a
   null version in output, so for tie-breaking it counts as missing; a row carrying a
   real version must never lose to a row whose version is effectively absent). Rows still tied after that are identical in every
   field the join reads (id, date, time_of_day, version), so the pick is immaterial —
   the join is a pure function of the session SET, never of input order.
4. **Version.** `quote.model_version` if non-empty string; else joined session's `version`
   if non-empty string; else null. NO hardcoded version list anywhere (N-version-proof —
   '5.0' must flow through untouched). Own-property access only (guard the
   prototype-chain-lookup class, cf. #62868).
5. **Excerpt derivation.** Verbatim prefix only — no rewording, no re-joining.
   - `chars` mode: if `text.length <= maxChars` → full text. Else cut at the LAST
     whitespace at-or-before index maxChars; if that cut would split a surrogate pair,
     back off one more code unit; if no whitespace exists in range, hard-cut at maxChars
     (surrogate-safe). Trim trailing whitespace, append U+2026 `…` (single char, never
     `...`).
   - `sentence` mode: prefix up to and including the first `.` `!` `?` or `…` that is
     followed by whitespace or end-of-text; if none exists, fall back to `chars` behavior
     with the same maxChars.
   - `maxChars <= 0` or non-finite → treated as the default 140.
6. **Eligibility + selection.**
   - Drop quotes whose id is in `excludeIds`.
   - Candidates = valid, non-excluded quotes.
   - `pinnedIds` candidates are always selected first (in pinned-array order, deduped);
     pinned ids that are invalid/excluded/unknown are ignored.
   - Remaining slots (cap minus pinned count) filled by deterministic sample: sort
     candidates by FNV-1a 32-bit hash (offset 2166136261, prime 16777619, over UTF-16
     code units via charCodeAt, unsigned >>> 0) of the string `${sessionId ?? ''}:${id}`,
     ascending numeric; tie-break by id ascending. NO Math.random, NO Date.now. Tests
     pin DETERMINISM and stability-under-input-shuffle, not exact hash values.
   - `cap` undefined/non-finite → all candidates. `cap <= 0` → pinned-only? NO: cap 0
     returns `[]` (cap is a hard ceiling, pinned included). Negative/NaN cap → treated
     as 0/[] (hostile-test decides exact pin: negative and NaN both → []).
7. **Output order.** Selected fragments sorted chronologically: date asc, then joined
   session time_of_day (AM before PM, null ranks AM), then quote id asc. Deterministic
   across runs and platforms (no locale-dependent compare — use `<`/`>` on raw strings).
8. **Purity.** Same inputs → identical output (deep-equal AND ordering). No I/O, no
   globals, no randomness.

## Curation parameters (provisional — FINAL VALUES AFTER GATE)

- Call site (page/data wiring — happens in 5.5.3 integration, not in this transform):
  `excludeIds` = council+James exclusion list; `cap` = council+James density;
  `excerptRule` = council+James rule; `pinnedIds` = at least `['36d6f794…full id']`
  (the quote containing the alignment payoff line "Hello, future self…" —
  quotes.json id `36d6f794` prefix; full id in data).

## Data facts (for test realism, not for hardcoding)

- quotes.json: 63 rows; keys: id, date, model_version, source_file, source_type,
  suggested_section, text, themes. source_type ∈ {writing, daily_note, message} today —
  transform must NOT enforce this set.
- sessions.json: 378 rows; keys incl. id, date, time_of_day ('AM'|'PM'), version.
  All 63 quote dates currently have a same-day session — tests must cover the miss case
  anyway.
- No 4.8-era quotes exist (extraction ceiling 2026-05-18) — transform must not care.

## RED-isolation import pattern (Agent A MUST use this)

New tests live in `src/lib/transforms.test.ts` (per plan) but must NOT take the existing
~200 transform tests down with a link-time SyntaxError while the export doesn't exist
yet. Access the function via namespace lookup, not a named import:

```ts
import * as transformsModule from './transforms';
const deriveArchiveFragments: any = (transformsModule as any).deriveArchiveFragments;
```

During RED each new test fails individually (TypeError: not a function); existing tests
stay green. The pattern remains valid after GREEN — no rework.

## Hostile test inventory (transforms.test.ts additions — Agent A)

Malformed: null/undefined/non-array inputs; quote rows as null, arrays, numbers,
strings; missing/empty/non-string id/text/date; date wrong shape ('2026-1-5',
'2026-13-01', '2026-02-30', ISO datetime, whitespace-padded); text whitespace-only;
prototype-pollution shaped rows (`{"__proto__": …}`, version present only on prototype
chain — must not leak, cf. #62868).
Boundary: empty corpus both sides; single quote; cap 0 / 1 / negative / NaN / Infinity /
undefined / larger-than-corpus; text exactly maxChars, maxChars+1, maxChars-1; no
whitespace in text (hard-cut path); whitespace-only prefix region; maxChars 0/negative/
NaN (→ default 140).
Encoding: emoji (incl. surrogate pair straddling the cut index — must not split), RTL
text, combining marks, 10k-char text, newlines/tabs in text (excerpt keeps them — verbatim),
ellipsis is U+2026 exactly once and only when truncated.
Timing/ordering: duplicate quote ids (first wins); two sessions same date AM+PM (AM
joins); PM-only date (PM joins); session with missing time_of_day (ranks AM); quotes fed
out of chronological order (output still sorted); join miss (sessionId null, fragment
kept).
Determinism: two identical calls deep-equal INCLUDING order; sampling with cap < corpus
is stable across shuffled input order of quotes (same selected id set); no Math.random /
Date usage (spy-based pin).
Curation semantics: excludeIds removes; unknown excludeIds ignored; pinnedIds always
present when valid; pinned + cap interaction (cap 1 with 1 pin + 62 others → only the
pin); pinned id also in excludeIds → excluded wins (exclusion is absolute); duplicate
pinnedIds don't duplicate output.
Version: model_version absent → session version used; both absent → null; novel version
'5.0' flows through; version on prototype only → null.
Purity: input arrays and rows not mutated (deep-freeze probe).
